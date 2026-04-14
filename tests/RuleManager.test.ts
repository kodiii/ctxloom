/**
 * Tests for RuleManager — Project rule file loading.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RuleManager } from '../src/tools/ruleManager.js';
import { PathValidator } from '../src/security/PathValidator.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('RuleManager', () => {
  let tempDir: string;
  let ruleManager: RuleManager;
  let pathValidator: PathValidator;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-rules-'));
    pathValidator = new PathValidator(tempDir);
    ruleManager = new RuleManager(tempDir, pathValidator);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('loadRules()', () => {
    it('should return empty array when no rule files exist', async () => {
      const rules = await ruleManager.loadRules();
      expect(rules).toEqual([]);
    });

    it('should find .cursorrules file', async () => {
      fs.writeFileSync(path.join(tempDir, '.cursorrules'), 'Use TypeScript strict mode');
      const rules = await ruleManager.loadRules();
      expect(rules).toHaveLength(1);
      expect(rules[0].name).toBe('.cursorrules');
      expect(rules[0].content).toBe('Use TypeScript strict mode');
    });

    it('should find CLAUDE.md file', async () => {
      fs.writeFileSync(path.join(tempDir, 'CLAUDE.md'), '# Claude Rules\nUse strict types');
      const rules = await ruleManager.loadRules();
      expect(rules).toHaveLength(1);
      expect(rules[0].name).toBe('CLAUDE.md');
    });

    it('should find CONTEXT.md file', async () => {
      fs.writeFileSync(path.join(tempDir, 'CONTEXT.md'), 'Project context info');
      const rules = await ruleManager.loadRules();
      expect(rules).toHaveLength(1);
      expect(rules[0].name).toBe('CONTEXT.md');
    });

    it('should find .ctxloomrc file', async () => {
      fs.writeFileSync(path.join(tempDir, '.ctxloomrc'), '{"embeddingModel": "all-MiniLM-L6-v2"}');
      const rules = await ruleManager.loadRules();
      expect(rules).toHaveLength(1);
      expect(rules[0].name).toBe('.ctxloomrc');
    });

    it('should find multiple rule files', async () => {
      fs.writeFileSync(path.join(tempDir, '.cursorrules'), 'Rule 1');
      fs.writeFileSync(path.join(tempDir, 'CLAUDE.md'), 'Rule 2');
      const rules = await ruleManager.loadRules();
      expect(rules).toHaveLength(2);
    });

    it('should cache rules on subsequent calls', async () => {
      fs.writeFileSync(path.join(tempDir, '.cursorrules'), 'Cached rule');
      const rules1 = await ruleManager.loadRules();
      // Delete the file and load again — should still return cached result
      fs.unlinkSync(path.join(tempDir, '.cursorrules'));
      const rules2 = await ruleManager.loadRules();
      expect(rules2).toEqual(rules1);
    });
  });

  describe('getRulesXML()', () => {
    it('should return empty XML when no rules found', async () => {
      const xml = await ruleManager.getRulesXML();
      expect(xml).toContain('count="0"');
      expect(xml).toContain('No rule files found');
    });

    it('should return XML with rule content', async () => {
      fs.writeFileSync(path.join(tempDir, '.cursorrules'), 'Use strict');
      const xml = await ruleManager.getRulesXML();
      expect(xml).toContain('count="1"');
      expect(xml).toContain('file=".cursorrules"');
      expect(xml).toContain('Use strict');
    });

    it('should escape special XML characters in rule content', async () => {
      fs.writeFileSync(path.join(tempDir, 'CLAUDE.md'), 'Use <tags> & "quotes"');
      const xml = await ruleManager.getRulesXML();
      expect(xml).toContain('&lt;tags&gt;');
      expect(xml).toContain('&amp;');
      expect(xml).toContain('&quot;');
    });
  });

  describe('invalidateCache()', () => {
    it('should force re-scan of rule files', async () => {
      fs.writeFileSync(path.join(tempDir, '.cursorrules'), 'Old rule');
      await ruleManager.loadRules();

      fs.writeFileSync(path.join(tempDir, '.cursorrules'), 'New rule');
      ruleManager.invalidateCache();

      const rules = await ruleManager.loadRules();
      expect(rules[0].content).toBe('New rule');
    });
  });
});
