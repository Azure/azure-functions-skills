// studio-commands.mjs
//
// Shared four-command surface for every Cloud Foundation canvas: Run (canvas
// specific), Open in VS Code, Save to GitHub, and Deploy to Azure. This file is
// the single source of truth in scripts/lib and is vendored byte-identical into
// each canvas directory so a canvas stays independently installable (only its
// own directory ships when the plugin is installed). scripts/validate.mjs
// asserts every vendored copy matches this source.
//
// The command mechanics here are canvas-agnostic. Each canvas supplies its own
// materialize step (which files to write) and state snapshot; the helper owns
// the git/gh/azd/vscode process work, the shared button icons and CSS, and the
// client-side wiring.

import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// LOCAL means a loopback canvas or func start. CLOUD means deployed to Azure Functions via azd.
export const RUNTIME_MODE = { LOCAL: "local", CLOUD: "cloud" };

export const AZD_DOCS_URL = "https://learn.microsoft.com/azure/developer/azure-developer-cli/";

export function resolveStudioBuildInfo(moduleUrl, fallbackVersion = "unknown") {
	let version = fallbackVersion;
	let revision = "unknown";
	try {
		version = JSON.parse(readFileSync(new URL("./package.json", moduleUrl), "utf8")).version || fallbackVersion;
	} catch {
		// Keep the footer available in a partially packaged development copy.
	}
	try {
		revision = createHash("sha256").update(readFileSync(new URL(moduleUrl))).digest("hex").slice(0, 10);
	} catch {
		// A stable fallback is clearer than preventing the canvas from opening.
	}
	return { version, revision };
}

// Product icons (VS Code, GitHub, Azure) as inline SVG so buttons render without assets.
export const ICONS = {
	vscode:
		'<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M23.15 2.587 18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z"/></svg>',
	github:
		'<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>',
	azure:
		'<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.05 2 4 20.01h5.86l1.45-3.73 5.63 5.72H24L13.05 2Zm.8 6.42 4.37 10.36-5.25-4.79 2.91-5.01-2.03-.56ZM10.1 17.73H6.78l5.45-10.85 1.43 3.38-3.56 7.47Z"/></svg>',
};

// The three portable command buttons. The canvas supplies its own primary Run button.
export const COMMAND_BUTTONS = `<button class="btn ghost" id="open-vscode">${ICONS.vscode}<span class="label">Open in VS Code</span></button>
      <button class="btn ghost" id="save-github">${ICONS.github}<span class="label">Save to GitHub</span></button>
      <button class="btn ghost" id="deploy-azure">${ICONS.azure}<span class="label">Deploy to Azure</span></button>`;

// Shared CSS for the command buttons, deploy status panel, and mode badge.
// Canvases define their own --accent / --line / --ink / --muted / --panel palette.
export const COMMAND_CSS = `.btn {
    border: none; cursor: pointer; border-radius: 10px; padding: 10px 16px;
    font-size: .86rem; font-weight: 600; color: #0b1120;
    background: linear-gradient(135deg, var(--accent), #ffcf6b);
    display: inline-flex; align-items: center; gap: .45rem;
  }
  .btn svg { width: 15px; height: 15px; flex: 0 0 auto; }
  .btn:hover { filter: brightness(1.05); }
  .btn.ghost { background: transparent; color: var(--muted); border: 1px solid var(--line); }
  .btn.ghost:hover { color: var(--ink); }
  .mode-badge {
    display: inline-block; font-size: .72rem; color: var(--muted); border: 1px solid var(--line);
    border-radius: 999px; padding: 3px 10px; background: var(--panel);
  }
  .deploy-status {
    display: none; color: var(--muted); font-size: .78rem; line-height: 1.45;
    margin: -.35rem 0 1rem; padding: .65rem .75rem; border: 1px solid var(--line);
    border-radius: 10px; background: rgba(255,255,255,.03); overflow-wrap: anywhere;
  }
  .deploy-status.show { display: block; }
  .deploy-status strong { color: var(--ink); }
  .deploy-status a { color: var(--accent2); text-decoration: none; }
  .deploy-status a:hover { text-decoration: underline; }`;

