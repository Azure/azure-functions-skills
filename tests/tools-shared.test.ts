import { describe, expect, it } from 'vitest';
import { parseArgs, UsageError } from '../src/tools/shared/args.js';
import { buildInvocation, resolveExecutable } from '../src/tools/shared/exec.js';
import { EXIT, fail, succeed } from '../src/tools/shared/output.js';
import { parseDotenv } from '../src/tools/shared/dotenv.js';
import { redact } from '../src/tools/shared/redact.js';

describe('tool output contract', () => {
  it('reports success with exit code 0 and schema version 1', () => {
    const result = succeed('deploy plan', 'ready', { ready: true });
    expect(result.exitCode).toBe(EXIT.ok);
    expect(result.body).toMatchObject({
      schemaVersion: 1, command: 'deploy plan', ok: true, summary: 'ready', data: { ready: true }, findings: [], gaps: [],
    });
  });

  it('keeps findings and the chosen exit code on failure', () => {
    const result = fail('deploy apply', EXIT.stepFailed, 'provision failed', {
      findings: [{ id: 'DEPLOY-STEP-FAILED', severity: 'error', title: 'azd provision failed' }],
    });
    expect(result.exitCode).toBe(4);
    expect(result.body.ok).toBe(false);
    expect(result.body.findings).toHaveLength(1);
  });
});

describe('argument parsing', () => {
  const spec = { strings: ['dir', 'env'], lists: ['set'], booleans: ['preview'] };

  it('reads strings, repeated lists, and booleans', () => {
    expect(parseArgs(['--dir', 'app', '--set', 'A=1', '--set', 'B=2', '--preview'], spec)).toEqual({
      strings: { dir: 'app' }, lists: { set: ['A=1', 'B=2'] }, booleans: { preview: true },
    });
  });

  it.each([
    [['--unknown', 'x']],
    [['--dir']],
    [['positional']],
    [['--dir', 'a', '--dir', 'b']],
  ])('rejects %j as a usage error', argv => {
    expect(() => parseArgs(argv, spec)).toThrow(UsageError);
  });
});

describe('command invocation', () => {
  it('passes arguments as an array for native executables', () => {
    expect(buildInvocation('C:\\tools\\azd.exe', ['env', 'new', 'my env'], 'win32')).toEqual({
      file: 'C:\\tools\\azd.exe', args: ['env', 'new', 'my env'], verbatim: false,
    });
  });

  it('wraps Windows command scripts in cmd.exe with quoted arguments', () => {
    const invocation = buildInvocation('C:\\Program Files\\az\\az.cmd', ['account', 'show', '--name', 'my sub'], 'win32');
    expect(invocation.file).toBe('cmd.exe');
    expect(invocation.verbatim).toBe(true);
    expect(invocation.args).toEqual([
      '/d', '/s', '/c', '""C:\\Program Files\\az\\az.cmd" account show --name "my sub""',
    ]);
  });

  it.each(['a&b', 'a|b', '%PATH%', 'a"b', 'a^b', 'a>b', 'line\nbreak'])(
    'refuses %j as a command script argument', argument => {
      expect(() => buildInvocation('C:\\az.cmd', [argument], 'win32')).toThrow(/unsafe/i);
    },
  );

  it('does not wrap command scripts outside Windows', () => {
    expect(buildInvocation('/usr/bin/az', ['a&b'], 'linux')).toEqual({ file: '/usr/bin/az', args: ['a&b'], verbatim: false });
  });

  it('resolves Windows executables through PATHEXT', () => {
    const exists = (path: string) => path === 'C:\\bin\\az.cmd';
    expect(resolveExecutable('az', {
      platform: 'win32', path: 'C:\\other;C:\\bin', pathExt: '.EXE;.CMD', exists,
    })).toBe('C:\\bin\\az.cmd');
    expect(resolveExecutable('missing', { platform: 'win32', path: 'C:\\bin', pathExt: '.EXE;.CMD', exists })).toBeNull();
  });

  it('prefers a native executable over a command script in the same folder', () => {
    const exists = (path: string) => path.startsWith('C:\\bin\\func.');
    expect(resolveExecutable('func', { platform: 'win32', path: 'C:\\bin', pathExt: '.CMD;.EXE', exists }))
      .toBe('C:\\bin\\func.exe');
  });
});

describe('dotenv parsing', () => {
  it('reads quoted and bare values and ignores comments', () => {
    expect(parseDotenv('# note\nA="one two"\nB=three\n\nC="with \\"quote\\""\nbroken line\n')).toEqual({
      A: 'one two', B: 'three', C: 'with "quote"',
    });
  });
});

describe('redaction', () => {
  it.each([
    ['DefaultEndpointsProtocol=https;AccountName=x;AccountKey=abc123==;EndpointSuffix=core.windows.net', 'abc123'],
    ['https://app.azurewebsites.net/api/hello?code=s3cr3tKey&name=x', 's3cr3tKey'],
    ['https://st.blob.core.windows.net/c/b?sv=2022&sig=AbCdEf%3D', 'AbCdEf'],
    ['Authorization: Bearer eyJhbGciOi.payload.signature', 'eyJhbGciOi'],
    ['AZURE_CLIENT_SECRET="top-secret-value"', 'top-secret-value'],
    ['InstrumentationKey=00000000-1111-2222-3333-444444444444;IngestionEndpoint=https://x', '1111-2222'],
    ['"masterKey": "m4st3r"', 'm4st3r'],
  ])('removes the secret from %j', (text, secret) => {
    const output = redact(text);
    expect(output).not.toContain(secret);
    expect(output).toContain('***');
  });

  it('keeps ordinary output unchanged', () => {
    const text = 'Deploying service api (https://func-api-abc.azurewebsites.net/)';
    expect(redact(text)).toBe(text);
  });
});
