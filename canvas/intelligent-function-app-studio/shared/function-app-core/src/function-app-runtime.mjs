import { randomUUID } from "node:crypto";
import { redactSensitive } from "./arm-rest.mjs";

export const APP_SERVICE_API_VERSION = "2024-11-01";
export const STORAGE_API_VERSION = "2023-11-03";
export const STORAGE_RESOURCE = "https://storage.azure.com/";

const MAX_RUNTIME_RESPONSE = 64 * 1024;
const QUEUE_NAME_RE = /^[a-z0-9](?!.*--)[a-z0-9-]{1,61}[a-z0-9]$/;
const STORAGE_QUEUE_HOST_RE =
	/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]\.queue\.(?:core\.windows\.net|core\.usgovcloudapi\.net|core\.cloudapi\.de|core\.chinacloudapi\.cn)$/i;

const TRIGGER_LABELS = new Map([
	["httptrigger", "HTTP"],
	["timertrigger", "Timer"],
	["queuetrigger", "Queue"],
	["blobtrigger", "Blob"],
	["servicebustrigger", "Service Bus"],
	["eventhubtrigger", "Event Hubs"],
	["eventgridtrigger", "Event Grid"],
	["cosmosdbtrigger", "Cosmos DB"],
	["kafkatrigger", "Kafka"],
	["rabbitmqtrigger", "RabbitMQ"],
	["orchestrationtrigger", "Durable orchestration"],
	["activitytrigger", "Durable activity"],
	["entitytrigger", "Durable entity"],
]);

function parseConfig(value) {
	if (!value) return {};
	if (typeof value === "object") return value;
	try {
		return JSON.parse(value);
	} catch {
		return {};
	}
}

function cleanString(value) {
	return typeof value === "string" ? value.trim() : "";
}

function functionName(envelope) {
	const config = parseConfig(envelope?.properties?.config ?? envelope?.config);
	return (
		cleanString(config.name) ||
		cleanString(envelope?.name)
			.split("/")
			.filter(Boolean)
			.at(-1) ||
		"unnamed"
	);
}

function safeInvokeUrl(value) {
	const raw = cleanString(value);
	if (!raw) return "";
	try {
		const url = new URL(raw);
		if (url.protocol !== "https:") return "";
		url.username = "";
		url.password = "";
		for (const key of [...url.searchParams.keys()]) {
			if (/^(?:code|sig|signature|token|access_token)$/i.test(key)) url.searchParams.delete(key);
		}
		return url.toString();
	} catch {
		return "";
	}
}

function safeBinding(binding) {
	return {
		type: cleanString(binding?.type),
		direction: cleanString(binding?.direction),
		name: cleanString(binding?.name),
		authLevel: cleanString(binding?.authLevel),
		methods: Array.isArray(binding?.methods)
			? binding.methods.map((method) => cleanString(method).toUpperCase()).filter(Boolean)
			: [],
		route: cleanString(binding?.route),
		schedule: cleanString(binding?.schedule),
		queueName: cleanString(binding?.queueName),
		connection: cleanString(binding?.connection),
	};
}

function triggerBindings(bindings) {
	return bindings.filter((binding) => {
		const type = cleanString(binding?.type).toLowerCase();
		const direction = cleanString(binding?.direction).toLowerCase();
		return type.endsWith("trigger") && direction !== "out";
	});
}

function unsupportedGuidance(label) {
	return `${label} discovery is supported, but Studio does not synthesize its source event. Test it through the trigger's documented service or portal tooling.`;
}