// Client-side wiring for the three command buttons plus the deploy-status and
// mode-badge elements. The canvas provides window.cmdSetStatus(message, url) and
// calls window.applyCommandState(state) from its own EventSource state handler.
export function commandClientScript() {
	return `
    (function () {
      function postJson(url) { return fetch(url, { method: 'POST' }).then(function (r) { return r.json(); }); }
      var openVscode = document.getElementById('open-vscode');
      var saveGithub = document.getElementById('save-github');
      var deployAzure = document.getElementById('deploy-azure');
      var deployStatus = document.getElementById('deploy-status');
      var modeBadge = document.getElementById('mode-badge');
      function status(message, url) {
        if (typeof window.cmdSetStatus === 'function') window.cmdSetStatus(message, url);
      }
      window.applyCommandState = function (state) {
        if (modeBadge) {
          var cloud = state.runtimeMode === 'cloud';
          modeBadge.textContent = cloud ? 'Mode: Cloud (Azure Functions)' : 'Mode: Local';
        }
        if (saveGithub) {
          var lbl = saveGithub.querySelector('.label');
          if (lbl) lbl.textContent = state.repoUrl ? 'Open on GitHub' : 'Save to GitHub';
        }
        if (deployStatus) {
          if (state.deployStatus) {
            deployStatus.classList.add('show');
            deployStatus.innerHTML = '<strong>Deploy:</strong> ' + state.deployStatus;
            if (state.deployDocsUrl) deployStatus.innerHTML += ' <a href="' + state.deployDocsUrl + '" target="_blank" rel="noreferrer">Install azd</a>';
            if (state.deployCommand) deployStatus.innerHTML += '<br /><code>' + state.deployCommand + '</code>';
          } else {
            deployStatus.classList.remove('show');
            deployStatus.textContent = '';
          }
        }
        if (deployAzure) {
          // state.azdOperation is only present on canvases with a second azd
          // write path to guard against (e.g. Create Models' azd provision);
          // canvases without one simply never set it, so this is a no-op there.
          var azdOp = state.azdOperation;
          var blocked = Boolean(azdOp && azdOp.active);
          var deploying = Boolean(blocked && azdOp.kind === 'deploy');
          deployAzure.disabled = blocked;
          var deployLabel = deployAzure.querySelector('.label');
          if (deployLabel) deployLabel.textContent = deploying ? 'Deploying...' : (deployAzure.dataset.label || 'Deploy to Azure');
          deployAzure.title = blocked
            ? deploying
              ? 'Deployment is running. Expand Deployment output to follow progress or cancel it.'
              : (azdOp.label || 'Another azd operation') + ' is still running for this working copy - wait for it to finish before deploying.'
            : '';
        }
      };
      if (openVscode) openVscode.addEventListener('click', async function () {
        status('Opening VS Code...');
        var result = await postJson('/open-vscode');
        status(result.ok ? (result.message || 'Opened in VS Code: ' + result.dir) : result.message);
      });
      if (saveGithub) saveGithub.addEventListener('click', async function () {
        status('Saving to GitHub...');
        var result = await postJson('/save-github');
        if (result.ok) { window.open(result.url, '_blank'); status('', result.url); }
        else { status(result.message || 'Save to GitHub failed.'); }
      });
      if (deployAzure) deployAzure.addEventListener('click', async function () {
        if (deployAzure.disabled) { status(deployAzure.title); return; }
        status(deployAzure.dataset.startMessage || 'Preparing Azure Functions azd project...');
        var lbl = deployAzure.querySelector('.label');
        var idleLabel = deployAzure.dataset.label || 'Deploy to Azure';
        if (lbl) lbl.textContent = 'Deploying...';
        var result = await postJson('/deploy-azure');
        if (lbl && !result.ok) lbl.textContent = idleLabel;
        status(result.message || (result.ok ? 'azd up launched.' : 'Deploy setup needs attention.'));
      });
    })();
  `;
}

export function safeSegment(value) {
	return String(value || "instance").replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80) || "instance";
}

export function responseJson(res, data) {
	res.writeHead(200, { "Content-Type": "application/json" });
	res.end(JSON.stringify(data));
}

export function shortError(error) {
	return String(error?.stderr || error?.stdout || error?.message || error || "Command failed")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 300);
}

const AZURE_CLI_ENV_KEYS = [
	"HOME",
	"PATH",
	"USER",
	"LOGNAME",
	"TMPDIR",
	"LANG",
	"LC_ALL",
	"SHELL",
	"AZURE_CONFIG_DIR",
	"XDG_CONFIG_HOME",
];

// Keep Azure CLI on the user's existing token cache and strip GUI-host auth
// variables that can force an interactive broker flow.
export function azureCliChildEnv(source = process.env) {
	const env = {};
	for (const key of AZURE_CLI_ENV_KEYS) {
		if (source[key] != null) env[key] = source[key];
	}
	return env;
}

