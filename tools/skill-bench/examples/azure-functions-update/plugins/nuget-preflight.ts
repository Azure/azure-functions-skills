// Example preflight plugin for .NET scenarios. It is not part of the skill-bench core.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { PreflightCellContext, PreflightPlugin, PreflightRunContext } from '../../../src/plugins.ts';

const publicSource = 'https://api.nuget.org/v3/index.json';

export interface NugetOptions {
  targetFramework: string;
  sdk: string;
  packages: Record<string, string>;
  source?: string;
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`nuget-preflight: ${message}`);
}

export function parseOptions(value: unknown): NugetOptions {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'options must be an object.');
  const { targetFramework, sdk, packages, source, ...rest } = value as Record<string, unknown>;
  check(Object.keys(rest).length === 0, `unknown option ${Object.keys(rest)[0]}.`);
  check(typeof targetFramework === 'string' && /^net(\d+\.\d+|standard\d\.\d|framework\d{3})$/.test(targetFramework),
    'targetFramework must be a target framework moniker, such as net8.0.');
  check(typeof sdk === 'string' && /^[A-Za-z0-9][A-Za-z0-9.]*\/\d+(\.\d+){1,3}(-[A-Za-z0-9.]+)?$/.test(sdk),
    'sdk must be a versioned MSBuild project SDK, such as Azure.Functions.Sdk/1.0.0.');
  const declared = packages !== null && typeof packages === 'object' && !Array.isArray(packages)
    ? Object.entries(packages as Record<string, unknown>) : [];
  check(declared.length > 0 && declared.every(([id, version]) => /^[A-Za-z0-9][A-Za-z0-9.]*$/.test(id)
    && typeof version === 'string' && /^\d+(\.\d+){1,3}(-[A-Za-z0-9.]+)?$/.test(version)),
  'packages must map package identifiers to explicit versions.');
  check(source === undefined || typeof source === 'string', 'source must be a string.');
  return { targetFramework, sdk, packages: Object.fromEntries(declared) as Record<string, string>, source };
}

/** The operator can replace the feed with SKILL_BENCH_NUGET_SOURCE, for example for an approved mirror. */
export function sourceUrl(options: NugetOptions, env: NodeJS.ProcessEnv = process.env): URL {
  const value = env.SKILL_BENCH_NUGET_SOURCE ?? options.source ?? publicSource;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('nuget-preflight: the NuGet source must be a valid URL.');
  }
  check(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash,
    'the NuGet source must be an HTTPS URL without credentials, query or fragment.');
  return url;
}

const attribute = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** NuGet.Config with only one feed and a package folder inside the cell. */
export function nugetConfig(source: URL, packagesFolder: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <clear />
    <add key="benchmark" value="${attribute(source.href)}" protocolVersion="3" />
  </packageSources>
  <config>
    <add key="globalPackagesFolder" value="${attribute(packagesFolder)}" />
  </config>
</configuration>
`;
}

export const preflight: PreflightPlugin = {
  name: 'nuget-preflight',
  validate(options) {
    sourceUrl(parseOptions(options));
  },
  prepareCell(context: PreflightCellContext) {
    const content = nugetConfig(sourceUrl(parseOptions(context.options)), join(context.cellRoot, 'cache', 'nuget'));
    for (const path of [join(context.appData, 'NuGet', 'NuGet.Config'), join(context.home, '.nuget', 'NuGet', 'NuGet.Config')]) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
  },
  run(context: PreflightRunContext) {
    const options = parseOptions(context.options);
    const source = sourceUrl(options);
    const references = Object.entries(options.packages)
      .map(([id, version]) => `    <PackageReference Include="${id}" Version="${version}" />`).join('\n');
    const project = join(context.workDir, 'nuget-preflight.csproj');
    writeFileSync(project, `<Project Sdk="${options.sdk}">
  <PropertyGroup>
    <TargetFramework>${options.targetFramework}</TargetFramework>
  </PropertyGroup>
  <ItemGroup>
${references}
  </ItemGroup>
</Project>
`);
    const child = spawnSync('dotnet', ['restore', project, '--nologo', '--verbosity', 'minimal'], {
      cwd: context.workDir, env: context.env, shell: false, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    check(!child.error, `cannot start dotnet for ${source.href}; install the .NET SDK or check PATH.`);
    check(child.signal === null, `dotnet restore stopped with ${child.signal}.`);
    const output = [child.stdout, child.stderr].filter(value => typeof value === 'string' && value.trim())
      .join('\n').trim().slice(-4000);
    check(child.status === 0, `cannot restore ${options.sdk} and ${Object.keys(options.packages).join(', ')} `
      + `for ${options.targetFramework} from ${source.href}. Set SKILL_BENCH_NUGET_SOURCE to a credential-free `
      + `HTTPS v3 feed that contains these packages.${output ? `\n${output}` : ''}`);
  },
};
