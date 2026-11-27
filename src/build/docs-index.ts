import { posix } from 'node:path';
import type { LearnArticle, LearnSection } from '../tools/app/learn.js';

export const LEARN_BASE_URL = 'https://learn.microsoft.com/azure/azure-functions/';
const ARTICLES_PREFIX = 'articles/azure-functions/';
const MAX_INCLUDE_DEPTH = 3;
const INCLUDE = /\[!INCLUDE\s*\[[^\]]*\]\(([^)\s]+)\)\]/gi;
const FENCE = /^\s*(```|~~~)/;
const HEADING = /^(#{1,3})\s+(.+?)\s*#*\s*$/;
const ZONE_START = /^:::\s*zone\b(.*)$/;
const ZONE_END = /^:::\s*zone-end\b/;

export function parseFrontmatter(markdown: string): { meta: Record<string, string>; body: string } {
  const text = markdown.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');
  const match = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  if (!match) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const pair = /^([A-Za-z_][\w.-]*):\s*(.*?)\s*$/.exec(line);
    if (pair && pair[2]) meta[pair[1]] = pair[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  return { meta, body: text.slice(match[0].length) };
}

/** Inlines `[!INCLUDE [name](path)]` relative to `baseDir`; drops includes that cannot be resolved (for example `~/reusable-content`). */
export function expandIncludes(text: string, baseDir: string, read: (path: string) => string | undefined, depth = 0): string {
  return text.replace(INCLUDE, (_match, target: string) => {
    if (depth >= MAX_INCLUDE_DEPTH || target.startsWith('~') || /^[a-z]+:/i.test(target)) return '';
    const path = posix.normalize(posix.join(baseDir, target));
    const content = read(path);
    if (content === undefined) return '';
    return expandIncludes(parseFrontmatter(content).body.trim(), posix.dirname(path), read, depth + 1);
  });
}

export function cleanMarkdown(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/:::image-end:::/g, '')
    .replace(/:::image\b[^\n]*?:::/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n');
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Splits an article on H1–H3 headings outside code fences and tags sections with the zone pivots their text belongs to. */
export function splitSections(articleId: string, body: string): LearnSection[] {
  const sections: LearnSection[] = [];
  const used = new Set<string>();
  let current: { title: string; lines: string[]; pivots: string[] } | undefined;
  let pivots: string[] = [];
  let inFence = false;

  const flush = (): void => {
    if (!current) return;
    const text = current.lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) return;
    const base = slugify(current.title) || 'section';
    let id = base;
    for (let suffix = 2; used.has(id); suffix++) id = `${base}-${suffix}`;
    used.add(id);
    sections.push(current.pivots.length ? { id, title: current.title, text, pivots: current.pivots } : { id, title: current.title, text });
  };

  for (const line of body.replace(/\r\n/g, '\n').split('\n')) {
    if (FENCE.test(line)) inFence = !inFence;
    if (!inFence) {
      if (ZONE_END.test(line.trim())) {
        pivots = [];
        continue;
      }
      const zone = ZONE_START.exec(line.trim());
      if (zone) {
        const pivot = /pivot\s*=\s*"([^"]+)"/.exec(zone[1]);
        pivots = pivot ? pivot[1].split(',').map(value => value.trim()).filter(Boolean) : [];
        continue;
      }
      const heading = HEADING.exec(line);
      if (heading && !heading[2].includes('](#tab/')) {
        flush();
        current = { title: heading[2].replace(/`/g, ''), lines: [], pivots: [] };
        continue;
      }
    }
    current ??= { title: articleId, lines: [], pivots: [] };
    current.lines.push(line);
    if (line.trim()) for (const pivot of pivots) if (!current.pivots.includes(pivot)) current.pivots.push(pivot);
  }
  flush();
  return sections;
}

/** Functions articles keep short IDs; related services keep their folder, for example `app-service/overview-managed-identity`. */
export function articleIdFor(path: string): string {
  const relative = path.replace(/\.md$/, '');
  return relative.startsWith(ARTICLES_PREFIX) ? relative.slice(ARTICLES_PREFIX.length) : relative.replace(/^articles\//, '');
}

export function learnUrl(path: string): string {
  const relative = path.replace(/\.md$/, '');
  return relative.startsWith(ARTICLES_PREFIX) ? `${LEARN_BASE_URL}${relative.slice(ARTICLES_PREFIX.length)}` : `https://learn.microsoft.com/azure/${relative.replace(/^articles\//, '')}`;
}

/** Builds one Learn article from its repository path (`articles/azure-functions/...md`) and raw Markdown. */
export function buildArticle(path: string, raw: string, read: (path: string) => string | undefined): LearnArticle | undefined {
  const { meta, body } = parseFrontmatter(raw);
  if (meta.redirect_url) return undefined;
  const id = articleIdFor(path);
  const expanded = cleanMarkdown(expandIncludes(body, posix.dirname(path), read));
  const sections = splitSections(id, expanded);
  if (sections.length === 0) return undefined;
  const article: LearnArticle = { id, title: meta.title ?? sections[0].title, url: learnUrl(path), sections };
  if (meta.description) article.description = meta.description;
  if (meta['ms.date']) article.date = meta['ms.date'];
  return article;
}
