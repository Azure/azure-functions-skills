#!/usr/bin/env node

/**
 * Azure Functions Skills CLI
 *
 * Usage:
 *   npx @azure/functions-skills setup              # Install skill files
 *   npx @azure/functions-skills chat               # Launch agent with Welcome prompt
 *   npx @azure/functions-skills chat --agent codex  # Specific agent
 *   npx @azure/functions-skills build               # Build plugin artifacts
 */

import { detectAgents, applySetup } from '../lib/setup/index.js';
import { join } from 'node:path';

const args = process.argv.slice(2);
const command = args[0];
const TARGETS = ['ghcp', 'claude', 'codex'];
const LAUNCHER_IDS = ['github-copilot', 'claude-code', 'codex'];

const HELP_TEXT = {
  install: `Usage: azure-functions-skills install [options]

Install Azure Functions Skills plugin support and workspace activation.

Options:
  --agent <name>     Agent: ghcp, claude, codex (repeatable)
  --all              Install all supported agents explicitly
  --dir <path>       Target directory (default: current directory)
  --local            Full workspace-local setup, equivalent to setup
  --dry-run          Print planned install without writing files
  --yes              Approve safe file updates such as managed blocks and state .gitignore entry
  --source <name>    marketplace, github, or local (default: marketplace)
  --scope <name>     workspace or user (default: workspace)
  --no-mcp           Do not add workspace MCP files
  --no-hooks         Do not add workspace hook files
  -- <args...>       Pass remaining arguments to the host plugin install command for a single agent
`,
  update: `Usage: azure-functions-skills update [options]

Update Azure Functions Skills; uses existing state by default.
Install mode (local/plugin) is auto-detected from state.

Options:
  --agent <name>     Agent: ghcp, claude, codex (repeatable)
  --all              Update all supported agents explicitly
  --dir <path>       Target directory (default: current directory)
  --local            Force local update mode (auto-detected from state if omitted)
  --force            Overwrite all files including user-customized files
  --dry-run          Print planned update without writing files
  --yes              Approve safe file updates such as managed blocks and state .gitignore entry
  --source <name>    marketplace, github, or local (default: marketplace)
  --scope <name>     workspace or user (default: workspace)
  --no-mcp           Do not add workspace MCP files
  --no-hooks         Do not add workspace hook files
`,
  chat: `Usage: azure-functions-skills chat [options] [-- <agent args...>]

Launch a CLI coding agent with Azure Functions context. When --agent is omitted,
chat uses .azure-functions-skills state to select the previously installed agent.

Options:
  --agent <name>     Agent: github-copilot, claude-code, codex
  --prompt <text>    Custom prompt (overrides startup template)
  --dir <path>       Working directory (default: current directory)
  --check-prerequisites  Check external prerequisites without installing them
  --skip-prerequisites   Skip external prerequisite checks
  -- <args...>       Pass remaining arguments through to the selected agent CLI
`,
  'plugin install': `Usage: azure-functions-skills plugin install [options]

Register Azure Functions Skills with the selected host plugin system.

Options:
  --agent <name>     Agent: ghcp, claude, codex (repeatable)
  --dir <path>       Target directory (default: current directory)
  --scope <name>     workspace or user (default: workspace)
  --source <name>    marketplace, github, or local (default: marketplace)
  --workspace        Apply workspace plugin-reference activation (default)
  --no-workspace     Skip workspace activation
  --dry-run          Print planned changes without writing files
  --yes              Approve workspace activation changes to existing instruction files
`,
  'plugin update': `Usage: azure-functions-skills plugin update [options]

Update Azure Functions Skills host plugin registration.

Options:
  --agent <name>     Agent: ghcp, claude, codex (repeatable)
  --dir <path>       Target directory (default: current directory)
  --scope <name>     workspace or user (default: workspace)
  --source <name>    marketplace, github, or local (default: marketplace)
  --workspace        Apply workspace plugin-reference activation (default)
  --no-workspace     Skip workspace activation
  --dry-run          Print planned changes without writing files
  --yes              Approve workspace activation changes to existing instruction files
`,
  'workspace apply': `Usage: azure-functions-skills workspace apply [options]

Apply Azure Functions routing and optional activation files to a workspace.

Options:
  --agent <name>     Agent: ghcp, claude, codex (repeatable)
  --dir <path>       Target directory (default: current directory)
  --mode <name>      minimal, copy, plugin-reference (default: copy)
  --merge-strategy <name> managed-block, include-file, fail-if-exists, append
  --dry-run          Print planned changes without writing files
  --yes              Approve modifying existing instruction files without prompting
  --include-agent    Add the GHCP functions-copilot workspace agent definition
  --include-mcp      Add workspace MCP configuration files
  --include-hooks    Add supported workspace hook files
`,
  'workspace update': `Usage: azure-functions-skills workspace update [options]

Update existing Azure Functions managed workspace routing blocks.

Options:
  --agent <name>     Agent: ghcp, claude, codex (repeatable)
  --dir <path>       Target directory (default: current directory)
  --mode <name>      minimal, copy, plugin-reference (default: copy)
  --merge-strategy <name> managed-block, include-file, fail-if-exists, append
  --dry-run          Print planned changes without writing files
  --yes              Approve modifying existing instruction files without prompting
  --include-agent    Add the GHCP functions-copilot workspace agent definition
  --include-mcp      Add workspace MCP configuration files
  --include-hooks    Add supported workspace hook files
`,
  'state setup-complete': `Usage: azure-functions-skills state setup-complete [options]

Mark the first-run azure-functions-setup skill as completed in local workspace state.

Options:
  --dir <path>       Target directory (default: current directory)
  --agent <name>     Agent that completed setup: github-copilot, claude-code, codex
`,
  doctor: `Usage: azure-functions-skills doctor [options]

Analyze workspace code and configuration for common Azure Functions issues.
Runs built-in checks by default; add --deep for AI-powered analysis.

Exit codes:
  0  All checks passed
  1  Problems found at or above --severity threshold
  2  Doctor command itself failed (not a code/config problem)

Options:
  --dir <path>        Target workspace (default: cwd)
  --deep              Enable AI agent analysis (Tier 2). Requires --accept-deep-risk.
  --no-deep           Skip AI analysis, run built-in checks only
  --accept-deep-risk  Acknowledge that --deep runs the agent with elevated permissions
                      (file write, shell execution). Required on trusted workspaces only.
  --agent <name>      Agent for AI analysis: github-copilot, claude-code, codex
  --install-mode <m>  How to auto-install skills: local (default, CI-safe), plugin
  --timeout <seconds> Timeout for AI analysis (default: 300)
  --format <type>     Output format: text, json, markdown, html (default: text)
  --output <path>     Report file path (default: .azure-functions-skills/doctor-report.json)
  --checks <names>    Comma-separated check names to run
  --severity <level>  Minimum severity to fail: critical, high, medium, low (default: high)

Examples:
  azure-functions-skills doctor                      # Built-in checks
  azure-functions-skills doctor --deep --accept-deep-risk               # AI analysis included
  azure-functions-skills doctor --no-deep --format json  # CI mode
  azure-functions-skills doctor --deep --accept-deep-risk --install-mode plugin  # Plugin install on dev machine
`,
};

