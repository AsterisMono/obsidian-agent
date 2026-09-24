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
  interruptedText: string;
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

function textBlock(value: unknown): boolean {
  return isRecord(value) && value.type === 'text' && typeof value.text === 'string';
}

function imageBlock(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.type === 'image' &&
    typeof value.data === 'string' &&
    typeof value.mimeType === 'string'
  );
}

function userContent(value: unknown): boolean {
  return (
    typeof value === 'string' ||
    (Array.isArray(value) && value.every((block) => textBlock(block) || imageBlock(block)))
  );
}

function systemMessage(value: Record<string, unknown>): boolean {
  const content = value.content;
  if (typeof content !== 'string' && !(Array.isArray(content) && content.every(textBlock)))
    return false;
  if (
    value.sections !== undefined &&
    (!isRecord(value.sections) ||
      !Object.values(value.sections).every((item) => item === null || typeof item === 'string'))
  )
    return false;
  if (
    value.toolsAdded !== undefined &&
    (!Array.isArray(value.toolsAdded) ||
      !value.toolsAdded.every(
        (tool: unknown) =>
          isRecord(tool) &&
          typeof tool.name === 'string' &&
          typeof tool.description === 'string' &&
          isRecord(tool.parameters),
      ))
  )
    return false;
  if (
    value.toolsRemoved !== undefined &&
    (!Array.isArray(value.toolsRemoved) ||
      !value.toolsRemoved.every((tool: unknown) => isRecord(tool) && typeof tool.name === 'string'))
  )
    return false;
  return true;
}

function assistantBlock(value: unknown): boolean {
  if (textBlock(value)) return true;
  if (!isRecord(value)) return false;
  if (value.type === 'thinking') return typeof value.thinking === 'string';
  if (value.type === 'toolCall')
    return (
      typeof value.id === 'string' && typeof value.name === 'string' && isRecord(value.arguments)
    );
  return false;
}

function usage(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.cost)) return false;
  const cost = value.cost;
  return (
    ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens'].every(
      (key) => typeof value[key] === 'number' && Number.isFinite(value[key]),
    ) &&
    ['input', 'output', 'cacheRead', 'cacheWrite', 'total'].every(
      (key) => typeof cost[key] === 'number' && Number.isFinite(cost[key]),
    )
  );
}

function isAgentMessage(value: unknown): value is AgentMessage {
  if (!isRecord(value)) return false;
  if (typeof value.timestamp !== 'number' || !Number.isFinite(value.timestamp)) return false;
  if (value.role === 'system') return systemMessage(value);
  if (value.role === 'user') return userContent(value.content);
  if (value.role === 'assistant') {
    return (
      Array.isArray(value.content) &&
      value.content.every(assistantBlock) &&
      typeof value.api === 'string' &&
      typeof value.provider === 'string' &&
      typeof value.model === 'string' &&
      typeof value.stopReason === 'string' &&
      ['pending', 'stop', 'length', 'toolUse', 'error', 'aborted', 'deferred'].includes(
        value.stopReason,
      ) &&
      usage(value.usage)
    );
  }
  if (value.role === 'toolResult') {
    return (
      typeof value.toolCallId === 'string' &&
      typeof value.toolName === 'string' &&
      Array.isArray(value.content) &&
      value.content.every((block) => textBlock(block) || imageBlock(block)) &&
      typeof value.isError === 'boolean'
    );
  }
  return false;
}

export function parseData(value: unknown): AgentData {
  const raw = isRecord(value) ? value : {};
  const chats = Array.isArray(raw.chats) ? raw.chats : [];
  const endpoints = Array.isArray(raw.customEndpoints) ? raw.customEndpoints : [];
  const servers = Array.isArray(raw.mcpServers) ? raw.mcpServers : [];
  const thinking = raw.thinking;
  const parsedChats = chats.filter(isRecord).map((chat) => ({
    id: typeof chat.id === 'string' ? chat.id : '',
    title: typeof chat.title === 'string' ? chat.title : 'Chat',
    messages: Array.isArray(chat.messages) ? chat.messages.filter(isAgentMessage) : [],
    pending: chat.pending === true,
    interrupted: chat.interrupted === true,
    interruptedText: typeof chat.interruptedText === 'string' ? chat.interruptedText : '',
    activity: strings(chat.activity),
    updatedAt:
      typeof chat.updatedAt === 'number' && Number.isFinite(chat.updatedAt)
        ? chat.updatedAt
        : Date.now(),
  }));
  const usedIds = new Set<string>();
  const reservedIds = new Set(parsedChats.map((chat) => chat.id).filter(Boolean));
  for (const chat of parsedChats) {
    if (!chat.id || usedIds.has(chat.id)) {
      do {
        chat.id = crypto.randomUUID();
      } while (usedIds.has(chat.id) || reservedIds.has(chat.id));
    }
    usedIds.add(chat.id);
  }
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
    chats: parsedChats,
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
    interruptedText: '',
    activity: [],
    updatedAt: Date.now(),
  };
}
