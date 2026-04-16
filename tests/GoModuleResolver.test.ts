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
});
