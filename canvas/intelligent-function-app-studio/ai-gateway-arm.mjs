import { createHash } from "node:crypto";
import { redactSensitive } from "./arm-rest.mjs";

export const AI_GATEWAY_API_VERSION = "2025-09-01-preview";
export const COGNITIVE_SERVICES_API_VERSION = "2025-04-01-preview";
export const AUTHORIZATION_API_VERSION = "2022-04-01";
export const RESOURCE_GROUP_API_VERSION = "2024-03-01";
export const AI_GATEWAY_WORKSPACE = "default";
export const FOUNDRY_USER_ROLE_ID = "53ca6127-db72-4b80-b1b0-d745d6d5456d";
export const DEFAULT_MODEL_TOKEN_LIMIT = 10000;
export const DEFAULT_CONTENT_SAFETY = "Medium";
export const SUPPORTED_MODEL_ENDPOINTS = Object.freeze([
	"/openai/v1/chat/completions",
	"/openai/v1/responses",
]);

const UUID_URL_NAMESPACE = "6ba7b8119dad11d180b400c04fd430c8";

function segment(value, label) {
	const text = String(value || "").trim();
	if (!text || text.includes("/")) throw new Error(`Invalid ${label}.`);
	return encodeURIComponent(text);
}

export function resourceGroupPath(subscription, resourceGroup) {
	return `/subscriptions/${segment(subscription, "subscription")}/resourceGroups/${segment(resourceGroup, "resource group")}`;
}

export function gatewayCollectionPath(subscription) {
	return `/subscriptions/${segment(subscription, "subscription")}/providers/Microsoft.ApiManagement/service`;
}

export function gatewayResourcePath(subscription, resourceGroup, gatewayName) {
	return `${resourceGroupPath(subscription, resourceGroup)}/providers/Microsoft.ApiManagement/service/${segment(gatewayName, "gateway name")}`;
}

export function workspaceResourcePath(gatewayId) {
	return `${String(gatewayId || "").replace(/\/+$/, "")}/workspaces/${AI_GATEWAY_WORKSPACE}`;
}

export function providerResourcePath(gatewayId, providerName) {
	return `${workspaceResourcePath(gatewayId)}/modelProviders/${segment(providerName, "provider name")}`;
}

export function modelResourcePath(gatewayId, providerName, modelName) {
	return `${providerResourcePath(gatewayId, providerName)}/models/${segment(modelName, "model name")}`;
}

export function apiKeyResourcePath(gatewayId, keyName = "default") {
	return `${String(gatewayId || "").replace(/\/+$/, "")}/apiKeys/${segment(keyName, "API key name")}`;
}

export function resourceSegment(resourceId, name) {
	const parts = String(resourceId || "").split("/").filter(Boolean);
	const index = parts.findIndex((part) => part.toLowerCase() === String(name).toLowerCase());
	return index >= 0 ? decodeURIComponent(parts[index + 1] || "") : "";
}

export function normalizeGateway(gateway) {
	const properties = gateway?.properties || {};
	const hostname =
		properties.hostnameConfigurations?.find((item) => item?.hostName)?.hostName ||
		properties.gatewayHostname ||
		"";
	const host = String(
		properties.gatewayUrl ||
		properties.gatewayRuntimeUrl ||
		(hostname ? `https://${hostname}` : ""),
	).replace(/\/+$/, "");
	return {
		id: String(gateway?.id || ""),
		name: String(gateway?.name || ""),
		resourceGroup: resourceSegment(gateway?.id, "resourceGroups"),
		location: String(gateway?.location || ""),
		endpoint: host,
		state: String(properties.provisioningState || ""),
		identity: {
			type: String(gateway?.identity?.type || ""),
			principalId: String(gateway?.identity?.principalId || ""),
			tenantId: String(gateway?.identity?.tenantId || ""),
		},
	};
}

export function normalizeProvider(provider) {
	const properties = provider?.properties || {};
	return {
		name: String(provider?.name || ""),
		kind: String(properties.kind || properties.providerKind || ""),
		displayName: String(properties.displayName || provider?.name || ""),
		state: String(properties.state || properties.provisioningState || ""),
	};
}

