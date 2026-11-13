import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  applyFunctionTemplate, resolveInsideTarget, TemplateError, type TemplateApplyMode,
} from '../../templates/index.js';
import { UsageError } from '../shared/args.js';
import { EXIT, fail, succeed, type Finding, type NextStep, type ToolResult } from '../shared/output.js';
import { redact } from '../shared/redact.js';
import { loadFirstManifest, manifestUnavailable, type TemplateDependencies } from './find.js';

export interface WriteOptions {
  readonly dir: string;
  /** A template id from the manifest. Give this or `from`. */
  readonly template?: string;
  /** A file that holds the JSON result of the Azure MCP template tools. Give this or `template`. */
  readonly from?: string;
  readonly language?: string;
  readonly runtimeVersion?: string;
  readonly mode?: TemplateApplyMode;
  readonly dryRun: boolean;
}

export interface WriteData {
  readonly source?: 'manifest' | 'mcp-file';
  readonly template?: string;
  readonly mode?: 'new' | 'add';
  readonly dryRun?: boolean;
  readonly written?: readonly string[];
  /** Files that were left alone because they exist or belong to the existing project. */
  readonly skipped?: readonly string[];
  readonly mergeInstructions?: string;
}

interface McpFile {
  readonly fileName: string;
  readonly content: string;
}

const COMMAND = 'template write';
const MCP_FILE_LISTS = ['projectfiles', 'functionfiles', 'files'];
const MAX_SEARCH_DEPTH = 4;
const FINDINGS: Readonly<Record<string, { id: string; fix: string }>> = {
  'not-found': { id: 'TEMPLATE-NOT-FOUND', fix: 'Run template find and use an id from its output.' },
  'unsafe-path': { id: 'TEMPLATE-UNSAFE-PATH', fix: 'Do not write this template. Report it to the user.' },
  'needs-new-mode': { id: 'TEMPLATE-NEEDS-NEW-FOLDER', fix: 'Write this template into an empty folder.' },
  'fetch-failed': { id: 'TEMPLATE-FETCH-FAILED', fix: 'Check the network connection and try once more.' },
  'invalid-manifest': { id: 'TEMPLATE-FETCH-FAILED', fix: 'Try once more, or use the Azure MCP template tools.' },
  'unsupported-source': { id: 'TEMPLATE-UNSUPPORTED-SOURCE', fix: 'Choose a template hosted on GitHub.' },
};

/** Writes template files into a folder. Existing files are never overwritten. */
export async function writeTemplate(options: WriteOptions, dependencies: TemplateDependencies): Promise<ToolResult<WriteData>> {
  if ((options.template === undefined) === (options.from === undefined)) {
    throw new UsageError('Give exactly one of --template or --from');
  }
  const dir = resolve(options.dir);
  try {
    return options.from !== undefined
      ? writeFromMcpFile(dir, resolve(options.from), options.dryRun)
      : await writeFromManifest(dir, options.template as string, options, dependencies);
  } catch (error) {
    if (!(error instanceof TemplateError)) throw error;
    const known = FINDINGS[error.code];
    return blocked(redact(error.message), { id: known.id, severity: 'error', title: redact(error.message), fix: known.fix });
  }
}

async function writeFromManifest(
  dir: string,
  template: string,
  options: WriteOptions,
  dependencies: TemplateDependencies,
): Promise<ToolResult<WriteData>> {
  const loaded = await loadFirstManifest(dependencies.manifestUrls);
  if (!loaded) return manifestUnavailable<WriteData>(COMMAND);
  const applied = await applyFunctionTemplate(dir, {
    manifestUrl: loaded.result.manifestUrl,
    template,
    language: options.language,
    runtimeVersion: options.runtimeVersion,
    mode: options.mode ?? 'auto',
    dryRun: options.dryRun,
  });
  return done({
    source: 'manifest',
    template: applied.template.id,
    mode: applied.mode,
    dryRun: applied.dryRun,
    written: applied.filesWritten,
    skipped: applied.skippedFiles,
  }, loaded.gaps);
}

