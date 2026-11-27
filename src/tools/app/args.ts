import { EXIT, ToolError } from './output.js';

export interface ParsedArgs {
  positionals: string[];
  /** Last value of each flag. */
  flags: Map<string, string | true>;
  /** Every string value of each flag, for repeatable flags such as `--query`. */
  lists: Map<string, string[]>;
}

/** Parses `--name value`, `--name=value`, and boolean `--name` flags. */
export function parseArgs(argv: readonly string[], booleanFlags: ReadonlySet<string> = new Set()): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  const lists = new Map<string, string[]>();
  const add = (name: string, value: string): void => {
    flags.set(name, value);
    lists.set(name, [...(lists.get(name) ?? []), value]);
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (!name) throw new ToolError(EXIT.usage, `Invalid flag "${arg}".`);
    if (eq !== -1) {
      add(name, arg.slice(eq + 1));
    } else if (booleanFlags.has(name) || i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
      flags.set(name, true);
    } else {
      add(name, argv[++i]);
    }
  }
  return { positionals, flags, lists };
}

export function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  if (value === undefined) return undefined;
  if (value === true) throw new ToolError(EXIT.usage, `Flag --${name} requires a value.`);
  return value;
}

export function listFlag(args: ParsedArgs, name: string): string[] {
  if (args.flags.get(name) === true) throw new ToolError(EXIT.usage, `Flag --${name} requires a value.`);
  return args.lists.get(name) ?? [];
}

export function requireFlag(args: ParsedArgs, name: string, hint: string): string {
  const value = stringFlag(args, name);
  if (!value) throw new ToolError(EXIT.usage, `Missing --${name}. ${hint}`);
  return value;
}

export function boolFlag(args: ParsedArgs, name: string): boolean {
  return args.flags.get(name) === true || args.flags.get(name) === 'true';
}

export function intFlag(args: ParsedArgs, name: string, fallback: number, max: number): number {
  const raw = stringFlag(args, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new ToolError(EXIT.usage, `--${name} must be an integer between 1 and ${max}.`);
  }
  return value;
}

const DURATION = /^(\d+)(m|h|d)$/;

/** Converts `30m`, `6h`, or `7d` into an ISO 8601 duration accepted by Azure Monitor. */
export function durationFlag(args: ParsedArgs, name: string, fallback: string): { iso: string; ms: number } {
  const raw = stringFlag(args, name) ?? fallback;
  const match = DURATION.exec(raw);
  if (!match) throw new ToolError(EXIT.usage, `--${name} must look like 30m, 6h, or 7d.`);
  const amount = Number(match[1]);
  const unit = match[2];
  const ms = amount * (unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000);
  if (ms < 60_000 || ms > 90 * 86_400_000) throw new ToolError(EXIT.usage, `--${name} must be between 1m and 90d.`);
  const iso = unit === 'd' ? `P${amount}D` : `PT${amount}${unit.toUpperCase()}`;
  return { iso, ms };
}
