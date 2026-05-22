/**
 * SetupWizard.test.ts — Tests for the MCP client detection and configuration.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MCP_CLIENTS, detectInstalledClients, addCtxloomToConfig, removeCtxloomFromConfig, type DetectedClient } from '../src/setup/clients.js';

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

  it('should handle Continue.dev custom format', () => {
    const configPath = path.join(tmpDir, 'config.json');
    const detected: DetectedClient = {
      client: MCP_CLIENTS.find(c => c.id === 'continue')!,
      configPath,
      configExists: false,
      alreadyConfigured: false,
    };

    const result = addCtxloomToConfig(detected);
    expect(result.success).toBe(true);

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const continueEntry = written.experimental?.mcpServers?.ctxloom;
    expect(continueEntry).toBeDefined();
    expect(continueEntry.transport).toBe('stdio');
  });

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
