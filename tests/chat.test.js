import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildStartupPrompt, LAUNCHERS, detectCliAgents } from '../src/chat/index.js';

const DIST_DIR = join(import.meta.dirname, '..', 'dist-test-chat');

// ─── Startup prompt tests ───

describe('buildStartupPrompt', () => {
  it('returns a string containing welcome text', async () => {
    const prompt = await buildStartupPrompt(DIST_DIR);
    expect(prompt).toContain('Azure Functions');
    expect(prompt).toContain('Skills');
  });

  it('includes project context when host.json exists', async () => {
    const dir = join(DIST_DIR, 'with-project');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'host.json'), '{"version":"2.0"}');
    writeFileSync(join(dir, 'package.json'), '{"dependencies":{"@azure/functions":"4.0.0"}}');

    const prompt = await buildStartupPrompt(dir);
    expect(prompt).toContain('Functions project detected');

    // Cleanup
    rmSync(dir, { recursive: true, force: true });
  });

  it('includes suggested actions for new project', async () => {
    const dir = join(DIST_DIR, 'empty-dir');
    mkdirSync(dir, { recursive: true });

    const prompt = await buildStartupPrompt(dir);
    expect(prompt).toContain('af-create');

    rmSync(dir, { recursive: true, force: true });
  });

  it('suggests deploy for existing project', async () => {
    const dir = join(DIST_DIR, 'existing-project');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'host.json'), '{"version":"2.0"}');

    const prompt = await buildStartupPrompt(dir);
    expect(prompt).toContain('af-deploy');

    rmSync(dir, { recursive: true, force: true });
  });
});

// ─── Launcher config tests ───

describe('LAUNCHERS', () => {
  it('has entries for ghcp, claude, codex', () => {
    expect(LAUNCHERS['github-copilot']).toBeTruthy();
    expect(LAUNCHERS['claude-code']).toBeTruthy();
    expect(LAUNCHERS['codex']).toBeTruthy();
  });

  it('ghcp launcher uses copilot -i flag', () => {
    const args = LAUNCHERS['github-copilot'].buildArgs({ startupPrompt: 'hello' });
    expect(args).toContain('-i');
    expect(args).toContain('hello');
  });

  it('claude launcher passes prompt as first arg', () => {
    const args = LAUNCHERS['claude-code'].buildArgs({ startupPrompt: 'hello' });
    expect(args).toContain('hello');
  });

  it('codex launcher passes prompt as first arg', () => {
    const args = LAUNCHERS['codex'].buildArgs({ startupPrompt: 'hello' });
    expect(args).toContain('hello');
  });

  it('launchers return empty args when no prompt', () => {
    for (const [, launcher] of Object.entries(LAUNCHERS)) {
      const args = launcher.buildArgs({});
      expect(args).toBeInstanceOf(Array);
    }
  });
});

// ─── Agent detection tests ───

describe('detectCliAgents', () => {
  it('returns an array', async () => {
    const agents = await detectCliAgents();
    expect(agents).toBeInstanceOf(Array);
  });

  it('each entry has id and command', async () => {
    const agents = await detectCliAgents();
    for (const a of agents) {
      expect(a.id).toBeTruthy();
      expect(a.command).toBeTruthy();
    }
  });
});
