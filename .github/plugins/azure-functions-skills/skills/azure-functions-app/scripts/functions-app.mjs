#!/usr/bin/env node

// lib/tools/app/main.js
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// lib/tools/app/auth.js
import { execFile } from "node:child_process";

// lib/tools/app/output.js
var EXIT = {
  ok: 0,
  failed: 1,
  usage: 2,
  unsupported: 3,
  azure: 4,
  approval: 5,
  precheck: 6
};
var STATUS_BY_EXIT = {
  0: "ok",
  1: "failed",
  2: "usage_error",
  3: "unsupported",
  4: "azure_error",
  5: "approval_required",
  6: "precheck_failed"
};
var ToolError = class extends Error {
  exitCode;
  options;
  constructor(exitCode, message, options = {}) {
    super(message);
    this.exitCode = exitCode;
    this.options = options;
    this.name = "ToolError";
  }
};
function successEnvelope(command, result3) {
  return {
    schemaVersion: 1,
    command,
    ok: true,
    status: "ok",
    summary: result3.summary,
    data: result3.data,
    findings: result3.findings ?? [],
    next: result3.next ?? []
  };
}
function errorEnvelope(command, exitCode, message, options = {}) {
  return {
    schemaVersion: 1,
    command,
    ok: false,
    status: STATUS_BY_EXIT[exitCode],
    summary: message,
    data: options.data,
    findings: options.findings ?? [],
    next: options.next ?? []
  };
}

// lib/tools/app/auth.js
var runCommand = (command, args) => new Promise((resolve) => {
  execFile(command, [...args], { shell: process.platform === "win32", windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout) => {
    resolve({ ok: !error, stdout: String(stdout) });
  });
});
function createTokenProvider(run = runCommand) {
  const cache2 = /* @__PURE__ */ new Map();
  return (resource) => {
    let token = cache2.get(resource);
    if (!token) {
      token = acquire(run, resource);
      cache2.set(resource, token);
      token.catch(() => cache2.delete(resource));
    }
    return token;
  };
}
async function acquire(run, resource) {
  const az = await run("az", ["account", "get-access-token", "--resource", resource, "--output", "json"]);
  const fromAz = az.ok ? readToken(az.stdout, "accessToken") : void 0;
  if (fromAz)
    return fromAz;
  const azd = await run("azd", ["auth", "token", "--scope", `${resource}/.default`, "--output", "json"]);
  const fromAzd = azd.ok ? readToken(azd.stdout, "token") : void 0;
  if (fromAzd)
    return fromAzd;
  throw new ToolError(EXIT.precheck, "Could not get an Azure access token from `az` or `azd`.", {
    findings: [{ severity: "error", code: "NotSignedIn", message: "Neither the Azure CLI nor the Azure Developer CLI returned a token.", fix: "Run `az login` (or `azd auth login`), then retry." }]
  });
}
function readToken(stdout, field) {
  try {
    const value = JSON.parse(stdout)[field];
    return typeof value === "string" && value ? value : void 0;
  } catch {
    return void 0;
  }
}

// lib/tools/app/args.js
function parseArgs(argv, booleanFlags = /* @__PURE__ */ new Set()) {
  const positionals = [];
  const flags = /* @__PURE__ */ new Map();
  const lists = /* @__PURE__ */ new Map();
  const add = (name, value) => {
    flags.set(name, value);
    lists.set(name, [...lists.get(name) ?? [], value]);
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (!name)
      throw new ToolError(EXIT.usage, `Invalid flag "${arg}".`);
    if (eq !== -1) {
      add(name, arg.slice(eq + 1));
    } else if (booleanFlags.has(name) || i + 1 >= argv.length || argv[i + 1].startsWith("--")) {
      flags.set(name, true);
    } else {
      add(name, argv[++i]);
    }
  }
  return { positionals, flags, lists };
}
function stringFlag(args, name) {
  const value = args.flags.get(name);
  if (value === void 0)
    return void 0;
  if (value === true)
    throw new ToolError(EXIT.usage, `Flag --${name} requires a value.`);
  return value;
}
function listFlag(args, name) {
  if (args.flags.get(name) === true)
    throw new ToolError(EXIT.usage, `Flag --${name} requires a value.`);
  return args.lists.get(name) ?? [];
}
function requireFlag(args, name, hint) {
  const value = stringFlag(args, name);
  if (!value)
    throw new ToolError(EXIT.usage, `Missing --${name}. ${hint}`);
  return value;
}
function boolFlag(args, name) {
  return args.flags.get(name) === true || args.flags.get(name) === "true";
}
function intFlag(args, name, fallback, max) {
  const raw = stringFlag(args, name);
  if (raw === void 0)
    return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new ToolError(EXIT.usage, `--${name} must be an integer between 1 and ${max}.`);
  }
  return value;
}
var DURATION = /^(\d+)(m|h|d)$/;
function durationFlag(args, name, fallback) {
  const raw = stringFlag(args, name) ?? fallback;
  const match = DURATION.exec(raw);
  if (!match)
    throw new ToolError(EXIT.usage, `--${name} must look like 30m, 6h, or 7d.`);
  const amount = Number(match[1]);
  const unit = match[2];
  const ms = amount * (unit === "m" ? 6e4 : unit === "h" ? 36e5 : 864e5);
  if (ms < 6e4 || ms > 90 * 864e5)
    throw new ToolError(EXIT.usage, `--${name} must be between 1m and 90d.`);
  const iso = unit === "d" ? `P${amount}D` : `PT${amount}${unit.toUpperCase()}`;
  return { iso, ms };
}

// lib/tools/app/redact.js
var SECRET_NAME = /(KEY|SECRET|PASSWORD|PWD|TOKEN|CONNECTION|SAS)|Storage$/i;
var SECRET_VALUE = /(AccountKey=|SharedAccessKey=|SharedAccessSignature|[?&]sig=|Password=|Pwd=|InstrumentationKey=|ClientSecret=)/i;
var KEY_VAULT_REF = /^@Microsoft\.KeyVault\(/i;
var REDACTED = "<redacted>";
function isKeyVaultReference(value) {
  return KEY_VAULT_REF.test(value.trim());
}
function redactValue(name, value) {
  if (isKeyVaultReference(value))
    return { name, value, source: "keyVaultReference" };
  if (SECRET_NAME.test(name) || SECRET_VALUE.test(value))
    return { name, value: REDACTED, source: "redacted" };
  return { name, value, source: "plain" };
}
function redactSettings(settings) {
  return Object.keys(settings).sort((a, b) => a.localeCompare(b)).map((name) => redactValue(name, settings[name] ?? ""));
}
var SECRET_FIELD = /(password|secret|accountkey|connectionstring|token|masterkey|primarykey|secondarykey|^key$|sas)/i;
var KEY_LISTING_PATH = /\/(listkeys|listsecrets|listsyncfunctiontriggerstatus|listpublishingcredentials|publishxml|listpublishingprofilexmlwithsecrets|keys)(\/|$)|\/list[a-z]*keys?$/i;
var SETTINGS_PATH = /\/config\/(appsettings|connectionstrings|slotconfignames)(\/list)?$/i;
function isKeyListingPath(path) {
  return KEY_LISTING_PATH.test(path);
}
function namesOnly(value) {
  if (Array.isArray(value))
    return value.map(namesOnly);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, namesOnly(inner)]));
  return typeof value === "string" && value ? REDACTED : value;
}
function redactFields(value) {
  if (Array.isArray(value))
    return value.map(redactFields);
  if (value && typeof value === "object") {
    const record = value;
    const pairName = typeof record.name === "string" && typeof record.value === "string" ? record.name : void 0;
    return Object.fromEntries(Object.entries(record).map(([key, inner]) => {
      if (pairName !== void 0 && key === "value")
        return [key, redactValue(pairName, inner).value];
      if (typeof inner === "string" && inner && SECRET_FIELD.test(key))
        return [key, isKeyVaultReference(inner) ? inner : REDACTED];
      return [key, redactFields(inner)];
    }));
  }
  return typeof value === "string" ? scrubText(value) : value;
}
function redactResponse(path, body) {
  if (isKeyListingPath(path))
    return namesOnly(body);
  if (SETTINGS_PATH.test(path) && body && typeof body === "object" && "properties" in body) {
    const properties = body.properties;
    const redacted = Object.fromEntries(Object.entries(properties ?? {}).map(([name, inner]) => {
      if (typeof inner === "string")
        return [name, redactValue(name, inner).value];
      if (inner && typeof inner === "object" && "value" in inner)
        return [name, { ...inner, value: REDACTED }];
      return [name, inner];
    }));
    return { ...body, properties: redacted };
  }
  return redactFields(body);
}
function scrubText(text) {
  return text.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer <redacted>").replace(/(AccountKey|SharedAccessKey|Password|Pwd|ClientSecret)=([^;"'\s]+)/gi, "$1=<redacted>").replace(/([?&]sig=)[^&"'\s]+/gi, "$1<redacted>");
}

// lib/tools/app/azure.js
var ARM_ENDPOINT = "https://management.azure.com";
var ARM_RESOURCE = "https://management.azure.com";
var LOGS_ENDPOINT = "https://api.loganalytics.io";
var LOGS_RESOURCE = "https://api.loganalytics.io";
var SCM_RESOURCE = "https://appservice.azure.com";
var MAX_RETRIES = 3;
var AzureError = class extends ToolError {
  httpStatus;
  azureCode;
  constructor(httpStatus, azureCode, message, findings = []) {
    super(EXIT.azure, message, { findings, data: { httpStatus, code: azureCode } });
    this.httpStatus = httpStatus;
    this.azureCode = azureCode;
  }
};
var AzureClient = class {
  deps;
  constructor(deps) {
    this.deps = deps;
  }
  arm(method, path, apiVersion, options = {}) {
    const separator = path.includes("?") ? "&" : "?";
    const url = `${ARM_ENDPOINT}${path}${separator}api-version=${encodeURIComponent(apiVersion)}`;
    return this.request(method, url, ARM_RESOURCE, options);
  }
  async request(method, url, resource, options = {}) {
    return (await this.send(method, url, resource, options)).body;
  }
  /** Sends one request and returns status, the headers needed for polling, and the parsed body. Throws AzureError on failure. */
  async send(method, url, resource, options = {}) {
    const idempotent = options.idempotent ?? method.toUpperCase() === "GET";
    const token = await this.deps.getToken(resource);
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json", ...options.headers };
    const body = options.rawBody ?? (options.body === void 0 ? void 0 : JSON.stringify(options.body));
    if (body !== void 0 && options.rawBody === void 0)
      headers["Content-Type"] = "application/json";
    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await this.deps.fetch(url, { method: method.toUpperCase(), headers, body });
      } catch (error) {
        if (idempotent && attempt < MAX_RETRIES) {
          await this.deps.sleep(backoff(attempt));
          continue;
        }
        throw new AzureError(0, "NetworkError", `Request to ${describeUrl(url)} failed: ${scrubText(String(error))}`);
      }
      const text = await response.text();
      if (response.status >= 200 && response.status < 300) {
        return { status: response.status, headers: pickHeaders(response), body: parseBody(text) };
      }
      if (idempotent && attempt < MAX_RETRIES && (response.status === 429 || response.status >= 500)) {
        await this.deps.sleep(retryAfter(response) ?? backoff(attempt));
        continue;
      }
      throw toAzureError(response.status, text, url);
    }
  }
  /**
   * Opens a streaming GET and collects text until `durationMs` passes, `maxChars` is reached, or the server
   * closes the stream. `onOpen` runs once the stream is connected (for example to trigger the event to watch).
   */
  async stream(url, resource, durationMs, maxChars, onOpen) {
    const token = await this.deps.getToken(resource);
    const controller = new AbortController();
    let response;
    try {
      response = await this.deps.fetch(url, { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "text/plain" }, signal: controller.signal });
    } catch (error) {
      throw new AzureError(0, "NetworkError", `Request to ${describeUrl(url)} failed: ${scrubText(String(error))}`);
    }
    if (response.status < 200 || response.status >= 300)
      throw toAzureError(response.status, await response.text(), url);
    onOpen?.();
    const reader = response.body?.getReader();
    if (!reader)
      return { text: await response.text(), ended: "closed" };
    const decoder = new TextDecoder();
    const timeout = this.deps.sleep(durationMs).then(() => "timeout");
    let text = "";
    let ended = "closed";
    try {
      for (; ; ) {
        const next = await Promise.race([reader.read(), timeout]);
        if (next === "timeout") {
          ended = "timeout";
          break;
        }
        if (next.done)
          break;
        text += decoder.decode(next.value, { stream: true });
        if (text.length >= maxChars) {
          ended = "limit";
          break;
        }
      }
    } finally {
      await reader.cancel().catch(() => void 0);
      controller.abort();
    }
    return { text, ended };
  }
  /**
   * Follows an accepted long-running operation through `Azure-AsyncOperation` or `Location` until it
   * finishes or `timeoutMs` of waiting has passed. Polls are reads, so they are retried; the write never is.
   */
  async poll(accepted, resource, timeoutMs) {
    const asyncUrl = accepted.headers["azure-asyncoperation"];
    const pollUrl = asyncUrl ?? accepted.headers.location;
    if (!pollUrl)
      return { done: true, status: "Succeeded", body: accepted.body };
    let waitMs = retryAfterMs(accepted.headers["retry-after"]) ?? DEFAULT_POLL_MS;
    let waited = 0;
    for (; ; ) {
      if (waited + waitMs > timeoutMs)
        return { done: false, status: "InProgress", pollUrl };
      await this.deps.sleep(waitMs);
      waited += waitMs;
      const response = await this.send("GET", pollUrl, resource, { idempotent: true });
      waitMs = retryAfterMs(response.headers["retry-after"]) ?? DEFAULT_POLL_MS;
      if (asyncUrl) {
        const operation = response.body;
        const status = operation?.status ?? "Unknown";
        if (TERMINAL.has(status))
          return { done: true, status, body: operation, pollUrl };
      } else if (response.status !== 202) {
        return { done: true, status: "Succeeded", body: response.body, pollUrl };
      }
    }
  }
};
var DEFAULT_POLL_MS = 5e3;
var TERMINAL = /* @__PURE__ */ new Set(["Succeeded", "Failed", "Canceled", "Cancelled"]);
var POLL_HEADERS = ["azure-asyncoperation", "location", "retry-after"];
function pickHeaders(response) {
  const headers = {};
  for (const name of POLL_HEADERS) {
    const value = response.headers.get(name);
    if (value)
      headers[name] = value;
  }
  return headers;
}
function parseBody(text) {
  if (!text)
    return void 0;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
function retryAfterMs(raw) {
  if (!raw)
    return void 0;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? Math.min(Math.max(seconds, 1), 30) * 1e3 : void 0;
}
function backoff(attempt) {
  return 1e3 * 2 ** attempt;
}
function retryAfter(response) {
  return retryAfterMs(response.headers.get("retry-after") ?? void 0);
}
function describeUrl(url) {
  const parsed = new URL(url);
  return `${parsed.host}${parsed.pathname}`;
}
function toAzureError(status, text, url) {
  let code = `Http${status}`;
  let message = text.slice(0, 500);
  try {
    const parsed = JSON.parse(text);
    code = parsed.error?.code ?? parsed.Code ?? code;
    message = parsed.error?.message ?? parsed.Message ?? message;
  } catch {
  }
  const findings = [];
  if (status === 401) {
    findings.push({ severity: "error", code: "Unauthenticated", message: "The Azure token was rejected.", fix: "Run `az login` (or `azd auth login`) and retry." });
  } else if (status === 403) {
    findings.push({ severity: "error", code: "Forbidden", message: "The signed-in identity lacks permission for this operation.", fix: "Ask for an Azure role that grants this action (Reader for reads, Contributor or Website Contributor for app writes)." });
  } else if (status === 404) {
    findings.push({ severity: "error", code: "NotFound", message: "The resource or endpoint was not found.", fix: "Check the app name, resource group, and subscription with `app find`." });
  }
  return new AzureError(status, code, `Azure returned ${status} ${code} for ${describeUrl(url)}: ${scrubText(message)}`, findings);
}

// lib/tools/app/commands/docs.js
import { join as join3 } from "node:path";

// lib/tools/app/api.js
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";

// lib/tools/app/docs.js
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
function slugify(title) {
  return title.toLowerCase().replace(/^\d+[a-z]?\.\s*/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function parseDoc(id, markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let title = id;
  const sections = [];
  let current;
  let inFence = false;
  const flush = () => {
    if (!current)
      return;
    let slug = slugify(current.title) || "section";
    let suffix = 2;
    while (sections.some((section) => section.id === `${id}/${slug}`))
      slug = `${slugify(current.title)}-${suffix++}`;
    sections.push({ id: `${id}/${slug}`, file: id, title: current.title, content: current.lines.join("\n").trim() });
  };
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line))
      inFence = !inFence;
    if (!inFence && /^# /.test(line) && title === id) {
      title = line.slice(2).trim();
      continue;
    }
    if (!inFence && /^## /.test(line)) {
      flush();
      current = { title: line.slice(3).trim(), lines: [line] };
      continue;
    }
    current?.lines.push(line);
  }
  flush();
  return { id, title, content: markdown.trim(), sections };
}
function loadDocs(root) {
  if (!existsSync(root)) {
    throw new ToolError(EXIT.failed, `Docs folder not found at ${root}. Reinstall the azure-functions-skills plugin.`);
  }
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory())
        walk(full);
      else if (entry.endsWith(".md")) {
        const id = relative(root, full).replaceAll("\\", "/").replace(/\.md$/, "").toLowerCase();
        files.push(parseDoc(id, readFileSync(full, "utf-8")));
      }
    }
  };
  walk(root);
  return files;
}
function findDoc(docs, id) {
  const wanted = id.toLowerCase().replace(/\.md$/, "").replace(/^\/+/, "");
  for (const file of docs) {
    if (file.id === wanted)
      return file;
    const section = file.sections.find((candidate) => candidate.id === wanted);
    if (section)
      return section;
  }
  return void 0;
}
function tokenize(text) {
  return text.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length >= 2);
}
function searchDocs(docs, query2, limit) {
  const terms = [...new Set(tokenize(query2))];
  if (terms.length === 0)
    return [];
  const hits = [];
  for (const section of docs.flatMap((file) => file.sections)) {
    const title = section.title.toLowerCase();
    const body = section.content.toLowerCase();
    let score = 0;
    let matched = 0;
    for (const term of terms) {
      const inTitle = title.includes(term);
      const occurrences = Math.min(countOccurrences(body, term), 10);
      if (inTitle || occurrences > 0)
        matched++;
      score += (inTitle ? 5 : 0) + occurrences;
    }
    if (score === 0)
      continue;
    score *= matched / terms.length;
    hits.push({ id: section.id, title: section.title, score: Math.round(score * 10) / 10, snippet: snippet(section.content, terms) });
  }
  return hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
}
function countOccurrences(text, term) {
  let count = 0;
  for (let index = text.indexOf(term); index !== -1; index = text.indexOf(term, index + term.length))
    count++;
  return count;
}
function snippet(content, terms) {
  const lines = content.split("\n").slice(1).filter((line2) => line2.trim());
  const line = lines.find((candidate) => terms.some((term) => candidate.toLowerCase().includes(term))) ?? lines[0] ?? "";
  const trimmed = line.trim();
  return trimmed.length > 160 ? `${trimmed.slice(0, 157)}...` : trimmed;
}

