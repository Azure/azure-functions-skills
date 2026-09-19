export function localRuntimeControlState(state) {
	const localStatus = state?.local?.status || "stopped";
	const materialized = Boolean(state?.sourceWorkspace?.materialized);
	const deploymentPreparing = state?.deployment?.status === "preparing";
	return {
		visible: state?.target !== "azure",
		disabled:
			localStatus === "starting" ||
			!materialized ||
			(deploymentPreparing && localStatus !== "running"),
		label:
			localStatus === "starting"
				? "Starting..."
				: localStatus === "running"
					? "Stop local function"
					: "Start local function",
	};
}

export function createLocalPortReservationPool({ isListening }) {
	const reserved = new Set();
	return {
		async reserve(start, span = 40) {
			for (let port = start; port < start + span; port += 1) {
				if (reserved.has(port)) continue;
				reserved.add(port);
				if (await isListening(port)) {
					reserved.delete(port);
					continue;
				}
				let released = false;
				return {
					port,
					release() {
						if (released) return;
						released = true;
						reserved.delete(port);
					},
				};
			}
			throw new Error(`No free TCP port found starting at ${start}`);
		},
	};
}

export function appendBoundedDeploymentOutput(
	deployment,
	event,
	{ maxLines = 800, maxChars = 120_000 } = {},
) {
	deployment.output ||= [];
	deployment.outputChars ||= 0;
	deployment.output.push(event);
	deployment.outputChars += event.text.length;
	while (
		deployment.output.length > maxLines ||
		(deployment.outputChars > maxChars && deployment.output.length > 1)
	) {
		const removed = deployment.output.shift();
		deployment.outputChars -= removed.text.length;
		deployment.outputTruncated = true;
	}
	return deployment;
}
