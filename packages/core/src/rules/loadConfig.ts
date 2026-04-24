import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';
import { RulesConfigError } from './types.js';
import type { RulesConfig } from './types.js';

const RuleSchema = z.object({
  name: z.string(),
  type: z.literal('no-import'),
  from: z.string(),
  to: z.string(),
  severity: z.enum(['error', 'warn']).optional(),
});

const RulesConfigSchema = z.object({
  version: z.literal(1),
  rules: z.array(RuleSchema).default([]),
});

export async function loadRulesConfig(rootDir: string): Promise<RulesConfig | null> {
  const filePath = path.join(rootDir, '.ctxloom', 'rules.yml');

  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new RulesConfigError(`Failed to read rules config: ${String(err)}`);
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (err: unknown) {
    throw new RulesConfigError(`Invalid YAML in .ctxloom/rules.yml: ${String(err)}`);
  }

  const result = RulesConfigSchema.safeParse(parsed);
  if (!result.success) {
    const messages = result.error.errors
      .map(e => `  ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new RulesConfigError(`Invalid .ctxloom/rules.yml schema:\n${messages}`);
  }

  return result.data as RulesConfig;
}
