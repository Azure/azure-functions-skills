import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  CopilotClient,
  type CopilotClientOptions,
  type CopilotSession,
  type ResumeSessionConfig,
  type SessionConfig,
} from '@github/copilot-sdk';
import type { ExecutorOptions, ExecutorRegistry, Stimulus, Trajectory } from '@microsoft/vally';
import {
  COPILOT_HOME_SETTINGS_JSON_ENV,
  CopilotSdkExecutor,
  validateCopilotSdkExecutorConfig,
  type CopilotSdkProviderConfig,
} from '@microsoft/vally/executor';
import {
  AnswerPolicySession,
  parseAnswerPolicy,
  readAnswerPolicyFile,
  type AnswerPolicy,
  type AnswerPolicyBlockReason,
  type AnswerPolicyDecision,
} from './answer-policy.js';

export type UserPolicyCopilotExecutorConfig = {
  readonly provider?: CopilotSdkProviderConfig;
} & (
  | { readonly answerPolicy: AnswerPolicy; readonly answerPolicyFile?: never }
  | {
    /** JSON policy path, resolved from the controller's process.cwd(), not the eval file. */
    readonly answerPolicyFile: string;
    readonly answerPolicy?: never;
  }
);

interface ResolvedExecutorConfig {
  readonly answerPolicy: AnswerPolicy;
  readonly answerPolicyFile?: string;
  readonly provider?: CopilotSdkProviderConfig;
}

export class AnswerPolicyBlockedError extends Error {
  readonly code = 'ANSWER_POLICY_BLOCKED';
  constructor(readonly reason: AnswerPolicyBlockReason, readonly questionNumber: number) {
    super(`User answer blocked (${reason}, question ${questionNumber}). Review the question and update the controller answerPolicy before another trial.`);
    this.name = 'AnswerPolicyBlockedError';
  }
}

export class AnswerPolicyArtifactError extends Error {
  readonly code = 'ANSWER_POLICY_ARTIFACT_ERROR';
  constructor(cause: unknown) {
    super('Cannot write the user answer trail. Check the controller artifact directory and its permissions.', { cause });
    this.name = 'AnswerPolicyArtifactError';
  }
}

function assertProvider(value: unknown): asserts value is CopilotSdkProviderConfig | undefined {
  validateCopilotSdkExecutorConfig(value === undefined ? {} : { provider: value });
}

function parseConfig(value: unknown): ResolvedExecutorConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || ('answerPolicy' in value) === ('answerPolicyFile' in value)
    || Object.keys(value).some(key => !['answerPolicy', 'answerPolicyFile', 'provider'].includes(key))) {
    throw new TypeError('Invalid executor config: supply exactly one of answerPolicy or answerPolicyFile, and an optional provider.');
  }
  const provider = 'provider' in value ? value.provider : undefined;
  assertProvider(provider);
  if ('answerPolicy' in value) {
    return { answerPolicy: parseAnswerPolicy(value.answerPolicy), ...(provider !== undefined && { provider }) };
  }
  if (!('answerPolicyFile' in value) || typeof value.answerPolicyFile !== 'string') {
    throw new TypeError('Invalid executor config: answerPolicyFile must be a nonempty file path.');
  }
  return {
    answerPolicy: readAnswerPolicyFile(value.answerPolicyFile),
    answerPolicyFile: resolve(value.answerPolicyFile),
    ...(provider !== undefined && { provider }),
  };
}

/** Resolve links in existing parents before creating an artifact directory. */
function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(canonicalPath(parent), basename(path));
  }
}

