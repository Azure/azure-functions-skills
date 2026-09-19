import assert from "node:assert/strict";
import { test } from "./vitest-test.mjs";
import {
	apiKeyResourcePath,
	contentSafetyPolicy,
	createResourceGroup,
	deterministicRoleAssignmentId,
	ensureFoundryRoleAssignment,
	ensureGatewayIdentity,
	foundryModelBody,
	foundryProviderBody,
	gatewayCollectionPath,
	gatewayCreateBody,
	gatewayResourcePath,
	getGateway,
	listFoundryAccounts,
	listFoundryDeployments,
	listModels,
	listProviders,
	mergeManagedPolicies,
	modelResourcePath,
	normalizeGateway,
	normalizeModel,
	normalizeProvider,
	providerResourcePath,
	resourceGroupPath,
	resourceSegment,
	retrieveRuntimeKey,
	tokenLimitPolicy,
	waitForGatewayReady,
	workspaceResourcePath,
} from "../ai-gateway-arm.mjs";

function armStub({ request, list } = {}) {
	const calls = [];
	return {
		calls,
		async request(options) {
			calls.push({ type: "request", ...options });
			return request ? request(options, calls) : { body: {}, status: 200, etag: "" };
		},
		async list(options) {
			calls.push({ type: "list", ...options });
			return list ? list(options, calls) : [];
		},
	};
}

test("resource paths encode valid segments and reject empty or slash-bearing names", () => {
	const gatewayId = "/subscriptions/sub one/resourceGroups/rg/providers/Microsoft.ApiManagement/service/gateway/";
	assert.equal(resourceGroupPath("sub one", "rg one"), "/subscriptions/sub%20one/resourceGroups/rg%20one");
	assert.equal(gatewayCollectionPath("sub one"), "/subscriptions/sub%20one/providers/Microsoft.ApiManagement/service");
	assert.equal(
		gatewayResourcePath("sub", "rg", "gateway one"),
		"/subscriptions/sub/resourceGroups/rg/providers/Microsoft.ApiManagement/service/gateway%20one",
	);
	assert.equal(workspaceResourcePath(gatewayId), `${gatewayId.slice(0, -1)}/workspaces/default`);
	assert.equal(
		providerResourcePath(gatewayId, "provider one"),
		`${gatewayId.slice(0, -1)}/workspaces/default/modelProviders/provider%20one`,
	);
	assert.equal(
		modelResourcePath(gatewayId, "provider", "model one"),
		`${gatewayId.slice(0, -1)}/workspaces/default/modelProviders/provider/models/model%20one`,
	);
	assert.equal(apiKeyResourcePath(gatewayId), `${gatewayId.slice(0, -1)}/apiKeys/default`);
	assert.equal(resourceSegment("/resourceGroups/rg%20one/providers/Test", "RESOURCEGROUPS"), "rg one");
	assert.equal(resourceSegment("/subscriptions/sub", "missing"), "");
	assert.throws(() => resourceGroupPath("", "rg"), /Invalid subscription/);
	assert.throws(() => providerResourcePath(gatewayId, "bad/name"), /Invalid provider name/);
});

test("gateway, provider, and model normalization honor documented fallback fields", () => {
	assert.deepEqual(
		normalizeGateway({
			id: "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.ApiManagement/service/gw",
			name: "gw",
			location: "eastus2",
			identity: { type: "SystemAssigned", principalId: "principal", tenantId: "tenant" },
			properties: { gatewayRuntimeUrl: "https://runtime.example/", provisioningState: "Succeeded" },
		}),
		{
			id: "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.ApiManagement/service/gw",
			name: "gw",
			resourceGroup: "rg",
			location: "eastus2",
			endpoint: "https://runtime.example",
			state: "Succeeded",
			identity: { type: "SystemAssigned", principalId: "principal", tenantId: "tenant" },
		},
	);
	assert.equal(normalizeGateway({ properties: { gatewayHostname: "host.example" } }).endpoint, "https://host.example");
	assert.deepEqual(normalizeProvider({ name: "provider", properties: { providerKind: "Foundry", provisioningState: "Ready" } }), {
		name: "provider",
		kind: "Foundry",
		displayName: "provider",
		state: "Ready",
	});
	const normalized = normalizeModel(
		{
			id: "/workspaces/default/modelProviders/provider/models/model",
			name: "model",
			properties: {
				deployment: { modelName: "gpt", modelVersion: "1" },
				policies: [
					{ type: "tokenLimit", count: "4000" },
					{ type: "contentSafety", hateSeverity: "High", selfHarmSeverity: "Low" },
				],
			},
		},
		new Map([["provider", "Foundry"]]),
	);
	assert.equal(normalized.providerKind, "Foundry");
	assert.equal(normalized.modelName, "gpt");
	assert.equal(normalized.modelVersion, "1");
	assert.equal(normalized.tpm, 4000);
	assert.deepEqual(normalized.safetyPolicy, { hate: "High", selfHarm: "Low", sexual: "", violence: "" });
	assert.equal(normalizeModel({ name: "empty" }).safetyPolicy, null);
});

