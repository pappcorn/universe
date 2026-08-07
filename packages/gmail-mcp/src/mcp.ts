#!/usr/bin/env node
// Gmail MCP server. Speaks the Model Context Protocol over stdio so
// Claude can work your own mailbox natively — search,
// read threads, send/draft (with user confirmation), label, archive. Auth is
// token-gated: the OAuth credential file at ~/.config/pappcorn-gmail-mcp/credentials.json
//
// v1 is ON-DEMAND only (read + triage + confirmed sends). Inbound triggers
// (users.watch → Pub/Sub → worker) are Fase 2, designed but not built — see

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools';

async function main(): Promise<void> {
  const server = new McpServer({
    name: 'gmail',
    version: '0.1.0',
  });

  registerTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`gmail-mcp: fatal: ${msg}\n`);
  process.exit(1);
});
