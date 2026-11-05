#!/usr/bin/env node
// LinkedIn Pages MCP server over stdio. It publishes AS YOUR ORGANIZATION'S
// PAGE through LinkedIn's official Community Management API — never as a
// person, never through a browser. Auth is your own LinkedIn app (config.ts);
// every post and comment is two-phase and gated on a human confirmation
// (gate.ts). Nothing runs on its own: the connector acts only when asked.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer } from './server';

async function main(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`linkedin-mcp: fatal: ${msg}\n`);
  process.exit(1);
});
