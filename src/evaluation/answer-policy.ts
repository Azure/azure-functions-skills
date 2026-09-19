import type { SessionConfig } from '@github/copilot-sdk';
import { closeSync, fstatSync, openSync, readSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { TextDecoder } from 'node:util';

// SDK 1.0.11 exposes these types through SessionConfig, not as named exports.
export type UserInputRequest = Parameters<NonNullable<SessionConfig['onUserInputRequest']>>[0];
export type UserInputResponse = Awaited<ReturnType<NonNullable<SessionConfig['onUserInputRequest']>>>;

export interface AnswerPolicyRule {
  readonly id: string;
  /** Alternative regular expressions. Each must match the full question, without case sensitivity. */
  readonly match: readonly string[];
  readonly answer: string;
}

/** Keep this object on the controller. Do not stage it in the agent workspace. */
export interface AnswerPolicy {
  readonly version: 1;
  readonly rules: readonly AnswerPolicyRule[];
  /** Integer from 1 through 100, shared by all turns in one execution. */
  readonly maxQuestions: number;
}

export const MAX_ANSWER_POLICY_FILE_BYTES = 1024 * 1024;

export class AnswerPolicyFileError extends Error {
  readonly code = 'ANSWER_POLICY_FILE_ERROR';
  constructor(message: string) {
    super(`Invalid answerPolicyFile: ${message}`);
    this.name = 'AnswerPolicyFileError';
  }
}

export type AnswerPolicyBlockReason =
  | 'invalid-question'
  | 'question-limit'
  | 'no-match'
  | 'ambiguous-match'
  | 'choice-not-permitted';

export type AnswerPolicyDecision =
  | {
    readonly status: 'answered';
    readonly questionNumber: number;
    readonly ruleId: string;
    readonly response: UserInputResponse;
  }
  | {
    readonly status: 'blocked';
    readonly questionNumber: number;
    readonly ruleId?: string;
    readonly reason: AnswerPolicyBlockReason;
  };

function invalid(field: string, message: string): never {
  // Do not include policy values or a RegExp parser error in this message.
  throw new TypeError(`Invalid answerPolicy${field}: ${message}`);
}

function objectWithKeys(value: unknown, keys: readonly string[], field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalid(field, 'expected an object.');
  }
  if (Object.keys(value).some(key => !keys.includes(key))) {
    return invalid(field, 'remove unsupported fields.');
  }
  return value as Record<string, unknown>;
}

function boundedText(value: unknown, max: number, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    return invalid(field, `expected nonempty text with at most ${max} characters.`);
  }
  return value;
}

function compilePattern(pattern: string): RegExp {
  return new RegExp(`^(?:${pattern})$`, 'i');
}

/**
 * Parse trusted controller configuration. Limits: 100 rules, 16 patterns per rule,
 * 512 characters per pattern, 4096 per answer, and 64 per unique rule ID.
 * JavaScript regular expressions are not a sandbox; review patterns before use.
 */
export function parseAnswerPolicy(value: unknown): AnswerPolicy {
  const input = objectWithKeys(value, ['version', 'rules', 'maxQuestions'], '');
  if (input.version !== 1) invalid('.version', 'expected 1.');
  if (typeof input.maxQuestions !== 'number' || !Number.isInteger(input.maxQuestions)
    || input.maxQuestions < 1 || input.maxQuestions > 100) {
    invalid('.maxQuestions', 'expected an integer from 1 through 100.');
  }
  if (!Array.isArray(input.rules) || input.rules.length < 1 || input.rules.length > 100) {
    invalid('.rules', 'expected 1 through 100 rules.');
  }
  const ids = new Set<string>();
  const rules = input.rules.map((value: unknown, index: number): AnswerPolicyRule => {
    const field = `.rules[${index}]`;
    const rule = objectWithKeys(value, ['id', 'match', 'answer'], field);
    const id = boundedText(rule.id, 64, `${field}.id`);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id) || ids.has(id)) {
      invalid(`${field}.id`, 'use a unique ID with letters, digits, underscores, or hyphens.');
    }
    ids.add(id);
    if (!Array.isArray(rule.match) || rule.match.length < 1 || rule.match.length > 16) {
      invalid(`${field}.match`, 'expected 1 through 16 patterns.');
    }
    const match = rule.match.map((value: unknown, patternIndex: number) => {
      const patternField = `${field}.match[${patternIndex}]`;
      const pattern = boundedText(value, 512, patternField);
      try {
        compilePattern(pattern);
      } catch (_error) {
        invalid(patternField, 'expected a valid regular expression.');
      }
      return pattern;
    });
    return Object.freeze({
      id, match: Object.freeze(match), answer: boundedText(rule.answer, 4096, `${field}.answer`),
    });
  });
  return Object.freeze({ version: 1, maxQuestions: input.maxQuestions, rules: Object.freeze(rules) });
}

