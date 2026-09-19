import assert from "node:assert/strict";
import { test } from "./vitest-test.mjs";
import {
	AI_GATEWAY_API_VERSION,
	DEFAULT_MODEL_TOKEN_LIMIT,
	UnsupportedPublicContractError,
	createGatewayResource,
	createGithubMcpServer,
	createRuntimeKey,
	foundryModelBody,
	importFoundryProvider,
	listGateways,
	listGithubMcpServers,
	listRuntimeKeys,
	mergeManagedPolicies,
	normalizeGateway,
	retrieveRuntimeKey,
	updateModelPolicies,
} from "../ai-gateway-arm.mjs";

function armStub({ request, list } = {}) {
	const calls = [];
	return {
		calls,
		async request(options) {
			calls.push({ type: "request", ...options });
			return request ? request(options, calls) : { body: {}, status: 200, headers: {}, etag: "" };
		},
		async list(options) {
			calls.push({ type: "list", ...options });
			return list ? list(options, calls) : [];
		},
	};
}

test("gateway endpoint normalization falls back to ARM hostname configuration", () => {
	assert.equal(
		normalizeGateway({
			id: "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.ApiManagement/service/gw",
			properties: { hostnameConfigurations: [{ hostName: "gw.example.azure-api.net" }] },
		}).endpoint,
		"https://gw.example.azure-api.net",
	);
});

test("gateway discovery filters AIGateway SKU and create uses the service compatibility payload", async () => {
	const arm = armStub({
		list: async () => [
			{ id: "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.ApiManagement/service/gw", name: "gw", sku: { name: "AIGateway" } },
			{ id: "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.ApiManagement/service/apim", name: "apim", sku: { name: "Developer" } },
		],
	});

	const gateways = await listGateways(arm, "sub");
	assert.equal(gateways.length, 1);
	assert.equal(gateways[0].resourceGroup, "rg");

	await createGatewayResource(arm, "sub", "rg-new", "gw-new", "eastus2", { owner: "studio" });
	const create = arm.calls.at(-1);
	assert.equal(create.method, "PUT");
	assert.equal(create.apiVersion, AI_GATEWAY_API_VERSION);
	assert.deepEqual(create.body, {
		location: "eastus2",
		sku: { name: "AIGateway", capacity: 1 },
		identity: { type: "SystemAssigned" },
		properties: {
			publisherEmail: "noreply@aigateway.azure.com",
			publisherName: "AI Gateway Administrator",
		},
		tags: { owner: "studio" },
	});
});

test("policy updates preserve unknown policies and use the current ETag", async () => {
	const arm = armStub({
		request: async (options) => {
			if (options.method === "PATCH") return { body: options.body, status: 200, etag: '"new"' };
			return {
				body: {
					properties: {
						policies: [
							{ type: "custom", keep: true },
							{ type: "tokenLimit", count: 1 },
							{ type: "tokenLimit", count: 2 },
							{ type: "contentSafety", hateSeverity: "Low" },
						],
					},
				},
				status: 200,
				etag: '"old"',
			};
		},
	});
	const result = await updateModelPolicies(
		arm,
		"sub",
		"/subscriptions/sub/resourceGroups/rg/providers/Microsoft.ApiManagement/service/gw",
		"foundry",
		"gpt",
		{ tokenLimit: 4000, contentSafety: "Medium" },
	);
	const patch = arm.calls.find((call) => call.method === "PATCH");
	assert.equal(patch.ifMatch, '"old"');
	assert.deepEqual(result.policies, [
		{ type: "custom", keep: true },
		{ type: "tokenLimit", period: "minute", count: 4000, counterKey: "Identity" },
		{
			type: "contentSafety",
			hateSeverity: "Medium",
			selfHarmSeverity: "Medium",
			sexualSeverity: "Medium",
			violenceSeverity: "Medium",
		},
	]);
});

test("policy updates refuse mutation when the model returns no ETag", async () => {
	const arm = armStub({ request: async () => ({ body: { properties: { policies: [] } }, status: 200 }) });
	await assert.rejects(
		() => updateModelPolicies(arm, "sub", "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.ApiManagement/service/gw", "p", "m", { tokenLimit: 1 }),
		/ETag/,
	);
	assert.equal(arm.calls.filter((call) => call.method === "PATCH").length, 0);
});

