#!/usr/bin/env node
// YouTube MCP server over stdio, the transport Claude Code, Claude Desktop and
// Cowork speak to a local server. No credential: it reads the public captions
// of a video from youtube.com. See README.md.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer } from './server';

async function main(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`youtube-mcp: fatal: ${msg}\n`);
  process.exit(1);
});
