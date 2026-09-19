import { describe, expect, it } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const scenario = resolve('evals', 'azure-functions-update', 'dotnet-isolated');
const reference = resolve('templates', 'skills', 'azure-functions-update', 'references', 'dotnet-isolated.md');
const read = (...parts: string[]) => readFileSync(join(scenario, ...parts), 'utf8');
const json = <T>(...parts: string[]) => JSON.parse(read(...parts)) as T;

interface Requirement {
  id: string;
  title: string;
  gates: string[];
  check: string | null;
  applicability?: string;
}
interface Checklist {
  skill: string;
  scenario: string;
  reference: string;
  statuses: string[];
  expectations: Record<string, unknown>;
  requirements: Requirement[];
}
interface Provenance {
  repository: string;
  pullRequest: number;
  commit: string;
  files: { path: string; blob: string }[];
  adapted: string[];
}

const checklist = json<Checklist>('fixtures', 'definition-of-done.json');
const provenance = json<Provenance>('upstream-provenance.json');
const script = read('fixtures', 'checks', 'Invoke-DefinitionOfDone.ps1');
const specification = read('eval.yaml');

function gitBlob(path: string): string {
  const content = Buffer.from(readFileSync(path, 'utf8').replaceAll('\r\n', '\n'));
  return createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
}