export function normalizeModel(model, providerKinds = new Map()) {
	const properties = model?.properties || {};
	const providerName = resourceSegment(model?.id, "modelProviders") || String(properties.providerName || "");
	const policies = Array.isArray(properties.policies) ? properties.policies : [];
	const tokenPolicy = policies.find((policy) => policy?.type === "tokenLimit");
	const safetyPolicy = policies.find((policy) => policy?.type === "contentSafety");
	const deployment = properties.deployment || {};
	return {
		id: String(model?.name || ""),
		label: String(properties.displayName || model?.name || ""),
		modelProvider: providerName,
		providerKind: String(properties.providerKind || providerKinds.get(providerName) || ""),
		modelName: String(properties.modelName || deployment.modelName || model?.name || ""),
		modelVersion: String(properties.modelVersion || deployment.modelVersion || ""),
		state: String(properties.state || properties.provisioningState || ""),
		tpm: tokenPolicy ? Number(tokenPolicy.count) : null,
		tpmPeriod: tokenPolicy ? String(tokenPolicy.period || "minute") : null,
		counterKey: tokenPolicy ? String(tokenPolicy.counterKey || "Identity") : null,
		safety: Boolean(safetyPolicy),
		safetyPolicy: safetyPolicy
			? {
					hate: String(safetyPolicy.hateSeverity || ""),
					selfHarm: String(safetyPolicy.selfHarmSeverity || ""),
					sexual: String(safetyPolicy.sexualSeverity || ""),
					violence: String(safetyPolicy.violenceSeverity || ""),
				}
			: null,
	};
}

export function gatewayCreateBody(location, tags = {}) {
	return {
		location,
		sku: { name: "AIGateway", capacity: 1 },
		identity: { type: "SystemAssigned" },
		properties: {
			publisherEmail: "noreply@aigateway.azure.com",
			publisherName: "AI Gateway Administrator",
		},
		tags,
	};
}

export function foundryProviderBody(foundryResourceId, endpoint, displayName) {
	return {
		properties: {
			kind: "Foundry",
			displayName,
			foundry: {
				endpoint: `${String(endpoint || "").replace(/\/+$/, "")}/`,
				resourceIds: [foundryResourceId],
				authentication: {
					kind: "ManagedIdentity",
					managedIdentity: { resource: "https://cognitiveservices.azure.com/" },
				},
			},
		},
	};
}

export function tokenLimitPolicy(count) {
	const parsed = Number(count);
	if (!Number.isInteger(parsed) || parsed <= 0) throw new Error("Token limit must be a positive integer.");
	return { type: "tokenLimit", period: "minute", count: parsed, counterKey: "Identity" };
}

export function contentSafetyPolicy(severity = DEFAULT_CONTENT_SAFETY) {
	const value = String(severity || "").trim();
	if (!value) throw new Error("Content-safety severity is required.");
	return {
		type: "contentSafety",
		hateSeverity: value,
		selfHarmSeverity: value,
		sexualSeverity: value,
		violenceSeverity: value,
	};
}

export function foundryModelBody(deployment, policies) {
	const deploymentName = String(deployment?.name || "").trim();
	const deploymentResourceId = String(deployment?.id || "").trim();
	if (!deploymentName || !deploymentResourceId) throw new Error("Foundry deployment name and resource ID are required.");
	const properties = deployment?.properties || {};
	const model = properties.model || {};
	const body = {
		properties: {
			displayName: String(model.name || deploymentName),
			apiFormat: "OpenAIChatCompletions",
			supportedEndpoints: [...SUPPORTED_MODEL_ENDPOINTS],
			deployment: {
				resourceId: deploymentResourceId,
			},
			modelName: deploymentName,
			policies: policies || [
				tokenLimitPolicy(
					Number.isFinite(Number(deployment?.sku?.capacity)) && Number(deployment.sku.capacity) > 0
						? Number(deployment.sku.capacity) * 1000
						: DEFAULT_MODEL_TOKEN_LIMIT,
				),
			],
		},
	};
	if (model.version) body.properties.modelVersion = String(model.version);
	return body;
}

function replaceManagedPolicy(policies, type, replacement) {
	const next = [];
	let replaced = false;
	for (const policy of policies) {
		if (policy?.type !== type) {
			next.push(policy);
			continue;
		}
		if (!replaced) {
			next.push(replacement);
			replaced = true;
		}
	}
	if (!replaced) next.push(replacement);
	return next;
}

