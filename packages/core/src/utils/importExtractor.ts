/**
 * importExtractor.ts — Regex-based import/dependency extractor for
 * languages that are not handled by the TypeScript/JS AST parser.
 *
 * Supported languages:
 *   Python  (.py)  — relative `from .foo import bar` statements
 *   Rust    (.rs)  — `mod foo;` declarations + `use` declarations
 *   Go      (.go)  — `import "path"` — relative AND module-path via GoModuleResolver
 *   Java    (.java) — `import` statements (dot-to-slash + same-package resolution)
 *
 * Only imports that can be resolved to actual local files produce graph edges.
 */
import fs from 'node:fs';
import path from 'node:path';
import { GoModuleResolver } from './GoModuleResolver.js';
import { extractNotebookPythonSource } from './notebookExtractor.js';

/** Module-level resolver cache: rootDir → GoModuleResolver */
const goResolverCache = new Map<string, GoModuleResolver>();

function getGoResolver(rootDir: string): GoModuleResolver {
  let resolver = goResolverCache.get(rootDir);
  if (!resolver) {
    resolver = new GoModuleResolver(rootDir);
    goResolverCache.set(rootDir, resolver);
  }
  return resolver;
}

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
    case '.cs':   return extractCSharpImports(content);
    case '.rb':   return extractRubyImports(content);
    case '.kt':
    case '.kts': return extractKotlinImports(content);
    case '.swift': return extractSwiftImports(content);
    case '.php':   return extractPhpImports(content);
    case '.dart':  return extractDartImports(content);
    case '.ipynb': return extractNotebookImports(filePath, content);
    case '.vue':   return extractVueImports(content);
    case '.c':
    case '.cc':
    case '.cpp':
    case '.cxx':
    case '.h':
    case '.hh':
    case '.hpp':
    case '.hxx':   return extractCppImports(content);
    case '.scala': return extractScalaImports(content);
    case '.lua':   return extractLuaImports(content);
    case '.ex':
    case '.exs':   return extractElixirImports(content);
    case '.zig':   return extractZigImports(content);
    default:      return [];
  }
}

/**
 * Resolve a raw import specifier from a given source file to a relative
 * project path. Returns null if the import cannot be resolved to an
 * existing file.
 *
 * @param fromAbs  Absolute path of the file containing the import
 * @param raw      The import specifier (as extracted from source)
 * @param rootDir  Project root directory (needed for Go module resolution)
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
  if (ext === '.go') return resolveGoImportFull(fromAbs, fromDir, raw, rootDir);
  if (ext === '.java') return resolveJavaImport(fromDir, raw, rootDir);
  if (ext === '.cs') return resolveCSharpImport(fromDir, raw, rootDir);
  if (ext === '.rb') return resolveRubyImport(fromDir, raw, rootDir);
  if (ext === '.kt' || ext === '.kts') return resolveKotlinImport(fromDir, raw, rootDir);
  if (ext === '.swift') return resolveSwiftImport(fromDir, raw, rootDir);
  if (ext === '.php') return resolvePhpImport(fromAbs, fromDir, raw, rootDir);
  if (ext === '.dart') return resolveDartImport(fromAbs, fromDir, raw, rootDir);
  if (ext === '.ipynb') return resolvePythonImport(fromAbs, fromDir, raw, rootDir);
  if (ext === '.vue') return resolveVueImport(fromAbs, fromDir, raw, rootDir);
  if (CPP_EXTENSIONS.has(ext)) return resolveCppImport(fromDir, raw, rootDir);
  if (ext === '.scala') return resolveScalaImport(fromDir, raw, rootDir);
  if (ext === '.lua') return resolveLuaImport(fromDir, raw, rootDir);
  if (ext === '.ex' || ext === '.exs') return resolveElixirImport(fromDir, raw, rootDir);
  if (ext === '.zig') return resolveZigImport(fromAbs, fromDir, raw, rootDir);

  return null;
}

/** C/C++ source + header extensions handled by extractCppImports/resolveCppImport. */
const CPP_EXTENSIONS = new Set(['.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx']);

