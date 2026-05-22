/**
 * SetupWizard.test.ts — Tests for the MCP client detection and configuration.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MCP_CLIENTS, detectInstalledClients, addCtxloomToConfig, removeCtxloomFromConfig, yamlEscape, tomlString, type DetectedClient } from '../src/setup/clients.js';

const HOME = os.homedir();

describe('MCP Clients Registry', () => {
  it('should define all expected MCP clients', () => {
    const expectedIds = [
      'claude-desktop', 'claude-code', 'cursor', 'vscode',
      'windsurf', 'augment', 'kilo-code', 'continue',
      'aider', 'codex', 'kimi', 'qwen', 'jetbrains',
      // v1.7.0 additions per docs/host-adapters-verification.md
      'zed', 'gemini-cli', 'kiro', 'opencode',
    ];
    const actualIds = MCP_CLIENTS.map(c => c.id);
    for (const id of expectedIds) {
      expect(actualIds).toContain(id);
    }
  });

  // ── v1.7.0: 4 new hosts (Zed, Gemini CLI, Kiro, OpenCode) ──────────
  // Each registry entry must agree with docs/host-adapters-verification.md.
  // Pin the critical wrinkles below — they're the bugs we found in
  // code-review-graph's PLATFORMS dict that we explicitly avoided
  // replicating.

  it('Zed uses `context_servers` (NOT the conventional `mcpServers`)', () => {
    const zed = MCP_CLIENTS.find((c) => c.id === 'zed');
    expect(zed).toBeDefined();
    // The wrong key here would land the MCP config in a file Zed silently
    // ignores. Pinning the key in a test catches accidental "fix" reverts.
    expect(zed!.serversPath).toBe('context_servers');
  });

  it('OpenCode uses `mcp` (NOT the conventional `mcpServers`)', () => {
    const oc = MCP_CLIENTS.find((c) => c.id === 'opencode');
    expect(oc).toBeDefined();
    // Same trap as Zed — code-review-graph's PLATFORMS dict has this wrong.
    expect(oc!.serversPath).toBe('mcp');
    // Both .json and .jsonc extensions are valid per opencode docs.
    expect(oc!.configPaths.some((p) => p.endsWith('opencode.json'))).toBe(true);
    expect(oc!.configPaths.some((p) => p.endsWith('opencode.jsonc'))).toBe(true);
  });

  it('Gemini CLI checks workspace-scoped path before user-scoped', () => {
    const g = MCP_CLIENTS.find((c) => c.id === 'gemini-cli');
    expect(g).toBeDefined();
    // Workspace wins per vendor docs — list it first so detectInstalledClients
    // picks it up before the user-wide settings file.
    expect(g!.configPaths[0]).toContain('.gemini');
    expect(g!.serversPath).toBe('mcpServers');
  });

  it('Kiro splits config under settings/ subdirectory', () => {
    const k = MCP_CLIENTS.find((c) => c.id === 'kiro');
    expect(k).toBeDefined();
    // Kiro nests its MCP config one level deeper than most hosts:
    // `.kiro/settings/mcp.json` (NOT `.kiro/mcp.json`).
    expect(k!.configPaths.some((p) => p.includes(path.join('.kiro', 'settings', 'mcp.json')))).toBe(true);
  });

  it('Cursor v1.7.0 now detects the project-root `.cursor/mcp.json` path', () => {
    const c = MCP_CLIENTS.find((c) => c.id === 'cursor');
    expect(c).toBeDefined();
    // The canonical Cursor workflow is per-project — without this entry
    // we'd auto-detect Cursor at the user level but never install ctxloom
    // in the project's local cursor config where users actually expect it.
    expect(c!.configPaths.some((p) => p === path.join(process.cwd(), '.cursor', 'mcp.json'))).toBe(true);
  });

  it('each client should have required fields', () => {
    for (const client of MCP_CLIENTS) {
      expect(client.id).toBeTruthy();
      expect(client.name).toBeTruthy();
      expect(client.description).toBeTruthy();
      expect(client.configPaths.length).toBeGreaterThan(0);
      expect(client.serversPath).toBeTruthy();
    }
  });

  it('each client should have at least one detection method', () => {
    for (const client of MCP_CLIENTS) {
      const hasDetection = client.configPaths.length > 0
        || client.cliBinaries.length > 0
        || client.appBundles.length > 0;
      expect(hasDetection).toBe(true);
    }
  });
});

describe('detectInstalledClients', () => {
  it('should return an array (may be empty on test machines)', () => {
    const result = detectInstalledClients();
    expect(Array.isArray(result)).toBe(true);
  });

  it('should not crash if no clients are installed', () => {
    // This tests the function runs without error regardless of environment
    expect(() => detectInstalledClients()).not.toThrow();
  });
});

describe('addCtxloomToConfig', () => {
  const tmpDir = path.join(os.tmpdir(), 'ctxloom-test-config-' + process.pid);

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should create a new config file if none exists', () => {
    const configPath = path.join(tmpDir, 'mcp.json');
    const detected: DetectedClient = {
      client: MCP_CLIENTS.find(c => c.id === 'cursor')!,
      configPath,
      configExists: false,
      alreadyConfigured: false,
    };

    const result = addCtxloomToConfig(detected);
    expect(result.success).toBe(true);

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(written.mcpServers).toBeDefined();
    expect(written.mcpServers.ctxloom).toBeDefined();
    expect(written.mcpServers.ctxloom.command).toBeDefined();
  });

  it('should add to existing config without overwriting other entries', () => {
    const configPath = path.join(tmpDir, 'mcp.json');
    const existing = {
      mcpServers: {
        'other-tool': { command: 'other', args: [] },
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));

    const detected: DetectedClient = {
      client: MCP_CLIENTS.find(c => c.id === 'cursor')!,
      configPath,
      configExists: true,
      alreadyConfigured: false,
    };

    const result = addCtxloomToConfig(detected);
    expect(result.success).toBe(true);

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(written.mcpServers['other-tool']).toBeDefined();
    expect(written.mcpServers.ctxloom).toBeDefined();
  });

  it('should skip if already configured', () => {
    const configPath = path.join(tmpDir, 'mcp.json');
    const existing = {
      mcpServers: {
        ctxloom: { command: 'npx', args: ['-y', 'ctxloom'] },
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));

    const detected: DetectedClient = {
      client: MCP_CLIENTS.find(c => c.id === 'cursor')!,
      configPath,
      configExists: true,
      alreadyConfigured: true,
    };

    const result = addCtxloomToConfig(detected);
    expect(result.success).toBe(true);
    expect(result.message).toContain('already configured');
  });

  // (Note: the Continue.dev format was migrated in v1.7.0 from
  //  experimental.mcpServers JSON to per-server YAML files at
  //  .continue/mcpServers/<name>.yaml. The replacement coverage
  //  lives under the "Continue per-server YAML writer" describe
  //  block at the end of this file — it exercises the customWriter
  //  path, idempotency, file-based "already configured" detection,
  //  and uninstall via file removal.)

  it('should handle VS Code servers format', () => {
    const configPath = path.join(tmpDir, 'mcp.json');
    const detected: DetectedClient = {
      client: MCP_CLIENTS.find(c => c.id === 'vscode')!,
      configPath,
      configExists: false,
      alreadyConfigured: false,
    };

    const result = addCtxloomToConfig(detected);
    expect(result.success).toBe(true);

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(written.servers).toBeDefined();
    expect(written.servers.ctxloom).toBeDefined();
  });
});

describe('removeCtxloomFromConfig', () => {
  const tmpDir = path.join(os.tmpdir(), 'ctxloom-test-remove-' + process.pid);

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should remove ctxloom from existing config', () => {
    const configPath = path.join(tmpDir, 'mcp.json');
    const existing = {
      mcpServers: {
        ctxloom: { command: 'npx', args: ['-y', 'ctxloom'] },
        'other-tool': { command: 'other', args: [] },
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));

    const detected: DetectedClient = {
      client: MCP_CLIENTS.find(c => c.id === 'cursor')!,
      configPath,
      configExists: true,
      alreadyConfigured: false,
    };

    const result = removeCtxloomFromConfig(detected);
    expect(result.success).toBe(true);

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(written.mcpServers.ctxloom).toBeUndefined();
    expect(written.mcpServers['other-tool']).toBeDefined();
  });

  it('should handle missing config file gracefully', () => {
    const detected: DetectedClient = {
      client: MCP_CLIENTS.find(c => c.id === 'cursor')!,
      configPath: '/nonexistent/path/mcp.json',
      configExists: false,
      alreadyConfigured: false,
    };

    const result = removeCtxloomFromConfig(detected);
    expect(result.success).toBe(true);
  });
});


// ─── v1.7.0: Continue per-server YAML (customWriter) ────────────────
// Continue's current format is fundamentally different from the
// JSON-merge model: one YAML file per MCP server at
// .continue/mcpServers/<name>.yaml. These tests pin the wire format
// because (a) regressing to the old JSON path would silently fail on
// current Continue, and (b) malformed YAML emit would break parsing
// without an obvious error.

describe('yamlEscape', () => {
  it('emits bare strings for safe alphanumeric values', () => {
    expect(yamlEscape('ctxloom')).toBe('ctxloom');
    expect(yamlEscape('npx')).toBe('npx');
    expect(yamlEscape('./bin/cmd-1')).toBe('./bin/cmd-1');
  });

  it('quotes strings with whitespace or YAML-meaningful chars', () => {
    expect(yamlEscape('hello world')).toBe('"hello world"');
    expect(yamlEscape('value: with colon')).toBe('"value: with colon"');
    expect(yamlEscape('')).toBe('""');
  });

  it('escapes embedded double-quotes and backslashes', () => {
    expect(yamlEscape('say "hi"')).toBe('"say \\"hi\\""');
    expect(yamlEscape('C:\\path')).toBe('"C:\\\\path"');
  });
});

describe('Continue per-server YAML writer', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'continue-yaml-'));
    originalCwd = process.cwd();
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes .continue/mcpServers/ctxloom.yaml on add (the corrected path)', () => {
    // Continue's MCP_CLIENTS entry uses customWriter — the workspace
    // path must lead configPaths so it gets picked up here.
    const client = MCP_CLIENTS.find((c) => c.id === 'continue')!;
    const expectedPath = path.join(tempDir, '.continue', 'mcpServers', 'ctxloom.yaml');
    // We can't easily reconstruct the dynamic configPath here because
    // the registry captured process.cwd() at module load — instead,
    // call addCtxloomToConfig with a manually-built detected object
    // whose first configPath points at our temp dir.
    const detected: DetectedClient = {
      client: {
        ...client,
        configPaths: [
          expectedPath,
          ...client.configPaths.slice(1),
        ],
      },
      configPath: expectedPath,
      configExists: false,
      alreadyConfigured: false,
    };

    const result = addCtxloomToConfig(detected);
    expect(result.success).toBe(true);
    expect(fs.existsSync(expectedPath)).toBe(true);

    // Pin the emitted shape — Continue parses each file as a single
    // mcpServers array entry. The "name: ctxloom" line + the
    // mcpServers: root are non-negotiable per Continue's schema.
    const content = fs.readFileSync(expectedPath, 'utf-8');
    expect(content).toContain('mcpServers:');
    expect(content).toContain('- name: ctxloom');
    expect(content).toMatch(/^\s*command:/m);
  });

  it('produces valid YAML structure (no smashed indentation)', () => {
    const client = MCP_CLIENTS.find((c) => c.id === 'continue')!;
    const expectedPath = path.join(tempDir, '.continue', 'mcpServers', 'ctxloom.yaml');
    addCtxloomToConfig({
      client: { ...client, configPaths: [expectedPath, ...client.configPaths.slice(1)] },
      configPath: expectedPath,
      configExists: false,
      alreadyConfigured: false,
    });

    const lines = fs.readFileSync(expectedPath, 'utf-8').split('\n');
    // Root key has no leading indent.
    expect(lines.find((l) => l.startsWith('mcpServers:'))).toBeDefined();
    // YAML structural alignment: the `name:` key starts at column 4
    // ("  - " is 2 spaces + dash + space) and its siblings start at
    // column 4 (4 literal spaces). They look "aligned" in a YAML viewer
    // even though `name:` has only 2 chars of LITERAL leading whitespace
    // (the dash isn't whitespace). Assert each line's structure separately:
    //   - The list-item line starts with the canonical YAML list marker
    //   - Sibling keys (command, args) start with 4 literal spaces — if
    //     anything is at 2 spaces, YAML re-interprets it as a new list
    //     entry instead of a key of the existing one.
    const nameLine = lines.find((l) => l.includes('name: ctxloom'));
    expect(nameLine).toMatch(/^  - name: ctxloom$/);
    const cmdLine = lines.find((l) => l.match(/^\s+command:/));
    expect(cmdLine?.match(/^\s*/)?.[0].length).toBe(4);
  });

  it('add is idempotent: re-running produces identical file contents', () => {
    const client = MCP_CLIENTS.find((c) => c.id === 'continue')!;
    const expectedPath = path.join(tempDir, '.continue', 'mcpServers', 'ctxloom.yaml');
    const detected: DetectedClient = {
      client: { ...client, configPaths: [expectedPath, ...client.configPaths.slice(1)] },
      configPath: expectedPath,
      configExists: false,
      alreadyConfigured: false,
    };
    addCtxloomToConfig(detected);
    const firstWrite = fs.readFileSync(expectedPath, 'utf-8');
    addCtxloomToConfig({ ...detected, configExists: true });
    const secondWrite = fs.readFileSync(expectedPath, 'utf-8');
    expect(secondWrite).toBe(firstWrite);
  });

  it('remove deletes the file (not just an entry inside it)', () => {
    const client = MCP_CLIENTS.find((c) => c.id === 'continue')!;
    const expectedPath = path.join(tempDir, '.continue', 'mcpServers', 'ctxloom.yaml');
    const baseDetected = {
      client: { ...client, configPaths: [expectedPath, ...client.configPaths.slice(1)] },
      configPath: expectedPath,
    };
    addCtxloomToConfig({ ...baseDetected, configExists: false, alreadyConfigured: false });
    expect(fs.existsSync(expectedPath)).toBe(true);

    const result = removeCtxloomFromConfig({
      ...baseDetected,
      configExists: true,
      alreadyConfigured: true,
    });
    expect(result.success).toBe(true);
    expect(fs.existsSync(expectedPath)).toBe(false);
  });

  it('detects "already configured" by file presence (not by JSON parse)', () => {
    const client = MCP_CLIENTS.find((c) => c.id === 'continue')!;
    const expectedPath = path.join(tempDir, '.continue', 'mcpServers', 'ctxloom.yaml');
    fs.mkdirSync(path.dirname(expectedPath), { recursive: true });
    fs.writeFileSync(expectedPath, 'mcpServers:\n  - name: ctxloom\n', 'utf-8');

    // Walking the actual detection function against a custom-writer
    // client would need real CWD manipulation; we simulate the
    // post-detection contract here. The key invariant is the writer's
    // behavior, not the global detection scan.
    const detected: DetectedClient = {
      client: { ...client, configPaths: [expectedPath, ...client.configPaths.slice(1)] },
      configPath: expectedPath,
      configExists: true,
      alreadyConfigured: true,
    };
    const result = addCtxloomToConfig(detected);
    expect(result.message).toMatch(/already configured/);
  });
});

