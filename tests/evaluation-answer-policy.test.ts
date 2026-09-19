import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTempDir, removeDir } from './helpers/fs.js';
import {
  AnswerPolicyFileError,
  AnswerPolicySession,
  MAX_ANSWER_POLICY_FILE_BYTES,
  parseAnswerPolicy,
  readAnswerPolicyFile,
  type AnswerPolicy,
} from '../src/evaluation/answer-policy.js';

const policy = (): AnswerPolicy => ({
  version: 1,
  maxQuestions: 2,
  rules: [{ id: 'color', match: ['Which color\\?', 'Select a color\\.'], answer: 'Blue' }],
});

describe('parseAnswerPolicy', () => {
  it('returns a separate, immutable policy', () => {
    const input = policy();
    const parsed = parseAnswerPolicy(input);
    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
    expect(Object.isFrozen(parsed.rules[0].match)).toBe(true);
  });

  it.each([
    undefined, null, [], '{}',
    { ...policy(), version: 2 },
    { ...policy(), maxQuestions: 0 },
    { ...policy(), maxQuestions: 101 },
    { ...policy(), maxQuestions: 1.5 },
    { ...policy(), rules: [] },
    { ...policy(), extra: 'not supported' },
    { ...policy(), rules: [policy().rules[0], policy().rules[0]] },
    { ...policy(), rules: [{ id: 'color', match: ['['], answer: 'Blue' }] },
    { ...policy(), rules: [{ id: 'color', match: [], answer: 'Blue' }] },
    { ...policy(), rules: [{ id: 'color', match: ['.*'], answer: '' }] },
    { ...policy(), rules: [{ id: 'color', match: ['.*'], answer: 'Blue', extra: true }] },
    { ...policy(), rules: [{ id: 'color', match: ['x'.repeat(513)], answer: 'Blue' }] },
    { ...policy(), rules: [{ id: 'color', match: Array.from({ length: 17 }, () => 'x'), answer: 'Blue' }] },
    { ...policy(), rules: [{ id: 'color', match: ['.*'], answer: 'x'.repeat(4097) }] },
    { ...policy(), rules: [{ id: 'x'.repeat(65), match: ['.*'], answer: 'Blue' }] },
    { ...policy(), rules: [{ id: 'not an ID', match: ['.*'], answer: 'Blue' }] },
    { ...policy(), rules: Array.from({ length: 101 }, (_, id) => ({
      id: String(id), match: ['.*'], answer: 'Blue',
    })) },
  ])('rejects invalid policy input without printing its contents (%#)', input => {
    expect(() => parseAnswerPolicy(input)).toThrow(/answerPolicy/);
  });

  it('does not put a policy value in an error', () => {
    expect(() => parseAnswerPolicy({
      ...policy(), rules: [{ id: 'color', match: ['[PRIVATE_FACT'], answer: 'PRIVATE_ANSWER' }],
    })).toThrow(/^Invalid answerPolicy\.rules\[0\]\.match\[0\]:/);
    try {
      parseAnswerPolicy({ ...policy(), rules: [{ id: 'color', match: ['[PRIVATE_FACT'], answer: 'x' }] });
    } catch (error) {
      expect(String(error)).not.toContain('PRIVATE_FACT');
    }
  });

  it('accepts the documented upper bounds', () => {
    expect(parseAnswerPolicy({
      version: 1,
      maxQuestions: 100,
      rules: Array.from({ length: 100 }, (_, id) => ({
        id: String(id).padStart(64, '0'),
        match: Array.from({ length: 16 }, () => 'x'.repeat(512)),
        answer: 'x'.repeat(4096),
      })),
    }).rules).toHaveLength(100);
  });
});