// ─── Python ──────────────────────────────────────────────────────────────

function extractPythonImports(content: string): RawImport[] {
  const results: RawImport[] = [];
  let m: RegExpExecArray | null;

  // Relative: `from .foo import bar` or `from ..pkg.mod import x`
  const relFrom = /^from\s+(\.+[\w.]*)\s+import/gm;
  while ((m = relFrom.exec(content)) !== null) {
    results.push({ specifier: m[1], isRelative: true });
  }

  // Absolute from-imports: `from fastapi.routing import APIRouter`
  // (no leading dot — distinguished by negative lookahead in the
  // character class for the first character of the specifier).
  const absFrom = /^from\s+([A-Za-z_][\w.]*)\s+import/gm;
  while ((m = absFrom.exec(content)) !== null) {
    results.push({ specifier: m[1], isRelative: false });
  }

  // Direct imports: `import package` or `import package.module`.
  // Matches the FIRST identifier on the line — multi-import statements
  // (`import a, b, c`) only contribute the first; rare in practice and
  // the AST path catches them all when grammar is loaded.
  const directImport = /^import\s+([A-Za-z_][\w.]*)/gm;
  while ((m = directImport.exec(content)) !== null) {
    results.push({ specifier: m[1], isRelative: false });
  }

  return results;
}