// ─── v1.7.0: Codex TOML (shared-file customWriter) ─────────────────
// Codex's config.toml is shared with other settings (model, auth,
// sandbox). Unlike Continue's per-server YAML, we cannot just write
// the whole file — we must surgically add/update only the
// [mcp_servers.ctxloom] block while preserving everything else.

describe('tomlString', () => {
  it('wraps every string in double quotes (no bare form)', () => {
    expect(tomlString('ctxloom')).toBe('"ctxloom"');
    expect(tomlString('npx')).toBe('"npx"');
  });

  it('escapes backslashes and double-quotes', () => {
    expect(tomlString('C:\\path')).toBe('"C:\\\\path"');
    expect(tomlString('say "hi"')).toBe('"say \\"hi\\""');
  });

  it('escapes control characters', () => {
    expect(tomlString('line1\nline2')).toBe('"line1\\nline2"');
    expect(tomlString('col1\tcol2')).toBe('"col1\\tcol2"');
  });
});

describe('Codex TOML writer', () => {
  let tempDir: string;
  let originalCwd: string;
  const codex = MCP_CLIENTS.find((c) => c.id === 'codex')!;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-toml-'));
    originalCwd = process.cwd();
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function withCodex(targetPath: string): DetectedClient {
    return {
      client: { ...codex, configPaths: [targetPath, ...codex.configPaths.slice(1)] },
      configPath: targetPath,
      configExists: fs.existsSync(targetPath),
      alreadyConfigured: false,
    };
  }

  it('writes the corrected TOML path (NOT the old JSON path)', () => {
    // The OLD path was ~/.codex/mcp.json — silently failed on current
    // Codex. New canonical path: .codex/config.toml (workspace-scoped).
    expect(codex.configPaths[0]).toMatch(/\.codex.*config\.toml$/);
    // The old JSON path is still detected (legacy users with that file)
    // but it's NOT configPaths[0] — we never write to it.
    expect(codex.configPaths.some((p) => p.endsWith('mcp.json'))).toBe(true);
    expect(codex.configPaths[0]).not.toMatch(/mcp\.json$/);
  });

  it('uses the snake_case `mcp_servers` schema key (NOT `mcpServers`)', () => {
    expect(codex.serversPath).toBe('mcp_servers');
  });

  it('creates a fresh config.toml with the ctxloom block when file missing', () => {
    const target = path.join(tempDir, '.codex', 'config.toml');
    addCtxloomToConfig(withCodex(target));
    const content = fs.readFileSync(target, 'utf-8');
    expect(content).toContain('[mcp_servers.ctxloom]');
    expect(content).toMatch(/^command = "/m);
    expect(content).toMatch(/^args = \[/m);
  });

  it('PRESERVES existing TOML content when appending the ctxloom block', () => {
    // Simulate a real user's config.toml: model selection, auth, and
    // some other MCP server already registered. Pre-fix our writer
    // would (a) write the wrong path AND (b) the proposed writer must
    // not clobber unrelated entries.
    const target = path.join(tempDir, '.codex', 'config.toml');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const existing = [
      'model = "gpt-5"',
      '',
      '[auth]',
      'provider = "openai"',
      '',
      '[mcp_servers.other-tool]',
      'command = "other"',
      'args = ["--flag"]',
      '',
    ].join('\n');
    fs.writeFileSync(target, existing);

    addCtxloomToConfig(withCodex(target));
    const after = fs.readFileSync(target, 'utf-8');

    // Every line of the pre-existing config must still be present.
    expect(after).toContain('model = "gpt-5"');
    expect(after).toContain('[auth]');
    expect(after).toContain('provider = "openai"');
    expect(after).toContain('[mcp_servers.other-tool]');
    expect(after).toContain('command = "other"');
    // AND our entry was appended.
    expect(after).toContain('[mcp_servers.ctxloom]');
  });

  it('replaces (not duplicates) an existing [mcp_servers.ctxloom] block on re-add', () => {
    const target = path.join(tempDir, '.codex', 'config.toml');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, [
      '[mcp_servers.ctxloom]',
      'command = "stale-old-command"',
      'args = []',
      '',
    ].join('\n'));

    addCtxloomToConfig(withCodex(target));
    const after = fs.readFileSync(target, 'utf-8');

    // Stale block must be gone, not appended-after.
    expect(after).not.toContain('stale-old-command');
    // Only ONE [mcp_servers.ctxloom] TABLE HEADER should exist
    // (line-anchored — the writer's own comment includes the literal
    // string in prose, so a non-anchored match would false-positive).
    const headerMatches = after.match(/^\[mcp_servers\.ctxloom\]$/gm) ?? [];
    expect(headerMatches).toHaveLength(1);
  });

  it('customInstalledCheck detects ctxloom by TOML block header (not file existence)', () => {
    const target = path.join(tempDir, '.codex', 'config.toml');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // File exists but ONLY contains unrelated Codex config — must NOT
    // be reported as "already configured" or we'd silently skip install.
    fs.writeFileSync(target, 'model = "gpt-5"\n[auth]\nprovider = "openai"\n');
    expect(codex.customInstalledCheck!(target)).toBe(false);

    // Add our block — now the check should report true.
    fs.appendFileSync(target, '\n[mcp_servers.ctxloom]\ncommand = "ctxloom"\nargs = []\n');
    expect(codex.customInstalledCheck!(target)).toBe(true);
  });

  it('customRemove surgically removes only the ctxloom block', () => {
    const original = [
      'model = "gpt-5"',
      '',
      '# ctxloom — added by `ctxloom setup`. Safe to edit; the',
      '# installer only ever modifies the [mcp_servers.ctxloom]',
      '# block and never touches the rest of this file.',
      '[mcp_servers.ctxloom]',
      'command = "ctxloom"',
      'args = []',
      '',
      '[mcp_servers.other-tool]',
      'command = "other"',
      '',
    ].join('\n');
    const after = codex.customRemove!(original);
    expect(typeof after).toBe('string');
    expect(after).not.toContain('mcp_servers.ctxloom');
    expect(after).toContain('model = "gpt-5"');
    expect(after).toContain('[mcp_servers.other-tool]');
  });

  it('customRemove returns null when the file becomes empty after removal', () => {
    // If config.toml only ever had our block, removing it leaves an
    // empty file — better to delete than leave a zero-byte artifact.
    const onlyOurs = [
      '[mcp_servers.ctxloom]',
      'command = "ctxloom"',
      'args = []',
      '',
    ].join('\n');
    expect(codex.customRemove!(onlyOurs)).toBeNull();
  });

  it('full add → remove → file is deleted (when our block was the only content)', () => {
    const target = path.join(tempDir, '.codex', 'config.toml');
    const det = withCodex(target);
    addCtxloomToConfig(det);
    expect(fs.existsSync(target)).toBe(true);

    const removeResult = removeCtxloomFromConfig({ ...det, configExists: true, alreadyConfigured: true });
    expect(removeResult.success).toBe(true);
    expect(fs.existsSync(target)).toBe(false);
  });

  it('full add (on existing config) → remove → file kept, other content preserved', () => {
    const target = path.join(tempDir, '.codex', 'config.toml');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'model = "gpt-5"\n');

    const det = withCodex(target);
    addCtxloomToConfig({ ...det, configExists: true });
    expect(fs.readFileSync(target, 'utf-8')).toContain('[mcp_servers.ctxloom]');

    removeCtxloomFromConfig({ ...det, configExists: true, alreadyConfigured: true });
    const after = fs.readFileSync(target, 'utf-8');
    expect(after).toContain('model = "gpt-5"');
    expect(after).not.toContain('mcp_servers.ctxloom');
  });
});
