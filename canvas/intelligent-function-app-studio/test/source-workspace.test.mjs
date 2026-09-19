import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "./vitest-test.mjs";
import {
	assertCurrentWorkspaceDestinationSafe,
	createOwnershipManifest,
	moveWorkspaceDirectory,
	readOwnershipManifest,
	removeOwnedWorkspace,
	resolveCurrentWorkspaceDestination,
	sourceManifestPath,
	verifyOwnedWorkspace,
	writeOwnershipManifest,
} from "../source-workspace.mjs";

async function fixture(t) {
	const root = await mkdtemp(path.join(tmpdir(), "function-source-workspace-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const workspace = path.join(root, "repo");
	await mkdir(workspace);
	return { root, workspace };
}

test("current-worktree destinations stay in a dedicated relative subfolder", async (t) => {
	const { workspace } = await fixture(t);
	assert.deepEqual(resolveCurrentWorkspaceDestination(workspace, "functions/digest"), {
		root: workspace,
		relative: path.join("functions", "digest"),
		destination: path.join(workspace, "functions", "digest"),
	});
	assert.throws(() => resolveCurrentWorkspaceDestination(workspace, "../outside"), /inside the current worktree/);
	assert.throws(() => resolveCurrentWorkspaceDestination(workspace, "."), /dedicated subfolder/);
	assert.throws(() => resolveCurrentWorkspaceDestination("", "functions/digest"), /does not expose/);
});

test("current-worktree destinations reject symbolic-link escapes", async (t) => {
	const { root, workspace } = await fixture(t);
	const outside = path.join(root, "outside");
	await mkdir(outside);
	await symlink(outside, path.join(workspace, "functions"));
	await assert.rejects(
		() => assertCurrentWorkspaceDestinationSafe(workspace, "functions/digest"),
		/cannot traverse a symbolic link/,
	);
});

test("ownership manifests persist outside the repository and detect user changes", async (t) => {
	const { root, workspace } = await fixture(t);
	const destination = path.join(workspace, "functions", "digest");
	await mkdir(path.join(destination, "src"), { recursive: true });
	await writeFile(path.join(destination, "src", "agent.md"), "initial\n");
	await mkdir(path.join(destination, "src", ".venv"));
	await writeFile(path.join(destination, "src", ".venv", "runtime.txt"), "ignored\n");

	const manifest = await createOwnershipManifest({
		root: destination,
		workspaceRoot: workspace,
		relativePath: "functions/digest",
		sessionId: "session",
		instanceId: "instance",
	});
	const manifestPath = sourceManifestPath(path.join(root, "copilot"), "session", "instance");
	await writeOwnershipManifest(manifestPath, manifest);
	assert.deepEqual(await readOwnershipManifest(manifestPath), manifest);
	assert.ok(!manifestPath.startsWith(workspace));
	assert.deepEqual(await verifyOwnedWorkspace(destination, manifest), []);

	await writeFile(path.join(destination, "src", ".venv", "runtime.txt"), "runtime changed\n");
	assert.deepEqual(await verifyOwnedWorkspace(destination, manifest), []);
	await writeFile(path.join(destination, "src", "agent.md"), "user edit\n");
	assert.deepEqual(await verifyOwnedWorkspace(destination, manifest), [{ path: path.join("src", "agent.md"), reason: "modified" }]);
	await assert.rejects(() => removeOwnedWorkspace(destination, manifest), /nothing was removed/);
	assert.equal(await readFile(path.join(destination, "src", "agent.md"), "utf8"), "user edit\n");

	await writeFile(path.join(destination, "src", "agent.md"), "initial\n");
	await writeFile(path.join(destination, "src", "notes.md"), "user file\n");
	await rm(path.join(destination, "src", "agent.md"));
	assert.deepEqual(await verifyOwnedWorkspace(destination, manifest), [
		{ path: path.join("src", "agent.md"), reason: "missing" },
		{ path: path.join("src", "notes.md"), reason: "added" },
	]);
});

test("clean generated workspaces can be removed without touching siblings", async (t) => {
	const { workspace } = await fixture(t);
	const destination = path.join(workspace, "functions", "digest");
	const sibling = path.join(workspace, "functions", "keep.txt");
	await mkdir(destination, { recursive: true });
	await writeFile(path.join(destination, "agent.md"), "generated\n");
	await writeFile(sibling, "keep\n");
	const manifest = await createOwnershipManifest({
		root: destination,
		workspaceRoot: workspace,
		relativePath: "functions/digest",
		sessionId: "session",
		instanceId: "instance",
	});

	await removeOwnedWorkspace(destination, manifest);
	assert.equal(await readFile(sibling, "utf8"), "keep\n");
});

test("move preserves the complete generated tree and removes only its old folder", async (t) => {
	const { root, workspace } = await fixture(t);
	const source = path.join(workspace, "functions", "digest");
	const destination = path.join(root, "isolated", "template");
	await mkdir(path.join(source, "src"), { recursive: true });
	await writeFile(path.join(source, "src", "agent.md"), "edited\n");

	await moveWorkspaceDirectory(source, destination);
	assert.equal(await readFile(path.join(destination, "src", "agent.md"), "utf8"), "edited\n");
	await assert.rejects(() => readFile(path.join(source, "src", "agent.md")), /ENOENT/);
});

test("move refuses to overwrite an existing isolated destination", async (t) => {
	const { root, workspace } = await fixture(t);
	const source = path.join(workspace, "functions", "digest");
	const destination = path.join(root, "isolated", "template");
	await mkdir(source, { recursive: true });
	await mkdir(destination, { recursive: true });
	await writeFile(path.join(source, "agent.md"), "source\n");
	await writeFile(path.join(destination, "agent.md"), "destination\n");

	await assert.rejects(() => moveWorkspaceDirectory(source, destination), /already exists/);
	assert.equal(await readFile(path.join(source, "agent.md"), "utf8"), "source\n");
	assert.equal(await readFile(path.join(destination, "agent.md"), "utf8"), "destination\n");
});
