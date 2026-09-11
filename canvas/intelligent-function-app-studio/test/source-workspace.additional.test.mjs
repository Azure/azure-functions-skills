import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "./vitest-test.mjs";
import {
	assertCurrentWorkspaceDestinationSafe,
	createOwnershipManifest,
	deleteOwnershipManifest,
	moveWorkspaceDirectory,
	readOwnershipManifest,
	removeOwnedWorkspace,
	snapshotWorkspaceTree,
	sourceManifestPath,
	verifyOwnedWorkspace,
	writeOwnershipManifest,
} from "../source-workspace.mjs";

async function temporaryDirectory(t) {
	const root = await mkdtemp(path.join(tmpdir(), "function-source-extra-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	return root;
}

test("workspace snapshots capture symlinks and consistently ignore runtime state", async (t) => {
	const root = await temporaryDirectory(t);
	await mkdir(path.join(root, ".venv"));
	await writeFile(path.join(root, ".venv", "runtime.pyc"), "runtime");
	await writeFile(path.join(root, "local.settings.json"), "{}");
	await writeFile(path.join(root, "visible.txt"), "visible");
	await symlink("visible.txt", path.join(root, "visible-link.txt"), "file");

	const filtered = await snapshotWorkspaceTree(root);
	assert.deepEqual(filtered.map((entry) => entry.path), ["visible-link.txt", "visible.txt"]);
	assert.deepEqual(filtered[0], { path: "visible-link.txt", type: "symlink", target: "visible.txt" });
	const complete = await snapshotWorkspaceTree(root, { ignoreRuntime: false });
	assert.ok(complete.some((entry) => entry.path === path.join(".venv", "runtime.pyc")));
	assert.deepEqual(await snapshotWorkspaceTree(path.join(root, "missing")), []);
});

test("ownership manifest lifecycle handles missing, invalid, valid, and deleted files", async (t) => {
	const root = await temporaryDirectory(t);
	const manifestPath = sourceManifestPath(path.join(root, "copilot"), "session", "instance");
	assert.equal(await readOwnershipManifest(manifestPath), null);
	await writeFile(path.join(root, "invalid.json"), "{}\n");
	await assert.rejects(readOwnershipManifest(path.join(root, "invalid.json")), /manifest is invalid/);
	const manifest = {
		version: 1,
		root: path.join(root, "workspace", "functions", "digest"),
		workspaceRoot: path.join(root, "workspace"),
		relativePath: path.join("functions", "digest"),
		sessionId: "session",
		instanceId: "instance",
		createdAt: "2026-09-11T00:00:00.000Z",
		baseline: [],
	};
	await writeOwnershipManifest(manifestPath, manifest);
	assert.deepEqual(await readOwnershipManifest(manifestPath), manifest);
	await deleteOwnershipManifest(manifestPath);
	assert.equal(await readOwnershipManifest(manifestPath), null);
	await deleteOwnershipManifest(manifestPath);
});

test("ownership checks reject mismatched roots before reading or deleting files", async (t) => {
	const root = await temporaryDirectory(t);
	const workspace = path.join(root, "workspace");
	const destination = path.join(workspace, "functions", "digest");
	await assert.rejects(
		createOwnershipManifest({
			root: path.join(root, "other"),
			workspaceRoot: workspace,
			relativePath: path.join("functions", "digest"),
			sessionId: "session",
			instanceId: "instance",
		}),
		/does not match its declared worktree path/,
	);
	await assert.rejects(verifyOwnedWorkspace(destination, { root: path.join(root, "other"), baseline: [] }), /does not match/);
	await assert.rejects(
		removeOwnedWorkspace(destination, {
			root: path.join(root, "other"),
			workspaceRoot: workspace,
			relativePath: path.join("functions", "digest"),
			baseline: [],
		}),
		/outside the recorded generated workspace/,
	);
});

test("safe destination and move validation reject file parents and missing sources", async (t) => {
	const root = await temporaryDirectory(t);
	await writeFile(path.join(root, "functions"), "not a directory");
	await assert.rejects(
		assertCurrentWorkspaceDestinationSafe(root, path.join("functions", "digest")),
		/parent path is not a directory/,
	);
	assert.equal(await moveWorkspaceDirectory(root, root), undefined);
	await assert.rejects(
		moveWorkspaceDirectory(path.join(root, "missing"), path.join(root, "destination")),
		/no longer exists/,
	);
});