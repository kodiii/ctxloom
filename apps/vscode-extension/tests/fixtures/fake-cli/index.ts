#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server({ name: 'ctxloom-fake', version: '0.0.0-test' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: 'ctx_status', description: 'Fake status tool', inputSchema: { type: 'object' } }],
}));

server.setRequestHandler(CallToolRequestSchema, async () => ({
  content: [{ type: 'text', text: '<status>fake</status>' }],
}));

const transport = new StdioServerTransport();
await server.connect(transport);
