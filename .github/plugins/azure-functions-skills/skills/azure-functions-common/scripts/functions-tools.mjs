#!/usr/bin/env node

// lib/tools/cli.js
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
  return (command, args, options = {}) => new Promise((resolve6) => {
    const file = resolveExecutable(command, {
      platform,
      path: environment.PATH || environment.Path || "",
      pathExt: environment.PATHEXT,
      exists: existsSync4
    });
    if (!file)
      return resolve6({ code: null, stdout: "", stderr: "", notFound: true, timedOut: false });
    let invocation;
    try {
      invocation = buildInvocation(file, args, platform);
    } catch (error) {
      return resolve6({ code: null, stdout: "", stderr: error.message, notFound: false, timedOut: false });
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
      resolve6({ code: null, stdout, stderr: stderr || error.message, notFound: false, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve6({ code: timedOut ? null : code, stdout, stderr, notFound: false, timedOut });
    });
  });
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
    sleep: (milliseconds) => new Promise((resolve6) => {
      setTimeout(resolve6, milliseconds);
    })
  });
  process.stdout.write(`${JSON.stringify(result.body, null, 2)}
`);
  process.exitCode = result.exitCode;
}
function isEntryPoint() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
if (isEntryPoint())
  await main();
export {
  runCli
};
