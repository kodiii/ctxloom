/**
 * Tests for ASTParser and Skeletonizer — Code parsing and skeletonization.
 *
 * These tests use the test fixtures in tests/fixtures/.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ASTParser } from '../src/ast/ASTParser.js';
import { Skeletonizer } from '../src/ast/Skeletonizer.js';
import path from 'node:path';
import fs, { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os, { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const SAMPLE_TS = path.join(FIXTURES_DIR, 'sample.ts');

describe('ASTParser', () => {
  let parser: ASTParser;

  beforeAll(async () => {
    parser = new ASTParser();
    await parser.init();
  });

  describe('parse()', () => {
    it('should parse the sample TypeScript file', async () => {
      const nodes = await parser.parse(SAMPLE_TS);
      expect(nodes.length).toBeGreaterThan(0);
    });

    it('should detect import declarations', async () => {
      const nodes = await parser.parse(SAMPLE_TS);
      const imports = nodes.filter(n => n.type === 'import');
      expect(imports.length).toBeGreaterThanOrEqual(2); // fs, path, Config
    });

    /**
     * Regression coverage for the v1.6.0 bench-spike finding: pure
     * CommonJS projects (express and most pre-2020 Node libs) used
     * to produce a dependency graph with zero edges because the
     * JS walker only handled ES6 `import_statement` nodes — never
     * `require('./path')` call expressions. Now mirrors Ruby's
     * special-case treatment of require/require_relative/load.
     */
    describe('CommonJS require() imports', () => {
      let tmpDir: string;

      beforeAll(() => {
        tmpDir = mkdtempSync(path.join(tmpdir(), 'ctxloom-cjs-test-'));
      });

      afterAll(() => {
        rmSync(tmpDir, { recursive: true, force: true });
      });

      it('emits an import node for `require(\'./relative\')`', async () => {
        const file = path.join(tmpDir, 'simple-require.js');
        writeFileSync(
          file,
          [
            "var express = require('./lib/express');",
            "module.exports = express;",
          ].join('\n'),
        );

        const nodes = await parser.parse(file);
        const imports = nodes.filter(n => n.type === 'import');
        expect(imports.length).toBe(1);
        expect(imports[0].source).toBe('./lib/express');
      });

      it('emits import nodes for multiple require() calls in one file', async () => {
        const file = path.join(tmpDir, 'multi-require.js');
        writeFileSync(
          file,
          [
            "const a = require('./a');",
            "const b = require('../b');",
            "const c = require('./nested/c.js');",
            "module.exports = { a, b, c };",
          ].join('\n'),
        );

        const nodes = await parser.parse(file);
        const imports = nodes.filter(n => n.type === 'import');
        const specs = imports.map(i => i.source).sort();
        expect(specs).toEqual(['../b', './a', './nested/c.js']);
      });

      it('emits import nodes for destructured require()', async () => {
        const file = path.join(tmpDir, 'destructure-require.js');
        writeFileSync(
          file,
          [
            "const { Router } = require('./router');",
            "const { Map, Set } = require('./collections');",
          ].join('\n'),
        );

        const nodes = await parser.parse(file);
        const imports = nodes.filter(n => n.type === 'import');
        const specs = imports.map(i => i.source).sort();
        expect(specs).toEqual(['./collections', './router']);
      });

      it('skips dynamic require() with a variable argument (not resolvable)', async () => {
        const file = path.join(tmpDir, 'dynamic-require.js');
        writeFileSync(
          file,
          [
            "const name = './foo';",
            "const mod = require(name);", // dynamic — must be skipped
            "const lit = require('./real');", // static — must emit
          ].join('\n'),
        );

        const nodes = await parser.parse(file);
        const imports = nodes.filter(n => n.type === 'import');
        expect(imports.map(i => i.source)).toEqual(['./real']);
      });

      it('coexists with ES6 import_statement in the same TS file', async () => {
        const file = path.join(tmpDir, 'mixed-imports.ts');
        writeFileSync(
          file,
          [
            "import fs from 'node:fs';",
            "const legacyLib = require('./legacy');",
            "export const x = 1;",
          ].join('\n'),
        );

        const nodes = await parser.parse(file);
        const imports = nodes.filter(n => n.type === 'import');
        const specs = imports.map(i => i.source).sort();
        expect(specs).toEqual(['./legacy', 'node:fs']);
      });
    });

    it('should detect function declarations', async () => {
      const nodes = await parser.parse(SAMPLE_TS);
      const functions = nodes.filter(n => n.type === 'function');
      expect(functions.length).toBeGreaterThanOrEqual(1);
      const formatUser = functions.find(f => f.name === 'formatUser');
      expect(formatUser).toBeDefined();
      expect(formatUser!.signature).toContain('formatUser');
    });

    it('should detect class declarations', async () => {
      const nodes = await parser.parse(SAMPLE_TS);
      const classes = nodes.filter(n => n.type === 'class');
      expect(classes.length).toBeGreaterThanOrEqual(1);
      const userService = classes.find(c => c.name === 'UserService');
      expect(userService).toBeDefined();
      expect(userService!.methods).toBeDefined();
      expect(userService!.methods!.length).toBeGreaterThanOrEqual(2);
    });

    it('should detect interface declarations', async () => {
      const nodes = await parser.parse(SAMPLE_TS);
      const interfaces = nodes.filter(n => n.type === 'interface');
      expect(interfaces.length).toBeGreaterThanOrEqual(1);
      const user = interfaces.find(i => i.name === 'User');
      expect(user).toBeDefined();
    });

    it('should detect export default', async () => {
      const nodes = await parser.parse(SAMPLE_TS);
      const exportDefaults = nodes.filter(n => n.type === 'export_default');
      expect(exportDefaults.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect arrow functions', async () => {
      const nodes = await parser.parse(SAMPLE_TS);
      const arrows = nodes.filter(n => n.type === 'arrow_function');
      expect(arrows.length).toBeGreaterThanOrEqual(1);
      const helper = arrows.find(a => a.name === 'helper');
      expect(helper).toBeDefined();
    });

    it('should include line numbers', async () => {
      const nodes = await parser.parse(SAMPLE_TS);
      for (const node of nodes) {
        expect(node.startLine).toBeGreaterThan(0);
        expect(node.endLine).toBeGreaterThanOrEqual(node.startLine);
      }
    });

    // ─── Prototype-assignment symbol extraction (v1.6.0) ──────────────
    // CommonJS libraries (express, most pre-2020 Node code) attach their
    // public API via `res.send = function send(...)` patterns. Before this
    // case landed in the AST walker, those names were entirely missing
    // from the symbol index → ctxloom's blast-radius prediction couldn't
    // attribute callers of `send()` to lib/response.js. Documented at
    // length in ASTParser.ts case 'assignment_expression'.
    describe('prototype/object method assignments (CommonJS API surface)', () => {
      const tmpDir = path.join(os.tmpdir(), 'ctxloom-ast-assign-tests');
      const SAMPLE_PROTOTYPE_JS = path.join(tmpDir, 'sample-prototype.js');

      beforeAll(() => {
        fs.mkdirSync(tmpDir, { recursive: true });
        fs.writeFileSync(
          SAMPLE_PROTOTYPE_JS,
          [
            "var res = exports = module.exports = {};",
            "",
            "res.send = function send(body) { return body; };",
            "res.json = function (obj) { return JSON.stringify(obj); };",
            "res.redirect = function redirect(url) { return url; };",
            "// chained assignment — both names should be credited",
            "res.contentType =",
            "res.type = function contentType(type) { return type; };",
            "// pure arrow function form",
            "res.cookie = (name, value) => ({ name, value });",
            "",
            "// patterns that should NOT be picked up as methods",
            "res.MAX_AGE = 3600;                       // not a function",
            "res.copy = res.send;                      // alias to another value",
          ].join('\n'),
          'utf-8',
        );
      });

      afterAll(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      });

      it('extracts function-valued prototype assignments as method symbols', async () => {
        const nodes = await parser.parse(SAMPLE_PROTOTYPE_JS);
        const methods = nodes.filter(n => n.type === 'method').map(n => n.name);

        expect(methods).toContain('send');
        expect(methods).toContain('json');
        expect(methods).toContain('redirect');
        expect(methods).toContain('cookie');
      });

      it('credits both names in chained assignments (`a = b = function(){}`)', async () => {
        const nodes = await parser.parse(SAMPLE_PROTOTYPE_JS);
        const methods = nodes.filter(n => n.type === 'method').map(n => n.name);

        expect(methods).toContain('contentType');
        expect(methods).toContain('type');
      });

      it('does not pick up non-function assignments as methods', async () => {
        const nodes = await parser.parse(SAMPLE_PROTOTYPE_JS);
        const methods = nodes.filter(n => n.type === 'method').map(n => n.name);

        // res.MAX_AGE = 3600 — constant, not callable
        expect(methods).not.toContain('MAX_AGE');
        // res.copy = res.send — alias to identifier, not a fresh function
        expect(methods).not.toContain('copy');
      });

      it('attaches line numbers to extracted method symbols', async () => {
        const nodes = await parser.parse(SAMPLE_PROTOTYPE_JS);
        const send = nodes.find(n => n.type === 'method' && n.name === 'send');
        expect(send).toBeDefined();
        expect(send!.startLine).toBeGreaterThan(0);
        expect(send!.endLine).toBeGreaterThanOrEqual(send!.startLine);
      });
    });
  });

  describe('findCallSites()', () => {
    it('should find call sites for a known function', async () => {
      const sites = await parser.findCallSites(SAMPLE_TS, 'readFileSync');
      expect(sites.length).toBeGreaterThanOrEqual(1);
      expect(sites[0].line).toBeGreaterThan(0);
      expect(sites[0].snippet).toBeTruthy();
    });

    it('should return empty for unknown function', async () => {
      const sites = await parser.findCallSites(SAMPLE_TS, 'nonExistentFunction12345');
      expect(sites).toEqual([]);
    });
  });
});

