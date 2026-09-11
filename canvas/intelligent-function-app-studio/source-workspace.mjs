import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, readlink, rename, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_CURRENT_SUBDIR = path.join("functions", "daily-repo-digest");
const MANIFEST_VERSION = 1;
const RUNTIME_DIRS = new Set([
	".azurite",
	".azure",
	".git",
	".intelligent-function-app-studio",
	".mypy_cache",
	".pytest_cache",
	".python_packages",
	".venv",
	"__pycache__",
]);

async function pathExists(filePath) {
	try {
		await lstat(filePath);
		return true;
	} catch (error) {
		if (error?.code === "ENOENT") return false;
		throw error;
	}
}

function normalizedRelativePath(relativePath) {
	const raw = String(relativePath || "").trim();
	if (!raw || path.isAbsolute(raw)) throw new Error("Choose a non-empty relative folder inside the current worktree.");
	const normalized = path.normalize(raw);
	if (normalized === ".") throw new Error("The generated app folder must be a dedicated subfolder inside the current worktree.");
	if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
		throw new Error("The generated app folder must stay inside the current worktree.");
	}
	return normalized;
}

export function resolveCurrentWorkspaceDestination(workingDirectory, relativePath = DEFAULT_CURRENT_SUBDIR) {
	if (!workingDirectory || !path.isAbsolute(workingDirectory)) {
		throw new Error("The current chat does not expose an absolute worktree path. Use an isolated workspace instead.");
	}
	const root = path.resolve(workingDirectory);
	const relative = normalizedRelativePath(relativePath);
	const destination = path.resolve(root, relative);
	const fromRoot = path.relative(root, destination);
	if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) {
		throw new Error("The generated app folder must be a dedicated subfolder inside the current worktree.");
	}
	return { root, relative, destination };
}

export async function assertCurrentWorkspaceDestinationSafe(
	workingDirectory,
	relativePath = DEFAULT_CURRENT_SUBDIR,
) {
	const selected = resolveCurrentWorkspaceDestination(workingDirectory, relativePath);
	let cursor = selected.root;
	for (const segment of selected.relative.split(path.sep)) {
		cursor = path.join(cursor, segment);
		try {
			const stat = await lstat(cursor);
			if (stat.isSymbolicLink()) {
				throw new Error(`The generated app path cannot traverse a symbolic link: ${cursor}`);
			}
			if (cursor !== selected.destination && !stat.isDirectory()) {
				throw new Error(`The generated app parent path is not a directory: ${cursor}`);
			}
		} catch (error) {
			if (error?.code === "ENOENT") break;
			throw error;
		}
	}
	return selected;
}

export function sourceManifestPath(copilotHome, sessionId, instanceId) {
	const key = createHash("sha256")
		.update(`${String(sessionId || "unknown")}\0${String(instanceId || "unknown")}`)
		.digest("hex")
		.slice(0, 24);
	return path.join(copilotHome, "extensions", "intelligent-function-app-studio", "artifacts", "source-workspaces", `${key}.json`);
}

function ignoredRuntimePath(relativePath) {
	const parts = relativePath.split(path.sep);
	const base = parts.at(-1) || "";
	return (
		parts.some((part) => RUNTIME_DIRS.has(part)) ||
		base === ".DS_Store" ||
		base === "local.settings.json" ||
		base.endsWith(".pyc")
	);
}

async function fileDigest(filePath) {
	const bytes = await readFile(filePath);
	return createHash("sha256").update(bytes).digest("hex");
}

export async function snapshotWorkspaceTree(root, { ignoreRuntime = true } = {}) {
	const absoluteRoot = path.resolve(root);
	const entries = [];

	async function visit(directory, relativeDirectory = "") {
		const children = await readdir(directory, { withFileTypes: true });
		children.sort((a, b) => a.name.localeCompare(b.name));
		for (const child of children) {
			const relativePath = path.join(relativeDirectory, child.name);
			if (ignoreRuntime && ignoredRuntimePath(relativePath)) continue;
			const absolutePath = path.join(directory, child.name);
			if (child.isDirectory()) {
				await visit(absolutePath, relativePath);
			} else if (child.isSymbolicLink()) {
				entries.push({ path: relativePath, type: "symlink", target: await readlink(absolutePath) });
			} else if (child.isFile()) {
				const stat = await lstat(absolutePath);
				entries.push({ path: relativePath, type: "file", size: stat.size, sha256: await fileDigest(absolutePath) });
			} else {
				throw new Error(`Unsupported generated workspace entry: ${relativePath}`);
			}
		}
	}

	if (await pathExists(absoluteRoot)) await visit(absoluteRoot);
	return entries;
}