// Corporate networks often block the public PyPI CDN (files.pythonhosted.org)
// while allowing an internal package mirror configured for pip (via
// pip.conf/PIP_INDEX_URL). `uv` does not read pip's config and defaults
// straight to pypi.org, so a machine that has always worked fine with `pip
// install` can fail outright the first time this canvas uses `uv`. Detect the
// user's already-configured pip mirror and pass it to uv as well, so both
// tools agree on where packages come from.
const PIP_CONF_PATHS =
	process.platform === "win32"
		? [path.join(process.env.APPDATA || "", "pip", "pip.ini")]
		: process.platform === "darwin"
			? [
					"/Library/Application Support/pip/pip.conf",
					"/opt/homebrew/share/pip/pip.conf",
					path.join(homedirForEnv(), ".config", "pip", "pip.conf"),
					path.join(homedirForEnv(), ".pip", "pip.conf"),
				]
			: [
					"/etc/pip.conf",
					"/etc/xdg/pip/pip.conf",
					path.join(homedirForEnv(), ".config", "pip", "pip.conf"),
					path.join(homedirForEnv(), ".pip", "pip.conf"),
				];

function homedirForEnv() {
	return process.env.HOME || os.homedir();
}

function parseIndexUrlFromIni(text) {
	const match = /^\s*index-url\s*=\s*(\S+)\s*$/m.exec(text);
	return match ? match[1] : "";
}

let cachedPipIndexUrl;
export async function findPipIndexUrl() {
	if (cachedPipIndexUrl !== undefined) return cachedPipIndexUrl;
	cachedPipIndexUrl =
		process.env.PIP_INDEX_URL ||
		process.env.UV_INDEX_URL ||
		process.env.UV_DEFAULT_INDEX ||
		"";
	if (!cachedPipIndexUrl) {
		// `pip config list` resolves the same precedence pip itself uses
		// (env > global > site > user) across whatever config paths exist on
		// this OS - more reliable than us re-guessing pip's search paths.
		for (const pipBin of ["pip3", "pip"]) {
			try {
				const { stdout } = await execFileTextPromise(pipBin, ["config", "list"]);
				const match = /^global\.index-url\s*=\s*'?([^'\n]+)'?\s*$/m.exec(stdout);
				if (match) {
					cachedPipIndexUrl = match[1].trim();
					break;
				}
			} catch {
				/* pip not installed or config command unavailable */
			}
		}
	}
	if (!cachedPipIndexUrl) {
		for (const confPath of PIP_CONF_PATHS) {
			if (!confPath) continue;
			try {
				const text = await readFile(confPath, "utf8");
				const url = parseIndexUrlFromIni(text);
				if (url) {
					cachedPipIndexUrl = url;
					break;
				}
			} catch {
				/* config file not present at this path */
			}
		}
	}
	cachedPipIndexUrl = cachedPipIndexUrl || "";
	return cachedPipIndexUrl;
}

function execFileTextPromise(file, args) {
	return new Promise((resolve, reject) => {
		execFile(file, args, { timeout: 5000 }, (error, stdout, stderr) => {
			if (error) {
				error.stdout = stdout;
				error.stderr = stderr;
				reject(error);
				return;
			}
			resolve({ stdout, stderr });
		});
	});
}

// Env overrides to hand `uv` the same package index pip is already
// configured to use, if one is configured. Returns {} when none is found, so
// callers can safely spread it without disturbing default env inheritance.
export async function uvIndexEnv() {
	const url = await findPipIndexUrl();
	if (!url) return {};
	return { UV_INDEX_URL: url, UV_DEFAULT_INDEX: url };
}

function tokenExpiryMs(token) {
	const epochSeconds = Number(token?.expires_on || token?.expiresOnTimestamp || 0);
	if (Number.isFinite(epochSeconds) && epochSeconds > 0) return epochSeconds * 1000;
	const parsed = Date.parse(String(token?.expiresOn || ""));
	return Number.isFinite(parsed) ? parsed : 0;
}

export function createAzureCliSession(runJson, { metadataTtlMs = 5 * 60 * 1000, now = () => Date.now() } = {}) {
	const values = new Map();
	const pending = new Map();
	const generations = new Map();

	async function cached(key, validUntil, loader, force = false) {
		const existing = values.get(key);
		if (!force && existing && existing.validUntil > now()) return existing.value;
		if (!force && pending.has(key)) return pending.get(key);
		const generation = (generations.get(key) || 0) + 1;
		generations.set(key, generation);
		const promise = Promise.resolve()
			.then(loader)
			.then((value) => {
				if (generations.get(key) === generation) {
					values.set(key, { value, validUntil: validUntil(value) });
				}
				return value;
			})
			.finally(() => {
				if (pending.get(key) === promise) pending.delete(key);
			});
		pending.set(key, promise);
		return promise;
	}

	return {
		account(force = false) {
			return cached("account", () => now() + metadataTtlMs, () => runJson(["account", "show", "-o", "json"]), force);
		},
		subscriptions(force = false) {
			return cached(
				"subscriptions",
				() => now() + metadataTtlMs,
				() => runJson(["account", "list", "--query", "[?state=='Enabled']", "-o", "json"]),
				force,
			);
		},
		accessToken(subscription, resource, force = false) {
			const key = `token:${subscription || "default"}:${resource}`;
			return cached(
				key,
				(token) => Math.max(now(), tokenExpiryMs(token) - 5 * 60 * 1000),
				() => runJson(["account", "get-access-token", "--resource", resource, "-o", "json"], subscription),
				force,
			);
		},
		clear() {
			values.clear();
			generations.clear();
		},
	};
}