function printHelp() {
  console.log(`
  @azure/functions-skills — AI assistant plugins for Azure Functions

  Commands:
    doctor   Analyze project code and configuration for common issues
    install  Install plugin and workspace activation in one step
    update   Update plugin and workspace activation in one step
    setup    Detect coding agents and install skill files into your project
    plugin install   Register Azure Functions Skills as a native plugin
    plugin update    Refresh plugin registration and workspace activation
    workspace apply   Apply Azure Functions routing/activation files to a workspace
    workspace update  Update existing Azure Functions managed workspace routing blocks
    chat     Launch a CLI coding agent with Azure Functions Welcome prompt
    state setup-complete  Mark first-run setup skill complete in local state
    build    Build plugin artifacts for all targets (ghcp, claude, codex)

  Options (setup):
    --agent <name>     Specify agent: ghcp, claude, codex (repeatable)
    --all              Install/update all supported agents explicitly
    --dir <path>       Target directory (default: current directory)
    --as-plugin        Register as a native platform plugin (instead of copying files)
    --check-prerequisites  Check external prerequisites without installing them
    --skip-prerequisites   Skip external prerequisite checks

  Options (install/update):
    --agent <name>     Specify agent: ghcp, claude, codex (repeatable)
    --dir <path>       Target directory (default: current directory)
    --local            Full workspace-local setup, equivalent to setup
    --dry-run          Print planned install without writing files
    --yes              Approve modifying existing instruction files without prompting
    --source <name>    marketplace, github, or local (default: marketplace)
    --scope <name>     workspace or user (default: workspace)
    --no-mcp           Do not add workspace MCP files
    --no-hooks         Do not add workspace hook files
    -- <args...>       Pass remaining arguments to the host plugin install command for a single agent

  Options (workspace apply/update):
    --agent <name>     Specify agent: ghcp, claude, codex (repeatable)
    --dir <path>       Target directory (default: current directory)
    --mode <name>      minimal, copy, plugin-reference (default: copy)
    --merge-strategy <name> managed-block, include-file, fail-if-exists, append
    --update           Replace existing Azure Functions managed blocks
    --dry-run          Print planned changes without writing files
    --yes              Approve modifying existing instruction files without prompting
    --include-agent    Add the GHCP functions-copilot workspace agent definition
    --include-mcp      Add workspace MCP configuration files
    --include-hooks    Add supported workspace hook files

  Options (plugin install/update):
    --agent <name>     Specify agent: ghcp, claude, codex (repeatable)
    --dir <path>       Target directory (default: current directory)
    --scope <name>     workspace or user (default: workspace)
    --source <name>    marketplace, github, or local (default: marketplace)
    --version <value>  Plugin version/ref to plan (default: package version)
    --workspace        Apply workspace plugin-reference activation (default)
    --no-workspace     Skip workspace activation
    --dry-run          Print planned changes without writing files
    --yes              Approve workspace activation changes to existing instruction files

  Options (chat):
    --agent <name>     Agent: github-copilot, claude-code, codex (state-selected if omitted)
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
    npx @azure/functions-skills setup
    npx @azure/functions-skills install --agent ghcp --dry-run
    npx @azure/functions-skills setup --as-plugin
    npx @azure/functions-skills plugin install --agent ghcp --dry-run
    npx @azure/functions-skills workspace apply --agent codex --mode plugin-reference --dry-run
    npx @azure/functions-skills chat
    npx @azure/functions-skills chat --as-plugin --agent claude-code
  `);
}

