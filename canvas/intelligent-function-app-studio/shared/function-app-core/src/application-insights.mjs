import { redactSensitive } from "./arm-rest.mjs";

export const APPLICATION_INSIGHTS_API_VERSION = "2020-02-02";
export const APPLICATION_INSIGHTS_RESOURCE = "https://api.applicationinsights.io";

export const REQUEST_SUMMARY_QUERY =
	"requests | where timestamp > ago(30m) | summarize total=count(), failed=countif(success == false), avgMs=avg(duration)";
export const TRACE_QUERY =
	'union (traces | project timestamp, eventKind="trace", severityLevel=tolong(severityLevel), message, operationId=operation_Id), ' +
	'(exceptions | project timestamp, eventKind="exception", severityLevel=tolong(3), message=outerMessage, operationId=operation_Id) ' +
	"| where timestamp > ago(30m) | top 40 by timestamp desc";

/**
 * @typedef {{ accessToken(subscription: string, resource: string, force: boolean): Promise<string | { accessToken?: string }> }} TelemetryTokenSession
 * @typedef {{ subscription?: string, component?: { applicationId?: string }, fetchImpl?: typeof fetch }} TelemetryQueryOptions
 */

function clean(value) {
	return typeof value === "string" ? value.trim() : "";
}

function requireAppId(app) {
	const id = clean(app?.id);
	if (!/^\/subscriptions\/[^/]+\/resourceGroups\/[^/]+\/providers\/Microsoft\.Web\/sites\/[^/]+$/i.test(id)) {
		throw new Error("The selected Function App has no valid ARM resource ID.");
	}
	return id;
}

function dictionary(body) {
	const value = body?.properties && typeof body.properties === "object" ? body.properties : body;
	return value && typeof value === "object" ? value : {};
}

function instrumentationKey(settings) {
	const entries = Object.entries(settings || {});
	const connection = clean(
		entries.find(([key]) => key.toLowerCase() === "applicationinsights_connection_string")?.[1],
	);
	const fromConnection = /(?:^|;)InstrumentationKey=([0-9a-f-]+)(?:;|$)/i.exec(connection)?.[1] || "";
	return (
		fromConnection ||
		clean(entries.find(([key]) => key.toLowerCase() === "appinsights_instrumentationkey")?.[1])
	);
}

function resourceGroup(id) {
	return decodeURIComponent(/\/resourceGroups\/([^/]+)/i.exec(clean(id))?.[1] || "");
}

export async function resolveApplicationInsights(arm, { subscription, app }) {
	const appResponse = await arm.request({
		subscription,
		path: `${requireAppId(app)}/config/appsettings/list`,
		apiVersion: "2024-11-01",
		method: "POST",
	});
	const ikey = instrumentationKey(dictionary(appResponse.body));
	if (!ikey) {
		throw new Error(`${app.name || "The selected Function App"} has no Application Insights connection string configured.`);
	}

	const components = await arm.list({
		subscription,
		path: `/subscriptions/${encodeURIComponent(subscription)}/providers/Microsoft.Insights/components`,
		apiVersion: APPLICATION_INSIGHTS_API_VERSION,
	});
	const component = components.find(
		(candidate) => clean(candidate?.properties?.InstrumentationKey).toLowerCase() === ikey.toLowerCase(),
	);
	if (!component) {
		throw new Error("The configured instrumentation key did not match an accessible Application Insights resource in the subscription.");
	}
	const applicationId = clean(component?.properties?.AppId);
	if (!applicationId) throw new Error("The matched Application Insights resource has no query application ID.");
	return {
		id: clean(component.id),
		name: clean(component.name),
		resourceGroup: resourceGroup(component.id),
		applicationId,
	};
}

function responseRequestId(response) {
	return response.headers?.get?.("x-ms-request-id") || response.headers?.get?.("request-id") || "";
}

async function parseQueryResponse(response) {
	const text = await response.text();
	let body;
	try {
		body = text ? JSON.parse(text) : {};
	} catch {
		throw new Error(`Application Insights query returned non-JSON HTTP ${response.status}.`);
	}
	if (!response.ok) {
		const safe = redactSensitive(body);
		const code = clean(safe?.error?.code || safe?.code);
		const message = clean(safe?.error?.message || safe?.message);
		const requestId = responseRequestId(response);
		throw Object.assign(
			new Error(
				`Application Insights query failed (HTTP ${response.status})` +
					(code ? ` ${code}` : "") +
					(message ? `: ${message}` : "") +
					(requestId ? ` Request ID: ${requestId}.` : ""),
			),
			{ status: response.status, code, requestId },
		);
	}
	return body;
}

async function query(session, subscription, applicationId, queryText, fetchImpl) {
	const url = `https://api.applicationinsights.io/v1/apps/${encodeURIComponent(applicationId)}/query`;
	const send = async (force) => {
		const tokenResult = await session.accessToken(subscription, APPLICATION_INSIGHTS_RESOURCE, force);
		const token = typeof tokenResult === "string" ? tokenResult : tokenResult?.accessToken;
		if (!token) throw new Error("Azure CLI session returned no Application Insights access token.");
		return fetchImpl(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ query: queryText }),
		});
	};
	let response = await send(false);
	if (response.status === 401) response = await send(true);
	return parseQueryResponse(response);
}

function firstTable(body) {
	return Array.isArray(body?.tables) ? body.tables[0] : null;
}

/** @param {TelemetryTokenSession} session @param {TelemetryQueryOptions} [options] */
export async function queryApplicationInsights(
	session,
	{ subscription, component, fetchImpl = fetch } = {},
) {
	if (!session || typeof session.accessToken !== "function") {
		throw new TypeError("Application Insights query requires an Azure CLI token session.");
	}
	if (!component?.applicationId) throw new Error("Resolve an Application Insights component before querying telemetry.");
	const [summaryBody, tracesBody] = await Promise.all([
		query(session, subscription, component.applicationId, REQUEST_SUMMARY_QUERY, fetchImpl),
		query(session, subscription, component.applicationId, TRACE_QUERY, fetchImpl),
	]);
	const summaryRow = firstTable(summaryBody)?.rows?.[0] || [];
	const traceRows = firstTable(tracesBody)?.rows || [];
	return {
		windowMinutes: 30,
		summary: {
			total: Number(summaryRow[0] || 0),
			failed: Number(summaryRow[1] || 0),
			avgMs: Number(summaryRow[2] || 0),
		},
		traces: traceRows.slice(0, 40).map((row) => ({
			time: clean(row[0]),
			kind: clean(row[1]) || "trace",
			severity: Number(row[2] || 0),
			message: clean(redactSensitive(row[3])).slice(0, 1000),
			operationId: clean(row[4]),
		})),
	};
}