describe('Skeletonizer', () => {
  let skeletonizer: Skeletonizer;

  beforeAll(async () => {
    skeletonizer = new Skeletonizer();
    await skeletonizer.init();
  });

  describe('skeletonize()', () => {
    it('should produce a skeleton shorter than the original', async () => {
      const skeleton = await skeletonizer.skeletonize(SAMPLE_TS);
      const original = require('fs').readFileSync(SAMPLE_TS, 'utf-8');
      // Skeleton should be significantly shorter
      expect(skeleton.length).toBeLessThan(original.length);
    });

    it('should include class signatures', async () => {
      const skeleton = await skeletonizer.skeletonize(SAMPLE_TS);
      expect(skeleton).toContain('UserService');
    });

    it('should include function signatures', async () => {
      const skeleton = await skeletonizer.skeletonize(SAMPLE_TS);
      expect(skeleton).toContain('formatUser');
    });

    it('should include import statements', async () => {
      const skeleton = await skeletonizer.skeletonize(SAMPLE_TS);
      expect(skeleton).toContain('import');
    });

    it('should include method signatures in classes', async () => {
      const skeleton = await skeletonizer.skeletonize(SAMPLE_TS);
      // Methods should be present but without body
      expect(skeleton).toContain('getUser');
      expect(skeleton).toContain('createUser');
    });
  });

  describe('skeletonizeXML()', () => {
    it('should produce valid XML output', async () => {
      const xml = await skeletonizer.skeletonizeXML(SAMPLE_TS);
      expect(xml).toContain('<skeleton');
      expect(xml).toContain('</skeleton>');
    });

    it('should include class elements', async () => {
      const xml = await skeletonizer.skeletonizeXML(SAMPLE_TS);
      expect(xml).toContain('<class');
      expect(xml).toContain('UserService');
    });

    it('should include function elements', async () => {
      const xml = await skeletonizer.skeletonizeXML(SAMPLE_TS);
      expect(xml).toContain('<function');
    });

    it('should include import elements', async () => {
      const xml = await skeletonizer.skeletonizeXML(SAMPLE_TS);
      expect(xml).toContain('<import');
    });

    it('should include interface elements', async () => {
      const xml = await skeletonizer.skeletonizeXML(SAMPLE_TS);
      expect(xml).toContain('<interface');
    });
  });
});