function resolvePythonImport(
  fromAbs: string,
  fromDir: string,
  raw: RawImport,
  rootDir: string,
): string | null {
  const dotsMatch = raw.specifier.match(/^(\.+)/);

  if (dotsMatch) {
    // ── Relative import: `from .foo import bar` or `from ..pkg.mod import x`
    const dots = dotsMatch[1];
    const modulePart = raw.specifier.slice(dots.length); // after the dots

    // Traverse up by (dots.length - 1) levels from the file's directory.
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

  // ── Absolute import: `from fastapi.routing import APIRouter` or
  //    `import fastapi.routing`. Pre-fix this whole branch was missing —
  //    resolvePythonImport assumed leading dots, then sliced(1) ate the
  //    first character of the specifier ('fastapi.routing' → 'astapi.routing').
  //    Result: every absolute Python import silently failed to resolve.
  //    Surfaced by the v1.6.0 bench spike on fastapi: 140 edges in a
  //    2464-file repo (vs ~120 in express's 155 files).
  //
  // Most Python projects use absolute imports rooted at either the repo
  // root (`<package>/__init__.py`) or a `src/<package>/__init__.py`
  // layout. We probe both. Site-packages / stdlib references resolve
  // to null (correctly — they're not in this repo's graph).
  const modulePath = raw.specifier.replace(/\./g, path.sep);
  const candidates = [
    // <repoRoot>/<package>/foo.py  or  <repoRoot>/<package>/foo/__init__.py
    path.join(rootDir, modulePath + '.py'),
    path.join(rootDir, modulePath, '__init__.py'),
    // src/ layout (common for Python apps that follow PEP 518 src-layout)
    path.join(rootDir, 'src', modulePath + '.py'),
    path.join(rootDir, 'src', modulePath, '__init__.py'),
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
  // M-1: Limit block content to 512KB to prevent ReDoS on crafted input
  const MAX_BLOCK_LEN = 512 * 1024;
  const safeContent = content.length > MAX_BLOCK_LEN ? content.slice(0, MAX_BLOCK_LEN) : content;
  const blockImport = /import\s*\(([^)]{0,4096})\)/gs;
  while ((m = blockImport.exec(safeContent)) !== null) {
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

function resolveGoImportFull(
  fromAbs: string,
  fromDir: string,
  raw: RawImport,
  rootDir: string,
): string | null {
  // Relative Go imports: import "./sibling" or import "../pkg"
  if (raw.isRelative) {
    const resolver = getGoResolver(rootDir);
    return resolver.resolveRelative(fromAbs, raw.specifier);
  }

  // Module-path imports: github.com/myorg/myapp/internal/auth
  // Use GoModuleResolver which reads go.mod to find the module prefix
  const resolver = getGoResolver(rootDir);
  return resolver.resolve(raw.specifier);
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

// ─── C# ───────────────────────────────────────────────────────────────────

function extractCSharpImports(content: string): RawImport[] {
  const results: RawImport[] = [];
  const usingRe = /^using\s+(?:static\s+)?([\w.]+)\s*;/gm;
  let m: RegExpExecArray | null;
  while ((m = usingRe.exec(content)) !== null) {
    results.push({ specifier: m[1], isRelative: false });
  }
  return results;
}

function resolveCSharpImport(
  fromDir: string,
  raw: RawImport,
  rootDir: string,
): string | null {
  // using Company.Project.Auth → try rootDir/Company/Project/Auth.cs
  const filePath = path.join(rootDir, raw.specifier.replace(/\./g, path.sep) + '.cs');
  if (fs.existsSync(filePath)) return path.relative(rootDir, filePath);
  // Same-directory fallback: last segment only
  const className = raw.specifier.split('.').pop() ?? raw.specifier;
  const local = path.join(fromDir, className + '.cs');
  if (fs.existsSync(local)) return path.relative(rootDir, local);
  return null;
}

// ─── Ruby ─────────────────────────────────────────────────────────────────

function extractRubyImports(content: string): RawImport[] {
  const results: RawImport[] = [];
  // Only require_relative resolves to local files; plain require is gems
  const relRe = /require_relative\s+['"]([^'"]+)['"]/gm;
  let m: RegExpExecArray | null;
  while ((m = relRe.exec(content)) !== null) {
    results.push({ specifier: m[1], isRelative: true });
  }
  return results;
}

function resolveRubyImport(
  fromDir: string,
  raw: RawImport,
  rootDir: string,
): string | null {
  const candidates = [
    path.join(fromDir, raw.specifier + '.rb'),
    path.join(fromDir, raw.specifier),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return path.relative(rootDir, c);
  }
  return null;
}

// ─── Kotlin ───────────────────────────────────────────────────────────────

function extractKotlinImports(content: string): RawImport[] {
  const results: RawImport[] = [];
  const importRe = /^import\s+([\w.]+)/gm;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(content)) !== null) {
    results.push({ specifier: m[1], isRelative: false });
  }
  return results;
}

function resolveKotlinImport(
  fromDir: string,
  raw: RawImport,
  rootDir: string,
): string | null {
  // import com.example.Foo → rootDir/com/example/Foo.kt
  const asPath = raw.specifier.replace(/\./g, path.sep);
  for (const ext of ['.kt', '.kts']) {
    const candidate = path.join(rootDir, asPath + ext);
    if (fs.existsSync(candidate)) return path.relative(rootDir, candidate);
  }
  const className = raw.specifier.split('.').pop() ?? raw.specifier;
  const local = path.join(fromDir, className + '.kt');
  if (fs.existsSync(local)) return path.relative(rootDir, local);
  return null;
}

// ─── Swift ────────────────────────────────────────────────────────────────

function extractSwiftImports(_content: string): RawImport[] {
  // Swift uses module imports (import Foundation), not file imports
  // No local file resolution possible without Swift Package Manager metadata
  return [];
}

function resolveSwiftImport(
  _fromDir: string,
  _raw: RawImport,
  _rootDir: string,
): string | null {
  return null;
}

// ─── PHP ──────────────────────────────────────────────────────────────────

function extractPhpImports(content: string): RawImport[] {
  const results: RawImport[] = [];

  // require/require_once/include/include_once with relative paths
  const requireRe = /(?:require|require_once|include|include_once)\s*\(?['"](\.[^'"]+\.php)['"]\)?/gm;
  let m: RegExpExecArray | null;
  while ((m = requireRe.exec(content)) !== null) {
    results.push({ specifier: m[1], isRelative: true });
  }

  // use Namespace\ClassName; — simple import
  const useRe = /^use\s+([\w\\]+)(?:\s+as\s+\w+)?\s*;/gm;
  while ((m = useRe.exec(content)) !== null) {
    results.push({ specifier: m[1], isRelative: false });
  }

  // use Namespace\{ClassA, ClassB}; — grouped imports (PHP 7+)
  const groupedRe = /^use\s+([\w\\]+)\\{([^}]+)}/gm;
  while ((m = groupedRe.exec(content)) !== null) {
    const prefix = m[1];
    for (const part of m[2].split(',')) {
      const name = part.trim().replace(/\s+as\s+\w+$/, '');
      if (name) results.push({ specifier: `${prefix}\\${name}`, isRelative: false });
    }
  }

  return results;
}

function resolvePhpImport(
  fromAbs: string,
  fromDir: string,
  raw: RawImport,
  rootDir: string,
): string | null {
  void fromAbs;

  if (raw.isRelative) {
    const candidate = path.resolve(fromDir, raw.specifier);
    const rootResolved = path.resolve(rootDir);
    if (!candidate.startsWith(rootResolved + path.sep) && candidate !== rootResolved) return null;
    if (fs.existsSync(candidate)) return path.relative(rootDir, candidate);
    return null;
  }

  // PSR-4: App\Models\User → src/Models/User.php or rootDir/App/Models/User.php
  const asPath = raw.specifier.replace(/\\/g, path.sep);
  const candidates = [
    path.join(rootDir, 'src', asPath + '.php'),
    path.join(rootDir, asPath + '.php'),
    path.join(fromDir, asPath.split(path.sep).pop()! + '.php'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return path.relative(rootDir, c);
  }
  return null;
}

// ─── Dart ─────────────────────────────────────────────────────────────────

function extractDartImports(content: string): RawImport[] {
  const results: RawImport[] = [];
  // Only relative imports (starting with . or ..); skip package: and dart: which are library imports
  const importRe = /^import\s+['"](\.[^'"]+\.dart)['"]/gm;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(content)) !== null) {
    results.push({ specifier: m[1], isRelative: true });
  }
  return results;
}