export function classifyFunctionEnvelope(envelope) {
	const config = parseConfig(envelope?.properties?.config ?? envelope?.config);
	const bindings = Array.isArray(config.bindings) ? config.bindings : [];
	const triggers = triggerBindings(bindings);
	const name = functionName(envelope);
	const disabled = Boolean(envelope?.properties?.isDisabled ?? envelope?.isDisabled);
	const invokeUrl = safeInvokeUrl(
		envelope?.properties?.invoke_url_template ??
			envelope?.properties?.invokeUrlTemplate ??
			envelope?.invokeUrlTemplate ??
			envelope?.invokeUrl,
	);

	if (triggers.length !== 1) {
		const label = triggers.length ? "Multiple triggers" : "No trigger metadata";
		return {
			id: cleanString(envelope?.id),
			name,
			kind: "unsupported",
			label,
			triggerType: triggers.map((binding) => cleanString(binding.type)).filter(Boolean).join(", "),
			triggerBinding: null,
			invokeUrl,
			authLevel: "",
			methods: [],
			disabled,
			supportStatus: "unsupported",
			supportsInvoke: false,
			acceptsInput: false,
			guidance:
				triggers.length > 1
					? "Multiple input trigger bindings were returned. Studio will not guess which event to synthesize."
					: "No trigger binding was returned by the public Function metadata.",
			hostedSkillVerified: false,
			hostedSkillNote: "Hosted Skill not verified",
		};
	}

	const binding = safeBinding(triggers[0]);
	const triggerType = binding.type.toLowerCase();
	const label = TRIGGER_LABELS.get(triggerType) || binding.type || "Unknown";
	let kind = "unsupported";
	let supportStatus = "unsupported";
	let supportsInvoke = false;
	let acceptsInput = false;
	let guidance = unsupportedGuidance(label);

	if (triggerType === "httptrigger") {
		kind = "http";
		supportStatus = "supported";
		supportsInvoke = true;
		acceptsInput = true;
		guidance =
			"Calls the discovered HTTP endpoint. Optional test input uses the Hosted Skills prompt field; leave it empty unless the deployed endpoint expects that contract.";
		if (!invokeUrl) {
			supportStatus = "unsupported";
			supportsInvoke = false;
			guidance = "Public Function metadata did not return a safe HTTPS invocation URL, so Studio will not guess one.";
		}
	} else if (triggerType === "timertrigger") {
		kind = "timer";
		supportStatus = "supported";
		supportsInvoke = true;
		acceptsInput = true;
		guidance =
			"Uses the Functions admin endpoint. Optional input is trigger/test input only; it does not change deployed skill instructions.";
	} else if (triggerType === "queuetrigger") {
		kind = "queue";
		supportStatus = "conditional";
		supportsInvoke = true;
		acceptsInput = true;
		guidance =
			"Enqueues a Storage Queue message only when the binding target resolves to a safe identity-based Queue endpoint.";
	}

	if (disabled) {
		supportStatus = "disabled";
		supportsInvoke = false;
		guidance = "This deployed function is disabled. Studio will not invoke it.";
	}

	return {
		id: cleanString(envelope?.id),
		name,
		kind,
		label,
		triggerType: binding.type,
		triggerBinding: binding,
		invokeUrl,
		authLevel: binding.authLevel,
		methods: binding.methods,
		disabled,
		supportStatus,
		supportsInvoke,
		acceptsInput,
		guidance,
		hostedSkillVerified: false,
		hostedSkillNote: "Hosted Skill not verified",
	};
}

function requireAppId(app) {
	const id = cleanString(app?.id);
	if (!/^\/subscriptions\/[^/]+\/resourceGroups\/[^/]+\/providers\/Microsoft\.Web\/sites\/[^/]+$/i.test(id)) {
		throw new Error("The selected Function App has no valid ARM resource ID.");
	}
	return id;
}

export async function listFunctionApps(arm, subscription) {
	const rows = await arm.list({
		subscription,
		path: `/subscriptions/${encodeURIComponent(subscription)}/providers/Microsoft.Web/sites`,
		apiVersion: APP_SERVICE_API_VERSION,
	});
	return rows
		.filter((app) =>
			cleanString(app?.kind)
				.toLowerCase()
				.split(",")
				.map((part) => part.trim())
				.includes("functionapp"),
		)
		.map((app) => ({
			name: cleanString(app.name),
			resourceGroup: cleanString(app.resourceGroup) || cleanString(app.id).split("/")[4] || "",
			id: cleanString(app.id),
			location: cleanString(app.location),
			state: cleanString(app.properties?.state ?? app.state),
			defaultHostName: cleanString(app.properties?.defaultHostName ?? app.defaultHostName),
			kind: cleanString(app.kind),
		}));
}