describe('azure-functions-update dotnet-isolated fixture provenance', () => {
  it('compares Git-normalized text when a Windows checkout uses CRLF', () => {
    const directory = mkdtempSync(join(tmpdir(), 'functions-update-lines-'));
    try {
      const lf = join(directory, 'lf.txt');
      const crlf = join(directory, 'crlf.txt');
      writeFileSync(lf, 'one\ntwo\n');
      writeFileSync(crlf, 'one\r\ntwo\r\n');
      expect(gitBlob(crlf)).toBe(gitBlob(lf));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps provenance for the original app and identifies its deliberate changes', () => {
    expect(provenance.repository).toBe('Azure/azure-functions-skills');
    expect(provenance.pullRequest).toBe(267);
    expect(provenance.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(provenance.files.map(file => file.path).sort()).toEqual([
      'fixtures/Hello.cs', 'fixtures/UpgradeApp.csproj', 'fixtures/host.json', 'fixtures/trial.gitignore',
    ]);
    for (const file of provenance.files) {
      expect(file.blob).toMatch(/^[0-9a-f]{40}$/);
      const actual = gitBlob(join(scenario, ...file.path.split('/')));
      if (provenance.adapted.includes(file.path)) {
        expect(actual).not.toBe(file.blob);
      } else {
        expect(actual).toBe(file.blob);
      }
    }
  });

  it('keeps the migrated-from baseline in the fixture, not a rewritten application', () => {
    expect(read('fixtures', 'UpgradeApp.csproj')).toContain('<TargetFramework>net8.0</TargetFramework>');
    expect(read('fixtures', 'Hello.cs')).toContain('[FunctionName("Hello")]');
  });

  it('keeps the grader baseline copy identical to the staged application fixture', () => {
    for (const file of ['UpgradeApp.csproj', 'Hello.cs', 'host.json',
      'Startup.cs', 'GreetingService.cs', 'QueueGreeting.cs']) {
      expect(gitBlob(join(scenario, 'fixtures', 'baseline', `${file}.txt`)))
        .toBe(gitBlob(join(scenario, 'fixtures', file)));
    }
  });

  it('requires a real in-process DI registration and constructor use', () => {
    expect(read('fixtures', 'Startup.cs')).toContain('[assembly: FunctionsStartup(typeof(Startup))]');
    expect(read('fixtures', 'Startup.cs')).toContain('builder.Services.AddSingleton<GreetingService>()');
    for (const file of ['Hello.cs', 'QueueGreeting.cs']) {
      expect(read('fixtures', file)).toContain('GreetingService greetings');
      expect(read('fixtures', file)).toContain('_greetings.Create(');
      expect(read('fixtures', file)).toContain('ILogger log');
      expect(read('fixtures', file)).toContain('log.LogInformation(');
    }
  });

  it('uses extension trigger, input and output bindings in one small flow', () => {
    const source = read('fixtures', 'QueueGreeting.cs');
    expect(source).toContain('[QueueTrigger("greeting-requests", Connection = "AzureWebJobsStorage")]');
    expect(source).toContain('[Blob("greeting-input/{queueTrigger}.txt", FileAccess.Read');
    expect(source).toContain('[Blob("greeting-output/{queueTrigger}.txt", FileAccess.Write');
    expect(source).toContain('out string output');
    expect(read('fixtures', 'UpgradeApp.csproj')).toContain('Microsoft.Azure.WebJobs.Extensions.Storage.Queues');
    expect(read('fixtures', 'UpgradeApp.csproj')).toContain('Microsoft.Azure.WebJobs.Extensions.Storage.Blobs');
  });
});

describe('definition-of-done checklist', () => {
  it('uses the stable scenario IDs published by the skill reference', () => {
    const published = [...readFileSync(reference, 'utf8').matchAll(/^\| (DI-(?:POST-)?\d+) \|/gm)]
      .map(match => match[1]);
    expect(published.length).toBeGreaterThan(0);
    expect(checklist.requirements.map(requirement => requirement.id)).toEqual(published);
    expect(checklist.reference).toBe('templates/skills/azure-functions-update/references/dotnet-isolated.md');
    expect(checklist.statuses).toEqual(['pass', 'fail', 'blocked', 'not-applicable']);
    const publicContract = json<{ requirements: Record<string, string> }>('fixtures', 'acceptance.json');
    expect(Object.keys(publicContract.requirements)).toEqual(published);
  });

  it('gives every requirement an owner and every deterministic requirement an implemented check', () => {
    for (const requirement of checklist.requirements) {
      expect(requirement.gates.length).toBeGreaterThan(0);
      expect(requirement.gates.every(gate => ['deterministic', 'judge'].includes(gate))).toBe(true);
      expect(requirement.title.length).toBeGreaterThan(0);
      if (requirement.gates.includes('deterministic')) {
        expect(requirement.check).toBeTruthy();
        expect(script).toContain(`'${requirement.check}'`);
      } else {
        expect(requirement.check).toBeNull();
        expect(requirement.applicability).toBeTruthy();
      }
    }
  });

  it('keeps the model phase on the current target framework and the language stage separate', () => {
    const post = checklist.requirements.filter(requirement => requirement.id.startsWith('DI-POST-'));
    expect(post).toHaveLength(3);
    expect(post.every(requirement => (requirement.applicability ?? '').length > 0)).toBe(true);
    expect(checklist.expectations.targetFramework).toBe('net8.0');
    expect(checklist.expectations.languageHandoff).toBe('not-requested');
  });
});

describe('deterministic grader script', () => {
  it('reports a status and evidence per requirement instead of a single opaque verdict', () => {
    for (const token of ['checklist.json', 'not-applicable', 'blocked', 'evidence', '$Requirement.id']) {
      expect(script).toContain(token);
    }
    for (const step of ['restore', 'build', 'publish']) {
      expect(script).toMatch(new RegExp(`Invoke-Recorded -Name '${step}' -File 'dotnet'`));
    }
    expect(script).toContain('start --no-build');
  });

  it('parses as PowerShell and declares the evidence contract explicitly', () => {
    expect(script).toMatch(/\[CmdletBinding\(\)\]/);
    expect(script).toContain('grading-evidence');
    expect(script).not.toContain('Invoke-Expression');
  });
});

describe('eval specification', () => {
  it('stages the reused fixture, the checklist and the baseline for grading', () => {
    for (const staged of ['fixtures/UpgradeApp.csproj', 'fixtures/Hello.cs', 'fixtures/host.json',
      'fixtures/trial.gitignore', 'fixtures/definition-of-done.json', 'fixtures/review-basis.md',
      'fixtures/checks/Invoke-DefinitionOfDone.ps1']) {
      expect(specification).toContain(staged);
    }
    expect(specification).toContain('grading-evidence/baseline/UpgradeApp.csproj.txt');
  });

  it('preanswers the interactive decisions and blocks new material decisions', () => {
    for (const answer of ['Scope:', 'Target:', 'Permissions:', 'Retention:', 'Dependencies:', 'Expected answers:']) {
      expect(specification).toContain(answer);
    }
    expect(specification).toMatch(/do not invent.*approval|record a blocked decision/i);
    expect(specification).toContain('dotnet-version-upgrade');
    expect(specification).toContain('dest: .migration/definition-of-done.json');
    expect(specification).toContain('If the skill is unavailable, perform the same task directly');
  });

  it('binds the judge to the deterministic evidence instead of transcript claims', () => {
    expect(specification).toContain('grading-evidence/checklist.json');
    expect(specification).toMatch(/cannot (turn|convert).*(fail|blocked|missing).*pass/i);
    expect(specification).toContain('review-basis.md');
  });

  it('keeps the model phase target framework unchanged in the stimulus contract', () => {
    expect(specification).toContain('net8.0');
    expect(specification).not.toContain('net10.0');
  });
});

describe('local benchmark registration', () => {
  const registry = JSON.parse(readFileSync(resolve('experiments', 'local-benchmark.json'), 'utf8'));
  const entry = registry.skills['azure-functions-update'];

  it('registers the scenario, its fixtures and the offline NuGet preflight', () => {
    expect(entry.evals).toEqual(['evals/azure-functions-update/dotnet-isolated/eval.yaml']);
    for (const file of ['templates/skills/azure-functions-update/SKILL.md',
      'templates/skills/azure-functions-update/references/dotnet-isolated.md',
      'evals/azure-functions-update/dotnet-isolated/fixtures/UpgradeApp.csproj',
      'evals/azure-functions-update/dotnet-isolated/fixtures/Hello.cs',
      'evals/azure-functions-update/dotnet-isolated/fixtures/host.json',
      'evals/azure-functions-update/dotnet-isolated/fixtures/trial.gitignore',
      'evals/azure-functions-update/dotnet-isolated/fixtures/definition-of-done.json',
      'evals/azure-functions-update/dotnet-isolated/fixtures/review-basis.md',
      'evals/azure-functions-update/dotnet-isolated/fixtures/baseline/UpgradeApp.csproj.txt',
      'evals/azure-functions-update/dotnet-isolated/fixtures/checks/Invoke-DefinitionOfDone.ps1']) {
      expect(entry.files).toContain(file);
    }
    expect(entry.nugetPreflight.targetFramework).toBe('net8.0');
    expect(entry.nugetPreflight.sdk).toMatch(/^Azure\.Functions\.Sdk\/\d+(\.\d+){1,3}$/);
    expect(Object.keys(entry.nugetPreflight.packages)).toContain('Microsoft.Azure.Functions.Worker');
  });

  const hasPowerShell = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major']).status === 0;

  describe.skipIf(!hasPowerShell)('Azurite contract helper', () => {
    const helper = join(scenario, 'fixtures', 'checks', 'AzuriteContract.ps1').replaceAll("'", "''");
    const invoke = (code: string) => spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command',
      `$ErrorActionPreference = 'Stop'; . '${helper}'; ${code}`], { encoding: 'utf8' });

    it('signs a loopback-only request with the documented public emulator key', () => {
      const result = invoke(`
        function Invoke-WebRequest {
          param($Uri, $Method, $Headers, $Body, $ContentType, $TimeoutSec,
            $MaximumRedirection, [switch]$NoProxy, [switch]$SkipHttpErrorCheck)
          @{ uri = $Uri; headers = $Headers; redirects = $MaximumRedirection; noProxy = [bool]$NoProxy }
        }
        Invoke-AzuriteRequest -Service blob -Method PUT -Resource 'greeting-input?restype=container' `
        + `-Date 'Fri, 18 Sep 2026 00:00:00 GMT' | ConvertTo-Json -Depth 5`);
      expect(result.status, result.stderr).toBe(0);
      const request = JSON.parse(result.stdout);
      expect(request.uri).toBe('http://127.0.0.1:10000/devstoreaccount1/greeting-input?restype=container');
      expect(request.redirects).toBe(0);
      expect(request.noProxy).toBe(true);
      const canonical = ['PUT', '', '', '', '', 'application/octet-stream', '', '', '', '', '', '',
        'x-ms-date:Fri, 18 Sep 2026 00:00:00 GMT\nx-ms-version:2021-12-02\n'
        + '/devstoreaccount1/devstoreaccount1/greeting-input\nrestype:container'].join('\n');
      const publicKey = 'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==';
      const signature = createHmac('sha256', Buffer.from(publicKey, 'base64')).update(canonical).digest('base64');
      expect(request.headers.Authorization).toBe(`SharedKey devstoreaccount1:${signature}`);
    });

    it('does not claim ownership of pre-existing queue data', () => {
      const result = invoke(`
        function Invoke-AzuriteRequest { @{ StatusCode = 409; Content = 'QueueAlreadyExists' } }
        $owned = [Collections.Generic.List[object]]::new()
        try { Initialize-StorageCase -Owned $owned -Contract ([pscustomobject]@{
          queue = 'greeting-requests'; inputContainer = 'greeting-input'; outputContainer = 'greeting-output'
        }); throw 'Expected a refusal' }
        catch [InvalidOperationException] { @{ count = $owned.Count; reason = $_.Exception.Message } | ConvertTo-Json }
      `);
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ count: 0, reason: expect.stringContaining('already exists') });
    });

    it('treats an absent output blob as pending and a wrong output as a failed contract', () => {
      const result = invoke(`
        function Invoke-AzuriteRequest { @{ StatusCode = 404; Content = '' } }
        $absent = Read-StorageOutput -Contract ([pscustomobject]@{ outputContainer = 'greeting-output'; output = 'Hello, Storage!' }) -RequestId abc
        function Invoke-AzuriteRequest { @{ StatusCode = 200; Content = 'wrong' } }
        $wrong = Read-StorageOutput -Contract ([pscustomobject]@{ outputContainer = 'greeting-output'; output = 'Hello, Storage!' }) -RequestId abc
        @{ absent = $absent; wrong = $wrong } | ConvertTo-Json -Depth 5
      `);
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        absent: { ready: false, matches: false },
        wrong: { ready: true, matches: false, body: 'wrong' },
      });
    });

    it('emits every ID and blocks unexecuted bindings when the app is missing', () => {
      const directory = mkdtempSync(join(tmpdir(), 'functions-update-grader-'));
      try {
        const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File',
          join(scenario, 'fixtures', 'checks', 'Invoke-DefinitionOfDone.ps1'),
          '-Checklist', join(scenario, 'fixtures', 'definition-of-done.json'),
          '-BaselineRoot', join(scenario, 'fixtures', 'baseline'),
          '-EvidenceRoot', join(directory, 'grading-evidence')],
        { cwd: directory, encoding: 'utf8', timeout: 30_000 });
        expect(result.status).toBe(1);
        const report = JSON.parse(readFileSync(join(directory, 'grading-evidence', 'checklist.json'), 'utf8'));
        expect(report.overall).toBe('fail');
        expect(report.requirements).toHaveLength(19);
        expect(report.requirements).toContainEqual(expect.objectContaining({ id: 'DI-16', status: 'blocked' }));
        expect(report.requirements).toContainEqual(expect.objectContaining({ id: 'DI-POST-01', status: 'not-applicable' }));
        expect(report.requirements.every((item: { evidence: unknown }) => Array.isArray(item.evidence))).toBe(true);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
  });
});
