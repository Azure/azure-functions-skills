#!/usr/bin/env node

/**
 * Azure Functions Skills CLI
 *
 * Usage:
 *   npx @agent-loom/azure-functions-skills setup              # Install skill files
 *   npx @agent-loom/azure-functions-skills chat               # Launch agent with Welcome prompt
 *   npx @agent-loom/azure-functions-skills chat --agent codex  # Specific agent
 *   npx @agent-loom/azure-functions-skills build               # Build plugin artifacts
 */

import { detectAgents, applySetup } from '../lib/setup/index.js';
import { join } from 'node:path';

const args = process.argv.slice(2);
const command = args[0];

function printHelp() {
  console.log(`
  @agent-loom/azure-functions-skills — AI assistant plugins for Azure Functions

  Commands:
    setup    Detect coding agents and install skill files into your project
    plugin install   Register Azure Functions Skills as a native plugin
    plugin update    Refresh plugin registration and workspace activation
    workspace apply   Apply Azure Functions routing/activation files to a workspace
    workspace update  Update existing Azure Functions managed workspace routing blocks
    chat     Launch a CLI coding agent with Azure Functions Welcome prompt
    build    Build plugin artifacts for all targets (ghcp, claude, codex)

  Options (setup):
    --agent <name>     Specify agent: ghcp, claude, codex (repeatable)
    --dir <path>       Target directory (default: current directory)
    --as-plugin        Register as a native platform plugin (instead of copying files)
    --check-prerequisites  Check external prerequisites without installing them
    --skip-prerequisites   Skip external prerequisite checks

  Options (workspace apply/update):
    --agent <name>     Specify agent: ghcp, claude, codex (repeatable)
    --dir <path>       Target directory (default: current directory)
    --mode <name>      minimal, copy, plugin-reference (default: copy)
    --merge-strategy <name> managed-block, include-file, fail-if-exists, append
    --update           Replace existing Azure Functions managed blocks
    --dry-run          Print planned changes without writing files

  Options (plugin install/update):
    --agent <name>     Specify agent: ghcp, claude, codex (repeatable)
    --dir <path>       Target directory (default: current directory)
    --scope <name>     workspace or user (default: workspace)
    --source <name>    marketplace, github, or local (default: marketplace)
    --version <value>  Plugin version/ref to plan (default: package version)
    --workspace        Apply workspace plugin-reference activation (default)
    --no-workspace     Skip workspace activation
    --dry-run          Print planned changes without writing files

  Options (chat):
    --agent <name>     Agent: github-copilot, claude-code, codex (auto-detected if omitted)
    --prompt <text>    Custom prompt (overrides startup template)
    --dir <path>       Working directory (default: current directory)
    --as-plugin        Ensure plugin is registered before launching agent
    --check-prerequisites  Check external prerequisites without installing them
    --skip-prerequisites   Skip external prerequisite checks
    -- <args...>       Pass remaining arguments through to the selected agent CLI
    Other unrecognized chat arguments are also passed through to the agent CLI

  Options (build):
    --target <name>    Build target: ghcp, claude, codex
    --dist-dir <path>  Output directory (default: dist)

  Examples:
    npx @agent-loom/azure-functions-skills setup
    npx @agent-loom/azure-functions-skills setup --as-plugin
    npx @agent-loom/azure-functions-skills plugin install --agent ghcp --dry-run
    npx @agent-loom/azure-functions-skills workspace apply --agent codex --mode plugin-reference --dry-run
    npx @agent-loom/azure-functions-skills chat
    npx @agent-loom/azure-functions-skills chat --as-plugin --agent claude-code
  `);
}

if (!command || command === '--help' || command === '-h') {
  printHelp();
  process.exit(0);
}