export async function listFunctionAppFunctions(arm, { subscription, app }) {
	const rows = await arm.list({
		subscription,
		path: `${requireAppId(app)}/functions`,
		apiVersion: APP_SERVICE_API_VERSION,
	});
	return rows.map(classifyFunctionEnvelope);
}

function dictionary(body) {
	const value = body?.properties && typeof body.properties === "object" ? body.properties : body;
	return value && typeof value === "object" ? value : {};
}

export async function readHostMasterKey(arm, { subscription, app }) {
	let response;
	try {
		response = await arm.request({
			subscription,
			path: `${requireAppId(app)}/host/default/listkeys`,
			apiVersion: APP_SERVICE_API_VERSION,
			method: "POST",
		});
	} catch (error) {
		throw keyAccessError(
			"Timer",
			"the Functions host master key",
			"Microsoft.Web/sites/host/listkeys/action",
			error,
		);
	}
	const body = response.body || {};
	const key = cleanString(body.masterKey ?? body.properties?.masterKey);
	if (!key) throw new Error("Azure returned no Functions master key.");
	return key;
}

export async function readFunctionKey(arm, { subscription, app, fn }) {
	let response;
	try {
		response = await arm.request({
			subscription,
			path: `${requireAppId(app)}/functions/${encodeURIComponent(fn.name)}/listkeys`,
			apiVersion: APP_SERVICE_API_VERSION,
			method: "POST",
		});
	} catch (error) {
		throw keyAccessError(
			"HTTP",
			"a function-scoped key",
			"Microsoft.Web/sites/functions/listKeys/action",
			error,
		);
	}
	const keys = dictionary(response.body);
	const key = cleanString(keys.default) || Object.values(keys).map(cleanString).find(Boolean) || "";
	if (!key) throw new Error(`Azure returned no function key for ${fn.name}.`);
	return key;
}

async function readAppSettings(arm, { subscription, app }) {
	let response;
	try {
		response = await arm.request({
			subscription,
			path: `${requireAppId(app)}/config/appsettings/list`,
			apiVersion: APP_SERVICE_API_VERSION,
			method: "POST",
		});
	} catch (error) {
		if (![401, 403].includes(Number(error?.status))) throw error;
		const wrapped = new Error(
			`Queue target resolution could not read Function App settings (HTTP ${error.status}). Grant an Azure role that can list the app's configuration, then retry.`,
		);
		wrapped.status = error.status;
		throw wrapped;
	}
	return dictionary(response.body);
}

function keyAccessError(testKind, keyKind, action, error) {
	if (![401, 403].includes(Number(error?.status))) return error;
	const wrapped = new Error(
		`${testKind} test could not read ${keyKind} (HTTP ${error.status}). Grant an Azure role that includes ${action}, then retry.`,
	);
	wrapped.status = error.status;
	return wrapped;
}

function setting(settings, name) {
	const wanted = cleanString(name).toLowerCase();
	const match = Object.entries(settings || {}).find(([key]) => key.toLowerCase() === wanted);
	return match ? cleanString(match[1]) : "";
}

function validateQueueServiceUrl(value) {
	const url = new URL(value);
	if (url.protocol !== "https:" || url.username || url.password || !STORAGE_QUEUE_HOST_RE.test(url.hostname)) {
		throw new Error("Queue service URI must be a standard HTTPS Azure Queue endpoint.");
	}
	url.pathname = "/";
	url.search = "";
	url.hash = "";
	return url.toString().replace(/\/$/, "");
}

function connectionStringParts(value) {
	const parts = new Map();
	for (const segment of cleanString(value).split(";")) {
		const index = segment.indexOf("=");
		if (index <= 0) continue;
		parts.set(segment.slice(0, index).trim().toLowerCase(), segment.slice(index + 1).trim());
	}
	return parts;
}

