// intelligent-function-app-studio
//
// Functions Hosted Skills Studio for Intelligent Functions Apps. The canvas
// initializes from the daily-digest template repo
// (paulyuk/serverless-repo-digest-agent), lets you run it locally with
// `func start` or point at an existing Azure Function App, and manually invokes
// Timer, HTTP, Queue, or Microsoft 365 Inbox triggers against the supported
// target. Existing apps use documented discovery and invocation contracts;
// unsupported trigger types remain explicit rather than guessed.
//
// Grounded in:
// https://learn.microsoft.com/en-us/azure/azure-functions/functions-serverless-agents-runtime
// https://learn.microsoft.com/en-us/azure/azure-functions/functions-serverless-agents-runtime-reference

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { chmod, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, joinSession } from "@github/copilot-sdk/extension";
import {
	ICONS,
	COMMAND_CSS,
	commandClientScript,
	responseJson,
	shortError,
	safeSegment,
	commandInvocation,
	execFileText,
	exists,
	openVsCode,
	readGlobalAppInstructionContents,
	redactDeploymentOutput,
	resolveStudioBuildInfo,
	deployToAzure,
	prepareDeploymentProjectCopy,
	AZD_DOCS_URL,
	azureCliChildEnv,
	createAzureCliSession,
	runAzureCliJson,
	uvIndexEnv,
} from "./studio-commands.mjs";
import {
	applyAgentResponseTelemetry,
	hasPendingAgentResponse,
	installAgentResponseLogging,
	isAwaitingAgentResponse,
	normalizeAgentOutput,
	parseAgentResponseLog,
} from "./agent-output.mjs";
import {
	classifyGatewayArmError,
	configuredModelBindingIsUsable,
	discoverModelCapabilities,
	gatewayRuntimeUrls,
	requireGatewayCapability,
} from "./model-capabilities.mjs";
import { createArmClient } from "./arm-rest.mjs";
import {
	AI_GATEWAY_WORKSPACE,
	getGateway,
	listGateways,
	listModels,
	listRuntimeKeys,
	retrieveRuntimeKey,
} from "./ai-gateway-arm.mjs";
import {
	DEFAULT_CURRENT_SUBDIR,
	assertCurrentWorkspaceDestinationSafe,
	createOwnershipManifest,
	deleteOwnershipManifest,
	moveWorkspaceDirectory,
	readOwnershipManifest,
	removeOwnedWorkspace,
	resolveCurrentWorkspaceDestination,
	sourceManifestPath,
	writeOwnershipManifest,
} from "./source-workspace.mjs";
import {
	describeTimerSchedule,
	normalizeTimerSchedule,
	replaceTimerScheduleExpression,
	timerExpressionFromSchedule,
	timerScheduleFromExpression,
} from "./timer-schedule.mjs";
import {
	appendBoundedDeploymentOutput,
	createLocalPortReservationPool,
} from "./deployment-ui-state.mjs";
import { enforceIdentityOnlyDeploymentTemplate } from "./deployment-template-policy.mjs";
import {
	APP_SERVICE_API_VERSION,
	invokeFunction,
	listFunctionAppFunctions,
	listFunctionApps,
	readFunctionKey,
} from "./function-app-runtime.mjs";
import {
	DEFAULT_QUEUE_MESSAGE,
	DEFAULT_QUEUE_NAME,
	assertLocalQueueConnection,
	enqueueLocalQueueMessage,
	queueAgentContent,
	queueNameForWorkspace,
} from "./queue-trigger.mjs";
import {
	M365_INBOX_CONNECTOR,
	m365InboxAgentContent,
	m365InboxDryRunPromptFromJson,
	withoutConnectorExtensionBundle,
	withConnectorExtensionBundle,
	withM365InboxMcpServer,
} from "./connector-trigger.mjs";

const { version: STUDIO_VERSION, revision: STUDIO_REVISION } = resolveStudioBuildInfo(import.meta.url);
const AZD_DEPLOYMENT_ENVIRONMENT = "deployment";
const AZD_DEPLOYMENT_LOCATION = "eastus2";

const DOC_URL =
	"https://learn.microsoft.com/en-us/azure/azure-functions/functions-serverless-agents-runtime";
const CORE_TOOLS_DOCS_URL = "https://learn.microsoft.com/azure/azure-functions/functions-run-local";
const AIGW_WORKSPACE = AI_GATEWAY_WORKSPACE;
const GITHUB_MCP_URL = "https://api.githubcopilot.com/mcp/";
const GITHUB_MCP_TOOLS = ["list_pull_requests", "list_issues", "actions_list"];

// The serverless agents runtime's `azurefunctions-agents-runtime` package on
// PyPI declares `requires-python = ">=3.13"` (verified against its published
// metadata). Older guidance in this canvas said "3.10+" and would silently
// hand pip whatever `python3` resolved to - on a stock macOS box that is the
// system Python (3.9), which produces a confusing "no matching distribution"
// pip error instead of an honest "wrong Python version" message. Every
// version check and every piece of user-facing copy must agree on 3.13.
const MIN_PYTHON = [3, 13];
const MIN_PYTHON_LABEL = "3.13";
// Keep managed working copies on the last verified runtime while it remains
// in beta. Transitive serving dependencies stay within the runtime's supported
// ranges; the worker-recycle regression was caused by watched source writes,
// not a Uvicorn release.
const RUNTIME_VERSION = "0.1.0b11";
const UV_DOCS_URL = "https://docs.astral.sh/uv/getting-started/installation/";
const PYTHON_DOCS_URL = "https://www.python.org/downloads/";
// Env var an advanced user can set to point at their own verified >=3.13
// interpreter (a pyenv shim, a custom build, etc). Checked before any PATH
// guessing so an explicit user choice always wins over auto-detection, and
// uv is never forced on someone who already has a valid interpreter set up.
const PYTHON_OVERRIDE_ENV = "INTELLIGENT_FUNCTION_APP_STUDIO_PYTHON";
// PATH fallbacks tried only when uv is unavailable and no override is set.
// `python3.13` is tried first because on macOS `python3` commonly resolves to
// the (older) system interpreter even when a real 3.13 is also installed.
const PYTHON_PATH_CANDIDATES = ["python3.13", "python3", "python"];

function parsePythonVersion(text) {
	const match = /Python\s+(\d+)\.(\d+)(?:\.(\d+))?/i.exec(text || "");
	if (!match) return null;
	return [Number(match[1]), Number(match[2]), Number(match[3] || 0)];
}

function meetsMinPython(version) {
	if (!version) return false;
	const [major, minor] = version;
	return major > MIN_PYTHON[0] || (major === MIN_PYTHON[0] && minor >= MIN_PYTHON[1]);
}

// Try one interpreter path/name: run `--version`, parse it, and report
// whether it clears the 3.13 floor. Never throws - a missing/broken
// candidate is just reported as such so callers can move on to the next one.
async function probePythonBin(bin) {
	try {
		const { stdout, stderr } = await execFileText(bin, ["--version"]);
		const text = (stdout || stderr).trim();
		const version = parsePythonVersion(text);
		return { bin, text, version, ok: meetsMinPython(version) };
	} catch (error) {
		return { bin, text: "", version: null, ok: false, notFound: true, error: shortError(error) };
	}
}

// Find a verified >=3.13 interpreter without uv: an explicit user override
// first (so a user-supplied distribution is always honored), then common
// PATH names. Returns null - never a version below 3.13 - so a stale system
// `python3` can never be silently handed to pip.
async function resolveSystemPython() {
	const override = process.env[PYTHON_OVERRIDE_ENV];
	if (override) {
		const probe = await probePythonBin(override);
		if (probe.ok) return { ...probe, source: `${PYTHON_OVERRIDE_ENV}` };
		throw new Error(
			probe.notFound
				? `${PYTHON_OVERRIDE_ENV}=${override} does not point at a runnable Python interpreter (${probe.error}).`
				: `${PYTHON_OVERRIDE_ENV}=${override} resolved to ${probe.text || "an unknown version"}, but the serverless agents runtime requires Python ${MIN_PYTHON_LABEL}+.`,
		);
	}
	for (const bin of PYTHON_PATH_CANDIDATES) {
		const probe = await probePythonBin(bin);
		if (probe.ok) return { ...probe, source: "PATH" };
	}
	return null;
}

// Trigger types the canvas can talk about. Timer is the default (matches the
// template); HTTP, Queue, and Microsoft 365 Inbox have real local test paths.
// Unsupported runtime surfaces stay visible and disabled rather than implying
// broader Connector support.
const TRIGGER_TYPES = [
	{ id: "timer", label: "Timer", nyi: false },
	{ id: "http", label: "HTTP", nyi: false },
	{ id: "queue", label: "Queue", nyi: false },
	{ id: "blob", label: "Blob", nyi: true },
	{ id: "connector", label: "Connector", nyi: false },
	{ id: "cosmos", label: "Cosmos DB", nyi: true },
];

// The daily-digest template repo. This is the one real, deployable, source of
// truth the canvas initializes from automatically (no "load template"
// button - it IS the starting point). It is a one-time port of the Foundry
// Hosted Agent AI Gateway sample to the Azure Functions serverless agents
// runtime, keeping the exact agent instructions and the read-only GitHub MCP
// tools that route through Azure AI Gateway.
const HERO_TEMPLATE = {
	repo: "paulyuk/serverless-repo-digest-agent",
	repoUrl: "https://github.com/paulyuk/serverless-repo-digest-agent",
	cloneUrl: "https://github.com/paulyuk/serverless-repo-digest-agent.git",
	sourceUrl: "https://github.com/Azure-Samples/simple-foundry-hosted-agent-python-aigateway",
	// The upstream repo only defines a Timer agent. The canvas generates a local
	// HTTP twin (same instructions body, http_trigger front matter) so HTTP has
	// a real direct-invoke endpoint too. Generated locally only - never pushed
	// upstream; only written into the working copy this canvas manages.
	timerAgentRelPath: "src/daily-repo-digest.agent.md",
	httpAgentRelPath: "src/daily-repo-digest-http.agent.md",
	queueAgentRelPath: "src/daily-repo-digest-queue.agent.md",
	connectorAgentRelPath: "src/daily-repo-digest-m365-inbox.agent.md",
};

// The Copilot extension host can inject environment variables that make the
// bundled `az` MSAL flow attempt a broker handshake it cannot complete
// headlessly (AADSTS901001). Run az with a curated, minimal environment so it
// uses the on-disk token cache and a plain refresh-token flow, exactly like a
// normal shell would. Only auth-neutral vars are passed through.
async function runAz(args, subscription) {
	return runAzureCliJson(args, subscription, {
		maxBuffer: 8 * 1024 * 1024,
		timeout: 45000,
	});
}

let cachedGithubAuthHeader = "";

async function githubAuthHeader() {
	if (cachedGithubAuthHeader) return cachedGithubAuthHeader;
	const { stdout } = await execFileText("gh", ["auth", "token", "--hostname", "github.com"], {
		timeout: 30000,
		maxBuffer: 1024 * 1024,
	});
	const token = stdout.trim();
	if (!token) throw new Error("GitHub CLI returned an empty token. Run `gh auth login`, then retry.");
	cachedGithubAuthHeader = `Bearer ${token}`;
	return cachedGithubAuthHeader;
}

const azureCliSession = createAzureCliSession(runAz);
const armClient = createArmClient({ session: azureCliSession });

// Cheap, read-only check of whether the CLI already has a signed-in account -
// `az account show` reads the on-disk token cache and does not itself require
// a network round trip to enumerate subscriptions. Used both by the doctor
// readiness check and to give `az account list` failures an accurate,
// actionable reason (not signed in vs. some other CLI/network error), which
// is what lets a login done in the user's own terminal be recognized on the
// next check instead of repeating a stale "please sign in" message forever.
async function checkAzureLogin(force = false) {
	try {
		const account = await azureCliSession.account(force);
		return { loggedIn: true, account: account?.name || account?.id || "", user: account?.user?.name || "" };
	} catch (error) {
		return { loggedIn: false, error: shortError(error) };
	}
}

function accountNameFromProject(project) {
	const parts = String(project.id || "").split("/");
	const accountIndex = parts.findIndex((part) => part.toLowerCase() === "accounts");
	return accountIndex >= 0 ? parts[accountIndex + 1] || "" : String(project.name || "").split("/")[0];
}

function projectNameFromProject(project) {
	const parts = String(project.id || "").split("/");
	const projectIndex = parts.findIndex((part) => part.toLowerCase() === "projects");
	return projectIndex >= 0 ? parts[projectIndex + 1] || "" : String(project.name || "").split("/").at(-1);
}

async function waitForFoundryProjectReady(endpoint, subscription, timeoutMs = 120000) {
	const deadline = Date.now() + timeoutMs;
	let lastFailure = "The project data plane is not ready yet.";
	let forceTokenRefresh = false;
	while (Date.now() < deadline) {
		let response;
		try {
			const token = await azureCliSession.accessToken(subscription, "https://ai.azure.com", forceTokenRefresh);
			forceTokenRefresh = false;
			response = await fetch(`${String(endpoint).replace(/\/+$/, "")}/connections?api-version=v1`, {
				headers: { Authorization: `Bearer ${token.accessToken}` },
				signal: AbortSignal.timeout(15000),
			});
		} catch (error) {
			lastFailure = shortError(error);
		}
		if (response?.ok) return;
		if (response) {
			lastFailure = `Foundry returned HTTP ${response.status}.`;
			if (![401, 403, 404, 408, 429, 500, 502, 503, 504].includes(response.status)) {
				throw new Error(lastFailure);
			}
			if (response.status === 401) forceTokenRefresh = true;
		}
		await new Promise((resolve) => setTimeout(resolve, 3000));
	}
	throw new Error(`Foundry project did not become callable within ${Math.round(timeoutMs / 1000)} seconds. ${lastFailure}`);
}

async function discoverFoundryBindings(subscription) {
	const projects = await runAz(
		["resource", "list", "--resource-type", "Microsoft.CognitiveServices/accounts/projects", "-o", "json"],
		subscription,
	);
	const accountKeys = [
		...new Map(
			projects.map((project) => {
				const accountName = accountNameFromProject(project);
				const resourceGroup = project.resourceGroup || String(project.id || "").split("/")[4] || "";
				return [`${resourceGroup}/${accountName}`, { accountName, resourceGroup }];
			}),
		).values(),
	];
	const accountDetails = await Promise.all(
		accountKeys.map(async ({ accountName, resourceGroup }) => {
			const [account, deployments] = await Promise.all([
				runAz(["cognitiveservices", "account", "show", "-g", resourceGroup, "-n", accountName, "-o", "json"], subscription),
				runAz(
					["cognitiveservices", "account", "deployment", "list", "-g", resourceGroup, "-n", accountName, "-o", "json"],
					subscription,
				).catch(() => []),
			]);
			return {
				accountName,
				resourceGroup,
				baseEndpoint: account.properties?.endpoints?.["AI Foundry API"] || "",
				models: deployments
					.filter((deployment) => deployment.properties?.provisioningState === "Succeeded")
					.map((deployment) => ({
						id: deployment.name,
						label: deployment.properties?.model?.name || deployment.name,
						version: deployment.properties?.model?.version || "",
					})),
			};
		}),
	);
	const detailByAccount = new Map(accountDetails.map((detail) => [`${detail.resourceGroup}/${detail.accountName}`, detail]));
	return projects
		.map((project) => {
			const accountName = accountNameFromProject(project);
			const projectName = projectNameFromProject(project);
			const resourceGroup = project.resourceGroup || String(project.id || "").split("/")[4] || "";
			const detail = detailByAccount.get(`${resourceGroup}/${accountName}`);
			const baseEndpoint = String(detail?.baseEndpoint || "").replace(/\/+$/, "");
			return {
				id: project.id,
				name: projectName,
				label: `${projectName} (${resourceGroup})`,
				resourceGroup,
				accountName,
				location: project.location || "",
				endpoint: baseEndpoint ? `${baseEndpoint}/api/projects/${encodeURIComponent(projectName)}` : "",
				models: detail?.models || [],
			};
		});
	// Unfiltered: callers need the raw project/account count (not just the
	// subset with a usable model deployment) to tell "no Foundry project or
	// account exists yet" apart from "a project/account exists but has no
	// supported model deployment."
}

async function discoverGatewayBindings(subscription) {
	const gateways = await listGateways(armClient, subscription);
	return Promise.all(
		gateways.map(async (gateway) => {
			const [details, models] = await Promise.all([
				getGateway(armClient, subscription, gateway.id),
				listModels(armClient, subscription, gateway.id),
			]);
			return {
				id: gateway.id,
				name: gateway.name,
				label: `${gateway.name} (${gateway.resourceGroup})`,
				resourceGroup: gateway.resourceGroup,
				location: gateway.location || "",
				endpoint: details.gateway.endpoint,
				models: models.map((model) => ({
					id: model.name,
					label: model.properties?.displayName || model.name,
					provider: model.properties?.providerKind || "",
				})),
			};
		}),
	);
}

async function fetchGatewayKey(entry, gateway) {
	const subscription = entry.modelBinding.subscription;
	const identity = `${subscription}:${gateway.id}`;
	const keys = await listRuntimeKeys(armClient, subscription, gateway.id);
	const names = ["default", "master", ...keys.map((item) => String(item?.name || "")).filter(Boolean)]
		.filter((name, index, all) => all.indexOf(name) === index);
	if (!names.length) throw new Error(`AI Gateway ${gateway.name} has no runtime access keys.`);
	let lastMissing = null;
	for (const keyName of names) {
		try {
			const key = await retrieveRuntimeKey(armClient, subscription, gateway.id, keyName);
			const current = modelResources(entry, "gateway").find(
				(item) => item.id === entry.modelBinding.resourceId,
			);
			if (`${entry.modelBinding.subscription}:${current?.id || ""}` !== identity) {
				throw new Error("The selected gateway changed while its runtime key was being retrieved. Retry the binding.");
			}
			return key;
		} catch (error) {
			if (error?.status !== 404) throw error;
			lastMissing = error;
		}
	}
	throw lastMissing || new Error(`Could not retrieve an API key for ${gateway.name}.`);
}

function portListening(port) {
	return new Promise((resolve) => {
		const socket = net.createConnection({ port, host: "127.0.0.1" });
		const done = (value) => {
			socket.removeAllListeners();
			socket.destroy();
			resolve(value);
		};
		socket.once("connect", () => done(true));
		socket.once("error", () => done(false));
		socket.setTimeout(400, () => done(false));
	});
}

const localPortReservations = createLocalPortReservationPool({ isListening: portListening });

// File stem -> the runtime's registered function name (hyphens become
// underscores). Verified against a real `func start` run of the template.
function agentFunctionName(relPath) {
	return path.basename(relPath, ".agent.md").replace(/-/g, "_");
}

function stripFrontmatter(text) {
	const match = /^\s*---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text);
	return (match ? text.slice(match[0].length) : text).trim();
}

function frontmatterOf(text) {
	const match = /^\s*(---\r?\n[\s\S]*?\r?\n---\r?\n?)/.exec(text);
	return match ? match[1] : "---\nname: Agent\ndescription: Agent\n---\n";
}

function skillNameOf(text) {
	const frontmatter = frontmatterOf(text);
	const raw = frontmatter.match(/^\s*name:\s*(.*?)\s*$/m)?.[1]?.trim() || "";
	const unquoted = raw.match(/^(["'])(.*)\1$/)?.[2] || raw;
	return unquoted || "Untitled skill";
}

async function listTemplateFiles(dir) {
	try {
		const entries = await readdir(dir, { recursive: true, withFileTypes: true });
		return entries
			.filter((e) => e.isFile())
			.map((e) => path.relative(dir, path.join(e.parentPath ?? e.path ?? dir, e.name)))
			.filter((rel) => rel && !rel.startsWith(".git" + path.sep) && !rel.startsWith(".venv" + path.sep))
			.sort()
			.slice(0, 60);
	} catch {
		return [];
	}
}

const instances = new Map();
let session;

async function loadedInstructionContents() {
	const result = session?.instructions?.getSources
		? await session.instructions.getSources()
		: { sources: [] };
	return [
		...(result.sources || []).map((source) => source.content).filter(Boolean),
		...(await readGlobalAppInstructionContents()),
	];
}

function terminateChild(child, signal = "SIGTERM") {
	if (!child || child.exitCode !== null) return;
	if (process.platform !== "win32" && child.pid) {
		try {
			process.kill(-child.pid, signal);
			return;
		} catch {
			/* Fall back when the child predates process-group management. */
		}
	}
	try {
		child.kill(signal);
	} catch {
		/* already gone */
	}
}

function stopExtensionChildren() {
	for (const entry of instances.values()) {
		entry.deployment?.cancel?.();
		for (const child of [entry.local?.funcProc, entry.local?.azuriteProc, entry.loadTest?.proc]) {
			terminateChild(child, "SIGKILL");
		}
	}
}

process.once("SIGTERM", () => {
	stopExtensionChildren();
	process.exit(0);
});
process.once("SIGINT", () => {
	stopExtensionChildren();
	process.exit(0);
});

function broadcast(entry, event, data) {
	const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
	for (const res of entry.clients) res.write(payload);
}

// --- Command feed: every real az/func/git/gh/REST/oha call the canvas runs,
// VS Code "output"-style, so engineers can see, trust, and learn exactly what
// happened. Records are redacted before they are ever stored (no bearer
// tokens, no function/master keys, no MCP/API secrets). start() logs a
// "running" line; end() updates it in place with the outcome.
let cmdSeq = 0;
function cmdStart(entry, rec) {
	if (!entry.commands) entry.commands = [];
	const item = { id: ++cmdSeq, ts: Date.now(), status: "run", ms: null, note: "", ...rec };
	entry.commands.unshift(item);
	if (entry.commands.length > 60) entry.commands.length = 60;
	broadcast(entry, "state", snapshot(entry));
	return item;
}
function cmdEnd(entry, item, patch) {
	if (!item) return;
	const ms = item.ts ? Date.now() - item.ts : null;
	Object.assign(item, { ms, status: "ok" }, patch || {});
	if (patch && patch.ok === false) item.status = "err";
	broadcast(entry, "state", snapshot(entry));
}

function deploymentWorkspaceDir(entry) {
	return path.join(homedir(), ".intelligent-function-app-studio", safeSegment(entry.instanceId), "deployment");
}

function deploymentSummary(deployment) {
	if (!deployment || deployment.status === "idle") return "";
	const elapsed =
		deployment.startedAt && deployment.endedAt
			? ` in ${((deployment.endedAt - deployment.startedAt) / 1000).toFixed(1)}s`
			: "";
	if (deployment.status === "preparing") return "Preparing an isolated deployment workspace...";
	if (deployment.status === "succeeded") return `Deployment completed${elapsed}.`;
	if (deployment.status === "failed") return `Deployment failed${elapsed}: ${deployment.message || "azd up failed."}`;
	if (deployment.status === "cancelled") {
		return `Local azd command stopped${elapsed}; Azure operations already submitted may continue.`;
	}
	if (deployment.cancelRequested) return "Stopping local azd command...";
	const active = ["provision", "package", "deploy"].find(
		(name) => deployment.phases?.[name]?.state === "started",
	);
	return active ? `${active[0].toUpperCase()}${active.slice(1)} in progress...` : "azd up is running...";
}

function scheduleDeploymentBroadcast(entry) {
	if (entry.deploymentBroadcastTimer) return;
	entry.deploymentBroadcastTimer = setTimeout(() => {
		entry.deploymentBroadcastTimer = null;
		entry.deployStatus = deploymentSummary(entry.deployment);
		broadcast(entry, "state", snapshot(entry));
	}, 60);
	entry.deploymentBroadcastTimer.unref?.();
}

function appendDeploymentOutput(entry, event) {
	appendBoundedDeploymentOutput(entry.deployment, event);
	scheduleDeploymentBroadcast(entry);
}

function updateDeploymentMilestone(entry, milestone) {
	entry.deployment.phases[milestone.name] = milestone;
	let command = entry.deploymentPhaseCommands[milestone.name];
	if (!command) {
		command = cmdStart(entry, {
			kind: "shell",
			title: `azd ${milestone.name}`,
			cmd: `azd up · ${milestone.name}`,
			purpose: `${milestone.name[0].toUpperCase()}${milestone.name.slice(1)} the Azure Functions application`,
		});
		entry.deploymentPhaseCommands[milestone.name] = command;
	}
	if (milestone.state !== "started") {
		cmdEnd(entry, command, {
			ok: milestone.state === "completed",
			note: milestone.detail || milestone.state,
		});
	}
	entry.deployStatus = deploymentSummary(entry.deployment);
	broadcast(entry, "state", snapshot(entry));
}

function recordInvocation(entry, rec) {
	const event = {
		id: ++entry.invocationSequence,
		time: new Date().toLocaleTimeString(),
		phase: rec.ok === null ? "running" : rec.ok === false ? "failed" : "completed",
		...rec,
	};
	entry.invocations.unshift(event);
	if (entry.invocations.length > 40) entry.invocations.length = 40;
	scheduleInvocationHistoryWrite(entry);
	broadcast(entry, "state", snapshot(entry));
	return event;
}

function clearSettledInvocations(entry) {
	entry.invocations = entry.invocations.filter((event) => isAwaitingAgentResponse(event));
	scheduleInvocationHistoryWrite(entry);
	broadcast(entry, "state", snapshot(entry));
	return entry.invocations.length;
}

function invocationHistoryPath(entry) {
	return path.join(homedir(), ".intelligent-function-app-studio", safeSegment(entry.instanceId), "invocations.json");
}

function scheduleInvocationHistoryWrite(entry) {
	if (entry.invocationWriteTimer) clearTimeout(entry.invocationWriteTimer);
	entry.invocationWriteTimer = setTimeout(async () => {
		entry.invocationWriteTimer = null;
		const file = invocationHistoryPath(entry);
		try {
			await mkdir(path.dirname(file), { recursive: true });
			await writeFile(file, `${JSON.stringify(entry.invocations, null, 2)}\n`, { mode: 0o600 });
			await chmod(file, 0o600);
		} catch {
			/* The in-memory activity feed remains available if persistence fails. */
		}
	}, 100);
	entry.invocationWriteTimer.unref();
}

async function loadInvocationHistory(entry) {
	if (entry.invocationHistoryLoaded) return;
	entry.invocationHistoryLoaded = true;
	try {
		const parsed = JSON.parse(await readFile(invocationHistoryPath(entry), "utf8"));
		if (!Array.isArray(parsed)) return;
		entry.invocations = parsed
			.filter(
				(event) =>
					!(
						!event?.executionId &&
						String(event?.note || "").startsWith("Accepted; completion is still running.")
					),
			)
			.slice(0, 40)
			.map((event) =>
				event?.phase === "running"
					? { ...event, phase: "failed", ok: false, note: "Canvas restarted before this execution completed." }
					: event,
			);
		entry.invocationSequence = entry.invocations.reduce((highest, event) => Math.max(highest, Number(event?.id) || 0), 0);
		scheduleInvocationHistoryWrite(entry);
	} catch {
		/* First open has no activity history yet. */
	}
}

function activeLocalInvocation(entry) {
	const running = [...entry.local.executions.values()].filter((event) => event.phase === "running");
	return running.length === 1 ? running[0] : null;
}

function finalizeRunningInvocations(entry, note) {
	let changed = false;
	for (const event of entry.invocations) {
		if (event.target !== "local") continue;
		if (event.phase !== "running") continue;
		event.phase = "failed";
		event.ok = false;
		event.note = note;
		changed = true;
	}
	entry.local.executions.clear();
	if (changed) scheduleInvocationHistoryWrite(entry);
}

function sourceMcpToolName(name) {
	return String(name || "").split("___").at(-1);
}

function invocationTrigger(entry, functionName) {
	return (
		entry.local.functions.find((fn) => fn.name === functionName)?.kind ||
		(functionName.endsWith("_http")
			? "http"
			: functionName.endsWith("_queue")
				? "queue"
				: functionName.endsWith("_m365_inbox")
					? "connector"
					: "timer")
	);
}

function refreshInvocationNote(event) {
	const toolNote = event.tools?.length
		? `${event.tools.filter((tool) => tool.ok).length}/${event.tools.length} MCP calls completed.`
		: "";
	const inputBytes = event.payloads?.reduce((total, payload) => total + payload.inputBytes, 0) || 0;
	const outputBytes = event.payloads?.reduce((total, payload) => total + payload.outputBytes, 0) || 0;
	const payloadNote = event.payloads?.length
		? `MCP results: ${inputBytes.toLocaleString()} -> ${outputBytes.toLocaleString()} bytes across ${event.payloads.length} calls.`
		: "";
	const activity = [toolNote, payloadNote].filter(Boolean).join(" ");
	if (event.phase === "running") {
		event.note = activity || `${event.origin === "scheduled" ? "Scheduled" : "Manual"} ${event.trigger} is running.`;
	} else if (event.ok) {
		event.note = `${event.origin === "scheduled" ? "Scheduled" : "Manual"} ${event.trigger} completed.${activity ? ` ${activity}` : ""}`;
	}
}

function processLocalInvocationLog(entry, line, sequence) {
	const started = line.match(/Executing 'Functions\.([^']+)' \(Reason='([^']*)', Id=([^)]+)\)/);
	if (started) {
		const [, functionName, reason, executionId] = started;
		if (!entry.local.executions.has(executionId)) {
			const pending = entry.invocations.find(
				(item) => item.phase === "running" && !item.executionId && item.functionName === functionName,
			);
			const origin = pending?.origin || (/programmatically called|host APIs/i.test(reason) ? "manual" : "scheduled");
			const event =
				pending ||
				recordInvocation(entry, {
					target: "local",
					trigger: invocationTrigger(entry, functionName),
					origin,
					ok: null,
					status: 0,
					ms: null,
					tools: [],
					payloads: [],
				});
			Object.assign(event, {
				executionId,
				functionName,
				logSequence: sequence,
				origin,
				note: `${origin === "scheduled" ? "Scheduled" : "Manual"} trigger started.`,
			});
			entry.local.executions.set(executionId, event);
			scheduleInvocationHistoryWrite(entry);
		}
		return;
	}

	const globalRetry = Number(
		line.match(/try again in (\d+) seconds/i)?.[1] ||
			line.match(/Retrying request to \/responses in ([\d.]+) seconds/i)?.[1] ||
			0,
	);
	if (globalRetry && (/rate limit|token limit/i.test(line) || /Retrying request to \/responses/i.test(line))) {
		entry.modelBinding.nextInvokeAt = Math.max(entry.modelBinding.nextInvokeAt, Date.now() + globalRetry * 1000);
	}

	const event = activeLocalInvocation(entry);
	if (event) {
		const agentOutput = parseAgentResponseLog(line);
		if (agentOutput) {
			event.response = agentOutput.response;
			event.sessionId = agentOutput.sessionId;
		}
		const toolStarted = sourceMcpToolName(line.match(/Function name: ([^\s]+)/)?.[1]);
		if (toolStarted.startsWith("github_") && !event.tools.some((tool) => tool.name === toolStarted)) {
			event.tools.push({ name: toolStarted, ok: false });
			refreshInvocationNote(event);
		}
		const toolCompleted = sourceMcpToolName(line.match(/Function ([^\s]+) succeeded\./)?.[1]);
		if (toolCompleted.startsWith("github_")) {
			const tool = event.tools.find((item) => item.name === toolCompleted);
			if (tool) tool.ok = true;
			refreshInvocationNote(event);
		}
		const compacted = line.match(/Compacted GitHub MCP result for ([^:]+): (\d+) to (\d+) bytes\./);
		if (compacted) {
			event.payloads.push({
				tool: compacted[1],
				inputBytes: Number(compacted[2]),
				outputBytes: Number(compacted[3]),
			});
			refreshInvocationNote(event);
		}
		if (globalRetry) {
			event.retryAfterSeconds = globalRetry;
			event.note = `The gateway is retrying after ${globalRetry} seconds.`;
		}
		scheduleInvocationHistoryWrite(entry);
	}

	const completed = line.match(/Executed 'Functions\.([^']+)' \((Succeeded|Failed), Id=([^,]+), Duration=(\d+)ms\)/);
	if (!completed) return;
	const [, functionName, outcome, executionId, duration] = completed;
	const completedEvent =
		entry.local.executions.get(executionId) ||
		entry.invocations.find((item) => item.executionId === executionId) ||
		recordInvocation(entry, {
			executionId,
			functionName,
			logSequence: sequence,
			target: "local",
			trigger: invocationTrigger(entry, functionName),
			origin: "runtime",
			ok: null,
			status: 0,
			tools: [],
			payloads: [],
		});
	completedEvent.ok = outcome === "Succeeded";
	completedEvent.phase = completedEvent.ok ? "completed" : "failed";
	completedEvent.ms = Number(duration);
	if (completedEvent.ok) {
		refreshInvocationNote(completedEvent);
	} else {
		const events = entry.local.logEvents.filter((item) => item.sequence >= completedEvent.logSequence);
		const diagnosticsAreUnambiguous = entry.local.executions.size === 1;
		const rate = diagnosticsAreUnambiguous
			? [...events].reverse().find((item) => /rate limit exceeded|rate_limit_exceeded|token limit is exceeded/i.test(item.line))
			: null;
		const safety = diagnosticsAreUnambiguous
			? [...events].reverse().find((item) => /content safety check/i.test(item.line))
			: null;
		const retry = Number(rate?.line.match(/try again in (\d+) seconds/i)?.[1] || 0);
		completedEvent.retryAfterSeconds = retry;
		completedEvent.note = safety
			? "AI Gateway content safety blocked this run."
			: retry
				? `The selected model token limit was exceeded. Try again in ${retry} seconds.`
				: "Function execution failed. Check the local host log.";
	}

	entry.local.executions.delete(executionId);
	scheduleInvocationHistoryWrite(entry);
}

async function ensureAgentResponseLogging(entry) {
	const functionAppPath = path.join(requireTemplateDir(entry), "src", "function_app.py");
	const source = await readFile(functionAppPath, "utf8");
	const updated = installAgentResponseLogging(source);
	if (updated !== source) await writeFile(functionAppPath, updated);
}

// Classifies exactly why a model endpoint is/isn't ready, so the UI and
// Invoke's readiness gate can name the real blocker instead of a generic
// "not ready" - the six states below cover the full Azure/Foundry bootstrap
// path from a fresh subscription to a ready, invocable endpoint.
function computeModelReadiness(entry) {
	const mb = entry.modelBinding;
	if (configuredModelBindingIsUsable(mb) && mb.activeSource === "gateway" && !mb.loading) {
		return { state: "ready", message: mb.status || `${mb.activeLabel} is ready` };
	}
	if (entry.azure.subscriptionsError && /not signed in/i.test(entry.azure.subscriptionsError)) {
		return { state: "not-signed-in", message: entry.azure.subscriptionsError };
	}
	if (!entry.azure.subscription) {
		return {
			state: "no-subscription",
			message: entry.azure.subscriptionsError || "No Azure subscription is available for model discovery.",
		};
	}
	if (mb.loading) return { state: "discovering", message: mb.status || "Discovering existing model endpoints..." };
	if (mb.error) return { state: "error", message: mb.error };
	if (configuredModelBindingIsUsable(mb)) {
		if (mb.activeResourceId && (mb.activeSource !== "gateway" || mb.gatewayCapability.status === "available")) {
			const stillPresent = modelResources(entry, mb.activeSource).some(
				(resource) => resource.id === mb.activeResourceId && resource.models.some((model) => model.id === mb.activeModelId),
			);
			if (!stillPresent) {
				return {
					state: "endpoint-invalid",
					message: `The previously bound endpoint (${mb.activeLabel || "model"}) was not found in the latest discovery - it may have been deleted or moved. Refresh, then select or create a model.`,
				};
			}
		}
		return { state: "ready", message: mb.status || `${mb.activeLabel} is ready` };
	}
	const totalAccounts = (mb.foundryAccountCount || 0) + (mb.gatewayAccountCount || 0);
	if (totalAccounts === 0) {
		return {
			state: "no-account",
			message:
				"No Microsoft Foundry project/account or Azure AI Gateway was found in this subscription. Use Create Models to provision one, or pick a different subscription.",
		};
	}
	const usableModels = mb.foundry.length + mb.gateways.length;
	if (usableModels === 0) {
		return {
			state: "no-model",
			message:
				"A Foundry account or AI Gateway exists, but it has no supported model deployment yet. Use Create Models to deploy one, or add a deployment to the existing account.",
		};
	}
	return { state: "select", message: "Usable models were found. Select one below to bind it." };
}

function snapshot(entry) {
	return {
		commands: entry.commands,
		triggerTypes: TRIGGER_TYPES,
		trigger: entry.trigger,
		target: entry.target,
		hero: entry.hero,
		fetchError: entry.fetchError || "",
		prompt: entry.prompt,
		httpPrompt: entry.httpPrompt,
		triggerSupport: {
			queue: {
				queueName: entry.queueName || DEFAULT_QUEUE_NAME,
				message: entry.queueMessage,
				localOnly: true,
			},
			connector: {
				...M365_INBOX_CONNECTOR,
				localDryRun: true,
				otherConnectorsSupported: false,
			},
		},
		doctor: entry.doctor,
		doctorRunning: entry.doctorRunning,
		sourceWorkspace: {
			mode: entry.sourceWorkspace.mode,
			workingDirectory: entry.sourceWorkspace.workingDirectory,
			relativePath: entry.sourceWorkspace.relativePath,
			destination: entry.sourceWorkspace.destination,
			materialized: entry.sourceWorkspace.materialized,
			operation: entry.sourceWorkspace.operation,
			error: entry.sourceWorkspace.error,
			canUseCurrent: Boolean(entry.sourceWorkspace.workingDirectory),
			autoCreate: entry.sourceWorkspace.autoCreate,
		},
		// Non-empty once ensureTemplate() has actually cloned the working
		// copy - the UI must only claim "your code is here" after this is set,
		// never before, so it never implies code exists prematurely.
		templateDir: entry.templateDir || "",
		agentDir: entry.agentDir || "",
		timerSchedule: {
			cadence: entry.timerSchedule.cadence,
			localTime: entry.timerSchedule.localTime,
			weekday: entry.timerSchedule.weekday,
			hourlyMinute: entry.timerSchedule.hourlyMinute,
			expression: entry.timerSchedule.expression,
			status: entry.timerSchedule.status,
			error: entry.timerSchedule.error,
		},
		local: {
			status: entry.local.status,
			port: entry.local.port,
			error: entry.local.error,
			funcVersion: entry.local.funcVersion,
			pythonVersion: entry.local.pythonVersion,
			pythonProvider: entry.local.pythonProvider,
			uvVersion: entry.local.uvVersion,
			azuriteNote: entry.local.azuriteNote,
			functions: entry.local.functions,
			logTail: entry.local.logTail.slice(-50),
		},
		azure: {
			subscriptions: entry.azure.subscriptions,
			subscription: entry.azure.subscription,
			subscriptionsError: entry.azure.subscriptionsError,
			apps: entry.azure.apps,
			appsError: entry.azure.appsError,
			appId: entry.azure.appId,
			app: entry.azure.app,
			functions: entry.azure.functions,
			functionsError: entry.azure.functionsError,
			functionName: entry.azure.functionName,
			appInsights: entry.azure.appInsights,
			appInsightsError: entry.azure.appInsightsError,
			appInsightsUrl: entry.azure.appInsightsUrl || null,
		},
		modelBinding: {
			loading: entry.modelBinding.loading,
			error: entry.modelBinding.error,
			status: entry.modelBinding.status,
			configured: entry.modelBinding.configured,
			source: entry.modelBinding.source,
			subscription: entry.modelBinding.subscription,
			foundry: entry.modelBinding.foundry,
			gateways: entry.modelBinding.gateways,
			foundryAccountCount: entry.modelBinding.foundryAccountCount || 0,
			foundryModelessCount: entry.modelBinding.foundryModelessCount || 0,
			gatewayAccountCount: entry.modelBinding.gatewayAccountCount || 0,
			gatewayModelessCount: entry.modelBinding.gatewayModelessCount || 0,
			gatewayCapability: entry.modelBinding.gatewayCapability,
			gatewayActionError: entry.modelBinding.gatewayActionError,
			resourceId: entry.modelBinding.resourceId,
			modelId: entry.modelBinding.modelId,
			activeLabel: entry.modelBinding.activeLabel,
			activeSource: entry.modelBinding.activeSource,
			activeResourceId: entry.modelBinding.activeResourceId,
			activeModelId: entry.modelBinding.activeModelId,
			nextInvokeAt: entry.modelBinding.nextInvokeAt,
			readiness: computeModelReadiness(entry),
		},
		modelCreate: entry.modelCreate,
		azdOperation: entry.azdOperation,
		invocations: entry.invocations,
		loadTest: {
			running: entry.loadTest.running,
			target: entry.loadTest.target,
			points: entry.loadTest.points,
			error: entry.loadTest.error,
			ohaChecked: entry.loadTest.ohaChecked,
			ohaAvailable: entry.loadTest.ohaAvailable,
			ohaVersion: entry.loadTest.ohaVersion,
			durationSec: entry.loadTest.durationSec,
			concurrency: entry.loadTest.concurrency,
			instanceCount: entry.loadTest.target === "local" ? 1 : entry.loadTest.instanceCount,
			instanceCountNote: entry.loadTest.instanceCountNote,
			maxRps: entry.loadTest.maxRps,
			logTail: entry.loadTest.logTail.slice(-120),
		},
		liveTelemetry: {
			enabled: entry.liveTelemetry.enabled,
			points: entry.liveTelemetry.points,
			traces: entry.liveTelemetry.traces,
			error: entry.liveTelemetry.error,
		},
		appRegistration: entry.appRegistration,
		openStatus: entry.openStatus || "",
		deployStatus: entry.deployStatus || "",
		deployDir: entry.deployDir || "",
		deployCommand: entry.deployCommand || "",
		deployDocsUrl: entry.deployDocsUrl || "",
		deployment: {
			status: entry.deployment.status,
			message: entry.deployment.message,
			startedAt: entry.deployment.startedAt,
			endedAt: entry.deployment.endedAt,
			cancelRequested: entry.deployment.cancelRequested,
			output: entry.deployment.output,
			outputTruncated: entry.deployment.outputTruncated,
			phases: entry.deployment.phases,
		},
	};
}

function ensureEntry(instanceId) {
	let entry = instances.get(instanceId);
	if (entry) return entry;
	entry = {
		instanceId,
		sessionId: "",
		clients: new Set(),
		server: null,
		url: "",
		commands: [],
		templateDir: "",
		agentDir: "",
		hero: null,
		fetchError: "",
		fetchPromise: null,
		prompt: "",
		timerSchedule: {
			cadence: "daily",
			localTime: "09:00",
			weekday: 1,
			hourlyMinute: 0,
			expression: timerExpressionFromSchedule({ cadence: "daily", localTime: "09:00" }),
			status: "",
			error: "",
		},
		httpPrompt: "Give me the daily digest now.",
		queueMessage: DEFAULT_QUEUE_MESSAGE,
		queueName: "",
		trigger: "timer",
		target: "local",
		doctor: null,
		doctorRunning: false,
		sourceWorkspace: {
			mode: "isolated",
			workingDirectory: "",
			relativePath: DEFAULT_CURRENT_SUBDIR,
			destination: "",
			materialized: false,
			operation: "",
			error: "",
			manifestPath: "",
			manifest: null,
			hydrated: false,
			createPromise: null,
			autoCreate: true,
		},
		local: {
			status: "stopped",
			port: null,
			error: "",
			funcVersion: "",
			pythonVersion: "",
			pythonProvider: "",
			pythonBin: "",
			uvVersion: "",
			azuriteNote: "",
			funcProc: null,
			azuriteProc: null,
			startPromise: null,
			startGeneration: 0,
			functions: [],
			logTail: [],
			logSequence: 0,
			logEvents: [],
			executions: new Map(),
		},
		azure: {
			subscriptions: [],
			subscription: "",
			subscriptionsError: "",
			apps: [],
			appsError: "",
			appId: "",
			app: null,
			tenantId: "",
			functions: [],
			functionsError: "",
			functionName: "",
			appInsights: null,
			appInsightsError: "",
			appInsightsUrl: "",
		},
		modelBinding: {
			loading: false,
			error: "",
			status: "",
			configured: false,
			source: "foundry",
			subscription: "",
			foundry: [],
			gateways: [],
			foundryAccountCount: 0,
			foundryModelessCount: 0,
			gatewayAccountCount: 0,
			gatewayModelessCount: 0,
			gatewayCapability: {
				status: "unknown",
				error: "",
				detail: "AI Gateway discovery has not run yet.",
			},
			gatewayActionError: "",
			resourceId: "",
			modelId: "",
			activeLabel: "",
			activeSource: "",
			activeResourceId: "",
			activeModelId: "",
			nextInvokeAt: 0,
			initializePromise: null,
		},
		invocations: [],
		azureInvocationsInFlight: new Set(),
		invocationSequence: 0,
		invocationHistoryLoaded: false,
		invocationWriteTimer: null,
		foundryTokenRefreshTimer: null,
		loadTest: {
			running: false,
			target: "local",
			points: [],
			error: "",
			ohaChecked: false,
			ohaAvailable: false,
			ohaVersion: "",
			durationSec: 60,
			concurrency: 16,
			maxRps: 50,
			instanceCount: 1,
			instanceCountNote: "Local host",
			instanceMetricName: "",
			lastInstancePollAt: 0,
			startedAt: 0,
			proc: null,
			stopRequested: false,
			logTail: [],
		},
		liveTelemetry: { enabled: false, points: [], traces: [], error: "", timer: null },
		appRegistration: { pending: false, ok: null, message: "" },
		appRegistrationCommand: null,
		openStatus: "",
		deployMode: null,
		deployStatus: "",
		deployDir: "",
		deployCommand: "",
		deployDocsUrl: "",
		deployment: {
			status: "idle",
			message: "",
			startedAt: null,
			endedAt: null,
			cancelRequested: false,
			output: [],
			outputChars: 0,
			outputTruncated: false,
			phases: {},
			cancel: null,
		},
		deploymentPhaseCommands: {},
		deploymentBroadcastTimer: null,
		modelCreate: {
			// null = not planned yet; a plan object once the user opens Create
			// Models (never provisions anything by itself); running/ok/message
			// are only set once the user explicitly confirms.
			planned: false,
			running: false,
			ok: null,
			message: "",
			command: "",
			workingDir: "",
			resources: [],
		},
		// Shared mutual-exclusion guard: Create Models and Deploy to Azure can
		// touch overlapping resources, so only one write may run at a time.
		// `active` is held true
		// from the moment the real child process actually spawns until it
		// actually exits - never merely until the launch call resolves - so a
		// detached, unref'd child still keeps the guard until it truly finishes.
		// See beginAzdOperation()/endAzdOperation().
		azdOperation: { active: false, kind: null, label: "", startedAt: 0 },
	};
	instances.set(instanceId, entry);
	return entry;
}

// Human-readable label for an azd-operation kind, used in guard rejection
// messages and UI blocker text.
function azdOperationLabel(kind) {
	if (kind === "deploy") return "Deploy to Azure (azd up)";
	if (kind === "create-models") return "Create Models";
	return kind || "an Azure write operation";
}

// Acquire the shared azd-operation guard for `kind` ("deploy" or
// "create-models"). Throws an actionable Error (never provisions/deploys
// anything itself) if another azd operation is already active for this
// entry, so callers can reject the request instead of spawning a second
// concurrent azd process against the same `.azure` environment. Only call
// this immediately before actually spawning the real child process - not
// earlier - and only release it via endAzdOperation() once that child's
// real 'close' event has fired after output drains.
function beginAzdOperation(entry, kind) {
	if (entry.azdOperation && entry.azdOperation.active) {
		const activeLabel = azdOperationLabel(entry.azdOperation.kind);
		const requestedLabel = azdOperationLabel(kind);
		throw new Error(
			`${activeLabel} is still running for this working copy. Wait for it to finish before starting ${requestedLabel} - running both at once against the same .azure environment risks corrupting it.`,
		);
	}
	entry.azdOperation = { active: true, kind, label: azdOperationLabel(kind), startedAt: Date.now() };
	broadcast(entry, "state", snapshot(entry));
}

function assertWorkspaceMutationAllowed(entry, action) {
	if (!entry.azdOperation?.active) return;
	throw new Error(
		`${action} is unavailable while ${azdOperationLabel(entry.azdOperation.kind)} is running for this working copy.`,
	);
}

// Release the shared azd-operation guard. Only clears it when `kind`
// matches the currently active operation, so a stale/late call for an
// operation that never actually acquired the guard cannot clobber a
// different, genuinely active operation.
function endAzdOperation(entry, kind) {
	if (entry.azdOperation && entry.azdOperation.active && entry.azdOperation.kind === kind) {
		entry.azdOperation = { active: false, kind: null, label: "", startedAt: 0 };
		broadcast(entry, "state", snapshot(entry));
	}
}

// Generate the HTTP twin agent file: same instructions body as the Timer
// agent (copied verbatim, never rewritten by hand), with http_trigger front
// matter so HTTP has a real, direct-invoke endpoint. Written only into the
// working copy this canvas manages - never pushed to the upstream repo.
function httpTwinContent(bodyText, skillName = "Hosted skill") {
	const frontmatter = [
		"---",
		`name: ${JSON.stringify(`${skillName} (HTTP)`)}`,
		"description: On-demand HTTP twin of the Timer-triggered hosted skill.",
		"",
		"trigger:",
		"  type: http_trigger",
		"  args:",
		"    route: digest",
		'    methods: ["POST"]',
		"    auth_level: function",
		"",
		"mcp: true",
		"timeout: 1800",
		"---",
		"",
	].join("\n");
	return frontmatter + "\n" + bodyText.trim() + "\n";
}

async function ensureConnectorHostConfig(sourceDir) {
	const hostPath = path.join(sourceDir, "host.json");
	const current = JSON.parse(await readFile(hostPath, "utf8"));
	const next = withConnectorExtensionBundle(current);
	await writeTextIfChanged(hostPath, `${JSON.stringify(next, null, 2)}\n`);

	const connectorMcpPath = path.join(sourceDir, "m365-inbox.mcp.json");
	await writeTextIfChanged(
		connectorMcpPath,
		`${JSON.stringify(withM365InboxMcpServer({ servers: {} }), null, 2)}\n`,
	);
}

async function removeConnectorDeploymentConfig(sourceDir) {
	const hostPath = path.join(sourceDir, "host.json");
	const current = JSON.parse(await readFile(hostPath, "utf8"));
	const next = withoutConnectorExtensionBundle(current);
	await writeTextIfChanged(hostPath, `${JSON.stringify(next, null, 2)}\n`);
	await rm(path.join(sourceDir, "m365-inbox.mcp.json"), { force: true });
}

async function syncGeneratedTriggerFiles(entry, bodyText = entry.prompt, skillName = entry.hero?.title || "Hosted skill") {
	const sourceDir = entry.agentDir || path.join(requireTemplateDir(entry), "src");
	const queuePath = path.join(requireTemplateDir(entry), HERO_TEMPLATE.queueAgentRelPath);
	const connectorPath = path.join(requireTemplateDir(entry), HERO_TEMPLATE.connectorAgentRelPath);
	const queueExists = await exists(queuePath);
	const connectorExists = await exists(connectorPath);

	if (entry.trigger === "queue" || queueExists) {
		await assertLocalQueueStorageSafe(entry);
		entry.queueName = entry.queueName || queueNameForWorkspace(requireTemplateDir(entry));
		await writeTextIfChanged(queuePath, queueAgentContent(bodyText, skillName, entry.queueName));
	}
	if (entry.trigger === "connector" || connectorExists) {
		await writeTextIfChanged(connectorPath, m365InboxAgentContent(bodyText, skillName));
		await ensureConnectorHostConfig(sourceDir);
	}
}

async function protectLocalSettings(dir) {
	const ignorePath = path.join(dir, ".gitignore");
	const requiredRules = ["src/local.settings.json", "src/.foundry-token.json", ".intelligent-function-app-studio/"];
	const current = (await exists(ignorePath)) ? await readFile(ignorePath, "utf8") : "";
	const rules = current.split(/\r?\n/).map((line) => line.trim());
	const missingRules = requiredRules.filter((rule) => !rules.includes(rule));
	if (missingRules.length) {
		const separator = current && !current.endsWith("\n") ? "\n" : "";
		await writeFile(ignorePath, `${current}${separator}${missingRules.join("\n")}\n`);
	}
	if (await exists(path.join(dir, ".git"))) {
		await execFileText("git", ["rm", "--cached", "--ignore-unmatch", ...requiredRules], { cwd: dir });
	}
}

const LEGACY_GATEWAY_PROVIDER_MARKER = "# Intelligent Function App Studio: AI Gateway provider";
const GATEWAY_PROVIDER_MARKER = "# Intelligent Function App Studio: model provider routing v2";

function gatewayClientManagerSource() {
	return `"""Model providers generated by Functions Hosted Skills Studio."""

import json
import os
import time

from agent_framework import Message
from agent_framework.foundry import FoundryChatClient
from agent_framework.openai import OpenAIChatClient
from azure.core.credentials import AccessToken
from azure.identity.aio import DefaultAzureCredential
from azure_functions_agents import ClientManager
from github_mcp_middleware import compact_github_results


def _normalize_timer_messages(messages):
    normalized = []
    for message in messages:
        is_timer = (
            getattr(message, "role", "") == "user"
            and any(
                str(getattr(content, "text", "")).startswith("Triggered by: timer_trigger")
                for content in getattr(message, "contents", [])
            )
        )
        normalized.append(
            Message(
                "user",
                ["Run the scheduled daily task now. Follow the agent instructions and use available tools."],
            )
            if is_timer
            else message
        )
    return normalized


def _bound_completion(kwargs):
    options = dict(kwargs.get("options") or {})
    options.setdefault("max_tokens", 4096)
    kwargs["options"] = options
    return kwargs


class AIGatewayChatClient(OpenAIChatClient):
    def get_response(self, messages, **kwargs):
        return super().get_response(_normalize_timer_messages(messages), **_bound_completion(kwargs))


class BoundedFoundryChatClient(FoundryChatClient):
    def get_response(self, messages, **kwargs):
        return super().get_response(_normalize_timer_messages(messages), **_bound_completion(kwargs))


class AIGatewayClientManager(ClientManager):
    name = "ai_gateway"

    def resolve_model(self, requested: str | None) -> str:
        return requested or os.environ["AZURE_FUNCTIONS_AGENTS_MODEL"]

    def build_chat_client(self, model: str | None):
        api_key = os.environ["AZURE_AI_GATEWAY_API_KEY"]
        return AIGatewayChatClient(
            model=self.resolve_model(model),
            api_key=api_key,
            base_url=os.environ["AZURE_AI_GATEWAY_OPENAI_BASE_URL"],
            default_headers={"api-key": api_key},
            middleware=[compact_github_results],
        )


class StudioTokenCredential:
    """Read the token refreshed by the Studio's shared Azure CLI session cache."""

    def __init__(self):
        self._token = None

    async def get_token(self, *scopes, **kwargs):
        if self._token and self._token.expires_on > time.time() + 300:
            return self._token
        token_file = os.environ["FOUNDRY_TOKEN_FILE"]
        with open(token_file, encoding="utf-8") as handle:
            payload = json.load(handle)
        self._token = AccessToken(payload["accessToken"], int(payload["expiresOn"]))
        if self._token.expires_on <= time.time() + 60:
            raise RuntimeError("The cached Foundry token expired. Invoke again so the Studio can refresh it.")
        return self._token

    async def close(self):
        return None


class FoundryClientManager(ClientManager):
    name = "foundry"

    def __init__(self):
        if os.environ.get("FOUNDRY_TOKEN_FILE"):
            self._credential = StudioTokenCredential()
        else:
            client_id = os.environ.get("AZURE_CLIENT_ID")
            self._credential = (
                DefaultAzureCredential(managed_identity_client_id=client_id)
                if client_id
                else DefaultAzureCredential()
            )

    def resolve_model(self, requested: str | None) -> str:
        return requested or os.environ["FOUNDRY_MODEL"]

    def build_chat_client(self, model: str | None):
        return BoundedFoundryChatClient(
            project_endpoint=os.environ["FOUNDRY_PROJECT_ENDPOINT"],
            model=self.resolve_model(model),
            credential=self._credential,
            middleware=[compact_github_results],
        )

    async def close(self):
        await self._credential.close()
`;
}

function githubMcpMiddlewareSource() {
	return `"""Bound and compact GitHub MCP results for daily repository digests."""

import json
import logging
from collections.abc import Mapping
from datetime import datetime, timedelta, timezone

from agent_framework import Content, FunctionInvocationContext, function_middleware


logger = logging.getLogger(__name__)

GITHUB_MCP_TOOLS = {
    "actions_list",
    "list_issues",
    "list_pull_requests",
    "github_actions_list",
    "github_list_issues",
    "github_list_pull_requests",
}


def _source_tool_name(tool_name):
    return tool_name.rsplit("___", maxsplit=1)[-1]


def _is_recent(value, cutoff):
    if not isinstance(value, str):
        return True
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")) >= cutoff
    except ValueError:
        return True


def _login(value):
    return value.get("login") if isinstance(value, Mapping) else None


def _labels(value):
    if not isinstance(value, list):
        return []
    names = []
    for label in value:
        name = label if isinstance(label, str) else label.get("name") if isinstance(label, Mapping) else None
        if isinstance(name, str):
            names.append(name)
    return names


def _select(item, fields):
    return {field: item[field] for field in fields if field in item}


def _normalize_arguments(tool_name, arguments, cutoff):
    if tool_name in {"github_list_pull_requests", "list_pull_requests"}:
        arguments.update(state="all", sort="updated", direction="desc", perPage=100, page=1)
    elif tool_name in {"github_list_issues", "list_issues"}:
        arguments.pop("page", None)
        arguments.pop("query", None)
        arguments.update(
            orderBy="UPDATED_AT",
            direction="DESC",
            since=cutoff.strftime("%Y-%m-%dT%H:%M:%SZ"),
            perPage=100,
        )
    elif tool_name in {"github_actions_list", "actions_list"}:
        filters = arguments.get("workflow_runs_filter")
        filters = dict(filters) if isinstance(filters, Mapping) else {}
        filters["status"] = "completed"
        arguments.update(
            method="list_workflow_runs",
            workflow_runs_filter=filters,
            per_page=100,
            page=1,
        )


def _compact(tool_name, payload, cutoff):
    if tool_name in {"github_list_pull_requests", "list_pull_requests"}:
        if not isinstance(payload, list):
            return payload
        source = payload
        items = []
        for item in source:
            if not isinstance(item, Mapping) or not _is_recent(item.get("updated_at"), cutoff):
                continue
            compact = _select(
                item,
                ("number", "title", "state", "draft", "merged", "created_at", "updated_at", "html_url"),
            )
            compact["author"] = _login(item.get("user"))
            compact["labels"] = _labels(item.get("labels"))
            items.append(compact)
        return {"returned_count": len(items), "pull_requests": items}

    if tool_name in {"github_list_issues", "list_issues"}:
        if not isinstance(payload, Mapping) or not isinstance(payload.get("issues"), list):
            return payload
        source = payload["issues"]
        items = []
        for item in source:
            if not isinstance(item, Mapping) or not _is_recent(item.get("updated_at"), cutoff):
                continue
            compact = _select(
                item,
                ("number", "title", "state", "state_reason", "comments", "created_at", "updated_at", "closed_at", "html_url"),
            )
            compact["author"] = _login(item.get("user"))
            compact["labels"] = _labels(item.get("labels"))
            items.append(compact)
        return {
            "total_count": payload.get("totalCount") if isinstance(payload, Mapping) else None,
            "returned_count": len(items),
            "issues": items,
        }

    if tool_name in {"github_actions_list", "actions_list"}:
        if not isinstance(payload, Mapping) or not isinstance(payload.get("workflow_runs"), list):
            return payload
        source = payload["workflow_runs"]
        items = []
        for item in source:
            if (
                not isinstance(item, Mapping)
                or item.get("conclusion") != "failure"
                or not _is_recent(item.get("updated_at") or item.get("created_at"), cutoff)
            ):
                continue
            compact = _select(
                item,
                (
                    "id", "name", "display_title", "event", "head_branch", "head_sha",
                    "run_number", "run_attempt", "status", "conclusion", "created_at",
                    "updated_at", "html_url",
                ),
            )
            compact["actor"] = _login(item.get("actor"))
            items.append(compact)
        return {"returned_count": len(items), "workflow_runs": items}

    return payload


def _compact_text(tool_name, text, cutoff):
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return text
    compact = json.dumps(_compact(tool_name, payload, cutoff), separators=(",", ":"), sort_keys=True)
    logger.warning(
        "GitHub MCP middleware compacted %s from %d to %d bytes.",
        tool_name,
        len(text.encode("utf-8")),
        len(compact.encode("utf-8")),
    )
    return compact


@function_middleware
async def compact_github_results(context: FunctionInvocationContext, call_next):
    tool_name = _source_tool_name(context.function.name)
    if tool_name not in GITHUB_MCP_TOOLS:
        await call_next()
        return

    cutoff = datetime.now(timezone.utc) - timedelta(days=1)
    if isinstance(context.arguments, dict):
        _normalize_arguments(tool_name, context.arguments, cutoff)

    await call_next()
    if isinstance(context.result, str):
        context.result = _compact_text(tool_name, context.result, cutoff)
    elif isinstance(context.result, list):
        for item in context.result:
            if isinstance(item, Content) and item.type == "text" and item.text is not None:
                item.text = _compact_text(tool_name, item.text, cutoff)
`;
}

async function writeGithubMcpConfig(sourceDir, mode) {
	const mcpPath = path.join(sourceDir, "mcp.json");
	let mcpConfig = { servers: {} };
	try {
		const existing = JSON.parse(await readFile(mcpPath, "utf8"));
		if (existing && typeof existing === "object") mcpConfig = existing;
	} catch {
		/* A fresh template may not have MCP configuration yet. */
	}
	if (!mcpConfig.servers || typeof mcpConfig.servers !== "object") mcpConfig.servers = {};
	delete mcpConfig.servers["aigw-github"];
	delete mcpConfig.servers.github;
	delete mcpConfig.servers[M365_INBOX_CONNECTOR.connectorName];
	if (mode === "gateway") {
		mcpConfig.servers["aigw-github"] = {
			type: "streamable-http",
			url: "$AZURE_AI_GATEWAY_MCP_URL",
			tools: ["github_list_pull_requests", "github_list_issues", "github_actions_list"],
			headers: { "Api-Key": "$AZURE_AI_GATEWAY_API_KEY" },
		};
	} else {
		mcpConfig.servers.github =
			mode === "connector"
			? {
					type: "streamable-http",
					url: "$GITHUB_MCP_SERVER_URL",
					tools: GITHUB_MCP_TOOLS,
					auth: { scope: "https://apihub.azure.com/.default" },
				}
			: {
					type: "streamable-http",
					url: GITHUB_MCP_URL,
					tools: GITHUB_MCP_TOOLS,
					headers: {
						Authorization: "$GITHUB_MCP_AUTHORIZATION",
						"X-MCP-Readonly": "true",
						"X-MCP-Tools": GITHUB_MCP_TOOLS.join(","),
					},
				};
	}
	await writeTextIfChanged(mcpPath, `${JSON.stringify(mcpConfig, null, 2)}\n`);
}

async function migrateGithubToolInstructions(sourceDir, mode) {
	for (const file of ["daily-repo-digest.agent.md", "daily-repo-digest-http.agent.md"]) {
		const agentPath = path.join(sourceDir, file);
		if (!(await exists(agentPath))) continue;
		const current = await readFile(agentPath, "utf8");
		const next =
			mode === "gateway"
				? current
						.replaceAll("github___list_pull_requests", "aigw-github___github_list_pull_requests")
						.replaceAll("github___list_issues", "aigw-github___github_list_issues")
						.replaceAll("github___actions_list", "aigw-github___github_actions_list")
				: current
						.replaceAll("aigw-github___github_list_pull_requests", "github___list_pull_requests")
						.replaceAll("aigw-github___github_list_issues", "github___list_issues")
						.replaceAll("aigw-github___github_actions_list", "github___actions_list");
		if (next !== current) await writeFile(agentPath, next);
	}
}

async function ensureGatewayProviderFiles(entry, mcpMode = "public") {
	const sourceDir = entry.agentDir || path.join(requireTemplateDir(entry), "src");
	const helperPath = path.join(sourceDir, "ai_gateway_client_manager.py");
	const middlewarePath = path.join(sourceDir, "github_mcp_middleware.py");
	const functionAppPath = path.join(sourceDir, "function_app.py");
	const agentsConfigPath = path.join(sourceDir, "agents.config.yaml");
	await writeTextIfChanged(helperPath, gatewayClientManagerSource());
	await writeTextIfChanged(middlewarePath, githubMcpMiddlewareSource());
	await writeGithubMcpConfig(sourceDir, mcpMode);
	await migrateGithubToolInstructions(sourceDir, mcpMode);
	const agentsConfig = await readFile(agentsConfigPath, "utf8");
	if (agentsConfig.includes("model: $FOUNDRY_MODEL")) {
		await writeFile(agentsConfigPath, agentsConfig.replace("model: $FOUNDRY_MODEL", "model: $AZURE_FUNCTIONS_AGENTS_MODEL"));
	}
	const current = await readFile(functionAppPath, "utf8");
	if (current.includes(GATEWAY_PROVIDER_MARKER)) return;
	const importLine = "from azure_functions_agents import create_function_app";
	const appLine = "app = create_function_app()";
	const providerBlock =
		`${GATEWAY_PROVIDER_MARKER}\n` +
		`from ai_gateway_client_manager import AIGatewayClientManager, FoundryClientManager\n\n` +
		`provider = os.environ.get("AZURE_FUNCTIONS_AGENTS_PROVIDER")\n` +
		`if provider == "ai_gateway":\n` +
		`    set_client_manager(AIGatewayClientManager())\n` +
		`elif provider == "foundry":\n` +
		`    set_client_manager(FoundryClientManager())\n`;
	let next;
	if (current.includes(LEGACY_GATEWAY_PROVIDER_MARKER)) {
		next = current.replace(
			/# Intelligent Function App Studio: AI Gateway provider\nif os\.environ\.get\("AZURE_FUNCTIONS_AGENTS_PROVIDER"\) == "ai_gateway":\n {4}from ai_gateway_client_manager import AIGatewayClientManager\n\n {4}set_client_manager\(AIGatewayClientManager\(\)\)\n/,
			providerBlock,
		);
		if (next === current) {
			throw new Error("Could not upgrade the managed model provider block in src/function_app.py.");
		}
	} else {
		if (!current.includes(importLine) || !current.includes(appLine)) {
			throw new Error("Could not add model provider support because src/function_app.py has been customized.");
		}
		next = current
			.replace(importLine, `import os\n\nfrom azure_functions_agents import create_function_app, set_client_manager`)
			.replace(appLine, `${providerBlock}\n${appLine}`);
	}
	await writeFile(functionAppPath, next);
}

async function readLocalSettings(entry) {
	const settingsPath = path.join(requireTemplateDir(entry), "src", "local.settings.json");
	if (!(await exists(settingsPath))) {
		return {
			path: settingsPath,
			json: { IsEncrypted: false, Values: { FUNCTIONS_WORKER_RUNTIME: "python", AzureWebJobsStorage: "UseDevelopmentStorage=true" } },
		};
	}
	const json = JSON.parse(await readFile(settingsPath, "utf8"));
	json.Values = json.Values && typeof json.Values === "object" ? json.Values : {};
	return { path: settingsPath, json };
}

async function assertLocalQueueStorageSafe(entry) {
	const queuePath = path.join(requireTemplateDir(entry), HERO_TEMPLATE.queueAgentRelPath);
	if (entry.trigger !== "queue" && !(await exists(queuePath))) return;
	const { json } = await readLocalSettings(entry);
	assertLocalQueueConnection(json.Values.AzureWebJobsStorage);
}

async function writeTextIfChanged(file, content, options) {
	const current = (await exists(file)) ? await readFile(file, "utf8") : null;
	if (current === content) return false;
	await writeFile(file, content, options);
	return true;
}

async function inspectConfiguredModelBinding(entry) {
	const { json } = await readLocalSettings(entry);
	const values = json.Values;
	const provider = String(values.AZURE_FUNCTIONS_AGENTS_PROVIDER || "");
	if (provider === "foundry" && values.FOUNDRY_PROJECT_ENDPOINT && values.FOUNDRY_MODEL) {
		entry.modelBinding.configured = true;
		entry.modelBinding.source = "foundry";
		entry.modelBinding.activeSource = "foundry";
		entry.modelBinding.modelId = values.FOUNDRY_MODEL;
		entry.modelBinding.activeModelId = values.FOUNDRY_MODEL;
		entry.modelBinding.activeLabel = `${values.FOUNDRY_MODEL} via Microsoft Foundry`;
		return { source: "foundry", endpoint: values.FOUNDRY_PROJECT_ENDPOINT, model: values.FOUNDRY_MODEL };
	}
	if (
		provider === "ai_gateway" &&
		values.AZURE_AI_GATEWAY_OPENAI_BASE_URL &&
		values.AZURE_AI_GATEWAY_API_KEY &&
		values.AZURE_FUNCTIONS_AGENTS_MODEL
	) {
		entry.modelBinding.configured = true;
		entry.modelBinding.source = "gateway";
		entry.modelBinding.activeSource = "gateway";
		entry.modelBinding.modelId = values.AZURE_FUNCTIONS_AGENTS_MODEL;
		entry.modelBinding.activeModelId = values.AZURE_FUNCTIONS_AGENTS_MODEL;
		entry.modelBinding.activeLabel = `${values.AZURE_FUNCTIONS_AGENTS_MODEL} via AI Gateway`;
		return {
			source: "gateway",
			endpoint: values.AZURE_AI_GATEWAY_OPENAI_BASE_URL,
			model: values.AZURE_FUNCTIONS_AGENTS_MODEL,
		};
	}
	entry.modelBinding.configured = false;
	entry.modelBinding.activeLabel = "";
	entry.modelBinding.activeSource = "";
	entry.modelBinding.activeResourceId = "";
	entry.modelBinding.activeModelId = "";
	return null;
}

async function writeModelBindingSettings(entry, valuesToSet) {
	const { path: settingsPath, json } = await readLocalSettings(entry);
	const values = json.Values;
	for (const key of [
		"FOUNDRY_PROJECT_ENDPOINT",
		"FOUNDRY_MODEL",
		"AZURE_OPENAI_ENDPOINT",
		"AZURE_OPENAI_DEPLOYMENT",
		"AZURE_OPENAI_API_KEY",
		"OPENAI_BASE_URL",
		"OPENAI_API_KEY",
		"OPENAI_MODEL",
		"AZURE_AI_GATEWAY_OPENAI_BASE_URL",
		"AZURE_AI_GATEWAY_MCP_URL",
		"AZURE_AI_GATEWAY_API_KEY",
		"AZURE_FUNCTIONS_AGENTS_MODEL",
		"AZURE_TOKEN_CREDENTIALS",
		"FOUNDRY_TOKEN_FILE",
		"GITHUB_MCP_AUTHORIZATION",
		"GITHUB_MCP_SERVER_URL",
	]) {
		delete values[key];
	}
	values.AZURE_SUBSCRIPTION_ID = entry.modelBinding.subscription;
	Object.assign(values, valuesToSet);
	await writeFile(settingsPath, `${JSON.stringify(json, null, 2)}\n`, { mode: 0o600 });
	await chmod(settingsPath, 0o600);
	await protectLocalSettings(requireTemplateDir(entry));
}

function tokenExpirySeconds(token) {
	const numeric = Number(token?.expires_on || token?.expiresOnTimestamp || 0);
	if (Number.isFinite(numeric) && numeric > 0) return numeric;
	const parsed = Date.parse(String(token?.expiresOn || ""));
	return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

async function ensureLocalFoundryToken(entry) {
	const subscription = entry.modelBinding.subscription || entry.azure.subscription;
	if (!subscription) throw new Error("Select an Azure subscription before using a Foundry model.");
	const token = await azureCliSession.accessToken(subscription, "https://ai.azure.com");
	const expiresOn = tokenExpirySeconds(token);
	if (!token?.accessToken || !expiresOn) throw new Error("Azure CLI returned an invalid Foundry access token.");
	const tokenDir = path.join(requireTemplateDir(entry), ".intelligent-function-app-studio");
	await mkdir(tokenDir, { recursive: true, mode: 0o700 });
	await chmod(tokenDir, 0o700);
	const tokenPath = path.join(tokenDir, "foundry-token.json");
	await writeFile(tokenPath, `${JSON.stringify({ accessToken: token.accessToken, expiresOn })}\n`, { mode: 0o600 });
	await chmod(tokenPath, 0o600);
	await protectLocalSettings(requireTemplateDir(entry));
	return tokenPath;
}

async function ensureLocalFoundryRuntimeSettings(entry) {
	const [tokenPath, githubAuthorization] = await Promise.all([
		ensureLocalFoundryToken(entry),
		githubAuthHeader(),
	]);
	const { path: settingsPath, json } = await readLocalSettings(entry);
	json.Values.FOUNDRY_TOKEN_FILE = tokenPath;
	json.Values.GITHUB_MCP_AUTHORIZATION = githubAuthorization;
	await writeTextIfChanged(settingsPath, `${JSON.stringify(json, null, 2)}\n`, { mode: 0o600 });
	await chmod(settingsPath, 0o600);
	await protectLocalSettings(requireTemplateDir(entry));
	return tokenPath;
}

function stopFoundryTokenRefresh(entry) {
	if (entry.foundryTokenRefreshTimer) clearInterval(entry.foundryTokenRefreshTimer);
	entry.foundryTokenRefreshTimer = null;
}

function startFoundryTokenRefresh(entry) {
	stopFoundryTokenRefresh(entry);
	if (entry.modelBinding.activeSource !== "foundry") return;
	entry.foundryTokenRefreshTimer = setInterval(() => {
		void ensureLocalFoundryToken(entry).catch((error) => {
			entry.local.error = `Could not refresh the Foundry token: ${shortError(error)}`;
			broadcast(entry, "state", snapshot(entry));
		});
	}, 4 * 60 * 1000);
	entry.foundryTokenRefreshTimer.unref();
}

function modelResources(entry, source = entry.modelBinding.source) {
	return source === "gateway" ? entry.modelBinding.gateways : entry.modelBinding.foundry;
}

function selectDefaultModelBinding(entry) {
	const resources = modelResources(entry);
	const resource = resources.find((item) => item.models.length);
	if (!resource) {
		entry.modelBinding.resourceId = "";
		entry.modelBinding.modelId = "";
		return;
	}
	entry.modelBinding.resourceId = resource.id;
	entry.modelBinding.modelId = resource.models[0].id;
}

async function discoverModelBindings(entry, subscription) {
	entry.modelBinding.loading = true;
	entry.modelBinding.error = "";
	entry.modelBinding.status = "Discovering existing model endpoints...";
	entry.modelBinding.subscription = subscription;
	broadcast(entry, "state", snapshot(entry));
	const c = cmdStart(entry, {
		kind: "azure",
		title: "model endpoint discovery",
		cmd:
			`az resource list --resource-type Microsoft.CognitiveServices/accounts/projects --subscription ${subscription}\n` +
			`GET https://management.azure.com/subscriptions/${subscription}/providers/Microsoft.ApiManagement/service?api-version=2025-09-01-preview`,
		purpose: "Find existing Microsoft Foundry projects, model deployments, AI Gateways, and governed models",
	});
	try {
		const discovery = await discoverModelCapabilities(
			() => discoverFoundryBindings(subscription),
			() => discoverGatewayBindings(subscription),
		);
		const foundryAll = discovery.foundry;
		const gatewaysAll = discovery.gateways;
		entry.modelBinding.gatewayCapability = discovery.gatewayCapability;
		const foundry = foundryAll.filter((project) => project.endpoint && project.models.length);
		const gateways = gatewaysAll.filter((gateway) => gateway.endpoint && gateway.models.length);
		entry.modelBinding.foundry = foundry;
		if (discovery.gatewayCapability.status === "available") entry.modelBinding.gateways = gateways;
		// Raw (unfiltered) counts let the UI distinguish "no Foundry
		// project/account exists at all" from "a project/account exists but has
		// no supported model deployment yet" - the two are fixed very
		// differently (Create Models vs. deploy a model to the existing account).
		entry.modelBinding.foundryAccountCount = foundryAll.length;
		entry.modelBinding.foundryModelessCount = foundryAll.filter((p) => p.endpoint && !p.models.length).length;
		entry.modelBinding.gatewayAccountCount = gatewaysAll.length;
		entry.modelBinding.gatewayModelessCount = gatewaysAll.filter((g) => g.endpoint && !g.models.length).length;
		if (
			(entry.modelBinding.source !== "gateway" || discovery.gatewayCapability.status === "available") &&
			!modelResources(entry).some((resource) => resource.id === entry.modelBinding.resourceId)
		) {
			selectDefaultModelBinding(entry);
		}
		entry.modelBinding.status =
			`${foundry.reduce((sum, item) => sum + item.models.length, 0)} Foundry and ` +
			`${entry.modelBinding.gateways.reduce((sum, item) => sum + item.models.length, 0)} gateway model(s) found`;
		cmdEnd(entry, c, {
			ok: true,
			note: `${foundry.length} project(s), ${entry.modelBinding.gateways.length} gateway(s)`,
		});
	} catch (error) {
		entry.modelBinding.error = `Model discovery failed: ${shortError(error)}`;
		entry.modelBinding.status = "";
		cmdEnd(entry, c, { ok: false, note: shortError(error) });
	} finally {
		entry.modelBinding.loading = false;
		broadcast(entry, "state", snapshot(entry));
	}
}

async function applyModelBinding(entry, { source, resourceId, modelId }, restart = true) {
	assertWorkspaceMutationAllowed(entry, "Changing the model binding");
	if (source !== "foundry" && source !== "gateway") throw new Error("Choose Microsoft Foundry or AI Gateway.");
	if (source === "gateway") {
		try {
			requireGatewayCapability(entry.modelBinding.gatewayCapability);
			entry.modelBinding.gatewayActionError = "";
		} catch (error) {
			entry.modelBinding.gatewayActionError = error.message;
			broadcast(entry, "state", snapshot(entry));
			throw error;
		}
	} else {
		entry.modelBinding.gatewayActionError = "";
	}
	entry.modelBinding.source = source;
	const resource = modelResources(entry, source).find((item) => item.id === resourceId);
	if (!resource) throw new Error("Choose an existing model resource.");
	const model = resource.models.find((item) => item.id === modelId);
	if (!model) throw new Error("Choose an existing model.");
	entry.modelBinding.status = `Binding ${model.label}...`;
	entry.modelBinding.error = "";
	entry.modelBinding.loading = true;
	broadcast(entry, "state", snapshot(entry));
	try {
		if (source === "foundry") {
			entry.modelBinding.status = `Waiting for ${resource.name} to accept model requests...`;
			broadcast(entry, "state", snapshot(entry));
			await waitForFoundryProjectReady(resource.endpoint, entry.modelBinding.subscription);
		}
		if (source === "foundry") {
			await ensureGatewayProviderFiles(entry, "public");
			const githubAuthorization = await githubAuthHeader();
			const tokenPath = await ensureLocalFoundryToken(entry);
			await writeModelBindingSettings(entry, {
				AZURE_FUNCTIONS_AGENTS_PROVIDER: "foundry",
				FOUNDRY_PROJECT_ENDPOINT: resource.endpoint,
				FOUNDRY_MODEL: model.id,
				AZURE_FUNCTIONS_AGENTS_MODEL: model.id,
				FOUNDRY_TOKEN_FILE: tokenPath,
				GITHUB_MCP_AUTHORIZATION: githubAuthorization,
			});
		} else {
			await ensureGatewayProviderFiles(entry, "gateway");
			const key = await fetchGatewayKey(entry, resource);
			const runtimeUrls = gatewayRuntimeUrls(resource.endpoint, AIGW_WORKSPACE);
			await writeModelBindingSettings(entry, {
				AZURE_FUNCTIONS_AGENTS_PROVIDER: "ai_gateway",
				AZURE_AI_GATEWAY_OPENAI_BASE_URL: runtimeUrls.openAiBaseUrl,
				AZURE_AI_GATEWAY_MCP_URL: runtimeUrls.githubMcpUrl,
				AZURE_AI_GATEWAY_API_KEY: key,
				AZURE_FUNCTIONS_AGENTS_MODEL: model.id,
			});
		}
		entry.modelBinding.resourceId = resource.id;
		entry.modelBinding.modelId = model.id;
		entry.modelBinding.configured = true;
		entry.modelBinding.activeSource = source;
		entry.modelBinding.activeResourceId = resource.id;
		entry.modelBinding.activeModelId = model.id;
		entry.modelBinding.activeLabel = `${model.label} via ${source === "foundry" ? "Microsoft Foundry" : "AI Gateway"}`;
		entry.modelBinding.status = `${entry.modelBinding.activeLabel} is ready`;
		if (restart) await restartLocalEnvironment(entry);
	} catch (error) {
		entry.modelBinding.error = shortError(error);
		entry.modelBinding.status = "";
		throw error;
	} finally {
		entry.modelBinding.loading = false;
		broadcast(entry, "state", snapshot(entry));
	}
}

// --- CREATE MODELS: a real, repo-consistent path to provision the Foundry
// resources this template needs when a subscription has none yet. This
// mirrors the existing Deploy to Azure button's pattern exactly - it only
// ever *shows* the concrete action (never runs anything on its own), and
// only executes once the user explicitly confirms. A model-only subscription
// deployment reuses the template's Foundry module without deploying the
// Function App, storage, monitoring, or hosting plan.
const FOUNDRY_CREATE_RESOURCES = [
	{
		kind: "Resource group",
		note: "A dedicated resource group in East US 2",
	},
	{
		kind: "Foundry",
		note: "Azure AI Foundry account and project",
	},
	{
		kind: "gpt-5.4-mini",
		note: "Version 2026-03-17, GlobalStandard capacity 200",
	},
	{
		kind: "gpt-5.6-sol",
		note: "Version 2026-07-09, GlobalStandard capacity 20",
	},
	{
		kind: "Access",
		note: "Required Foundry User and Cognitive Services role assignments",
	},
];

const CREATE_MODELS_BICEP_MARKER = "// Managed by Intelligent Function App Studio Create Models.";
const CREATE_MODELS_ENTRYPOINT_MARKER = "// Managed by Intelligent Function App Studio Create Models entrypoint.";
const CREATE_MODELS_LOCATION = "eastus2";
const STOCK_FOUNDRY_BICEP_SHA256 = new Set([
	"02dec44c156825269624d135d569cd2102b4dd1dd08c0ee6ea2a49a3b14d75f8",
]);
const CREATE_MODELS_FOUNDRY_BICEP = `${CREATE_MODELS_BICEP_MARKER}
param accountName string
param projectName string
param location string = resourceGroup().location
param tags object = {}
// Kept for compatibility with older versions of the template's main.bicep.
#disable-next-line no-unused-params
param modelDeploymentName string = 'gpt-latest'
#disable-next-line no-unused-params
param modelName string = 'gpt-5.6-sol'
#disable-next-line no-unused-params
param modelVersion string = '2026-07-09'
#disable-next-line no-unused-params
param deploymentCapacity int = 20
param managedIdentityPrincipalId string = ''
param deployerPrincipalId string = ''

var cognitiveServicesUserRoleId = 'a97b65f3-24c7-4388-baec-2e87135dc908'
var cognitiveServicesOpenAiUserRoleId = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'
var foundryUserRoleId = '53ca6127-db72-4b80-b1b0-d745d6d5456d'
var modelDeployments = [
  {
    deploymentName: 'gpt-mini-latest'
    modelName: 'gpt-5.4-mini'
    modelVersion: '2026-03-17'
    capacity: 200
  }
  {
    deploymentName: 'gpt-latest'
    modelName: 'gpt-5.6-sol'
    modelVersion: '2026-07-09'
    capacity: 20
  }
]

resource foundryAccount 'Microsoft.CognitiveServices/accounts@2025-10-01-preview' = {
  name: accountName
  location: location
  kind: 'AIServices'
  sku: {
    name: 'S0'
  }
  tags: tags
  properties: {
    allowProjectManagement: true
    customSubDomainName: accountName
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
  }
}

resource foundryProject 'Microsoft.CognitiveServices/accounts/projects@2025-10-01-preview' = {
  parent: foundryAccount
  name: projectName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    displayName: projectName
    description: 'Serverless agents quickstart project'
  }
}

@batchSize(1)
resource foundryModelDeployments 'Microsoft.CognitiveServices/accounts/deployments@2025-04-01-preview' = [for deployment in modelDeployments: {
  parent: foundryAccount
  name: deployment.deploymentName
  sku: {
    name: 'GlobalStandard'
    capacity: deployment.capacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: deployment.modelName
      version: deployment.modelVersion
    }
  }
}]

resource foundryCognitiveServicesUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(managedIdentityPrincipalId)) {
  name: guid(foundryAccount.id, managedIdentityPrincipalId, cognitiveServicesUserRoleId)
  scope: foundryAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', cognitiveServicesUserRoleId)
    principalId: managedIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource foundryOpenAiUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(managedIdentityPrincipalId)) {
  name: guid(foundryAccount.id, managedIdentityPrincipalId, cognitiveServicesOpenAiUserRoleId)
  scope: foundryAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', cognitiveServicesOpenAiUserRoleId)
    principalId: managedIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource foundryUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(managedIdentityPrincipalId)) {
  name: guid(foundryProject.id, managedIdentityPrincipalId, foundryUserRoleId)
  scope: foundryProject
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', foundryUserRoleId)
    principalId: managedIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource foundryDeployerCognitiveServicesUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(deployerPrincipalId)) {
  name: guid(foundryAccount.id, deployerPrincipalId, cognitiveServicesUserRoleId)
  scope: foundryAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', cognitiveServicesUserRoleId)
    principalId: deployerPrincipalId
    principalType: 'User'
  }
}

resource foundryDeployerOpenAiUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(deployerPrincipalId)) {
  name: guid(foundryAccount.id, deployerPrincipalId, cognitiveServicesOpenAiUserRoleId)
  scope: foundryAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', cognitiveServicesOpenAiUserRoleId)
    principalId: deployerPrincipalId
    principalType: 'User'
  }
}

resource foundryDeployerUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(deployerPrincipalId)) {
  name: guid(foundryProject.id, deployerPrincipalId, foundryUserRoleId)
  scope: foundryProject
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', foundryUserRoleId)
    principalId: deployerPrincipalId
    principalType: 'User'
  }
}

output accountName string = foundryAccount.name
output projectName string = foundryProject.name
output projectEndpoint string = '\${foundryAccount.properties.endpoints['AI Foundry API']}api/projects/\${foundryProject.name}'
output modelDeploymentName string = foundryModelDeployments[1].name
`;

const CREATE_MODELS_ENTRYPOINT_BICEP = `${CREATE_MODELS_ENTRYPOINT_MARKER}
targetScope = 'subscription'

@minLength(1)
param environmentName string

@allowed([
  'eastus2'
])
param location string = 'eastus2'

var abbrs = loadJsonContent('./abbreviations.json')
var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))
var tags = { 'azd-env-name': environmentName }
var foundryAccountName = 'cog-\${resourceToken}'
var foundryProjectName = '\${foundryAccountName}-proj'

resource rg 'Microsoft.Resources/resourceGroups@2021-04-01' = {
  name: '\${abbrs.resourcesResourceGroups}\${environmentName}'
  location: location
  tags: tags
}

module foundry './app/foundry.bicep' = {
  name: 'foundry-models'
  scope: rg
  params: {
    accountName: foundryAccountName
    projectName: foundryProjectName
    location: location
    tags: tags
    deployerPrincipalId: deployer().objectId
  }
}

output FOUNDRY_PROJECT_ENDPOINT string = foundry.outputs.projectEndpoint
output FOUNDRY_MODEL string = foundry.outputs.modelDeploymentName
output FOUNDRY_ACCOUNT_NAME string = foundry.outputs.accountName
output FOUNDRY_PROJECT_NAME string = foundry.outputs.projectName
`;

async function ensureCreateModelsBicep(entry) {
	const infraDir = path.join(requireTemplateDir(entry), "infra");
	const bicepPath = path.join(infraDir, "app", "foundry.bicep");
	const current = await readFile(bicepPath, "utf8");
	const isManaged = current.startsWith(CREATE_MODELS_BICEP_MARKER);
	const normalized = `${current.replace(/\r\n/g, "\n").trimEnd()}\n`;
	const currentSha256 = createHash("sha256").update(normalized).digest("hex");
	const isStockSingleModel = STOCK_FOUNDRY_BICEP_SHA256.has(currentSha256);
	if (!isManaged && !isStockSingleModel) {
		throw new Error(
			"Create Models found a customized infra/app/foundry.bicep and will not overwrite it. Restore the stock template file or manage its model deployments directly.",
		);
	}
	const entrypointPath = path.join(infraDir, "create-models.bicep");
	if (await exists(entrypointPath)) {
		const entrypointCurrent = await readFile(entrypointPath, "utf8");
		if (!entrypointCurrent.startsWith(CREATE_MODELS_ENTRYPOINT_MARKER)) {
			throw new Error("Create Models found a customized infra/create-models.bicep and will not overwrite it.");
		}
	}
	if (current !== CREATE_MODELS_FOUNDRY_BICEP) {
		await writeFile(bicepPath, CREATE_MODELS_FOUNDRY_BICEP);
	}
	await writeFile(entrypointPath, CREATE_MODELS_ENTRYPOINT_BICEP);
	return { bicepPath, entrypointPath };
}

// Read-only: describes exactly what Create Models would do, without touching
// Azure. Safe to call at any time (including from chat) since it never
// executes an Azure deployment itself.
async function buildModelCreationPlan(entry) {
	await ensureTemplate(entry);
	const dir = requireTemplateDir(entry);
	const subscription = entry.modelBinding.subscription || entry.azure.subscription || "";
	const environmentName = (safeSegment(entry.instanceId) || "ifas").slice(0, 40);
	const deploymentName = `ifas-models-${createHash("sha256").update(entry.instanceId).digest("hex").slice(0, 8)}`;
	const abbreviations = JSON.parse(await readFile(path.join(dir, "infra", "abbreviations.json"), "utf8"));
	const resourceGroupName = `${abbreviations.resourcesResourceGroups || "rg-"}${environmentName}`;
	const args = [
		"deployment",
		"sub",
		"create",
		"--name",
		deploymentName,
		"--location",
		CREATE_MODELS_LOCATION,
		"--template-file",
		path.join(dir, "infra", "create-models.bicep"),
		"--parameters",
		`environmentName=${environmentName}`,
		`location=${CREATE_MODELS_LOCATION}`,
		"--subscription",
		subscription || "<selected-subscription>",
		"--query",
		"properties.outputs",
		"--output",
		"json",
	];
	const accountNamePattern = "cog-<13-char hash of subscription, canvas instance, eastus2>";
	const projectNamePattern = `${accountNamePattern}-proj`;
	return {
		workingDir: dir,
		command: `az ${args.join(" ")}`,
		executable: "az",
		args,
		subscription,
		location: CREATE_MODELS_LOCATION,
		resourceGroupName,
		accountNamePattern,
		projectNamePattern,
		source: "infra/create-models.bicep and infra/app/foundry.bicep using the AI Gateway template model lineup",
		resources: FOUNDRY_CREATE_RESOURCES.map((resource) => {
			if (resource.kind === "Resource group") return { ...resource, note: `${resourceGroupName} in East US 2` };
			if (resource.kind === "Foundry") {
				return { ...resource, note: `Account ${accountNamePattern} and project ${projectNamePattern}; exact names appear after deployment` };
			}
			return resource;
		}),
		alternatives: [
			"Already have models? Use Existing to select a Foundry or AI Gateway deployment instead.",
		],
	};
}

// Executes the plan. Only ever called after the caller has verified
// `confirm === true` came from an explicit user click - never from a doctor
// check, a discovery refresh, or an agent action guess.
async function runModelCreation(entry) {
	// Resolve the working copy before acquiring the lock. Once acquired, keep
	// every IaC write and azd process under that same lock.
	const plan = await buildModelCreationPlan(entry);
	if (!plan.subscription) {
		return { ok: false, message: "Select an Azure subscription before creating models." };
	}
	try {
		beginAzdOperation(entry, "create-models");
	} catch (error) {
		return { ok: false, message: shortError(error) };
	}
	try {
		await ensureCreateModelsBicep(entry);
	} catch (error) {
		const message = shortError(error);
		entry.modelCreate = { ...entry.modelCreate, planned: true, running: false, ok: false, message, ...plan };
		endAzdOperation(entry, "create-models");
		broadcast(entry, "state", snapshot(entry));
		return { ok: false, message };
	}
	entry.modelCreate = { ...entry.modelCreate, planned: true, running: true, ok: null, message: "", ...plan };
	broadcast(entry, "state", snapshot(entry));
	const c = cmdStart(entry, {
		kind: "az",
		title: "Create Foundry models",
		cmd: plan.command,
		purpose: "Provision only the Foundry account, project, role assignments, and two model deployments",
	});
	try {
		await execFileText("az", ["version", "-o", "json"], { cwd: plan.workingDir, env: azureCliChildEnv() });
	} catch {
		const message = "Azure CLI not found. Install it, sign in, then retry Create Models.";
		entry.modelCreate = { ...entry.modelCreate, running: false, ok: false, message };
		cmdEnd(entry, c, { ok: false, note: "Azure CLI not found" });
		endAzdOperation(entry, "create-models");
		broadcast(entry, "state", snapshot(entry));
		return { ok: false, message };
	}
	return new Promise((resolve) => {
		let output = "";
		let stdout = "";
		let launchFailed = false;
		const summarizeOutput = () => {
			const text = output.trim();
			const reason = text.match(/"reason"\s*:\s*"([^"]+)"/i)?.[1] || text.match(/Reasons:\s*'([^']+)'/i)?.[1];
			const code = text.match(/"code"\s*:\s*"([^"]+)"/i)?.[1];
			if (reason) return `${code ? `${code}: ` : ""}${reason.replace(/\\n/g, " ")}`.slice(0, 900);
			return text.split("\n").map((line) => line.trim()).filter(Boolean).slice(-5).join(" ").slice(-900);
		};
		const appendOutput = (chunk) => {
			const sanitized = String(chunk)
				.replace(/\u001b\[[0-9;]*m/g, "")
				.replace(/Bearer\s+\S+/gi, "Bearer REDACTED")
				.replace(/((?:access[_-]?token|secret|password)\s*[:=]\s*)\S+/gi, "$1REDACTED");
			output = `${output}${sanitized}`.slice(-12000);
		};
		const child = spawn(plan.executable, plan.args, {
			cwd: plan.workingDir,
			stdio: ["ignore", "pipe", "pipe"],
			detached: true,
			env: azureCliChildEnv(),
		});
		child.stdout.on("data", (chunk) => {
			stdout = `${stdout}${String(chunk)}`.slice(-12000);
			appendOutput(chunk);
		});
		child.stderr.on("data", appendOutput);
		child.once("error", (error) => {
			launchFailed = true;
			const message = `Unable to launch model deployment: ${shortError(error)}`;
			entry.modelCreate = { ...entry.modelCreate, running: false, ok: false, message };
			cmdEnd(entry, c, { ok: false, note: shortError(error) });
			endAzdOperation(entry, "create-models");
			broadcast(entry, "state", snapshot(entry));
			resolve({ ok: false, message });
		});
		child.once("spawn", () => {
			child.unref();
			const message = `Creating the two Foundry model deployments in ${plan.location}. Progress and errors appear in Commands.`;
			// Keep modelCreate.running true and hold the azd-operation guard
			// until the detached process really exits below - launching is not
			// the same as finishing, and Deploy to Azure must stay blocked for
			// as long as this model deployment is genuinely still running.
			entry.modelCreate = { ...entry.modelCreate, running: true, ok: null, message };
			broadcast(entry, "state", snapshot(entry));
			resolve({ ok: true, message });
			child.once("close", (code, signal) => {
				if (launchFailed) return;
				const exitOk = code === 0;
				const detail = summarizeOutput();
				let created = {};
				if (exitOk) {
					try {
						const outputs = JSON.parse(stdout.trim());
						created = {
							accountName: String(outputs?.FOUNDRY_ACCOUNT_NAME?.value || ""),
							projectName: String(outputs?.FOUNDRY_PROJECT_NAME?.value || ""),
						};
					} catch {
						// The deployment succeeded; model discovery can still resolve the names.
					}
				}
				const createdNames = created.accountName
					? ` Foundry account: ${created.accountName}.${created.projectName ? ` Project: ${created.projectName}.` : ""}`
					: "";
				const exitMessage = exitOk
					? `Foundry models created.${createdNames} Refresh model discovery to select gpt-latest or gpt-mini-latest.${!created.accountName && detail ? ` ${detail}` : ""}`
					: `Model deployment exited with code ${code ?? "null"}${signal ? `, signal ${signal}` : ""}.${detail ? ` ${detail}` : ""}`;
				entry.modelCreate = { ...entry.modelCreate, running: false, ok: exitOk, message: exitMessage, ...created };
				cmdEnd(entry, c, { ok: exitOk, note: exitMessage });
				endAzdOperation(entry, "create-models");
				broadcast(entry, "state", snapshot(entry));
			});
		});
	});
}


async function initializeModelBindings(entry) {
	if (entry.modelBinding.initializePromise) return entry.modelBinding.initializePromise;
	entry.modelBinding.initializePromise = (async () => {
		await ensureTemplate(entry);
		await ensureGatewayProviderFiles(entry);
		const configured = await inspectConfiguredModelBinding(entry);
		await ensureAzureSubscriptions(entry);
		if (!entry.azure.subscription) {
			entry.modelBinding.error = entry.azure.subscriptionsError || "No Azure subscription is available for model discovery.";
			broadcast(entry, "state", snapshot(entry));
			return;
		}
		await discoverModelBindings(entry, entry.azure.subscription);
		const resources = modelResources(entry);
		const configuredResource = configured
			? resources.find((resource) => {
					const endpointMatches =
						configured.source === "foundry"
							? resource.endpoint === configured.endpoint
							: configured.endpoint.startsWith(`${resource.endpoint}/`);
					return endpointMatches && resource.models.some((model) => model.id === configured.model);
				})
			: null;
		if (configuredResource) {
			const configuredModel = configuredResource.models.find((model) => model.id === configured.model);
			entry.modelBinding.resourceId = configuredResource.id;
			entry.modelBinding.modelId = configuredModel?.id || "";
			entry.modelBinding.activeResourceId = configuredResource.id;
			entry.modelBinding.activeLabel =
				`${configuredModel?.label || configured.model} via ${configured.source === "foundry" ? "Microsoft Foundry" : "AI Gateway"}`;
		}
		if (!entry.modelBinding.configured) {
			entry.modelBinding.source =
				entry.modelBinding.foundry.some((item) => item.models.length) ||
				entry.modelBinding.gatewayCapability.status !== "available"
					? "foundry"
					: "gateway";
			selectDefaultModelBinding(entry);
			if (entry.modelBinding.resourceId && entry.modelBinding.modelId) {
				await applyModelBinding(
					entry,
					{
						source: entry.modelBinding.source,
						resourceId: entry.modelBinding.resourceId,
						modelId: entry.modelBinding.modelId,
					},
					false,
				);
			}
		}
	})().finally(() => {
		entry.modelBinding.initializePromise = null;
	});
	return entry.modelBinding.initializePromise;
}

async function writeAgentBody(filePath, bodyText) {
	let frontmatter;
	try {
		frontmatter = frontmatterOf(await readFile(filePath, "utf8"));
	} catch {
		frontmatter = "---\nname: Agent\ndescription: Agent\n---\n";
	}
	await writeFile(filePath, `${frontmatter}\n${bodyText.trim()}\n`);
}

async function loadTimerSchedule(entry) {
	const timerPath = path.join(requireTemplateDir(entry), HERO_TEMPLATE.timerAgentRelPath);
	const source = await readFile(timerPath, "utf8");
	const expression = source.match(/^\s*schedule:\s*["']?([^"'\r\n]+)["']?\s*$/m)?.[1]?.trim() || "";
	const parsed = timerScheduleFromExpression(expression);
	if (parsed) {
		entry.timerSchedule = parsed;
		return;
	}
	entry.timerSchedule.expression = expression;
	entry.timerSchedule.status = "";
	entry.timerSchedule.error = "This Timer does not use a supported Daily, Weekly, or Hourly schedule.";
}

async function setTimerSchedule(entry, input) {
	assertWorkspaceMutationAllowed(entry, "Changing timer schedule");
	await ensureTemplate(entry);
	const schedule = normalizeTimerSchedule({ ...entry.timerSchedule, ...input });
	const expression = timerExpressionFromSchedule(schedule);
	const timerPath = path.join(requireTemplateDir(entry), HERO_TEMPLATE.timerAgentRelPath);
	const source = await readFile(timerPath, "utf8");
	const next = replaceTimerScheduleExpression(source, expression);
	await writeFile(timerPath, next);
	entry.timerSchedule = {
		...schedule,
		expression,
		error: "",
		status: describeTimerSchedule(schedule),
	};
	broadcast(entry, "state", snapshot(entry));
	if (entry.target === "local" && entry.trigger === "timer") await restartLocalEnvironment(entry);
}

function isolatedTemplateDirectory(entry) {
	return path.join(homedir(), ".intelligent-function-app-studio", safeSegment(entry.instanceId), "template");
}

function sourceOwnershipManifestPath(entry) {
	const copilotHome = process.env.COPILOT_HOME || path.join(homedir(), ".copilot");
	if (entry.sourceWorkspace.workingDirectory) {
		return sourceManifestPath(copilotHome, "workspace", path.resolve(entry.sourceWorkspace.workingDirectory));
	}
	return sourceManifestPath(copilotHome, entry.sessionId, entry.instanceId);
}

function legacySourceOwnershipManifestPath(entry) {
	const copilotHome = process.env.COPILOT_HOME || path.join(homedir(), ".copilot");
	return sourceManifestPath(copilotHome, entry.sessionId, entry.instanceId);
}

function sourceRemovalMarkerPath(entry) {
	return `${entry.sourceWorkspace.manifestPath}.removed`;
}

async function configureTemplateDirectory(entry, dir) {
	const timerPath = path.join(dir, HERO_TEMPLATE.timerAgentRelPath);
	const httpPath = path.join(dir, HERO_TEMPLATE.httpAgentRelPath);
	entry.templateDir = dir;
	entry.agentDir = path.join(dir, "src");
	entry.queueName = queueNameForWorkspace(dir);
	await protectLocalSettings(dir);
	await ensureAgentResponseLogging(entry);
	const raw = await readFile(timerPath, "utf8");
	entry.prompt = stripFrontmatter(raw);
	const skillName = skillNameOf(raw);

	const currentHttpTwin = (await exists(httpPath)) ? await readFile(httpPath, "utf8") : "";
	const needsSecureHttpTwin =
		!currentHttpTwin ||
		/\bhttp_auth\s*:\s*/i.test(currentHttpTwin) ||
		/\bauth_level\s*:\s*anonymous\b/i.test(currentHttpTwin);
	if (needsSecureHttpTwin) {
		const c = cmdStart(entry, {
			kind: "shell",
			title: "write HTTP twin agent",
			cmd: `write ${HERO_TEMPLATE.httpAgentRelPath}`,
			purpose:
				"Generate a local HTTP-triggered twin of the Timer agent (same instructions, http_trigger front matter) so HTTP has a real direct-invoke endpoint",
		});
		try {
			await writeFile(httpPath, httpTwinContent(entry.prompt, skillName));
			cmdEnd(entry, c, { ok: true });
		} catch (error) {
			cmdEnd(entry, c, { ok: false, note: shortError(error) });
			throw error;
		}
	}
	await syncGeneratedTriggerFiles(entry, entry.prompt, skillName);

	entry.hero = {
		title: skillName,
		repo: HERO_TEMPLATE.repo,
		repoUrl: HERO_TEMPLATE.repoUrl,
		sourceUrl: HERO_TEMPLATE.sourceUrl,
		agentFile: HERO_TEMPLATE.timerAgentRelPath,
		httpAgentFile: HERO_TEMPLATE.httpAgentRelPath,
		queueAgentFile: HERO_TEMPLATE.queueAgentRelPath,
		connectorAgentFile: HERO_TEMPLATE.connectorAgentRelPath,
		dir,
		files: await listTemplateFiles(dir),
	};
	broadcast(entry, "state", snapshot(entry));
	return entry.hero;
}

async function cloneTemplateDirectory(entry, dir) {
	const timerPath = path.join(dir, HERO_TEMPLATE.timerAgentRelPath);
	if (await exists(timerPath)) return;
	if (await exists(dir)) throw new Error(`The selected generated app folder already exists: ${dir}`);
	const c = cmdStart(entry, {
		kind: "shell",
		title: "git clone (template)",
		cmd: `git clone --depth 1 ${HERO_TEMPLATE.cloneUrl} ${dir}`,
		purpose: "Fetch the real daily-digest template repo into the selected generated app folder",
	});
	try {
		await mkdir(path.dirname(dir), { recursive: true });
		await execFileText("git", ["clone", "--depth", "1", HERO_TEMPLATE.cloneUrl, dir]);
		// Start from the template, not a fork of it: remove upstream history/origin.
		await rm(path.join(dir, ".git"), { recursive: true, force: true });
		cmdEnd(entry, c, { ok: true, note: "cloned" });
	} catch (error) {
		await rm(dir, { recursive: true, force: true });
		cmdEnd(entry, c, { ok: false, note: shortError(error) });
		throw error;
	}
}

async function hydrateSourceWorkspace(entry, { sessionId, workingDirectory } = {}) {
	if (entry.sourceWorkspace.hydrated) return;
	entry.sessionId = String(sessionId || entry.sessionId || "");
	entry.sourceWorkspace.workingDirectory =
		workingDirectory && path.isAbsolute(workingDirectory) ? path.resolve(workingDirectory) : "";
	entry.sourceWorkspace.manifestPath = sourceOwnershipManifestPath(entry);

	let manifest = await readOwnershipManifest(entry.sourceWorkspace.manifestPath);
	const legacyManifestPath = legacySourceOwnershipManifestPath(entry);
	if (!manifest && legacyManifestPath !== entry.sourceWorkspace.manifestPath) {
		manifest = await readOwnershipManifest(legacyManifestPath);
		if (manifest) {
			await writeOwnershipManifest(entry.sourceWorkspace.manifestPath, manifest);
			await deleteOwnershipManifest(legacyManifestPath);
		}
	}
	if (!manifest && (await exists(sourceRemovalMarkerPath(entry)))) {
		entry.sourceWorkspace.autoCreate = false;
	}
	if (manifest && (await exists(path.join(manifest.root, HERO_TEMPLATE.timerAgentRelPath)))) {
		entry.sourceWorkspace.mode = "current";
		entry.sourceWorkspace.relativePath = manifest.relativePath;
		entry.sourceWorkspace.destination = manifest.root;
		entry.sourceWorkspace.materialized = true;
		entry.sourceWorkspace.manifest = manifest;
		await configureTemplateDirectory(entry, manifest.root);
	} else {
		if (manifest) await deleteOwnershipManifest(entry.sourceWorkspace.manifestPath);
		const isolated = isolatedTemplateDirectory(entry);
		if (await exists(path.join(isolated, HERO_TEMPLATE.timerAgentRelPath))) {
			entry.sourceWorkspace.mode = "isolated";
			entry.sourceWorkspace.destination = isolated;
			entry.sourceWorkspace.materialized = true;
			await configureTemplateDirectory(entry, isolated);
		} else if (entry.sourceWorkspace.workingDirectory) {
			entry.sourceWorkspace.mode = "current";
			const selected = resolveCurrentWorkspaceDestination(
				entry.sourceWorkspace.workingDirectory,
				entry.sourceWorkspace.relativePath,
			);
			entry.sourceWorkspace.destination = selected.destination;
		} else {
			entry.sourceWorkspace.mode = "isolated";
			entry.sourceWorkspace.destination = isolated;
		}
	}
	entry.sourceWorkspace.hydrated = true;
	broadcast(entry, "state", snapshot(entry));
}

async function materializeSourceWorkspace(entry, { mode, relativePath } = {}) {
	assertWorkspaceMutationAllowed(entry, "Creating the generated app");
	if (entry.sourceWorkspace.materialized) return entry.hero;
	if (entry.sourceWorkspace.operation) throw new Error("A generated workspace operation is already running.");
	const nextMode = mode === "isolated" ? "isolated" : "current";
	if (nextMode === "current" && !entry.sourceWorkspace.workingDirectory) {
		throw new Error("This chat does not expose a current worktree. Choose an isolated workspace.");
	}

	entry.sourceWorkspace.operation = "creating";
	entry.sourceWorkspace.error = "";
	entry.sourceWorkspace.mode = nextMode;
	if (nextMode === "current") entry.sourceWorkspace.relativePath = String(relativePath || DEFAULT_CURRENT_SUBDIR);
	broadcast(entry, "state", snapshot(entry));

	let cloneDestination = "";
	let removeCloneOnFailure = false;
	try {
		let destination;
		if (nextMode === "current") {
			const selected = await assertCurrentWorkspaceDestinationSafe(
				entry.sourceWorkspace.workingDirectory,
				entry.sourceWorkspace.relativePath,
			);
			entry.sourceWorkspace.relativePath = selected.relative;
			destination = selected.destination;
			if (await exists(destination)) {
				throw new Error(
					`The current-worktree destination already exists: ${destination}. Choose another subfolder or use an isolated workspace.`,
				);
			}
			cloneDestination = path.join(
				homedir(),
				".intelligent-function-app-studio",
				safeSegment(entry.instanceId),
				`staging-${Date.now()}`,
			);
			removeCloneOnFailure = true;
		} else {
			destination = isolatedTemplateDirectory(entry);
			cloneDestination = destination;
			removeCloneOnFailure = !(await exists(cloneDestination));
		}

		await cloneTemplateDirectory(entry, cloneDestination);
		await configureTemplateDirectory(entry, cloneDestination);
		await ensureRuntimeRequirement(entry);
		await ensureGatewayProviderFiles(entry, "public");

		if (nextMode === "current") {
			await moveWorkspaceDirectory(cloneDestination, destination);
			await configureTemplateDirectory(entry, destination);
		}

		entry.sourceWorkspace.destination = destination;
		entry.sourceWorkspace.materialized = true;
		entry.sourceWorkspace.autoCreate = true;
		await rm(sourceRemovalMarkerPath(entry), { force: true });
		if (nextMode === "current") {
			const manifest = await createOwnershipManifest({
				root: destination,
				workspaceRoot: entry.sourceWorkspace.workingDirectory,
				relativePath: entry.sourceWorkspace.relativePath,
				sessionId: entry.sessionId,
				instanceId: entry.instanceId,
			});
			entry.sourceWorkspace.manifest = manifest;
			await writeOwnershipManifest(entry.sourceWorkspace.manifestPath, manifest);
		}
		entry.fetchError = "";
		return entry.hero;
	} catch (error) {
		let failure = error;
		if (removeCloneOnFailure && cloneDestination) {
			try {
				await rm(cloneDestination, { recursive: true, force: true });
			} catch (cleanupError) {
				failure = new AggregateError(
					[error, cleanupError],
					`${shortError(error)} Cleanup also failed for ${cloneDestination}: ${shortError(cleanupError)}`,
				);
			}
		}
		resetGeneratedWorkspaceState(entry);
		entry.fetchError = `Could not create the generated app: ${shortError(failure)}`;
		entry.sourceWorkspace.error = shortError(failure);
		throw failure;
	} finally {
		entry.sourceWorkspace.operation = "";
		broadcast(entry, "state", snapshot(entry));
	}
}

async function ensureSourceMaterialized(entry, options = {}) {
	if (entry.sourceWorkspace.materialized) return entry.hero;
	if (!entry.sourceWorkspace.createPromise) {
		entry.sourceWorkspace.createPromise = materializeSourceWorkspace(entry, {
			mode: options.mode || entry.sourceWorkspace.mode,
			relativePath: options.relativePath || entry.sourceWorkspace.relativePath,
		}).finally(() => {
			entry.sourceWorkspace.createPromise = null;
		});
	}
	return entry.sourceWorkspace.createPromise;
}

async function startGeneratedWorkspace(entry, options = {}) {
	await ensureSourceMaterialized(entry, options);
	await initializeModelBindings(entry);
	if (entry.target === "local") await startLocalEnvironment(entry);
	return entry.hero;
}

function resetGeneratedWorkspaceState(entry) {
	entry.templateDir = "";
	entry.agentDir = "";
	entry.hero = null;
	entry.fetchPromise = null;
	entry.fetchError = "";
	entry.prompt = "";
	entry.modelBinding.initializePromise = null;
	entry.modelBinding.loading = false;
	entry.modelBinding.error = "";
	entry.modelBinding.status = "";
	entry.modelBinding.configured = false;
	entry.modelBinding.activeLabel = "";
	entry.modelBinding.activeSource = "";
	entry.modelBinding.activeResourceId = "";
	entry.modelBinding.activeModelId = "";
}

async function moveCurrentSourceWorkspace(entry, relativePath) {
	assertWorkspaceMutationAllowed(entry, "Moving the generated app");
	if (!entry.sourceWorkspace.materialized || entry.sourceWorkspace.mode !== "current") {
		throw new Error("The generated app is not in the current worktree.");
	}
	if (entry.sourceWorkspace.operation) throw new Error("A generated workspace operation is already running.");
	const selected = await assertCurrentWorkspaceDestinationSafe(
		entry.sourceWorkspace.workingDirectory,
		String(relativePath || DEFAULT_CURRENT_SUBDIR),
	);
	const source = requireTemplateDir(entry);
	if (selected.destination === source) return { dir: source };
	if (await exists(selected.destination)) {
		throw new Error(`The selected local function path already exists: ${selected.destination}`);
	}

	entry.sourceWorkspace.operation = "moving";
	entry.sourceWorkspace.error = "";
	broadcast(entry, "state", snapshot(entry));
	try {
		stopLoadTest(entry);
		stopLocal(entry);
		const currentManifest =
			entry.sourceWorkspace.manifest || (await readOwnershipManifest(entry.sourceWorkspace.manifestPath));
		if (!currentManifest) throw new Error("The ownership manifest is missing, so the generated app cannot be moved safely.");
		const nextManifest = {
			...currentManifest,
			root: selected.destination,
			workspaceRoot: selected.root,
			relativePath: selected.relative,
		};
		await moveWorkspaceDirectory(source, selected.destination);
		try {
			await writeOwnershipManifest(entry.sourceWorkspace.manifestPath, nextManifest);
		} catch (manifestError) {
			try {
				await moveWorkspaceDirectory(selected.destination, source);
			} catch (rollbackError) {
				throw new AggregateError(
					[manifestError, rollbackError],
					`The app moved but its ownership record and rollback both failed: ${shortError(manifestError)}; ${shortError(rollbackError)}`,
					{ cause: rollbackError },
				);
			}
			throw manifestError;
		}
		entry.sourceWorkspace.relativePath = selected.relative;
		entry.sourceWorkspace.destination = selected.destination;
		entry.sourceWorkspace.manifest = nextManifest;
		await configureTemplateDirectory(entry, selected.destination);
		entry.openStatus = `Moved local function to ${selected.relative}`;
		return { dir: selected.destination };
	} catch (error) {
		entry.sourceWorkspace.error = shortError(error);
		throw error;
	} finally {
		entry.sourceWorkspace.operation = "";
		broadcast(entry, "state", snapshot(entry));
	}
}

async function moveSourceWorkspaceToIsolated(entry) {
	assertWorkspaceMutationAllowed(entry, "Moving the generated app");
	if (!entry.sourceWorkspace.materialized || entry.sourceWorkspace.mode !== "current") {
		throw new Error("The generated app is not in the current worktree.");
	}
	if (entry.sourceWorkspace.operation) throw new Error("A generated workspace operation is already running.");
	entry.sourceWorkspace.operation = "moving";
	entry.sourceWorkspace.error = "";
	broadcast(entry, "state", snapshot(entry));
	try {
		stopLoadTest(entry);
		stopLocal(entry);
		const source = requireTemplateDir(entry);
		const destination = isolatedTemplateDirectory(entry);
		await moveWorkspaceDirectory(source, destination);
		await deleteOwnershipManifest(entry.sourceWorkspace.manifestPath);
		entry.sourceWorkspace.mode = "isolated";
		entry.sourceWorkspace.destination = destination;
		entry.sourceWorkspace.manifest = null;
		await configureTemplateDirectory(entry, destination);
		entry.openStatus = `Moved generated app to ${destination}`;
		return { dir: destination };
	} catch (error) {
		entry.sourceWorkspace.error = shortError(error);
		throw error;
	} finally {
		entry.sourceWorkspace.operation = "";
		broadcast(entry, "state", snapshot(entry));
	}
}

async function removeCurrentSourceWorkspace(entry) {
	assertWorkspaceMutationAllowed(entry, "Removing the generated app");
	if (!entry.sourceWorkspace.materialized || entry.sourceWorkspace.mode !== "current") {
		throw new Error("There is no Studio-owned app in the current worktree to remove.");
	}
	if (entry.sourceWorkspace.operation) throw new Error("A generated workspace operation is already running.");
	entry.sourceWorkspace.operation = "removing";
	entry.sourceWorkspace.error = "";
	broadcast(entry, "state", snapshot(entry));
	try {
		stopLoadTest(entry);
		stopLocal(entry);
		const manifest =
			entry.sourceWorkspace.manifest || (await readOwnershipManifest(entry.sourceWorkspace.manifestPath));
		if (!manifest) throw new Error("The ownership manifest is missing, so nothing was removed.");
		await assertCurrentWorkspaceDestinationSafe(manifest.workspaceRoot, manifest.relativePath);
		await removeOwnedWorkspace(requireTemplateDir(entry), manifest);
		await deleteOwnershipManifest(entry.sourceWorkspace.manifestPath);
		await writeFile(sourceRemovalMarkerPath(entry), "Removed by the user. Create from the Studio to restore.\n", {
			mode: 0o600,
		});
		resetGeneratedWorkspaceState(entry);
		entry.sourceWorkspace.materialized = false;
		entry.sourceWorkspace.autoCreate = false;
		entry.sourceWorkspace.destination = resolveCurrentWorkspaceDestination(
			entry.sourceWorkspace.workingDirectory,
			entry.sourceWorkspace.relativePath,
		).destination;
		entry.sourceWorkspace.manifest = null;
		entry.openStatus = "Removed the unchanged Studio-generated app from the current worktree.";
		return { ok: true };
	} catch (error) {
		entry.sourceWorkspace.error = shortError(error);
		throw error;
	} finally {
		entry.sourceWorkspace.operation = "";
		broadcast(entry, "state", snapshot(entry));
	}
}

async function syncInstructionsFromDisk(entry) {
	await ensureAgentResponseLogging(entry);
	const timerPath = path.join(requireTemplateDir(entry), HERO_TEMPLATE.timerAgentRelPath);
	const httpPath = path.join(requireTemplateDir(entry), HERO_TEMPLATE.httpAgentRelPath);
	const raw = await readFile(timerPath, "utf8");
	const prompt = stripFrontmatter(raw);
	const currentSkillName = skillNameOf(raw);
	const httpContent = httpTwinContent(prompt, currentSkillName);
	const currentHttp = (await exists(httpPath)) ? await readFile(httpPath, "utf8") : "";
	if (currentHttp !== httpContent) await writeFile(httpPath, httpContent);
	await syncGeneratedTriggerFiles(entry, prompt, currentSkillName);
	entry.prompt = prompt;
	if (entry.hero) entry.hero.title = currentSkillName;
	await loadTimerSchedule(entry);
	return entry.hero;
}

async function ensureTemplate(entry) {
	if (!entry.sourceWorkspace.materialized || !entry.templateDir) {
		throw new Error("Create the generated app in the current worktree or an isolated workspace first.");
	}
	return entry.hero ? syncInstructionsFromDisk(entry) : configureTemplateDirectory(entry, entry.sourceWorkspace.destination);
}

function requireTemplateDir(entry) {
	if (!entry.templateDir) throw new Error("Template not fetched yet - wait for the initial clone to finish.");
	return entry.templateDir;
}

// Save instructions: writes the same body into the Timer agent file
// (preserving its own front matter) and regenerates the HTTP twin so both
// stay in sync with the canonical instructions text.
async function saveInstructions(entry, bodyText) {
	const dir = requireTemplateDir(entry);
	const timerPath = path.join(dir, HERO_TEMPLATE.timerAgentRelPath);
	const httpPath = path.join(dir, HERO_TEMPLATE.httpAgentRelPath);
	const clean = bodyText.trim() || entry.prompt;
	await writeAgentBody(timerPath, clean);
	await writeFile(httpPath, httpTwinContent(clean, entry.hero?.title || "Hosted skill"));
	await syncGeneratedTriggerFiles(entry, clean, entry.hero?.title || "Hosted skill");
	entry.prompt = clean;
	broadcast(entry, "state", snapshot(entry));
}

// --- LOCAL: real Azure Functions Core Tools (`func start`) against the
// working copy. No mocked host, no fabricated readiness - if a prerequisite
// is missing, we say so and stop.

// Decide how this run will get a >=3.13 Python: prefer `uv` (it can install
// and pin an exact Python version itself, so it never falls back to
// whatever `python3` happens to resolve to on PATH), otherwise fall back to
// a verified system/override interpreter. Never returns a interpreter below
// 3.13 - the caller must treat a thrown error as "cannot proceed", not fall
// through to an unverified `python3`.
async function resolvePythonProvisioning(entry) {
	const uvProbe = await execFileText("uv", ["--version"]).catch((error) => ({ error }));
	if (!uvProbe.error) {
		entry.local.uvVersion = uvProbe.stdout.trim();
		entry.local.pythonProvider = "uv";
		return { provider: "uv", detail: `${entry.local.uvVersion} (will provision Python ${MIN_PYTHON_LABEL})` };
	}
	entry.local.uvVersion = "";
	const system = await resolveSystemPython();
	if (!system) {
		throw new Error(
			`No Python ${MIN_PYTHON_LABEL}+ interpreter found, and \`uv\` is not on PATH. ` +
				`Install uv (preferred, it can provision Python ${MIN_PYTHON_LABEL} for you): ${UV_DOCS_URL} ` +
				`- or install Python ${MIN_PYTHON_LABEL}+ yourself: ${PYTHON_DOCS_URL}. ` +
				`The serverless agents runtime (azurefunctions-agents-runtime) requires Python ${MIN_PYTHON_LABEL}+; ` +
				`an older system \`python3\` (for example macOS's bundled 3.9) will not work and is never used automatically.`,
		);
	}
	entry.local.pythonProvider = "system";
	entry.local.pythonBin = system.bin;
	return { provider: "system", bin: system.bin, detail: `${system.text} (${system.source})` };
}

// --- DOCTOR: a fast, read-only readiness sweep over every local dependency
// this canvas needs. Every probe here is a version/existence/sign-in check
// only - nothing here starts a process, writes a file, or touches an Azure
// resource, so it's always safe to re-run. Checks that only need the local
// filesystem/PATH (uv, python, func, node, azurite) run first and resolve in
// well under a second; the two Azure CLI checks (`az version`, `az account
// show`) are the only ones that can involve any I/O and are listed last so a
// slow/offline network never blocks the fast local diagnosis from showing.

// Read-only mirror of bootstrap-extension.mjs's own check: is
// ~/.copilot/extensions/intelligent-function-app-studio actually linked
// somewhere real? Never writes or repairs anything itself - the real fix
// (re-running bootstrap-extension.mjs) is documented in the fix text and
// already happens automatically via SKILL.md's retry flow. A destination
// that resolves to a *different* real plugin copy (for example, a separate
// installed-plugins checkout vs. a dev worktree) is reported as informational
// detail, not an error - only a missing/broken link is flagged.
function checkExtensionRegistration() {
	const copilotHome = process.env.COPILOT_HOME || path.join(homedir(), ".copilot");
	const destination = path.join(copilotHome, "extensions", "intelligent-function-app-studio");
	const pluginRoot = path.dirname(fileURLToPath(import.meta.url));
	try {
		if (!existsSync(destination)) return { registered: false, detail: `not linked yet at ${destination}` };
		const stats = lstatSync(destination);
		if (!stats.isSymbolicLink() && !stats.isDirectory()) {
			return { registered: false, detail: `unexpected non-link path at ${destination}` };
		}
		const resolvedDestination = realpathSync(destination);
		const resolvedRoot = realpathSync(pluginRoot);
		if (resolvedDestination === resolvedRoot) return { registered: true, detail: destination };
		// Linked, just to a different real copy than the one currently
		// running (normal for a dev worktree) - not broken, just worth noting.
		return { registered: true, detail: `${destination} -> ${resolvedDestination} (this session is running from ${resolvedRoot})` };
	} catch (error) {
		return { registered: false, detail: shortError(error) };
	}
}

async function runDoctor(entry) {
	const checks = [];

	const uvProbe = await execFileText("uv", ["--version"]).catch((error) => ({ error }));
	const uvReady = !uvProbe.error;
	checks.push(
		uvReady
			? { id: "uv", label: "uv (Python provisioner)", status: "ready", detail: uvProbe.stdout.trim(), fix: "", required: false }
			: {
					id: "uv",
					label: "uv (Python provisioner)",
					status: "missing",
					detail: "not found on PATH",
					fix: `Preferred but optional - installs and pins Python ${MIN_PYTHON_LABEL} automatically: ${UV_DOCS_URL}`,
					required: false,
				},
	);

	if (uvReady) {
		checks.push({
			id: "python",
			label: `Python ${MIN_PYTHON_LABEL}+`,
			status: "ready",
			detail: `uv will provision Python ${MIN_PYTHON_LABEL} on demand`,
			fix: "",
			required: true,
		});
	} else {
		try {
			const system = await resolveSystemPython();
			checks.push(
				system
					? {
							id: "python",
							label: `Python ${MIN_PYTHON_LABEL}+`,
							status: "ready",
							detail: `${system.text} (${system.source})`,
							fix: "",
							required: true,
						}
					: {
							id: "python",
							label: `Python ${MIN_PYTHON_LABEL}+`,
							status: "stale",
							detail: "No interpreter on PATH meets the minimum version (a stale system python3, e.g. macOS's bundled 3.9, is never used automatically)",
							fix: `Install uv (preferred): ${UV_DOCS_URL} - or install Python ${MIN_PYTHON_LABEL}+ yourself: ${PYTHON_DOCS_URL}`,
							required: true,
						},
			);
		} catch (error) {
			checks.push({
				id: "python",
				label: `Python ${MIN_PYTHON_LABEL}+`,
				status: "error",
				detail: shortError(error),
				fix: `Fix ${PYTHON_OVERRIDE_ENV} or install a valid interpreter: ${PYTHON_DOCS_URL}`,
				required: true,
			});
		}
	}

	const func = await execFileText("func", ["--version"]).catch((error) => ({ error }));
	checks.push(
		func.error
			? {
					id: "core-tools",
					label: "Azure Functions Core Tools v4",
					status: "missing",
					detail: "not found on PATH",
					fix: `Install it: ${CORE_TOOLS_DOCS_URL}`,
					required: true,
				}
			: {
					id: "core-tools",
					label: "Azure Functions Core Tools v4",
					status: func.stdout.trim().startsWith("4") ? "ready" : "stale",
					detail: func.stdout.trim(),
					fix: func.stdout.trim().startsWith("4") ? "" : `Core Tools v4 is required. Reinstall: ${CORE_TOOLS_DOCS_URL}`,
					required: true,
				},
	);

	const node = await execFileText("node", ["--version"]).catch((error) => ({ error }));
	checks.push(
		node.error
			? {
					id: "node",
					label: "Node.js",
					status: "missing",
					detail: "not found on PATH (Core Tools itself runs on Node, so a missing/broken Node often shows up as a confusing Core Tools failure)",
					fix: "Install Node.js LTS: https://nodejs.org/",
					required: true,
				}
			: { id: "node", label: "Node.js", status: "ready", detail: node.stdout.trim(), fix: "", required: true },
	);

	const ports = [10000, 10001, 10002];
	const busy = await Promise.all(ports.map(portListening));
	if (busy.every(Boolean)) {
		checks.push({
			id: "azurite",
			label: "Azurite (storage emulator)",
			status: "ready",
			detail: "Already listening on 10000-10002",
			fix: "",
			required: false,
		});
	} else {
		const azurite = await execFileText("azurite", ["--version"]).catch((error) => ({ error }));
		checks.push(
			azurite.error
				? {
						id: "azurite",
						label: "Azurite (storage emulator)",
						status: "missing",
						detail: "not found on PATH - only needed locally for the Timer trigger's schedule store, not for HTTP-only runs",
						fix: "npm install -g azurite",
						required: false,
					}
				: {
						id: "azurite",
						label: "Azurite (storage emulator)",
						status: "ready",
						detail: `${azurite.stdout.trim()} (not currently running - Start Local will launch it)`,
						fix: "",
						required: false,
					},
		);
	}

	const az = await execFileText("az", ["version", "-o", "json"], { env: azureCliChildEnv(), timeout: 15000 }).catch(
		(error) => ({ error }),
	);
	checks.push(
		az.error
			? {
					id: "az-cli",
					label: "Azure CLI (az)",
					status: "missing",
					detail: "not found on PATH",
					fix: "Install the Azure CLI: https://learn.microsoft.com/cli/azure/install-azure-cli",
					required: true,
				}
			: {
					id: "az-cli",
					label: "Azure CLI (az)",
					status: "ready",
					detail: (() => {
						try {
							return JSON.parse(az.stdout)["azure-cli"] ? `azure-cli ${JSON.parse(az.stdout)["azure-cli"]}` : "installed";
						} catch {
							return "installed";
						}
					})(),
					fix: "",
					required: true,
				},
	);

	// Read-only, no new login flow: recognizes an existing `az login` done in
	// the user's own terminal (or fails clearly if there truly isn't one).
	const login = await checkAzureLogin(true);
	checks.push(
		login.loggedIn
			? {
					id: "az-login",
					label: "Azure CLI sign-in",
					status: "ready",
					detail: login.user ? `Signed in as ${login.user}` : `Signed in (${login.account})`,
					fix: "",
					required: true,
				}
			: {
					id: "az-login",
					label: "Azure CLI sign-in",
					status: "missing",
					detail: login.error || "Not signed in",
					fix: "Run `az login` in a terminal, then use Recheck - this canvas never opens a login flow for you.",
					required: true,
				},
	);

	const doctorSubscription =
		entry.modelBinding.subscription ||
		entry.azure.subscription ||
		(login.loggedIn ? (await listSubscriptions().catch(() => []))[0]?.id : "");
	if (doctorSubscription) {
		try {
			const gateways = await listGateways(armClient, doctorSubscription);
			checks.push({
				id: "ai-gateway-arm",
				label: "AI Gateway management API",
				status: "ready",
				detail: `Direct ARM access is available; ${gateways.length} gateway(s) found.`,
				fix: "",
				required: false,
			});
		} catch (error) {
			const capability = classifyGatewayArmError(error);
			checks.push({
				id: "ai-gateway-arm",
				label: "AI Gateway management API",
				status: capability.status,
				detail: capability.detail,
				fix: capability.error,
				required: false,
			});
		}
	} else {
		checks.push({
			id: "ai-gateway-arm",
			label: "AI Gateway management API",
			status: "missing",
			detail: "No enabled subscription is available for a read-only ARM probe.",
			fix: "Sign in with Azure CLI and select an enabled subscription. Foundry-only use remains available.",
			required: false,
		});
	}

	// Not required for local Timer/HTTP invoke, but needed for Create Models
	// and Deploy to Azure (both run `azd`). Listed as optional so a missing
	// azd never blocks the "ready" state for a purely local run.
	const azd = await execFileText("azd", ["version"]).catch((error) => ({ error }));
	checks.push(
		azd.error
			? {
					id: "azd",
					label: "Azure Developer CLI (azd)",
					status: "missing",
					detail: "not found on PATH - only needed for Create Models and Deploy to Azure, not for local Timer/HTTP invoke",
					fix: `Install it: ${AZD_DOCS_URL}`,
					required: false,
				}
			: { id: "azd", label: "Azure Developer CLI (azd)", status: "ready", detail: azd.stdout.trim(), fix: "", required: false },
	);

	// Informational only: never blocks "ready". If a session opens this
	// canvas before the plugin is linked, SKILL.md-driven tooling reruns
	// bootstrap-extension.mjs and retries automatically - this just makes
	// that recovery path visible instead of silent.
	const registration = checkExtensionRegistration();
	checks.push(
		registration.registered
			? {
					id: "extension-registration",
					label: "Canvas extension registration",
					status: "ready",
					detail: `Linked at ${registration.detail}`,
					fix: "",
					required: false,
				}
			: {
					id: "extension-registration",
					label: "Canvas extension registration",
					status: "missing",
					detail: registration.detail,
					fix: "Normally auto-fixed: opening this canvas re-runs bootstrap-extension.mjs and retries once. If it still shows missing, run `node bootstrap-extension.mjs` from this plugin's folder yourself, then reload extensions.",
					required: false,
				},
	);

	entry.doctor = {
		ranAt: Date.now(),
		checks,
		ready: checks.every((check) => !check.required || check.status === "ready"),
	};
	broadcast(entry, "state", snapshot(entry));
	return entry.doctor;
}

async function checkLocalPrereqs(entry) {
	const c1 = cmdStart(entry, {
		kind: "shell",
		title: "func --version",
		cmd: "func --version",
		purpose: "Detect Azure Functions Core Tools v4 (required to run the agent locally)",
	});
	try {
		const { stdout } = await execFileText("func", ["--version"]);
		entry.local.funcVersion = stdout.trim();
		cmdEnd(entry, c1, { ok: true, note: entry.local.funcVersion });
	} catch (error) {
		cmdEnd(entry, c1, { ok: false, note: "not found" });
		throw new Error(
			`Azure Functions Core Tools v4 not found on PATH. Install it, then retry: ${CORE_TOOLS_DOCS_URL}`,
			{ cause: error },
		);
	}

	const c2 = cmdStart(entry, {
		kind: "shell",
		title: "uv --version (preferred Python provisioner)",
		cmd: "uv --version",
		purpose: `Detect uv, the preferred way to provision an isolated Python ${MIN_PYTHON_LABEL} for the agent runtime`,
	});
	try {
		const provisioning = await resolvePythonProvisioning(entry);
		if (provisioning.provider === "uv") {
			cmdEnd(entry, c2, { ok: true, note: provisioning.detail });
		} else {
			cmdEnd(entry, c2, { ok: false, note: "not found - falling back to a verified system interpreter" });
		}
		entry.local.pythonVersion = provisioning.detail;
	} catch (error) {
		cmdEnd(entry, c2, { ok: false, note: "not found" });
		throw error;
	}
}

// Timer schedule state and Queue messages both use the app's default
// AzureWebJobsStorage binding. Locally that is Azurite. We start it for every
// local host so trigger switching never races missing storage.
async function ensureAzurite(entry, ensureCurrent = () => {}) {
	const ports = [10000, 10001, 10002];
	const busy = await Promise.all(ports.map(portListening));
	if (busy.every(Boolean)) {
		entry.local.azuriteNote = "Reusing a storage emulator already listening on 10000-10002";
		return;
	}
	if (busy.some(Boolean)) {
		throw new Error(
			"Ports 10000-10002 are partially in use by another process. Free them (or stop the other service) and retry.",
		);
	}

	const c1 = cmdStart(entry, {
		kind: "shell",
		title: "azurite --version",
		cmd: "azurite --version",
		purpose: "Detect the Azurite storage emulator used by Timer state and Queue messages",
	});
	try {
		const { stdout } = await execFileText("azurite", ["--version"]);
		cmdEnd(entry, c1, { ok: true, note: stdout.trim() });
	} catch (error) {
		cmdEnd(entry, c1, { ok: false, note: "not found" });
		throw new Error("Azurite not found on PATH. Install it: npm install -g azurite, then retry.", { cause: error });
	}

	const dataDir = path.join(entry.templateDir, ".azurite");
	await mkdir(dataDir, { recursive: true });
	const cmdText = `azurite --silent --location ${dataDir} --skipApiVersionCheck`;
	const c2 = cmdStart(entry, {
		kind: "shell",
		title: "azurite (start)",
		cmd: cmdText,
		purpose: "Start the local storage emulator used by Timer and Queue triggers",
	});
	ensureCurrent();
	const azuriteInvocation = commandInvocation("azurite", ["--silent", "--location", dataDir, "--skipApiVersionCheck"]);
	const child = spawn(azuriteInvocation.executable, azuriteInvocation.args, {
		stdio: ["ignore", "pipe", "pipe"],
		detached: process.platform !== "win32",
		windowsVerbatimArguments: azuriteInvocation.windowsVerbatimArguments,
	});
	entry.local.azuriteProc = child;
	child.once("exit", (code, signal) => {
		if (entry.local.azuriteProc !== child) return;
		entry.local.azuriteProc = null;
		if (entry.local.status === "starting" || entry.local.status === "running") {
			if (entry.local.funcProc) {
				terminateChild(entry.local.funcProc);
				entry.local.funcProc = null;
			}
			entry.local.status = "error";
			entry.local.error = `Azurite exited${code == null ? "" : ` with code ${code}`}${signal ? ` (${signal})` : ""}.`;
			entry.local.port = null;
			entry.local.functions = [];
			broadcast(entry, "state", snapshot(entry));
		}
	});
	await new Promise((resolve, reject) => {
		let done = false;
		const onData = (buf) => {
			if (done) return;
			if (/successfully listening/i.test(buf.toString())) {
				done = true;
				cmdEnd(entry, c2, { ok: true, note: "listening on 10000-10002" });
				resolve();
			}
		};
		child.stdout.on("data", onData);
		child.stderr.on("data", onData);
		child.once("error", (err) => {
			if (done) return;
			done = true;
			cmdEnd(entry, c2, { ok: false, note: shortError(err) });
			reject(err);
		});
		child.once("exit", (code) => {
			if (done) return;
			done = true;
			const error = new Error(`Azurite exited before startup completed${code == null ? "" : ` with code ${code}`}.`);
			cmdEnd(entry, c2, { ok: false, note: error.message });
			reject(error);
		});
		setTimeout(() => {
			if (done) return;
			done = true;
			cmdEnd(entry, c2, { ok: true, note: "started" });
			resolve();
		}, 4000);
	});
}

async function ensureRuntimeRequirement(entry) {
	const reqPath = path.join(entry.agentDir, "requirements.txt");
	const current = await readFile(reqPath, "utf8");
	const next = current.replace(
		/^azurefunctions-agents-runtime(?:\s*[<>=!~].*)?\s*$/m,
		`azurefunctions-agents-runtime==${RUNTIME_VERSION}`,
	);
	if (next !== current) await writeFile(reqPath, next);
}

async function ensureVenv(entry) {
	const venvDir = path.join(entry.agentDir, ".venv");
	const venvPython = path.join(venvDir, "bin", "python3");
	const marker = path.join(venvDir, ".copilot-installed");
	const reqPath = path.join(entry.agentDir, "requirements.txt");
	await ensureRuntimeRequirement(entry);
	const reqText = await readFile(reqPath, "utf8").catch(() => "");
	const reqHash = createHash("sha256").update(reqText).digest("hex").slice(0, 16);

	const provisioning = await resolvePythonProvisioning(entry);

	if (await exists(venvPython)) {
		// A .venv created before this canvas enforced Python 3.13 (or one that
		// otherwise points at a stale interpreter) must never be silently
		// reused - that is exactly how a consumer ends up with pip's
		// confusing "no matching distribution" error against the wrong
		// Python. Verify it and rebuild rather than trust its mere presence.
		const probe = await probePythonBin(venvPython);
		if (!probe.ok) {
			const c0 = cmdStart(entry, {
				kind: "shell",
				title: "rebuild .venv (stale Python)",
				cmd: `rm -rf ${venvDir}`,
				purpose:
					`The existing .venv uses ${probe.text || "an unknown/broken Python"}, below the Python ${MIN_PYTHON_LABEL} ` +
					"the serverless agents runtime requires - removing it so it gets rebuilt with a verified interpreter",
			});
			await rm(venvDir, { recursive: true, force: true });
			cmdEnd(entry, c0, { ok: true });
		}
	}

	if (!(await exists(venvPython))) {
		if (provisioning.provider === "uv") {
			const c = cmdStart(entry, {
				kind: "shell",
				title: `uv venv --python ${MIN_PYTHON_LABEL} .venv`,
				cmd: `uv venv --python ${MIN_PYTHON_LABEL} .venv`,
				purpose: `Ask uv to provision Python ${MIN_PYTHON_LABEL} (downloading it if needed) and create the agent's virtual environment`,
			});
			try {
				await execFileText("uv", ["venv", "--python", MIN_PYTHON_LABEL, ".venv"], {
					cwd: entry.agentDir,
					timeout: 5 * 60 * 1000,
					env: { ...process.env, ...(await uvIndexEnv()) },
				});
				cmdEnd(entry, c, { ok: true });
			} catch (error) {
				cmdEnd(entry, c, { ok: false, note: shortError(error) });
				throw error;
			}
		} else {
			const c = cmdStart(entry, {
				kind: "shell",
				title: `${provisioning.bin} -m venv .venv`,
				cmd: `${provisioning.bin} -m venv .venv`,
				purpose: "Create an isolated virtual environment for the agent's Python dependencies",
			});
			try {
				await execFileText(provisioning.bin, ["-m", "venv", ".venv"], { cwd: entry.agentDir });
				cmdEnd(entry, c, { ok: true });
			} catch (error) {
				cmdEnd(entry, c, { ok: false, note: shortError(error) });
				throw error;
			}
		}
	}

	let installedHash = "";
	try {
		installedHash = (await readFile(marker, "utf8")).trim();
	} catch {
		/* not installed yet */
	}
	if (installedHash === reqHash && reqHash) return;

	if (provisioning.provider === "uv") {
		const c2 = cmdStart(entry, {
			kind: "shell",
			title: "uv pip install -r requirements.txt",
			cmd: `uv pip install --python ${venvPython} -r requirements.txt`,
			purpose: "Install the template's Python dependencies (azurefunctions-agents-runtime, azure-identity, ...) with uv",
		});
		try {
			await execFileText("uv", ["pip", "install", "--python", venvPython, "-q", "-r", "requirements.txt"], {
				cwd: entry.agentDir,
				timeout: 5 * 60 * 1000,
				maxBuffer: 8 * 1024 * 1024,
				env: { ...process.env, ...(await uvIndexEnv()) },
			});
			await writeFile(marker, reqHash);
			cmdEnd(entry, c2, { ok: true });
		} catch (error) {
			cmdEnd(entry, c2, { ok: false, note: shortError(error) });
			throw error;
		}
		return;
	}

	const pip = path.join(venvDir, "bin", "pip");
	const c2 = cmdStart(entry, {
		kind: "shell",
		title: "pip install -r requirements.txt",
		cmd: `${pip} install -r requirements.txt`,
		purpose: "Install the template's Python dependencies (azurefunctions-agents-runtime, azure-identity, ...)",
	});
	try {
		await execFileText(pip, ["install", "-q", "-r", "requirements.txt"], {
			cwd: entry.agentDir,
			timeout: 5 * 60 * 1000,
			maxBuffer: 8 * 1024 * 1024,
		});
		await writeFile(marker, reqHash);
		cmdEnd(entry, c2, { ok: true });
	} catch (error) {
		cmdEnd(entry, c2, { ok: false, note: shortError(error) });
		throw error;
	}
}

function parseFuncFunctionLines(logText) {
	// `func start` prints a "Functions:" block like:
	//   daily_repo_digest_http: [POST] http://localhost:7071/digest
	//   daily_repo_digest: timerTrigger
	//   daily_repo_digest_queue: queueTrigger
	//   daily_repo_digest_m365_inbox: connectorTrigger
	const functions = [];
	const lines = logText.split(/\r?\n/);
	let inBlock = false;
	let pendingName = "";
	for (const raw of lines) {
		const line = raw.trim();
		if (/^Functions:\s*$/.test(line)) {
			inBlock = true;
			continue;
		}
		if (!inBlock) continue;
		if (!line) continue;
		if (/^For detailed output/.test(line)) break;
		const nameOnly = /^([\w-]+):\s*$/.exec(line);
		if (nameOnly) {
			pendingName = nameOnly[1];
			continue;
		}
		if (pendingName) {
			const routeMatch = /\[(\w+)\]\s+(http\S+)/.exec(line);
			if (routeMatch) {
				functions.push({ name: pendingName, kind: "http", route: routeMatch[2] });
				pendingName = "";
				continue;
			}
		}
		const m = /^([\w-]+):\s*(.+)$/.exec(line);
		if (!m) continue;
		const [, name, rest] = m;
		pendingName = "";
		const routeMatch = /\[(\w+)\]\s+(http\S+)/.exec(rest);
		functions.push({
			name,
			kind: routeMatch
				? "http"
				: /timerTrigger/i.test(rest)
					? "timer"
					: /queueTrigger/i.test(rest)
						? "queue"
						: /connectorTrigger/i.test(rest)
							? "connector"
							: "other",
			route: routeMatch ? routeMatch[2] : null,
		});
	}
	return functions;
}

async function startFuncHost(entry) {
	const venvBin = path.join(entry.agentDir, ".venv", "bin");
	const portLease = await localPortReservations.reserve(7071);
	const port = portLease.port;
	let portReleased = false;
	const releasePort = () => {
		if (portReleased) return;
		portReleased = true;
		portLease.release();
	};
	const cmdText = `func start --port ${port}`;
	const c = cmdStart(entry, {
		kind: "shell",
		title: "func start",
		cmd: cmdText,
		purpose: "Start the Azure Functions host for this working copy",
	});
	const env = {
		...process.env,
		PATH: `${venvBin}:${process.env.PATH}`,
		AzureWebJobsStorage: "UseDevelopmentStorage=true",
	};
	const funcInvocation = commandInvocation("func", ["start", "--port", String(port)], env);
	const child = spawn(funcInvocation.executable, funcInvocation.args, {
		cwd: entry.agentDir,
		env,
		stdio: ["ignore", "pipe", "pipe"],
		detached: process.platform !== "win32",
		windowsVerbatimArguments: funcInvocation.windowsVerbatimArguments,
	});
	entry.local.funcProc = child;
	entry.local.port = port;
	entry.local.logTail = [];
	entry.local.logSequence = 0;
	entry.local.logEvents = [];
	finalizeRunningInvocations(entry, "Local function host restarted before this execution completed.");
	entry.local.functions = [];
	entry.local.status = "starting";
	let stdoutText = "";
	let stderrText = "";
	const lineBuffers = { stdout: "", stderr: "" };

	const appendLog = (buf, stream) => {
		if (stream === "stdout") stdoutText += buf.toString();
		else stderrText += buf.toString();
		const lines = `${lineBuffers[stream]}${buf.toString()}`.split(/\r?\n/);
		lineBuffers[stream] = lines.pop() || "";
		for (const line of lines) {
			if (!line.trim()) continue;
			entry.local.logTail.push(line);
			if (entry.local.logTail.length > 150) entry.local.logTail.shift();
			const sequence = ++entry.local.logSequence;
			entry.local.logEvents.push({ sequence, line });
			if (entry.local.logEvents.length > 300) entry.local.logEvents.shift();
			processLocalInvocationLog(entry, line, sequence);
		}
		entry.local.functions = parseFuncFunctionLines(`${stdoutText}\n${stderrText}`);
		broadcast(entry, "state", snapshot(entry));
	};
	child.stdout.on("data", (buf) => appendLog(buf, "stdout"));
	child.stderr.on("data", (buf) => appendLog(buf, "stderr"));
	child.once("exit", releasePort);
	child.once("error", releasePort);

	const ready = await new Promise((resolve) => {
		let settled = false;
		const check = () => {
			if (!settled && entry.local.functions.some((fn) => fn.kind === entry.trigger)) {
				settled = true;
				resolve(true);
			}
		};
		child.stdout.on("data", check);
		child.stderr.on("data", check);
		child.once("exit", (code) => {
			entry.local.exitCode = code;
			if (entry.local.funcProc === child) {
				entry.local.funcProc = null;
				finalizeRunningInvocations(entry, `Local function host exited with code ${code} before this execution completed.`);
				if (entry.local.status === "running") {
					entry.local.status = "error";
					entry.local.error = `Local function host exited with code ${code}.`;
					entry.local.port = null;
					entry.local.functions = [];
					broadcast(entry, "state", snapshot(entry));
				}
			}
			if (!settled) {
				settled = true;
				resolve(false);
			}
		});
		setTimeout(() => {
			if (!settled) {
				settled = true;
				resolve(entry.local.functions.some((fn) => fn.kind === entry.trigger));
			}
		}, 25000);
	});

	if (!ready) {
		cmdEnd(entry, c, { ok: false, note: "func start did not report ready in time" });
		entry.local.status = "error";
		entry.local.error = "func start did not become ready within 25s. Check the local host log below.";
		broadcast(entry, "state", snapshot(entry));
		throw new Error(entry.local.error);
	}

	// The "Functions:" log line can print a beat before the host's HTTP listener
	// actually accepts connections. Confirm real TCP reachability before calling
	// it running, so the first Invoke never races a not-yet-open port.
	let reachable = false;
	for (let i = 0; i < 20; i++) {
		if (await portListening(port)) {
			reachable = true;
			break;
		}
		await new Promise((r) => setTimeout(r, 250));
	}
	if (!reachable) {
		cmdEnd(entry, c, { ok: false, note: "port never accepted connections" });
		entry.local.status = "error";
		entry.local.error = `func start printed its function list but 127.0.0.1:${port} never accepted a connection.`;
		broadcast(entry, "state", snapshot(entry));
		throw new Error(entry.local.error);
	}

	cmdEnd(entry, c, { ok: true, note: `listening on 127.0.0.1:${port}` });
	releasePort();
	entry.local.status = "running";
	entry.local.error = "";
	broadcast(entry, "state", snapshot(entry));
}

function startLocalEnvironment(entry) {
	if (entry.local.status === "running") return Promise.resolve();
	if (entry.local.startPromise) return entry.local.startPromise;
	if (entry.deployment.status === "preparing") {
		return Promise.reject(new Error("Wait for the isolated deployment snapshot to finish, then start the local function."));
	}
	if (!entry.modelBinding.configured) {
		return initializeModelBindings(entry).then(() => {
			if (!entry.modelBinding.configured) {
				throw new Error("Select an existing Microsoft Foundry or AI Gateway model before starting locally.");
			}
			return startLocalEnvironment(entry);
		});
	}
	const generation = ++entry.local.startGeneration;
	const ensureCurrent = () => {
		if (generation !== entry.local.startGeneration) throw new Error("Local startup cancelled.");
	};
	entry.local.startPromise = (async () => {
		entry.local.status = "starting";
		entry.local.error = "";
		broadcast(entry, "state", snapshot(entry));
		try {
			await ensureTemplate(entry);
			ensureCurrent();
			await ensureGatewayProviderFiles(
				entry,
				entry.modelBinding.activeSource === "gateway" ? "gateway" : "public",
			);
			if (entry.modelBinding.activeSource === "foundry") await ensureLocalFoundryRuntimeSettings(entry);
			await assertLocalQueueStorageSafe(entry);
			ensureCurrent();
			await checkLocalPrereqs(entry);
			ensureCurrent();
			await ensureAzurite(entry, ensureCurrent);
			ensureCurrent();
			await ensureVenv(entry);
			ensureCurrent();
			await startFuncHost(entry);
			startFoundryTokenRefresh(entry);
		} catch (error) {
			const cancelled = generation !== entry.local.startGeneration;
			stopLocal(entry);
			if (cancelled) throw error;
			entry.local.status = "error";
			entry.local.error = shortError(error) || String(error?.message || error);
			broadcast(entry, "state", snapshot(entry));
			throw error;
		}
	})().finally(() => {
		entry.local.startPromise = null;
	});
	return entry.local.startPromise;
}

async function restartLocalEnvironment(entry) {
	if (entry.local.startPromise) {
		try {
			await entry.local.startPromise;
		} catch {
			/* The restart below retries after the failed startup. */
		}
	}
	stopLocal(entry);
	return startLocalEnvironment(entry);
}

function stopLocal(entry) {
	entry.local.startGeneration += 1;
	stopFoundryTokenRefresh(entry);
	finalizeRunningInvocations(entry, "Local function host was stopped before this execution completed.");
	if (entry.local.funcProc) {
		const child = entry.local.funcProc;
		terminateChild(child);
		setTimeout(() => {
			if (child.exitCode !== null) return;
			terminateChild(child, "SIGKILL");
		}, 1500).unref();
		entry.local.funcProc = null;
	}
	if (entry.local.azuriteProc) {
		const child = entry.local.azuriteProc;
		terminateChild(child);
		setTimeout(() => {
			if (child.exitCode !== null) return;
			terminateChild(child, "SIGKILL");
		}, 1500).unref();
		entry.local.azuriteProc = null;
	}
	entry.local.status = "stopped";
	entry.local.port = null;
	entry.local.functions = [];
	broadcast(entry, "state", snapshot(entry));
}

async function invokeLocal(entry, trigger, promptOverride) {
	if (entry.local.status !== "running") throw new Error("Start the local function host first.");
	const base = `http://127.0.0.1:${entry.local.port}`;

	if (trigger === "queue") return invokeLocalQueue(entry, promptOverride);
	if (trigger === "connector") return invokeLocalM365Inbox(entry, base, promptOverride);
	if (trigger === "timer") {
		// Manual Timer tests use the generated HTTP twin: it has the same
		// instructions, model, and tools, but returns the actual agent output.
		// The Functions Timer admin endpoint only returns 202 and may recycle
		// the worker before publishing a completion event.
		return invokeLocalHttp(entry, base, trigger, promptOverride, true);
	}

	return invokeLocalHttp(entry, base, trigger, promptOverride, false);
}

async function invokeLocalQueue(entry, messageOverride) {
	const fn = entry.local.functions.find((candidate) => candidate.kind === "queue");
	if (!fn) throw new Error("No Queue-triggered hosted skill is registered on the local host yet.");
	const { json } = await readLocalSettings(entry);
	if (json.Values.AzureWebJobsStorage !== "UseDevelopmentStorage=true") {
		throw new Error(
			"Queue test messages are local-only and require AzureWebJobsStorage=UseDevelopmentStorage=true; no cloud queue was changed.",
		);
	}
	const invocation = recordInvocation(entry, {
		functionName: fn.name,
		target: "local",
		trigger: "queue",
		origin: "manual",
		ok: null,
		status: 0,
		ms: null,
		tools: [],
		payloads: [],
		note: `Writing a representative message to local Azurite queue ${entry.queueName}.`,
	});
	const c = cmdStart(entry, {
		kind: "az",
		title: "enqueue local Queue trigger",
		cmd:
			`az storage queue create --name ${entry.queueName} --connection-string 'UseDevelopmentStorage=true'\n` +
			`az storage message put --queue-name ${entry.queueName} --connection-string 'UseDevelopmentStorage=true' --content '<message omitted>'`,
		purpose: "Create the local Azurite queue idempotently and write one representative Queue trigger message",
	});
	const started = Date.now();
	try {
		const result = await enqueueLocalQueueMessage({
			execFileText,
			queueName: entry.queueName,
			message: messageOverride || entry.queueMessage,
			env: azureCliChildEnv(),
		});
		cmdEnd(entry, c, { ok: true, note: `${result.bytes} bytes written to local Azurite` });
		if (invocation.phase === "running") {
			invocation.status = 202;
			invocation.note = `Message written to local queue ${result.queueName}; waiting for the hosted skill to complete.`;
		}
		invocation.ms = Date.now() - started;
		scheduleInvocationHistoryWrite(entry);
		broadcast(entry, "state", snapshot(entry));
		return invocation;
	} catch (error) {
		invocation.ok = false;
		invocation.phase = "failed";
		invocation.ms = Date.now() - started;
		invocation.note = shortError(error);
		scheduleInvocationHistoryWrite(entry);
		cmdEnd(entry, c, { ok: false, note: shortError(error) });
		broadcast(entry, "state", snapshot(entry));
		return invocation;
	}
}

async function invokeLocalM365Inbox(entry, base, promptOverride) {
	const fn = entry.local.functions.find((candidate) => candidate.kind === "connector");
	if (!fn) throw new Error("No Microsoft 365 Inbox connector-triggered hosted skill is registered locally yet.");
	const url = `${base}/agents/${agentFunctionName(HERO_TEMPLATE.connectorAgentRelPath)}/chat`;
	const prompt = m365InboxDryRunPromptFromJson(promptOverride);
	const invocation = recordInvocation(entry, {
		functionName: fn.name,
		target: "local",
		trigger: "connector",
		origin: "manual",
		ok: null,
		status: 0,
		ms: null,
		tools: [],
		payloads: [],
		note: "Running the Microsoft 365 Inbox hosted skill through its built-in chat endpoint with dry-run Trigger data.",
	});
	const c = cmdStart(entry, {
		kind: "http",
		title: "Microsoft 365 Inbox dry run",
		cmd: `POST ${url}\n  body {"prompt":"<representative OnNewEmailV3 Trigger data omitted>"}`,
		purpose:
			"Exercise the connector-triggered hosted skill through the runtime's chat endpoint without emulating a webhook or calling Microsoft 365",
	});
	const started = Date.now();
	try {
		const resp = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ prompt }),
		});
		const text = await resp.text();
		const ms = Date.now() - started;
		const response = normalizeAgentOutput(text);
		cmdEnd(entry, c, { ok: resp.ok, note: `${resp.status} in ${ms}ms` });
		Object.assign(invocation, {
			status: resp.status,
			response,
			ok: resp.ok,
			phase: resp.ok ? "completed" : "failed",
			ms,
			note: response ? "Microsoft 365 Inbox dry run completed; agent response is available below." : `HTTP ${resp.status}`,
		});
		scheduleInvocationHistoryWrite(entry);
		broadcast(entry, "state", snapshot(entry));
		return invocation;
	} catch (error) {
		const ms = Date.now() - started;
		Object.assign(invocation, {
			ok: false,
			phase: "failed",
			ms,
			note: shortError(error),
		});
		scheduleInvocationHistoryWrite(entry);
		cmdEnd(entry, c, { ok: false, note: shortError(error) });
		broadcast(entry, "state", snapshot(entry));
		return invocation;
	}
}

async function invokeLocalHttp(entry, base, trigger, promptOverride, timerTwin) {
	const fn = entry.local.functions.find((f) => f.kind === "http");
	if (!fn) {
		throw new Error(
			timerTwin
				? "The Timer agent's HTTP test twin is not registered on the local host yet."
				: "No HTTP-triggered function is registered on the local host yet.",
		);
	}
	const fullUrl = fn.route.startsWith("http") ? fn.route : `${base}${fn.route}`;
	const prompt = promptOverride || entry.httpPrompt;
	const invocation = recordInvocation(entry, {
		functionName: fn.name,
		target: "local",
		trigger,
		origin: "manual",
		ok: null,
		status: 0,
		ms: null,
		tools: [],
		payloads: [],
		note: timerTwin ? "Running the Timer agent through its HTTP test twin." : "Sending HTTP trigger.",
	});
	const c = cmdStart(entry, {
		kind: "http",
		title: timerTwin ? "Timer manual test (HTTP twin)" : "HTTP direct invoke",
		cmd: `POST ${fullUrl}\n  body ${JSON.stringify({ prompt })}`,
		purpose: timerTwin
			? "Run the Timer agent's identical HTTP twin and wait for the resulting digest"
			: "Call the HTTP-triggered twin agent directly and wait for its response",
	});
	const started = Date.now();
	try {
		const resp = await fetch(fullUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ prompt }),
		});
		const ms = Date.now() - started;
		const text = await resp.text();
		cmdEnd(entry, c, { ok: resp.ok, note: `${resp.status} in ${ms}ms` });
		invocation.status = resp.status;
		invocation.response = normalizeAgentOutput(text);
		invocation.ok = resp.ok;
		invocation.phase = resp.ok ? "completed" : "failed";
		invocation.ms = ms;
		if (invocation.executionId) entry.local.executions.delete(invocation.executionId);
		if (invocation.response) invocation.note = `${invocation.note} Agent digest is available below.`;
		scheduleInvocationHistoryWrite(entry);
		broadcast(entry, "state", snapshot(entry));
		return invocation;
	} catch (error) {
		const ms = Date.now() - started;
		invocation.ok = false;
		invocation.phase = "failed";
		invocation.ms = ms;
		invocation.note = shortError(error);
		scheduleInvocationHistoryWrite(entry);
		broadcast(entry, "state", snapshot(entry));
		cmdEnd(entry, c, { ok: false, note: shortError(error) });
		return invocation;
	}
}

async function prepareInvocation(entry) {
	if (entry.target !== "local") return;
	await ensureTemplate(entry);
	if (
		entry.modelBinding.loading ||
		entry.modelBinding.source !== entry.modelBinding.activeSource ||
		entry.modelBinding.resourceId !== entry.modelBinding.activeResourceId ||
		entry.modelBinding.modelId !== entry.modelBinding.activeModelId
	) {
		throw new Error("Wait for the selected model endpoint to finish binding before invoking.");
	}
	await ensureGatewayProviderFiles(entry, entry.modelBinding.activeSource === "gateway" ? "gateway" : "public");
	if (entry.modelBinding.activeSource === "foundry") await ensureLocalFoundryRuntimeSettings(entry);
	await startLocalEnvironment(entry);
	if (entry.modelBinding.activeSource !== "gateway") return;
	const remainingMs = entry.modelBinding.nextInvokeAt - Date.now();
	if (remainingMs > 0) {
		throw new Error(`Wait ${Math.ceil(remainingMs / 1000)} seconds before invoking the AI Gateway model again.`);
	}
	entry.modelBinding.nextInvokeAt = Date.now() + 30000;
	broadcast(entry, "state", snapshot(entry));
}

// --- AZURE: Azure CLI supplies the caller's signed-in account context and
// tokens. Function App/function discovery and runtime tests use documented
// public ARM, Functions, and Storage HTTPS contracts directly. Trigger tests
// can execute deployed code or enqueue a message, but resource provisioning and
// deployment remain exclusive to the separately confirmed azd flow.

async function listSubscriptions() {
	const rows = await azureCliSession.subscriptions();
	const subs = rows.map((s) => ({ id: s.id, name: s.name, tenantId: s.tenantId, isDefault: Boolean(s.isDefault) }));
	subs.sort((a, b) => (a.isDefault === b.isDefault ? 0 : a.isDefault ? -1 : 1));
	return subs;
}

async function ensureAzureSubscriptions(entry) {
	if (entry.azure.subscriptions.length) return;
	const c = cmdStart(entry, {
		kind: "az",
		title: "account list",
		cmd: "az account list --query \"[?state=='Enabled']\" -o json",
		purpose: "Discover available Azure subscriptions",
	});
	try {
		entry.azure.subscriptions = await listSubscriptions();
		entry.azure.subscriptionsError = "";
		cmdEnd(entry, c, { ok: true, note: `${entry.azure.subscriptions.length} subscription(s)` });
	} catch (error) {
		// Distinguish "not signed in" from every other az CLI failure so the
		// remediation is accurate, and so a genuine auth failure is never
		// silently reinterpreted as something else.
		const login = await checkAzureLogin();
		entry.azure.subscriptionsError = login.loggedIn
			? `Azure subscription discovery failed: ${shortError(error)}.`
			: `Not signed in to the Azure CLI. Run \`az login\`, then retry. (${shortError(error)})`;
		cmdEnd(entry, c, { ok: false, note: shortError(error) });
		broadcast(entry, "state", snapshot(entry));
		return;
	}
	if (!entry.azure.subscriptions.length) {
		entry.azure.subscriptionsError = "No enabled Azure subscriptions found.";
		broadcast(entry, "state", snapshot(entry));
		return;
	}
	entry.azure.subscription = entry.azure.subscriptions[0].id;
	entry.azure.tenantId = entry.azure.subscriptions[0].tenantId || "";
	await loadFunctionApps(entry);
}

async function loadFunctionApps(entry) {
	const c = cmdStart(entry, {
		kind: "rest",
		title: "Function Apps",
		cmd: `GET https://management.azure.com/subscriptions/${entry.azure.subscription}/providers/Microsoft.Web/sites?api-version=${APP_SERVICE_API_VERSION}`,
		purpose: "List Function Apps through the documented App Service ARM API",
	});
	try {
		entry.azure.apps = await listFunctionApps(armClient, entry.azure.subscription);
		entry.azure.appsError = "";
		cmdEnd(entry, c, { ok: true, note: `${entry.azure.apps.length} app(s)` });
	} catch (error) {
		entry.azure.apps = [];
		entry.azure.appsError = `Function App ARM discovery failed: ${shortError(error)}`;
		cmdEnd(entry, c, { ok: false, note: shortError(error) });
	}
	broadcast(entry, "state", snapshot(entry));
}

async function selectSubscription(entry, subscriptionId) {
	const sub = entry.azure.subscriptions.find((s) => s.id === subscriptionId);
	if (!sub) throw new Error("Unknown subscription.");
	entry.azure.subscription = sub.id;
	entry.azure.tenantId = sub.tenantId || "";
	entry.azure.app = null;
	entry.azure.appId = "";
	entry.azure.functions = [];
	entry.azure.functionName = "";
	entry.azure.appInsights = null;
	stopLiveTelemetry(entry);
	entry.liveTelemetry.points = [];
	entry.liveTelemetry.traces = [];
	entry.liveTelemetry.error = "";
	await loadFunctionApps(entry);
}

function selectedAzureFunction(entry) {
	return entry.azure.functions.find((fn) => fn.name === entry.azure.functionName) || null;
}

function selectAzureFunction(entry, functionName) {
	const fn = entry.azure.functions.find((candidate) => candidate.name === functionName);
	if (!fn) throw new Error("Unknown deployed function.");
	entry.azure.functionName = fn.name;
	entry.trigger = fn.kind;
	broadcast(entry, "state", snapshot(entry));
	return fn;
}

async function selectFunctionApp(entry, resourceId) {
	const app = entry.azure.apps.find((a) => a.id === resourceId);
	if (!app) throw new Error("Unknown Function App.");
	entry.azure.app = app;
	entry.azure.appId = app.id;
	entry.azure.functions = [];
	entry.azure.functionName = "";
	entry.azure.appInsights = null;
	stopLiveTelemetry(entry);
	entry.liveTelemetry.points = [];
	entry.liveTelemetry.traces = [];
	entry.liveTelemetry.error = "";
	broadcast(entry, "state", snapshot(entry));

	const c = cmdStart(entry, {
		kind: "rest",
		title: "Deployed functions",
		cmd: `GET https://management.azure.com${app.id}/functions?api-version=${APP_SERVICE_API_VERSION}`,
		purpose: "Discover deployed functions and trigger bindings through the documented App Service ARM API",
	});
	try {
		entry.azure.functions = await listFunctionAppFunctions(armClient, {
			subscription: entry.azure.subscription,
			app,
		});
		entry.azure.functionsError = "";
		const initial = entry.azure.functions.find((fn) => fn.supportsInvoke) || entry.azure.functions[0];
		if (initial) {
			entry.azure.functionName = initial.name;
			entry.trigger = initial.kind;
		}
		cmdEnd(entry, c, { ok: true, note: `${entry.azure.functions.length} function(s)` });
	} catch (error) {
		entry.azure.functions = [];
		entry.azure.functionName = "";
		entry.azure.functionsError = `Function discovery failed. Verify Microsoft.Web/sites/functions read access. ${shortError(error)}`;
		cmdEnd(entry, c, { ok: false, note: shortError(error) });
	}
	try {
		const appInsights = await resolveAppInsights(entry);
		if (appInsights) startLiveTelemetry(entry);
		else entry.liveTelemetry.error = entry.azure.appInsightsError;
	} catch (error) {
		entry.azure.appInsightsError = `Application Insights auto-enable failed. ${shortError(error)}`;
		entry.liveTelemetry.error = entry.azure.appInsightsError;
	}
	broadcast(entry, "state", snapshot(entry));
}

// Azure's invokeUrlTemplate/href can embed a real `?code=...` function key in
// the URL itself (not just a header). Never show that in the Commands feed -
// redact it for display while the real URL (with its real code, if any) is
// still what actually gets called.
function redactUrl(url) {
	return String(url || "").replace(/([?&]code=)[^&]+/gi, "$1******");
}

async function invokeAzure(entry, input) {
	const { app, subscription } = entry.azure;
	if (!app) throw new Error("Select an Azure Function App first.");
	const fn = selectedAzureFunction(entry);
	if (!fn) throw new Error("Select a deployed function first.");
	if (!fn.supportsInvoke) throw new Error(fn.guidance);
	const awaitAgentResponse =
		fn.kind !== "http" && entry.liveTelemetry.enabled && Boolean(entry.azure.appInsights);
	if (
		entry.azureInvocationsInFlight.has(fn.name) ||
		hasPendingAgentResponse(entry.invocations, fn.name)
	) {
		throw new Error(
			`Wait for ${fn.name}'s current Application Insights result before invoking it again. ` +
				"Keep Observe enabled; the activity clear action retains this invocation so results cannot be swapped.",
		);
	}
	if (awaitAgentResponse) entry.azureInvocationsInFlight.add(fn.name);
	const c = cmdStart(entry, {
		kind: fn.kind === "http" ? "http" : "rest",
		title: `${fn.label} test`,
		cmd: `${fn.label} ${fn.name}\n  authentication resolved at invoke time; trigger/test input omitted from log`,
		purpose: fn.guidance,
	});
	try {
		const invokedAt = new Date().toISOString();
		const result = await invokeFunction({
			arm: armClient,
			session: azureCliSession,
			subscription,
			app,
			fn,
			input,
		});
		const request = result.request || {};
		c.cmd =
			`${request.method || "POST"} ${redactUrl(request.url || app.defaultHostName)}\n` +
			`  auth ${request.auth || "[redacted]"}${request.body ? `\n  body ${request.body}` : ""}`;
		cmdEnd(entry, c, { ok: true, note: `${result.status} in ${result.ms}ms` });
		const response = normalizeAgentOutput(result.text);
		return recordInvocation(entry, {
			functionName: fn.name,
			target: "azure",
			trigger: fn.kind,
			ok: true,
			status: result.status,
			ms: result.ms,
			invokedAt,
			awaitAgentResponse,
			response,
			note: result.note || (response ? "Function response is available below." : `HTTP ${result.status}`),
		});
	} catch (error) {
		cmdEnd(entry, c, { ok: false, note: shortError(error) });
		return recordInvocation(entry, {
			functionName: fn.name,
			target: "azure",
			trigger: fn.kind,
			ok: false,
			status: Number(error?.status || 0),
			ms: 0,
			note: shortError(error),
		});
	} finally {
		if (awaitAgentResponse) entry.azureInvocationsInFlight.delete(fn.name);
	}
}

// Resolve the app's Application Insights resource by matching its
// configured instrumentation key. Appsettings values are never printed to
// the Commands feed (only the setting names are shown).
async function resolveAppInsights(entry) {
	const { app, subscription } = entry.azure;
	if (!app) throw new Error("Select an Azure Function App first.");
	if (entry.azure.appInsights) return entry.azure.appInsights;

	const settingQuery = "[?name=='APPLICATIONINSIGHTS_CONNECTION_STRING' || name=='APPINSIGHTS_INSTRUMENTATIONKEY']";
	const c1 = cmdStart(entry, {
		kind: "az",
		title: "functionapp appsettings list",
		cmd: `az functionapp config appsettings list -g ${app.resourceGroup} -n ${app.name} --query "${settingQuery}" -o json --subscription ${subscription}`,
		purpose: "Find the app's Application Insights instrumentation key (values redacted, only setting names shown)",
	});
	let ikey = "";
	try {
		const rows = await runAz(
			["functionapp", "config", "appsettings", "list", "-g", app.resourceGroup, "-n", app.name, "--query", settingQuery, "-o", "json"],
			subscription,
		);
		const connSetting = rows.find((r) => r.name === "APPLICATIONINSIGHTS_CONNECTION_STRING");
		const ikeySetting = rows.find((r) => r.name === "APPINSIGHTS_INSTRUMENTATIONKEY");
		const raw = connSetting?.value || "";
		const m = /InstrumentationKey=([0-9a-fA-F-]+)/.exec(raw);
		ikey = (m && m[1]) || ikeySetting?.value || "";
		cmdEnd(entry, c1, { ok: true, note: ikey ? "found" : "no App Insights configured" });
	} catch (error) {
		cmdEnd(entry, c1, { ok: false, note: shortError(error) });
		throw error;
	}
	if (!ikey) {
		entry.azure.appInsights = null;
		entry.azure.appInsightsError = `${app.name} has no Application Insights connection string configured.`;
		return null;
	}

	const c2 = cmdStart(entry, {
		kind: "az",
		title: "app-insights component show",
		cmd: `az monitor app-insights component show -g ${app.resourceGroup} -o json --subscription ${subscription}`,
		purpose: "Match the instrumentation key to its Application Insights resource",
	});
	try {
		const rows = await runAz(["monitor", "app-insights", "component", "show", "-g", app.resourceGroup, "-o", "json"], subscription);
		const comp = rows.find((r) => r.instrumentationKey === ikey);
		cmdEnd(entry, c2, { ok: true, note: comp ? comp.name : "not found in resource group" });
		if (!comp) {
			entry.azure.appInsights = null;
			entry.azure.appInsightsError = "Instrumentation key set, but no matching Application Insights resource found in the resource group.";
			return null;
		}
		entry.azure.appInsights = { name: comp.name, resourceGroup: app.resourceGroup, id: comp.id };
		entry.azure.appInsightsError = "";
		entry.azure.appInsightsUrl = portalLink(entry, comp.id);
		return entry.azure.appInsights;
	} catch (error) {
		cmdEnd(entry, c2, { ok: false, note: shortError(error) });
		throw error;
	}
}

function portalLink(entry, resourceId) {
	const tenant = entry.azure.tenantId ? `${entry.azure.tenantId}/` : "";
	return `https://portal.azure.com/#@${tenant}resource${resourceId}/overview`;
}

// Live Application Insights telemetry: a real KQL query against the
// resolved App Insights resource, polled on an interval while enabled.
// Application Insights ingestion lags ~1-5 minutes, so this is near-real-time,
// not instantaneous - the UI says so.
const LIVE_TELEMETRY_QUERY =
	"requests | where timestamp > ago(30m) | summarize total=count(), failed=countif(success==false), avgMs=avg(duration) by bin(timestamp, 30s) | order by timestamp asc";
const LIVE_TELEMETRY_TRACE_QUERY =
	'union (traces | project timestamp, eventKind="trace", severityLevel=tolong(severityLevel), message, operationId=operation_Id), ' +
	'(exceptions | project timestamp, eventKind="exception", severityLevel=tolong(3), message=outerMessage, operationId=operation_Id) ' +
	"| where timestamp > ago(30m) | top 40 by timestamp desc";
const LIVE_AGENT_OUTPUT_QUERY =
	'let outputs = traces | where timestamp > ago(30m) and message startswith "Agent response:" ' +
	'| project timestamp, operationId=operation_Id, message; ' +
	"let functionRequests = requests | where timestamp > ago(30m) " +
	"| summarize arg_max(timestamp, name) by operationId=operation_Id " +
	"| project operationId, functionName=name; " +
	"outputs | join kind=leftouter functionRequests on operationId " +
	"| project timestamp, operationId, functionName, message | top 10 by timestamp desc";

async function pollLiveTelemetry(entry) {
	const ai = entry.azure.appInsights;
	if (!ai) return;
	const c = cmdStart(entry, {
		kind: "az",
		title: "app-insights query (live)",
		cmd: `az monitor app-insights query --app ${ai.name} -g ${ai.resourceGroup} -o json --subscription ${entry.azure.subscription} --analytics-query "<requests plus traces/exceptions from last 30m>"`,
		purpose: "Pull real request metrics, traces, and exceptions from Application Insights",
	});
	try {
		const [out, traceOut, outputOut] = await Promise.all([
			runAz(
				["monitor", "app-insights", "query", "--app", ai.name, "-g", ai.resourceGroup, "--analytics-query", LIVE_TELEMETRY_QUERY, "-o", "json"],
				entry.azure.subscription,
			),
			runAz(
				[
					"monitor",
					"app-insights",
					"query",
					"--app",
					ai.name,
					"-g",
					ai.resourceGroup,
					"--analytics-query",
					LIVE_TELEMETRY_TRACE_QUERY,
					"-o",
					"json",
				],
				entry.azure.subscription,
			),
			runAz(
				[
					"monitor",
					"app-insights",
					"query",
					"--app",
					ai.name,
					"-g",
					ai.resourceGroup,
					"--analytics-query",
					LIVE_AGENT_OUTPUT_QUERY,
					"-o",
					"json",
				],
				entry.azure.subscription,
			),
		]);
		const table = out.tables?.[0];
		const rows = table ? table.rows.map((r) => ({ t: r[0], total: r[1], failed: r[2], avgMs: r[3] })) : [];
		const traceTable = traceOut.tables?.[0];
		const traces = traceTable
			? traceTable.rows.map((row) => ({
					t: row[0],
					kind: String(row[1] || "trace"),
					severity: Number(row[2] || 0),
					message: redactDeploymentOutput(String(row[3] || "")).slice(0, 1000),
					operationId: String(row[4] || ""),
				}))
			: [];
		entry.liveTelemetry.points = rows.slice(-40);
		entry.liveTelemetry.traces = traces.slice(0, 40);
		const outputRows = (outputOut.tables?.[0]?.rows || []).map((row) => ({
			time: String(row[0] || ""),
			operationId: String(row[1] || ""),
			functionName: String(row[2] || ""),
			message: String(row[3] || ""),
		}));
		if (applyAgentResponseTelemetry(entry.invocations, outputRows)) scheduleInvocationHistoryWrite(entry);
		entry.liveTelemetry.error = "";
		cmdEnd(entry, c, { ok: true, note: `${rows.length} metric bucket(s), ${traces.length} trace/exception event(s)` });
	} catch (error) {
		entry.liveTelemetry.error = shortError(error);
		cmdEnd(entry, c, { ok: false, note: shortError(error) });
	}
	broadcast(entry, "state", snapshot(entry));
}

function startLiveTelemetry(entry) {
	if (entry.liveTelemetry.enabled) return;
	entry.liveTelemetry.enabled = true;
	pollLiveTelemetry(entry);
	entry.liveTelemetry.timer = setInterval(() => pollLiveTelemetry(entry), 15000);
	broadcast(entry, "state", snapshot(entry));
}

function stopLiveTelemetry(entry) {
	entry.liveTelemetry.enabled = false;
	if (entry.liveTelemetry.timer) clearInterval(entry.liveTelemetry.timer);
	entry.liveTelemetry.timer = null;
	broadcast(entry, "state", snapshot(entry));
}

// --- LOAD TEST: real traffic via `oha`. Never fabricated - if `oha` is not
// installed, we say so explicitly with an install command and send nothing.
// Runs a loop of short, throttled bursts (real `oha` invocations, each fully
// logged in the Commands feed) so the chart is repeatedly measured.

async function checkOha(entry) {
	if (entry.loadTest.ohaChecked) return entry.loadTest.ohaAvailable;
	const c = cmdStart(entry, {
		kind: "shell",
		title: "oha --version",
		cmd: "oha --version",
		purpose: "Detect the oha HTTP load generator",
	});
	try {
		const { stdout } = await execFileText("oha", ["--version"]);
		entry.loadTest.ohaAvailable = true;
		entry.loadTest.ohaVersion = stdout.trim();
		cmdEnd(entry, c, { ok: true, note: entry.loadTest.ohaVersion });
	} catch {
		entry.loadTest.ohaAvailable = false;
		cmdEnd(entry, c, { ok: false, note: "not found" });
	}
	entry.loadTest.ohaChecked = true;
	return entry.loadTest.ohaAvailable;
}

// Resolve the load test's real target URL and, for Azure, its auth headers.
// Local targets are never authenticated (unchanged). Azure targets retrieve a
// function-scoped key at invoke time when the function's auth level is not
// anonymous, so oha authenticates instead of
// generating a stream of real 401s. headerArgs are the real oha `-H` args
// (with the real key) used for the actual call; headerNote/redacted URL are
// display-only and never contain the key or an embedded `code=` value.
async function resolveLoadTestTarget(entry) {
	if (entry.loadTest.target === "local") {
		if (entry.local.status !== "running") throw new Error("Start the local function host first.");
		const fn = entry.local.functions.find((f) => f.kind === "http");
		if (!fn) throw new Error("No HTTP-triggered function registered on the local host yet.");
		const url = fn.route.startsWith("http") ? fn.route : `http://127.0.0.1:${entry.local.port}${fn.route}`;
		return { url, headerArgs: [], headerNote: "" };
	}
	if (!entry.azure.app) throw new Error("Select an Azure Function App first.");
	const fn = selectedAzureFunction(entry);
	if (!fn || fn.kind !== "http") throw new Error(`Select an HTTP-triggered function on ${entry.azure.app.name}.`);
	if (!fn.invokeUrl) throw new Error(`HTTP function ${fn.name} has no invocation URL in public Function metadata.`);
	const url = fn.invokeUrl;
	if (fn.authLevel && fn.authLevel.toUpperCase() !== "ANONYMOUS") {
		let key;
		try {
			key = await readFunctionKey(armClient, {
				subscription: entry.azure.subscription,
				app: entry.azure.app,
				fn,
			});
		} catch (error) {
			throw new Error(`Could not fetch a function key for the load test: ${shortError(error)}`, { cause: error });
		}
		return { url, headerArgs: ["-H", `x-functions-key: ${key}`], headerNote: " -H 'x-functions-key: ******'" };
	}
	return { url, headerArgs: [], headerNote: "" };
}

function parseOhaSummary(json) {
	const m = json.metrics || {};
	const s = json.summary || {};
	const lat = m.latency_ms || {};
	const statusCounts = json.statusCodeDistribution || {};
	const errCounts = json.errorDistribution || {};
	const ok = Object.entries(statusCounts).reduce((sum, [code, n]) => sum + (Number(code) < 400 ? n : 0), 0);
	const errStatus = Object.entries(statusCounts).reduce((sum, [code, n]) => sum + (Number(code) >= 400 ? n : 0), 0);
	const errConn = Object.values(errCounts).reduce((a, b) => a + b, 0);
	return {
		t: Date.now(),
		rps: m.requests_per_sec ?? s.requestsPerSec ?? 0,
		avgMs: lat.mean ?? 0,
		p95Ms: lat.p95 ?? 0,
		p99Ms: lat.p99 ?? 0,
		ok,
		errors: errStatus + errConn,
		total: ok + errStatus + errConn,
	};
}

const LOAD_TEST_BURST_SECONDS = 3;

async function runLoadTestBurst(entry) {
	const available = await checkOha(entry);
	if (!available) {
		throw new Error(
			"oha is not installed. Install it (macOS: brew install oha, or cargo install oha), then retry. No traffic was sent.",
		);
	}
	const { url, headerArgs, headerNote } = await resolveLoadTestTarget(entry);
	const body = JSON.stringify({ prompt: entry.httpPrompt });
	const args = [
		"-z",
		`${LOAD_TEST_BURST_SECONDS}s`,
		"-c",
		String(entry.loadTest.concurrency),
		"-q",
		String(entry.loadTest.maxRps),
		"-m",
		"POST",
		"-d",
		body,
		"-T",
		"application/json",
		...headerArgs,
		"--no-tui",
		"--output-format",
		"json",
		url,
	];
	const cmdText = `oha -z ${LOAD_TEST_BURST_SECONDS}s -c ${entry.loadTest.concurrency} -q ${entry.loadTest.maxRps} -m POST -d '${body}' -T application/json${headerNote} --no-tui --output-format json ${redactUrl(url)}`;
	const c = cmdStart(entry, {
		kind: "shell",
		title: "oha burst",
		cmd: cmdText,
		purpose: "Run a throttled load-test burst and read its JSON summary",
	});
	recordLoadTestLine(entry, `$ ${cmdText}`);
	try {
		const { stdout } = await runTrackedOha(entry, args, (LOAD_TEST_BURST_SECONDS + 15) * 1000);
		const point = parseOhaSummary(JSON.parse(stdout));
		entry.loadTest.points.push(point);
		if (entry.loadTest.points.length > 60) entry.loadTest.points.shift();
		recordLoadTestLine(
			entry,
			`completed  ${point.rps.toFixed(1)} req/s  avg ${point.avgMs.toFixed(1)} ms  p95 ${point.p95Ms.toFixed(1)} ms  errors ${point.errors}`,
		);
		cmdEnd(entry, c, { ok: true, note: `${point.rps.toFixed(1)} req/s, ${point.errors} error(s)` });
	} catch (error) {
		if (entry.loadTest.stopRequested) {
			recordLoadTestLine(entry, "stopped");
			cmdEnd(entry, c, { ok: true, note: "stopped" });
			return;
		}
		recordLoadTestLine(entry, `error  ${shortError(error)}`);
		cmdEnd(entry, c, { ok: false, note: shortError(error) });
		throw error;
	}
	broadcast(entry, "state", snapshot(entry));
}

function recordLoadTestLine(entry, line) {
	const stamp = new Date().toLocaleTimeString();
	entry.loadTest.logTail.push(`[${stamp}] ${line}`);
	if (entry.loadTest.logTail.length > 120) entry.loadTest.logTail.shift();
	broadcast(entry, "state", snapshot(entry));
}

function runTrackedOha(entry, args, timeoutMs) {
	return new Promise((resolve, reject) => {
		const child = spawn("oha", args, { stdio: ["ignore", "pipe", "pipe"] });
		entry.loadTest.proc = child;
		recordLoadTestLine(entry, `oha started (pid ${child.pid})`);
		let stdout = "";
		let stderr = "";
		let settled = false;
		let timer = null;
		let activityTimer = null;
		const startedAt = Date.now();
		const finish = (error) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			if (activityTimer) clearInterval(activityTimer);
			if (entry.loadTest.proc === child) entry.loadTest.proc = null;
			if (error) reject(error);
			else resolve({ stdout, stderr });
		};
		const append = (target, chunk) => {
			const next = target + chunk.toString();
			if (next.length > 8 * 1024 * 1024) {
				child.kill("SIGTERM");
				finish(new Error("oha output exceeded 8 MB."));
			}
			return next;
		};
		child.stdout.on("data", (chunk) => {
			stdout = append(stdout, chunk);
		});
		child.stderr.on("data", (chunk) => {
			stderr = append(stderr, chunk);
			for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) {
				recordLoadTestLine(entry, line);
			}
		});
		child.once("error", finish);
		child.once("close", (code, signal) => {
			if (code === 0) finish();
			else finish(new Error(stderr.trim() || `oha exited${code == null ? "" : ` with code ${code}`}${signal ? ` (${signal})` : ""}.`));
		});
		timer = setTimeout(() => {
			child.kill("SIGTERM");
			finish(new Error("oha timed out."));
		}, timeoutMs);
		activityTimer = setInterval(() => {
			const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
			recordLoadTestLine(entry, `running  ${elapsed}s elapsed`);
		}, 1000);
	});
}

async function refreshLoadTestInstances(entry, force = false) {
	if (entry.loadTest.target === "local") {
		entry.loadTest.instanceCount = 1;
		entry.loadTest.instanceCountNote = "Local host";
		return;
	}
	const app = entry.azure.app;
	if (!app) {
		entry.loadTest.instanceCount = null;
		entry.loadTest.instanceCountNote = "Select an Azure Function App";
		return;
	}
	if (!force && Date.now() - entry.loadTest.lastInstancePollAt < 15_000) return;
	entry.loadTest.lastInstancePollAt = Date.now();
	try {
		if (!entry.loadTest.instanceMetricName) {
			const defs = await runAz(["monitor", "metrics", "list-definitions", "--resource", app.id, "-o", "json"], entry.azure.subscription);
			const metric = defs.find((item) => item.name?.localizedValue === "Automatic Scaling Instance Count");
			entry.loadTest.instanceMetricName = metric?.name?.value || "";
		}
		if (!entry.loadTest.instanceMetricName) {
			entry.loadTest.instanceCount = null;
			entry.loadTest.instanceCountNote = "Instance metric is not available for this plan";
			return;
		}
		const startTime = new Date(Date.now() - 5 * 60_000).toISOString();
		const metrics = await runAz(
			[
				"monitor",
				"metrics",
				"list",
				"--resource",
				app.id,
				"--metric",
				entry.loadTest.instanceMetricName,
				"--interval",
				"PT1M",
				"--aggregation",
				"Maximum",
				"--start-time",
				startTime,
				"-o",
				"json",
			],
			entry.azure.subscription,
		);
		const values = (metrics.value || [])
			.flatMap((metric) => metric.timeseries || [])
			.flatMap((series) => series.data || [])
			.map((point) => point.maximum)
			.filter(Number.isFinite);
		entry.loadTest.instanceCount = values.length ? Math.max(1, Math.round(values.at(-1))) : null;
		entry.loadTest.instanceCountNote = values.length ? "Azure Monitor" : "Waiting for Azure Monitor";
	} catch (error) {
		entry.loadTest.instanceCount = null;
		entry.loadTest.instanceCountNote = `Instance metric unavailable: ${shortError(error)}`;
	}
	broadcast(entry, "state", snapshot(entry));
}

async function runLoadTestLoop(entry) {
	const maxMs = Math.min(Math.max(entry.loadTest.durationSec, 5), 120) * 1000;
	while (entry.loadTest.running && Date.now() - entry.loadTest.startedAt < maxMs) {
		try {
			await runLoadTestBurst(entry);
			await refreshLoadTestInstances(entry);
		} catch (error) {
			entry.loadTest.error = shortError(error) || String(error?.message || error);
			entry.loadTest.running = false;
			broadcast(entry, "state", snapshot(entry));
			return;
		}
	}
	entry.loadTest.running = false;
	broadcast(entry, "state", snapshot(entry));
}

async function startLoadTest(entry, opts = {}) {
	if (entry.loadTest.running) return;
	await ensureTemplate(entry);
	if (opts.target === "local" || opts.target === "azure") entry.loadTest.target = opts.target;
	if (entry.loadTest.target === "local") await startLocalEnvironment(entry);
	if (Number.isFinite(opts.durationSec)) entry.loadTest.durationSec = opts.durationSec;
	if ([1, 16, 32].includes(opts.concurrency)) entry.loadTest.concurrency = opts.concurrency;
	if (Number.isFinite(opts.maxRps)) entry.loadTest.maxRps = opts.maxRps;
	entry.loadTest.running = true;
	entry.loadTest.error = "";
	entry.loadTest.points = [];
	entry.loadTest.logTail = [];
	entry.loadTest.startedAt = Date.now();
	entry.loadTest.stopRequested = false;
	entry.loadTest.instanceMetricName = "";
	entry.loadTest.lastInstancePollAt = 0;
	await refreshLoadTestInstances(entry, true);
	broadcast(entry, "state", snapshot(entry));
	runLoadTestLoop(entry);
}

function stopLoadTest(entry) {
	entry.loadTest.stopRequested = true;
	entry.loadTest.running = false;
	if (entry.loadTest.proc) {
		recordLoadTestLine(entry, "stopping oha...");
		entry.loadTest.proc.kill("SIGTERM");
		entry.loadTest.proc = null;
	}
	broadcast(entry, "state", snapshot(entry));
}

async function commitAppHandoff(dir, instanceId) {
	const branch = `intelligent-function-app-studio/${safeSegment(instanceId).slice(0, 48)}`;
	const instructionsPath = path.join(dir, ".github", "copilot-instructions.md");
	await mkdir(path.dirname(instructionsPath), { recursive: true });
	await writeFile(
		instructionsPath,
		[
			"# Functions Hosted Skills Studio handoff",
			"",
			"This working copy contains an Intelligent Functions App created from the daily repo digest template.",
			"Start by reviewing `src/*.agent.md`, `src/agents.config.yaml`, `src/mcp.json`, and `azure.yaml`.",
			"`src/local.settings.json` is intentionally ignored and must remain uncommitted.",
			"Do not deploy or change Azure resources without explicit approval.",
			"",
		].join("\n"),
	);
	await protectLocalSettings(dir);
	if (!(await exists(path.join(dir, ".git")))) {
		await execFileText("git", ["init", "-b", "main"], { cwd: dir });
	}
	let branchExists = true;
	try {
		await execFileText("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: dir });
	} catch {
		branchExists = false;
	}
	await execFileText("git", branchExists ? ["switch", branch] : ["switch", "-c", branch], { cwd: dir });
	await execFileText("git", ["add", "-A"], { cwd: dir });
	const status = await execFileText("git", ["status", "--porcelain"], { cwd: dir });
	if (status.stdout.trim()) {
		try {
			await execFileText("git", ["commit", "-m", "Add Functions Hosted Skills Studio handoff"], { cwd: dir });
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
					"Add Functions Hosted Skills Studio handoff",
				],
				{ cwd: dir },
			);
		}
	}
	return { dir, branch };
}

async function prepareAppSession(entry) {
	const dir = await ensureTemplate(entry).then(() => requireTemplateDir(entry));
	return commitAppHandoff(dir, entry.instanceId);
}

async function requestAppProjectRegistration(entry, info) {
	if (!session) throw new Error("The GitHub Copilot App session is not connected.");
	const command = cmdStart(entry, {
		kind: "app",
		title: "create GitHub Copilot App session",
		cmd:
			`create_project(path=${JSON.stringify(info.dir)})\n` +
			`create_session(base_branch=${JSON.stringify(info.branch)}, mode=plan)`,
		purpose: "Create an isolated App worktree from this Intelligent Functions App",
	});
	entry.appRegistrationCommand = command;
	entry.appRegistration = { pending: true, ok: null, message: "Waiting for the App agent." };
	entry.openStatus = "Creating a GitHub Copilot App session...";
	broadcast(entry, "state", snapshot(entry));

	const kickoff =
		"Continue from the Functions Hosted Skills Studio handoff. Read .github/copilot-instructions.md, " +
		"inspect the agent and project files, and report the concrete local run steps. Do not deploy or change Azure resources without asking.";
	const prompt =
		`Functions Hosted Skills Studio session request for canvas instance ${JSON.stringify(entry.instanceId)}.\n\n` +
		`The user clicked Create isolated GitHub Session and authorized these local App operations:\n` +
		`1. Call create_project with path ${JSON.stringify(info.dir)}. Use this exact local path, not a remote repository URL.\n` +
		`2. Call create_session for the returned project id with base_branch ${JSON.stringify(info.branch)}, ` +
		`name "Build intelligent function app", coordinate_with_creator true, notify_on_idle "once", and this kickoff prompt:\n` +
		`${JSON.stringify(kickoff)}\nUse plan mode. Do not run or deploy the app yet.\n` +
		`3. Call get_session for the new session and verify its worktree contains .github/copilot-instructions.md and src/agent files.\n` +
		`4. Call invoke_canvas_action with instanceId ${JSON.stringify(entry.instanceId)}, actionName ` +
		`"registration_completed", and input containing ok, projectId, projectName, sessionId, worktreePath, and message. ` +
		`Only send ok=true after verifying the worktree. If a step fails, send ok=false with the exact failure.`;
	const messageId = await session.send(prompt);
	return { ok: true, pending: true, messageId, ...info, message: entry.openStatus };
}

function readJsonBody(req, maxLen = 16000) {
	return new Promise((resolve) => {
		let body = "";
		req.on("data", (chunk) => {
			body += chunk;
			if (body.length > maxLen) req.destroy();
		});
		req.on("end", () => {
			try {
				resolve(JSON.parse(body || "{}"));
			} catch {
				resolve({});
			}
		});
	});
}

async function startServer(entry) {
	const server = createServer((req, res) => {
		if (req.method === "GET" && req.url === "/") {
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(renderHtml());
			return;
		}
		if (req.method === "GET" && req.url === "/events") {
			res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
			res.write(`event: state\ndata: ${JSON.stringify(snapshot(entry))}\n\n`);
			entry.clients.add(res);
			req.on("close", () => entry.clients.delete(res));
			return;
		}

		if (req.method === "POST" && req.url === "/source/select") {
			readJsonBody(req)
				.then((body) => {
					if (entry.sourceWorkspace.materialized) {
						throw new Error("Move or remove the generated app before changing its source location.");
					}
					const mode = body.mode === "isolated" ? "isolated" : "current";
					if (mode === "current" && !entry.sourceWorkspace.workingDirectory) {
						throw new Error("This chat does not expose a current worktree. Use an isolated workspace.");
					}
					entry.sourceWorkspace.mode = mode;
					if (mode === "current") {
						const selected = resolveCurrentWorkspaceDestination(
							entry.sourceWorkspace.workingDirectory,
							String(body.relativePath || DEFAULT_CURRENT_SUBDIR),
						);
						entry.sourceWorkspace.relativePath = selected.relative;
						entry.sourceWorkspace.destination = selected.destination;
					} else {
						entry.sourceWorkspace.destination = isolatedTemplateDirectory(entry);
					}
					entry.sourceWorkspace.error = "";
					broadcast(entry, "state", snapshot(entry));
					responseJson(res, { ok: true, destination: entry.sourceWorkspace.destination });
				})
				.catch((error) => responseJson(res, { ok: false, message: shortError(error) }));
			return;
		}

		if (req.method === "POST" && req.url === "/source/create") {
			readJsonBody(req)
				.then(async (body) => {
					await startGeneratedWorkspace(entry, {
						mode: body.mode,
						relativePath: body.relativePath,
					});
					responseJson(res, {
						ok: true,
						destination: entry.sourceWorkspace.destination,
						message: `Generated app created at ${entry.sourceWorkspace.destination}`,
					});
				})
				.catch((error) => responseJson(res, { ok: false, message: shortError(error) }));
			return;
		}

		if (req.method === "POST" && req.url === "/source/move-current") {
			readJsonBody(req)
				.then(async (body) => {
					if (body.confirm !== true) throw new Error("Confirm the new local function path before moving files.");
					await moveCurrentSourceWorkspace(entry, body.relativePath);
					startLocalEnvironment(entry).catch((error) => {
						entry.local.error = shortError(error);
						broadcast(entry, "state", snapshot(entry));
					});
					responseJson(res, {
						ok: true,
						destination: entry.sourceWorkspace.destination,
						message: entry.openStatus,
					});
				})
				.catch((error) => responseJson(res, { ok: false, message: shortError(error) }));
			return;
		}

		if (req.method === "POST" && req.url === "/source/remove") {
			readJsonBody(req)
				.then(async (body) => {
					if (body.confirm !== true) throw new Error("Confirm removal before deleting generated files.");
					await removeCurrentSourceWorkspace(entry);
					responseJson(res, { ok: true, message: entry.openStatus });
				})
				.catch((error) => responseJson(res, { ok: false, message: shortError(error) }));
			return;
		}

		if (req.method === "POST" && req.url === "/select-trigger") {
			readJsonBody(req).then(async (body) => {
				const id = String(body.trigger || "");
				const t = TRIGGER_TYPES.find((x) => x.id === id);
				if (!t || t.nyi) throw new Error(`Trigger ${id || "(missing)"} is not implemented.`);
				assertWorkspaceMutationAllowed(entry, "Changing triggers");
				const changed = Boolean(t && !t.nyi && entry.trigger !== id);
				entry.trigger = id;
				broadcast(entry, "state", snapshot(entry));
				if (changed && entry.sourceWorkspace.materialized) await syncGeneratedTriggerFiles(entry);
				if (changed && entry.target === "local") await restartLocalEnvironment(entry);
				responseJson(res, { ok: true, trigger: entry.trigger });
			}).catch((error) => responseJson(res, { ok: false, message: shortError(error) }));
			return;
		}

		if (req.method === "POST" && req.url === "/timer-schedule") {
			readJsonBody(req)
				.then(async (body) => {
					if (entry.target !== "local") throw new Error("Timer schedule editing is available for the local function.");
					await setTimerSchedule(entry, body);
					responseJson(res, {
						ok: true,
						cadence: entry.timerSchedule.cadence,
						localTime: entry.timerSchedule.localTime,
						weekday: entry.timerSchedule.weekday,
						hourlyMinute: entry.timerSchedule.hourlyMinute,
						expression: entry.timerSchedule.expression,
					});
				})
				.catch((error) => {
					entry.timerSchedule.error = shortError(error);
					entry.timerSchedule.status = "";
					broadcast(entry, "state", snapshot(entry));
					responseJson(res, { ok: false, message: shortError(error) });
				});
			return;
		}

		if (req.method === "POST" && req.url === "/select-target") {
			readJsonBody(req)
				.then(async (body) => {
					const target = body.target === "azure" ? "azure" : "local";
					entry.target = target;
					broadcast(entry, "state", snapshot(entry));
					if (target === "azure") {
						stopLocal(entry);
						await ensureAzureSubscriptions(entry);
					} else if (entry.sourceWorkspace.materialized) {
						if (!["timer", "http"].includes(entry.trigger)) entry.trigger = "timer";
						await startLocalEnvironment(entry);
					}
					responseJson(res, { ok: true, target: entry.target });
				})
				.catch((error) => {
					responseJson(res, { ok: false, message: shortError(error) || String(error?.message || error) });
				});
			return;
		}

		if (req.method === "POST" && req.url === "/prompt") {
			readJsonBody(req).then(async (body) => {
				try {
					assertWorkspaceMutationAllowed(entry, "Editing skill instructions");
					await ensureTemplate(entry);
					await saveInstructions(entry, String(body.prompt ?? ""));
					responseJson(res, { ok: true, prompt: entry.prompt });
				} catch (error) {
					responseJson(res, { ok: false, message: shortError(error) });
				}
			});
			return;
		}

		if (req.method === "POST" && req.url === "/http-prompt") {
			readJsonBody(req).then((body) => {
				entry.httpPrompt = String(body.prompt || "").trim() || "Give me the daily digest now.";
				broadcast(entry, "state", snapshot(entry));
				responseJson(res, { ok: true, httpPrompt: entry.httpPrompt });
			});
			return;
		}

		if (req.method === "POST" && req.url === "/local/start") {
			if (entry.target !== "local") {
				responseJson(res, { ok: false, message: "Select New local function first." });
				return;
			}
			if (entry.deployment.status === "preparing") {
				responseJson(res, {
					ok: false,
					message: "Wait for the isolated deployment snapshot to finish, then start the local function.",
				});
				return;
			}
			startLocalEnvironment(entry)
				.then(() => responseJson(res, { ok: true, port: entry.local.port }))
				.catch((error) => responseJson(res, { ok: false, message: shortError(error) || String(error?.message || error) }));
			return;
		}

		if (req.method === "POST" && req.url === "/local/stop") {
			stopLocal(entry);
			responseJson(res, { ok: true });
			return;
		}

		if (req.method === "POST" && req.url === "/doctor/run") {
			if (entry.doctorRunning) {
				responseJson(res, { ok: false, message: "Doctor is already running." });
				return;
			}
			entry.doctorRunning = true;
			broadcast(entry, "state", snapshot(entry));
			runDoctor(entry)
				.then((doctor) => responseJson(res, { ok: true, ready: doctor.ready }))
				.catch((error) => responseJson(res, { ok: false, message: shortError(error) || String(error?.message || error) }))
				.finally(() => {
					entry.doctorRunning = false;
					broadcast(entry, "state", snapshot(entry));
				});
			return;
		}

		if (req.method === "POST" && req.url === "/invoke") {
			readJsonBody(req).then(async (body) => {
				try {
					await prepareInvocation(entry);
					const result =
						entry.target === "azure"
							? await invokeAzure(entry, body.input)
							: await invokeLocal(entry, entry.trigger, body.prompt);
					responseJson(res, { ok: true, result });
				} catch (error) {
					responseJson(res, { ok: false, message: shortError(error) || String(error?.message || error) });
				}
			});
			return;
		}

		if (req.method === "POST" && req.url === "/invoke/cancel") {
			(async () => {
				const running = entry.invocations.filter((event) => event.phase === "running");
				if (!running.length) return { ok: false, message: "No invocation is currently running." };
				if (entry.target !== "local") {
					return { ok: false, message: "Azure accepted this invocation and cannot cancel it from the canvas." };
				}
				for (const event of running) {
					event.phase = "failed";
					event.ok = false;
					event.note = "Cancelled by the user.";
					event.ms = event.ms ?? 0;
				}
				scheduleInvocationHistoryWrite(entry);
				stopLocal(entry);
				await new Promise((resolve) => setTimeout(resolve, 1800));
				await startLocalEnvironment(entry);
				return { ok: true, message: "Invocation cancelled and the local host restarted." };
			})()
				.then((result) => responseJson(res, result))
				.catch((error) => responseJson(res, { ok: false, message: shortError(error) }));
			return;
		}

		if (req.method === "POST" && req.url === "/clear") {
			const retainedAwaiting = clearSettledInvocations(entry);
			responseJson(res, { ok: true, retainedAwaiting });
			return;
		}

		if (req.method === "POST" && req.url === "/models/select-source") {
			readJsonBody(req)
				.then(async (body) => {
					const source = body.source === "gateway" ? "gateway" : "foundry";
					entry.modelBinding.source = source;
					selectDefaultModelBinding(entry);
					await applyModelBinding(entry, {
						source,
						resourceId: entry.modelBinding.resourceId,
						modelId: entry.modelBinding.modelId,
					});
					responseJson(res, { ok: true, activeLabel: entry.modelBinding.activeLabel });
				})
				.catch((error) => responseJson(res, { ok: false, message: shortError(error) }));
			return;
		}

		if (req.method === "POST" && req.url === "/models/select-choice") {
			readJsonBody(req)
				.then(async (body) => {
					const resource = modelResources(entry).find((item) => item.id === String(body.resourceId || ""));
					if (!resource) throw new Error("Unknown model resource.");
					const model = resource.models.find((item) => item.id === String(body.modelId || "")) || resource.models[0];
					await applyModelBinding(entry, {
						source: entry.modelBinding.source,
						resourceId: resource.id,
						modelId: model?.id || "",
					});
					responseJson(res, { ok: true, activeLabel: entry.modelBinding.activeLabel });
				})
				.catch((error) => responseJson(res, { ok: false, message: shortError(error) }));
			return;
		}

		if (req.method === "POST" && req.url === "/models/select-subscription") {
			readJsonBody(req)
				.then(async (body) => {
					const subscription = String(body.subscription || "");
					if (!entry.azure.subscriptions.some((item) => item.id === subscription)) {
						throw new Error("Unknown Azure subscription.");
					}
					await discoverModelBindings(entry, subscription);
					if (!modelResources(entry).some((item) => item.models.length)) {
						entry.modelBinding.source =
							entry.modelBinding.foundry.some((item) => item.models.length) ||
							entry.modelBinding.gatewayCapability.status !== "available"
								? "foundry"
								: "gateway";
						selectDefaultModelBinding(entry);
					}
					if (entry.modelBinding.resourceId && entry.modelBinding.modelId) {
						await applyModelBinding(entry, {
							source: entry.modelBinding.source,
							resourceId: entry.modelBinding.resourceId,
							modelId: entry.modelBinding.modelId,
						});
					}
					responseJson(res, { ok: true, activeLabel: entry.modelBinding.activeLabel });
				})
				.catch((error) => responseJson(res, { ok: false, message: shortError(error) }));
			return;
		}

		if (req.method === "POST" && req.url === "/models/refresh") {
			discoverModelBindings(entry, entry.modelBinding.subscription || entry.azure.subscription)
				.then(() => {
					if (entry.modelBinding.source === "gateway") {
						try {
							requireGatewayCapability(entry.modelBinding.gatewayCapability);
							entry.modelBinding.gatewayActionError = "";
						} catch (error) {
							entry.modelBinding.gatewayActionError = error.message;
							broadcast(entry, "state", snapshot(entry));
							throw error;
						}
					}
					responseJson(res, { ok: true });
				})
				.catch((error) => responseJson(res, { ok: false, message: shortError(error) }));
			return;
		}

		if (req.method === "POST" && req.url === "/models/apply") {
			readJsonBody(req)
				.then(async (body) => {
					await applyModelBinding(entry, {
						source: body.source,
						resourceId: String(body.resourceId || ""),
						modelId: String(body.modelId || ""),
					});
					responseJson(res, { ok: true, activeLabel: entry.modelBinding.activeLabel });
				})
				.catch((error) => {
					entry.modelBinding.error = shortError(error);
					entry.modelBinding.status = "";
					broadcast(entry, "state", snapshot(entry));
					responseJson(res, { ok: false, message: shortError(error) });
				});
			return;
		}

		if (req.method === "POST" && req.url === "/models/create-plan") {
			// Read-only: builds and returns the plan, never provisions anything.
			buildModelCreationPlan(entry)
				.then((plan) => {
					entry.modelCreate = { ...entry.modelCreate, planned: true, ok: null, message: "", ...plan };
					broadcast(entry, "state", snapshot(entry));
					responseJson(res, { ok: true, plan });
				})
				.catch((error) => responseJson(res, { ok: false, message: shortError(error) }));
			return;
		}

		if (req.method === "POST" && req.url === "/models/create") {
			readJsonBody(req)
				.then(async (body) => {
					if (body.confirm !== true) {
						// Never provision without an explicit confirmation from the
						// user's own click - a missing/false confirm only returns the
						// plan again, exactly like the initial Create Models view.
						const plan = await buildModelCreationPlan(entry);
						responseJson(res, { ok: false, message: "Confirmation required before creating models.", plan });
						return;
					}
					const result = await runModelCreation(entry);
					responseJson(res, result);
				})
				.catch((error) => responseJson(res, { ok: false, message: shortError(error) }));
			return;
		}

		if (req.method === "POST" && req.url === "/az/select-subscription") {
			readJsonBody(req).then(async (body) => {
				try {
					await selectSubscription(entry, String(body.subscription || ""));
					responseJson(res, { ok: true });
				} catch (error) {
					responseJson(res, { ok: false, message: shortError(error) });
				}
			});
			return;
		}

		if (req.method === "POST" && req.url === "/az/select-app") {
			readJsonBody(req).then(async (body) => {
				try {
					await selectFunctionApp(entry, String(body.resourceId || ""));
					responseJson(res, { ok: true });
				} catch (error) {
					responseJson(res, { ok: false, message: shortError(error) });
				}
			});
			return;
		}

		if (req.method === "POST" && req.url === "/az/select-function") {
			readJsonBody(req).then((body) => {
				try {
					const fn = selectAzureFunction(entry, String(body.functionName || ""));
					responseJson(res, { ok: true, function: fn });
				} catch (error) {
					responseJson(res, { ok: false, message: shortError(error) });
				}
			});
			return;
		}

		if (req.method === "POST" && req.url === "/az/refresh-apps") {
			loadFunctionApps(entry).then(() => responseJson(res, { ok: true }));
			return;
		}

		if (req.method === "POST" && req.url === "/app-insights/open") {
			resolveAppInsights(entry)
				.then((ai) => {
					if (!ai) {
						responseJson(res, { ok: false, message: entry.azure.appInsightsError || "No Application Insights resource found." });
						return;
					}
					responseJson(res, { ok: true, url: entry.azure.appInsightsUrl });
				})
				.catch((error) => responseJson(res, { ok: false, message: shortError(error) }));
			return;
		}

		if (req.method === "POST" && req.url === "/telemetry/start") {
			(async () => {
				try {
					await resolveAppInsights(entry);
					if (!entry.azure.appInsights) throw new Error(entry.azure.appInsightsError || "No Application Insights resource found.");
					startLiveTelemetry(entry);
					responseJson(res, { ok: true });
				} catch (error) {
					responseJson(res, { ok: false, message: shortError(error) || String(error?.message || error) });
				}
			})();
			return;
		}

		if (req.method === "POST" && req.url === "/telemetry/stop") {
			stopLiveTelemetry(entry);
			responseJson(res, { ok: true });
			return;
		}

		if (req.method === "POST" && req.url === "/load-test/start") {
			readJsonBody(req)
				.then((body) =>
					startLoadTest(entry, {
						target: body.target,
						durationSec: Number(body.durationSec),
						concurrency: Number(body.concurrency),
						maxRps: Number(body.maxRps),
					}),
				)
				.then(() => responseJson(res, { ok: true }))
				.catch((error) => responseJson(res, { ok: false, message: shortError(error) }));
			return;
		}

		if (req.method === "POST" && req.url === "/load-test/stop") {
			stopLoadTest(entry);
			responseJson(res, { ok: true });
			return;
		}

		if (req.method === "POST" && req.url === "/open-vscode") {
			(async () => {
				const dir = await ensureTemplate(entry).then(() => requireTemplateDir(entry));
				const c = cmdStart(entry, { kind: "shell", title: "code (open)", cmd: `code ${dir}`, purpose: "Open the working copy in VS Code" });
				const result = await openVsCode(dir, {
					instructionContents: await loadedInstructionContents(),
				});
				cmdEnd(entry, c, { ok: result.ok, note: result.ok ? "opened" : result.message });
				return result;
			})()
				.then((result) => responseJson(res, result))
				.catch((error) => responseJson(res, { ok: false, message: shortError(error) }));
			return;
		}

		if (req.method === "POST" && req.url === "/edit-instructions-vscode") {
			(async () => {
				await ensureTemplate(entry);
				const dir = requireTemplateDir(entry);
				const filePath = path.join(dir, HERO_TEMPLATE.timerAgentRelPath);
				const c = cmdStart(entry, {
					kind: "shell",
					title: "code (agent instructions)",
					cmd: `code ${dir} --goto ${filePath}`,
					purpose: "Open the working folder and focus the agent markdown in VS Code",
				});
				const result = await openVsCode(dir, {
					instructionContents: await loadedInstructionContents(),
					filePath,
				});
				cmdEnd(entry, c, { ok: result.ok, note: result.ok ? "opened" : result.message });
				return result;
			})()
				.then((result) => responseJson(res, result))
				.catch((error) => responseJson(res, { ok: false, message: shortError(error) }));
			return;
		}

		if (req.method === "POST" && req.url === "/register-app-project") {
			if (entry.target !== "local") {
				responseJson(res, { ok: false, message: "Select New local function first." });
				return;
			}
			(async () => {
				entry.openStatus = "Preparing the local project and App session handoff...";
				broadcast(entry, "state", snapshot(entry));
				if (entry.sourceWorkspace.mode === "current") await moveSourceWorkspaceToIsolated(entry);
				const info = await prepareAppSession(entry);
				return requestAppProjectRegistration(entry, info);
			})()
				.then((result) => responseJson(res, result))
				.catch((error) => {
					if (entry.appRegistrationCommand) {
						cmdEnd(entry, entry.appRegistrationCommand, { ok: false, note: shortError(error) });
						entry.appRegistrationCommand = null;
					}
					entry.appRegistration = { pending: false, ok: false, message: shortError(error) };
					entry.openStatus = `Session handoff failed: ${shortError(error)}`;
					broadcast(entry, "state", snapshot(entry));
					responseJson(res, { ok: false, message: shortError(error) });
				});
			return;
		}

		if (req.method === "POST" && req.url === "/deploy-azure") {
			if (entry.target !== "local") {
				responseJson(res, { ok: false, message: "Select New local function first." });
				return;
			}
			(async () => {
				if (!entry.sourceWorkspace.materialized) {
					throw new Error("Create the generated app before deploying it to Azure.");
				}
				const sourceDir = requireTemplateDir(entry);
				try {
					beginAzdOperation(entry, "deploy");
				} catch (error) {
					return { ok: false, message: shortError(error) };
				}
				entry.deployment = {
					status: "preparing",
					message: "",
					startedAt: Date.now(),
					endedAt: null,
					cancelRequested: false,
					output: [],
					outputChars: 0,
					outputTruncated: false,
					phases: {},
					cancel: null,
				};
				entry.deploymentPhaseCommands = {};
				entry.deployStatus = deploymentSummary(entry.deployment);
				broadcast(entry, "state", snapshot(entry));
				await ensureAzureSubscriptions(entry);
				const deploymentSubscription = entry.modelBinding.subscription || entry.azure.subscription;
				if (!deploymentSubscription) {
					throw new Error(
						entry.azure.subscriptionsError ||
							"Select an Azure subscription before deploying. Studio cannot prompt inside the canvas.",
					);
				}
				const dir = deploymentWorkspaceDir(entry);
				await prepareDeploymentProjectCopy(sourceDir, dir);
				await enforceIdentityOnlyDeploymentTemplate(dir);
				if (entry.trigger === "connector") {
					throw new Error(
						"Microsoft 365 Inbox deployment is not automated by Studio. Provision an authorized Connector Namespace connection, create OnNewEmailV3 for folderPath=Inbox, merge src/m365-inbox.mcp.json into src/mcp.json, configure OUTLOOK_MCP_ENDPOINT, and complete delegated OAuth consent outside Studio.",
					);
				}
				if (entry.trigger === "queue") {
					throw new Error(
						"Queue deployment is not automated by Studio because the generated Azure infrastructure does not create its source queue. Provision the exact generated queue and required data-plane access outside Studio before deploying this Queue-triggered app.",
					);
				}
				await rm(path.join(dir, HERO_TEMPLATE.queueAgentRelPath), { force: true });
				await rm(path.join(dir, HERO_TEMPLATE.connectorAgentRelPath), { force: true });
				await removeConnectorDeploymentConfig(path.join(dir, "src"));
				const deploymentEntry = {
					...entry,
					templateDir: dir,
					agentDir: path.join(dir, "src"),
				};
				await ensureGatewayProviderFiles(
					deploymentEntry,
					entry.modelBinding.activeSource === "gateway" ? "gateway" : "connector",
				);
				entry.deployment.status = "running";
				entry.deployStatus = deploymentSummary(entry.deployment);
				const c = cmdStart(entry, {
					kind: "shell",
					title: "azd up",
					cmd:
						`cd ${dir} && azd up --environment ${AZD_DEPLOYMENT_ENVIRONMENT} ` +
						`--subscription ${deploymentSubscription} --location ${AZD_DEPLOYMENT_LOCATION} --no-prompt`,
					purpose:
						`Provision and deploy the isolated Azure Functions workspace in ${AZD_DEPLOYMENT_LOCATION} ` +
						"using the canvas-selected subscription",
				});
				const result = await deployToAzure(dir, {
					environmentName: AZD_DEPLOYMENT_ENVIRONMENT,
					subscription: deploymentSubscription,
					location: AZD_DEPLOYMENT_LOCATION,
					noPrompt: true,
					onStatus: (patch) => {
						Object.assign(entry, patch);
						broadcast(entry, "state", snapshot(entry));
					},
					onOutput: (event) => appendDeploymentOutput(entry, event),
					onMilestone: (milestone) => updateDeploymentMilestone(entry, milestone),
					onProcessExit: (exitInfo) => {
						entry.deployment.cancel = null;
						entry.deployment.endedAt = Date.now();
						entry.deployment.message = exitInfo.message;
						entry.deployment.status = exitInfo.cancelled ? "cancelled" : exitInfo.ok ? "succeeded" : "failed";
						entry.deployStatus = deploymentSummary(entry.deployment);
						cmdEnd(entry, c, { ok: exitInfo.ok, note: exitInfo.message });
						endAzdOperation(entry, "deploy");
						broadcast(entry, "state", snapshot(entry));
					},
				});
				if (result.ok) entry.deployment.cancel = result.cancel;
				return { ...result, cancel: undefined };
			})()
				.then((result) => responseJson(res, result))
				.catch((error) => {
					const message = redactDeploymentOutput(shortError(error));
					entry.deployment.cancel = null;
					entry.deployment.endedAt = Date.now();
					entry.deployment.status = "failed";
					entry.deployment.message = message;
					const lastSequence = entry.deployment.output.at(-1)?.sequence || 0;
					appendDeploymentOutput(entry, {
						sequence: lastSequence + 1,
						stream: "stderr",
						text: `Deployment setup failed: ${message}`,
						at: Date.now(),
					});
					entry.deployStatus = deploymentSummary(entry.deployment);
					endAzdOperation(entry, "deploy");
					broadcast(entry, "state", snapshot(entry));
					responseJson(res, { ok: false, message });
				});
			return;
		}

		if (req.method === "POST" && req.url === "/deploy-azure/cancel") {
			if (!entry.azdOperation.active || entry.azdOperation.kind !== "deploy" || !entry.deployment.cancel) {
				responseJson(res, { ok: false, message: "No Azure deployment is currently running." });
				return;
			}
			const cancelled = entry.deployment.cancel();
			entry.deployment.cancelRequested = cancelled;
			entry.deployStatus = deploymentSummary(entry.deployment);
			broadcast(entry, "state", snapshot(entry));
			responseJson(res, {
				ok: cancelled,
				message: cancelled
					? "Stop requested for the local azd command. Azure operations already submitted may continue."
					: "azd had already exited.",
			});
			return;
		}

		res.writeHead(404);
		res.end("Not found");
	});

	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address();
	entry.server = server;
	entry.url = `http://127.0.0.1:${port}/`;
	return entry;
}

const canvas = createCanvas({
	id: "intelligent-function-app-studio",
	displayName: "Functions Hosted Skills Studio",
	description:
		"Build and run Hosted Skills in a local Function App, or select an existing Azure Function App to invoke remotely.",
	actions: [
		{
			name: "set_trigger",
			description:
				"Choose which implemented trigger (Timer, HTTP, local Azure Storage Queue, or Microsoft 365 Inbox dry run) manual invoke uses.",
			inputSchema: {
				type: "object",
				properties: { trigger: { type: "string", enum: ["timer", "http", "queue", "connector"] } },
				required: ["trigger"],
			},
			async handler({ input, instanceId }) {
				const entry = ensureEntry(instanceId);
				const trigger = TRIGGER_TYPES.find((item) => item.id === input.trigger);
				if (!trigger || trigger.nyi) return { ok: false, message: `Trigger ${input.trigger} is not implemented.` };
				try {
					assertWorkspaceMutationAllowed(entry, "Changing triggers");
				} catch (error) {
					return { ok: false, message: shortError(error) };
				}
				const changed = entry.trigger !== trigger.id;
				entry.trigger = trigger.id;
				broadcast(entry, "state", snapshot(entry));
				if (changed && entry.sourceWorkspace.materialized) await syncGeneratedTriggerFiles(entry);
				if (changed && entry.target === "local") {
					try {
						await restartLocalEnvironment(entry);
					} catch (error) {
						return { ok: false, trigger: entry.trigger, message: shortError(error) };
					}
				}
				return { ok: true, trigger: entry.trigger };
			},
		},
		{
			name: "set_target",
			description: "Choose whether Invoke/Load test act against the local func host or a selected Azure Function App.",
			inputSchema: { type: "object", properties: { target: { type: "string", enum: ["local", "azure"] } }, required: ["target"] },
			async handler({ input, instanceId }) {
				const entry = ensureEntry(instanceId);
				entry.target = input.target;
				broadcast(entry, "state", snapshot(entry));
				if (input.target === "azure") {
					stopLocal(entry);
					await ensureAzureSubscriptions(entry);
				} else {
					if (!["timer", "http"].includes(entry.trigger)) entry.trigger = "timer";
					try {
						await startLocalEnvironment(entry);
					} catch (error) {
						return { ok: false, target: entry.target, message: shortError(error) };
					}
				}
				return { ok: true, target: entry.target };
			},
		},
		{
			name: "set_timer_schedule",
			description: "Set the Timer trigger to run daily, weekly, or hourly using local-time fields where applicable.",
			inputSchema: {
				type: "object",
				properties: {
					cadence: { type: "string", enum: ["daily", "weekly", "hourly"] },
					localTime: { type: "string", description: "Local 24-hour time in HH:mm format for Daily or Weekly." },
					weekday: { type: "integer", minimum: 0, maximum: 6, description: "Local weekday for Weekly, where 0 is Sunday." },
					hourlyMinute: { type: "integer", minimum: 0, maximum: 59, description: "Minute within each hour for Hourly." },
				},
				required: ["cadence"],
			},
			async handler({ input, instanceId }) {
				const entry = ensureEntry(instanceId);
				try {
					await setTimerSchedule(entry, input);
					return {
						ok: true,
						cadence: entry.timerSchedule.cadence,
						localTime: entry.timerSchedule.localTime,
						weekday: entry.timerSchedule.weekday,
						hourlyMinute: entry.timerSchedule.hourlyMinute,
						expression: entry.timerSchedule.expression,
					};
				} catch (error) {
					return { ok: false, message: shortError(error) };
				}
			},
		},
		{
			name: "start_local_function",
			description: "Start the local Azure Functions host for the working copy, preparing Core Tools, Azurite, and the Python environment as needed.",
			inputSchema: { type: "object", properties: {} },
			async handler({ instanceId }) {
				const entry = ensureEntry(instanceId);
				if (entry.target !== "local") return { ok: false, message: "Select New local function first." };
				try {
					await startLocalEnvironment(entry);
					return { ok: true, port: entry.local.port };
				} catch (error) {
					return { ok: false, message: shortError(error) || String(error?.message || error) };
				}
			},
		},
		{
			name: "run_doctor",
			description:
				"Run a fast, read-only readiness check over every local dependency this canvas needs (uv, Python 3.13+, Azure Functions Core Tools, Node.js, Azurite, Azure CLI, Azure CLI sign-in) and report exactly what is ready, missing, stale, or fixable. Never installs anything, never starts a login flow, and never creates or modifies Azure resources.",
			inputSchema: { type: "object", properties: {} },
			async handler({ instanceId }) {
				const entry = ensureEntry(instanceId);
				if (entry.doctorRunning) return { ok: false, message: "Doctor is already running." };
				entry.doctorRunning = true;
				broadcast(entry, "state", snapshot(entry));
				try {
					const doctor = await runDoctor(entry);
					return { ok: true, ready: doctor.ready, checks: doctor.checks };
				} catch (error) {
					return { ok: false, message: shortError(error) || String(error?.message || error) };
				} finally {
					entry.doctorRunning = false;
					broadcast(entry, "state", snapshot(entry));
				}
			},
		},
		{
			name: "refresh_model_bindings",
			description: "Discover existing Microsoft Foundry projects/deployments and AI Gateway governed models.",
			inputSchema: {
				type: "object",
				properties: {
					subscription: { type: "string" },
					source: { type: "string", enum: ["foundry", "gateway"] },
				},
			},
			async handler({ input, instanceId }) {
				const entry = ensureEntry(instanceId);
				try {
					await initializeModelBindings(entry);
					const subscription = input?.subscription || entry.modelBinding.subscription;
					await discoverModelBindings(entry, subscription);
					if (input?.source === "gateway") requireGatewayCapability(entry.modelBinding.gatewayCapability);
					return {
						ok: true,
						foundryProjects: entry.modelBinding.foundry.length,
						gateways: entry.modelBinding.gateways.length,
					};
				} catch (error) {
					return { ok: false, message: shortError(error) };
				}
			},
		},
		{
			name: "bind_existing_model",
			description:
				"Bind the local Intelligent Functions App to an existing Microsoft Foundry deployment or governed AI Gateway model, then restart the local host.",
			inputSchema: {
				type: "object",
				properties: {
					source: { type: "string", enum: ["foundry", "gateway"] },
					resourceId: { type: "string" },
					modelId: { type: "string" },
				},
				required: ["source", "resourceId", "modelId"],
			},
			async handler({ input, instanceId }) {
				const entry = ensureEntry(instanceId);
				try {
					await initializeModelBindings(entry);
					await applyModelBinding(entry, input);
					return { ok: true, activeLabel: entry.modelBinding.activeLabel };
				} catch (error) {
					return { ok: false, message: shortError(error) };
				}
			},
		},
		{
			name: "explain_model_creation",
			description:
				"Explain exactly what Create Models would do: which real Azure/Foundry resources its model-only Bicep deployment would provision, the concrete command, and the existing-model alternative. Never provisions or modifies any Azure resource. Actually running it always requires the user's own explicit Create Models click in the canvas UI.",
			inputSchema: { type: "object", properties: {} },
			async handler({ instanceId }) {
				const entry = ensureEntry(instanceId);
				try {
					const plan = await buildModelCreationPlan(entry);
					return { ok: true, plan, note: "This only describes the plan. Nothing is created until the user clicks Create Models in the canvas." };
				} catch (error) {
					return { ok: false, message: shortError(error) };
				}
			},
		},
		{
			name: "stop_local_function",
			description: "Stop the local func host and its Azurite emulator.",
			inputSchema: { type: "object", properties: {} },
			handler({ instanceId }) {
				stopLocal(ensureEntry(instanceId));
				return { ok: true };
			},
		},
		{
			name: "select_azure_subscription",
			description: "Select which of the signed-in user's Azure subscriptions to browse Function Apps in.",
			inputSchema: { type: "object", properties: { subscription: { type: "string" } }, required: ["subscription"] },
			async handler({ input, instanceId }) {
				const entry = ensureEntry(instanceId);
				try {
					await selectSubscription(entry, input.subscription);
					return { ok: true, apps: entry.azure.apps };
				} catch (error) {
					return { ok: false, message: shortError(error) };
				}
			},
		},
		{
			name: "select_azure_function_app",
			description: "Select an existing Azure Function App (by resource id from the snapshot) as the Azure invoke/telemetry target.",
			inputSchema: { type: "object", properties: { resourceId: { type: "string" } }, required: ["resourceId"] },
			async handler({ input, instanceId }) {
				const entry = ensureEntry(instanceId);
				try {
					await selectFunctionApp(entry, input.resourceId);
					return { ok: true, functions: entry.azure.functions };
				} catch (error) {
					return { ok: false, message: shortError(error) };
				}
			},
		},
		{
			name: "select_azure_function",
			description:
				"Select one deployed function discovered on the current Azure Function App. Returns its trigger classification, support state, and invocation guidance without inferring that it is a Hosted Skill.",
			inputSchema: {
				type: "object",
				properties: { functionName: { type: "string" } },
				required: ["functionName"],
			},
			handler({ input, instanceId }) {
				const entry = ensureEntry(instanceId);
				try {
					return { ok: true, function: selectAzureFunction(entry, input.functionName) };
				} catch (error) {
					return { ok: false, message: shortError(error) };
				}
			},
		},
		{
			name: "invoke_trigger",
			description:
				"Invoke the selected local trigger or deployed Azure function. Local Queue writes only to Azurite, local Connector uses representative dry-run data, and deployed functions use documented HTTP, Timer, or safely resolved Storage Queue contracts.",
			inputSchema: {
				type: "object",
				properties: {
					prompt: {
						type: "string",
						description:
							"Optional HTTP prompt, Queue message, or Connector JSON array of representative email objects. Connector always preserves RUN MODE: DRY RUN.",
					},
					input: {
						type: "string",
						description:
							"Optional Azure trigger/test input. For HTTP it uses the Hosted Skills prompt field only when the deployed endpoint expects that convention; for Timer it is admin test input; for Queue it is the enqueued message. It never changes deployed skill instructions.",
					},
				},
			},
			async handler({ input, instanceId }) {
				const entry = ensureEntry(instanceId);
				try {
					await prepareInvocation(entry);
					const result =
						entry.target === "azure"
							? await invokeAzure(entry, input?.input)
							: await invokeLocal(entry, entry.trigger, input?.prompt);
					return { ok: true, result };
				} catch (error) {
					return { ok: false, message: shortError(error) || String(error?.message || error) };
				}
			},
		},
		{
			name: "run_load_test",
			description: "Start an oha load-test burst loop against the current HTTP endpoint.",
			inputSchema: {
				type: "object",
				properties: {
					target: { type: "string", enum: ["local", "azure"] },
					durationSec: { type: "number" },
					concurrency: { type: "number", enum: [1, 16, 32] },
					maxRps: { type: "number" },
				},
			},
			async handler({ input, instanceId }) {
				const entry = ensureEntry(instanceId);
				try {
					await startLoadTest(entry, input || {});
					return { ok: true };
				} catch (error) {
					return { ok: false, message: shortError(error) };
				}
			},
		},
		{
			name: "stop_load_test",
			description: "Stop the running load test loop.",
			inputSchema: { type: "object", properties: {} },
			handler({ instanceId }) {
				stopLoadTest(ensureEntry(instanceId));
				return { ok: true };
			},
		},
		{
			name: "clear_invocations",
			description: "Clear the persisted trigger activity feed.",
			inputSchema: { type: "object", properties: {} },
			handler({ instanceId }) {
				const entry = ensureEntry(instanceId);
				const retainedAwaiting = clearSettledInvocations(entry);
				return { ok: true, retainedAwaiting };
			},
		},
		{
			name: "registration_completed",
			description:
				"Complete a pending GitHub Copilot App project registration after create_project and create_session.",
			inputSchema: {
				type: "object",
				properties: {
					ok: { type: "boolean" },
					projectId: { type: "string" },
					projectName: { type: "string" },
					sessionId: { type: "string" },
					worktreePath: { type: "string" },
					message: { type: "string" },
				},
				required: ["ok", "message"],
			},
			handler({ input, instanceId }) {
				const entry = ensureEntry(instanceId);
				const ok = input?.ok === true;
				const message = input?.message || (ok ? "Project and worktree ready." : "Registration failed.");
				entry.openStatus = ok
					? `Session ready: ${input?.worktreePath || input?.projectName || "worktree created"}`
					: `Session creation failed: ${message}`;
				entry.appRegistration = {
					pending: false,
					ok,
					projectId: input?.projectId || "",
					projectName: input?.projectName || "",
					sessionId: input?.sessionId || "",
					worktreePath: input?.worktreePath || "",
					message,
				};
				if (entry.appRegistrationCommand) {
					cmdEnd(entry, entry.appRegistrationCommand, {
						ok,
						note: ok ? input?.worktreePath || message : message,
					});
					entry.appRegistrationCommand = null;
				}
				broadcast(entry, "state", snapshot(entry));
				return { ok, message };
			},
		},
	],
	async open({ instanceId, sessionId, session: sessionContext }) {
		const entry = ensureEntry(instanceId);
		await hydrateSourceWorkspace(entry, {
			sessionId,
			workingDirectory: sessionContext?.workingDirectory,
		});
		await loadInvocationHistory(entry);
		if (!entry.server) await startServer(entry);
		if (entry.sourceWorkspace.materialized || entry.sourceWorkspace.autoCreate) {
			const initialize =
				entry.target === "local"
					? startGeneratedWorkspace(entry)
					: ensureSourceMaterialized(entry).then(() => ensureTemplate(entry));
			initialize.catch(() => {
				/* The failure is recorded on the entry and broadcast to the UI. */
			});
		}
		return { url: entry.url, title: "Functions Hosted Skills Studio", status: "ready" };
	},
	async onClose({ instanceId }) {
		const entry = instances.get(instanceId);
		if (!entry) return;
		for (const res of entry.clients) {
			try {
				res.end();
			} catch {
				/* ignore */
			}
		}
		entry.clients = new Set();
		if (entry.server) {
			const server = entry.server;
			entry.server = null;
			entry.url = "";
			await new Promise((resolve) => server.close(() => resolve()));
		}
		stopLiveTelemetry(entry);
		stopLoadTest(entry);
		stopLocal(entry);
		entry.deployment?.cancel?.();
		// The working copy and in-memory history persist so reopening restores
		// the Studio without leaving background processes behind.
	},
});

session = await joinSession({ canvases: [canvas] });

function renderHtml() {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Functions Hosted Skills Studio</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #ffffff; --panel: #f7f6fb; --line: #e6e3f0;
    --ink: #1b1a24; --muted: #6a6775; --accent: #6b3fd6; --accent2: #7b52e0;
    --ok: #0f9d6e; --warn: #b45309; --bad: #dc2626;
  }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    background: radial-gradient(1200px 600px at 100% -12%, rgba(107,63,214,0.05), transparent), var(--bg);
    color: var(--ink); min-height: 100vh; padding: 1.75rem 1.5rem 2.5rem;
  }
  .wrap { max-width: 840px; margin: 0 auto; }
  .topline { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin-bottom: .9rem; }
  .badge {
    display: inline-block; font-size: 11px; letter-spacing: .6px; text-transform: uppercase;
    color: var(--accent2); border: 1px solid rgba(139,92,246,.35); border-radius: 999px; padding: 3px 10px;
  }
  .tag { display: inline-block; font-size: .72rem; color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 3px 10px; background: var(--panel); }
  button.tag { cursor: pointer; font: inherit; display: inline-flex; align-items: center; gap: 4px; }
  button.tag svg { width: 12px; height: 12px; flex: 0 0 auto; }
  button.tag:hover { color: var(--ink); border-color: var(--accent); }
  h1 { font-size: 1.5rem; font-weight: 700; letter-spacing: -.01em; }
  .sub { color: var(--muted); margin-top: .35rem; font-size: .92rem; line-height: 1.55; }
  .sub a { color: var(--accent2); text-decoration: none; }
  .sub a:hover { text-decoration: underline; }
  h2.sec { font-size: .74rem; text-transform: uppercase; letter-spacing: .6px; color: var(--muted); margin: 1.4rem 0 .5rem; }

  .controls { display: flex; flex-wrap: wrap; gap: .6rem; align-items: center; margin: .6rem 0; }
  .seg { display: inline-flex; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
  .seg button { background: transparent; color: var(--muted); border: none; padding: 7px 14px; font-size: .8rem; font-weight: 600; cursor: pointer; }
  .seg button.on { background: var(--accent); color: #fff; }
  .controls select {
    background: var(--panel); color: var(--ink); border: 1px solid var(--line);
    border-radius: 9px; padding: 7px 10px; font: inherit; font-size: .8rem; max-width: 300px;
  }
  .inline-note { font-size: .78rem; color: var(--muted); line-height: 1.5; }
  .inline-note.err { color: var(--bad); }
  .inline-note.warn { color: var(--warn, #d9a441); }
  .inline-note code { background: var(--panel); border: 1px solid var(--line); border-radius: 5px; padding: 1px 5px; }
  .btn.warn-outline { border: 1px solid var(--warn, #d9a441); }

  .chips { display: flex; flex-wrap: wrap; gap: .4rem; margin: .3rem 0 .8rem; }
  .trig { font-size: .76rem; font-weight: 600; border-radius: 999px; padding: 5px 12px; border: 1px solid var(--line); background: var(--panel); color: var(--muted); cursor: pointer; }
  .trig.on { background: var(--accent); color: #fff; border-color: var(--accent); }
  .trig.nyi { cursor: not-allowed; opacity: .55; }
  .trig .nyi-tag { font-size: .6rem; margin-left: 5px; text-transform: uppercase; letter-spacing: .3px; }
  .timer-schedule { display: flex; flex-wrap: wrap; align-items: center; gap: .45rem; margin: -.35rem 0 1rem; color: var(--muted); font-size: .8rem; }
  .timer-schedule select, .timer-schedule input {
    background: var(--panel); color: var(--ink); border: 1px solid var(--line);
    border-radius: 8px; padding: 5px 8px; font: inherit; font-size: .78rem;
  }
  .timer-schedule input[type=time] { width: 112px; }
  .timer-schedule input[type=number] { width: 62px; }
  .timer-fields { display: inline-flex; align-items: center; gap: .45rem; }
  .timer-fields[hidden] { display: none; }
  .timer-schedule .schedule-status { font-size: .72rem; }
  .timer-schedule .schedule-status.err { color: var(--bad); }

  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; margin-bottom: 1rem; }
  .panel h3 {
    font-size: .74rem; text-transform: uppercase; letter-spacing: .6px; color: var(--muted);
    padding: .8rem 1rem; border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; align-items: center;
  }
  .panel .body { padding: .85rem 1rem; }
  .list { max-height: 280px; overflow-y: auto; }
  .row { display: flex; gap: .75rem; padding: .65rem 1rem; border-bottom: 1px solid var(--line); align-items: flex-start; }
  .row:last-child { border-bottom: none; }
  .row .tagcol {
    flex: 0 0 auto; font-size: .66rem; font-weight: 700; text-transform: uppercase; letter-spacing: .4px;
    color: var(--accent2); border: 1px solid rgba(123,82,224,.3); border-radius: 6px; padding: 3px 7px; height: fit-content; white-space: nowrap;
  }
  .row .tagcol.bad { color: var(--bad); border-color: rgba(220,38,38,.35); }
  .row .tagcol.ok { color: var(--ok); border-color: rgba(15,157,110,.35); }
  .row .meta { min-width: 0; }
  .row .meta .s { font-size: .85rem; overflow-wrap: anywhere; }
  .row .meta .t { font-size: .7rem; color: var(--muted); margin-top: 2px; }
  .empty { padding: 1.2rem 1rem; color: var(--muted); font-size: .84rem; font-style: italic; text-align: center; }

  .cmdlog {
    margin: 0 0 1rem; border: 1px solid var(--line); border-radius: 12px;
    background: var(--panel); overflow: hidden;
  }
  .cmdlog > summary {
    cursor: pointer; padding: .7rem .9rem; font-size: .82rem; font-weight: 650;
    display: flex; align-items: center; gap: .5rem; list-style: none;
  }
  .cmdlog > summary::-webkit-details-marker { display: none; }
  .cmdlog > summary::before { content: "›"; color: var(--accent); font-size: 1rem; transition: transform .2s; }
  .cmdlog[open] > summary::before { transform: rotate(90deg); }
  .cmdlog .ttl { letter-spacing: .2px; }
  .cmdlog-sub { color: var(--muted); font-weight: 400; font-size: .74rem; }
  .cmdlog-list { padding: 0 .65rem .65rem; display: grid; gap: .55rem; max-height: 360px; overflow-y: auto; }
  .cmd {
    border: 1px solid var(--line); border-radius: 10px; padding: .6rem .7rem;
    background: #fff; box-shadow: 0 6px 18px rgba(32,24,64,.04);
  }
  .cmd.run { border-color: rgba(107,63,214,.45); box-shadow: 0 0 0 1px rgba(107,63,214,.08); }
  .cmd.err { border-color: rgba(220,38,38,.35); }
  .cmd .chead { display: flex; flex-wrap: wrap; align-items: center; gap: .42rem; font-size: .78rem; }
  .cmd .ckind {
    font-size: .62rem; font-weight: 750; text-transform: uppercase; letter-spacing: .4px;
    border-radius: 5px; padding: 2px 7px; border: 1px solid var(--line); color: var(--muted);
  }
  .cmd .ckind.az, .cmd .ckind.app { color: var(--accent); border-color: rgba(107,63,214,.4); }
  .cmd .ckind.rest { color: #b42373; border-color: rgba(180,35,115,.35); }
  .cmd .ckind.shell { color: #9a6700; border-color: rgba(154,103,0,.35); }
  .cmd .ctitle { font-weight: 650; }
  .cmd .cst { font-size: .66rem; border-radius: 999px; padding: 2px 8px; border: 1px solid var(--line); }
  .cmd .cst.ok { color: var(--ok); border-color: rgba(15,157,110,.35); }
  .cmd .cst.err { color: var(--bad); border-color: rgba(220,38,38,.35); }
  .cmd .cst.run { color: var(--accent); border-color: rgba(107,63,214,.4); }
  .cmd .ctime { font-size: .68rem; color: var(--muted); font-variant-numeric: tabular-nums; }
  .cmd .cms { font-size: .68rem; color: var(--muted); font-variant-numeric: tabular-nums; }
  .cmd .cnote { font-size: .68rem; color: var(--muted); margin-left: auto; }
  .cmd .cpurpose { font-size: .74rem; color: var(--muted); margin: .4rem 0 0; line-height: 1.45; }
  .cmd .ccmd {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .72rem;
    color: var(--ink); background: #f1eff8; border: 1px solid #e9e4f7; border-radius: 8px;
    padding: .55rem .65rem; margin-top: .45rem; white-space: pre-wrap; word-break: break-word; line-height: 1.5;
  }

  .inv-panel { margin: 0 0 1rem; border: 1px solid var(--line); border-radius: 12px; background: var(--panel); overflow: hidden; }
  .inv-title {
    padding: .7rem .9rem; display: flex; justify-content: space-between; align-items: center;
    font-size: .82rem; font-weight: 650; border-bottom: 1px solid var(--line);
  }
  .inv-title span:last-child { color: var(--muted); font-size: .74rem; font-weight: 500; }
  .inv-list { padding: .65rem; display: grid; gap: .55rem; max-height: 320px; overflow-y: auto; }
  .invocation { border: 1px solid var(--line); border-radius: 10px; padding: .65rem .7rem; background: #fff; }
  .invocation.ok { border-left: 3px solid var(--ok); }
  .invocation.bad { border-left: 3px solid var(--bad); }
  .invocation.run { border-left: 3px solid var(--accent); background: rgba(107,63,214,.035); }
  .inv-head { display: flex; flex-wrap: wrap; align-items: center; gap: .42rem; }
  .inv-badge {
    color: var(--accent); border: 1px solid rgba(107,63,214,.35); border-radius: 6px;
    padding: 2px 7px; font-size: .64rem; font-weight: 750; text-transform: uppercase; letter-spacing: .35px;
  }
  .inv-target { font-size: .74rem; font-weight: 650; }
  .inv-status { font-size: .68rem; color: var(--muted); }
  .inv-time { margin-left: auto; font-size: .68rem; color: var(--muted); font-variant-numeric: tabular-nums; }
  .inv-note { margin-top: .4rem; color: var(--ink); font-size: .78rem; line-height: 1.45; }
  .digest-panel {
    display: none; margin: 0 0 1rem; border: 1px solid rgba(107,63,214,.3);
    border-radius: 12px; background: var(--panel); overflow: hidden;
    box-shadow: 0 8px 24px rgba(28,18,51,.06);
  }
  .digest-panel.show { display: block; }
  .digest-head {
    display: flex; flex-wrap: wrap; align-items: baseline; gap: .55rem;
    padding: .8rem 1rem; border-bottom: 1px solid var(--line);
  }
  .digest-head strong { font-size: .82rem; color: var(--ink); }
  .digest-meta { color: var(--muted); font-size: .7rem; }
  .digest-body { padding: .9rem 1rem; font-size: .82rem; line-height: 1.55; color: var(--ink); }
  .digest-body h1, .digest-body h2, .digest-body h3 { margin: .9rem 0 .35rem; line-height: 1.25; }
  .digest-body h1:first-child, .digest-body h2:first-child, .digest-body h3:first-child { margin-top: 0; }
  .digest-body h1 { font-size: 1.15rem; }
  .digest-body h2 { font-size: 1rem; }
  .digest-body h3 { font-size: .9rem; }
  .digest-body p { margin: .45rem 0; }
  .digest-body ul, .digest-body ol { margin: .4rem 0 .6rem; padding-left: 1.35rem; }
  .digest-body li { margin: .2rem 0; }
  .digest-body code { font-family: var(--font-mono, ui-monospace, monospace); font-size: .75rem; background: rgba(107,63,214,.08); padding: 1px 4px; border-radius: 4px; }
  .digest-body a { color: var(--accent2); text-decoration: none; }
  .digest-body a:hover { text-decoration: underline; }

  .instr summary {
    cursor: pointer; list-style: none; display: flex; align-items: center; gap: .5rem;
    font-size: .74rem; text-transform: uppercase; letter-spacing: .6px; color: var(--muted);
    background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: .7rem 1rem;
  }
  .instr summary::-webkit-details-marker { display: none; }
  .instr summary::before { content: "›"; color: var(--accent); font-size: 1rem; transition: transform .2s; }
  .instr[open] summary::before { transform: rotate(90deg); }
  .instr summary > span:first-child { flex: 1 1 auto; }
  .instr[open] summary { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
  .instr .ibody { background: var(--panel); border: 1px solid var(--line); border-top: none; border-radius: 0 0 12px 12px; padding: .8rem 1rem; }
  .instr pre {
    white-space: pre-wrap; overflow-wrap: anywhere; font-size: .78rem; line-height: 1.55; color: var(--ink);
    max-height: 180px; overflow-y: auto; background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: .6rem .7rem;
  }
  .instr .row2 { display: flex; gap: .5rem; margin-top: .6rem; align-items: center; }

  .btn {
    border: none; cursor: pointer; border-radius: 10px; padding: 10px 16px;
    font-size: .86rem; font-weight: 600; color: #fff;
    background: var(--accent);
    display: inline-flex; align-items: center; gap: .45rem;
  }
  .btn svg { width: 15px; height: 15px; flex: 0 0 auto; }
  .btn:hover { filter: brightness(1.06); }
  .btn.ghost { background: transparent; color: var(--muted); border: 1px solid var(--line); }
  .btn.ghost:hover { color: var(--ink); }
  .btn[hidden] { display: none; }
  .btn:disabled { opacity: .5; cursor: not-allowed; filter: none; }
  .invoke-spinner { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,.45); border-top-color: #fff; border-radius: 50%; animation: invoke-spin .8s linear infinite; display: none; }
  #invoke.running .invoke-spinner { display: inline-block; }
  @keyframes invoke-spin { to { transform: rotate(360deg); } }
  .bar { display: flex; flex-wrap: wrap; gap: .6rem; margin: 1rem 0 .45rem; align-items: center; }
  .status { min-height: 1.1rem; color: var(--muted); font-size: .78rem; margin: 0 0 1rem; }
  .status a { color: var(--accent2); text-decoration: none; }
  .status a:hover { text-decoration: underline; }
  ${COMMAND_CSS}
  .btn { background: var(--accent); color: #fff; }
  .btn.ghost { background: transparent; color: var(--muted); border: 1px solid var(--line); }
  #deploy-azure svg { color: var(--accent); }
  .section-label { font-size: .72rem; font-weight: 700; letter-spacing: .08em; color: var(--muted); margin: 1.5rem 0 .55rem; }

  .fields { display: flex; flex-wrap: wrap; gap: .6rem; align-items: center; margin: .5rem 0; }
  .fields label { font-size: .74rem; color: var(--muted); display: flex; flex-direction: column; gap: 3px; }
  .fields input[type=number], .fields input[type=text], .fields select {
    background: #fff; color: var(--ink); border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px; font: inherit; font-size: .8rem; width: 90px;
  }
  .fields input[type=text] { width: 260px; }
  .trigger-test-input { margin: .65rem 0 1rem; }
  .trigger-test-input label { display: block; color: var(--muted); font-size: .74rem; font-weight: 600; }
  .trigger-test-input textarea {
    width: 100%; min-height: 64px; margin-top: .35rem; resize: vertical;
    background: #fff; color: var(--ink); border: 1px solid var(--line); border-radius: 8px;
    padding: 8px 10px; font: .78rem/1.4 ui-monospace, "SFMono-Regular", Menlo, monospace;
  }
  .model-binding { margin: .65rem 0 1rem; }
  .model-binding > summary {
    cursor: pointer; list-style: none; display: flex; align-items: flex-start; gap: .65rem;
    padding: .75rem .9rem; font-size: .8rem;
  }
  .model-binding > summary::-webkit-details-marker { display: none; }
  .model-binding > summary::before { content: "›"; color: var(--accent); font-size: 1rem; transition: transform .2s; margin-top: .1rem; }
  .model-binding[open] > summary::before { transform: rotate(90deg); }
  .model-binding[open] > summary { border-bottom: 1px solid var(--line); }
  .model-binding .model-summary { min-width: 0; flex: 1 1 auto; display: flex; flex-wrap: wrap; align-items: baseline; gap: .35rem .55rem; }
  .model-binding .model-summary strong { color: var(--ink); font-size: .8rem; flex: 0 0 auto; }
  .model-binding .model-summary-detail { color: var(--muted); flex: 1 1 220px; min-width: 0; white-space: normal; overflow-wrap: anywhere; }
  .model-binding .model-summary-detail.err { color: var(--bad); }
  .model-binding > summary .tag { margin-left: auto; flex: 0 0 auto; }
  .model-binding .endpoint-mode { margin-bottom: .8rem; }
  .model-binding .fields { align-items: end; }
  .model-binding .fields label { flex: 1 1 180px; }
  .model-binding .fields select { width: 100%; min-width: 160px; }
  .model-binding .model-actions { display: flex; flex-wrap: wrap; align-items: center; gap: .55rem; margin-top: .7rem; }
  .model-binding .model-status { color: var(--muted); font-size: .76rem; }
  .model-binding .model-status.ok { color: var(--ok); }
  .model-binding .model-status.err { color: var(--bad); }
  .model-binding .model-status.warn { color: var(--warn, #d9a441); }
  .model-binding .model-create-resources { margin: .5rem 0; padding-left: 1.1rem; font-size: .78rem; color: var(--ink); }
  .model-binding .model-create-resources li { margin-bottom: .25rem; }
  .model-binding .model-create-alt { white-space: normal; overflow-wrap: anywhere; margin-top: .45rem; }

  .doctor-panel { border: 1px solid var(--line); border-radius: 10px; padding: .75rem .9rem; margin: .65rem 0 1rem; background: #fff; }
  .doctor-panel[hidden] { display: none; }
  .doctor-head { display: flex; align-items: center; gap: .65rem; flex-wrap: wrap; }
  .doctor-head .tag.ok { color: var(--ok); border-color: rgba(15,157,110,.35); }
  .doctor-head .tag.err { color: var(--bad); border-color: rgba(220,38,38,.35); }
  .doctor-note { color: var(--muted); font-size: .74rem; margin: .4rem 0 0; }
  .doctor-list { margin-top: .7rem; display: flex; flex-direction: column; gap: .5rem; }
  .doctor-row { border: 1px solid var(--line); border-radius: 8px; padding: .55rem .7rem; }
  .doctor-row-head { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .doctor-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; background: var(--muted); }
  .doctor-row.ok .doctor-dot { background: var(--ok); }
  .doctor-row.warn .doctor-dot { background: #b45309; }
  .doctor-row.err .doctor-dot { background: var(--bad); }
  .doctor-row-head strong { font-size: .8rem; color: var(--ink); }
  .doctor-status { font-size: .68rem; text-transform: uppercase; letter-spacing: .3px; color: var(--muted); margin-left: auto; }
  .doctor-row.ok .doctor-status { color: var(--ok); }
  .doctor-row.warn .doctor-status { color: #b45309; }
  .doctor-row.err .doctor-status { color: var(--bad); }
  /* Doctor/warning text must always be fully readable, never clipped: wrap
     long lines instead of truncating them with an ellipsis. */
  .doctor-detail, .doctor-fix { font-size: .76rem; color: var(--muted); margin-top: .3rem; white-space: normal; overflow-wrap: anywhere; }
  .doctor-fix { color: var(--ink); }
  .build-stamp { margin-top: 1rem; color: var(--muted); font: 10px/1.2 ui-monospace, "SFMono-Regular", Menlo, monospace; text-align: right; opacity: .7; }
  .local-path {
    margin: .35rem 0 .8rem; padding: .65rem .75rem; border: 1px solid var(--line);
    border-radius: 10px; background: var(--panel);
  }
  .local-path[hidden], .local-path-editor[hidden] { display: none; }
  .local-path-head { display: flex; align-items: center; gap: .55rem; min-width: 0; }
  .local-path-label { color: var(--muted); font-size: .72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; flex: 1 1 auto; }
  .local-path code { color: var(--ink); font: .76rem/1.4 ui-monospace, "SFMono-Regular", Menlo, monospace; overflow-wrap: anywhere; }
  .local-path-value { display: block; margin-top: .35rem; }
  .path-action {
    border: 0; background: transparent; color: var(--accent2); cursor: pointer;
    padding: 3px 4px; font: 600 .74rem/1 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .path-action:hover { text-decoration: underline; }
  .path-action:disabled { opacity: .5; cursor: not-allowed; text-decoration: none; }
  .local-path-editor { margin-top: .65rem; padding-top: .65rem; border-top: 1px solid var(--line); }
  .local-path-editor label { display: block; color: var(--muted); font-size: .72rem; }
  .local-path-editor input {
    width: 100%; margin-top: .3rem; background: #fff; color: var(--ink); border: 1px solid var(--line);
    border-radius: 8px; padding: 7px 9px; font: .78rem ui-monospace, "SFMono-Regular", Menlo, monospace;
  }
  .local-path-actions { display: flex; align-items: center; gap: .3rem; margin-top: .5rem; flex-wrap: wrap; }
  .btn.compact { padding: 6px 10px; border-radius: 8px; font-size: .75rem; }
  .btn.danger-text { margin-left: auto; background: transparent; color: var(--bad); border: 0; }
  .btn.danger-text:hover { background: rgba(220,38,38,.06); filter: none; }
  .local-path .inline-note { margin-top: .45rem; }

  .chart { border: 1px solid var(--line); border-radius: 10px; background: #fff; padding: .6rem .7rem; }
  .chart svg { display: block; width: 100%; height: 90px; }
  .stat-row { display: flex; flex-wrap: wrap; gap: .5rem 1.2rem; margin-top: .5rem; font-size: .78rem; color: var(--muted); }
  .stat-row b { color: var(--ink); font-variant-numeric: tabular-nums; }

  .loglines { background: #0b1120; color: #cdd6f4; font-family: ui-monospace, monospace; font-size: .72rem; line-height: 1.5;
    max-height: 200px; overflow-y: auto; padding: .6rem .7rem; border-radius: 10px; white-space: pre-wrap; overflow-wrap: anywhere; }
  .load-terminal { margin: .7rem 0; border-radius: 10px; overflow: hidden; border: 1px solid #202a3b; background: #0b1120; }
  .load-terminal-head { display: flex; align-items: center; gap: .45rem; padding: .48rem .65rem; color: #a9b5ca;
    background: #111a2b; border-bottom: 1px solid #202a3b; font: 600 .7rem ui-monospace, SFMono-Regular, Menlo, monospace; }
  .load-terminal-dot { width: 7px; height: 7px; border-radius: 50%; background: #8b5cf6; box-shadow: 0 0 8px rgba(139,92,246,.8); }
  .load-terminal pre { margin: 0; min-height: 88px; max-height: 220px; overflow-y: auto; padding: .7rem;
    background: #0b1120; color: #dbe5f7; font: .72rem/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
  .deployment-output { margin: -.2rem 0 1rem; }
  .deployment-output[hidden] { display: none; }
  .deployment-output .body { padding: 0 .65rem .65rem; }
  .deployment-phases { display: flex; flex-wrap: wrap; gap: .45rem; margin-bottom: .6rem; }
  .deployment-phase { border: 1px solid var(--line); border-radius: 999px; padding: 3px 8px; color: var(--muted); font-size: .68rem; }
  .deployment-phase.started { color: var(--accent2); }
  .deployment-phase.completed { color: var(--ok); }
  .deployment-phase.failed, .deployment-phase.cancelled { color: var(--bad); }
  .deployment-actions { display: flex; align-items: center; gap: .55rem; margin-bottom: .55rem; }
  .deployment-terminal { margin: 0; min-height: 100px; max-height: 300px; overflow: auto; border-radius: 8px; padding: .65rem;
    background: #0b1120; color: #dbe5f7; font: .72rem/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="topline">
      <span class="badge">Initial Concept</span>
      <span class="tag" id="target-badge">Target: Local</span>
      <span class="tag" id="trigger-badge">Trigger: Timer</span>
      <button class="tag" id="doctor-toggle" aria-expanded="false">
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M2.5 2C2.22386 2 2 2.22386 2 2.5V7.50003C2 9.8163 3.75002 11.7238 6 11.9726V13C6 15.7614 8.23858 18 11 18C13.7614 18 16 15.7614 16 13V11.95C17.1411 11.7184 18 10.7095 18 9.5C18 8.11929 16.8807 7 15.5 7C14.1193 7 13 8.11929 13 9.5C13 10.7095 13.8589 11.7184 15 11.95V13C15 15.2092 13.2091 17 11 17C8.79086 17 7 15.2092 7 13V11.9726C9.24998 11.7238 11 9.8163 11 7.50003V2.5C11 2.22386 10.7761 2 10.5 2H8.5C8.22386 2 8 2.22386 8 2.5C8 2.77614 8.22386 3 8.5 3H10V7.50003C10 9.43302 8.433 11 6.5 11C4.567 11 3 9.43302 3 7.50003V3H4.5C4.77614 3 5 2.77614 5 2.5C5 2.22386 4.77614 2 4.5 2H2.5ZM15.5 8C16.3284 8 17 8.67157 17 9.5C17 10.3284 16.3284 11 15.5 11C14.6716 11 14 10.3284 14 9.5C14 8.67157 14.6716 8 15.5 8Z"/></svg>
        <span id="doctor-toggle-label">Doctor</span>
      </button>
    </div>
    <h1>Functions Hosted Skills Studio</h1>
    <p class="sub">
      Build and run <strong>Hosted Skills</strong> in a local Function App, or select an existing Azure Function App to invoke remotely.
      <a href="${DOC_URL}" target="_blank" rel="noreferrer">Docs</a>
    </p>

    <div class="doctor-panel" id="doctor-panel" hidden>
      <div class="doctor-head">
        <button class="btn ghost" id="doctor-run">Check readiness</button>
        <span class="tag" id="doctor-tag">not checked</span>
      </div>
      <p class="doctor-note">Read-only checks for uv, Python ${MIN_PYTHON_LABEL}+, Core Tools, Node.js, Azurite, and the Azure CLI (including sign-in). Never installs anything, never opens a login prompt, never touches Azure resources.</p>
      <div class="doctor-list" id="doctor-list"></div>
    </div>

    <h2 class="sec">BUILD NEW OR SELECT EXISTING</h2>
    <div class="controls">
      <div class="seg" role="tablist">
        <button id="target-local">New local function</button>
        <button id="target-azure">Azure Function App</button>
      </div>
      <select id="sub" style="display:none" title="Azure subscription"></select>
      <select id="app" style="display:none" title="Azure Function App"></select>
      <button class="btn ghost" id="refresh-apps" style="display:none" title="Reload the Function App list">Refresh</button>
    </div>
    <div class="local-path" id="source-workspace-panel">
      <div class="local-path-head">
        <span class="local-path-label">Local function path</span>
        <span class="tag" id="source-workspace-tag">creating</span>
        <button class="path-action" id="source-customize">Change</button>
      </div>
      <code class="local-path-value" id="source-path-display">Preparing…</code>
      <div class="local-path-editor" id="source-path-editor" hidden>
        <label>Subfolder in current worktree
          <input id="source-relative-path" value="functions/daily-repo-digest" autocomplete="off" spellcheck="false">
        </label>
        <div class="local-path-actions">
          <button class="btn compact" id="source-create">Move here</button>
          <button class="btn compact ghost" id="source-cancel">Cancel</button>
          <button class="btn compact danger-text" id="source-remove" hidden>Remove generated skill</button>
        </div>
      </div>
      <p class="inline-note" id="source-workspace-note"></p>
    </div>
    <div class="inline-note" id="source-note"></div>
    <h2 class="sec">MODEL ENDPOINT</h2>
    <details class="panel model-binding" id="model-binding-panel">
      <summary>
        <span class="model-summary"><strong>Existing</strong><span class="model-summary-detail" id="model-summary-detail">Discovering available models...</span></span>
        <span class="tag" id="model-binding-tag">discovering</span>
      </summary>
      <div class="body">
        <div class="seg endpoint-mode" role="tablist" aria-label="Model endpoint source">
          <button class="on" id="model-mode-existing" aria-selected="true">Existing</button>
          <button id="model-mode-create" aria-selected="false">Create Models</button>
        </div>
        <div id="model-existing-view">
          <div class="fields">
            <label>Subscription<select id="model-subscription"></select></label>
            <label>Provider
              <select id="model-source">
                <option value="foundry">Microsoft Foundry</option>
                <option value="gateway">AI Gateway</option>
              </select>
            </label>
            <label>Project or gateway<select id="model-resource"></select></label>
            <label>Model<select id="model-model"></select></label>
          </div>
          <div class="model-actions">
            <button class="btn ghost" id="model-refresh">Refresh</button>
            <span class="model-status" id="model-status"></span>
          </div>
        </div>
        <div id="model-create-view" hidden>
          <p class="inline-note">Create only the Foundry project and two model deployments used by the AI Gateway template. No Function App or hosting resources are deployed.</p>
          <ul class="model-create-resources" id="model-create-resources"></ul>
          <div class="model-actions">
            <button class="btn" id="model-create-confirm">Create Models</button>
            <span class="model-status" id="model-create-status"></span>
          </div>
          <p class="inline-note model-create-alt" id="model-create-alternatives"></p>
        </div>
      </div>
    </details>
    <div class="bar" id="local-build-actions">
      <button class="btn ghost" id="open-vscode">${ICONS.vscode}<span class="label">Open in VS Code</span></button>
      <button class="btn ghost" id="register-app-project" title="Creates a separate session from the isolated generated working copy; it does not add files to your current project." hidden>${ICONS.github}<span class="label">Create isolated GitHub Session</span></button>
      <button class="btn ghost" id="local-toggle">Start local function</button>
      <button class="btn ghost" id="deploy-azure">${ICONS.azure}<span class="label">Deploy to Azure</span></button>
    </div>
    <div class="inline-note" id="local-note" hidden></div>
    <div class="inline-note" id="code-location" hidden></div>
    <details class="cmdlog deployment-output" id="deployment-output" hidden>
      <summary><span class="ttl">Deployment output</span><span class="cmdlog-sub" id="deployment-summary"></span></summary>
      <div class="body">
        <div class="deployment-phases" id="deployment-phases"></div>
        <div class="deployment-actions">
          <button class="btn compact ghost" id="deployment-cancel" hidden>Cancel deployment</button>
          <span class="inline-note" id="deployment-output-note"></span>
        </div>
        <pre class="deployment-terminal" id="deployment-terminal">Waiting for deployment output.</pre>
      </div>
    </details>

    <h2 class="sec">Trigger</h2>
    <div class="chips" id="triggers"></div>
    <div class="trigger-test-input" id="trigger-test-input-wrap" hidden>
      <label><span id="trigger-test-input-label">Trigger/test input (optional)</span>
        <textarea id="trigger-test-input" maxlength="65536" placeholder="Optional input for this test only"></textarea>
      </label>
      <p class="inline-note" id="trigger-input-guidance"></p>
    </div>
    <div class="timer-schedule" id="timer-schedule">
      <select id="timer-cadence" aria-label="Timer cadence">
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="hourly">Hourly</option>
      </select>
      <span class="timer-fields" id="timer-daily-fields">
        <span>at</span>
        <input id="timer-time" type="time" step="60" aria-label="Daily timer time">
        <span>local time</span>
      </span>
      <span class="timer-fields" id="timer-weekly-fields" hidden>
        <select id="timer-weekday" aria-label="Weekly timer weekday">
          <option value="0">Sunday</option>
          <option value="1">Monday</option>
          <option value="2">Tuesday</option>
          <option value="3">Wednesday</option>
          <option value="4">Thursday</option>
          <option value="5">Friday</option>
          <option value="6">Saturday</option>
        </select>
        <span>at</span>
        <input id="timer-weekly-time" type="time" step="60" aria-label="Weekly timer time">
        <span>local time</span>
      </span>
      <span class="timer-fields" id="timer-hourly-fields" hidden>
        <span>at minute</span>
        <input id="timer-minute" type="number" min="0" max="59" step="1" inputmode="numeric" aria-label="Hourly timer minute">
      </span>
      <span class="schedule-status" id="timer-status"></span>
    </div>
    <div class="inline-note" id="trigger-guidance"></div>

    <details class="instr" id="instr" open>
      <summary><span>SKILL INSTRUCTIONS</span><span class="tag" id="skill-name">Skill</span></summary>
      <div class="ibody">
        <pre id="prompt-preview"></pre>
        <div class="row2">
          <button class="btn ghost" id="edit-instructions">${ICONS.vscode}<span class="label">Edit in VS Code</span></button>
        </div>
      </div>
    </details>

    <div class="section-label">TEST</div>
    <div class="bar">
      <button class="btn" id="invoke"><span class="invoke-spinner" aria-hidden="true"></span><span id="invoke-label">Invoke</span></button>
      <button class="btn ghost" id="load-test-toggle" title="Sends real throttled HTTP bursts to measure latency/throughput. Read-only against Azure (looks up URL/key/instances); never creates or changes resources.">Load test</button>
      <button class="btn ghost" id="clear-invocations" title="Clear the trigger activity feed below">Clear</button>
      <button class="btn ghost" id="open-app-insights">Open in Application Insights</button>
    </div>
    <div class="inline-note" id="invoke-gate" hidden></div>
    <div class="status" id="status"></div>

    <div class="section-label" id="observe-label">OBSERVE</div>
    <details class="instr" id="telemetry-panel" style="display:none;margin-bottom:1rem;">
      <summary><span>Live Application Insights telemetry</span><span class="tag" id="telemetry-tag">off</span></summary>
      <div class="ibody">
        <div class="inline-note">Polled every 15s. Application Insights ingestion lags ~1-5 minutes, so this is near-real-time.</div>
        <div class="stat-row" id="ai-stats"></div>
        <div class="load-terminal">
          <div class="load-terminal-head"><span class="load-terminal-dot"></span><span>Recent traces and exceptions</span></div>
          <pre id="ai-traces">Waiting for Application Insights traces.</pre>
        </div>
        <div class="inline-note err" id="ai-error"></div>
        <div class="bar" style="margin-top:.65rem;">
          <button class="btn ghost" id="telemetry-toggle">Enable telemetry</button>
        </div>
      </div>
    </details>
    <details class="instr" id="local-log-wrap" tabindex="-1" style="margin-bottom:1rem;">
      <summary><span>Local function host log</span><span class="tag" id="local-log-tag">stopped</span></summary>
      <div class="ibody"><div class="loglines" id="local-log"></div></div>
    </details>
    <div class="digest-panel" id="digest-panel">
      <div class="digest-head"><strong>Agent digest</strong><span class="digest-meta" id="digest-meta"></span></div>
      <div class="digest-body" id="digest-body"></div>
    </div>

    <details class="cmdlog" id="cmdlog" style="display:none" open>
      <summary><span class="ttl">Commands</span><span class="cmdlog-sub" id="cmdlog-sub"></span></summary>
      <div class="cmdlog-list" id="cmdlog-list"></div>
    </details>

    <div class="inv-panel">
      <div class="inv-title"><span>Trigger activity</span><span id="inv-total">0 events</span></div>
      <div class="inv-list" id="inv-list"><div class="empty">Waiting for local or Azure trigger activity.</div></div>
    </div>

    <div class="panel" id="load-test-panel" style="display:none">
      <h3><span>Load test</span><span id="load-test-status"></span></h3>
      <div class="body">
        <p class="inline-note">Sends real, throttled HTTP bursts with <code>oha</code> against your Function App's HTTP trigger - to measure latency/throughput, not to change anything. Local target hits your running <code>func start</code> host directly. Azure target first runs read-only <code>az</code> commands to look up the selected Function App's URL, host key, and instance count, then sends the same bursts to it. <strong>No Azure resource is created, modified, scaled, or deployed by this button</strong> - it only reads config/metrics and sends test traffic. Requires <code>oha</code> installed (see Doctor) and, for Local, the host already running.</p>
        <div class="fields">
          <label>Target
            <select id="lt-target"><option value="local">Local</option><option value="azure">Azure</option></select>
          </label>
          <label>Duration (s)<input type="number" id="lt-duration" min="5" max="120" /></label>
          <label>Concurrency
            <select id="lt-concurrency"><option value="1">1</option><option value="16">16</option><option value="32">32</option></select>
          </label>
          <label>Max req/s<input type="number" id="lt-rps" min="1" max="200" /></label>
        </div>
        <div class="inline-note" id="lt-note"></div>
        <div class="load-terminal">
          <div class="load-terminal-head"><span class="load-terminal-dot"></span><span>oha burst output</span></div>
          <pre id="lt-terminal">Waiting for a load test.</pre>
        </div>
        <div class="chart"><svg id="lt-chart" viewBox="0 0 600 90" preserveAspectRatio="none"></svg></div>
        <div class="stat-row" id="lt-stats"></div>
      </div>
    </div>

    <div class="build-stamp">Functions Hosted Skills Studio v${STUDIO_VERSION} &middot; rev ${STUDIO_REVISION}</div>
  </div>

<script>
${commandClientScript()}
</script>
<script>
  function localRuntimeControlState(state) {
    const localStatus = state && state.local ? state.local.status : 'stopped';
    const materialized = Boolean(state && state.sourceWorkspace && state.sourceWorkspace.materialized);
    const deploymentPreparing = Boolean(state && state.deployment && state.deployment.status === 'preparing');
    return {
      visible: !state || state.target !== 'azure',
      disabled: localStatus === 'starting' || !materialized || (deploymentPreparing && localStatus !== 'running'),
      label: localStatus === 'starting'
        ? 'Starting...'
        : localStatus === 'running' ? 'Stop local function' : 'Start local function'
    };
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }
  function inlineMarkdown(s) {
    return esc(s)
      .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
      .replace(/\\[([^\\]]+)\\]\\((https:\\/\\/[^)\\s]+)\\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
      .replace(/\`([^\`]+)\`/g, '<code>$1</code>');
  }
  function renderMarkdown(text) {
    const lines = String(text || '').replace(/\\r\\n/g, '\\n').split('\\n');
    let html = '';
    let list = '';
    function closeList() { if (list) { html += '</' + list + '>'; list = ''; } }
    lines.forEach((line) => {
      const heading = /^(#{1,3})\\s+(.+)$/.exec(line);
      const bullet = /^\\s*[-*]\\s+(.+)$/.exec(line);
      const numbered = /^\\s*\\d+[.)]\\s+(.+)$/.exec(line);
      if (heading) {
        closeList();
        const level = heading[1].length;
        html += '<h' + level + '>' + inlineMarkdown(heading[2]) + '</h' + level + '>';
      } else if (bullet || numbered) {
        const nextList = bullet ? 'ul' : 'ol';
        if (list !== nextList) { closeList(); list = nextList; html += '<' + list + '>'; }
        html += '<li>' + inlineMarkdown((bullet || numbered)[1]) + '</li>';
      } else if (!line.trim()) {
        closeList();
      } else {
        closeList();
        html += '<p>' + inlineMarkdown(line) + '</p>';
      }
    });
    closeList();
    return html;
  }
  function postJson(url, body) {
    return fetch(url, { method: 'POST', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
      .then((r) => r.json());
  }
  const statusEl = document.getElementById('status');
  function setStatus(message, url) {
    statusEl.textContent = message || '';
    if (url) {
      statusEl.textContent = 'Saved: ';
      const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noreferrer'; a.textContent = url;
      statusEl.appendChild(a);
    }
  }
  window.cmdSetStatus = setStatus;

  const targetBadge = document.getElementById('target-badge');
  const triggerBadge = document.getElementById('trigger-badge');
  const timerSchedule = document.getElementById('timer-schedule');
  const timerCadence = document.getElementById('timer-cadence');
  const timerDailyFields = document.getElementById('timer-daily-fields');
  const timerTime = document.getElementById('timer-time');
  const timerWeeklyFields = document.getElementById('timer-weekly-fields');
  const timerWeekday = document.getElementById('timer-weekday');
  const timerWeeklyTime = document.getElementById('timer-weekly-time');
  const timerHourlyFields = document.getElementById('timer-hourly-fields');
  const timerMinute = document.getElementById('timer-minute');
  const timerStatus = document.getElementById('timer-status');
  const triggerGuidance = document.getElementById('trigger-guidance');
  const targetLocalBtn = document.getElementById('target-local');
  const targetAzureBtn = document.getElementById('target-azure');
  const subSel = document.getElementById('sub');
  const appSel = document.getElementById('app');
  const refreshAppsBtn = document.getElementById('refresh-apps');
  const sourceNote = document.getElementById('source-note');
  const doctorToggleBtn = document.getElementById('doctor-toggle');
  const doctorToggleLabel = document.getElementById('doctor-toggle-label');
  const doctorPanel = document.getElementById('doctor-panel');
  const doctorRunBtn = document.getElementById('doctor-run');
  const doctorTag = document.getElementById('doctor-tag');
  const doctorList = document.getElementById('doctor-list');
  const sourceWorkspacePanel = document.getElementById('source-workspace-panel');
  const sourceWorkspaceTag = document.getElementById('source-workspace-tag');
  const sourcePathDisplay = document.getElementById('source-path-display');
  const sourceCustomize = document.getElementById('source-customize');
  const sourcePathEditor = document.getElementById('source-path-editor');
  const sourceRelativePath = document.getElementById('source-relative-path');
  const sourceCreate = document.getElementById('source-create');
  const sourceCancel = document.getElementById('source-cancel');
  const sourceRemove = document.getElementById('source-remove');
  const sourceWorkspaceNote = document.getElementById('source-workspace-note');
  const modelBindingPanel = document.getElementById('model-binding-panel');
  const modelBindingTag = document.getElementById('model-binding-tag');
  const modelSummaryDetail = document.getElementById('model-summary-detail');
  const modelSubscription = document.getElementById('model-subscription');
  const modelSource = document.getElementById('model-source');
  const modelResource = document.getElementById('model-resource');
  const modelModel = document.getElementById('model-model');
  const modelRefresh = document.getElementById('model-refresh');
  const modelStatus = document.getElementById('model-status');
  const modelModeExisting = document.getElementById('model-mode-existing');
  const modelModeCreate = document.getElementById('model-mode-create');
  const modelExistingView = document.getElementById('model-existing-view');
  const modelCreateView = document.getElementById('model-create-view');
  const modelCreateResources = document.getElementById('model-create-resources');
  const modelCreateAlternatives = document.getElementById('model-create-alternatives');
  const modelCreateConfirm = document.getElementById('model-create-confirm');
  const modelCreateStatus = document.getElementById('model-create-status');
  const localBuildActions = document.getElementById('local-build-actions');
  const registerAppProject = document.getElementById('register-app-project');
  const deployAzureBtn = document.getElementById('deploy-azure');
  const deploymentOutput = document.getElementById('deployment-output');
  const deploymentSummaryEl = document.getElementById('deployment-summary');
  const deploymentPhases = document.getElementById('deployment-phases');
  const deploymentCancel = document.getElementById('deployment-cancel');
  const deploymentOutputNote = document.getElementById('deployment-output-note');
  const deploymentTerminal = document.getElementById('deployment-terminal');
  const codeLocation = document.getElementById('code-location');
  const triggersEl = document.getElementById('triggers');
  const triggerTestInputWrap = document.getElementById('trigger-test-input-wrap');
  const triggerTestInput = document.getElementById('trigger-test-input');
  const triggerTestInputLabel = document.getElementById('trigger-test-input-label');
  const triggerInputGuidance = document.getElementById('trigger-input-guidance');
  const instructions = document.getElementById('instr');
  const skillName = document.getElementById('skill-name');
  const promptPreview = document.getElementById('prompt-preview');
  const invokeBtn = document.getElementById('invoke');
  const invokeLabel = document.getElementById('invoke-label');
  const invokeGate = document.getElementById('invoke-gate');
  const localToggleBtn = document.getElementById('local-toggle');
  const localNote = document.getElementById('local-note');
  const localLogEl = document.getElementById('local-log');
  const localLogTag = document.getElementById('local-log-tag');
  const localLogWrap = document.getElementById('local-log-wrap');
  const observeLabel = document.getElementById('observe-label');
  const openAiBtn = document.getElementById('open-app-insights');
  const loadTestToggleBtn = document.getElementById('load-test-toggle');
  const clearInvocationsBtn = document.getElementById('clear-invocations');
  const loadTestPanel = document.getElementById('load-test-panel');
  const ltTargetSel = document.getElementById('lt-target');
  const ltDuration = document.getElementById('lt-duration');
  const ltConcurrency = document.getElementById('lt-concurrency');
  const ltRps = document.getElementById('lt-rps');
  const ltNote = document.getElementById('lt-note');
  const ltChart = document.getElementById('lt-chart');
  const ltStats = document.getElementById('lt-stats');
  const ltTerminal = document.getElementById('lt-terminal');
  const ltStatus = document.getElementById('load-test-status');
  const telemetryPanel = document.getElementById('telemetry-panel');
  const telemetryToggleBtn = document.getElementById('telemetry-toggle');
  const telemetryTag = document.getElementById('telemetry-tag');
  const aiStats = document.getElementById('ai-stats');
  const aiTraces = document.getElementById('ai-traces');
  const aiError = document.getElementById('ai-error');
  const cmdlog = document.getElementById('cmdlog');
  const cmdlogList = document.getElementById('cmdlog-list');
  const cmdlogSub = document.getElementById('cmdlog-sub');
  const invList = document.getElementById('inv-list');
  const invTotal = document.getElementById('inv-total');
  const digestPanel = document.getElementById('digest-panel');
  const digestMeta = document.getElementById('digest-meta');
  const digestBody = document.getElementById('digest-body');
  let latest = null;
  let triggerInputKey = '';
  let sourceEditorOpen = false;

  function renderTriggers(state) {
    const schedule = state.timerSchedule || { cadence: 'daily', localTime: '09:00', weekday: 1, hourlyMinute: 0, status: '', error: '' };
    if (state.target === 'azure') {
      const selected = (state.azure.functions || []).find((fn) => fn.name === state.azure.functionName);
      triggersEl.innerHTML = (state.azure.functions || []).map((fn) => {
        const on = fn.name === state.azure.functionName ? ' on' : '';
        const unsupported = fn.supportsInvoke ? '' : ' nyi';
        const tag = fn.supportStatus === 'conditional'
          ? '<span class="nyi-tag">RBAC</span>'
          : fn.supportsInvoke ? '' : '<span class="nyi-tag">unsupported</span>';
        return '<button class="trig' + on + unsupported + '" data-function="' + esc(fn.name) + '" title="' + esc(fn.hostedSkillNote + '. ' + fn.guidance) + '">' + esc(fn.name + ' · ' + fn.label) + tag + '</button>';
      }).join('') || '<span class="inline-note">Select an app to discover its deployed functions and trigger bindings.</span>';
      triggerBadge.textContent = selected ? ('Function: ' + selected.name + ' · ' + selected.label) : 'Trigger: none';
    } else {
      triggersEl.innerHTML = state.triggerTypes.map((t) => {
        const on = t.id === state.trigger ? ' on' : '';
        const nyi = t.nyi ? ' nyi' : '';
        const tag = t.nyi ? '<span class="nyi-tag">NYI</span>' : '';
        const title = t.nyi ? 'Not implemented in this canvas yet' : 'Manually invoke via ' + t.label;
        return '<button class="trig' + on + nyi + '" data-id="' + t.id + '" title="' + title + '"' + (t.nyi || !state.sourceWorkspace.materialized || state.azdOperation.active ? ' disabled' : '') + '>' + t.label + tag + '</button>';
      }).join('');
      triggerBadge.textContent = 'Trigger: ' + ((state.triggerTypes.find((t) => t.id === state.trigger) || {}).label || 'none');
    }
    const showTimerSchedule = state.trigger === 'timer' && state.target === 'local';
    timerSchedule.style.display = showTimerSchedule ? '' : 'none';
    const cadence = schedule.cadence || 'daily';
    if (document.activeElement !== timerCadence) timerCadence.value = cadence;
    timerDailyFields.hidden = cadence !== 'daily';
    timerWeeklyFields.hidden = cadence !== 'weekly';
    timerHourlyFields.hidden = cadence !== 'hourly';
    if (document.activeElement !== timerTime) timerTime.value = schedule.localTime || '09:00';
    if (document.activeElement !== timerWeeklyTime) timerWeeklyTime.value = schedule.localTime || '09:00';
    if (document.activeElement !== timerWeekday) timerWeekday.value = String(schedule.weekday == null ? 1 : schedule.weekday);
    if (document.activeElement !== timerMinute) timerMinute.value = String(schedule.hourlyMinute == null ? 0 : schedule.hourlyMinute);
    timerStatus.textContent = schedule.error || schedule.status || '';
    timerStatus.className = 'schedule-status' + (schedule.error ? ' err' : '');
    const scheduleDisabled = Boolean(state.local.status === 'starting' || !state.sourceWorkspace.materialized || state.azdOperation.active);
    [timerCadence, timerTime, timerWeekday, timerWeeklyTime, timerMinute].forEach((control) => { control.disabled = scheduleDisabled; });
    const support = state.triggerSupport || {};
    if (state.trigger === 'queue') {
      const queue = support.queue || {};
      triggerGuidance.textContent = state.target === 'local'
        ? 'Local Invoke creates the ' + (queue.queueName || 'agent-input') + ' queue in Azurite and writes one representative JSON message through the documented Azure CLI Storage commands.'
        : 'Azure Invoke writes one real test message to the selected function\\'s resolved Azure Storage queue. Use it only when triggering that deployed workload is intended.';
    } else if (state.trigger === 'connector') {
      const connector = support.connector || {};
      triggerGuidance.textContent = state.target === 'local'
        ? 'Microsoft 365 Inbox only (' + (connector.operationName || 'OnNewEmailV3') + ', Inbox). Local Invoke uses the runtime chat endpoint with representative DRY RUN Trigger data; Outlook tools are not registered locally, so it cannot call Microsoft 365. Other connectors are unsupported.'
        : 'Microsoft 365 Inbox only. Azure requires an authorized Connector Namespace OnNewEmailV3 trigger, MCP endpoint, and delegated consent. Studio does not create or invoke that webhook and blocks deployment until you configure it outside Studio; other connectors are unsupported.';
    } else if (state.trigger === 'blob' || state.trigger === 'cosmos') {
      triggerGuidance.textContent = 'This trigger is not supported in Studio yet.';
    } else {
      triggerGuidance.textContent = '';
    }
    triggerGuidance.hidden = !triggerGuidance.textContent;
  }

  function renderDoctor(state) {
    const doctor = state.doctor;
    const running = Boolean(state.doctorRunning);
    doctorRunBtn.disabled = running;
    doctorRunBtn.textContent = running ? 'Checking…' : 'Check readiness';
    if (running) {
      doctorTag.textContent = 'checking…';
      doctorTag.className = 'tag';
    } else if (!doctor) {
      doctorTag.textContent = 'not checked';
      doctorTag.className = 'tag';
    } else {
      doctorTag.textContent = doctor.ready ? 'ready' : 'action needed';
      doctorTag.className = 'tag' + (doctor.ready ? ' ok' : ' err');
    }
    doctorToggleLabel.textContent = !doctor ? 'Doctor' : doctor.ready ? 'Doctor: ready' : 'Doctor: action needed';
    if (doctor && !doctor.ready && doctorPanel.hidden) {
      doctorPanel.hidden = false;
      doctorToggleBtn.setAttribute('aria-expanded', 'true');
    }
    if (!doctor) { doctorList.innerHTML = ''; return; }
    const statusLabel = { ready: 'Ready', missing: 'Missing', stale: 'Stale', error: 'Error' };
    doctorList.innerHTML = doctor.checks.map((check) => {
      const cls = check.status === 'ready' ? 'ok' : check.status === 'stale' ? 'warn' : 'err';
      return '<div class="doctor-row ' + cls + '">' +
        '<div class="doctor-row-head"><span class="doctor-dot"></span><strong>' + esc(check.label) + '</strong>' +
        '<span class="doctor-status">' + esc(statusLabel[check.status] || check.status) + (check.required ? '' : ' · optional') + '</span></div>' +
        (check.detail ? '<div class="doctor-detail">' + esc(check.detail) + '</div>' : '') +
        (check.fix ? '<div class="doctor-fix">' + esc(check.fix) + '</div>' : '') +
        '</div>';
    }).join('');
  }

  function renderModelBinding(state) {
    const binding = state.modelBinding || {};
    const readiness = binding.readiness || {};
    const resources = binding.source === 'gateway' ? (binding.gateways || []) : (binding.foundry || []);
    const resource = resources.find((item) => item.id === binding.resourceId) || resources[0];
    const model = resource && (resource.models.find((item) => item.id === binding.modelId) || resource.models[0]);
    const activeResources = binding.activeSource === 'gateway' ? (binding.gateways || []) : (binding.foundry || []);
    const activeResource = activeResources.find((item) => item.id === binding.activeResourceId);
    const activeModel = activeResource && activeResource.models.find((item) => item.id === binding.activeModelId);
    const activeModelName = activeModel ? (activeModel.label || activeModel.name || activeModel.id) : binding.activeModelId;
    const activeResourceName = activeResource
      ? (activeResource.name || activeResource.label)
      : String(binding.activeResourceId || '').split('/').filter(Boolean).pop();
    const boundSummary = binding.configured && activeModelName
      ? activeModelName + (activeResourceName ? ' · ' + activeResourceName : '')
      : '';
    // Priority: a hard discovery/apply error first, then the prescriptive
    // readiness classification (not-signed-in / no-subscription / no-account
    // / no-model / endpoint-invalid / ready / select), then the legacy
    // active-label fallback. This is what makes the six bootstrap states
    // visible instead of a generic "no active model endpoint".
    modelSummaryDetail.textContent = boundSummary
      ? boundSummary
      : binding.error
        ? binding.error
      : readiness.message
        ? readiness.message
        : binding.loading ? 'Binding selected model...' : 'No active model endpoint';
    modelSummaryDetail.className = 'model-summary-detail' + (!boundSummary && (binding.error || readiness.state === 'no-account' || readiness.state === 'no-model' || readiness.state === 'endpoint-invalid' || readiness.state === 'not-signed-in' || readiness.state === 'no-subscription') ? ' err' : '');
    modelBindingPanel.style.display = state.target === 'local' && state.sourceWorkspace.materialized ? '' : 'none';
    if (document.activeElement !== modelSubscription) {
      modelSubscription.innerHTML = (state.azure.subscriptions || []).map((item) =>
        '<option value="' + esc(item.id) + '"' + (item.id === binding.subscription ? ' selected' : '') + '>' + esc(item.name) + '</option>'
      ).join('');
    }
    modelSource.value = binding.source || 'foundry';
    if (document.activeElement !== modelResource) {
      modelResource.innerHTML = resources.length
        ? resources.map((item) => '<option value="' + esc(item.id) + '"' + (item.id === (resource || {}).id ? ' selected' : '') + '>' + esc(item.label) + '</option>').join('')
        : '<option value="">No existing resources found</option>';
    }
    if (document.activeElement !== modelModel) {
      modelModel.innerHTML = resource && resource.models.length
        ? resource.models.map((item) => '<option value="' + esc(item.id) + '"' + (item.id === (model || {}).id ? ' selected' : '') + '>' + esc(item.label) + '</option>').join('')
        : '<option value="">No deployed models found</option>';
    }
    modelBindingTag.textContent = binding.loading ? 'binding' : binding.configured ? 'ready' : (readiness.state || 'select model').replace(/-/g, ' ');
    modelBindingTag.className = 'tag' + (binding.configured ? ' ok' : '');
    modelStatus.textContent = binding.error || binding.gatewayActionError || binding.status || binding.activeLabel || readiness.message || '';
    modelStatus.className = 'model-status' + (binding.error || binding.gatewayActionError ? ' err' : binding.configured ? ' ok' : '');
    modelRefresh.disabled = Boolean(binding.loading);
    renderModelCreate(state);
  }

  // Whichever tab (Existing / Create Models) the user last clicked; a plan
  // fetched into state.modelCreate does not itself switch tabs, so this
  // stays purely a client-side view toggle.
  let modelCreateTabActive = false;
  function setModelTab(create) {
    modelCreateTabActive = create;
    modelModeExisting.classList.toggle('on', !create);
    modelModeExisting.setAttribute('aria-selected', String(!create));
    modelModeCreate.classList.toggle('on', create);
    modelModeCreate.setAttribute('aria-selected', String(create));
    modelExistingView.style.display = create ? 'none' : '';
    modelCreateView.hidden = !create;
    if (create) postJson('/models/create-plan');
  }
  modelModeExisting.addEventListener('click', () => setModelTab(false));
  modelModeCreate.addEventListener('click', () => setModelTab(true));

  function renderModelCreate(state) {
    const create = state.modelCreate || {};
    const azdOp = state.azdOperation || {};
    const blockedByDeploy = Boolean(azdOp.active && azdOp.kind !== 'create-models');
    modelCreateResources.innerHTML = (create.resources || []).map((r) =>
      '<li><strong>' + esc(r.kind) + '</strong>: ' + esc(r.note) + '</li>'
    ).join('') || '<li>Plan loading...</li>';
    modelCreateAlternatives.innerHTML = (create.alternatives || []).map((a) => esc(a)).join('<br>');
    modelCreateConfirm.disabled = Boolean(create.running) || blockedByDeploy;
    modelCreateConfirm.title = blockedByDeploy ? ((azdOp.label || 'Another azd operation') + ' is still running - wait for it to finish.') : '';
    modelCreateStatus.textContent = blockedByDeploy
      ? (azdOp.label || 'Another Azure write operation') + ' is still running. Wait for it to finish before creating models.'
      : create.running ? 'Creating Foundry models...' : (create.message || '');
    modelCreateStatus.className = 'model-status' + (blockedByDeploy ? ' warn' : create.ok === false ? ' err' : create.ok === true ? ' ok' : '');
  }

  modelCreateConfirm.addEventListener('click', async () => {
    // This explicit user click is the confirmation. Discovery, doctor, and
    // agent actions can only explain the plan and never reach this route.
    if (modelCreateConfirm.disabled) return;
    modelCreateConfirm.disabled = true;
    modelCreateStatus.textContent = 'Starting model deployment...';
    modelCreateStatus.className = 'model-status';
    await postJson('/models/create', { confirm: true });
  });
  function renderSourceWorkspace(state) {
    const source = state.sourceWorkspace || {};
    const busy = Boolean(source.operation);
    const current = source.mode === 'current';
    const showEditor = current && (sourceEditorOpen || (!source.materialized && !busy));
    sourceWorkspacePanel.hidden = state.target === 'azure';
    sourcePathDisplay.textContent = current ? (source.relativePath || 'functions/daily-repo-digest') : 'Isolated workspace';
    sourcePathDisplay.title = source.destination || '';
    sourceCustomize.hidden = !current || busy;
    sourceCustomize.disabled = busy;
    sourcePathEditor.hidden = !showEditor;
    if (document.activeElement !== sourceRelativePath) sourceRelativePath.value = source.relativePath || 'functions/daily-repo-digest';
    sourceRelativePath.disabled = busy;
    sourceCreate.disabled = busy || !source.canUseCurrent;
    sourceCreate.textContent = source.materialized ? 'Move here' : 'Create here';
    sourceCancel.disabled = busy;
    sourceRemove.hidden = !(showEditor && source.materialized && current);
    sourceRemove.disabled = busy;
    sourceWorkspaceTag.textContent = busy
      ? source.operation
      : source.materialized ? (current ? 'current worktree' : 'isolated') : source.autoCreate === false ? 'removed' : 'preparing';
    sourceWorkspaceTag.className = 'tag' + (source.materialized ? ' ok' : '');
    if (source.error) {
      sourceWorkspaceNote.hidden = false;
      sourceWorkspaceNote.className = 'inline-note err';
      sourceWorkspaceNote.textContent = source.error;
    } else if (!source.materialized && source.autoCreate === false) {
      sourceWorkspaceNote.hidden = false;
      sourceWorkspaceNote.className = 'inline-note';
      sourceWorkspaceNote.textContent = 'Removed. Choose a folder and create again whenever you want it back.';
    } else if (busy) {
      sourceWorkspaceNote.hidden = false;
      sourceWorkspaceNote.className = 'inline-note';
      sourceWorkspaceNote.textContent = source.operation === 'moving' ? 'Moving the complete generated app…' : 'Creating the generated app…';
    } else if (source.materialized && current && showEditor) {
      sourceWorkspaceNote.hidden = false;
      sourceWorkspaceNote.className = 'inline-note';
      sourceWorkspaceNote.textContent = 'Changing the path moves the complete generated app. Remove succeeds only while Studio-owned files are unchanged.';
    } else {
      sourceWorkspaceNote.hidden = true;
      sourceWorkspaceNote.textContent = '';
    }
  }

  function renderSource(state) {
    renderSourceWorkspace(state);
    renderModelBinding(state);
    targetLocalBtn.classList.toggle('on', state.target === 'local');
    targetAzureBtn.classList.toggle('on', state.target === 'azure');
    targetBadge.textContent = 'Target: ' + (state.target === 'azure' ? ('Azure' + (state.azure.app ? ' · ' + state.azure.app.name : '')) : 'Local');
    const showAzure = state.target === 'azure';
    const localControl = localRuntimeControlState(state);
    subSel.style.display = showAzure ? '' : 'none';
    appSel.style.display = showAzure ? '' : 'none';
    refreshAppsBtn.style.display = showAzure ? '' : 'none';
    sourceNote.hidden = !showAzure;
    localBuildActions.style.display = localControl.visible ? '' : 'none';
    deploymentOutput.style.display = showAzure ? 'none' : '';
    codeLocation.hidden = true;
    localLogWrap.style.display = showAzure ? 'none' : '';
    observeLabel.style.display = (!showAzure || state.azure.app) ? '' : 'none';
    openAiBtn.style.display = showAzure ? '' : 'none';
    if (showAzure) {
      if (document.activeElement !== subSel) {
        subSel.innerHTML = (state.azure.subscriptions || []).map((s) => '<option value="' + esc(s.id) + '"' + (s.id === state.azure.subscription ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('');
      }
      if (document.activeElement !== appSel) {
        appSel.innerHTML = '<option value="">Select a Function App…</option>' +
          (state.azure.apps || []).map((a) => '<option value="' + esc(a.id) + '"' + (a.id === state.azure.appId ? ' selected' : '') + '>' + esc(a.name) + ' (' + esc(a.resourceGroup) + ')</option>').join('');
      }
      let note = '';
      if (state.azure.subscriptionsError) note = state.azure.subscriptionsError;
      else if (state.azure.appsError) note = state.azure.appsError;
      else if (state.azure.app && state.azure.functionsError) note = state.azure.functionsError;
      else if (state.azure.app) {
        const selected = (state.azure.functions || []).find((fn) => fn.name === state.azure.functionName);
        note = state.azure.functions.length + ' function(s) found on ' + state.azure.app.name +
          (selected ? '. Selected ' + selected.name + ' (' + selected.label + '). ' + selected.hostedSkillNote + '. ' + selected.guidance : '');
      }
      sourceNote.textContent = note;
      sourceNote.className = 'inline-note' + ((state.azure.subscriptionsError || state.azure.appsError || state.azure.functionsError) ? ' err' : '');
    } else sourceNote.textContent = '';
    const reg = state.appRegistration || {};
    const registerLabel = registerAppProject.querySelector('.label');
    registerAppProject.disabled = Boolean(reg.pending || reg.ok === true);
    registerAppProject.title = state.sourceWorkspace.mode === 'current'
      ? 'Move the generated app out of this worktree, then create an isolated GitHub session. The current-worktree folder is removed only after the move succeeds.'
      : 'Create a separate session from the isolated generated working copy.';
    registerLabel.textContent = reg.pending
      ? 'Creating Session...'
      : reg.ok === true
        ? 'Session Ready'
        : state.sourceWorkspace.mode === 'current' ? 'Move to isolated GitHub Session' : 'Create isolated GitHub Session';
    if (state.openStatus) setStatus(state.openStatus);
  }

  function renderLocal(state) {
    const running = state.local.status === 'running';
    const localControl = localRuntimeControlState(state);
    localToggleBtn.textContent = localControl.label;
    localToggleBtn.disabled = localControl.disabled;
    localLogTag.textContent = state.local.status + (running && state.local.port ? (' · :' + state.local.port) : '');
    localNote.textContent = state.local.error || (running ? state.local.functions.map((f) => f.name + ' (' + f.kind + (f.route ? ', ' + f.route : '') + ')').join(' · ') : '');
    localNote.className = 'inline-note' + (state.local.error ? ' err' : '');
    localNote.hidden = state.target !== 'local' || !localNote.textContent;
    localLogEl.textContent = (state.local.logTail || []).join('\\n');
    localLogEl.scrollTop = localLogEl.scrollHeight;
  }

  function renderDeployment(state) {
    const deployment = state.deployment || { status: 'idle', phases: {}, output: [] };
    if (deployment.status === 'preparing' && deploymentOutput.dataset.status !== 'preparing') deploymentOutput.open = true;
    deploymentOutput.dataset.status = deployment.status;
    deploymentOutput.hidden = deployment.status === 'idle';
    deploymentSummaryEl.textContent = state.deployStatus || deployment.message || deployment.status;
    deploymentPhases.innerHTML = ['provision', 'package', 'deploy'].map((name) => {
      const phase = deployment.phases[name] || { state: 'pending' };
      const duration = phase.durationMs != null ? ' · ' + (phase.durationMs / 1000).toFixed(1) + 's' : '';
      return '<span class="deployment-phase ' + esc(phase.state) + '" title="' + esc(phase.detail || '') + '">' +
        esc(name + ': ' + phase.state + duration) + '</span>';
    }).join('');
    const running = deployment.status === 'preparing' || deployment.status === 'running';
    deploymentCancel.hidden = !running;
    deploymentCancel.disabled = Boolean(deployment.cancelRequested || deployment.status === 'preparing');
    deploymentOutputNote.textContent = deployment.outputTruncated
      ? 'Older output was removed from this bounded view.'
      : running ? 'Deployment continues while this panel is collapsed.' : '';
    const terminalText = (deployment.output || []).map((item) => '[' + item.stream + '] ' + item.text).join('\\n') ||
      (running ? 'Waiting for azd output...' : 'No deployment output was emitted.');
    if (deploymentTerminal.textContent !== terminalText) {
      const atBottom = deploymentTerminal.scrollHeight - deploymentTerminal.scrollTop - deploymentTerminal.clientHeight < 24;
      deploymentTerminal.textContent = terminalText;
      if (atBottom) deploymentTerminal.scrollTop = deploymentTerminal.scrollHeight;
    }
  }

  // Invoke is never a dead gray control: it always stays clickable. When
  // something blocks a real invocation, the click still does something
  // useful - it runs the doctor sweep, explains the exact blocker, and
  // opens the panel that fixes it, instead of silently doing nothing.
  function computeInvokeGate(state) {
    const binding = state.modelBinding || {};
    if (state.target === 'azure') {
      if (!state.azure.app) return { blocked: true, reason: 'Select an Azure Function App first.', focus: 'azure' };
      if (state.azure.functionsError) return { blocked: true, reason: state.azure.functionsError, focus: 'azure' };
      const fn = (state.azure.functions || []).find((candidate) => candidate.name === state.azure.functionName);
      if (!fn) return { blocked: true, reason: 'Select a discovered deployed function first.', focus: 'azure' };
      if (!fn.supportsInvoke) return { blocked: true, reason: fn.guidance, focus: 'azure' };
      return { blocked: false };
    }
    if (!state.sourceWorkspace.materialized) {
      return { blocked: true, reason: 'Create the generated app in the selected source location first.', focus: 'source' };
    }
    const cooldownSeconds = binding.activeSource === 'gateway'
      ? Math.max(0, Math.ceil(((binding.nextInvokeAt || 0) - Date.now()) / 1000))
      : 0;
    if (cooldownSeconds > 0) {
      return { blocked: true, reason: 'This gateway model is rate-limited for ' + cooldownSeconds + 's more before the next call.', focus: 'cooldown' };
    }
    const boundToActive = binding.configured &&
      binding.source === binding.activeSource &&
      binding.resourceId === binding.activeResourceId &&
      binding.modelId === binding.activeModelId;
    if (binding.loading) return { blocked: true, reason: 'Still binding the selected model - try again in a moment.', focus: null };
    if (!boundToActive) {
      const readiness = binding.readiness || {};
      const reason = readiness.message || 'No model endpoint is bound yet. Pick Subscription/Provider/Project/Model above, or use Create Models.';
      return { blocked: true, reason, focus: 'model' };
    }
    return { blocked: false };
  }

  function renderInvoke(state) {
    const binding = state.modelBinding || {};
    const gate = computeInvokeGate(state);
    const cooldownSeconds = state.target === 'local' && binding.activeSource === 'gateway'
      ? Math.max(0, Math.ceil(((binding.nextInvokeAt || 0) - Date.now()) / 1000))
      : 0;
    const invocationRunning = (state.invocations || []).some((item) => item.phase === 'running');
    const selectedAzure = state.target === 'azure'
      ? (state.azure.functions || []).find((fn) => fn.name === state.azure.functionName)
      : null;
    invokeLabel.textContent = invocationRunning
      ? 'Running…'
      : cooldownSeconds
        ? 'Invoke Trigger · ' + cooldownSeconds + 's'
        : selectedAzure ? 'Invoke ' + selectedAzure.name : 'Invoke Trigger';
    invokeBtn.classList.toggle('running', invocationRunning);
    invokeBtn.setAttribute('aria-busy', String(invocationRunning));
    if (invocationRunning && state.target === 'local') localLogWrap.open = true;
    invokeBtn.disabled = false;
    invokeBtn.classList.toggle('warn-outline', gate.blocked);
    invokeBtn.title = gate.blocked ? gate.reason : '';
    if (gate.blocked) {
      // Always show the blocker while genuinely blocked - no dismiss state.
      // A real blocker (no model bound, still binding, etc.) must stay
      // visible for as long as it is true, not be hideable by the user.
      invokeGate.hidden = false;
      invokeGate.className = 'inline-note warn';
      invokeGate.textContent = gate.reason;
    } else {
      invokeGate.hidden = true;
    }
    openAiBtn.disabled = !(state.target === 'azure' && state.azure.app);
    const queueInput = state.trigger === 'queue' && (state.target === 'local' || (selectedAzure && selectedAzure.kind === 'queue'));
    const nextTriggerInputKey = queueInput
      ? state.target + ':queue:' + (selectedAzure ? selectedAzure.name : 'local')
      : selectedAzure ? 'azure:' + selectedAzure.kind + ':' + selectedAzure.name : '';
    triggerTestInputWrap.hidden = !(queueInput || selectedAzure);
    if (nextTriggerInputKey !== triggerInputKey) {
      triggerInputKey = nextTriggerInputKey;
      triggerTestInput.value = queueInput
        ? (((state.triggerSupport || {}).queue || {}).message || '')
        : '';
    }
    triggerTestInputLabel.textContent = queueInput ? 'Queue message JSON' : 'Trigger/test input (optional)';
    triggerInputGuidance.textContent = queueInput
      ? 'Edit the JSON object for this one Queue invocation. Change repository to choose which GitHub repo the digest processes.'
      : selectedAzure ? selectedAzure.hostedSkillNote + '. ' + selectedAzure.guidance : '';
    triggerTestInput.placeholder = queueInput
      ? '{\\n  "request": "Create a repository digest",\\n  "repository": "owner/repo",\\n  "lookbackHours": 24\\n}'
      : selectedAzure && selectedAzure.kind === 'http'
        ? 'Optional Hosted Skills/MCP message for this HTTP call'
        : selectedAzure && selectedAzure.kind === 'timer'
          ? 'Optional Timer trigger/test input; does not change skill instructions'
          : 'Optional trigger/test input';
    loadTestToggleBtn.style.display = state.target === 'azure' && (!selectedAzure || selectedAzure.kind !== 'http') ? 'none' : '';
    telemetryPanel.style.display = (state.azure.app) ? '' : 'none';
  }

  function chartPath(values, w, h, pad) {
    if (!values.length) return '';
    const max = Math.max(1, ...values);
    const stepX = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
    return values.map((v, i) => {
      const x = pad + i * stepX;
      const y = h - pad - (v / max) * (h - pad * 2);
      return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
    }).join(' ');
  }
  function renderChart(svgEl, values, color) {
    const path = chartPath(values, 600, 90, 8);
    svgEl.innerHTML = path ? '<path d="' + path + '" fill="none" stroke="' + color + '" stroke-width="2"/>' : '<text x="10" y="45" font-size="11" fill="#9ca3af">No data yet</text>';
  }

  function renderLoadTest(state) {
    const lt = state.loadTest;
    loadTestToggleBtn.textContent = lt.running ? 'Stop load test' : 'Load test';
    loadTestPanel.style.display = loadTestPanel.dataset.open === '1' ? '' : (lt.running ? '' : loadTestPanel.style.display);
    if (document.activeElement !== ltTargetSel) ltTargetSel.value = lt.target;
    if (document.activeElement !== ltDuration) ltDuration.value = lt.durationSec;
    if (document.activeElement !== ltConcurrency) ltConcurrency.value = lt.concurrency;
    if (document.activeElement !== ltRps) ltRps.value = lt.maxRps;
    ltStatus.textContent = lt.running ? 'running…' : (lt.points.length ? 'stopped' : '');
    if (!lt.ohaAvailable && lt.ohaChecked) {
      ltNote.className = 'inline-note err';
      ltNote.textContent = 'oha is not installed. Install it: brew install oha (macOS) or cargo install oha, then retry. No traffic is sent without it.';
    } else if (lt.error) {
      ltNote.className = 'inline-note err';
      ltNote.textContent = lt.error;
    } else {
      ltNote.className = 'inline-note';
      ltNote.textContent = 'Each point is a real 3s oha burst, logged live below.';
    }
    const terminalText = (lt.logTail || []).join('\\n') || 'Waiting for a load test.';
    if (ltTerminal.textContent !== terminalText) {
      ltTerminal.textContent = terminalText;
      ltTerminal.scrollTop = ltTerminal.scrollHeight;
    }
    renderChart(ltChart, lt.points.map((p) => p.rps), '#6b3fd6');
    const last = lt.points[lt.points.length - 1];
    const instances = lt.instanceCount == null ? '—' : lt.instanceCount;
    const configStats = '<span title="' + esc(lt.instanceCountNote || '') + '">instances <b>' + instances + '</b></span><span>concurrency <b>' + lt.concurrency + '</b></span>';
    ltStats.innerHTML = configStats + (last
      ? '<span>RPS <b>' + last.rps.toFixed(1) + '</b></span><span>avg <b>' + last.avgMs.toFixed(1) + 'ms</b></span><span>p95 <b>' + last.p95Ms.toFixed(1) + 'ms</b></span><span>errors <b>' + last.errors + '</b></span><span>total <b>' + last.total + '</b></span>'
      : '');
  }

  function renderTelemetry(state) {
    telemetryToggleBtn.textContent = state.liveTelemetry.enabled ? 'Disable telemetry' : 'Enable telemetry';
    telemetryTag.textContent = state.liveTelemetry.enabled ? 'live' : 'off';
    const pts = state.liveTelemetry.points || [];
    const total = pts.reduce((sum, point) => sum + Number(point.total || 0), 0);
    const failed = pts.reduce((sum, point) => sum + Number(point.failed || 0), 0);
    const weightedDuration = pts.reduce((sum, point) => sum + Number(point.avgMs || 0) * Number(point.total || 0), 0);
    const averageMs = total ? weightedDuration / total : null;
    aiStats.innerHTML = '<span>requests (30m) <b>' + total + '</b></span><span>failed <b>' + failed +
      '</b></span><span>avg duration <b>' + (averageMs != null ? averageMs.toFixed(1) : '—') + 'ms</b></span>';
    const traces = state.liveTelemetry.traces || [];
    aiTraces.textContent = traces.length
      ? traces.map((item) => {
          const severity = item.kind === 'exception' ? 'exception' : 'severity ' + item.severity;
          const operation = item.operationId ? ' · operation ' + item.operationId : '';
          return '[' + item.t + '] ' + severity + operation + '\\n' + item.message;
        }).join('\\n\\n')
      : 'No traces or exceptions ingested in the last 30 minutes.';
    aiError.textContent = state.liveTelemetry.error || '';
  }

  function renderCommands(state) {
    const cmds = state.commands || [];
    if (!cmds.length) { cmdlog.style.display = 'none'; return; }
    cmdlog.style.display = '';
    const running = cmds.filter((c) => c.status === 'run').length;
    cmdlogSub.textContent = running ? (running + ' running…') : (cmds.length + ' call' + (cmds.length === 1 ? '' : 's'));
    cmdlogList.innerHTML = cmds.map((c) => {
      const badge = c.kind === 'az' ? 'az' : c.kind === 'rest' ? 'REST' : c.kind === 'shell' ? 'shell' : c.kind === 'app' ? 'App' : 'http';
      const st = c.status === 'run' ? '<span class="cst run">running</span>' : c.status === 'err' ? '<span class="cst err">error</span>' : '<span class="cst ok">ok</span>';
      const time = c.ts ? '<span class="ctime">' + esc(new Date(c.ts).toLocaleTimeString()) + '</span>' : '';
      const ms = c.ms != null ? '<span class="cms">' + c.ms + 'ms</span>' : '';
      const note = c.note ? '<span class="cnote">' + esc(c.note) + '</span>' : '';
      const purpose = c.purpose ? '<div class="cpurpose">' + esc(c.purpose) + '</div>' : '';
      return '<div class="cmd ' + c.status + '"><div class="chead"><span class="ckind ' + c.kind + '">' + badge + '</span><span class="ctitle">' + esc(c.title || '') + '</span>' + st + time + ms + note + '</div>' + purpose + '<pre class="ccmd">' + esc(c.cmd || '') + '</pre></div>';
    }).join('');
  }

  function renderInvocations(state) {
    const items = state.invocations || [];
    const running = items.filter((item) => item.phase === 'running').length;
    invTotal.textContent = running ? (running + ' running · ' + items.length + ' event' + (items.length === 1 ? '' : 's')) : (items.length + ' event' + (items.length === 1 ? '' : 's'));
    clearInvocationsBtn.disabled = !items.length;
    if (!items.length) { invList.innerHTML = '<div class="empty">Waiting for local or Azure trigger activity.</div>'; return; }
    invList.innerHTML = items.map((e) => {
      const cls = e.phase === 'running' ? 'run' : e.ok ? 'ok' : 'bad';
      const phase = e.phase === 'running' ? 'Running' : e.ok ? 'Completed' : 'Failed';
      const status = e.status ? (phase + ' · HTTP ' + e.status) : phase;
      const duration = e.ms != null ? (e.ms + ' ms') : '';
      const origin = e.origin === 'scheduled' ? 'Scheduled' : e.origin === 'manual' ? 'Manual' : 'Runtime';
      return '<div class="invocation ' + cls + '">' +
        '<div class="inv-head"><span class="inv-badge">' + esc(e.trigger) + '</span>' +
        '<span class="inv-target">' + esc(origin + ' · ' + (e.target === 'azure' ? 'Azure Function App' : 'Local function')) + '</span>' +
        '<span class="inv-status">' + esc(status) + (duration ? ' · ' + esc(duration) : '') + '</span>' +
        '<span class="inv-time">#' + e.id + ' · ' + esc(e.time) + '</span></div>' +
        '<div class="inv-note">' + esc(e.note || (e.phase === 'running' ? 'Trigger is running.' : e.ok ? 'Trigger completed.' : 'Trigger failed.')) + '</div></div>';
    }).join('');
  }

  function renderDigest(state) {
    const event = (state.invocations || [])[0];
    if (!event || !event.response) {
      digestPanel.classList.remove('show');
      digestBody.innerHTML = '';
      digestMeta.textContent = '';
      return;
    }
    const origin = event.origin === 'scheduled' ? 'Scheduled' : event.origin === 'manual' ? 'Manual' : 'Runtime';
    digestMeta.textContent = origin + ' ' + event.trigger + ' · ' + (event.target === 'azure' ? 'Azure Function App' : 'Local function') + ' · #' + event.id + ' · ' + event.time;
    digestBody.innerHTML = renderMarkdown(event.response);
    digestPanel.classList.add('show');
  }

  function render(state) {
    latest = state;
    instructions.style.display = state.target === 'azure' ? 'none' : '';
    if (state.target === 'local') instructions.open = true;
    renderTriggers(state);
    renderDoctor(state);
    renderSource(state);
    renderLocal(state);
    renderDeployment(state);
    renderInvoke(state);
    renderLoadTest(state);
    renderTelemetry(state);
    renderCommands(state);
    renderInvocations(state);
    renderDigest(state);
    if (typeof window.applyCommandState === 'function') window.applyCommandState(state);
    skillName.textContent = state.hero && state.hero.title ? state.hero.title : 'Skill';
    promptPreview.textContent = state.prompt || '';
  }

  const es = new EventSource('/events');
  es.addEventListener('state', (e) => render(JSON.parse(e.data)));
  setInterval(() => { if (latest) renderInvoke(latest); }, 500);

  triggersEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.trig');
    if (!btn || btn.disabled) return;
    if (btn.dataset.function) postJson('/az/select-function', { functionName: btn.dataset.function }).then(() => {});
    else postJson('/select-trigger', { trigger: btn.dataset.id }).then(() => {});
  });
  function timerSchedulePayload() {
    const cadence = timerCadence.value;
    if (cadence === 'weekly') {
      return { cadence, weekday: Number(timerWeekday.value), localTime: timerWeeklyTime.value };
    }
    if (cadence === 'hourly') {
      return { cadence, hourlyMinute: Number(timerMinute.value) };
    }
    return { cadence: 'daily', localTime: timerTime.value };
  }
  function applyTimerSchedule() {
    timerStatus.textContent = 'Applying…';
    postJson('/timer-schedule', timerSchedulePayload()).catch((error) => {
      timerStatus.textContent = error.message || 'Could not apply schedule';
      timerStatus.className = 'schedule-status err';
    });
  }
  [timerCadence, timerTime, timerWeekday, timerWeeklyTime, timerMinute].forEach((control) => {
    control.addEventListener('change', applyTimerSchedule);
  });

  sourceCustomize.addEventListener('click', () => {
    sourceEditorOpen = true;
    renderSourceWorkspace(latest);
    sourceRelativePath.focus();
    sourceRelativePath.select();
  });
  sourceCancel.addEventListener('click', () => {
    sourceEditorOpen = false;
    if (latest) renderSourceWorkspace(latest);
  });
  sourceCreate.addEventListener('click', async () => {
    const source = latest && latest.sourceWorkspace ? latest.sourceWorkspace : {};
    const moving = Boolean(source.materialized);
    if (moving && !window.confirm('Move the complete generated app to ' + sourceRelativePath.value + '?')) return;
    sourceCreate.disabled = true;
    setStatus(moving ? 'Moving generated app...' : 'Creating generated app...');
    const result = await postJson(moving ? '/source/move-current' : '/source/create', moving
      ? { confirm: true, relativePath: sourceRelativePath.value }
      : { mode: 'current', relativePath: sourceRelativePath.value });
    if (result.ok) {
      sourceEditorOpen = false;
      if (latest) renderSourceWorkspace(latest);
    }
    setStatus(result.message || (result.ok ? (moving ? 'Generated app moved.' : 'Generated app created.') : 'Could not update generated app.'));
  });
  sourceRemove.addEventListener('click', async () => {
    const source = latest && latest.sourceWorkspace ? latest.sourceWorkspace : {};
    if (!window.confirm('Remove the Studio-generated app at ' + source.destination + '? Removal stops if generated files changed.')) return;
    sourceRemove.disabled = true;
    setStatus('Checking and removing Studio-owned files...');
    const result = await postJson('/source/remove', { confirm: true });
    if (result.ok) {
      sourceEditorOpen = false;
      if (latest) renderSourceWorkspace(latest);
    }
    setStatus(result.message || (result.ok ? 'Generated app removed.' : 'Nothing was removed.'));
  });

  targetLocalBtn.addEventListener('click', () => postJson('/select-target', { target: 'local' }));
  targetAzureBtn.addEventListener('click', () => postJson('/select-target', { target: 'azure' }));
  modelSubscription.addEventListener('change', () => postJson('/models/select-subscription', { subscription: modelSubscription.value }));
  modelSource.addEventListener('change', () => postJson('/models/select-source', { source: modelSource.value }));
  modelResource.addEventListener('change', () => {
    const binding = latest.modelBinding || {};
    const resources = modelSource.value === 'gateway' ? (binding.gateways || []) : (binding.foundry || []);
    const resource = resources.find((item) => item.id === modelResource.value);
    postJson('/models/select-choice', { resourceId: modelResource.value, modelId: resource && resource.models[0] ? resource.models[0].id : '' });
  });
  modelModel.addEventListener('change', () => postJson('/models/select-choice', { resourceId: modelResource.value, modelId: modelModel.value }));
  modelRefresh.addEventListener('click', () => postJson('/models/refresh'));
  doctorToggleBtn.addEventListener('click', () => {
    doctorPanel.hidden = !doctorPanel.hidden;
    doctorToggleBtn.setAttribute('aria-expanded', String(!doctorPanel.hidden));
  });
  doctorRunBtn.addEventListener('click', () => postJson('/doctor/run'));
  subSel.addEventListener('change', () => { setStatus('Loading Function Apps…'); postJson('/az/select-subscription', { subscription: subSel.value }).then(() => setStatus('')); });
  appSel.addEventListener('change', () => { if (!appSel.value) return; setStatus('Discovering functions…'); postJson('/az/select-app', { resourceId: appSel.value }).then(() => setStatus('')); });
  refreshAppsBtn.addEventListener('click', () => postJson('/az/refresh-apps'));
  registerAppProject.addEventListener('click', async () => {
    if (latest && latest.sourceWorkspace && latest.sourceWorkspace.mode === 'current') {
      const destination = latest.sourceWorkspace.destination;
      if (!window.confirm('Move the complete generated app from ' + destination + ' to an isolated workspace and create a GitHub session? The current-worktree folder is removed only after the move succeeds.')) return;
    }
    registerAppProject.disabled = true;
    setStatus('Preparing the project and GitHub Copilot App session...');
    const r = await postJson('/register-app-project');
    registerAppProject.disabled = Boolean(r.pending);
    setStatus(r.message || (r.ok ? 'Session creation requested.' : 'Session handoff failed.'));
  });

  localToggleBtn.addEventListener('click', async () => {
    if (latest && latest.local.status === 'running') { await postJson('/local/stop'); return; }
    setStatus('Starting local function host (Core Tools, Azurite, venv, func start)…');
    const r = await postJson('/local/start');
    setStatus(r.ok ? 'Local function host running.' : r.message);
  });

  deploymentCancel.addEventListener('click', async () => {
    if (deploymentCancel.disabled) return;
    deploymentCancel.disabled = true;
    const result = await postJson('/deploy-azure/cancel');
    setStatus(result.message || (result.ok ? 'Cancellation requested.' : 'Could not cancel deployment.'));
  });
  deployAzureBtn.addEventListener('click', () => {
    if (deployAzureBtn.disabled) return;
    deploymentOutput.hidden = false;
    deploymentOutput.open = true;
    deploymentSummaryEl.textContent = 'Preparing isolated deployment...';
  });

  invokeBtn.addEventListener('click', async () => {
    const invocationRunning = latest && (latest.invocations || []).some((item) => item.phase === 'running');
    if (invocationRunning) {
      if (!window.confirm('An invocation is already running. Cancel it and restart the local function host?')) return;
      const cancelled = await postJson('/invoke/cancel', {});
      setStatus(cancelled.message || (cancelled.ok ? 'Invocation cancelled.' : 'Could not cancel invocation.'));
      return;
    }
    const gate = latest ? computeInvokeGate(latest) : { blocked: false };
    if (gate.blocked) {
      // Never a dead click: explain the exact blocker, run doctor for a full
      // picture, and open the panel that actually fixes it.
      invokeGate.hidden = false;
      invokeGate.className = 'inline-note warn';
      invokeGate.textContent = gate.reason;
      setStatus('Invoke blocked: ' + gate.reason);
      if (gate.focus === 'model' && modelBindingPanel) modelBindingPanel.open = true;
      if (gate.focus === 'source' && sourceWorkspacePanel) {
        sourceWorkspacePanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (gate.focus === 'azure' && sourceNote) {
        sourceNote.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      doctorPanel.hidden = false;
      doctorToggleBtn.setAttribute('aria-expanded', 'true');
      doctorPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (!(latest && latest.doctorRunning)) postJson('/doctor/run').catch(() => {});
      return;
    }
    if (latest && latest.target === 'local') {
      localLogWrap.open = true;
      localLogWrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
      localLogWrap.focus({ preventScroll: true });
    }
    if (latest && latest.target === 'azure') telemetryPanel.open = true;
    setStatus('Invoking…');
    digestPanel.classList.remove('show');
    digestBody.innerHTML = '';
    digestMeta.textContent = '';
    const queueInput = latest && latest.trigger === 'queue';
    if (queueInput) {
      try {
        const payload = JSON.parse(triggerTestInput.value);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error();
      } catch {
        setStatus('Queue message must be a valid JSON object.');
        triggerTestInput.focus();
        return;
      }
    }
    const r = await postJson(
      '/invoke',
      latest && latest.target === 'azure'
        ? { input: triggerTestInput.value }
        : queueInput ? { prompt: triggerTestInput.value } : {},
    );
    if (r.ok) setStatus((r.result.ok ? 'Invoked: ' : 'Invoke failed: ') + (r.result.note || ''));
    else setStatus(r.message);
  });

  openAiBtn.addEventListener('click', async () => {
    setStatus('Resolving Application Insights…');
    const r = await postJson('/app-insights/open');
    if (r.ok) { window.open(r.url, '_blank'); setStatus(''); } else setStatus(r.message);
  });

  const telemetryToggle = document.getElementById('telemetry-toggle');
  telemetryToggle.addEventListener('click', async () => {
    if (latest && latest.liveTelemetry.enabled) { await postJson('/telemetry/stop'); return; }
    setStatus('Resolving Application Insights…');
    const r = await postJson('/telemetry/start');
    setStatus(r.ok ? '' : r.message);
  });

  loadTestToggleBtn.addEventListener('click', async () => {
    if (latest && latest.loadTest.running) { await postJson('/load-test/stop'); return; }
    loadTestPanel.style.display = '';
    loadTestPanel.dataset.open = '1';
    await postJson('/load-test/start', {
      target: ltTargetSel.value,
      durationSec: Number(ltDuration.value) || 60,
      concurrency: Number(ltConcurrency.value) || 16,
      maxRps: Number(ltRps.value) || 50,
    });
  });

  clearInvocationsBtn.addEventListener('click', async () => {
    await postJson('/clear', {});
    setStatus('Trigger activity cleared.');
  });

  document.getElementById('edit-instructions').addEventListener('click', async () => {
    setStatus('Opening agent instructions in VS Code...');
    const r = await postJson('/edit-instructions-vscode');
    setStatus(r.ok ? 'Opened agent instructions in VS Code.' : r.message);
  });
</script>
</body>
</html>`;
}