/** @param {unknown} existingPolicies @param {{ tokenLimit?: number | string | null, contentSafety?: string | null }} [change] */
export function mergeManagedPolicies(existingPolicies, { tokenLimit, contentSafety } = {}) {
	let policies = Array.isArray(existingPolicies) ? [...existingPolicies] : [];
	if (tokenLimit != null) policies = replaceManagedPolicy(policies, "tokenLimit", tokenLimitPolicy(tokenLimit));
	if (contentSafety) policies = replaceManagedPolicy(policies, "contentSafety", contentSafetyPolicy(contentSafety));
	if (tokenLimit == null && !contentSafety) throw new Error("A model policy change is required.");
	return policies;
}

export class UnsupportedPublicContractError extends Error {
	constructor(operation) {
		super(
			`${operation} is unavailable because Microsoft has not published an exact public REST contract for AI Gateway GitHub MCP registrations. No private or guessed endpoint was called.`,
		);
		this.name = "UnsupportedPublicContractError";
		this.code = "unsupportedPublicContract";
		this.operation = operation;
	}
}

export async function listGithubMcpServers() {
	throw new UnsupportedPublicContractError("GitHub MCP list");
}

export async function createGithubMcpServer() {
	throw new UnsupportedPublicContractError("GitHub MCP create");
}

export async function listGateways(arm, subscription) {
	const rows = await arm.list({
		subscription,
		path: gatewayCollectionPath(subscription),
		apiVersion: AI_GATEWAY_API_VERSION,
	});
	return rows.filter((row) => String(row?.sku?.name || "").toLowerCase() === "aigateway").map(normalizeGateway);
}

export async function getGateway(arm, subscription, gatewayId) {
	const result = await arm.request({
		subscription,
		path: gatewayId,
		apiVersion: AI_GATEWAY_API_VERSION,
	});
	return { ...result, gateway: normalizeGateway(result.body) };
}

export async function createGatewayResource(arm, subscription, resourceGroup, gatewayName, location, tags = {}) {
	return arm.request({
		subscription,
		path: gatewayResourcePath(subscription, resourceGroup, gatewayName),
		apiVersion: AI_GATEWAY_API_VERSION,
		method: "PUT",
		body: gatewayCreateBody(location, tags),
	});
}

export async function waitForGatewayReady(
	arm,
	subscription,
	gatewayId,
	{ attempts = 60, delay = async () => new Promise((resolve) => setTimeout(resolve, 5000)) } = {},
) {
	let lastError = null;
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		try {
			const current = await getGateway(arm, subscription, gatewayId);
			const state = current.gateway.state.toLowerCase();
			if (!state || state === "succeeded") return current.gateway;
			if (["failed", "canceled", "cancelled"].includes(state)) {
				throw new Error(`AI Gateway provisioning ended in state ${current.gateway.state}.`);
			}
		} catch (error) {
			if (error?.status !== 404) throw error;
			lastError = error;
		}
		if (attempt + 1 < attempts) await delay();
	}
	throw lastError || new Error("AI Gateway provisioning did not complete before the timeout.");
}

export async function createResourceGroup(arm, subscription, resourceGroup, location, tags = {}) {
	return arm.request({
		subscription,
		path: resourceGroupPath(subscription, resourceGroup),
		apiVersion: RESOURCE_GROUP_API_VERSION,
		method: "PUT",
		body: { location, tags },
	});
}

export async function listProviders(arm, subscription, gatewayId) {
	return arm.list({
		subscription,
		path: `${workspaceResourcePath(gatewayId)}/modelProviders`,
		apiVersion: AI_GATEWAY_API_VERSION,
	});
}

export async function listModels(arm, subscription, gatewayId, providerName = "") {
	return arm.list({
		subscription,
		path: providerName
			? `${providerResourcePath(gatewayId, providerName)}/models`
			: `${workspaceResourcePath(gatewayId)}/models`,
		apiVersion: AI_GATEWAY_API_VERSION,
	});
}

export async function listRuntimeKeys(arm, subscription, gatewayId) {
	const keys = await arm.list({
		subscription,
		path: `${String(gatewayId || "").replace(/\/+$/, "")}/apiKeys`,
		apiVersion: AI_GATEWAY_API_VERSION,
	});
	return redactSensitive(keys);
}

