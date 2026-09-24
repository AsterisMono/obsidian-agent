import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { App } from 'obsidian';
import type { Locator, Page } from 'playwright-core';
import { withAgent, type ModelRequest, type ModelStream } from './support.ts';

declare global {
  interface Window {
    app: App;
    releaseAgentSkillRead?: () => void;
    restoreAgentProcess?: () => void;
    agentSkillReadEntered?: boolean;
    releaseAgentSave?: () => void;
    agentSaveEntered?: boolean;
  }
}

type ToolAction = {
  tool: string;
  args: Record<string, string>;
  result: RegExp;
};

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function leanFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === '.lake' ? [] : leanFiles(filename);
    return entry.name.endsWith('.lean') ? [filename] : [];
  });
}

function checkedModelCases(): Map<string, { contract: string; input: unknown; expected: unknown }> {
  const docs = path.join(pluginRoot, 'docs');
  const planSources = fs.readdirSync(docs, { withFileTypes: true }).flatMap((entry) => {
    const lean = path.join(docs, entry.name, 'lean');
    return entry.isDirectory() && /^\d{4}-/.test(entry.name) && fs.existsSync(lean)
      ? leanFiles(lean)
      : [];
  });
  const sources = [
    ...planSources,
    ...leanFiles(path.join(pluginRoot, 'lean')),
    path.join(pluginRoot, 'lean-toolchain'),
    path.join(pluginRoot, 'lakefile.toml'),
    path.join(pluginRoot, 'lake-manifest.json'),
    path.join(pluginRoot, 'scripts', 'check-lean.ts'),
  ].sort();
  const hash = createHash('sha256');
  for (const source of sources) {
    hash.update(path.relative(pluginRoot, source));
    hash.update('\0');
    hash.update(fs.readFileSync(source));
    hash.update('\0');
  }
  const fixturePath = path.join(docs, '0002-formal-verification', 'lean', 'fixtures.json');
  const parsed: unknown = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  assert.ok(isRecord(parsed));
  assert.equal(parsed.plan, '0002-formal-verification');
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(
    parsed.toolchain,
    fs.readFileSync(path.join(pluginRoot, 'lean-toolchain'), 'utf8').trim(),
  );
  assert.equal(parsed.modelSourceSha256, hash.digest('hex'));
  assert.ok(Array.isArray(parsed.cases));
  const cases = new Map<string, { contract: string; input: unknown; expected: unknown }>();
  for (const item of parsed.cases) {
    assert.ok(isRecord(item));
    if (typeof item.id !== 'string' || typeof item.contract !== 'string')
      throw new Error('Invalid Lean case identity.');
    assert.ok('input' in item && 'expected' in item);
    assert.equal(cases.has(item.id), false);
    cases.set(item.id, {
      contract: item.contract,
      input: item.input,
      expected: item.expected,
    });
  }
  return cases;
}

function modelCase(
  cases: Map<string, { contract: string; input: unknown; expected: unknown }>,
  id: string,
  contract: string,
): { input: Record<string, unknown>; expected: Record<string, unknown> } {
  const item = cases.get(id);
  assert.ok(item, `Missing Lean case ${id}.`);
  assert.equal(item.contract, contract);
  assert.ok(isRecord(item.input));
  assert.ok(isRecord(item.expected));
  return { input: item.input, expected: item.expected };
}

function modelExpectation(
  cases: Map<string, { contract: string; input: unknown; expected: unknown }>,
  id: string,
  contract: string,
): Record<string, unknown> {
  const item = cases.get(id);
  assert.ok(item, `Missing Lean case ${id}.`);
  assert.equal(item.contract, contract);
  assert.ok(isRecord(item.expected));
  return item.expected;
}

