import { ItemView, type WorkspaceLeaf } from 'obsidian';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type AgentPlugin from './main.ts';
import { isRecord } from './data.ts';

export const AGENT_VIEW = 'agent-chat';

function messageText(message: AgentMessage): string {
  if (message.role !== 'user' && message.role !== 'assistant') return '';
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return '';
  return message.content
    .filter(
      (block): block is { type: 'text'; text: string } =>
        isRecord(block) && block.type === 'text' && typeof block.text === 'string',
    )
    .map((block) => block.text)
    .join('');
}

export class AgentView extends ItemView {
  private showSaved = false;
  private draft = '';

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: AgentPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return AGENT_VIEW;
  }

  getDisplayText(): string {
    return 'Obsidian Agent';
  }

  getIcon(): string {
    return 'bot';
  }

  onOpen(): Promise<void> {
    this.contentEl.addClass('agent-view');
    this.registerDomEvent(this.contentEl, 'click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLButtonElement>('button[data-action]');
      if (!button) return;
      const action = button.dataset.action;
      if (action === 'new')
        this.plugin.startNewChat().catch((error: unknown) => {
          this.plugin.handleError(error);
        });
      if (action === 'saved') {
        this.showSaved = !this.showSaved;
        this.render();
      }
      if (action === 'open-chat' && button.dataset.chatId)
        this.plugin.openChat(button.dataset.chatId).catch((error: unknown) => {
          this.plugin.handleError(error);
        });
      if (action === 'attach')
        this.plugin.attachActiveNote().catch((error: unknown) => {
          this.plugin.handleError(error);
        });
      if (action === 'send')
        this.send().catch((error: unknown) => {
          this.plugin.handleError(error);
        });
      if (action === 'stop') this.plugin.stop();
    });
    this.registerDomEvent(this.contentEl, 'change', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLSelectElement)) return;
      if (target.dataset.select === 'model')
        this.plugin.setModel(target.value).catch((error: unknown) => {
          this.plugin.handleError(error);
        });
      if (target.dataset.select === 'thinking')
        this.plugin.setThinking(target.value).catch((error: unknown) => {
          this.plugin.handleError(error);
        });
    });
    this.registerDomEvent(this.contentEl, 'input', (event) => {
      const target = event.target;
      if (target instanceof HTMLTextAreaElement) this.draft = target.value;
    });
    this.registerDomEvent(this.contentEl, 'keydown', (event) => {
      const target = event.target;
      if (target instanceof HTMLTextAreaElement && event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        this.send().catch((error: unknown) => {
          this.plugin.handleError(error);
        });
      }
    });
    this.render();
    return Promise.resolve();
  }

  private async send(): Promise<void> {
    const message = this.draft.trim();
    if (!message || this.plugin.isStreaming()) return;
    this.draft = '';
    this.render();
    await this.plugin.send(message);
  }

  render(): void {
    const root = this.contentEl;
    root.empty();
    const top = root.createDiv({ cls: 'agent-top' });
    top.createEl('strong', { text: 'Obsidian Agent' });
    top.createEl('button', {
      text: 'New chat',
      attr: { 'data-action': 'new', 'aria-label': 'New chat' },
    });
    top.createEl('button', {
      text: 'Saved chats',
      attr: { 'data-action': 'saved', 'aria-label': 'Saved chats' },
    });

    if (this.showSaved) {
      const saved = root.createDiv({ cls: 'agent-saved' });
      for (const chat of [...this.plugin.data.chats].sort((a, b) => b.updatedAt - a.updatedAt)) {
        saved.createEl('button', {
          text: chat.title,
          attr: { 'data-action': 'open-chat', 'data-chat-id': chat.id },
        });
      }
    }

    const controls = root.createDiv({ cls: 'agent-controls' });
    const modelLabel = controls.createEl('label', { text: 'Model' });
    const model = modelLabel.createEl('select', {
      attr: { 'aria-label': 'Model', 'data-select': 'model' },
    });
    const catalog = this.plugin.models.getModels();
    for (const item of catalog) {
      const option = model.createEl('option', { text: `${item.provider}: ${item.name}` });
      option.value = `${item.provider}::${item.id}`;
    }
    model.value = this.plugin.data.model;
    const thinkingLabel = controls.createEl('label', { text: 'Thinking' });
    const thinking = thinkingLabel.createEl('select', {
      attr: { 'aria-label': 'Thinking', 'data-select': 'thinking' },
    });
    for (const value of ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']) {
      const option = thinking.createEl('option', { text: value });
      option.value = value;
    }
    thinking.value = this.plugin.data.thinking;

    const chat = this.plugin.currentChat();
    const conversation = root.createDiv({ cls: 'agent-conversation' });
    for (const message of chat.messages) {
      const content = messageText(message);
      if (!content) continue;
      conversation.createDiv({ cls: `agent-message agent-${message.role}`, text: content });
    }
    const partial = this.plugin.partialText;
    if (partial)
      conversation.createDiv({ cls: 'agent-message agent-assistant agent-partial', text: partial });
    if (chat.interrupted && chat.interruptedText)
      conversation.createDiv({ cls: 'agent-message agent-assistant', text: chat.interruptedText });
    for (const activity of chat.activity) {
      conversation.createDiv({ cls: 'agent-tool-activity', text: activity });
    }
    if (chat.interrupted) conversation.createDiv({ cls: 'agent-interrupted', text: 'Interrupted' });
    if (this.plugin.error) conversation.createDiv({ cls: 'agent-error', text: this.plugin.error });

    const composer = root.createDiv({ cls: 'agent-composer' });
    if (this.plugin.attachment) {
      composer.createDiv({ cls: 'agent-attachment', text: this.plugin.attachment.path });
    }
    composer.createEl('textarea', {
      attr: { 'aria-label': 'Message', placeholder: 'Ask about your vault' },
      text: this.draft,
    });
    const actions = composer.createDiv({ cls: 'agent-actions' });
    actions.createEl('button', {
      text: 'Attach active note',
      attr: { 'data-action': 'attach', 'aria-label': 'Attach active note' },
    });
    if (this.plugin.isStreaming()) {
      actions.createEl('button', {
        text: 'Stop',
        attr: { 'data-action': 'stop', 'aria-label': 'Stop' },
      });
    } else {
      actions.createEl('button', {
        text: 'Send',
        attr: { 'data-action': 'send', 'aria-label': 'Send' },
      });
    }
  }
}
