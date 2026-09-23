import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { createHash } from 'node:crypto';

export function providerSecretId(providerId: string): string {
  return `agent-provider-${createHash('sha256').update(providerId).digest('hex').slice(0, 48)}`;
}

export function mcpHeaderSecretId(serverId: string, name: string): string {
  return `agent-mcp-${createHash('sha256').update(`${serverId}:${name}`).digest('hex').slice(0, 48)}`;
}

export type Chat = {
  id: string;
  title: string;
  messages: AgentMessage[];
  pending: boolean;
  interrupted: boolean;
  activity: string[];
  updatedAt: number;
};

export type CustomEndpoint = {
  id: string;
  name: string;
  url: string;
  models: string[];
};

export type McpServer = {
  id: string;
  name: string;
  type: 'stdio' | 'http';
  enabled: boolean;
  command: string;
  args: string[];
  url: string;
  headerRefs: Record<string, string>;
};

export type AgentData = {
  model: string;
  thinking: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  activeChatId: string;
  chats: Chat[];
  customEndpoints: CustomEndpoint[];
  credentialRefs: Record<string, string>;
  skillFolders: string[];
  enabledSkills: string[];
  mcpServers: McpServer[];
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function recordStrings(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function isAgentMessage(value: unknown): value is AgentMessage {
  return (
    isRecord(value) &&
    typeof value.role === 'string' &&
    ['system', 'user', 'assistant', 'toolResult'].includes(value.role)
  );
}

export function parseData(value: unknown): AgentData {
  const raw = isRecord(value) ? value : {};
  const chats = Array.isArray(raw.chats) ? raw.chats : [];
  const endpoints = Array.isArray(raw.customEndpoints) ? raw.customEndpoints : [];
  const servers = Array.isArray(raw.mcpServers) ? raw.mcpServers : [];
  const thinking = raw.thinking;
  return {
    model: typeof raw.model === 'string' ? raw.model : '',
    thinking:
      thinking === 'minimal' ||
      thinking === 'low' ||
      thinking === 'medium' ||
      thinking === 'high' ||
      thinking === 'xhigh'
        ? thinking
        : 'off',
    activeChatId: typeof raw.activeChatId === 'string' ? raw.activeChatId : '',
    chats: chats.filter(isRecord).map((chat) => ({
      id: typeof chat.id === 'string' ? chat.id : crypto.randomUUID(),
      title: typeof chat.title === 'string' ? chat.title : 'Chat',
      messages: Array.isArray(chat.messages) ? chat.messages.filter(isAgentMessage) : [],
      pending: chat.pending === true,
      interrupted: chat.interrupted === true,
      activity: strings(chat.activity),
      updatedAt: typeof chat.updatedAt === 'number' ? chat.updatedAt : Date.now(),
    })),
    customEndpoints: endpoints.filter(isRecord).flatMap((endpoint) =>
      typeof endpoint.id === 'string' && typeof endpoint.url === 'string'
        ? [
            {
              id: endpoint.id,
              name: typeof endpoint.name === 'string' ? endpoint.name : endpoint.id,
              url: endpoint.url,
              models: strings(endpoint.models),
            },
          ]
        : [],
    ),
    credentialRefs: Object.fromEntries(
      Object.entries(recordStrings(raw.credentialRefs)).filter(
        ([id, ref]) => ref === providerSecretId(id),
      ),
    ),
    skillFolders: strings(raw.skillFolders),
    enabledSkills: strings(raw.enabledSkills),
    mcpServers: servers.filter(isRecord).flatMap((server) =>
      typeof server.id === 'string' && (server.type === 'stdio' || server.type === 'http')
        ? [
            {
              id: server.id,
              name: typeof server.name === 'string' ? server.name : server.id,
              type: server.type,
              enabled: server.enabled === true,
              command: typeof server.command === 'string' ? server.command : '',
              args: strings(server.args),
              url: typeof server.url === 'string' ? server.url : '',
              headerRefs: Object.fromEntries(
                Object.entries(recordStrings(server.headerRefs)).filter(
                  ([name, ref]) => ref === mcpHeaderSecretId(String(server.id), name),
                ),
              ),
            },
          ]
        : [],
    ),
  };
}

export function newChat(): Chat {
  return {
    id: crypto.randomUUID(),
    title: 'New chat',
    messages: [],
    pending: false,
    interrupted: false,
    activity: [],
    updatedAt: Date.now(),
  };
}
