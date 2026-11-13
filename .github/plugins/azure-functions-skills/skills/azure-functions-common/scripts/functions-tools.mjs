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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
var WORK_DIR = ".azure-functions-skills";
function stepArgs(id, plan, value = "") {
  if (id === "env-new") {
    return ["env", "new", plan.environment, "--subscription", plan.subscriptionId, "--location", plan.location, "--no-prompt"];
  }
  if (id === "provision" || id === "deploy")
    return [id, "-e", plan.environment, "--no-prompt"];
  return ["env", "set", id.slice("env-set:".length), value, "-e", plan.environment, "--no-prompt"];
}
var ENV_SET_VALUE_INDEX = 3;
function isValidStep(step, plan) {
  if (!Array.isArray(step.args) || step.args.some((argument) => typeof argument !== "string"))
    return false;
  const known = step.id === "env-new" || step.id === "provision" || step.id === "deploy" || /^env-set:[A-Z_][A-Z0-9_]*$/.test(step.id);
  if (!known)
    return false;
  const expected = stepArgs(step.id, plan, step.id.startsWith("env-set:") ? step.args[ENV_SET_VALUE_INDEX] : "");
  return expected.length === step.args.length && expected.every((argument, index) => argument === step.args[index]);
}
function workDir(dir) {
  return join(resolve(dir), WORK_DIR, "deploy");
}
function planFilePath(dir) {
  return join(workDir(dir), "plan.json");
}
function stateFilePath(dir) {
  return join(workDir(dir), "state.json");
}
function logFilePath(dir) {
  return join(workDir(dir), "apply.log");
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
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}
`);
}
function ensureWorkDir(dir) {
  const root = join(resolve(dir), WORK_DIR);
  mkdirSync(workDir(dir), { recursive: true });
  const ignore = join(root, ".gitignore");
  if (!existsSync(ignore))
    writeFileSync(ignore, "*\n");
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
import { join as join2, resolve as resolve2 } from "node:path";

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
  const azureYaml = readAzureYaml(join2(root, "azure.yaml"));
  const functionProjects = (azureYaml?.services ?? []).filter((service) => service.host === "function").map((service) => join2(root, service.project));
  return {
    dir: root,
    hasHostJson: [root, ...functionProjects].some((folder) => isFile(join2(folder, "host.json"))),
    isHostedSkills: isFile(join2(root, "agents.config.yaml")) || hasAgentFile(root),
    azureYaml,
    infra: readInfra(join2(root, "infra")),
    environments: readEnvironments(join2(root, ".azure")),
    fingerprint: fingerprint(root)
  };
}
function readEnvironmentValues(dir, environment) {
  const path = join2(resolve2(dir), ".azure", environment, ".env");
  return isFile(path) ? parseDotenv(readFileSync2(path, "utf-8")) : null;
}
function isFile(path) {
  return existsSync2(path) && statSync(path).isFile();
}
function isDirectory(path) {
  return existsSync2(path) && statSync(path).isDirectory();
}
function hasAgentFile(root) {
  return [root, join2(root, "src")].some((folder) => isDirectory(folder) && readdirSync(folder).some((name) => name.endsWith(".agent.md")));
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
  const bicepPath = join2(infraDir, "main.bicep");
  if (!isFile(bicepPath)) {
    const hasTerraform = isDirectory(infraDir) && readdirSync(infraDir).some((name) => name.endsWith(".tf"));
    return { kind: hasTerraform ? "terraform" : null, allowedLocations: null, inputs: [] };
  }
  const bicep = parseBicepParameters(readFileSync2(bicepPath, "utf-8"));
  return {
    kind: "bicep",
    allowedLocations: bicep.get("location")?.allowed ?? null,
    inputs: readInputs(join2(infraDir, "main.parameters.json"), bicep)
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
  const names = readdirSync(azureDir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && isFile(join2(azureDir, entry.name, ".env"))).map((entry) => entry.name).sort();
  let defaultName = null;
  try {
    const config = JSON.parse(readFileSync2(join2(azureDir, "config.json"), "utf-8"));
    if (typeof config.defaultEnvironment === "string" && names.includes(config.defaultEnvironment)) {
      defaultName = config.defaultEnvironment;
    }
  } catch {
  }
  return { defaultName, names };
}
function fingerprint(root) {
  const hash = createHash2("sha256");
  const files = [join2(root, "azure.yaml"), ...listFiles(join2(root, "infra"))].filter(isFile).sort();
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
    const path = join2(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

// lib/tools/deploy/apply.js
var COMMAND = "deploy apply";
var TAIL_LINES = 40;
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
  if (plan.steps.some((step) => !isValidStep(step, plan))) {
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
  const completed = [...readState(dir, plan).completed];
  for (const step of plan.steps) {
    if (completed.includes(step.id))
      continue;
    const isPreview = options.preview && step.changes !== "local-environment";
    const args = isPreview ? [...step.args, "--preview"] : [...step.args];
    if (isPreview && step.id !== "provision")
      break;
    const outcome = await dependencies.run("azd", args, { cwd: dir, timeoutMs: step.timeoutSeconds * 1e3 });
    const output = redact([outcome.stdout, outcome.stderr].filter(Boolean).join("\n"));
    appendFileSync(logFile, `--- ${step.id} (exit ${outcome.code ?? "none"})
