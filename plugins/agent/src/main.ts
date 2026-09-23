import { Agent, type AgentMessage } from '@earendil-works/pi-agent-core';
import type { MutableModels } from '@earendil-works/pi-ai';
import { MarkdownView, Notice, Plugin, TFile } from 'obsidian';
import { type AgentData, type Chat, isRecord, newChat, parseData } from './data.ts';
import { McpConnections } from './mcp.ts';
import { createAgentModels, SecretCredentials } from './models.ts';
import { nodeFetch } from './node-fetch.ts';
import { AgentSettingsTab } from './settings.ts';
import { skillInstructions } from './skills.ts';
import { VaultTools } from './vault-tools.ts';
import { AGENT_VIEW, AgentView } from './view.ts';

export default class AgentPlugin extends Plugin {
  data!: AgentData;
  models!: MutableModels;
  credentials!: SecretCredentials;
  mcp!: McpConnections;
  partialText = '';
  error = '';
  attachment: { path: string; content: string } | null = null;
  private activeAgent: Agent | null = null;
  private persistQueue: Promise<void> = Promise.resolve();
  private lastMarkdownView: MarkdownView | null = null;

  async onload(): Promise<void> {
    const raw: unknown = await this.loadData();
    this.data = parseData(raw);
    for (const chat of this.data.chats) {
      if (chat.pending) {
        chat.pending = false;
        chat.interrupted = true;
      }
    }
    if (!this.data.chats.some((chat) => chat.id === this.data.activeChatId)) {
      const chat = newChat();
      this.data.chats.push(chat);
      this.data.activeChatId = chat.id;
    }
    this.credentials = new SecretCredentials(this.app.secretStorage, this.data, () =>
      this.persist(),
    );
    this.models = createAgentModels(this.data, this.credentials);
    this.mcp = new McpConnections(this.app.secretStorage);
    this.registerView(AGENT_VIEW, (leaf) => new AgentView(leaf, this));
    this.addRibbonIcon('bot', 'Open Obsidian Agent', () => {
      this.openSidebar().catch((error: unknown) => {
        this.handleError(error);
      });
    });
    this.addCommand({
      id: 'open-agent',
      name: 'Open agent sidebar',
      callback: () => {
        this.openSidebar().catch((error: unknown) => {
          this.handleError(error);
        });
      },
    });
    this.addSettingTab(new AgentSettingsTab(this.app, this));
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        if (leaf?.view instanceof MarkdownView) this.lastMarkdownView = leaf.view;
      }),
    );
    this.app.workspace.onLayoutReady(() => {
      this.refreshMcp().catch((error: unknown) => {
        this.handleError(error);
      });
      for (const providerId of Object.keys(this.data.credentialRefs)) {
        this.refreshProvider(providerId).catch((error: unknown) => {
          this.handleError(error);
        });
      }
    });
    await this.persist();
  }

  onunload(): void {
    this.activeAgent?.abort();
    this.mcp.close().catch((error: unknown) => {
      this.handleError(error);
    });
    this.persistQueue.catch((error: unknown) => {
      this.handleError(error);
    });
  }

  handleError(error: unknown): void {
    this.error = error instanceof Error ? error.message : String(error);
    new Notice(this.error);
    this.refresh();
  }

  persist(): Promise<void> {
    this.persistQueue = this.persistQueue
      .catch(() => undefined)
      .then(() => this.saveData(this.data));
    return this.persistQueue;
  }

  currentChat(): Chat {
    const chat = this.data.chats.find((item) => item.id === this.data.activeChatId);
    if (chat) return chat;
    const created = newChat();
    this.data.chats.push(created);
    this.data.activeChatId = created.id;
    return created;
  }

  isStreaming(): boolean {
    return this.activeAgent?.state.isStreaming ?? false;
  }

  refresh(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(AGENT_VIEW)) {
      if (leaf.view instanceof AgentView) leaf.view.render();
    }
  }

  async openSidebar(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(AGENT_VIEW);
    const leaf = existing.length ? existing[0] : this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: AGENT_VIEW, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  async startNewChat(): Promise<void> {
    if (this.isStreaming()) {
      this.stop();
      await this.activeAgent?.waitForIdle();
    }
    const chat = newChat();
    this.data.chats.push(chat);
    this.data.activeChatId = chat.id;
    this.activeAgent = null;
    this.partialText = '';
    this.attachment = null;
    this.error = '';
    await this.persist();
    this.refresh();
  }

  async openChat(id: string): Promise<void> {
    if (!this.data.chats.some((chat) => chat.id === id)) return;
    if (this.isStreaming()) {
      this.stop();
      await this.activeAgent?.waitForIdle();
    }
    this.data.activeChatId = id;
    this.activeAgent = null;
    this.partialText = '';
    this.attachment = null;
    this.error = '';
    await this.persist();
    this.refresh();
  }

  async setModel(value: string): Promise<void> {
    if (this.isStreaming()) return;
    if (!this.models.getModels().some((model) => `${model.provider}::${model.id}` === value))
      return;
    this.data.model = value;
    await this.persist();
    this.refresh();
  }

  async setThinking(value: string): Promise<void> {
    if (this.isStreaming()) return;
    if (
      value !== 'off' &&
      value !== 'minimal' &&
      value !== 'low' &&
      value !== 'medium' &&
      value !== 'high' &&
      value !== 'xhigh'
    )
      return;
    this.data.thinking = value;
    await this.persist();
    this.refresh();
  }

  async attachActiveNote(): Promise<void> {
    const activeView =
      this.app.workspace.getActiveViewOfType(MarkdownView) ?? this.lastMarkdownView;
    const file = activeView?.file ?? this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension !== 'md') {
      this.error = 'Open a Markdown note before attaching it.';
      this.refresh();
      return;
    }
    const selection = activeView?.file?.path === file.path ? activeView.editor.getSelection() : '';
    const content = selection || (await this.app.vault.cachedRead(file));
    this.attachment = { path: file.path, content };
    this.error = '';
    this.refresh();
  }

  stop(): void {
    if (!this.activeAgent?.state.isStreaming) return;
    this.currentChat().interrupted = true;
    this.activeAgent.abort();
    this.refresh();
  }

  async refreshMcp(): Promise<void> {
    await this.mcp.sync(this.data.mcpServers);
    this.refresh();
  }

  rebuildModels(): void {
    this.models = createAgentModels(this.data, this.credentials);
    this.refresh();
  }

  async refreshProvider(providerId: string): Promise<void> {
    const result = await this.models.refresh({
      providers: [providerId],
      signal: AbortSignal.timeout(15000),
    });
    const error = result.errors.get(providerId);
    if (error) new Notice(`${providerId}: ${error.message}`);
    this.refresh();
  }

  async send(message: string): Promise<void> {
    if (this.isStreaming()) return;
    const selected = this.models
      .getModels()
      .find((model) => `${model.provider}::${model.id}` === this.data.model);
    if (!selected) {
      this.error = 'Choose a model in the sidebar or configure one in settings.';
      this.refresh();
      return;
    }
    const chat = this.currentChat();
    const systemPrompt = [
      'You are Obsidian Agent. Help with this vault using only the provided tools. Vault writes are applied immediately when requested. Read a note before editing it. Never request shell commands, deletion, or files outside the vault.',
      await skillInstructions(this.app, this.data),
    ]
      .filter(Boolean)
      .join('\n\n');
    const history: AgentMessage[] =
      chat.messages[0]?.role === 'system'
        ? [{ ...chat.messages[0], content: systemPrompt }, ...chat.messages.slice(1)]
        : chat.messages;
    const agent = new Agent({
      initialState: {
        model: selected,
        thinkingLevel: this.data.thinking,
        systemPrompt,
        messages: history,
        tools: [...new VaultTools(this.app).create(), ...this.mcp.tools()],
      },
      streamFn: (model, context, options) =>
        this.models.streamSimple(model, context, { ...options, fetch: nodeFetch }),
      toolExecution: 'sequential',
    });
    this.activeAgent = agent;
    this.partialText = '';
    this.error = '';
    chat.pending = true;
    chat.interrupted = false;
    chat.updatedAt = Date.now();
    if (chat.title === 'New chat') chat.title = message.slice(0, 80);
    let prompt = message;
    if (this.attachment) {
      prompt += `\n\nAttached ${this.attachment.path}:\n${this.attachment.content}`;
      this.attachment = null;
    }
    const chatId = chat.id;
    agent.subscribe(async (event) => {
      if (event.type === 'message_update' && event.message.role === 'assistant') {
        this.partialText = this.extractText(event.message);
        this.refresh();
      }
      if (event.type === 'message_end') {
        chat.messages = agent.state.messages;
        if (event.message.role === 'assistant') this.partialText = '';
        if (event.message.role === 'assistant' && event.message.stopReason === 'error') {
          this.error = event.message.errorMessage ?? 'Model request failed.';
        }
        this.refresh();
      }
      if (event.type === 'tool_execution_start') {
        chat.activity.push(`Running ${event.toolName}`);
        this.refresh();
      }
      if (event.type === 'tool_execution_end') {
        const result: unknown = event.result;
        const content = isRecord(result) && Array.isArray(result.content) ? result.content : [];
        const output = content
          .filter(
            (part: unknown): part is { type: 'text'; text: string } =>
              isRecord(part) && part.type === 'text' && typeof part.text === 'string',
          )
          .map((part) => part.text)
          .join(' ');
        chat.activity.push(
          `${event.toolName}: ${event.isError ? 'Error: ' : ''}${output || 'Done'}`,
        );
        this.refresh();
      }
      if (event.type === 'agent_end') {
        chat.messages = agent.state.messages;
        chat.pending = false;
        chat.updatedAt = Date.now();
        this.partialText = '';
        if (this.data.activeChatId === chatId) this.activeAgent = null;
        await this.persist();
        this.refresh();
      }
    });
    await this.persist();
    this.refresh();
    try {
      await agent.prompt(prompt);
    } catch (error) {
      chat.pending = false;
      chat.interrupted = true;
      this.error = error instanceof Error ? error.message : String(error);
      await this.persist();
      this.refresh();
      new Notice(this.error);
    }
  }

  private extractText(message: AgentMessage): string {
    if (message.role !== 'assistant') return '';
    return message.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('');
  }
}