function printCommandHelp(topic) {
  const text = HELP_TEXT[topic];
  if (!text) {
    console.error(`Unknown help topic: ${topic}`);
    process.exit(1);
  }
  console.log(text);
}

/** Extract the value following a flag from args, e.g. getFlag('--dir') → '/path'. */
function getFlag(flag) {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

async function resolveInstallTargets({ action, agents, all, dir, readState, getInstalledTargets }) {
  if (agents.length > 0 && all) {
    console.error('Use either --agent <name> or --all, not both.');
    process.exit(1);
  }

  if (agents.length > 0) return validateTargets(agents);
  if (all) return TARGETS;

  if (action === 'update') {
    const state = readState(dir);
    const installedTargets = state ? getInstalledTargets(state) : [];
    if (installedTargets.length > 0) return installedTargets;
  }

  if (isInteractive()) return askTargetSelection(action);

  const verb = action === 'install' ? 'install' : 'update';
  console.error(`Choose an agent with --agent <name> or use --all to ${verb} every supported agent.`);
  if (action === 'update') console.error('If this workspace was installed before, make sure .azure-functions-skills/state.local.json exists.');
  process.exit(1);
}

function validateTargets(values) {
  const invalid = values.filter(value => !TARGETS.includes(value));
  if (invalid.length > 0) {
    console.error(`Unknown agent: ${invalid.join(', ')}. Available: ${TARGETS.join(', ')}`);
    process.exit(1);
  }
  return [...new Set(values)];
}

async function askTargetSelection(action) {
  const { createInterface } = await import('node:readline/promises');
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(`Select agents to ${action}:`);
    TARGETS.forEach((target, index) => console.log(`  ${index + 1}. ${target}`));
    console.log(`  ${TARGETS.length + 1}. all`);
    const answer = (await readline.question('Enter number(s), comma-separated: ')).trim();
    if (answer === String(TARGETS.length + 1) || answer.toLowerCase() === 'all') return TARGETS;
    const selected = answer
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
      .map(value => TARGETS[Number(value) - 1] || value);
    return validateTargets(selected);
  } finally {
    readline.close();
  }
}

