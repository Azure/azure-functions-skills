import { join } from 'node:path';
import { intFlag, stringFlag } from '../args.js';
import { findOperations, loadApiIndex } from '../api.js';
import { findDoc, loadDocs, searchDocs, type SearchHit } from '../docs.js';
import { findLearn, isLearnId, learnSectionUrl, loadLearnIndex, normalizeFilter, searchLearn, type LearnHit, type LearnIndex } from '../learn.js';
import { EXIT, ToolError, type Finding } from '../output.js';
import type { CommandSpec, ToolContext } from './types.js';

const LAYERS = ['all', 'recipe', 'learn'] as const;
type Layer = (typeof LAYERS)[number];
const MAX_CONTENT = 30_000;
const LEARN_SEARCH_URL = 'https://learn.microsoft.com/api/search';
const FUNCTIONS_PATH = /\/azure\/(azure-functions|durable-task)\//;

function query(positionals: readonly string[], command: string): string {
  const text = positionals.join(' ').trim();
  if (!text) throw new ToolError(EXIT.usage, `Provide search words, for example: ${command} "easy auth".`);
  return text;
}

function layerFlag(value: string | undefined): Layer {
  const layer = (value ?? 'all').toLowerCase();
  if (!(LAYERS as readonly string[]).includes(layer)) throw new ToolError(EXIT.usage, `Unknown --layer "${value}". Use all, recipe, or learn.`);
  return layer as Layer;
}

function source(index: LearnIndex): Record<string, string> {
  return { repository: index.source.repository, commit: index.source.commit, license: index.source.license, attribution: index.source.attribution };
}

function cap(text: string): { content: string; truncated: boolean } {
  return text.length > MAX_CONTENT ? { content: `${text.slice(0, MAX_CONTENT)}\n...`, truncated: true } : { content: text, truncated: false };
}

interface OnlineHit {
  title: string;
  url: string;
  snippet: string;
  online: true;
}

/** Asks the public Learn search API; used only when nothing matches locally. Never throws. */
async function searchOnline(context: ToolContext, text: string, limit: number): Promise<OnlineHit[] | undefined> {
  try {
    const url = `${LEARN_SEARCH_URL}?search=${encodeURIComponent(text)}&locale=en-us&$top=25`;
    const response = await context.fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
    if (response.status !== 200) return undefined;
    const body = JSON.parse(await response.text()) as { results?: { title?: string; url?: string; description?: string }[] };
    return (body.results ?? [])
      .filter(result => result.url && FUNCTIONS_PATH.test(result.url))
      .slice(0, limit)
      .map(result => ({ title: result.title ?? result.url ?? '', url: result.url ?? '', snippet: result.description ?? '', online: true }));
  } catch {
    return undefined;
  }
}

