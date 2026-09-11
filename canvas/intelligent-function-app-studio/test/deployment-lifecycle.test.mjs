import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "./vitest-test.mjs";

import {
	createAzdPhaseTracker,
	deployToAzure,
	prepareDeploymentProjectCopy,
	redactDeploymentOutput,
} from "../studio-commands.mjs";
import {
	appendBoundedDeploymentOutput,
	createLocalPortReservationPool,
	localRuntimeControlState,
} from "../deployment-ui-state.mjs";
import { enforceIdentityOnlyDeploymentTemplate } from "../deployment-template-policy.mjs";

function fakeChild() {
	const child = new EventEmitter();
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.unref = () => {};
	child.exitCode = null;
	child.signalCode = null;
	child.kill = (signal) => {
		child.signalCode = signal;
		return true;
	};
	return child;
}

test("deployment output is redacted without hiding ordinary progress", () => {
	const output = redactDeploymentOutput(
		"Deploying service digest Authorization: Bearer ey.secret.value?code=abc access_token=top-secret AZURE_CLIENT_SECRET=private GITHUB_TOKEN=github-secret",
	);
	assert.match(output, /Deploying service digest/);
	assert.doesNotMatch(output, /ey\.secret|top-secret|private|github-secret|code=abc/);
	assert.match(output, /Authorization: (?:Bearer \[REDACTED\]|\*+)/);
	assert.match(output, /code=\[REDACTED\]/);
});

test("azd phase tracker maps emitted provision, package, and deploy output", () => {
	let timestamp = 100;
	const tracker = createAzdPhaseTracker({ now: () => (timestamp += 25) });
	const events = [
		...tracker.feed("Provisioning Azure resources (azd provision)"),
		...tracker.feed("SUCCESS: Your application was provisioned in Azure."),
		...tracker.feed("Packaging services (azd package)"),
		...tracker.feed("  (✓) Done: Packaging service api"),
		...tracker.feed("Deploying services (azd deploy)"),
		...tracker.feed("SUCCESS: Your application was deployed to Azure."),
	];
	assert.deepEqual(
		events.map(({ name, state }) => `${name}:${state}`),
		[
			"provision:started",
			"provision:completed",
			"package:started",
			"package:completed",
			"deploy:started",
			"deploy:completed",
		],
	);
	assert.equal(tracker.finish({ ok: true, detail: "exit 0" }).length, 0);
});

test("azd phase tracker fails unreported phases and records cancellation", () => {
	const failed = createAzdPhaseTracker();
	failed.feed("Provisioning Azure resources (azd provision)");
	assert.deepEqual(
		failed.finish({ ok: false, detail: "azd up exited (code 1)" }).map(({ name, state }) => `${name}:${state}`),
		["provision:failed", "package:failed", "deploy:failed"],
	);

	const cancelled = createAzdPhaseTracker();
	cancelled.feed("Provisioning Azure resources (azd provision)");
	assert.deepEqual(
		cancelled.finish({ ok: false, cancelled: true, detail: "cancelled" }).map(({ name, state }) => `${name}:${state}`),
		["provision:cancelled", "package:cancelled", "deploy:cancelled"],
	);
});

