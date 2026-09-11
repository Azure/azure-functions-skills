export const AI_GATEWAY_PUBLIC_PREVIEW_FIX =
	"Confirm the Microsoft.ApiManagement provider is registered, the AI Gateway public preview is enabled for this subscription, and your account has read access to the gateway resources.";

function errorDetail(error) {
	return String(error?.azureMessage || error?.message || "Unknown Azure Resource Manager failure.").trim();
}

export function classifyGatewayArmError(error) {
	const code = String(error?.code || error?.azureCode || "").trim();
	const statusCode = Number(error?.status || error?.statusCode || 0);
	const normalized = `${code} ${errorDetail(error)}`.toLowerCase();
	let status = "error";
	let reason = "AI Gateway management discovery failed.";

	if (
		["missing subscription registration", "noregisteredproviderfound", "invalidresourcetype"].some((value) =>
			normalized.includes(value.replaceAll(" ", "")),
		) ||
		normalized.includes("is not registered")
	) {
		status = "registration";
		reason = "The AI Gateway public-preview resource provider or feature is not registered for this subscription.";
	} else if (
		code === "InvalidApiVersionParameter" ||
		normalized.includes("invalidapiversionparameter") ||
		normalized.includes("api version")
	) {
		status = "api-version";
		reason = "This subscription or region does not currently expose the AI Gateway preview management contract used by the Studio.";
	} else if (
		statusCode === 401 ||
		statusCode === 403 ||
		["authorizationfailed", "linkedauthorizationfailed"].some((value) => normalized.includes(value))
	) {
		status = "forbidden";
		reason = "The signed-in Azure identity is not authorized to inspect AI Gateway resources.";
	}

	const detail = errorDetail(error);
	return {
		status,
		code,
		statusCode,
		error: `${reason} ${AI_GATEWAY_PUBLIC_PREVIEW_FIX} Azure returned${code ? ` ${code}:` : ":"} ${detail}`,
		detail,
	};
}

export async function discoverModelCapabilities(discoverFoundry, discoverGateway) {
	const foundry = await discoverFoundry();
	try {
		const gateways = await discoverGateway();
		return {
			foundry,
			gateways,
			gatewayCapability: {
				status: "available",
				code: "",
				statusCode: 200,
				error: "",
				detail: "The AI Gateway ARM public-preview contract is available.",
			},
		};
	} catch (error) {
		return {
			foundry,
			gateways: [],
			gatewayCapability: classifyGatewayArmError(error),
		};
	}
}

export function requireGatewayCapability(capability) {
	if (capability?.status === "available") return;
	const error = new Error(
		capability?.error || `AI Gateway management discovery is unavailable. ${AI_GATEWAY_PUBLIC_PREVIEW_FIX}`,
	);
	throw Object.assign(error, {
		code: capability?.code || "GatewayCapabilityUnavailable",
		status: capability?.statusCode || 0,
	});
}

export function configuredModelBindingIsUsable(binding) {
	return Boolean(binding?.configured && binding?.activeSource && binding?.activeModelId);
}

export function gatewayRuntimeUrls(endpoint, workspace = "default") {
	const base = String(endpoint || "").trim().replace(/\/+$/, "");
	const scope = String(workspace || "").trim().replace(/^\/+|\/+$/g, "");
	if (!base || !scope) throw new Error("AI Gateway endpoint and workspace are required.");
	return {
		openAiBaseUrl: `${base}/${scope}/models/openai/v1`,
		githubMcpUrl: `${base}/${scope}/toolservers/github/mcp`,
	};
}