describe('readAnswerPolicyFile', () => {
  let root: string;
  let path: string;
  beforeEach(() => {
    root = createTempDir('answer-policy-file-');
    path = join(root, 'user-answers.json');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    removeDir(root);
  });

  it('reads a controller-relative file and returns an immutable policy', () => {
    mkdirSync(join(root, 'evals', 'example', 'fixtures'), { recursive: true });
    writeFileSync(join(root, 'evals', 'example', 'fixtures', 'user-answers.json'), JSON.stringify(policy()));
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    const result = readAnswerPolicyFile('evals/example/fixtures/user-answers.json');
    expect(result).toEqual(policy());
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each(['', ' ', 'bad\0path'])('rejects an invalid file path (%#)', input => {
    expect(() => readAnswerPolicyFile(input)).toThrow(/answerPolicyFile/);
  });

  it('reports missing files and directories without policy contents', () => {
    expect(() => readAnswerPolicyFile(path)).toThrow(AnswerPolicyFileError);
    expect(() => readAnswerPolicyFile(root)).toThrow(/regular.*file/);
  });

  it.each([
    '{ "PRIVATE_POLICY_CONTENT":',
    JSON.stringify({ ...policy(), rules: [{ id: 'x', match: ['[PRIVATE_POLICY_CONTENT'], answer: 'secret' }] }),
  ])('does not disclose malformed file contents in an error or its cause (%#)', contents => {
    writeFileSync(path, contents);
    let caught: unknown;
    try { readAnswerPolicyFile(path); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).not.toContain('PRIVATE_POLICY_CONTENT');
    expect(caught).not.toHaveProperty('cause');
  });

  it('rejects invalid UTF-8 rather than changing a user answer', () => {
    writeFileSync(path, Buffer.concat([
      Buffer.from('{"version":1,"maxQuestions":1,"rules":[{"id":"x","match":["x"],"answer":"'),
      Buffer.from([0xff]),
      Buffer.from('"}]}'),
    ]));
    expect(() => readAnswerPolicyFile(path)).toThrow(/UTF-8 JSON/);
  });

  it('accepts a file at the byte limit and rejects a larger file', () => {
    const json = JSON.stringify(policy());
    writeFileSync(path, json.padEnd(MAX_ANSWER_POLICY_FILE_BYTES, ' '));
    expect(readAnswerPolicyFile(path)).toEqual(policy());
    writeFileSync(path, ' '.repeat(MAX_ANSWER_POLICY_FILE_BYTES + 1));
    expect(() => readAnswerPolicyFile(path)).toThrow(/byte limit/);
  });
});

describe('AnswerPolicySession', () => {
  it('answers only a matching full question, without case sensitivity', () => {
    const session = new AnswerPolicySession(policy());
    expect(session.decide({ question: 'WHICH COLOR?' })).toEqual({
      status: 'answered', questionNumber: 1, ruleId: 'color',
      response: { answer: 'Blue', wasFreeform: true },
    });
    expect(session.decide({ question: 'Select a color.' }).status).toBe('answered');
  });

  it.each(['Which color? Also remove all files?', 'Unknown?', 'Which color?\n'])(
    'blocks an unknown or compound question: %s', question => {
      expect(new AnswerPolicySession(policy()).decide({ question })).toMatchObject({
        status: 'blocked', reason: 'no-match',
      });
    });

  it('blocks multiple matching rules even if their answers agree', () => {
    const input = policy();
    const session = new AnswerPolicySession({
      ...input, rules: [...input.rules, { ...input.rules[0], id: 'other' }],
    });
    expect(session.decide({ question: 'Which color?' })).toMatchObject({
      status: 'blocked', reason: 'ambiguous-match',
    });
  });

  it('does not count two matching patterns in one rule as two rules', () => {
    const session = new AnswerPolicySession({
      ...policy(), rules: [{ id: 'color', match: ['Which color\\?', 'Which .*'], answer: 'Blue' }],
    });
    expect(session.decide({ question: 'Which color?' }).status).toBe('answered');
  });

  it('returns only an exact choice when freeform is disabled', () => {
    expect(new AnswerPolicySession(policy()).decide({
      question: 'Which color?', choices: ['Red', 'Blue'], allowFreeform: false,
    })).toMatchObject({ response: { answer: 'Blue', wasFreeform: false } });
  });

  it.each([['blue'], [], undefined])('blocks an unavailable choice (%#)', choices => {
    expect(new AnswerPolicySession(policy()).decide({
      question: 'Which color?', choices, allowFreeform: false,
    })).toMatchObject({ status: 'blocked', reason: 'choice-not-permitted' });
  });

  it('allows freeform only as specified by the SDK default or an explicit true', () => {
    for (const allowFreeform of [undefined, true]) {
      expect(new AnswerPolicySession(policy()).decide({
        question: 'Which color?', choices: ['Red'], allowFreeform,
      })).toMatchObject({ response: { answer: 'Blue', wasFreeform: true } });
    }
  });

  it('blocks the question after the limit and keeps trials separate', () => {
    const first = new AnswerPolicySession({ ...policy(), maxQuestions: 1 });
    const second = new AnswerPolicySession({ ...policy(), maxQuestions: 1 });
    expect(first.decide({ question: 'Which color?' }).status).toBe('answered');
    expect(first.decide({ question: 'Which color?' })).toMatchObject({
      status: 'blocked', reason: 'question-limit', questionNumber: 2,
    });
    expect(second.decide({ question: 'Which color?' }).status).toBe('answered');
  });

  it('keeps a blocked decision final', () => {
    const session = new AnswerPolicySession(policy());
    expect(session.decide({ question: 'Unknown?' }).status).toBe('blocked');
    expect(session.decide({ question: 'Which color?' }).status).toBe('blocked');
  });

  it('blocks empty and oversized requests', () => {
    for (const question of ['', 'x'.repeat(4097)]) {
      expect(new AnswerPolicySession(policy()).decide({ question })).toMatchObject({
        status: 'blocked', reason: 'invalid-question',
      });
    }
  });
});