export async function runAzureCliJson(
	args,
	subscription,
	{
		timeout = 30000,
		maxBuffer = 1024 * 1024,
		env = azureCliChildEnv(),
		execute = execFileText,
	} = {},
) {
	const full = subscription ? [...args, "--subscription", subscription] : [...args];
	const withFlag = full.includes("--only-show-errors") ? full : [...full, "--only-show-errors"];
	const { stdout } = await execute("az", withFlag, { env, maxBuffer, timeout });
	const text = stdout.trim();
	return text ? JSON.parse(text) : null;
}

function resolveWindowsCommand(file, env = process.env) {
	if (process.platform !== "win32" || path.extname(file)) return file;
	const pathValue = env.PATH || env.Path || "";
	const extensions = (env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";");
	for (const directory of pathValue.split(path.delimiter)) {
		if (!directory) continue;
		for (const extension of extensions) {
			const candidate = path.join(directory, `${file}${extension.toLowerCase()}`);
			if (existsSync(candidate)) return candidate;
		}
	}
	return file;
}

function quoteCmdArgument(value) {
	const text = String(value);
	if (/[\r\n\0]/.test(text)) throw new Error("Windows command arguments cannot contain newlines or NUL characters.");
	return `"${text.replace(/%/g, "%%").replace(/"/g, '""')}"`;
}

export function commandInvocation(file, args = [], env = process.env) {
	const executable = resolveWindowsCommand(file, env);
	if (process.platform !== "win32" || !/\.(?:cmd|bat)$/i.test(executable)) {
		return { executable, args };
	}
	const commandLine = [executable, ...args].map(quoteCmdArgument).join(" ");
	return {
		executable: process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe",
		args: ["/d", "/s", "/c", `"${commandLine}"`],
		windowsVerbatimArguments: true,
	};
}

export function execFileText(file, args, options = {}) {
	return new Promise((resolve, reject) => {
		const invocation = commandInvocation(file, args, options.env);
		execFile(
			invocation.executable,
			invocation.args,
			{ maxBuffer: 1024 * 1024, ...options, windowsVerbatimArguments: invocation.windowsVerbatimArguments },
			(error, stdout, stderr) => {
			if (error) {
				error.stdout = stdout;
				error.stderr = stderr;
				reject(error);
				return;
			}
			resolve({ stdout, stderr });
			},
		);
	});
}

export async function exists(filePath) {
	try {
		await stat(filePath);
		return true;
	} catch {
		return false;
	}
}

// Write a { relativePath: content } map into baseDir, creating parent folders.
export async function writeFiles(baseDir, files) {
	await mkdir(baseDir, { recursive: true });
	for (const [relativePath, content] of Object.entries(files)) {
		const filePath = path.join(baseDir, relativePath);
		await mkdir(path.dirname(filePath), { recursive: true });
		await writeFile(filePath, content);
	}
	return baseDir;
}

const REDACTED_MODE_PATTERN = /\buse\s+redacted\s+mode\b/i;
const REDACTED_COPY_SKIP = new Set([".git", ".venv", "node_modules", "__pycache__"]);

function isSensitiveKey(key) {
	const normalized = String(key || "")
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.replace(/[^A-Za-z0-9]+/g, "_")
		.toLowerCase();
	const compact = normalized.replaceAll("_", "");
	return (
		/(^|_)(secret|password|credential|token|sas|signature)($|_)/.test(normalized) ||
		compact.includes("apikey") ||
		compact.includes("clientsecret") ||
		compact.includes("functionkey") ||
		compact.includes("masterkey") ||
		compact.includes("connectionstring") ||
		compact === "azurewebjobsstorage"
	);
}

export function requestsRedactedMode(contents = []) {
	return contents.some((content) => REDACTED_MODE_PATTERN.test(String(content || "")));
}

async function projectInstructionContents(dir) {
	const instructionsPath = path.join(dir, ".github", "copilot-instructions.md");
	if (!(await exists(instructionsPath))) return [];
	return [await readFile(instructionsPath, "utf8")];
}

export async function shouldUseRedactedMode(dir, instructionContents = []) {
	return requestsRedactedMode([...instructionContents, ...(await projectInstructionContents(dir))]);
}

