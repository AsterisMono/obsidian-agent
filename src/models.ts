import {
  createProvider,
  type Credential,
  type CredentialInfo,
  type CredentialStore,
  type Model,
  type MutableModels,
} from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { registerBunOAuthFlows } from '@earendil-works/pi-ai/bun-oauth';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import type { SecretStorage } from 'obsidian';
import { type AgentData, isRecord, providerSecretId } from './data.ts';

function credential(value: unknown): value is Credential {
  return (
    isRecord(value) &&
    ((value.type === 'api_key' && (value.key === undefined || typeof value.key === 'string')) ||
      (value.type === 'oauth' &&
        typeof value.access === 'string' &&
        typeof value.refresh === 'string' &&
        typeof value.expires === 'number'))
  );
}

export class SecretCredentials implements CredentialStore {
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    private readonly storage: SecretStorage,
    private readonly data: AgentData,
    private readonly persist: () => Promise<void>,
  ) {}

  private reference(providerId: string): string {
    return providerSecretId(providerId);
  }

  read(providerId: string): Promise<Credential | undefined> {
    const ref = this.data.credentialRefs[providerId];
    if (!ref) return Promise.resolve(undefined);
    const stored = this.storage.getSecret(ref);
    if (!stored) return Promise.resolve(undefined);
    try {
      const parsed: unknown = JSON.parse(stored);
      return Promise.resolve(credential(parsed) ? parsed : undefined);
    } catch {
      return Promise.resolve(undefined);
    }
  }

  async list(): Promise<readonly CredentialInfo[]> {
    const found: CredentialInfo[] = [];
    for (const id of Object.keys(this.data.credentialRefs)) {
      const item = await this.read(id);
      if (item) found.push({ providerId: id, type: item.type });
    }
    return found;
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    const previous = this.locks.get(providerId) ?? Promise.resolve();
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => held);
    this.locks.set(providerId, queued);
    await previous;
    try {
      const current = await this.read(providerId);
      const next = await fn(current);
      if (next) {
        const ref = this.data.credentialRefs[providerId] ?? this.reference(providerId);
        this.storage.setSecret(ref, JSON.stringify(next));
        this.data.credentialRefs[providerId] = ref;
        await this.persist();
      }
      return next ?? current;
    } finally {
      release();
      if (this.locks.get(providerId) === queued) this.locks.delete(providerId);
    }
  }

  async delete(providerId: string): Promise<void> {
    const previous = this.locks.get(providerId);
    if (previous) await previous;
    const ref = this.data.credentialRefs[providerId];
    if (ref) this.storage.setSecret(ref, '');
    this.data.credentialRefs = Object.fromEntries(
      Object.entries(this.data.credentialRefs).filter(([id]) => id !== providerId),
    );
    await this.persist();
  }
}

export function createAgentModels(data: AgentData, credentials: SecretCredentials): MutableModels {
  registerBunOAuthFlows();
  const models = builtinModels({ credentials });
  for (const endpoint of data.customEndpoints) {
    const providerId = `custom-${endpoint.id}`;
    const catalog: Model<'openai-completions'>[] = endpoint.models.map((id) => ({
      id,
      name: id,
      api: 'openai-completions',
      provider: providerId,
      baseUrl: endpoint.url,
      reasoning: true,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 8192,
    }));
    models.setProvider(
      createProvider({
        id: providerId,
        name: endpoint.name,
        baseUrl: endpoint.url,
        auth: {
          apiKey: {
            name: endpoint.name,
            resolve: async () => {
              const item = await credentials.read(providerId);
              return {
                auth: { apiKey: item?.type === 'api_key' && item.key ? item.key : 'local' },
              };
            },
          },
        },
        models: catalog,
        api: openAICompletionsApi(),
      }),
    );
  }
  return models;
}
