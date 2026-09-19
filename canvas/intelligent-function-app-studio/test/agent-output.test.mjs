import assert from "node:assert/strict";
import test from "./vitest-test.mjs";

import {
	MAX_REMOTE_AGENT_RESPONSE_CHARS,
	applyAgentResponseTelemetry,
	hasPendingAgentResponse,
	installAgentResponseLogging,
	isAwaitingAgentResponse,
	parseAgentResponseLog,
} from "../agent-output.mjs";

function output({
	time = "2026-09-04T15:10:00Z",
	operationId = "operation-1",
	functionName = "daily_repo_digest",
	response = "# Digest\n\nEverything worked.",
	sessionId = "session-1",
} = {}) {
	return {
		time,
		operationId,
		functionName,
		message:
			"Agent response: source_file=daily-repo-digest.agent.md payload=" +
			JSON.stringify({ session_id: sessionId, response }),
	};
}

test("parses compact Agent response telemetry", () => {
	assert.deepEqual(parseAgentResponseLog(output().message), {
		response: "# Digest\n\nEverything worked.",
		sessionId: "session-1",
	});
	assert.equal(parseAgentResponseLog("ordinary trace"), null);
	assert.equal(parseAgentResponseLog("Agent response: payload=not-json"), null);
});

test("installs an idempotent bounded response logger and removes v2", () => {
	const v2 = [
		"import logging",
		"",
		"# Intelligent Function App Studio: expose completed agent responses (v2)",
		"# Core Tools filters this named logger's INFO records from the local host stream.",
		'_agent_runtime_logger = logging.getLogger("azure.functions.AgentRuntime")',
		"_agent_runtime_logger.info = _agent_runtime_logger.warning",
		"import azure.functions as func",
		"",
	].join("\n");
	const installed = installAgentResponseLogging(v2);
	assert.match(installed, /completed agent responses \(v5\)/);
	assert.match(installed, /json\.loads/);
	assert.match(installed, new RegExp(`\\[:${MAX_REMOTE_AGENT_RESPONSE_CHARS}\\]`));
	assert.match(installed, /logging\.warning\("Agent response:/);
	assert.match(installed, /_agent_runtime_info\(message, \*args, \*\*kwargs\)/);
	assert.doesNotMatch(installed, /completed agent responses \(v2\)/);
	assert.doesNotMatch(installed, /tool_calls/);
	assert.equal(installAgentResponseLogging(installed), installed);
});

test("migrates the previous v3 and v4 response loggers", () => {
	const previous = [
		"import logging",
		"import json",
		"",
		"# Intelligent Function App Studio: expose completed agent responses (v4)",
		'_agent_runtime_logger = logging.getLogger("azure.functions.AgentRuntime")',
		"_agent_runtime_warning = _agent_runtime_logger.warning",
		"def _studio_agent_response_info(message, *args, **kwargs):",
		"    _agent_runtime_warning(message, *args, **kwargs)",
		"_agent_runtime_logger.info = _studio_agent_response_info",
		"import azure.functions as func",
		"",
	].join("\n");
	const installed = installAgentResponseLogging(previous);
	assert.match(installed, /completed agent responses \(v5\)/);
	assert.doesNotMatch(installed, /completed agent responses \(v4\)/);
	assert.equal((installed.match(/def _studio_agent_response_info/g) || []).length, 1);
	assert.match(installed, /import azure\.functions as func/);
});

test("correlates output with the nearest preceding Azure invocation", () => {
	const invocations = [
		{
			target: "azure",
			trigger: "timer",
			ok: true,
			awaitAgentResponse: true,
			functionName: "daily_repo_digest",
			invokedAt: "2026-09-04T15:09:30Z",
			response: "",
		},
		{
			target: "azure",
			trigger: "timer",
			ok: true,
			awaitAgentResponse: true,
			functionName: "daily_repo_digest",
			invokedAt: "2026-09-04T15:00:00Z",
			response: "",
		},
	];

	assert.equal(applyAgentResponseTelemetry(invocations, [output()]), true);
	assert.equal(invocations[0].response, "# Digest\n\nEverything worked.");
	assert.equal(invocations[0].operationId, "operation-1");
	assert.equal(invocations[1].response, "");
});

test("only non-HTTP successful Azure invocations await telemetry output", () => {
	const invocation = {
		target: "azure",
		trigger: "timer",
		ok: true,
		awaitAgentResponse: true,
		response: "",
		invokedAt: "2026-09-04T15:00:00Z",
	};
	assert.equal(isAwaitingAgentResponse(invocation, Date.parse("2026-09-04T15:10:00Z")), true);
	assert.equal(isAwaitingAgentResponse({ ...invocation, trigger: "http" }, Date.parse("2026-09-04T15:10:00Z")), false);
	assert.equal(isAwaitingAgentResponse({ ...invocation, ok: false }, Date.parse("2026-09-04T15:10:00Z")), false);
	assert.equal(isAwaitingAgentResponse({ ...invocation, response: "done" }, Date.parse("2026-09-04T15:10:00Z")), false);
	assert.equal(
		isAwaitingAgentResponse({ ...invocation, awaitAgentResponse: false }, Date.parse("2026-09-04T15:10:00Z")),
		false,
	);
	assert.equal(isAwaitingAgentResponse(invocation, Date.parse("2026-09-04T15:31:00Z")), false);
	assert.equal(
		hasPendingAgentResponse(
			[{ ...invocation, functionName: "daily_repo_digest" }],
			"daily_repo_digest",
			Date.parse("2026-09-04T15:10:00Z"),
		),
		true,
	);
	assert.equal(
		hasPendingAgentResponse(
			[{ ...invocation, functionName: "daily_repo_digest", awaitAgentResponse: false }],
			"daily_repo_digest",
			Date.parse("2026-09-04T15:10:00Z"),
		),
		false,
	);
});

test("repeated, stale, unrelated, and uncorrelated output is ignored", () => {
	const invocations = [
		{
			target: "azure",
			trigger: "timer",
			ok: true,
			awaitAgentResponse: true,
			functionName: "daily_repo_digest",
			invokedAt: "2026-09-04T15:09:30Z",
			response: "",
		},
		{
			target: "azure",
			trigger: "timer",
			ok: true,
			awaitAgentResponse: true,
			functionName: "daily_repo_digest",
			invokedAt: "2026-09-04T14:00:00Z",
			response: "",
		},
	];
	const first = output();
	assert.equal(applyAgentResponseTelemetry(invocations, [first]), true);
	assert.equal(applyAgentResponseTelemetry(invocations, [first]), false);
	assert.equal(
		applyAgentResponseTelemetry(invocations, [
			output({ operationId: "operation-2", functionName: "another_function" }),
			output({ operationId: "operation-3", time: "2026-09-04T14:31:00Z" }),
			output({ operationId: "" }),
		]),
		false,
	);
	assert.equal(invocations[1].response, "");
});
