import {
  listFunctionTemplates, loadTemplateManifest, type TemplateListResult, type TemplateManifest,
} from '../../templates/index.js';
import { EXIT, fail, succeed, type Gap, type ToolResult } from '../shared/output.js';
import { redact } from '../shared/redact.js';

/**
 * Where the tool reads the template manifest. The command line cannot change
 * these, so the tool only ever downloads from the Azure Functions CDN and GitHub.
 */
export const DEFAULT_MANIFEST_URLS: readonly string[] = [
  'https://cdn.functions.azure.com/public/templates-manifest/manifest.json',
  'https://raw.githubusercontent.com/Azure/azure-functions-templates/dev/Functions.Templates/Template-Manifest/manifest.json',
];

export interface TemplateDependencies {
  readonly manifestUrls: readonly string[];
}

export interface FindOptions {
  readonly language: string;
  readonly resource?: string;
  readonly iac?: string;
}

export interface FoundTemplate {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly language: string;
  readonly resource?: string;
  readonly iac?: string;
}

export interface FindData {
  readonly templates?: readonly FoundTemplate[];
  /** The first template, which is the closest match by manifest priority. */
  readonly recommended?: string;
  readonly manifestSource?: 'primary' | 'fallback';
}

export interface LoadedManifest {
  readonly result: TemplateListResult;
  /** The whole manifest, so a later step can reuse it without downloading it again. */
  readonly manifest: TemplateManifest;
  readonly source: 'primary' | 'fallback';
  readonly gaps: readonly Gap[];
}

const COMMAND = 'template find';

export async function findTemplates(options: FindOptions, dependencies: TemplateDependencies): Promise<ToolResult<FindData>> {
  const loaded = await loadFirstManifest(dependencies.manifestUrls, options);
  if (!loaded) return manifestUnavailable<FindData>(COMMAND);

  const templates = loaded.result.templates.map(template => ({
    id: template.id,
    displayName: template.displayName,
    description: template.shortDescription,
    language: template.language,
    ...(template.resource ? { resource: template.resource } : {}),
    ...(template.iac ? { iac: template.iac } : {}),
  }));
  const data: FindData = { templates, manifestSource: loaded.source };
  if (templates.length === 0) {
    const result = succeed(COMMAND, 'No template matches the filters', data, {
      gaps: loaded.gaps,
      findings: [{
        id: 'TEMPLATE-NONE-MATCH', severity: 'warn', title: `No template matches language ${options.language}`,
        fix: 'Remove --resource or --iac, or check the language name. Go has no manifest templates.',
      }],
    });
    return { ...result, body: { ...result.body, ok: false } };
  }
  return succeed(COMMAND, `Found ${templates.length} template(s)`, { ...data, recommended: templates[0].id }, {
    gaps: loaded.gaps,
    next: {
      action: 'write-template',
      reason: 'Write the recommended template unless the user asked for another one in the list.',
      command: `template write --template ${templates[0].id} --language ${templates[0].language} --dir <project-dir>`,
    },
  });
}

/** Reads the manifest from the first location that answers. */
export async function loadFirstManifest(
  manifestUrls: readonly string[],
  filter: Partial<FindOptions> = {},
): Promise<LoadedManifest | null> {
  const gaps: Gap[] = [];
  for (const [index, manifestUrl] of manifestUrls.entries()) {
    try {
      const manifest = await loadTemplateManifest(manifestUrl);
      const result = await listFunctionTemplates({ manifestUrl, manifest, ...filter });
      return { result, manifest, source: index === 0 ? 'primary' : 'fallback', gaps };
    } catch (error) {
      gaps.push({
        check: index === 0 ? 'manifest-primary' : `manifest-fallback-${index}`,
        reason: redact(error instanceof Error ? error.message : String(error)),
      });
    }
  }
  return null;
}

export function manifestUnavailable<T>(command: string): ToolResult<T> {
  return fail<T>(command, EXIT.blocked, 'The template manifest could not be read', {
    findings: [{
      id: 'TEMPLATE-MANIFEST-UNAVAILABLE', severity: 'error',
      title: 'No template manifest location answered',
      fix: 'Check the network connection and try once more, or use the Azure MCP template tools.',
    }],
  });
}