export async function readGlobalAppInstructionContents(
	dbPath = path.join(os.homedir(), ".copilot", "data.db"),
) {
	if (!(await exists(dbPath))) return [];
	let DatabaseSync;
	try {
		({ DatabaseSync } = await import("node:sqlite"));
	} catch (error) {
		throw new Error(`Cannot read global Sessions instructions safely: ${shortError(error)}`, { cause: error });
	}
	const db = new DatabaseSync(dbPath, { readOnly: true });
	try {
		const row = db.prepare("SELECT instructions FROM settings WHERE id = 1").get();
		return typeof row?.instructions === "string" && row.instructions.trim() ? [row.instructions] : [];
	} finally {
		db.close();
	}
}

function redactEnv(text) {
	const lines = text.split(/\r?\n/);
	let multilineQuote = "";
	return lines
		.map((line) => {
			if (multilineQuote) {
				if (line.includes(multilineQuote)) multilineQuote = "";
				return "REDACTED";
			}
			if (!line.trim() || line.trimStart().startsWith("#")) return line;
			const assignment = line.match(
				/^(\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*)(.*)$/,
			);
			if (!assignment || !isSensitiveKey(assignment[2])) return line;
			const value = assignment[3].trim();
			const openingQuote = value[0] === '"' || value[0] === "'" ? value[0] : "";
			if (openingQuote && !value.slice(1).includes(openingQuote)) multilineQuote = openingQuote;
			return `${assignment[1]}"REDACTED"`;
		})
		.join("\n");
}

function redactJsonValue(value, key = "", redactAll = false) {
	const shouldRedact = redactAll || isSensitiveKey(key);
	if (Array.isArray(value)) {
		return value.map((item) => redactJsonValue(item, key, shouldRedact));
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([childKey, childValue]) => [
				childKey,
				redactJsonValue(childValue, childKey, shouldRedact),
			]),
		);
	}
	return shouldRedact ? "REDACTED" : value;
}

function redactLocalSettings(text) {
	const settings = JSON.parse(text);
	return `${JSON.stringify(redactJsonValue(settings), null, 2)}\n`;
}

async function redactProjectConfigs(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const filePath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			await redactProjectConfigs(filePath);
			continue;
		}
		if (!entry.isFile()) continue;
		if (entry.name === ".env" || entry.name.startsWith(".env.")) {
			await writeFile(filePath, redactEnv(await readFile(filePath, "utf8")), { mode: 0o600 });
		} else if (entry.name === "local.settings.json") {
			await writeFile(filePath, redactLocalSettings(await readFile(filePath, "utf8")), { mode: 0o600 });
		}
	}
}

export async function createRedactedProjectCopy(dir) {
	const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cloud-foundation-redacted-"));
	const redactedDir = path.join(tempRoot, path.basename(dir));
	await cp(dir, redactedDir, {
		recursive: true,
		filter: async (source) => {
			if (source === dir) return true;
			const relative = path.relative(dir, source);
			if (REDACTED_COPY_SKIP.has(relative.split(path.sep)[0])) return false;
			return !(await lstat(source)).isSymbolicLink();
		},
	});
	await redactProjectConfigs(redactedDir);
	return redactedDir;
}

const DEPLOYMENT_COPY_SKIP = new Set([".git", ".venv", ".azurite", "node_modules", "__pycache__"]);

export async function prepareDeploymentProjectCopy(sourceDir, deployDir) {
	const source = path.resolve(sourceDir);
	const destination = path.resolve(deployDir);
	if (source === destination || destination.startsWith(`${source}${path.sep}`)) {
		throw new Error("Deployment workspace must be outside the generated app source.");
	}
	await mkdir(path.dirname(destination), { recursive: true });
	const nonce = `${process.pid}-${Date.now()}`;
	const nextDestination = `${destination}.next-${nonce}`;
	const previousDestination = `${destination}.previous-${nonce}`;
	const existingAzure = path.join(destination, ".azure");
	await rm(nextDestination, { recursive: true, force: true });
	await rm(previousDestination, { recursive: true, force: true });
	try {
		await mkdir(nextDestination, { recursive: true });
		for (const entry of await readdir(source, { withFileTypes: true })) {
			if (DEPLOYMENT_COPY_SKIP.has(entry.name) || entry.isSymbolicLink()) continue;
			await cp(path.join(source, entry.name), path.join(nextDestination, entry.name), {
				recursive: true,
				filter: async (candidate) => !(await lstat(candidate)).isSymbolicLink(),
			});
		}
		if (await exists(existingAzure)) {
			await rm(path.join(nextDestination, ".azure"), { recursive: true, force: true });
			await cp(existingAzure, path.join(nextDestination, ".azure"), { recursive: true });
		}
		if (await exists(destination)) await rename(destination, previousDestination);
		try {
			await rename(nextDestination, destination);
		} catch (error) {
			if (await exists(previousDestination)) await rename(previousDestination, destination);
			throw error;
		}
		await rm(previousDestination, { recursive: true, force: true });
		return destination;
	} finally {
		await rm(nextDestination, { recursive: true, force: true });
	}
}

