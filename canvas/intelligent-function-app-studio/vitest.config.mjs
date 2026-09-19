import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/**/*.test.mjs", "shared/function-app-core/test/**/*.test.mjs"],
	},
});