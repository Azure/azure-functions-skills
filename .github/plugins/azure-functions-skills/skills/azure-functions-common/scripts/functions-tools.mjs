#!/usr/bin/env node

// lib/tools/cli.js
import { realpathSync as realpathSync2 } from "node:fs";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// lib/tools/deploy/apply.js
import { appendFileSync } from "node:fs";
import { resolve as resolve3 } from "node:path";

// lib/tools/shared/output.js
var EXIT = {
  /** The command ran. Findings may still describe problems. */
  ok: 0,
  /** Unexpected failure. Use the manual steps; do not repeat the command. */
  unexpected: 1,
  /** Invalid arguments. Fix them and run once more. */
  usage: 2,
  /** A prerequisite or input is missing. Nothing was executed. */
  blocked: 3,
  /** An executed step failed. Read the finding before resuming. */
  stepFailed: 4
};
function succeed(command, summary, data, extras = {}) {
  return { exitCode: EXIT.ok, body: body(command, true, summary, data, extras) };
}
function fail(command, exitCode, summary, extras = {}) {
  return { exitCode, body: body(command, false, summary, extras.data ?? {}, extras) };
}
function body(command, ok, summary, data, extras) {
  return {
    schemaVersion: 1,
    command,
    ok,
    summary,
    data,
    findings: extras.findings ?? [],
    gaps: extras.gaps ?? [],
    ...extras.next ? { next: extras.next } : {}
  };
}

