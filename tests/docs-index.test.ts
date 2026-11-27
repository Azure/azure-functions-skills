import { describe, expect, it } from 'vitest';
import { buildArticle, cleanMarkdown, expandIncludes, learnUrl, parseFrontmatter, splitSections } from '../src/build/docs-index.js';

describe('parseFrontmatter', () => {
  it('reads scalar keys and returns the body without frontmatter', () => {
    const parsed = parseFrontmatter('---\ntitle: HTTP trigger\ndescription: "Call a function"\nms.date: 09/15/2026\nms.custom:\n  - a\n---\n\n# HTTP trigger\nBody');
    expect(parsed.meta).toMatchObject({ title: 'HTTP trigger', description: 'Call a function', 'ms.date': '09/15/2026' });
    expect(parsed.body.trim()).toBe('# HTTP trigger\nBody');
  });
});

describe('expandIncludes', () => {
  it('inlines relative includes recursively without their frontmatter and drops unresolved ones', () => {
    const files: Record<string, string> = {
      'includes/a.md': '---\nauthor: x\n---\nA text [!INCLUDE [b](b.md)]',
      'includes/b.md': 'B text',
    };
    const text = expandIncludes('Start\n[!INCLUDE [a](../../includes/a.md)]\n[!INCLUDE [r](~/reusable-content/x.md)]\n[!INCLUDE [m](missing.md)]', 'articles/azure-functions', path => files[path]);
    expect(text).toBe('Start\nA text B text\n\n');
  });

  it('stops at a depth limit for include cycles', () => {
    const text = expandIncludes('[!INCLUDE [a](a.md)]', 'x', () => 'loop [!INCLUDE [a](a.md)]');
    expect(text.match(/loop/g)?.length).toBeLessThanOrEqual(5);
  });
});

describe('cleanMarkdown', () => {
  it('removes comments, images, and image directives but keeps text and links', () => {
    expect(cleanMarkdown('Keep <!-- hidden --> this\n![alt](media/x.png)\n:::image type="content" source="x.png" alt-text="y":::\nSee [docs](https://learn.microsoft.com).')).toBe('Keep  this\n\nSee [docs](https://learn.microsoft.com).');
  });
});

describe('splitSections', () => {
  it('keeps tab labels inside the parent section', () => {
    const body = ['## Example', 'Pick a model.', '### [v2](#tab/v2)', 'Use decorators.', '### [v1](#tab/v1)', 'Use function.json.', '---'].join('\n');
    const sections = splitSections('functions-reference-python', body);
    expect(sections.map(section => section.id)).toEqual(['example']);
    expect(sections[0].text).toContain('Use decorators.');
    expect(sections[0].text).toContain('[v1](#tab/v1)');
  });

  it('splits on H1-H3 outside code fences and tags zone pivots', () => {
    const body = [
      '# HTTP trigger',
      'Intro',
      '## Example',
      '::: zone pivot="programming-language-python"',
      'Python sample',
      '```bash',
      '# not a heading',
      '```',
      '::: zone-end',
      ':::zone pivot="programming-language-javascript,programming-language-typescript"',
      'Node sample',
      ':::zone-end',
      '### Example',
      'Second',
    ].join('\n');
    const sections = splitSections('functions-bindings-http-webhook-trigger', body);
    expect(sections.map(section => section.id)).toEqual(['http-trigger', 'example', 'example-2']);
    expect(sections[1]).toMatchObject({ title: 'Example', pivots: ['programming-language-python', 'programming-language-javascript', 'programming-language-typescript'] });
    expect(sections[1].text).toContain('# not a heading');
    expect(sections[1].text).not.toContain('zone');
    expect(sections[0].pivots).toBeUndefined();
  });

  it('starts a new section when a heading appears inside a pivot and keeps the pivot tag', () => {
    const sections = splitSections('a', '::: zone pivot="flex-consumption-plan"\n## Flex only\nText\n::: zone-end\n## Shared\nAll');
    expect(sections).toEqual([
      { id: 'flex-only', title: 'Flex only', text: 'Text', pivots: ['flex-consumption-plan'] },
      { id: 'shared', title: 'Shared', text: 'All' },
    ]);
  });
});

describe('buildArticle', () => {
  it('returns a Learn article with URL, date, and sections', () => {
    const article = buildArticle('articles/azure-functions/flex-consumption-plan.md', '---\ntitle: Flex Consumption plan\ndescription: Hosting\nms.date: 01/02/2026\n---\n# Flex Consumption plan\nIntro [!INCLUDE [x](../../includes/x.md)]\n## Limits\nOne', path => (path === 'includes/x.md' ? 'included' : undefined));
    expect(article).toMatchObject({
      id: 'flex-consumption-plan',
      title: 'Flex Consumption plan',
      description: 'Hosting',
      date: '01/02/2026',
      url: 'https://learn.microsoft.com/azure/azure-functions/flex-consumption-plan',
    });
    expect(article?.sections.map(section => section.text)).toEqual(['Intro included', 'One']);
  });

  it('skips redirect stubs and articles without text', () => {
    expect(buildArticle('articles/azure-functions/x.md', '---\ntitle: X\n---\n', () => undefined)).toBeUndefined();
  });
});

describe('learnUrl', () => {
  it('maps nested Functions article paths', () => {
    expect(learnUrl('articles/azure-functions/migration/migrate-aws-lambda.md')).toBe('https://learn.microsoft.com/azure/azure-functions/migration/migrate-aws-lambda');
  });

  it('maps related services under their own Learn path', () => {
    expect(learnUrl('articles/durable-task/durable-functions/durable-functions-overview.md')).toBe('https://learn.microsoft.com/azure/durable-task/durable-functions/durable-functions-overview');
  });
});

describe('buildArticle for related services', () => {
  it('prefixes the article ID with the service folder', () => {
    const article = buildArticle('articles/app-service/overview-managed-identity.md', '---\ntitle: Managed identities\n---\n# Managed identities\nUse identities.', () => undefined);
    expect(article).toMatchObject({ id: 'app-service/overview-managed-identity', url: 'https://learn.microsoft.com/azure/app-service/overview-managed-identity' });
  });
});
