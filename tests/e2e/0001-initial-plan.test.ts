import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { App } from 'obsidian';
import type { Locator, Page } from 'playwright-core';
import { reloadApp, withAgent, type ModelRequest, type ModelStream } from './support.ts';

declare global {
  interface Window {
    app: App;
  }
}

async function waitFor(check: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + 10000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${description}.`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function toolName(request: ModelRequest, action: string): string {
  const name = request.tools?.find((tool) => new RegExp(action, 'i').test(tool.function.name))
    ?.function.name;
  assert.ok(name, `The model was not offered a ${action} tool.`);
  return name;
}

function currentTurn(request: ModelRequest): ModelRequest['messages'] {
  const latestUser = [...request.messages].reverse().find((message) => message.role === 'user');
  assert.ok(latestUser, 'The model request has no user message.');
  return request.messages.slice(request.messages.indexOf(latestUser));
}

function callTool(stream: ModelStream, name: string, arguments_: Record<string, string>): void {
  stream.chunk({
    role: 'assistant',
    tool_calls: [
      {
        index: 0,
        id: `call-${name}`,
        type: 'function',
        function: { name, arguments: JSON.stringify(arguments_) },
      },
    ],
  });
  stream.finish('tool_calls');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown, description: string): Record<string, unknown> {
  assert.ok(isRecord(value), description);
  return value;
}

function settingRow(settings: Locator, name: string, index = 0): Locator {
  return settings.locator('.setting-item').filter({ hasText: name }).nth(index);
}

async function openAgentSettings(page: Page): Promise<Locator> {
  await page.locator('.clickable-icon:has(svg.lucide-settings)').click();
  const settingsPage = page
    .context()
    .pages()
    .find((item) => item !== page);
  assert.ok(settingsPage, 'Obsidian did not open its Settings window.');
  await settingsPage
    .locator('.vertical-tab-nav-item')
    .filter({ hasText: 'Obsidian Agent' })
    .click();
  const settings = settingsPage.locator('.vertical-tab-content');
  await settings.getByRole('heading', { name: 'Obsidian Agent' }).waitFor();
  return settings;
}

async function closeAgentSettings(page: Page): Promise<void> {
  const settingsPage = page
    .context()
    .pages()
    .find((item) => item !== page);
  assert.ok(settingsPage, 'The Settings window is missing.');
  await settingsPage.close();
}

function localMcpScript(): string {
  return [
    'printf "started\\n" > "$1"',
    'while IFS= read -r line; do',
    '  printf "recv:%s\\n" "$line" >> "$1"',
    '  id=${line##*id*:}',
    '  id=${id%%[^0-9]*}',
    '  case "$line" in',
    '    *initialize*)',
    `      printf '{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":"2025-11-25","capabilities":{"tools":{}},"serverInfo":{"name":"local-fixture","version":"1.0.0"}}}\\n' "$id"`,
    '      ;;',
    '    *tools/list*)',
    '      printf "connected\\n" >> "$1"',
    `      printf '{"jsonrpc":"2.0","id":%s,"result":{"tools":[{"name":"local_ping","description":"Local fixture ping","inputSchema":{"type":"object","properties":{}}}]}}\\n' "$id"`,
    '      ;;',
    '    *tools/call*)',
    `      printf '{"jsonrpc":"2.0","id":%s,"result":{"content":[{"type":"text","text":"local pong"}]}}\\n' "$id"`,
    '      ;;',
    '  esac',
    'done',
    '',
  ].join('\n');
}

async function startRemoteMcp(headers: string[]): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer((request, response) => {
    if (request.url !== '/mcp') {
      response.writeHead(404).end();
      return;
    }
    const token = request.headers['x-fixture-token'];
    headers.push(typeof token === 'string' ? token : '');
    const mcp = new McpServer({ name: 'remote-fixture', version: '1.0.0' });
    mcp.registerTool('remote_ping', { description: 'Remote fixture ping' }, () =>
      Promise.resolve({ content: [{ type: 'text' as const, text: 'remote pong' }] }),
    );
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    mcp
      .connect(transport)
      .then(() => transport.handleRequest(request, response))
      .catch((error: unknown) => {
        if (!response.headersSent) response.writeHead(500);
        response.end(error instanceof Error ? error.message : String(error));
      });
    response.once('close', () => {
      mcp.close().catch(() => undefined);
    });
  });
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string')
        reject(new Error('MCP fixture has no TCP port.'));
      else resolve(address.port);
    });
  });
  return { server, port };
}

async function addMcpServer(
  settings: Locator,
  name: string,
  transport: 'http' | 'stdio',
  target: string,
  args = '',
  headers = '',
): Promise<void> {
  await settingRow(settings, 'Name', 1).locator('input').fill(name);
  await settingRow(settings, 'Transport')
    .locator('select:not([aria-hidden])')
    .selectOption(transport);
  await settingRow(settings, 'URL or command').locator('input').fill(target);
  if (args) await settingRow(settings, 'Command arguments').locator('textarea').fill(args);
  if (headers) await settingRow(settings, 'Secret headers').locator('textarea').fill(headers);
  await settings.getByRole('button', { name: 'Add server' }).click();
  await settingRow(settings, name)
    .waitFor({ timeout: 3000 })
    .catch(async () => {
      const state = await settings.evaluate((element) => ({
        rows: Array.from(element.querySelectorAll('.setting-item'), (row) => row.textContent),
        notices: Array.from(document.querySelectorAll('.notice'), (notice) => notice.textContent),
      }));
      throw new Error(`MCP server was not added: ${JSON.stringify(state)}`);
    });
}

await test('Obsidian Agent streams and restores chats, uses note context, and protects vault edits', async () => {
  let releaseFirst: (() => void) | undefined;
  await withAgent(
    'chat',
    async (agent) => {
      await agent.openSidebar();
      const model = agent.view().getByRole('combobox', { name: 'Model' });
      const thinking = agent.view().getByRole('combobox', { name: 'Thinking' });
      await model.selectOption('custom-fixture::fixture-alternate');
      await thinking.selectOption('high');

      await agent.view().locator('textarea[aria-label="Message"]').fill('First conversation');
      await agent.view().getByRole('button', { name: 'Send' }).click();
      await agent.view().getByText('Streaming begins').waitFor();
      assert.equal(await agent.view().getByRole('button', { name: 'Stop' }).isVisible(), true);
      assert.ok(releaseFirst, 'The first model stream was not opened.');
      releaseFirst();
      await agent.view().getByText('Streaming begins and ends.').waitFor();
      await agent.view().getByRole('button', { name: 'Send' }).waitFor();
      assert.equal(agent.requests[0]?.model, 'fixture-alternate');
      assert.equal(agent.requests[0]?.stream, true);

      await agent.page.locator('.nav-file-title[data-path="Welcome.md"]').first().click();
      await agent.view().getByRole('button', { name: 'Attach active note' }).click();
      await agent.view().getByText('Welcome.md').waitFor();
      await agent.send('Summarize the attached note');
      assert.match(JSON.stringify(agent.requests[1]?.messages), /Fixture note content/);
      await agent.view().getByText('Context acknowledged.').waitFor();

      await agent.view().locator('textarea[aria-label="Message"]').fill('Stop this reply');
      await agent.view().getByRole('button', { name: 'Send' }).click();
      await agent.view().getByText('Unfinished phrase').waitFor();
      await agent.view().getByRole('button', { name: 'Stop' }).click();
      await agent.view().getByRole('button', { name: 'Send' }).waitFor();
      await waitFor(
        () => JSON.stringify(agent.savedData()).toLowerCase().includes('interrupted'),
        'the interrupted chat to be saved',
      );

      await reloadApp(agent.page);
      await agent.openSidebar();
      await agent.view().getByText('Streaming begins and ends.').waitFor();
      await agent.view().getByText('Unfinished phrase').waitFor();
      assert.equal(await model.inputValue(), 'custom-fixture::fixture-alternate');
      assert.equal(await thinking.inputValue(), 'high');
      await agent.newChat();
      assert.equal(await agent.view().getByText('First conversation').count(), 0);
      await agent.view().getByRole('button', { name: 'Saved chats' }).click();
      await agent.view().getByText('First conversation').click();
      await agent.view().getByText('Streaming begins and ends.').waitFor();
    },
    {
      modelHandler: async (request, stream) => {
        const turn = JSON.stringify(currentTurn(request));
        if (turn.includes('First conversation')) {
          stream.chunk({ role: 'assistant', content: 'Streaming begins' });
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
          stream.chunk({ content: ' and ends.' });
          stream.finish();
          return;
        }
        if (turn.includes('Stop this reply')) {
          stream.chunk({ role: 'assistant', content: 'Unfinished phrase' });
          await new Promise<void>((resolve) => {
            stream.response.once('close', resolve);
          });
          return;
        }
        stream.chunk({ role: 'assistant', content: 'Context acknowledged.' });
        stream.finish();
      },
    },
  );

  let releaseEdit: (() => void) | undefined;
  let readCompleted = false;
  let createCompleted = false;
  let editRejected = false;
  let outsideRejected = false;
  await withAgent(
    'vault-tools',
    async (agent) => {
      await agent.openSidebar();
      await agent.send('Create Agent created.md with the planned content');
      await waitFor(
        () => fs.existsSync(path.join(agent.vault, 'Agent created.md')),
        'the created vault note',
      );
      assert.equal(
        fs.readFileSync(path.join(agent.vault, 'Agent created.md'), 'utf8'),
        '# Created by the agent\n',
      );
      assert.equal(createCompleted, true);
      assert.equal((await agent.view().locator('.agent-tool-activity').count()) > 0, true);

      const pending = agent.send('Read Conflict.md, then replace it');
      await waitFor(() => readCompleted, 'the read tool result');
      await agent.page.evaluate(async () => {
        const note = window.app.vault
          .getMarkdownFiles()
          .find((file) => file.path === 'Conflict.md');
        if (!note) throw new Error('Conflict.md was not found in the test vault.');
        await window.app.vault.modify(note, '# External edit\n');
      });
      assert.ok(releaseEdit, 'The edit request was not waiting for the external change.');
      releaseEdit();
      await pending;
      assert.equal(editRejected, true);
      assert.equal(
        fs.readFileSync(path.join(agent.vault, 'Conflict.md'), 'utf8'),
        '# External edit\n',
      );
      await agent.send('Try to create ../Outside.md');
      assert.equal(outsideRejected, true);
      assert.equal(fs.existsSync(path.join(agent.paths.root, 'Outside.md')), false);
    },
    {
      prepareVault: (paths) => {
        fs.writeFileSync(path.join(paths.vault, 'Conflict.md'), '# Original\n');
      },
      modelHandler: async (request, stream) => {
        const messages = currentTurn(request);
        const transcript = JSON.stringify(messages);
        const toolResults = messages.filter((message) => message.role === 'tool').length;
        if (transcript.includes('Create Agent created.md') && toolResults === 0) {
          toolName(request, 'search');
          toolName(request, 'read');
          toolName(request, 'edit');
          assert.doesNotMatch(
            request.tools?.map((tool) => tool.function.name).join(' ') || '',
            /shell|delete|exec/i,
          );
          callTool(stream, toolName(request, 'create'), {
            path: 'Agent created.md',
            content: '# Created by the agent\n',
          });
          return;
        }
        if (transcript.includes('Create Agent created.md')) {
          createCompleted = true;
          stream.chunk({ role: 'assistant', content: 'Created the note.' });
          stream.finish();
          return;
        }
        if (transcript.includes('Try to create ../Outside.md') && toolResults === 0) {
          callTool(stream, toolName(request, 'create'), {
            path: '../Outside.md',
            content: '# Outside\n',
          });
          return;
        }
        if (transcript.includes('Try to create ../Outside.md')) {
          assert.match(
            JSON.stringify(messages.filter((message) => message.role === 'tool')),
            /escap|outside.*vault|not.*(vault|allow)|invalid|reject|denied/i,
          );
          outsideRejected = true;
          stream.chunk({ role: 'assistant', content: 'Outside the vault is rejected.' });
          stream.finish();
          return;
        }
        if (transcript.includes('Read Conflict.md') && toolResults === 0) {
          callTool(stream, toolName(request, 'read'), { path: 'Conflict.md' });
          return;
        }
        if (transcript.includes('Read Conflict.md') && toolResults === 1) {
          assert.match(transcript, /Original/);
          readCompleted = true;
          await new Promise<void>((resolve) => {
            releaseEdit = resolve;
          });
          callTool(stream, toolName(request, 'edit'), {
            path: 'Conflict.md',
            content: '# Agent replacement\n',
          });
          return;
        }
        assert.match(transcript, /chang|modif|stale|version|mismatch/i);
        editRejected = true;
        stream.chunk({ role: 'assistant', content: 'The note changed since I read it.' });
        stream.finish();
      },
    },
  );

  const remoteHeaders: string[] = [];
  const remote = await startRemoteMcp(remoteHeaders);
  try {
    await withAgent(
      'settings-and-mcp',
      async (agent) => {
        let settings = await openAgentSettings(agent.page);
        await settingRow(settings, 'Provider')
          .locator('select:not([aria-hidden])')
          .selectOption('custom-fixture');
        await settingRow(settings, 'API key').locator('input').fill('fixture-api-key');
        await settingRow(settings, 'API key').getByRole('button', { name: 'Save key' }).click();
        await waitFor(
          () => isRecord(agent.savedData().credentialRefs),
          'the provider credential reference',
        );
        const credentialRefs = record(agent.savedData().credentialRefs, 'No credential references');
        const credentialRef = credentialRefs['custom-fixture'];
        assert.ok(typeof credentialRef === 'string');
        assert.equal(JSON.stringify(agent.savedData()).includes('fixture-api-key'), false);
        const storedCredential = await agent.page.evaluate(
          (ref) => window.app.secretStorage.getSecret(ref),
          credentialRef,
        );
        assert.equal(
          record(JSON.parse(storedCredential || ''), 'Credential was not stored').key,
          'fixture-api-key',
        );

        await settingRow(settings, 'Skill folders').locator('input').fill('Skills');
        await settingRow(settings, 'Skill folders').getByRole('button', { name: 'Scan' }).click();
        await settingRow(settings, 'Skills/Writer/SKILL.md').waitFor();
        await closeAgentSettings(agent.page);

        await agent.openSidebar();
        await agent.send('Baseline without the skill');
        const baseline = agent.requests.at(-1);
        assert.ok(baseline);
        assert.equal(baseline.authorization, 'Bearer fixture-api-key');
        assert.doesNotMatch(JSON.stringify(baseline.messages), /SKILL_FIXTURE_TOKEN_7391/);

        settings = await openAgentSettings(agent.page);
        await settingRow(settings, 'Skills/Writer/SKILL.md').locator('.checkbox-container').click();
        await waitFor(() => {
          const enabled = agent.savedData().enabledSkills;
          return (
            Array.isArray(enabled) &&
            enabled.some((item: unknown) => item === 'Skills/Writer/SKILL.md')
          );
        }, 'the enabled skill to be saved');
        await addMcpServer(
          settings,
          'Remote fixture',
          'http',
          `http://127.0.0.1:${String(remote.port)}/mcp`,
          '',
          '{"X-Fixture-Token":"remote-secret"}',
        );
        const serverData = agent.savedData().mcpServers;
        assert.ok(Array.isArray(serverData));
        const remoteData: unknown = serverData.find(
          (item: unknown) => isRecord(item) && item.name === 'Remote fixture',
        );
        const headerRefs = record(
          record(remoteData, 'Remote server was not saved').headerRefs,
          'MCP header reference was not saved',
        );
        const headerRef = headerRefs['X-Fixture-Token'];
        assert.ok(typeof headerRef === 'string');
        assert.equal(JSON.stringify(agent.savedData()).includes('remote-secret'), false);
        assert.equal(
          await agent.page.evaluate((ref) => window.app.secretStorage.getSecret(ref), headerRef),
          'remote-secret',
        );
        await settingRow(settings, 'Remote fixture').locator('.checkbox-container').click();
        await waitFor(
          () => remoteHeaders.includes('remote-secret'),
          'authenticated remote MCP connection',
        );
        await closeAgentSettings(agent.page);

        await agent.send('Invoke remote MCP ping');
        const remoteRequest = agent.requests.find((request) =>
          JSON.stringify(currentTurn(request)).includes('Invoke remote MCP ping'),
        );
        assert.ok(remoteRequest);
        assert.match(JSON.stringify(remoteRequest.messages), /SKILL_FIXTURE_TOKEN_7391/);
        assert.ok(remoteRequest.tools?.some((tool) => tool.function.name.endsWith('_remote_ping')));

        settings = await openAgentSettings(agent.page);
        await settingRow(settings, 'Remote fixture').locator('.checkbox-container').click();
        await addMcpServer(
          settings,
          'Local fixture',
          'stdio',
          'bash',
          `${path.join(agent.paths.root, 'local-mcp.sh')}\n${path.join(agent.paths.root, 'local-mcp-ready')}`,
        );
        await settingRow(settings, 'Local fixture').locator('.checkbox-container').click();
        await waitFor(
          () =>
            fs.existsSync(path.join(agent.paths.root, 'local-mcp-ready')) &&
            fs
              .readFileSync(path.join(agent.paths.root, 'local-mcp-ready'), 'utf8')
              .includes('connected'),
          'local MCP tool discovery',
        ).catch(async (error: unknown) => {
          const marker = path.join(agent.paths.root, 'local-mcp-ready');
          throw new Error(
            `${error instanceof Error ? error.message : String(error)} Settings row: ${String(await settingRow(settings, 'Local fixture').textContent())} Fixture log: ${fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : '(not started)'}`,
          );
        });
        await closeAgentSettings(agent.page);

        await agent.send('Invoke local MCP ping');
        const localRequest = agent.requests.find((request) =>
          JSON.stringify(currentTurn(request)).includes('Invoke local MCP ping'),
        );
        assert.ok(localRequest);
        assert.ok(localRequest.tools?.some((tool) => tool.function.name.endsWith('_local_ping')));
        assert.equal(
          localRequest.tools?.some((tool) => tool.function.name.endsWith('_remote_ping')),
          false,
        );

        settings = await openAgentSettings(agent.page);
        await settingRow(settings, 'Local fixture').locator('.checkbox-container').click();
        await addMcpServer(settings, 'Broken fixture', 'http', 'http://127.0.0.1:1/mcp');
        await settingRow(settings, 'Broken fixture').locator('.checkbox-container').click();
        await settingRow(settings, 'Broken fixture')
          .getByText(/fetch failed|ECONNREFUSED|connect/i)
          .waitFor({ timeout: 10000 });
        await closeAgentSettings(agent.page);

        await agent.send('After MCP disable');
        const afterDisable = agent.requests.at(-1);
        assert.equal(
          afterDisable?.tools?.some((tool) => /_remote_ping|_local_ping/.test(tool.function.name)),
          false,
        );
      },
      {
        prepareVault: (paths) => {
          fs.mkdirSync(path.join(paths.vault, 'Skills', 'Writer'), { recursive: true });
          fs.writeFileSync(
            path.join(paths.vault, 'Skills', 'Writer', 'SKILL.md'),
            '# Writer\n\nSKILL_FIXTURE_TOKEN_7391: Answer concisely.\n',
          );
          fs.writeFileSync(path.join(paths.root, 'local-mcp.sh'), localMcpScript());
        },
        modelHandler: (request, stream) => {
          const messages = currentTurn(request);
          const turn = JSON.stringify(messages);
          const toolResults = messages.filter((message) => message.role === 'tool').length;
          if (turn.includes('Invoke remote MCP ping')) {
            if (toolResults === 0) callTool(stream, toolName(request, 'remote_ping'), {});
            else {
              assert.match(turn, /remote pong/);
              stream.chunk({ role: 'assistant', content: 'Remote tool worked.' });
              stream.finish();
            }
            return;
          }
          if (turn.includes('Invoke local MCP ping')) {
            if (toolResults === 0) callTool(stream, toolName(request, 'local_ping'), {});
            else {
              assert.match(turn, /local pong/);
              stream.chunk({ role: 'assistant', content: 'Local tool worked.' });
              stream.finish();
            }
            return;
          }
          stream.chunk({ role: 'assistant', content: 'Settings acknowledged.' });
          stream.finish();
        },
      },
    );
  } finally {
    remote.server.closeAllConnections();
    await new Promise<void>((resolve) => {
      remote.server.close(() => {
        resolve();
      });
    });
  }
});
