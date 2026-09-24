import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { normalizePath, TFile, TFolder, type App } from 'obsidian';
import { isRecord } from './data.ts';

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }], details: undefined };
}

function notePath(path: string): string {
  if (
    path.startsWith('/') ||
    /^[a-zA-Z]:/.test(path) ||
    path.includes('\\') ||
    path.split('/').some((part) => part === '..' || part === '.' || part.startsWith('.')) ||
    !path.toLowerCase().endsWith('.md')
  ) {
    throw new Error('Only Markdown notes inside the vault are allowed.');
  }
  const normalized = normalizePath(path);
  if (!normalized || normalized !== path.replace(/\/+/g, '/')) {
    throw new Error('Invalid vault note path.');
  }
  return normalized;
}

export class VaultTools {
  private readonly snapshots = new Map<string, string>();

  constructor(private readonly app: App) {}

  create(): AgentTool[] {
    return [
      {
        name: 'search_notes',
        label: 'Search notes',
        description:
          'Search Markdown note paths and contents in the vault. Returns matching paths and excerpts.',
        parameters: Type.Object({ query: Type.String() }),
        execute: async (_id, params) => {
          if (!isRecord(params) || typeof params.query !== 'string')
            throw new Error('A search query is required.');
          const query = params.query;
          const needle = query.trim().toLowerCase();
          if (!needle) throw new Error('Search query is empty.');
          const matches: string[] = [];
          for (const file of this.app.vault.getMarkdownFiles()) {
            if (file.path.split('/').some((part) => part.startsWith('.'))) continue;
            const content = await this.app.vault.cachedRead(file);
            const index = content.toLowerCase().indexOf(needle);
            if (index >= 0 || file.path.toLowerCase().includes(needle)) {
              const start = Math.max(0, index - 80);
              matches.push(`${file.path}: ${index < 0 ? '' : content.slice(start, start + 240)}`);
            }
            if (matches.length >= 30) break;
          }
          return textResult(matches.join('\n') || 'No matching notes.');
        },
      },
      {
        name: 'read_note',
        label: 'Read note',
        description: 'Read a Markdown note and remember its exact content for a safe later edit.',
        parameters: Type.Object({ path: Type.String() }),
        execute: async (_id, params) => {
          if (!isRecord(params) || typeof params.path !== 'string')
            throw new Error('A note path is required.');
          const path = params.path;
          const normalized = notePath(path);
          const file = this.app.vault.getAbstractFileByPath(normalized);
          if (!(file instanceof TFile)) throw new Error(`Note not found: ${normalized}`);
          const content = await this.app.vault.read(file);
          this.snapshots.set(normalized, content);
          return textResult(content);
        },
      },
      {
        name: 'create_note',
        label: 'Create note',
        description: 'Create a new Markdown note in the vault. Fails if the path already exists.',
        parameters: Type.Object({ path: Type.String(), content: Type.String() }),
        execute: async (_id, params) => {
          if (
            !isRecord(params) ||
            typeof params.path !== 'string' ||
            typeof params.content !== 'string'
          )
            throw new Error('A note path and content are required.');
          const { path, content } = params;
          const normalized = notePath(path);
          if (this.app.vault.getAbstractFileByPath(normalized))
            throw new Error('Note already exists.');
          const parts = normalized.split('/');
          if (parts.length > 1) {
            let folder = '';
            for (const part of parts.slice(0, -1)) {
              folder = folder ? `${folder}/${part}` : part;
              const existing = this.app.vault.getAbstractFileByPath(folder);
              if (!existing) await this.app.vault.createFolder(folder);
              else if (!(existing instanceof TFolder))
                throw new Error('A file blocks the target folder.');
            }
          }
          await this.app.vault.create(normalized, content);
          this.snapshots.set(normalized, content);
          return textResult(`Created ${normalized}`);
        },
      },
      {
        name: 'edit_note',
        label: 'Edit note',
        description:
          'Replace a Markdown note with the supplied content only if it has not changed since read_note.',
        parameters: Type.Object({ path: Type.String(), content: Type.String() }),
        executionMode: 'sequential',
        execute: async (_id, params) => {
          if (
            !isRecord(params) ||
            typeof params.path !== 'string' ||
            typeof params.content !== 'string'
          )
            throw new Error('A note path and content are required.');
          const { path, content } = params;
          const normalized = notePath(path);
          const snapshot = this.snapshots.get(normalized);
          if (snapshot === undefined) throw new Error('Read the note before editing it.');
          const file = this.app.vault.getAbstractFileByPath(normalized);
          if (!(file instanceof TFile)) throw new Error(`Note not found: ${normalized}`);
          const activeEditor = this.app.workspace.activeEditor;
          if (
            activeEditor?.file?.path === normalized &&
            activeEditor.editor?.getValue() !== snapshot
          ) {
            throw new Error('Edit conflict: the active editor changed since the note was read.');
          }
          await this.app.vault.process(file, (current) => {
            if (current !== snapshot)
              throw new Error('Edit conflict: note changed since it was read.');
            return content;
          });
          this.snapshots.set(normalized, content);
          return textResult(`Edited ${normalized}`);
        },
      },
    ];
  }
}
