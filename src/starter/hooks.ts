export type StarterAgent = 'copilot' | 'claude' | 'codex';
export const STARTER_AGENTS: readonly StarterAgent[] = ['copilot', 'claude', 'codex'];

/** The literal that identifies a starter hook inside a user-owned settings file. */
export const STARTER_HOOK_MARKER = '.azure-functions-skills/runtime/telemetry.mjs';
export const HOOK_TIMEOUT_SECONDS = 8;

export const CLIENT_NAMES: Readonly<Record<StarterAgent, string>> = {
  copilot: 'copilot-cli',
  claude: 'claude-code',
  codex: 'codex',
};

/**
 * Destination of each agent's hook file. Claude and Codex settings files are
 * user-owned; the installer creates them only when they are absent.
 */
export const HOOK_DESTINATIONS: Readonly<Record<StarterAgent, string>> = {
  copilot: '.github/hooks/azure-functions-skills.json',
  claude: '.claude/settings.json',
  codex: '.codex/hooks.json',
};

/**
 * JavaScript run with `node -e`. It looks for the starter runtime from the
 * current directory upward and stops at the project root: the host-provided
 * project directory, the nearest directory that contains `.git`, or the
 * file-system root. It never checks the home directory or anything above it.
 * The code contains no double quote, dollar sign, or backtick, so it is safe
 * inside double quotes in both POSIX shells and PowerShell.
 */
export function hookScript(agent: StarterAgent): string {
  const code = [
    "let f=require('node:fs'),p=require('node:path'),o=require('node:os');",
    "let k=x=>process.platform==='win32'?x.toLowerCase():x;",
    'try{',
    'let h=k(p.resolve(o.homedir())),r=process.env.CLAUDE_PROJECT_DIR,d=p.resolve(process.cwd());',
    'for(;;){',
    'if(k(d)===h)break;',
    `let s=p.join(d,'${STARTER_HOOK_MARKER}');`,
    'if(f.existsSync(s)){',
    `import(require('node:url').pathToFileURL(s).href).then(m=>m.runHook('${CLIENT_NAMES[agent]}'))`,
    '.then(()=>process.exit(0),()=>process.exit(0));break}',
    "if((r&&k(p.resolve(r))===k(d))||f.existsSync(p.join(d,'.git'))||p.dirname(d)===d)break;",
    'd=p.dirname(d)}',
    '}catch{}',
  ].join('');
  if (/["$`]/.test(code)) throw new Error('Hook script must not contain shell-sensitive characters.');
  return code;
}

export function bashHookCommand(agent: StarterAgent): string {
  return `node -e "${hookScript(agent)}" >/dev/null 2>&1 || true`;
}

export function powerShellHookCommand(agent: StarterAgent): string {
  return `try { node -e "${hookScript(agent)}" 2>$null | Out-Null } catch { }; exit 0`;
}

export function hookSnippet(agent: StarterAgent): unknown {
  if (agent === 'copilot') {
    return {
      version: 1,
      hooks: {
        postToolUse: [{
          type: 'command',
          bash: bashHookCommand(agent),
          powershell: powerShellHookCommand(agent),
          timeoutSec: HOOK_TIMEOUT_SECONDS,
          cwd: '.',
        }],
      },
    };
  }
  const hook: Record<string, unknown> = {
    type: 'command',
    command: bashHookCommand(agent),
  };
  if (agent === 'codex') hook.commandWindows = powerShellHookCommand(agent);
  hook.timeout = HOOK_TIMEOUT_SECONDS;
  hook.async = true;
  return { hooks: { PostToolUse: [{ hooks: [hook] }] } };
}
