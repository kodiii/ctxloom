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

export const CTXLOOM_SERVER: MCPServerEntry = {
  command: 'npx',
  args: ['-y', 'ctxloom'],
  env: {},
};

/**
 * Quote a string for safe YAML scalar emission. We deliberately avoid
 * pulling in a YAML library — the only emit case is the per-server
 * Continue file with a fixed shape (command string + args array of
 * strings + env map of strings). Hand-quoting covers the only escape
 * concern (embedded double-quotes, control chars). If the value is
 * "simple" (alphanum + a few punctuation) we emit it bare; otherwise
 * we wrap in double quotes and escape `\` and `"`.
 *
 * Exported only for tests — the symbol is internal to the YAML writer.
 */
export function yamlEscape(s: string): string {
  // Bare-safe pattern: starts with alphanum/./_/-, no whitespace or
  // YAML-meaningful chars. Conservative — wrapping is always safe.
  if (/^[A-Za-z0-9_./-][A-Za-z0-9_./@-]*$/.test(s)) return s;
  const escaped = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

// If installed globally, use direct command instead of npx.
// Cached after first check — result is stable for the lifetime of the process.
let _serverEntry: MCPServerEntry | undefined;
function getServerEntry(): MCPServerEntry {
  if (_serverEntry) return _serverEntry;
  // Use `which`/`where` to check existence — never run ctxloom directly here,
  // since it starts an MCP server instead of exiting (no --version flag).
  _serverEntry = commandExists('ctxloom')
    ? { command: 'ctxloom', args: [], env: {} }
    : CTXLOOM_SERVER;
  return _serverEntry;
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
  /**
   * Override for clients whose config layout doesn't fit the "merge a
   * server entry into a JSON file" model (Continue's per-server YAML
   * files, Codex's TOML, etc.). When defined:
   *   - addCtxloomToConfig() writes `customWriter(targetPath, entry)`
   *     verbatim to `targetPath` instead of doing a JSON merge.
   *   - The "already configured" check uses fs.existsSync against the
   *     target path — these formats are one file per server, so file
   *     presence IS the configuration signal.
   *
   * `targetPath` is the FIRST entry in `configPaths` — by convention
   * the workspace-scoped path so the install lands in the project the
   * user is in. Each client documents its own `configPaths[0]`.
   */
  customWriter?: (targetPath: string, entry: MCPServerEntry) => string;
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
    // Vendor docs (Cursor team, verified 2026-05) list TWO canonical paths:
    //   - `<repo>/.cursor/mcp.json` (project-scoped — the documented default)
    //   - `~/.cursor/mcp.json`       (user-scoped, applies to every project)
    // The XDG-style paths in the old list were speculative; Cursor never
    // shipped them. Project-root scope goes FIRST so a per-project install
    // matches the canonical workflow before we touch the user-wide config.
    configPaths: [
      path.join(process.cwd(), '.cursor', 'mcp.json'),
      path.join(HOME, '.cursor', 'mcp.json'),
      path.join(xdgConfig(), 'Cursor', 'User', 'globalStorage', 'cursor-mcp', 'mcp.json'),
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
  // v1.7.0 fix: current Continue (2026+) uses **per-server YAML files**
  // at `.continue/mcpServers/<name>.yaml` (workspace-scoped), NOT the
  // old `~/.continue/config.json` with embedded `experimental.mcpServers`.
  // Writing to the old path silently fails on current Continue — the
  // file is parsed but the section is ignored. Verified against
  // docs.continue.dev/customize/deep-dives/mcp (2026-05).
  //
  // The customWriter renders the entire YAML file because each MCP
  // server gets its own file; there's no merge step.
  {
    id: 'continue',
    name: 'Continue.dev',
    description: 'Continue open-source AI code assistant',
    // Workspace-scoped path FIRST (the canonical/correct path on
    // current Continue). Legacy user-scoped paths kept as detection
    // fallback so we still detect Continue's presence on machines
    // that haven't migrated their config yet.
    configPaths: [
      path.join(process.cwd(), '.continue', 'mcpServers', 'ctxloom.yaml'),
      path.join(HOME, '.continue', 'config.json'),
      path.join(xdgConfig(), 'continue', 'config.json'),
    ],
    cliBinaries: ['continue'],
    appBundles: [],
    usesMcpServersFormat: false,
    serversPath: 'mcpServers',
    customWriter: (_targetPath, entry) => {
      // Each YAML file has its own root. Continue's loader treats each
      // file as a single-element mcpServers array. We never need to
      // merge with existing content — if the file exists, it's ours
      // (and we're idempotent: re-writing the same content is a no-op).
      const envLines = entry.env && Object.keys(entry.env).length > 0
        ? '\n    env:\n' + Object.entries(entry.env)
            .map(([k, v]) => `      ${k}: ${yamlEscape(v)}`)
            .join('\n')
        : '';
      const argsLines = entry.args && entry.args.length > 0
        ? '\n    args:\n' + entry.args.map((a) => `      - ${yamlEscape(a)}`).join('\n')
        : '\n    args: []';
      return (
        '# Generated by `ctxloom setup` — Continue MCP server registration.\n' +
        '# Format: docs.continue.dev/customize/deep-dives/mcp\n' +
        'mcpServers:\n' +
        '  - name: ctxloom\n' +
        `    command: ${yamlEscape(entry.command)}` +
        argsLines +
        envLines +
        '\n'
      );
    },
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

  // ─── Zed ────────────────────────────────────────────────
  // Zed's MCP config lives under the main settings.json, NOT a
  // dedicated mcp.json. Critical wrinkle: the key is `context_servers`,
  // not the conventional `mcpServers` — silently ignored otherwise.
  // Verified against zed.dev/docs/ai/mcp (2026-05).
  {
    id: 'zed',
    name: 'Zed',
    description: 'Zed high-performance code editor',
    configPaths: [
      path.join(xdgConfig(), 'zed', 'settings.json'),
      path.join(HOME, '.config', 'zed', 'settings.json'),
    ],
    cliBinaries: ['zed'],
    appBundles: ['dev.zed.Zed', 'dev.zed.Zed-Preview'],
    usesMcpServersFormat: true,
    serversPath: 'context_servers',
  },

  // ─── Gemini CLI ─────────────────────────────────────────
  // Google's Gemini CLI tool. Workspace config wins over user config
  // when both exist; we list the workspace path first so a project
  // install lands where the user expects. Schema is standard
  // `mcpServers` per google-gemini/gemini-cli docs/cli/settings.md.
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    description: 'Google Gemini command-line AI agent',
    configPaths: [
      path.join(process.cwd(), '.gemini', 'settings.json'),
      path.join(HOME, '.gemini', 'settings.json'),
    ],
    cliBinaries: ['gemini'],
    appBundles: [],
    usesMcpServersFormat: true,
    serversPath: 'mcpServers',
  },

  // ─── Kiro ───────────────────────────────────────────────
  // Kiro IDE (kiro.dev). Both workspace + user configs are honored;
  // workspace overrides user per Kiro's docs. Schema is standard
  // `mcpServers`.
  {
    id: 'kiro',
    name: 'Kiro',
    description: 'Kiro AI-first IDE',
    configPaths: [
      path.join(process.cwd(), '.kiro', 'settings', 'mcp.json'),
      path.join(HOME, '.kiro', 'settings', 'mcp.json'),
    ],
    cliBinaries: ['kiro'],
    appBundles: ['dev.kiro.Kiro'],
    usesMcpServersFormat: true,
    serversPath: 'mcpServers',
  },

  // ─── OpenCode ───────────────────────────────────────────
  // Project-root configured. Critical wrinkle: the key is `mcp`
  // (not `mcpServers`) — code-review-graph's PLATFORMS dict had
  // this wrong; verified against opencode.ai/docs/mcp-servers.
  // Supports both .json and .jsonc extensions.
  {
    id: 'opencode',
    name: 'OpenCode',
    description: 'OpenCode agentic coding tool',
    configPaths: [
      path.join(process.cwd(), 'opencode.json'),
      path.join(process.cwd(), 'opencode.jsonc'),
    ],
    cliBinaries: ['opencode'],
    appBundles: [],
    usesMcpServersFormat: true,
    serversPath: 'mcp',
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

        // customWriter clients (Continue per-server YAML, etc.) have
        // a 1:1 "file == server entry" relationship. If the target
        // file exists at all, ctxloom is already configured for that
        // host. We DO NOT JSON.parse the file — it's YAML/TOML/etc.
        if (client.customWriter) {
          // Only treat the FIRST configPath (the workspace-scoped
          // canonical write target) as the "already configured"
          // signal. Fallback paths in the list are detection-only
          // for legacy config layouts that we don't write to anymore.
          if (cp === client.configPaths[0]) {
            alreadyConfigured = true;
          }
          break;
        }

        // Standard JSON-merge clients: parse the file and look for
        // the ctxloom key inside the configured servers path.
        try {
          const content = fs.readFileSync(cp, 'utf-8');
          const config = JSON.parse(content);
          const servers = getNestedValue(config, client.serversPath);
          if (servers && (servers as Record<string, unknown>)['ctxloom']) {
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
    // Use execFileSync (not execSync) to avoid shell injection via cmd interpolation
    const result = execFileSync(checkCmd, [cmd], {
      encoding: 'utf-8',
      timeout: 500,
      stdio: 'pipe',
    });
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Add ctxloom to a client's MCP config file.
 * Creates the file if it doesn't exist, preserves existing config.
 */
export function addCtxloomToConfig(detected: DetectedClient): { success: boolean; message: string } {
  const { client, configPath, configExists, alreadyConfigured } = detected;

  if (alreadyConfigured) {
    return { success: true, message: `ctxloom is already configured in ${client.name}` };
  }

  // ── customWriter branch (Continue per-server YAML, Codex TOML, etc.)
  // These formats don't fit the "merge a server entry into a JSON object"
  // model — each file is single-purpose and we render the whole thing.
  // The target path is `configPaths[0]` by convention (workspace-scoped).
  if (client.customWriter) {
    const targetPath = client.configPaths[0];
    const serverEntry = getServerEntry();
    const content = client.customWriter(targetPath, serverEntry);
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    try {
      fs.writeFileSync(targetPath, content, 'utf-8');
      return { success: true, message: `Added ctxloom to ${client.name} (${targetPath})` };
    } catch (err) {
      return { success: false, message: `Failed to write config at ${targetPath}: ${err}` };
    }
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
  (servers as Record<string, unknown>)['ctxloom'] = entryValue;

  // Ensure directory exists
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write back
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    return { success: true, message: `Added ctxloom to ${client.name} (${configPath})` };
  } catch (err) {
    return { success: false, message: `Failed to write config at ${configPath}: ${err}` };
  }
}

/**
 * Remove ctxloom from a client's MCP config file.
 */
export function removeCtxloomFromConfig(detected: DetectedClient): { success: boolean; message: string } {
  const { client, configPath, configExists } = detected;

  if (!configExists) {
    return { success: true, message: `No config file found for ${client.name}` };
  }

  // customWriter clients (Continue per-server YAML, etc.) use one
  // file per server — uninstall is a file removal, not a JSON edit.
  // We only remove the canonical workspace-scoped path (configPaths[0]);
  // legacy paths are detection-only and not safe to delete.
  if (client.customWriter) {
    const targetPath = client.configPaths[0];
    if (!fs.existsSync(targetPath)) {
      return { success: true, message: `ctxloom not found in ${client.name} config` };
    }
    try {
      fs.unlinkSync(targetPath);
      return { success: true, message: `Removed ctxloom from ${client.name} (${targetPath})` };
    } catch (err) {
      return { success: false, message: `Failed to remove config at ${targetPath}: ${err}` };
    }
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content);
    const servers = getNestedValue(config, client.serversPath);

    if (!servers || !(servers as Record<string, unknown>).ctxloom) {
      return { success: true, message: `ctxloom not found in ${client.name} config` };
    }

    delete (servers as Record<string, unknown>)['ctxloom'];
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    return { success: true, message: `Removed ctxloom from ${client.name} (${configPath})` };
  } catch (err) {
    return { success: false, message: `Failed to update config at ${configPath}: ${err}` };
  }
}
