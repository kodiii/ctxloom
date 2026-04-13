/**
 * importExtractor.ts — Regex-based import/dependency extractor for
 * languages that are not handled by the TypeScript/JS AST parser.
 *
 * Supported languages:
 *   Python  (.py)  — relative `from .foo import bar` statements
 *   Rust    (.rs)  — `mod foo;` declarations
 *   Go      (.go)  — `import "path"` within same module (relative paths)
 *   Java    (.java) — same-package `import` statements (file-relative only)
 *
 * Only imports that can be resolved to actual local files produce graph edges.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface RawImport {
  specifier: string;
  isRelative: boolean;
}

/**
 * Extract import specifiers from a source file based on its extension.
 * Returns only imports that are candidates for local-file resolution.
 */
export function extractImports(filePath: string, content: string): RawImport[] {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.py':   return extractPythonImports(content);
    case '.rs':   return extractRustModules(content);
    case '.go':   return extractGoImports(content);
    case '.java': return extractJavaImports(content);
    default:      return [];
  }
}

/**
 * Resolve a raw import specifier from a given source file to a relative
 * project path. Returns null if the import cannot be resolved to an
 * existing file.
 */
export function resolveImport(
  fromAbs: string,
  raw: RawImport,
  rootDir: string,
): string | null {
  const ext = path.extname(fromAbs).toLowerCase();
  const fromDir = path.dirname(fromAbs);

  if (ext === '.py') return resolvePythonImport(fromAbs, fromDir, raw, rootDir);
  if (ext === '.rs') return resolveRustModule(fromDir, raw, rootDir);
  if (ext === '.go') return resolveGoImport(fromDir, raw, rootDir);
  if (ext === '.java') return resolveJavaImport(fromDir, raw, rootDir);

  return null;
}

// ─── Python ──────────────────────────────────────────────────────────────

function extractPythonImports(content: string): RawImport[] {
  const results: RawImport[] = [];

  // Relative: `from .foo import bar` or `from ..pkg.mod import x`
  const relFrom = /^from\s+(\.+[\w.]*)\s+import/gm;
  let m: RegExpExecArray | null;
  while ((m = relFrom.exec(content)) !== null) {
    results.push({ specifier: m[1], isRelative: true });
  }

  return results;
}

function resolvePythonImport(
  fromAbs: string,
  fromDir: string,
  raw: RawImport,
  rootDir: string,
): string | null {
  // Count leading dots: `.` = same package, `..` = parent, etc.
  const dotsMatch = raw.specifier.match(/^(\.+)/);
  const dots = dotsMatch?.[1] ?? '.';
  const modulePart = raw.specifier.slice(dots.length); // after the dots

  // Traverse up by (dots.length - 1) levels from the file's directory
  let baseDir = fromDir;
  for (let i = 1; i < dots.length; i++) {
    baseDir = path.dirname(baseDir);
  }

  const modulePath = modulePart.replace(/\./g, path.sep);

  const candidates = modulePath
    ? [
        path.join(baseDir, modulePath + '.py'),
        path.join(baseDir, modulePath, '__init__.py'),
      ]
    : [
        path.join(fromDir, '__init__.py'),
        fromAbs, // self — skip below
      ];

  for (const c of candidates) {
    if (c !== fromAbs && fs.existsSync(c)) {
      return path.relative(rootDir, c);
    }
  }

  return null;
}

// ─── Rust ─────────────────────────────────────────────────────────────────

function extractRustModules(content: string): RawImport[] {
  const results: RawImport[] = [];

  // `mod foo;` (public or private) — declares a child module file
  // Does NOT match `mod foo { ... }` inline module blocks
  const modDecl = /^\s*(?:pub(?:\([\w:]+\))?\s+)?mod\s+(\w+)\s*;/gm;
  let m: RegExpExecArray | null;
  while ((m = modDecl.exec(content)) !== null) {
    results.push({ specifier: m[1], isRelative: true });
  }

  return results;
}

function resolveRustModule(
  fromDir: string,
  raw: RawImport,
  rootDir: string,
): string | null {
  // mod foo → ./foo.rs  or  ./foo/mod.rs
  const candidates = [
    path.join(fromDir, raw.specifier + '.rs'),
    path.join(fromDir, raw.specifier, 'mod.rs'),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return path.relative(rootDir, c);
    }
  }

  return null;
}

// ─── Go ───────────────────────────────────────────────────────────────────

function extractGoImports(content: string): RawImport[] {
  const results: RawImport[] = [];

  // Single import: import "path/to/pkg"
  // Aliased:       import alias "path/to/pkg"
  const singleImport = /^import\s+(?:\w+\s+)?"([^"]+)"/gm;
  let m: RegExpExecArray | null;
  while ((m = singleImport.exec(content)) !== null) {
    const spec = m[1];
    // Only keep imports that look like relative sub-paths (contain a slash
    // and do not start with a domain-like segment).
    // We treat paths that start with `.` as clearly relative.
    results.push({ specifier: spec, isRelative: spec.startsWith('.') });
  }

  // Block import: import (\n  "path"\n  alias "path"\n)
  const blockImport = /import\s*\(([^)]+)\)/gs;
  while ((m = blockImport.exec(content)) !== null) {
    const block = m[1];
    const lineRe = /(?:\w+\s+)?"([^"]+)"/g;
    let lm: RegExpExecArray | null;
    while ((lm = lineRe.exec(block)) !== null) {
      const spec = lm[1];
      results.push({ specifier: spec, isRelative: spec.startsWith('.') });
    }
  }

  return results;
}

function resolveGoImport(
  fromDir: string,
  raw: RawImport,
  rootDir: string,
): string | null {
  if (!raw.isRelative) return null; // non-relative Go imports are module paths

  // Relative Go imports: import "./sibling" or import "../pkg"
  const candidate = path.resolve(fromDir, raw.specifier);
  // Go packages map to directories — look for any .go file inside
  if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
    const goFiles = fs.readdirSync(candidate).filter(f => f.endsWith('.go'));
    if (goFiles.length > 0) {
      return path.relative(rootDir, path.join(candidate, goFiles[0]));
    }
  }

  return null;
}

// ─── Java ─────────────────────────────────────────────────────────────────

function extractJavaImports(content: string): RawImport[] {
  const results: RawImport[] = [];

  // import com.example.ClassName;
  const importStmt = /^import\s+(?:static\s+)?([\w.]+)\s*;/gm;
  let m: RegExpExecArray | null;
  while ((m = importStmt.exec(content)) !== null) {
    results.push({ specifier: m[1], isRelative: false });
  }

  return results;
}

function resolveJavaImport(
  fromDir: string,
  raw: RawImport,
  rootDir: string,
): string | null {
  // Java imports use fully-qualified class names (e.g., com.example.Foo).
  // Convert dots to slashes and look for the .java file relative to rootDir.
  const filePath = path.join(rootDir, raw.specifier.replace(/\./g, path.sep) + '.java');
  if (fs.existsSync(filePath)) {
    return path.relative(rootDir, filePath);
  }

  // Also try relative to the source file's directory (for same-package imports)
  const localPath = path.join(fromDir, raw.specifier.split('.').pop() + '.java');
  if (fs.existsSync(localPath)) {
    return path.relative(rootDir, localPath);
  }

  return null;
}