/** Read a UTF-8 JSON policy, at most 1 MiB, relative to the controller's cwd. */
export function readAnswerPolicyFile(path: string): AnswerPolicy {
  if (typeof path !== 'string' || !path.trim() || path.length > 4096 || path.includes('\0')) {
    throw new AnswerPolicyFileError('supply a nonempty file path with at most 4096 characters.');
  }
  let contents: Buffer;
  try {
    const absolutePath = resolve(path);
    if (!statSync(absolutePath).isFile()) {
      throw new AnswerPolicyFileError('supply a regular JSON file.');
    }
    const descriptor = openSync(absolutePath, 'r');
    try {
      const stat = fstatSync(descriptor);
      if (!stat.isFile()) throw new AnswerPolicyFileError('supply a regular JSON file.');
      if (stat.size > MAX_ANSWER_POLICY_FILE_BYTES) {
        throw new AnswerPolicyFileError(`file exceeds the ${MAX_ANSWER_POLICY_FILE_BYTES} byte limit.`);
      }
      // Read no more than the limit plus one byte, even if the file grows.
      const buffer = Buffer.alloc(MAX_ANSWER_POLICY_FILE_BYTES + 1);
      let length = 0;
      while (length < buffer.length) {
        const count = readSync(descriptor, buffer, length, buffer.length - length, null);
        if (count === 0) break;
        length += count;
      }
      if (length > MAX_ANSWER_POLICY_FILE_BYTES) {
        throw new AnswerPolicyFileError(`file exceeds the ${MAX_ANSWER_POLICY_FILE_BYTES} byte limit.`);
      }
      contents = buffer.subarray(0, length);
    } finally {
      closeSync(descriptor);
    }
  } catch (error) {
    if (error instanceof AnswerPolicyFileError) throw error;
    throw new AnswerPolicyFileError('cannot read the file. Check its path relative to the controller cwd and its permissions.');
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(contents));
  } catch (_error) {
    // JSON parser messages can include user facts from the input.
    throw new AnswerPolicyFileError('supply valid UTF-8 JSON.');
  }
  return parseAnswerPolicy(value);
}

/** One instance per execution. A blocked decision remains final. */
export class AnswerPolicySession {
  private readonly policy: AnswerPolicy;
  private readonly rules: readonly { rule: AnswerPolicyRule; patterns: readonly RegExp[] }[];
  private questionNumber = 0;
  private blocked?: Extract<AnswerPolicyDecision, { status: 'blocked' }>;

  constructor(policy: AnswerPolicy) {
    this.policy = parseAnswerPolicy(policy);
    this.rules = this.policy.rules.map(rule => ({ rule, patterns: rule.match.map(compilePattern) }));
  }

  decide(request: UserInputRequest): AnswerPolicyDecision {
    if (this.blocked) return this.blocked;
    this.questionNumber++;
    const block = (reason: AnswerPolicyBlockReason, ruleId?: string): AnswerPolicyDecision => {
      this.blocked = { status: 'blocked', questionNumber: this.questionNumber, reason, ...(ruleId && { ruleId }) };
      return this.blocked;
    };
    if (this.questionNumber > this.policy.maxQuestions) return block('question-limit');
    if (typeof request.question !== 'string' || !request.question.trim() || request.question.length > 4096) {
      return block('invalid-question');
    }
    const matches = this.rules.filter(({ patterns }) => patterns.some(pattern =>
      pattern.exec(request.question)?.[0] === request.question));
    if (matches.length === 0) return block('no-match');
    if (matches.length !== 1) return block('ambiguous-match');
    const { rule } = matches[0];
    const isChoice = request.choices?.includes(rule.answer) ?? false;
    if (request.allowFreeform === false && !isChoice) return block('choice-not-permitted', rule.id);
    return {
      status: 'answered', questionNumber: this.questionNumber, ruleId: rule.id,
      response: { answer: rule.answer, wasFreeform: !isChoice },
    };
  }
}
