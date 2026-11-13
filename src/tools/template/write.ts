import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  applyFunctionTemplate, resolveInsideTarget, TemplateError, type FunctionTemplate, type TemplateApplyMode,
} from '../../templates/index.js';
import { UsageError } from '../shared/args.js';
import { EXIT, fail, succeed, type Finding, type NextStep, type ToolResult } from '../shared/output.js';
import { redact } from '../shared/redact.js';
import { ensureToolDir, toolDir } from '../shared/work-dir.js';
import { loadFirstManifest, manifestUnavailable, type LoadedManifest, type TemplateDependencies } from './find.js';

export interface WriteOptions {
  readonly dir: string;
  /** A template id from the manifest. Give this, `from`, or `language` to let the tool choose. */
  readonly template?: string;
  /** A file that holds the JSON result of the Azure MCP template tools. */
  readonly from?: string;
  readonly language?: string;
  /** With `language` and no `template`: the trigger resource the template must have, such as http or timer. */
  readonly resource?: string;
  /** With `language` and no `template`: the infrastructure language the template must use. */
  readonly iac?: string;
  readonly runtimeVersion?: string;
  readonly mode?: TemplateApplyMode;
  /** Write the whole template into `.azure-functions-skills/templates/<id>` to merge from, instead of into `dir`. */
  readonly stage?: boolean;
  readonly dryRun: boolean;
}

export interface TemplateSelection {
  /** Which filters chose the template. */
  readonly by: string;
  /** Other matching template ids, closest first. */
  readonly alternatives: readonly string[];
}

export interface WriteData {
  readonly source?: 'manifest' | 'mcp-file';
  readonly template?: string;
  readonly language?: string;
  readonly runtimeVersion?: string;
  readonly selection?: TemplateSelection;
  readonly mode?: 'new' | 'add';
  readonly dryRun?: boolean;
  /** Set with `--stage`: the folder that holds the template files. */
  readonly stagedDir?: string;
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
const MAX_ALTERNATIVES = 3;
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
  const sources = [options.template, options.from].filter(value => value !== undefined).length;
  if (sources > 1) throw new UsageError('Give only one of --template or --from');
  if (sources === 0 && options.language === undefined) {
    throw new UsageError('Give --template, --from, or --language to choose the closest template');
  }
  if (options.template !== undefined && (options.resource !== undefined || options.iac !== undefined)) {
    throw new UsageError('--resource and --iac choose a template, so do not combine them with --template');
  }
  if (options.from !== undefined && options.stage) throw new UsageError('--stage works only with manifest templates');
  if (options.stage && options.mode !== undefined) throw new UsageError('--stage always writes a whole template; omit --mode');
  const dir = resolve(options.dir);
  try {
    return options.from !== undefined
      ? writeFromMcpFile(dir, resolve(options.from), options.dryRun)
      : await writeFromManifest(dir, options, dependencies);
  } catch (error) {
    if (!(error instanceof TemplateError)) throw error;
    const known = FINDINGS[error.code];
    return blocked(redact(error.message), { id: known.id, severity: 'error', title: redact(error.message), fix: known.fix });
  }
}

async function writeFromManifest(
  dir: string,
  options: WriteOptions,
  dependencies: TemplateDependencies,
): Promise<ToolResult<WriteData>> {
  const loaded = await loadFirstManifest(dependencies.manifestUrls);
  if (!loaded) return manifestUnavailable<WriteData>(COMMAND);

  let template = options.template;
  let language = options.language;
  let selection: TemplateSelection | undefined;
  if (template === undefined) {
    const chosen = selectTemplate(loaded, options);
    if ('blocked' in chosen) return chosen.blocked;
    template = chosen.template.id;
    language = chosen.template.language;
    selection = chosen.selection;
  }

  const stagedDir = options.stage ? join(toolDir(dir), 'templates', template) : undefined;
  if (stagedDir && !options.dryRun) ensureToolDir(dir, 'templates');
  const applied = await applyFunctionTemplate(stagedDir ?? dir, {
    manifestUrl: loaded.result.manifestUrl,
    manifest: loaded.manifest,
    template,
    language,
    runtimeVersion: options.runtimeVersion,
    mode: stagedDir ? 'new' : options.mode ?? 'auto',
    dryRun: options.dryRun,
  });
  return done(dir, {
    source: 'manifest',
    template: applied.template.id,
    language: applied.template.language,
    runtimeVersion: options.runtimeVersion ?? loaded.manifest.runtimeVersions?.[applied.template.language]?.default,
    ...(selection ? { selection } : {}),
    mode: applied.mode,
    dryRun: applied.dryRun,
    ...(stagedDir ? { stagedDir } : {}),
    written: applied.filesWritten,
    skipped: applied.skippedFiles,
  }, loaded.gaps);
}

/** Picks the closest template: the manifest's highest priority among those that match every given filter. */
function selectTemplate(
  loaded: LoadedManifest,
  options: WriteOptions,
): { template: FunctionTemplate; selection: TemplateSelection } | { blocked: ToolResult<WriteData> } {
  const language = (options.language as string).toLowerCase();
  const sameLanguage = loaded.result.templates.filter(candidate => candidate.language.toLowerCase() === language);
  const matches = sameLanguage
    .filter(candidate => !options.resource || candidate.resource?.toLowerCase() === options.resource.toLowerCase())
    .filter(candidate => !options.iac || candidate.iac?.toLowerCase() === options.iac.toLowerCase());
  if (matches.length === 0) {
    const resources = [...new Set(sameLanguage.map(candidate => candidate.resource).filter(Boolean))].join(', ');
    return {
      blocked: fail<WriteData>(COMMAND, EXIT.blocked, 'No template matches the request', {
        findings: [{
          id: 'TEMPLATE-NONE-MATCH', severity: 'error',
          title: `No ${options.language} template matches${options.resource ? ` resource ${options.resource}` : ''}`
            + `${options.iac ? ` with ${options.iac}` : ''}`,
          detail: resources ? `Resources with ${options.language} templates: ${resources}.` : `No ${options.language} templates exist.`,
          fix: 'Choose one of the listed resources, or run template find to see every template.',
        }],
      }),
    };
  }
  const by = ['language', options.resource ? 'resource' : '', options.iac ? 'iac' : ''].filter(Boolean).join('+');
  return {
    template: matches[0],
    selection: { by, alternatives: matches.slice(1, 1 + MAX_ALTERNATIVES).map(candidate => candidate.id) },
  };
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
  return done(dir, {
    source: 'mcp-file',
    template: asText(pick(result, 'templatename')),
    dryRun,
    written: written.sort(),
    skipped: skipped.sort(),
    ...(typeof mergeInstructions === 'string' && mergeInstructions ? { mergeInstructions } : {}),
  }, []);
}

function done(dir: string, data: WriteData, gaps: ReadonlyArray<{ check: string; reason: string }>): ToolResult<WriteData> {
  const written = data.written?.length ?? 0;
  const skipped = data.skipped?.length ?? 0;
  const next: NextStep = data.stagedDir
    ? {
      action: 'merge-staged',
      reason: 'Copy the function source from data.stagedDir into the project and merge its dependencies, settings, '
        + 'and infra resources. Delete the staged folder afterwards.',
    }
    : skipped > 0
      ? { action: 'merge-skipped', reason: 'Merge the needed settings and dependencies from the skipped files by hand.' }
      : {
        action: 'local-verify',
        reason: 'Install dependencies, start the host, and call an HTTP function once.',
        command: `local verify --dir "${dir}"`,
      };
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
