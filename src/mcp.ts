import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { SecretStorage } from 'obsidian';
import type { McpServer } from './data.ts';
import { isRecord } from './data.ts';
import { nodeFetch } from './node-fetch.ts';

type Attempt = {
  id: string;
  configuration: string;
  client: Client;
  tools: AgentTool[];
};

const builtInNames = new Set(['search_notes', 'read_note', 'create_note', 'edit_note']);

function exposedName(serverId: string, toolName: string): string {
  const server = serverId.replace(/[^a-z0-9]/gi, '').slice(0, 12);
  const tool = toolName.replace(/[^a-z0-9_]/gi, '_').slice(0, 40);
  return `mcp_${server}_${tool}`;
}

function permittedName(name: string): boolean {
  return name.length <= 64 && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

export class McpConnections {
  private readonly attempts = new Map<string, Attempt>();
  private readonly published = new Map<string, Attempt>();
  private readonly connectionErrors = new Map<string, string>();
  private desired = new Map<string, string>();
  private order: string[] = [];
  private registered: AgentTool[] = [];
  private registeredSet = new Set<AgentTool>();
  private live = true;
  readonly errors = new Map<string, string>();

  constructor(private readonly storage: SecretStorage) {}

  private configuration(server: McpServer): string {
    return JSON.stringify({
      name: server.name,
      type: server.type,
      command: server.command,
      args: server.args,
      url: server.url,
      headers: Object.entries(server.headerRefs).map(([name, ref]) => [
        name,
        ref,
        this.storage.getSecret(ref),
      ]),
    });
  }

  private current(attempt: Attempt): boolean {
    return (
      this.live &&
      this.attempts.get(attempt.id) === attempt &&
      this.desired.get(attempt.id) === attempt.configuration
    );
  }

  private rebuild(): void {
    this.errors.clear();
    for (const [id, error] of this.connectionErrors) this.errors.set(id, error);
    const occupied = new Set(builtInNames);
    const registered: AgentTool[] = [];
    for (const id of this.order) {
      const attempt = this.published.get(id);
      if (!attempt || !this.current(attempt)) continue;
      for (const tool of attempt.tools) {
        if (!permittedName(tool.name) || occupied.has(tool.name)) {
          this.errors.set(id, `MCP tool name collision or invalid name: ${tool.name}`);
          continue;
        }
        occupied.add(tool.name);
        registered.push(tool);
      }
    }
    this.registered = registered;
    this.registeredSet = new Set(registered);
  }

  private retire(attempt: Attempt): Promise<void> {
    if (this.attempts.get(attempt.id) === attempt) this.attempts.delete(attempt.id);
    if (this.published.get(attempt.id) === attempt) this.published.delete(attempt.id);
    return attempt.client.close();
  }

  private async connect(server: McpServer, configuration: string): Promise<void> {
    const client = new Client({ name: 'obsidian-agent', version: '0.1.0' });
    const attempt: Attempt = { id: server.id, configuration, client, tools: [] };
    this.connectionErrors.delete(server.id);
    this.attempts.set(server.id, attempt);
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
      if (!this.current(attempt)) return;
      const listed = await client.listTools();
      if (!this.current(attempt)) return;
      attempt.tools = listed.tools.map((tool) => {
        const agentTool: AgentTool = {
          name: exposedName(server.id, tool.name),
          label: `${server.name}: ${tool.name}`,
          description: tool.description ?? tool.name,
          parameters: Type.Unsafe<Record<string, unknown>>(tool.inputSchema),
          execute: async (_id, params) => {
            if (
              !this.current(attempt) ||
              this.published.get(server.id) !== attempt ||
              !this.registeredSet.has(agentTool)
            )
              throw new Error('MCP tool connection is no longer active.');
            if (!isRecord(params)) throw new Error('MCP tool arguments must be an object.');
            const result = await client.callTool({ name: tool.name, arguments: params });
            if (
              !this.current(attempt) ||
              this.published.get(server.id) !== attempt ||
              !this.registeredSet.has(agentTool)
            )
              throw new Error('MCP tool connection is no longer active.');
            return {
              content: [
                { type: 'text', text: JSON.stringify(result.structuredContent ?? result.content) },
              ],
              details: undefined,
            };
          },
        };
        return agentTool;
      });
      this.published.set(server.id, attempt);
      this.connectionErrors.delete(server.id);
      this.rebuild();
    } catch (error) {
      if (this.current(attempt)) {
        this.connectionErrors.set(
          server.id,
          error instanceof Error ? error.message : String(error),
        );
      }
    } finally {
      if (this.published.get(server.id) !== attempt || !this.current(attempt)) {
        await this.retire(attempt).catch(() => undefined);
        this.rebuild();
      }
    }
  }

  async sync(servers: McpServer[]): Promise<void> {
    if (!this.live) return;
    const counts = new Map<string, number>();
    for (const server of servers) {
      counts.set(server.id, (counts.get(server.id) ?? 0) + 1);
    }
    const wanted = servers
      .filter((server) => server.enabled && counts.get(server.id) === 1)
      .map((server) => ({
        ...server,
        args: [...server.args],
        headerRefs: { ...server.headerRefs },
      }));
    this.desired = new Map(wanted.map((server) => [server.id, this.configuration(server)]));
    this.order = wanted.map((server) => server.id);
    for (const attempt of [...this.attempts.values()]) {
      if (this.desired.get(attempt.id) !== attempt.configuration)
        this.retire(attempt).catch(() => undefined);
    }
    for (const id of [...this.connectionErrors.keys()]) {
      if (!this.desired.has(id)) this.connectionErrors.delete(id);
    }
    for (const [id, count] of counts) {
      if (count > 1) this.connectionErrors.set(id, 'Duplicate MCP server ID.');
    }
    this.rebuild();
    await Promise.all(
      wanted.flatMap((server) => {
        if (this.attempts.has(server.id)) return [];
        return [this.connect(server, this.desired.get(server.id) ?? '')];
      }),
    );
    this.rebuild();
  }

  tools(): AgentTool[] {
    return [...this.registered];
  }

  async close(): Promise<void> {
    this.live = false;
    this.desired.clear();
    this.order = [];
    const closing = [...this.attempts.values()].map((attempt) => this.retire(attempt));
    this.rebuild();
    await Promise.allSettled(closing);
  }
}
