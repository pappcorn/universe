// The shared server factory. Both transports (mcp.ts = stdio, http.ts =
// streamable HTTP) build their server through here, so tool registration never
// touches transport concerns.
//
// This split is what makes "two transports from day one" cheap. The sibling
// MCP servers in this repo inline `new McpServer(...)` + `registerTools(...)`
// directly in their stdio entry, which is fine when stdio is the only
// transport — but retrofitting a second one then means editing the entry
// point. Fifteen lines now instead.
//
// The protocol-visible name is the bare 'whatsapp'. Any host-repo naming
// prefix belongs in that repo's project metadata, never here.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from './tools';

export function buildServer(): McpServer {
  const server = new McpServer({
    name: 'whatsapp',
    version: '0.1.0',
  });
  registerTools(server);
  return server;
}
