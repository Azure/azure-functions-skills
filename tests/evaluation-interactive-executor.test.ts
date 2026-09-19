import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionConfig } from '@github/copilot-sdk';
import type { UserInputRequest, UserInputResponse } from '../src/evaluation/answer-policy.js';
import type { ExecutorOptions, Stimulus } from '@microsoft/vally';
import { createExecutorRegistry, createGraderRegistry, loadEvalSpec, validateEvalSpec } from '@microsoft/vally';
import { createTempDir, removeDir } from './helpers/fs.js';

const sdk = vi.hoisted(() => ({
  clients: [] as FakeClient[],
  run: async (_session: FakeSession): Promise<void> => {},
  stopErrors: [] as Error[],
}));

class FakeSession {
  readonly sessionId: string;
  readonly abort = vi.fn(async () => {});
  readonly disconnect = vi.fn(async () => {});
  readonly getEvents = vi.fn(async () => []);
  readonly on = vi.fn((_listener: (event: unknown) => void) => () => {});
  readonly sendAndWait = vi.fn(async (_message: unknown, _timeout?: number) => {
    await sdk.run(this);
    return { data: { content: 'Done' } };
  });

  constructor(readonly config: SessionConfig) {
    this.sessionId = config.sessionId ?? `session-${sdk.clients.length}`;
  }

  async ask(request: UserInputRequest): Promise<UserInputResponse> {
    if (!this.config.onUserInputRequest) throw new Error('Missing user input handler');
    return this.config.onUserInputRequest(request, { sessionId: this.sessionId });
  }
}

class FakeClient {
  readonly sessions: FakeSession[] = [];
  readonly stop = vi.fn(async () => sdk.stopErrors);
  readonly forceStop = vi.fn(async () => {});
  readonly deleteSession = vi.fn(async (_id: string) => {});
  readonly createSession = vi.fn(async (config: SessionConfig) => {
    const session = new FakeSession(config);
    this.sessions.push(session);
    return session;
  });
  readonly resumeSession = vi.fn(async (_id: string, config: SessionConfig) => this.createSession(config));

  constructor(readonly options: { env?: NodeJS.ProcessEnv; telemetry?: unknown; onGetTraceContext?: unknown }) {
    sdk.clients.push(this);
  }
}

vi.mock('@github/copilot-sdk', () => ({
  CopilotClient: class {
    readonly fake: FakeClient;
    constructor(options: FakeClient['options']) { this.fake = new FakeClient(options); }
    createSession(config: SessionConfig) { return this.fake.createSession(config); }
    resumeSession(id: string, config: SessionConfig) { return this.fake.resumeSession(id, config); }
    stop() { return this.fake.stop(); }
    forceStop() { return this.fake.forceStop(); }
    deleteSession(id: string) { return this.fake.deleteSession(id); }
  },
  approveAll: vi.fn(),
}));

import {
  AnswerPolicyBlockedError,
  AnswerPolicyArtifactError,
  UserPolicyCopilotExecutor,
  registerExecutors,
} from '../src/evaluation/interactive-executor.js';

let root: string;
let executor: UserPolicyCopilotExecutor;
const stimulus: Stimulus = { name: 'offline', prompt: 'Do the task.', rubric: [] };
function config(answer = 'Blue', maxQuestions = 2) {
  return { answerPolicy: { version: 1, maxQuestions, rules: [
    { id: 'color', match: ['Which color\\?'], answer },
    { id: 'unused', match: ['Unused fact\\?'], answer: 'NEVER_DISCLOSE_THIS_FACT' },
  ] } };
}
function options(answer = 'Blue'): ExecutorOptions {
  return {
    timeout: 1000, workDir: join(root, 'workspace'), executorConfig: config(answer),
    sessionLog: { rootDir: join(root, 'logs'), executorArtifactsDir: join(root, 'artifacts') },
  };
}
function trail(): unknown[] {
  const dir = join(root, 'artifacts');
  return readdirSync(dir).filter(name => name.startsWith('user-policy-'))
    .flatMap(name => readFileSync(join(dir, name), 'utf8').trim().split('\n').filter(Boolean).map(
      line => JSON.parse(line) as unknown,
    ));
}