test("Foundry import ensures identity and RBAC, preflights collisions, and governs each created model", async () => {
	const gatewayId = "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.ApiManagement/service/gw";
	const foundryId = "/subscriptions/sub/resourceGroups/models/providers/Microsoft.CognitiveServices/accounts/foundry";
	const deployment = {
		id: `${foundryId}/deployments/gpt`,
		name: "gpt",
		sku: { capacity: 3 },
		properties: { model: { name: "gpt-5", version: "2026-01-01" } },
	};
	const arm = armStub({
		list: async (options) => {
			if (options.path.endsWith("/models")) return [];
			return [];
		},
		request: async (options) => {
			if (options.path === gatewayId && !options.method) {
				return {
					body: {
						id: gatewayId,
						name: "gw",
						identity: { type: "SystemAssigned", principalId: "principal" },
						properties: { provisioningState: "Succeeded" },
					},
					status: 200,
					etag: '"gateway"',
				};
			}
			if (options.path.endsWith("/modelProviders/foundry") && !options.method) {
				throw Object.assign(new Error("not found"), { status: 404 });
			}
			if (options.path.endsWith("/models/gpt") && !options.method) {
				return {
					body: { properties: { policies: [{ type: "custom", keep: true }] } },
					status: 200,
					etag: '"model"',
				};
			}
			return { body: options.body || {}, status: 200, etag: '"written"' };
		},
	});

	const result = await importFoundryProvider(arm, {
		subscription: "sub",
		gatewayId,
		foundryAccount: {
			id: foundryId,
			name: "foundry",
			properties: { endpoint: "https://foundry.example" },
		},
		deployments: [deployment],
	});
	assert.deepEqual(result.summary, { created: 1, unchanged: 0, failed: 0 });
	const role = arm.calls.find((call) => call.path?.includes("/roleAssignments/"));
	assert.equal(role.method, "PUT");
	assert.equal(role.body.properties.principalId, "principal");
	const provider = arm.calls.find((call) => call.method === "PUT" && call.path?.endsWith("/modelProviders/foundry"));
	assert.equal(provider.body.properties.foundry.endpoint, "https://foundry.example/");
	const model = arm.calls.find((call) => call.method === "PUT" && call.path?.endsWith("/models/gpt"));
	assert.equal(model.body.properties.deployment.resourceId, deployment.id);
	assert.equal(model.body.properties.modelName, "gpt");
	assert.equal(model.body.properties.modelVersion, "2026-01-01");
	assert.equal(model.body.properties.policies[0].count, 3000);
	const policy = arm.calls.find((call) => call.method === "PATCH" && call.path?.endsWith("/models/gpt"));
	assert.equal(policy.ifMatch, '"model"');
	assert.equal(policy.body.properties.policies[0].type, "custom");
});

test("Foundry model payload uses the documented defaults when deployment capacity is absent", () => {
	const body = foundryModelBody({
		id: "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.CognitiveServices/accounts/f/deployments/d",
		name: "d",
		properties: { model: { name: "model" } },
	});
	assert.equal(body.properties.policies[0].count, DEFAULT_MODEL_TOKEN_LIMIT);
	assert.deepEqual(
		mergeManagedPolicies(body.properties.policies, { contentSafety: "Medium" }).map((policy) => policy.type),
		["tokenLimit", "contentSafety"],
	);
});

test("runtime key create/listSecrets separates metadata from secret retrieval", async () => {
	const gatewayId = "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.ApiManagement/service/gw";
	const arm = armStub({
		request: async (options) =>
			options.path.endsWith("/listSecrets")
				? { body: { primaryKey: "secret-value" }, status: 200 }
				: { body: options.body, status: 201 },
	});
	await createRuntimeKey(arm, "sub", gatewayId, "runtime", "Runtime key");
	const secret = await retrieveRuntimeKey(arm, "sub", gatewayId, "runtime");
	assert.equal(secret, "secret-value");
	assert.deepEqual(arm.calls[0].body, { properties: { displayName: "Runtime key" } });
	assert.equal(arm.calls[1].sensitiveResponse, true);
});

test("runtime key inventory redacts unexpected secret fields", async () => {
	const gatewayId = "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.ApiManagement/service/gw";
	const arm = armStub({
		list: async () => [{ name: "runtime", properties: { displayName: "Runtime", primaryKey: "must-not-leak" } }],
	});
	const keys = await listRuntimeKeys(arm, "sub", gatewayId);
	assert.equal(keys[0].properties.displayName, "Runtime");
	assert.equal(keys[0].properties.primaryKey, "[redacted]");
});

test("GitHub MCP operations fail closed before any management request", async () => {
	let calls = 0;
	const arm = {
		request: async () => { calls += 1; },
		list: async () => { calls += 1; },
	};
	await assert.rejects(() => listGithubMcpServers(arm), UnsupportedPublicContractError);
	await assert.rejects(() => createGithubMcpServer(arm), UnsupportedPublicContractError);
	assert.equal(calls, 0);
});
