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

if (!command || command === '--help' || command === '-h') {
  console.log(`
  @agent-loom/azure-functions-skills — AI assistant plugins for Azure Functions

  Commands:
    setup    Detect coding agents and install skill files into your project
    chat     Launch a CLI coding agent with Azure Functions Welcome prompt
    build    Build plugin artifacts for all targets (ghcp, claude, codex)

  Options (setup):
    --agent <name>     Specify agent: ghcp, claude, codex (repeatable)
    --dir <path>       Target directory (default: current directory)
    --as-plugin        Register as a native platform plugin (instead of copying files)

  Options (chat):
    --agent <name>     Agent: github-copilot, claude-code, codex (auto-detected if omitted)
    --prompt <text>    Custom prompt (overrides startup template)
    --dir <path>       Working directory (default: current directory)
    --as-plugin        Ensure plugin is registered before launching agent

  Examples:
    npx @agent-loom/azure-functions-skills setup
    npx @agent-loom/azure-functions-skills setup --as-plugin
    npx @agent-loom/azure-functions-skills chat
    npx @agent-loom/azure-functions-skills chat --as-plugin --agent claude-code
  `);
  process.exit(0);
}

if (command === 'setup') {
  const agents = [];
  let dir = process.cwd();
  let asPlugin = false;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--agent' && args[i + 1]) {
      agents.push(args[++i]);
    } else if (args[i] === '--dir' && args[i + 1]) {
      dir = args[++i];
    } else if (args[i] === '--as-plugin') {
      asPlugin = true;
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
  } else {
    // File copy mode (original behavior)
    console.log(`\n📁 Installing to: ${dir}\n`);
    const result = await applySetup(dir, { agents: detectedAgents });
    console.log(result.welcomeMessage);
  }
} else if (command === 'chat') {
  const { chat, detectCliAgents } = await import('../lib/chat/index.js');

  let agent = null;
  let prompt = null;
  let dir = process.cwd();
  let asPlugin = false;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--agent' && args[i + 1]) agent = args[++i];
    else if (args[i] === '--prompt' && args[i + 1]) prompt = args[++i];
    else if (args[i] === '--dir' && args[i + 1]) dir = args[++i];
    else if (args[i] === '--as-plugin') asPlugin = true;
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
  await chat(options);
} else if (command === 'build') {
  // Delegate to build script
  const { execSync } = await import('node:child_process');
  execSync('node lib/build/build.js', { stdio: 'inherit' });
} else {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}
