import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DependencyGraph } from '@ctxloom/core';
import { auditImportEdges } from '../scripts/bench/graph-correctness.js';

function graphStub(
  files: string[],
  imports: Record<string, string[]>,
): DependencyGraph {
  return {
    allFiles: () => files,
    getImports: (file: string) => imports[file] ?? [],
  } as unknown as DependencyGraph;
}

describe('auditImportEdges', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-bench-graph-')));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('does not let unrelated graph edges hide a missing exact import edge', async () => {
    fs.writeFileSync(path.join(tempDir, 'source.js'), "const dep = require('./dep');\n");
    fs.writeFileSync(path.join(tempDir, 'dep.js'), 'module.exports = 1;\n');
    fs.writeFileSync(path.join(tempDir, 'noise.js'), 'module.exports = 2;\n');

    const report = await auditImportEdges(
      tempDir,
      graphStub(
        ['source.js', 'dep.js', 'noise.js'],
        { 'source.js': ['noise.js'] },
      ),
    );

    expect(report).toMatchObject({
      expectedEdges: 1,
      matchedEdges: 0,
      coverage: 0,
      notApplicable: false,
    });
    expect(report.sampleMissed).toEqual([{ source: 'source.js', target: 'dep.js' }]);
  });

  it('counts an exact match once even when the graph has extra edges', async () => {
    fs.writeFileSync(path.join(tempDir, 'source.js'), "import './dep.js';\n");
    fs.writeFileSync(path.join(tempDir, 'dep.js'), 'export const dep = 1;\n');
    fs.writeFileSync(path.join(tempDir, 'noise.js'), 'export const noise = 2;\n');

    const report = await auditImportEdges(
      tempDir,
      graphStub(
        ['source.js', 'dep.js', 'noise.js'],
        { 'source.js': ['dep.js', 'noise.js'] },
      ),
    );

    expect(report).toMatchObject({
      expectedEdges: 1,
      matchedEdges: 1,
      coverage: 1,
      notApplicable: false,
    });
  });

  it('audits every production file targeted by a local Go package import', async () => {
    fs.mkdirSync(path.join(tempDir, 'pkg'));
    fs.writeFileSync(path.join(tempDir, 'go.mod'), 'module example.com/audit\n');
    fs.writeFileSync(
      path.join(tempDir, 'main.go'),
      'package main\nimport "example.com/audit/pkg"\nfunc main() {}\n',
    );
    fs.writeFileSync(path.join(tempDir, 'pkg', 'a.go'), 'package pkg\n');
    fs.writeFileSync(path.join(tempDir, 'pkg', 'b.go'), 'package pkg\n');
    fs.writeFileSync(path.join(tempDir, 'pkg', 'a_test.go'), 'package pkg\n');

    const report = await auditImportEdges(
      tempDir,
      graphStub(
        ['main.go', 'pkg/a.go', 'pkg/b.go'],
        { 'main.go': ['pkg/a.go'] },
      ),
    );

    expect(report).toMatchObject({
      expectedEdges: 2,
      matchedEdges: 1,
      coverage: 0.5,
      notApplicable: false,
    });
    expect(report.sampleMissed).toContainEqual({ source: 'main.go', target: 'pkg/b.go' });
  });

  it('reports n/a when the corpus has no independently resolvable local imports', async () => {
    fs.writeFileSync(path.join(tempDir, 'source.js'), "import express from 'express';\n");

    const report = await auditImportEdges(
      tempDir,
      graphStub(['source.js'], {}),
    );

    expect(report).toMatchObject({
      expectedEdges: 0,
      matchedEdges: 0,
      coverage: null,
      notApplicable: true,
    });
  });
});
