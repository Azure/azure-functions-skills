import { test } from "./vitest-test.mjs";
import assert from "node:assert/strict";
import {
	APP_SERVICE_API_VERSION,
	STORAGE_API_VERSION,
	STORAGE_RESOURCE,
	classifyFunctionEnvelope,
	invokeFunction,
	listFunctionAppFunctions,
	listFunctionApps,
	resolveQueueTarget,
} from "../function-app-runtime.mjs";

const app = {
	id: "/subscriptions/sub-1/resourceGroups/rg-one/providers/Microsoft.Web/sites/functions-one",
	name: "functions-one",
	resourceGroup: "rg-one",
	defaultHostName: "functions-one.azurewebsites.net",
};

function response(status, body = "", headers = {}) {
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: new Headers(headers),
		text: async () => body,
	};
}

function envelope(name, binding, properties = {}) {
	return {
		id: `${app.id}/functions/${name}`,
		name: `${app.name}/${name}`,
		properties: {
			config: { name, bindings: binding ? [binding] : [] },
			invoke_url_template: binding?.type === "httpTrigger" ? `https://${app.defaultHostName}/api/${name}` : null,
			...properties,
		},
	};
}

test("direct ARM discovery lists Function Apps and classifies deployed trigger bindings", async () => {
	const calls = [];
	const arm = {
		async list(options) {
			calls.push(options);
			if (options.path.endsWith("/providers/Microsoft.Web/sites")) {
				return [
					{ ...app, kind: "functionapp,linux", properties: { defaultHostName: app.defaultHostName, state: "Running" } },
					{ id: "/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.Web/sites/web-one", name: "web-one", kind: "app" },
				];
			}
			return [
				envelope("httpSkill", { type: "httpTrigger", direction: "in", authLevel: "function", methods: ["post"] }),
				envelope("scheduledSkill", { type: "timerTrigger", direction: "in", schedule: "0 */5 * * * *" }),
				envelope("queueSkill", { type: "queueTrigger", direction: "in", queueName: "jobs", connection: "JobsStorage" }),
				envelope("blobListener", { type: "blobTrigger", direction: "in", path: "incoming/{name}" }),
			];
		},
	};

	const apps = await listFunctionApps(arm, "sub-1");
	const functions = await listFunctionAppFunctions(arm, { subscription: "sub-1", app });

	assert.equal(apps.length, 1);
	assert.equal(apps[0].name, "functions-one");
	assert.deepEqual(
		calls.map(({ path, apiVersion }) => ({ path, apiVersion })),
		[
			{
				path: "/subscriptions/sub-1/providers/Microsoft.Web/sites",
				apiVersion: APP_SERVICE_API_VERSION,
			},
			{
				path: `${app.id}/functions`,
				apiVersion: APP_SERVICE_API_VERSION,
			},
		],
	);
	assert.deepEqual(
		functions.map(({ name, kind, label, supportStatus }) => ({ name, kind, label, supportStatus })),
		[
			{ name: "httpSkill", kind: "http", label: "HTTP", supportStatus: "supported" },
			{ name: "scheduledSkill", kind: "timer", label: "Timer", supportStatus: "supported" },
			{ name: "queueSkill", kind: "queue", label: "Queue", supportStatus: "conditional" },
			{ name: "blobListener", kind: "unsupported", label: "Blob", supportStatus: "unsupported" },
		],
	);
	assert.ok(functions.every((fn) => fn.hostedSkillNote === "Hosted Skill not verified"));
});

test("classification rejects missing, multiple, disabled, and unknown trigger metadata without guessing", () => {
	const missing = classifyFunctionEnvelope(envelope("missing", null));
	const multiple = classifyFunctionEnvelope({
		...envelope("multiple", { type: "httpTrigger", direction: "in" }),
		properties: {
			config: {
				name: "multiple",
				bindings: [
					{ type: "httpTrigger", direction: "in" },
					{ type: "timerTrigger", direction: "in" },
				],
			},
		},
	});
	const disabled = classifyFunctionEnvelope(
		envelope("disabled", { type: "timerTrigger", direction: "in" }, { isDisabled: true }),
	);
	const unknown = classifyFunctionEnvelope(envelope("custom", { type: "customTrigger", direction: "in" }));

	assert.equal(missing.supportStatus, "unsupported");
	assert.match(missing.guidance, /No trigger binding/);
	assert.equal(multiple.supportStatus, "unsupported");
	assert.match(multiple.guidance, /will not guess/);
	assert.equal(disabled.supportStatus, "disabled");
	assert.equal(disabled.supportsInvoke, false);
	assert.equal(unknown.label, "customTrigger");
	assert.match(unknown.guidance, /does not synthesize/);
});

