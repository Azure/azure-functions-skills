const usingVitest = Boolean(process.env.VITEST);
const testModule = usingVitest ? await import("vitest") : await import("node:test");

export function test(name, handler) {
	if (!usingVitest) return testModule.test(name, handler);
	return testModule.test(name, (context) => handler({ ...context, after: testModule.onTestFinished }));
}

export default test;