export function resolveQueueTarget(binding, settings) {
	const queueName = cleanString(binding?.queueName).toLowerCase();
	if (!QUEUE_NAME_RE.test(queueName)) {
		throw new Error("The Queue trigger does not expose a valid Azure Storage queue name.");
	}
	const connection = cleanString(binding?.connection) || "AzureWebJobsStorage";
	const queueServiceUri = setting(settings, `${connection}__queueServiceUri`);
	const accountName = setting(settings, `${connection}__accountName`);
	const rawConnection = setting(settings, connection);
	let serviceUrl;
	let source;

	if (queueServiceUri) {
		serviceUrl = validateQueueServiceUrl(queueServiceUri);
		source = `${connection}__queueServiceUri`;
	} else if (accountName) {
		if (!/^[a-z0-9]{3,24}$/i.test(accountName)) {
			throw new Error(`${connection}__accountName is not a valid Azure Storage account name.`);
		}
		serviceUrl = `https://${accountName.toLowerCase()}.queue.core.windows.net`;
		source = `${connection}__accountName`;
	} else if (rawConnection) {
		const parts = connectionStringParts(rawConnection);
		if (parts.get("usedevelopmentstorage")?.toLowerCase() === "true") {
			throw new Error("Development Storage is not a safe target for an Azure Function App queue test.");
		}
		const explicitQueue = parts.get("queueendpoint");
		if (explicitQueue) {
			serviceUrl = validateQueueServiceUrl(explicitQueue);
		} else {
			const parsedAccount = parts.get("accountname") || "";
			const protocol = (parts.get("defaultendpointsprotocol") || "https").toLowerCase();
			const suffix = parts.get("endpointsuffix") || "core.windows.net";
			if (protocol !== "https" || !/^[a-z0-9]{3,24}$/i.test(parsedAccount) || !/^core\.(?:windows\.net|usgovcloudapi\.net|cloudapi\.de|chinacloudapi\.cn)$/i.test(suffix)) {
				throw new Error("The Queue trigger connection setting does not identify a safe HTTPS Azure Queue endpoint.");
			}
			serviceUrl = validateQueueServiceUrl(`https://${parsedAccount.toLowerCase()}.queue.${suffix}`);
		}
		source = connection;
	} else {
		throw new Error(
			`Cannot resolve Queue target ${queueName}: ${connection} has no __queueServiceUri, __accountName, or connection setting visible through ARM.`,
		);
	}
	const configuredEncoding = setting(settings, "AzureFunctionsJobHost__extensions__queues__messageEncoding").toLowerCase();
	if (configuredEncoding && configuredEncoding !== "base64" && configuredEncoding !== "none") {
		throw new Error(
			"AzureFunctionsJobHost__extensions__queues__messageEncoding must be base64 or none before Studio can safely test this Queue trigger.",
		);
	}

	return {
		queueName,
		serviceUrl,
		messageUrl: `${serviceUrl}/${encodeURIComponent(queueName)}/messages`,
		connectionSetting: source,
		messageEncoding: configuredEncoding || "base64",
	};
}

function xmlEscape(value) {
	return String(value).replace(/[<>&'"]/g, (character) => {
		if (character === "<") return "&lt;";
		if (character === ">") return "&gt;";
		if (character === "&") return "&amp;";
		if (character === "'") return "&apos;";
		return "&quot;";
	});
}

function normalizeInput(input) {
	if (input == null || input === "") return null;
	if (["string", "number", "boolean"].includes(typeof input)) return input;
	throw new TypeError("Trigger/test input must be a string, number, or boolean.");
}

function responseRequestId(response) {
	return (
		response.headers?.get?.("x-ms-request-id") ||
		response.headers?.get?.("x-ms-client-request-id") ||
		""
	);
}

