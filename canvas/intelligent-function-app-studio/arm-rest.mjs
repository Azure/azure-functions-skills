export const ARM_RESOURCE = "https://management.azure.com/"

/**
 * @typedef {{ accessToken(subscription: string, resource: string, force: boolean): Promise<string | { accessToken?: string }> }} ArmTokenSession
 * @typedef {{ session?: ArmTokenSession, fetchImpl?: typeof fetch }} ArmClientOptions
 * @typedef {{ subscription?: string, path?: string, apiVersion?: string, method?: string, body?: unknown, headers?: HeadersInit, ifMatch?: string, ifNoneMatch?: string }} ArmRequestOptions
 * @typedef {{ subscription?: string, path?: string, apiVersion?: string, headers?: HeadersInit }} ArmListOptions
 */

const ARM_ORIGIN = new URL(ARM_RESOURCE).origin.toLowerCase()
const REDACTED = "[redacted]"
const SENSITIVE_KEY_RE =
	/(?:authorization|access.?token|refresh.?token|^(?:id|session|auth)?token$|api.?key|^(?:primary|secondary|subscription|runtime)?key$|secret|password|sig(?:nature)?|connection.?string|client.?secret|sharedaccesssignature)/i
const SENSITIVE_QUERY_RE =
	/^(?:access_token|assertion|client_assertion|client_secret|code|password|refresh_token|sig|signature|token)$/i

function readHeader(headersLike, name) {
	const headers = headersLike?.headers || headersLike
	if (!headers) return null
	if (typeof headers.get === "function") return headers.get(name) ?? null
	for (const [key, value] of Object.entries(headers)) {
		if (String(key).toLowerCase() === String(name).toLowerCase()) return value == null ? null : String(value)
	}
	return null
}

function headersObject(headersLike) {
	const headers = headersLike?.headers || headersLike
	const out = {}
	if (!headers) return out
	if (typeof headers.forEach === "function") {
		headers.forEach((value, key) => {
			out[String(key).toLowerCase()] = String(value)
		})
		return out
	}
	for (const [key, value] of Object.entries(headers)) out[String(key).toLowerCase()] = String(value)
	return out
}

function extractSubscription(pathname, fallback = "") {
	const match = /^\/subscriptions\/([^/]+)/i.exec(String(pathname || ""))
	return match ? decodeURIComponent(match[1]) : fallback
}

function normalizeAccessToken(tokenResult) {
	if (typeof tokenResult === "string" && tokenResult) return tokenResult
	if (tokenResult && typeof tokenResult.accessToken === "string" && tokenResult.accessToken) return tokenResult.accessToken
	throw new TypeError("Azure CLI session returned no ARM access token.")
}

function sanitizeString(value) {
	let text = String(value || "")
	try {
		const url = new URL(text)
		for (const [key] of url.searchParams) {
			if (SENSITIVE_QUERY_RE.test(key)) url.searchParams.set(key, REDACTED)
		}
		text = url.toString()
	} catch {}
	return text
		.replace(
			/(["']?(?:authorization|api-key)["']?\s*:\s*["']?)(?:Bearer\s+)?[^"',\r\n}]+/gi,
			`$1${REDACTED}`,
		)
		.replace(/(api-key\s*:\s*)\S+/gi, `$1${REDACTED}`)
		.replace(/(authorization\s*:\s*)(?:Bearer\s+)?[^\r\n]+/gi, `$1${REDACTED}`)
		.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi, `Bearer ${REDACTED}`)
		.replace(/(\b(?:access_token|assertion|client_assertion|client_secret|code|password|refresh_token|sig|signature|token)=)[^&\s]+/gi, `$1${REDACTED}`)
}

export function redactSensitive(value, key = "") {
	if (value == null) return value
	if (SENSITIVE_KEY_RE.test(String(key))) return REDACTED
	if (typeof value === "string") return sanitizeString(value)
	if (Array.isArray(value)) return value.map((entry) => redactSensitive(entry, key))
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([childKey, childValue]) => [childKey, redactSensitive(childValue, childKey)]),
		)
	}
	return value
}

function parseErrorShape(body) {
	const error = body?.error && typeof body.error === "object" ? body.error : body
	if (!error || typeof error !== "object") {
		return { code: "", message: "", details: [], target: "" }
	}
	return {
		code: typeof error.code === "string" ? error.code : "",
		message: typeof error.message === "string" ? sanitizeString(error.message) : "",
		details: Array.isArray(error.details) ? redactSensitive(error.details) : [],
		target: typeof error.target === "string" ? sanitizeString(error.target) : "",
	}
}