function writeFromMcpFile(dir: string, from: string, dryRun: boolean): ToolResult<WriteData> {
  const result = findMcpResult(readJson(from));
  const files = result ? collectFiles(result) : [];
  if (!result || files.length === 0) {
    return blocked('The file holds no template files', {
      id: 'TEMPLATE-INPUT-INVALID', severity: 'error',
      title: '--from must be the JSON result of functions_template_get or functions_project_get',
      detail: 'Expected a files, functionFiles, or projectFiles list of { fileName, content } entries.',
      fix: 'Save the complete tool result to a file and pass that file.',
    });
  }

  // Check every destination before the first write, so a rejected result writes nothing.
  const planned = files.map(file => {
    if (/^[\\/]/.test(file.fileName)) {
      throw new TemplateError('unsafe-path', `Unsafe template file path: ${file.fileName}`);
    }
    return { file, destination: resolveInsideTarget(dir, file.fileName) };
  });
  const written: string[] = [];
  const skipped: string[] = [];
  for (const { file, destination } of planned) {
    const name = file.fileName.replace(/\\/g, '/');
    if (existsSync(destination)) {
      skipped.push(name);
      continue;
    }
    if (!dryRun) {
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, file.content);
    }
    written.push(name);
  }
  const mergeInstructions = pick(result, 'mergeinstructions');
  return done({
    source: 'mcp-file',
    template: asText(pick(result, 'templatename')),
    dryRun,
    written: written.sort(),
    skipped: skipped.sort(),
    ...(typeof mergeInstructions === 'string' && mergeInstructions ? { mergeInstructions } : {}),
  }, []);
}

function done(data: WriteData, gaps: ReadonlyArray<{ check: string; reason: string }>): ToolResult<WriteData> {
  const written = data.written?.length ?? 0;
  const skipped = data.skipped?.length ?? 0;
  const next: NextStep = skipped > 0
    ? { action: 'merge-skipped', reason: 'Merge the needed settings and dependencies from the skipped files by hand.' }
    : { action: 'install-and-verify', reason: 'Install dependencies, then build and run the project locally.' };
  const verb = data.dryRun ? 'Would write' : 'Wrote';
  return succeed(COMMAND, `${verb} ${written} file(s), skipped ${skipped}`, data, { gaps, next });
}

function blocked(summary: string, finding: Finding): ToolResult<WriteData> {
  return fail<WriteData>(COMMAND, EXIT.blocked, summary, { findings: [finding] });
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as unknown;
  } catch {
    return null;
  }
}

/** Finds the object that carries the file lists. MCP hosts wrap the tool result in different envelopes. */
function findMcpResult(value: unknown, depth = 0): Record<string, unknown> | null {
  if (!isRecord(value) || depth > MAX_SEARCH_DEPTH) return null;
  if (MCP_FILE_LISTS.some(name => Array.isArray(pick(value, name)))) return value;
  for (const child of Object.values(value)) {
    const found = findMcpResult(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function collectFiles(result: Record<string, unknown>): McpFile[] {
  const files = new Map<string, McpFile>();
  for (const listName of MCP_FILE_LISTS) {
    const list = pick(result, listName);
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (!isRecord(entry)) continue;
      const fileName = pick(entry, 'filename');
      const content = pick(entry, 'content');
      if (typeof fileName === 'string' && typeof content === 'string' && !files.has(fileName)) {
        files.set(fileName, { fileName, content });
      }
    }
  }
  return [...files.values()];
}

/** Reads a property without regard to case, because serializers differ. */
function pick(record: Record<string, unknown>, lowerCaseName: string): unknown {
  const key = Object.keys(record).find(candidate => candidate.toLowerCase() === lowerCaseName);
  return key === undefined ? undefined : record[key];
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
