import type { AuthEvent, AuthPrompt } from '@earendil-works/pi-ai';
import { Modal, Notice, PluginSettingTab, Setting, type App } from 'obsidian';
import type AgentPlugin from './main.ts';
import { discoverSkills } from './skills.ts';
import type { McpServer } from './data.ts';
import { isRecord, mcpHeaderSecretId } from './data.ts';

class LoginDialog extends Modal {
  private cancelPending: (() => void) | null = null;

  notify(event: AuthEvent): void {
    const row = this.contentEl.createDiv();
    if (event.type === 'auth_url') {
      row.createEl('a', {
        text: event.url,
        href: event.url,
        attr: { target: '_blank', rel: 'noopener noreferrer' },
      });
    } else if (event.type === 'device_code') {
      row.setText(`${event.userCode} — ${event.verificationUri}`);
    } else {
      row.setText(event.message);
      if (event.type === 'info') {
        for (const link of event.links ?? [])
          row.createEl('a', { text: link.label ?? link.url, href: link.url });
      }
    }
  }

  ask(prompt: AuthPrompt): Promise<string> {
    return new Promise((resolve, reject) => {
      const row = this.contentEl.createDiv({ cls: 'agent-login-prompt' });
      row.createEl('label', { text: prompt.message });
      const onAbort = () => {
        finish();
        reject(new Error('Login prompt cancelled.'));
      };
      const finish = () => {
        prompt.signal?.removeEventListener('abort', onAbort);
        this.cancelPending = null;
        row.remove();
      };
      this.cancelPending = () => {
        finish();
        reject(new Error('Login cancelled.'));
      };
      if (prompt.type === 'select') {
        const select = row.createEl('select');
        for (const option of prompt.options) {
          const item = select.createEl('option', { text: option.label });
          item.value = option.id;
        }
        row.createEl('button', { text: 'Continue' }).onclick = () => {
          finish();
          resolve(select.value);
        };
      } else {
        const input = row.createEl('input', { attr: { placeholder: prompt.placeholder ?? '' } });
        input.type = prompt.type === 'secret' ? 'password' : 'text';
        row.createEl('button', { text: 'Continue' }).onclick = () => {
          finish();
          resolve(input.value);
        };
      }
      prompt.signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  onClose(): void {
    this.cancelPending?.();
  }
}

function parseHeaderInput(value: string): Record<string, string> {
  if (!value.trim()) return {};
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed) || !Object.values(parsed).every((item) => typeof item === 'string')) {
    throw new Error('Headers must be a JSON object of string values.');
  }
  return Object.fromEntries(Object.entries(parsed).map(([name, item]) => [name, String(item)]));
}

export class AgentSettingsTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: AgentPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    this.renderSettings();
  }

  private renderSettings(): void {
    const root = this.containerEl;
    root.empty();
    root.createEl('h2', { text: 'Obsidian Agent' });

    root.createEl('h3', { text: 'Provider credentials' });
    let providerId = this.plugin.models.getProviders()[0]?.id ?? '';
    let apiKey = '';
    new Setting(root).setName('Provider').addDropdown((dropdown) => {
      for (const provider of this.plugin.models.getProviders())
        dropdown.addOption(provider.id, provider.name);
      dropdown.setValue(providerId).onChange((value) => {
        providerId = value;
      });
    });
    new Setting(root)
      .setName('API key')
      .addText((text) => {
        text.inputEl.type = 'password';
        text.setPlaceholder('Stored in Obsidian SecretStorage').onChange((value) => {
          apiKey = value;
        });
      })
      .addButton((button) =>
        button.setButtonText('Save key').onClick(async () => {
          if (!providerId || !apiKey) return;
          await this.plugin.credentials.modify(providerId, () =>
            Promise.resolve({
              type: 'api_key',
              key: apiKey,
            }),
          );
          await this.plugin.refreshProvider(providerId);
          new Notice('API key saved.');
          this.renderSettings();
        }),
      )
      .addButton((button) =>
        button.setButtonText('OAuth login').onClick(async () => {
          if (!providerId) return;
          const dialog = new LoginDialog(this.app);
          dialog.open();
          try {
            await this.plugin.models.login(providerId, 'oauth', {
              prompt: (prompt) => dialog.ask(prompt),
              notify: (event) => {
                dialog.notify(event);
              },
            });
            await this.plugin.refreshProvider(providerId);
            new Notice('Provider connected.');
          } catch (error) {
            new Notice(error instanceof Error ? error.message : String(error));
          } finally {
            dialog.close();
            this.renderSettings();
          }
        }),
      );
    new Setting(root)
      .setName('Model catalog')
      .setDesc('Refresh models offered by the selected provider')
      .addButton((button) =>
        button.setButtonText('Refresh models').onClick(async () => {
          await this.plugin.refreshProvider(providerId);
          this.renderSettings();
        }),
      );

    root.createEl('h3', { text: 'Custom endpoints' });
    let endpointName = '';
    let endpointUrl = '';
    let endpointModels = '';
    new Setting(root).setName('Name').addText((text) =>
      text.onChange((value) => {
        endpointName = value;
      }),
    );
    new Setting(root).setName('Base URL').addText((text) =>
      text.setPlaceholder('http://localhost:11434/v1').onChange((value) => {
        endpointUrl = value;
      }),
    );
    new Setting(root)
      .setName('Model IDs')
      .setDesc('Comma separated')
      .addText((text) =>
        text.onChange((value) => {
          endpointModels = value;
        }),
      );
    new Setting(root).addButton((button) =>
      button.setButtonText('Add endpoint').onClick(async () => {
        try {
          const url = new URL(endpointUrl);
          if (url.protocol !== 'http:' && url.protocol !== 'https:')
            throw new Error('Endpoint must use HTTP or HTTPS.');
          const models = endpointModels
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
          if (!endpointName.trim() || models.length === 0)
            throw new Error('Name and model IDs are required.');
          this.plugin.data.customEndpoints.push({
            id: crypto.randomUUID(),
            name: endpointName.trim(),
            url: url.toString().replace(/\/$/, ''),
            models,
          });
          await this.plugin.persist();
          this.plugin.rebuildModels();
          this.renderSettings();
        } catch (error) {
          new Notice(error instanceof Error ? error.message : String(error));
        }
      }),
    );
    for (const endpoint of this.plugin.data.customEndpoints) {
      new Setting(root)
        .setName(endpoint.name)
        .setDesc(`${endpoint.url} — ${endpoint.models.join(', ')}`)
        .addButton((button) =>
          button.setButtonText('Remove').onClick(async () => {
            this.plugin.data.customEndpoints = this.plugin.data.customEndpoints.filter(
              (item) => item.id !== endpoint.id,
            );
            await this.plugin.persist();
            this.plugin.rebuildModels();
            this.renderSettings();
          }),
        );
    }

    root.createEl('h3', { text: 'Skills' });
    let folders = this.plugin.data.skillFolders.join(', ');
    new Setting(root)
      .setName('Skill folders')
      .setDesc('Vault folders containing SKILL.md files, comma separated')
      .addText((text) =>
        text.setValue(folders).onChange((value) => {
          folders = value;
        }),
      )
      .addButton((button) =>
        button.setButtonText('Scan').onClick(async () => {
          this.plugin.data.skillFolders = folders
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
          await this.plugin.persist();
          this.renderSettings();
        }),
      );
    for (const file of discoverSkills(this.app, this.plugin.data.skillFolders)) {
      new Setting(root).setName(file.path).addToggle((toggle) =>
        toggle
          .setValue(this.plugin.data.enabledSkills.includes(file.path))
          .onChange(async (enabled) => {
            const current = new Set(this.plugin.data.enabledSkills);
            if (enabled) current.add(file.path);
            else current.delete(file.path);
            this.plugin.data.enabledSkills = [...current];
            await this.plugin.persist();
          }),
      );
    }

    root.createEl('h3', { text: 'MCP servers' });
    let serverName = '';
    let serverType: 'stdio' | 'http' = 'http';
    let serverTarget = '';
    let serverArgs = '';
    let serverHeaders = '';
    new Setting(root).setName('Name').addText((text) =>
      text.onChange((value) => {
        serverName = value;
      }),
    );
    new Setting(root).setName('Transport').addDropdown((dropdown) =>
      dropdown
        .addOption('http', 'Streamable HTTP')
        .addOption('stdio', 'Local stdio')
        .onChange((value) => {
          serverType = value === 'stdio' ? 'stdio' : 'http';
        }),
    );
    new Setting(root).setName('URL or command').addText((text) =>
      text.onChange((value) => {
        serverTarget = value;
      }),
    );
    new Setting(root)
      .setName('Command arguments')
      .setDesc('One argument per line for stdio servers')
      .addTextArea((text) =>
        text.onChange((value) => {
          serverArgs = value;
        }),
      );
    new Setting(root)
      .setName('Secret headers')
      .setDesc('JSON object for HTTP servers; values are stored in SecretStorage')
      .addTextArea((text) =>
        text.onChange((value) => {
          serverHeaders = value;
        }),
      );
    new Setting(root).addButton((button) =>
      button.setButtonText('Add server').onClick(async () => {
        try {
          if (!serverName.trim() || !serverTarget.trim())
            throw new Error('Server name and target are required.');
          if (serverType === 'http') new URL(serverTarget);
          const id = crypto.randomUUID();
          const headerRefs: Record<string, string> = {};
          for (const [name, secret] of Object.entries(parseHeaderInput(serverHeaders))) {
            const ref = mcpHeaderSecretId(id, name);
            this.app.secretStorage.setSecret(ref, secret);
            headerRefs[name] = ref;
          }
          const server: McpServer = {
            id,
            name: serverName.trim(),
            type: serverType,
            enabled: false,
            command: serverType === 'stdio' ? serverTarget.trim() : '',
            args: serverArgs
              .split('\n')
              .map((item) => item.trim())
              .filter(Boolean),
            url: serverType === 'http' ? serverTarget.trim() : '',
            headerRefs,
          };
          this.plugin.data.mcpServers.push(server);
          await this.plugin.persist();
          this.renderSettings();
        } catch (error) {
          new Notice(error instanceof Error ? error.message : String(error));
        }
      }),
    );
    for (const server of this.plugin.data.mcpServers) {
      new Setting(root)
        .setName(server.name)
        .setDesc(
          this.plugin.mcp.errors.get(server.id) ??
            (server.type === 'http' ? server.url : server.command),
        )
        .addToggle((toggle) =>
          toggle.setValue(server.enabled).onChange(async (enabled) => {
            server.enabled = enabled;
            await this.plugin.persist();
            await this.plugin.refreshMcp();
            this.renderSettings();
          }),
        )
        .addButton((button) =>
          button.setButtonText('Remove').onClick(async () => {
            server.enabled = false;
            this.plugin.data.mcpServers = this.plugin.data.mcpServers.filter(
              (item) => item.id !== server.id,
            );
            await this.plugin.refreshMcp();
            await this.plugin.persist();
            this.renderSettings();
          }),
        );
    }
  }
}