/**
 * Multi-language Skeletonizer coverage (closes Issue #105 / Phase B1).
 *
 * Before Phase B2 wires server-side `max_response_tokens` + skeleton
 * fallback on the 12 source-returning tools, every supported language
 * needs at least one fixture proving the skeleton:
 *   1. is shorter than the original,
 *   2. preserves the public class + function names,
 *   3. strips function body content (sentinel `BODY_SENTINEL_DO_NOT_LEAK`),
 *   4. preserves import statements,
 *   5. produces well-formed XML via `skeletonizeXML()`.
 *
 * Without these, B2 could silently degrade review quality on a non-TS
 * language whenever the budget triggered skeleton substitution.
 *
 * The Skeletonizer iterates ASTParser nodes by canonical type
 * (`function | class | interface | import | export_default | arrow_function`),
 * so a single uniform fixture per language is enough to prove the
 * end-to-end pipeline. Fixtures live in `tests/fixtures/skeleton/`
 * and follow a fixed naming convention: `UserService` class,
 * `formatUser`/`format_user`/`FormatUser` top-level function, and the
 * `BODY_SENTINEL_DO_NOT_LEAK` marker inside every function body.
 */
const SKELETON_FIXTURES_DIR = path.join(FIXTURES_DIR, 'skeleton');
const BODY_SENTINEL = 'BODY_SENTINEL_DO_NOT_LEAK';

