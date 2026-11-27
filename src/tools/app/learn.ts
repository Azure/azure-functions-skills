import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { tokenize } from './docs.js';
import { EXIT, ToolError } from './output.js';

export const LEARN_INDEX_FILE = 'learn-index.json.gz';
export const LEARN_PREFIX = 'learn:';

export interface LearnSection {
  /** Heading slug, unique within the article; also the Learn page anchor. */
  id: string;
  title: string;
  text: string;
  /** Zone pivots the section text belongs to, for example `programming-language-python` or `flex-consumption-plan`. */
  pivots?: string[];
}

export interface LearnArticle {
  /** Article path under `articles/azure-functions/`, without `.md`. */
  id: string;
  title: string;
  description?: string;
  date?: string;
  url: string;
  sections: LearnSection[];
}

export interface LearnIndex {
  schemaVersion: 1;
  source: { repository: string; commit: string; generatedAt: string; license: string; attribution: string };
  articles: LearnArticle[];
}

export interface LearnHit {
  id: string;
  title: string;
  article: string;
  url: string;
  score: number;
  snippet: string;
  pivots?: string[];
}

export interface LearnFilter {
  lang?: string;
  plan?: string;
}

const LANGUAGES: Record<string, string> = {
  csharp: 'csharp', 'c#': 'csharp', dotnet: 'csharp', '.net': 'csharp',
  javascript: 'javascript', js: 'javascript', node: 'javascript', nodejs: 'javascript',
  typescript: 'typescript', ts: 'typescript',
  python: 'python', py: 'python',
  java: 'java',
  powershell: 'powershell', pwsh: 'powershell',
  go: 'go',
};

const PLANS: Record<string, string> = {
  flex: 'flex-consumption-plan', 'flex-consumption': 'flex-consumption-plan',
  consumption: 'consumption-plan',
  premium: 'premium-plan', 'elastic-premium': 'premium-plan',
  dedicated: 'dedicated-plan', 'app-service': 'dedicated-plan',
  container: 'container-apps', 'container-apps': 'container-apps', aca: 'container-apps',
};
const PLAN_PIVOTS = new Set(Object.values(PLANS));

const STOP_WORDS = new Set(['the', 'to', 'an', 'and', 'or', 'of', 'in', 'on', 'for', 'with', 'is', 'are', 'do', 'does', 'how', 'my', 'me', 'what', 'can', 'it', 'be', 'by', 'from', 'azure', 'functions', 'function']);
const K1 = 1.2;
const B = 0.75;
const SECTION_TITLE_BOOST = 3;
const ARTICLE_TITLE_BOOST = 1;

const cache = new Map<string, LearnIndex>();

/** Loads the bundled Learn index, or returns undefined when the asset is not installed. */
export function loadLearnIndex(assetsDir: string): LearnIndex | undefined {
  const path = join(assetsDir, LEARN_INDEX_FILE);
  const cached = cache.get(path);
  if (cached) return cached;
  if (!assetsDir || !existsSync(path)) return undefined;
  const index = JSON.parse(gunzipSync(readFileSync(path)).toString('utf-8')) as LearnIndex;
  cache.set(path, index);
  return index;
}

export function normalizeFilter(filter: LearnFilter): LearnFilter {
  const result: LearnFilter = {};
  if (filter.lang) {
    const lang = LANGUAGES[filter.lang.toLowerCase()];
    if (!lang) throw new ToolError(EXIT.usage, `Unknown --lang "${filter.lang}". Use one of: csharp, javascript, typescript, python, java, powershell, go.`);
    result.lang = `programming-language-${lang}`;
  }
  if (filter.plan) {
    const plan = PLANS[filter.plan.toLowerCase()];
    if (!plan) throw new ToolError(EXIT.usage, `Unknown --plan "${filter.plan}". Use one of: flex, consumption, premium, dedicated, container-apps.`);
    result.plan = plan;
  }
  return result;
}

