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
 * Quote a string for safe TOML scalar emission. The Codex config.toml
 * writer needs to render only string-valued fields (command, env
 * values) — TOML basic-strings wrap in double quotes and escape
 * `\`, `"`, and the standard control chars. We never need multi-line
 * or literal strings for our fixed-shape MCP server block.
 *
 * Exported only for tests — the symbol is internal to the TOML writer.
 */
export function tomlString(s: string): string {
  // TOML basic-string escapes: backslash, double-quote, newline/tab.
  // Other control chars get \uXXXX (rare in MCP configs but cheap).
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return `"${escaped}"`;
}

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
   *   - addCtxloomToConfig() reads existing content (or null if no
   *     file), calls customWriter, and writes the returned string
   *     back to `targetPath`.
   *   - The "already configured" check uses customInstalledCheck if
   *     provided, else falls back to fs.existsSync against the target.
   *
   * `targetPath` is the FIRST entry in `configPaths` — by convention
   * the workspace-scoped path so the install lands in the project the
   * user is in. Each client documents its own `configPaths[0]`.
   *
   * `existingContent` is the file's current contents (or null if no
   * file exists). Single-purpose hosts like Continue ignore it (each
   * file == one server entry, no merge); shared-file hosts like Codex
   * (config.toml may contain model/auth settings too) read it,
   * append-or-update their own block, and return the merged result.
   */
  customWriter?: (
    targetPath: string,
    entry: MCPServerEntry,
    existingContent: string | null,
  ) => string;
  /**
   * Override for "is ctxloom already in this file?" — defaults to
   * fs.existsSync(configPaths[0]). Required for shared-file customWriter
   * hosts (Codex TOML) where the file existing doesn't mean ctxloom
   * is in it.
   */
  customInstalledCheck?: (targetPath: string) => boolean;
  /**
   * Override for uninstall on customWriter hosts. Receives the current
   * file content and returns:
   *   - a string → write this content (block removed, file kept)
   *   - null     → delete the file entirely
   *
   * Defaults to "delete the file" (Continue's per-server YAML case —
   * the whole file IS ctxloom's entry). Shared-file hosts must define
   * this to surgically remove just their block.
   */
  customRemove?: (existingContent: string) => string | null;
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
    customWriter: (_targetPath, entry, _existingContent) => {
      // Continue ignores existingContent — each YAML file is single-
      // purpose (one MCP server per file), so we always render the
      // whole thing fresh. The new signature is shared with shared-file
      // writers like Codex.
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
  // v1.7.0 fix: current Codex (2026+) uses **TOML at config.toml**,
  // NOT JSON at mcp.json. The schema key is `mcp_servers` (snake_case
  // TOML), NOT `mcpServers`. Writing JSON to the old `.codex/mcp.json`
  // path silently fails on current Codex — the file is never read.
  // Verified against developers.openai.com/codex/config-reference
  // (2026-05).
  //
  // config.toml is SHARED with other Codex settings (model selection,
  // auth, sandbox prefs), so the writer reads existing content,
  // appends/updates ONLY the `[mcp_servers.ctxloom]` block, and
  // preserves everything else. We deliberately avoid pulling in a
  // TOML parser library — the only mutation is a single named-table
  // block, which append-or-replace by string match handles safely.
  {
    id: 'codex',
    name: 'Codex CLI',
    description: 'OpenAI Codex CLI agent',
    // Workspace path FIRST (canonical per Codex docs); user-scoped
    // path second (preserves detection on machines with Codex
    // installed but no project-local config yet).
    configPaths: [
      path.join(process.cwd(), '.codex', 'config.toml'),
      path.join(HOME, '.codex', 'config.toml'),
      // Legacy detection only — won't be written to. Kept so users
      // who created these in earlier ctxloom versions still get
      // detected (they need to migrate, but at least we surface them).
      path.join(HOME, '.codex', 'mcp.json'),
      path.join(xdgConfig(), 'codex', 'mcp.json'),
    ],
    cliBinaries: ['codex'],
    appBundles: [],
    usesMcpServersFormat: false,
    serversPath: 'mcp_servers',
    customInstalledCheck: (target) => {
      // "Already configured" iff the file contains a literal
      // `[mcp_servers.ctxloom]` table header. Robust to extra
      // whitespace per the TOML spec; not a full parser, but
      // sufficient for the only block we care about.
      try {
        const content = fs.readFileSync(target, 'utf-8');
        return /^\s*\[mcp_servers\.ctxloom\]\s*$/m.test(content);
      } catch {
        return false;
      }
    },
    customWriter: (_targetPath, entry, existingContent) => {
      // Render our standard block. We deliberately use the
      // table-of-tables form (`[mcp_servers.ctxloom]` + key/value
      // lines + optional `[mcp_servers.ctxloom.env]` subtable)
      // rather than inline tables — readable diffs, friendly to
      // `git blame` on the user's config.toml.
      const lines: string[] = [
        '# ctxloom — added by `ctxloom setup`. Safe to edit; the',
        '# installer only ever modifies the [mcp_servers.ctxloom]',
        '# block and never touches the rest of this file.',
        '[mcp_servers.ctxloom]',
        `command = ${tomlString(entry.command)}`,
        `args = [${(entry.args ?? []).map(tomlString).join(', ')}]`,
      ];
      if (entry.env && Object.keys(entry.env).length > 0) {
        lines.push('');
        lines.push('[mcp_servers.ctxloom.env]');
        for (const [k, v] of Object.entries(entry.env)) {
          lines.push(`${k} = ${tomlString(v)}`);
        }
      }
      const newBlock = lines.join('\n') + '\n';

      if (!existingContent) {
        // Fresh file: just our block.
        return newBlock;
      }

      // Replace an existing [mcp_servers.ctxloom] block if present,
      // else append. The match is anchored on the table header and
      // runs until the next top-level table or end of file. Subtable
      // `[mcp_servers.ctxloom.env]` is captured by this range too,
      // so the replacement cleanly swaps the whole entry.
      const blockRegex =
        /(^|\n)(?:#[^\n]*\n)*\[mcp_servers\.ctxloom\][\s\S]*?(?=\n\[(?!mcp_servers\.ctxloom)|$)/;
      if (blockRegex.test(existingContent)) {
        return existingContent.replace(blockRegex, (_m, leading) =>
          (leading === '\n' ? '\n' : '') + newBlock.trimEnd(),
        );
      }
      // Append with one blank-line separator from prior content.
      const sep = existingContent.endsWith('\n') ? '\n' : '\n\n';
      return existingContent + sep + newBlock;
    },
    customRemove: (existingContent) => {
      // Surgical removal of the [mcp_servers.ctxloom] block AND its
      // leading installer-comment header (the `# ctxloom — added by...`
      // lines). Everything else in config.toml is preserved verbatim.
      const blockWithLeadingComments =
        /(^|\n)(?:#[^\n]*\n)*\[mcp_servers\.ctxloom\][\s\S]*?(?=\n\[(?!mcp_servers\.ctxloom)|$)/;
      const stripped = existingContent.replace(blockWithLeadingComments, (_m, leading) => leading);
      // If the file is now empty (or just whitespace), delete it.
      if (stripped.trim() === '') return null;
      return stripped;
    },
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

        // customWriter clients have non-JSON formats — defer to the
        // host's own "is ctxloom installed?" check when provided.
        // Defaults to file-existence-at-canonical-path (correct for
        // single-purpose files like Continue's per-server YAML; wrong
        // for shared files like Codex's config.toml that may exist
        // without ctxloom's block).
        if (client.customWriter) {
          if (cp === client.configPaths[0]) {
            alreadyConfigured = client.customInstalledCheck
              ? client.customInstalledCheck(cp)
              : true;
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
  // The writer receives the existing file contents (or null if no file)
  // so shared-file hosts like Codex can append/update their block without
  // clobbering unrelated config. Single-purpose hosts like Continue
  // ignore the existing content and return the whole file.
  if (client.customWriter) {
    const targetPath = client.configPaths[0];
    const serverEntry = getServerEntry();
    const existingContent = fs.existsSync(targetPath)
      ? fs.readFileSync(targetPath, 'utf-8')
      : null;
    const content = client.customWriter(targetPath, serverEntry, existingContent);
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

  // customWriter clients: dispatch to the host's customRemove hook
  // when provided (shared-file hosts like Codex TOML need surgical
  // block removal), or fall back to "delete the file" (single-purpose
  // hosts like Continue's per-server YAML).
  if (client.customWriter) {
    const targetPath = client.configPaths[0];
    if (!fs.existsSync(targetPath)) {
      return { success: true, message: `ctxloom not found in ${client.name} config` };
    }
    if (client.customRemove) {
      try {
        const existingContent = fs.readFileSync(targetPath, 'utf-8');
        const newContent = client.customRemove(existingContent);
        if (newContent === null) {
          fs.unlinkSync(targetPath);
        } else {
          fs.writeFileSync(targetPath, newContent, 'utf-8');
        }
        return { success: true, message: `Removed ctxloom from ${client.name} (${targetPath})` };
      } catch (err) {
        return { success: false, message: `Failed to update config at ${targetPath}: ${err}` };
      }
    }
    // Default: delete the file entirely (Continue's per-server YAML).
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
