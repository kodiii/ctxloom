/**
 * ASTParser — Wraps web-tree-sitter to extract structured nodes
 * (functions, classes, interfaces, imports, export defaults, arrow functions)
 * from TypeScript/JavaScript files.
 *
 * Expanded pattern support per flaw analysis (F-09):
 *   - export default
 *   - arrow functions
 *   - variable declarators with function types
 *
 * Handles both tree-sitter WASM grammar versions:
 *   - import_statement (newer tree-sitter-typescript)
 *   - import_declaration (older tree-sitter-typescript)
 */
import * as TreeSitter from 'web-tree-sitter';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { GrammarLoader } from '../grammars/GrammarLoader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// WASM path discovery — check multiple candidate locations
// When running from built output: __dirname = dist/        → wasm is at dist/wasm/
// When running from source (tsx): __dirname = src/ast/     → wasm is at dist/wasm/ (two levels up)
// When installed globally:         __dirname = <prefix>/   → wasm is at <prefix>/wasm/
function findWasmDir(): string {
  const candidates = [
    // Built output: __dirname is dist/ → wasm/ is right next to it
    path.join(__dirname, 'wasm'),
    // Source mode: __dirname is src/ast/ → need to go up to project root, then dist/wasm
    path.join(__dirname, '..', '..', 'dist', 'wasm'),
    // node_modules location (tree-sitter.wasm lives inside web-tree-sitter)
    path.join(__dirname, '..', 'node_modules'),
    path.join(__dirname, '..', '..', 'node_modules'),
  ];

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'tree-sitter.wasm'))) {
      return dir;
    }
  }

  // Fallback: try to find web-tree-sitter in node_modules
  try {
    const _require = createRequire(import.meta.url);
    const pkgPath = _require.resolve('web-tree-sitter/package.json');
    const pkgDir = path.dirname(pkgPath);
    if (fs.existsSync(path.join(pkgDir, 'tree-sitter.wasm'))) {
      return pkgDir;
    }
  } catch {
    // Package not found in standard locations
  }

  // Last resort: return the most likely built-output path
  return path.join(__dirname, 'wasm');
}

const WASM_DIR = findWasmDir();

export interface MethodRange {
  name: string;
  signatureLine: number;
}

export interface CallSite {
  filePath: string;
  line: number;
  snippet: string;
}

export interface ParsedNode {
  type: 'function' | 'class' | 'interface' | 'import' | 'export_default' | 'arrow_function';
  name: string;
  signature?: string;
  methods?: string[];
  methodRanges?: MethodRange[];
  source?: string;
  startLine: number;
  endLine: number;
}

export class ASTParser {
  private tsLang: TreeSitter.Language | null = null;
  private pyLang: TreeSitter.Language | null = null;
  private goLang: TreeSitter.Language | null = null;
  private rustLang: TreeSitter.Language | null = null;
  private javaLang: TreeSitter.Language | null = null;
  private csLang: TreeSitter.Language | null = null;
  private rubyLang: TreeSitter.Language | null = null;
  private kotlinLang: TreeSitter.Language | null = null;
  private swiftLang: TreeSitter.Language | null = null;
  private grammarLoader = new GrammarLoader();

  async init(): Promise<void> {
    await TreeSitter.Parser.init({
      locateFile: () => path.join(WASM_DIR, 'tree-sitter.wasm'),
    });

    // Load TypeScript grammar — try multiple paths
    const grammarCandidates = [
      path.join(WASM_DIR, 'tree-sitter-typescript.wasm'),
      path.join(WASM_DIR, 'tree-sitter-typescript', 'tree-sitter-typescript.wasm'),
      // Also check node_modules for the grammar
      path.join(__dirname, '..', 'node_modules', 'web-tree-sitter', 'tree-sitter-typescript.wasm'),
      path.join(__dirname, '..', '..', 'node_modules', 'web-tree-sitter', 'tree-sitter-typescript.wasm'),
    ];

    let grammarPath = '';
    for (const candidate of grammarCandidates) {
      if (fs.existsSync(candidate)) {
        grammarPath = candidate;
        break;
      }
    }

    if (!grammarPath) {
      throw new Error('Could not locate tree-sitter-typescript.wasm grammar file');
    }

    this.tsLang = await TreeSitter.Language.load(grammarPath);
  }

  /**
   * Load Python grammar on demand. Downloads and caches WASM if needed.
   */
  private async loadPython(): Promise<void> {
    if (this.pyLang) return;
    try {
      const wasmPath = await this.grammarLoader.ensureGrammar('python');
      this.pyLang = await TreeSitter.Language.load(wasmPath);
    } catch (err) {
      // Python grammar unavailable — log warning, skip Python files
      const { logger } = await import('../utils/logger.js');
      logger.warn('Python grammar unavailable', { detail: err instanceof Error ? err.message : String(err) });
    }
  }