// lib/tools/app/api.js
function loadApiIndex(path) {
  if (!existsSync2(path))
    throw new ToolError(EXIT.failed, `API index not found at ${path}. Reinstall the azure-functions-skills plugin.`);
  return JSON.parse(readFileSync2(path, "utf-8"));
}
var SYNONYMS = {
  easy: ["auth"],
  easyauth: ["auth"],
  authentication: ["auth"],
  kudu: ["scm", "deployments"],
  env: ["settings"],
  environment: ["settings"],
  variables: ["settings"],
  appsettings: ["application", "settings"],
  vnet: ["virtual", "network"],
  keyvault: ["configreferences"],
  kv: ["configreferences"],
  logs: ["query"],
  plan: ["serverfarms"]
};
function expandTerms(query2) {
  return [...new Set(tokenize(query2))].map((term) => [.../* @__PURE__ */ new Set([term, ...SYNONYMS[term] ?? []])]);
}
function findOperations(index, query2, options) {
  const groups = expandTerms(query2);
  if (groups.length === 0)
    return [];
  const method = options.method?.toUpperCase();
  const hits = [];
  for (const operation of index.operations) {
    if (method && operation.method !== method)
      continue;
    const idTerms = new Set(tokenize(operation.id));
    const pathText = operation.path.replace(/\{[^}]+\}/g, "").toLowerCase();
    const summary = operation.summary.toLowerCase();
    let score = 0;
    let matched = 0;
    for (const group of groups) {
      const groupScore = Math.max(...group.map((term) => (idTerms.has(term) ? 4 : 0) + (pathText.includes(term) ? 2 : 0) + (summary.includes(term) ? 1 : 0)));
      if (groupScore > 0)
        matched++;
      score += groupScore;
    }
    if (matched === 0)
      continue;
    score = score * (matched / groups.length) - operation.path.length / 1e3;
    hits.push({ ...operation, score: Math.round(score * 100) / 100 });
  }
  return hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, options.limit);
}