function codeUnits(value: unknown): string {
  if (
    !Array.isArray(value) ||
    !value.every(
      (part: unknown): part is number =>
        typeof part === 'number' && Number.isInteger(part) && part >= 0 && part <= 65535,
    )
  )
    throw new Error('Expected UTF-16 code units from Lean fixture.');
  return String.fromCharCode(...value);
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitFor(check: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + 15000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${description}.`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function currentTurn(request: ModelRequest): ModelRequest['messages'] {
  const lastUser = [...request.messages].reverse().find((message) => message.role === 'user');
  assert.ok(lastUser);
  return request.messages.slice(request.messages.indexOf(lastUser));
}

function offeredTool(request: ModelRequest, name: string): string {
  const result = request.tools?.find(
    (tool) => tool.function.name === name || tool.function.name.endsWith(`_${name}`),
  )?.function.name;
  assert.ok(result, `Model was not offered ${name}.`);
  return result;
}

function callTool(stream: ModelStream, name: string, args: Record<string, string>): void {
  stream.chunk({
    role: 'assistant',
    tool_calls: [
      {
        index: 0,
        id: `call-${name}`,
        type: 'function',
        function: { name, arguments: JSON.stringify(args) },
      },
    ],
  });
  stream.finish('tool_calls');
}

function reply(stream: ModelStream, text: string): void {
  stream.chunk({ role: 'assistant', content: text });
  stream.finish();
}

function settingRow(settings: Locator, name: string): Locator {
  return settings.locator('.setting-item').filter({ hasText: name }).first();
}

async function openAgentSettings(page: Page): Promise<Locator> {
  await page.locator('.clickable-icon:has(svg.lucide-settings)').click();
  const settingsPage = page
    .context()
    .pages()
    .find((item) => item !== page);
  assert.ok(settingsPage);
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
  assert.ok(settingsPage);
  await settingsPage.close();
}

async function waitForMcpTool(page: Page, name: string, present = true): Promise<void> {
  await page.waitForFunction(
    ({ expected, desired }) => {
      const plugins: unknown = Reflect.get(window.app, 'plugins');
      if (typeof plugins !== 'object' || plugins === null) return false;
      const instances: unknown = Reflect.get(plugins, 'plugins');
      if (typeof instances !== 'object' || instances === null) return false;
      const plugin: unknown = Reflect.get(instances, 'agent');
      if (typeof plugin !== 'object' || plugin === null) return false;
      const mcp: unknown = Reflect.get(plugin, 'mcp');
      if (typeof mcp !== 'object' || mcp === null) return false;
      const toolsMethod: unknown = Reflect.get(mcp, 'tools');
      if (typeof toolsMethod !== 'function') return false;
      const tools: unknown = Reflect.apply(toolsMethod, mcp, []);
      return (
        Array.isArray(tools) &&
        tools.some(
          (tool: unknown) =>
            typeof tool === 'object' && tool !== null && Reflect.get(tool, 'name') === expected,
        ) === desired
      );
    },
    { expected: name, desired: present },
  );
}

async function startMcpFixture(
  name: string,
  calls: string[],
  listBarrier?: { entered: () => void; release: Promise<void> },
  collidingTools = false,
): Promise<{ server: http.Server; port: number; requests: { count: number } }> {
  let posts = 0;
  const requests = { count: 0 };
  const server = http.createServer((request, response) => {
    requests.count += 1;
    if (request.url !== '/mcp') {
      response.writeHead(404).end();
      return;
    }
    const mcp = new McpServer({ name, version: '1.0.0' });
    mcp.registerTool('ping', { description: `${name} ping` }, () => {
      calls.push(name);
      return Promise.resolve({ content: [{ type: 'text' as const, text: `${name} pong` }] });
    });
    mcp.registerTool('unique', { description: `${name} unique` }, () => {
      calls.push(`${name}-unique`);
      return Promise.resolve({ content: [{ type: 'text' as const, text: `${name} unique` }] });
    });
    if (collidingTools) {
      mcp.registerTool('a-b', { description: `${name} first colliding tool` }, () => {
        calls.push(`${name}:a-b`);
        return Promise.resolve({
          content: [{ type: 'text' as const, text: `${name} first collision` }],
        });
      });
      mcp.registerTool('a_b', { description: `${name} second colliding tool` }, () => {
        calls.push(`${name}:a_b`);
        return Promise.resolve({
          content: [{ type: 'text' as const, text: `${name} second collision` }],
        });
      });
    }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const handle = async () => {
      await mcp.connect(transport);
      if (request.method === 'POST') {
        posts += 1;
        if (listBarrier && posts >= 2) {
          listBarrier.entered();
          await listBarrier.release;
        }
      }
      await transport.handleRequest(request, response);
    };
    handle().catch((error: unknown) => {
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
      if (!address || typeof address === 'string') reject(new Error('MCP fixture has no port.'));
      else resolve(address.port);
    });
  });
  return { server, port, requests };
}

async function closeMcpFixture(server: http.Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}

function localMcpCloseScript(): string {
  return [
    'printf "started\\n" >> "$1"',
    'trap \'printf "closed\\n" >> "$1"\' EXIT',
    "trap 'exit 0' TERM HUP INT",
    'while IFS= read -r line; do',
    '  id=${line##*id*:}',
    '  id=${id%%[^0-9]*}',
    '  case "$line" in',
    '    *initialize*)',
    `      printf '{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":"2025-11-25","capabilities":{"tools":{}},"serverInfo":{"name":"close-fixture","version":"1.0.0"}}}\\n' "$id"`,
    '      ;;',
    '    *tools/list*)',
    '      printf "connected\\n" >> "$1"',
    `      printf '{"jsonrpc":"2.0","id":%s,"result":{"tools":[{"name":"ping","description":"Local close fixture","inputSchema":{"type":"object","properties":{}}}]}}\\n' "$id"`,
    '      ;;',
    '    *tools/call*)',
    `      printf '{"jsonrpc":"2.0","id":%s,"result":{"content":[{"type":"text","text":"local pong"}]}}\\n' "$id"`,
    '      ;;',
    '  esac',
    'done',
    '',
  ].join('\n');
}

await test('formal verification contracts agree with packaged Obsidian behavior', async () => {
  const cases = checkedModelCases();
  const emptyEdit = modelCase(cases, 'edit-empty-snapshot', 'V1-V5');
  const missingEdit = modelCase(cases, 'edit-no-snapshot', 'V1-V5');
  const staleEdit = modelCase(cases, 'edit-stale-disk', 'V1-V5');
  const overlap = modelExpectation(cases, 'run-preparation-overlap', 'R1');
  const sameChat = modelExpectation(cases, 'run-stale-same-chat', 'R2');
  const collision = modelCase(cases, 'mcp-name-collision', 'M1-M3');
  const late = modelExpectation(cases, 'mcp-disabled-late-success', 'M4-M5');
  assert.deepEqual(emptyEdit.input.disk, []);
  assert.deepEqual(emptyEdit.input.snapshot, []);
  assert.equal(emptyEdit.expected.status, 'success');
  assert.equal(codeUnits(emptyEdit.expected.disk), 'C');
  assert.deepEqual(missingEdit.input.disk, []);
  assert.equal(missingEdit.input.snapshot, null);
  assert.match(String(missingEdit.expected.status), /missingSnapshot$/);
  assert.equal(codeUnits(staleEdit.input.snapshot), 'A');
  assert.equal(codeUnits(staleEdit.input.disk), 'B');
  assert.equal(staleEdit.expected.status, 'diskConflict');
  assert.equal(overlap.promptCount, 0);
  assert.equal(sameChat.ownerSerial, 2);
  assert.deepEqual(sameChat.partialText, []);
  assert.equal(collision.expected.receivingServer, 'a-b');
  assert.equal(collision.expected.firstAccepted, true);
  assert.equal(collision.expected.secondAccepted, false);
  assert.equal(codeUnits(collision.input.name), 'mcp_ab_ping');
  assert.equal(late.published, false);
  assert.equal(late.closeRequested, true);
  const scripts: Record<string, ToolAction[]> = {
    'edit-empty': [
      { tool: 'read_note', args: { path: 'Nest//Empty.md' }, result: /content|text/i },
      {
        tool: 'edit_note',
        args: { path: 'Nest/Empty.md', content: codeUnits(emptyEdit.input.replacement) },
        result: /Edited Nest\/Empty\.md/,
      },
      {
        tool: 'edit_note',
        args: { path: 'Nest//Empty.md', content: 'A\r\n😀é\n' },
        result: /Edited Nest\/Empty\.md/,
      },
      {
        tool: 'edit_note',
        args: { path: 'Nest/Empty.md', content: 'B\r\n😀é\n' },
        result: /Edited Nest\/Empty\.md/,
      },
      {
        tool: 'edit_note',
        args: { path: 'Nest//Empty.md', content: '' },
        result: /Edited Nest\/Empty\.md/,
      },
    ],
    'no-snapshot': [
      {
        tool: 'edit_note',
        args: { path: 'NoSnapshotEmpty.md', content: 'wrong' },
        result: /Read the note before editing/i,
      },
    ],
    'stale-disk': [
      { tool: 'read_note', args: { path: 'Conflict.md' }, result: /A/ },
      {
        tool: 'edit_note',
        args: { path: 'Conflict.md', content: codeUnits(staleEdit.input.replacement) },
        result: /Edit conflict.*changed since it was read/i,
      },
    ],
    'reread-success': [
      { tool: 'read_note', args: { path: 'Conflict.md' }, result: /B/ },
      {
        tool: 'edit_note',
        args: { path: 'Conflict.md', content: 'Accepted after reread' },
        result: /Edited Conflict\.md/,
      },
    ],
    'stale-editor': [
      { tool: 'read_note', args: { path: 'Editor.md' }, result: /Editor original/ },
      {
        tool: 'edit_note',
        args: { path: 'Editor.md', content: 'Agent replacement' },
        result: /Edit conflict.*active editor/i,
      },
    ],
    'line-ending-conflict': [
      { tool: 'read_note', args: { path: 'LineEndings.md' }, result: /line\\r\\n/ },
      {
        tool: 'edit_note',
        args: { path: 'LineEndings.md', content: 'replacement' },
        result: /Edit conflict.*changed since it was read/i,
      },
    ],
    'process-failure': [
      { tool: 'read_note', args: { path: 'Failure.md' }, result: /Failure original/ },
      {
        tool: 'edit_note',
        args: { path: 'Failure.md', content: 'Never committed' },
        result: /Injected process failure/,
      },
      {
        tool: 'edit_note',
        args: { path: 'Failure.md', content: 'Recovered edit' },
        result: /Edited Failure\.md/,
      },
    ],
    'valid-unicode': [
      { tool: 'read_note', args: { path: '目录/笔记.MD' }, result: /Unicode original/ },
    ],
    'reject-parent': [
      {
        tool: 'create_note',
        args: { path: '../Outside.md', content: 'wrong' },
        result: /Only Markdown notes inside the vault/i,
      },
    ],
    'reject-hidden': [
      {
        tool: 'read_note',
        args: { path: '.private/Secret.md' },
        result: /Only Markdown notes inside the vault/i,
      },
    ],
    'reject-absolute': [
      {
        tool: 'create_note',
        args: { path: '/tmp/Outside.md', content: 'wrong' },
        result: /Only Markdown notes inside the vault/i,
      },
    ],
    'reject-drive': [
      {
        tool: 'create_note',
        args: { path: 'C:/Outside.md', content: 'wrong' },
        result: /Only Markdown notes inside the vault/i,
      },
    ],
    'reject-backslash': [
      {
        tool: 'create_note',
        args: { path: 'Nest\\Outside.md', content: 'wrong' },
        result: /Only Markdown notes inside the vault/i,
      },
    ],
    'reject-extension': [
      {
        tool: 'create_note',
        args: { path: 'Outside.txt', content: 'wrong' },
        result: /Only Markdown notes inside the vault/i,
      },
    ],
  };
  const barriers = new Map<
    string,
    { entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> }
  >();
  const processRetry = { entered: deferred(), release: deferred() };
  let guardedVault = '';
  for (const label of ['stale-disk', 'stale-editor', 'line-ending-conflict', 'process-failure']) {
    barriers.set(label, { entered: deferred(), release: deferred() });
  }
  await withAgent(
    'guarded-edit-and-paths',
    async (agent) => {
      await agent.openSidebar();
      await agent.send('case:edit-empty');
      assert.equal(fs.readFileSync(path.join(agent.vault, 'Nest', 'Empty.md'), 'utf8'), '');
      assert.equal(fs.readFileSync(path.join(agent.vault, 'Other.md'), 'utf8'), 'Other original');
      await agent.send('case:no-snapshot');
      assert.equal(fs.readFileSync(path.join(agent.vault, 'NoSnapshotEmpty.md'), 'utf8'), '');
      assert.equal(fs.readFileSync(path.join(agent.vault, 'Nest', 'Empty.md'), 'utf8'), '');

      const disk = agent.send('case:stale-disk');
      await barriers.get('stale-disk')?.entered.promise;
      await agent.page.evaluate(async (replacement) => {
        const file = window.app.vault
          .getMarkdownFiles()
          .find((item) => item.path === 'Conflict.md');
        if (!file) throw new Error('Conflict.md is missing.');
        await window.app.vault.modify(file, replacement);
      }, codeUnits(staleEdit.input.disk));
      barriers.get('stale-disk')?.release.resolve();
      await disk;
      assert.equal(
        fs.readFileSync(path.join(agent.vault, 'Conflict.md'), 'utf8'),
        codeUnits(staleEdit.expected.disk),
      );
      await agent.send('case:reread-success');
      assert.equal(
        fs.readFileSync(path.join(agent.vault, 'Conflict.md'), 'utf8'),
        'Accepted after reread',
      );

      const endings = agent.send('case:line-ending-conflict');
      await barriers.get('line-ending-conflict')?.entered.promise;
      await agent.page.evaluate(async () => {
        const file = window.app.vault
          .getMarkdownFiles()
          .find((item) => item.path === 'LineEndings.md');
        if (!file) throw new Error('LineEndings.md is missing.');
        await window.app.vault.modify(file, 'line\n');
      });
      barriers.get('line-ending-conflict')?.release.resolve();
      await endings;
      assert.equal(fs.readFileSync(path.join(agent.vault, 'LineEndings.md'), 'utf8'), 'line\n');

      const editor = agent.send('case:stale-editor');
      await barriers.get('stale-editor')?.entered.promise;
      await agent.page.evaluate(async () => {
        const file = window.app.vault.getMarkdownFiles().find((item) => item.path === 'Editor.md');
        if (!file) throw new Error('Editor.md is missing.');
        await window.app.workspace.getLeaf(false).openFile(file);
        const active = window.app.workspace.activeEditor;
        if (!active?.editor) throw new Error('Editor did not open.');
        active.editor.setValue('Unsaved user buffer');
      });
      barriers.get('stale-editor')?.release.resolve();
      await editor;
      assert.equal(
        await agent.page.evaluate(() => window.app.workspace.activeEditor?.editor?.getValue()),
        'Unsaved user buffer',
      );

      const failure = agent.send('case:process-failure');
      await barriers.get('process-failure')?.entered.promise;
      await agent.page.evaluate(() => {
        const original = window.app.vault.process.bind(window.app.vault);
        Object.defineProperty(window.app.vault, 'process', {
          configurable: true,
          value: () => Promise.reject(new Error('Injected process failure')),
        });
        window.restoreAgentProcess = () => {
          Object.defineProperty(window.app.vault, 'process', {
            configurable: true,
            value: original,
          });
        };
      });
      barriers.get('process-failure')?.release.resolve();
      await processRetry.entered.promise;
      assert.equal(
        fs.readFileSync(path.join(agent.vault, 'Failure.md'), 'utf8'),
        'Failure original',
      );
      await agent.page.evaluate(() => window.restoreAgentProcess?.());
      processRetry.release.resolve();
      await failure;
      assert.equal(fs.readFileSync(path.join(agent.vault, 'Failure.md'), 'utf8'), 'Recovered edit');

      for (const label of [
        'valid-unicode',
        'reject-parent',
        'reject-hidden',
        'reject-absolute',
        'reject-drive',
        'reject-backslash',
        'reject-extension',
      ]) {
        await agent.send(`case:${label}`);
      }
      assert.equal(fs.existsSync(path.join(agent.paths.root, 'Outside.md')), false);
      assert.equal(fs.existsSync(path.join(agent.vault, 'Outside.txt')), false);
      assert.equal(
        fs.readFileSync(path.join(agent.vault, '目录', '笔记.MD'), 'utf8'),
        'Unicode original',
      );
    },
    {
      prepareVault: (paths) => {
        guardedVault = paths.vault;
        fs.mkdirSync(path.join(paths.vault, 'Nest'), { recursive: true });
        fs.mkdirSync(path.join(paths.vault, '目录'), { recursive: true });
        fs.writeFileSync(
          path.join(paths.vault, 'Nest', 'Empty.md'),
          codeUnits(emptyEdit.input.disk),
        );
        fs.writeFileSync(
          path.join(paths.vault, 'NoSnapshotEmpty.md'),
          codeUnits(missingEdit.input.disk),
        );
        fs.writeFileSync(path.join(paths.vault, 'Other.md'), 'Other original');
        fs.writeFileSync(
          path.join(paths.vault, 'Conflict.md'),
          codeUnits(staleEdit.input.snapshot),
        );
        fs.writeFileSync(path.join(paths.vault, 'LineEndings.md'), 'line\r\n');
        fs.writeFileSync(path.join(paths.vault, 'Editor.md'), 'Editor original');
        fs.writeFileSync(path.join(paths.vault, 'Failure.md'), 'Failure original');
        fs.writeFileSync(path.join(paths.vault, '目录', '笔记.MD'), 'Unicode original');
      },
      modelHandler: async (request, stream) => {
        const turn = currentTurn(request);
        const prompt = JSON.stringify(turn.find((message) => message.role === 'user'));
        const label = Object.keys(scripts).find((key) => prompt.includes(`case:${key}`));
        assert.ok(label, `Unexpected request: ${prompt}`);
        const actions = scripts[label];
        assert.ok(actions);
        const results = turn.filter((message) => message.role === 'tool');
        if (results.length > 0) {
          const action = actions[results.length - 1];
          assert.ok(action);
          assert.match(JSON.stringify(results.at(-1)), action.result, `${label} tool result`);
          if (label === 'edit-empty' && results.length === 4) {
            assert.equal(
              fs.readFileSync(path.join(guardedVault, 'Nest', 'Empty.md'), 'utf8'),
              'B\r\n😀é\n',
            );
          }
        }
        if (results.length === actions.length) {
          reply(stream, `${label} checked`);
          return;
        }
        if (results.length === 1 && barriers.has(label)) {
          barriers.get(label)?.entered.resolve();
          await barriers.get(label)?.release.promise;
        }
        if (label === 'process-failure' && results.length === 2) {
          processRetry.entered.resolve();
          await processRetry.release.promise;
        }
        const next = actions[results.length];
        assert.ok(next);
        callTool(stream, offeredTool(request, next.tool), next.args);
      },
    },
  );

  const mcpCalls: string[] = [];
  const firstMcp = await startMcpFixture('first', mcpCalls);
  const collisionMcp = await startMcpFixture('collision', mcpCalls);
  const independentMcp = await startMcpFixture('independent', mcpCalls);
  const sameMcp = await startMcpFixture('same', mcpCalls, undefined, true);
  try {
    await withAgent(
      'mcp-registration-and-routing',
      async (agent) => {
        await agent.openSidebar();
        await agent.send('MCP route fixture');
        assert.deepEqual(mcpCalls, ['first', 'independent-unique', 'same:a-b']);
        const offered = agent.requests[0]?.tools?.map((tool) => tool.function.name) ?? [];
        assert.equal(new Set(offered).size, offered.length);
        assert.equal(offered.filter((name) => name === 'mcp_ab_ping').length, 1);
        assert.equal(offered.filter((name) => name === 'mcp_same_a_b').length, 1);
        const settings = await openAgentSettings(agent.page);
        await settingRow(settings, 'Collision server')
          .locator('.setting-item-description')
          .getByText(/collision|duplicate/i)
          .waitFor();
        await settingRow(settings, 'Same server')
          .locator('.setting-item-description')
          .getByText(/collision/i)
          .waitFor();
        await closeAgentSettings(agent.page);
      },
      {
        data: {
          mcpServers: [
            {
              id: 'a-b',
              name: 'First server',
              type: 'http',
              enabled: true,
              command: '',
              args: [],
              url: `http://127.0.0.1:${String(firstMcp.port)}/mcp`,
              headerRefs: {},
            },
            {
              id: 'ab',
              name: 'Collision server',
              type: 'http',
              enabled: true,
              command: '',
              args: [],
              url: `http://127.0.0.1:${String(collisionMcp.port)}/mcp`,
              headerRefs: {},
            },
            {
              id: 'third',
              name: 'Independent server',
              type: 'http',
              enabled: true,
              command: '',
              args: [],
              url: `http://127.0.0.1:${String(independentMcp.port)}/mcp`,
              headerRefs: {},
            },
            {
              id: 'same',
              name: 'Same server',
              type: 'http',
              enabled: true,
              command: '',
              args: [],
              url: `http://127.0.0.1:${String(sameMcp.port)}/mcp`,
              headerRefs: {},
            },
          ],
        },
        modelHandler: (request, stream) => {
          const results = currentTurn(request).filter((message) => message.role === 'tool');
          if (results.length === 0) {
            const names = request.tools?.map((tool) => tool.function.name) ?? [];
            assert.equal(new Set(names).size, names.length);
            callTool(stream, offeredTool(request, 'mcp_ab_ping'), {});
          } else if (results.length === 1) {
            assert.match(JSON.stringify(results[0]), /first pong/);
            callTool(stream, offeredTool(request, 'mcp_third_unique'), {});
          } else if (results.length === 2) {
            assert.match(JSON.stringify(results[1]), /independent unique/);
            callTool(stream, offeredTool(request, 'mcp_same_a_b'), {});
          } else {
            assert.match(JSON.stringify(results[2]), /same first collision/);
            reply(stream, 'Routing checked.');
          }
        },
      },
    );
  } finally {
    await Promise.all([
      closeMcpFixture(firstMcp.server),
      closeMcpFixture(collisionMcp.server),
      closeMcpFixture(independentMcp.server),
      closeMcpFixture(sameMcp.server),
    ]);
  }

  const duplicateFirst = await startMcpFixture('duplicate-first', []);
  const duplicateSecond = await startMcpFixture('duplicate-second', []);
  try {
    for (const secondEnabled of [true, false]) {
      await withAgent(
        secondEnabled ? 'duplicate-enabled-mcp-ids' : 'duplicate-enabled-disabled-mcp-ids',
        async (agent) => {
          await agent.openSidebar();
          const settings = await openAgentSettings(agent.page);
          await settingRow(settings, 'Duplicate first')
            .locator('.setting-item-description')
            .getByText(/Duplicate MCP server ID/i)
            .waitFor();
          await closeAgentSettings(agent.page);
          await agent.send('Duplicate IDs cannot connect');
          assert.equal(
            agent.requests[0]?.tools?.some((tool) => tool.function.name.startsWith('mcp_dup_')),
            false,
          );
          assert.equal(duplicateFirst.requests.count, 0);
          assert.equal(duplicateSecond.requests.count, 0);
        },
        {
          data: {
            mcpServers: [
              {
                id: 'dup',
                name: 'Duplicate first',
                type: 'http',
                enabled: true,
                command: '',
                args: [],
                url: `http://127.0.0.1:${String(duplicateFirst.port)}/mcp`,
                headerRefs: {},
              },
              {
                id: 'dup',
                name: 'Duplicate second',
                type: 'http',
                enabled: secondEnabled,
                command: '',
                args: [],
                url: `http://127.0.0.1:${String(duplicateSecond.port)}/mcp`,
                headerRefs: {},
              },
            ],
          },
          modelHandler: (_request, stream) => {
            reply(stream, 'Duplicate IDs rejected.');
          },
        },
      );
    }
  } finally {
    await Promise.all([
      closeMcpFixture(duplicateFirst.server),
      closeMcpFixture(duplicateSecond.server),
    ]);
  }

  const firstRun = deferred();
  await withAgent(
    'run-ownership-and-cancellation',
    async (agent) => {
      await agent.openSidebar();
      const settings = await openAgentSettings(agent.page);
      await settingRow(settings, 'Skills/Writer/SKILL.md').waitFor();
      assert.equal(await settingRow(settings, 'Skills-extra/Outside/SKILL.md').count(), 0);
      assert.equal(await settingRow(settings, 'Skills/.Hidden/SKILL.md').count(), 0);
      await closeAgentSettings(agent.page);
      await agent.page.evaluate(() => {
        const original = window.app.vault.cachedRead.bind(window.app.vault);
        let held = false;
        Object.defineProperty(window.app.vault, 'cachedRead', {
          configurable: true,
          value: async (file: Parameters<typeof original>[0]) => {
            if (file.path === 'Skills/Writer/SKILL.md' && !held) {
              held = true;
              window.agentSkillReadEntered = true;
              await new Promise<void>((resolve) => {
                window.releaseAgentSkillRead = resolve;
              });
            }
            return original(file);
          },
        });
      });
      const composer = agent.view().locator('textarea[aria-label="Message"]');
      await composer.fill('Preparation owner');
      await agent.view().getByRole('button', { name: 'Send' }).click();
      await agent.page.waitForFunction(() => window.agentSkillReadEntered === true);
      await composer.fill('Overlapping send');
      await composer.press('Enter');
      assert.equal(agent.requests.length, 0);
      await agent.view().getByRole('button', { name: 'Stop' }).click();
      await waitFor(() => {
        const chats = agent.savedData().chats;
        return Array.isArray(chats) && chats.some((chat) => chat.interrupted && !chat.pending);
      }, 'interrupted preparation to persist');
      await composer.fill('After preparation stop');
      await agent.view().getByRole('button', { name: 'Send' }).click();
      await agent.view().getByText('Fresh run completed.').waitFor();
      assert.equal(agent.requests.length, 1);
      await agent.page.evaluate(() => window.releaseAgentSkillRead?.());
      await firstRun.promise;
      assert.equal(agent.requests.length, 1);

      await composer.fill('Streaming partial');
      await agent.view().getByRole('button', { name: 'Send' }).click();
      await agent.view().getByText('Retained partial text').waitFor();
      await agent.view().getByRole('button', { name: 'Stop' }).click();
      await waitFor(
        () => JSON.stringify(agent.savedData()).includes('Retained partial text'),
        'partial reply to be saved',
      );
      await agent.page.reload();
      await agent.openSidebar();
      await agent.view().getByText('Retained partial text').waitFor();
      await agent.send('After reload');
      assert.equal(
        agent.requests.filter((request) =>
          JSON.stringify(currentTurn(request)).includes('After reload'),
        ).length,
        1,
      );

      const switchedChatId = agent.savedData().activeChatId;
      assert.ok(switchedChatId);
      await composer.fill('Switch held stream');
      await agent.view().getByRole('button', { name: 'Send' }).click();
      await agent.view().getByText('Partial before switch').waitFor();
      await agent.newChat();
      await waitFor(() => {
        const chat = agent.savedData().chats?.find((item) => item.id === switchedChatId);
        return (
          chat?.interrupted === true &&
          !chat.pending &&
          JSON.stringify(chat.messages).includes('Partial before switch')
        );
      }, 'switched chat to retain its partial reply');
      await agent.send('New chat reply');
      await agent.send('Provider failure');
      await agent.view().locator('.agent-error').waitFor();
      await agent.send('Recovery after provider failure');
      await agent.view().getByText('Recovered provider reply.').waitFor();
      await agent.view().getByRole('button', { name: 'Saved chats' }).click();
      await agent.view().locator(`button[data-chat-id="${switchedChatId}"]`).click();
      await agent.view().getByText('Partial before switch').waitFor();
    },
    {
      data: { skillFolders: ['Skills'], enabledSkills: ['Skills/Writer/SKILL.md'] },
      prepareVault: (paths) => {
        fs.mkdirSync(path.join(paths.vault, 'Skills', 'Writer'), { recursive: true });
        fs.mkdirSync(path.join(paths.vault, 'Skills', '.Hidden'), { recursive: true });
        fs.mkdirSync(path.join(paths.vault, 'Skills-extra', 'Outside'), { recursive: true });
        fs.writeFileSync(
          path.join(paths.vault, 'Skills', 'Writer', 'SKILL.md'),
          'WRITER_SKILL_TOKEN_0002',
        );
        fs.writeFileSync(
          path.join(paths.vault, 'Skills', '.Hidden', 'SKILL.md'),
          'HIDDEN_SKILL_TOKEN_0002',
        );
        fs.writeFileSync(
          path.join(paths.vault, 'Skills-extra', 'Outside', 'SKILL.md'),
          'SIBLING_SKILL_TOKEN_0002',
        );
      },
      modelHandler: async (request, stream) => {
        const turn = JSON.stringify(currentTurn(request));
        assert.doesNotMatch(turn, /Overlapping send|Preparation owner/);
        assert.match(JSON.stringify(request.messages), /WRITER_SKILL_TOKEN_0002/);
        assert.doesNotMatch(
          JSON.stringify(request.messages),
          /HIDDEN_SKILL_TOKEN_0002|SIBLING_SKILL_TOKEN_0002/,
        );
        if (turn.includes('After preparation stop')) {
          reply(stream, 'Fresh run completed.');
          firstRun.resolve();
        } else if (turn.includes('Streaming partial')) {
          stream.chunk({ role: 'assistant', content: 'Retained partial text' });
          await new Promise<void>((resolve) => stream.response.once('close', resolve));
        } else if (turn.includes('Switch held stream')) {
          stream.chunk({ role: 'assistant', content: 'Partial before switch' });
          await new Promise<void>((resolve) => stream.response.once('close', resolve));
        } else if (turn.includes('Provider failure')) {
          throw new Error('Injected provider failure');
        } else if (turn.includes('Recovery after provider failure')) {
          reply(stream, 'Recovered provider reply.');
        } else {
          reply(stream, 'Reloaded run completed.');
        }
      },
    },
  );

  const oldRunStarted = deferred();
  const releaseOldOutput = deferred();
  const oldResponseClosed = deferred();
  const newRunStarted = deferred();
  const releaseNewOutput = deferred();
  let oldToolCompleted = false;
  await withAgent(
    'same-chat-delayed-old-callback',
    async (agent) => {
      await agent.openSidebar();
      const oldPending = agent.send('Old same-chat run');
      await oldRunStarted.promise;
      await agent.view().getByText('OLD_PARTIAL').waitFor();
      await agent.page.evaluate(() => {
        const plugins: unknown = Reflect.get(window.app, 'plugins');
        if (typeof plugins !== 'object' || plugins === null)
          throw new Error('Plugin manager unavailable.');
        const instances: unknown = Reflect.get(plugins, 'plugins');
        if (typeof instances !== 'object' || instances === null)
          throw new Error('Plugin instances unavailable.');
        const plugin: unknown = Reflect.get(instances, 'agent');
        if (typeof plugin !== 'object' || plugin === null)
          throw new Error('Agent plugin unavailable.');
        const owner: unknown = Reflect.get(plugin, 'owner');
        if (typeof owner !== 'object' || owner === null) throw new Error('Run owner unavailable.');
        const running: unknown = Reflect.get(owner, 'agent');
        if (typeof running !== 'object' || running === null)
          throw new Error('Running agent unavailable.');
        Reflect.set(running, 'abort', () => undefined);
      });
      await agent.view().getByRole('button', { name: 'Stop' }).click();
      await agent.view().getByRole('button', { name: 'Send' }).waitFor();
      const newPending = agent.send('New same-chat run');
      await newRunStarted.promise;
      await agent.view().getByText('NEW_ACTIVE_TEXT').waitFor();
      const activeChatId = agent.savedData().activeChatId;
      assert.ok(activeChatId);
      const activityBefore =
        agent.savedData().chats?.find((chat) => chat.id === activeChatId)?.activity ?? [];
      const visibleActivityBefore = await agent
        .view()
        .locator('.agent-tool-activity')
        .allTextContents();
      assert.deepEqual(activityBefore, []);
      releaseOldOutput.resolve();
      await oldResponseClosed.promise;
      assert.equal(oldToolCompleted, true);
      await agent.view().getByText('NEW_ACTIVE_TEXT').waitFor();
      assert.equal(await agent.view().locator('.agent-error').count(), 0);
      assert.deepEqual(
        await agent.view().locator('.agent-tool-activity').allTextContents(),
        visibleActivityBefore,
      );
      assert.doesNotMatch(JSON.stringify(agent.savedData()), /STALE_OLD_TEXT/);
      releaseNewOutput.resolve();
      await Promise.all([oldPending, newPending]);
      assert.equal(agent.requests.length, 3);
      assert.deepEqual(
        agent.savedData().chats?.find((chat) => chat.id === activeChatId)?.activity ?? [],
        activityBefore,
      );
      assert.match(JSON.stringify(agent.savedData()), /NEW_ACTIVE_TEXT/);
      assert.doesNotMatch(JSON.stringify(agent.savedData()), /STALE_OLD_TEXT/);
    },
    {
      modelHandler: async (request, stream) => {
        const turn = JSON.stringify(currentTurn(request));
        if (turn.includes('Old same-chat run')) {
          const results = currentTurn(request).filter((message) => message.role === 'tool');
          if (results.length === 0) {
            stream.chunk({ role: 'assistant', content: 'OLD_PARTIAL' });
            oldRunStarted.resolve();
            await releaseOldOutput.promise;
            callTool(stream, offeredTool(request, 'read_note'), { path: 'Welcome.md' });
          } else {
            assert.match(JSON.stringify(results[0]), /Fixture note content/);
            oldToolCompleted = true;
            const closed = new Promise<void>((resolve) => stream.response.once('close', resolve));
            reply(stream, 'STALE_OLD_TEXT');
            await closed;
            oldResponseClosed.resolve();
          }
        } else {
          assert.match(turn, /New same-chat run/);
          stream.chunk({ role: 'assistant', content: 'NEW_ACTIVE_TEXT' });
          newRunStarted.resolve();
          await releaseNewOutput.promise;
          stream.finish();
        }
      },
    },
  );

  await withAgent(
    'empty-skill-folder',
    async (agent) => {
      await agent.openSidebar();
      await agent.send('Empty folder must not select root skill');
      assert.doesNotMatch(JSON.stringify(agent.requests[0]?.messages), /ROOT_SKILL_TOKEN_0002/);
    },
    {
      data: { skillFolders: [''], enabledSkills: ['SKILL.md'] },
      prepareVault: (paths) => {
        fs.writeFileSync(path.join(paths.vault, 'SKILL.md'), 'ROOT_SKILL_TOKEN_0002');
      },
      modelHandler: (request, stream) => {
        assert.doesNotMatch(JSON.stringify(request.messages), /ROOT_SKILL_TOKEN_0002/);
        reply(stream, 'Root skill excluded.');
      },
    },
  );

  await withAgent(
    'skill-read-failure-and-recovery',
    async (agent) => {
      await agent.openSidebar();
      await agent.page.evaluate(() => {
        const original = window.app.vault.cachedRead.bind(window.app.vault);
        let rejected = false;
        Object.defineProperty(window.app.vault, 'cachedRead', {
          configurable: true,
          value: (file: Parameters<typeof original>[0]) => {
            if (file.path === 'Skills/Writer/SKILL.md' && !rejected) {
              rejected = true;
              return Promise.reject(new Error('Injected skill read failure'));
            }
            return original(file);
          },
        });
      });
      await agent.send('Failed skill preparation');
      assert.equal(agent.requests.length, 0);
      await agent
        .view()
        .locator('.agent-error')
        .getByText(/Injected skill read failure/)
        .waitFor();
      await agent.send('Recovered skill preparation');
      assert.equal(agent.requests.length, 1);
      assert.match(JSON.stringify(agent.requests[0]?.messages), /WRITER_SKILL_TOKEN_0002/);
    },
    {
      data: { skillFolders: ['Skills'], enabledSkills: ['Skills/Writer/SKILL.md'] },
      prepareVault: (paths) => {
        fs.mkdirSync(path.join(paths.vault, 'Skills', 'Writer'), { recursive: true });
        fs.writeFileSync(
          path.join(paths.vault, 'Skills', 'Writer', 'SKILL.md'),
          'WRITER_SKILL_TOKEN_0002',
        );
      },
      modelHandler: (request, stream) => {
        assert.match(JSON.stringify(currentTurn(request)), /Recovered skill preparation/);
        reply(stream, 'Skill read recovered.');
      },
    },
  );

  await withAgent(
    'save-failure-and-recovery',
    async (agent) => {
      await agent.openSidebar();
      await agent.page.evaluate(() => {
        const plugins: unknown = Reflect.get(window.app, 'plugins');
        if (typeof plugins !== 'object' || plugins === null)
          throw new Error('Plugin manager unavailable.');
        const instances: unknown = Reflect.get(plugins, 'plugins');
        if (typeof instances !== 'object' || instances === null)
          throw new Error('Plugin instances unavailable.');
        const plugin: unknown = Reflect.get(instances, 'agent');
        if (typeof plugin !== 'object' || plugin === null)
          throw new Error('Agent plugin unavailable.');
        const original: unknown = Reflect.get(plugin, 'saveData');
        if (typeof original !== 'function') throw new Error('Plugin saveData unavailable.');
        let rejected = false;
        Reflect.set(plugin, 'saveData', (data: unknown) => {
          if (!rejected) {
            rejected = true;
            return Promise.reject(new Error('Injected storage failure'));
          }
          const result: unknown = Reflect.apply(original, plugin, [data]);
          return Promise.resolve(result);
        });
      });
      await agent.send('Save failure before prompt');
      assert.equal(agent.requests.length, 0);
      await agent
        .view()
        .locator('.agent-error')
        .getByText(/Injected storage failure/)
        .waitFor();
      await agent.send('Save recovered');
      assert.equal(agent.requests.length, 1);
      await waitFor(
        () => JSON.stringify(agent.savedData()).includes('Save recovered'),
        'recovered save',
      );
      await agent.page.reload();
      await agent.openSidebar();
      await agent.view().getByText('Saved after recovery.').waitFor();
    },
    {
      modelHandler: (request, stream) => {
        assert.match(JSON.stringify(currentTurn(request)), /Save recovered/);
        reply(stream, 'Saved after recovery.');
      },
    },
  );

  await withAgent(
    'save-barrier-and-chat-switch',
    async (agent) => {
      await agent.openSidebar();
      await agent.page.evaluate(() => {
        const plugins: unknown = Reflect.get(window.app, 'plugins');
        if (typeof plugins !== 'object' || plugins === null)
          throw new Error('Plugin manager unavailable.');
        const instances: unknown = Reflect.get(plugins, 'plugins');
        if (typeof instances !== 'object' || instances === null)
          throw new Error('Plugin instances unavailable.');
        const plugin: unknown = Reflect.get(instances, 'agent');
        if (typeof plugin !== 'object' || plugin === null)
          throw new Error('Agent plugin unavailable.');
        const original: unknown = Reflect.get(plugin, 'saveData');
        if (typeof original !== 'function') throw new Error('Plugin saveData unavailable.');
        let held = false;
        Reflect.set(plugin, 'saveData', async (data: unknown) => {
          if (!held) {
            held = true;
            window.agentSaveEntered = true;
            await new Promise<void>((resolve) => {
              window.releaseAgentSave = resolve;
            });
          }
          const result: unknown = Reflect.apply(original, plugin, [data]);
          await Promise.resolve(result);
        });
      });
      const composer = agent.view().locator('textarea[aria-label="Message"]');
      await composer.fill('Save barrier owner');
      await agent.view().getByRole('button', { name: 'Send' }).click();
      await agent.page.waitForFunction(() => window.agentSaveEntered === true);
      await composer.fill('Overlapping save send');
      await composer.press('Enter');
      assert.equal(agent.requests.length, 0);
      await agent.view().getByRole('button', { name: 'New chat' }).click();
      await agent.page.evaluate(() => window.releaseAgentSave?.());
      await agent.view().getByRole('button', { name: 'Send' }).waitFor();
      assert.equal(agent.requests.length, 0);
      await agent.send('After save switch');
      assert.equal(agent.requests.length, 1);
      assert.match(JSON.stringify(currentTurn(agent.requests[0])), /After save switch/);
      assert.equal(
        agent.savedData().chats?.some((chat) => chat.interrupted && !chat.pending),
        true,
      );
    },
    {
      modelHandler: (request, stream) => {
        assert.match(JSON.stringify(currentTurn(request)), /After save switch/);
        reply(stream, 'Switched run completed.');
      },
    },
  );

  const persisted = {
    activeChatId: 'missing',
    chats: [
      {
        id: 'same',
        title: 'Pending chat',
        messages: [
          { role: 'user', content: 'Preserved message', timestamp: 1 },
          { role: 'user', content: [{ type: 'text' }], timestamp: 1 },
        ],
        pending: true,
        interrupted: false,
        activity: ['Earlier activity'],
        updatedAt: 1,
      },
      {
        id: 'same',
        title: 'Duplicate chat',
        messages: [{ role: 'assistant' }],
        pending: false,
        interrupted: false,
        activity: [],
        updatedAt: 2,
      },
      {
        id: '',
        title: 'Empty ID',
        messages: [],
        pending: false,
        interrupted: false,
        activity: [],
        updatedAt: 3,
      },
    ],
  };
  await withAgent(
    'restoration-and-decoder',
    async (agent) => {
      const loaded = agent.savedData();
      assert.ok(Array.isArray(loaded.chats));
      assert.equal(loaded.chats[0]?.id, 'same');
      assert.equal(loaded.chats[0]?.pending, false);
      assert.equal(loaded.chats[0]?.interrupted, true);
      assert.deepEqual(loaded.chats[0]?.messages, [
        { role: 'user', content: 'Preserved message', timestamp: 1 },
      ]);
      assert.equal(loaded.chats[1]?.messages.length, 0);
      const ids = loaded.chats.map((chat) => chat.id);
      assert.equal(
        ids.every((id) => id.length > 0),
        true,
      );
      assert.equal(new Set(ids).size, ids.length);
      assert.ok(loaded.activeChatId && ids.includes(loaded.activeChatId));
      assert.notEqual(loaded.activeChatId, 'missing');
      assert.equal(agent.requests.length, 0);
      await agent.page.reload();
      await agent.openSidebar();
      const restored = agent.savedData();
      assert.deepEqual(
        restored.chats?.map((chat) => chat.id),
        ids,
      );
      assert.equal(restored.activeChatId, loaded.activeChatId);
      await agent.view().getByRole('button', { name: 'Saved chats' }).click();
      await agent.view().locator('button[data-chat-id="same"]').click();
      await agent.send('Restored chat can send');
      assert.equal(agent.requests.length, 1);
      assert.match(JSON.stringify(agent.requests[0]?.messages), /Preserved message/);
      assert.doesNotMatch(JSON.stringify(agent.requests[0]?.messages), /"role":"assistant"}/);
      assert.doesNotMatch(JSON.stringify(agent.requests[0]?.messages), /"type":"text"}/);
    },
    {
      data: persisted,
      modelHandler: (_request, stream) => {
        reply(stream, 'Restored run completed.');
      },
    },
  );
  const lateCalls: string[] = [];
  const lateEntered = deferred();
  const lateRelease = deferred();
  const lateMcp = await startMcpFixture('late', lateCalls, {
    entered: lateEntered.resolve,
    release: lateRelease.promise,
  });
  try {
    await withAgent(
      'mcp-disabled-late-completion',
      async (agent) => {
        await lateEntered.promise;
        const settings = await openAgentSettings(agent.page);
        await settingRow(settings, 'Late server').locator('.checkbox-container').click();
        await waitFor(() => {
          const servers = agent.savedData().mcpServers;
          return (
            Array.isArray(servers) &&
            servers.some(
              (item: unknown) =>
                typeof item === 'object' &&
                item !== null &&
                'enabled' in item &&
                item.enabled === false,
            )
          );
        }, 'disabled MCP configuration');
        lateRelease.resolve();
        await closeAgentSettings(agent.page);
        await agent.openSidebar();
        await agent.send('No stale MCP tools');
        assert.equal(
          agent.requests[0]?.tools?.some((tool) => tool.function.name.startsWith('mcp_late_')),
          false,
        );
        assert.deepEqual(lateCalls, []);
        const settingsAgain = await openAgentSettings(agent.page);
        assert.doesNotMatch(
          (await settingRow(settingsAgain, 'Late server').textContent()) ?? '',
          /connect failed|discovery failed/i,
        );
        await settingRow(settingsAgain, 'Late server').locator('.checkbox-container').click();
        await closeAgentSettings(agent.page);
        await waitForMcpTool(agent.page, 'mcp_late_ping');
        await agent.send('MCP current after re-enable');
        assert.ok(
          agent.requests.at(-1)?.tools?.some((tool) => tool.function.name === 'mcp_late_ping'),
        );
        assert.deepEqual(lateCalls, ['late']);
      },
      {
        data: {
          mcpServers: [
            {
              id: 'late',
              name: 'Late server',
              type: 'http',
              enabled: true,
              command: '',
              args: [],
              url: `http://127.0.0.1:${String(lateMcp.port)}/mcp`,
              headerRefs: {},
            },
          ],
        },
        modelHandler: (request, stream) => {
          const turn = JSON.stringify(currentTurn(request));
          if (!turn.includes('MCP current after re-enable')) {
            reply(stream, 'No stale tools offered.');
            return;
          }
          const results = currentTurn(request).filter((message) => message.role === 'tool');
          if (results.length === 0) callTool(stream, offeredTool(request, 'mcp_late_ping'), {});
          else {
            assert.match(JSON.stringify(results[0]), /late pong/);
            reply(stream, 'Current MCP tool worked.');
          }
        },
      },
    );
  } finally {
    lateRelease.resolve();
    await closeMcpFixture(lateMcp.server);
  }

  const replacementOldCalls: string[] = [];
  const replacementNewCalls: string[] = [];
  const replacementEntered = deferred();
  const replacementRelease = deferred();
  const oldConfiguration = await startMcpFixture('old-configuration', replacementOldCalls, {
    entered: replacementEntered.resolve,
    release: replacementRelease.promise,
  });
  const newConfiguration = await startMcpFixture('new-configuration', replacementNewCalls);
  try {
    await withAgent(
      'mcp-same-id-replacement-during-discovery',
      async (agent) => {
        await replacementEntered.promise;
        const newUrl = `http://127.0.0.1:${String(newConfiguration.port)}/mcp`;
        await agent.page.evaluate(async (url) => {
          const plugins: unknown = Reflect.get(window.app, 'plugins');
          if (typeof plugins !== 'object' || plugins === null)
            throw new Error('Plugin manager unavailable.');
          const instances: unknown = Reflect.get(plugins, 'plugins');
          if (typeof instances !== 'object' || instances === null)
            throw new Error('Plugin instances unavailable.');
          const plugin: unknown = Reflect.get(instances, 'agent');
          if (typeof plugin !== 'object' || plugin === null)
            throw new Error('Agent plugin unavailable.');
          const data: unknown = Reflect.get(plugin, 'data');
          if (typeof data !== 'object' || data === null)
            throw new Error('Plugin data unavailable.');
          const servers: unknown = Reflect.get(data, 'mcpServers');
          if (!Array.isArray(servers) || servers.length !== 1)
            throw new Error('MCP configuration unavailable.');
          const server: unknown = servers[0];
          if (typeof server !== 'object' || server === null)
            throw new Error('MCP server unavailable.');
          Reflect.set(server, 'url', url);
          const persist: unknown = Reflect.get(plugin, 'persist');
          const refresh: unknown = Reflect.get(plugin, 'refreshMcp');
          if (typeof persist !== 'function' || typeof refresh !== 'function')
            throw new Error('Plugin configuration operations unavailable.');
          await Promise.resolve(Reflect.apply(persist, plugin, []));
          await Promise.resolve(Reflect.apply(refresh, plugin, []));
        }, newUrl);
        replacementRelease.resolve();
        await waitFor(
          () => JSON.stringify(agent.savedData().mcpServers).includes(newUrl),
          'replacement configuration save',
        );
        await agent.openSidebar();
        await agent.send('Replacement routes current');
        assert.deepEqual(replacementOldCalls, []);
        assert.deepEqual(replacementNewCalls, ['new-configuration']);
        assert.equal(
          agent.requests[0]?.tools?.filter((tool) => tool.function.name === 'mcp_replace_ping')
            .length,
          1,
        );
      },
      {
        data: {
          mcpServers: [
            {
              id: 'replace',
              name: 'Replacement server',
              type: 'http',
              enabled: true,
              command: '',
              args: [],
              url: `http://127.0.0.1:${String(oldConfiguration.port)}/mcp`,
              headerRefs: {},
            },
          ],
        },
        modelHandler: (request, stream) => {
          const results = currentTurn(request).filter((message) => message.role === 'tool');
          if (results.length === 0) callTool(stream, offeredTool(request, 'mcp_replace_ping'), {});
          else {
            assert.match(JSON.stringify(results[0]), /new-configuration pong/);
            reply(stream, 'Replacement routed to the current server.');
          }
        },
      },
    );
  } finally {
    replacementRelease.resolve();
    await Promise.all([
      closeMcpFixture(oldConfiguration.server),
      closeMcpFixture(newConfiguration.server),
    ]);
  }

  const retainedCalls: string[] = [];
  const retainedOffered = deferred();
  const retainedRelease = deferred();
  let retainedRejected = false;
  const retainedMcp = await startMcpFixture('retained', retainedCalls);
  try {
    await withAgent(
      'mcp-retained-tool-after-disable',
      async (agent) => {
        await agent.openSidebar();
        await waitForMcpTool(agent.page, 'mcp_retained_ping');
        const pending = agent.send('Retained dispatch after disable');
        await retainedOffered.promise;
        const settings = await openAgentSettings(agent.page);
        await settingRow(settings, 'Retained server').locator('.checkbox-container').click();
        await waitForMcpTool(agent.page, 'mcp_retained_ping', false);
        await closeAgentSettings(agent.page);
        retainedRelease.resolve();
        await pending;
        assert.equal(retainedRejected, true);
        assert.deepEqual(retainedCalls, []);
      },
      {
        data: {
          mcpServers: [
            {
              id: 'retained',
              name: 'Retained server',
              type: 'http',
              enabled: true,
              command: '',
              args: [],
              url: `http://127.0.0.1:${String(retainedMcp.port)}/mcp`,
              headerRefs: {},
            },
          ],
        },
        modelHandler: async (request, stream) => {
          const results = currentTurn(request).filter((message) => message.role === 'tool');
          if (results.length === 0) {
            const name = offeredTool(request, 'mcp_retained_ping');
            retainedOffered.resolve();
            await retainedRelease.promise;
            callTool(stream, name, {});
          } else {
            assert.match(JSON.stringify(results[0]), /no longer active/i);
            retainedRejected = true;
            reply(stream, 'Retained tool rejected.');
          }
        },
      },
    );
  } finally {
    retainedRelease.resolve();
    await closeMcpFixture(retainedMcp.server);
  }

  const unloadStreamClosed = deferred();
  await withAgent(
    'repeated-sync-and-unload-partial',
    async (agent) => {
      const marker = path.join(agent.paths.root, 'local-close.log');
      await agent.openSidebar();
      await waitForMcpTool(agent.page, 'mcp_local_ping');
      await waitFor(
        () => fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').includes('connected'),
        'local MCP discovery',
      );
      await agent.page.evaluate(async () => {
        const plugins: unknown = Reflect.get(window.app, 'plugins');
        if (typeof plugins !== 'object' || plugins === null)
          throw new Error('Plugin manager unavailable.');
        const instances: unknown = Reflect.get(plugins, 'plugins');
        if (typeof instances !== 'object' || instances === null)
          throw new Error('Plugin instances unavailable.');
        const plugin: unknown = Reflect.get(instances, 'agent');
        if (typeof plugin !== 'object' || plugin === null)
          throw new Error('Agent plugin unavailable.');
        const refresh: unknown = Reflect.get(plugin, 'refreshMcp');
        if (typeof refresh !== 'function') throw new Error('MCP refresh unavailable.');
        await Promise.resolve(Reflect.apply(refresh, plugin, []));
        await Promise.resolve(Reflect.apply(refresh, plugin, []));
      });
      assert.equal(fs.readFileSync(marker, 'utf8').split('started').length - 1, 1);
      const pending = agent.send('Unload while streaming partial');
      await agent.view().getByText('UNLOAD_PARTIAL_TEXT').waitFor();
      await waitFor(
        () => JSON.stringify(agent.savedData()).includes('UNLOAD_PARTIAL_TEXT'),
        'visible partial reply to persist',
      );
      await agent.page.evaluate(async () => {
        const plugins: unknown = Reflect.get(window.app, 'plugins');
        if (typeof plugins !== 'object' || plugins === null)
          throw new Error('Plugin manager unavailable.');
        const disable: unknown = Reflect.get(plugins, 'disablePlugin');
        if (typeof disable !== 'function') throw new Error('Plugin disable unavailable.');
        await Promise.resolve(Reflect.apply(disable, plugins, ['agent']));
      });
      await unloadStreamClosed.promise;
      await waitFor(
        () => fs.readFileSync(marker, 'utf8').includes('closed'),
        'local MCP process close',
      );
      await agent.page.evaluate(async () => {
        const plugins: unknown = Reflect.get(window.app, 'plugins');
        if (typeof plugins !== 'object' || plugins === null)
          throw new Error('Plugin manager unavailable.');
        const enable: unknown = Reflect.get(plugins, 'enablePlugin');
        if (typeof enable !== 'function') throw new Error('Plugin enable unavailable.');
        await Promise.resolve(Reflect.apply(enable, plugins, ['agent']));
      });
      await agent.page.locator('[aria-label="Open Obsidian Agent"]').waitFor();
      await agent.openSidebar();
      await agent.view().getByText('UNLOAD_PARTIAL_TEXT').waitFor();
      assert.equal(agent.requests.length, 1);
      await pending;
    },
    {
      data: {
        mcpServers: [
          {
            id: 'local',
            name: 'Local close fixture',
            type: 'stdio',
            enabled: true,
            command: 'bash',
            args: ['./local-close.sh', './local-close.log'],
            url: '',
            headerRefs: {},
          },
        ],
      },
      prepareVault: (paths) => {
        fs.writeFileSync(path.join(paths.root, 'local-close.sh'), localMcpCloseScript());
      },
      modelHandler: async (_request, stream) => {
        stream.chunk({ role: 'assistant', content: 'UNLOAD_PARTIAL_TEXT' });
        await new Promise<void>((resolve) => stream.response.once('close', resolve));
        unloadStreamClosed.resolve();
      },
    },
  );
});
