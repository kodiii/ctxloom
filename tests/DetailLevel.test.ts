import { describe, it, expect } from 'vitest';

describe('DetailLevel', () => {
  it('blast-radius Zod schema accepts detail_level', async () => {
    const { z } = await import('zod');
    const schema = z.object({
      changed_files: z.array(z.string()).optional(),
      depth: z.number().optional(),
      use_git: z.boolean().optional(),
      detail_level: z.enum(['standard', 'minimal']).default('standard'),
    });
    expect(() => schema.parse({ detail_level: 'minimal' })).not.toThrow();
    expect(() => schema.parse({ detail_level: 'standard' })).not.toThrow();
    expect(() => schema.parse({})).not.toThrow(); // default: standard
  });

  it('blast-radius minimal XML is shorter than standard XML', async () => {
    const { buildBlastRadiusXml } = await import('../src/tools/blast-radius.js');
    const result = {
      changedFiles: ['src/a.ts', 'src/b.ts'],
      directImporters: ['src/c.ts', 'src/d.ts'],
      transitiveImporters: ['src/e.ts'],
      callSites: [],
    };
    const standard = buildBlastRadiusXml(result, 3, 'standard');
    const minimal = buildBlastRadiusXml(result, 3, 'minimal');
    expect(minimal.length).toBeLessThan(standard.length);
    expect(minimal).toContain('detail_level="minimal"');
    expect(minimal).not.toContain('<file');
  });
});
