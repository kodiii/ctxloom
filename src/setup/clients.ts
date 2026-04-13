/**
 * clients.ts — MCP client definitions and config file paths.
 *
 * Each client entry defines:
 *   - How to detect if the tool is installed (config paths, CLI binaries, app bundles)
 *   - Where its MCP server config lives
 *   - What the config format looks like
 *
 * Supported clients:
 *   Claude Desktop, Claude Code, Cursor, VS Code (Copilot/GitHub MCP),
 *   Windsurf (Codeium), Augment Code, Kilo Code, Continue.dev,
 *   Aider, Codex CLI, Kimi, Qwen
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';

const HOME = os.homedir();
const PLATFORM = process.platform; // 'darwin' | 'win32' | 'linux'

// ─── Path helpers ──────────────────────────────────────────────

function xdgConfig(): string {
  if (PLATFORM === 'darwin') return path.join(HOME, 'Library', 'Application Support');
  if (PLATFORM === 'win32') return process.env.APPDATA ?? path.join(HOME, 'AppData', 'Roaming');
  return process.env.XDG_CONFIG_HOME ?? path.join(HOME, '.config');
}

function xdgData(): string {
  if (PLATFORM === 'darwin') return path.join(HOME, 'Library', 'Application Support');
  if (PLATFORM === 'win32') return process.env.APPDATA ?? path.join(HOME, 'AppData', 'Roaming');
  return process.env.XDG_DATA_HOME ?? path.join(HOME, '.local', 'share');
}

// ─── MCP Server Config Entry ──────────────────────────────────

export interface MCPServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export const CONTEXTMESH_SERVER: MCPServerEntry = {
  command: 'npx',
  args: ['-y', 'contextmesh'],
  env: {},
};

// If installed globally, use direct command instead of npx
function getServerEntry(): MCPServerEntry {
  try {
    execFileSync('contextmesh', ['--version'], { stdio: 'ignore', timeout: 3000 });
    return { command: 'contextmesh', args: [], env: {} };
  } catch {
    // Not installed globally, use npx
  }
  return CONTEXTMESH_SERVER;
}

// ─── Client Definitions ───────────────────────────────────────

export interface MCPClient {
  id: string;
  name: string;
  description: string;
  /** Config file paths to check (in priority order) */
  configPaths: string[];
  /** CLI binaries to check with `which`/`where` */
  cliBinaries: string[];
  /** macOS application bundle identifiers */
  appBundles: string[];
  /** Whether this client uses the standard mcpServers format */
  usesMcpServersFormat: boolean;
  /** JSON path to the servers object in the config file */
  serversPath: string;
  /** Custom config format (if not standard mcpServers) */
  formatConfig?: (entry: MCPServerEntry) => Record<string, unknown>;
}