  /**
   * Load Go grammar on demand. Downloads and caches WASM if needed.
   */
  private async loadGo(): Promise<void> {
    if (this.goLang) return;
    try {
      const wasmPath = await this.grammarLoader.ensureGrammar('go');
      this.goLang = await TreeSitter.Language.load(wasmPath);
    } catch (err) {
      const { logger } = await import('../utils/logger.js');
      logger.warn('Go grammar unavailable', { detail: err instanceof Error ? err.message : String(err) });
    }
  }

  /**
   * Load Rust grammar on demand. Downloads and caches WASM if needed.
   */
  private async loadRust(): Promise<void> {
    if (this.rustLang) return;
    try {
      const wasmPath = await this.grammarLoader.ensureGrammar('rust');
      this.rustLang = await TreeSitter.Language.load(wasmPath);
    } catch (err) {
      const { logger } = await import('../utils/logger.js');
      logger.warn('Rust grammar unavailable', { detail: err instanceof Error ? err.message : String(err) });
    }
  }

  /**
   * Load Java grammar on demand. Downloads and caches WASM if needed.
   */
  private async loadJava(): Promise<void> {
    if (this.javaLang) return;
    try {
      const wasmPath = await this.grammarLoader.ensureGrammar('java');
      this.javaLang = await TreeSitter.Language.load(wasmPath);
    } catch (err) {
      const { logger } = await import('../utils/logger.js');
      logger.warn('Java grammar unavailable', { detail: err instanceof Error ? err.message : String(err) });
    }
  }

  private async loadCSharp(): Promise<void> {
    if (this.csLang) return;
    try {
      const wasmPath = await this.grammarLoader.ensureGrammar('csharp');
      this.csLang = await TreeSitter.Language.load(wasmPath);
    } catch (err) {
      const { logger } = await import('../utils/logger.js');
      logger.warn('C# grammar unavailable', { detail: err instanceof Error ? err.message : String(err) });
    }
  }

  private async loadRuby(): Promise<void> {
    if (this.rubyLang) return;
    try {
      const wasmPath = await this.grammarLoader.ensureGrammar('ruby');
      this.rubyLang = await TreeSitter.Language.load(wasmPath);
    } catch (err) {
      const { logger } = await import('../utils/logger.js');
      logger.warn('Ruby grammar unavailable', { detail: err instanceof Error ? err.message : String(err) });
    }
  }

  private async loadKotlin(): Promise<void> {
    if (this.kotlinLang) return;
    try {
      const wasmPath = await this.grammarLoader.ensureGrammar('kotlin');
      this.kotlinLang = await TreeSitter.Language.load(wasmPath);
    } catch (err) {
      const { logger } = await import('../utils/logger.js');
      logger.warn('Kotlin grammar unavailable', { detail: err instanceof Error ? err.message : String(err) });
    }
  }

  private async loadSwift(): Promise<void> {
    if (this.swiftLang) return;
    try {
      const wasmPath = await this.grammarLoader.ensureGrammar('swift');
      this.swiftLang = await TreeSitter.Language.load(wasmPath);
    } catch (err) {
      const { logger } = await import('../utils/logger.js');
      logger.warn('Swift grammar unavailable', { detail: err instanceof Error ? err.message : String(err) });
    }
  }

  async parse(filePath: string): Promise<ParsedNode[]> {
    if (!this.tsLang) throw new Error('ASTParser not initialized. Call init() first.');

    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.py') {
      return this.parsePython(filePath);
    }
    if (ext === '.go') return this.parseGo(filePath);
    if (ext === '.rs') return this.parseRust(filePath);
    if (ext === '.java') return this.parseJava(filePath);
    if (ext === '.cs') return this.parseCSharp(filePath);
    if (ext === '.rb') return this.parseRuby(filePath);
    if (ext === '.kt' || ext === '.kts') return this.parseKotlin(filePath);
    if (ext === '.swift') return this.parseSwift(filePath);

    const parser = new TreeSitter.Parser();
    parser.setLanguage(this.tsLang);

    const source = fs.readFileSync(filePath, 'utf-8');
    const tree = parser.parse(source);
    if (!tree) return [];

    const nodes: ParsedNode[] = [];
    const lines = source.split('\n');
    // Track processed node IDs to prevent duplicates from export_statement
    const processedIds = new Set<number>();

