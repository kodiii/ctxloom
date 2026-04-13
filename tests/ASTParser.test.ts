/**
 * Tests for ASTParser and Skeletonizer — Code parsing and skeletonization.
 *
 * These tests use the test fixtures in tests/fixtures/.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { ASTParser } from '../src/ast/ASTParser.js';
import { Skeletonizer } from '../src/ast/Skeletonizer.js';
import path from 'node:path';
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