// lib/tools/shared/redact.js
var MASK = "***";
var RULES = [
  // Connection-string parts.
  [/\b(AccountKey|SharedAccessKey|SharedAccessSignature|InstrumentationKey|Password|Pwd)=[^;\s"']+/gi, `$1=${MASK}`],
  // Query-string credentials: function keys and SAS signatures.
  [/([?&](?:code|sig|key|token|access_token)=)[^&\s"']+/gi, `$1${MASK}`],
  [/\b(Bearer)\s+[A-Za-z0-9._~+/-]+=*/g, `$1 ${MASK}`],
  // KEY=value and "key": "value" pairs whose name looks like a credential.
  [/\b([A-Za-z0-9_]*(?:SECRET|PASSWORD|TOKEN|CONNECTION_STRING|CONNECTIONSTRING|_KEY)[A-Za-z0-9_]*)=("?)[^"\s]+\2/gi, `$1=${MASK}`],
  [/("[A-Za-z0-9_]*(?:secret|password|token|connectionString|key)"\s*:\s*)"[^"]*"/gi, `$1"${MASK}"`]
];
function redact(text) {
  return RULES.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), text);
}

// lib/tools/deploy/plan-file.js
import { createHash } from "node:crypto";
import { mkdirSync as mkdirSync2, readFileSync, writeFileSync as writeFileSync2 } from "node:fs";
import { dirname, join as join2 } from "node:path";

// lib/tools/shared/work-dir.js
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
var TOOL_DIR = ".azure-functions-skills";
function toolDir(dir) {
  return join(resolve(dir), TOOL_DIR);
}
function ensureToolDir(dir, ...parts) {
  const root = toolDir(dir);
  const target = join(root, ...parts);
  mkdirSync(target, { recursive: true });
  const ignore = join(root, ".gitignore");
  if (!existsSync(ignore))
    writeFileSync(ignore, "*\n");
  return target;
}

// lib/tools/deploy/plan-file.js
function stepArgs(id, plan, value = "") {
  if (id === "env-new") {
    return ["env", "new", plan.environment, "--subscription", plan.subscriptionId, "--location", plan.location, "--no-prompt"];
  }
  if (id === "provision" || id === "deploy")
    return [id, "-e", plan.environment, "--no-prompt"];
  return ["env", "set", id.slice("env-set:".length), value, "-e", plan.environment, "--no-prompt"];
}
var ENV_SET_VALUE_INDEX = 3;
function isValidStep(step2, plan) {
  if (!Array.isArray(step2.args) || step2.args.some((argument) => typeof argument !== "string"))
    return false;
  const known = step2.id === "env-new" || step2.id === "provision" || step2.id === "deploy" || /^env-set:[A-Z_][A-Z0-9_]*$/.test(step2.id);
  if (!known)
    return false;
  const expected = stepArgs(step2.id, plan, step2.id.startsWith("env-set:") ? step2.args[ENV_SET_VALUE_INDEX] : "");
  return expected.length === step2.args.length && expected.every((argument, index) => argument === step2.args[index]);
}
function workDir(dir) {
  return join2(toolDir(dir), "deploy");
}
function planFilePath(dir) {
  return join2(workDir(dir), "plan.json");
}
function stateFilePath(dir) {
  return join2(workDir(dir), "state.json");
}
function logFilePath(dir) {
  return join2(workDir(dir), "apply.log");
}
function planId(content) {
  return createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 16);
}
function writePlan(dir, content) {
  const plan = { ...content, planId: planId(content) };
  writeWorkFile(dir, planFilePath(dir), plan);
  return plan;
}
function readPlan(path) {
  const parsed = readJson(path);
  if (!parsed || parsed.kind !== "azure-functions-deploy-plan" || !Array.isArray(parsed.steps))
    return null;
  const { planId: recorded, ...content } = parsed;
  return recorded === planId(content) ? parsed : null;
}
function readState(dir, plan) {
  const state = readJson(stateFilePath(dir));
  return state && state.planId === plan.planId && Array.isArray(state.completed) ? state : { planId: plan.planId, completed: [] };
}
function writeState(dir, state) {
  writeWorkFile(dir, stateFilePath(dir), state);
}
function writeWorkFile(dir, path, value) {
  ensureWorkDir(dir);
  mkdirSync2(dirname(path), { recursive: true });
  writeFileSync2(path, `${JSON.stringify(value, null, 2)}
`);
}
function ensureWorkDir(dir) {
  ensureToolDir(dir, "deploy");
}
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

// lib/tools/deploy/project.js
import { createHash as createHash2 } from "node:crypto";
import { existsSync as existsSync2, readdirSync, readFileSync as readFileSync2, statSync } from "node:fs";
import { join as join3, resolve as resolve2 } from "node:path";

// lib/tools/shared/dotenv.js
function parseDotenv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match)
      continue;
    const raw = match[2];
    values[match[1]] = raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1).replace(/\\(["\\])/g, "$1") : raw;
  }
  return values;
}

// lib/tools/deploy/project.js
function inspectProject(dir) {
  const root = resolve2(dir);
  const azureYaml = readAzureYaml(join3(root, "azure.yaml"));
  const functionProjects = (azureYaml?.services ?? []).filter((service) => service.host === "function").map((service) => join3(root, service.project));
  return {
    dir: root,
    hasHostJson: [root, ...functionProjects].some((folder) => isFile(join3(folder, "host.json"))),
    isHostedSkills: isFile(join3(root, "agents.config.yaml")) || hasAgentFile(root),
    azureYaml,
    infra: readInfra(join3(root, "infra")),
    environments: readEnvironments(join3(root, ".azure")),
    fingerprint: fingerprint(root)
  };
}
function readEnvironmentValues(dir, environment) {
  const path = join3(resolve2(dir), ".azure", environment, ".env");
  return isFile(path) ? parseDotenv(readFileSync2(path, "utf-8")) : null;
}
function isFile(path) {
  return existsSync2(path) && statSync(path).isFile();
}
function isDirectory(path) {
  return existsSync2(path) && statSync(path).isDirectory();
}
function hasAgentFile(root) {
  return [root, join3(root, "src")].some((folder) => isDirectory(folder) && readdirSync(folder).some((name) => name.endsWith(".agent.md")));
}
function readAzureYaml(path) {
  if (!isFile(path))
    return null;
  let name = "";
  let template = "";
  const services = [];
  let section = "";
  let serviceIndent = -1;
  for (const rawLine of readFileSync2(path, "utf-8").split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, "");
    const match = line.match(/^(\s*)([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!match || line.trimStart().startsWith("#"))
      continue;
    const indent = match[1].length;
    const key = match[2];
    const value = match[3].replace(/^['"]|['"]$/g, "");
    if (indent === 0) {
      section = key;
      serviceIndent = -1;
      if (key === "name")
        name = value;
    } else if (section === "metadata" && key === "template") {
      template = value;
    } else if (section === "services") {
      if (serviceIndent < 0 || indent <= serviceIndent) {
        serviceIndent = indent;
        services.push({ name: key, project: ".", host: "", language: "" });
      } else if (key === "project" || key === "host" || key === "language") {
        services[services.length - 1][key] = value;
      }
    }
  }
  return { name, template, services };
}
function readInfra(infraDir) {
  const bicepPath = join3(infraDir, "main.bicep");
  if (!isFile(bicepPath)) {
    const hasTerraform = isDirectory(infraDir) && readdirSync(infraDir).some((name) => name.endsWith(".tf"));
    return { kind: hasTerraform ? "terraform" : null, allowedLocations: null, inputs: [] };
  }
  const bicep = parseBicepParameters(readFileSync2(bicepPath, "utf-8"));
  return {
    kind: "bicep",
    allowedLocations: bicep.get("location")?.allowed ?? null,
    inputs: readInputs(join3(infraDir, "main.parameters.json"), bicep)
  };
}
var OTHER_DECLARATION = /^(?:var|resource|module|output|type|func)\s+[A-Za-z_]|^targetScope\s*=/;
function parseBicepParameters(text) {
  const parameters = /* @__PURE__ */ new Map();
  let allowed = null;
  let inAllowed = false;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (inAllowed) {
      if (trimmed.startsWith("])"))
        inAllowed = false;
      else
        allowed?.push(...[...trimmed.matchAll(/'([^']*)'/g)].map((match) => match[1]));
      continue;
    }
    if (trimmed.startsWith("@allowed([")) {
      allowed = [...trimmed.matchAll(/'([^']*)'/g)].map((match) => match[1]);
      inAllowed = !trimmed.includes("])");
      continue;
    }
    const parameter = trimmed.match(/^param\s+([A-Za-z_][A-Za-z0-9_]*)\s+[^=]+?(=.*)?$/);
    if (parameter) {
      parameters.set(parameter[1], { hasDefault: Boolean(parameter[2]), allowed });
      allowed = null;
    } else if (OTHER_DECLARATION.test(trimmed)) {
      allowed = null;
    }
  }
  return parameters;
}
function readInputs(path, bicep) {
  if (!isFile(path))
    return [];
  let parsed;
  try {
    parsed = JSON.parse(readFileSync2(path, "utf-8"));
  } catch {
    return [];
  }
  const inputs = /* @__PURE__ */ new Map();
  for (const [parameter, entry] of Object.entries(parsed.parameters ?? {})) {
    for (const match of JSON.stringify(entry?.value ?? "").matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)(=[^}]*)?\}/g)) {
      if (inputs.has(match[1]))
        continue;
      inputs.set(match[1], {
        variable: match[1],
        parameter,
        hasDefault: match[2] !== void 0 || (bicep.get(parameter)?.hasDefault ?? false)
      });
    }
  }
  return [...inputs.values()].sort((a, b) => a.variable.localeCompare(b.variable));
}
function readEnvironments(azureDir) {
  if (!isDirectory(azureDir))
    return { defaultName: null, names: [] };
  const names = readdirSync(azureDir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && isFile(join3(azureDir, entry.name, ".env"))).map((entry) => entry.name).sort();
  let defaultName = null;
  try {
    const config = JSON.parse(readFileSync2(join3(azureDir, "config.json"), "utf-8"));
    if (typeof config.defaultEnvironment === "string" && names.includes(config.defaultEnvironment)) {
      defaultName = config.defaultEnvironment;
    }
  } catch {
  }
  return { defaultName, names };
}
function fingerprint(root) {
  const hash = createHash2("sha256");
  const files = [join3(root, "azure.yaml"), ...listFiles(join3(root, "infra"))].filter(isFile).sort();
  for (const file of files) {
    hash.update(file.slice(root.length).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(readFileSync2(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}
function listFiles(dir) {
  if (!isDirectory(dir))
    return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join3(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

// lib/tools/deploy/storage-access.js
var PROPAGATION_WINDOW_MINUTES = 15;
var BLOB_DATA_ROLES = ["Storage Blob Data Owner", "Storage Blob Data Contributor"];
var STORAGE_DENIAL_CODE = /\bAuthorizationPermissionMismatch\b|\bAuthorizationFailure\b/;
var GENERIC_DENIAL = /\b403\b|\bForbidden\b|not authorized to perform this operation/i;
var STORAGE_ENDPOINT = /\.blob\.core\.(?:windows\.net|chinacloudapi\.cn|usgovcloudapi\.net)\b/i;
function isStorageForbidden(output) {
  return STORAGE_DENIAL_CODE.test(output) || GENERIC_DENIAL.test(output) && STORAGE_ENDPOINT.test(output);
}
function provisionAgeMs(provisionedAt, now) {
  if (!provisionedAt)
    return null;
  const age = now.getTime() - Date.parse(provisionedAt);
  return Number.isFinite(age) && age >= 0 ? age : null;
}
function withinPropagationWindow(provisionedAt, now) {
  const age = provisionAgeMs(provisionedAt, now);
  return age !== null && age < PROPAGATION_WINDOW_MINUTES * 6e4;
}
async function diagnoseStorageAccess(target, run) {
  const age = provisionAgeMs(target.provisionedAt, target.now);
  const minutesSinceProvision = age === null ? null : Math.floor(age / 6e4);
  const unknown = (detail, evidence2 = {}) => ({
    cause: "unknown",
    detail,
    evidence: { ...evidence2, minutesSinceProvision },
    fix: "Read the log file, check the identity role and storage network rules, then resume."
  });
  const scope = ["--subscription", target.subscription, "--output", "json"];
  const az = async (args) => run("az", [...args, ...scope], { cwd: target.dir });
  const resourceGroup = parse(await az(["resource", "list", "--name", target.app, "--resource-type", "Microsoft.Web/sites"]))?.[0]?.resourceGroup;
  if (!resourceGroup)
    return unknown(`Function app ${target.app} could not be read.`);
  const site = parse(await az(["functionapp", "show", "--name", target.app, "--resource-group", resourceGroup]));
  const storage = site?.functionAppConfig?.deployment?.storage ?? site?.properties?.functionAppConfig?.deployment?.storage;
  const account = storage?.value ? accountName(storage.value) : null;
  if (!account)
    return unknown("The deployment storage of the function app could not be read.");
  const authentication = storage?.authentication?.type?.toLowerCase();
  const identity = authentication === "userassignedidentity" ? "user-assigned" : authentication === "systemassignedidentity" ? "system-assigned" : "other";
  if (identity === "other") {
    return unknown("The deployment storage does not use a managed identity, so a role delay cannot explain the refusal.", { account, identity });
  }
  const principalId = identity === "user-assigned" ? parse(await az(["identity", "show", "--ids", storage?.authentication?.userAssignedIdentityResourceId ?? ""]))?.principalId : site?.identity?.principalId;
  const accountInfo = parse(await az(["storage", "account", "show", "--name", account]));
  if (!principalId || !accountInfo?.id)
    return unknown("The identity or the storage account could not be read.", { account, identity });
  const publicNetworkAccess = accountInfo.publicNetworkAccess ?? "Enabled";
  const defaultAction = accountInfo.networkRuleSet?.defaultAction ?? "Allow";
  const assignments = parse(await az(["role", "assignment", "list", "--assignee", principalId, "--scope", accountInfo.id, "--include-inherited"]));
  const matching = (assignments ?? []).filter((assignment) => !!assignment.roleDefinitionName && BLOB_DATA_ROLES.includes(assignment.roleDefinitionName));
  const unconditional = matching.find((assignment) => !assignment.condition?.trim());
  const role = (unconditional ?? matching[0])?.roleDefinitionName ?? null;
  const evidence = { account, identity, role, publicNetworkAccess, defaultAction, minutesSinceProvision };
  if (!assignments)
    return unknown("The role assignments could not be read.", evidence);
  if (!role) {
    return {
      cause: "role-missing",
      evidence,
      detail: `The ${identity} identity has no Storage Blob Data role on ${account}.`,
      fix: `Assign Storage Blob Data Owner on ${account} to the identity in the infrastructure, run provision again, then resume.`
    };
  }
  if (!unconditional) {
    return unknown(`The ${role} assignment on ${account} has a condition that may deny this request.`, evidence);
  }
  if (publicNetworkAccess.toLowerCase() !== "enabled" || defaultAction.toLowerCase() !== "allow") {
    return {
      cause: "network-restricted",
      evidence,
      detail: `${account} does not accept requests from this machine (public access ${publicNetworkAccess}, default action ${defaultAction}).`,
      fix: "Deploy from a network the storage account allows, or change its network rules with the user's approval, then resume."
    };
  }
  if (!withinPropagationWindow(target.provisionedAt, target.now)) {
    return unknown("The role and network rules look correct, but the resources were not just provisioned, so a role delay is unlikely.", evidence);
  }
  return {
    cause: "propagation",
    evidence,
    detail: `The role and network rules are correct and provision finished ${minutesSinceProvision} minute(s) ago. The role assignment is probably still propagating.`
  };
}
function accountName(blobUrl) {
  try {
    const host = new URL(blobUrl).hostname;
    return host.split(".")[0] || null;
  } catch {
    return null;
  }
}
function parse(outcome) {
  if (outcome.code !== 0)
    return null;
  try {
    return JSON.parse(outcome.stdout);
  } catch {
    return null;
  }
}

// lib/tools/deploy/apply.js
var COMMAND = "deploy apply";
var TAIL_LINES = 40;
var PROPAGATION_RETRY_WAITS_MS = [6e4, 9e4];
async function applyDeploy(options, dependencies) {
  const dir = resolve3(options.dir);
  const plan = readPlan(planFilePath(dir));
  if (!plan) {
    return blocked("No usable plan was found", {
      id: "DEPLOY-PLAN-MISSING",
      severity: "error",
      title: "The plan file is missing or was changed after it was written",
      fix: "Run deploy plan again and ask the user to approve the new plan."
    });
  }
  if (!options.approve || options.approve !== plan.planId) {
    return blocked("The plan was not approved", {
      id: "DEPLOY-PLAN-NOT-APPROVED",
      severity: "error",
      title: "--approve does not match the current plan id",
      fix: "Show the current plan to the user. Pass its plan id only after they approve it."
    });
  }
  if (plan.steps.some((step2) => !isValidStep(step2, plan))) {
    return blocked("The plan contains a step that is not part of a deployment", {
      id: "DEPLOY-PLAN-INVALID",
      severity: "error",
      title: "A plan step is not one of the allowed azd commands",
      fix: "Run deploy plan again."
    });
  }
  if (inspectProject(dir).fingerprint !== plan.fingerprint) {
    return blocked("The project changed after the plan was written", {
      id: "DEPLOY-PLAN-STALE",
      severity: "error",
      title: "azure.yaml or infra/ changed after planning",
      fix: "Run deploy plan again and ask the user to approve the new plan."
    });
  }
  ensureWorkDir(dir);
  const logFile = logFilePath(dir);
  const now = dependencies.now ?? (() => /* @__PURE__ */ new Date());
  const sleep = dependencies.sleep ?? ((ms) => new Promise((done2) => setTimeout(done2, ms)));
  const state = readState(dir, plan);
  const completed = [...state.completed];
  let provisionedAt = state.provisionedAt;
  const retries = [];
  for (const step2 of plan.steps) {
    if (completed.includes(step2.id))
      continue;
    const isPreview = options.preview && step2.changes !== "local-environment";
    const args = isPreview ? [...step2.args, "--preview"] : [...step2.args];
    if (isPreview && step2.id !== "provision")
      break;
    const execute = async () => {
      const outcome2 = await dependencies.run("azd", args, { cwd: dir, timeoutMs: step2.timeoutSeconds * 1e3 });
      const output2 = redact([outcome2.stdout, outcome2.stderr].filter(Boolean).join("\n"));
      appendFileSync(logFile, `--- ${step2.id} (exit ${outcome2.code ?? "none"})
${output2}
`);
      return { outcome: outcome2, output: output2 };
    };
    let { outcome, output } = await execute();
    let storageAccess;
    while (outcome.code !== 0 && step2.id === "deploy" && isStorageForbidden(output)) {
      storageAccess ??= await diagnose(dir, plan, provisionedAt, now(), dependencies.run);
      const wait = PROPAGATION_RETRY_WAITS_MS[retries.length];
      if (storageAccess.cause !== "propagation" || wait === void 0)
        break;
      if (!withinPropagationWindow(provisionedAt, new Date(now().getTime() + wait))) {
        storageAccess = {
          ...storageAccess,
          cause: "unknown",
          detail: `${storageAccess.detail} Another wait would pass the ${PROPAGATION_WINDOW_MINUTES}-minute propagation window, so it was not retried.`
        };
        break;
      }
      retries.push({ step: step2.id, cause: "propagation", waitedSeconds: wait / 1e3, evidence: storageAccess.evidence });
      appendFileSync(logFile, `--- ${step2.id}: storage refused the package; waiting ${wait / 1e3}s for role propagation
`);
      await sleep(wait);
      ({ outcome, output } = await execute());
    }
    const storageRefused = storageAccess !== void 0 && isStorageForbidden(output);
    if (outcome.code !== 0) {
      return fail(COMMAND, EXIT.stepFailed, `Step ${step2.id} failed`, {
        data: {
          planId: plan.planId,
          environment: plan.environment,
          completed,
          failedStep: step2.id,
          outputTail: tail(output),
          logFile,
          ...retries.length > 0 ? { retries } : {},
          ...storageAccess ? { storageAccess } : {}
        },
        findings: [storageRefused && storageAccess ? storageFailure(storageAccess, retries.length) : failure(step2, outcome, output)],
        next: {
          action: "fix-then-resume",
          reason: "Fix the cause, then run the same command. Finished steps are not repeated. Do not retry unchanged.",
          command: resumeCommand(dir, plan)
        }
      });
    }
    if (isPreview) {
      return succeed(COMMAND, "Previewed the infrastructure change. Nothing was provisioned.", {
        planId: plan.planId,
        environment: plan.environment,
        completed,
        preview: tail(output),
        logFile
      }, { next: { action: "approve", reason: "Run without --preview after the user approves.", command: resumeCommand(dir, plan) } });
    }
    completed.push(step2.id);
    if (step2.id === "provision")
      provisionedAt = now().toISOString();
    writeState(dir, { planId: plan.planId, completed, ...provisionedAt ? { provisionedAt } : {} });
  }
  if (options.preview) {
    return succeed(COMMAND, "This plan has no infrastructure change to preview.", {
      planId: plan.planId,
      environment: plan.environment,
      completed,
      logFile
    });
  }
  const functionApp = functionAppName(readEnvironmentValues(dir, plan.environment) ?? {});
  return succeed(COMMAND, `Deployed environment ${plan.environment}`, {
    planId: plan.planId,
    environment: plan.environment,
    completed,
    functionApp,
    logFile,
    ...retries.length > 0 ? { retries } : {},
    ...plan.mode === "provision-and-deploy" ? { telemetry: { operation: "deploy", environmentName: plan.environment } } : {}
  }, {
    next: {
      action: "verify",
      reason: "Confirm that the functions are listed and respond.",
      command: `deploy verify --dir "${dir}" --env ${plan.environment}`
    }
  });
}
function functionAppName(values) {
  if (values.AZURE_FUNCTION_NAME)
    return values.AZURE_FUNCTION_NAME;
  const serviceNames = Object.entries(values).filter(([key, value]) => /^SERVICE_[A-Z0-9_]+_NAME$/.test(key) && value);
  return serviceNames.length === 1 ? serviceNames[0][1] : null;
}
function blocked(summary, finding) {
  return fail(COMMAND, EXIT.blocked, summary, { findings: [finding] });
}
async function diagnose(dir, plan, provisionedAt, now, run) {
  const app = functionAppName(readEnvironmentValues(dir, plan.environment) ?? {});
  if (!app) {
    return {
      cause: "unknown",
      evidence: {},
      detail: "The azd environment does not name the function app, so its storage could not be checked.",
      fix: "Check the identity role and storage network rules in the Azure portal, then resume."
    };
  }
  return diagnoseStorageAccess({ app, subscription: plan.subscriptionId, dir, provisionedAt, now }, run);
}
function storageFailure(diagnosis, retried) {
  const after = retried > 0 ? ` after ${retried} automatic retr${retried === 1 ? "y" : "ies"}` : "";
  return {
    id: "DEPLOY-STORAGE-FORBIDDEN",
    severity: "error",
    title: `The deployment storage refused the package${after} (${diagnosis.cause})`,
    detail: diagnosis.detail,
    ...diagnosis.fix ? { fix: diagnosis.fix } : retried > 0 ? { fix: "Wait a few minutes and resume once. If it still fails, check the role assignment in the Azure portal." } : {}
  };
}
function resumeCommand(dir, plan) {
  return `deploy apply --dir "${dir}" --approve ${plan.planId}`;
}
function failure(step2, outcome, output) {
  const base = { id: "DEPLOY-STEP-FAILED", severity: "error" };
  if (outcome.notFound)
    return { ...base, title: "The azd command was not found", fix: "Install the Azure Developer CLI." };
  if (outcome.timedOut) {
    return {
      ...base,
      title: `azd ${step2.args[0]} timed out after ${step2.timeoutSeconds} seconds`,
      detail: "The operation may still be running in Azure. Check its state before resuming."
    };
  }
  const title = `azd ${step2.args[0]} exited with code ${outcome.code}`;
  if (/not logged in|azd auth login|AADSTS|reauthentication required/i.test(output)) {
    return { ...base, title, detail: "Authentication failed.", fix: "azd auth login" };
  }
  if (/quota|SkuNotAvailable|LocationNotAvailable|not available in (?:the )?(?:location|region)/i.test(output)) {
    return {
      ...base,
      title,
      detail: "The subscription or region cannot supply the requested resources.",
      fix: "Plan again with another --location and a new --env name."
    };
  }
  return { ...base, title, detail: "Read data.outputTail and the log file for the cause." };
}
function tail(text) {
  return text.split(/\r?\n/).slice(-TAIL_LINES).join("\n").trim();
}

// lib/tools/deploy/plan.js
import { existsSync as existsSync3, statSync as statSync2 } from "node:fs";
import { basename, resolve as resolve4 } from "node:path";

// lib/tools/shared/args.js
var UsageError = class extends Error {
};
function parseArgs(argv, spec) {
  const parsed = { strings: {}, lists: {}, booleans: {} };
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith("--"))
      throw new UsageError(`Unexpected argument: ${token}`);
    const name = token.slice(2);
    if (spec.booleans?.includes(name)) {
      parsed.booleans[name] = true;
      continue;
    }
    const isList = spec.lists?.includes(name) ?? false;
    if (!isList && !spec.strings?.includes(name))
      throw new UsageError(`Unknown option: ${token}`);
    const value = argv[++index];
    if (value === void 0 || value.startsWith("--"))
      throw new UsageError(`Option ${token} needs a value`);
    if (isList) {
      (parsed.lists[name] ??= []).push(value);
    } else {
      if (name in parsed.strings)
        throw new UsageError(`Option ${token} was given more than once`);
      parsed.strings[name] = value;
    }
  }
  return parsed;
}

// lib/tools/deploy/plan.js
var COMMAND2 = "deploy plan";
var MANUAL_STEPS = "references/manual-deploy.md";
var AZD_MANAGED = /* @__PURE__ */ new Set([
  "AZURE_ENV_NAME",
  "AZURE_LOCATION",
  "AZURE_SUBSCRIPTION_ID",
  "AZURE_PRINCIPAL_ID",
  "AZURE_PRINCIPAL_TYPE",
  "AZURE_TENANT_ID",
  "AZURE_RESOURCE_GROUP"
]);
var KNOWN_DEFAULTS = { VNET_ENABLED: "false" };
var ENVIRONMENT_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
var VALUE_NAME = /^[A-Z_][A-Z0-9_]*$/;
var SECRET_NAME = /SECRET|PASSWORD|TOKEN|KEY|CONNECTION/i;
var PROVISION_TIMEOUT_SECONDS = 1800;
var DEPLOY_TIMEOUT_SECONDS = 1800;
async function planDeploy(options, dependencies) {
  const dir = resolve4(options.dir);
  if (!existsSync3(dir) || !statSync2(dir).isDirectory())
    throw new UsageError(`--dir is not a folder: ${options.dir}`);
  const requested = parseValues(options.set);
  if (options.env !== void 0 && !ENVIRONMENT_NAME.test(options.env)) {
    throw new UsageError("--env may contain only letters, digits, and hyphens (64 characters at most)");
  }
  const project = inspectProject(dir);
  const projectBlock = checkProject(project);
  if (projectBlock)
    return projectBlock;
  const [version, login, account, defaultSubscription, defaultLocation] = await Promise.all([
    dependencies.run("azd", ["version"], { cwd: dir }),
    dependencies.run("azd", ["auth", "login", "--check-status"], { cwd: dir }),
    dependencies.run("az", ["account", "show", "--output", "json"], { cwd: dir }),
    dependencies.run("azd", ["config", "get", "defaults.subscription"], { cwd: dir }),
    dependencies.run("azd", ["config", "get", "defaults.location"], { cwd: dir })
  ]);
  if (version.notFound) {
    return blocked2("Azure Developer CLI is not installed", [{
      id: "DEPLOY-AZD-MISSING",
      severity: "error",
      title: "The azd command was not found",
      fix: "Install the Azure Developer CLI, or run azure-functions-setup."
    }]);
  }
  if (login.code !== 0) {
    return blocked2("Not signed in to Azure Developer CLI", [{
      id: "DEPLOY-AZD-LOGIN",
      severity: "error",
      title: "azd is not signed in",
      fix: "azd auth login"
    }]);
  }
  const gaps = [];
  const azAccount = parseAccount(account.code === 0 ? account.stdout : "");
  if (!azAccount)
    gaps.push({ check: "azure-cli-account", reason: "az is missing or signed out; deploy verify needs it" });
  const findings = [];
  const inputsNeeded = [];
  const environment = options.env ?? project.environments.defaultName ?? void 0;
  const existing = environment ? readEnvironmentValues(dir, environment) : null;
  if (!environment) {
    inputsNeeded.push({
      name: "environment",
      option: "--env",
      reason: "No azd environment exists yet",
      suggested: suggestEnvironmentName(project)
    });
  }
  const subscriptionId = resolveSetting({
    name: "subscription",
    option: "--subscription",
    findingId: "DEPLOY-ENV-SUBSCRIPTION-MISMATCH",
    requested: options.subscription,
    existing: existing?.AZURE_SUBSCRIPTION_ID,
    fallbacks: [configValue(defaultSubscription.code === 0 ? defaultSubscription.stdout : ""), azAccount?.id],
    reason: "No subscription is selected in the environment, the azd defaults, or az"
  }, findings, inputsNeeded);
  const location = resolveSetting({
    name: "location",
    option: "--location",
    findingId: "DEPLOY-ENV-LOCATION-MISMATCH",
    requested: options.location,
    existing: existing?.AZURE_LOCATION,
    fallbacks: [configValue(defaultLocation.code === 0 ? defaultLocation.stdout : "")],
    reason: "No location is selected in the environment or the azd defaults",
    allowed: project.infra.allowedLocations ?? void 0
  }, findings, inputsNeeded);
  if (location && project.infra.allowedLocations && !project.infra.allowedLocations.includes(location)) {
    findings.push({
      id: "DEPLOY-LOCATION-NOT-ALLOWED",
      severity: "error",
      title: `The template does not allow the location ${location}`,
      detail: `Allowed: ${project.infra.allowedLocations.join(", ")}`,
      fix: "Run deploy plan again with --location set to an allowed value."
    });
  }
  const values = planValues(project, requested, existing ?? {}, options.codeOnly, findings, inputsNeeded);
  if (findings.some((finding) => finding.severity === "error")) {
    return blocked2("The deployment inputs conflict with the project", findings, { gaps });
  }
  if (inputsNeeded.length > 0 || !environment || !subscriptionId || !location) {
    return blocked2(`Missing ${inputsNeeded.length} deployment input(s)`, findings, {
      gaps,
      data: { inputsNeeded },
      next: { action: "ask-user", reason: "Ask for each missing input, then run deploy plan again with the listed options." }
    });
  }
  const mode = options.codeOnly ? "code-only" : "provision-and-deploy";
  const plan = writePlan(dir, {
    schemaVersion: 1,
    kind: "azure-functions-deploy-plan",
    createdAt: dependencies.now().toISOString(),
    environment,
    subscriptionId,
    location,
    mode,
    fingerprint: project.fingerprint,
    steps: buildSteps(environment, subscriptionId, location, existing !== null, values, options.codeOnly)
  });
  const next = {
    action: "approve",
    reason: "Show the subscription, location, values, and steps to the user. Run the command only after they approve.",
    command: `deploy apply --dir "${dir}" --approve ${plan.planId}`
  };
  return succeed(COMMAND2, `Plan ${plan.planId} has ${plan.steps.length} step(s) for environment ${environment}`, {
    planId: plan.planId,
    planFile: planFilePath(dir),
    environment,
    environmentExists: existing !== null,
    subscription: { id: subscriptionId, name: azAccount?.id === subscriptionId ? azAccount.name : null },
    location,
    mode,
    template: project.azureYaml?.template ?? "",
    services: (project.azureYaml?.services ?? []).filter((service) => service.host === "function").map((service) => service.name),
    values: values.map((value) => SECRET_NAME.test(value.name) ? { ...value, value: "***" } : value),
    steps: plan.steps.map((step2) => ({ id: step2.id, command: display(step2), changes: step2.changes }))
  }, { findings, gaps, next });
}
function checkProject(project) {
  if (project.isHostedSkills) {
    return blocked2("This is an Azure Functions Hosted Skills app", [{
      id: "DEPLOY-HOSTED-SKILLS",
      severity: "info",
      title: "Hosted Skills apps deploy through their own skill"
    }], { next: { action: "azure-functions-hosted-skills", reason: "It owns model, connector, and runtime setup." } });
  }
  const manual = { action: "manual-steps", reason: `Follow ${MANUAL_STEPS}.` };
  if (!project.azureYaml || project.infra.kind !== "bicep") {
    const detail = project.infra.kind === "terraform" ? "Terraform infrastructure is not supported by the script yet." : "The script needs azure.yaml and infra/main.bicep.";
    return blocked2("This project is not an azd project with Bicep infrastructure", [{
      id: "DEPLOY-NO-AZD-PROJECT",
      severity: "error",
      title: "No supported azd project was found",
      detail,
      fix: "Create the project from an azd template with azure-functions-create, or deploy by hand."
    }], { next: manual });
  }
  if (!project.azureYaml.services.some((service) => service.host === "function")) {
    return blocked2("azure.yaml has no function app service", [{
      id: "DEPLOY-NO-FUNCTION-SERVICE",
      severity: "error",
      title: "No service in azure.yaml uses host: function"
    }], { next: manual });
  }
  if (!project.hasHostJson) {
    return blocked2("No host.json was found", [{
      id: "DEPLOY-NOT-FUNCTIONS-PROJECT",
      severity: "error",
      title: "The function service has no host.json",
      fix: "Run the command with --dir set to the folder that contains azure.yaml."
    }]);
  }
  return null;
}
function blocked2(summary, findings, extras = {}) {
  return fail(COMMAND2, EXIT.blocked, summary, { findings, ...extras });
}
function resolveSetting(request2, findings, inputsNeeded) {
  if (request2.existing) {
    if (request2.requested && request2.requested !== request2.existing) {
      findings.push({
        id: request2.findingId,
        severity: "error",
        title: `The environment already uses another ${request2.name}`,
        detail: `Environment: ${request2.existing}. Requested: ${request2.requested}.`,
        fix: `Omit ${request2.option}, or choose a new environment name with --env.`
      });
    }
    return request2.existing;
  }
  const value = request2.requested ?? request2.fallbacks.find((candidate) => candidate);
  if (!value) {
    inputsNeeded.push({
      name: request2.name,
      option: request2.option,
      reason: request2.reason,
      ...request2.allowed ? { allowed: request2.allowed } : {}
    });
  }
  return value;
}
function planValues(project, requested, existing, codeOnly, findings, inputsNeeded) {
  const values = [];
  const inputs = project.infra.inputs.filter((input) => !AZD_MANAGED.has(input.variable));
  for (const input of inputs) {
    const option = requested.get(input.variable);
    if (option !== void 0) {
      if (existing[input.variable] !== option)
        values.push({ name: input.variable, value: option, source: "option" });
    } else if (codeOnly || input.variable in existing || input.hasDefault) {
      continue;
    } else if (input.variable in KNOWN_DEFAULTS) {
      values.push({ name: input.variable, value: KNOWN_DEFAULTS[input.variable], source: "default" });
    } else {
      inputsNeeded.push({
        name: input.variable,
        option: `--set ${input.variable}=<value>`,
        reason: `infra/main.parameters.json needs it for the parameter ${input.parameter}`
      });
    }
  }
  const known = new Set(inputs.map((input) => input.variable));
  for (const [name, value] of requested) {
    if (known.has(name))
      continue;
    findings.push({
      id: "DEPLOY-VALUE-NOT-USED",
      severity: "warn",
      title: `${name} is not referenced by infra/main.parameters.json`,
      detail: "The value is still stored in the azd environment."
    });
    if (existing[name] !== value)
      values.push({ name, value, source: "option" });
  }
  return values;
}
function buildSteps(environment, subscriptionId, location, environmentExists, values, codeOnly) {
  const target = { environment, subscriptionId, location };
  const steps = [];
  if (!environmentExists) {
    steps.push({ id: "env-new", changes: "local-environment", timeoutSeconds: 60, args: stepArgs("env-new", target) });
  }
  for (const value of values) {
    const id = `env-set:${value.name}`;
    steps.push({ id, changes: "local-environment", timeoutSeconds: 60, args: stepArgs(id, target, value.value) });
  }
  if (!codeOnly) {
    steps.push({
      id: "provision",
      changes: "azure-resources",
      timeoutSeconds: PROVISION_TIMEOUT_SECONDS,
      args: stepArgs("provision", target)
    });
  }
  steps.push({
    id: "deploy",
    changes: "application-code",
    timeoutSeconds: DEPLOY_TIMEOUT_SECONDS,
    args: stepArgs("deploy", target)
  });
  return steps;
}
function display(step2) {
  const args = step2.id.startsWith("env-set:") && SECRET_NAME.test(step2.args[2]) ? step2.args.map((argument, index) => index === 3 ? "***" : argument) : step2.args;
  return ["azd", ...args].join(" ");
}
function parseValues(pairs) {
  const values = /* @__PURE__ */ new Map();
  for (const pair of pairs) {
    const separator = pair.indexOf("=");
    const name = separator > 0 ? pair.slice(0, separator) : "";
    if (!VALUE_NAME.test(name))
      throw new UsageError(`--set expects NAME=VALUE with an upper-case name: ${pair}`);
    values.set(name, pair.slice(separator + 1));
  }
  return values;
}
function parseAccount(stdout) {
  try {
    const account = JSON.parse(stdout);
    return typeof account.id === "string" ? { id: account.id, name: String(account.name ?? "") } : null;
  } catch {
    return null;
  }
}
function configValue(stdout) {
  const text = stdout.trim();
  if (!text)
    return void 0;
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "string" && parsed ? parsed : void 0;
  } catch {
    return /^[\w-]+$/.test(text) ? text : void 0;
  }
}
function suggestEnvironmentName(project) {
  const base = (project.azureYaml?.name || basename(project.dir)).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `${base || "functions"}-dev`;
}

// lib/tools/deploy/verify.js
import { resolve as resolve5 } from "node:path";
var COMMAND3 = "deploy verify";
var LIST_ATTEMPTS = 6;
var LIST_INTERVAL_MS = 1e4;
var MAX_HTTP_CHECKS = 3;
async function verifyDeploy(options, dependencies) {
  const dir = resolve5(options.dir);
  const environment = options.env ?? inspectProject(dir).environments.defaultName;
  const values = (environment ? readEnvironmentValues(dir, environment) : null) ?? {};
  const app = options.app ?? functionAppName(values);
  const subscription = options.subscription ?? values.AZURE_SUBSCRIPTION_ID;
  if (!app || !subscription) {
    return blocked3("The function app could not be identified", {
      id: "VERIFY-APP-UNKNOWN",
      severity: "error",
      title: "The azd environment does not name a function app or subscription",
      fix: "Pass --app and --subscription, or run deploy apply first."
    });
  }
  const scope = ["--subscription", subscription, "--output", "json"];
  const located = await dependencies.run("az", ["resource", "list", "--name", app, "--resource-type", "Microsoft.Web/sites", ...scope], { cwd: dir });
  if (located.notFound) {
    return blocked3("Azure CLI is not installed", {
      id: "VERIFY-AZ-MISSING",
      severity: "error",
      title: "The az command was not found",
      fix: "Install the Azure CLI, or check the app in the Azure portal."
    });
  }
  const resource = parse2(located)?.[0];
  const resourceGroup = resource?.resourceGroup;
  if (!resourceGroup) {
    return blocked3(`Function app ${app} was not found`, {
      id: "VERIFY-APP-NOT-FOUND",
      severity: "error",
      title: `No function app named ${app} is visible in the subscription`,
      fix: "Check az login and the subscription, then run deploy verify again."
    });
  }
  const target = ["--name", app, "--resource-group", resourceGroup, ...scope];
  const site = parse2(await dependencies.run("az", ["functionapp", "show", ...target], { cwd: dir }));
  const state = site?.state ?? await resourceState(app, resourceGroup, scope, dir, dependencies);
  const entries = await listFunctions(target, dir, dependencies);
  const findings = [];
  const gaps = [];
  const functions = entries.map(describe);
  if (!state) {
    gaps.push({ check: "state", reason: "Azure did not report the app state. The function list and HTTP checks stand in for it." });
  } else if (state !== "Running") {
    findings.push({ id: "VERIFY-APP-NOT-RUNNING", severity: "error", title: `The function app state is ${state}` });
  }
  if (functions.length === 0) {
    findings.push({
      id: "VERIFY-NO-FUNCTIONS",
      severity: "error",
      title: "The function app lists no functions",
      detail: "The package may have failed to build or load. Use azure-functions-diagnostics."
    });
  }
  const http = [];
  for (const entry of entries) {
    const info = describe(entry);
    if (info.trigger !== "httpTrigger")
      continue;
    const reason = skipReason(entry, info, http.length, options.useKeys ?? false);
    if (reason) {
      gaps.push({ check: `http:${info.name}`, reason });
      continue;
    }
    const usedKey = info.authLevel?.toLowerCase() === "function";
    const key = usedKey ? await functionKey(info.name, target, dir, dependencies) : null;
    if (usedKey && !key) {
      gaps.push({ check: `http:${info.name}`, reason: "The function key could not be read with the Azure CLI." });
      continue;
    }
    const headers = key ? { "x-functions-key": key } : void 0;
    const status = await dependencies.fetchStatus(entry.invokeUrlTemplate, headers).catch(() => 0);
    const reachable = status >= 200 && status < 500 && status !== 404 && !(usedKey && (status === 401 || status === 403));
    http.push({ function: info.name, status, reachable, usedKey });
    if (!reachable) {
      findings.push({
        id: "VERIFY-HTTP-FAILED",
        severity: "error",
        title: `GET ${info.name} returned ${status === 0 ? "no response" : `HTTP ${status}`}`
      });
    }
  }
  const data = {
    functionApp: app,
    resourceGroup,
    state: state ?? "unknown",
    hostName: site?.defaultHostName,
    ...resource?.id ? { portalUrl: `https://portal.azure.com/#resource${resource.id}/overview` } : {},
    functions,
    http
  };
  const failed = findings.some((finding) => finding.severity === "error");
  const summary = failed ? `Verification found ${findings.length} problem(s) in ${app}` : `${app} is running with ${functions.length} function(s)`;
  return failed ? { exitCode: EXIT.ok, body: { ...succeed(COMMAND3, summary, data, { findings, gaps }).body, ok: false } } : succeed(COMMAND3, summary, data, { findings, gaps });
}
async function listFunctions(target, dir, dependencies) {
  for (let attempt = 1; attempt <= LIST_ATTEMPTS; attempt++) {
    const listed = parse2(await dependencies.run("az", ["functionapp", "function", "list", ...target], { cwd: dir }));
    if (Array.isArray(listed) && listed.length > 0)
      return listed;
    if (attempt < LIST_ATTEMPTS)
      await dependencies.sleep(LIST_INTERVAL_MS);
  }
  return [];
}
function describe(entry) {
  const trigger = entry.config?.bindings?.find((binding) => binding.type?.endsWith("Trigger"));
  return {
    name: (entry.name ?? "").split("/").pop() ?? "",
    trigger: trigger?.type ?? "unknown",
    ...trigger?.authLevel ? { authLevel: trigger.authLevel } : {}
  };
}
async function resourceState(app, resourceGroup, scope, dir, dependencies) {
  const resource = parse2(await dependencies.run("az", [
    "resource",
    "show",
    "--name",
    app,
    "--resource-group",
    resourceGroup,
    "--resource-type",
    "Microsoft.Web/sites",
    ...scope
  ], { cwd: dir }));
  return resource?.properties?.state ?? null;
}
async function functionKey(name, target, dir, dependencies) {
  const keys = parse2(await dependencies.run("az", ["functionapp", "function", "keys", "list", "--function-name", name, ...target], { cwd: dir }));
  const key = keys?.default ?? Object.values(keys ?? {}).find((value) => typeof value === "string");
  return typeof key === "string" && key ? key : null;
}
function skipReason(entry, info, checked, useKeys) {
  const methods = entry.config?.bindings?.find((binding) => binding.type === "httpTrigger")?.methods;
  const level = info.authLevel?.toLowerCase();
  if (level === "function" && !useKeys)
    return "Needs a function key. Run deploy verify with --use-keys to read it with the Azure CLI.";
  if (level !== "anonymous" && level !== "function")
    return "Needs an admin or system key. Request it manually.";
  if (methods && methods.length > 0 && !methods.some((method) => method.toLowerCase() === "get"))
    return "Does not accept GET.";
  if (!entry.invokeUrlTemplate || entry.invokeUrlTemplate.includes("{"))
    return "The route needs parameters.";
  if (checked >= MAX_HTTP_CHECKS)
    return `Only the first ${MAX_HTTP_CHECKS} HTTP triggers are requested.`;
  return null;
}
function parse2(outcome) {
  if (outcome.code !== 0)
    return null;
  try {
    return JSON.parse(outcome.stdout);
  } catch {
    return null;
  }
}
function blocked3(summary, finding) {
  return fail(COMMAND3, EXIT.blocked, summary, { findings: [finding] });
}

// lib/tools/local/processes.js
import { spawn as spawn2, spawnSync } from "node:child_process";
import { existsSync as existsSync5 } from "node:fs";
import { request } from "node:http";
import { createConnection, createServer } from "node:net";

// lib/tools/shared/exec.js
import { spawn } from "node:child_process";
import { existsSync as existsSync4 } from "node:fs";
import { delimiter, join as join4, posix, win32 } from "node:path";
var DEFAULT_TIMEOUT_MS = 6e4;
var NATIVE_FIRST = [".exe", ".com"];
var UNSAFE_FOR_CMD = /["%^&|<>!\r\n]/;
function resolveExecutable(command, environment) {
  const isWindows = environment.platform === "win32";
  const separator = isWindows ? ";" : delimiter;
  const joinPath = isWindows ? win32.join : join4;
  const extensions = isWindows ? orderExtensions((environment.pathExt || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)) : [""];
  if (isWindows ? win32.isAbsolute(command) : posix.isAbsolute(command)) {
    const candidates = isWindows && /\.[A-Za-z0-9]+$/.test(command) ? [command] : extensions.map((extension) => `${command}${extension}`);
    return candidates.find((candidate) => environment.exists(candidate)) ?? null;
  }
  for (const directory of environment.path.split(separator).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = joinPath(directory, `${command}${extension}`);
      if (environment.exists(candidate))
        return candidate;
    }
  }
  return null;
}
function orderExtensions(extensions) {
  const lower = extensions.map((extension) => extension.toLowerCase());
  return [
    ...lower.filter((extension) => NATIVE_FIRST.includes(extension)),
    ...lower.filter((extension) => !NATIVE_FIRST.includes(extension))
  ];
}
function buildInvocation(file, args, platform) {
  if (platform !== "win32" || !/\.(?:cmd|bat)$/i.test(file))
    return { file, args: [...args], verbatim: false };
  const unsafe = args.find((argument) => UNSAFE_FOR_CMD.test(argument));
  if (unsafe !== void 0)
    throw new Error(`Unsafe argument for a Windows command script: ${JSON.stringify(unsafe)}`);
  const quoted = args.map((argument) => argument === "" || /\s/.test(argument) ? `"${argument}"` : argument);
  return { file: "cmd.exe", args: ["/d", "/s", "/c", `"${[`"${file}"`, ...quoted].join(" ")}"`], verbatim: true };
}
function createRunner(environment = process.env, platform = process.platform) {
  return (command, args, options = {}) => new Promise((resolve10) => {
    const file = resolveExecutable(command, {
      platform,
      path: environment.PATH || environment.Path || "",
      pathExt: environment.PATHEXT,
      exists: existsSync4
    });
    if (!file)
      return resolve10({ code: null, stdout: "", stderr: "", notFound: true, timedOut: false });
    let invocation;
    try {
      invocation = buildInvocation(file, args, platform);
    } catch (error) {
      return resolve10({ code: null, stdout: "", stderr: error.message, notFound: false, timedOut: false });
    }
    const child = spawn(invocation.file, invocation.args, {
      cwd: options.cwd,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      windowsVerbatimArguments: invocation.verbatim
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve10({ code: null, stdout, stderr: stderr || error.message, notFound: false, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve10({ code: timedOut ? null : code, stdout, stderr, notFound: false, timedOut });
    });
  });
}

// lib/tools/local/processes.js
var OUTPUT_LIMIT = 64 * 1024;
var STOP_GRACE_MS = 5e3;
function createStarter(environment = process.env, platform = process.platform) {
  return (command, args, options) => {
    const env = options.env ?? environment;
    const file = resolveExecutable(command, {
      platform,
      path: env.PATH ?? env.Path ?? "",
      pathExt: env.PATHEXT,
      exists: existsSync5
    });
    if (!file)
      return null;
    const invocation = buildInvocation(file, args, platform);
    const child = spawn2(invocation.file, invocation.args, {
      cwd: options.cwd,
      env: { ...env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      windowsVerbatimArguments: invocation.verbatim,
      // A separate process group lets POSIX stop the host together with its worker.
      detached: platform !== "win32"
    });
    let output = "";
    let exit;
    const append = (chunk) => {
      output = (output + chunk.toString("utf-8")).slice(-OUTPUT_LIMIT);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const exited = new Promise((resolve10) => {
      child.on("exit", (code) => {
        exit = code;
        resolve10();
      });
      child.on("error", (error) => {
        output += `
${error.message}`;
        exit = null;
        resolve10();
      });
    });
    const closePipes = () => {
      child.stdout.destroy();
      child.stderr.destroy();
    };
    const process_ = {
      pid: child.pid,
      output: () => output,
      exitCode: () => exit,
      release: () => {
        closePipes();
        child.unref();
      },
      stop: async () => {
        const pid = child.pid;
        if (pid === void 0)
          return;
        if (platform === "win32") {
          if (exit === void 0)
            spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        } else {
          if (signalGroup(pid, "SIGTERM")) {
            await Promise.race([exited, delay(STOP_GRACE_MS)]);
            if (groupAlive(pid)) {
              const deadline = Date.now() + STOP_GRACE_MS;
              while (groupAlive(pid) && Date.now() < deadline)
                await delay(100);
              if (groupAlive(pid))
                signalGroup(pid, "SIGKILL");
            }
          }
        }
        await Promise.race([exited, delay(STOP_GRACE_MS)]);
        closePipes();
      }
    };
    return process_;
  };
}
function delay(milliseconds) {
  return new Promise((resolve10) => {
    setTimeout(resolve10, milliseconds).unref();
  });
}
function signalGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}
function groupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}
var loopbackRequest = (url, options = {}) => new Promise((resolvePromise) => {
  const target = new URL(url);
  if (target.protocol !== "http:") {
    resolvePromise(null);
    return;
  }
  const timeoutMs = options.timeoutMs ?? 1e4;
  let settled = false;
  const resolve10 = (value) => {
    if (settled)
      return;
    settled = true;
    clearTimeout(deadline);
    resolvePromise(value);
  };
  const body2 = options.body;
  const outgoing = request({
    host: target.hostname,
    port: target.port || 80,
    path: `${target.pathname}${target.search}`,
    method: options.method ?? "GET",
    agent: false,
    headers: body2 === void 0 ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(body2) },
    timeout: timeoutMs
  }, (response) => {
    let text = "";
    response.setEncoding("utf-8");
    response.on("data", (chunk) => {
      if (text.length < OUTPUT_LIMIT)
        text += chunk;
    });
    response.on("end", () => {
      const headers = {};
      for (const [name, value] of Object.entries(response.headers)) {
        if (value !== void 0)
          headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
      }
      resolve10({ status: response.statusCode ?? 0, headers, body: text });
    });
    response.on("error", () => resolve10(null));
    response.on("close", () => resolve10(null));
  });
  const deadline = setTimeout(() => {
    outgoing.destroy();
    resolve10(null);
  }, timeoutMs);
  deadline.unref();
  outgoing.on("timeout", () => outgoing.destroy());
  outgoing.on("error", () => resolve10(null));
  if (body2 !== void 0)
    outgoing.write(body2);
  outgoing.end();
});
function portInUse(port) {
  return new Promise((resolve10) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (inUse) => {
      socket.destroy();
      resolve10(inUse);
    };
    socket.setTimeout(1e3, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}
function freePort() {
  return new Promise((resolve10, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => port ? resolve10(port) : reject(new Error("No free port was found")));
    });
  });
}
function localDependencies(base, environment = process.env, platform = process.platform) {
  return {
    ...base,
    start: createStarter(environment, platform),
    http: loopbackRequest,
    portInUse,
    freePort,
    platform,
    env: environment
  };
}

// lib/tools/local/verify.js
import { createHash as createHash3 } from "node:crypto";
import { existsSync as existsSync7, readFileSync as readFileSync4, writeFileSync as writeFileSync3 } from "node:fs";
import { join as join6, resolve as resolve7 } from "node:path";

// lib/tools/local/project.js
import { existsSync as existsSync6, readdirSync as readdirSync2, readFileSync as readFileSync3, statSync as statSync3 } from "node:fs";
import { extname, join as join5, resolve as resolve6 } from "node:path";
var STORAGE_TRIGGERS = /* @__PURE__ */ new Set(["timer", "blob", "queue", "eventhub", "durable"]);
var TRIGGER_PATTERNS = [
  ["http", /@app\.route\(|\.http_trigger\(|\bapp\.(?:http|get|post|put|patch|delete)\(|\[HttpTrigger|@HttpTrigger|"httpTrigger"/],
  ["timer", /timer_trigger\(|\bapp\.schedule\(|\bapp\.timer\(|\[TimerTrigger|@TimerTrigger|"timerTrigger"/],
  ["blob", /blob_trigger\(|\bapp\.storageBlob\(|\[BlobTrigger|@BlobTrigger|"blobTrigger"/],
  ["queue", /queue_trigger\(|\bapp\.storageQueue\(|\[QueueTrigger|@QueueTrigger|"queueTrigger"/],
  ["eventhub", /event_hub_message_trigger\(|\bapp\.eventHub\(|\[EventHubTrigger|@EventHubTrigger|"eventHubTrigger"/],
  ["servicebus", /service_bus_(?:queue|topic)_trigger\(|\bapp\.serviceBus(?:Queue|Topic)\(|\[ServiceBusTrigger|@ServiceBus(?:Queue|Topic)Trigger|"serviceBusTrigger"/],
  ["cosmos", /cosmos_db_trigger\(|\bapp\.cosmosDB\(|\[CosmosDBTrigger|@CosmosDBTrigger|"cosmosDBTrigger"/],
  ["eventgrid", /event_grid_trigger\(|\bapp\.eventGrid\(|\[EventGridTrigger|@EventGridTrigger|"eventGridTrigger"/],
  ["durable", /orchestration_trigger\(|df\.app\.orchestration\(|\[OrchestrationTrigger|"orchestrationTrigger"|DFApp\(/],
  ["sql", /sql_trigger\(|\bapp\.sql\(|\[SqlTrigger|@SqlTrigger|"sqlTrigger"/],
  ["mcp", /mcp_tool_trigger\(|\bapp\.mcpTool\(|\[McpToolTrigger|@McpToolTrigger|"mcpToolTrigger"/]
];
var SOURCE_EXTENSIONS = /* @__PURE__ */ new Set([".py", ".js", ".mjs", ".cjs", ".ts", ".mts", ".cs", ".fs", ".java", ".ps1"]);
var SKIPPED_FOLDERS = /* @__PURE__ */ new Set([
  "node_modules",
  "venv",
  "bin",
  "obj",
  "dist",
  "target",
  "infra",
  "tests",
  "test",
  "__pycache__"
]);
var MAX_DEPTH = 5;
var MAX_FILES = 1e3;
function findFunctionDir(dir) {
  const root = resolve6(dir);
  if (isFile2(join5(root, "host.json")))
    return root;
  for (const service of inspectProject(root).azureYaml?.services ?? []) {
    const candidate = resolve6(root, service.project);
    if (service.host === "function" && isFile2(join5(candidate, "host.json")))
      return candidate;
  }
  const children = readdirSync2(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !isSkipped(entry.name)).map((entry) => join5(root, entry.name)).filter((folder) => isFile2(join5(folder, "host.json")));
  return children.length === 1 ? children[0] : null;
}
function readLocalSettings(functionDir) {
  const path = join5(functionDir, "local.settings.json");
  if (!isFile2(path))
    return { path, exists: false, values: {} };
  try {
    const parsed = JSON.parse(readFileSync3(path, "utf-8"));
    const values = Object.fromEntries(Object.entries(parsed.Values ?? {}).filter((entry) => typeof entry[1] === "string"));
    return { path, exists: true, values };
  } catch {
    return { path, exists: true, values: {} };
  }
}
function detectWorker(functionDir, settings) {
  const runtime = settings.values.FUNCTIONS_WORKER_RUNTIME?.toLowerCase();
  if (runtime?.startsWith("dotnet"))
    return "dotnet";
  if (runtime === "python" || runtime === "node" || runtime === "java" || runtime === "powershell" || runtime === "custom") {
    return runtime;
  }
  const names = readdirSync2(functionDir);
  if (names.some((name) => name === "function_app.py" || name === "requirements.txt"))
    return "python";
  if (names.some((name) => /\.(?:cs|fs)proj$/i.test(name)))
    return "dotnet";
  if (names.some((name) => name === "pom.xml" || name.startsWith("build.gradle")))
    return "java";
  if (names.includes("package.json"))
    return "node";
  if (names.some((name) => name === "profile.ps1" || name === "requirements.psd1"))
    return "powershell";
  return null;
}
function workerRuntimeSetting(worker) {
  return worker === "dotnet" ? "dotnet-isolated" : worker;
}
function scanTriggers(functionDir) {
  const found = /* @__PURE__ */ new Set();
  let budget = MAX_FILES;
  const visit = (folder, depth) => {
    if (depth > MAX_DEPTH)
      return;
    for (const entry of readdirSync2(folder, { withFileTypes: true })) {
      if (budget <= 0)
        return;
      const path = join5(folder, entry.name);
      if (entry.isDirectory()) {
        if (!isSkipped(entry.name))
          visit(path, depth + 1);
        continue;
      }
      if (!SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase()) && entry.name !== "function.json")
        continue;
      budget--;
      const text = readFileSync3(path, "utf-8");
      for (const [kind, pattern] of TRIGGER_PATTERNS)
        if (pattern.test(text))
          found.add(kind);
    }
  };
  visit(functionDir, 0);
  return TRIGGER_PATTERNS.map(([kind]) => kind).filter((kind) => found.has(kind));
}
function storageConnection(values) {
  const value = values.AzureWebJobsStorage;
  if (value && /UseDevelopmentStorage=true|devstoreaccount1|127\.0\.0\.1:1000[0-2]/i.test(value))
    return "development";
  if (value || Object.keys(values).some((key) => key.startsWith("AzureWebJobsStorage__")))
    return "other";
  return "missing";
}
function isSkipped(name) {
  return name.startsWith(".") || SKIPPED_FOLDERS.has(name);
}
function isFile2(path) {
  return existsSync6(path) && statSync3(path).isFile();
}

// lib/tools/local/verify.js
var COMMAND4 = "local verify";
var DEFAULT_PORT = 7071;
var DEFAULT_TIMEOUT_SECONDS = 120;
var AZURITE_TIMEOUT_MS = 6e4;
var POLL_MS = 1e3;
var INDEX_RETRIES = 3;
var INSTALL_TIMEOUT_MS = 9e5;
var BODY_PREVIEW = 500;
var OUTPUT_TAIL_LINES = 40;
var AZURITE_PORTS = { blob: 1e4, queue: 10001, table: 10002 };
var AZURITE_IMAGE = "mcr.microsoft.com/azure-storage/azurite";
var Stop = class extends Error {
  exitCode;
  summary;
  constructor(exitCode, summary) {
    super(summary);
    this.exitCode = exitCode;
    this.summary = summary;
  }
};
async function verifyLocal(options, deps) {
  const root = resolve7(options.dir);
  const functionDir = existsSync7(root) ? findFunctionDir(root) : null;
  if (!functionDir) {
    return fail(COMMAND4, EXIT.blocked, "No Azure Functions project was found", {
      findings: [{
        id: "NO-FUNCTIONS-PROJECT",
        severity: "error",
        title: `No host.json in ${root} or its function service folder`,
        fix: "Pass --dir with the folder that contains host.json, or create the project with template write."
      }]
    });
  }
  const settings = readLocalSettings(functionDir);
  const worker = detectWorker(functionDir, settings);
  const triggers = scanTriggers(functionDir);
  const context = {
    options,
    deps,
    root,
    functionDir,
    data: {
      functionDir,
      worker,
      triggers,
      settings: { path: settings.path, created: false },
      storage: { connection: "missing", need: "none", azurite: "not-needed" },
      install: { skipped: false, steps: [] },
      host: null,
      functions: [],
      invocation: null,
      cleanup: { host: "not-started", azurite: "not-started" }
    },
    findings: [],
    gaps: [],
    azurite: null,
    host: null,
    index: []
  };
  try {
    if (!worker || worker === "java" || worker === "custom")
      throw unsupportedWorker(context, worker);
    const values = ensureSettings(context, worker, settings);
    await prepareStorage(context, values);
    await checkCoreTools(context);
    const env = await installDependencies(context, worker);
    const port = await choosePort(context);
    await startHost(context, port, env);
    await readFunctionIndex(context, port);
    await invokeHttp(context, port);
  } catch (error) {
    await cleanUp(context);
    if (error instanceof Stop) {
      return fail(COMMAND4, error.exitCode, error.summary, { data: context.data, findings: context.findings, gaps: context.gaps });
    }
    throw error;
  }
  await cleanUp(context);
  const invoked = context.data.invocation;
  const summary = invoked ? `The host ran ${context.data.functions.length} function(s); ${invoked.method} ${invoked.function} returned ${invoked.status}` : `The host ran ${context.data.functions.length} function(s)`;
  return succeed(COMMAND4, summary, context.data, {
    findings: context.findings,
    gaps: context.gaps,
    next: { action: "deploy", reason: "The app starts and indexes its functions locally.", command: `deploy plan --dir "${root}"` }
  });
}
function unsupportedWorker(context, worker) {
  context.findings.push(worker === "java" ? {
    id: "LOCAL-WORKER-UNSUPPORTED",
    severity: "error",
    title: "Java apps are not run by this command",
    fix: "Run `mvn clean package`, then `mvn azure-functions:run` (or `func start` in the staging folder under target/azure-functions)."
  } : {
    id: "LOCAL-WORKER-UNSUPPORTED",
    severity: "error",
    title: worker ? `The ${worker} worker is not run by this command` : "The worker runtime could not be detected",
    fix: "Set FUNCTIONS_WORKER_RUNTIME in local.settings.json, or run `func start` manually."
  });
  return new Stop(EXIT.blocked, "This app cannot be verified by local verify");
}
function ensureSettings(context, worker, settings) {
  if (settings.exists) {
    if (!settings.values.FUNCTIONS_WORKER_RUNTIME) {
      context.findings.push({
        id: "SETTINGS-NO-WORKER",
        severity: "warn",
        title: "local.settings.json has no FUNCTIONS_WORKER_RUNTIME",
        fix: `Add "FUNCTIONS_WORKER_RUNTIME": "${workerRuntimeSetting(worker)}" under Values.`
      });
    }
    return settings.values;
  }
  const values = { FUNCTIONS_WORKER_RUNTIME: workerRuntimeSetting(worker), AzureWebJobsStorage: "UseDevelopmentStorage=true" };
  writeFileSync3(settings.path, `${JSON.stringify({ IsEncrypted: false, Values: values }, null, 2)}
`);
  context.data.settings.created = true;
  return values;
}
async function prepareStorage(context, values) {
  const { data, options } = context;
  const connection = storageConnection(values);
  const need = data.triggers.some((kind) => STORAGE_TRIGGERS.has(kind)) ? "required" : "optional";
  data.storage.connection = connection;
  data.storage.need = need;
  if (connection === "missing") {
    if (need === "required") {
      context.findings.push({
        id: "STORAGE-NOT-CONFIGURED",
        severity: "error",
        title: `AzureWebJobsStorage is empty, but ${data.triggers.filter((kind) => STORAGE_TRIGGERS.has(kind)).join(", ")} triggers need storage`,
        fix: 'Set "AzureWebJobsStorage": "UseDevelopmentStorage=true" in local.settings.json and use Azurite.'
      });
      throw new Stop(EXIT.blocked, "Local storage is not configured");
    }
    return;
  }
  if (connection === "other")
    return;
  const required2 = azuriteServices(data.triggers);
  const probe = await probeAzurite(context.deps, required2);
  data.storage.azurite = probe.state;
  if (probe.state === "conflict") {
    context.findings.push({
      id: "AZURITE-PORT-CONFLICT",
      severity: need === "required" ? "error" : "warn",
      title: "Another program answers on an Azurite port (10000-10002)",
      detail: `Ports: ${probe.foreign.map((service) => AZURITE_PORTS[service]).join(", ")}`,
      fix: "Stop that program, or point AzureWebJobsStorage at a running Azurite instance."
    });
    if (need === "required")
      throw new Stop(EXIT.blocked, "Azurite ports are used by another program");
    return;
  }
  if (probe.state === "incomplete") {
    context.findings.push({
      id: "AZURITE-INCOMPLETE",
      severity: need === "required" ? "error" : "warn",
      title: `Azurite is running without the ${probe.missing.join(", ")} service`,
      detail: `This app needs ${required2.join(", ")}. Missing ports: ${probe.missing.map((service) => AZURITE_PORTS[service]).join(", ")}`,
      fix: "Restart Azurite with all services (the `azurite` command, not `azurite-blob` alone), then run this command again."
    });
    if (need === "required")
      throw new Stop(EXIT.blocked, "Azurite is missing a required service");
    return;
  }
  if (probe.state === "running")
    return;
  if (options.startAzurite) {
    await startAzurite(context, required2);
    data.storage.azurite = "started";
    return;
  }
  if (need === "required") {
    context.findings.push({
      id: "AZURITE-NOT-RUNNING",
      severity: "error",
      title: "The app uses development storage, and Azurite is not running",
      fix: "Run this command again with --start-azurite, or start Azurite yourself."
    });
    throw new Stop(EXIT.blocked, "Azurite is not running");
  }
  context.findings.push({
    id: "AZURITE-NOT-RUNNING",
    severity: "info",
    title: "Azurite is not running. HTTP functions run without it; add --start-azurite to start it."
  });
}
function azuriteServices(triggers) {
  const services = /* @__PURE__ */ new Set(["blob"]);
  if (triggers.some((kind) => kind === "queue" || kind === "blob" || kind === "durable"))
    services.add("queue");
  if (triggers.includes("durable"))
    services.add("table");
  return [...services];
}
async function probeAzurite(deps, required2) {
  const services = Object.keys(AZURITE_PORTS);
  const responses = await Promise.all(services.map((service) => deps.http(`http://127.0.0.1:${AZURITE_PORTS[service]}/`, { timeoutMs: 2e3 })));
  const answer = new Map(services.map((service, index) => [service, responses[index]]));
  const foreign = services.filter((service) => {
    const response = answer.get(service);
    return response !== null && response !== void 0 && !/azurite/i.test(response.headers.server ?? "");
  });
  const missing = required2.filter((service) => !answer.get(service));
  if (foreign.length > 0)
    return { state: "conflict", missing, foreign };
  if (missing.length === 0)
    return { state: "running", missing, foreign };
  if (responses.every((response) => !response))
    return { state: "not-running", missing, foreign };
  return { state: "incomplete", missing, foreign };
}
async function startAzurite(context, required2) {
  const { deps, root } = context;
  const location = join6(toolDir(root), "azurite");
  ensureToolDir(root, "azurite");
  const process2 = deps.start("azurite", ["--silent", "--skipApiVersionCheck", "--location", location], { cwd: root });
  if (process2) {
    context.azurite = {
      stop: () => process2.stop(),
      release: () => process2.release(),
      description: `azurite (pid ${process2.pid ?? "unknown"})`
    };
  } else {
    const ports = Object.values(AZURITE_PORTS).flatMap((port) => ["-p", `127.0.0.1:${port}:${port}`]);
    const run = await deps.run("docker", ["run", "-d", "--rm", ...ports, AZURITE_IMAGE], { timeoutMs: INSTALL_TIMEOUT_MS });
    const containerId = run.stdout.trim().split(/\s+/).pop() ?? "";
    if (run.notFound || run.code !== 0 || !containerId) {
      context.findings.push({
        id: "AZURITE-UNAVAILABLE",
        severity: "error",
        title: "Azurite could not be started",
        detail: run.notFound ? "Neither the azurite command nor docker is on PATH." : redact(tail2(run.stderr || run.stdout)),
        fix: "Install Azurite with `npm install -g azurite`, or start Docker Desktop, then run this command again."
      });
      throw new Stop(EXIT.blocked, "Azurite could not be started");
    }
    context.azurite = {
      stop: async () => {
        await deps.run("docker", ["stop", containerId], { timeoutMs: 6e4 });
      },
      release: () => void 0,
      description: `docker container ${containerId.slice(0, 12)}`
    };
  }
  const deadline = deps.now().getTime() + AZURITE_TIMEOUT_MS;
  while (deps.now().getTime() < deadline) {
    if (process2 && process2.exitCode() !== void 0)
      break;
    if ((await probeAzurite(deps, required2)).state === "running")
      return;
    await deps.sleep(500);
  }
  context.findings.push({
    id: "AZURITE-NOT-READY",
    severity: "error",
    title: `Azurite did not start answering for ${required2.join(", ")}`,
    detail: process2 ? redact(tail2(process2.output())) : void 0,
    fix: "Start Azurite manually and check its output."
  });
  throw new Stop(EXIT.stepFailed, "Azurite did not become ready");
}
async function checkCoreTools(context) {
  const version = await context.deps.run("func", ["--version"], { timeoutMs: 3e4 });
  if (version.notFound)
    throw funcNotFound(context);
}
function funcNotFound(context) {
  context.findings.push({
    id: "FUNC-NOT-FOUND",
    severity: "error",
    title: "Azure Functions Core Tools (func) is not on PATH",
    fix: "Install Core Tools v4: https://learn.microsoft.com/azure/azure-functions/functions-run-local#install-the-azure-functions-core-tools"
  });
  return new Stop(EXIT.blocked, "Azure Functions Core Tools is missing");
}
async function installDependencies(context, worker) {
  if (worker === "python")
    return installPython(context);
  if (worker === "node")
    await installNode(context);
  else
    context.data.install.skipped = true;
  return void 0;
}
async function installPython(context) {
  const { deps, functionDir, data, options } = context;
  const scripts = deps.platform === "win32" ? "Scripts" : "bin";
  const venv = join6(functionDir, ".venv");
  const binDir = join6(venv, scripts);
  const python = join6(binDir, deps.platform === "win32" ? "python.exe" : "python");
  const requirements = join6(functionDir, "requirements.txt");
  const hash = existsSync7(requirements) ? hashFiles([requirements]) : null;
  const venvExists = existsSync7(python);
  if (options.noInstall || venvExists && (hash === null || readMarker(context, "python") === hash)) {
    data.install.skipped = true;
  } else {
    const uv = await deps.run("uv", ["--version"], { timeoutMs: 3e4 });
    const useUv = !uv.notFound && uv.code === 0;
    if (!venvExists) {
      if (useUv)
        await step(context, "uv", ["venv", ".venv"]);
      else
        await step(context, await basePython(context), ["-m", "venv", ".venv"]);
    }
    if (hash !== null) {
      if (useUv)
        await step(context, "uv", ["pip", "install", "-r", "requirements.txt", "--python", python]);
      else
        await step(context, python, ["-m", "pip", "install", "-r", "requirements.txt"]);
      writeMarker(context, "python", hash);
    }
  }
  if (!existsSync7(binDir) && data.install.skipped && !venvExists)
    return void 0;
  return withPath(deps, binDir, { VIRTUAL_ENV: venv, languageWorkers__python__defaultExecutablePath: python });
}
async function basePython(context) {
  const candidates = context.deps.platform === "win32" ? ["python", "py"] : ["python3", "python"];
  for (const candidate of candidates) {
    const version = await context.deps.run(candidate, ["--version"], { timeoutMs: 3e4 });
    if (!version.notFound && version.code === 0)
      return candidate;
  }
  context.findings.push({
    id: "PYTHON-NOT-FOUND",
    severity: "error",
    title: "Python is not on PATH",
    fix: "Install a Python version that Azure Functions supports (3.10 to 3.13), or install uv."
  });
  throw new Stop(EXIT.blocked, "Python is missing");
}
async function installNode(context) {
  const { functionDir, data, options } = context;
  const packageJsonPath = join6(functionDir, "package.json");
  if (!existsSync7(packageJsonPath)) {
    data.install.skipped = true;
    return;
  }
  const hash = hashFiles([packageJsonPath, join6(functionDir, "package-lock.json")]);
  const installed = existsSync7(join6(functionDir, "node_modules")) && readMarker(context, "node") === hash;
  if (options.noInstall) {
    data.install.skipped = true;
    return;
  }
  if (installed)
    data.install.skipped = true;
  else {
    await step(context, "npm", ["install"]);
    writeMarker(context, "node", hash);
  }
  const packageJson = JSON.parse(readFileSync4(packageJsonPath, "utf-8"));
  if (typeof packageJson.scripts?.build === "string")
    await step(context, "npm", ["run", "build"]);
}
async function step(context, command, args) {
  const line = [command, ...args].join(" ");
  context.data.install.steps.push(line);
  const outcome = await context.deps.run(command, args, { cwd: context.functionDir, timeoutMs: INSTALL_TIMEOUT_MS });
  if (outcome.code === 0)
    return;
  context.findings.push({
    id: "INSTALL-FAILED",
    severity: "error",
    title: `\`${line}\` failed`,
    detail: outcome.notFound ? `${command} is not on PATH.` : redact(tail2(outcome.stderr || outcome.stdout)),
    fix: "Fix the dependency problem, then run local verify again."
  });
  throw new Stop(EXIT.stepFailed, "Installing dependencies failed");
}
async function choosePort(context) {
  const { deps, options } = context;
  if (options.port !== void 0) {
    if (!await deps.portInUse(options.port))
      return options.port;
    context.findings.push({
      id: "PORT-IN-USE",
      severity: "error",
      title: `Port ${options.port} is already in use`,
      fix: "Stop the program that uses the port, or omit --port to use a free port."
    });
    throw new Stop(EXIT.blocked, `Port ${options.port} is in use`);
  }
  return await deps.portInUse(DEFAULT_PORT) ? deps.freePort() : DEFAULT_PORT;
}
async function startHost(context, port, env) {
  const { deps, functionDir, options, data } = context;
  const host = deps.start("func", ["start", "--port", String(port)], { cwd: functionDir, ...env ? { env } : {} });
  if (!host)
    throw funcNotFound(context);
  context.host = host;
  data.host = { port, state: "Starting", readyMs: null };
  const started = deps.now().getTime();
  const deadline = started + (options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1e3;
  while (deps.now().getTime() < deadline) {
    if (host.exitCode() !== void 0) {
      data.host.state = "Exited";
      context.findings.push({
        id: "HOST-EXITED",
        severity: "error",
        title: `func start exited with code ${host.exitCode() ?? "unknown"} before it was ready`,
        detail: redact(tail2(host.output())),
        fix: "Read the host output in detail. Fix the error, then run local verify again."
      });
      throw new Stop(EXIT.stepFailed, "The Functions host stopped during startup");
    }
    const status = await deps.http(`http://127.0.0.1:${port}/admin/host/status`, { timeoutMs: 5e3 });
    const state = status?.status === 200 ? hostState(status.body) : null;
    if (state)
      data.host.state = state;
    if (state === "Running") {
      data.host.readyMs = deps.now().getTime() - started;
      return;
    }
    await deps.sleep(POLL_MS);
  }
  context.findings.push({
    id: "HOST-NOT-READY",
    severity: "error",
    title: `The host did not report Running within ${options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS} seconds (last state: ${data.host.state})`,
    detail: redact(tail2(host.output())),
    fix: "Read the host output. If a proxy is configured, add localhost and 127.0.0.1 to NO_PROXY."
  });
  throw new Stop(EXIT.stepFailed, "The Functions host did not become ready");
}
function hostState(body2) {
  try {
    const parsed = JSON.parse(body2);
    return typeof parsed.state === "string" ? parsed.state : null;
  } catch {
    return null;
  }
}
async function readFunctionIndex(context, port) {
  const { deps } = context;
  let functions = [];
  for (let attempt = 0; attempt < INDEX_RETRIES && functions.length === 0; attempt++) {
    if (attempt > 0)
      await deps.sleep(POLL_MS);
    const response = await deps.http(`http://127.0.0.1:${port}/admin/functions`, { timeoutMs: 1e4 });
    functions = response?.status === 200 ? parseFunctions(response.body) : [];
  }
  context.index = functions;
  context.data.functions = functions.map((fn) => ({ name: String(fn.name), trigger: triggerType(fn) }));
  if (functions.length > 0)
    return;
  context.findings.push({
    id: "NO-FUNCTIONS-INDEXED",
    severity: "error",
    title: "The host is running but found no functions",
    detail: redact(tail2(context.host?.output() ?? "")),
    fix: "Check that the function code is registered (decorators, app.* calls, or attributes) and that the build output is current."
  });
  throw new Stop(EXIT.stepFailed, "No functions were indexed");
}
function parseFunctions(body2) {
  try {
    const parsed = JSON.parse(body2);
    return Array.isArray(parsed) ? parsed.filter((fn) => typeof fn?.name === "string") : [];
  } catch {
    return [];
  }
}
function triggerType(fn) {
  const binding = fn.config?.bindings?.find((item) => typeof item.type === "string" && /trigger$/i.test(item.type));
  return typeof binding?.type === "string" ? binding.type : "unknown";
}
async function invokeHttp(context, port) {
  const { deps, options, data } = context;
  const functions = context.index.filter((fn) => /^httptrigger$/i.test(triggerType(fn)));
  const methodsOf = (fn) => {
    const methods = fn.config?.bindings?.find((item) => /^httptrigger$/i.test(String(item.type)))?.methods;
    return Array.isArray(methods) ? methods.map((method2) => String(method2).toLowerCase()) : [];
  };
  const callable = (fn) => typeof fn.invoke_url_template === "string" && !fn.invoke_url_template.includes("{");
  const methodOf = (fn) => {
    const methods = methodsOf(fn);
    if (methods.length === 0 || methods.includes("get"))
      return "GET";
    return methods.includes("post") ? "POST" : null;
  };
  let target;
  if (options.invoke) {
    target = functions.find((fn) => fn.name === options.invoke);
    if (!target) {
      context.findings.push({
        id: "INVOKE-NOT-FOUND",
        severity: "warn",
        title: `No HTTP function named ${options.invoke} was indexed`,
        detail: `HTTP functions: ${functions.map((fn) => String(fn.name)).join(", ") || "none"}`
      });
      return;
    }
    if (!callable(target)) {
      context.gaps.push({ check: `invoke ${options.invoke}`, reason: "The route has parameters. Request it manually with real values." });
      return;
    }
  } else {
    const candidates = functions.filter(callable);
    target = candidates.find((fn) => methodOf(fn) === "GET") ?? candidates.find((fn) => methodOf(fn) === "POST");
    if (!target) {
      if (candidates.length > 0) {
        context.gaps.push({ check: "invoke", reason: "No HTTP function accepts GET or POST. Request one manually." });
      } else if (functions.length > 0) {
        context.gaps.push({ check: "invoke", reason: "Every HTTP function has route parameters. Request one manually." });
      }
      return;
    }
  }
  const method = methodOf(target);
  if (!method) {
    context.gaps.push({
      check: `invoke ${String(target.name)}`,
      reason: `The function accepts only ${methodsOf(target).join(", ").toUpperCase()}. Request it manually.`
    });
    return;
  }
  const url = String(target.invoke_url_template).replace(/^https?:\/\/[^/]+/i, `http://127.0.0.1:${port}`);
  const response = await deps.http(url, { method, timeoutMs: 3e4, ...method === "POST" ? { body: "{}" } : {} });
  data.invocation = {
    function: String(target.name),
    method,
    url,
    status: response?.status ?? null,
    body: redact((response?.body ?? "").slice(0, BODY_PREVIEW))
  };
  if (!response || response.status >= 500) {
    context.findings.push({
      id: "INVOKE-FAILED",
      severity: "error",
      title: response ? `${method} ${target.name} returned ${response.status}` : `${method} ${target.name} got no response`,
      detail: redact(tail2(context.host?.output() ?? "")),
      fix: "Read the host output for the exception, fix the function, and run local verify again."
    });
    throw new Stop(EXIT.stepFailed, "The HTTP function failed");
  }
  if (response.status >= 400) {
    context.findings.push({
      id: "INVOKE-CLIENT-ERROR",
      severity: "warn",
      title: `${method} ${target.name} returned ${response.status}`,
      detail: "The function may need a query string or a request body."
    });
  }
}
async function cleanUp(context) {
  const { data } = context;
  if (context.host) {
    await context.host.stop();
    data.cleanup.host = "stopped";
    context.host = null;
  }
  if (context.azurite) {
    if (context.options.keepAzurite) {
      context.azurite.release();
      data.cleanup.azurite = "kept";
      context.findings.push({ id: "AZURITE-KEPT", severity: "info", title: `Azurite is still running: ${context.azurite.description}` });
    } else {
      await context.azurite.stop();
      data.cleanup.azurite = "stopped";
    }
    context.azurite = null;
  }
}
function withPath(deps, directory, extra) {
  const env = { ...deps.env };
  const key = Object.keys(env).find((name) => name.toUpperCase() === "PATH") ?? "PATH";
  const separator = deps.platform === "win32" ? ";" : ":";
  env[key] = env[key] ? `${directory}${separator}${env[key]}` : directory;
  return { ...env, ...extra };
}
function hashFiles(paths) {
  const hash = createHash3("sha256");
  for (const path of paths) {
    hash.update(path);
    hash.update("\0");
    if (existsSync7(path))
      hash.update(readFileSync4(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}
function markerPath(root) {
  return join6(toolDir(root), "local-install.json");
}
function readMarkers(root) {
  try {
    return JSON.parse(readFileSync4(markerPath(root), "utf-8"));
  } catch {
    return {};
  }
}
function readMarker(context, worker) {
  return readMarkers(context.root)[context.functionDir]?.[worker];
}
function writeMarker(context, worker, hash) {
  ensureToolDir(context.root);
  const markers = readMarkers(context.root);
  markers[context.functionDir] = { ...markers[context.functionDir], [worker]: hash };
  writeFileSync3(markerPath(context.root), `${JSON.stringify(markers, null, 2)}
`);
}
function tail2(text) {
  return text.split(/\r?\n/).filter((line) => line.trim()).slice(-OUTPUT_TAIL_LINES).join("\n");
}

// lib/templates/index.js
import { execFileSync } from "node:child_process";
import { existsSync as existsSync8, lstatSync, mkdirSync as mkdirSync3, readFileSync as readFileSync5, readdirSync as readdirSync3, realpathSync, writeFileSync as writeFileSync4 } from "node:fs";
import { dirname as dirname2, isAbsolute, join as join7, relative, resolve as resolve8 } from "node:path";
import { fileURLToPath } from "node:url";
var DEFAULT_TEMPLATE_MANIFEST_URL = "https://cdn.functions.azure.com/public/templates-manifest/manifest.json";
var TemplateError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "TemplateError";
  }
};
var ADD_MODE_PROJECT_PATHS = /* @__PURE__ */ new Set([
  ".gitignore",
  "azure.yaml",
  "host.json",
  "local.settings.json",
  "package-lock.json",
  "package.json",
  "pom.xml",
  "requirements.txt",
  "tsconfig.json"
]);
var ADD_MODE_PROJECT_PREFIXES = [
  ".devcontainer/",
  ".github/",
  ".vscode/",
  "infra/"
];
var DOWNLOAD_CONCURRENCY = 8;
var githubCliTokenWarningShown = false;
var githubCliToken = null;
async function listFunctionTemplates(options = {}) {
  const manifestUrl = options.manifestUrl ?? DEFAULT_TEMPLATE_MANIFEST_URL;
  const manifest = options.manifest ?? await loadTemplateManifest(manifestUrl);
  const templates = manifest.templates.filter((template) => matchesFilter(template.language, options.language)).filter((template) => matchesFilter(template.resource, options.resource)).filter((template) => matchesFilter(template.iac, options.iac)).slice().sort(compareTemplates);
  return { manifestUrl, templates };
}
async function applyFunctionTemplate(targetDir, options) {
  const manifestUrl = options.manifestUrl ?? DEFAULT_TEMPLATE_MANIFEST_URL;
  const manifest = options.manifest ?? await loadTemplateManifest(manifestUrl);
  const template = findTemplate(manifest, options.template, options.language);
  const mode = resolveApplyMode(targetDir, options.mode ?? "auto");
  const downloadedFiles = await downloadTemplateFiles(template, manifestUrl);
  const runtimeVersion = options.runtimeVersion ?? manifest.runtimeVersions?.[template.language]?.default;
  const templateFiles = downloadedFiles.map((file) => ({
    relativePath: normalizeTemplatePath(file.relativePath),
    content: applyRuntimePlaceholders(file.content, runtimeVersion)
  }));
  if (mode === "add")
    assertAddModeSafe(template, templateFiles);
  const plannedFiles = templateFiles.map((file) => file.relativePath).sort();
  const filesWritten = [];
  const skippedFiles = [];
  const candidates = templateFiles.filter((file) => {
    if (!shouldSkipFile(file.relativePath, mode, options.force === true))
      return true;
    skippedFiles.push(file.relativePath);
    return false;
  });
  const destinations = new Map(candidates.map((file) => [file, resolveInsideTarget(targetDir, file.relativePath)]));
  for (const file of candidates) {
    const destination = destinations.get(file);
    if (existsSync8(destination) && options.force !== true) {
      skippedFiles.push(file.relativePath);
      continue;
    }
    if (!options.dryRun) {
      mkdirSync3(dirname2(destination), { recursive: true });
      writeFileSync4(destination, file.content);
    }
    filesWritten.push(file.relativePath);
  }
  return {
    template,
    mode,
    dryRun: options.dryRun === true,
    filesWritten: filesWritten.sort(),
    skippedFiles: skippedFiles.sort(),
    plannedFiles
  };
}
function resolveInsideTarget(targetDir, relativePath) {
  const destination = join7(targetDir, normalizeTemplatePath(relativePath));
  if (!existsSync8(targetDir))
    return destination;
  const root = realpathSync(targetDir);
  let ancestor = dirname2(destination);
  while (!existsSync8(ancestor))
    ancestor = dirname2(ancestor);
  const inside = relative(root, realpathSync(ancestor));
  const isLink = existsSync8(destination) && lstatSync(destination).isSymbolicLink();
  if (inside.startsWith("..") || isAbsolute(inside) || isLink) {
    throw new TemplateError("unsafe-path", `Template file would be written outside the target folder: ${relativePath}`);
  }
  return destination;
}
async function loadTemplateManifest(manifestUrl) {
  const parsed = new URL(manifestUrl);
  const raw = parsed.protocol === "file:" ? readFileSync5(fileURLToPath(parsed), "utf-8") : await fetchText(manifestUrl);
  const parsedJson = JSON.parse(raw);
  if (!isTemplateManifest(parsedJson)) {
    throw new TemplateError("invalid-manifest", `Template manifest at ${manifestUrl} does not match the expected schema.`);
  }
  return parsedJson;
}
async function downloadTemplateFiles(template, manifestUrl) {
  const repositoryUrl = new URL(template.repositoryUrl);
  if (repositoryUrl.protocol === "file:") {
    if (new URL(manifestUrl).protocol !== "file:") {
      throw new TemplateError("unsupported-source", "Local file template repositories are only supported with local file manifests.");
    }
    return readLocalTemplateFiles(fileURLToPath(repositoryUrl), template.folderPath);
  }
  const repo = parseGitHubRepo(repositoryUrl);
  if (!repo) {
    throw new TemplateError("unsupported-source", `Unsupported template repository URL: ${template.repositoryUrl}`);
  }
  return downloadGitHubTemplateFiles(repo, template.folderPath, normalizeGitHubRef(template.gitRef ?? "main"));
}
function readLocalTemplateFiles(sourceDir, folderPath) {
  assertSafeFolderPath(folderPath);
  const sourceRoot = resolve8(sourceDir);
  const rootDir = folderPath === "." ? sourceRoot : resolve8(sourceRoot, folderPath);
  assertPathInside(sourceRoot, rootDir, "Template folder");
  if (!existsSync8(rootDir)) {
    throw new Error(`Template folder does not exist: ${rootDir}`);
  }
  const files = [];
  collectLocalFiles(rootDir, rootDir, files);
  return files;
}
function collectLocalFiles(rootDir, currentDir, files) {
  const entries = readdirSync3(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join7(currentDir, entry.name);
    if (entry.isDirectory()) {
      collectLocalFiles(rootDir, entryPath, files);
    } else if (entry.isFile()) {
      files.push({
        relativePath: relative(rootDir, entryPath),
        content: readFileSync5(entryPath)
      });
    }
  }
}
async function downloadGitHubTemplateFiles(repo, folderPath, ref) {
  assertSafeFolderPath(folderPath);
  const rootPath = folderPath === "." ? "" : folderPath.replace(/^\/+|\/+$/g, "");
  const entries = await listGitHubContents(repo, rootPath, ref);
  return mapLimit(entries, DOWNLOAD_CONCURRENCY, async (entry) => {
    if (!entry.download_url) {
      throw new Error(`GitHub file entry is missing download URL: ${entry.path}`);
    }
    return {
      relativePath: rootPath ? entry.path.slice(rootPath.length + 1) : entry.path,
      content: await fetchBuffer(entry.download_url)
    };
  });
}
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(lanes);
  return results;
}
async function listGitHubContents(repo, path, ref) {
  const encodedPath = path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  const url = new URL(`https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${encodedPath}`);
  url.searchParams.set("ref", ref);
  const entries = await fetchGitHubJson(url.toString());
  if (!Array.isArray(entries)) {
    throw new Error(`GitHub contents path is not a directory: ${path || "."}`);
  }
  const valid = entries.filter(isGitHubContentEntry);
  const nested = await Promise.all(valid.map((entry) => entry.type === "file" ? Promise.resolve([entry]) : listGitHubContents(repo, entry.path, ref)));
  return nested.flat();
}
function parseGitHubRepo(url) {
  if (url.hostname.toLowerCase() !== "github.com")
    return null;
  const [owner, repoName] = url.pathname.replace(/^\/+/, "").split("/");
  if (!owner || !repoName)
    return null;
  return { owner, repo: repoName.replace(/\.git$/i, "") };
}
function normalizeGitHubRef(ref) {
  return ref.replace(/^refs\/heads\//, "").replace(/^refs\/tags\//, "");
}
function assertSafeFolderPath(folderPath) {
  if (isAbsolute(folderPath) || folderPath.split(/[\\/]/).includes("..")) {
    throw new TemplateError("unsafe-path", `Unsafe template folder path: ${folderPath}`);
  }
}
function assertPathInside(root, candidate, label) {
  const relativePath = relative(root, candidate);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new TemplateError("unsafe-path", `${label} must stay inside the template repository.`);
  }
}
function assertAddModeSafe(template, files) {
  const nestedProjectFile = files.find((file) => {
    const normalized = normalizeTemplatePath(file.relativePath);
    return normalized.includes("/") && ADD_MODE_PROJECT_PATHS.has(normalized.split("/").at(-1) ?? "");
  });
  if (nestedProjectFile) {
    throw new TemplateError("needs-new-mode", `Template '${template.id}' appears to contain a nested full project (${nestedProjectFile.relativePath}). Apply it with --mode new, or choose an add-specific template.`);
  }
}
function findTemplate(manifest, templateId, language) {
  const templates = manifest.templates.filter((candidate) => equalsIgnoreCase(candidate.id, templateId));
  if (templates.length === 0) {
    throw new TemplateError("not-found", `Template '${templateId}' was not found in the manifest.`);
  }
  if (language) {
    const template = templates.find((candidate) => equalsIgnoreCase(candidate.language, language));
    if (!template) {
      throw new TemplateError("not-found", `Template '${templateId}' was found, but not for language '${language}'.`);
    }
    return template;
  }
  if (templates.length > 1) {
    const languages = templates.map((template) => template.language).sort().join(", ");
    throw new TemplateError("not-found", `Template '${templateId}' matches multiple languages (${languages}); pass --language to disambiguate.`);
  }
  return templates[0];
}
function resolveApplyMode(targetDir, mode) {
  if (mode === "new" || mode === "add")
    return mode;
  return existsSync8(join7(targetDir, "host.json")) ? "add" : "new";
}
function shouldSkipFile(relativePath, mode, force) {
  if (mode === "new")
    return false;
  if (force)
    return false;
  const normalized = normalizeTemplatePath(relativePath);
  if (ADD_MODE_PROJECT_PATHS.has(normalized))
    return true;
  return ADD_MODE_PROJECT_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}
function normalizeTemplatePath(path) {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").includes("..") || /^[A-Za-z]:/.test(normalized)) {
    throw new TemplateError("unsafe-path", `Unsafe template file path: ${path}`);
  }
  return normalized;
}
function applyRuntimePlaceholders(content, runtimeVersion) {
  if (!runtimeVersion || !isTextContent(content))
    return content;
  const replaced = content.toString("utf-8").replaceAll("{{nodeVersion}}", runtimeVersion).replaceAll("{{javaVersion}}", runtimeVersion).replaceAll("{{pythonVersion}}", runtimeVersion).replaceAll("{{runtimeVersion}}", runtimeVersion);
  return Buffer.from(replaced, "utf-8");
}
function isTextContent(content) {
  return !content.includes(0);
}
function matchesFilter(actual, expected) {
  return !expected || equalsIgnoreCase(actual, expected);
}
function equalsIgnoreCase(actual, expected) {
  return Boolean(actual && expected && actual.toLowerCase() === expected.toLowerCase());
}
function compareTemplates(left, right) {
  const priority = (left.priority ?? Number.MAX_SAFE_INTEGER) - (right.priority ?? Number.MAX_SAFE_INTEGER);
  if (priority !== 0)
    return priority;
  return left.id.localeCompare(right.id);
}
async function fetchText(url) {
  const { text } = await fetchTextResponse(url);
  return text;
}
async function fetchBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new TemplateError("fetch-failed", `Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
async function fetchGitHubJson(url) {
  const result = await fetchTextResponse(url, githubHeaders());
  if (result.response.ok) {
    return JSON.parse(result.text);
  }
  const token = resolveGitHubToken();
  if (!token || !isGitHubAuthRetryable(result.response)) {
    throw new TemplateError("fetch-failed", buildFetchErrorMessage(url, result, { includeGitHubTokenHint: true }));
  }
  const retryResult = await fetchTextResponse(url, githubHeaders(token));
  if (!retryResult.response.ok) {
    throw new TemplateError("fetch-failed", buildFetchErrorMessage(url, retryResult));
  }
  return JSON.parse(retryResult.text);
}
async function fetchTextResponse(url, headers) {
  const response = await fetch(url, headers ? { headers } : void 0);
  const text = await response.text();
  if (!response.ok && !headers) {
    throw new TemplateError("fetch-failed", buildFetchErrorMessage(url, { text, response }));
  }
  return { text, response };
}
function githubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "azure-functions-skills",
    ...token ? { Authorization: `Bearer ${token}` } : {}
  };
}
function resolveGitHubToken(env = process.env) {
  return env.GH_TOKEN || env.GITHUB_TOKEN || resolveGitHubCliToken();
}
function resolveGitHubCliToken() {
  if (githubCliToken !== null)
    return githubCliToken;
  if (!githubCliTokenWarningShown) {
    process.stderr.write("GitHub API rate limit or private repository access requires authentication. Trying `gh auth token`...\n");
    githubCliTokenWarningShown = true;
  }
  try {
    const token = execFileSync("gh", ["auth", "token"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    githubCliToken = token || void 0;
  } catch (_err) {
    githubCliToken = void 0;
  }
  return githubCliToken;
}
function isGitHubAuthRetryable(response) {
  return response.status === 401 || response.status === 404 || response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0";
}
function buildFetchErrorMessage(url, result, options = {}) {
  const suffix = options.includeGitHubTokenHint && isGitHubAuthRetryable(result.response) ? " Set GH_TOKEN or GITHUB_TOKEN, or run gh auth login, to retry GitHub API requests authenticated." : "";
  return `Failed to fetch ${url}: ${result.response.status} ${result.response.statusText}.${suffix}`;
}
function isTemplateManifest(value) {
  return isRecord(value) && Array.isArray(value.templates) && value.templates.every(isFunctionTemplate);
}
function isFunctionTemplate(value) {
  return isRecord(value) && typeof value.id === "string" && typeof value.displayName === "string" && typeof value.shortDescription === "string" && typeof value.language === "string" && typeof value.repositoryUrl === "string" && typeof value.folderPath === "string";
}
function isGitHubContentEntry(value) {
  return isRecord(value) && (value.type === "file" || value.type === "dir") && typeof value.path === "string" && (typeof value.download_url === "string" || value.download_url === null);
}
function isRecord(value) {
  return typeof value === "object" && value !== null;
}

// lib/tools/template/find.js
var DEFAULT_MANIFEST_URLS = [
  "https://cdn.functions.azure.com/public/templates-manifest/manifest.json",
  "https://raw.githubusercontent.com/Azure/azure-functions-templates/dev/Functions.Templates/Template-Manifest/manifest.json"
];
var COMMAND5 = "template find";
async function findTemplates(options, dependencies) {
  const loaded = await loadFirstManifest(dependencies.manifestUrls, options);
  if (!loaded)
    return manifestUnavailable(COMMAND5);
  const templates = loaded.result.templates.map((template) => ({
    id: template.id,
    displayName: template.displayName,
    description: template.shortDescription,
    language: template.language,
    ...template.resource ? { resource: template.resource } : {},
    ...template.iac ? { iac: template.iac } : {}
  }));
  const data = { templates, manifestSource: loaded.source };
  if (templates.length === 0) {
    const result = succeed(COMMAND5, "No template matches the filters", data, {
      gaps: loaded.gaps,
      findings: [{
        id: "TEMPLATE-NONE-MATCH",
        severity: "warn",
        title: `No template matches language ${options.language}`,
        fix: "Remove --resource or --iac, or check the language name. Go has no manifest templates."
      }]
    });
    return { ...result, body: { ...result.body, ok: false } };
  }
  return succeed(COMMAND5, `Found ${templates.length} template(s)`, { ...data, recommended: templates[0].id }, {
    gaps: loaded.gaps,
    next: {
      action: "write-template",
      reason: "Write the recommended template unless the user asked for another one in the list.",
      command: `template write --template ${templates[0].id} --language ${templates[0].language} --dir <project-dir>`
    }
  });
}
async function loadFirstManifest(manifestUrls, filter = {}) {
  const gaps = [];
  for (const [index, manifestUrl] of manifestUrls.entries()) {
    try {
      const manifest = await loadTemplateManifest(manifestUrl);
      const result = await listFunctionTemplates({ manifestUrl, manifest, ...filter });
      return { result, manifest, source: index === 0 ? "primary" : "fallback", gaps };
    } catch (error) {
      gaps.push({
        check: index === 0 ? "manifest-primary" : `manifest-fallback-${index}`,
        reason: redact(error instanceof Error ? error.message : String(error))
      });
    }
  }
  return null;
}
function manifestUnavailable(command) {
  return fail(command, EXIT.blocked, "The template manifest could not be read", {
    findings: [{
      id: "TEMPLATE-MANIFEST-UNAVAILABLE",
      severity: "error",
      title: "No template manifest location answered",
      fix: "Check the network connection and try once more, or use the Azure MCP template tools."
    }]
  });
}

// lib/tools/template/write.js
import { existsSync as existsSync9, mkdirSync as mkdirSync4, readFileSync as readFileSync6, writeFileSync as writeFileSync5 } from "node:fs";
import { dirname as dirname3, join as join8, resolve as resolve9 } from "node:path";
var COMMAND6 = "template write";
var MAX_ALTERNATIVES = 3;
var MCP_FILE_LISTS = ["projectfiles", "functionfiles", "files"];
var MAX_SEARCH_DEPTH = 4;
var FINDINGS = {
  "not-found": { id: "TEMPLATE-NOT-FOUND", fix: "Run template find and use an id from its output." },
  "unsafe-path": { id: "TEMPLATE-UNSAFE-PATH", fix: "Do not write this template. Report it to the user." },
  "needs-new-mode": { id: "TEMPLATE-NEEDS-NEW-FOLDER", fix: "Write this template into an empty folder." },
  "fetch-failed": { id: "TEMPLATE-FETCH-FAILED", fix: "Check the network connection and try once more." },
  "invalid-manifest": { id: "TEMPLATE-FETCH-FAILED", fix: "Try once more, or use the Azure MCP template tools." },
  "unsupported-source": { id: "TEMPLATE-UNSUPPORTED-SOURCE", fix: "Choose a template hosted on GitHub." }
};
async function writeTemplate(options, dependencies) {
  const sources = [options.template, options.from].filter((value) => value !== void 0).length;
  if (sources > 1)
    throw new UsageError("Give only one of --template or --from");
  if (sources === 0 && options.language === void 0) {
    throw new UsageError("Give --template, --from, or --language to choose the closest template");
  }
  if (options.template !== void 0 && (options.resource !== void 0 || options.iac !== void 0)) {
    throw new UsageError("--resource and --iac choose a template, so do not combine them with --template");
  }
  if (options.from !== void 0 && options.stage)
    throw new UsageError("--stage works only with manifest templates");
  if (options.stage && options.mode !== void 0)
    throw new UsageError("--stage always writes a whole template; omit --mode");
  const dir = resolve9(options.dir);
  try {
    return options.from !== void 0 ? writeFromMcpFile(dir, resolve9(options.from), options.dryRun) : await writeFromManifest(dir, options, dependencies);
  } catch (error) {
    if (!(error instanceof TemplateError))
      throw error;
    const known = FINDINGS[error.code];
    return blocked4(redact(error.message), { id: known.id, severity: "error", title: redact(error.message), fix: known.fix });
  }
}
async function writeFromManifest(dir, options, dependencies) {
  const loaded = await loadFirstManifest(dependencies.manifestUrls);
  if (!loaded)
    return manifestUnavailable(COMMAND6);
  let template = options.template;
  let language = options.language;
  let selection;
  if (template === void 0) {
    const chosen = selectTemplate(loaded, options);
    if ("blocked" in chosen)
      return chosen.blocked;
    template = chosen.template.id;
    language = chosen.template.language;
    selection = chosen.selection;
  }
  const stagedDir = options.stage ? join8(toolDir(dir), "templates", template) : void 0;
  if (stagedDir && !options.dryRun)
    ensureToolDir(dir, "templates");
  const applied = await applyFunctionTemplate(stagedDir ?? dir, {
    manifestUrl: loaded.result.manifestUrl,
    manifest: loaded.manifest,
    template,
    language,
    runtimeVersion: options.runtimeVersion,
    mode: stagedDir ? "new" : options.mode ?? "auto",
    dryRun: options.dryRun
  });
  return done(dir, {
    source: "manifest",
    template: applied.template.id,
    language: applied.template.language,
    runtimeVersion: options.runtimeVersion ?? loaded.manifest.runtimeVersions?.[applied.template.language]?.default,
    ...selection ? { selection } : {},
    mode: applied.mode,
    dryRun: applied.dryRun,
    ...stagedDir ? { stagedDir } : {},
    written: applied.filesWritten,
    skipped: applied.skippedFiles
  }, loaded.gaps);
}
function selectTemplate(loaded, options) {
  const language = options.language.toLowerCase();
  const sameLanguage = loaded.result.templates.filter((candidate) => candidate.language.toLowerCase() === language);
  const matches = sameLanguage.filter((candidate) => !options.resource || candidate.resource?.toLowerCase() === options.resource.toLowerCase()).filter((candidate) => !options.iac || candidate.iac?.toLowerCase() === options.iac.toLowerCase());
  if (matches.length === 0) {
    const resources = [...new Set(sameLanguage.map((candidate) => candidate.resource).filter(Boolean))].join(", ");
    return {
      blocked: fail(COMMAND6, EXIT.blocked, "No template matches the request", {
        findings: [{
          id: "TEMPLATE-NONE-MATCH",
          severity: "error",
          title: `No ${options.language} template matches${options.resource ? ` resource ${options.resource}` : ""}${options.iac ? ` with ${options.iac}` : ""}`,
          detail: resources ? `Resources with ${options.language} templates: ${resources}.` : `No ${options.language} templates exist.`,
          fix: "Choose one of the listed resources, or run template find to see every template."
        }]
      })
    };
  }
  const by = ["language", options.resource ? "resource" : "", options.iac ? "iac" : ""].filter(Boolean).join("+");
  return {
    template: matches[0],
    selection: { by, alternatives: matches.slice(1, 1 + MAX_ALTERNATIVES).map((candidate) => candidate.id) }
  };
}
function writeFromMcpFile(dir, from, dryRun) {
  const result = findMcpResult(readJson2(from));
  const files = result ? collectFiles(result) : [];
  if (!result || files.length === 0) {
    return blocked4("The file holds no template files", {
      id: "TEMPLATE-INPUT-INVALID",
      severity: "error",
      title: "--from must be the JSON result of functions_template_get or functions_project_get",
      detail: "Expected a files, functionFiles, or projectFiles list of { fileName, content } entries.",
      fix: "Save the complete tool result to a file and pass that file."
    });
  }
  const planned = files.map((file) => {
    if (/^[\\/]/.test(file.fileName)) {
      throw new TemplateError("unsafe-path", `Unsafe template file path: ${file.fileName}`);
    }
    return { file, destination: resolveInsideTarget(dir, file.fileName) };
  });
  const written = [];
  const skipped = [];
  for (const { file, destination } of planned) {
    const name = file.fileName.replace(/\\/g, "/");
    if (existsSync9(destination)) {
      skipped.push(name);
      continue;
    }
    if (!dryRun) {
      mkdirSync4(dirname3(destination), { recursive: true });
      writeFileSync5(destination, file.content);
    }
    written.push(name);
  }
  const mergeInstructions = pick(result, "mergeinstructions");
  return done(dir, {
    source: "mcp-file",
    template: asText(pick(result, "templatename")),
    dryRun,
    written: written.sort(),
    skipped: skipped.sort(),
    ...typeof mergeInstructions === "string" && mergeInstructions ? { mergeInstructions } : {}
  }, []);
}
function done(dir, data, gaps) {
  const written = data.written?.length ?? 0;
  const skipped = data.skipped?.length ?? 0;
  const next = data.stagedDir ? {
    action: "merge-staged",
    reason: "Copy the function source from data.stagedDir into the project and merge its dependencies, settings, and infra resources. Delete the staged folder afterwards."
  } : skipped > 0 ? { action: "merge-skipped", reason: "Merge the needed settings and dependencies from the skipped files by hand." } : {
    action: "local-verify",
    reason: "Install dependencies, start the host, and call an HTTP function once.",
    command: `local verify --dir "${dir}"`
  };
  const verb = data.dryRun ? "Would write" : "Wrote";
  return succeed(COMMAND6, `${verb} ${written} file(s), skipped ${skipped}`, data, { gaps, next });
}
function blocked4(summary, finding) {
  return fail(COMMAND6, EXIT.blocked, summary, { findings: [finding] });
}
function readJson2(path) {
  try {
    return JSON.parse(readFileSync6(path, "utf-8"));
  } catch {
    return null;
  }
}
function findMcpResult(value, depth = 0) {
  if (!isRecord2(value) || depth > MAX_SEARCH_DEPTH)
    return null;
  if (MCP_FILE_LISTS.some((name) => Array.isArray(pick(value, name))))
    return value;
  for (const child of Object.values(value)) {
    const found = findMcpResult(child, depth + 1);
    if (found)
      return found;
  }
  return null;
}
function collectFiles(result) {
  const files = /* @__PURE__ */ new Map();
  for (const listName of MCP_FILE_LISTS) {
    const list = pick(result, listName);
    if (!Array.isArray(list))
      continue;
    for (const entry of list) {
      if (!isRecord2(entry))
        continue;
      const fileName = pick(entry, "filename");
      const content = pick(entry, "content");
      if (typeof fileName === "string" && typeof content === "string" && !files.has(fileName)) {
        files.set(fileName, { fileName, content });
      }
    }
  }
  return [...files.values()];
}
function pick(record, lowerCaseName) {
  const key = Object.keys(record).find((candidate) => candidate.toLowerCase() === lowerCaseName);
  return key === void 0 ? void 0 : record[key];
}
function asText(value) {
  return typeof value === "string" && value ? value : void 0;
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// lib/tools/cli.js
var HTTP_TIMEOUT_MS = 3e4;
var USAGE = `Usage: functions-tools.mjs <group> <command> [options]

  deploy plan    --dir <path> [--env <name>] [--location <region>] [--subscription <id>]
                 [--set NAME=VALUE]... [--code-only]
                 Reads the project and writes a deployment plan. Changes nothing in Azure.
  deploy apply   --dir <path> --approve <plan-id> [--preview]
                 Runs the approved plan with azd. Resumes after a failed step.
  deploy verify  --dir <path> [--env <name>] [--app <name>] [--subscription <id>] [--use-keys]
                 Lists the deployed functions and requests anonymous HTTP triggers. --use-keys also
                 requests FUNCTION-level triggers with a key read by the Azure CLI; keys are never printed.

  local verify   --dir <path> [--port <n>] [--timeout <seconds>] [--invoke <function>]
                 [--start-azurite] [--keep-azurite] [--no-install]
                 Creates local.settings.json when missing, installs dependencies, starts the host,
                 waits for Running, lists the functions, calls one HTTP function, then stops the host.

  template find  --language <name> [--resource <name>] [--iac <name>]
                 Lists templates from the Azure Functions template manifest, closest first.
  template write --dir <path> (--template <id> | --language <name> [--resource <name>] [--iac <name>]
                 | --from <mcp-result.json>) [--runtime-version <version>] [--mode new|add] [--stage] [--dry-run]
                 Writes template files. Never overwrites an existing file. Without --template it
                 chooses the closest template. --stage writes into .azure-functions-skills/templates/<id>.

Output is one JSON object on stdout.
Exit codes: 0 ran, 1 unexpected failure, 2 invalid arguments, 3 blocked before running, 4 a step failed.`;
async function runCli(argv, dependencies) {
  const command = argv.slice(0, 2).join(" ");
  const rest = argv.slice(2);
  try {
    if (command === "deploy plan") {
      const args = parseArgs(rest, {
        strings: ["dir", "env", "location", "subscription"],
        lists: ["set"],
        booleans: ["code-only"]
      });
      return await planDeploy({
        dir: required(args.strings, "dir"),
        env: args.strings.env,
        location: args.strings.location,
        subscription: args.strings.subscription,
        set: args.lists.set ?? [],
        codeOnly: args.booleans["code-only"] ?? false
      }, dependencies);
    }
    if (command === "deploy apply") {
      const args = parseArgs(rest, { strings: ["dir", "approve"], booleans: ["preview"] });
      return await applyDeploy({
        dir: required(args.strings, "dir"),
        approve: required(args.strings, "approve"),
        preview: args.booleans.preview ?? false
      }, dependencies);
    }
    if (command === "deploy verify") {
      const args = parseArgs(rest, { strings: ["dir", "env", "app", "subscription"], booleans: ["use-keys"] });
      return await verifyDeploy({
        dir: required(args.strings, "dir"),
        env: args.strings.env,
        app: args.strings.app,
        subscription: args.strings.subscription,
        useKeys: args.booleans["use-keys"] ?? false
      }, dependencies);
    }
    if (command === "local verify") {
      const args = parseArgs(rest, {
        strings: ["dir", "port", "timeout", "invoke"],
        booleans: ["start-azurite", "keep-azurite", "no-install"]
      });
      const base = { run: dependencies.run, sleep: dependencies.sleep, now: dependencies.now };
      return await verifyLocal({
        dir: required(args.strings, "dir"),
        port: positiveInteger(args.strings, "port", 65535),
        timeoutSeconds: positiveInteger(args.strings, "timeout", 3600),
        invoke: args.strings.invoke,
        startAzurite: args.booleans["start-azurite"] ?? false,
        keepAzurite: args.booleans["keep-azurite"] ?? false,
        noInstall: args.booleans["no-install"] ?? false
      }, dependencies.local ? { ...dependencies.local, ...base } : localDependencies(base));
    }
    if (command === "template find") {
      const args = parseArgs(rest, { strings: ["language", "resource", "iac"] });
      return await findTemplates({
        language: required(args.strings, "language"),
        resource: args.strings.resource,
        iac: args.strings.iac
      }, { manifestUrls: dependencies.manifestUrls ?? DEFAULT_MANIFEST_URLS });
    }
    if (command === "template write") {
      const args = parseArgs(rest, {
        strings: ["dir", "template", "from", "language", "resource", "iac", "runtime-version", "mode"],
        booleans: ["dry-run", "stage"]
      });
      const mode = args.strings.mode;
      if (mode !== void 0 && mode !== "new" && mode !== "add")
        throw new UsageError("--mode must be new or add");
      return await writeTemplate({
        dir: required(args.strings, "dir"),
        template: args.strings.template,
        from: args.strings.from,
        language: args.strings.language,
        resource: args.strings.resource,
        iac: args.strings.iac,
        runtimeVersion: args.strings["runtime-version"],
        mode,
        stage: args.booleans.stage ?? false,
        dryRun: args.booleans["dry-run"] ?? false
      }, { manifestUrls: dependencies.manifestUrls ?? DEFAULT_MANIFEST_URLS });
    }
    throw new UsageError(command ? `Unknown command: ${command}` : "No command was given");
  } catch (error) {
    if (error instanceof UsageError) {
      return fail(command || "usage", EXIT.usage, error.message, {
        findings: [{ id: "USAGE", severity: "error", title: error.message, detail: USAGE }]
      });
    }
    return fail(command, EXIT.unexpected, "Unexpected failure", {
      findings: [{
        id: "UNEXPECTED",
        severity: "error",
        title: redact(error instanceof Error ? error.message : String(error)),
        fix: "Follow the manual steps. Do not run the same command again."
      }]
    });
  }
}
function required(strings, name) {
  const value = strings[name];
  if (!value)
    throw new UsageError(`Missing required option --${name}`);
  return value;
}
function positiveInteger(strings, name, max) {
  const value = strings[name];
  if (value === void 0)
    return void 0;
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || parsed < 1 || parsed > max)
    throw new UsageError(`--${name} must be a whole number from 1 to ${max}`);
  return parsed;
}
async function fetchStatus(url, headers) {
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    ...headers ? { headers } : {}
  });
  return response.status;
}
async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${USAGE}
`);
    return;
  }
  const result = await runCli(argv, {
    run: createRunner(),
    now: () => /* @__PURE__ */ new Date(),
    fetchStatus,
    sleep: (milliseconds) => new Promise((resolve10) => {
      setTimeout(resolve10, milliseconds);
    })
  });
  process.stdout.write(`${JSON.stringify(result.body, null, 2)}
`);
  process.exitCode = result.exitCode;
}
function isEntryPoint() {
  try {
    return Boolean(process.argv[1]) && realpathSync2(process.argv[1]) === realpathSync2(fileURLToPath2(import.meta.url));
  } catch {
    return false;
  }
}
if (isEntryPoint())
  await main();
export {
  runCli
};
