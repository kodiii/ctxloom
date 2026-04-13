/**
 * Tests for PathValidator — Security boundary validation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PathValidator } from '../src/security/PathValidator.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('PathValidator', () => {
  let tempDir: string;
  let validator: PathValidator;

  beforeEach(() => {
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'contextmesh-test-')));
    // Create a test file
    fs.writeFileSync(path.join(tempDir, 'test.txt'), 'hello');
    fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'src', 'app.ts'), 'console.log("hi")');
    validator = new PathValidator(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('validate()', () => {
    it('should accept paths within the project root', () => {
      const result = validator.validate('test.txt');
      expect(result).toBe(path.resolve(tempDir, 'test.txt'));
    });

    it('should accept nested paths within the project root', () => {
      const result = validator.validate('src/app.ts');
      expect(result).toBe(path.resolve(tempDir, 'src', 'app.ts'));
    });

    it('should reject path traversal with ../', () => {
      expect(() => validator.validate('../../../etc/passwd')).toThrow('Path traversal blocked');
    });

    it('should reject absolute paths outside the root', () => {
      expect(() => validator.validate('/etc/passwd')).toThrow('Path traversal blocked');
    });

    it('should reject complex path traversal attacks', () => {
      expect(() => validator.validate('src/../../etc/shadow')).toThrow('Path traversal blocked');
    });

    it('should handle paths with double dots that stay within root', () => {
      // src/../test.txt resolves to test.txt which is in root
      const result = validator.validate('src/../test.txt');
      expect(result).toBe(path.resolve(tempDir, 'test.txt'));
    });
  });

  describe('readFile()', () => {
    it('should read a valid file within root', () => {
      const content = validator.readFile('test.txt');
      expect(content).toBe('hello');
    });

    it('should throw for files outside root', () => {
      expect(() => validator.readFile('../../../etc/passwd')).toThrow('Path traversal blocked');
    });

    it('should throw for non-existent files', () => {
      expect(() => validator.readFile('nonexistent.txt')).toThrow();
    });
  });

  describe('isWithinRoot()', () => {
    it('should return true for paths within root', () => {
      expect(validator.isWithinRoot('test.txt')).toBe(true);
    });

    it('should return false for paths outside root', () => {
      expect(validator.isWithinRoot('../../../etc/passwd')).toBe(false);
    });
  });

  describe('toRelative()', () => {
    it('should convert absolute paths to relative', () => {
      const absPath = path.resolve(tempDir, 'src', 'app.ts');
      expect(validator.toRelative(absPath)).toBe(path.join('src', 'app.ts'));
    });
  });

  describe('getProjectRoot()', () => {
    it('should return the canonical root path', () => {
      expect(validator.getProjectRoot()).toBe(fs.realpathSync(tempDir));
    });
  });
});
