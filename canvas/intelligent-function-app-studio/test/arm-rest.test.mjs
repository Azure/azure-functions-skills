import { test } from "./vitest-test.mjs"
import assert from "node:assert/strict"

function jsonResponse(status, body, headers = {}) {
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: new Headers(headers),
		text: async () => (body == null ? "" : JSON.stringify(body)),
	}
}

function makeSession(tokens = ["token-1"]) {
	const calls = []
	return {
		calls,
		async accessToken(subscription, resource, force) {
			calls.push({ subscription, resource, force })
			return { accessToken: tokens[Math.min(calls.length - 1, tokens.length - 1)] }
		},
	}
}

const implementations = [
	["canvas", await import("../arm-rest.mjs")],
	["shared core", await import("../shared/function-app-core/src/arm-rest.mjs")],
]

for (const [implementationName, implementation] of implementations) {
	const {
		ARM_RESOURCE,
		AzureArmError,
		createArmClient,
		extractEtag,
		getArmRequestIds,
		ifMatch,
		ifNoneMatch,
		redactSensitive,
	} = implementation
	const contractTest = (name, handler) => test(`${implementationName}: ${name}`, handler)

contractTest("request appends api-version to subscription-relative paths without losing query", async () => {
	const session = makeSession()
	const seen = []
	const client = createArmClient({
		session,
		fetchImpl: async (url, init) => {
			seen.push({
				url,
				method: init.method,
				headers: Object.fromEntries(init.headers.entries()),
			})
			return jsonResponse(200, { ok: true }, { ETag: '"etag-1"', "x-ms-request-id": "req-1" })
		},
	})

	const response = await client.request({
		subscription: "sub-123",
		path: "resourceGroups/rg-one/providers/Microsoft.ApiManagement/service/gw-one?foo=bar",
		apiVersion: "2024-05-01",
		headers: { Accept: "application/json" },
	})

	assert.deepEqual(response, {
		body: { ok: true },
		etag: '"etag-1"',
		status: 200,
		headers: {
			etag: '"etag-1"',
			"x-ms-request-id": "req-1",
		},
	})
	assert.equal(
		seen[0].url,
		"https://management.azure.com/subscriptions/sub-123/resourceGroups/rg-one/providers/Microsoft.ApiManagement/service/gw-one?foo=bar&api-version=2024-05-01",
	)
	assert.equal(seen[0].method, "GET")
	assert.equal(seen[0].headers.accept, "application/json")
	assert.equal(seen[0].headers.authorization, "Bearer token-1")
	assert.deepEqual(session.calls, [{ subscription: "sub-123", resource: ARM_RESOURCE, force: false }])
})

contractTest("request supports resource ids, json bodies, no-content deletes, and etag helpers", async () => {
	const session = makeSession(["token-a", "token-b"])
	const seen = []
	const client = createArmClient({
		session,
		fetchImpl: async (url, init) => {
			seen.push({
				url,
				method: init.method,
				headers: Object.fromEntries(init.headers.entries()),
				body: init.body,
			})
			if (init.method === "PUT") return jsonResponse(200, { id: "done" }, { ETag: '"etag-42"', "request-id": "req-plain" })
			return jsonResponse(204, null)
		},
	})

	const path = "/subscriptions/sub-999/resourceGroups/rg/providers/Microsoft.ApiManagement/service/gw-two"
	const putResponse = await client.request({
		subscription: "ignored-default",
		path,
		apiVersion: "2024-06-01",
		method: "PUT",
		body: { enabled: true },
		headers: { Accept: "application/json" },
		...ifMatch('"etag-old"'),
		...ifNoneMatch("*"),
	})
	const deleteResponse = await client.request({
		subscription: "ignored-default",
		path,
		apiVersion: "2024-06-01",
		method: "DELETE",
	})

	assert.deepEqual(putResponse.body, { id: "done" })
	assert.equal(putResponse.etag, '"etag-42"')
	assert.equal(deleteResponse.body, null)
	assert.equal(seen[0].headers["content-type"], "application/json")
	assert.equal(seen[0].headers["if-match"], '"etag-old"')
	assert.equal(seen[0].headers["if-none-match"], "*")
	assert.equal(seen[0].body, JSON.stringify({ enabled: true }))
	assert.equal(extractEtag(putResponse.headers), '"etag-42"')
	assert.deepEqual(getArmRequestIds(putResponse.headers), {
		requestId: "req-plain",
		clientRequestId: null,
		correlationRequestId: null,
		routingRequestId: null,
	})
	assert.equal(session.calls[0].subscription, "sub-999")
	assert.equal(session.calls[1].subscription, "sub-999")
})

contractTest("list follows absolute ARM nextLink pages and flattens value arrays", async () => {
	const session = makeSession()
	const urls = []
	const client = createArmClient({
		session,
		fetchImpl: async (url) => {
			urls.push(url)
			if (urls.length === 1) {
				return jsonResponse(200, {
					value: [{ name: "first" }],
					nextLink:
						"https://management.azure.com/subscriptions/sub-321/providers/Microsoft.ApiManagement/service/gateways?$skiptoken=abc",
				})
			}
			return jsonResponse(200, { value: [{ name: "second" }] })
		},
	})

	const items = await client.list({
		subscription: "sub-321",
		path: "/subscriptions/sub-321/providers/Microsoft.ApiManagement/service/gateways",
		apiVersion: "2024-07-01",
		headers: { Accept: "application/json" },
	})

	assert.deepEqual(items, [{ name: "first" }, { name: "second" }])
	assert.deepEqual(urls, [
		"https://management.azure.com/subscriptions/sub-321/providers/Microsoft.ApiManagement/service/gateways?api-version=2024-07-01",
		"https://management.azure.com/subscriptions/sub-321/providers/Microsoft.ApiManagement/service/gateways?$skiptoken=abc&api-version=2024-07-01",
	])
})

contractTest("request retries exactly once after 401 with a forced token refresh", async () => {
	const session = makeSession(["stale-token", "fresh-token"])
	const seen = []
	const client = createArmClient({
		session,
		fetchImpl: async (url, init) => {
			seen.push({ url, authorization: init.headers.get("Authorization") })
			if (seen.length === 1) return jsonResponse(401, { error: { code: "ExpiredAuthenticationToken", message: "expired" } })
			return jsonResponse(200, { ok: true })
		},
	})

	const response = await client.request({
		subscription: "sub-401",
		path: "resourceGroups/rg/providers/Microsoft.ApiManagement/service/gw",
		apiVersion: "2024-05-01",
	})

	assert.deepEqual(response.body, { ok: true })
	assert.deepEqual(
		session.calls.map((call) => call.force),
		[false, true],
	)
	assert.deepEqual(
		seen.map((entry) => entry.authorization),
		["Bearer stale-token", "Bearer fresh-token"],
	)
})

contractTest("AzureArmError exposes structured fields and request ids without leaking secrets", async () => {
	const session = makeSession()
	const client = createArmClient({
		session,
		fetchImpl: async () =>
			jsonResponse(
				409,
				{
					error: {
						code: "PreconditionFailed",
						message: "Authorization: Bearer leaked-token and sig=very-secret",
						target: "properties.credentials",
						details: [{ code: "Conflict", message: "token=still-secret" }],
					},
				},
				{
					"x-ms-request-id": "req-123",
					"x-ms-client-request-id": "client-456",
					"x-ms-correlation-request-id": "corr-789",
				},
			),
	})

	await assert.rejects(
		() =>
			client.request({
				subscription: "sub-err",
				path: "resourceGroups/rg/providers/Microsoft.ApiManagement/service/gw?sig=very-secret",
				apiVersion: "2024-05-01",
			}),
		(error) => {
			assert.ok(error instanceof AzureArmError)
			assert.equal(error.status, 409)
			assert.equal(error.code, "PreconditionFailed")
			assert.match(error.azureMessage, /\[redacted\]/)
			assert.ok(!error.azureMessage.includes("very-secret"))
			assert.equal(error.target, "properties.credentials")
			assert.equal(error.method, "GET")
			assert.match(error.path, /\[redacted\]/)
			assert.ok(!error.message.includes("leaked-token"))
			assert.ok(!JSON.stringify(error.details).includes("still-secret"))
			assert.deepEqual(error.requestIds, {
				requestId: "req-123",
				clientRequestId: "client-456",
				correlationRequestId: "corr-789",
				routingRequestId: null,
			})
			return true
		},
	)
})

contractTest("redactSensitive redacts nested tokens, auth headers, and signed urls while leaving safe fields", () => {
	const redacted = redactSensitive({
		Authorization: "Bearer abc.def",
		apiKey: "secret-key",
		url: "https://management.azure.com/subscriptions/x/providers/Test?sig=secret&foo=ok",
		nested: [{ connectionString: "Endpoint=sb://secret" }],
		planToken: "confirmation-value",
		tokenLimit: 10000,
		safe: "visible",
	})

	assert.equal(redacted.Authorization, "[redacted]")
	assert.equal(redacted.apiKey, "[redacted]")
	assert.match(redacted.url, /\[redacted\]/)
	assert.equal(redacted.safe, "visible")
	assert.equal(redacted.planToken, "confirmation-value")
	assert.equal(redacted.tokenLimit, 10000)
	assert.equal(redacted.nested[0].connectionString, "[redacted]")
})
}