function resolveDartImport(
  fromAbs: string,
  fromDir: string,
  raw: RawImport,
  rootDir: string,
): string | null {
  void fromAbs;

  const candidate = path.resolve(fromDir, raw.specifier);
  // *** IMPORTANT: bound to rootDir — prevent path traversal ***
  const rootResolved = path.resolve(rootDir);
  if (!candidate.startsWith(rootResolved + path.sep) && candidate !== rootResolved) return null;
  if (fs.existsSync(candidate)) return path.relative(rootDir, candidate);
  // Also try without explicit .dart extension
  const withoutExt = path.resolve(fromDir, raw.specifier.replace(/\.dart$/, ''));
  const withExt = withoutExt + '.dart';
  if (fs.existsSync(withExt)) return path.relative(rootDir, withExt);
  return null;
}

// ─── Jupyter Notebook ─────────────────────────────────────────────────────

function extractNotebookImports(filePath: string, content: string): RawImport[] {
  void filePath;
  const pythonSource = extractNotebookPythonSource(content);
  if (!pythonSource) return [];
  return extractPythonImports(pythonSource);
}

// ─── Vue SFC ──────────────────────────────────────────────────────────────

function extractVueScriptContent(content: string): string {
  const match = content.match(/<script(?:\s[^>]*)?>([^]*?)<\/script>/i);
  return match?.[1] ?? '';
}