async function readBoundedText(response) {
	let text = "";
	let truncated = false;
	if (response.body?.getReader) {
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let bytes = 0;
		while (bytes <= MAX_RUNTIME_RESPONSE) {
			const { done, value } = await reader.read();
			if (done) break;
			const remaining = MAX_RUNTIME_RESPONSE + 1 - bytes;
			const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
			bytes += chunk.byteLength;
			text += decoder.decode(chunk, { stream: true });
			if (value.byteLength > remaining || bytes > MAX_RUNTIME_RESPONSE) {
				truncated = true;
				await reader.cancel();
				break;
			}
		}
		text += decoder.decode();
	} else {
		text = await response.text();
		truncated = text.length > MAX_RUNTIME_RESPONSE;
		if (truncated) text = text.slice(0, MAX_RUNTIME_RESPONSE + 1);
	}
	let sanitized;
	try {
		sanitized = JSON.stringify(redactSensitive(JSON.parse(text)));
	} catch {
		sanitized = redactSensitive(text);
	}
	return truncated || sanitized.length > MAX_RUNTIME_RESPONSE
		? `${sanitized.slice(0, MAX_RUNTIME_RESPONSE)}\n[response truncated]`
		: sanitized;
}

function runtimeFailure(kind, response) {
	const requestId = responseRequestId(response);
	const suffix = requestId ? ` Request ID: ${requestId}.` : "";
	if (kind === "queue" && [401, 403].includes(response.status)) {
		return new Error(
			`Queue message was rejected with HTTP ${response.status}. Grant the signed-in identity Storage Queue Data Message Sender on the target queue or storage account.${suffix}`,
		);
	}
	return new Error(`${kind} invocation failed with HTTP ${response.status}.${suffix}`);
}

function httpMethod(fn) {
	const methods = Array.isArray(fn.methods) ? fn.methods.map((method) => method.toUpperCase()) : [];
	if (!methods.length || methods.includes("POST")) return "POST";
	if (methods.includes("GET")) return "GET";
	throw new Error(`HTTP function ${fn.name} does not advertise GET or POST in its trigger metadata.`);
}

function httpRequest(fn, input, key) {
	if (!fn.invokeUrl) throw new Error(`HTTP function ${fn.name} has no invocation URL in public Function metadata.`);
	const method = httpMethod(fn);
	const url = new URL(fn.invokeUrl);
	const normalized = normalizeInput(input);
	const headers = {};
	let body;
	if (method === "GET") {
		if (normalized != null) url.searchParams.set("prompt", String(normalized));
	} else {
		headers["Content-Type"] = "application/json";
		body = JSON.stringify(normalized == null ? {} : { prompt: normalized });
	}
	if (cleanString(fn.authLevel).toLowerCase() !== "anonymous") headers["x-functions-key"] = key;
	return {
		url: url.toString(),
		init: { method, headers, body },
		display: {
			method,
			url: url.toString(),
			auth: headers["x-functions-key"] ? "function key [redacted]" : "anonymous",
			body: body ? (normalized == null ? "{}" : '{"prompt":"<trigger/test input>"}') : "",
		},
	};
}

function adminRequest(app, fn, input, key) {
	const host = cleanString(app?.defaultHostName);
	if (!host || !/^[a-z0-9.-]+$/i.test(host)) throw new Error("The selected Function App has no valid default host name.");
	const normalized = normalizeInput(input);
	const body = JSON.stringify(normalized == null ? {} : { input: normalized });
	return {
		url: `https://${host}/admin/functions/${encodeURIComponent(fn.name)}`,
		init: {
			method: "POST",
			headers: { "Content-Type": "application/json", "x-functions-key": key },
			body,
		},
		display: {
			method: "POST",
			url: `https://${host}/admin/functions/${encodeURIComponent(fn.name)}`,
			auth: "master key [redacted]",
			body: normalized == null ? "{}" : '{"input":"<trigger/test input>"}',
		},
	};
}

