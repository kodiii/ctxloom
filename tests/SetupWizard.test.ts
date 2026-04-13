/**
 * SetupWizard.test.ts — Tests for the MCP client detection and configuration.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MCP_CLIENTS, detectInstalledClients, addContextMeshToConfig, removeContextMeshFromConfig, type DetectedClient } from '../src/setup/clients.js';

const HOME = os.homedir();

describe('MCP Clients Registry', () => {
  it('should define all expected MCP clients', () => {
    const expectedIds = [
      'claude-desktop', 'claude-code', 'cursor', 'vscode',
      'windsurf', 'augment', 'kilo-code', 'continue',
      'aider', 'codex', 'kimi', 'qwen', 'jetbrains',
    ];
    const actualIds = MCP_CLIENTS.map(c => c.id);
    for (const id of expectedIds) {
      expect(actualIds).toContain(id);
    }
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

describe('addContextMeshToConfig', () => {
  const tmpDir = path.join(os.tmpdir(), 'contextmesh-test-config-' + process.pid);

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

    const result = addContextMeshToConfig(detected);
    expect(result.success).toBe(true);

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(written.mcpServers).toBeDefined();
    expect(written.mcpServers.contextmesh).toBeDefined();
    expect(written.mcpServers.contextmesh.command).toBeDefined();
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

    const result = addContextMeshToConfig(detected);
    expect(result.success).toBe(true);

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(written.mcpServers['other-tool']).toBeDefined();
    expect(written.mcpServers.contextmesh).toBeDefined();
  });

  it('should skip if already configured', () => {
    const configPath = path.join(tmpDir, 'mcp.json');
    const existing = {
      mcpServers: {
        contextmesh: { command: 'npx', args: ['-y', 'contextmesh'] },
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));

    const detected: DetectedClient = {
      client: MCP_CLIENTS.find(c => c.id === 'cursor')!,
      configPath,
      configExists: true,
      alreadyConfigured: true,
    };

    const result = addContextMeshToConfig(detected);
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

    const result = addContextMeshToConfig(detected);
    expect(result.success).toBe(true);

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const continueEntry = written.experimental?.mcpServers?.contextmesh;
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

    const result = addContextMeshToConfig(detected);
    expect(result.success).toBe(true);

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(written.servers).toBeDefined();
    expect(written.servers.contextmesh).toBeDefined();
  });
});

describe('removeContextMeshFromConfig', () => {
  const tmpDir = path.join(os.tmpdir(), 'contextmesh-test-remove-' + process.pid);

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should remove contextmesh from existing config', () => {
    const configPath = path.join(tmpDir, 'mcp.json');
    const existing = {
      mcpServers: {
        contextmesh: { command: 'npx', args: ['-y', 'contextmesh'] },
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

    const result = removeContextMeshFromConfig(detected);
    expect(result.success).toBe(true);

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(written.mcpServers.contextmesh).toBeUndefined();
    expect(written.mcpServers['other-tool']).toBeDefined();
  });

  it('should handle missing config file gracefully', () => {
    const detected: DetectedClient = {
      client: MCP_CLIENTS.find(c => c.id === 'cursor')!,
      configPath: '/nonexistent/path/mcp.json',
      configExists: false,
      alreadyConfigured: false,
    };

    const result = removeContextMeshFromConfig(detected);
    expect(result.success).toBe(true);
  });
});
