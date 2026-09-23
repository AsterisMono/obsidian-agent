import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { SecretStorage } from 'obsidian';
import type { McpServer } from './data.ts';
import { isRecord } from './data.ts';
import { nodeFetch } from './node-fetch.ts';

type Connection = {
  client: Client;
  tools: AgentTool[];
};

export class McpConnections {
  private readonly connections = new Map<string, Connection>();
  readonly errors = new Map<string, string>();

  constructor(private readonly storage: SecretStorage) {}

  async sync(servers: McpServer[]): Promise<void> {
    const active = new Set(servers.filter((server) => server.enabled).map((server) => server.id));
    for (const [id, connection] of this.connections) {
      if (!active.has(id)) {
        try {
          await connection.client.close();
        } finally {
          this.connections.delete(id);
          this.errors.delete(id);
        }
      }
    }
    for (const server of servers) {
      if (!server.enabled || this.connections.has(server.id)) continue;
      const client = new Client({ name: 'obsidian-agent', version: '0.1.0' });
      try {
        if (server.type === 'stdio') {
          if (!server.command) throw new Error('Server command is empty.');
          await client.connect(
            new StdioClientTransport({
              command: server.command,
              args: server.args,
              stderr: 'ignore',
            }),
          );
        } else {
          const headers: Record<string, string> = {};
          for (const [name, ref] of Object.entries(server.headerRefs)) {
            const secret = this.storage.getSecret(ref);
            if (secret) headers[name] = secret;
          }
          await client.connect(
            new StreamableHTTPClientTransport(new URL(server.url), {
              requestInit: { headers },
              fetch: nodeFetch,
            }),
          );
        }
        const listed = await client.listTools();
        const tools: AgentTool[] = listed.tools.map((tool) => ({
          name: `mcp_${server.id.replace(/[^a-z0-9]/gi, '').slice(0, 12)}_${tool.name.replace(/[^a-z0-9_]/gi, '_').slice(0, 40)}`,
          label: `${server.name}: ${tool.name}`,
          description: tool.description ?? tool.name,
          parameters: Type.Unsafe<Record<string, unknown>>(tool.inputSchema),
          execute: async (_id, params) => {
            if (!isRecord(params)) throw new Error('MCP tool arguments must be an object.');
            const result = await client.callTool({ name: tool.name, arguments: params });
            return {
              content: [
                { type: 'text', text: JSON.stringify(result.structuredContent ?? result.content) },
              ],
              details: undefined,
            };
          },
        }));
        this.connections.set(server.id, { client, tools });
        this.errors.delete(server.id);
      } catch (error) {
        await client.close().catch(() => undefined);
        this.errors.set(server.id, error instanceof Error ? error.message : String(error));
      }
    }
  }

  tools(): AgentTool[] {
    return [...this.connections.values()].flatMap((connection) => connection.tools);
  }

  async close(): Promise<void> {
    await Promise.allSettled(
      [...this.connections.values()].map((connection) => connection.client.close()),
    );
    this.connections.clear();
  }
}