test("deployToAzure streams ordered output, milestones, and terminal status", async () => {
	const child = fakeChild();
	const output = [];
	const milestones = [];
	let spawned;
	let finish;
	const exited = new Promise((resolve) => {
		finish = resolve;
	});
	const launched = deployToAzure("/tmp/deploy-app", {
		environmentName: "deployment",
		subscription: "00000000-0000-0000-0000-000000000001",
		location: "eastus2",
		noPrompt: true,
		runCommand: async () => ({ stdout: "azd version 1.0", stderr: "" }),
		spawnProcess: (command, args, options) => {
			spawned = { command, args, options };
			queueMicrotask(() => child.emit("spawn"));
			return child;
		},
		onOutput: (event) => output.push(event),
		onMilestone: (event) => milestones.push(event),
		onProcessExit: finish,
	});
	const result = await launched;
	child.stdout.write("Provisioning Azure resources (azd provision)\n");
	child.stderr.write("warning: retrying\n");
	child.stdout.write("Packaging services (azd package)\nDeploying services (azd deploy)\n");
	child.stdout.write("SUCCESS: Your application was deployed to Azure.\n");
	child.emit("close", 0, null);
	const exit = await exited;

	assert.equal(result.ok, true);
	assert.equal(exit.ok, true);
	assert.deepEqual(spawned.args, [
		"up",
		"--environment",
		"deployment",
		"--subscription",
		"00000000-0000-0000-0000-000000000001",
		"--location",
		"eastus2",
		"--no-prompt",
	]);
	assert.deepEqual(output.map(({ sequence }) => sequence), [1, 2, 3, 4, 5]);
	assert.deepEqual(output.map(({ stream }) => stream), ["stdout", "stderr", "stdout", "stdout", "stdout"]);
	assert.equal(milestones.at(-1).state, "completed");
	assert.equal(milestones.at(-1).name, "deploy");
});

test("deployToAzure cancellation reports the local command stopped without promising Azure rollback", async () => {
	const child = fakeChild();
	let finish;
	const exited = new Promise((resolve) => {
		finish = resolve;
	});
	const result = await deployToAzure("/tmp/deploy-app", {
		runCommand: async () => ({}),
		spawnProcess: () => {
			queueMicrotask(() => child.emit("spawn"));
			return child;
		},
		onProcessExit: finish,
	});
	assert.equal(result.cancel(), true);
	child.emit("close", null, "SIGTERM");
	const exit = await exited;
	assert.equal(exit.cancelled, true);
	assert.equal(exit.ok, false);
	assert.match(exit.message, /Local azd command stopped/);
	assert.match(exit.message, /Azure operations already submitted may continue/);
});

test("failed cancellation remains retryable and does not relabel a successful exit", async () => {
	const child = fakeChild();
	child.kill = () => false;
	let finish;
	const exited = new Promise((resolve) => {
		finish = resolve;
	});
	const result = await deployToAzure("/tmp/deploy-app", {
		runCommand: async () => ({}),
		spawnProcess: () => {
			queueMicrotask(() => child.emit("spawn"));
			return child;
		},
		onProcessExit: finish,
	});
	assert.equal(result.cancel(), false);
	child.emit("close", 0, null);
	const exit = await exited;
	assert.equal(exit.cancelled, false);
	assert.equal(exit.ok, true);
});

test("deployToAzure surfaces preflight failure and fails every milestone", async () => {
	const milestones = [];
	let exit;
	const result = await deployToAzure("/tmp/deploy-app", {
		runCommand: async () => {
			throw new Error("azd missing");
		},
		onMilestone: (event) => milestones.push(event),
		onProcessExit: (event) => {
			exit = event;
		},
	});
	assert.equal(result.ok, false);
	assert.equal(exit.started, false);
	assert.deepEqual(
		milestones.map(({ name, state }) => `${name}:${state}`),
		["provision:failed", "package:failed", "deploy:failed"],
	);
});

