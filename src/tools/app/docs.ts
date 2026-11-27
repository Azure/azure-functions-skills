import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { EXIT, ToolError } from './output.js';

export interface DocSection {
  /** `<file>/<slug>`, for example `inspection/logs-application-insights`. */
  id: string;
  file: string;
  title: string;
  content: string;
}

export interface DocFile {
  /** Relative path without `.md`, lowercase, with `/` separators. */
  id: string;
  title: string;
  content: string;
  sections: DocSection[];
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/^\d+[a-z]?\.\s*/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Splits a Markdown file into `##` sections, ignoring headings inside fenced code blocks. */
export function parseDoc(id: string, markdown: string): DocFile {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let title = id;
  const sections: DocSection[] = [];
  let current: { title: string; lines: string[] } | undefined;
  let inFence = false;

  const flush = (): void => {
    if (!current) return;
    let slug = slugify(current.title) || 'section';
    let suffix = 2;
    while (sections.some(section => section.id === `${id}/${slug}`)) slug = `${slugify(current.title)}-${suffix++}`;
    sections.push({ id: `${id}/${slug}`, file: id, title: current.title, content: current.lines.join('\n').trim() });
  };

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (!inFence && /^# /.test(line) && title === id) {
      title = line.slice(2).trim();
      continue;
    }
    if (!inFence && /^## /.test(line)) {
      flush();
      current = { title: line.slice(3).trim(), lines: [line] };
      continue;
    }
    current?.lines.push(line);
  }
  flush();
  return { id, title, content: markdown.trim(), sections };
}

export function loadDocs(root: string): DocFile[] {
  if (!existsSync(root)) {
    throw new ToolError(EXIT.failed, `Docs folder not found at ${root}. Reinstall the azure-functions-skills plugin.`);
  }
  const files: DocFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.md')) {
        const id = relative(root, full).replaceAll('\\', '/').replace(/\.md$/, '').toLowerCase();
        files.push(parseDoc(id, readFileSync(full, 'utf-8')));
      }
    }
  };
  walk(root);
  return files;
}

export function findDoc(docs: readonly DocFile[], id: string): DocFile | DocSection | undefined {
  const wanted = id.toLowerCase().replace(/\.md$/, '').replace(/^\/+/, '');
  for (const file of docs) {
    if (file.id === wanted) return file;
    const section = file.sections.find(candidate => candidate.id === wanted);
    if (section) return section;
  }
  return undefined;
}

export interface SearchHit {
  id: string;
  title: string;
  score: number;
  snippet: string;
}

export function tokenize(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(term => term.length >= 2);
}

export function searchDocs(docs: readonly DocFile[], query: string, limit: number): SearchHit[] {
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const section of docs.flatMap(file => file.sections)) {
    const title = section.title.toLowerCase();
    const body = section.content.toLowerCase();
    let score = 0;
    let matched = 0;
    for (const term of terms) {
      const inTitle = title.includes(term);
      const occurrences = Math.min(countOccurrences(body, term), 10);
      if (inTitle || occurrences > 0) matched++;
      score += (inTitle ? 5 : 0) + occurrences;
    }
    if (score === 0) continue;
    score *= matched / terms.length;
    hits.push({ id: section.id, title: section.title, score: Math.round(score * 10) / 10, snippet: snippet(section.content, terms) });
  }
  return hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
}

function countOccurrences(text: string, term: string): number {
  let count = 0;
  for (let index = text.indexOf(term); index !== -1; index = text.indexOf(term, index + term.length)) count++;
  return count;
}

function snippet(content: string, terms: readonly string[]): string {
  const lines = content.split('\n').slice(1).filter(line => line.trim());
  const line = lines.find(candidate => terms.some(term => candidate.toLowerCase().includes(term))) ?? lines[0] ?? '';
  const trimmed = line.trim();
  return trimmed.length > 160 ? `${trimmed.slice(0, 157)}...` : trimmed;
}
