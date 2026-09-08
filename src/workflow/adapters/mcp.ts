import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema, ErrorCode, McpError, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { LIMITS, mcpConfigSchema, type Action, type McpConfig } from '../plan.js';
import { normalizeOutput } from '../output.js';
import { ArtifactLimitError, type Outcome, type RunStore } from '../store.js';

export class McpConnections {
  private readonly config;
  private readonly clients = new Map<string, Promise<Client>>();
  private readonly transports: StdioClientTransport[] = [];
  private readonly tails = new Map<string, Promise<void>>();
  constructor(config: McpConfig = { servers: {} }, private readonly cwd = process.cwd()) {
    this.config = mcpConfigSchema.parse(config);
  }
  private async connect(id: string): Promise<Client> {
    const existing = this.clients.get(id);
    if (existing) return existing;
    const server = this.config.servers[id];
    if (!Object.hasOwn(this.config.servers, id)) throw new Error(`MCP server ${id} is not explicitly configured.`);
    const environment = getDefaultEnvironment();
    for (const [name, source] of Object.entries(server.env)) {
      const value = process.env[source];
      if (value === undefined) throw new Error(`Set environment variable ${source} for MCP server ${id}.`);
      environment[name] = value;
    }
    const client = new Client({ name: 'functions-workflow', version: '1' });
    const transport = new StdioClientTransport({
      command: server.command, args: server.args, env: environment, cwd: this.cwd,
      stderr: 'ignore', maxBufferSize: LIMITS.artifact,
    });
    this.transports.push(transport);
    const connection = client.connect(transport, { timeout: 10_000 }).then(() => client);
    this.clients.set(id, connection);
    return connection;
  }
  async tools(id: string): Promise<Tool[]> {
    const client = await this.connect(id);
    const tools: Tool[] = [];
    let cursor: string | undefined;
    const cursors = new Set<string>();
    do {
      const page = await client.listTools(cursor ? { cursor } : {}, { timeout: 10_000 });
      tools.push(...page.tools);
      if (tools.length > 1000 || cursors.size >= 50) throw new Error('MCP tool discovery exceeds its limit.');
      cursor = page.nextCursor;
      if (cursor) {
        if (cursors.has(cursor)) throw new Error('MCP tool discovery repeated a cursor.');
        cursors.add(cursor);
      }
    } while (cursor);
    return tools;
  }
  execute(
    action: Extract<Action, { kind: 'mcp' }>, store: RunStore, prefix: string,
    timeoutMs: number, signal?: AbortSignal,
  ): Promise<Outcome> {
    const previous = this.tails.get(action.server) ?? Promise.resolve();
    const execution = previous.then(() => this.call(action, store, prefix, timeoutMs, signal));
    // Release the per-server queue; the caller still receives the original rejection.
    this.tails.set(action.server, execution.then(() => undefined, () => undefined));
    return execution;
  }
  private async call(
    action: Extract<Action, { kind: 'mcp' }>, store: RunStore, prefix: string,
    timeoutMs: number, signal?: AbortSignal,
  ): Promise<Outcome> {
    let client: Client;
    try { client = await this.connect(action.server); }
    catch {
      return { status: 'failed', code: 'MCP_START_ERROR', message: 'Cannot initialize the configured MCP server; check its command and environment.', notStarted: true };
    }
    if (signal?.aborted) return { status: 'unknown', code: 'OUTCOME_UNKNOWN', message: 'Run interrupted before tool dispatch.' };
    let response: CallToolResult;
    try { response = CallToolResultSchema.parse(await client.callTool({ name: action.tool, arguments: action.arguments }, undefined, { timeout: timeoutMs, signal })); }
    catch (error) {
      if (error instanceof McpError && error.code !== ErrorCode.RequestTimeout && error.code !== ErrorCode.ConnectionClosed) {
        return { status: 'failed', code: 'MCP_REQUEST_ERROR', message: `MCP rejected the request with code ${error.code}.` };
      }
      return { status: 'unknown', code: 'OUTCOME_UNKNOWN', message: 'MCP response was lost, interrupted, or timed out; inspect external state before retrying.' };
    }
    const primaryArtifact = `${prefix}/response.json`;
    const content = JSON.stringify(response);
    try { store.writeArtifact(primaryArtifact, content); }
    catch (error) {
      if (!(error instanceof ArtifactLimitError)) throw error;
      return { status: 'unknown', code: 'ARTIFACT_LIMIT', message: 'MCP response could not be retained within storage limits; verify external effects before retrying.' };
    }
    if (response.isError) return { status: 'failed', code: 'MCP_TOOL_ERROR', message: 'MCP tool reported an error; inspect its response.', primaryArtifact };
    try {
      const data = normalizeOutput(action, content);
      return { status: 'succeeded', code: 'OK', data, primaryArtifact };
    } catch {
      return { status: 'failed', code: 'OUTPUT_INVALID', message: 'MCP output does not match the requested format.', primaryArtifact };
    }
  }
  async close(): Promise<void> {
    const results = await Promise.allSettled(this.transports.map(transport => transport.close()));
    if (results.some(result => result.status === 'rejected')) throw new Error('MCP shutdown failed; check the owned server processes.');
  }
}

export async function listWorkflowTools(config: McpConfig, server: string): Promise<Tool[]> {
  const connections = new McpConnections(config);
  try { return await connections.tools(server); }
  finally { await connections.close(); }
}
