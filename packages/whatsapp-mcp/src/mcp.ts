#!/usr/bin/env node
// WhatsApp MCP server over stdio — the transport Claude Code speaks, and the
// one Cris and Lola use. Auth is a Meta access token in $WHATSAPP_ACCESS_TOKEN;
// see README.md.
//
// v1 is OUTBOUND only ("hablar"). The inbound listener that would let people
// message Cris and get a reply is a separate long-running service (1.b),
// designed but not built — it needs a public HTTPS endpoint, which a local Mac
// doesn't have. See README.md → "Future: inbound".
//
// The 24-hour window is the thing to understand before using this: free-form
// text only works within 24h of the recipient's last inbound message. Outside
// it, only pre-approved templates. Without an inbound receiver this server
// cannot know whether the window is open — it sends and reads the error.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer } from './server';

async function main(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`whatsapp-mcp: fatal: ${msg}\n`);
  process.exit(1);
});