export const MCP_CLIENTS: MCPClient[] = [
  // ─── Claude Desktop ───────────────────────────────────────
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    description: 'Anthropic Claude desktop application',
    configPaths: [
      path.join(HOME, '.claude', 'claude_desktop_config.json'),
      path.join(xdgConfig(), 'Claude', 'claude_desktop_config.json'),
    ],
    cliBinaries: ['claude-desktop'],
    appBundles: ['com.anthropic.claudedesktop'],
    usesMcpServersFormat: true,
    serversPath: 'mcpServers',
  },

  // ─── Claude Code (CLI) ───────────────────────────────────
  {
    id: 'claude-code',
    name: 'Claude Code',
    description: 'Anthropic Claude Code CLI agent',
    configPaths: [
      path.join(HOME, '.claude', 'mcp.json'),
      path.join(HOME, '.claude.json'),
    ],
    cliBinaries: ['claude'],
    appBundles: [],
    usesMcpServersFormat: true,
    serversPath: 'mcpServers',
  },

  // ─── Cursor ─────────────────────────────────────────────
  {
    id: 'cursor',
    name: 'Cursor',
    description: 'Cursor AI code editor',
    configPaths: [
      path.join(xdgConfig(), 'Cursor', 'User', 'globalStorage', 'cursor-mcp', 'mcp.json'),
      path.join(HOME, '.cursor', 'mcp.json'),
      path.join(xdgConfig(), 'Cursor', 'mcp.json'),
    ],
    cliBinaries: ['cursor'],
    appBundles: ['com.todesktop.230313mzl4w4u92'],
    usesMcpServersFormat: true,
    serversPath: 'mcpServers',
  },

  // ─── VS Code (GitHub Copilot MCP) ───────────────────────
  {
    id: 'vscode',
    name: 'VS Code',
    description: 'Visual Studio Code with MCP support',
    configPaths: [
      path.join(HOME, '.vscode', 'mcp.json'),
      path.join(xdgConfig(), 'Code', 'User', 'globalStorage', 'mcp.json'),
      path.join(xdgConfig(), 'Code - Insiders', 'User', 'globalStorage', 'mcp.json'),
    ],
    cliBinaries: ['code'],
    appBundles: ['com.microsoft.VSCode', 'com.microsoft.VSCodeInsiders'],
    usesMcpServersFormat: true,
    serversPath: 'servers',
  },

  // ─── Windsurf (Codeium) ──────────────────────────────────
  {
    id: 'windsurf',
    name: 'Windsurf',
    description: 'Windsurf AI code editor by Codeium',
    configPaths: [
      path.join(xdgConfig(), 'Windsurf', 'User', 'globalStorage', 'windsurf-mcp', 'mcp.json'),
      path.join(HOME, '.windsurf', 'mcp.json'),
    ],
    cliBinaries: ['windsurf'],
    appBundles: ['com.codeium.windsurf'],
    usesMcpServersFormat: true,
    serversPath: 'mcpServers',
  },

  // ─── Augment Code ───────────────────────────────────────
  {
    id: 'augment',
    name: 'Augment Code',
    description: 'Augment Code AI assistant',
    configPaths: [
      path.join(xdgConfig(), 'Augment', 'mcp.json'),
      path.join(HOME, '.augment', 'mcp.json'),
      path.join(xdgConfig(), 'Augment Code', 'mcp.json'),
    ],
    cliBinaries: ['augment'],
    appBundles: [],
    usesMcpServersFormat: true,
    serversPath: 'mcpServers',
  },

  // ─── Kilo Code ──────────────────────────────────────────
  {
    id: 'kilo-code',
    name: 'Kilo Code',
    description: 'Kilo Code AI coding assistant',
    configPaths: [
      path.join(xdgConfig(), 'KiloCode', 'mcp.json'),
      path.join(HOME, '.kilocode', 'mcp.json'),
    ],
    cliBinaries: ['kilo-code', 'kilocode'],
    appBundles: [],
    usesMcpServersFormat: true,
    serversPath: 'mcpServers',
  },

  // ─── Continue.dev ───────────────────────────────────────
  {
    id: 'continue',
    name: 'Continue.dev',
    description: 'Continue open-source AI code assistant',
    configPaths: [
      path.join(HOME, '.continue', 'config.json'),
      path.join(xdgConfig(), 'continue', 'config.json'),
    ],
    cliBinaries: ['continue'],
    appBundles: [],
    usesMcpServersFormat: false,
    serversPath: 'experimental.mcpServers',
    formatConfig: (entry) => ({
      command: entry.command,
      args: entry.args,
      transport: 'stdio',
    }),
  },

  // ─── Aider ──────────────────────────────────────────────
  {
    id: 'aider',
    name: 'Aider',
    description: 'Aider AI pair programming CLI',
    configPaths: [
      path.join(HOME, '.aider', 'mcp.json'),
      path.join(xdgConfig(), 'aider', 'mcp.json'),
    ],
    cliBinaries: ['aider'],
    appBundles: [],
    usesMcpServersFormat: true,
    serversPath: 'mcpServers',
  },

  // ─── Codex CLI (OpenAI) ─────────────────────────────────
  {
    id: 'codex',
    name: 'Codex CLI',
    description: 'OpenAI Codex CLI agent',
    configPaths: [
      path.join(HOME, '.codex', 'mcp.json'),
      path.join(xdgConfig(), 'codex', 'mcp.json'),
    ],
    cliBinaries: ['codex'],
    appBundles: [],
    usesMcpServersFormat: true,
    serversPath: 'mcpServers',
  },

  // ─── Kimi ───────────────────────────────────────────────
  {
    id: 'kimi',
    name: 'Kimi',
    description: 'Moonshot AI Kimi coding assistant',
    configPaths: [
      path.join(HOME, '.kimi', 'mcp.json'),
      path.join(xdgConfig(), 'kimi', 'mcp.json'),
    ],
    cliBinaries: ['kimi'],
    appBundles: [],
    usesMcpServersFormat: true,
    serversPath: 'mcpServers',
  },

  // ─── Qwen (Alibaba) ─────────────────────────────────────
  {
    id: 'qwen',
    name: 'Qwen Code',
    description: 'Alibaba Qwen coding assistant',
    configPaths: [
      path.join(HOME, '.qwen', 'mcp.json'),
      path.join(xdgConfig(), 'qwen', 'mcp.json'),
    ],
    cliBinaries: ['qwen-code', 'qwen'],
    appBundles: [],
    usesMcpServersFormat: true,
    serversPath: 'mcpServers',
  },

  // ─── JetBrains AI ───────────────────────────────────────
  {
    id: 'jetbrains',
    name: 'JetBrains AI',
    description: 'JetBrains IDE with AI assistant',
    configPaths: [
      path.join(xdgConfig(), 'JetBrains', 'ai-mcp.json'),
    ],
    cliBinaries: [],
    appBundles: ['com.jetbrains.intellij'],
    usesMcpServersFormat: true,
    serversPath: 'mcpServers',
  },
];

// ─── Detection logic ──────────────────────────────────────────

export interface DetectedClient {
  client: MCPClient;
  configPath: string;
  configExists: boolean;
  alreadyConfigured: boolean;
}