beforeEach(() => {
  root = createTempDir('answer-policy-');
  mkdirSync(join(root, 'workspace'));
  executor = new UserPolicyCopilotExecutor();
  sdk.clients.length = 0;
  sdk.run = async () => {};
  sdk.stopErrors = [];
});
afterEach(async () => {
  await executor.shutdown();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  removeDir(root);
});

describe('UserPolicyCopilotExecutor', () => {
  it('loads the public Vally executor and registers the plugin', async () => {
    const { CopilotSdkExecutor } = await import('@microsoft/vally/executor');
    expect(executor).toBeInstanceOf(CopilotSdkExecutor);
    const registry = createExecutorRegistry();
    registerExecutors(registry);
    expect(registry.get('user-policy-copilot')).toBeInstanceOf(UserPolicyCopilotExecutor);
    expect(executor.supportsMultiTurn).toBe(true);
    expect(executor.supportsTurnCompletion).toBe(true);
    expect(executor.supportsSimulation).toBe(true);
  });

  it('does not put answers in the initial prompt, environment, session config, or trail', async () => {
    const result = await executor.execute(stimulus, options());
    const client = sdk.clients[0];
    const session = client.sessions[0];
    expect(session.sendAndWait.mock.calls[0][0]).toEqual({ prompt: 'Do the task.', mode: 'immediate' });
    expect(JSON.stringify([client.options, session.config, result])).not.toContain('Blue');
    expect(JSON.stringify([client.options, session.config, result])).not.toContain('NEVER_DISCLOSE');
    expect(trail()).toEqual([]);
    expect(session.disconnect).toHaveBeenCalledOnce();
    expect(client.stop).toHaveBeenCalledOnce();
  });

  it('answers only on request and records only the selected answer', async () => {
    sdk.run = async session => {
      expect(await session.ask({ question: 'Which color?' })).toEqual({ answer: 'Blue', wasFreeform: true });
    };
    const result = await executor.execute(stimulus, options());
    expect(result.endReason).toBe('completed');
    expect(result.metadata.executor).toBe('user-policy-copilot');
    expect(trail()).toEqual([expect.objectContaining({
      question: 'Which color?', answer: 'Blue', ruleId: 'color', status: 'answered', questionNumber: 1,
    })]);
    expect(JSON.stringify(trail())).not.toContain('NEVER_DISCLOSE');
    expect(readdirSync(join(root, 'workspace'))).toEqual([]);
  });

  it('uses the isolated merged environment and cleans up its home', async () => {
    vi.stubEnv('COPILOT_HOME', join(root, 'host-home'));
    vi.stubEnv('EVALUATE_USE_HOST_COPILOT_HOME', '1');
    const input = options();
    input.env = { CUSTOM_TRIAL_ENV: 'kept', copilot_home_settings_json: '{"testSetting":true}' };
    sdk.run = async session => {
      const env = sdk.clients[0].options.env!;
      expect(env.CUSTOM_TRIAL_ENV).toBe('kept');
      expect(env.COPILOT_HOME).not.toBe(join(root, 'host-home'));
      expect(env.COPILOT_HOME).toBe(session.config.configDirectory);
      expect(readFileSync(join(env.COPILOT_HOME!, 'settings.json'), 'utf8')).toContain('"testSetting": true');
      expect(Object.keys(env).some(key => key.toLowerCase() === 'copilot_home_settings_json')).toBe(false);
    };
    await executor.execute(stimulus, input);
    expect(existsSync(sdk.clients[0].options.env!.COPILOT_HOME!)).toBe(false);
  });

  it('creates an empty isolated home when no environment overrides are supplied', async () => {
    vi.stubEnv('COPILOT_HOME', join(root, 'host-home'));
    vi.stubEnv('EVALUATE_USE_HOST_COPILOT_HOME', '1');
    sdk.run = async session => {
      const home = sdk.clients[0].options.env!.COPILOT_HOME!;
      expect(home).not.toBe(join(root, 'host-home'));
      expect(home).toBe(session.config.configDirectory);
      expect(readFileSync(join(home, 'settings.json'), 'utf8')).toBe('{}');
    };
    await executor.execute(stimulus, options());
    expect(existsSync(sdk.clients[0].options.env!.COPILOT_HOME!)).toBe(false);
  });

  it.each(['unknown', 'ambiguous', 'choice', 'limit'])(
    'fails a %s decision even when the SDK swallows callback errors', async kind => {
      const input = options();
      const policy = config();
      if (kind === 'ambiguous') policy.answerPolicy.rules.push({ id: 'duplicate', match: ['Which .*'], answer: 'Blue' });
      if (kind === 'limit') policy.answerPolicy.maxQuestions = 1;
      input.executorConfig = policy;
      sdk.run = async session => {
        writeFileSync(join(root, 'workspace', 'partial.txt'), 'Keep this source.');
        if (kind === 'limit') await session.ask({ question: 'Which color?' });
        try {
          await session.ask({
            question: kind === 'unknown' ? 'Delete files?' : 'Which color?',
            ...(kind === 'choice' ? { choices: ['Red'], allowFreeform: false } : {}),
          });
        } catch {
          // The real SDK can convert a callback error to a tool result.
        }
      };
      await expect(executor.execute(stimulus, input)).rejects.toBeInstanceOf(AnswerPolicyBlockedError);
      expect(sdk.clients[0].sessions[0].abort).toHaveBeenCalledOnce();
      expect(sdk.clients[0].sessions[0].disconnect).toHaveBeenCalledOnce();
      expect(sdk.clients[0].stop).toHaveBeenCalledOnce();
      expect(trail().at(-1)).toMatchObject({ status: 'blocked' });
      expect(readFileSync(join(root, 'workspace', 'partial.txt'), 'utf8')).toBe('Keep this source.');
    });

  it('unwinds a blocked request even when sendAndWait does not settle', async () => {
    sdk.run = async session => {
      await session.ask({ question: 'Unknown?' }).catch(() => {});
      await new Promise(() => {});
    };
    await expect(executor.execute(stimulus, options())).rejects.toMatchObject({
      code: 'ANSWER_POLICY_BLOCKED', reason: 'no-match',
    });
    expect(sdk.clients[0].stop).toHaveBeenCalledOnce();
  });

  it('does not start another turn or report completion after a block', async () => {
    const onTurnComplete = vi.fn(async () => {});
    sdk.run = async session => { await session.ask({ question: 'Unknown?' }).catch(() => {}); };
    await expect(executor.execute(
      { ...stimulus, turns: ['First', 'Second'] }, { ...options(), onTurnComplete },
    )).rejects.toBeInstanceOf(AnswerPolicyBlockedError);
    expect(sdk.clients[0].sessions[0].sendAndWait).toHaveBeenCalledOnce();
    expect(onTurnComplete).not.toHaveBeenCalled();
  });

  it('keeps policies and question counts separate during overlapping trials', async () => {
    let entered = 0;
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    const answers: string[] = [];
    sdk.run = async session => {
      if (++entered === 2) release();
      await ready;
      answers.push((await session.ask({ question: 'Which color?' })).answer);
    };
    const first = options('Blue');
    const second = options('Green');
    first.executorConfig = config('Blue', 1);
    second.executorConfig = config('Green', 1);
    await Promise.all([executor.execute(stimulus, first), executor.execute(stimulus, second)]);
    expect(answers.sort()).toEqual(['Blue', 'Green']);
    expect(new Set(sdk.clients.map(client => client.options.env!.COPILOT_HOME)).size).toBe(2);
    expect(trail()).toHaveLength(2);
    await expect(sdk.clients[0].sessions[0].ask({ question: 'Which color?' })).rejects.toThrow(/closed/i);
  });

  it('does not carry a blocked state into the next trial', async () => {
    sdk.run = async session => { await session.ask({ question: 'Unknown?' }).catch(() => {}); };
    await expect(executor.execute(stimulus, options())).rejects.toBeInstanceOf(AnswerPolicyBlockedError);
    sdk.run = async session => {
      expect(await session.ask({ question: 'Which color?' })).toMatchObject({ answer: 'Green' });
    };
    await expect(executor.execute(stimulus, options('Green'))).resolves.toMatchObject({ endReason: 'completed' });
    expect(sdk.clients).toHaveLength(2);
  });

  it('works without an artifact path and does not write the trail into the workspace', async () => {
    sdk.run = async session => { await session.ask({ question: 'Which color?' }); };
    await executor.execute(stimulus, { ...options(), sessionLog: undefined });
    expect(readdirSync(root)).toEqual(['workspace']);
  });

  it('rejects an artifact directory inside the workspace before starting a client', async () => {
    const input = options();
    input.sessionLog!.executorArtifactsDir = join(input.workDir, 'artifacts');
    await expect(executor.execute(stimulus, input)).rejects.toThrow(/outside.*workDir/);
    expect(sdk.clients).toHaveLength(0);
  });

  it('rejects a native session log directory inside the workspace', async () => {
    const input = options();
    input.sessionLog!.rootDir = input.workDir;
    await expect(executor.execute(stimulus, input)).rejects.toThrow(/outside.*workDir/);
    expect(sdk.clients).toHaveLength(0);
  });

  it('uses the scratch log directory when no durable artifact directory is supplied', async () => {
    const input = options();
    input.sessionLog = { rootDir: join(root, 'logs') };
    sdk.run = async session => { await session.ask({ question: 'Which color?' }); };
    await executor.execute(stimulus, input);
    const files = readdirSync(join(root, 'logs')).filter(name => name.startsWith('user-policy-'));
    expect(files).toHaveLength(1);
    expect(readFileSync(join(root, 'logs', files[0]), 'utf8')).toContain('"answer":"Blue"');
  });

  it('rejects an artifact path that resolves through a link into the workspace', async () => {
    symlinkSync(join(root, 'workspace'), join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    const input = options();
    input.sessionLog!.executorArtifactsDir = join(root, 'linked', 'new-artifacts');
    await expect(executor.execute(stimulus, input)).rejects.toThrow(/outside.*workDir/);
    expect(sdk.clients).toHaveLength(0);
    expect(readdirSync(join(root, 'workspace'))).toEqual([]);
  });

  it('does not hide an artifact write error or deliver an answer after it', async () => {
    sdk.run = async session => {
      const artifact = readdirSync(join(root, 'artifacts')).find(name => name.startsWith('user-policy-'))!;
      removeDir(join(root, 'artifacts', artifact));
      mkdirSync(join(root, 'artifacts', artifact));
      await session.ask({ question: 'Which color?' }).catch(() => {});
    };
    await expect(executor.execute(stimulus, options())).rejects.toBeInstanceOf(AnswerPolicyArtifactError);
    expect(sdk.clients[0].sessions[0].abort).toHaveBeenCalledOnce();
  });

  it('fails an artifact creation error before starting a client', async () => {
    writeFileSync(join(root, 'artifacts'), 'Not a directory.');
    await expect(executor.execute(stimulus, options())).rejects.toBeInstanceOf(AnswerPolicyArtifactError);
    expect(sdk.clients).toHaveLength(0);
  });

  it('rejects resume and invalid config before starting a client', async () => {
    await expect(executor.execute(stimulus, { ...options(), sessionID: 'old' })).rejects.toThrow(/resume/i);
    await expect(executor.execute(stimulus, { ...options(), executorConfig: {} })).rejects.toThrow(/answerPolicy/);
    expect(() => executor.validateConfig({ ...config(), typo: true })).toThrow(/config/);
    expect(sdk.clients).toHaveLength(0);
  });

  it('requires exactly one policy source', async () => {
    for (const executorConfig of [
      {},
      { ...config(), answerPolicyFile: 'user-answers.json' },
      { ...config(), answerPolicyFile: undefined },
      { answerPolicyFile: '' },
      { answerPolicyFile: 42 },
      { answerPolicyFile: 'missing.json', typo: true },
    ]) {
      expect(() => executor.validateConfig(executorConfig)).toThrow(/answerPolicy/);
      await expect(executor.execute(stimulus, { ...options(), executorConfig })).rejects.toThrow(/answerPolicy/);
    }
    expect(sdk.clients).toHaveLength(0);
  });

  it('reads file policies from the controller cwd, not from the spec or agent workspace', async () => {
    const directory = join(root, 'inputs', 'evals', 'example', 'fixtures');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'user-answers.json'), JSON.stringify(config().answerPolicy));
    vi.spyOn(process, 'cwd').mockReturnValue(join(root, 'inputs'));
    const executorConfig = { answerPolicyFile: 'evals/example/fixtures/user-answers.json' };
    executor.validateConfig(executorConfig);
    expect(sdk.clients).toHaveLength(0);
    sdk.run = async session => {
      expect(await session.ask({ question: 'Which color?' })).toMatchObject({ answer: 'Blue' });
    };
    const result = await executor.execute(stimulus, { ...options(), executorConfig });
    expect(result.endReason).toBe('completed');
    expect(readdirSync(join(root, 'workspace'))).toEqual([]);
    expect(JSON.stringify([sdk.clients[0].options, sdk.clients[0].sessions[0].config, result, trail()]))
      .not.toContain('NEVER_DISCLOSE_THIS_FACT');
  });

  it('reads and validates the file again before execution', async () => {
    const path = join(root, 'user-answers.json');
    const executorConfig = { answerPolicyFile: path };
    writeFileSync(path, JSON.stringify(config().answerPolicy));
    executor.validateConfig(executorConfig);
    writeFileSync(path, '{"PRIVATE_POLICY_CONTENT":');
    await expect(executor.execute(stimulus, { ...options(), executorConfig }))
      .rejects.toMatchObject({ code: 'ANSWER_POLICY_FILE_ERROR' });
    expect(sdk.clients).toHaveLength(0);
    expect(existsSync(join(root, 'artifacts'))).toBe(false);
  });

  it('rejects a policy file inside the agent workspace', async () => {
    const path = join(root, 'workspace', 'user-answers.json');
    writeFileSync(path, JSON.stringify(config().answerPolicy));
    await expect(executor.execute(stimulus, {
      ...options(), executorConfig: { answerPolicyFile: path },
    })).rejects.toThrow(/outside.*workDir/);
    expect(sdk.clients).toHaveLength(0);
  });

  it('validates file policies through the public Vally preflight API without execution', async () => {
    const controller = join(root, 'inputs');
    const fixtureDir = join(controller, 'evals', 'example', 'fixtures');
    mkdirSync(fixtureDir, { recursive: true });
    const path = join(fixtureDir, 'user-answers.json');
    writeFileSync(path, JSON.stringify(config().answerPolicy));
    const evalFilePath = join(controller, 'evals', 'example', 'eval.yaml');
    writeFileSync(evalFilePath, JSON.stringify({
      name: 'offline-policy',
      defaults: {
        executor: {
          name: 'user-policy-copilot',
          config: { answerPolicyFile: 'evals/example/fixtures/user-answers.json' },
        },
      },
      stimuli: [{ name: 'example', prompt: 'Do the task.' }],
    }));
    vi.spyOn(process, 'cwd').mockReturnValue(controller);
    const executorRegistry = createExecutorRegistry();
    executorRegistry.register(executor);
    const registry = createGraderRegistry();
    const spec = await loadEvalSpec(evalFilePath);
    expect(validateEvalSpec(spec, { registry, executorRegistry, evalFilePath, skipGrade: true }).valid).toBe(true);
    writeFileSync(path, 'PRIVATE_POLICY_CONTENT');
    const invalid = validateEvalSpec(spec, { registry, executorRegistry, evalFilePath, skipGrade: true });
    expect(invalid.valid).toBe(false);
    expect(JSON.stringify(invalid)).not.toContain('PRIVATE_POLICY_CONTENT');
    expect(sdk.clients).toHaveLength(0);
  });

  it('passes provider and telemetry options to the existing executor', async () => {
    executor.configureTelemetry({ otlpEndpoint: 'http://localhost:4318', captureContent: false });
    const provider = { baseUrl: 'http://localhost:9000', type: 'openai' };
    const input = { ...options(), executorConfig: { ...config(), provider } };
    executor.validateConfig(input.executorConfig);
    await executor.execute(stimulus, input);
    expect(sdk.clients[0].sessions[0].config.provider).toMatchObject(provider);
    expect(sdk.clients[0].options.telemetry).toMatchObject({ captureContent: false });
    expect(sdk.clients[0].options.onGetTraceContext).toBeTypeOf('function');
  });

  it('keeps ordinary errors and the Vally force-stop fallback', async () => {
    sdk.stopErrors = [new Error('Stop failed')];
    sdk.run = async () => { throw new Error('Offline send failure'); };
    await expect(executor.execute(stimulus, options())).rejects.toThrow('Offline send failure');
    expect(sdk.clients[0].forceStop).toHaveBeenCalledOnce();
    expect(sdk.clients[0].sessions[0].disconnect).toHaveBeenCalledOnce();
  });

  it('preserves raw events, metrics, turn callbacks, and the SDK timeout argument', async () => {
    const onRawEvent = vi.fn();
    const onTurnComplete = vi.fn(async () => {});
    const event = {
      id: 'event-id', timestamp: new Date().toISOString(), parentId: null,
      type: 'assistant.message', data: { messageId: 'message-id', content: 'Done' },
    };
    sdk.run = async session => { session.on.mock.calls[0][0](event); };
    const result = await executor.execute(stimulus, { ...options(), onRawEvent, onTurnComplete });
    expect(onRawEvent).toHaveBeenCalledWith(event);
    expect(onTurnComplete).toHaveBeenCalledExactlyOnceWith({ turn: 0, status: 'completed', final: true });
    expect(result.events).toEqual([expect.objectContaining({ type: 'assistant_message' })]);
    expect(result.metrics.wallTimeMs).toBeGreaterThanOrEqual(0);
    const timeout = sdk.clients[0].sessions[0].sendAndWait.mock.calls[0][1]!;
    expect(timeout).toBeGreaterThan(0);
    expect(timeout).toBeLessThanOrEqual(1000);
  });

  it('lets Vally own cleanup when shutdown occurs during execution', async () => {
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    let release!: () => void;
    const finish = new Promise<void>(resolve => { release = resolve; });
    sdk.run = async () => { entered(); await finish; };
    const execution = executor.execute(stimulus, options());
    await started;
    try {
      await executor.shutdown();
      expect(sdk.clients[0].stop).toHaveBeenCalledOnce();
      expect(existsSync(sdk.clients[0].options.env!.COPILOT_HOME!)).toBe(false);
    } finally {
      release();
      await execution;
    }
    expect(sdk.clients[0].stop).toHaveBeenCalledOnce();
  });
});
