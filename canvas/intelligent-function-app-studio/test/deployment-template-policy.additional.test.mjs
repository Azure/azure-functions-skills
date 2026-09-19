import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "./vitest-test.mjs";
import { enforceIdentityOnlyDeploymentTemplate } from "../deployment-template-policy.mjs";

async function templateFixture(t, overrides = {}) {
	const root = await mkdtemp(path.join(tmpdir(), "deployment-policy-extra-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(path.join(root, "infra", "app"), { recursive: true });
	await writeFile(
		path.join(root, "infra", "main.bicep"),
		overrides.main || "module storage 'storage' = {\n  params: {\n    allowSharedKeyAccess: false\n  }\n}\n",
	);
	await writeFile(
		path.join(root, "infra", "app", "api.bicep"),
		overrides.api || "var baseAppSettings = {\n  AzureWebJobsStorage__blobServiceUri: stg.properties.primaryEndpoints.blob\n}\n",
	);
	await writeFile(
		path.join(root, "infra", "app", "foundry.bicep"),
		overrides.foundry || "resource foundryAccount 'x' = {\n  properties: {\n    disableLocalAuth: true\n  }\n}\n",
	);
	return root;
}

test("already secure deployment templates remain byte-for-byte unchanged", async (t) => {
	const root = await templateFixture(t);
	const paths = [
		path.join(root, "infra", "main.bicep"),
		path.join(root, "infra", "app", "api.bicep"),
		path.join(root, "infra", "app", "foundry.bicep"),
	];
	const before = await Promise.all(paths.map((filePath) => readFile(filePath, "utf8")));
	await enforceIdentityOnlyDeploymentTemplate(root);
	assert.deepEqual(await Promise.all(paths.map((filePath) => readFile(filePath, "utf8"))), before);
});

test("deployment policy rejects a missing Storage shared-key declaration", async (t) => {
	const root = await templateFixture(t, { main: "module storage 'storage' = {}\n" });
	await assert.rejects(enforceIdentityOnlyDeploymentTemplate(root), /does not declare the Storage shared-key policy/);
});

test("deployment policy rejects Foundry configuration without a hosted-agent model setting", async (t) => {
	const root = await templateFixture(t, {
		main: "allowSharedKeyAccess: false\nAZURE_FUNCTIONS_AGENTS_PROVIDER: 'foundry'\n",
	});
	await assert.rejects(enforceIdentityOnlyDeploymentTemplate(root), /does not expose the hosted-agent model setting/);
});

test("deployment policy rejects unrecognized optional host-storage settings", async (t) => {
	const root = await templateFixture(t, {
		api: "var baseAppSettings = {\n  AzureWebJobsStorage__queueServiceUri: customQueueEndpoint\n}\n",
	});
	await assert.rejects(enforceIdentityOnlyDeploymentTemplate(root), /unrecognized optional host-storage settings/);
});

test("deployment policy flips an explicit Foundry local-auth setting", async (t) => {
	const root = await templateFixture(t, {
		foundry: "resource foundryAccount 'x' = {\n  properties: {\n    disableLocalAuth: false\n  }\n}\n",
	});
	await enforceIdentityOnlyDeploymentTemplate(root);
	assert.match(await readFile(path.join(root, "infra", "app", "foundry.bicep"), "utf8"), /disableLocalAuth: true/);
});