test("HTTP invoke uses the discovered endpoint, optional Hosted Skills prompt shape, and a function-scoped key", async () => {
	const requests = [];
	const armCalls = [];
	const arm = {
		async request(options) {
			armCalls.push(options);
			return { body: { properties: { default: "function-secret" } } };
		},
	};
	const fn = classifyFunctionEnvelope(
		envelope("httpSkill", { type: "httpTrigger", direction: "in", authLevel: "function", methods: ["post"] }),
	);
	const result = await invokeFunction({
		arm,
		session: {},
		subscription: "sub-1",
		app,
		fn,
		input: "Summarize open incidents",
		fetchImpl: async (url, init) => {
			requests.push({ url, init });
			return response(200, '{"answer":"done"}', { "x-ms-request-id": "http-request" });
		},
	});

	assert.equal(armCalls[0].path, `${app.id}/functions/httpSkill/listkeys`);
	assert.equal(armCalls[0].method, "POST");
	assert.equal(requests[0].url, `https://${app.defaultHostName}/api/httpSkill`);
	assert.equal(requests[0].init.method, "POST");
	assert.equal(requests[0].init.headers["x-functions-key"], "function-secret");
	assert.equal(requests[0].init.body, JSON.stringify({ prompt: "Summarize open incidents" }));
	assert.equal(result.text, '{"answer":"done"}');
	assert.equal(result.request.auth, "function key [redacted]");
	assert.ok(!JSON.stringify(result).includes("function-secret"));
});

test("admin-auth HTTP invoke uses the host master key rather than a function-scoped key", async () => {
	const armCalls = [];
	let seenKey = "";
	const fn = classifyFunctionEnvelope(
		envelope("adminSkill", { type: "httpTrigger", direction: "in", authLevel: "admin", methods: ["post"] }),
	);
	await invokeFunction({
		arm: {
			async request(options) {
				armCalls.push(options);
				return { body: { masterKey: "master-secret" } };
			},
		},
		session: {},
		subscription: "sub-1",
		app,
		fn,
		fetchImpl: async (_url, init) => {
			seenKey = init.headers["x-functions-key"];
			return response(204);
		},
	});
	assert.equal(armCalls[0].path, `${app.id}/host/default/listkeys`);
	assert.equal(seenKey, "master-secret");
});

test("HTTP discovery drops signed query values and successful responses retain shared secret redaction", async () => {
	const signed = envelope("httpSkill", {
		type: "httpTrigger",
		direction: "in",
		authLevel: "anonymous",
		methods: ["post"],
	});

	signed.properties.invoke_url_template =
		`https://${app.defaultHostName}/api/httpSkill?code=leaked-function-key&mode=safe`;
	const fn = classifyFunctionEnvelope(signed);
	let seenUrl = "";
	const result = await invokeFunction({
		arm: {},
		session: {},
		subscription: "sub-1",
		app,
		fn,
		fetchImpl: async (url) => {
			seenUrl = url;
			return response(200, JSON.stringify({ answer: "done", accessToken: "response-secret" }));
		},
	});

	assert.equal(fn.invokeUrl, `https://${app.defaultHostName}/api/httpSkill?mode=safe`);
	assert.equal(seenUrl, fn.invokeUrl);
	assert.equal(result.text, JSON.stringify({ answer: "done", accessToken: "[redacted]" }));
	assert.ok(!JSON.stringify(result).includes("response-secret"));
	assert.ok(!JSON.stringify(result).includes("leaked-function-key"));
});

test("HTTP response streaming stops at the response budget and redacts truncated JSON", async () => {
	const oversized = `{"AccessKey":"TOPSECRET","sql":"Server=tcp:example;Pwd=SQL_SECRET;","padding":"${"x".repeat(100_000)}"}`;
	const fn = classifyFunctionEnvelope(
		envelope("httpSkill", { type: "httpTrigger", direction: "in", authLevel: "anonymous", methods: ["post"] }),
	);
	const result = await invokeFunction({
		arm: {},
		session: {},
		subscription: "sub-1",
		app,
		fn,
		fetchImpl: async () => new Response(oversized, { status: 200 }),
	});
	assert.match(result.text, /\[response truncated\]$/);
	assert.ok(result.text.length < 66_000);
	assert.ok(!result.text.includes("TOPSECRET"));
	assert.ok(!result.text.includes("SQL_SECRET"));
});

