import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { jsonSchema, type Action, type Json } from './plan.js';

export function normalizeOutput(action: Action, content: string): Json {
  if (action.kind === 'exec') return action.output === 'json' ? jsonSchema.parse(JSON.parse(content)) : content;
  const response = CallToolResultSchema.parse(JSON.parse(content));
  if (response.isError) throw new Error('An MCP error response cannot supply successful exports.');
  const text = response.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
  return action.output === 'structured' ? jsonSchema.parse(response.structuredContent)
    : action.output === 'json' ? jsonSchema.parse(JSON.parse(text)) : text;
}