async function askLauncherSelection(reason) {
  const { createInterface } = await import('node:readline/promises');
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (reason) console.log(reason);
    console.log('Select chat agent:');
    LAUNCHER_IDS.forEach((launcher, index) => console.log(`  ${index + 1}. ${launcher}`));
    const answer = (await readline.question('Enter number: ')).trim();
    const selected = LAUNCHER_IDS[Number(answer) - 1] || answer;
    if (!LAUNCHER_IDS.includes(selected)) {
      console.error(`Unknown chat agent: ${selected}. Available: ${LAUNCHER_IDS.join(', ')}`);
      process.exit(1);
    }
    return selected;
  } finally {
    readline.close();
  }
}

async function updateStateGitignore({ dir, yes, ensureStateIgnored, stateIgnoreEntry }) {
  let result = ensureStateIgnored(dir, { yes, interactive: false });
  if (result.status === 'needs-approval' && isInteractive()) {
    const approved = await askYesNo(`Add ${stateIgnoreEntry} to .gitignore so local state is not committed?`);
    if (approved) result = ensureStateIgnored(dir, { yes: true, interactive: false });
  }
  return result;
}

async function ensureGitRepo({ dir, yes, agents, action }) {
  // Only relevant for GHCP installs — Copilot needs a git repo to discover agent definitions
  if (!agents.includes('ghcp') || action === 'update') {
    return { status: 'skipped' };
  }
  try {
    const { execFileSync } = await import('node:child_process');
    try {
      execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir, stdio: 'pipe' });
      return { status: 'detected' };
    } catch {
      // Not a git repo — offer to init
      if (yes) {
        execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
        return { status: 'initialized' };
      }
      if (isInteractive()) {
        const approved = await askYesNo('Initialize git repository? GitHub Copilot requires a git repo to discover agent definitions.');
        if (approved) {
          execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
          return { status: 'initialized' };
        }
      }
      return { status: 'not-initialized' };
    }
  } catch {
    return { status: 'git-unavailable' };
  }
}

async function askYesNo(question) {
  const { createInterface } = await import('node:readline/promises');
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await readline.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    readline.close();
  }
}

