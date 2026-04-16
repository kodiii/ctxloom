/**
 * Tests for importExtractor — regex-based multi-language import extraction.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { extractImports, resolveImport } from '../src/utils/importExtractor.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('extractImports()', () => {
  describe('Python', () => {
    it('should extract relative from-import', () => {
      const result = extractImports('src/foo.py', 'from .bar import Baz\n');
      expect(result).toHaveLength(1);
      expect(result[0].specifier).toBe('.bar');
      expect(result[0].isRelative).toBe(true);
    });

    it('should extract double-dot relative import', () => {
      const result = extractImports('src/a/b.py', 'from ..utils import helper\n');
      expect(result[0].specifier).toBe('..utils');
      expect(result[0].isRelative).toBe(true);
    });

    it('should ignore absolute imports', () => {
      const result = extractImports('src/foo.py', 'import os\nfrom pathlib import Path\n');
      expect(result).toHaveLength(0);
    });

    it('should handle multiple relative imports', () => {
      const content = 'from .models import User\nfrom ..db import session\nimport sys\n';
      const result = extractImports('app/views.py', content);
      expect(result).toHaveLength(2);
      expect(result.map(r => r.specifier)).toEqual(['.models', '..db']);
    });
  });

  describe('Rust', () => {
    it('should extract mod declarations', () => {
      const result = extractImports('src/main.rs', 'mod utils;\nmod models;\n');
      expect(result).toHaveLength(2);
      expect(result[0].specifier).toBe('utils');
      expect(result[1].specifier).toBe('models');
    });

    it('should extract pub mod declarations', () => {
      const result = extractImports('src/lib.rs', 'pub mod handlers;\n');
      expect(result[0].specifier).toBe('handlers');
    });

    it('should NOT extract inline mod blocks', () => {
      const result = extractImports('src/lib.rs', 'mod tests {\n  use super::*;\n}\n');
      expect(result).toHaveLength(0);
    });

    it('should ignore use statements (not file-level)', () => {
      const result = extractImports('src/main.rs', 'use std::collections::HashMap;\nuse crate::utils;\n');
      expect(result).toHaveLength(0);
    });
  });

  describe('Go', () => {
    it('should extract single relative import', () => {
      const result = extractImports('cmd/main.go', 'import "./pkg"\n');
      expect(result).toHaveLength(1);
      expect(result[0].specifier).toBe('./pkg');
      expect(result[0].isRelative).toBe(true);
    });

    it('should extract block imports', () => {
      const content = 'import (\n  "fmt"\n  "./internal/db"\n)\n';
      const result = extractImports('main.go', content);
      expect(result.some(r => r.specifier === './internal/db')).toBe(true);
    });

    it('should mark non-relative imports as non-relative', () => {
      const result = extractImports('main.go', 'import "github.com/user/repo"\n');
      expect(result[0].isRelative).toBe(false);
    });
  });

  describe('Java', () => {
    it('should extract import statements', () => {
      const result = extractImports('src/Foo.java', 'import com.example.Bar;\n');
      expect(result).toHaveLength(1);
      expect(result[0].specifier).toBe('com.example.Bar');
    });

    it('should extract static imports', () => {
      const result = extractImports('src/Foo.java', 'import static org.junit.Assert.assertEquals;\n');
      expect(result[0].specifier).toBe('org.junit.Assert.assertEquals');
    });
  });

  describe('Unsupported extensions', () => {
    it('should return empty array for .md files', () => {
      expect(extractImports('README.md', '# Hello\n')).toHaveLength(0);
    });

    it('should return empty array for .json files', () => {
      expect(extractImports('config.json', '{"key":"val"}')).toHaveLength(0);
    });
  });
});

describe('resolveImport()', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-import-test-')));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Python resolution', () => {
    it('should resolve a same-package relative import', () => {
      // Create src/bar.py
      fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'src', 'bar.py'), '');
      fs.writeFileSync(path.join(tempDir, 'src', 'foo.py'), '');

      const fromAbs = path.join(tempDir, 'src', 'foo.py');
      const result = resolveImport(fromAbs, { specifier: '.bar', isRelative: true }, tempDir);
      expect(result).toBe(path.join('src', 'bar.py'));
    });

    it('should resolve a parent-package relative import', () => {
      fs.mkdirSync(path.join(tempDir, 'pkg', 'sub'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'pkg', 'utils.py'), '');
      fs.writeFileSync(path.join(tempDir, 'pkg', 'sub', 'view.py'), '');

      const fromAbs = path.join(tempDir, 'pkg', 'sub', 'view.py');
      const result = resolveImport(fromAbs, { specifier: '..utils', isRelative: true }, tempDir);
      expect(result).toBe(path.join('pkg', 'utils.py'));
    });

    it('should return null when target file does not exist', () => {
      fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'src', 'foo.py'), '');
      const fromAbs = path.join(tempDir, 'src', 'foo.py');
      const result = resolveImport(fromAbs, { specifier: '.nonexistent', isRelative: true }, tempDir);
      expect(result).toBeNull();
    });
  });

  describe('PHP imports', () => {
    it('extracts require_once relative imports', () => {
      const content = `<?php\nrequire_once './Models/User.php';\nrequire './helpers.php';\n`;
      const result = extractImports('/project/src/index.php', content);
      expect(result).toContainEqual({ specifier: './Models/User.php', isRelative: true });
      expect(result).toContainEqual({ specifier: './helpers.php', isRelative: true });
    });

    it('extracts use namespace imports', () => {
      const content = `<?php\nuse App\\Models\\User;\nuse App\\Services\\AuthService;\n`;
      const result = extractImports('/project/src/index.php', content);
      expect(result.some(r => r.specifier.includes('User'))).toBe(true);
    });
  });

  describe('Rust resolution', () => {
    it('should resolve mod foo to foo.rs', () => {
      fs.writeFileSync(path.join(tempDir, 'utils.rs'), '');
      fs.writeFileSync(path.join(tempDir, 'main.rs'), '');

      const fromAbs = path.join(tempDir, 'main.rs');
      const result = resolveImport(fromAbs, { specifier: 'utils', isRelative: true }, tempDir);
      expect(result).toBe('utils.rs');
    });

    it('should resolve mod foo to foo/mod.rs', () => {
      fs.mkdirSync(path.join(tempDir, 'handlers'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'handlers', 'mod.rs'), '');
      fs.writeFileSync(path.join(tempDir, 'lib.rs'), '');

      const fromAbs = path.join(tempDir, 'lib.rs');
      const result = resolveImport(fromAbs, { specifier: 'handlers', isRelative: true }, tempDir);
      expect(result).toBe(path.join('handlers', 'mod.rs'));
    });
  });
});
