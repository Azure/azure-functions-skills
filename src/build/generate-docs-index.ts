#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { LearnArticle, LearnIndex } from '../tools/app/learn.js';
import { buildArticle } from './docs-index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUTPUT = join(ROOT, 'templates', 'skills', 'azure-functions-app', 'assets', 'learn-index.json.gz');
const REPOSITORY = 'MicrosoftDocs/azure-docs';
/** Folders indexed recursively: Functions itself plus Durable Functions and its Durable Task Scheduler backend. */
const ARTICLE_DIRS = ['articles/azure-functions', 'articles/durable-task/durable-functions', 'articles/durable-task/common', 'articles/durable-task/scheduler'];
/** App Service articles that Functions docs defer to for Easy Auth, Key Vault references, and managed identity. */
const APP_SERVICE_ARTICLES = [
  'app-service-key-vault-references',
  'configure-authentication-api-version',
  'configure-authentication-customize-sign-in-out',
  'configure-authentication-file-based',
  'configure-authentication-mcp',
  'configure-authentication-oauth-tokens',
  'configure-authentication-provider-aad',
  'configure-authentication-provider-openid-connect',
  'configure-authentication-user-identities',
  'overview-authentication-authorization',
  'overview-managed-identity',
].map(name => `articles/app-service/${name}.md`);
const EXCLUDED_DIRS = new Set(['functions-skills-reference', 'media', 'includes']);

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}

function sparseClone(): string {
  const dir = mkdtempSync(join(tmpdir(), 'azure-docs-'));
  git(dir, ['clone', '--filter=blob:none', '--no-checkout', '--depth', '1', '--sparse', `https://github.com/${REPOSITORY}.git`, '.']);
  git(dir, ['sparse-checkout', 'set', '--no-cone', ...ARTICLE_DIRS.map(path => `/${path}/`), '/articles/durable-task/includes/', '/articles/app-service/includes/', ...APP_SERVICE_ARTICLES.map(path => `/${path}`), '/includes/']);
  git(dir, ['checkout']);
  return dir;
}

function listMarkdown(root: string, relative: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(join(root, relative)).sort()) {
    const path = posix.join(relative, name);
    if (statSync(join(root, path)).isDirectory()) {
      if (!EXCLUDED_DIRS.has(name)) files.push(...listMarkdown(root, path));
    } else if (name.endsWith('.md')) {
      files.push(path);
    }
  }
  return files;
}

function readArg(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

function main(): void {
  const given = readArg('--source');
  const source = given ?? sparseClone();
  try {
    const read = (path: string): string | undefined => {
      const full = join(source, path);
      return existsSync(full) ? readFileSync(full, 'utf8') : undefined;
    };
    const articles: LearnArticle[] = [];
    const paths = [...ARTICLE_DIRS.flatMap(dir => listMarkdown(source, dir)), ...APP_SERVICE_ARTICLES.filter(path => existsSync(join(source, path)))];
    for (const path of paths) {
      const article = buildArticle(path, readFileSync(join(source, path), 'utf8'), read);
      if (article) articles.push(article);
    }
    articles.sort((a, b) => a.id.localeCompare(b.id));
    const index: LearnIndex = {
      schemaVersion: 1,
      source: {
        repository: REPOSITORY,
        commit: git(source, ['rev-parse', 'HEAD']),
        generatedAt: git(source, ['log', '-1', '--format=%cI']),
        license: 'CC-BY-4.0',
        attribution: 'Microsoft Learn (MicrosoftDocs/azure-docs)',
      },
      articles,
    };
    if (existsSync(OUTPUT)) {
      const current = JSON.parse(gunzipSync(readFileSync(OUTPUT)).toString('utf8')) as LearnIndex;
      if (JSON.stringify(current.articles) === JSON.stringify(articles)) {
        console.log(`No Learn content changes since ${current.source.commit}; kept ${OUTPUT}`);
        return;
      }
    }
    const zipped = gzipSync(JSON.stringify(index), { level: 9 });
    writeFileSync(OUTPUT, zipped);
    const sections = articles.reduce((sum, article) => sum + article.sections.length, 0);
    console.log(`Wrote ${articles.length} articles (${sections} sections, ${(zipped.length / 1024).toFixed(0)} KiB) from ${index.source.commit} to ${OUTPUT}`);
  } finally {
    if (!given) rmSync(source, { recursive: true, force: true });
  }
}

main();
