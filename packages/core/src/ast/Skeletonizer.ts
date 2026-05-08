/**
 * Skeletonizer — Converts a full source file into a compact signature-only view.
 *
 * Output format (for the AI):
 *
 *   // Source: src/services/UserService.ts
 *   import { foo } from './foo.js';
 *   export interface User { id: string; name: string; }
 *   export class UserService {
 *     constructor(db: string);
 *     async getUser(id: string): Promise<User>;
 *   }
 *   export function formatUser(user: User): string;
 *
 * This reduces a 200-line file to ~15 lines (≈90% token reduction).
 *
 * Returns structured XML output per Design Doc specification.
 */
import { ASTParser, ParsedNode } from './ASTParser.js';
import fs from 'node:fs';

export class Skeletonizer {
  private parser: ASTParser;

  constructor() {
    this.parser = new ASTParser();
  }

  async init(): Promise<void> {
    await this.parser.init();
  }

  /**
   * Set a pre-initialized parser (avoids re-initialization cost).
   */
  setParser(parser: ASTParser): void {
    this.parser = parser;
  }

  /**
   * Produce a plain-text skeleton of the file.
   *
   * Three layers of pathological-input defense — without them, a single
   * minified bundled file (e.g. Next.js ships entire compiled vendor
   * packages as 466KB-on-16-lines `.cjs` files) explodes into hundreds
   * of MB of output. The `import` and `interface` cases call
   * `readLines(node.startLine, node.endLine)`; on minified one-line
   * source where every node spans the whole file, that returns the
   * entire file each time, and many such nodes repeat the duplication.
   * Observed: 466KB → 211MB (452× expansion) on @vercel/blob's compiled
   * bundle in next.js. Defenses, in order of cheapest:
   *
   *   1. `MAX_INPUT_BYTES` — skip files larger than 256KB. AI context
   *      tools shouldn't be skeletonizing pre-built vendor bundles
   *      anyway; they're not human-authored source.
   *   2. Average-line-length heuristic — if mean line >1KB, treat as
   *      minified and skip. Catches the .cjs/.min.js pattern that
   *      slips under the 256KB ceiling.
   *   3. `MAX_OUTPUT_BYTES` running cap — belt-and-suspenders against
   *      anything the first two miss. Stop appending and return what
   *      we have rather than OOM.
   *
   * Skipped files return a single comment so callers can distinguish
   * "deliberately skipped" from "skeletonized to empty".
   */
  async skeletonize(filePath: string): Promise<string> {
    const fileSource = fs.readFileSync(filePath, 'utf-8');
    const fileLines = fileSource.split('\n');

    // Layer 1: hard size cap. 256KB is comfortably above any
    // human-authored source file — typical max is ~50KB.
    const MAX_INPUT_BYTES = 256 * 1024;
    if (fileSource.length > MAX_INPUT_BYTES) {
      return `// Source: ${filePath}\n// (skipped: ${fileSource.length} bytes exceeds ${MAX_INPUT_BYTES} byte limit; likely a bundled vendor file)`;
    }

    // Layer 2: minified detector. Mean-line-length >1KB means the file
    // has very few line breaks for its size — almost certainly minified
    // or a generated single-line bundle. Skeletonization on these
    // produces no useful signal AND triggers the readLines blowup.
    const meanLineBytes = fileSource.length / Math.max(fileLines.length, 1);
    if (meanLineBytes > 1024) {
      return `// Source: ${filePath}\n// (skipped: appears minified — ${fileLines.length} lines for ${fileSource.length} bytes)`;
    }

    const nodes = await this.parser.parse(filePath);
    const lines: string[] = [`// Source: ${filePath}`];

    // Layer 3: running output cap. 1MB is way above any reasonable
    // skeleton (largest seen on a real human-authored file: ~80KB).
    const MAX_OUTPUT_BYTES = 1024 * 1024;
    let outputBytes = lines[0].length;

    for (const node of nodes) {
      if (outputBytes > MAX_OUTPUT_BYTES) {
        lines.push(`// (output truncated at ${MAX_OUTPUT_BYTES} bytes)`);
        break;
      }
      let chunk = '';
      switch (node.type) {
        case 'import':
          chunk = this.readLines(fileLines, node.startLine, node.endLine);
          break;

        case 'interface':
          chunk = this.readLines(fileLines, node.startLine, node.endLine);
          break;

        case 'function':
          chunk = `${node.signature};`;
          break;

        case 'arrow_function':
          chunk = `${node.signature};`;
          break;

        case 'export_default':
          chunk = `${node.signature};`;
          break;

        case 'class': {
          const methodLines = (node.methodRanges ?? []).map(mr => {
            const rawLine = this.readLines(fileLines, mr.signatureLine, mr.signatureLine);
            return '  ' + rawLine.replace(/\s*\{\s*$/, ';').trim();
          });

          if (methodLines.length === 0 && node.methods) {
            node.methods.forEach(m => methodLines.push(`  ${m}(...): unknown;`));
          }

          chunk = `class ${node.name} {\n${methodLines.join('\n')}\n}`;
          break;
        }
      }
      if (chunk) {
        lines.push(chunk);
        outputBytes += chunk.length + 1; // +1 for the newline join() will add
      }
    }

    return lines.join('\n');
  }

  /**
   * Produce an XML-formatted skeleton of the file.
   */
  async skeletonizeXML(filePath: string): Promise<string> {
    const nodes = await this.parser.parse(filePath);
    const fileLines = fs.readFileSync(filePath, 'utf-8').split('\n');
    const parts: string[] = [`<skeleton file="${filePath}">`];

    for (const node of nodes) {
      switch (node.type) {
        case 'import':
          parts.push(`  <import source="${this.escapeXML(node.source ?? '')}">${this.escapeXML(node.name)}</import>`);
          break;

        case 'interface':
          parts.push(`  <interface name="${this.escapeXML(node.name)}" lines="${node.startLine}-${node.endLine}">`);
          parts.push(`    ${this.escapeXML(this.readLines(fileLines, node.startLine, node.endLine))}`);
          parts.push('  </interface>');
          break;

        case 'function':
          parts.push(`  <function name="${this.escapeXML(node.name)}" line="${node.startLine}">`);
          parts.push(`    ${this.escapeXML(node.signature ?? '')}`);
          parts.push('  </function>');
          break;

        case 'arrow_function':
          parts.push(`  <arrow_function name="${this.escapeXML(node.name)}" line="${node.startLine}">`);
          parts.push(`    ${this.escapeXML(node.signature ?? '')}`);
          parts.push('  </arrow_function>');
          break;

        case 'export_default':
          parts.push(`  <export_default name="${this.escapeXML(node.name)}" line="${node.startLine}">`);
          parts.push(`    ${this.escapeXML(node.signature ?? '')}`);
          parts.push('  </export_default>');
          break;

        case 'class': {
          const methodSigs = (node.methodRanges ?? []).map(mr => {
            const rawLine = this.readLines(fileLines, mr.signatureLine, mr.signatureLine);
            return '    ' + rawLine.replace(/\s*\{\s*$/, ';').trim();
          });

          if (methodSigs.length === 0 && node.methods) {
            node.methods.forEach(m => methodSigs.push(`    ${m}(...): unknown;`));
          }

          parts.push(`  <class name="${this.escapeXML(node.name)}" line="${node.startLine}">`);
          parts.push(...methodSigs);
          parts.push('  </class>');
          break;
        }
      }
    }

    parts.push('</skeleton>');
    return parts.join('\n');
  }

  private readLines(lines: string[], start: number, end: number): string {
    return lines.slice(start - 1, end).join('\n');
  }

  private escapeXML(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
