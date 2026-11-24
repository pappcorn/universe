// The shared server factory. Every transport builds its server through here, so
// tool registration never touches transport concerns. The protocol-visible
// name is the bare 'linkedin'.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from './tools';

export function buildServer(): McpServer {
  const server = new McpServer({
    name: 'linkedin',
    version: '0.2.0',
  });
  registerTools(server);
  return server;
}