function isInteractive() {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

function printInstallSummary({ action, agents, dir, filesWritten, state, gitignoreResult, gitRepoResult }) {
  const noun = action === 'install' ? 'installed' : 'updated';
  const label = action === 'install' ? 'Installed' : 'Updated';
  console.log(`Azure Functions Skills ${noun}.`);
  console.log(`  ${label} agents: ${agents.join(', ')}`);
  console.log(`  Workspace files written: ${filesWritten}`);
  console.log('  State: .azure-functions-skills/state.local.json');
  if (state.chat.defaultAgent) console.log(`  Default chat agent: ${state.chat.defaultAgent}`);
  else console.log('  Default chat agent: not set; chat will ask when multiple agents are installed');
  if (gitignoreResult.status === 'updated') console.log(`  Git ignore: added ${gitignoreResult.entry}`);
  else if (gitignoreResult.status === 'already-ignored') console.log(`  Git ignore: ${gitignoreResult.entry} already configured`);
  else console.log(`  Git ignore: add ${gitignoreResult.entry} to keep local state out of Git`);
  if (gitRepoResult && gitRepoResult.status === 'initialized') console.log('  Git repo: initialized');
  else if (gitRepoResult && gitRepoResult.status === 'not-initialized') console.log('  Git repo: not initialized — Copilot requires a git repo to discover agent definitions');
  else if (gitRepoResult && gitRepoResult.status === 'git-unavailable') console.log('  Git repo: not checked — git executable not found');
  console.log(`  Next: azure-functions-skills chat --dir "${dir}"`);
}

if (!command || command === '--help' || command === '-h') {
  printHelp();
  process.exit(0);
}

if (command === 'help') {
  const topic = args.slice(1).join(' ');
  if (!topic) printHelp();
  else printCommandHelp(topic);
  process.exit(0);
}

if (command === 'install' || command === 'update') {
  const separatorIndex = args.indexOf('--', 1);
  const commandArgs = separatorIndex === -1 ? args.slice(1) : args.slice(1, separatorIndex);
  if (commandArgs.includes('--help') || commandArgs.includes('-h')) {
    printCommandHelp(command);
    process.exit(0);
  }
  const passthroughArgs = separatorIndex === -1 ? [] : args.slice(separatorIndex + 1);
  const agents = [];
  let dir = process.cwd();
  let local = false;
  let all = false;
  let dryRun = false;
  let yes = false;
  let force = false;
  let includeMcp = true;
  let includeHooks = true;
  let source = 'marketplace';
  let scope = 'workspace';
  let prerequisites = 'auto';

  for (let i = 0; i < commandArgs.length; i++) {
    if (commandArgs[i] === '--agent' && commandArgs[i + 1]) agents.push(commandArgs[++i]);
    else if (commandArgs[i] === '--all') all = true;
    else if (commandArgs[i] === '--dir' && commandArgs[i + 1]) dir = commandArgs[++i];
    else if (commandArgs[i] === '--local') local = true;
    else if (commandArgs[i] === '--dry-run') dryRun = true;
    else if (commandArgs[i] === '--yes') yes = true;
    else if (commandArgs[i] === '--force') force = true;
    else if (commandArgs[i] === '--no-mcp') includeMcp = false;
    else if (commandArgs[i] === '--no-hooks') includeHooks = false;
    else if (commandArgs[i] === '--source' && commandArgs[i + 1]) source = commandArgs[++i];
    else if (commandArgs[i] === '--scope' && commandArgs[i + 1]) scope = commandArgs[++i];
    else if (commandArgs[i] === '--check-prerequisites') prerequisites = 'check-only';
    else if (commandArgs[i] === '--skip-prerequisites') prerequisites = 'skip';
  }

  const { readState, getInstalledTargets, recordInstallState, ensureStateIgnored, STATE_IGNORE_ENTRY, resolveInstallMode } = await import('../lib/setup/state.js');
  const detectedAgents = await resolveInstallTargets({
    action: command,
    agents,
    all,
    dir,
    readState,
    getInstalledTargets,
  });
  if (passthroughArgs.length > 0 && detectedAgents.length !== 1) {
    console.error('Cannot use passthrough arguments with multiple agents. Run one agent at a time.');
    process.exit(1);
  }

  // Auto-detect install mode from state when running 'update' without explicit --local
  if (command === 'update' && !local) {
    const state = readState(dir);
    if (state) {
      const mode = resolveInstallMode(state, detectedAgents);
      if (mode === 'local') local = true;
      if (mode === 'mixed') {
        console.error('Mixed install modes detected: some agents were installed locally, others as plugins.');
        console.error('Run update separately per agent with --agent <name>.');
        process.exit(1);
      }
    }
  }

  // Prevent mixed-mode installs: block if existing agents use a different mode
  if (command === 'install') {
    const state = readState(dir);
    if (state) {
      const existingTargets = getInstalledTargets(state);
      if (existingTargets.length > 0) {
        const existingMode = resolveInstallMode(state, existingTargets);
        const requestedMode = local ? 'local' : 'plugin';
        if (existingMode !== 'mixed' && existingMode !== requestedMode) {
          console.error(`Cannot mix install modes: existing agents use '${existingMode}' mode, but '${requestedMode}' was requested.`);
          console.error(`Use --local to match, or reinstall all agents with the same mode.`);
          process.exit(1);
        }
      }
    }
  }

  if (local) {
    if (command === 'update') {
      // Use file-type-aware local update strategy
      const { applyLocalUpdate, createInteractivePrompter } = await import('../lib/setup/local-update.js');
      const prompter = isInteractive() && !force && !yes && !dryRun ? createInteractivePrompter() : undefined;
      const result = await applyLocalUpdate(dir, {
        agents: detectedAgents,
        force,
        dryRun,
        yes,
        prompter,
      });
      if (dryRun) {
        console.log(`Planned local update:`);
        if (result.overwritten.length > 0) {
          console.log('  Overwrite:');
          for (const f of result.overwritten) console.log(`    - ${f}`);
        }
        if (result.managedBlockUpdated.length > 0) {
          console.log('  Managed-block update:');
          for (const f of result.managedBlockUpdated) console.log(`    - ${f}`);
        }
        if (result.savedAside.length > 0) {
          console.log('  Save aside (review & merge manually):');
          for (const entry of result.savedAside) console.log(`    - ${entry.original} → ${entry.aside}`);
        }
      } else {
        const state = recordInstallState(dir, {
          action: command,
          agents: detectedAgents,
          mode: 'local',
          source: 'local',
          scope,
          includeMcp: true,
          includeHooks: true,
          includeAgent: detectedAgents.includes('ghcp'),
        });
        const gitignoreResult = await updateStateGitignore({ dir, yes, ensureStateIgnored, stateIgnoreEntry: STATE_IGNORE_ENTRY });
        printInstallSummary({ action: command, agents: detectedAgents, dir, filesWritten: result.overwritten.length + result.managedBlockUpdated.length + result.savedAside.length, state, gitignoreResult });
        if (result.savedAside.length > 0) {
          console.log('\n⚠️  Some files were saved aside for manual review:');
          for (const entry of result.savedAside) {
            console.log(`   ${entry.original} → ${entry.aside}`);
          }
          console.log('   Review these files and merge changes as needed.');
        }
      }
    } else {
      // install --local: use original applySetup()
      if (dryRun) {
        console.log(`Planned local install:`);
        for (const agent of detectedAgents) console.log(`  - ${agent}: workspace setup files`);
      } else {
        const result = await applySetup(dir, { agents: detectedAgents, prerequisites });
        const state = recordInstallState(dir, {
          action: command,
          agents: detectedAgents,
          mode: 'local',
          source: 'local',
          scope,
          includeMcp: true,
          includeHooks: true,
          includeAgent: detectedAgents.includes('ghcp'),
        });
        const gitignoreResult = await updateStateGitignore({ dir, yes, ensureStateIgnored, stateIgnoreEntry: STATE_IGNORE_ENTRY });
        const gitRepoResult = await ensureGitRepo({ dir, yes, agents: detectedAgents, action: command });
        printInstallSummary({ action: command, agents: detectedAgents, dir, filesWritten: result.filesWritten, state, gitignoreResult, gitRepoResult });
      }
    }
  } else {
    const { runPluginOperation } = await import('../lib/setup/plugin-install.js');
    const { applyWorkspace } = await import('../lib/setup/workspace.js');
    const action = command;
    const pluginResult = await runPluginOperation({
      action,
      agents: detectedAgents,
      projectDir: dir,
      dryRun,
      source,
      scope,
      workspace: false,
      yes,
      passthroughArgs,
    });
    const workspaceResult = await applyWorkspace(dir, {
      agents: detectedAgents,
      mode: 'plugin-reference',
      update: action === 'update',
      dryRun,
      yes,
      includeMcp,
      includeHooks,
      includeAgent: true,
    });

    if (dryRun) {
      console.log(`Planned ${action}:`);
      console.log('  Plugin:');
      for (const step of pluginResult.steps) {
        console.log(`    - ${step.target}: ${step.description}`);
        for (const pluginCommand of step.commands || []) console.log(`        $ ${pluginCommand}`);
      }
      console.log('  Workspace:');
      for (const file of workspaceResult.plannedFiles) console.log(`    - ${file}`);
    } else {
      const state = recordInstallState(dir, {
        action,
        agents: detectedAgents,
        mode: 'plugin',
        source,
        scope,
        includeMcp,
        includeHooks,
        includeAgent: true,
      });
      const gitignoreResult = await updateStateGitignore({ dir, yes, ensureStateIgnored, stateIgnoreEntry: STATE_IGNORE_ENTRY });
      printInstallSummary({ action, agents: detectedAgents, dir, filesWritten: workspaceResult.filesWritten, state, gitignoreResult });
    }
  }
} else if (command === 'setup') {
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
} else if (command === 'state') {
  const action = args[1];
  if (action === 'setup-complete' && (args.includes('--help') || args.includes('-h'))) {
    printCommandHelp('state setup-complete');
    process.exit(0);
  }
  if (action !== 'setup-complete') {
    console.error(`Unknown state command: ${action || ''}`.trim());
    console.error('Usage: azure-functions-skills state setup-complete [options]');
    process.exit(1);
  }

  const { markSetupComplete } = await import('../lib/setup/state.js');
  let dir = process.cwd();
  let agent = null;
  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--dir' && args[i + 1]) dir = args[++i];
    else if (args[i] === '--agent' && args[i + 1]) agent = args[++i];
  }
  if (agent && !LAUNCHER_IDS.includes(agent)) {
    console.error(`Unknown chat agent: ${agent}. Available: ${LAUNCHER_IDS.join(', ')}`);
    process.exit(1);
  }
  markSetupComplete(dir, agent);
  console.log('Setup skill marked complete.');
  console.log('  State: .azure-functions-skills/state.local.json');
} else if (command === 'chat') {
  const { chat } = await import('../lib/chat/index.js');

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

  const { readState, resolveStateLauncher, markSetupPrompted } = await import('../lib/setup/state.js');
  const state = readState(dir);

  if (!agent) {
    const resolution = resolveStateLauncher(state);
    if (resolution.kind === 'resolved') {
      agent = resolution.agent;
      console.log(`Using chat agent from .azure-functions-skills state: ${agent}`);
    } else if (resolution.kind === 'ambiguous') {
      if (isInteractive()) agent = await askLauncherSelection(`Multiple agents are installed: ${resolution.agents.join(', ')}`);
      else {
        console.error(`Multiple agents are installed: ${resolution.agents.join(', ')}. Choose one with --agent <name>.`);
        process.exit(1);
      }
    } else if (isInteractive()) {
      agent = await askLauncherSelection('No .azure-functions-skills state was found for chat agent selection.');
    } else {
      console.error('No .azure-functions-skills state was found. Run install first or choose an agent with --agent <name>.');
      process.exit(1);
    }
  }

  console.log(`\n🚀 Launching ${agent} with Azure Functions context...\n`);

  const options = { agent, dir };
  if (prompt) options.prompt = prompt;
  if (passthroughArgs.length > 0) options.passthroughArgs = passthroughArgs;
  options.prerequisites = prerequisites;
  const setupSkillPending = state && state.setupSkill.status !== 'completed';
  if (setupSkillPending) {
    markSetupPrompted(dir, agent);
    options.setupSkillPending = true;
    options.setupCompleteCommand = `azure-functions-skills state setup-complete --dir "${dir}" --agent ${agent}`;
  }
  await chat(options);
} else if (command === 'workspace') {
  const action = args[1];
  if ((action === 'apply' || action === 'update') && (args.includes('--help') || args.includes('-h'))) {
    printCommandHelp(`workspace ${action}`);
    process.exit(0);
  }
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
  let yes = false;
  let includeMcp = false;
  let includeHooks = false;
  let includeAgent = false;

  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--agent' && args[i + 1]) agents.push(args[++i]);
    else if (args[i] === '--dir' && args[i + 1]) dir = args[++i];
    else if (args[i] === '--mode' && args[i + 1]) mode = args[++i];
    else if (args[i] === '--merge-strategy' && args[i + 1]) mergeStrategy = args[++i];
    else if (args[i] === '--dry-run') dryRun = true;
    else if (args[i] === '--update') update = true;
    else if (args[i] === '--yes') yes = true;
    else if (args[i] === '--include-mcp') includeMcp = true;
    else if (args[i] === '--include-hooks') includeHooks = true;
    else if (args[i] === '--include-agent') includeAgent = true;
  }

  let result;
  try {
    result = await applyWorkspace(dir, {
      agents: agents.length > 0 ? agents : undefined,
      mode,
      mergeStrategy,
      update,
      dryRun,
      yes,
      includeMcp,
      includeHooks,
      includeAgent,
    });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

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
  if ((action === 'install' || action === 'update') && (args.includes('--help') || args.includes('-h'))) {
    printCommandHelp(`plugin ${action}`);
    process.exit(0);
  }
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
  let yes = false;

  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--agent' && args[i + 1]) agents.push(args[++i]);
    else if (args[i] === '--dir' && args[i + 1]) dir = args[++i];
    else if (args[i] === '--scope' && args[i + 1]) scope = args[++i];
    else if (args[i] === '--source' && args[i + 1]) source = args[++i];
    else if (args[i] === '--version' && args[i + 1]) version = args[++i];
    else if (args[i] === '--workspace') workspace = true;
    else if (args[i] === '--no-workspace') workspace = false;
    else if (args[i] === '--dry-run') dryRun = true;
    else if (args[i] === '--yes') yes = true;
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
      yes,
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
} else if (command === 'doctor') {
  const { runDoctor, formatReport } = await import('../lib/doctor/index.js');
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');

  const dir = getFlag('--dir') || process.cwd();
  const deep = args.includes('--deep');
  const noDeep = args.includes('--no-deep');
  const acceptDeepRisk = args.includes('--accept-deep-risk');
  const agent = getFlag('--agent');
  const timeout = parseInt(getFlag('--timeout') || '300', 10);
  const format = getFlag('--format') || 'text';
  const output = getFlag('--output') || join(dir, '.azure-functions-skills', 'doctor-report.json');
  const checksArg = getFlag('--checks');
  const checks = checksArg ? checksArg.split(',').map(s => s.trim()) : undefined;
  const severity = getFlag('--severity') || 'high';
  const installMode = getFlag('--install-mode') || 'local';

  try {
    const { report, exitCode } = await runDoctor({
      dir,
      deep: deep && !noDeep,
      acceptDeepRisk,
      agent,
      timeout,
      format,
      output,
      checks,
      severity,
      installMode,
    });

    console.log(formatReport(report, 'text'));

    // Write report file in the requested format
    const reportDir = dirname(output);
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(output, formatReport(report, format));

    process.exit(exitCode);
  } catch (err) {
    console.error(`Doctor failed: ${err.message}`);
    process.exit(2);
  }
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
