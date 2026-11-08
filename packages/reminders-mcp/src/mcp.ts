#!/usr/bin/env node
// Apple Reminders MCP server over stdio. It runs on the Mac, next to the
// Reminders app, and talks to it through osascript (core.ts). No account, no
// token, no network: macOS's own Automation permission decides whether it may.
// Nothing runs on its own: the connector acts only when asked.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer } from './server';

async function main(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`reminders-mcp: fatal: ${msg}\n`);
  process.exit(1);
});