interface LanguageFixture {
  language: string;
  file: string;
  /** Identifiers the skeleton must surface (case-sensitive substrings). */
  expectedNames: string[];
  /**
   * Whether the ASTParser→Skeletonizer pipeline currently preserves at
   * least one import-equivalent line in the skeleton output for this
   * language. When false, the import-preservation test is pinned with
   * `it.fails(...)` so a future parser fix flips the test red and
   * forces removal of the flag (tripwire on regression-fix).
   *
   * All advertised languages currently pass. Three previously-known
   * gaps closed in the Step C parser fixes:
   *   - Go:   parseGo now emits a wrapping `import` node covering the
   *           full `import (...)` block before the per-spec nodes.
   *   - Ruby: parseRuby now emits `import` nodes for top-level
   *           `require`/`require_relative`/`load`/`autoload` calls.
   *   - Dart: parseDart now emits `import` for all URIs (was filtering
   *           to relative-only, silently dropping `dart:`/`package:`).
   */
  importPreservedInSkeleton: boolean;
}

/**
 * Languages with working grammars + parser→skeleton pipeline.
 * `importPreservedInSkeleton: false` flags a known parser bug — see
 * the comment on `LanguageFixture.importPreservedInSkeleton` for
 * fix surface per language.
 */
const LANGUAGE_FIXTURES: LanguageFixture[] = [
  { language: 'Python',  file: 'sample.py',    expectedNames: ['UserService', 'format_user'], importPreservedInSkeleton: true },
  { language: 'Go',      file: 'sample.go',    expectedNames: ['UserService', 'FormatUser'],  importPreservedInSkeleton: true },
  { language: 'Rust',    file: 'sample.rs',    expectedNames: ['UserService', 'format_user'], importPreservedInSkeleton: true },
  { language: 'Java',    file: 'sample.java',  expectedNames: ['UserService', 'formatUser'],  importPreservedInSkeleton: true },
  { language: 'C#',      file: 'sample.cs',    expectedNames: ['UserService', 'FormatUser'],  importPreservedInSkeleton: true },
  { language: 'Ruby',    file: 'sample.rb',    expectedNames: ['UserService', 'format_user'], importPreservedInSkeleton: true },
  { language: 'PHP',     file: 'sample.php',   expectedNames: ['UserService', 'formatUser'],  importPreservedInSkeleton: true },
  { language: 'Dart',    file: 'sample.dart',  expectedNames: ['UserService', 'formatUser'],  importPreservedInSkeleton: true },
];

/**
 * Languages whose tree-sitter grammars are unavailable on the CDN.
 * Tracked here (as it.todo) with NO committed fixture files — adding
 * sample.kt or sample.swift would cause the graph builder to attempt
 * the doomed grammar download on every run; with the loader hardened
 * (see PR fix/grammar-loader-no-crash-on-download-failure) the failure
 * is now graceful, but there's still no upside to indexing files for
 * languages we can't parse.
 *
 * Discovered during Phase B1 dogfood:
 *   - Kotlin: CDN returns HTTP 404 for
 *             https://cdn.jsdelivr.net/npm/tree-sitter-kotlin@0.3.8/tree-sitter-kotlin.wasm
 *   - Swift:  CDN returns HTTP 404 for
 *             https://cdn.jsdelivr.net/npm/tree-sitter-swift@0.7.1/tree-sitter-swift.wasm
 *
 * (C# was previously in this list — the original crash was the
 * `.wasm.tmp` ENOENT bug fixed in the grammar loader hardening, not a
 * CDN issue. The C# CDN serves the wasm at HTTP 200; C# is now in the
 * main LANGUAGE_FIXTURES array.)
 *
 * Re-enabling, per language:
 *   1. Pin a known-good grammar version + URL in grammar-manifest.ts
 *      (or vendor the .wasm into the repo).
 *   2. Re-add tests/fixtures/skeleton/sample.kt / .swift.
 *   3. Move the language from this list into LANGUAGE_FIXTURES.
 *
 * Impact on Phase B2 (#106): when the budget surface auto-substitutes
 * a skeleton for an over-budget response, Kotlin/Swift files silently
 * degrade to an empty skeleton — exactly the failure mode Phase B1
 * was designed to surface. **Ship blocker for B2 on these languages.**
 */
