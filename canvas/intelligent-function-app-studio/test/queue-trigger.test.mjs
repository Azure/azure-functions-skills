import assert from "node:assert/strict";
import test from "./vitest-test.mjs";
import {
	DEFAULT_QUEUE_MESSAGE,
	DEFAULT_QUEUE_NAME,
	assertLocalQueueConnection,
	enqueueLocalQueueMessage,
	normalizeQueueMessage,
	queueAgentContent,
	queueNameForWorkspace,
} from "../queue-trigger.mjs";

test("queue agent uses the documented hosted-skill trigger contract", () => {
	const source = queueAgentContent("Follow these instructions.", "Repository digest");
	assert.match(source, /name: "Repository digest \(Queue\)"/);
	assert.match(source, /type: queue_trigger/);
	assert.match(source, new RegExp(`queue_name: "${DEFAULT_QUEUE_NAME}"`));
	assert.match(source, /connection: AzureWebJobsStorage/);
	assert.match(source, /mcp: true/);
	assert.match(source, /Follow these instructions\./);
	assert.match(source, /body_json/);
});

test("local queue invocation creates the Azurite queue then writes the representative message", async () => {
	const calls = [];
	const execFileText = async (...args) => {
		calls.push(args);
		return { stdout: "{}", stderr: "" };
	};
	const result = await enqueueLocalQueueMessage({ execFileText, env: { PATH: "/tools" } });

	assert.deepEqual(result, {
		queueName: DEFAULT_QUEUE_NAME,
		bytes: Buffer.byteLength(DEFAULT_QUEUE_MESSAGE),
	});
	assert.equal(calls.length, 2);
	assert.deepEqual(calls[0][0], "az");
	assert.deepEqual(calls[0][1], [
		"storage",
		"queue",
		"create",
		"--name",
		DEFAULT_QUEUE_NAME,
		"--connection-string",
		"UseDevelopmentStorage=true",
		"--only-show-errors",
		"-o",
		"none",
	]);
	assert.deepEqual(calls[1][1], [
		"storage",
		"message",
		"put",
		"--queue-name",
		DEFAULT_QUEUE_NAME,
		"--connection-string",
		"UseDevelopmentStorage=true",
		"--only-show-errors",
		"--content",
		Buffer.from(DEFAULT_QUEUE_MESSAGE, "utf8").toString("base64"),
		"-o",
		"json",
	]);
	assert.deepEqual(calls[1][2].env, { PATH: "/tools" });
});

test("queue message validation rejects unsafe names, empty content, and oversized content", async () => {
	assert.throws(() => normalizeQueueMessage(""), /must not be empty/);
	assert.throws(() => normalizeQueueMessage("plain text"), /valid JSON/);
	assert.throws(() => normalizeQueueMessage('"plain text"'), /JSON object/);
	assert.throws(() => normalizeQueueMessage(JSON.stringify({ value: "x".repeat(48 * 1024 + 1) })), /limited/);
	await assert.rejects(
		enqueueLocalQueueMessage({ execFileText: async () => {}, queueName: "Not Valid", message: "hello" }),
		/lowercase/,
	);
	assert.equal(assertLocalQueueConnection("UseDevelopmentStorage=true"), "UseDevelopmentStorage=true");
	assert.throws(() => assertLocalQueueConnection("DefaultEndpointsProtocol=https;AccountName=prod"), /cannot consume/);
});

test("local queue names are stable and isolated per generated workspace", () => {
	const first = queueNameForWorkspace("/repo/functions/first");
	assert.match(first, /^agent-input-[a-f0-9]{12}$/);
	assert.equal(first, queueNameForWorkspace("/repo/functions/first"));
	assert.notEqual(first, queueNameForWorkspace("/repo/functions/second"));
});

test("Function Studio renders and submits an editable Queue JSON payload", async () => {
	const source = await import("node:fs/promises").then(({ readFile }) =>
		readFile(new URL("../extension.mjs", import.meta.url), "utf8"),
	);
	assert.match(source, /id="trigger-test-input"/);
	assert.match(source, /Queue message JSON/);
	assert.match(source, /Change repository to choose which GitHub repo/);
	assert.match(source, /queueInput \? \{ prompt: triggerTestInput\.value \} : \{\}/);
	assert.match(source, /Queue message must be a valid JSON object/);
});