test("anonymous GET-only HTTP invoke sends optional input in the query and never requests a key", async () => {
	let armCalled = false;
	let seen;
	const fn = classifyFunctionEnvelope({
		...envelope("httpGet", { type: "httpTrigger", direction: "in", authLevel: "anonymous", methods: ["get"] }),
		properties: {
			...envelope("httpGet", { type: "httpTrigger", direction: "in" }).properties,
			config: {
				name: "httpGet",
				bindings: [{ type: "httpTrigger", direction: "in", authLevel: "anonymous", methods: ["get"] }],
			},
		},
	});
	await invokeFunction({
		arm: { request: async () => { armCalled = true; } },
		session: {},
		subscription: "sub-1",
		app,
		fn,
		input: "status",
		fetchImpl: async (url, init) => {
			seen = { url, init };
			return response(204);
		},
	});

	assert.equal(armCalled, false);
	assert.equal(seen.init.method, "GET");
	assert.match(seen.url, /[?&]prompt=status/);
	assert.equal(seen.init.body, undefined);
});

test("Timer invoke uses the documented admin contract and labels optional data as trigger input", async () => {
	const bodies = [];
	const arm = {
		async request(options) {
			assert.equal(options.path, `${app.id}/host/default/listkeys`);
			assert.equal(options.method, "POST");
			return { body: { masterKey: "master-secret" } };
		},
	};
	const fn = classifyFunctionEnvelope(envelope("scheduledSkill", { type: "timerTrigger", direction: "in" }));
	const fetchImpl = async (url, init) => {
		assert.equal(url, `https://${app.defaultHostName}/admin/functions/scheduledSkill`);
		assert.equal(init.headers["x-functions-key"], "master-secret");
		bodies.push(init.body);
		return response(202);
	};

	const empty = await invokeFunction({ arm, session: {}, subscription: "sub-1", app, fn, fetchImpl });
	const withInput = await invokeFunction({
		arm,
		session: {},
		subscription: "sub-1",
		app,
		fn,
		input: "manual test",
		fetchImpl,
	});

	assert.deepEqual(bodies, ["{}", JSON.stringify({ input: "manual test" })]);
	assert.match(empty.note, /No trigger\/test input/);
	assert.match(withInput.note, /trigger\/test input/);
	assert.ok(!JSON.stringify(withInput).includes("master-secret"));
});

test("HTTP and Timer key-access RBAC failures identify the required management permission", async () => {
	const deniedArm = {
		async request() {
			throw Object.assign(new Error("AuthorizationFailed"), { status: 403 });
		},
	};
	const http = classifyFunctionEnvelope(
		envelope("httpSkill", { type: "httpTrigger", direction: "in", authLevel: "function", methods: ["post"] }),
	);
	const timer = classifyFunctionEnvelope(envelope("scheduledSkill", { type: "timerTrigger", direction: "in" }));

	await assert.rejects(
		() => invokeFunction({ arm: deniedArm, session: {}, subscription: "sub-1", app, fn: http }),
		/Microsoft\.Web\/sites\/functions\/listKeys\/action/,
	);
	await assert.rejects(
		() => invokeFunction({ arm: deniedArm, session: {}, subscription: "sub-1", app, fn: timer }),
		/Microsoft\.Web\/sites\/host\/listkeys\/action/,
	);
});

test("Queue invoke resolves an identity-based target and sends documented Put Message XML with a Storage token", async () => {
	const armCalls = [];
	const tokenCalls = [];
	let seen;
	const arm = {
		async request(options) {
			armCalls.push(options);
			return {
				body: {
					properties: {
						JobsStorage__queueServiceUri: "https://jobsstore.queue.core.windows.net/",
					},
				},
			};
		},
	};
	const session = {
		async accessToken(subscription, resource, force) {
			tokenCalls.push({ subscription, resource, force });
			return { accessToken: "storage-secret" };
		},
	};
	const fn = classifyFunctionEnvelope(
		envelope("queueSkill", { type: "queueTrigger", direction: "in", queueName: "skill-jobs", connection: "JobsStorage" }),
	);
	const result = await invokeFunction({
		arm,
		session,
		subscription: "sub-1",
		app,
		fn,
		input: "run digest",
		now: () => new Date("2026-09-03T12:00:00Z"),
		requestId: () => "client-request",
		fetchImpl: async (url, init) => {
			seen = { url, init };
			return response(201, "", { "x-ms-request-id": "queue-request" });
		},
	});

	assert.equal(armCalls[0].path, `${app.id}/config/appsettings/list`);
	assert.deepEqual(tokenCalls, [{ subscription: "sub-1", resource: STORAGE_RESOURCE, force: false }]);
	assert.equal(seen.url, "https://jobsstore.queue.core.windows.net/skill-jobs/messages");
	assert.equal(seen.init.headers.Authorization, "Bearer storage-secret");
	assert.equal(seen.init.headers["x-ms-version"], STORAGE_API_VERSION);
	assert.equal(seen.init.headers["x-ms-date"], "Thu, 03 Sep 2026 12:00:00 GMT");
	assert.equal(seen.init.headers["x-ms-client-request-id"], "client-request");
	const encoded = /<MessageText>([^<]*)<\/MessageText>/.exec(seen.init.body)[1];
	assert.equal(Buffer.from(encoded, "base64").toString("utf8"), "run digest");
	assert.equal(result.note, "Message enqueued to skill-jobs.");
	assert.ok(!JSON.stringify(result).includes("storage-secret"));
});