const LANGUAGE_FIXTURES_GRAMMAR_UNAVAILABLE = [
  { language: 'Kotlin', file: 'sample.kt'    },
  { language: 'Swift',  file: 'sample.swift' },
];

describe('Skeletonizer — multi-language coverage', () => {
  let skeletonizer: Skeletonizer;

  beforeAll(async () => {
    skeletonizer = new Skeletonizer();
    await skeletonizer.init();
  });

  describe.each(LANGUAGE_FIXTURES)('$language ($file)', ({ file, expectedNames, importPreservedInSkeleton }) => {
    const fixturePath = path.join(SKELETON_FIXTURES_DIR, file);

    it('produces a skeleton shorter than the original source', async () => {
      const skeleton = await skeletonizer.skeletonize(fixturePath);
      const original = readFileSync(fixturePath, 'utf-8');
      expect(skeleton.length).toBeLessThan(original.length);
    });

    it('surfaces every public symbol in the skeleton', async () => {
      const skeleton = await skeletonizer.skeletonize(fixturePath);
      for (const name of expectedNames) {
        expect(skeleton, `Skeleton for ${file} should contain "${name}"`).toContain(name);
      }
    });

    it('strips function body content (body sentinel must not appear)', async () => {
      const skeleton = await skeletonizer.skeletonize(fixturePath);
      expect(
        skeleton,
        `Skeleton for ${file} leaked body content — Skeletonizer is emitting the body of at least one function`,
      ).not.toContain(BODY_SENTINEL);
    });

    // Pinned with `it.fails(...)` on known-broken languages — when the
    // parser is fixed, the test will go from pass→fail (tripwire),
    // forcing whoever fixed it to flip `importPreservedInSkeleton: true`.
    const importTest = importPreservedInSkeleton ? it : it.fails;
    importTest('preserves at least one import-equivalent line', async () => {
      const skeleton = await skeletonizer.skeletonize(fixturePath);
      // Canonical 'import' node type covers all language-specific
      // import keywords. Some languages also emit package/namespace
      // declarations as imports.
      const hasImportLike = /\b(import|use|using|require|namespace|package)\b/.test(skeleton);
      expect(
        hasImportLike,
        `Skeleton for ${file} dropped all imports — expected at least one import/use/using/require/namespace/package keyword`,
      ).toBe(true);
    });

    it('produces well-formed XML via skeletonizeXML()', async () => {
      const xml = await skeletonizer.skeletonizeXML(fixturePath);
      expect(xml.startsWith('<skeleton')).toBe(true);
      expect(xml.endsWith('</skeleton>')).toBe(true);
      // Body sentinel must not leak via the XML path either.
      expect(xml).not.toContain(BODY_SENTINEL);
    });
  });

  // TODO: When the grammar download issues are resolved, move these
  // languages from LANGUAGE_FIXTURES_GRAMMAR_UNAVAILABLE into the main
  // LANGUAGE_FIXTURES array and the full assertion battery runs.
  describe.skip.each(LANGUAGE_FIXTURES_GRAMMAR_UNAVAILABLE)(
    '$language ($file) — SKIPPED pending grammar availability',
    () => {
      it.todo('produces a skeleton shorter than the original source');
      it.todo('surfaces every public symbol in the skeleton');
      it.todo('strips function body content (body sentinel must not appear)');
      it.todo('preserves at least one import-equivalent line');
      it.todo('produces well-formed XML via skeletonizeXML()');
    },
  );
});