    const walk = (node: TreeSitter.Node) => {
      // Skip if already processed (prevents duplicates from export_statement)
      if (processedIds.has(node.id)) return;

      switch (node.type) {
        // ─── Import statements (both grammar versions) ────────────────────
        case 'import_statement':
        case 'import_declaration': {
          const srcNode = node.children.find(c => c?.type === 'string');
          if (srcNode) {
            nodes.push({
              type: 'import',
              name: srcNode.text.replace(/['"]/g, ''),
              source: srcNode.text.replace(/['"]/g, ''),
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
          }
          processedIds.add(node.id);
          return; // Don't recurse into import nodes
        }

        // ─── Export statements (export function, export default) ────────
        case 'export_statement': {
          const hasDefault = node.children.some(c => c?.type === 'default');

          if (hasDefault) {
            // export default function foo() {} or export default class Foo {}
            const innerFunc = node.children.find(c => c?.type === 'function_declaration');
            const innerClass = node.children.find(c => c?.type === 'class_declaration');

            if (innerFunc) {
              processedIds.add(innerFunc.id);
              const nameNode = innerFunc.childForFieldName?.('name')
                ?? innerFunc.children.find(c => c?.type === 'identifier');
              const sig = lines[node.startPosition.row] ?? '';
              nodes.push({
                type: 'export_default',
                name: nameNode?.text ?? 'default',
                signature: sig.trim(),
                startLine: node.startPosition.row + 1,
                endLine: node.endPosition.row + 1,
              });
            } else if (innerClass) {
              processedIds.add(innerClass.id);
              const nameNode = innerClass.childForFieldName?.('name');
              const sig = lines[node.startPosition.row] ?? '';
              nodes.push({
                type: 'export_default',
                name: nameNode?.text ?? 'default',
                signature: sig.trim(),
                startLine: node.startPosition.row + 1,
                endLine: node.endPosition.row + 1,
              });
            } else {
              // export default expression (identifier, call_expression, etc.)
              const exprChild = node.children.find(c =>
                c?.type === 'identifier' || c?.type === 'call_expression' || c?.type === 'class'
              );
              if (exprChild) {
                const sig = lines[node.startPosition.row] ?? '';
                nodes.push({
                  type: 'export_default',
                  name: exprChild.text.split('(')[0].trim().slice(0, 50),
                  signature: sig.trim(),
                  startLine: node.startPosition.row + 1,
                  endLine: node.endPosition.row + 1,
                });
              }
            }
          } else {
            // export function / export class / export interface / export const
            // Walk the inner child — it will add itself to processedIds when processed
            const innerChild = node.children.find(
              c => c?.type === 'function_declaration'
                || c?.type === 'class_declaration'
                || c?.type === 'interface_declaration'
                || c?.type === 'lexical_declaration'
                || c?.type === 'type_alias_declaration'
            );

            if (innerChild) {
              // Walk the inner child — it will be processed and mark itself
              walk(innerChild);
            }
          }

          processedIds.add(node.id);
          return; // Don't recurse into export_statement children (we handled them above)
        }

        // ─── Function declarations ──────────────────────────────────────
        case 'function_declaration': {
          const nameNode = node.childForFieldName?.('name')
            ?? node.children.find(c => c?.type === 'identifier');
          if (nameNode) {
            const sig = lines[node.startPosition.row] ?? '';
            nodes.push({
              type: 'function',
              name: nameNode.text,
              signature: sig.trim(),
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
          }
          processedIds.add(node.id);
          // Don't recurse into function bodies
          return;
        }

        // ─── Class declarations ─────────────────────────────────────────
        case 'class_declaration': {
          const nameNode = node.childForFieldName?.('name');
          if (nameNode) {
            const body = node.childForFieldName?.('body');
            const methodNodes = (body?.children ?? []).filter(
              c => c?.type === 'method_definition' || c?.type === 'public_field_definition',
            ) as TreeSitter.Node[];
            const methods = methodNodes
              .map(c => c.childForFieldName?.('name')?.text ?? '')
              .filter(Boolean);

            const methodRanges: MethodRange[] = methodNodes
              .map(c => {
                const mName = c.childForFieldName?.('name')?.text ?? '';
                return mName ? { name: mName, signatureLine: c.startPosition.row + 1 } : null;
              })
              .filter((x): x is MethodRange => x !== null);

            nodes.push({
              type: 'class',
              name: nameNode.text,
              signature: `class ${nameNode.text}`,
              methods,
              methodRanges,
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
          }
          processedIds.add(node.id);
          // Don't recurse into class bodies
          return;
        }

        // ─── Interface declarations ─────────────────────────────────────
        case 'interface_declaration': {
          const nameNode = node.childForFieldName?.('name');
          if (nameNode) {
            nodes.push({
              type: 'interface',
              name: nameNode.text,
              signature: `interface ${nameNode.text}`,
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
          }
          processedIds.add(node.id);
          return;
        }

        // ─── Lexical declarations (const fn = () => {}) ────────────────
        case 'lexical_declaration': {
          for (const child of node.children) {
            if (!child || child.type !== 'variable_declarator') continue;
            const declarator = child;
            const nameNode = declarator.childForFieldName?.('name');
            const valueNode = declarator.childForFieldName?.('value');

            if (nameNode && valueNode) {
              if (valueNode.type === 'arrow_function' || valueNode.type === 'function') {
                const sig = lines[declarator.startPosition.row] ?? '';
                nodes.push({
                  type: 'arrow_function',
                  name: nameNode.text,
                  signature: sig.trim().replace(/\s*\=>\s*\{.*$/, ' => ...'),
                  startLine: declarator.startPosition.row + 1,
                  endLine: declarator.endPosition.row + 1,
                });
              }
            }
          }
          processedIds.add(node.id);
          return;
        }
      }

      // Recurse into children
      for (const child of node.children) {
        if (child) walk(child);
      }
    };

    walk(tree.rootNode);
    return nodes;
  }

  private async parsePython(filePath: string): Promise<ParsedNode[]> {
    if (!this.pyLang) await this.loadPython();
    if (!this.pyLang) return []; // grammar unavailable

    const parser = new TreeSitter.Parser();
    parser.setLanguage(this.pyLang);

    const source = fs.readFileSync(filePath, 'utf-8');
    const tree = parser.parse(source);
    if (!tree) return [];

    const nodes: ParsedNode[] = [];
    const lines = source.split('\n');

    const walk = (node: TreeSitter.Node): void => {
      switch (node.type) {
        case 'import_statement': {
          // import foo, import foo as bar
          const nameNode = node.children.find(c => c?.type === 'dotted_name' || c?.type === 'aliased_import');
          if (nameNode) {
            nodes.push({
              type: 'import',
              name: nameNode.text,
              source: nameNode.text,
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
          }
          return;
        }
        case 'import_from_statement': {
          // from foo import bar
          const moduleNode = node.children.find(c => c?.type === 'dotted_name' || c?.type === 'relative_import');
          nodes.push({
            type: 'import',
            name: moduleNode?.text ?? '',
            source: moduleNode?.text ?? '',
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
          });
          return;
        }
        case 'function_definition': {
          const nameNode = node.childForFieldName?.('name');
          if (nameNode) {
            const sig = lines[node.startPosition.row] ?? '';
            nodes.push({
              type: 'function',
              name: nameNode.text,
              signature: sig.trim(),
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
          }
          return; // don't recurse into function body
        }
        case 'class_definition': {
          const nameNode = node.childForFieldName?.('name');
          if (nameNode) {
            const body = node.childForFieldName?.('body');
            const methods = (body?.children ?? [])
              .filter((c): c is TreeSitter.Node => c !== null && c.type === 'function_definition')
              .map(c => c.childForFieldName?.('name')?.text ?? '')
              .filter(Boolean);

            nodes.push({
              type: 'class',
              name: nameNode.text,
              signature: `class ${nameNode.text}`,
              methods,
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
          }
          return; // don't recurse into class body
        }
        case 'decorated_definition': {
          // @decorator\ndef foo(): ...  →  recurse into the inner definition
          const inner = node.children.find(
            c => c?.type === 'function_definition' || c?.type === 'class_definition',
          );
          if (inner) walk(inner);
          return;
        }
      }

      for (const child of node.children) {
        if (child) walk(child);
      }
    };

    walk(tree.rootNode);
    return nodes;
  }

  private async parseGo(filePath: string): Promise<ParsedNode[]> {
    if (!this.goLang) await this.loadGo();
    if (!this.goLang) return [];

    const parser = new TreeSitter.Parser();
    parser.setLanguage(this.goLang);

    const source = fs.readFileSync(filePath, 'utf-8');
    const tree = parser.parse(source);
    if (!tree) return [];

    const nodes: ParsedNode[] = [];
    const lines = source.split('\n');

    const walk = (node: TreeSitter.Node): void => {
      switch (node.type) {
        case 'function_declaration': {
          const nameNode = node.childForFieldName?.('name');
          if (nameNode) {
            nodes.push({
              type: 'function',
              name: nameNode.text,
              signature: (lines[node.startPosition.row] ?? '').trim(),
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
          }
          return;
        }
        case 'method_declaration': {
          const nameNode = node.childForFieldName?.('name');
          if (nameNode) {
            nodes.push({
              type: 'function',
              name: nameNode.text,
              signature: (lines[node.startPosition.row] ?? '').trim(),
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
          }
          return;
        }
        case 'type_declaration': {
          for (const child of node.children) {
            if (child?.type === 'type_spec') {
              const nameNode = child.childForFieldName?.('name');
              if (nameNode) {
                const typeNode = child.childForFieldName?.('type');
                const isInterface = typeNode?.type === 'interface_type';
                nodes.push({
                  type: isInterface ? 'interface' : 'class',
                  name: nameNode.text,
                  signature: `type ${nameNode.text} ${typeNode?.type ?? ''}`.trim(),
                  startLine: child.startPosition.row + 1,
                  endLine: child.endPosition.row + 1,
                });
              }
            }
          }
          return;
        }
        case 'import_declaration': {
          // Walk into import_spec_list or import_spec directly
          const walkImport = (n: TreeSitter.Node): void => {
            if (n.type === 'import_spec') {
              const pathNode = n.childForFieldName?.('path');
              if (pathNode) {
                const spec = pathNode.text.replace(/^"|"$/g, '');
                nodes.push({
                  type: 'import',
                  name: spec,
                  source: spec,
                  startLine: n.startPosition.row + 1,
                  endLine: n.endPosition.row + 1,
                });
              }
            }
            for (const c of n.children) {
              if (c) walkImport(c);
            }
          };
          walkImport(node);
          return;
        }
      }

      for (const child of node.children) {
        if (child) walk(child);
      }
    };

    walk(tree.rootNode);
    return nodes;
  }

  private async parseRust(filePath: string): Promise<ParsedNode[]> {
    if (!this.rustLang) await this.loadRust();
    if (!this.rustLang) return [];

    const parser = new TreeSitter.Parser();
    parser.setLanguage(this.rustLang);

    const source = fs.readFileSync(filePath, 'utf-8');
    const tree = parser.parse(source);
    if (!tree) return [];

    const nodes: ParsedNode[] = [];
    const lines = source.split('\n');

    const walk = (node: TreeSitter.Node): void => {
      switch (node.type) {
        case 'function_item': {
          const nameNode = node.childForFieldName?.('name');
          if (nameNode) {
            nodes.push({
              type: 'function',
              name: nameNode.text,
              signature: (lines[node.startPosition.row] ?? '').trim(),
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
          }
          return;
        }
        case 'struct_item': {
          const nameNode = node.childForFieldName?.('name');
          if (nameNode) {
            nodes.push({
              type: 'class',
              name: nameNode.text,
              signature: `struct ${nameNode.text}`,
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
          }
          return;
        }
        case 'enum_item': {
          const nameNode = node.childForFieldName?.('name');
          if (nameNode) {
            nodes.push({
              type: 'class',
              name: nameNode.text,
              signature: `enum ${nameNode.text}`,
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
          }
          return;
        }
        case 'trait_item': {
          const nameNode = node.childForFieldName?.('name');
          if (nameNode) {
            nodes.push({
              type: 'interface',
              name: nameNode.text,
              signature: `trait ${nameNode.text}`,
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
          }
          return;
        }
        case 'impl_item': {
          // Recurse into the impl body so function_item children emit as function nodes
          // Do NOT emit the impl block itself — struct_item or enum_item already registers the type
          const body = node.childForFieldName?.('body');
          if (body) {
            for (const child of body.children) {
              if (child) walk(child);
            }
          }
          return;
        }
        case 'mod_item': {
          // `mod foo;` (no body) = file module declaration — emit as import
          const body = node.childForFieldName?.('body');
          if (body) return; // `mod foo { ... }` inline block — skip
          const nameNode = node.childForFieldName?.('name');
          if (nameNode) {
            nodes.push({
              type: 'import',
              name: nameNode.text,
              source: nameNode.text,
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
          }
          return;
        }
        case 'use_declaration': {
          const arg = node.childForFieldName?.('argument');
          if (arg) {
            nodes.push({
              type: 'import',
              name: arg.text,
              source: arg.text,
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
          }
          return;
        }
      }

      for (const child of node.children) {
        if (child) walk(child);
      }
    };

    walk(tree.rootNode);
    return nodes;
  }

  private async parseJava(filePath: string): Promise<ParsedNode[]> {
    if (!this.javaLang) await this.loadJava();
    if (!this.javaLang) return [];

    const parser = new TreeSitter.Parser();
    parser.setLanguage(this.javaLang);

    const source = fs.readFileSync(filePath, 'utf-8');
    const tree = parser.parse(source);
    if (!tree) return [];

    const nodes: ParsedNode[] = [];
    const lines = source.split('\n');

    const walk = (node: TreeSitter.Node): void => {
      switch (node.type) {
        case 'class_declaration': {
          const nameNode = node.childForFieldName?.('name');
          if (nameNode) {
            // Recurse into the body to emit methods as function nodes
            const body = node.childForFieldName?.('body');
            const methods = (body?.children ?? [])
              .filter((c): c is TreeSitter.Node => c !== null && (c.type === 'method_declaration' || c.type === 'constructor_declaration'))
              .map(c => c.childForFieldName?.('name')?.text ?? '')
              .filter(Boolean);

            const methodRanges: MethodRange[] = (body?.children ?? [])
              .filter((c): c is TreeSitter.Node => c !== null && (c.type === 'method_declaration' || c.type === 'constructor_declaration'))
              .map(c => {
                const mName = c.childForFieldName?.('name')?.text ?? '';
                return mName ? { name: mName, signatureLine: c.startPosition.row + 1 } : null;
              })
              .filter((x): x is MethodRange => x !== null);

            nodes.push({
              type: 'class',
              name: nameNode.text,
              signature: `class ${nameNode.text}`,
              methods,
              methodRanges,
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
            // Recurse into body to emit method_declaration nodes as function nodes
            if (body) {
              for (const child of body.children) {
                if (child) walk(child);
              }
            }
          }
          return;
        }
        case 'interface_declaration': {
          const nameNode = node.childForFieldName?.('name');
          if (nameNode) {
            nodes.push({
              type: 'interface',
              name: nameNode.text,
              signature: `interface ${nameNode.text}`,
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
          }
          return;
        }
        case 'method_declaration': {
          const nameNode = node.childForFieldName?.('name');
          if (nameNode) {
            nodes.push({
              type: 'function',
              name: nameNode.text,
              signature: (lines[node.startPosition.row] ?? '').trim(),
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
          }
          return;
        }
        case 'constructor_declaration': {
          const nameNode = node.childForFieldName?.('name');
          if (nameNode) {
            nodes.push({
              type: 'function',
              name: nameNode.text,
              signature: (lines[node.startPosition.row] ?? '').trim(),
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
          }
          return;
        }
        case 'import_declaration': {
          const child = node.children.find(
            c => c?.type === 'scoped_identifier' || c?.type === 'identifier',
          );
          if (child) {
            nodes.push({
              type: 'import',
              name: child.text,
              source: child.text,
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
          }
          return;
        }
      }

      for (const child of node.children) {
        if (child) walk(child);
      }
    };

    walk(tree.rootNode);
    return nodes;
  }

  private async parseCSharp(filePath: string): Promise<ParsedNode[]> {
    if (!this.csLang) await this.loadCSharp();
    if (!this.csLang) return [];

    const parser = new TreeSitter.Parser();
    parser.setLanguage(this.csLang);

    const source = fs.readFileSync(filePath, 'utf-8');
    const tree = parser.parse(source);
    if (!tree) return [];

    const nodes: ParsedNode[] = [];
    const lines = source.split('\n');

    const walk = (node: TreeSitter.Node): void => {
      switch (node.type) {
        case 'using_directive': {
          const nameNode = node.children.find(
            c => c?.type === 'identifier' || c?.type === 'qualified_name' || c?.type === 'name',
          );
          if (nameNode) {
            nodes.push({
              type: 'import',
              name: nameNode.text,
              source: nameNode.text,
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
          }
          return;
        }
        case 'method_declaration': {
          const nameNode = node.childForFieldName?.('name') ?? node.children.find(c => c?.type === 'identifier');
          if (nameNode) {
            nodes.push({
              type: 'function',
              name: nameNode.text,
              signature: (lines[node.startPosition.row] ?? '').trim(),
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
          }
          return;
        }
        case 'class_declaration':
        case 'struct_declaration': {
          const nameNode = node.childForFieldName?.('name') ?? node.children.find(c => c?.type === 'identifier');
          if (nameNode) {
            const body = node.childForFieldName?.('body');
            const methods = (body?.children ?? [])
              .filter((c): c is TreeSitter.Node => c !== null && c.type === 'method_declaration')
              .map(c => (c.childForFieldName?.('name') ?? c.children.find(ch => ch?.type === 'identifier'))?.text ?? '')
              .filter(Boolean);
            nodes.push({
              type: 'class',
              name: nameNode.text,
              signature: `class ${nameNode.text}`,
              methods,
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
          }
          return;
        }
        case 'interface_declaration': {
          const nameNode = node.childForFieldName?.('name') ?? node.children.find(c => c?.type === 'identifier');
          if (nameNode) {
            nodes.push({
              type: 'interface',
              name: nameNode.text,
              signature: `interface ${nameNode.text}`,
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
          }
          return;
        }
      }
      for (const child of node.children) {
        if (child) walk(child);
      }
    };

    walk(tree.rootNode);
    return nodes;
  }

  private async parseRuby(filePath: string): Promise<ParsedNode[]> {
    if (!this.rubyLang) await this.loadRuby();
    if (!this.rubyLang) return [];

    const parser = new TreeSitter.Parser();
    parser.setLanguage(this.rubyLang);

    const source = fs.readFileSync(filePath, 'utf-8');
    const tree = parser.parse(source);
    if (!tree) return [];

    const nodes: ParsedNode[] = [];
    const lines = source.split('\n');

    const walk = (node: TreeSitter.Node): void => {
      switch (node.type) {
        case 'method':
        case 'singleton_method': {
          const nameNode = node.childForFieldName?.('name') ?? node.children.find(c => c?.type === 'identifier');
          if (nameNode) {
            nodes.push({
              type: 'function',
              name: nameNode.text,
              signature: (lines[node.startPosition.row] ?? '').trim(),
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
          }
          return;
        }
        case 'class': {
          const nameNode = node.childForFieldName?.('name') ?? node.children.find(c => c?.type === 'constant');
          if (nameNode) {
            const body = node.childForFieldName?.('body');
            const methods = (body?.children ?? [])
              .filter((c): c is TreeSitter.Node => c !== null && (c.type === 'method' || c.type === 'singleton_method'))
              .map(c => (c.childForFieldName?.('name') ?? c.children.find(ch => ch?.type === 'identifier'))?.text ?? '')
              .filter(Boolean);
            nodes.push({
              type: 'class',
              name: nameNode.text,
              signature: `class ${nameNode.text}`,
              methods,
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
          }
          return;
        }
        case 'module': {
          const nameNode = node.childForFieldName?.('name') ?? node.children.find(c => c?.type === 'constant');
          if (nameNode) {
            nodes.push({
              type: 'class',
              name: nameNode.text,
              signature: `module ${nameNode.text}`,
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
          }
          return;
        }
      }
      for (const child of node.children) {
        if (child) walk(child);
      }
    };

    walk(tree.rootNode);
    return nodes;
  }

  private async parseKotlin(filePath: string): Promise<ParsedNode[]> {
    if (!this.kotlinLang) await this.loadKotlin();
    if (!this.kotlinLang) return [];

    const parser = new TreeSitter.Parser();
    parser.setLanguage(this.kotlinLang);

    const source = fs.readFileSync(filePath, 'utf-8');
    const tree = parser.parse(source);
    if (!tree) return [];

    const nodes: ParsedNode[] = [];
    const lines = source.split('\n');

    const walk = (node: TreeSitter.Node): void => {
      switch (node.type) {
        case 'function_declaration': {
          const nameNode = node.children.find(c => c?.type === 'simple_identifier');
          if (nameNode) {
            nodes.push({
              type: 'function',
              name: nameNode.text,
              signature: (lines[node.startPosition.row] ?? '').trim(),
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
          }
          return;
        }
        case 'class_declaration':
        case 'object_declaration': {
          const nameNode = node.children.find(c => c?.type === 'type_identifier' || c?.type === 'simple_identifier');
          if (nameNode) {
            nodes.push({
              type: 'class',
              name: nameNode.text,
              signature: `class ${nameNode.text}`,
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
          }
          return;
        }
        case 'import_header': {
          const identifier = node.children.find(c => c?.type === 'identifier');
          if (identifier) {
            nodes.push({
              type: 'import',
              name: identifier.text,
              source: identifier.text,
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
          }
          return;
        }
      }
      for (const child of node.children) {
        if (child) walk(child);
      }
    };

    walk(tree.rootNode);
    return nodes;
  }

  private async parseSwift(filePath: string): Promise<ParsedNode[]> {
    if (!this.swiftLang) await this.loadSwift();
    if (!this.swiftLang) return [];

    const parser = new TreeSitter.Parser();
    parser.setLanguage(this.swiftLang);

    const source = fs.readFileSync(filePath, 'utf-8');
    const tree = parser.parse(source);
    if (!tree) return [];

    const nodes: ParsedNode[] = [];
    const lines = source.split('\n');

    const walk = (node: TreeSitter.Node): void => {
      switch (node.type) {
        case 'function_declaration': {
          const nameNode = node.childForFieldName?.('name') ?? node.children.find(c => c?.type === 'simple_identifier');
          if (nameNode) {
            nodes.push({
              type: 'function',
              name: nameNode.text,
              signature: (lines[node.startPosition.row] ?? '').trim(),
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
          }
          return;
        }
        case 'class_declaration': {
          const nameNode = node.childForFieldName?.('name') ?? node.children.find(c => c?.type === 'type_identifier');
          if (nameNode) {
            nodes.push({
              type: 'class',
              name: nameNode.text,
              signature: `class ${nameNode.text}`,
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
          }
          return;
        }
        case 'protocol_declaration': {
          const nameNode = node.childForFieldName?.('name') ?? node.children.find(c => c?.type === 'type_identifier');
          if (nameNode) {
            nodes.push({
              type: 'interface',
              name: nameNode.text,
              signature: `protocol ${nameNode.text}`,
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
          }
          return;
        }
        case 'import_declaration': {
          const nameNode = node.children.find(c => c?.type === 'identifier');
          if (nameNode) {
            nodes.push({
              type: 'import',
              name: nameNode.text,
              source: nameNode.text,
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
          }
          return;
        }
      }
      for (const child of node.children) {
        if (child) walk(child);
      }
    };

    walk(tree.rootNode);
    return nodes;
  }

  /**
   * Find all call sites of a symbol in a file.
   */
  async findCallSites(filePath: string, symbolName: string): Promise<CallSite[]> {
    if (!this.tsLang) throw new Error('ASTParser not initialized. Call init() first.');

    const parser = new TreeSitter.Parser();
    parser.setLanguage(this.tsLang);

    const source = fs.readFileSync(filePath, 'utf-8');
    const tree = parser.parse(source);
    if (!tree) return [];

    const lines = source.split('\n');
    const results: CallSite[] = [];

    const walk = (node: TreeSitter.Node): void => {
      if (node.type === 'call_expression' || node.type === 'new_expression') {
        const fn = node.childForFieldName?.('function') ?? node.children[0];
        if (fn) {
          const name =
            fn.type === 'identifier'
              ? fn.text
              : fn.type === 'member_expression'
                ? (fn.childForFieldName?.('property')?.text ?? '')
                : '';

          if (name === symbolName) {
            const lineIdx = node.startPosition.row;
            results.push({
              filePath,
              line: lineIdx + 1,
              snippet: (lines[lineIdx] ?? '').trim(),
            });
          }
        }
      }
      for (const child of node.children) {
        if (child) walk(child);
      }
    };

    walk(tree.rootNode);
    return results;
  }

  /**
   * Extract all call edges in a TypeScript/TSX file.
   * Tracks the enclosing function/method context for each call site.
   * Used to populate CallGraphIndex during indexing.
   */
  async parseAllCallEdges(
    filePath: string,
  ): Promise<Array<{ callerSymbol: string; calleeSymbol: string; line: number }>> {
    if (!this.tsLang) throw new Error('ASTParser not initialized. Call init() first.');

    const parser = new TreeSitter.Parser();
    parser.setLanguage(this.tsLang);

    const source = fs.readFileSync(filePath, 'utf-8');
    const tree = parser.parse(source);
    if (!tree) return [];

    const results: Array<{ callerSymbol: string; calleeSymbol: string; line: number }> = [];

    const walk = (node: TreeSitter.Node, contextStack: string[]): void => {
      let newStack = contextStack;

      if (
        node.type === 'function_declaration' ||
        node.type === 'method_definition' ||
        node.type === 'arrow_function' ||
        node.type === 'function'
      ) {
        const nameNode =
          node.childForFieldName?.('name') ??
          node.children.find(c => c?.type === 'identifier');
        const name = nameNode?.text ?? '';
        if (name) {
          newStack = [...contextStack, name];
        }
      }

      if (node.type === 'call_expression' || node.type === 'new_expression') {
        const fn = node.childForFieldName?.('function') ?? node.children[0];
        if (fn) {
          const name =
            fn.type === 'identifier'
              ? fn.text
              : fn.type === 'member_expression'
                ? (fn.childForFieldName?.('property')?.text ?? '')
                : '';
          if (name && name.length > 0) {
            results.push({
              callerSymbol: newStack[newStack.length - 1] ?? '',
              calleeSymbol: name,
              line: node.startPosition.row + 1,
            });
          }
        }
      }

      for (const child of node.children) {
        if (child) walk(child, newStack);
      }
    };

    walk(tree.rootNode, []);
    return results;
  }
}
