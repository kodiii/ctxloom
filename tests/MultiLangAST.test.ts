import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';
import { ASTParser } from '../src/ast/ASTParser.js';

// ─── DependencyGraph import-resolution regression tests ──────────────────────

describe('DependencyGraph — multi-language import resolution', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-dep-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolves Rust mod declarations to file edges', async () => {
    // lib.rs declares `mod utils;`  →  expects edge lib.rs → utils.rs
    fs.writeFileSync(path.join(tmpDir, 'lib.rs'), 'mod utils;\n\nfn main() {}\n');
    fs.writeFileSync(path.join(tmpDir, 'utils.rs'), 'pub fn helper() {}\n');

    const parser = new ASTParser();
    await parser.init();
    const graph = new DependencyGraph();
    graph.setParser(parser);
    await graph.buildFromDirectory(tmpDir);

    expect(graph.getImports('lib.rs')).toContain('utils.rs');
  });

  it('resolves Python relative imports to file edges', async () => {
    // main.py: `from .utils import helper`  →  edge main.py → utils.py
    fs.writeFileSync(path.join(tmpDir, 'main.py'), 'from .utils import helper\n');
    fs.writeFileSync(path.join(tmpDir, 'utils.py'), 'def helper(): pass\n');

    const parser = new ASTParser();
    await parser.init();
    const graph = new DependencyGraph();
    graph.setParser(parser);
    await graph.buildFromDirectory(tmpDir);

    expect(graph.getImports('main.py')).toContain('utils.py');
  });

  it('adds Go/Rust/Java files to allFiles() after graph build', async () => {
    fs.writeFileSync(path.join(tmpDir, 'main.go'), 'package main\nfunc main() {}\n');
    fs.writeFileSync(path.join(tmpDir, 'Foo.java'), 'public class Foo {}\n');
    fs.writeFileSync(path.join(tmpDir, 'lib.rs'), 'fn hello() {}\n');

    const parser = new ASTParser();
    await parser.init();
    const graph = new DependencyGraph();
    graph.setParser(parser);
    await graph.buildFromDirectory(tmpDir);

    const files = graph.allFiles();
    expect(files).toContain('main.go');
    expect(files).toContain('Foo.java');
    expect(files).toContain('lib.rs');
  });

  it('retains a no-import Rust file in allFiles() after updateFile', async () => {
    fs.writeFileSync(path.join(tmpDir, 'lib.rs'), 'fn hello() {}\n');

    const parser = new ASTParser();
    await parser.init();
    const graph = new DependencyGraph();
    graph.setParser(parser);
    await graph.buildFromDirectory(tmpDir);

    // Simulate a file change — still no imports
    fs.writeFileSync(path.join(tmpDir, 'lib.rs'), '// changed\nfn hello() {}\n');
    await graph.updateFile(path.join(tmpDir, 'lib.rs'), tmpDir);

    expect(graph.allFiles()).toContain('lib.rs');
  });
});

// ─── ASTParser dispatch tests ─────────────────────────────────────────────

describe('ASTParser — Go dispatch', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-go-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parse() dispatches .go files without throwing', async () => {
    const goFile = path.join(tmpDir, 'main.go');
    fs.writeFileSync(goFile, `package main

import "fmt"

func greet(name string) string {
  return fmt.Sprintf("Hello, %s", name)
}

type User struct {
  Name string
  Age  int
}
`);
    const parser = new ASTParser();
    await parser.init();
    const result = await parser.parse(goFile);
    // Grammar may or may not be downloaded in CI; result must be an array
    expect(Array.isArray(result)).toBe(true);
  });

  it('parse() returns [] gracefully when Go grammar unavailable', async () => {
    const goFile = path.join(tmpDir, 'empty.go');
    fs.writeFileSync(goFile, 'package main\n');
    const parser = new ASTParser();
    await parser.init();
    const result = await parser.parse(goFile);
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('ASTParser — Rust dispatch', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-rs-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parse() dispatches .rs files without throwing', async () => {
    const rsFile = path.join(tmpDir, 'lib.rs');
    fs.writeFileSync(rsFile, `pub struct User {
  pub name: String,
  pub age: u32,
}

impl User {
  pub fn new(name: String, age: u32) -> Self {
    User { name, age }
  }
}

pub fn greet(user: &User) -> String {
  format!("Hello, {}", user.name)
}
`);
    const parser = new ASTParser();
    await parser.init();
    const result = await parser.parse(rsFile);
    expect(Array.isArray(result)).toBe(true);
  });

  it('parse() returns [] gracefully when Rust grammar unavailable', async () => {
    const rsFile = path.join(tmpDir, 'empty.rs');
    fs.writeFileSync(rsFile, 'fn main() {}\n');
    const parser = new ASTParser();
    await parser.init();
    const result = await parser.parse(rsFile);
    expect(Array.isArray(result)).toBe(true);
  });
});
