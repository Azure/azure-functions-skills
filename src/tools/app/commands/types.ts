import type { AzureClient, FetchLike } from '../azure.js';
import type { ParsedArgs } from '../args.js';
import type { CommandResult } from '../output.js';

export interface ToolContext {
  client: AzureClient;
  referencesDir: string;
  /** Bundled data files such as the Learn docs index. */
  assetsDir: string;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  /** Unauthenticated fetch for public endpoints (Learn search). */
  fetch: FetchLike;
  /** Reads a file path, or standard input for `-`. */
  readInput: (source: string) => Promise<string>;
}

export type CommandHandler = (args: ParsedArgs, context: ToolContext) => Promise<CommandResult>;

export interface CommandSpec {
  name: string;
  usage: string;
  description: string;
  /** Extra notes for `<command> --help`: output fields, limits, and examples. */
  details?: string[];
  handler: CommandHandler;
}
