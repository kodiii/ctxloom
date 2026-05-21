import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { GoModuleResolver } from '../src/utils/GoModuleResolver.js';

// ─── helpers ──────────────────────────────────────────────────────────────

function makeGoProject(tmpDir: string, modulePath: string, files: Record<string, string>): void {
  // Write go.mod
  fs.writeFileSync(path.join(tmpDir, 'go.mod'), `module ${modulePath}\n\ngo 1.21\n`);
  // Write source files
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(tmpDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

// ─── GoModuleResolver ─────────────────────────────────────────────────────

describe('GoModuleResolver', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-go-mod-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds and parses go.mod from a file deep in the project', () => {
    makeGoProject(tmpDir, 'github.com/myorg/myapp', {
      'internal/auth/user.go': 'package auth\n',
    });
    const resolver = new GoModuleResolver(tmpDir);
    expect(resolver.getModulePath()).toBe('github.com/myorg/myapp');
  });

  it('resolves a module-path import to a relative file path', () => {
    makeGoProject(tmpDir, 'github.com/myorg/myapp', {
      'internal/auth/user.go': 'package auth\n',
      'internal/auth/helper.go': 'package auth\n',
    });
    const resolver = new GoModuleResolver(tmpDir);
    // Import "github.com/myorg/myapp/internal/auth" → internal/auth/<first .go file>
    const result = resolver.resolve('github.com/myorg/myapp/internal/auth');
    expect(result).not.toBeNull();
    expect(result).toMatch(/^internal\/auth\//);
    expect(result).toMatch(/\.go$/);
  });

  it('returns null for third-party module imports (not in this repo)', () => {
    makeGoProject(tmpDir, 'github.com/myorg/myapp', {
      'main.go': 'package main\n',
    });
    const resolver = new GoModuleResolver(tmpDir);
    const result = resolver.resolve('github.com/some/external/pkg');
    expect(result).toBeNull();
  });

  it('resolves a relative import (./subpkg) to the first .go file', () => {
    makeGoProject(tmpDir, 'github.com/myorg/myapp', {
      'cmd/server/main.go': 'package main\n',
      'cmd/server/config/config.go': 'package config\n',
    });
    const resolver = new GoModuleResolver(tmpDir);
    // Resolve relative import from cmd/server/main.go
    const result = resolver.resolveRelative(
      path.join(tmpDir, 'cmd/server/main.go'),
      './config',
    );
    expect(result).not.toBeNull();
    expect(result).toMatch(/cmd\/server\/config\/config\.go/);
  });

  it('returns null when go.mod does not exist', () => {
    // No go.mod in tmpDir
    const resolver = new GoModuleResolver(tmpDir);
    expect(resolver.getModulePath()).toBeNull();
    expect(resolver.resolve('github.com/anything')).toBeNull();
  });

  it('resolves a package import where directory has multiple .go files — returns first', () => {
    makeGoProject(tmpDir, 'example.com/app', {
      'pkg/store/store.go': 'package store\n',
      'pkg/store/store_test.go': 'package store\n',
    });
    const resolver = new GoModuleResolver(tmpDir);
    const result = resolver.resolve('example.com/app/pkg/store');
    expect(result).not.toBeNull();
    // Should pick a non-test file if possible
    expect(result).toMatch(/pkg\/store\//);
  });

  // ── resolveAll: the v1.7.0 fix for gin's graphReachability=0.32 ─────────
  // A Go import targets a PACKAGE (every .go file in a directory), not a
  // single file. resolveAll() returns the full set so the dep graph can
  // emit one edge per package member — pre-fix only the alphabetically-
  // first file was reachable, causing sibling-touching PRs to look
  // structurally disconnected.

  it('resolveAll returns every non-test .go file in the package', () => {
    makeGoProject(tmpDir, 'github.com/myorg/myapp', {
      'binding/binding.go': 'package binding\n',
      'binding/plain.go': 'package binding\n',
      'binding/json.go': 'package binding\n',
      'binding/binding_test.go': 'package binding\n',
    });
    const resolver = new GoModuleResolver(tmpDir);
    const result = resolver.resolveAll('github.com/myorg/myapp/binding');
    expect(result).toHaveLength(3); // 3 non-test files (test file excluded)
    expect(result).toEqual(
      expect.arrayContaining([
        'binding/binding.go',
        'binding/plain.go',
        'binding/json.go',
      ]),
    );
    // _test.go files are excluded — they're not part of the public package
    // interface, and DependencyGraph links them separately via the
    // intra-package test↔source pass.
    expect(result).not.toContain('binding/binding_test.go');
  });

  it('resolveAll returns [] for third-party imports', () => {
    makeGoProject(tmpDir, 'example.com/app', {
      'main.go': 'package main\n',
    });
    const resolver = new GoModuleResolver(tmpDir);
    expect(resolver.resolveAll('github.com/some/external/pkg')).toEqual([]);
  });

  it('resolveAll returns [] for relative imports (use resolveRelativeAll)', () => {
    makeGoProject(tmpDir, 'example.com/app', {
      'main.go': 'package main\n',
    });
    const resolver = new GoModuleResolver(tmpDir);
    expect(resolver.resolveAll('./sibling')).toEqual([]);
  });

  it('resolveAll returns [] when the target directory does not exist', () => {
    makeGoProject(tmpDir, 'example.com/app', {
      'main.go': 'package main\n',
    });
    const resolver = new GoModuleResolver(tmpDir);
    expect(resolver.resolveAll('example.com/app/missing/pkg')).toEqual([]);
  });

  it('resolveRelativeAll returns every non-test .go file in the sibling package', () => {
    makeGoProject(tmpDir, 'example.com/app', {
      'cmd/server/main.go': 'package main\n',
      'cmd/server/config/config.go': 'package config\n',
      'cmd/server/config/loader.go': 'package config\n',
      'cmd/server/config/config_test.go': 'package config\n',
    });
    const resolver = new GoModuleResolver(tmpDir);
    const result = resolver.resolveRelativeAll(
      path.join(tmpDir, 'cmd/server/main.go'),
      './config',
    );
    expect(result).toHaveLength(2);
    expect(result).toEqual(
      expect.arrayContaining([
        'cmd/server/config/config.go',
        'cmd/server/config/loader.go',
      ]),
    );
  });

  it('resolve (single-file API) still returns the first file from resolveAll', () => {
    makeGoProject(tmpDir, 'example.com/app', {
      'pkg/store/a_store.go': 'package store\n',
      'pkg/store/b_helper.go': 'package store\n',
    });
    const resolver = new GoModuleResolver(tmpDir);
    const all = resolver.resolveAll('example.com/app/pkg/store');
    const single = resolver.resolve('example.com/app/pkg/store');
    expect(single).toBe(all[0]);
  });
});
