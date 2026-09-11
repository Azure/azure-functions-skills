import { test } from "node:test";
import assert from "node:assert/strict";
import {
	APPLICATION_INSIGHTS_RESOURCE,
	queryApplicationInsights,
	resolveApplicationInsights,
} from "../src/application-insights.mjs";
import { redactSensitive } from "../src/arm-rest.mjs";

function response(status, body, headers = {}) {
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: new Headers(headers),
		text: async () => JSON.stringify(body),
	};
}

const app = {
	id: "/subscriptions/sub-1/resourceGroups/rg-one/providers/Microsoft.Web/sites/functions-one",
	name: "functions-one",
	resourceGroup: "rg-one",
};

test("resolves the configured Application Insights component without exposing settings", async () => {
	const calls = [];
	const arm = {
		async request(options) {
			calls.push(options);
			return {
				body: {
					properties: {
						APPLICATIONINSIGHTS_CONNECTION_STRING:
							"InstrumentationKey=11111111-2222-3333-4444-555555555555;IngestionEndpoint=https://example",
					},
				},
			};
		},
		async list(options) {
			calls.push(options);
			return [
				{
					id: "/subscriptions/sub-1/resourceGroups/observability-rg/providers/Microsoft.Insights/components/ai-one",
					name: "ai-one",
					properties: {
						InstrumentationKey: "11111111-2222-3333-4444-555555555555",
						AppId: "app-query-id",
					},
				},
			];
		},
	};

	const component = await resolveApplicationInsights(arm, { subscription: "sub-1", app });
	assert.deepEqual(component, {
		id: "/subscriptions/sub-1/resourceGroups/observability-rg/providers/Microsoft.Insights/components/ai-one",
		name: "ai-one",
		resourceGroup: "observability-rg",
		applicationId: "app-query-id",
	});
	assert.equal(calls[0].method, "POST");
	assert.equal(calls[1].path, "/subscriptions/sub-1/providers/Microsoft.Insights/components");
	assert.ok(!JSON.stringify(component).includes("11111111"));
});

test("redacts common Azure connection-string and SAS secret forms in free-form text", () => {
	const safe = redactSensitive(
		"DefaultEndpointsProtocol=https;AccountName=store;AccountKey=TOPSECRET; " +
			"Endpoint=sb://example/;SharedAccessKeyName=sender;SharedAccessKey=BUSSECRET; " +
			"SharedAccessSignature=sv=1&sig=SASSECRET; " +
			"Endpoint=https://example.service.signalr.net;AccessKey=SIGNALRSECRET;Version=1.0",
	);
	assert.match(safe, /AccountName=store/);
	assert.match(safe, /SharedAccessKeyName=sender/);
	assert.ok(!safe.includes("TOPSECRET"));
	assert.ok(!safe.includes("BUSSECRET"));
	assert.ok(!safe.includes("SASSECRET"));
	assert.ok(!safe.includes("SIGNALRSECRET"));
	assert.equal(redactSensitive({ AccessKey: "STRUCTURED_SECRET" }).AccessKey, "[redacted]");
	assert.deepEqual(
		redactSensitive({
			Pwd: "STRUCTURED_PWD",
			AccountKey: "STRUCTURED_ACCOUNT",
			SharedAccessKey: "STRUCTURED_SHARED",
		}),
		{ Pwd: "[redacted]", AccountKey: "[redacted]", SharedAccessKey: "[redacted]" },
	);
	const truncatedJson = redactSensitive(
		`{"AccessKey":"JSON_SECRET","sql":"Server=tcp:example;User ID=app;Pwd=SQL_SECRET;","padding":"${"x".repeat(100)}"`,
	);
	assert.ok(!truncatedJson.includes("JSON_SECRET"));
	assert.ok(!truncatedJson.includes("SQL_SECRET"));
});

test("queries bounded summary and redacted traces with the Application Insights audience", async () => {
	const tokenCalls = [];
	const session = {
		async accessToken(subscription, resource, force) {
			tokenCalls.push({ subscription, resource, force });
			return { accessToken: "secret-token" };
		},
	};
	let request = 0;
	const telemetry = await queryApplicationInsights(session, {
		subscription: "sub-1",
		component: { applicationId: "app-query-id" },
		fetchImpl: async (url, init) => {
			request += 1;
			assert.equal(url, "https://api.applicationinsights.io/v1/apps/app-query-id/query");
			assert.equal(init.method, "POST");
			assert.equal(init.headers.Authorization, "Bearer secret-token");
			if (request === 1) return response(200, { tables: [{ rows: [[12, 2, 45.4]] }] });
			return response(200, {
				tables: [{
					rows: [
						["2026-09-04T00:00:00Z", "exception", 3, "authorization: Bearer leaked", "op-1"],
					],
				}],
			});
		},
	});

	assert.deepEqual(telemetry.summary, { total: 12, failed: 2, avgMs: 45.4 });
	assert.equal(telemetry.traces.length, 1);
	assert.match(telemetry.traces[0].message, /\[redacted\]/);
	assert.ok(!JSON.stringify(telemetry).includes("leaked"));
	assert.ok(tokenCalls.every((call) => call.resource === APPLICATION_INSIGHTS_RESOURCE));
});

test("structured query failures propagate with request IDs and no token material", async () => {
	await assert.rejects(
		() =>
			queryApplicationInsights(
				{ async accessToken() { return { accessToken: "secret-token" }; } },
				{
					subscription: "sub-1",
					component: { applicationId: "app-query-id" },
					fetchImpl: async () =>
						response(
							403,
							{ error: { code: "Forbidden", message: "token=secret-value" } },
							{ "x-ms-request-id": "request-1" },
						),
				},
			),
		(error) => {
			assert.equal(error.status, 403);
			assert.equal(error.code, "Forbidden");
			assert.match(error.message, /request-1/);
			assert.ok(!error.message.includes("secret-value"));
			return true;
		},
	);
});
