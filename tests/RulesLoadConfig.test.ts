import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadRulesConfig } from '../src/rules/loadConfig.js';
import { RulesConfigError } from '../src/rules/types.js';

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ctxloom-rules-test-'));
}

describe('loadRulesConfig', () => {
  it('returns null when .ctxloom/rules.yml is missing', async () => {
    const dir = await makeTmpDir();
    const result = await loadRulesConfig(dir);
    expect(result).toBeNull();
  });

  it('parses a valid rules.yml', async () => {
    const dir = await makeTmpDir();
    await fs.mkdir(path.join(dir, '.ctxloom'));
    await fs.writeFile(path.join(dir, '.ctxloom', 'rules.yml'), `
version: 1
rules:
  - name: "no infra in domain"
    type: no-import
    from: "src/domain/**"
    to: "src/infra/**"
    severity: error
`);
    const result = await loadRulesConfig(dir);
    expect(result).not.toBeNull();
    expect(result!.version).toBe(1);
    expect(result!.rules).toHaveLength(1);
    expect(result!.rules[0]!.name).toBe('no infra in domain');
    expect(result!.rules[0]!.from).toBe('src/domain/**');
    expect(result!.rules[0]!.severity).toBe('error');
  });

  it('allows severity to be omitted (Rule.severity is optional)', async () => {
    const dir = await makeTmpDir();
    await fs.mkdir(path.join(dir, '.ctxloom'));
    await fs.writeFile(path.join(dir, '.ctxloom', 'rules.yml'), `
version: 1
rules:
  - name: "no infra in domain"
    type: no-import
    from: "src/domain/**"
    to: "src/infra/**"
`);
    const result = await loadRulesConfig(dir);
    expect(result!.rules[0]!.severity).toBeUndefined();
  });

  it('accepts empty rules array', async () => {
    const dir = await makeTmpDir();
    await fs.mkdir(path.join(dir, '.ctxloom'));
    await fs.writeFile(path.join(dir, '.ctxloom', 'rules.yml'), 'version: 1\nrules: []\n');
    const result = await loadRulesConfig(dir);
    expect(result!.rules).toHaveLength(0);
  });

  it('throws RulesConfigError on invalid YAML', async () => {
    const dir = await makeTmpDir();
    await fs.mkdir(path.join(dir, '.ctxloom'));
    await fs.writeFile(path.join(dir, '.ctxloom', 'rules.yml'), 'key: [unclosed');
    await expect(loadRulesConfig(dir)).rejects.toBeInstanceOf(RulesConfigError);
  });

  it('throws RulesConfigError when version field is missing', async () => {
    const dir = await makeTmpDir();
    await fs.mkdir(path.join(dir, '.ctxloom'));
    await fs.writeFile(path.join(dir, '.ctxloom', 'rules.yml'), `
rules:
  - name: "no infra"
    type: no-import
    from: "src/**"
    to: "lib/**"
`);
    await expect(loadRulesConfig(dir)).rejects.toBeInstanceOf(RulesConfigError);
  });

  it('throws RulesConfigError when rule type is invalid', async () => {
    const dir = await makeTmpDir();
    await fs.mkdir(path.join(dir, '.ctxloom'));
    await fs.writeFile(path.join(dir, '.ctxloom', 'rules.yml'), `
version: 1
rules:
  - name: "bad type"
    type: must-import
    from: "src/**"
    to: "lib/**"
`);
    await expect(loadRulesConfig(dir)).rejects.toBeInstanceOf(RulesConfigError);
  });

  it('throws RulesConfigError when rule is missing required "from" field', async () => {
    const dir = await makeTmpDir();
    await fs.mkdir(path.join(dir, '.ctxloom'));
    await fs.writeFile(path.join(dir, '.ctxloom', 'rules.yml'), `
version: 1
rules:
  - name: "missing from"
    type: no-import
    to: "src/infra/**"
`);
    await expect(loadRulesConfig(dir)).rejects.toBeInstanceOf(RulesConfigError);
  });
});