export async function createRuntimeKey(arm, subscription, gatewayId, keyName = "default", displayName = keyName) {
	return arm.request({
		subscription,
		path: apiKeyResourcePath(gatewayId, keyName),
		apiVersion: AI_GATEWAY_API_VERSION,
		method: "PUT",
		body: { properties: { displayName } },
	});
}

export async function retrieveRuntimeKey(arm, subscription, gatewayId, keyName = "default") {
	const result = await arm.request({
		subscription,
		path: `${apiKeyResourcePath(gatewayId, keyName)}/listSecrets`,
		apiVersion: AI_GATEWAY_API_VERSION,
		method: "POST",
		body: {},
		sensitiveResponse: true,
	});
	const key = result.body?.primaryKey || result.body?.secondaryKey;
	if (!key) throw new Error(`AI Gateway key ${keyName} returned no usable secret.`);
	return String(key);
}

export async function updateModelPolicies(
	arm,
	subscription,
	gatewayId,
	providerName,
	modelName,
	change,
) {
	const path = modelResourcePath(gatewayId, providerName, modelName);
	const current = await arm.request({
		subscription,
		path,
		apiVersion: AI_GATEWAY_API_VERSION,
	});
	const etag = current.etag || current.body?.etag;
	if (!etag) throw new Error(`AI Gateway model ${modelName} did not return an ETag; refusing an unsafe policy update.`);
	const policies = mergeManagedPolicies(current.body?.properties?.policies, change);
	const updated = await arm.request({
		subscription,
		path,
		apiVersion: AI_GATEWAY_API_VERSION,
		method: "PATCH",
		ifMatch: etag,
		body: { properties: { policies } },
	});
	return { ...updated, policies };
}

export async function listFoundryAccounts(arm, subscription) {
	const rows = await arm.list({
		subscription,
		path: `/subscriptions/${segment(subscription, "subscription")}/providers/Microsoft.CognitiveServices/accounts`,
		apiVersion: COGNITIVE_SERVICES_API_VERSION,
	});
	return rows.filter((row) => String(row?.kind || "").toLowerCase() === "aiservices");
}

export async function listFoundryDeployments(arm, subscription, accountId) {
	return arm.list({
		subscription,
		path: `${String(accountId || "").replace(/\/+$/, "")}/deployments`,
		apiVersion: COGNITIVE_SERVICES_API_VERSION,
	});
}

function uuidBytes(value) {
	return Buffer.from(String(value).replaceAll("-", ""), "hex");
}

function bytesToUuid(bytes) {
	const hex = Buffer.from(bytes).toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function deterministicRoleAssignmentId(...parts) {
	const namespace = uuidBytes(UUID_URL_NAMESPACE);
	const digest = createHash("sha1")
		.update(namespace)
		.update(parts.map((part) => String(part || "").toLowerCase()).join("|"))
		.digest()
		.subarray(0, 16);
	digest[6] = (digest[6] & 0x0f) | 0x50;
	digest[8] = (digest[8] & 0x3f) | 0x80;
	return bytesToUuid(digest);
}

function contains(current, expected) {
	if (Array.isArray(expected)) {
		return Array.isArray(current) && current.length === expected.length && expected.every((item, index) => contains(current[index], item));
	}
	if (expected && typeof expected === "object") {
		return Boolean(current && typeof current === "object") &&
			Object.entries(expected).every(([key, value]) => contains(current[key], value));
	}
	return current === expected;
}

async function getOptional(arm, options) {
	try {
		return await arm.request(options);
	} catch (error) {
		if (error?.status === 404) return null;
		throw error;
	}
}

export async function ensureGatewayIdentity(
	arm,
	subscription,
	gatewayId,
	{ attempts = 20, delay = async () => new Promise((resolve) => setTimeout(resolve, 3000)) } = {},
) {
	let current = await getGateway(arm, subscription, gatewayId);
	if (!current.gateway.identity.principalId) {
		await arm.request({
			subscription,
			path: gatewayId,
			apiVersion: AI_GATEWAY_API_VERSION,
			method: "PATCH",
			ifMatch: current.etag || current.body?.etag,
			body: { identity: { type: "SystemAssigned" } },
		});
	}
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		current = await getGateway(arm, subscription, gatewayId);
		if (current.gateway.identity.principalId) return current.gateway;
		if (attempt + 1 < attempts) await delay();
	}
	throw new Error("AI Gateway system identity did not produce a principal ID before the timeout.");
}