export async function createOwnershipManifest({ root, workspaceRoot, relativePath, sessionId, instanceId }) {
	const resolvedRoot = path.resolve(root);
	const resolvedWorkspace = path.resolve(workspaceRoot);
	const safe = resolveCurrentWorkspaceDestination(resolvedWorkspace, relativePath);
	if (safe.destination !== resolvedRoot) throw new Error("Generated workspace ownership does not match its declared worktree path.");
	return {
		version: MANIFEST_VERSION,
		root: resolvedRoot,
		workspaceRoot: resolvedWorkspace,
		relativePath: safe.relative,
		sessionId: String(sessionId || ""),
		instanceId: String(instanceId || ""),
		createdAt: new Date().toISOString(),
		baseline: await snapshotWorkspaceTree(resolvedRoot),
	};
}

export async function writeOwnershipManifest(filePath, manifest) {
	await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
	const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
	await rename(temporary, filePath);
}

export async function readOwnershipManifest(filePath) {
	try {
		const manifest = JSON.parse(await readFile(filePath, "utf8"));
		if (manifest?.version !== MANIFEST_VERSION || !manifest.root || !manifest.workspaceRoot || !Array.isArray(manifest.baseline)) {
			throw new Error("Generated workspace ownership manifest is invalid.");
		}
		return manifest;
	} catch (error) {
		if (error?.code === "ENOENT") return null;
		throw error;
	}
}

export async function verifyOwnedWorkspace(root, manifest) {
	const resolvedRoot = path.resolve(root);
	if (path.resolve(manifest?.root || "") !== resolvedRoot) {
		throw new Error("Generated workspace ownership manifest does not match this folder.");
	}
	const baseline = new Map(manifest.baseline.map((entry) => [entry.path, entry]));
	const currentEntries = await snapshotWorkspaceTree(resolvedRoot);
	const current = new Map(currentEntries.map((entry) => [entry.path, entry]));
	const conflicts = [];
	for (const [relativePath, expected] of baseline) {
		const actual = current.get(relativePath);
		if (!actual) {
			conflicts.push({ path: relativePath, reason: "missing" });
		} else if (JSON.stringify(actual) !== JSON.stringify(expected)) {
			conflicts.push({ path: relativePath, reason: "modified" });
		}
	}
	for (const relativePath of current.keys()) {
		if (!baseline.has(relativePath)) conflicts.push({ path: relativePath, reason: "added" });
	}
	return conflicts;
}

export async function removeOwnedWorkspace(root, manifest) {
	const resolvedRoot = path.resolve(root);
	const safe = resolveCurrentWorkspaceDestination(manifest.workspaceRoot, manifest.relativePath);
	if (safe.destination !== resolvedRoot || path.resolve(manifest.root) !== resolvedRoot) {
		throw new Error("Refusing to remove a folder outside the recorded generated workspace.");
	}
	const conflicts = await verifyOwnedWorkspace(resolvedRoot, manifest);
	if (conflicts.length) {
		const summary = conflicts
			.slice(0, 5)
			.map((item) => `${item.path} (${item.reason})`)
			.join(", ");
		throw new Error(
			`Generated files changed after creation, so nothing was removed. Move the app to an isolated session or review: ${summary}${conflicts.length > 5 ? ` and ${conflicts.length - 5} more` : ""}.`,
		);
	}
	await rm(resolvedRoot, { recursive: true, force: false });
	try {
		await rmdir(path.dirname(resolvedRoot));
	} catch (error) {
		if (!["ENOTEMPTY", "ENOENT"].includes(error?.code)) throw error;
	}
}

export async function moveWorkspaceDirectory(source, destination) {
	const resolvedSource = path.resolve(source);
	const resolvedDestination = path.resolve(destination);
	if (resolvedSource === resolvedDestination) return;
	if (!(await pathExists(resolvedSource))) throw new Error("The generated workspace no longer exists.");
	if (await pathExists(resolvedDestination)) throw new Error(`The isolated destination already exists: ${resolvedDestination}`);
	await mkdir(path.dirname(resolvedDestination), { recursive: true });
	try {
		await rename(resolvedSource, resolvedDestination);
	} catch (error) {
		if (error?.code !== "EXDEV") throw error;
		const before = await snapshotWorkspaceTree(resolvedSource, { ignoreRuntime: false });
		await cp(resolvedSource, resolvedDestination, { recursive: true, errorOnExist: true, force: false });
		const after = await snapshotWorkspaceTree(resolvedDestination, { ignoreRuntime: false });
		if (JSON.stringify(after) !== JSON.stringify(before)) {
			await rm(resolvedDestination, { recursive: true, force: true });
			throw new Error("The isolated copy could not be verified, so the current-worktree source was left unchanged.", {
				cause: error,
			});
		}
		await rm(resolvedSource, { recursive: true, force: false });
	}
	try {
		await rmdir(path.dirname(resolvedSource));
	} catch (error) {
		if (!["ENOTEMPTY", "ENOENT"].includes(error?.code)) throw error;
	}
}

export async function deleteOwnershipManifest(filePath) {
	await rm(filePath, { force: true });
}
