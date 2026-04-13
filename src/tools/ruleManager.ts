/**
 * RuleManager — Scans for and loads project rule files.
 *
 * Supports: .cursorrules, CLAUDE.md, CONTEXT.md, .contextmeshrc
 * Fulfills FR-09 (Rule Injection, P0) from the PRD.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PathValidator } from '../security/PathValidator.js';

const RULE_FILES = [
  '.cursorrules',
  'CLAUDE.md',
  'CONTEXT.md',
  '.contextmeshrc',
  '.cursor/rules',
  '.claude/CLAUDE.md',
];

export interface RuleFile {
  name: string;
  path: string;
  content: string;
}

export class RuleManager {
  private projectRoot: string;
  private pathValidator: PathValidator;
  private cachedRules: RuleFile[] | null = null;

  constructor(projectRoot: string, pathValidator: PathValidator) {
    this.projectRoot = projectRoot;
    this.pathValidator = pathValidator;
  }

  /**
   * Scan for all rule files in the project root.
   */
  async loadRules(): Promise<RuleFile[]> {
    if (this.cachedRules) return this.cachedRules;

    const rules: RuleFile[] = [];

    for (const ruleFile of RULE_FILES) {
      const fullPath = path.join(this.projectRoot, ruleFile);
      try {
        this.pathValidator.validate(fullPath);
        if (fs.existsSync(fullPath)) {
          const stat = fs.statSync(fullPath);
          if (stat.isFile()) {
            const content = fs.readFileSync(fullPath, 'utf-8');
            rules.push({
              name: ruleFile,
              path: ruleFile,
              content,
            });
          } else if (stat.isDirectory()) {
            // For directories, load all files within
            const dirEntries = fs.readdirSync(fullPath);
            for (const entry of dirEntries) {
              const entryPath = path.join(fullPath, entry);
              const entryStat = fs.statSync(entryPath);
              if (entryStat.isFile()) {
                const content = fs.readFileSync(entryPath, 'utf-8');
                rules.push({
                  name: `${ruleFile}/${entry}`,
                  path: `${ruleFile}/${entry}`,
                  content,
                });
              }
            }
          }
        }
      } catch {
        // File doesn't exist or is outside root — skip
      }
    }

    this.cachedRules = rules;
    return rules;
  }

  /**
   * Get rules as XML output for AI consumption.
   */
  async getRulesXML(): Promise<string> {
    const rules = await this.loadRules();

    if (rules.length === 0) {
      return '<rules count="0">\n  <!-- No rule files found in project -->\n</rules>';
    }

    const lines = [`<rules count="${rules.length}">`];
    for (const rule of rules) {
      const escaped = rule.content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
      lines.push(`  <rule file="${rule.name}">`);
      lines.push(`    ${escaped}`);
      lines.push('  </rule>');
    }
    lines.push('</rules>');

    return lines.join('\n');
  }

  /**
   * Invalidate the cache (e.g., after file changes).
   */
  invalidateCache(): void {
    this.cachedRules = null;
  }
}