// lib/tools/app/learn.js
import { existsSync as existsSync3, readFileSync as readFileSync3 } from "node:fs";
import { join as join2 } from "node:path";
import { gunzipSync } from "node:zlib";
var LEARN_INDEX_FILE = "learn-index.json.gz";
var LEARN_PREFIX = "learn:";
var LANGUAGES = {
  csharp: "csharp",
  "c#": "csharp",
  dotnet: "csharp",
  ".net": "csharp",
  javascript: "javascript",
  js: "javascript",
  node: "javascript",
  nodejs: "javascript",
  typescript: "typescript",
  ts: "typescript",
  python: "python",
  py: "python",
  java: "java",
  powershell: "powershell",
  pwsh: "powershell",
  go: "go"
};
var PLANS = {
  flex: "flex-consumption-plan",
  "flex-consumption": "flex-consumption-plan",
  consumption: "consumption-plan",
  premium: "premium-plan",
  "elastic-premium": "premium-plan",
  dedicated: "dedicated-plan",
  "app-service": "dedicated-plan",
  container: "container-apps",
  "container-apps": "container-apps",
  aca: "container-apps"
};
var PLAN_PIVOTS = new Set(Object.values(PLANS));
var STOP_WORDS = /* @__PURE__ */ new Set(["the", "to", "an", "and", "or", "of", "in", "on", "for", "with", "is", "are", "do", "does", "how", "my", "me", "what", "can", "it", "be", "by", "from", "azure", "functions", "function"]);
var K1 = 1.2;
var B = 0.75;
var SECTION_TITLE_BOOST = 3;
var ARTICLE_TITLE_BOOST = 1;
var cache = /* @__PURE__ */ new Map();
function loadLearnIndex(assetsDir2) {
  const path = join2(assetsDir2, LEARN_INDEX_FILE);
  const cached = cache.get(path);
  if (cached)
    return cached;
  if (!assetsDir2 || !existsSync3(path))
    return void 0;
  const index = JSON.parse(gunzipSync(readFileSync3(path)).toString("utf-8"));
  cache.set(path, index);
  return index;
}
function normalizeFilter(filter) {
  const result3 = {};
  if (filter.lang) {
    const lang = LANGUAGES[filter.lang.toLowerCase()];
    if (!lang)
      throw new ToolError(EXIT.usage, `Unknown --lang "${filter.lang}". Use one of: csharp, javascript, typescript, python, java, powershell, go.`);
    result3.lang = `programming-language-${lang}`;
  }
  if (filter.plan) {
    const plan = PLANS[filter.plan.toLowerCase()];
    if (!plan)
      throw new ToolError(EXIT.usage, `Unknown --plan "${filter.plan}". Use one of: flex, consumption, premium, dedicated, container-apps.`);
    result3.plan = plan;
  }
  return result3;
}
function matchesFilter(section, filter) {
  const pivots = section.pivots ?? [];
  if (filter.lang) {
    const languages = pivots.filter((pivot) => pivot.startsWith("programming-language-"));
    if (languages.length && !languages.includes(filter.lang))
      return false;
  }
  if (filter.plan) {
    const plans = pivots.filter((pivot) => PLAN_PIVOTS.has(pivot));
    if (plans.length && !plans.includes(filter.plan))
      return false;
  }
  return true;
}
function learnSectionUrl(article, section) {
  return article.sections[0] === section ? article.url : `${article.url}#${section.id}`;
}
function counts(tokens, weight, into) {
  for (const token of tokens)
    into.set(token, (into.get(token) ?? 0) + weight);
}
function searchLearn(index, query2, filter, limit) {
  const terms = [...new Set(tokenize(query2).filter((term) => !STOP_WORDS.has(term)))];
  if (terms.length === 0)
    return [];
  const wanted = new Set(terms);
  const docs = [];
  const df = /* @__PURE__ */ new Map();
  let totalLength = 0;
  for (const article of index.articles) {
    for (const section of article.sections) {
      if (!matchesFilter(section, filter))
        continue;
      const textTokens = tokenize(section.text);
      const tf = /* @__PURE__ */ new Map();
      counts(textTokens.filter((token) => wanted.has(token)), 1, tf);
      const titles = /* @__PURE__ */ new Map();
      for (const token of tokenize(article.title))
        if (wanted.has(token))
          titles.set(token, ARTICLE_TITLE_BOOST);
      for (const token of tokenize(section.title))
        if (wanted.has(token))
          titles.set(token, SECTION_TITLE_BOOST + (titles.get(token) ?? 0));
      totalLength += textTokens.length;
      docs.push({ article, section, tf, titles, length: textTokens.length });
      for (const term of /* @__PURE__ */ new Set([...tf.keys(), ...titles.keys()]))
        df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  const average = totalLength / Math.max(docs.length, 1);
  const hits = [];
  for (const doc of docs) {
    const matched = /* @__PURE__ */ new Set([...doc.tf.keys(), ...doc.titles.keys()]);
    if (matched.size === 0)
      continue;
    let score = 0;
    for (const term of matched) {
      const idf = Math.log(1 + (docs.length - (df.get(term) ?? 0) + 0.5) / ((df.get(term) ?? 0) + 0.5));
      const frequency = doc.tf.get(term) ?? 0;
      score += idf * (frequency * (K1 + 1) / (frequency + K1 * (1 - B + B * doc.length / average)) + (doc.titles.get(term) ?? 0));
    }
    score *= matched.size / terms.length;
    const hit = {
      id: `${LEARN_PREFIX}${doc.article.id}#${doc.section.id}`,
      title: doc.section.title,
      article: doc.article.title,
      url: learnSectionUrl(doc.article, doc.section),
      score: Math.round(score * 100) / 100,
      snippet: snippet2(doc.section.text, terms)
    };
    if (doc.section.pivots)
      hit.pivots = doc.section.pivots;
    hits.push(hit);
  }
  return hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
}
function snippet2(text, terms) {
  const lines = text.split("\n").map((line2) => line2.trim()).filter(Boolean);
  const line = lines.find((candidate) => terms.some((term) => candidate.toLowerCase().includes(term))) ?? lines[0] ?? "";
  return line.length > 200 ? `${line.slice(0, 197)}...` : line;
}
function isLearnId(id) {
  return id.toLowerCase().startsWith(LEARN_PREFIX);
}
function findLearn(index, id) {
  const [articleId, sectionId] = id.slice(LEARN_PREFIX.length).replace(/\.md$/, "").split("#");
  const article = index.articles.find((candidate) => candidate.id.toLowerCase() === articleId.toLowerCase());
  if (!article)
    return void 0;
  if (sectionId === void 0)
    return { article };
  const section = article.sections.find((candidate) => candidate.id === sectionId.toLowerCase());
  return section ? { article, section } : void 0;
}

// lib/tools/app/commands/docs.js
var LAYERS = ["all", "recipe", "learn"];
var MAX_CONTENT = 3e4;
var LEARN_SEARCH_URL = "https://learn.microsoft.com/api/search";
var FUNCTIONS_PATH = /\/azure\/(azure-functions|durable-task)\//;
function query(positionals, command) {
  const text = positionals.join(" ").trim();
  if (!text)
    throw new ToolError(EXIT.usage, `Provide search words, for example: ${command} "easy auth".`);
  return text;
}
function layerFlag(value) {
  const layer = (value ?? "all").toLowerCase();
  if (!LAYERS.includes(layer))
    throw new ToolError(EXIT.usage, `Unknown --layer "${value}". Use all, recipe, or learn.`);
  return layer;
}
function source(index) {
  return { repository: index.source.repository, commit: index.source.commit, license: index.source.license, attribution: index.source.attribution };
}
function cap(text) {
  return text.length > MAX_CONTENT ? { content: `${text.slice(0, MAX_CONTENT)}
...`, truncated: true } : { content: text, truncated: false };
}
async function searchOnline(context, text, limit) {
  try {
    const url = `${LEARN_SEARCH_URL}?search=${encodeURIComponent(text)}&locale=en-us&$top=25`;
    const response = await context.fetch(url, { method: "GET", headers: { Accept: "application/json" } });
    if (response.status !== 200)
      return void 0;
    const body = JSON.parse(await response.text());
    return (body.results ?? []).filter((result3) => result3.url && FUNCTIONS_PATH.test(result3.url)).slice(0, limit).map((result3) => ({ title: result3.title ?? result3.url ?? "", url: result3.url ?? "", snippet: result3.description ?? "", online: true }));
  } catch {
    return void 0;
  }
}
var docsCommands = [
  {
    name: "docs list",
    usage: "docs list",
    description: "List recipe documents and their section IDs, and the bundled Learn index version.",
    handler: async (_args, context) => {
      const docs = loadDocs(context.referencesDir);
      const index = loadLearnIndex(context.assetsDir);
      return {
        summary: `${docs.length} recipe documents, ${docs.reduce((sum, doc) => sum + doc.sections.length, 0)} sections.${index ? ` Learn index: ${index.articles.length} articles at ${index.source.commit.slice(0, 7)}.` : ""}`,
        data: {
          recipes: docs.map((doc) => ({ id: doc.id, title: doc.title, sections: doc.sections.map((section) => section.id) })),
          learn: index ? { ...source(index), generatedAt: index.source.generatedAt, articles: index.articles.length } : void 0
        },
        next: ["Find content with `docs search <words>`; read one section with `docs get <id>`."]
      };
    }
  },
  {
    name: "docs search",
    usage: "docs search <words> [--layer all|recipe|learn] [--lang python] [--plan flex] [--top 5]",
    description: "Search the recipes (how this tool does it) and the bundled Microsoft Learn docs for Azure Functions (product facts).",
    handler: async (args, context) => {
      const text = query(args.positionals, "docs search");
      const layer = layerFlag(stringFlag(args, "layer"));
      const filter = normalizeFilter({ lang: stringFlag(args, "lang"), plan: stringFlag(args, "plan") });
      const top = intFlag(args, "top", 5, 20);
      const findings = [];
      const recipes = layer === "learn" ? [] : searchDocs(loadDocs(context.referencesDir), text, top);
      let learn = [];
      if (layer !== "recipe") {
        const index = loadLearnIndex(context.assetsDir);
        if (index)
          learn = searchLearn(index, text, filter, top);
        else
          findings.push({ severity: "warning", code: "LearnIndexMissing", message: "The bundled Learn index is not installed.", fix: "Reinstall the azure-functions-skills plugin." });
        if (recipes.length === 0 && learn.length === 0) {
          const online = await searchOnline(context, text, top);
          if (online)
            learn = online;
          else
            findings.push({ severity: "info", code: "LearnSearchOffline", message: "The online Learn search was not reachable." });
        }
      }
      const best = recipes[0]?.id ?? (learn[0] && "id" in learn[0] ? learn[0].id : void 0);
      return {
        summary: `${recipes.length} recipe section(s) and ${learn.length} Learn section(s) match "${text}".`,
        data: { recipes, learn },
        findings,
        next: best ? [`Read the best match with \`docs get ${best}\`. Prefer recipes for how to do it with this tool; use Learn sections for product facts and limits.`] : learn.length ? ["These are online Learn results; open the URL only if needed. Do not run more web searches for the same question."] : ["Try other words or `api find <words>`. If still nothing, ask the user instead of guessing."]
      };
    }
  },
  {
    name: "docs get",
    usage: "docs get <recipe-id | learn:<article>[#section]>",
    description: "Print one recipe document or section, or one Microsoft Learn article outline or section with its URL.",
    handler: async (args, context) => {
      const id = args.positionals[0];
      if (!id)
        throw new ToolError(EXIT.usage, "Provide a document or section ID from `docs search` or `docs list`.");
      if (isLearnId(id)) {
        const index = loadLearnIndex(context.assetsDir);
        if (!index)
          throw new ToolError(EXIT.failed, "The bundled Learn index is not installed. Reinstall the azure-functions-skills plugin.");
        const found = findLearn(index, id);
        if (!found) {
          const hits = searchLearn(index, id.replace(/^learn:/i, "").replace(/[/#-]/g, " "), {}, 3);
          throw new ToolError(EXIT.usage, `No Learn article or section "${id}".`, { data: hits.map((hit) => hit.id), next: ["Pick one of the suggested IDs, or run `docs search <words> --layer learn`."] });
        }
        const { article, section } = found;
        if (section) {
          const { content, truncated } = cap(section.text);
          return {
            summary: `${section.title} \u2014 ${article.title} (Microsoft Learn)`,
            data: { id: `learn:${article.id}#${section.id}`, title: section.title, article: article.title, url: learnSectionUrl(article, section), pivots: section.pivots, content, source: source(index) },
            findings: truncated ? [{ severity: "info", code: "Truncated", message: `Content was cut at ${MAX_CONTENT} characters.`, fix: `Open ${learnSectionUrl(article, section)} for the rest.` }] : []
          };
        }
        return {
          summary: `${article.title} (Microsoft Learn): ${article.sections.length} sections.`,
          data: { id: `learn:${article.id}`, title: article.title, description: article.description, date: article.date, url: article.url, sections: article.sections.map((item) => ({ id: `learn:${article.id}#${item.id}`, title: item.title, pivots: item.pivots })), source: source(index) },
          next: ["Read only the section you need with `docs get learn:<article>#<section>`."]
        };
      }
      const docs = loadDocs(context.referencesDir);
      const doc = findDoc(docs, id);
      if (!doc) {
        const hits = searchDocs(docs, id.replace(/[/-]/g, " "), 3);
        throw new ToolError(EXIT.usage, `No document or section "${id}".`, {
          data: hits.map((hit) => hit.id),
          next: ["Pick one of the suggested IDs, or run `docs list`."]
        });
      }
      return { summary: `${doc.title} (${doc.id})`, data: { id: doc.id, title: doc.title, content: doc.content } };
    }
  },
  {
    name: "api find",
    usage: "api find <words> [--method GET|PUT|PATCH|POST|DELETE] [--top 8]",
    description: "Search the pinned REST API index (Microsoft.Web and related monitoring APIs).",
    handler: async (args, context) => {
      const text = query(args.positionals, "api find");
      const method = stringFlag(args, "method");
      if (method && !/^(GET|PUT|PATCH|POST|DELETE)$/i.test(method))
        throw new ToolError(EXIT.usage, "--method must be GET, PUT, PATCH, POST, or DELETE.");
      const hits = findOperations(loadApiIndex(join3(context.referencesDir, "api-index.json")), text, { method, limit: intFlag(args, "top", 8, 25) });
      if (hits.length === 0) {
        return { summary: `No REST operation matches "${text}".`, data: [], next: ["Stop and ask the user; do not guess a URL."] };
      }
      return {
        summary: `${hits.length} operations match "${text}".`,
        data: hits,
        next: [
          "Fill {placeholders} from `app inspect`, then call it with `rest <METHOD> <path>`; the api-version is filled in for you.",
          "Writes print a plan and exit 5 until the user approves; then rerun with --approve."
        ]
      };
    }
  }
];

// lib/tools/app/target.js
var WEB_API_VERSION = "2024-11-01";
var RESOURCE_GRAPH_API_VERSION = "2022-10-01";
var APP_ID = /^\/subscriptions\/([0-9a-f-]{36})\/resourceGroups\/([-\w.()]+)\/providers\/Microsoft\.Web\/sites\/([A-Za-z0-9-]+)(?:\/slots\/([A-Za-z0-9-]+))?$/i;
var SLOT_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,58}$/;
var APP_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,59}$/;
var RESOURCE_GROUP = /^[-\w.()]{1,90}$/;
var SUBSCRIPTION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parseAppId(id) {
  const match = APP_ID.exec(id.trim());
  if (!match)
    return void 0;
  const siteId = `/subscriptions/${match[1]}/resourceGroups/${match[2]}/providers/Microsoft.Web/sites/${match[3]}`;
  return makeTarget(siteId, match[1], match[2], match[3], match[4]);
}
function makeTarget(siteId, subscriptionId, resourceGroup, name, slot) {
  const useSlot = slot && slot.toLowerCase() !== "production" ? slot : void 0;
  return {
    id: useSlot ? `${siteId}/slots/${useSlot}` : siteId,
    siteId,
    name,
    resourceGroup,
    subscriptionId,
    slot: useSlot,
    label: useSlot ? `${name}/${useSlot}` : name,
    ref: useSlot ? `--app ${name} --slot ${useSlot}` : `--app ${name}`
  };
}
function withSlot(target, slot) {
  if (slot === void 0)
    return target;
  if (!SLOT_NAME.test(slot))
    throw new ToolError(EXIT.usage, `Invalid --slot "${slot}". Pass the slot name, for example --slot staging.`);
  const requested = slot.toLowerCase() === "production" ? void 0 : slot.toLowerCase();
  if (target.slot && target.slot.toLowerCase() !== requested)
    throw new ToolError(EXIT.usage, `--app points to slot ${target.slot} but --slot is ${slot}. Pass only one.`);
  return makeTarget(target.siteId, target.subscriptionId, target.resourceGroup, target.name, slot);
}
function validateScope(options) {
  if (options.resourceGroup !== void 0 && !RESOURCE_GROUP.test(options.resourceGroup)) {
    throw new ToolError(EXIT.usage, `Invalid --resource-group "${options.resourceGroup}".`);
  }
  if (options.subscription !== void 0 && !SUBSCRIPTION.test(options.subscription)) {
    throw new ToolError(EXIT.usage, `--subscription must be a subscription ID (GUID).`);
  }
}
async function queryGraph(client, query2, subscription) {
  const body = { query: query2, options: { resultFormat: "objectArray", $top: 200 } };
  if (subscription)
    body.subscriptions = [subscription];
  const result3 = await client.arm("POST", "/providers/Microsoft.ResourceGraph/resources", RESOURCE_GRAPH_API_VERSION, { body, idempotent: true });
  return result3.data;
}
async function resolveApp(client, options) {
  return withSlot(await resolveSite(client, options), options.slot);
}
async function resolveSite(client, options) {
  const fromId = parseAppId(options.app);
  if (fromId)
    return fromId;
  if (options.app.startsWith("/"))
    throw new ToolError(EXIT.usage, `--app is not a Microsoft.Web/sites resource ID: ${options.app}`);
  if (!APP_NAME.test(options.app))
    throw new ToolError(EXIT.usage, `Invalid app name "${options.app}". Use letters, digits, and hyphens, or pass the full resource ID.`);
  validateScope(options);
  const filters = [`type =~ 'microsoft.web/sites'`, `name =~ '${options.app}'`];
  if (options.resourceGroup)
    filters.push(`resourceGroup =~ '${options.resourceGroup}'`);
  const rows = await queryGraph(client, `resources | where ${filters.join(" and ")} | project id, name, resourceGroup, subscriptionId, kind`, options.subscription);
  if (rows.length === 0) {
    throw new ToolError(EXIT.usage, `No app named "${options.app}" was found in the subscriptions you can access.`, {
      next: ["Run `app find` to list Function Apps, or pass --subscription / the full resource ID."]
    });
  }
  if (rows.length > 1) {
    throw new ToolError(EXIT.usage, `"${options.app}" matches ${rows.length} apps. Pass --resource-group, --subscription, or the full resource ID.`, {
      data: rows.map((row2) => row2.id)
    });
  }
  const row = rows[0];
  return makeTarget(row.id, row.subscriptionId, row.resourceGroup, row.name, void 0);
}

// lib/tools/app/commands/common.js
var LRO_WAIT_MS = 3e5;
var APP_HINT = "Pass the Function App name or resource ID, for example --app my-func.";
function appTarget(client, args) {
  return resolveApp(client, {
    app: requireFlag(args, "app", APP_HINT),
    resourceGroup: stringFlag(args, "resource-group"),
    subscription: stringFlag(args, "subscription"),
    slot: stringFlag(args, "slot")
  });
}
function requireApproval(args, command, plan, findings = []) {
  if (boolFlag(args, "approve"))
    return;
  throw new ToolError(EXIT.approval, `${plan.risk} change needs approval: ${plan.impact}`, {
    data: plan,
    findings,
    next: [`Show this plan to the user. After they approve, run the same command with --approve: \`${command} ... --approve\`.`]
  });
}
function isOutcomeUnknown(error) {
  return error instanceof AzureError && (error.httpStatus === 0 || error.httpStatus >= 500);
}
function outcomeUnknown(error, what, checkCommand) {
  return new ToolError(EXIT.azure, `${what}: the outcome is unknown (${error.azureCode}). Do not resend it.`, {
    data: error.options.data,
    findings: [
      ...error.options.findings ?? [],
      { severity: "error", code: "OutcomeUnknown", message: `${what} may or may not have been applied.`, fix: `Check first with \`${checkCommand}\`; resend only if that shows the change is missing.` }
    ],
    next: [`Run \`${checkCommand}\` before deciding anything else.`]
  });
}
async function waitFor(read, done, options) {
  let elapsedMs = 0;
  let value;
  while (elapsedMs + options.intervalMs <= options.waitMs) {
    await options.sleep(options.intervalMs);
    elapsedMs += options.intervalMs;
    value = await read();
    if (value !== void 0 && done(value, elapsedMs))
      return { value, done: true, elapsedMs };
  }
  return { value, done: false, elapsedMs };
}
async function writeArm(context, step, checkCommand, waitMs = LRO_WAIT_MS) {
  const url = `${ARM_ENDPOINT}${step.url}`;
  try {
    const response = await context.client.send(step.method, url, ARM_RESOURCE, { body: step.body });
    if (response.status === 201 || response.status === 202) {
      const result3 = await context.client.poll(response, ARM_RESOURCE, waitMs);
      if (!result3.done)
        throw new ToolError(EXIT.failed, `${step.action} is still running after ${waitMs / 1e3}s.`, { next: [`Run \`${checkCommand}\` later. Do not resend.`] });
      if (result3.status !== "Succeeded")
        throw new ToolError(EXIT.azure, `${step.action} finished with status ${result3.status}.`, { data: result3.body });
    }
  } catch (error) {
    if (isOutcomeUnknown(error))
      throw outcomeUnknown(error, step.action, checkCommand);
    throw error;
  }
}
async function tryRead(read) {
  try {
    return await read();
  } catch {
    return void 0;
  }
}

// lib/tools/app/commands/invoke.js
var BODY_LIMIT = 4e3;
var SAFE_METHODS = /* @__PURE__ */ new Set(["GET", "HEAD", "OPTIONS"]);
function readFunction(client, app, fn) {
  return client.arm("GET", `${app.id}/functions/${encodeURIComponent(fn)}`, WEB_API_VERSION);
}
function triggerOf(fn) {
  const bindings = fn.properties.config?.bindings ?? [];
  return bindings.find((binding) => binding.type?.toLowerCase().endsWith("trigger")) ?? bindings.find((binding) => binding.direction === "in");
}
function splitPair(raw, separator, flag) {
  const index = raw.indexOf(separator);
  if (index <= 0)
    throw new ToolError(EXIT.usage, `--${flag} must look like name${separator}value, got "${raw}".`);
  return [raw.slice(0, index).trim(), raw.slice(index + 1).trim()];
}
function buildUrl(template, request) {
  const url = new URL(template);
  if (request.path !== void 0)
    url.pathname = request.path.startsWith("/") ? request.path : `/${request.path}`;
  if (/[{}]|%7B|%7D/i.test(url.pathname)) {
    throw new ToolError(EXIT.usage, `The route has parameters (${decodeURIComponent(url.pathname)}). Pass the concrete path with --path, for example --path /api/items/42.`);
  }
  for (const pair of request.query ?? []) {
    const [name, value] = splitPair(pair, "=", "query");
    url.searchParams.append(name, value);
  }
  return url;
}
function parseResponseBody(text, secrets) {
  let clean = text;
  for (const secret of secrets)
    clean = clean.split(secret).join("<redacted>");
  clean = scrubText(clean);
  if (clean.length === 0)
    return void 0;
  try {
    const parsed = JSON.parse(clean);
    if (clean.length <= BODY_LIMIT)
      return parsed;
  } catch {
  }
  return clean.length > BODY_LIMIT ? `${clean.slice(0, BODY_LIMIT)}\u2026 (${clean.length} chars, truncated)` : clean;
}
async function send(fetch2, now, method, url, headers, body, secrets) {
  const started = now().getTime();
  let response;
  try {
    response = await fetch2(url, { method, headers, body });
  } catch (error) {
    throw new ToolError(EXIT.azure, `Request to ${new URL(url).host} failed: ${scrubText(String(error))}`, {
      next: ["Check that the app is running (`host status`) and reachable from this machine (private endpoints or access restrictions block it)."]
    });
  }
  const text = await response.text();
  return { status: response.status, elapsedMs: Math.max(0, now().getTime() - started), body: parseResponseBody(text, secrets) };
}
async function functionKey(client, app, fn, authLevel) {
  if (authLevel === "anonymous")
    return void 0;
  if (authLevel === "function") {
    const keys = await client.arm("POST", `${app.id}/functions/${encodeURIComponent(fn)}/listkeys`, WEB_API_VERSION, { idempotent: true });
    const key = keys?.default ?? Object.values(keys ?? {})[0];
    if (key)
      return key;
  }
  return masterKey(client, app);
}
async function masterKey(client, app) {
  const keys = await client.arm("POST", `${app.id}/host/default/listkeys`, WEB_API_VERSION, { idempotent: true });
  if (!keys.masterKey)
    throw new ToolError(EXIT.azure, `${app.label}: no master key was returned.`, { next: [`Run \`keys list ${app.ref}\` to inspect the host keys.`] });
  return keys.masterKey;
}
function statusFindings(status, keyUsed, app) {
  if (status === 401 || status === 403) {
    return [{
      severity: "error",
      code: keyUsed ? "KeyRejected" : "AccessDenied",
      message: keyUsed ? `The runtime rejected the key returned by ARM (${status}). After a swap or deployment the host key store can be out of sync with ARM; a restart does not fix it.` : `The function returned ${status} without a key (authentication or access restrictions in front of the app).`,
      fix: keyUsed ? `Sync triggers once (R1): \`rest POST ${app.id}/syncfunctiontriggers --approve\`, wait 20 seconds, and call again. If it persists: \`host status ${app.ref}\` and \`settings list ${app.ref}\` (AzureWebJobsSecretStorageType, AzureWebJobsStorage). Never print key values while investigating.` : "Check App Service authentication and access restrictions with `rest get` on config/authsettingsV2 and config/web."
    }];
  }
  if (status === 404)
    return [{ severity: "warning", code: "RouteNotFound", message: "The function URL returned 404.", fix: `Check \`functions list ${app.ref}\` for the route and whether the latest deployment is active.` }];
  if (status >= 500)
    return [{ severity: "error", code: "FunctionFailed", message: `The function returned ${status}.`, fix: `Run \`logs query ${app.ref} --preset errors --since 30m\`.` }];
  return [];
}
async function invokeFunction(context, app, fn, request, known) {
  const envelope = known ?? await readFunction(context.client, app, fn);
  const trigger = triggerOf(envelope);
  const triggerType = trigger?.type ?? "unknown";
  const findings = [];
  if (envelope.properties.isDisabled)
    findings.push({ severity: "warning", code: "FunctionDisabled", message: `${fn} is disabled; the call is expected to fail.`, fix: `Check AzureWebJobs.${fn}.Disabled in \`settings list\`.` });
  if (triggerType.toLowerCase() === "httptrigger") {
    const template = envelope.properties.invoke_url_template;
    if (!template)
      throw new ToolError(EXIT.azure, `${fn} has no invoke URL; the host may not have indexed it yet.`, { next: [`Run \`functions list ${app.ref}\` and \`host status ${app.ref}\`.`] });
    const authLevel = (trigger?.authLevel ?? "function").toLowerCase();
    const url2 = buildUrl(template, request).toString();
    const method = (request.method ?? trigger?.methods?.[0] ?? "GET").toUpperCase();
    const key2 = await functionKey(context.client, app, fn, authLevel);
    const headers = { Accept: "application/json, text/plain, */*" };
    for (const raw of request.headers ?? []) {
      const [name, value] = splitPair(raw, ":", "header");
      headers[name] = value;
    }
    if (request.body !== void 0 && !Object.keys(headers).some((name) => name.toLowerCase() === "content-type"))
      headers["Content-Type"] = "application/json";
    if (key2)
      headers["x-functions-key"] = key2;
    const response2 = await send(context.fetch, context.now, method, url2, headers, request.body, key2 ? [key2] : []);
    findings.push(...statusFindings(response2.status, Boolean(key2), app));
    return { result: { function: fn, trigger: triggerType, method, url: url2, authLevel, ...response2 }, findings };
  }
  const site = await context.client.arm("GET", app.id, WEB_API_VERSION);
  const host = site.properties.defaultHostName;
  if (!host)
    throw new ToolError(EXIT.azure, `${app.label} has no default host name.`);
  const key = await masterKey(context.client, app);
  const url = `https://${host}/admin/functions/${encodeURIComponent(fn)}`;
  const body = JSON.stringify({ input: request.body ?? "" });
  const response = await send(context.fetch, context.now, "POST", url, { "Content-Type": "application/json", "x-functions-key": key }, body, [key]);
  if (response.status !== 202)
    findings.push(...statusFindings(response.status, true, app));
  return { result: { function: fn, trigger: triggerType, method: "POST", url, status: response.status, elapsedMs: response.elapsedMs, body: response.body }, findings };
}
var invokeCommands = [
  {
    name: "functions invoke",
    usage: 'functions invoke --app <name|id> [--slot <s>] --function <name> [--method GET] [--path /api/x/1] [--query k=v]... [--header "Name: value"]... [--body <json> | --body-file <path|->] [--approve]',
    description: "Call one function once and return the status, time, and response body. Keys are fetched through ARM and never printed.",
    details: [
      "HTTP triggers: uses the function URL; adds the function key (authLevel function) or master key (admin). Anonymous functions get no key. GET/HEAD/OPTIONS run directly; other methods need --approve (R1).",
      "Routes with parameters need --path. --query and --header can repeat.",
      "Other triggers (timer, queue, ...): POST /admin/functions/<name> with the master key; --body becomes the input string. Needs --approve (it runs the function once). Expect 202; check results with `logs query`.",
      "401 with a key usually means the host key store is out of sync after a swap or deployment \u2014 see the KeyRejected finding (sync triggers, not restart)."
    ],
    handler: async (args, context) => {
      const app = await appTarget(context.client, args);
      const fn = requireFlag(args, "function", "Pass the function name from `functions list`.");
      const bodyFile = stringFlag(args, "body-file");
      const inline = stringFlag(args, "body");
      if (bodyFile !== void 0 && inline !== void 0)
        throw new ToolError(EXIT.usage, "Pass only one of --body and --body-file.");
      const body = bodyFile !== void 0 ? await context.readInput(bodyFile) : inline;
      const request = { method: stringFlag(args, "method"), path: stringFlag(args, "path"), query: listFlag(args, "query"), headers: listFlag(args, "header"), body };
      const preview = await readFunction(context.client, app, fn);
      const trigger = triggerOf(preview);
      const isHttp = trigger?.type?.toLowerCase() === "httptrigger";
      const method = (request.method ?? trigger?.methods?.[0] ?? "GET").toUpperCase();
      if (isHttp && !SAFE_METHODS.has(method)) {
        requireApproval(args, `functions invoke ${app.ref} --function ${fn} --method ${method}`, {
          risk: "R1",
          impact: `Send ${method} to ${fn} on ${app.label} once. The function runs for real with this body.`,
          steps: [{ action: "call function", method, url: preview.properties.invoke_url_template ?? fn }],
          rollback: "None; undo any side effects of the function yourself."
        });
      }
      if (!isHttp) {
        requireApproval(args, `functions invoke ${app.ref} --function ${fn}`, {
          risk: "R1",
          impact: `Run ${fn} (${triggerOf(preview)?.type ?? "unknown trigger"}) once on ${app.label} through the admin endpoint. Its side effects happen for real.`,
          steps: [{ action: "run function", method: "POST", url: `https://<host>/admin/functions/${fn}` }],
          rollback: "None; undo any side effects of the function yourself."
        });
      }
      const { result: result3, findings } = await invokeFunction(context, app, fn, request, preview);
      const ok = result3.status >= 200 && result3.status < 300;
      return {
        summary: `${app.label}/${fn}: ${result3.method} \u2192 ${result3.status} in ${result3.elapsedMs} ms${ok ? "" : " (see findings)"}.`,
        data: result3,
        findings,
        next: ok && result3.status === 202 ? [`Check the run with \`logs query ${app.ref} --preset traces --since 15m\`.`] : void 0
      };
    }
  }
];

// lib/tools/app/inspect.js
function detectPlan(site, plan) {
  if (site.properties.managedEnvironmentId)
    return "ContainerApps";
  if (site.properties.functionAppConfig || plan?.sku?.name === "FC1" || plan?.sku?.tier === "FlexConsumption")
    return "FlexConsumption";
  if (plan?.sku?.tier === "Dynamic" || plan?.sku?.name === "Y1")
    return "Consumption";
  if (plan?.sku?.tier === "ElasticPremium")
    return "Premium";
  return "Dedicated";
}
function scmHost(site) {
  return site.properties.hostNameSslStates?.find((state) => state.hostType === "Repository")?.name;
}
function runtimeOf(site, config, settings) {
  const flex = site.properties.functionAppConfig?.runtime;
  if (flex?.name)
    return { stack: flex.name, version: flex.version };
  const fx = config.properties.linuxFxVersion;
  if (fx && fx.includes("|")) {
    const [stack2, version] = fx.split("|");
    return { stack: stack2.toLowerCase(), version };
  }
  const stack = settings.FUNCTIONS_WORKER_RUNTIME;
  if (stack === "powershell")
    return { stack, version: config.properties.powerShellVersion };
  if (stack === "node")
    return { stack, version: settings.WEBSITE_NODE_DEFAULT_VERSION };
  if (stack === "java")
    return { stack, version: config.properties.javaVersion ?? void 0 };
  return { stack, version: stack?.startsWith("dotnet") ? config.properties.netFrameworkVersion : void 0 };
}
function storageMode(settings) {
  if (settings.AzureWebJobsStorage__accountName || settings.AzureWebJobsStorage__blobServiceUri)
    return "identity";
  if (settings.AzureWebJobsStorage)
    return "connectionString";
  return "missing";
}
function summarizeApp(site, config, plan, settings) {
  const hostingPlan = detectPlan(site, plan);
  const runtime = runtimeOf(site, config, settings);
  const storage = storageMode(settings);
  const appInsights = Boolean(settings.APPLICATIONINSIGHTS_CONNECTION_STRING || settings.APPINSIGHTS_INSTRUMENTATIONKEY);
  const findings = [];
  const p = site.properties;
  const c = config.properties;
  if (p.state && p.state !== "Running")
    findings.push({ severity: "warning", code: "AppNotRunning", message: `The app state is ${p.state}.`, fix: "Start the app if it should serve traffic." });
  if (p.httpsOnly === false)
    findings.push({ severity: "warning", code: "HttpsNotEnforced", message: "HTTPS Only is off.", fix: "Set httpsOnly to true (R1)." });
  if (c.minTlsVersion && c.minTlsVersion < "1.2")
    findings.push({ severity: "warning", code: "WeakTls", message: `Minimum TLS version is ${c.minTlsVersion}.`, fix: "Set minTlsVersion to 1.2 (R1)." });
  if (c.ftpsState === "AllAllowed")
    findings.push({ severity: "warning", code: "FtpAllowed", message: "Plain FTP is allowed.", fix: "Set ftpsState to Disabled or FtpsOnly (R1)." });
  if (!appInsights)
    findings.push({ severity: "warning", code: "NoAppInsights", message: "Application Insights is not configured, so `logs query` has no data.", fix: "Add APPLICATIONINSIGHTS_CONNECTION_STRING (R1)." });
  if (storage === "missing")
    findings.push({ severity: "error", code: "NoHostStorage", message: "AzureWebJobsStorage is not configured; the host cannot start.", fix: "Configure AzureWebJobsStorage or AzureWebJobsStorage__accountName with a managed identity." });
  if (storage === "connectionString")
    findings.push({ severity: "info", code: "StorageKeyAuth", message: "Host storage uses a connection string (shared key).", fix: "Prefer identity-based AzureWebJobsStorage__accountName with a managed identity." });
  const extension = settings.FUNCTIONS_EXTENSION_VERSION;
  if (extension && /^~[123]$/.test(extension))
    findings.push({ severity: "error", code: "UnsupportedHostVersion", message: `FUNCTIONS_EXTENSION_VERSION is ${extension}, which is out of support.`, fix: "Migrate to ~4." });
  if (hostingPlan === "FlexConsumption") {
    for (const name of ["FUNCTIONS_WORKER_RUNTIME", "FUNCTIONS_EXTENSION_VERSION", "WEBSITE_RUN_FROM_PACKAGE", "WEBSITE_CONTENTSHARE", "WEBSITE_CONTENTAZUREFILECONNECTIONSTRING"]) {
      if (name in settings)
        findings.push({ severity: "warning", code: "FlexUnsupportedSetting", message: `${name} is not used on Flex Consumption and can break deployments.`, fix: `Remove ${name} (R1).` });
    }
  }
  const identity = site.identity?.type && site.identity.type !== "None" ? {
    type: site.identity.type,
    systemAssignedPrincipalId: site.identity.principalId,
    userAssigned: Object.entries(site.identity.userAssignedIdentities ?? {}).map(([id, value]) => ({ id, clientId: value.clientId, principalId: value.principalId }))
  } : void 0;
  const flex = p.functionAppConfig;
  const data = {
    name: site.name,
    id: site.id,
    location: site.location,
    kind: site.kind,
    state: p.state,
    defaultHostName: p.defaultHostName,
    scmHost: scmHost(site),
    hostingPlan,
    plan: plan ? { name: plan.name, sku: plan.sku?.name, tier: plan.sku?.tier, maximumElasticWorkerCount: hostingPlan === "Premium" ? plan.properties?.maximumElasticWorkerCount : void 0 } : void 0,
    runtime,
    functionsExtensionVersion: extension,
    scale: flex?.scaleAndConcurrency ? { maximumInstanceCount: flex.scaleAndConcurrency.maximumInstanceCount, instanceMemoryMB: flex.scaleAndConcurrency.instanceMemoryMB, alwaysReady: flex.scaleAndConcurrency.alwaysReady ?? [] } : { functionAppScaleLimit: c.functionAppScaleLimit ?? void 0, minimumElasticInstanceCount: c.minimumElasticInstanceCount ?? void 0, alwaysOn: c.alwaysOn },
    deploymentStorage: flex?.deployment?.storage ? { type: flex.deployment.storage.type, container: flex.deployment.storage.value, authentication: flex.deployment.storage.authentication?.type } : void 0,
    hostStorage: storage,
    appInsights,
    identity,
    security: { httpsOnly: p.httpsOnly, minTlsVersion: c.minTlsVersion, ftpsState: c.ftpsState, http20Enabled: c.http20Enabled },
    network: { publicNetworkAccess: p.publicNetworkAccess ?? "Enabled", virtualNetworkSubnetId: p.virtualNetworkSubnetId ?? void 0, vnetRouteAllEnabled: c.vnetRouteAllEnabled },
    cors: c.cors?.allowedOrigins?.length ? { allowedOrigins: c.cors.allowedOrigins, supportCredentials: c.cors.supportCredentials } : void 0,
    healthCheckPath: c.healthCheckPath ?? void 0,
    settingCount: Object.keys(settings).length
  };
  return { data, findings };
}

// lib/tools/app/commands/logstream.js
var MAX_SECONDS = 120;
var MAX_CHARS = 2e5;
var MAX_LINES = 200;
var LINE_LIMIT = 1e3;
var INVOKE_DELAY_MS = 2e3;
var SENTINEL_PATH = "/api/vfs/LogFiles/Application/Functions/Host/debug_sentinel";
var SENTINEL_TEXT = "This is a system managed marker file used to control runtime debug mode behavior.";
var BANNER = /connected to log-streaming service|No new trace in the past/i;
function logLines(text) {
  const seen = /* @__PURE__ */ new Set();
  const lines = [];
  const segments = text.split("\n");
  const partial = text.endsWith("\n") ? void 0 : segments.pop()?.trim();
  for (const raw of segments) {
    const line = raw.trim();
    if (!line || BANNER.test(line) || seen.has(line))
      continue;
    seen.add(line);
  }
  if (partial && !BANNER.test(partial) && ![...seen].some((line) => line.startsWith(partial)))
    seen.add(partial);
  for (const line of seen) {
    const scrubbed = scrubText(line);
    lines.push(scrubbed.length > LINE_LIMIT ? `${scrubbed.slice(0, LINE_LIMIT)}...` : scrubbed);
  }
  return { lines: lines.slice(-MAX_LINES), total: lines.length };
}
var logStreamCommands = [
  {
    name: "logs tail",
    usage: "logs tail --app <name|id> [--slot <s>] [--seconds 30] [--invoke <function>] [--approve]",
    description: "Watch the live log stream for a bounded time (no portal needed), with the current instance list. --invoke calls a function once while watching.",
    details: [
      "Windows: turns on Functions debug mode first (the same marker file the portal log stream writes; file logging stays on for 15 minutes), then streams LogFiles/Application/Functions over Kudu. Lines from every instance appear because the log files are shared.",
      "Linux (Premium/Dedicated): streams the container log over Kudu; no debug mode is needed.",
      "Flex Consumption and Container Apps have no Kudu log stream: use `logs query` (Application Insights, 1-5 minute delay).",
      "--seconds 1-120 (default 30). Returns up to 200 de-duplicated, redacted lines; the connection banner is dropped.",
      "--invoke <function>: calls the function about 2 s after the stream opens (HTTP GET runs directly; other triggers need --approve) and returns its status with the lines.",
      "Output: data.lines, data.instances {count, names}, data.invoke, data.debugMode, data.ended (timeout | limit | closed)."
    ],
    handler: async (args, context) => {
      const { client, sleep } = context;
      const seconds = intFlag(args, "seconds", 30, MAX_SECONDS);
      const app = await appTarget(client, args);
      const fnName = stringFlag(args, "invoke");
      const site = await client.arm("GET", app.id, WEB_API_VERSION);
      const plan = detectPlan(site);
      const host = scmHost(site);
      if (plan === "FlexConsumption" || plan === "ContainerApps" || !host) {
        throw new ToolError(EXIT.unsupported, `${app.label} has no Kudu log stream (${plan === "Dedicated" ? "no SCM endpoint" : plan}).`, {
          next: [`Use \`logs query ${app.ref} --preset traces --since 15m\` (Application Insights; new events take 1-5 minutes to appear).`]
        });
      }
      const preview = fnName ? await readFunction(client, app, fnName) : void 0;
      if (fnName && preview) {
        const trigger = triggerOf(preview);
        const method = (trigger?.methods?.[0] ?? "GET").toUpperCase();
        if (trigger?.type?.toLowerCase() !== "httptrigger" || method !== "GET") {
          requireApproval(args, `logs tail ${app.ref} --invoke ${fnName}`, {
            risk: "R1",
            impact: `Run ${fnName} (${trigger?.type ?? "unknown trigger"}) once on ${app.label} while watching the log stream. Its side effects happen for real.`,
            steps: [{ action: "run function", method: trigger?.type?.toLowerCase() === "httptrigger" ? method : "POST", url: preview.properties.invoke_url_template ?? `https://<host>/admin/functions/${fnName}` }],
            rollback: "None; undo any side effects of the function yourself."
          });
        }
      }
      const findings = [];
      const linux = (site.kind ?? "").toLowerCase().includes("linux");
      let debugMode = "not needed (Linux container log)";
      if (!linux) {
        try {
          await client.send("PUT", `https://${host}${SENTINEL_PATH}`, SCM_RESOURCE, { rawBody: SENTINEL_TEXT, headers: { "If-Match": "*" } });
          debugMode = "on for 15 min (function logs are written to files)";
        } catch (error) {
          debugMode = "could not be turned on";
          findings.push({ severity: "warning", code: "DebugModeNotSet", message: `Could not write the debug marker, so function logs may not appear: ${error instanceof Error ? error.message : String(error)}`, fix: "Check that you can write to the app (Website Contributor) and that SCM basic or Entra access is allowed." });
        }
      }
      const instances = await tryRead(() => client.arm("GET", `${app.id}/instances`, WEB_API_VERSION));
      const path = linux ? "/api/logstream" : "/api/logstream/application/functions";
      let invoking;
      const streamed = await client.stream(`https://${host}${path}`, SCM_RESOURCE, seconds * 1e3, MAX_CHARS, () => {
        if (!fnName)
          return;
        invoking = sleep(INVOKE_DELAY_MS).then(() => invokeFunction(context, app, fnName, { method: "GET" }, preview)).catch((error) => ({ findings: [{ severity: "error", code: "InvokeFailed", message: `Calling ${fnName} failed: ${error instanceof Error ? scrubText(error.message) : String(error)}`, fix: `Retry with \`functions invoke ${app.ref} --function ${fnName}\` for details.` }] }));
      });
      const invoked = invoking ? await invoking : void 0;
      if (invoked)
        findings.push(...invoked.findings);
      const { lines, total } = logLines(streamed.text);
      if (lines.length === 0) {
        findings.push({
          severity: "info",
          code: "NoLogLines",
          message: `No log lines in ${seconds}s. The stream only shows new events.`,
          fix: `Trigger the function while watching (\`--invoke <function>\`), widen --seconds, or read recent history with \`logs query ${app.ref} --preset traces --since 30m\`.`
        });
      }
      const instanceNames = instances?.value.map((instance) => instance.name);
      const invokeSummary = invoked?.result ? ` ${fnName} \u2192 ${invoked.result.status}.` : "";
      return {
        summary: `${lines.length} log line(s) from ${app.label} in ${seconds}s; ${instanceNames ? `${instanceNames.length} instance(s)` : "instances unknown"}.${invokeSummary}`,
        data: {
          seconds,
          stream: `https://${host}${path}`,
          debugMode,
          ended: streamed.ended,
          instances: instanceNames ? { count: instanceNames.length, names: instanceNames } : void 0,
          invoke: invoked?.result,
          lines,
          truncatedLines: total > lines.length ? total - lines.length : void 0
        },
        findings
      };
    }
  }
];

// lib/tools/app/commands/ops.js
var POLL_MS = 1e4;
function readHostStatus(client, app) {
  return client.arm("GET", `${app.id}/hostruntime/admin/host/status`, WEB_API_VERSION);
}
function isRestarted(before, after, elapsedMs) {
  if (after.state !== "Running")
    return false;
  if (before?.instanceId && after.instanceId && before.instanceId !== after.instanceId)
    return true;
  if (typeof after.processUptime !== "number")
    return false;
  if (typeof before?.processUptime === "number")
    return after.processUptime < before.processUptime;
  return after.processUptime <= elapsedMs + POLL_MS;
}
var opsCommands = [
  {
    name: "host status",
    usage: "host status --app <name|id> [--slot <s>] [--full]",
    description: "Show the Functions host state, version, extension bundle, and uptime.",
    details: ["--full returns the raw host status payload from the runtime (all fields).", "Function list, trigger types, and disabled state: `functions list`."],
    handler: async (args, { client }) => {
      const app = await appTarget(client, args);
      const status = await readHostStatus(client, app);
      const findings = [];
      if (status.state !== "Running") {
        findings.push({ severity: "error", code: "HostNotRunning", message: `Host state is ${status.state ?? "unknown"}${status.errors?.length ? `: ${status.errors.join("; ")}` : ""}.`, fix: "Check `logs query --preset errors` and `settings list` (storage and Key Vault references)." });
      }
      return {
        summary: `${app.label}: host ${status.state ?? "unknown"}, version ${status.version ?? "unknown"}.`,
        data: boolFlag(args, "full") ? status : { state: status.state, version: status.version, platformVersion: status.platformVersion, extensionBundle: status.extensionBundle, uptimeSeconds: typeof status.processUptime === "number" ? Math.round(status.processUptime / 1e3) : void 0, errors: status.errors },
        findings
      };
    }
  },
  {
    name: "keys list",
    usage: "keys list --app <name|id> [--slot <s>] [--function <name>]",
    description: "List host key names (master, function, system), or one function's key names with --function. Values are never printed.",
    handler: async (args, { client }) => {
      const app = await appTarget(client, args);
      const fn = stringFlag(args, "function");
      if (fn) {
        const keys2 = await client.arm("POST", `${app.id}/functions/${encodeURIComponent(fn)}/listkeys`, WEB_API_VERSION, { idempotent: true });
        const names = Object.keys(keys2 ?? {});
        return {
          summary: `${app.label}/${fn}: ${names.length} function key(s). Values are hidden.`,
          data: { function: fn, keys: names },
          next: ["To call the function with a key, let the user copy it themselves; do not print key values."]
        };
      }
      const keys = await client.arm("POST", `${app.id}/host/default/listkeys`, WEB_API_VERSION, { idempotent: true });
      return {
        summary: `${app.label}: ${Object.keys(keys.functionKeys ?? {}).length} function key(s), ${Object.keys(keys.systemKeys ?? {}).length} system key(s). Values are hidden.`,
        data: { masterKey: Boolean(keys.masterKey), functionKeys: Object.keys(keys.functionKeys ?? {}), systemKeys: Object.keys(keys.systemKeys ?? {}) },
        next: ["To call a function with a key, let the user copy it themselves; do not print key values."]
      };
    }
  },
  {
    name: "restart",
    usage: "restart --app <name|id> [--slot <s>] [--approve] [--wait 180]",
    description: "Restart the app once and verify the new host process through the host status.",
    handler: async (args, { client, sleep }) => {
      const app = await appTarget(client, args);
      const waitSeconds = intFlag(args, "wait", 180, 900);
      requireApproval(args, `restart ${app.ref}`, {
        risk: "R1",
        impact: `Restart ${app.label}. In-flight executions stop; the app is unavailable for a short time.`,
        steps: [{ action: "restart", method: "POST", url: `${app.id}/restart` }],
        rollback: "None needed; the app comes back on its own."
      });
      const before = await tryRead(() => readHostStatus(client, app));
      try {
        await client.arm("POST", `${app.id}/restart`, WEB_API_VERSION);
      } catch (error) {
        if (isOutcomeUnknown(error))
          throw outcomeUnknown(error, `Restart of ${app.label}`, `host status ${app.ref}`);
        throw error;
      }
      const result3 = await waitFor(() => tryRead(() => readHostStatus(client, app)), (status, elapsed) => isRestarted(before, status, elapsed), { sleep, waitMs: waitSeconds * 1e3, intervalMs: POLL_MS });
      const data = { verified: result3.done, waitedSeconds: Math.round(result3.elapsedMs / 1e3), state: result3.value?.state, before: before && { instanceId: before.instanceId, uptimeSeconds: secondsOf(before) }, after: result3.value && { instanceId: result3.value.instanceId, uptimeSeconds: secondsOf(result3.value) } };
      if (result3.done)
        return { summary: `${app.label} restarted and the host is Running.`, data };
      return {
        summary: `${app.label}: restart was sent once, but a new host process was not confirmed within ${waitSeconds}s.`,
        data,
        findings: [{ severity: "warning", code: "RestartNotVerified", message: "The restart request succeeded but the host status did not show a new process yet.", fix: "Do not restart again. Run `host status` in a minute; if the host is not Running, check `logs query --preset errors`." }]
      };
    }
  }
];
function secondsOf(status) {
  return typeof status.processUptime === "number" ? Math.round(status.processUptime / 1e3) : void 0;
}

// lib/tools/app/commands/network.js
var NETWORK_API_VERSION = "2024-05-01";
var PROVIDER_API_VERSION = "2021-04-01";
var PROVIDER_WAIT_MS = 3e5;
var HOST_WAIT_MS = 12e4;
var RULES = {
  FlexConsumption: { delegation: "Microsoft.App/environments", minPrefix: 27, recommendedPrefix: 27, needsAppProvider: true },
  Premium: { delegation: "Microsoft.Web/serverFarms", minPrefix: 28, recommendedPrefix: 26, needsAppProvider: false },
  Dedicated: { delegation: "Microsoft.Web/serverFarms", minPrefix: 28, recommendedPrefix: 26, needsAppProvider: false }
};
var VNET_ID = /^(\/subscriptions\/[0-9a-f-]{36}\/resourceGroups\/[-\w.()]+\/providers\/Microsoft\.Network\/virtualNetworks\/[-\w.]+)(\/subnets\/([-\w.]+))?$/i;
var RESOURCE_NAME = /^[A-Za-z0-9][-\w.]{0,79}$/;
function cidr(prefix) {
  const match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/.exec(prefix.trim());
  if (!match)
    throw new ToolError(EXIT.usage, `Not an IPv4 CIDR: ${prefix}`);
  const length = Number(match[5]);
  const address = (Number(match[1]) << 24 | Number(match[2]) << 16 | Number(match[3]) << 8 | Number(match[4])) >>> 0;
  const size = 2 ** (32 - length);
  const start = address - address % size;
  return { start, end: start + size - 1, length };
}
function formatIp(value) {
  return [24, 16, 8, 0].map((shift) => value >>> shift & 255).join(".");
}
function findFreePrefix(spaces, used, length) {
  const taken = used.map(cidr);
  const size = 2 ** (32 - length);
  for (const space of spaces.map(cidr)) {
    if (space.length > length)
      continue;
    for (let start = space.start; start + size - 1 <= space.end; start += size) {
      const end = start + size - 1;
      if (!taken.some((block) => block.start <= end && start <= block.end))
        return `${formatIp(start)}/${length}`;
    }
  }
  return void 0;
}
function prefixesOf(subnet) {
  return subnet.properties?.addressPrefixes ?? (subnet.properties?.addressPrefix ? [subnet.properties.addressPrefix] : []);
}
function sameId(a, b) {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}
async function loadSite(client, app) {
  const site = await client.arm("GET", app.id, WEB_API_VERSION);
  const plan = !site.properties.functionAppConfig && site.properties.serverFarmId ? await client.arm("GET", site.properties.serverFarmId, WEB_API_VERSION) : void 0;
  return { site, hostingPlan: detectPlan(site, plan) };
}
function withVersion(path, version) {
  return `${path}?api-version=${version}`;
}
async function freeAddressSpace(client, subscriptionId) {
  const rows = await queryGraph(client, "resources | where type =~ 'microsoft.network/virtualnetworks' | project id, prefixes = properties.addressSpace.addressPrefixes", subscriptionId);
  const used = rows.flatMap((row) => Array.isArray(row.prefixes) ? row.prefixes.filter((item) => typeof item === "string") : []);
  const space = findFreePrefix(["10.0.0.0/8", "172.16.0.0/12"], used, 16) ?? findFreePrefix(["192.168.0.0/16"], used, 24);
  if (!space)
    throw new ToolError(EXIT.usage, "Every private range is already used by a VNet in this subscription. Pass --address-space <cidr>.");
  return space;
}
async function chooseSubnet(args, context, app, site, rule) {
  const { client } = context;
  const subnetFlag = stringFlag(args, "subnet");
  const vnetFlag = stringFlag(args, "vnet");
  const createSubnet = boolFlag(args, "create-subnet");
  const createVnet = boolFlag(args, "create-vnet");
  const modes = [Boolean(subnetFlag), Boolean(vnetFlag && createSubnet), createVnet].filter(Boolean).length;
  if (modes !== 1 || vnetFlag && !createSubnet) {
    throw new ToolError(EXIT.usage, "Choose one: --subnet <subnet-id>, --vnet <vnet-id|name> --create-subnet, or --create-vnet.");
  }
  const subnetName = stringFlag(args, "subnet-name") ?? "snet-functions";
  if (!RESOURCE_NAME.test(subnetName))
    throw new ToolError(EXIT.usage, `Invalid --subnet-name "${subnetName}".`);
  const delegations = [{ name: "delegation", properties: { serviceName: rule.delegation } }];
  if (createVnet) {
    const vnetName = stringFlag(args, "vnet-name") ?? `vnet-${app.name}`;
    if (!RESOURCE_NAME.test(vnetName))
      throw new ToolError(EXIT.usage, `Invalid --vnet-name "${vnetName}".`);
    const vnetId2 = `/subscriptions/${app.subscriptionId}/resourceGroups/${app.resourceGroup}/providers/Microsoft.Network/virtualNetworks/${vnetName}`;
    if (await tryRead(() => client.arm("GET", vnetId2, NETWORK_API_VERSION))) {
      throw new ToolError(EXIT.usage, `VNet ${vnetName} already exists. Use --vnet ${vnetId2} --create-subnet instead.`);
    }
    const explicitSpace = stringFlag(args, "address-space");
    const findings2 = [];
    let space = explicitSpace;
    if (!space) {
      space = await freeAddressSpace(client, app.subscriptionId);
      findings2.push({ severity: "info", code: "AddressSpaceChosen", message: `Chose ${space}, which overlaps no VNet in subscription ${app.subscriptionId}.`, fix: "Peered networks in other subscriptions and on-premises ranges are not checked; pass --address-space if you plan to peer or connect a VPN." });
    }
    const prefix = findFreePrefix([space], [], rule.recommendedPrefix);
    if (!prefix)
      throw new ToolError(EXIT.usage, `--address-space ${space} is smaller than /${rule.recommendedPrefix}.`);
    return {
      subnetId: `${vnetId2}/subnets/${subnetName}`,
      findings: findings2,
      steps: [{ action: "create vnet", method: "PUT", url: withVersion(vnetId2, NETWORK_API_VERSION), body: { location: site.location, properties: { addressSpace: { addressPrefixes: [space] }, subnets: [{ name: subnetName, properties: { addressPrefix: prefix, delegations } }] } } }]
    };
  }
  const vnetMatch = VNET_ID.exec(subnetFlag ?? vnetFlag ?? "");
  let vnetId = vnetMatch?.[1];
  if (!vnetId && vnetFlag && RESOURCE_NAME.test(vnetFlag))
    vnetId = `/subscriptions/${app.subscriptionId}/resourceGroups/${app.resourceGroup}/providers/Microsoft.Network/virtualNetworks/${vnetFlag}`;
  if (!vnetId || subnetFlag && !vnetMatch?.[3])
    throw new ToolError(EXIT.usage, subnetFlag ? "--subnet must be a full subnet resource ID." : "--vnet must be a VNet resource ID or a VNet name in the app resource group.");
  const vnet = await client.arm("GET", vnetId, NETWORK_API_VERSION);
  const findings = [];
  if (vnet.location && site.location && vnet.location.replace(/\s/g, "").toLowerCase() !== site.location.replace(/\s/g, "").toLowerCase()) {
    findings.push({ severity: "error", code: "VnetRegionMismatch", message: `The VNet is in ${vnet.location}; the app is in ${site.location}.`, fix: "Use a VNet in the same region, or --create-vnet." });
  }
  if (createSubnet) {
    if ((vnet.properties?.subnets ?? []).some((subnet2) => subnet2.name?.toLowerCase() === subnetName.toLowerCase())) {
      throw new ToolError(EXIT.usage, `Subnet ${subnetName} already exists. Pass --subnet ${vnetId}/subnets/${subnetName}, or a different --subnet-name.`);
    }
    const used = (vnet.properties?.subnets ?? []).flatMap(prefixesOf);
    const prefix = findFreePrefix(vnet.properties?.addressSpace?.addressPrefixes ?? [], used, rule.recommendedPrefix);
    if (!prefix)
      findings.push({ severity: "error", code: "NoFreeAddressSpace", message: `No free /${rule.recommendedPrefix} range is left in the VNet.`, fix: "Add address space to the VNet, use another VNet, or --create-vnet." });
    const subnetId2 = `${vnetId}/subnets/${subnetName}`;
    return { subnetId: subnetId2, findings, steps: prefix ? [{ action: "create subnet", method: "PUT", url: withVersion(subnetId2, NETWORK_API_VERSION), body: { properties: { addressPrefix: prefix, delegations } } }] : [] };
  }
  const subnetId = subnetFlag;
  const subnet = await client.arm("GET", subnetId, NETWORK_API_VERSION);
  const lengths = prefixesOf(subnet).map((prefix) => cidr(prefix).length);
  if (lengths.length && Math.min(...lengths) > rule.minPrefix) {
    findings.push({ severity: "error", code: "SubnetTooSmall", message: `The subnet is /${Math.min(...lengths)}; this plan needs /${rule.minPrefix} or larger (/${rule.recommendedPrefix} recommended).`, fix: "Use --vnet <id> --create-subnet to add a correctly sized subnet." });
  }
  const services = (subnet.properties?.delegations ?? []).map((item) => item.properties?.serviceName ?? "");
  if (services.some((service) => service.toLowerCase() !== rule.delegation.toLowerCase())) {
    findings.push({ severity: "error", code: "SubnetDelegatedElsewhere", message: `The subnet is delegated to ${services.join(", ")}; this plan needs ${rule.delegation}.`, fix: "Use an empty subnet or create a new one with --create-subnet." });
  }
  if ((subnet.properties?.ipConfigurations?.length ?? 0) > 0 || (subnet.properties?.privateEndpoints?.length ?? 0) > 0) {
    findings.push({ severity: "error", code: "SubnetInUse", message: "The subnet already has network interfaces or private endpoints.", fix: "Integration needs a dedicated subnet. Use --create-subnet." });
  }
  const steps = [];
  if (services.length === 0) {
    steps.push({ action: "delegate subnet", method: "PUT", url: withVersion(subnetId, NETWORK_API_VERSION), body: { properties: { ...subnet.properties, delegations } } });
  }
  return { subnetId, findings, steps };
}
var networkCommands = [
  {
    name: "vnet integrate",
    usage: "vnet integrate --app <name|id> [--slot <s>] (--subnet <subnet-id> | --vnet <vnet-id|name> --create-subnet [--subnet-name snet-functions] | --create-vnet [--vnet-name <name>] [--address-space <cidr, default: first free private /16>]) [--approve]",
    description: "Connect the app to a VNet subnet for outbound traffic: checks region, size, delegation, and providers, creates what is missing, integrates, and verifies.",
    handler: async (args, context) => {
      const { client } = context;
      const app = await appTarget(client, args);
      const { site, hostingPlan } = await loadSite(client, app);
      const rule = RULES[hostingPlan];
      if (!rule) {
        throw new ToolError(EXIT.precheck, `VNet integration is not available on ${hostingPlan}.`, {
          findings: [{ severity: "error", code: "PlanNotSupported", message: `${hostingPlan} apps cannot use regional VNet integration.`, fix: hostingPlan === "Consumption" ? "Move to Flex Consumption (`docs search migrate flex consumption`)." : "Configure networking on the Container Apps environment." }]
        });
      }
      const choice = await chooseSubnet(args, context, app, site, rule);
      const current = site.properties.virtualNetworkSubnetId;
      if (sameId(current, choice.subnetId) && choice.steps.length === 0) {
        return { summary: `${app.label} is already integrated with this subnet.`, data: { verified: true, subnetId: choice.subnetId } };
      }
      const errors = choice.findings.filter((finding) => finding.severity === "error");
      if (errors.length)
        throw new ToolError(EXIT.precheck, `Pre-check failed: ${errors.map((finding) => finding.code).join(", ")}.`, { findings: choice.findings });
      const steps = [];
      if (rule.needsAppProvider) {
        const provider = await client.arm("GET", `/subscriptions/${app.subscriptionId}/providers/Microsoft.App`, PROVIDER_API_VERSION);
        if (provider.registrationState !== "Registered") {
          steps.push({ action: "register Microsoft.App", method: "POST", url: withVersion(`/subscriptions/${app.subscriptionId}/providers/Microsoft.App/register`, PROVIDER_API_VERSION) });
        }
      }
      steps.push(...choice.steps);
      steps.push({ action: "integrate app", method: "PATCH", url: withVersion(app.id, WEB_API_VERSION), body: { properties: { virtualNetworkSubnetId: choice.subnetId } } });
      requireApproval(args, `vnet integrate ${app.ref}`, {
        risk: current ? "R2" : "R1",
        impact: `${current ? `Move ${app.label} from ${current} to` : `Integrate ${app.label} with`} ${choice.subnetId}. The app restarts; outbound traffic goes through the VNet${hostingPlan === "FlexConsumption" ? " (all traffic on Flex Consumption)" : ""}. Storage and other dependencies must stay reachable from the subnet (NSG, route table, private DNS).`,
        steps,
        rollback: current ? `vnet integrate ${app.ref} --subnet ${current}` : `vnet remove ${app.ref}`
      }, choice.findings);
      const check = `app inspect ${app.ref}`;
      for (const step of steps) {
        if (step.action === "register Microsoft.App") {
          await writeArm(context, step, check);
          const registered = await waitFor(() => tryRead(() => client.arm("GET", `/subscriptions/${app.subscriptionId}/providers/Microsoft.App`, PROVIDER_API_VERSION)), (provider) => provider.registrationState === "Registered", { sleep: context.sleep, waitMs: PROVIDER_WAIT_MS, intervalMs: 1e4 });
          if (!registered.done)
            throw new ToolError(EXIT.failed, "Microsoft.App provider registration is still in progress.", { next: ["Wait a few minutes, then rerun the same command with --approve; completed steps are skipped."] });
        } else {
          await writeArm(context, step, check);
        }
      }
      const after = await client.arm("GET", app.id, WEB_API_VERSION);
      const verified = sameId(after.properties.virtualNetworkSubnetId, choice.subnetId);
      const host = verified ? await waitFor(() => tryRead(() => readHostStatus(client, app)), (status) => status.state === "Running", { sleep: context.sleep, waitMs: HOST_WAIT_MS, intervalMs: 1e4 }) : void 0;
      const findings = [];
      if (!verified)
        findings.push({ severity: "warning", code: "IntegrationNotVerified", message: "virtualNetworkSubnetId does not match yet.", fix: "Run `app inspect` in a minute. Do not resend." });
      if (host && !host.done) {
        findings.push({ severity: "warning", code: "HostNotVerified", message: `The host is ${host.value?.state ?? "unreachable"} after integration${host.value?.errors?.length ? `: ${host.value.errors.join("; ")}` : ""}.`, fix: "Check that storage, Key Vault, and other dependencies are reachable from the subnet (NSG, route table, private DNS), then `logs query --preset errors --since 15m`. Roll back with the rollback command if needed." });
      }
      return {
        summary: verified ? `${app.label} is integrated with ${choice.subnetId}${host?.done ? " and the host is Running" : ""}.` : `${app.label}: the integration request succeeded but the app does not show the subnet yet.`,
        data: { verified, hostState: host?.value?.state, subnetId: choice.subnetId, steps: steps.map((step) => step.action) },
        findings: [...choice.findings.filter((item) => item.severity === "info"), ...findings],
        next: host?.done ? [] : ["Check the app still starts: `host status`, then `logs query --preset errors --since 15m`."]
      };
    }
  },
  {
    name: "vnet remove",
    usage: "vnet remove --app <name|id> [--slot <s>] [--approve]",
    description: "Disconnect the app from its VNet subnet and verify. The VNet and subnet are kept.",
    handler: async (args, context) => {
      const { client } = context;
      const app = await appTarget(client, args);
      const site = await client.arm("GET", app.id, WEB_API_VERSION);
      const current = site.properties.virtualNetworkSubnetId;
      if (!current)
        return { summary: `${app.label} has no VNet integration.`, data: { verified: true } };
      const step = { action: "remove integration", method: "DELETE", url: withVersion(`${app.id}/networkConfig/virtualNetwork`, WEB_API_VERSION) };
      requireApproval(args, `vnet remove ${app.ref}`, {
        risk: "R2",
        impact: `Disconnect ${app.label} from ${current}. The app restarts; private resources reachable only through the VNet become unreachable.`,
        steps: [step],
        rollback: `vnet integrate ${app.ref} --subnet ${current}`
      });
      await writeArm(context, step, `app inspect ${app.ref}`);
      const after = await client.arm("GET", app.id, WEB_API_VERSION);
      const verified = !after.properties.virtualNetworkSubnetId;
      return {
        summary: verified ? `${app.label} is no longer integrated. The subnet was kept.` : `${app.label}: removal was sent but the app still shows a subnet.`,
        data: { verified, subnetKept: current },
        findings: verified ? [] : [{ severity: "warning", code: "RemovalNotVerified", message: "virtualNetworkSubnetId is still set.", fix: "Run `app inspect` in a minute. Do not resend." }],
        next: ["Delete the subnet or VNet only if nothing else uses it, with `rest DELETE <id>` and user approval."]
      };
    }
  }
];

// lib/tools/app/commands/settings.js
var FLEX_UNSUPPORTED_SETTINGS = /* @__PURE__ */ new Set([
  "ENABLE_ORYX_BUILD",
  "FUNCTIONS_EXTENSION_VERSION",
  "FUNCTIONS_WORKER_RUNTIME",
  "FUNCTIONS_WORKER_RUNTIME_VERSION",
  "FUNCTIONS_MAX_HTTP_CONCURRENCY",
  "FUNCTIONS_WORKER_PROCESS_COUNT",
  "FUNCTIONS_WORKER_DYNAMIC_CONCURRENCY_ENABLED",
  "SCM_DO_BUILD_DURING_DEPLOYMENT",
  "WEBSITE_CONTENTAZUREFILECONNECTIONSTRING",
  "WEBSITE_CONTENTOVERVNET",
  "WEBSITE_CONTENTSHARE",
  "WEBSITE_DNS_SERVER",
  "WEBSITE_MAX_DYNAMIC_APPLICATION_SCALE_OUT",
  "WEBSITE_NODE_DEFAULT_VERSION",
  "WEBSITE_RUN_FROM_PACKAGE",
  "WEBSITE_SKIP_CONTENTSHARE_VALIDATION",
  "WEBSITE_VNET_ROUTE_ALL"
]);
var CONNECTION_STRING_TYPES = ["Custom", "SQLAzure", "SQLServer", "MySql", "PostgreSQL", "RedisCache", "DocDb", "ServiceBus", "EventHub", "NotificationHub", "ApiHub"];
var SETTING_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,255}$/;
var KV_WAIT_MS = 6e4;
var KV_POLL_MS = 1e4;
function valueOf(entry) {
  return typeof entry === "string" ? entry : entry?.value;
}
function sameEntry(a, b) {
  if (a === void 0 || b === void 0)
    return a === b;
  if (typeof a === "string" || typeof b === "string")
    return a === b;
  return a.value === b.value && a.type.toLowerCase() === b.type.toLowerCase();
}
function shown(kind, name, entry) {
  const value = valueOf(entry) ?? "";
  if (kind === "connectionstrings" && !isKeyVaultReference(value))
    return "<redacted>";
  return redactValue(name, value).value;
}
function listCollection(client, app, kind) {
  return client.arm("POST", `${app.id}/config/${kind}/list`, WEB_API_VERSION, { idempotent: true });
}
async function hostingPlanOf(client, app) {
  const site = await client.arm("GET", app.id, WEB_API_VERSION);
  const plan = !site.properties.functionAppConfig && site.properties.serverFarmId ? await tryRead(() => client.arm("GET", site.properties.serverFarmId, WEB_API_VERSION)) : void 0;
  return detectPlan(site, plan);
}
function stripFinalNewline(text) {
  return text.replace(/\r?\n$/, "");
}
async function requestedValues(args, context) {
  const values = /* @__PURE__ */ new Map();
  const name = stringFlag(args, "name");
  const inline = stringFlag(args, "value");
  const file = stringFlag(args, "value-file");
  if (inline !== void 0 && file !== void 0)
    throw new ToolError(EXIT.usage, "Use either --value or --value-file, not both.");
  if (name !== void 0) {
    if (inline === void 0 && file === void 0)
      throw new ToolError(EXIT.usage, `Pass --value <v> or --value-file <file|-> for ${name}.`);
    values.set(name, file !== void 0 ? stripFinalNewline(await context.readInput(file)) : inline);
  } else if (inline !== void 0 || file !== void 0) {
    throw new ToolError(EXIT.usage, "--value and --value-file need --name.");
  }
  for (const pair of listFlag(args, "set")) {
    const eq = pair.indexOf("=");
    if (eq < 1)
      throw new ToolError(EXIT.usage, `--set expects NAME=VALUE, got "${pair}".`);
    values.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  if (values.size === 0)
    throw new ToolError(EXIT.usage, "Nothing to set. Pass --name <n> --value <v>, --name <n> --value-file <file|->, or --set NAME=VALUE (repeatable).");
  return values;
}
function validateNames(names) {
  for (const name of names) {
    if (!SETTING_NAME.test(name))
      throw new ToolError(EXIT.usage, `Invalid setting name "${name}". Use letters, digits, and _ . : -.`);
  }
}
function connectionStringType(args) {
  const raw = stringFlag(args, "type") ?? "Custom";
  const type = CONNECTION_STRING_TYPES.find((item) => item.toLowerCase() === raw.toLowerCase());
  if (!type)
    throw new ToolError(EXIT.usage, `Unknown --type "${raw}". Use one of: ${CONNECTION_STRING_TYPES.join(", ")}.`);
  return type;
}
function kindOf(args) {
  return boolFlag(args, "connection-string") ? "connectionstrings" : "appsettings";
}
function collectionLabel(kind) {
  return kind === "appsettings" ? "app settings" : "connection strings";
}
async function applyEdits(args, context, app, kind, edit, command, extraSteps = []) {
  const { client } = context;
  const current = (await listCollection(client, app, kind)).properties ?? {};
  const edits = edit(current);
  const merged = { ...current };
  const changes = [];
  for (const [name, next] of edits) {
    const existingName = Object.keys(current).find((key) => key.toLowerCase() === name.toLowerCase());
    const before = existingName === void 0 ? void 0 : current[existingName];
    if (next === void 0) {
      if (existingName === void 0) {
        changes.push({ name, action: "unchanged" });
        continue;
      }
      delete merged[existingName];
      changes.push({ name: existingName, action: "remove" });
      continue;
    }
    if (existingName !== void 0)
      delete merged[existingName];
    merged[existingName ?? name] = next;
    if (before === void 0)
      changes.push({ name, action: "add", value: shown(kind, name, next) });
    else if (sameEntry(before, next))
      changes.push({ name: existingName, action: "unchanged", value: shown(kind, name, next) });
    else
      changes.push({ name: existingName, action: "update", value: shown(kind, name, next), previous: shown(kind, name, before) });
  }
  const effective = changes.filter((change) => change.action !== "unchanged");
  if (effective.length === 0)
    return { changes, verified: true, findings: [] };
  const destructive = effective.some((change) => change.action !== "add");
  const step = { action: `replace ${collectionLabel(kind)} (full merged collection, ${Object.keys(merged).length} entries)`, method: "PUT", url: `${app.id}/config/${kind}?api-version=${WEB_API_VERSION}` };
  requireApproval(args, command, {
    risk: destructive ? "R2" : "R1",
    impact: `${effective.map((change) => `${change.action} ${change.name}`).join(", ")} on ${app.label}. Every other entry is kept. The app restarts.`,
    steps: [step, ...extraSteps],
    rollback: destructive ? "Set the previous values again; the tool cannot restore secret values it never printed, so keep them before you approve." : `settings delete ${app.ref} ${effective.map((change) => `--name ${change.name}`).join(" ")}${kind === "connectionstrings" ? " --connection-string" : ""}`,
    changes
  });
  try {
    await client.arm("PUT", `${app.id}/config/${kind}`, WEB_API_VERSION, { body: { properties: merged } });
  } catch (error) {
    if (isOutcomeUnknown(error))
      throw outcomeUnknown(error, `Update of ${collectionLabel(kind)}`, `settings list ${app.ref}`);
    throw error;
  }
  const after = (await listCollection(client, app, kind)).properties ?? {};
  const findings = [];
  const verified = effective.every((change) => change.action === "remove" ? !(change.name in after) : sameEntry(after[change.name], merged[change.name]));
  if (!verified)
    findings.push({ severity: "warning", code: "SettingsNotVerified", message: "The read-back does not match the requested change yet.", fix: `Run \`settings list ${app.ref}\` in a minute. Do not resend.` });
  if (kind !== "appsettings")
    return { changes, verified, findings };
  const keyVault = await checkKeyVaultReferences(context, app, effective, merged);
  findings.push(...keyVault.findings);
  return { changes, verified, findings, keyVaultReferences: keyVault.statuses.length ? keyVault.statuses : void 0 };
}
async function checkKeyVaultReferences(context, app, changes, merged) {
  const names = changes.filter((change) => change.action !== "remove" && isKeyVaultReference(valueOf(merged[change.name]) ?? "")).map((change) => change.name);
  const findings = [];
  const statuses = [];
  for (const name of names) {
    const read = () => tryRead(() => context.client.arm("GET", `${app.id}/config/configreferences/appsettings/${encodeURIComponent(name)}`, WEB_API_VERSION));
    let status = await read();
    if (status?.properties?.status !== "Resolved" && !isFinalFailure(status?.properties?.status)) {
      status = (await waitFor(read, (value) => value.properties?.status === "Resolved" || isFinalFailure(value.properties?.status), { sleep: context.sleep, waitMs: KV_WAIT_MS, intervalMs: KV_POLL_MS })).value ?? status;
    }
    const state = status?.properties?.status;
    statuses.push({ name, status: state ?? "Unknown" });
    if (state !== "Resolved") {
      findings.push({ severity: "error", code: "KeyVaultReferenceUnresolved", message: `${name}: ${state ?? "status unavailable"}. ${status?.properties?.details ?? ""}`.trim(), fix: 'Grant the app identity "Key Vault Secrets User" on the vault (separate approval), check the secret URI and vault network access, then run `settings list`.' });
    }
  }
  return { findings, statuses };
}
function readSlotConfigNames(client, app) {
  return tryRead(() => client.arm("GET", `${app.siteId}/config/slotConfigNames`, WEB_API_VERSION));
}
function stickyField(kind) {
  return kind === "appsettings" ? "appSettingNames" : "connectionStringNames";
}
async function planSticky(client, app, kind, names) {
  const current = (await readSlotConfigNames(client, app))?.properties ?? {};
  const lists = { appSettingNames: [...current.appSettingNames ?? []], connectionStringNames: [...current.connectionStringNames ?? []] };
  const field = stickyField(kind);
  const added = names.filter((name) => !lists[field].some((existing) => existing.toLowerCase() === name.toLowerCase()));
  if (added.length === 0)
    return void 0;
  lists[field].push(...added);
  return { step: { action: `mark ${added.join(", ")} as slot settings (sticky)`, method: "PUT", url: `${app.siteId}/config/slotConfigNames?api-version=${WEB_API_VERSION}`, body: { properties: lists } }, added };
}
async function applySticky(context, app, kind, plan) {
  try {
    await context.client.arm("PUT", `${app.siteId}/config/slotConfigNames`, WEB_API_VERSION, { body: plan.step.body });
  } catch (error) {
    if (isOutcomeUnknown(error))
      throw outcomeUnknown(error, "Update of slot setting names", `slots list --app ${app.name}`);
    throw error;
  }
  const after = (await readSlotConfigNames(context.client, app))?.properties?.[stickyField(kind)] ?? [];
  const verified = plan.added.every((name) => after.some((existing) => existing.toLowerCase() === name.toLowerCase()));
  return { verified, findings: verified ? [] : [{ severity: "warning", code: "StickyNotVerified", message: "slotConfigNames does not show the new sticky names yet.", fix: `Run \`slots list --app ${app.name}\` in a minute. Do not resend.` }] };
}
function isFinalFailure(status) {
  return Boolean(status && status !== "Resolved" && status !== "Initialized");
}
function flexFindings(plan, kind, names) {
  if (plan !== "FlexConsumption" || kind !== "appsettings")
    return [];
  return [...names].filter((name) => FLEX_UNSUPPORTED_SETTINGS.has(name.toUpperCase())).map((name) => ({ severity: "error", code: "FlexUnsupportedSetting", message: `${name} is not used on Flex Consumption.`, fix: "Use properties.functionAppConfig instead (`docs search flex consumption deprecations`)." }));
}
function keyVaultSummary(statuses) {
  if (!statuses?.length)
    return "";
  const unresolved = statuses.filter((item) => item.status !== "Resolved");
  return unresolved.length === 0 ? ` Key Vault reference resolved: ${statuses.map((item) => item.name).join(", ")}.` : ` Key Vault reference not resolved: ${unresolved.map((item) => `${item.name} (${item.status})`).join(", ")}.`;
}
function result(app, kind, applied) {
  const effective = applied.changes.filter((change) => change.action !== "unchanged");
  const summary = effective.length === 0 ? `${app.label}: nothing to change; the ${collectionLabel(kind)} already match.` : `${app.label}: ${effective.map((change) => `${change.action} ${change.name}`).join(", ")}${applied.verified ? " (verified)" : " (not verified yet)"}.${keyVaultSummary(applied.keyVaultReferences)}`;
  return {
    summary,
    data: { verified: applied.verified, changes: applied.changes, ...applied.keyVaultReferences ? { keyVaultReferences: applied.keyVaultReferences } : {} },
    findings: applied.findings,
    next: effective.length ? ["The app restarts after a settings change. If the host matters, run `host status` once."] : []
  };
}
var settingsCommands = [
  {
    name: "settings set",
    usage: "settings set --app <name|id> [--slot <s>] (--name <n> (--value <v> | --value-file <file|->) | --set NAME=VALUE ...) [--connection-string [--type Custom]] [--sticky] [--approve]",
    description: "Add or update app settings (or connection strings): merges into the full collection, keeps every other value, verifies, and checks Key Vault references. Values are never printed.",
    details: [
      'Use --value-file - (stdin) for secrets so the value is not in the command line; one trailing newline is removed. Prefer a Key Vault reference: --value "@Microsoft.KeyVault(SecretUri=https://<vault>.vault.azure.net/secrets/<name>)".',
      "--sticky also marks the names as slot settings (config/slotConfigNames on the site), so they stay with their slot during a swap.",
      "Adding a setting is R1; replacing an existing value is R2. Every change restarts the app.",
      "On Flex Consumption, settings that the plan does not use (for example WEBSITE_RUN_FROM_PACKAGE, FUNCTIONS_WORKER_RUNTIME) are rejected with exit 6.",
      "To disable one function: --set AzureWebJobs.<FunctionName>.Disabled=true."
    ],
    handler: async (args, context) => {
      const app = await appTarget(context.client, args);
      const kind = kindOf(args);
      if (kind === "appsettings" && stringFlag(args, "type") !== void 0)
        throw new ToolError(EXIT.usage, "--type applies only with --connection-string.");
      const type = kind === "connectionstrings" ? connectionStringType(args) : void 0;
      const values = await requestedValues(args, context);
      validateNames(values.keys());
      const blocked = flexFindings(await hostingPlanOf(context.client, app), kind, values.keys());
      if (blocked.length)
        throw new ToolError(EXIT.precheck, `Pre-check failed: ${blocked.map((finding) => finding.message).join(" ")}`, { findings: blocked });
      const command = `settings set ${app.ref}`;
      const sticky = boolFlag(args, "sticky") ? await planSticky(context.client, app, kind, [...values.keys()]) : void 0;
      const applied = await applyEdits(args, context, app, kind, () => new Map([...values].map(([name, value]) => [name, type ? { value, type } : value])), command, sticky ? [sticky.step] : []);
      if (!sticky)
        return result(app, kind, applied);
      if (!applied.changes.some((change) => change.action !== "unchanged")) {
        requireApproval(args, command, { risk: "R1", impact: `Mark ${sticky.added.join(", ")} on ${app.name} as slot settings: they stay with their slot during a swap.`, steps: [sticky.step], rollback: "Remove the names from config/slotConfigNames with `rest put`." });
      }
      const stuck = await applySticky(context, app, kind, sticky);
      const output = result(app, kind, { ...applied, verified: applied.verified && stuck.verified, findings: [...applied.findings, ...stuck.findings] });
      return { ...output, summary: `${output.summary} Sticky: ${sticky.added.join(", ")}.`, data: { ...output.data, sticky: sticky.added } };
    }
  },
  {
    name: "settings delete",
    usage: "settings delete --app <name|id> [--slot <s>] --name <n> [--name <n2> ...] [--connection-string] [--approve]",
    description: "Remove app settings (or connection strings) by name; keeps every other value and verifies (R2).",
    handler: async (args, context) => {
      const app = await appTarget(context.client, args);
      const kind = kindOf(args);
      const names = listFlag(args, "name");
      if (names.length === 0)
        throw new ToolError(EXIT.usage, "Pass --name <setting> (repeatable).");
      validateNames(names);
      const applied = await applyEdits(args, context, app, kind, () => new Map(names.map((name) => [name, void 0])), `settings delete ${app.ref}`);
      return result(app, kind, applied);
    }
  }
];

// lib/tools/app/commands/read.js
var ACTIVITY_LOG_API_VERSION = "2015-04-01";
function listSettings(client, app) {
  return client.arm("POST", `${app.id}/config/appsettings/list`, WEB_API_VERSION, { idempotent: true });
}
var DEPLOYMENT_STATUS = { 0: "Pending", 1: "Building", 2: "Deploying", 3: "Failed", 4: "Success" };
var LOG_PRESETS = {
  errors: "union traces, exceptions | where cloud_RoleName =~ '{app}' and severityLevel >= 3 | project timestamp, itemType, operation_Name, message = coalesce(message, outerMessage), problemId, operation_Id | order by timestamp desc",
  exceptions: "exceptions | where cloud_RoleName =~ '{app}' | project timestamp, operation_Name, type, outerMessage, problemId, operation_Id | order by timestamp desc",
  failures: "requests | where cloud_RoleName =~ '{app}' and success == false | project timestamp, operation_Name, resultCode, duration, operation_Id | order by timestamp desc",
  requests: "requests | where cloud_RoleName =~ '{app}' | summarize count = count(), failures = countif(success == false), p95ms = percentile(duration, 95) by operation_Name | order by count desc",
  traces: "traces | where cloud_RoleName =~ '{app}' | project timestamp, severityLevel, operation_Name, message | order by timestamp desc",
  instances: "union requests, traces | where cloud_RoleName =~ '{app}' | summarize instances = dcount(cloud_RoleInstance) by bin(timestamp, 5m) | order by timestamp desc"
};
var AI_COMPONENT_ID = /^\/subscriptions\/[0-9a-f-]{36}\/resourceGroups\/[-\w.()]+\/providers\/Microsoft\.Insights\/components\/[-\w.()]+$/i;
var GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function instrumentationKeyOf(settings) {
  const fromConnection = /InstrumentationKey=([^;]+)/i.exec(settings.APPLICATIONINSIGHTS_CONNECTION_STRING ?? "")?.[1];
  const key = (fromConnection ?? settings.APPINSIGHTS_INSTRUMENTATIONKEY ?? "").trim();
  return GUID.test(key) ? key : void 0;
}
async function findAppInsights(client, app, explicit) {
  if (explicit) {
    if (!AI_COMPONENT_ID.test(explicit))
      throw new ToolError(EXIT.usage, "--app-insights must be a Microsoft.Insights/components resource ID.");
    return explicit;
  }
  const key = instrumentationKeyOf((await listSettings(client, app)).properties);
  if (!key) {
    throw new ToolError(EXIT.precheck, "The app has no Application Insights connection string, so there are no logs to query.", {
      findings: [{ severity: "error", code: "NoAppInsights", message: "APPLICATIONINSIGHTS_CONNECTION_STRING is not set.", fix: "Connect Application Insights (R1), or pass --app-insights <component-id>." }]
    });
  }
  const rows = await queryGraph(client, `resources | where type =~ 'microsoft.insights/components' and properties.InstrumentationKey =~ '${key}' | project id, name, resourceGroup, subscriptionId`);
  if (rows.length !== 1) {
    throw new ToolError(EXIT.precheck, "Could not find the Application Insights resource for this app in the subscriptions you can access.", {
      next: ["Pass --app-insights <component-resource-id>."]
    });
  }
  return rows[0].id;
}
function cell(value) {
  if (typeof value !== "string")
    return value;
  const scrubbed = scrubText(value);
  return scrubbed.length > 1500 ? `${scrubbed.slice(0, 1500)}...` : scrubbed;
}
function isNoise(operation) {
  if (!operation)
    return false;
  return /^Microsoft\.Authorization\/policies\//i.test(operation) || /\/list[^/]*\/action$/i.test(operation);
}
var readCommands = [
  {
    name: "app find",
    usage: "app find [--name <part>] [--resource-group <rg>] [--subscription <id>]",
    description: "List Function Apps you can access.",
    handler: async (args, { client }) => {
      const name = stringFlag(args, "name");
      const resourceGroup = stringFlag(args, "resource-group");
      const subscription = stringFlag(args, "subscription");
      if (name !== void 0 && !/^[A-Za-z0-9-]{1,60}$/.test(name))
        throw new ToolError(EXIT.usage, "--name may contain only letters, digits, and hyphens.");
      validateScope({ resourceGroup, subscription });
      const filters = [`type =~ 'microsoft.web/sites'`, `kind contains 'functionapp'`];
      if (name)
        filters.push(`name contains '${name}'`);
      if (resourceGroup)
        filters.push(`resourceGroup =~ '${resourceGroup}'`);
      const rows = await queryGraph(client, `resources | where ${filters.join(" and ")} | project id, name, resourceGroup, subscriptionId, location, kind, state = tostring(properties.state), sku = tostring(properties.sku) | order by name asc`, subscription);
      return {
        summary: `${rows.length} Function App(s) found.`,
        data: rows.map((row) => ({ ...row, portal: `https://portal.azure.com/#@/resource${row.id}` })),
        next: rows.length ? ["Run `app inspect --app <name>` for details."] : ["Check the signed-in account with `az account show`, or pass --subscription."]
      };
    }
  },
  {
    name: "app inspect",
    usage: "app inspect --app <name|id> [--slot <s>]",
    description: "Summarize plan, runtime, scale, identity, security, and network, with findings.",
    handler: async (args, { client }) => {
      const app = await appTarget(client, args);
      const [site, config, settings] = await Promise.all([
        client.arm("GET", app.id, WEB_API_VERSION),
        client.arm("GET", `${app.id}/config/web`, WEB_API_VERSION),
        listSettings(client, app)
      ]);
      const plan = site.properties.serverFarmId ? await client.arm("GET", site.properties.serverFarmId, WEB_API_VERSION) : void 0;
      const { data, findings } = summarizeApp(site, config, plan, settings.properties);
      return {
        summary: `${site.name}: ${String(data.hostingPlan)}, ${site.properties.state ?? "unknown state"}, ${findings.length} finding(s).`,
        data,
        findings,
        next: ["`functions list`, `settings list`, `deployments list`, `logs query`, and `changes` take the same --app."]
      };
    }
  },
  {
    name: "functions list",
    usage: "functions list --app <name|id> [--slot <s>]",
    description: "List functions with trigger type, route, and enabled state (no keys).",
    handler: async (args, { client }) => {
      const app = await appTarget(client, args);
      const result3 = await client.arm("GET", `${app.id}/functions`, WEB_API_VERSION);
      const functions = result3.value.map((fn) => {
        const trigger = fn.properties.config?.bindings?.find((binding) => binding.type?.toLowerCase().endsWith("trigger"));
        return {
          name: fn.name.split("/").pop(),
          trigger: trigger?.type,
          route: trigger?.route,
          methods: trigger?.methods,
          authLevel: trigger?.authLevel,
          schedule: trigger?.schedule,
          source: trigger?.queueName ?? trigger?.topicName ?? trigger?.eventHubName,
          isDisabled: fn.properties.isDisabled ?? false,
          invokeUrlTemplate: fn.properties.invoke_url_template ?? void 0
        };
      });
      const findings = functions.length ? [] : [{ severity: "warning", code: "NoFunctions", message: "The host reports no functions.", fix: "Check the latest deployment (`deployments list`) and startup errors (`logs query --preset errors`)." }];
      return { summary: `${functions.length} function(s) in ${app.label}.`, data: functions, findings };
    }
  },
  {
    name: "settings list",
    usage: "settings list --app <name|id> [--slot <s>]",
    description: "List app settings and connection strings with secrets redacted and Key Vault reference status.",
    handler: async (args, { client }) => {
      const app = await appTarget(client, args);
      const [settings, connectionStrings, sticky] = await Promise.all([
        listSettings(client, app),
        client.arm("POST", `${app.id}/config/connectionstrings/list`, WEB_API_VERSION, { idempotent: true }),
        readSlotConfigNames(client, app)
      ]);
      const isSticky = (names, name) => (names ?? []).some((item) => item.toLowerCase() === name.toLowerCase()) || void 0;
      const views = redactSettings(settings.properties).map((view) => ({ ...view, sticky: isSticky(sticky?.properties?.appSettingNames, view.name) }));
      const findings = [];
      let keyVaultReferences;
      if (views.some((view) => view.source === "keyVaultReference")) {
        const refs = await client.arm("GET", `${app.id}/config/configreferences/appsettings`, WEB_API_VERSION);
        keyVaultReferences = refs.value.map((ref) => ({ name: ref.name.split("/").pop() ?? ref.name, status: ref.properties.status, details: ref.properties.details }));
        for (const ref of keyVaultReferences.filter((item) => item.status && item.status !== "Resolved")) {
          findings.push({ severity: "error", code: "KeyVaultReferenceUnresolved", message: `${ref.name}: ${ref.status}. ${ref.details ?? ""}`.trim(), fix: 'Grant the app identity "Key Vault Secrets User" on the vault and check the secret URI.' });
        }
      }
      return {
        summary: `${views.length} app setting(s), ${Object.keys(connectionStrings.properties).length} connection string(s). Secret values are redacted.`,
        data: {
          appSettings: views,
          connectionStrings: Object.entries(connectionStrings.properties).map(([name, value]) => ({ name, type: value.type, value: "<redacted>", sticky: isSticky(sticky?.properties?.connectionStringNames, name) })),
          keyVaultReferences
        },
        findings
      };
    }
  },
  {
    name: "deployments list",
    usage: "deployments list --app <name|id> [--slot <s>] [--top 10]",
    description: "List recent code deployments from the SCM (Kudu) endpoint.",
    handler: async (args, { client }) => {
      const app = await appTarget(client, args);
      const site = await client.arm("GET", app.id, WEB_API_VERSION);
      const host = scmHost(site);
      if (!host)
        throw new ToolError(EXIT.unsupported, "This app has no SCM endpoint, so deployment history is not available here.", { next: ["Fall back to `docs get inspection/deployments`."] });
      const deployments = await client.request("GET", `https://${host}/api/deployments`, SCM_RESOURCE);
      const top = intFlag(args, "top", 10, 50);
      const rows = deployments.sort((a, b) => (b.start_time ?? "").localeCompare(a.start_time ?? "")).slice(0, top).map((d) => ({ id: d.id, status: DEPLOYMENT_STATUS[d.status] ?? String(d.status), active: d.active, deployer: d.deployer, message: d.message || void 0, start: d.start_time, end: d.end_time ?? void 0 }));
      const findings = rows[0]?.status === "Failed" ? [{ severity: "error", code: "LatestDeploymentFailed", message: `The latest deployment ${rows[0].id} failed.`, fix: `Read its log: GET https://${host}/api/deployments/${rows[0].id}/log` }] : [];
      return { summary: `${rows.length} deployment(s) for ${app.label}.`, data: rows, findings };
    }
  },
  {
    name: "logs query",
    usage: `logs query --app <name|id> [--slot <s>] [--preset ${Object.keys(LOG_PRESETS).join("|")}] [--kql <query> | --kql-file <file|->] [--since 1h] [--top 50] [--app-insights <id>]`,
    description: "Query Application Insights logs for the app (default preset: errors).",
    handler: async (args, { client, readInput: readInput2 }) => {
      const app = await appTarget(client, args);
      const kqlFile = stringFlag(args, "kql-file");
      if (kqlFile && stringFlag(args, "kql"))
        throw new ToolError(EXIT.usage, "Use either --kql or --kql-file, not both.");
      const kql = kqlFile ? (await readInput2(kqlFile)).trim() : stringFlag(args, "kql");
      const presetName = stringFlag(args, "preset") ?? (kql ? void 0 : "errors");
      if (kql && presetName)
        throw new ToolError(EXIT.usage, "Use either --preset or a custom query, not both.");
      const preset = presetName ? LOG_PRESETS[presetName] : void 0;
      if (presetName && !preset)
        throw new ToolError(EXIT.usage, `Unknown --preset "${presetName}". Use one of: ${Object.keys(LOG_PRESETS).join(", ")}.`);
      const since = durationFlag(args, "since", "1h");
      const top = intFlag(args, "top", 50, 500);
      const componentId = await findAppInsights(client, app, stringFlag(args, "app-insights"));
      const query2 = kql ?? (preset ?? "").replaceAll("{app}", app.name);
      const runQuery = (text) => client.request("POST", `${LOGS_ENDPOINT}/v1${componentId}/query`, LOGS_RESOURCE, { body: { query: text, timespan: since.iso }, idempotent: true });
      let result3;
      try {
        result3 = await runQuery(query2);
      } catch (error) {
        if (error instanceof AzureError && error.httpStatus === 400) {
          throw new AzureError(error.httpStatus, error.azureCode, error.message, [
            ...error.options.findings ?? [],
            { severity: "error", code: "KqlRejected", message: "Application Insights rejected the query.", fix: "Quote column names that are KQL keywords as ['count'] or ['name'], use classic table names (requests, traces, exceptions, dependencies), and check the syntax with a smaller query." }
          ]);
        }
        throw error;
      }
      const table = result3.tables[0] ?? { columns: [], rows: [] };
      const rows = table.rows.slice(0, top).map((row) => Object.fromEntries(table.columns.map((column, i) => [column.name, cell(row[i])])));
      const findings = [];
      if (table.rows.length === 0) {
        findings.push({ severity: "info", code: "NoRows", message: "No rows. Telemetry usually arrives 1-5 minutes after the event.", fix: "Widen --since or retry shortly." });
        if (preset) {
          const roles = await tryRead(() => runQuery("union requests, traces, exceptions | summarize count() by cloud_RoleName | top 5 by count_"));
          const names = (roles?.tables[0]?.rows ?? []).map((row) => String(row[0])).filter((name) => name && name.toLowerCase() !== app.name.toLowerCase());
          if (names.length) {
            findings.push({ severity: "warning", code: "NoRowsForRoleName", message: `Presets filter on cloud_RoleName == '${app.name}', but this Application Insights resource has telemetry for: ${names.join(", ")}.`, fix: "If one of these is this app (for example a slot or a custom role name), rerun with --kql and that cloud_RoleName." });
          }
        }
      }
      return {
        summary: `${table.rows.length} row(s) from ${presetName ? `preset ${presetName}` : "custom KQL"} over ${since.iso}${table.rows.length > top ? `, showing ${top}` : ""}.`,
        data: { appInsights: componentId, query: query2, rows },
        findings
      };
    }
  },
  {
    name: "changes",
    usage: "changes --app <name|id> [--slot <s>] [--since 24h] [--top 30] [--all]",
    description: "List control-plane changes to the app from the Activity Log (--all includes policy evaluations and list/read actions).",
    handler: async (args, { client, now }) => {
      const app = await appTarget(client, args);
      const since = durationFlag(args, "since", "24h");
      const top = intFlag(args, "top", 30, 200);
      const from = new Date(now().getTime() - since.ms).toISOString();
      const filter = encodeURIComponent(`eventTimestamp ge '${from}' and resourceUri eq '${app.id}'`);
      const select = encodeURIComponent("eventTimestamp,operationName,status,caller,correlationId,level");
      const result3 = await client.arm("GET", `/subscriptions/${app.subscriptionId}/providers/Microsoft.Insights/eventtypes/management/values?$filter=${filter}&$select=${select}`, ACTIVITY_LOG_API_VERSION);
      const latest = /* @__PURE__ */ new Map();
      const includeAll = boolFlag(args, "all");
      for (const event of result3.value) {
        if (!includeAll && isNoise(event.operationName?.value))
          continue;
        const key = `${event.correlationId ?? event.eventTimestamp}|${event.operationName?.value ?? ""}`;
        const seen = latest.get(key);
        if (!seen || seen.eventTimestamp < event.eventTimestamp)
          latest.set(key, event);
      }
      const rows = [...latest.values()].sort((a, b) => b.eventTimestamp.localeCompare(a.eventTimestamp)).slice(0, top).map((event) => ({ time: event.eventTimestamp, operation: event.operationName?.localizedValue ?? event.operationName?.value, status: event.status?.value, caller: event.caller, level: event.level }));
      const failures = rows.filter((row) => row.status === "Failed");
      return {
        summary: `${rows.length} change(s) to ${app.label} since ${from}${failures.length ? `, ${failures.length} failed` : ""}.`,
        data: rows,
        findings: failures.map((row) => ({ severity: "warning", code: "ChangeFailed", message: `${row.operation} failed at ${row.time} (caller ${row.caller ?? "unknown"}).` }))
      };
    }
  }
];

// lib/tools/app/commands/rest.js
import { existsSync as existsSync4 } from "node:fs";
import { join as join4 } from "node:path";
var METHODS = /* @__PURE__ */ new Set(["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"]);
var MAX_OUTPUT_CHARS = 8e4;
function resolveTarget(raw) {
  const absolute = raw.startsWith("/") ? `${ARM_ENDPOINT}${raw}` : raw;
  let parsed;
  try {
    parsed = new URL(absolute);
  } catch {
    throw new ToolError(EXIT.usage, `"${raw}" is not an ARM path (starting with /subscriptions or /providers) or an https URL.`);
  }
  if (parsed.protocol !== "https:")
    throw new ToolError(EXIT.usage, "Only https URLs are allowed.");
  const host = parsed.host.toLowerCase();
  const kind = host === "management.azure.com" ? "arm" : host === "api.loganalytics.io" ? "logs" : /\.scm\.([a-z0-9-]+\.)?azurewebsites\.net$/.test(host) ? "scm" : void 0;
  if (!kind) {
    throw new ToolError(EXIT.usage, `Host ${host} is not allowed. Use management.azure.com (ARM), <app>.scm.azurewebsites.net (Kudu), or api.loganalytics.io.`);
  }
  const resource = kind === "arm" ? ARM_RESOURCE : kind === "logs" ? LOGS_RESOURCE : SCM_RESOURCE;
  return { url: absolute, path: parsed.pathname, resource, kind };
}
function templateRegex(template) {
  const pattern = template.split(/(\{[^}]+\})/).map((part) => {
    if (part === "{resourceUri}" || part === "{scope}")
      return ".+";
    if (/^\{[^}]+\}$/.test(part))
      return "[^/]+";
    return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("");
  return new RegExp(`^${pattern}$`, "i");
}
function lookupApiVersion(operations, method, path) {
  const matches = operations.filter((operation) => !operation.host && templateRegex(operation.path).test(path)).sort((a, b) => Number(b.method === method) - Number(a.method === method) || literalLength(b.path) - literalLength(a.path));
  return matches[0]?.apiVersion;
}
function literalLength(template) {
  return template.replace(/\{[^}]+\}/g, "").length;
}
function isReadRequest(method, path) {
  if (method === "GET" || method === "HEAD")
    return true;
  if (method !== "POST")
    return false;
  return /\/list[a-z]*$/i.test(path) || /\/query$/i.test(path) || /\/Microsoft\.ResourceGraph\/resources$/i.test(path);
}
var COLLECTION_PUT = /\/config\/(appsettings|connectionstrings|authsettingsv2|web|azurestorageaccounts|metadata)$/i;
function planFindings(method, path) {
  const findings = [];
  if (method === "PUT" && COLLECTION_PUT.test(path)) {
    findings.push({
      severity: "warning",
      code: "ReplacesCollection",
      message: "PUT replaces the whole collection; anything not in the body is deleted.",
      fix: "Read the current values first (for app settings: `rest POST <app>/config/appsettings/list`), merge, then send the full set. Prefer `settings set` when available."
    });
  }
  if (method === "DELETE")
    findings.push({ severity: "warning", code: "Delete", message: "DELETE is R2: state what stops working and how to roll back before asking for approval." });
  return findings;
}
async function readBody(args, context) {
  const source2 = stringFlag(args, "body-file");
  if (source2 === void 0)
    return void 0;
  const text = await context.readInput(source2);
  try {
    return JSON.parse(text);
  } catch {
    throw new ToolError(EXIT.usage, `--body-file ${source2} is not valid JSON.`);
  }
}
function buildUrl2(target, args, method, context) {
  const params = [];
  for (const pair of listFlag(args, "query")) {
    const eq = pair.indexOf("=");
    if (eq <= 0)
      throw new ToolError(EXIT.usage, `--query must look like name=value, got "${pair}".`);
    params.push(`${encodeURIComponent(pair.slice(0, eq))}=${encodeURIComponent(pair.slice(eq + 1))}`);
  }
  const hasVersion = /[?&]api-version=/i.test(target.url);
  if (target.kind === "arm" && !hasVersion) {
    const explicit = stringFlag(args, "api-version");
    const indexPath = join4(context.referencesDir, "api-index.json");
    const version = explicit ?? (existsSync4(indexPath) ? lookupApiVersion(loadApiIndex(indexPath).operations, method, target.path) : void 0);
    if (!version) {
      throw new ToolError(EXIT.usage, `No pinned api-version for ${target.path}. Pass --api-version.`, {
        next: ["Find the operation and its version with `api find <words>`."]
      });
    }
    params.unshift(`api-version=${encodeURIComponent(version)}`);
  }
  if (params.length === 0)
    return target.url;
  return `${target.url}${target.url.includes("?") ? "&" : "?"}${params.join("&")}`;
}
function fitOutput(body) {
  const size = JSON.stringify(body ?? null).length;
  if (size <= MAX_OUTPUT_CHARS)
    return { body, findings: [] };
  if (body && typeof body === "object" && Array.isArray(body.value)) {
    const items = body.value;
    const kept = [];
    let used = 0;
    for (const item of items) {
      used += JSON.stringify(item).length;
      if (used > MAX_OUTPUT_CHARS)
        break;
      kept.push(item);
    }
    return {
      body: { ...body, value: kept },
      findings: [{ severity: "info", code: "Truncated", message: `Showing ${kept.length} of ${items.length} items.`, fix: "Narrow the request with --query $filter=... / $top=..., or a more specific path." }]
    };
  }
  return {
    body: `${JSON.stringify(body).slice(0, MAX_OUTPUT_CHARS)}...`,
    findings: [{ severity: "info", code: "Truncated", message: `The response is ${size} characters; output was cut.`, fix: "Request a narrower path or fewer properties." }]
  };
}
var restCommands = [
  {
    name: "rest",
    usage: "rest <GET|POST|PUT|PATCH|DELETE> <arm-path|https-url> [--api-version <v>] [--query name=value]... [--body-file <file|->] [--approve] [--wait 120]",
    description: "Call any Azure REST operation (fallback for tasks without a command). Fills api-version from the index, gates writes on --approve, polls long-running operations, never resends uncertain writes, and redacts secrets.",
    handler: async (args, context) => {
      const [rawMethod, rawUrl, ...extra] = args.positionals;
      const method = rawMethod?.toUpperCase();
      if (!method || !METHODS.has(method) || !rawUrl || extra.length > 0) {
        throw new ToolError(EXIT.usage, "Usage: rest <METHOD> <arm-path|https-url>. Quote the path, and pass query parameters with --query name=value.");
      }
      const target = resolveTarget(rawUrl);
      const read = isReadRequest(method, target.path);
      const body = await readBody(args, context);
      const url = buildUrl2(target, args, method, context);
      const display = scrubText(url.replace(ARM_ENDPOINT, ""));
      if (!read) {
        const plan = { risk: method === "DELETE" ? "R2" : "R1", impact: `${method} ${display}`, steps: [{ action: "request", method, url: display, body }] };
        requireApproval(args, `rest ${method} ${rawUrl}`, plan, planFindings(method, target.path));
      }
      let response;
      try {
        response = await context.client.send(method, url, target.resource, { body, idempotent: read });
      } catch (error) {
        if (!read && isOutcomeUnknown(error))
          throw outcomeUnknown(error, `${method} ${display}`, "changes --app <app> --since 15m` or `rest GET <resource>");
        throw error;
      }
      const findings = [];
      let finalBody = response.body;
      let operationStatus;
      if (!read && (response.status === 201 || response.status === 202) && (response.headers["azure-asyncoperation"] || response.headers.location)) {
        const waitSeconds = intFlag(args, "wait", 120, 1800);
        const result3 = await context.client.poll(response, target.resource, waitSeconds * 1e3);
        operationStatus = result3.status;
        if (!result3.done) {
          findings.push({ severity: "warning", code: "OperationPending", message: `Still running after ${waitSeconds}s.`, fix: `Check later with \`rest GET ${scrubText(result3.pollUrl ?? "")}\`. Do not resend the write.` });
        } else if (result3.status !== "Succeeded") {
          throw new ToolError(EXIT.azure, `${method} ${display} finished with status ${result3.status}.`, { data: redactResponse(target.path, result3.body) });
        } else if (result3.body !== void 0 && response.headers.location && !response.headers["azure-asyncoperation"]) {
          finalBody = result3.body;
        }
      }
      const fitted = fitOutput(redactResponse(target.path, finalBody));
      return {
        summary: `${method} ${display} -> ${response.status}${operationStatus ? ` (${operationStatus})` : ""}.`,
        data: { status: response.status, operationStatus, body: fitted.body },
        findings: [...findings, ...fitted.findings],
        next: read || boolFlag(args, "lean") ? [] : ["Verify the change with one GET of the resource; do not repeat the write."]
      };
    }
  }
];

// lib/tools/app/commands/slots.js
var SWAP_WAIT_MS = 9e5;
var HOST_POLL_MS = 1e4;
var RESYNC_WAIT_MS = 2e4;
function slotName(target) {
  return target.slot ?? "production";
}
function productionOf(app) {
  return { ...app, id: app.siteId, slot: void 0, label: app.name, ref: `--app ${app.name}` };
}
async function contentShareOf(client, target) {
  const settings = await tryRead(() => client.arm("POST", `${target.id}/config/appsettings/list`, WEB_API_VERSION, { idempotent: true }));
  return settings?.properties.WEBSITE_CONTENTSHARE || void 0;
}
async function activeBuild(client, site) {
  const scm = site && scmHost(site);
  if (!scm)
    return void 0;
  const deployments = await tryRead(() => client.request("GET", `https://${scm}/api/deployments`, SCM_RESOURCE));
  return deployments?.find((item) => item.active)?.id;
}
function sharedShareFindings(states) {
  const byShare = /* @__PURE__ */ new Map();
  for (const state of states)
    if (state.contentShare)
      byShare.set(state.contentShare, [...byShare.get(state.contentShare) ?? [], state.name]);
  return [...byShare.values()].filter((names) => names.length > 1).map((names) => ({
    severity: "warning",
    code: "SharedContentShare",
    message: `${names.join(" and ")} use the same WEBSITE_CONTENTSHARE, so they share one content file share; deploying to one slot changes the other.`,
    fix: `Give each slot its own share: \`settings set --slot <s> --name WEBSITE_CONTENTSHARE --value <unique-name> --sticky\` (lowercase, max 63 chars), then deploy again.`
  }));
}
async function readSlot(client, target) {
  const [site, host, contentShare] = await Promise.all([
    tryRead(() => client.arm("GET", target.id, WEB_API_VERSION)),
    tryRead(() => readHostStatus(client, target)),
    contentShareOf(client, target)
  ]);
  return { target, site, host, contentShare };
}
async function keyVaultFindings(client, target) {
  const refs = await tryRead(() => client.arm("GET", `${target.id}/config/configreferences/appsettings`, WEB_API_VERSION));
  return (refs?.value ?? []).filter((ref) => ref.properties.status && ref.properties.status !== "Resolved").map((ref) => ({
    severity: "error",
    code: "KeyVaultReferenceUnresolved",
    message: `${slotName(target)}: ${ref.name.split("/").pop()} is ${ref.properties.status}. ${ref.properties.details ?? ""}`.trim(),
    fix: `Slots have their own managed identity. Grant this slot's identity "Key Vault Secrets User" on the vault, then run \`settings list ${target.ref}\`.`
  }));
}
function sameName(a, b) {
  return (a ?? "").toLowerCase() === b.toLowerCase();
}
var slotsCommands = [
  {
    name: "slots list",
    usage: "slots list --app <name|id>",
    description: "List production and deployment slots with state, host name, sticky (slot) setting names, and content-share conflicts.",
    details: ["stickySettings are the names that stay with their slot during a swap (config/slotConfigNames). Values are never printed."],
    handler: async (args, { client }) => {
      const app = await appTarget(client, args);
      const production = productionOf(app);
      const [site, slots, sticky] = await Promise.all([
        client.arm("GET", production.id, WEB_API_VERSION),
        client.arm("GET", `${production.id}/slots`, WEB_API_VERSION),
        tryRead(() => client.arm("GET", `${production.id}/config/slotConfigNames`, WEB_API_VERSION))
      ]);
      const targets = [
        { target: production, site },
        ...slots.value.map((slot) => ({ target: withSlot(production, slot.name.split("/").pop() ?? slot.name), site: slot }))
      ];
      const shares = await Promise.all(targets.map((item) => contentShareOf(client, item.target)));
      const rows = targets.map((item, index) => ({
        name: slotName(item.target),
        state: item.site.properties.state,
        hostName: item.site.properties.defaultHostName,
        contentShare: shares[index],
        lastSwap: item.site.properties.slotSwapStatus ?? void 0
      }));
      const findings = sharedShareFindings(rows);
      return {
        summary: `${app.name}: ${rows.length} slot(s) including production.`,
        data: {
          slots: rows,
          stickySettings: { appSettings: sticky?.properties.appSettingNames ?? [], connectionStrings: sticky?.properties.connectionStringNames ?? [] }
        },
        findings,
        next: ["Swap with `slots swap --app <app> --slot <s>`; mark a setting slot-specific with `settings set ... --sticky`."]
      };
    }
  },
  {
    name: "slots swap",
    usage: "slots swap --app <name|id> --slot <source> [--target production] [--check-function <name>] [--wait 900] [--approve]",
    description: "Swap a slot into production (or --target) once, then verify the swap, both hosts, deployed builds, and Key Vault references.",
    details: [
      "Pre-checks: the source host must be Running; a shared WEBSITE_CONTENTSHARE is reported.",
      "Verification: slotSwapStatus on the target, both hosts Running, active deployment IDs before/after, Key Vault reference status on both slots.",
      "--check-function calls that function on both slots after the swap (HTTP triggers only). If a slot rejects its keys (401), the tool syncs that slot's triggers once and calls again.",
      "Rollback: run the same swap again."
    ],
    handler: async (args, context) => {
      const { client, sleep } = context;
      const source2 = stringFlag(args, "slot");
      if (!source2 || source2.toLowerCase() === "production")
        throw new ToolError(EXIT.usage, "Pass the source slot with --slot, for example --slot staging. Production is the default --target.");
      const targetName = stringFlag(args, "target") ?? "production";
      if (targetName.toLowerCase() === source2.toLowerCase())
        throw new ToolError(EXIT.usage, "--slot and --target must differ.");
      const waitMs = intFlag(args, "wait", SWAP_WAIT_MS / 1e3, 1800) * 1e3;
      const from = await appTarget(client, args);
      const to = withSlot(productionOf(from), targetName);
      const command = `slots swap ${from.ref}${to.slot ? ` --target ${to.slot}` : ""}`;
      const [before, after] = await Promise.all([readSlot(client, from), readSlot(client, to)]);
      const findings = sharedShareFindings([{ name: slotName(from), contentShare: before.contentShare }, { name: slotName(to), contentShare: after.contentShare }]);
      if (!before.site)
        throw new ToolError(EXIT.usage, `Slot ${from.label} was not found.`, { next: [`Run \`slots list --app ${from.name}\`.`] });
      if (before.host?.state !== "Running") {
        throw new ToolError(EXIT.precheck, `${from.label} host is ${before.host?.state ?? "unreachable"}; swapping it would put a broken build into ${slotName(to)}.`, {
          findings,
          next: [`Fix the source first: \`host status ${from.ref}\`, \`logs query ${from.ref} --preset errors\`.`]
        });
      }
      if (after.host?.state !== "Running")
        findings.push({ severity: "warning", code: "TargetHostNotRunning", message: `${to.label} host is ${after.host?.state ?? "unreachable"} before the swap.` });
      const step = { action: `swap ${slotName(from)} into ${slotName(to)}`, method: "POST", url: `${from.id}/slotsswap?api-version=${WEB_API_VERSION}`, body: { targetSlot: slotName(to), preserveVnet: true } };
      requireApproval(args, command, {
        risk: "R2",
        impact: `Swap ${from.label} into ${to.label}. Traffic on ${to.label} moves to the build now in ${slotName(from)}; non-sticky settings move with the code. Brief cold start on both slots.`,
        steps: [step],
        rollback: command
      }, findings);
      const builds = { before: { [slotName(to)]: await activeBuild(client, after.site), [slotName(from)]: await activeBuild(client, before.site) }, after: {} };
      const started = context.now().getTime();
      await writeArm(context, step, `slots list --app ${from.name}`, waitMs);
      const targetSite = await client.arm("GET", to.id, WEB_API_VERSION);
      const status = targetSite.properties.slotSwapStatus;
      const swapRecorded = sameName(status?.sourceSlotName, slotName(from)) && sameName(status?.destinationSlotName, slotName(to));
      const hosts = await Promise.all([from, to].map((target) => waitFor(() => tryRead(() => readHostStatus(client, target)), (value) => value.state === "Running", { sleep, waitMs: 18e4, intervalMs: HOST_POLL_MS })));
      builds.after[slotName(to)] = await activeBuild(client, targetSite);
      builds.after[slotName(from)] = await activeBuild(client, before.site);
      if (!swapRecorded)
        findings.push({ severity: "warning", code: "SwapNotRecorded", message: `${to.label} does not show this swap in slotSwapStatus yet (${JSON.stringify(status ?? null)}).`, fix: `Do not swap again. Run \`slots list --app ${from.name}\` in a minute.` });
      const moved = builds.before[slotName(from)] && builds.after[slotName(to)] ? builds.before[slotName(from)] === builds.after[slotName(to)] : void 0;
      if (moved === false)
        findings.push({ severity: "warning", code: "BuildNotMoved", message: `${slotName(to)} now reports build ${builds.after[slotName(to)]}, expected ${builds.before[slotName(from)]}.`, fix: "Check `deployments list` on both slots." });
      hosts.forEach((host, index) => {
        const target = index === 0 ? from : to;
        if (!host.done)
          findings.push({ severity: "error", code: "HostNotRunning", message: `${target.label} host is ${host.value?.state ?? "unreachable"} after the swap.`, fix: `Run \`host status ${target.ref}\` and \`logs query ${target.ref} --preset errors\`.` });
      });
      findings.push(...await keyVaultFindings(client, to), ...await keyVaultFindings(client, from));
      let checks;
      const checkFunction = stringFlag(args, "check-function");
      if (checkFunction) {
        checks = [];
        for (const target of [to, from]) {
          let outcome = await tryRead(() => invokeFunction(context, target, checkFunction, {}));
          let resynced;
          if (outcome?.findings.some((finding) => finding.code === "KeyRejected")) {
            await client.arm("POST", `${target.id}/syncfunctiontriggers`, WEB_API_VERSION);
            await sleep(RESYNC_WAIT_MS);
            outcome = await tryRead(() => invokeFunction(context, target, checkFunction, {}));
            resynced = true;
            const fixed = !outcome?.findings.some((finding) => finding.code === "KeyRejected");
            if (fixed)
              findings.push({ severity: "info", code: "KeysResynced", message: `${target.label} rejected its keys after the swap; syncing triggers fixed it.` });
          }
          checks.push({ slot: slotName(target), status: outcome?.result.status, elapsedMs: outcome?.result.elapsedMs, body: outcome?.result.body, ...resynced ? { resynced } : {} });
          findings.push(...outcome?.findings ?? []);
        }
      }
      const verified = swapRecorded && hosts.every((host) => host.done);
      return {
        summary: verified ? `Swapped ${from.label} into ${to.label}; both hosts are Running.` : `Swap of ${from.label} into ${to.label} completed but verification is incomplete (see findings).`,
        data: { verified, swap: status, elapsedSeconds: Math.round((context.now().getTime() - started) / 1e3), builds, checks, rollback: command },
        findings,
        next: boolFlag(args, "approve") ? [`Roll back if needed: \`${command} --approve\`.`] : void 0
      };
    }
  }
];

// lib/tools/app/cli.js
var COMMANDS = [...docsCommands, ...readCommands, ...logStreamCommands, ...invokeCommands, ...settingsCommands, ...opsCommands, ...slotsCommands, ...networkCommands, ...restCommands];
var BOOLEAN_FLAGS = /* @__PURE__ */ new Set(["lean", "help", "approve", "all", "full", "create-subnet", "create-vnet", "connection-string", "sticky"]);
var FALLBACK = [
  "Fall back to REST now: `docs search <task>` then `docs get <id>` for a recipe, `api find <words>` for the operation, then `rest <METHOD> <path>`.",
  "Writes still need a plan and user approval. Never guess a URL."
];
function help() {
  return {
    summary: "functions-app: Azure Functions operations over Azure REST APIs. Output is JSON; exit codes: 0 ok, 2 usage, 3 unsupported (fall back to REST), 4 Azure error, 5 approval needed, 6 pre-check failed. Every --app command also takes --slot <name>, --resource-group, and --subscription. Run `<command> --help` for output fields and limits.",
    data: COMMANDS.map((command) => ({ usage: command.usage, description: command.description }))
  };
}
function findCommand(positionals) {
  for (const words of [2, 1]) {
    const name = positionals.slice(0, words).join(" ");
    const spec = COMMANDS.find((command) => command.name === name);
    if (spec)
      return { spec, rest: positionals.slice(words) };
  }
  return void 0;
}
async function runCli(argv, deps) {
  let commandName = argv.filter((arg) => !arg.startsWith("--")).slice(0, 2).join(" ") || "help";
  try {
    const args = parseArgs(argv, BOOLEAN_FLAGS);
    const lean = args.flags.get("lean") === true;
    if (args.positionals.length === 0 || args.positionals[0] === "help") {
      return { exitCode: EXIT.ok, output: successEnvelope("help", help()) };
    }
    const match = findCommand(args.positionals);
    if (!match) {
      throw new ToolError(EXIT.unsupported, `"${args.positionals.slice(0, 2).join(" ")}" is not a functions-app command.`, {
        data: COMMANDS.map((command) => command.name),
        next: FALLBACK
      });
    }
    commandName = match.spec.name;
    if (args.flags.get("help") === true) {
      return { exitCode: EXIT.ok, output: successEnvelope(commandName, { summary: match.spec.description, data: { usage: match.spec.usage, details: match.spec.details } }) };
    }
    const context = { client: new AzureClient(deps), referencesDir: deps.referencesDir, assetsDir: deps.assetsDir, now: deps.now, sleep: deps.sleep, fetch: deps.fetch, readInput: deps.readInput };
    const result3 = await match.spec.handler({ ...args, positionals: match.rest }, context);
    const envelope = successEnvelope(commandName, result3);
    return { exitCode: EXIT.ok, output: lean ? envelope.data ?? null : envelope };
  } catch (error) {
    return { exitCode: exitCodeOf(error), output: toErrorEnvelope(commandName, error) };
  }
}
function exitCodeOf(error) {
  return error instanceof ToolError ? error.exitCode : EXIT.failed;
}
function toErrorEnvelope(command, error) {
  if (error instanceof ToolError) {
    const next = error.options.next ?? (error.exitCode === EXIT.azure ? azureNext(command) : []);
    return errorEnvelope(command, error.exitCode, error.message, { ...error.options, next });
  }
  const message = error instanceof Error ? error.message : String(error);
  return errorEnvelope(command, EXIT.failed, `Unexpected failure: ${scrubText(message)}`, { next: FALLBACK });
}
function azureNext(command) {
  return command.startsWith("docs") || command.startsWith("api") ? [] : ["Follow the findings. For a read, you may retry once with `rest GET <path>`. Never resend a write until `changes` or a GET shows it did not apply."];
}

// lib/tools/app/main.js
var referencesDir = process.env.FUNCTIONS_APP_REFERENCES_DIR ?? fileURLToPath(new URL("../references/", import.meta.url));
var assetsDir = process.env.FUNCTIONS_APP_ASSETS_DIR ?? fileURLToPath(new URL("../assets/", import.meta.url));
async function readInput(source2) {
  if (source2 !== "-")
    return readFile(source2, "utf-8");
  const chunks = [];
  for await (const chunk of process.stdin)
    chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf-8");
}
if (typeof fetch !== "function") {
  const envelope = errorEnvelope("startup", EXIT.unsupported, `Node.js ${process.version} has no fetch; this tool needs Node.js 18 or later.`, {
    next: ["Fall back to REST with `az rest` and the recipes in references/ (quote URLs that contain &)."]
  });
  process.stdout.write(`${JSON.stringify(envelope, null, 2)}
`);
  process.exit(EXIT.unsupported);
}
var result2 = await runCli(process.argv.slice(2), {
  fetch: (url, init) => fetch(url, init),
  getToken: createTokenProvider(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  referencesDir,
  assetsDir,
  now: () => /* @__PURE__ */ new Date(),
  readInput
});
process.stdout.write(`${JSON.stringify(result2.output, null, 2)}
`);
process.exitCode = result2.exitCode;