function extractVueImports(content: string): RawImport[] {
  const scriptContent = extractVueScriptContent(content);
  if (!scriptContent.trim()) return [];

  const results: RawImport[] = [];

  // Static imports: import X from './path' or import { X } from './path'
  const staticImport = /import\s+(?:[^'"]*from\s+)?['"](\.[^'"]+)['"]/gm;
  let m: RegExpExecArray | null;
  while ((m = staticImport.exec(scriptContent)) !== null) {
    results.push({ specifier: m[1], isRelative: true });
  }

  return results;
}

function resolveVueImport(
  fromAbs: string,
  fromDir: string,
  raw: RawImport,
  rootDir: string,
): string | null {
  void fromAbs;

  // Root confinement — same pattern as PHP/Dart
  const direct = path.resolve(fromDir, raw.specifier);
  const rootResolved = path.resolve(rootDir);
  if (!direct.startsWith(rootResolved + path.sep) && direct !== rootResolved) return null;
  if (fs.existsSync(direct)) return path.relative(rootDir, direct);

  // Try adding common extensions if no extension given
  for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.vue', '/index.ts', '/index.js']) {
    const candidate = path.resolve(fromDir, raw.specifier.replace(/\.js$/, '') + ext);
    if (!candidate.startsWith(rootResolved + path.sep)) continue; // keep confinement
    if (fs.existsSync(candidate)) return path.relative(rootDir, candidate);
  }
  return null;
}

// ─── C / C++ ──────────────────────────────────────────────────────────────

function extractCppImports(content: string): RawImport[] {
  const results: RawImport[] = [];
  // #include "foo.h" — local includes (intra-project).
  // #include <foo.h> intentionally skipped: angle-bracket includes
  // target system / framework paths the graph can't resolve to local
  // files without compiler-driver knowledge.
  const localInclude = /^\s*#\s*include\s+"([^"]+)"/gm;
  let m: RegExpExecArray | null;
  while ((m = localInclude.exec(content)) !== null) {
    results.push({ specifier: m[1], isRelative: true });
  }
  return results;
}

function resolveCppImport(
  fromDir: string,
  raw: RawImport,
  rootDir: string,
): string | null {
  // #include path is relative to the includer's directory FIRST, then
  // falls back to the project root (the common pattern for monorepo
  // root-include style).
  const rootResolved = path.resolve(rootDir);
  const candidates = [
    path.resolve(fromDir, raw.specifier),
    path.resolve(rootDir, raw.specifier),
  ];
  for (const c of candidates) {
    if (!c.startsWith(rootResolved + path.sep) && c !== rootResolved) continue;
    if (fs.existsSync(c)) return path.relative(rootDir, c);
  }
  return null;
}

// ─── Scala ────────────────────────────────────────────────────────────────

function extractScalaImports(content: string): RawImport[] {
  const results: RawImport[] = [];
  // Scala 2 + 3: `import com.example.Foo` / `import com.example.{Foo, Bar}`
  // We strip the brace clause and take the leading package path — same
  // resolution strategy as Java (dot-to-slash against rootDir). The
  // `(?:\w+\.)*\w+` shape (not `[\w.]+`) is deliberate: without it the
  // greedy character class swallows the trailing dot before `{`, leaving
  // a malformed `com.example.` specifier that the resolver can't match.
  const importRe = /^\s*import\s+((?:\w+\.)*\w+)(?:\.\{[^}]+\})?/gm;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(content)) !== null) {
    results.push({ specifier: m[1], isRelative: false });
  }
  return results;
}

function resolveScalaImport(
  fromDir: string,
  raw: RawImport,
  rootDir: string,
): string | null {
  // Scala package → file: com.example.Foo → src/main/scala/com/example/Foo.scala
  // OR rootDir/com/example/Foo.scala for non-sbt layouts.
  const asPath = raw.specifier.replace(/\./g, path.sep);
  const candidates = [
    path.join(rootDir, 'src', 'main', 'scala', asPath + '.scala'),
    path.join(rootDir, asPath + '.scala'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return path.relative(rootDir, c);
  }
  // Same-directory fallback (rare in Scala but cheap to try).
  const className = raw.specifier.split('.').pop() ?? raw.specifier;
  const local = path.join(fromDir, className + '.scala');
  if (fs.existsSync(local)) return path.relative(rootDir, local);
  return null;
}

// ─── Lua ──────────────────────────────────────────────────────────────────

function extractLuaImports(content: string): RawImport[] {
  const results: RawImport[] = [];
  // Lua module loading: `require "foo.bar"` or `require("foo.bar")`.
  // Both forms resolve to <fromDir>/foo/bar.lua via Lua's package.path
  // (which the default Lua interpreter sets up rooted in the running
  // script's directory). Conservative: only emit edges for paths that
  // resolve to a real file inside rootDir.
  const requireRe = /\brequire\s*\(?\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = requireRe.exec(content)) !== null) {
    results.push({ specifier: m[1], isRelative: false });
  }
  return results;
}

