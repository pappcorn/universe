// The shared server factory. Every transport builds its server through here,
// so tool registration never touches transport concerns.
//
// The protocol-visible name is the bare 'youtube'. Any host-repo naming prefix
// belongs in that repo's project metadata, never here.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from './tools';

/** Kept in lockstep with package.json by test/manifest.test.ts. */
export const VERSION = '0.1.0';

export function buildServer(): McpServer {
  const server = new McpServer({ name: 'youtube', version: VERSION });
  registerTools(server);
  return server;
}