test("gateway and Foundry request bodies validate policy and deployment inputs", () => {
	assert.deepEqual(gatewayCreateBody("westus", { owner: "test" }).tags, { owner: "test" });
	assert.equal(
		foundryProviderBody("/accounts/foundry", "https://foundry.example/", "Foundry").properties.foundry.endpoint,
		"https://foundry.example/",
	);
	assert.equal(tokenLimitPolicy("42").count, 42);
	assert.throws(() => tokenLimitPolicy(0), /positive integer/);
	assert.throws(() => tokenLimitPolicy(1.5), /positive integer/);
	assert.equal(contentSafetyPolicy().hateSeverity, "Medium");
	assert.throws(() => contentSafetyPolicy(" "), /severity is required/);
	const deploymentBody = foundryModelBody({
		id: "/accounts/foundry/deployments/gpt",
		name: "deployment",
		properties: { model: { name: "gpt", version: "2026-01" } },
		sku: { capacity: 2 },
	});
	assert.equal(deploymentBody.properties.modelVersion, "2026-01");
	assert.equal(deploymentBody.properties.policies[0].count, 2000);
	assert.throws(() => foundryModelBody({ name: "missing-id" }), /name and resource ID are required/);
	assert.throws(() => mergeManagedPolicies([]), /policy change is required/);
	assert.deepEqual(
		mergeManagedPolicies(
			[{ type: "custom" }, { type: "tokenLimit", count: 1 }, { type: "tokenLimit", count: 2 }],
			{ tokenLimit: 10, contentSafety: "High" },
		).map((policy) => policy.type),
		["custom", "tokenLimit", "contentSafety"],
	);
});

test("gateway collection operations use expected ARM paths and API versions", async () => {
	const arm = armStub({
		request: async (options) => ({
			body: { id: options.path, name: "gw", properties: { provisioningState: "Succeeded" } },
			status: 200,
			etag: '"etag"',
		}),
		list: async (options) =>
			options.path.endsWith("/accounts")
				? [{ kind: "AIServices", name: "foundry" }, { kind: "OpenAI", name: "other" }]
				: [{ name: "row" }],
	});
	const gatewayId = "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.ApiManagement/service/gw";
	assert.equal((await getGateway(arm, "sub", gatewayId)).gateway.state, "Succeeded");
	await createResourceGroup(arm, "sub", "rg", "eastus2", { owner: "test" });
	assert.equal((await listProviders(arm, "sub", gatewayId))[0].name, "row");
	assert.equal((await listModels(arm, "sub", gatewayId, "provider"))[0].name, "row");
	assert.equal((await listModels(arm, "sub", gatewayId))[0].name, "row");
	assert.deepEqual(await listFoundryAccounts(arm, "sub"), [{ kind: "AIServices", name: "foundry" }]);
	assert.equal((await listFoundryDeployments(arm, "sub", "/accounts/foundry/"))[0].name, "row");
	assert.ok(arm.calls.some((call) => call.method === "PUT" && call.body.location === "eastus2"));
});

test("gateway provisioning polling handles not-found, pending, failed, and timeout states", async () => {
	let read = 0;
	let delays = 0;
	const arm = armStub({
		request: async () => {
			read += 1;
			if (read === 1) throw Object.assign(new Error("not ready"), { status: 404 });
			return { body: { properties: { provisioningState: read === 2 ? "Provisioning" : "Succeeded" } } };
		},
	});
	assert.equal(
		(await waitForGatewayReady(arm, "sub", "/gateways/gw", {
			attempts: 4,
			delay: async () => { delays += 1; },
		})).state,
		"Succeeded",
	);
	assert.equal(delays, 2);
	await assert.rejects(
		waitForGatewayReady(
			armStub({ request: async () => ({ body: { properties: { provisioningState: "Failed" } } }) }),
			"sub",
			"/gateways/failed",
			{ attempts: 1 },
		),
		/ended in state Failed/,
	);
	await assert.rejects(
		waitForGatewayReady(
			armStub({ request: async () => ({ body: { properties: { provisioningState: "Provisioning" } } }) }),
			"sub",
			"/gateways/slow",
			{ attempts: 1 },
		),
		/did not complete/,
	);
});

test("identity and role setup poll safely and treat existing assignments as unchanged", async () => {
	let reads = 0;
	let patches = 0;
	const arm = armStub({
		request: async (options) => {
			if (options.method === "PATCH") {
				patches += 1;
				return { body: {}, status: 200 };
			}
			reads += 1;
			return {
				body: {
					identity: { type: "SystemAssigned", principalId: reads >= 3 ? "principal" : "" },
					properties: { provisioningState: "Succeeded" },
				},
				etag: '"etag"',
			};
		},
	});
	const gateway = await ensureGatewayIdentity(arm, "sub", "/gateways/gw", { attempts: 3, delay: async () => {} });
	assert.equal(gateway.identity.principalId, "principal");
	assert.equal(patches, 1);
	const roleId = deterministicRoleAssignmentId("A", "B", "C");
	assert.match(roleId, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
	assert.equal(roleId, deterministicRoleAssignmentId("a", "b", "c"));
	const unchanged = await ensureFoundryRoleAssignment(
		armStub({ request: async () => { throw Object.assign(new Error("exists"), { status: 409 }); } }),
		"sub",
		"/accounts/foundry",
		"/gateways/gw",
		"principal",
	);
	assert.equal(unchanged.unchanged, true);
});

test("runtime key retrieval rejects responses without a usable key", async () => {
	await assert.rejects(
		retrieveRuntimeKey(armStub({ request: async () => ({ body: {}, status: 200 }) }), "sub", "/gateways/gw", "missing"),
		/returned no usable secret/,
	);
});