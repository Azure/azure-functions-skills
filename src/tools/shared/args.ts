export class UsageError extends Error {}

export interface ArgSpec {
  readonly strings?: readonly string[];
  readonly lists?: readonly string[];
  readonly booleans?: readonly string[];
}

export interface ParsedArgs {
  readonly strings: Record<string, string>;
  readonly lists: Record<string, string[]>;
  readonly booleans: Record<string, boolean>;
}

/** Parses `--name value` options. Positional arguments are not accepted. */
export function parseArgs(argv: readonly string[], spec: ArgSpec): ParsedArgs {
  const parsed: ParsedArgs = { strings: {}, lists: {}, booleans: {} };
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new UsageError(`Unexpected argument: ${token}`);
    const name = token.slice(2);
    if (spec.booleans?.includes(name)) {
      parsed.booleans[name] = true;
      continue;
    }
    const isList = spec.lists?.includes(name) ?? false;
    if (!isList && !spec.strings?.includes(name)) throw new UsageError(`Unknown option: ${token}`);
    const value = argv[++index];
    if (value === undefined || value.startsWith('--')) throw new UsageError(`Option ${token} needs a value`);
    if (isList) {
      (parsed.lists[name] ??= []).push(value);
    } else {
      if (name in parsed.strings) throw new UsageError(`Option ${token} was given more than once`);
      parsed.strings[name] = value;
    }
  }
  return parsed;
}
