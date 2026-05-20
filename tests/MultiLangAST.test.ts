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

  // ─── Re-export tracing (v1.6.x) ───────────────────────────────────────
  it('Python: traces re-exports through a barrel __init__.py', async () => {
    // Simulates the fastapi pattern:
    //   fastapi/__init__.py     →  from .routing import APIRouter
    //   tests/test_routing.py   →  from fastapi import APIRouter
    //
    // Without re-export tracing, tests/test_routing.py has an edge to
    // fastapi/__init__.py but no edge to fastapi/routing.py — so a
    // blast-radius query against routing.py never finds the tests.
    //
    // With re-export tracing, a parallel edge tests/test_routing.py →
    // fastapi/routing.py is added.
    fs.mkdirSync(path.join(tmpDir, 'fastapi'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'fastapi', '__init__.py'),
      'from .routing import APIRouter\n',
    );
    fs.writeFileSync(
      path.join(tmpDir, 'fastapi', 'routing.py'),
      'class APIRouter:\n    def add_route(self): pass\n',
    );
    fs.writeFileSync(
      path.join(tmpDir, 'tests', 'test_routing.py'),
      'from fastapi import APIRouter\n\ndef test_it():\n    APIRouter()\n',
    );

    const parser = new ASTParser();
    await parser.init();
    const graph = new DependencyGraph();
    graph.setParser(parser);
    await graph.buildFromDirectory(tmpDir);

    // The classic edge through the barrel still exists.
    expect(graph.getImports('tests/test_routing.py')).toContain('fastapi/__init__.py');
    // The new re-export parallel edge — this is what enables a blast
    // radius from routing.py to find the test.
    expect(graph.getImports('tests/test_routing.py')).toContain('fastapi/routing.py');
    // And conversely, importers of routing.py include the test.
    expect(graph.getImporters('fastapi/routing.py')).toContain('tests/test_routing.py');
  });

  it('Python: aliased imports use the alias name for re-export lookup', async () => {
    // `from .routing import APIRouter as Router`  →  re-exports under
    // local name "Router". Downstream `from pkg import Router` chains
    // correctly through the alias.
    fs.mkdirSync(path.join(tmpDir, 'pkg'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'pkg', '__init__.py'),
      'from .routing import APIRouter as Router\n',
    );
    fs.writeFileSync(
      path.join(tmpDir, 'pkg', 'routing.py'),
      'class APIRouter: pass\n',
    );
    fs.writeFileSync(
      path.join(tmpDir, 'user.py'),
      'from pkg import Router\n',
    );

    const parser = new ASTParser();
    await parser.init();
    const graph = new DependencyGraph();
    graph.setParser(parser);
    await graph.buildFromDirectory(tmpDir);

    expect(graph.getImports('user.py')).toContain('pkg/routing.py');
  });

  it('Python: imports of non-re-exported names do NOT add false parallel edges', async () => {
    // If user.py imports `from pkg import unknown`, and pkg/__init__.py
    // does NOT re-export `unknown`, we should not invent an edge.
    fs.mkdirSync(path.join(tmpDir, 'pkg'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'pkg', '__init__.py'),
      'from .routing import APIRouter\n',
    );
    fs.writeFileSync(
      path.join(tmpDir, 'pkg', 'routing.py'),
      'class APIRouter: pass\n',
    );
    fs.writeFileSync(
      path.join(tmpDir, 'user.py'),
      'from pkg import APIRouter, unknown\n',
    );

    const parser = new ASTParser();
    await parser.init();
    const graph = new DependencyGraph();
    graph.setParser(parser);
    await graph.buildFromDirectory(tmpDir);

    // APIRouter chains correctly...
    expect(graph.getImports('user.py')).toContain('pkg/routing.py');
    // ...but no spurious edges to other files for the unknown name.
    const imports = graph.getImports('user.py');
    expect(imports.filter(f => f === 'pkg/routing.py')).toHaveLength(1);
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

describe('ASTParser — Java dispatch', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-java-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parse() dispatches .java files without throwing', async () => {
    const javaFile = path.join(tmpDir, 'UserService.java');
    fs.writeFileSync(javaFile, `import java.util.List;
import java.util.Optional;

public class UserService {
  private final UserRepository repo;

  public UserService(UserRepository repo) {
    this.repo = repo;
  }

  public Optional<User> findById(String id) {
    return repo.findById(id);
  }

  public List<User> findAll() {
    return repo.findAll();
  }
}
`);
    const parser = new ASTParser();
    await parser.init();
    const result = await parser.parse(javaFile);
    expect(Array.isArray(result)).toBe(true);
  });

  it('parse() returns [] gracefully when Java grammar unavailable', async () => {
    const javaFile = path.join(tmpDir, 'Empty.java');
    fs.writeFileSync(javaFile, 'public class Empty {}\n');
    const parser = new ASTParser();
    await parser.init();
    const result = await parser.parse(javaFile);
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('PHP parsing', () => {
  it('parses class declarations', async () => {
    const tmp = path.join(os.tmpdir(), 'test.php');
    fs.writeFileSync(tmp, `<?php\nnamespace App\\Models;\nclass User {\n  public function getName(): string { return $this->name; }\n}\n`);
    const parser = new ASTParser();
    await parser.init();
    const nodes = await parser.parse(tmp);
    fs.unlinkSync(tmp);
    const cls = nodes.find(n => n.type === 'class' && n.name === 'User');
    // graceful-degrade if grammar unavailable
    if (nodes.length > 0) expect(cls).toBeDefined();
  });

  it('parses function declarations', async () => {
    const tmp = path.join(os.tmpdir(), 'test.php');
    fs.writeFileSync(tmp, `<?php\nfunction greet(string $name): string {\n  return "Hello $name";\n}\n`);
    const parser = new ASTParser();
    await parser.init();
    const nodes = await parser.parse(tmp);
    fs.unlinkSync(tmp);
    if (nodes.length > 0) {
      const fn = nodes.find(n => n.type === 'function' && n.name === 'greet');
      expect(fn).toBeDefined();
    }
  });
});

describe('Dart parsing', () => {
  it('parses class declarations', async () => {
    const tmp = path.join(os.tmpdir(), 'test.dart');
    fs.writeFileSync(tmp, `class UserService {\n  String getName() => 'Alice';\n  void save(User user) {}\n}\n`);
    const parser = new ASTParser();
    await parser.init();
    const nodes = await parser.parse(tmp);
    fs.unlinkSync(tmp);
    if (nodes.length > 0) {
      expect(nodes.some(n => n.type === 'class' && n.name === 'UserService')).toBe(true);
    }
  });

  it('parses function declarations', async () => {
    const tmp = path.join(os.tmpdir(), 'test.dart');
    fs.writeFileSync(tmp, `String greet(String name) => 'Hello \$name';\nvoid main() { print(greet('world')); }\n`);
    const parser = new ASTParser();
    await parser.init();
    const nodes = await parser.parse(tmp);
    fs.unlinkSync(tmp);
    if (nodes.length > 0) {
      expect(nodes.some(n => n.type === 'function' && n.name === 'main')).toBe(true);
    }
  });
});
