#!/usr/bin/env node
// Google Sheets MCP server. Speaks the Model Context Protocol over stdio so an
// assistant can work spreadsheets that were SHARED WITH YOU — inspect them,
// search them, and edit cells in place — without ever pulling the whole file
// into its context.
//
// Auth is your own Google OAuth app; the connector can only reach what the
// signed-in account can already reach (see auth.ts). Every write is two-phase
// and gated on a human confirmation (see tools.ts).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools';

async function main(): Promise<void> {
  const server = new McpServer({
    name: 'gsheets',
    version: '0.1.0',
  });

  registerTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`gsheets-mcp: fatal: ${msg}\n`);
  process.exit(1);
});