function assertOutsideWorkspace(directory: string, workDir: string): void {
  const child = relative(canonicalPath(resolve(workDir)), canonicalPath(resolve(directory)));
  if (child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`))) {
    throw new Error('User policy files, session logs, and artifacts must be outside options.workDir.');
  }
}

function createTrail(options: ExecutorOptions): string | undefined {
  // The durable artifact directory takes precedence over the scratch log directory.
  const directory = options.sessionLog?.executorArtifactsDir ?? options.sessionLog?.rootDir;
  if (options.sessionLog?.rootDir) assertOutsideWorkspace(options.sessionLog.rootDir, options.workDir);
  if (!directory) return undefined;
  assertOutsideWorkspace(directory, options.workDir);
  const path = join(resolve(directory), `user-policy-${randomUUID()}.jsonl`);
  try {
    mkdirSync(directory, { recursive: true });
    writeFileSync(path, '', { flag: 'wx', mode: 0o600 });
  } catch (error) {
    throw new AnswerPolicyArtifactError(error);
  }
  return path;
}

class ExecutionAnswers {
  private readonly policy: AnswerPolicySession;
  private failure?: Error;
  private closed = false;
  private fail!: (error: Error) => void;
  // Resolve with the error: rejection is attached only when a send is active.
  private readonly failureSignal = new Promise<Error>(resolve => { this.fail = resolve; });

  constructor(policy: AnswerPolicy, private readonly trailPath?: string) {
    this.policy = new AnswerPolicySession(policy);
  }

  assertActive(): void {
    if (this.failure) throw this.failure;
    if (this.closed) throw new Error('The user answer session is closed.');
  }

  close(): void { this.closed = true; }

  readonly onUserInputRequest: NonNullable<SessionConfig['onUserInputRequest']> = request => {
    this.assertActive();
    try {
      const decision = this.policy.decide(request);
      this.record(request.question, decision);
      if (decision.status === 'blocked') {
        throw new AnswerPolicyBlockedError(decision.reason, decision.questionNumber);
      }
      return decision.response;
    } catch (error) {
      const failure = error instanceof Error ? error : new Error('The user answer handler failed.', { cause: error });
      this.failure = failure;
      this.fail(failure);
      throw failure;
    }
  };

  private record(question: string, decision: AnswerPolicyDecision): void {
    if (!this.trailPath) return;
    const answer = decision.status === 'answered' ? decision.response.answer : undefined;
    const entry = {
      questionNumber: decision.questionNumber,
      question: question.slice(0, 512),
      questionTruncated: question.length > 512,
      status: decision.status,
      ruleId: decision.ruleId,
      ...(answer !== undefined && {
        answer: answer.slice(0, 512), answerTruncated: answer.length > 512,
        wasFreeform: decision.status === 'answered' && decision.response.wasFreeform,
      }),
      ...(decision.status === 'blocked' && { reason: decision.reason }),
    };
    try {
      appendFileSync(this.trailPath, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch (error) {
      throw new AnswerPolicyArtifactError(error);
    }
  }

  wrap(session: CopilotSession): CopilotSession {
    this.assertActive();
    return new Proxy(session, {
      get: (target, property) => {
        if (property === 'sendAndWait') {
          return async (...args: Parameters<CopilotSession['sendAndWait']>) => {
            this.assertActive();
            // SDK callback errors can become tool results. Reject the Vally send
            // boundary too, so Vally aborts, exports history, and stops the client.
            const response = await Promise.race([
              target.sendAndWait(...args),
              this.failureSignal.then(error => { throw error; }),
            ]);
            this.assertActive();
            return response;
          };
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }
}

class UserPolicyClient extends CopilotClient {
  constructor(options: CopilotClientOptions, private readonly answers: ExecutionAnswers) {
    super(options);
  }

  override async createSession(config: SessionConfig): Promise<CopilotSession> {
    return this.answers.wrap(await super.createSession({
      ...config, onUserInputRequest: this.answers.onUserInputRequest,
    }));
  }

  override async resumeSession(sessionId: string, config: ResumeSessionConfig): Promise<CopilotSession> {
    return this.answers.wrap(await super.resumeSession(sessionId, {
      ...config, onUserInputRequest: this.answers.onUserInputRequest,
    }));
  }
}

/**
 * Vally executor plugin with deterministic, controller-side user answers.
 * Uses one short-lived SDK client and isolated config home per execution.
 * Session resume is not supported by Vally's per-run environment path.
 */
export class UserPolicyCopilotExecutor extends CopilotSdkExecutor {
  private readonly answerContext: AsyncLocalStorage<ExecutionAnswers>;

  constructor() {
    const answerContext = new AsyncLocalStorage<ExecutionAnswers>();
    super({
      createClient: () => {
        throw new Error('User policy execution requires the isolated per-run client factory.');
      },
      createEnvClient: (env, telemetry, onGetTraceContext) => {
        const answers = answerContext.getStore();
        if (!answers) throw new Error('No user answer policy is bound to this execution.');
        return new UserPolicyClient({ env, telemetry, onGetTraceContext }, answers);
      },
    });
    this.answerContext = answerContext;
    this.name = 'user-policy-copilot';
  }

  override validateConfig(config: unknown): void { parseConfig(config); }

  override async execute(stimulus: Stimulus, options: ExecutorOptions): Promise<Trajectory> {
    const config = parseConfig(options.executorConfig);
    if (options.sessionID != null) {
      throw new Error('user-policy-copilot cannot resume a session. Use stimulus turns in one execution instead.');
    }
    if (config.answerPolicyFile) assertOutsideWorkspace(config.answerPolicyFile, options.workDir);
    const answers = new ExecutionAnswers(config.answerPolicy, createTrail(options));
    const env = { ...options.env };
    const settingsKeys = Object.keys(env).filter(key => key.toLowerCase() === COPILOT_HOME_SETTINGS_JSON_ENV.toLowerCase());
    // A sentinel alone does not pin COPILOT_HOME in Vally 0.16.0's env factory.
    // Its public settings option creates, pins, and removes a per-trial home.
    if (settingsKeys.length === 0) env[COPILOT_HOME_SETTINGS_JSON_ENV] = '{}';
    try {
      return await this.answerContext.run(answers, async () => {
        const trajectory = await super.execute(stimulus, {
          ...options,
          env,
          executorConfig: config.provider === undefined ? {} : { provider: config.provider },
        });
        answers.assertActive();
        return trajectory;
      });
    } finally {
      answers.close();
    }
  }
}

export function registerExecutors(registry: ExecutorRegistry): void {
  registry.register(new UserPolicyCopilotExecutor());
}
