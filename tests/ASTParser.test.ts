/**
 * Tests for ASTParser and Skeletonizer — Code parsing and skeletonization.
 *
 * These tests use the test fixtures in tests/fixtures/.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { ASTParser } from '../src/ast/ASTParser.js';
import { Skeletonizer } from '../src/ast/Skeletonizer.js';
import path from 'node:path';
import { readFileSync } from 'node:fs';
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
   * Known-false languages discovered during Phase B1 dogfood:
   *   - Go:   parser emits `import` nodes whose line range points at
   *           the inner string literals, not the wrapping `import (...)`.
   *           Result: import paths visible but `import` keyword stripped.
   *   - Ruby: parser does not emit `require` as an import node.
   *   - Dart: parser does not emit `import_or_export_declaration` as
   *           an import node.
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
  { language: 'Python',  file: 'sample.py',    expectedNames: ['UserService', 'format_user'], importPreservedInSkeleton: true  },
  { language: 'Go',      file: 'sample.go',    expectedNames: ['UserService', 'FormatUser'],  importPreservedInSkeleton: false },
  { language: 'Rust',    file: 'sample.rs',    expectedNames: ['UserService', 'format_user'], importPreservedInSkeleton: true  },
  { language: 'Java',    file: 'sample.java',  expectedNames: ['UserService', 'formatUser'],  importPreservedInSkeleton: true  },
  { language: 'Ruby',    file: 'sample.rb',    expectedNames: ['UserService', 'format_user'], importPreservedInSkeleton: false },
  { language: 'PHP',     file: 'sample.php',   expectedNames: ['UserService', 'formatUser'],  importPreservedInSkeleton: true  },
  { language: 'Dart',    file: 'sample.dart',  expectedNames: ['UserService', 'formatUser'],  importPreservedInSkeleton: false },
];

/**
 * Languages whose tree-sitter grammars currently fail to load.
 * Tracked here (as it.todo) but with NO committed fixture files yet —
 * adding a sample.cs / sample.kt / sample.swift to the repo causes the
 * graph builder (used by benchmarks and the pr-bot CI action) to crash
 * with an unhandled 'error' event when it tries to download the
 * unavailable grammar:
 *
 *   Error: ENOENT ... tree-sitter-c-sharp.wasm.tmp
 *
 * That's a real bug in the grammar loader (it should disable the
 * language and continue, not throw an unhandled error), but it lives
 * downstream of this PR's scope. Until the loader is fixed AND the
 * grammars themselves are loadable, fixtures must NOT be added.
 *
 * Discovered during Phase B1 dogfood:
 *   - C#:     '.wasm.tmp' race on parallel grammar download → 30s timeout
 *   - Kotlin: CDN returns HTTP 404 for
 *             https://cdn.jsdelivr.net/npm/tree-sitter-kotlin@0.3.8/tree-sitter-kotlin.wasm
 *   - Swift:  CDN returns HTTP 404 for
 *             https://cdn.jsdelivr.net/npm/tree-sitter-swift@0.7.1/tree-sitter-swift.wasm
 *
 * Re-enabling, once grammars are reliably loadable:
 *   1. Fix the grammar loader so an unavailable grammar disables the
 *      language gracefully (catch error, return empty parser, do not
 *      crash the host process).
 *   2. Re-add tests/fixtures/skeleton/sample.cs / .kt / .swift with
 *      the same identifier convention as the other fixtures (see git
 *      log on this file for the originals).
 *   3. Move the language(s) from this list into LANGUAGE_FIXTURES.
 *
 * Impact on Phase B2 (#106): when the budget surface auto-substitutes
 * a skeleton for an over-budget response, C#/Kotlin/Swift files
 * silently degrade to an empty skeleton — exactly the failure mode
 * Phase B1 was designed to surface. **Ship blocker for B2 on these
 * three languages.**
 */
const LANGUAGE_FIXTURES_GRAMMAR_UNAVAILABLE = [
  { language: 'C#',     file: 'sample.cs'    },
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