function resolvePath(path, subscription, apiVersion) {
	const raw = String(path || "").trim()
	if (!raw) throw new TypeError("ARM path is required.")

	let absoluteUrl
	if (/^https?:\/\//i.test(raw)) {
		const url = new URL(raw)
		if (url.origin.toLowerCase() !== ARM_ORIGIN) {
			throw new RangeError("Absolute ARM URLs must use https://management.azure.com.")
		}
		absoluteUrl = raw
	} else {
		let relativePath = raw.startsWith("/") ? raw : `/${raw}`
		if (!/^\/(?:subscriptions\/|providers\/)/i.test(relativePath)) {
			if (!subscription) throw new TypeError("A subscription is required for subscription-relative ARM paths.")
			relativePath = `/subscriptions/${encodeURIComponent(subscription)}${relativePath}`
		}
		absoluteUrl = `${ARM_RESOURCE.slice(0, -1)}${relativePath}`
	}

	if (!/[?&]api-version=/i.test(absoluteUrl)) {
		if (!apiVersion) throw new TypeError("An explicit ARM api-version is required.")
		absoluteUrl = `${absoluteUrl}${absoluteUrl.includes("?") ? "&" : "?"}api-version=${encodeURIComponent(apiVersion)}`
	}

	const url = new URL(absoluteUrl)
	return {
		url: absoluteUrl,
		path: sanitizeString(absoluteUrl.replace(/^https:\/\/management\.azure\.com/i, "")),
		subscription: extractSubscription(url.pathname, subscription || ""),
	}
}

async function parseBody(response) {
	const text = await response.text()
	if (!text || response.status === 204 || response.status === 205) return null
	try {
		return JSON.parse(text)
	} catch {
		throw new Error(`ARM ${response.status} response was not valid JSON.`)
	}
}

export class AzureArmError extends Error {
	constructor({ status, code = "", message = "", details = [], target = "", requestIds = {}, method = "", path = "" }) {
		super(message || `${method} ${path} failed (${status})`)
		this.name = "AzureArmError"
		this.status = Number(status || 0)
		this.code = code
		this.azureMessage = message
		this.details = details
		this.target = target
		this.requestIds = requestIds
		this.method = method
		this.path = path
	}
}

export function extractEtag(headersLike) {
	return readHeader(headersLike, "etag")
}

export function getArmRequestIds(headersLike) {
	return {
		requestId: readHeader(headersLike, "x-ms-request-id") || readHeader(headersLike, "request-id"),
		clientRequestId: readHeader(headersLike, "x-ms-client-request-id"),
		correlationRequestId: readHeader(headersLike, "x-ms-correlation-request-id"),
		routingRequestId: readHeader(headersLike, "x-ms-routing-request-id"),
	}
}

export function ifMatch(etag) {
	return etag ? { ifMatch: String(etag) } : {}
}

export function ifNoneMatch(etag = "*") {
	return etag ? { ifNoneMatch: String(etag) } : {}
}

function buildArmError({ method, path, response, body }) {
	const azure = parseErrorShape(body)
	const status = Number(response?.status || 0)
	const requestIds = getArmRequestIds(response)
	const summary = azure.message ? `${azure.code ? ` ${azure.code}` : ""}: ${azure.message}` : ""
	const error = new AzureArmError({
		status,
		code: azure.code,
		message: `${method} ${path} failed (${status})${summary}`,
		details: azure.details,
		target: azure.target,
		requestIds,
		method,
		path,
	})
	error.azureMessage = azure.message
	return error
}

/** @param {ArmClientOptions} [options] */
export function createArmClient({ session, fetchImpl = fetch } = {}) {
	if (!session || typeof session.accessToken !== "function") {
		throw new TypeError("createArmClient requires a session with accessToken(subscription, resource, force).")
	}
	if (typeof fetchImpl !== "function") throw new TypeError("createArmClient requires a fetch implementation.")

	/** @param {ArmRequestOptions} [options] */
	async function request({
		subscription = "",
		path,
		apiVersion,
		method = "GET",
		body,
		headers,
		ifMatch: match,
		ifNoneMatch: noneMatch,
	} = {}) {
		const resolved = resolvePath(path, subscription, apiVersion)
		const verb = String(method || "GET").toUpperCase()

		const doFetch = async (forceRefresh = false) => {
			const tokenResult = await session.accessToken(resolved.subscription, ARM_RESOURCE, forceRefresh)
			const requestHeaders = new Headers(headers || {})
			requestHeaders.set("Authorization", `Bearer ${normalizeAccessToken(tokenResult)}`)
			if (body !== undefined && !requestHeaders.has("Content-Type")) requestHeaders.set("Content-Type", "application/json")
			if (match) requestHeaders.set("If-Match", String(match))
			if (noneMatch) requestHeaders.set("If-None-Match", String(noneMatch))
			return fetchImpl(resolved.url, {
				method: verb,
				headers: requestHeaders,
				body: body === undefined ? undefined : JSON.stringify(body),
			})
		}

		let response = await doFetch(false)
		if (response.status === 401) response = await doFetch(true)
		const responseBody = await parseBody(response)
		if (!response.ok) throw buildArmError({ method: verb, path: resolved.path, response, body: responseBody })
		return {
			body: responseBody,
			etag: extractEtag(response),
			status: response.status,
			headers: headersObject(response.headers),
		}
	}

	/** @param {ArmListOptions} [options] */
	async function list({ subscription = "", path, apiVersion, headers } = {}) {
		const items = []
		let nextPath = path
		do {
			const response = await request({ subscription, path: nextPath, apiVersion, method: "GET", headers })
			if (Array.isArray(response.body?.value)) {
				items.push(...response.body.value)
			} else if (response.body != null) {
				items.push(response.body)
			}
			nextPath = response.body?.nextLink || ""
		} while (nextPath)
		return items
	}

	return { request, list }
}
