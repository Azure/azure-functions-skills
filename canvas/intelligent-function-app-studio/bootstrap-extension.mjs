#!/usr/bin/env node

import { existsSync, lstatSync, mkdirSync, realpathSync, symlinkSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = dirname(fileURLToPath(import.meta.url));
const copilotHome = process.env.COPILOT_HOME || join(homedir(), ".copilot");
const extensionsDir = join(copilotHome, "extensions");
const destination = join(extensionsDir, "intelligent-function-app-studio");

mkdirSync(extensionsDir, { recursive: true });

let destinationStats = null;
try {
	destinationStats = lstatSync(destination);
} catch (error) {
	if (error.code !== "ENOENT") throw error;
}

if (destinationStats) {
	let sameTarget = false;
	try {
		sameTarget = realpathSync(destination) === realpathSync(pluginRoot);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	if (sameTarget) {
		console.log(`Functions Hosted Skills Studio extension is already linked at ${destination}`);
		process.exit(0);
	}
	if (destinationStats.isSymbolicLink() && !existsSync(destination)) {
		unlinkSync(destination);
	} else {
		const kind = destinationStats.isSymbolicLink() ? "link" : "path";
		throw new Error(`Refusing to replace existing ${kind}: ${destination}`);
	}
}

symlinkSync(pluginRoot, destination, process.platform === "win32" ? "junction" : "dir");
console.log(`Linked Functions Hosted Skills Studio extension at ${destination}`);
