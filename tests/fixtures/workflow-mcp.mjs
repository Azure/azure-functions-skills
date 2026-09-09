import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server({ name: 'workflow-fixture', version: '1' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: 'echo', description: 'Fixture echo', inputSchema: { type: 'object', properties: { value: { type: 'string' } } } }],
}));
server.setRequestHandler(CallToolRequestSchema, async request => {
  if (request.params.name === 'error') return { isError: true, content: [{ type: 'text', text: 'fixture failure' }] };
  return { content: [{ type: 'text', text: JSON.stringify(request.params.arguments) }], structuredContent: request.params.arguments ?? {} };
});
await server.connect(new StdioServerTransport());
