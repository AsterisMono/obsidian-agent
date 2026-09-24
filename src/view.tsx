import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
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

function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

function Sidebar({ plugin }: { plugin: AgentPlugin }) {
  const [draft, setDraft] = useState('');
  const [showSaved, setShowSaved] = useState(false);
  const [search, setSearch] = useState('');
  const conversationRef = useRef<HTMLDivElement>(null);
  const followOutput = useRef(true);
  const mounted = useRef(true);
  const pendingSubmission = useRef<{ chatId: string; message: string } | null>(null);
  const chat = plugin.currentChat();
  const streaming = plugin.isStreaming();
  const catalog = plugin.models.getModels();
  const selectedModel = catalog.some((item) => `${item.provider}::${item.id}` === plugin.data.model)
    ? plugin.data.model
    : '';
  const savedChats = [...plugin.data.chats]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((item) => item.title.toLowerCase().includes(search.trim().toLowerCase()));
  const hasConversation =
    chat.messages.some((message) => messageText(message)) ||
    Boolean(plugin.partialText || chat.interruptedText || chat.activity.length || plugin.error);

  useEffect(() => {
    setDraft('');
    setSearch('');
    followOutput.current = true;
  }, [chat.id]);

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  useEffect(() => {
    const element = conversationRef.current;
    if (element && followOutput.current) element.scrollTop = element.scrollHeight;
  }, [
    chat.id,
    chat.messages.length,
    chat.activity.length,
    chat.interruptedText,
    plugin.partialText,
    plugin.error,
  ]);

  const run = (action: Promise<void>) => {
    action.catch((error: unknown) => {
      plugin.handleError(error);
    });
  };

  const send = () => {
    const message = draft.trim();
    if (!message || streaming) return;
    if (!selectedModel) {
      run(plugin.send(message));
      return;
    }
    const submission = { chatId: chat.id, message };
    pendingSubmission.current = submission;
    setDraft('');
    const settle = () => {
      if (pendingSubmission.current !== submission) return;
      pendingSubmission.current = null;
      if (!mounted.current || plugin.data.activeChatId !== submission.chatId) return;
      if (chat.interrupted && plugin.error)
        setDraft((current) => (current === '' ? submission.message : current));
    };
    plugin
      .send(message)
      .then(settle)
      .catch((error: unknown) => {
        plugin.handleError(error);
        settle();
      });
  };

  return (
    <div className="agent-shell">
      <header className="agent-top">
        <div className="agent-brand">
          <span className="agent-brand-mark">
            <Icon size={17}>
              <path d="m12 2 2.4 6.8L21 12l-6.6 3.2L12 22l-2.4-6.8L3 12l6.6-3.2L12 2Z" />
            </Icon>
          </span>
          <span className="agent-brand-copy">
            <span className="agent-eyebrow">OBSIDIAN</span>
            <strong>Agent</strong>
          </span>
        </div>
        <div className="agent-top-actions">
          <button
            type="button"
            className="agent-header-button agent-new-button"
            aria-label="New chat"
            title="New chat"
            onClick={() => {
              run(plugin.startNewChat());
            }}
          >
            <Icon>
              <path d="M12 5v14M5 12h14" />
            </Icon>
            <span>New</span>
          </button>
          <button
            type="button"
            className="agent-header-button agent-history-button"
            aria-label="Saved chats"
            aria-expanded={showSaved}
            title="Saved chats"
            onClick={() => {
              setShowSaved((value) => !value);
            }}
          >
            <Icon>
              <path d="M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 7v5l3 2" />
            </Icon>
          </button>
        </div>
      </header>

      {showSaved && (
        <section className="agent-saved" aria-label="Saved chats">
          <div className="agent-saved-heading">
            <span>Recent chats</span>
            <span className="agent-count">{plugin.data.chats.length}</span>
          </div>
          <div className="agent-search-wrap">
            <Icon size={15}>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-4-4" />
            </Icon>
            <input
              type="search"
              aria-label="Search chats"
              placeholder="Search chats"
              value={search}
              onChange={(event) => {
                setSearch(event.currentTarget.value);
              }}
            />
          </div>
          <div className="agent-saved-list">
            {savedChats.length ? (
              savedChats.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-chat-id={item.id}
                  aria-current={item.id === chat.id ? 'true' : undefined}
                  className="agent-saved-chat"
                  onClick={() => {
                    run(plugin.openChat(item.id));
                  }}
                >
                  <span className="agent-saved-dot" />
                  <span className="agent-saved-title">{item.title}</span>
                </button>
              ))
            ) : (
              <p className="agent-saved-empty">No matching chats</p>
            )}
          </div>
        </section>
      )}

      <div className="agent-controls">
        <label>
          <span>Model</span>
          <select
            aria-label="Model"
            value={selectedModel}
            disabled={streaming}
            onChange={(event) => {
              run(plugin.setModel(event.currentTarget.value));
            }}
          >
            <option value="">Choose a model</option>
            {catalog.map((item) => (
              <option key={`${item.provider}::${item.id}`} value={`${item.provider}::${item.id}`}>
                {item.provider}: {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Thinking</span>
          <select
            aria-label="Thinking"
            value={plugin.data.thinking}
            disabled={streaming}
            onChange={(event) => {
              run(plugin.setThinking(event.currentTarget.value));
            }}
          >
            {['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="agent-conversation-header">
        <span>Conversation</span>
        <span className="agent-conversation-status">{streaming ? 'Responding' : 'Ready'}</span>
      </div>
      <div
        ref={conversationRef}
        className="agent-conversation"
        role="log"
        aria-label="Conversation"
        onScroll={(event) => {
          const element = event.currentTarget;
          followOutput.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 48;
        }}
      >
        {!hasConversation && (
          <div className="agent-empty-state">
            <div className="agent-empty-symbol">
              <Icon size={24}>
                <path d="m12 2 2.4 6.8L21 12l-6.6 3.2L12 22l-2.4-6.8L3 12l6.6-3.2L12 2Z" />
              </Icon>
            </div>
            <strong>What can I help with?</strong>
            <p>Ask a question about your vault or attach a note to get started.</p>
          </div>
        )}
        {chat.messages.map((message, index) => {
          const content = messageText(message);
          if (!content) return null;
          return (
            <div key={index} className={`agent-message agent-${message.role}`}>
              {message.role === 'assistant' && <span className="agent-response-mark">✦</span>}
              <div className="agent-message-body">{content}</div>
            </div>
          );
        })}
        {plugin.partialText && (
          <div className="agent-message agent-assistant agent-partial">
            <span className="agent-response-mark">✦</span>
            <div className="agent-message-body">{plugin.partialText}</div>
          </div>
        )}
        {chat.interrupted && chat.interruptedText && (
          <div className="agent-message agent-assistant">
            <span className="agent-response-mark">✦</span>
            <div className="agent-message-body">{chat.interruptedText}</div>
          </div>
        )}
        {chat.activity.length > 0 && (
          <div className="agent-activity-list">
            <span className="agent-activity-heading">Activity</span>
            {chat.activity.map((activity, index) => (
              <div key={index} className="agent-tool-activity">
                <span className="agent-activity-dot" />
                <span>{activity}</span>
              </div>
            ))}
          </div>
        )}
        {chat.interrupted && <div className="agent-interrupted">Interrupted</div>}
        {plugin.error && <div className="agent-error">{plugin.error}</div>}
      </div>

      <div className="agent-composer">
        <div className="agent-composer-card">
          {plugin.attachment && (
            <div className="agent-attachment">
              <Icon size={14}>
                <path d="m21 11.5-8.8 8.8a6 6 0 0 1-8.5-8.5l8.1-8.1a4 4 0 0 1 5.7 5.7l-8.1 8.1a2 2 0 0 1-2.8-2.8l7.5-7.5" />
              </Icon>
              <span>{plugin.attachment.path}</span>
            </div>
          )}
          <textarea
            aria-label="Message"
            placeholder="Ask about your vault"
            rows={3}
            value={draft}
            onChange={(event) => {
              setDraft(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send();
              }
            }}
          />
          <div className="agent-actions">
            <button
              type="button"
              className="agent-attach-button"
              aria-label="Attach active note"
              onClick={() => {
                run(plugin.attachActiveNote());
              }}
            >
              <Icon>
                <path d="m21 11.5-8.8 8.8a6 6 0 0 1-8.5-8.5l8.1-8.1a4 4 0 0 1 5.7 5.7l-8.1 8.1a2 2 0 0 1-2.8-2.8l7.5-7.5" />
              </Icon>
              <span>Attach</span>
            </button>
            <span className="agent-composer-hint">Enter to send</span>
            {streaming ? (
              <button
                type="button"
                className="agent-submit agent-stop"
                onClick={() => {
                  plugin.stop();
                }}
              >
                <Icon size={14}>
                  <rect
                    x="6"
                    y="6"
                    width="12"
                    height="12"
                    rx="2"
                    fill="currentColor"
                    stroke="none"
                  />
                </Icon>
                <span>Stop</span>
              </button>
            ) : (
              <button
                type="button"
                className="agent-submit agent-send"
                disabled={!draft.trim()}
                onClick={send}
              >
                <span>Send</span>
                <Icon size={15}>
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </Icon>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export class AgentView extends ItemView {
  private root: Root | null = null;

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
    this.root = createRoot(this.contentEl);
    this.render();
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    this.root?.unmount();
    this.root = null;
    this.contentEl.removeClass('agent-view');
    return Promise.resolve();
  }

  render(): void {
    this.root?.render(<Sidebar plugin={this.plugin} />);
  }
}