if (command === 'setup') {
  const agents = [];
  let dir = process.cwd();
  let asPlugin = false;
  let prerequisites = 'auto';

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--agent' && args[i + 1]) {
      agents.push(args[++i]);
    } else if (args[i] === '--dir' && args[i + 1]) {
      dir = args[++i];
    } else if (args[i] === '--as-plugin') {
      asPlugin = true;
    } else if (args[i] === '--check-prerequisites') {
      prerequisites = 'check-only';
    } else if (args[i] === '--skip-prerequisites') {
      prerequisites = 'skip';
    }
  }

  console.log('🔍 Detecting coding agents...');
  const detectedAgents = agents.length > 0 ? agents : await detectAgents();
  console.log(`  Found: ${detectedAgents.join(', ')}`);

  if (asPlugin) {
    // Native plugin install — register with each platform
    const { installPlugin, getPluginDir } = await import('../lib/setup/plugin-install.js');

    // Ensure plugins are built first
    const { existsSync } = await import('node:fs');
    if (!existsSync(getPluginDir('ghcp'))) {
      console.log('\n📦 Building plugins first...');
      const { execSync } = await import('node:child_process');
      execSync('node lib/build/build.js', { stdio: 'inherit', cwd: join(import.meta.dirname, '..') });
    }

    console.log(`\n🔌 Installing as native plugins to: ${dir}\n`);

    const agentToTarget = { ghcp: 'ghcp', claude: 'claude', codex: 'codex' };
    const results = [];
    for (const agent of detectedAgents) {
      const target = agentToTarget[agent];
      if (!target) {
        console.log(`  ⚠️  Unknown agent: ${agent}, skipping`);
        continue;
      }
      try {
        const result = installPlugin(target, dir);
        results.push(result);
        console.log(`  ✅ ${target}: registered via ${result.method}`);
        console.log(`     Plugin path: ${result.path}`);
        if (result.instructions) {
          console.log(`     → ${result.instructions}`);
        }
      } catch (err) {
        console.error(`  ❌ ${target}: ${err.message}`);
      }
    }

    console.log('\n⚡ Plugins registered! Updates will be picked up automatically when you update the npm package.');

    const { ensurePrerequisites } = await import('../lib/setup/prerequisites/index.js');
    const prerequisiteResults = await ensurePrerequisites({
      targets: detectedAgents,
      projectDir: dir,
      mode: prerequisites,
    });
    printPrerequisiteResults(prerequisiteResults);
  } else {
    // File copy mode (original behavior)
    console.log(`\n📁 Installing to: ${dir}\n`);
    const result = await applySetup(dir, { agents: detectedAgents, prerequisites });
    console.log(result.welcomeMessage);
  }
} else if (command === 'chat') {
  const { chat, detectCliAgents } = await import('../lib/chat/index.js');

  const separatorIndex = args.indexOf('--', 1);
  const commandArgs = separatorIndex === -1 ? args.slice(1) : args.slice(1, separatorIndex);
  if (commandArgs.includes('--help') || commandArgs.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  let agent = null;
  let prompt = null;
  let dir = process.cwd();
  let asPlugin = false;
  let prerequisites = 'auto';
  const passthroughArgs = [];

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--agent' && args[i + 1]) agent = args[++i];
    else if (args[i] === '--prompt' && args[i + 1]) prompt = args[++i];
    else if (args[i] === '--dir' && args[i + 1]) dir = args[++i];
    else if (args[i] === '--as-plugin') asPlugin = true;
    else if (args[i] === '--check-prerequisites') prerequisites = 'check-only';
    else if (args[i] === '--skip-prerequisites') prerequisites = 'skip';
    else if (args[i] === '--') {
      passthroughArgs.push(...args.slice(i + 1));
      break;
    } else {
      passthroughArgs.push(args[i]);
    }
  }

  // If --as-plugin, ensure plugin is registered first
  if (asPlugin) {
    const { installPlugin, getPluginDir } = await import('../lib/setup/plugin-install.js');
    const { existsSync } = await import('node:fs');

    if (!existsSync(getPluginDir('ghcp'))) {
      console.log('📦 Building plugins first...');
      const { execSync } = await import('node:child_process');
      execSync('node lib/build/build.js', { stdio: 'inherit', cwd: join(import.meta.dirname, '..') });
    }

    // Map CLI agent names to targets
    const agentToTarget = { 'github-copilot': 'ghcp', 'claude-code': 'claude', 'codex': 'codex' };

    if (agent && agentToTarget[agent]) {
      try {
        const result = installPlugin(agentToTarget[agent], dir);
        console.log(`🔌 Plugin registered: ${result.method}`);
        if (result.instructions) console.log(`   → ${result.instructions}`);
      } catch (err) {
        console.warn(`⚠️  Plugin install: ${err.message}`);
      }
    }
  }

  if (!agent) {
    console.log('🔍 Detecting CLI coding agents...');
    const agents = await detectCliAgents();
    if (agents.length === 0) {
      console.error('❌ No CLI coding agent found. Install one of:');
      console.error('  • GitHub Copilot CLI: gh extension install github/gh-copilot');
      console.error('  • Claude Code: https://claude.ai/download');
      console.error('  • Codex: npm install -g @openai/codex');
      process.exit(1);
    }
    agent = agents[0].id;
    console.log(`  Using: ${agent}`);
  }

  console.log(`\n🚀 Launching ${agent} with Azure Functions context...\n`);

  const options = { agent, dir };
  if (prompt) options.prompt = prompt;
  if (passthroughArgs.length > 0) options.passthroughArgs = passthroughArgs;
  options.prerequisites = prerequisites;
  await chat(options);
} else if (command === 'workspace') {
  const action = args[1];
  if (action !== 'apply' && action !== 'update') {
    console.error(`Unknown workspace command: ${action || ''}`.trim());
    console.error('Usage: azure-functions-skills workspace apply|update [options]');
    process.exit(1);
  }

  const { applyWorkspace } = await import('../lib/setup/workspace.js');
  const agents = [];
  let dir = process.cwd();
  let mode = 'copy';
  let mergeStrategy = 'managed-block';
  let dryRun = false;
  let update = action === 'update';

  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--agent' && args[i + 1]) agents.push(args[++i]);
    else if (args[i] === '--dir' && args[i + 1]) dir = args[++i];
    else if (args[i] === '--mode' && args[i + 1]) mode = args[++i];
    else if (args[i] === '--merge-strategy' && args[i + 1]) mergeStrategy = args[++i];
    else if (args[i] === '--dry-run') dryRun = true;
    else if (args[i] === '--update') update = true;
  }

  const result = await applyWorkspace(dir, {
    agents: agents.length > 0 ? agents : undefined,
    mode,
    mergeStrategy,
    update,
    dryRun,
  });

  if (dryRun) {
    console.log('Planned workspace changes:');
    for (const file of result.plannedFiles) console.log(`  - ${file}`);
  } else {
    console.log(`Workspace ${action} complete.`);
    console.log(`  Agents configured: ${result.agents.join(', ')}`);
    console.log(`  Mode: ${result.mode}`);
    console.log(`  Files written: ${result.filesWritten}`);
  }
} else if (command === 'plugin') {
  const action = args[1];
  if (action !== 'install' && action !== 'update') {
    console.error(`Unknown plugin command: ${action || ''}`.trim());
    console.error('Usage: azure-functions-skills plugin install|update [options]');
    process.exit(1);
  }

  const { detectAgents } = await import('../lib/setup/index.js');
  const { runPluginOperation } = await import('../lib/setup/plugin-install.js');
  const agents = [];
  let dir = process.cwd();
  let scope = 'workspace';
  let source = 'marketplace';
  let version = undefined;
  let workspace = true;
  let dryRun = false;

  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--agent' && args[i + 1]) agents.push(args[++i]);
    else if (args[i] === '--dir' && args[i + 1]) dir = args[++i];
    else if (args[i] === '--scope' && args[i + 1]) scope = args[++i];
    else if (args[i] === '--source' && args[i + 1]) source = args[++i];
    else if (args[i] === '--version' && args[i + 1]) version = args[++i];
    else if (args[i] === '--workspace') workspace = true;
    else if (args[i] === '--no-workspace') workspace = false;
    else if (args[i] === '--dry-run') dryRun = true;
  }

  const detectedAgents = agents.length > 0 ? agents : await detectAgents();
  let result;
  try {
    result = await runPluginOperation({
      action,
      agents: detectedAgents,
      projectDir: dir,
      dryRun,
      scope,
      source,
      version,
      workspace,
    });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  if (dryRun) {
    console.log(`Planned plugin ${action}:`);
    for (const step of result.steps) {
      console.log(`  - ${step.target}: ${step.description}`);
      for (const command of step.commands || []) console.log(`      $ ${command}`);
    }
  } else {
    console.log(`Plugin ${action} complete.`);
    console.log(`  Agents configured: ${result.agents.join(', ')}`);
    console.log(`  Files written: ${result.filesWritten}`);
  }
} else if (command === 'build') {
  // Delegate to build script
  const { execFileSync } = await import('node:child_process');
  execFileSync(
    process.execPath,
    [join(import.meta.dirname, '..', 'lib', 'build', 'build.js'), ...args.slice(1)],
    { stdio: 'inherit' },
  );
} else {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

function printPrerequisiteResults(results) {
  const actionable = results.filter(result => result.status !== 'present' && result.status !== 'skipped');
  if (actionable.length === 0) return;

  console.log('\nExternal prerequisites:');
  for (const result of actionable) {
    console.log(`  ⚠️  ${result.id} (${result.target}): ${result.message}`);
    for (const command of result.commands || []) {
      console.log(`     → ${command}`);
    }
  }
}
