import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function enforceIdentityOnlyDeploymentTemplate(projectDir) {
	const mainFile = path.join(projectDir, "infra", "main.bicep");
	const apiFile = path.join(projectDir, "infra", "app", "api.bicep");
	const foundryFile = path.join(projectDir, "infra", "app", "foundry.bicep");
	const [mainSource, apiSource, foundrySource] = await Promise.all([
		readFile(mainFile, "utf8"),
		readFile(apiFile, "utf8"),
		readFile(foundryFile, "utf8"),
	]);

	const mainNext = (() => {
		let next = mainSource;
		if (!/allowSharedKeyAccess:\s*false\b/.test(next)) {
			if (!/allowSharedKeyAccess:\s*true\b/.test(next)) {
				throw new Error("Deployment template does not declare the Storage shared-key policy; refusing to guess.");
			}
			next = next.replace(/allowSharedKeyAccess:\s*true\b/, "allowSharedKeyAccess: false");
		}
		if (
			/AZURE_FUNCTIONS_AGENTS_PROVIDER:\s*'foundry'/.test(next) &&
			/FOUNDRY_MODEL:\s*foundry\.outputs\.modelDeploymentName/.test(next) &&
			!/\bAZURE_FUNCTIONS_AGENTS_MODEL:/.test(next)
		) {
			next = next.replace(
				/(\s+)FOUNDRY_MODEL:\s*foundry\.outputs\.modelDeploymentName/,
				"$&$1AZURE_FUNCTIONS_AGENTS_MODEL: foundry.outputs.modelDeploymentName",
			);
		}
		if (
			/AZURE_FUNCTIONS_AGENTS_PROVIDER:\s*'foundry'/.test(next) &&
			!/\bAZURE_FUNCTIONS_AGENTS_MODEL:/.test(next)
		) {
			throw new Error("Deployment template does not expose the hosted-agent model setting; refusing to guess.");
		}
		return next;
	})();

	const apiNext = (() => {
		const directOptionalEndpoints =
			/^\s*AzureWebJobsStorage__(?:queue|table|file)ServiceUri:\s*stg\.properties\.primaryEndpoints\.(?:queue|table|file)\s*$/gm;
		const next = apiSource.replace(directOptionalEndpoints, "");
		if (
			/AzureWebJobsStorage__(?:queue|table|file)ServiceUri/.test(next) &&
			!(
				/param enableQueue bool = false/.test(next) &&
				/param enableTable bool = false/.test(next) &&
				/param enableFile bool = false/.test(next)
			)
		) {
			throw new Error("Deployment template exposes unrecognized optional host-storage settings; refusing to guess.");
		}
		return next;
	})();

	const foundryNext = (() => {
		if (/disableLocalAuth:\s*true\b/.test(foundrySource)) return foundrySource;
		if (/disableLocalAuth:\s*false\b/.test(foundrySource)) {
			return foundrySource.replace(/disableLocalAuth:\s*false\b/, "disableLocalAuth: true");
		}
		const account = /resource foundryAccount[\s\S]*?properties:\s*\{\n/;
		if (!account.test(foundrySource)) {
			throw new Error("Deployment template does not expose Foundry account properties; refusing to guess.");
		}
		return foundrySource.replace(account, (match) => `${match}    disableLocalAuth: true\n`);
	})();

	await Promise.all([
		mainNext === mainSource ? undefined : writeFile(mainFile, mainNext),
		apiNext === apiSource ? undefined : writeFile(apiFile, apiNext),
		foundryNext === foundrySource ? undefined : writeFile(foundryFile, foundryNext),
	]);
}
