import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  hasExternalPythonImports,
  loadPythonDependencies,
} from '../src/doctor/python-dependencies.js';
import { createTempDir, removeDir } from './helpers/fs.js';

const TEMP_DIRS: string[] = [];

function makeTmp(prefix: string): string {
  const dir = createTempDir(prefix);
  TEMP_DIRS.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of TEMP_DIRS) removeDir(dir);
});

describe('loadPythonDependencies', () => {
  it('normalizes extras, markers, hashes, and package names', () => {
    const dir = makeTmp('doctor-pydeps-normalize-');
    writeFileSync(join(dir, 'requirements.txt'), [
      'Azure_Functions[dev]==1.21.0 ; python_version >= "3.10" --hash=sha256:abc',
      'requests>=2.31',
    ].join('\n'));

    const manifest = loadPythonDependencies(dir);

    expect(manifest.dependencies).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'azure-functions',
        pinned: true,
        hashes: ['sha256:abc'],
      }),
      expect.objectContaining({ name: 'requests', pinned: false }),
    ]));
  });

  it('follows workspace-bound requirement and constraint includes once', () => {
    const dir = makeTmp('doctor-pydeps-include-');
    const requirementsDir = join(dir, 'requirements');
    mkdirSync(requirementsDir);
    writeFileSync(join(dir, 'requirements.txt'), [
      '-r requirements/base.txt',
      '-c requirements/constraints.txt',
    ].join('\n'));
    writeFileSync(join(requirementsDir, 'base.txt'), [
      'azure-functions==1.21.0',
      '-r ../requirements.txt',
    ].join('\n'));
    writeFileSync(join(requirementsDir, 'constraints.txt'), 'requests==2.32.0\n');

    const manifest = loadPythonDependencies(dir);

    expect(manifest.dependencies.map(dep => dep.name)).toEqual([
      'azure-functions',
      'requests',
    ]);
    expect(manifest.files).toHaveLength(3);
  });

  it('parses direct URLs and editable egg fragments', () => {
    const dir = makeTmp('doctor-pydeps-url-');
    writeFileSync(join(dir, 'requirements.txt'), [
      'custom-package @ https://example.invalid/custom.whl',
      '-e git+https://example.invalid/repo.git#egg=editable_package',
    ].join('\n'));

    const manifest = loadPythonDependencies(dir);

    expect(manifest.dependencies).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'custom-package', directUrl: true }),
      expect.objectContaining({ name: 'editable-package', directUrl: true }),
    ]));
  });

  it('reads PEP 621 and Poetry dependencies from pyproject.toml', () => {
    const dir = makeTmp('doctor-pydeps-pyproject-');
    writeFileSync(join(dir, 'pyproject.toml'), `
[project]
dependencies = [
  "azure-functions==1.21.0",
  "httpx>=0.27",
]

[tool.poetry.dependencies]
python = "^3.12"
orjson = "^3.10"
`);

    const manifest = loadPythonDependencies(dir);

    expect(manifest.kind).toBe('pyproject');
    expect(manifest.dependencies).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'azure-functions', pinned: true }),
      expect.objectContaining({ name: 'httpx', pinned: false }),
      expect.objectContaining({ name: 'orjson', pinned: false }),
    ]));
    expect(manifest.dependencies.some(dep => dep.name === 'python')).toBe(false);
  });

  it('ignores requirement includes that escape the workspace', () => {
    const dir = makeTmp('doctor-pydeps-escape-');
    writeFileSync(join(dir, 'requirements.txt'), '-r ../outside.txt\nazure-functions==1.21.0\n');

    const manifest = loadPythonDependencies(dir);

    expect(manifest.dependencies.map(dep => dep.name)).toEqual(['azure-functions']);
    expect(manifest.warnings).toContainEqual(expect.stringMatching(/outside the workspace/i));
  });
});

describe('hasExternalPythonImports', () => {
  it('distinguishes standard-library imports from external packages', () => {
    const standardOnly = makeTmp('doctor-pyimports-stdlib-');
    writeFileSync(join(standardOnly, 'function_app.py'), 'import json\nfrom pathlib import Path\n');
    const external = makeTmp('doctor-pyimports-external-');
    writeFileSync(join(external, 'function_app.py'), 'import azure.functions as func\nimport requests\n');

    expect(hasExternalPythonImports(standardOnly)).toBe(false);
    expect(hasExternalPythonImports(external)).toBe(true);
  });
});
