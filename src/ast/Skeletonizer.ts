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
   */
  async skeletonize(filePath: string): Promise<string> {
    const nodes = await this.parser.parse(filePath);
    const fileLines = fs.readFileSync(filePath, 'utf-8').split('\n');
    const lines: string[] = [`// Source: ${filePath}`];

    for (const node of nodes) {
      switch (node.type) {
        case 'import':
          lines.push(this.readLines(fileLines, node.startLine, node.endLine));
          break;

        case 'interface':
          lines.push(this.readLines(fileLines, node.startLine, node.endLine));
          break;

        case 'function':
          lines.push(`${node.signature};`);
          break;

        case 'arrow_function':
          lines.push(`${node.signature};`);
          break;

        case 'export_default':
          lines.push(`${node.signature};`);
          break;

        case 'class': {
          const methodLines = (node.methodRanges ?? []).map(mr => {
            const rawLine = this.readLines(fileLines, mr.signatureLine, mr.signatureLine);
            return '  ' + rawLine.replace(/\s*\{\s*$/, ';').trim();
          });

          if (methodLines.length === 0 && node.methods) {
            node.methods.forEach(m => methodLines.push(`  ${m}(...): unknown;`));
          }

          lines.push(`class ${node.name} {\n${methodLines.join('\n')}\n}`);
          break;
        }
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