${output}
`);
    if (outcome.code !== 0) {
      return fail(COMMAND, EXIT.stepFailed, `Step ${step.id} failed`, {
        data: { planId: plan.planId, environment: plan.environment, completed, failedStep: step.id, outputTail: tail(output), logFile },
        findings: [failure(step, outcome, output)],
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
    completed.push(step.id);
    writeState(dir, { planId: plan.planId, completed });
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
function resumeCommand(dir, plan) {
  return `deploy apply --dir "${dir}" --approve ${plan.planId}`;
}
function failure(step, outcome, output) {
  const base = { id: "DEPLOY-STEP-FAILED", severity: "error" };
  if (outcome.notFound)
    return { ...base, title: "The azd command was not found", fix: "Install the Azure Developer CLI." };
  if (outcome.timedOut) {
    return {
      ...base,
      title: `azd ${step.args[0]} timed out after ${step.timeoutSeconds} seconds`,
      detail: "The operation may still be running in Azure. Check its state before resuming."
    };
  }
  const title = `azd ${step.args[0]} exited with code ${outcome.code}`;
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
    steps: plan.steps.map((step) => ({ id: step.id, command: display(step), changes: step.changes }))
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
function resolveSetting(request, findings, inputsNeeded) {
  if (request.existing) {
    if (request.requested && request.requested !== request.existing) {
      findings.push({
        id: request.findingId,
        severity: "error",
        title: `The environment already uses another ${request.name}`,
        detail: `Environment: ${request.existing}. Requested: ${request.requested}.`,
        fix: `Omit ${request.option}, or choose a new environment name with --env.`
      });
    }
    return request.existing;
  }
  const value = request.requested ?? request.fallbacks.find((candidate) => candidate);
  if (!value) {
    inputsNeeded.push({
      name: request.name,
      option: request.option,
      reason: request.reason,
      ...request.allowed ? { allowed: request.allowed } : {}
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
function display(step) {
  const args = step.id.startsWith("env-set:") && SECRET_NAME.test(step.args[2]) ? step.args.map((argument, index) => index === 3 ? "***" : argument) : step.args;
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
  const resourceGroup = parse(located)?.[0]?.resourceGroup;
  if (!resourceGroup) {
    return blocked3(`Function app ${app} was not found`, {
      id: "VERIFY-APP-NOT-FOUND",
      severity: "error",
      title: `No function app named ${app} is visible in the subscription`,
      fix: "Check az login and the subscription, then run deploy verify again."
    });
  }
  const target = ["--name", app, "--resource-group", resourceGroup, ...scope];
  const site = parse(await dependencies.run("az", ["functionapp", "show", ...target], { cwd: dir }));
  const entries = await listFunctions(target, dir, dependencies);
  const findings = [];
  const gaps = [];
  const functions = entries.map(describe);
  if (site?.state !== "Running") {
    findings.push({
      id: "VERIFY-APP-NOT-RUNNING",
      severity: "error",
      title: `The function app state is ${site?.state ?? "unknown"}`
    });
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
    const reason = skipReason(entry, info, http.length);
    if (reason) {
      gaps.push({ check: `http:${info.name}`, reason });
      continue;
    }
    const status = await dependencies.fetchStatus(entry.invokeUrlTemplate).catch(() => 0);
    const reachable = status >= 200 && status < 500 && status !== 404;
    http.push({ function: info.name, status, reachable });
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
    state: site?.state ?? "unknown",
    hostName: site?.defaultHostName,
    functions,
    http
  };
  const failed = findings.some((finding) => finding.severity === "error");
  const summary = failed ? `Verification found ${findings.length} problem(s) in ${app}` : `${app} is running with ${functions.length} function(s)`;
  return failed ? { exitCode: EXIT.ok, body: { ...succeed(COMMAND3, summary, data, { findings, gaps }).body, ok: false } } : succeed(COMMAND3, summary, data, { findings, gaps });
}
async function listFunctions(target, dir, dependencies) {
  for (let attempt = 1; attempt <= LIST_ATTEMPTS; attempt++) {
    const listed = parse(await dependencies.run("az", ["functionapp", "function", "list", ...target], { cwd: dir }));
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
function skipReason(entry, info, checked) {
  const methods = entry.config?.bindings?.find((binding) => binding.type === "httpTrigger")?.methods;
  if (info.authLevel?.toLowerCase() !== "anonymous")
    return "Needs a function key. The script does not read keys.";
  if (methods && methods.length > 0 && !methods.some((method) => method.toLowerCase() === "get"))
    return "Does not accept GET.";
  if (!entry.invokeUrlTemplate || entry.invokeUrlTemplate.includes("{"))
    return "The route needs parameters.";
  if (checked >= MAX_HTTP_CHECKS)
    return `Only the first ${MAX_HTTP_CHECKS} HTTP triggers are requested.`;
  return null;
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
function blocked3(summary, finding) {
  return fail(COMMAND3, EXIT.blocked, summary, { findings: [finding] });
}

// lib/tools/shared/exec.js
import { spawn } from "node:child_process";
import { existsSync as existsSync4 } from "node:fs";
import { delimiter, join as join3, win32 } from "node:path";
var DEFAULT_TIMEOUT_MS = 6e4;
var NATIVE_FIRST = [".exe", ".com"];
var UNSAFE_FOR_CMD = /["%^&|<>!\r\n]/;
function resolveExecutable(command, environment) {
  const isWindows = environment.platform === "win32";
  const separator = isWindows ? ";" : delimiter;
  const joinPath = isWindows ? win32.join : join3;
  const extensions = isWindows ? orderExtensions((environment.pathExt || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)) : [""];
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
  return (command, args, options = {}) => new Promise((resolve8) => {
    const file = resolveExecutable(command, {
      platform,
      path: environment.PATH || environment.Path || "",
      pathExt: environment.PATHEXT,
      exists: existsSync4
    });
    if (!file)
      return resolve8({ code: null, stdout: "", stderr: "", notFound: true, timedOut: false });
    let invocation;
    try {
      invocation = buildInvocation(file, args, platform);
    } catch (error) {
      return resolve8({ code: null, stdout: "", stderr: error.message, notFound: false, timedOut: false });
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
      resolve8({ code: null, stdout, stderr: stderr || error.message, notFound: false, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve8({ code: timedOut ? null : code, stdout, stderr, notFound: false, timedOut });
    });
  });
}

// lib/templates/index.js
import { execFileSync } from "node:child_process";
import { existsSync as existsSync5, lstatSync, mkdirSync as mkdirSync2, readFileSync as readFileSync3, readdirSync as readdirSync2, realpathSync, writeFileSync as writeFileSync2 } from "node:fs";
import { dirname as dirname2, isAbsolute, join as join4, relative, resolve as resolve6 } from "node:path";
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
var githubCliTokenWarningShown = false;
async function listFunctionTemplates(options = {}) {
  const manifestUrl = options.manifestUrl ?? DEFAULT_TEMPLATE_MANIFEST_URL;
  const manifest = await loadTemplateManifest(manifestUrl);
  const templates = manifest.templates.filter((template) => matchesFilter(template.language, options.language)).filter((template) => matchesFilter(template.resource, options.resource)).filter((template) => matchesFilter(template.iac, options.iac)).slice().sort(compareTemplates);
  return { manifestUrl, templates };
}
async function applyFunctionTemplate(targetDir, options) {
  const manifestUrl = options.manifestUrl ?? DEFAULT_TEMPLATE_MANIFEST_URL;
  const manifest = await loadTemplateManifest(manifestUrl);
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
    if (existsSync5(destination) && options.force !== true) {
      skippedFiles.push(file.relativePath);
      continue;
    }
    if (!options.dryRun) {
      mkdirSync2(dirname2(destination), { recursive: true });
      writeFileSync2(destination, file.content);
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
  const destination = join4(targetDir, normalizeTemplatePath(relativePath));
  if (!existsSync5(targetDir))
    return destination;
  const root = realpathSync(targetDir);
  let ancestor = dirname2(destination);
  while (!existsSync5(ancestor))
    ancestor = dirname2(ancestor);
  const inside = relative(root, realpathSync(ancestor));
  const isLink = existsSync5(destination) && lstatSync(destination).isSymbolicLink();
  if (inside.startsWith("..") || isAbsolute(inside) || isLink) {
    throw new TemplateError("unsafe-path", `Template file would be written outside the target folder: ${relativePath}`);
  }
  return destination;
}
async function loadTemplateManifest(manifestUrl) {
  const parsed = new URL(manifestUrl);
  const raw = parsed.protocol === "file:" ? readFileSync3(fileURLToPath(parsed), "utf-8") : await fetchText(manifestUrl);
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
  const sourceRoot = resolve6(sourceDir);
  const rootDir = folderPath === "." ? sourceRoot : resolve6(sourceRoot, folderPath);
  assertPathInside(sourceRoot, rootDir, "Template folder");
  if (!existsSync5(rootDir)) {
    throw new Error(`Template folder does not exist: ${rootDir}`);
  }
  const files = [];
  collectLocalFiles(rootDir, rootDir, files);
  return files;
}
function collectLocalFiles(rootDir, currentDir, files) {
  const entries = readdirSync2(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join4(currentDir, entry.name);
    if (entry.isDirectory()) {
      collectLocalFiles(rootDir, entryPath, files);
    } else if (entry.isFile()) {
      files.push({
        relativePath: relative(rootDir, entryPath),
        content: readFileSync3(entryPath)
      });
    }
  }
}
async function downloadGitHubTemplateFiles(repo, folderPath, ref) {
  assertSafeFolderPath(folderPath);
  const rootPath = folderPath === "." ? "" : folderPath.replace(/^\/+|\/+$/g, "");
  const entries = await listGitHubContents(repo, rootPath, ref);
  const files = [];
  for (const entry of entries) {
    if (!entry.download_url) {
      throw new Error(`GitHub file entry is missing download URL: ${entry.path}`);
    }
    const content = await fetchBuffer(entry.download_url);
    files.push({
      relativePath: rootPath ? entry.path.slice(rootPath.length + 1) : entry.path,
      content
    });
  }
  return files;
}
async function listGitHubContents(repo, path, ref) {
  const encodedPath = path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  const url = new URL(`https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${encodedPath}`);
  url.searchParams.set("ref", ref);
  const entries = await fetchGitHubJson(url.toString());
  if (!Array.isArray(entries)) {
    throw new Error(`GitHub contents path is not a directory: ${path || "."}`);
  }
  const files = [];
  for (const entry of entries) {
    if (!isGitHubContentEntry(entry))
      continue;
    if (entry.type === "file") {
      files.push(entry);
    } else {
      files.push(...await listGitHubContents(repo, entry.path, ref));
    }
  }
  return files;
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
  return existsSync5(join4(targetDir, "host.json")) ? "add" : "new";
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
  if (!githubCliTokenWarningShown) {
    process.stderr.write("GitHub API rate limit or private repository access requires authentication. Trying `gh auth token`...\n");
    githubCliTokenWarningShown = true;
  }
  try {
    const token = execFileSync("gh", ["auth", "token"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return token || void 0;
  } catch (_err) {
    return void 0;
  }
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
var COMMAND4 = "template find";
async function findTemplates(options, dependencies) {
  const loaded = await loadFirstManifest(dependencies.manifestUrls, options);
  if (!loaded)
    return manifestUnavailable(COMMAND4);
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
    const result = succeed(COMMAND4, "No template matches the filters", data, {
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
  return succeed(COMMAND4, `Found ${templates.length} template(s)`, data, {
    gaps: loaded.gaps,
    next: { action: "choose-template", reason: "Let the user choose, then run template write with the chosen id." }
  });
}
async function loadFirstManifest(manifestUrls, filter = {}) {
  const gaps = [];
  for (const [index, manifestUrl] of manifestUrls.entries()) {
    try {
      const result = await listFunctionTemplates({ manifestUrl, ...filter });
      return { result, source: index === 0 ? "primary" : "fallback", gaps };
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
import { existsSync as existsSync6, mkdirSync as mkdirSync3, readFileSync as readFileSync4, writeFileSync as writeFileSync3 } from "node:fs";
import { dirname as dirname3, resolve as resolve7 } from "node:path";
var COMMAND5 = "template write";
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
  if (options.template === void 0 === (options.from === void 0)) {
    throw new UsageError("Give exactly one of --template or --from");
  }
  const dir = resolve7(options.dir);
  try {
    return options.from !== void 0 ? writeFromMcpFile(dir, resolve7(options.from), options.dryRun) : await writeFromManifest(dir, options.template, options, dependencies);
  } catch (error) {
    if (!(error instanceof TemplateError))
      throw error;
    const known = FINDINGS[error.code];
    return blocked4(redact(error.message), { id: known.id, severity: "error", title: redact(error.message), fix: known.fix });
  }
}
async function writeFromManifest(dir, template, options, dependencies) {
  const loaded = await loadFirstManifest(dependencies.manifestUrls);
  if (!loaded)
    return manifestUnavailable(COMMAND5);
  const applied = await applyFunctionTemplate(dir, {
    manifestUrl: loaded.result.manifestUrl,
    template,
    language: options.language,
    runtimeVersion: options.runtimeVersion,
    mode: options.mode ?? "auto",
    dryRun: options.dryRun
  });
  return done({
    source: "manifest",
    template: applied.template.id,
    mode: applied.mode,
    dryRun: applied.dryRun,
    written: applied.filesWritten,
    skipped: applied.skippedFiles
  }, loaded.gaps);
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
    if (existsSync6(destination)) {
      skipped.push(name);
      continue;
    }
    if (!dryRun) {
      mkdirSync3(dirname3(destination), { recursive: true });
      writeFileSync3(destination, file.content);
    }
    written.push(name);
  }
  const mergeInstructions = pick(result, "mergeinstructions");
  return done({
    source: "mcp-file",
    template: asText(pick(result, "templatename")),
    dryRun,
    written: written.sort(),
    skipped: skipped.sort(),
    ...typeof mergeInstructions === "string" && mergeInstructions ? { mergeInstructions } : {}
  }, []);
}
function done(data, gaps) {
  const written = data.written?.length ?? 0;
  const skipped = data.skipped?.length ?? 0;
  const next = skipped > 0 ? { action: "merge-skipped", reason: "Merge the needed settings and dependencies from the skipped files by hand." } : { action: "install-and-verify", reason: "Install dependencies, then build and run the project locally." };
  const verb = data.dryRun ? "Would write" : "Wrote";
  return succeed(COMMAND5, `${verb} ${written} file(s), skipped ${skipped}`, data, { gaps, next });
}
function blocked4(summary, finding) {
  return fail(COMMAND5, EXIT.blocked, summary, { findings: [finding] });
}
function readJson2(path) {
  try {
    return JSON.parse(readFileSync4(path, "utf-8"));
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
  deploy verify  --dir <path> [--env <name>] [--app <name>] [--subscription <id>]
                 Lists the deployed functions and requests anonymous HTTP triggers.

  template find  --language <name> [--resource <name>] [--iac <name>]
                 Lists templates from the Azure Functions template manifest.
  template write --dir <path> (--template <id> | --from <mcp-result.json>)
                 [--language <name>] [--runtime-version <version>] [--mode new|add] [--dry-run]
                 Writes template files. Never overwrites an existing file.

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
      const args = parseArgs(rest, { strings: ["dir", "env", "app", "subscription"] });
      return await verifyDeploy({
        dir: required(args.strings, "dir"),
        env: args.strings.env,
        app: args.strings.app,
        subscription: args.strings.subscription
      }, dependencies);
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
        strings: ["dir", "template", "from", "language", "runtime-version", "mode"],
        booleans: ["dry-run"]
      });
      const mode = args.strings.mode;
      if (mode !== void 0 && mode !== "new" && mode !== "add")
        throw new UsageError("--mode must be new or add");
      return await writeTemplate({
        dir: required(args.strings, "dir"),
        template: args.strings.template,
        from: args.strings.from,
        language: args.strings.language,
        runtimeVersion: args.strings["runtime-version"],
        mode,
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
async function fetchStatus(url) {
  const response = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
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
    sleep: (milliseconds) => new Promise((resolve8) => {
      setTimeout(resolve8, milliseconds);
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