function matchesFilter(section: LearnSection, filter: LearnFilter): boolean {
  const pivots = section.pivots ?? [];
  if (filter.lang) {
    const languages = pivots.filter(pivot => pivot.startsWith('programming-language-'));
    if (languages.length && !languages.includes(filter.lang)) return false;
  }
  if (filter.plan) {
    const plans = pivots.filter(pivot => PLAN_PIVOTS.has(pivot));
    if (plans.length && !plans.includes(filter.plan)) return false;
  }
  return true;
}

export function learnSectionUrl(article: LearnArticle, section: LearnSection): string {
  return article.sections[0] === section ? article.url : `${article.url}#${section.id}`;
}

function counts(tokens: readonly string[], weight: number, into: Map<string, number>): void {
  for (const token of tokens) into.set(token, (into.get(token) ?? 0) + weight);
}

/** Ranks Learn sections with BM25 over the body plus length-independent title bonuses. */
export function searchLearn(index: LearnIndex, query: string, filter: LearnFilter, limit: number): LearnHit[] {
  const terms = [...new Set(tokenize(query).filter(term => !STOP_WORDS.has(term)))];
  if (terms.length === 0) return [];
  const wanted = new Set(terms);
  const docs: { article: LearnArticle; section: LearnSection; tf: Map<string, number>; titles: Map<string, number>; length: number }[] = [];
  const df = new Map<string, number>();
  let totalLength = 0;
  for (const article of index.articles) {
    for (const section of article.sections) {
      if (!matchesFilter(section, filter)) continue;
      const textTokens = tokenize(section.text);
      const tf = new Map<string, number>();
      counts(textTokens.filter(token => wanted.has(token)), 1, tf);
      const titles = new Map<string, number>();
      for (const token of tokenize(article.title)) if (wanted.has(token)) titles.set(token, ARTICLE_TITLE_BOOST);
      for (const token of tokenize(section.title)) if (wanted.has(token)) titles.set(token, SECTION_TITLE_BOOST + (titles.get(token) ?? 0));
      totalLength += textTokens.length;
      docs.push({ article, section, tf, titles, length: textTokens.length });
      for (const term of new Set([...tf.keys(), ...titles.keys()])) df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  const average = totalLength / Math.max(docs.length, 1);
  const hits: LearnHit[] = [];
  for (const doc of docs) {
    const matched = new Set([...doc.tf.keys(), ...doc.titles.keys()]);
    if (matched.size === 0) continue;
    let score = 0;
    for (const term of matched) {
      const idf = Math.log(1 + (docs.length - (df.get(term) ?? 0) + 0.5) / ((df.get(term) ?? 0) + 0.5));
      const frequency = doc.tf.get(term) ?? 0;
      score += idf * ((frequency * (K1 + 1)) / (frequency + K1 * (1 - B + (B * doc.length) / average)) + (doc.titles.get(term) ?? 0));
    }
    score *= matched.size / terms.length;
    const hit: LearnHit = {
      id: `${LEARN_PREFIX}${doc.article.id}#${doc.section.id}`,
      title: doc.section.title,
      article: doc.article.title,
      url: learnSectionUrl(doc.article, doc.section),
      score: Math.round(score * 100) / 100,
      snippet: snippet(doc.section.text, terms),
    };
    if (doc.section.pivots) hit.pivots = doc.section.pivots;
    hits.push(hit);
  }
  return hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
}

function snippet(text: string, terms: readonly string[]): string {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  const line = lines.find(candidate => terms.some(term => candidate.toLowerCase().includes(term))) ?? lines[0] ?? '';
  return line.length > 200 ? `${line.slice(0, 197)}...` : line;
}

export function isLearnId(id: string): boolean {
  return id.toLowerCase().startsWith(LEARN_PREFIX);
}

export function findLearn(index: LearnIndex, id: string): { article: LearnArticle; section?: LearnSection } | undefined {
  const [articleId, sectionId] = id.slice(LEARN_PREFIX.length).replace(/\.md$/, '').split('#');
  const article = index.articles.find(candidate => candidate.id.toLowerCase() === articleId.toLowerCase());
  if (!article) return undefined;
  if (sectionId === undefined) return { article };
  const section = article.sections.find(candidate => candidate.id === sectionId.toLowerCase());
  return section ? { article, section } : undefined;
}
