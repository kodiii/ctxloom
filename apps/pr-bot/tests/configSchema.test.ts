import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { RepoConfigSchema, DEFAULT_CONFIG } from '../src/config.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(__dirname, '..', 'schema', 'ctxloom.schema.json');

interface JsonSchemaShape {
  type: string;
  additionalProperties: boolean;
  properties: Record<string, { default?: unknown }>;
}

describe('ctxloom.schema.json drift guard', () => {
  // Loads the schema once for the suite — keeps each test small.
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8')) as JsonSchemaShape;
  const zodKeys = Object.keys(RepoConfigSchema.shape).sort();
  const schemaKeys = Object.keys(schema.properties).sort();

  it('JSON Schema property set matches the Zod schema', () => {
    expect(schemaKeys).toEqual(zodKeys);
  });

  it('JSON Schema disallows additional properties (matches Zod .strict())', () => {
    expect(schema.additionalProperties).toBe(false);
  });

  it('JSON Schema defaults match DEFAULT_CONFIG', () => {
    for (const key of schemaKeys) {
      const schemaDefault = schema.properties[key]?.default;
      const zodDefault = (DEFAULT_CONFIG as Record<string, unknown>)[key];
      expect(schemaDefault).toEqual(zodDefault);
    }
  });
});
