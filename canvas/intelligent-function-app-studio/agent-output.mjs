const MAX_AGENT_OUTPUT_CHARS = 100_000;
export const MAX_REMOTE_AGENT_RESPONSE_CHARS = 8_000;
const MAX_TELEMETRY_CORRELATION_MS = 30 * 60 * 1000;
const AGENT_RESPONSE_LOGGING_MARKER =
	"# Intelligent Function App Studio: expose completed agent responses (v5)";
const LEGACY_AGENT_RESPONSE_LOGGING = [
	"import logging",
	"",
	'logging.getLogger("azure.functions.AgentRuntime").setLevel(logging.INFO)',
	"",
].join("\n");
const ORIGINAL_AGENT_RESPONSE_LOGGING =
	/^import logging\nimport sys\n\n# Intelligent Function App Studio: expose completed agent responses\n[\s\S]*?_agent_runtime_logger\.addHandler\(_agent_runtime_handler\)\n/;
const VERSION_TWO_AGENT_RESPONSE_LOGGING =
	/^import logging\n\n# Intelligent Function App Studio: expose completed agent responses \(v2\)\n# Core Tools filters this named logger's INFO records from the local host stream\.\n_agent_runtime_logger = logging\.getLogger\("azure\.functions\.AgentRuntime"\)\n_agent_runtime_logger\.info = _agent_runtime_logger\.warning\n/;
const VERSION_THREE_OR_FOUR_AGENT_RESPONSE_LOGGING =
	/^import logging\nimport json\n\n# Intelligent Function App Studio: expose completed agent responses \(v[34]\)\n[\s\S]*?_agent_runtime_logger\.info = _studio_agent_response_info\n/;

export function normalizeAgentOutput(value) {
	const text = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value, null, 2);
	return text.trim().slice(0, MAX_AGENT_OUTPUT_CHARS);
}

export function parseAgentResponseLog(line) {
	const marker = "Agent response:";
	const markerIndex = String(line || "").indexOf(marker);
	if (markerIndex === -1) return null;

	const payloadIndex = line.indexOf("payload=", markerIndex + marker.length);
	if (payloadIndex === -1) return null;

	try {
		const payload = JSON.parse(line.slice(payloadIndex + "payload=".length));
		const response = normalizeAgentOutput(payload?.response);
		if (!response) return null;
		return {
			response,
			sessionId: typeof payload.session_id === "string" ? payload.session_id : "",
		};
	} catch {
		return null;
	}
}

export function installAgentResponseLogging(source) {
	const input = String(source || "");
	if (input.includes(AGENT_RESPONSE_LOGGING_MARKER)) return input;
	const cleanSource = input
		.replace(ORIGINAL_AGENT_RESPONSE_LOGGING, "")
		.replace(VERSION_TWO_AGENT_RESPONSE_LOGGING, "")
		.replace(VERSION_THREE_OR_FOUR_AGENT_RESPONSE_LOGGING, "")
		.replace(LEGACY_AGENT_RESPONSE_LOGGING, "");
	const loggerSetup = [
		"import logging",
		"import json",
		"",
		AGENT_RESPONSE_LOGGING_MARKER,
		"# Emit only the bounded final response. The runtime's default record also includes",
		"# full tool-call payloads, which can exceed Application Insights trace limits.",
		'_agent_runtime_logger = logging.getLogger("azure.functions.AgentRuntime")',
		"_agent_runtime_info = _agent_runtime_logger.info",
		"",
		"def _studio_agent_response_info(message, *args, **kwargs):",
		'    if message == "Agent response: source_file=%s payload=%s" and len(args) >= 2:',
		"        try:",
		"            payload = json.loads(str(args[1]))",
		"            compact = {",
		'                "session_id": str(payload.get("session_id") or ""),',
		`                "response": str(payload.get("response") or "")[:${MAX_REMOTE_AGENT_RESPONSE_CHARS}],`,
		"            }",
		"        except (TypeError, ValueError):",
		`            compact = {"session_id": "", "response": str(args[1])[:${MAX_REMOTE_AGENT_RESPONSE_CHARS}]}`,
		'        logging.warning("Agent response: source_file=%s payload=%s", args[0], json.dumps(compact, ensure_ascii=False))',
		"        return",
		"    _agent_runtime_info(message, *args, **kwargs)",
		"",
		"_agent_runtime_logger.info = _studio_agent_response_info",
		"",
	].join("\n");
	return `${loggerSetup}${cleanSource}`;
}

export function isAwaitingAgentResponse(invocation, now = Date.now()) {
	const invokedAt = Date.parse(invocation?.invokedAt || "");
	const age = now - invokedAt;
	return (
		invocation?.target === "azure" &&
		invocation?.awaitAgentResponse === true &&
		invocation?.trigger !== "http" &&
		invocation?.ok === true &&
		!invocation?.response &&
		Number.isFinite(invokedAt) &&
		age >= 0 &&
		age <= MAX_TELEMETRY_CORRELATION_MS
	);
}

export function hasPendingAgentResponse(invocations, functionName, now = Date.now()) {
	return (invocations || []).some(
		(invocation) =>
			invocation?.functionName === functionName && isAwaitingAgentResponse(invocation, now),
	);
}

export function applyAgentResponseTelemetry(invocations, outputs) {
	let changed = false;
	for (const output of outputs || []) {
		const parsed = parseAgentResponseLog(output?.message);
		const outputTime = Date.parse(output?.time || "");
		const operationId = String(output?.operationId || "").trim();
		if (!parsed || !Number.isFinite(outputTime) || !operationId) continue;
		if ((invocations || []).some((item) => item?.operationId === operationId)) continue;
		const candidates = (invocations || [])
			.map((item) => ({ item, invokedAt: Date.parse(item?.invokedAt || "") }))
			.filter(({ item, invokedAt }) => {
				const age = outputTime - invokedAt;
				return (
					isAwaitingAgentResponse(item, outputTime) &&
					item?.functionName === output.functionName &&
					age >= 0
				);
			})
			.sort((left, right) => right.invokedAt - left.invokedAt);
		const invocation = candidates[0]?.item;
		if (!invocation) continue;
		invocation.response = parsed.response;
		invocation.sessionId = parsed.sessionId;
		invocation.operationId = operationId;
		invocation.note = "Agent output captured from Application Insights.";
		changed = true;
	}
	return changed;
}