/**
 * Detect which MCP clients are installed on the system.
 * Checks config files, CLI binaries, and application bundles.
 */
export function detectInstalledClients(): DetectedClient[] {
  const results: DetectedClient[] = [];

  for (const client of MCP_CLIENTS) {
    let detected = false;
    let configPath = '';
    let configExists = false;
    let alreadyConfigured = false;

    // Check config files
    for (const cp of client.configPaths) {
      if (fs.existsSync(cp)) {
        detected = true;
        configPath = cp;
        configExists = true;

        // Check if contextmesh is already configured
        try {
          const content = fs.readFileSync(cp, 'utf-8');
          const config = JSON.parse(content);
          const servers = getNestedValue(config, client.serversPath);
          if (servers && (servers as Record<string, unknown>)['contextmesh']) {
            alreadyConfigured = true;
          }
        } catch {
          // Config file exists but may be malformed — we'll still detect it
        }
        break;
      }
    }

    // Check CLI binaries (if not already detected via config)
    if (!detected) {
      for (const bin of client.cliBinaries) {
        if (commandExists(bin)) {
          detected = true;
          // Use the first config path as the target (even if it doesn't exist yet)
          configPath = client.configPaths[0];
          break;
        }
      }
    }

    // Check macOS app bundles (if not already detected)
    if (!detected && PLATFORM === 'darwin') {
      for (const bundle of client.appBundles) {
        // Check common macOS application locations
        const appLocations = [
          `/Applications/${bundle.split('.').pop()}.app`,
          path.join(HOME, 'Applications', `${bundle.split('.').pop()}.app`),
        ];
        for (const loc of appLocations) {
          if (fs.existsSync(loc)) {
            detected = true;
            configPath = client.configPaths[0];
            break;
          }
        }
        if (detected) break;
      }
    }

    if (detected) {
      results.push({
        client,
        configPath,
        configExists,
        alreadyConfigured,
      });
    }
  }

  return results;
}

/**
 * Get a nested value from an object using a dot-separated path.
 * e.g., getNestedValue(obj, 'mcpServers') or getNestedValue(obj, 'experimental.mcpServers')
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Set a nested value in an object using a dot-separated path.
 */
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in current) || typeof current[parts[i]] !== 'object') {
      current[parts[i]] = {};
    }
    current = current[parts[i]] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

/**
 * Check if a command exists in PATH.
 */
function commandExists(cmd: string): boolean {
  const isWin = PLATFORM === 'win32';
  const checkCmd = isWin ? 'where' : 'which';
  try {
    const result = execSync(
      `${checkCmd} ${cmd} 2>/dev/null`,
      { encoding: 'utf-8', timeout: 3000, stdio: 'pipe' },
    );
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Add ContextMesh to a client's MCP config file.
 * Creates the file if it doesn't exist, preserves existing config.
 */
export function addContextMeshToConfig(detected: DetectedClient): { success: boolean; message: string } {
  const { client, configPath, configExists, alreadyConfigured } = detected;

  if (alreadyConfigured) {
    return { success: true, message: `ContextMesh is already configured in ${client.name}` };
  }

  let config: Record<string, unknown>;

  if (configExists) {
    // Read existing config
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      config = JSON.parse(content);
    } catch {
      return { success: false, message: `Failed to parse existing config at ${configPath}` };
    }
  } else {
    // Create new config
    config = {};
  }

  // Build the server entry
  const serverEntry = getServerEntry();
  const entryValue = client.formatConfig
    ? client.formatConfig(serverEntry)
    : { command: serverEntry.command, args: serverEntry.args, ...(serverEntry.env && Object.keys(serverEntry.env).length > 0 ? { env: serverEntry.env } : {}) };

  // Set the nested value
  let servers = getNestedValue(config, client.serversPath);
  if (!servers || typeof servers !== 'object') {
    setNestedValue(config, client.serversPath, {});
    servers = getNestedValue(config, client.serversPath);
  }
  (servers as Record<string, unknown>)['contextmesh'] = entryValue;

  // Ensure directory exists
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write back
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    return { success: true, message: `Added ContextMesh to ${client.name} (${configPath})` };
  } catch (err) {
    return { success: false, message: `Failed to write config at ${configPath}: ${err}` };
  }
}

/**
 * Remove ContextMesh from a client's MCP config file.
 */
export function removeContextMeshFromConfig(detected: DetectedClient): { success: boolean; message: string } {
  const { client, configPath, configExists } = detected;

  if (!configExists) {
    return { success: true, message: `No config file found for ${client.name}` };
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content);
    const servers = getNestedValue(config, client.serversPath);

    if (!servers || !(servers as Record<string, unknown>).contextmesh) {
      return { success: true, message: `ContextMesh not found in ${client.name} config` };
    }

    delete (servers as Record<string, unknown>)['contextmesh'];
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    return { success: true, message: `Removed ContextMesh from ${client.name} (${configPath})` };
  } catch (err) {
    return { success: false, message: `Failed to update config at ${configPath}: ${err}` };
  }
}
