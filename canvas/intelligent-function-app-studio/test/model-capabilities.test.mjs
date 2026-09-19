import assert from "node:assert/strict";
import { test } from "./vitest-test.mjs";
import {
	classifyGatewayArmError,
	configuredModelBindingIsUsable,
	discoverModelCapabilities,
	gatewayRuntimeUrls,
	requireGatewayCapability,
} from "../model-capabilities.mjs";

test("Foundry discovery succeeds silently when optional Gateway ARM is unavailable", async () => {
	const discovery = await discoverModelCapabilities(
		async () => [{ id: "foundry-project" }],
		async () => {
			throw Object.assign(new Error("Provider Microsoft.ApiManagement is not registered"), {
				status: 409,
				code: "MissingSubscriptionRegistration",
			});
		},
	);
	assert.deepEqual(discovery.foundry, [{ id: "foundry-project" }]);
	assert.deepEqual(discovery.gateways, []);
	assert.equal(discovery.gatewayCapability.status, "registration");
});

test("explicit Gateway use surfaces API-version and RBAC guidance", () => {
	const version = classifyGatewayArmError(
		Object.assign(new Error("The api version is invalid"), { status: 400, code: "InvalidApiVersionParameter" }),
	);
	assert.equal(version.status, "api-version");
	assert.throws(() => requireGatewayCapability(version), /public preview/);

	const forbidden = classifyGatewayArmError(
		Object.assign(new Error("not authorized"), { status: 403, code: "AuthorizationFailed" }),
	);
	assert.equal(forbidden.status, "forbidden");
	assert.throws(() => requireGatewayCapability(forbidden), /not authorized/);
});

test("an existing configured Gateway binding remains usable without management discovery", () => {
	assert.equal(
		configuredModelBindingIsUsable({
			configured: true,
			activeSource: "gateway",
			activeModelId: "gpt",
		}),
		true,
	);
	assert.equal(configuredModelBindingIsUsable({ configured: false }), false);
});

test("successful model discovery reports an available Gateway capability", async () => {
	const discovery = await discoverModelCapabilities(
		async () => [{ id: "foundry" }],
		async () => [{ id: "gateway" }],
	);
	assert.deepEqual(discovery.gateways, [{ id: "gateway" }]);
	assert.equal(discovery.gatewayCapability.status, "available");
	assert.equal(discovery.gatewayCapability.statusCode, 200);
	assert.doesNotThrow(() => requireGatewayCapability(discovery.gatewayCapability));
});

test("Gateway error classification handles registration, authorization, and unknown failures", () => {
	const registration = classifyGatewayArmError({
		azureCode: "NoRegisteredProviderFound",
		azureMessage: "provider is not registered",
		statusCode: 409,
	});
	assert.equal(registration.status, "registration");
	assert.equal(registration.code, "NoRegisteredProviderFound");
	assert.equal(registration.detail, "provider is not registered");
	assert.equal(classifyGatewayArmError({ status: 401, message: "login" }).status, "forbidden");
	const unknown = classifyGatewayArmError(null);
	assert.equal(unknown.status, "error");
	assert.match(unknown.error, /Unknown Azure Resource Manager failure/);
	assert.throws(() => requireGatewayCapability(), (error) => {
		assert.equal(error.code, "GatewayCapabilityUnavailable");
		assert.equal(error.status, 0);
		return true;
	});
});

test("configured binding and runtime URL validation cover partial and custom workspace inputs", () => {
	for (const binding of [null, {}, { configured: true }, { configured: true, activeSource: "gateway" }]) {
		assert.equal(configuredModelBindingIsUsable(binding), false);
	}
	assert.deepEqual(gatewayRuntimeUrls("https://gateway.example///", "/team-a/"), {
		openAiBaseUrl: "https://gateway.example/team-a/models/openai/v1",
		githubMcpUrl: "https://gateway.example/team-a/toolservers/github/mcp",
	});
	assert.throws(() => gatewayRuntimeUrls("", "default"), /endpoint and workspace are required/);
	assert.throws(() => gatewayRuntimeUrls("https://gateway.example", " "), /endpoint and workspace are required/);
});
test("configured Gateway runtime stays on direct OpenAI HTTPS paths", () => {
	assert.deepEqual(gatewayRuntimeUrls("https://gateway.example/"), {
		openAiBaseUrl: "https://gateway.example/default/models/openai/v1",
		githubMcpUrl: "https://gateway.example/default/toolservers/github/mcp",
	});
});