test("deployment copy preserves azd environment and excludes local runtime state", async (t) => {
	const root = await mkdtemp(path.join(os.tmpdir(), "deployment-copy-test-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const source = path.join(root, "source");
	const destination = path.join(root, "deployment");
	await mkdir(path.join(source, "src"), { recursive: true });
	await mkdir(path.join(source, ".venv"), { recursive: true });
	await mkdir(path.join(destination, ".azure"), { recursive: true });
	await writeFile(path.join(source, "src", "function_app.py"), "source");
	await writeFile(path.join(source, ".venv", "runtime"), "must-not-copy");
	await writeFile(path.join(destination, ".azure", "config.json"), "persisted");

	await prepareDeploymentProjectCopy(source, destination);

	assert.equal(await readFile(path.join(destination, "src", "function_app.py"), "utf8"), "source");
	assert.equal(await readFile(path.join(destination, ".azure", "config.json"), "utf8"), "persisted");
	await assert.rejects(readFile(path.join(destination, ".venv", "runtime"), "utf8"), /ENOENT/);
	assert.equal(await readFile(path.join(source, "src", "function_app.py"), "utf8"), "source");
});

test("deployment copy failure leaves the previous azd environment intact", async (t) => {
	const root = await mkdtemp(path.join(os.tmpdir(), "deployment-copy-failure-test-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const destination = path.join(root, "deployment");
	await mkdir(path.join(destination, ".azure"), { recursive: true });
	await writeFile(path.join(destination, ".azure", "config.json"), "persisted");
	await assert.rejects(
		prepareDeploymentProjectCopy(path.join(root, "missing-source"), destination),
		/ENOENT/,
	);
	assert.equal(await readFile(path.join(destination, ".azure", "config.json"), "utf8"), "persisted");
});

test("concurrent local host starts reserve different ports before either host binds", async () => {
	let releaseProbe;
	const firstProbe = new Promise((resolve) => {
		releaseProbe = resolve;
	});
	let probes = 0;
	const pool = createLocalPortReservationPool({
		isListening: async () => {
			probes += 1;
			if (probes === 1) await firstProbe;
			return false;
		},
	});

	const first = pool.reserve(7071);
	const second = await pool.reserve(7071);
	releaseProbe();
	const firstLease = await first;

	assert.equal(firstLease.port, 7071);
	assert.equal(second.port, 7072);
	firstLease.release();
	second.release();
});

test("deployment snapshot disables Storage and Foundry local authentication", async (t) => {
	const root = await mkdtemp(path.join(os.tmpdir(), "deployment-policy-test-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(path.join(root, "infra", "app"), { recursive: true });
	await writeFile(
		path.join(root, "infra", "main.bicep"),
		"module storage 'storage' = {\n  params: {\n    allowSharedKeyAccess: true\n  }\n}\nvar appSettings = {\n  AZURE_FUNCTIONS_AGENTS_PROVIDER: 'foundry'\n  FOUNDRY_MODEL: foundry.outputs.modelDeploymentName\n}\n",
	);
	await writeFile(
		path.join(root, "infra", "app", "api.bicep"),
		"var baseAppSettings = {\n  AzureWebJobsStorage__blobServiceUri: stg.properties.primaryEndpoints.blob\n  AzureWebJobsStorage__queueServiceUri: stg.properties.primaryEndpoints.queue\n  AzureWebJobsStorage__tableServiceUri: stg.properties.primaryEndpoints.table\n  AzureWebJobsStorage__fileServiceUri: stg.properties.primaryEndpoints.file\n}\n",
	);
	await writeFile(
		path.join(root, "infra", "app", "foundry.bicep"),
		"resource foundryAccount 'Microsoft.CognitiveServices/accounts@2025-10-01-preview' = {\n  properties: {\n    allowProjectManagement: true\n  }\n}\n",
	);

	await enforceIdentityOnlyDeploymentTemplate(root);
	await enforceIdentityOnlyDeploymentTemplate(root);

	assert.match(await readFile(path.join(root, "infra", "main.bicep"), "utf8"), /allowSharedKeyAccess: false/);
	assert.match(
		await readFile(path.join(root, "infra", "main.bicep"), "utf8"),
		/AZURE_FUNCTIONS_AGENTS_MODEL: foundry\.outputs\.modelDeploymentName/,
	);
	assert.match(
		await readFile(path.join(root, "infra", "app", "foundry.bicep"), "utf8"),
		/properties:\s*\{\n\s+disableLocalAuth: true/,
	);
	assert.doesNotMatch(
		await readFile(path.join(root, "infra", "app", "api.bicep"), "utf8"),
		/AzureWebJobsStorage__(?:queue|table|file)ServiceUri/,
	);
});

test("deployment snapshot refuses unknown policy template shapes", async (t) => {
	const root = await mkdtemp(path.join(os.tmpdir(), "deployment-policy-shape-test-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(path.join(root, "infra", "app"), { recursive: true });
	await writeFile(
		path.join(root, "infra", "app", "api.bicep"),
		"var baseAppSettings = {\n  AzureWebJobsStorage__blobServiceUri: stg.properties.primaryEndpoints.blob\n}\n",
	);
	await writeFile(
		path.join(root, "infra", "main.bicep"),
		"module storage 'storage' = {\n  params: {\n    allowSharedKeyAccess: true\n  }\n}\n",
	);
	await writeFile(path.join(root, "infra", "app", "foundry.bicep"), "resource foundryAccount 'x' = {}\n");
	await assert.rejects(enforceIdentityOnlyDeploymentTemplate(root), /refusing to guess/);
	assert.match(await readFile(path.join(root, "infra", "main.bicep"), "utf8"), /allowSharedKeyAccess: true/);
});

test("local runtime controls remain recoverable across runtime and deploy states", () => {
	for (const status of ["idle", "stopped", "starting", "running", "error", "failed", "exited"]) {
		const control = localRuntimeControlState({
			target: "local",
			local: { status },
			sourceWorkspace: { materialized: true },
			deployment: { status: "running" },
		});

		assert.equal(control.visible, true, status);
		assert.equal(control.disabled, status === "starting", status);
		assert.equal(
			control.label,
			status === "starting" ? "Starting..." : status === "running" ? "Stop local function" : "Start local function",
			status,
		);
	}
	assert.equal(
		localRuntimeControlState({
			target: "local",
			local: { status: "error" },
			sourceWorkspace: { materialized: false },
		}).visible,
		true,
	);
	assert.equal(
		localRuntimeControlState({
			target: "local",
			local: { status: "stopped" },
			sourceWorkspace: { materialized: true },
			deployment: { status: "preparing" },
		}).disabled,
		true,
	);
});

test("deployment output retention is bounded and records truncation", () => {
	const deployment = { output: [], outputChars: 0, outputTruncated: false };
	for (let index = 0; index < 6; index += 1) {
		appendBoundedDeploymentOutput(
			deployment,
			{ sequence: index + 1, stream: "stdout", text: `line-${index}` },
			{ maxLines: 3, maxChars: 100 },
		);
	}
	assert.deepEqual(deployment.output.map(({ sequence }) => sequence), [4, 5, 6]);
	assert.equal(deployment.outputTruncated, true);
});

test("Function Studio deployment route never stops or overwrites local runtime state", async () => {
	const source = await readFile(
		new URL("../extension.mjs", import.meta.url),
		"utf8",
	);
	const route = source.slice(source.indexOf('req.url === "/deploy-azure"'), source.indexOf('req.url === "/deploy-azure/cancel"'));
	assert.doesNotMatch(route, /stopLocal\s*\(/);
	assert.doesNotMatch(route, /ensureTemplate\s*\(/);
	assert.doesNotMatch(route, /runtimeMode\s*:/);
	assert.match(route, /prepareDeploymentProjectCopy\(sourceDir, dir\)/);
	assert.match(route, /enforceIdentityOnlyDeploymentTemplate\(dir\)/);
	assert.match(route, /environmentName: AZD_DEPLOYMENT_ENVIRONMENT/);
	assert.match(route, /subscription: deploymentSubscription/);
	assert.match(route, /location: AZD_DEPLOYMENT_LOCATION/);
	assert.match(route, /noPrompt: true/);
	assert.ok(
		route.indexOf('beginAzdOperation(entry, "deploy")') <
			route.indexOf("prepareDeploymentProjectCopy(sourceDir, dir)"),
	);
	assert.match(route, /entry\.trigger === "queue"/);
	assert.match(route, /entry\.trigger === "connector"/);
	assert.match(route, /removeConnectorDeploymentConfig/);
	assert.match(route, /Deployment setup failed:/);
	assert.match(source, /class="cmdlog deployment-output" id="deployment-output"/);
	assert.match(source, /const deployAzureBtn = document\.getElementById\('deploy-azure'\)/);
	assert.match(source, /deployAzureBtn\.addEventListener\('click'/);
	const selectTargetRoute = source.slice(source.indexOf('req.url === "/select-target"'), source.indexOf('req.url === "/prompt"'));
	assert.match(selectTargetRoute, /\.catch\(\(error\) => \{/);
	assert.match(selectTargetRoute, /responseJson\(res, \{ ok: false, message:/);
	assert.match(source, /selectedAzure \? 'Invoke ' \+ selectedAzure\.name : 'Invoke Trigger'/);
	assert.match(source, /if os\.environ\.get\("FOUNDRY_TOKEN_FILE"\):/);
	assert.doesNotMatch(source, /if os\.environ\.get\("WEBSITE_INSTANCE_ID"\):/);
	assert.match(source, /const appInsights = await resolveAppInsights\(entry\)/);
	assert.match(source, /if \(appInsights\) startLiveTelemetry\(entry\)/);
	assert.match(source, /const LIVE_TELEMETRY_TRACE_QUERY/);
	assert.match(source, /const LIVE_AGENT_OUTPUT_QUERY/);
	assert.match(source, /message startswith "Agent response:"/);
	assert.match(source, /applyAgentResponseTelemetry\(entry\.invocations, outputRows\)/);
	assert.match(source, /const invokedAt = new Date\(\)\.toISOString\(\)/);
	assert.match(source, /installAgentResponseLogging\(source\)/);
	assert.match(source, /entry\.azureInvocationsInFlight\.has\(fn\.name\)/);
	assert.match(source, /entry\.liveTelemetry\.enabled && Boolean\(entry\.azure\.appInsights\)/);
	assert.match(source, /awaitAgentResponse,/);
	assert.doesNotMatch(source, /if \(\s*awaitAgentResponse &&\s*\(entry\.azureInvocationsInFlight/);
	assert.match(source, /entry\.azureInvocationsInFlight\.add\(fn\.name\)/);
	assert.match(source, /entry\.azureInvocationsInFlight\.delete\(fn\.name\)/);
	assert.match(source, /clearSettledInvocations\(entry\)/);
	assert.match(source, /Recent traces and exceptions/);
	assert.match(source, /<details class="instr" id="telemetry-panel"/);
	assert.match(source, /id="telemetry-tag">off/);
	assert.match(source, /if \(latest && latest\.target === 'azure'\) telemetryPanel\.open = true/);
	assert.match(source, /\.instr summary::before \{ content: "›"/);
	assert.match(source, /\.instr\[open\] summary::before \{ transform: rotate\(90deg\)/);
	assert.match(source, /\.load-terminal pre \{[\s\S]*?background: #0b1120; color: #dbe5f7/);
	assert.match(source, /observeLabel\.style\.display = \(!showAzure \|\| state\.azure\.app\) \? '' : 'none'/);
	assert.ok(source.indexOf('id="telemetry-panel"') < source.indexOf('id="digest-panel"'));
	assert.ok(source.indexOf('id="local-log-wrap"') < source.indexOf('id="digest-panel"'));
	assert.doesNotMatch(source, /id="ai-chart"/);
	assert.match(source, /requests \(30m\)/);
	assert.match(source, /weightedDuration/);
	assert.match(source, /entry\.liveTelemetry\.traces = traces\.slice\(0, 40\)/);
	assert.match(source, /redactDeploymentOutput\(String\(row\[3\] \|\| ""\)\)/);
	assert.match(source, /deploymentOutput\.open = true/);
	assert.match(source, /deploymentOutput\.hidden = false/);
	assert.match(source, /\.cmdlog > summary::before/);
	assert.match(source, /Deployment continues while this panel is collapsed/);
	assert.match(source, /async function moveCurrentSourceWorkspace/);
	assert.match(source, /assertWorkspaceMutationAllowed\(entry, "Moving the generated app"\)/);
	assert.match(source, /assertWorkspaceMutationAllowed\(entry, "Changing the model binding"\)/);
	assert.match(source, /if \(entry\.deployment\.status === "preparing"\)/);
});