export const docsCommands: CommandSpec[] = [
  {
    name: 'docs list',
    usage: 'docs list',
    description: 'List recipe documents and their section IDs, and the bundled Learn index version.',
    handler: async (_args, context) => {
      const docs = loadDocs(context.referencesDir);
      const index = loadLearnIndex(context.assetsDir);
      return {
        summary: `${docs.length} recipe documents, ${docs.reduce((sum, doc) => sum + doc.sections.length, 0)} sections.${index ? ` Learn index: ${index.articles.length} articles at ${index.source.commit.slice(0, 7)}.` : ''}`,
        data: {
          recipes: docs.map(doc => ({ id: doc.id, title: doc.title, sections: doc.sections.map(section => section.id) })),
          learn: index ? { ...source(index), generatedAt: index.source.generatedAt, articles: index.articles.length } : undefined,
        },
        next: ['Find content with `docs search <words>`; read one section with `docs get <id>`.'],
      };
    },
  },
  {
    name: 'docs search',
    usage: 'docs search <words> [--layer all|recipe|learn] [--lang python] [--plan flex] [--top 5]',
    description: 'Search the recipes (how this tool does it) and the bundled Microsoft Learn docs for Azure Functions (product facts).',
    handler: async (args, context) => {
      const text = query(args.positionals, 'docs search');
      const layer = layerFlag(stringFlag(args, 'layer'));
      const filter = normalizeFilter({ lang: stringFlag(args, 'lang'), plan: stringFlag(args, 'plan') });
      const top = intFlag(args, 'top', 5, 20);
      const findings: Finding[] = [];
      const recipes: SearchHit[] = layer === 'learn' ? [] : searchDocs(loadDocs(context.referencesDir), text, top);
      let learn: (LearnHit | OnlineHit)[] = [];
      if (layer !== 'recipe') {
        const index = loadLearnIndex(context.assetsDir);
        if (index) learn = searchLearn(index, text, filter, top);
        else findings.push({ severity: 'warning', code: 'LearnIndexMissing', message: 'The bundled Learn index is not installed.', fix: 'Reinstall the azure-functions-skills plugin.' });
        if (recipes.length === 0 && learn.length === 0) {
          const online = await searchOnline(context, text, top);
          if (online) learn = online;
          else findings.push({ severity: 'info', code: 'LearnSearchOffline', message: 'The online Learn search was not reachable.' });
        }
      }
      const best = recipes[0]?.id ?? (learn[0] && 'id' in learn[0] ? learn[0].id : undefined);
      return {
        summary: `${recipes.length} recipe section(s) and ${learn.length} Learn section(s) match "${text}".`,
        data: { recipes, learn },
        findings,
        next: best
          ? [`Read the best match with \`docs get ${best}\`. Prefer recipes for how to do it with this tool; use Learn sections for product facts and limits.`]
          : learn.length
            ? ['These are online Learn results; open the URL only if needed. Do not run more web searches for the same question.']
            : ['Try other words or `api find <words>`. If still nothing, ask the user instead of guessing.'],
      };
    },
  },
  {
    name: 'docs get',
    usage: 'docs get <recipe-id | learn:<article>[#section]>',
    description: 'Print one recipe document or section, or one Microsoft Learn article outline or section with its URL.',
    handler: async (args, context) => {
      const id = args.positionals[0];
      if (!id) throw new ToolError(EXIT.usage, 'Provide a document or section ID from `docs search` or `docs list`.');
      if (isLearnId(id)) {
        const index = loadLearnIndex(context.assetsDir);
        if (!index) throw new ToolError(EXIT.failed, 'The bundled Learn index is not installed. Reinstall the azure-functions-skills plugin.');
        const found = findLearn(index, id);
        if (!found) {
          const hits = searchLearn(index, id.replace(/^learn:/i, '').replace(/[/#-]/g, ' '), {}, 3);
          throw new ToolError(EXIT.usage, `No Learn article or section "${id}".`, { data: hits.map(hit => hit.id), next: ['Pick one of the suggested IDs, or run `docs search <words> --layer learn`.'] });
        }
        const { article, section } = found;
        if (section) {
          const { content, truncated } = cap(section.text);
          return {
            summary: `${section.title} — ${article.title} (Microsoft Learn)`,
            data: { id: `learn:${article.id}#${section.id}`, title: section.title, article: article.title, url: learnSectionUrl(article, section), pivots: section.pivots, content, source: source(index) },
            findings: truncated ? [{ severity: 'info', code: 'Truncated', message: `Content was cut at ${MAX_CONTENT} characters.`, fix: `Open ${learnSectionUrl(article, section)} for the rest.` }] : [],
          };
        }
        return {
          summary: `${article.title} (Microsoft Learn): ${article.sections.length} sections.`,
          data: { id: `learn:${article.id}`, title: article.title, description: article.description, date: article.date, url: article.url, sections: article.sections.map(item => ({ id: `learn:${article.id}#${item.id}`, title: item.title, pivots: item.pivots })), source: source(index) },
          next: ['Read only the section you need with `docs get learn:<article>#<section>`.'],
        };
      }
      const docs = loadDocs(context.referencesDir);
      const doc = findDoc(docs, id);
      if (!doc) {
        const hits = searchDocs(docs, id.replace(/[/-]/g, ' '), 3);
        throw new ToolError(EXIT.usage, `No document or section "${id}".`, {
          data: hits.map(hit => hit.id),
          next: ['Pick one of the suggested IDs, or run `docs list`.'],
        });
      }
      return { summary: `${doc.title} (${doc.id})`, data: { id: doc.id, title: doc.title, content: doc.content } };
    },
  },
  {
    name: 'api find',
    usage: 'api find <words> [--method GET|PUT|PATCH|POST|DELETE] [--top 8]',
    description: 'Search the pinned REST API index (Microsoft.Web and related monitoring APIs).',
    handler: async (args, context) => {
      const text = query(args.positionals, 'api find');
      const method = stringFlag(args, 'method');
      if (method && !/^(GET|PUT|PATCH|POST|DELETE)$/i.test(method)) throw new ToolError(EXIT.usage, '--method must be GET, PUT, PATCH, POST, or DELETE.');
      const hits = findOperations(loadApiIndex(join(context.referencesDir, 'api-index.json')), text, { method, limit: intFlag(args, 'top', 8, 25) });
      if (hits.length === 0) {
        return { summary: `No REST operation matches "${text}".`, data: [], next: ['Stop and ask the user; do not guess a URL.'] };
      }
      return {
        summary: `${hits.length} operations match "${text}".`,
        data: hits,
        next: [
          'Fill {placeholders} from `app inspect`, then call it with `rest <METHOD> <path>`; the api-version is filled in for you.',
          'Writes print a plan and exit 5 until the user approves; then rerun with --approve.',
        ],
      };
    },
  },
];