function queueRequest(target, input, token, now = () => new Date(), requestId = () => randomUUID()) {
	const normalized = normalizeInput(input);
	const message = normalized == null ? "" : String(normalized);
	const encoded = target.messageEncoding === "none" ? message : Buffer.from(message, "utf8").toString("base64");
	const body = `<QueueMessage><MessageText>${xmlEscape(encoded)}</MessageText></QueueMessage>`;
	return {
		url: target.messageUrl,
		init: {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/xml",
				"x-ms-date": now().toUTCString(),
				"x-ms-version": STORAGE_API_VERSION,
				"x-ms-client-request-id": requestId(),
			},
			body,
		},
		display: {
			method: "POST",
			url: target.messageUrl,
			auth: "Azure CLI Storage bearer token [redacted]",
			body: `<QueueMessage><MessageText>[${target.messageEncoding} trigger/test input]</MessageText></QueueMessage>`,
		},
	};
}

async function executeRuntimeRequest(kind, request, fetchImpl) {
	const started = Date.now();
	const response = await fetchImpl(request.url, request.init);
	const ms = Date.now() - started;
	if (!response.ok) throw runtimeFailure(kind, response);
	const text = kind === "http" ? await readBoundedText(response) : "";
	return {
		ok: true,
		status: response.status,
		ms,
		text,
		request: request.display,
		requestId: responseRequestId(response),
	};
}

export async function invokeFunction({
	arm,
	session,
	fetchImpl = fetch,
	subscription,
	app,
	fn,
	input,
	now,
	requestId,
}) {
	if (!fn?.supportsInvoke) throw new Error(fn?.guidance || "The selected function trigger is not supported.");

	if (fn.kind === "http") {
		const authLevel = cleanString(fn.authLevel).toLowerCase();
		const key = authLevel === "anonymous"
			? ""
			: authLevel === "admin"
				? await readHostMasterKey(arm, { subscription, app })
				: await readFunctionKey(arm, { subscription, app, fn });
		return executeRuntimeRequest("http", httpRequest(fn, input, key), fetchImpl);
	}

	if (fn.kind === "timer") {
		const key = await readHostMasterKey(arm, { subscription, app });
		const result = await executeRuntimeRequest("timer", adminRequest(app, fn, input, key), fetchImpl);
		return {
			...result,
			note:
				result.status === 202
					? input == null || input === ""
						? "Accepted (fire-and-forget). No trigger/test input was supplied; check Application Insights for completion."
						: "Accepted (fire-and-forget) with trigger/test input; check Application Insights for completion."
					: `HTTP ${result.status}`,
		};
	}

	if (fn.kind === "queue") {
		const settings = await readAppSettings(arm, { subscription, app });
		const target = resolveQueueTarget(fn.triggerBinding, settings);
		const loadToken = (force) => session.accessToken(subscription, STORAGE_RESOURCE, force);
		let tokenResult = await loadToken(false);
		let token = typeof tokenResult === "string" ? tokenResult : tokenResult?.accessToken;
		if (!token) throw new Error("Azure CLI session returned no Azure Storage access token.");
		let request = queueRequest(target, input, token, now, requestId);
		let started = Date.now();
		let response = await fetchImpl(request.url, request.init);
		if (response.status === 401) {
			tokenResult = await loadToken(true);
			token = typeof tokenResult === "string" ? tokenResult : tokenResult?.accessToken;
			if (!token) throw new Error("Azure CLI session returned no refreshed Azure Storage access token.");
			request = queueRequest(target, input, token, now, requestId);
			started = Date.now();
			response = await fetchImpl(request.url, request.init);
		}
		const ms = Date.now() - started;
		if (!response.ok) throw runtimeFailure("queue", response);
		return {
			ok: true,
			status: response.status,
			ms,
			text: "",
			request: request.display,
			requestId: responseRequestId(response),
			note: `Message enqueued to ${target.queueName}.`,
			queue: { name: target.queueName, serviceUrl: target.serviceUrl },
		};
	}

	throw new Error(fn.guidance || `Trigger ${fn.triggerType || fn.kind} is not supported.`);
}