export function redactDeploymentOutput(value) {
	return String(value || "")
		.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
		.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
		.replace(
			/((?:^|[\s,{])["']?[A-Za-z0-9_-]*(?:token|secret|password|key|connection[_-]?string)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
			"$1[REDACTED]",
		)
		.replace(/([?&](?:code|key|sig|token|secret)=)[^&\s]+/gi, "$1[REDACTED]");
}

export function createAzdPhaseTracker({ now = () => Date.now() } = {}) {
	const phases = Object.fromEntries(
		["provision", "package", "deploy"].map((name) => [
			name,
			{ name, state: "pending", startedAt: null, endedAt: null, durationMs: null, detail: "" },
		]),
	);
	const emit = (name, state, detail = "") => {
		const phase = phases[name];
		if (
			!phase ||
			phase.state === state ||
			["completed", "failed", "cancelled"].includes(phase.state)
		) {
			return null;
		}
		const timestamp = now();
		if (state === "started") {
			phase.state = "started";
			phase.startedAt = timestamp;
		} else {
			if (!phase.startedAt) phase.startedAt = timestamp;
			phase.state = state;
			phase.endedAt = timestamp;
			phase.durationMs = Math.max(0, timestamp - phase.startedAt);
		}
		phase.detail = detail;
		return { ...phase };
	};
	const feed = (line) => {
		const text = redactDeploymentOutput(line).trim();
		const events = [];
		const push = (event) => {
			if (event) events.push(event);
		};
		if (/Provisioning Azure resources(?:\s*\(azd provision\))?/i.test(text)) {
			push(emit("provision", "started", text));
		}
		if (/SUCCESS:.*\bprovisioned\b/i.test(text)) {
			push(emit("provision", "completed", text));
		}
		if (/Packaging services?(?:\s*\(azd package\))?|Packaging service\b/i.test(text)) {
			if (phases.provision.state === "started") push(emit("provision", "completed", "azd advanced to package"));
			push(emit("package", "started", text));
		}
		if (/SUCCESS:.*\bpackaged\b/i.test(text)) {
			push(emit("package", "completed", text));
		}
		if (/Deploying services?(?:\s*\(azd deploy\))?/i.test(text)) {
			if (phases.provision.state === "started") push(emit("provision", "completed", "azd advanced to deploy"));
			if (phases.package.state === "started") push(emit("package", "completed", "azd advanced to deploy"));
			push(emit("deploy", "started", text));
		}
		if (/SUCCESS:.*\bdeployed\b/i.test(text)) {
			push(emit("deploy", "completed", text));
		}
		return events;
	};
	const finish = ({ ok, cancelled = false, detail = "" }) => {
		const events = [];
		const terminalState = cancelled ? "cancelled" : ok ? "completed" : "failed";
		for (const name of ["provision", "package", "deploy"]) {
			const phase = phases[name];
			if (["completed", "failed", "cancelled"].includes(phase.state)) continue;
			const suffix =
				phase.state === "pending" && ok
					? " This azd version did not emit a separate phase heading."
					: phase.state === "pending"
						? " azd exited before reporting this phase."
						: "";
			const event = emit(name, terminalState, `${detail}${suffix}`.trim());
			if (event) events.push(event);
		}
		return events;
	};
	return { phases, feed, finish };
}

// Command: Open in VS Code. REDACTED mode opens a scrubbed temporary copy.
export async function openVsCode(dir, { instructionContents = [], filePath = "" } = {}) {
	const redacted = await shouldUseRedactedMode(dir, instructionContents);
	const openDir = redacted ? await createRedactedProjectCopy(dir) : dir;
	let openFile = "";
	if (filePath) {
		const relativeFile = path.relative(dir, filePath);
		if (relativeFile.startsWith("..") || path.isAbsolute(relativeFile)) {
			throw new Error(`VS Code file must be inside the project: ${filePath}`);
		}
		openFile = path.join(openDir, relativeFile);
	}
	return new Promise((resolve) => {
		const args = openFile ? [openDir, "--goto", openFile] : [openDir];
		const child = spawn("code", args, { stdio: "ignore", detached: true });
		child.once("error", (error) => {
			if (error?.code === "ENOENT") {
				resolve({
					ok: false,
					dir: openDir,
					redacted,
					message: `VS Code 'code' command not found on PATH. Open this folder manually: ${openDir}`,
				});
				return;
			}
			resolve({ ok: false, dir: openDir, redacted, message: shortError(error) });
		});
		child.once("spawn", () => {
			child.unref();
			resolve({
				ok: true,
				dir: openDir,
				sourceDir: redacted ? dir : undefined,
				filePath: openFile || undefined,
				redacted,
				message: redacted
					? `Opened a REDACTED demo copy in VS Code: ${openDir}`
					: `Opened in VS Code: ${openDir}`,
			});
		});
	});
}

// Command: Save to GitHub. Inits a repo if needed, commits, and creates a
// private GitHub repo via the gh CLI. Caller handles the "already saved" case.
export async function saveToGitHub(dir, { repoName, commitMessage }) {
	try {
		if (!(await exists(path.join(dir, ".git")))) {
			await execFileText("git", ["init", "-b", "main"], { cwd: dir });
		}
		await execFileText("git", ["add", "-A"], { cwd: dir });
		const status = await execFileText("git", ["status", "--porcelain"], { cwd: dir });
		if (status.stdout.trim()) {
			try {
				await execFileText("git", ["commit", "-m", commitMessage], { cwd: dir });
			} catch {
				await execFileText(
					"git",
					[
						"-c",
						"user.name=Cloud Foundation Studio",
						"-c",
						"user.email=noreply@localhost",
						"commit",
						"-m",
						commitMessage,
					],
					{ cwd: dir },
				);
			}
		}
		await execFileText("gh", ["repo", "create", repoName, "--private", "--source", dir, "--remote", "origin", "--push"], {
			cwd: dir,
		});
		const view = await execFileText("gh", ["repo", "view", repoName, "--json", "url", "-q", ".url"], { cwd: dir });
		const url = view.stdout.trim();
		return { ok: true, url, created: true, name: repoName };
	} catch (error) {
		return { ok: false, message: shortError(error) };
	}
}

// Command: Deploy to Azure. Verifies azd is installed, then launches `azd up`
// detached. onStatus receives partial deploy state for mid-flight broadcasts.
// onProcessExit (optional) is invoked exactly once, whenever this operation is
// fully done - either because it never actually started (azd missing, spawn
// failed) or, later and asynchronously, when the detached `azd up` process
// closes after its output streams drain. Callers that need to guard against overlapping azd
// operations (e.g. a concurrent `azd provision`) should key their guard's
// lifetime off onProcessExit, not off this function's returned promise, since
// that promise resolves as soon as the detached process is merely launched.
export async function deployToAzure(
	dir,
	{
		onStatus,
		onProcessExit,
		onOutput,
		onMilestone,
		env,
		environmentName,
		subscription,
		location,
		noPrompt = false,
		spawnProcess = spawn,
		runCommand = execFileText,
	} = {},
) {
	const azdArgs = ["up"];
	if (environmentName) azdArgs.push("--environment", environmentName);
	if (subscription) azdArgs.push("--subscription", subscription);
	if (location) azdArgs.push("--location", location);
	if (noPrompt) azdArgs.push("--no-prompt");
	const command = `cd ${dir} && azd ${azdArgs.join(" ")}`;
	const tracker = createAzdPhaseTracker();
	let sequence = 0;
	let cancelRequested = false;
	const lineBuffers = { stdout: "", stderr: "" };
	const notify = (patch) => {
		if (typeof onStatus === "function") onStatus(patch);
	};
	const notifyExit = (result) => {
		if (typeof onProcessExit === "function") onProcessExit(result);
	};
	const emitMilestones = (events) => {
		for (const event of events) {
			if (typeof onMilestone === "function") onMilestone(event);
		}
	};

	try {
		await runCommand("azd", ["version"], { cwd: dir });
	} catch {
		const message = `azd not found. Run: ${command}`;
		emitMilestones(tracker.finish({ ok: false, detail: message }));
		notify({
			deployMode: RUNTIME_MODE.CLOUD,
			deployStatus: message,
			deployDir: dir,
			deployCommand: command,
			deployDocsUrl: AZD_DOCS_URL,
		});
		notifyExit({ ok: false, started: false, code: null, signal: null, message });
		return { ok: false, dir, message, command, docsUrl: AZD_DOCS_URL };
	}

	return new Promise((resolve) => {
		// azd handles Azure login, subscription selection, provision, and deploy.
		const child = spawnProcess("azd", azdArgs, {
			cwd: dir,
			stdio: ["ignore", "pipe", "pipe"],
			detached: true,
			env: env ? { ...process.env, ...env } : process.env,
		});
		const emitLine = (stream, line) => {
			const text = redactDeploymentOutput(line);
			if (!text) return;
			const event = { sequence: ++sequence, stream, text, at: Date.now() };
			if (typeof onOutput === "function") onOutput(event);
			emitMilestones(tracker.feed(text));
		};
		const consume = (stream, chunk) => {
			const text = lineBuffers[stream] + String(chunk);
			const lines = text.split(/\r?\n/);
			lineBuffers[stream] = lines.pop() || "";
			for (const line of lines) emitLine(stream, line);
			if (lineBuffers[stream].length > 120_000) {
				lineBuffers[stream] = "";
				emitLine(stream, "[output line omitted because it exceeded the safe display limit]");
			}
		};
		child.stdout?.on("data", (chunk) => consume("stdout", chunk));
		child.stderr?.on("data", (chunk) => consume("stderr", chunk));
		child.once("error", (error) => {
			const message = `Unable to launch azd up: ${shortError(error)}`;
			emitMilestones(tracker.finish({ ok: false, detail: message }));
			notify({ deployMode: RUNTIME_MODE.CLOUD, deployStatus: message, deployDir: dir, deployCommand: command });
			notifyExit({ ok: false, started: false, code: null, signal: null, message });
			resolve({ ok: false, dir, message, command });
		});
		child.once("spawn", () => {
			child.unref();
			const message = `azd up launched in ${dir}`;
			notify({
				deployMode: RUNTIME_MODE.CLOUD,
				deployStatus: message,
				deployDir: dir,
				deployCommand: command,
			});
			resolve({
				ok: true,
				dir,
				message,
				command,
				cancel: () => {
					if (child.exitCode != null || child.signalCode != null) return false;
					if (process.platform !== "win32" && Number.isInteger(child.pid)) {
						try {
							process.kill(-child.pid, "SIGTERM");
							cancelRequested = true;
							return true;
						} catch {
							// Fall back to the direct child when no process group exists.
						}
					}
					const signalled = child.kill("SIGTERM");
					if (signalled) cancelRequested = true;
					return signalled;
				},
			});
			// Fires later, asynchronously, once the real azd process closes -
			// unref() only opts this process out of keeping the event loop alive
			// by itself; the close event still delivers normally as long as the
			// long-running canvas server process (which callers run this from)
			// stays alive, which it does for the lifetime of the open canvas.
			child.once("close", (code, signal) => {
				for (const stream of ["stdout", "stderr"]) {
					if (lineBuffers[stream]) emitLine(stream, lineBuffers[stream]);
					lineBuffers[stream] = "";
				}
				const cancelled = cancelRequested || signal === "SIGTERM";
				const ok = code === 0 && !cancelled;
				const message = cancelled
					? "Local azd command stopped; Azure operations already submitted may continue."
					: `azd up exited (code ${code ?? "null"}${signal ? `, signal ${signal}` : ""})`;
				emitMilestones(tracker.finish({ ok, cancelled, detail: message }));
				notifyExit({ ok, cancelled, started: true, code, signal, message });
			});
		});
	});
}

// Route helper: handles POST /open-vscode, /save-github, /deploy-azure. Returns
// true when it consumed the request. ctx supplies the canvas-specific glue:
//   materialize()        -> Promise<dir> with base project files written
//   materializeAzd()     -> Promise<dir> with base + azd project files written
//   instructionContents()-> Promise<string[]> with loaded session instructions
//   repoName()           -> string repo name for Save to GitHub
//   commitMessage        -> string commit message
//   existingRepoUrl()    -> string | null, short-circuits an already-saved repo
//   onRepoSaved(result)  -> called after a successful Save to GitHub
//   onDeployStatus(patch)-> called with partial deploy state during Deploy
export function handleCommandRoutes(req, res, ctx) {
	if (req.method !== "POST") return false;

	if (req.url === "/open-vscode") {
		(async () => {
			const dir = await ctx.materialize();
			const instructionContents = (await ctx.instructionContents?.()) || [];
			return openVsCode(dir, { instructionContents });
		})()
			.then((result) => responseJson(res, result))
			.catch((error) => responseJson(res, { ok: false, message: shortError(error) }));
		return true;
	}

	if (req.url === "/save-github") {
		(async () => {
			const existing = ctx.existingRepoUrl?.();
			if (existing) return { ok: true, url: existing, created: false };
			const dir = await ctx.materialize();
			const result = await saveToGitHub(dir, { repoName: ctx.repoName(), commitMessage: ctx.commitMessage });
			if (result.ok && typeof ctx.onRepoSaved === "function") ctx.onRepoSaved(result);
			return result;
		})()
			.then((result) => responseJson(res, result))
			.catch((error) => responseJson(res, { ok: false, message: shortError(error) }));
		return true;
	}

	if (req.url === "/deploy-azure") {
		ctx
			.materializeAzd()
			.then((dir) => deployToAzure(dir, { onStatus: ctx.onDeployStatus }))
			.then((result) => responseJson(res, result))
			.catch((error) => responseJson(res, { ok: false, message: shortError(error) }));
		return true;
	}

	return false;
}