export async function ensureFoundryRoleAssignment(arm, subscription, foundryResourceId, gatewayId, principalId) {
	const roleDefinitionId =
		`/subscriptions/${segment(subscription, "subscription")}/providers/Microsoft.Authorization/roleDefinitions/${FOUNDRY_USER_ROLE_ID}`;
	const assignmentId = deterministicRoleAssignmentId(foundryResourceId, gatewayId, principalId, roleDefinitionId);
	try {
		return await arm.request({
			subscription,
			path: `${foundryResourceId}/providers/Microsoft.Authorization/roleAssignments/${assignmentId}`,
			apiVersion: AUTHORIZATION_API_VERSION,
			method: "PUT",
			body: {
				properties: {
					principalId,
					roleDefinitionId,
					principalType: "ServicePrincipal",
				},
			},
		});
	} catch (error) {
		if (error?.status === 409) return { body: null, status: 409, unchanged: true };
		throw error;
	}
}

export async function importFoundryProvider(
	arm,
	{
		subscription,
		gatewayId,
		foundryAccount,
		deployments,
		contentSafety = DEFAULT_CONTENT_SAFETY,
		identityOptions,
	},
) {
	const accountId = String(foundryAccount?.id || "");
	const providerName = String(foundryAccount?.name || resourceSegment(accountId, "accounts"));
	const endpoint =
		foundryAccount?.properties?.endpoint ||
		foundryAccount?.properties?.endpoints?.["AI Foundry API"] ||
		"";
	if (!accountId || !providerName || !endpoint) throw new Error("Foundry account ID, name, and endpoint are required.");

	const gateway = await ensureGatewayIdentity(arm, subscription, gatewayId, identityOptions);
	await ensureFoundryRoleAssignment(arm, subscription, accountId, gatewayId, gateway.identity.principalId);

	const providerPath = providerResourcePath(gatewayId, providerName);
	const expectedProvider = foundryProviderBody(accountId, endpoint, providerName);
	const existingProvider = await getOptional(arm, {
		subscription,
		path: providerPath,
		apiVersion: AI_GATEWAY_API_VERSION,
	});
	if (existingProvider && !contains(existingProvider.body, expectedProvider)) {
		throw new Error(`Model provider ${providerName} already exists with a different configuration.`);
	}
	if (!existingProvider) {
		await arm.request({
			subscription,
			path: providerPath,
			apiVersion: AI_GATEWAY_API_VERSION,
			method: "PUT",
			body: expectedProvider,
		});
	}

	const registered = await listModels(arm, subscription, gatewayId);
	const registeredByName = new Map(registered.map((model) => [String(model?.name || "").toLowerCase(), model]));
	const results = [];
	for (const deployment of deployments || []) {
		const name = String(deployment?.name || "");
		const existing = registeredByName.get(name.toLowerCase());
		const existingProvider = resourceSegment(existing?.id, "modelProviders");
		const existingDeployment = String(existing?.properties?.deployment?.resourceId || "");
		if (existing) {
			if (
				existingProvider.toLowerCase() === providerName.toLowerCase() &&
				existingDeployment.toLowerCase() === String(deployment.id || "").toLowerCase()
			) {
				results.push({ name, status: "unchanged" });
			} else {
				results.push({ name, status: "failed", error: "A gateway-wide model registration with this name already exists." });
			}
			continue;
		}
		try {
			const body = foundryModelBody(deployment);
			await arm.request({
				subscription,
				path: modelResourcePath(gatewayId, providerName, name),
				apiVersion: AI_GATEWAY_API_VERSION,
				method: "PUT",
				body,
			});
			const capacity = Number(deployment?.sku?.capacity);
			await updateModelPolicies(arm, subscription, gatewayId, providerName, name, {
				tokenLimit: Number.isFinite(capacity) && capacity > 0 ? capacity * 1000 : DEFAULT_MODEL_TOKEN_LIMIT,
				contentSafety,
			});
			results.push({ name, status: "created" });
		} catch (error) {
			results.push({ name, status: "failed", error: String(error?.message || error) });
		}
	}
	return {
		providerName,
		models: results,
		summary: {
			created: results.filter((item) => item.status === "created").length,
			unchanged: results.filter((item) => item.status === "unchanged").length,
			failed: results.filter((item) => item.status === "failed").length,
		},
	};
}
