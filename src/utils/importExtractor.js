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
const goResolverCache = new Map();
function getGoResolver(rootDir) {
    let resolver = goResolverCache.get(rootDir);
    if (!resolver) {
        resolver = new GoModuleResolver(rootDir);
        goResolverCache.set(rootDir, resolver);
    }
    return resolver;
}
/**
 * Extract import specifiers from a source file based on its extension.
 * Returns only imports that are candidates for local-file resolution.
 */
export function extractImports(filePath, content) {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case '.py': return extractPythonImports(content);
        case '.rs': return extractRustModules(content);
        case '.go': return extractGoImports(content);
        case '.java': return extractJavaImports(content);
        case '.cs': return extractCSharpImports(content);
        case '.rb': return extractRubyImports(content);
        case '.kt':
        case '.kts': return extractKotlinImports(content);
        case '.swift': return extractSwiftImports(content);
        case '.php': return extractPhpImports(content);
        case '.dart': return extractDartImports(content);
        case '.ipynb': return extractNotebookImports(filePath, content);
        case '.vue': return extractVueImports(content);
        default: return [];
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
export function resolveImport(fromAbs, raw, rootDir) {
    const ext = path.extname(fromAbs).toLowerCase();
    const fromDir = path.dirname(fromAbs);
    if (ext === '.py')
        return resolvePythonImport(fromAbs, fromDir, raw, rootDir);
    if (ext === '.rs')
        return resolveRustModule(fromDir, raw, rootDir);
    if (ext === '.go')
        return resolveGoImportFull(fromAbs, fromDir, raw, rootDir);
    if (ext === '.java')
        return resolveJavaImport(fromDir, raw, rootDir);
    if (ext === '.cs')
        return resolveCSharpImport(fromDir, raw, rootDir);
    if (ext === '.rb')
        return resolveRubyImport(fromDir, raw, rootDir);
    if (ext === '.kt' || ext === '.kts')
        return resolveKotlinImport(fromDir, raw, rootDir);
    if (ext === '.swift')
        return resolveSwiftImport(fromDir, raw, rootDir);
    if (ext === '.php')
        return resolvePhpImport(fromAbs, fromDir, raw, rootDir);
    if (ext === '.dart')
        return resolveDartImport(fromAbs, fromDir, raw, rootDir);
    if (ext === '.ipynb')
        return resolvePythonImport(fromAbs, fromDir, raw, rootDir);
    if (ext === '.vue')
        return resolveVueImport(fromAbs, fromDir, raw, rootDir);
    return null;
}
// ─── Python ──────────────────────────────────────────────────────────────
function extractPythonImports(content) {
    const results = [];
    // Relative: `from .foo import bar` or `from ..pkg.mod import x`
    const relFrom = /^from\s+(\.+[\w.]*)\s+import/gm;
    let m;
    while ((m = relFrom.exec(content)) !== null) {
        results.push({ specifier: m[1], isRelative: true });
    }
    return results;
}
function resolvePythonImport(fromAbs, fromDir, raw, rootDir) {
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
function extractRustModules(content) {
    const results = [];
    // `mod foo;` (public or private) — declares a child module file
    // Does NOT match `mod foo { ... }` inline module blocks
    const modDecl = /^\s*(?:pub(?:\([\w:]+\))?\s+)?mod\s+(\w+)\s*;/gm;
    let m;
    while ((m = modDecl.exec(content)) !== null) {
        results.push({ specifier: m[1], isRelative: true });
    }
    return results;
}
function resolveRustModule(fromDir, raw, rootDir) {
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
function extractGoImports(content) {
    const results = [];
    // Single import: import "path/to/pkg"
    // Aliased:       import alias "path/to/pkg"
    const singleImport = /^import\s+(?:\w+\s+)?"([^"]+)"/gm;
    let m;
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
        let lm;
        while ((lm = lineRe.exec(block)) !== null) {
            const spec = lm[1];
            results.push({ specifier: spec, isRelative: spec.startsWith('.') });
        }
    }
    return results;
}
function resolveGoImportFull(fromAbs, fromDir, raw, rootDir) {
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
function extractJavaImports(content) {
    const results = [];
    // import com.example.ClassName;
    const importStmt = /^import\s+(?:static\s+)?([\w.]+)\s*;/gm;
    let m;
    while ((m = importStmt.exec(content)) !== null) {
        results.push({ specifier: m[1], isRelative: false });
    }
    return results;
}
function resolveJavaImport(fromDir, raw, rootDir) {
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
function extractCSharpImports(content) {
    const results = [];
    const usingRe = /^using\s+(?:static\s+)?([\w.]+)\s*;/gm;
    let m;
    while ((m = usingRe.exec(content)) !== null) {
        results.push({ specifier: m[1], isRelative: false });
    }
    return results;
}
function resolveCSharpImport(fromDir, raw, rootDir) {
    // using Company.Project.Auth → try rootDir/Company/Project/Auth.cs
    const filePath = path.join(rootDir, raw.specifier.replace(/\./g, path.sep) + '.cs');
    if (fs.existsSync(filePath))
        return path.relative(rootDir, filePath);
    // Same-directory fallback: last segment only
    const className = raw.specifier.split('.').pop() ?? raw.specifier;
    const local = path.join(fromDir, className + '.cs');
    if (fs.existsSync(local))
        return path.relative(rootDir, local);
    return null;
}
// ─── Ruby ─────────────────────────────────────────────────────────────────
function extractRubyImports(content) {
    const results = [];
    // Only require_relative resolves to local files; plain require is gems
    const relRe = /require_relative\s+['"]([^'"]+)['"]/gm;
    let m;
    while ((m = relRe.exec(content)) !== null) {
        results.push({ specifier: m[1], isRelative: true });
    }
    return results;
}
function resolveRubyImport(fromDir, raw, rootDir) {
    const candidates = [
        path.join(fromDir, raw.specifier + '.rb'),
        path.join(fromDir, raw.specifier),
    ];
    for (const c of candidates) {
        if (fs.existsSync(c))
            return path.relative(rootDir, c);
    }
    return null;
}
// ─── Kotlin ───────────────────────────────────────────────────────────────
function extractKotlinImports(content) {
    const results = [];
    const importRe = /^import\s+([\w.]+)/gm;
    let m;
    while ((m = importRe.exec(content)) !== null) {
        results.push({ specifier: m[1], isRelative: false });
    }
    return results;
}
function resolveKotlinImport(fromDir, raw, rootDir) {
    // import com.example.Foo → rootDir/com/example/Foo.kt
    const asPath = raw.specifier.replace(/\./g, path.sep);
    for (const ext of ['.kt', '.kts']) {
        const candidate = path.join(rootDir, asPath + ext);
        if (fs.existsSync(candidate))
            return path.relative(rootDir, candidate);
    }
    const className = raw.specifier.split('.').pop() ?? raw.specifier;
    const local = path.join(fromDir, className + '.kt');
    if (fs.existsSync(local))
        return path.relative(rootDir, local);
    return null;
}
// ─── Swift ────────────────────────────────────────────────────────────────
function extractSwiftImports(_content) {
    // Swift uses module imports (import Foundation), not file imports
    // No local file resolution possible without Swift Package Manager metadata
    return [];
}
function resolveSwiftImport(_fromDir, _raw, _rootDir) {
    return null;
}
// ─── PHP ──────────────────────────────────────────────────────────────────
function extractPhpImports(content) {
    const results = [];
    // require/require_once/include/include_once with relative paths
    const requireRe = /(?:require|require_once|include|include_once)\s*\(?['"](\.[^'"]+\.php)['"]\)?/gm;
    let m;
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
            if (name)
                results.push({ specifier: `${prefix}\\${name}`, isRelative: false });
        }
    }
    return results;
}
function resolvePhpImport(fromAbs, fromDir, raw, rootDir) {
    void fromAbs;
    if (raw.isRelative) {
        const candidate = path.resolve(fromDir, raw.specifier);
        const rootResolved = path.resolve(rootDir);
        if (!candidate.startsWith(rootResolved + path.sep) && candidate !== rootResolved)
            return null;
        if (fs.existsSync(candidate))
            return path.relative(rootDir, candidate);
        return null;
    }
    // PSR-4: App\Models\User → src/Models/User.php or rootDir/App/Models/User.php
    const asPath = raw.specifier.replace(/\\/g, path.sep);
    const candidates = [
        path.join(rootDir, 'src', asPath + '.php'),
        path.join(rootDir, asPath + '.php'),
        path.join(fromDir, asPath.split(path.sep).pop() + '.php'),
    ];
    for (const c of candidates) {
        if (fs.existsSync(c))
            return path.relative(rootDir, c);
    }
    return null;
}
// ─── Dart ─────────────────────────────────────────────────────────────────
function extractDartImports(content) {
    const results = [];
    // Only relative imports (starting with . or ..); skip package: and dart: which are library imports
    const importRe = /^import\s+['"](\.[^'"]+\.dart)['"]/gm;
    let m;
    while ((m = importRe.exec(content)) !== null) {
        results.push({ specifier: m[1], isRelative: true });
    }
    return results;
}
function resolveDartImport(fromAbs, fromDir, raw, rootDir) {
    void fromAbs;
    const candidate = path.resolve(fromDir, raw.specifier);
    // *** IMPORTANT: bound to rootDir — prevent path traversal ***
    const rootResolved = path.resolve(rootDir);
    if (!candidate.startsWith(rootResolved + path.sep) && candidate !== rootResolved)
        return null;
    if (fs.existsSync(candidate))
        return path.relative(rootDir, candidate);
    // Also try without explicit .dart extension
    const withoutExt = path.resolve(fromDir, raw.specifier.replace(/\.dart$/, ''));
    const withExt = withoutExt + '.dart';
    if (fs.existsSync(withExt))
        return path.relative(rootDir, withExt);
    return null;
}
// ─── Jupyter Notebook ─────────────────────────────────────────────────────
function extractNotebookImports(filePath, content) {
    void filePath;
    const pythonSource = extractNotebookPythonSource(content);
    if (!pythonSource)
        return [];
    return extractPythonImports(pythonSource);
}
// ─── Vue SFC ──────────────────────────────────────────────────────────────
function extractVueScriptContent(content) {
    const match = content.match(/<script(?:\s[^>]*)?>([^]*?)<\/script>/i);
    return match?.[1] ?? '';
}
function extractVueImports(content) {
    const scriptContent = extractVueScriptContent(content);
    if (!scriptContent.trim())
        return [];
    const results = [];
    // Static imports: import X from './path' or import { X } from './path'
    const staticImport = /import\s+(?:[^'"]*from\s+)?['"](\.[^'"]+)['"]/gm;
    let m;
    while ((m = staticImport.exec(scriptContent)) !== null) {
        results.push({ specifier: m[1], isRelative: true });
    }
    return results;
}
function resolveVueImport(fromAbs, fromDir, raw, rootDir) {
    void fromAbs;
    // Root confinement — same pattern as PHP/Dart
    const direct = path.resolve(fromDir, raw.specifier);
    const rootResolved = path.resolve(rootDir);
    if (!direct.startsWith(rootResolved + path.sep) && direct !== rootResolved)
        return null;
    if (fs.existsSync(direct))
        return path.relative(rootDir, direct);
    // Try adding common extensions if no extension given
    for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.vue', '/index.ts', '/index.js']) {
        const candidate = path.resolve(fromDir, raw.specifier.replace(/\.js$/, '') + ext);
        if (!candidate.startsWith(rootResolved + path.sep))
            continue; // keep confinement
        if (fs.existsSync(candidate))
            return path.relative(rootDir, candidate);
    }
    return null;
}
//# sourceMappingURL=importExtractor.js.map