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

type Run = {
  epoch: object;
  id: bigint;
  chat: Chat;
  agent: Agent | null;
};

export default class AgentPlugin extends Plugin {
  data!: AgentData;
  models!: MutableModels;
  credentials!: SecretCredentials;
  mcp!: McpConnections;
  partialText = '';
  error = '';
  attachment: { path: string; content: string } | null = null;
  private owner: Run | null = null;
  private readonly epoch = {};
  private nextRunId = 0n;
  private live = true;
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
      const chat = this.createChat();
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
    this.cancelRun();
    this.live = false;
    this.mcp.close().catch((error: unknown) => {
      if (this.live) this.handleError(error);
    });
    this.persistQueue.catch((error: unknown) => {
      if (this.live) this.handleError(error);
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
    const created = this.createChat();
    this.data.chats.push(created);
    this.data.activeChatId = created.id;
    return created;
  }

  isStreaming(): boolean {
    return this.owner !== null;
  }

  private createChat(): Chat {
    const existing = new Set(this.data.chats.map((chat) => chat.id));
    let chat: Chat;
    do {
      chat = newChat();
    } while (existing.has(chat.id));
    return chat;
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
    this.cancelRun();
    const chat = this.createChat();
    this.data.chats.push(chat);
    this.data.activeChatId = chat.id;
    this.partialText = '';
    this.attachment = null;
    this.error = '';
    this.refresh();
    await this.persist();
  }

  async openChat(id: string): Promise<void> {
    if (!this.data.chats.some((chat) => chat.id === id)) return;
    this.cancelRun();
    this.data.activeChatId = id;
    this.partialText = '';
    this.attachment = null;
    this.error = '';
    this.refresh();
    await this.persist();
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
    this.cancelRun();
  }

  private owns(run: Run): boolean {
    return this.live && run.epoch === this.epoch && this.owner === run && this.owner.id === run.id;
  }

  private cancelRun(): void {
    const run = this.owner;
    if (!run) return;
    this.owner = null;
    let retainedInMessages = false;
    if (run.agent) {
      run.chat.messages = [...run.agent.state.messages];
      const streaming = run.agent.state.streamingMessage;
      if (this.partialText && streaming?.role === 'assistant') {
        run.chat.messages.push({
          ...streaming,
          content: [{ type: 'text', text: this.partialText }],
          stopReason: 'aborted',
        });
        run.chat.interruptedText = '';
        retainedInMessages = true;
      }
    }
    if (this.partialText && !retainedInMessages) run.chat.interruptedText = this.partialText;
    run.chat.pending = false;
    run.chat.interrupted = true;
    run.chat.updatedAt = Date.now();
    this.partialText = '';
    run.agent?.abort();
    this.persist().catch((error: unknown) => {
      if (this.live && this.owner === null) this.handleError(error);
    });
    this.refresh();
  }

  private failRun(run: Run, error: unknown): void {
    if (!this.owns(run)) return;
    run.chat.pending = false;
    run.chat.interrupted = true;
    run.chat.updatedAt = Date.now();
    this.owner = null;
    this.partialText = '';
    this.error = error instanceof Error ? error.message : String(error);
    this.refresh();
    new Notice(this.error);
    this.persist().catch((failure: unknown) => {
      if (this.live && this.owner === null) this.handleError(failure);
    });
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
    if (!message.trim() || this.isStreaming() || !this.live) return;
    const selected = this.models
      .getModels()
      .find((model) => `${model.provider}::${model.id}` === this.data.model);
    if (!selected) {
      this.error = 'Choose a model in the sidebar or configure one in settings.';
      this.refresh();
      return;
    }
    const chat = this.currentChat();
    const run: Run = { epoch: this.epoch, id: ++this.nextRunId, chat, agent: null };
    this.owner = run;
    this.partialText = '';
    this.error = '';
    chat.pending = true;
    chat.interrupted = false;
    chat.interruptedText = '';
    chat.updatedAt = Date.now();
    if (chat.title === 'New chat') chat.title = message.slice(0, 80);
    const thinking = this.data.thinking;
    const skillData = {
      ...this.data,
      skillFolders: [...this.data.skillFolders],
      enabledSkills: [...this.data.enabledSkills],
    };
    const attachment = this.attachment;
    this.attachment = null;
    let prompt = message;
    if (attachment) prompt += `\n\nAttached ${attachment.path}:\n${attachment.content}`;
    this.refresh();
    let systemPrompt: string;
    try {
      systemPrompt = [
        'You are Obsidian Agent. Help with this vault using only the provided tools. Vault writes are applied immediately when requested. Read a note before editing it. Never request shell commands, deletion, or files outside the vault.',
        await skillInstructions(this.app, skillData),
      ]
        .filter(Boolean)
        .join('\n\n');
    } catch (error) {
      this.failRun(run, error);
      return;
    }
    if (!this.owns(run)) return;
    const history: AgentMessage[] =
      chat.messages[0]?.role === 'system'
        ? [{ ...chat.messages[0], content: systemPrompt }, ...chat.messages.slice(1)]
        : chat.messages;
    const agent = new Agent({
      initialState: {
        model: selected,
        thinkingLevel: thinking,
        systemPrompt,
        messages: history,
        tools: [...new VaultTools(this.app).create(), ...this.mcp.tools()],
      },
      streamFn: (model, context, options) =>
        this.models.streamSimple(model, context, { ...options, fetch: nodeFetch }),
      toolExecution: 'sequential',
    });
    run.agent = agent;
    agent.subscribe(async (event) => {
      if (!this.owns(run)) return;
      if (event.type === 'message_update' && event.message.role === 'assistant') {
        this.partialText = this.extractText(event.message);
        chat.interruptedText = this.partialText;
        try {
          await this.persist();
        } catch (error) {
          if (this.owns(run)) this.error = error instanceof Error ? error.message : String(error);
        }
        if (!this.owns(run)) return;
        this.refresh();
      }
      if (event.type === 'message_end') {
        chat.messages = agent.state.messages;
        if (event.message.role === 'assistant') {
          this.partialText = '';
          chat.interruptedText = '';
        }
        if (event.message.role === 'assistant' && event.message.stopReason === 'error') {
          this.error = event.message.errorMessage ?? 'Model request failed.';
          chat.interrupted = true;
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
        if (!chat.interrupted) chat.interruptedText = '';
        try {
          await this.persist();
        } catch (error) {
          if (this.owns(run)) this.error = error instanceof Error ? error.message : String(error);
        }
        if (!this.owns(run)) return;
        this.owner = null;
        this.refresh();
      }
    });
    try {
      await this.persist();
    } catch (error) {
      this.failRun(run, error);
      return;
    }
    if (!this.owns(run)) return;
    this.refresh();
    try {
      await agent.prompt(prompt);
    } catch (error) {
      this.failRun(run, error);
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
