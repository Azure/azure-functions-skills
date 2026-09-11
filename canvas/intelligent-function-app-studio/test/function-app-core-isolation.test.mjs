import { test } from "./vitest-test.mjs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const canvasDir = dirname(dirname(fileURLToPath(import.meta.url)));
const packagePath = join(canvasDir, "package.json");

test("Function Studio marketplace package contains and resolves its shared runtime", () => {
	const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
	const dependency = pkg.dependencies["@cloud-foundation/function-app-core"];
	assert.equal(dependency, "file:./shared/function-app-core");
	const dependencyPath = resolve(canvasDir, dependency.slice("file:".length));
	assert.ok(!relative(canvasDir, dependencyPath).startsWith(".."));
	const shared = JSON.parse(readFileSync(join(dependencyPath, "package.json"), "utf8"));
	assert.equal(shared.name, "@cloud-foundation/function-app-core");
	const requireFromCanvas = createRequire(packagePath);
	const resolvedRuntime = realpathSync(requireFromCanvas.resolve("@cloud-foundation/function-app-core/runtime"));
	assert.ok(!relative(canvasDir, resolvedRuntime).startsWith(".."));
});
