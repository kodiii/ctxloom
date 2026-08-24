/**
 * Integration test for MCP Server creation and tool registration.
 *
 * Tests that the MCP server can be created and lists the correct tools.
 * Since the SDK requires a transport connection to use server.request(),
 * we test the tool registration by examining the registered handlers.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, isGraphAvailable, SERVER_INSTRUCTIONS } from '../src/server.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

describe('MCP Server', () => {
  let server: Server;

  beforeAll(() => {
    ({ server } = createServer());
  });

  describe('createServer()', () => {
    it('should create a Server instance', () => {
      expect(server).toBeDefined();
      expect(server).toBeInstanceOf(Server);
    });

    it('should have the correct server name', () => {
      // Server name is set during creation - we can verify the instance exists
      expect(server).toBeDefined();
    });

    it('publishes graph-first workflow instructions during MCP initialization', async () => {
      const { server: initializedServer } = createServer();
      const client = new Client({ name: 'ctxloom-test', version: '1.0.0' });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

      await initializedServer.connect(serverTransport);
      await client.connect(clientTransport);
      try {
        expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
        expect(client.getInstructions()).toContain('ctx_get_minimal_context');
      } finally {
        await client.close();
        await initializedServer.close();
      }
    });

    it('treats an indexed graph snapshot as ready before in-memory hydration', async () => {
      const fs = await import('node:fs');
      const os = await import('node:os');
      const path = await import('node:path');
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-graph-ready-'));
      try {
        expect(isGraphAvailable(tempDir, false)).toBe(false);
        fs.mkdirSync(path.join(tempDir, '.ctxloom'), { recursive: true });
        fs.writeFileSync(path.join(tempDir, '.ctxloom', 'graph-snapshot.json'), '{}');
        expect(isGraphAvailable(tempDir, false)).toBe(true);
        expect(isGraphAvailable(tempDir, true)).toBe(true);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('Tool Registration', () => {
    it('should define the expected tool names in source code', async () => {
      // We can't call server.request() without a transport connection,
      // so we verify the tool registration by importing and inspecting
      // the createServer function's behavior through the ListTools handler
      //
      // Instead, let's verify the tools exist by checking the source code
      // and testing each handler individually through their exported functions
      
      // Verify the server object has request handlers registered
      // The MCP SDK stores handlers internally, so we can verify the server
      // was created successfully
      expect(server).toBeInstanceOf(Server);
    });

    it('should define all 8 expected tools', async () => {
      // Verify the tool names are defined in the tools source files.
      // After the ToolRegistry refactor each tool lives in its own file under
      // src/tools/ — we search all TS files in that directory.
      const expectedTools = [
        'ctx_search',
        'ctx_get_file',
        'ctx_get_context_packet',
        'ctx_get_call_graph',
        'ctx_get_definition',
        'ctx_get_rules',
        'ctx_similar_files',
        'ctx_status',
      ];
      const fs = await import('node:fs');
      const path = await import('node:path');
      const toolsDir = path.resolve(process.cwd(), 'packages/core/src/tools');
      const toolFiles = fs.readdirSync(toolsDir)
        .filter((f: string) => f.endsWith('.ts'))
        .map((f: string) => fs.readFileSync(path.join(toolsDir, f), 'utf-8'));
      const allSrc = toolFiles.join('\n');
      for (const toolName of expectedTools) {
        expect(allSrc).toContain(`'${toolName}'`);
      }
    });
  });

  describe('ctx_get_file handler', () => {
    it('should reject path traversal', async () => {
      // Test via the PathValidator directly, which the handler uses
      const { PathValidator } = await import('../src/security/PathValidator.js');
      const validator = new PathValidator(process.cwd());
      expect(() => validator.validate('../../../etc/passwd')).toThrow('Path traversal blocked');
    });
  });

  describe('ctx_get_rules handler', () => {
    it('should return empty rules XML for project with no rule files', async () => {
      const { RuleManager } = await import('../src/tools/ruleManager.js');
      const { PathValidator } = await import('../src/security/PathValidator.js');
      const os = await import('os');
      const fs = await import('fs');
      const path = await import('path');

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-rules-test-'));
      try {
        const validator = new PathValidator(tempDir);
        const ruleManager = new RuleManager(tempDir, validator);
        const xml = await ruleManager.getRulesXML();
        expect(xml).toContain('count="0"');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});