test("Queue invoke honors an explicit Functions messageEncoding=none app setting", async () => {
	let seen;
	const arm = {
		async request() {
			return {
				body: {
					properties: {
						JobsStorage__accountName: "jobsstore",
						AzureFunctionsJobHost__extensions__queues__messageEncoding: "none",
					},
				},
			};
		},
	};
	const fn = classifyFunctionEnvelope(
		envelope("queueSkill", { type: "queueTrigger", direction: "in", queueName: "skill-jobs", connection: "JobsStorage" }),
	);
	await invokeFunction({
		arm,
		session: { async accessToken() { return { accessToken: "storage-secret" }; } },
		subscription: "sub-1",
		app,
		fn,
		input: "run <digest>",
		fetchImpl: async (url, init) => {
			seen = { url, init };
			return response(201, "");
		},
	});
	assert.match(seen.init.body, /<MessageText>run &lt;digest&gt;<\/MessageText>/);
});

test("Queue invoke refreshes the Storage token once after 401 and reports data-plane RBAC failures safely", async () => {
	const tokenCalls = [];
	const session = {
		async accessToken(subscription, resource, force) {
			tokenCalls.push({ subscription, resource, force });
			return { accessToken: force ? "fresh-storage-secret" : "stale-storage-secret" };
		},
	};
	const arm = {
		async request() {
			return { body: { properties: { JobsStorage__accountName: "jobsstore" } } };
		},
	};
	const fn = classifyFunctionEnvelope(
		envelope("queueSkill", { type: "queueTrigger", direction: "in", queueName: "skill-jobs", connection: "JobsStorage" }),
	);
	let requestCount = 0;

	await assert.rejects(
		() =>
			invokeFunction({
				arm,
				session,
				subscription: "sub-1",
				app,
				fn,
				fetchImpl: async () => {
					requestCount += 1;
					return response(requestCount === 1 ? 401 : 403, "", { "x-ms-request-id": "denied-request" });
				},
			}),
		(error) => {
			assert.match(error.message, /Storage Queue Data Message Sender/);
			assert.match(error.message, /denied-request/);
			assert.ok(!error.message.includes("storage-secret"));
			return true;
		},
	);
	assert.deepEqual(
		tokenCalls.map(({ force }) => force),
		[false, true],
	);
});

test("Queue target resolution fails closed for missing, development, malformed, or untrusted endpoints", () => {
	const binding = { queueName: "skill-jobs", connection: "JobsStorage" };

	assert.throws(() => resolveQueueTarget(binding, {}), /Cannot resolve Queue target/);
	assert.throws(
		() => resolveQueueTarget(binding, { JobsStorage: "UseDevelopmentStorage=true" }),
		/Development Storage/,
	);
	assert.throws(
		() => resolveQueueTarget(binding, { JobsStorage__queueServiceUri: "http://jobsstore.queue.core.windows.net" }),
		/standard HTTPS Azure Queue endpoint/,
	);
	assert.throws(
		() => resolveQueueTarget(binding, { JobsStorage__queueServiceUri: "https://example.com/queue" }),
		/standard HTTPS Azure Queue endpoint/,
	);
	assert.throws(
		() => resolveQueueTarget({ ...binding, queueName: "../secret" }, { JobsStorage__accountName: "jobsstore" }),
		/valid Azure Storage queue name/,
	);
});

test("ARM discovery and unsupported trigger errors propagate instead of looking like success", async () => {
	const denied = Object.assign(new Error("GET functions failed (403): AuthorizationFailed"), { status: 403 });
	await assert.rejects(
		() =>
			listFunctionAppFunctions(
				{ list: async () => { throw denied; } },
				{ subscription: "sub-1", app },
			),
		(error) => error === denied,
	);

	const unsupported = classifyFunctionEnvelope(
		envelope("serviceBusSkill", { type: "serviceBusTrigger", direction: "in", queueName: "jobs" }),
	);
	await assert.rejects(
		() =>
			invokeFunction({
				arm: {},
				session: {},
				subscription: "sub-1",
				app,
				fn: unsupported,
			}),
		/does not synthesize/,
	);
});