function resolveLuaImport(
  fromDir: string,
  raw: RawImport,
  rootDir: string,
): string | null {
  // dot-to-slash: `require "foo.bar"` → foo/bar.lua
  const asPath = raw.specifier.replace(/\./g, path.sep);
  const candidates = [
    path.join(fromDir, asPath + '.lua'),
    path.join(rootDir, asPath + '.lua'),
    // Lua's package convention also supports init.lua as a directory
    // entry point — analogous to Python's __init__.py.
    path.join(rootDir, asPath, 'init.lua'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return path.relative(rootDir, c);
  }
  return null;
}

// ─── Elixir ───────────────────────────────────────────────────────────────

function extractElixirImports(content: string): RawImport[] {
  const results: RawImport[] = [];
  // Elixir: `alias My.App.Module` / `import My.App.Module` / `use ...`.
  // Module names are PascalCase dotted — that distinguishes them from
  // local function refs. We catch all three keywords since they share
  // the resolve target (a defmodule in some .ex/.exs file).
  const re = /^\s*(?:alias|import|use|require)\s+([A-Z][\w.]*)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    results.push({ specifier: m[1], isRelative: false });
  }
  return results;
}

function resolveElixirImport(
  fromDir: string,
  raw: RawImport,
  rootDir: string,
): string | null {
  // Convention: My.App.Module → lib/my/app/module.ex (Mix/Phoenix
  // default). Module path is snake_cased per segment.
  const segments = raw.specifier.split('.').map(s =>
    s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase(),
  );
  const asPath = segments.join(path.sep);
  const candidates = [
    path.join(rootDir, 'lib', asPath + '.ex'),
    path.join(rootDir, 'lib', asPath + '.exs'),
    path.join(rootDir, asPath + '.ex'),
    path.join(rootDir, asPath + '.exs'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return path.relative(rootDir, c);
  }
  // Same-dir fallback for ad-hoc scripts.
  const tail = segments[segments.length - 1];
  const local = path.join(fromDir, tail + '.ex');
  if (fs.existsSync(local)) return path.relative(rootDir, local);
  return null;
}

// ─── Zig ──────────────────────────────────────────────────────────────────

function extractZigImports(content: string): RawImport[] {
  const results: RawImport[] = [];
  // Zig: `@import("./foo.zig")` — only relative-path imports resolve
  // to local files. Standard library imports like `@import("std")`
  // target the Zig toolchain's bundled std and are intentionally
  // skipped (no local file to point to).
  const importRe = /@import\s*\(\s*"([^"]+)"\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(content)) !== null) {
    const spec = m[1];
    if (spec.endsWith('.zig')) {
      // Relative if it starts with `.` OR is a bare file ref (Zig
      // interprets both as relative to the current file).
      const isRelative = spec.startsWith('.') || !spec.includes('/');
      results.push({ specifier: spec, isRelative });
    }
  }
  return results;
}

function resolveZigImport(
  fromAbs: string,
  fromDir: string,
  raw: RawImport,
  rootDir: string,
): string | null {
  void fromAbs;
  const rootResolved = path.resolve(rootDir);
  const candidate = path.resolve(fromDir, raw.specifier);
  if (!candidate.startsWith(rootResolved + path.sep) && candidate !== rootResolved) {
    return null;
  }
  if (fs.existsSync(candidate)) return path.relative(rootDir, candidate);
  return null;
}
