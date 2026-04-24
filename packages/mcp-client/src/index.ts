/**
 * @ctxloom/mcp-client — thin wrapper for apps that talk to a running
 * ctxloom MCP server over stdio (as a child process).
 *
 * Apps that can import @ctxloom/core directly (dashboard, pr-bot) do not
 * need this. Apps that run in a different process (VS Code extension,
 * Slack bot, AI reviewer) use this.
 *
 * This package is workspace-private and never published to npm.
 * main/types/exports intentionally point at .ts source because:
 *   - Development: consumers use tsx which resolves .ts natively
 *   - Production: tsup bundles it inline via noExternal
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export type { Client };

export interface SpawnOpts {
  /** Working directory passed to the ctxloom server. Defaults to process.cwd(). */
  cwd?: string;
  /** Env vars merged on top of process.env. */
  env?: Record<string, string>;
  /** Command to spawn. Defaults to 'ctxloom'. */
  command?: string;
}

/**
 * Spawns a ctxloom MCP server as a child process and returns a connected Client.
 *
 * The caller is responsible for calling `client.close()` when done to terminate
 * the child process and release resources.
 *
 * @example
 * ```typescript
 * const client = await spawnServer({ cwd: '/my/project' });
 * const result = await client.callTool({ name: 'search_code', arguments: { query: 'parseAST' } });
 * await client.close();
 * ```
 */
export async function spawnServer(opts: SpawnOpts = {}): Promise<Client> {
  const { cwd, env, command = 'ctxloom' } = opts;

  const mergedEnv: Record<string, string> = {
    ...(Object.fromEntries(
      Object.entries(process.env).filter(([, v]) => v !== undefined),
    ) as Record<string, string>),
    ...env,
  };

  const transport = new StdioClientTransport({
    command,
    args: [],
    env: mergedEnv,
    cwd,
  });

  const client = new Client(
    { name: '@ctxloom/mcp-client', version: '0.0.0' },
    { capabilities: {} },
  );

  await client.connect(transport);

  return client;
}
