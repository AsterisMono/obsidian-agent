import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Locator, type Page } from 'playwright-core';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repositoryRoot = pluginRoot;
const displayRootPrefix = 'obsidian-e2e-display-';
const defaultDisplaySize = '1280x800';

type HeadlessDisplay = {
  root: string;
  runtimeDir: string;
  displayName: string;
  socketPath: string;
  process: ChildProcess;
};

let displayPromise: Promise<HeadlessDisplay> | undefined;

export type ModelRequest = {
  model: string;
  stream: boolean;
  authorization?: string;
  messages: Array<{ role: string; content?: unknown }>;
  tools?: Array<{ type: string; function: { name: string } }>;
};

export type SavedData = {
  activeChatId?: string;
  chats?: Array<{
    id: string;
    pending: boolean;
    interrupted?: boolean;
    messages: unknown[];
    activity?: string[];
  }>;
  [key: string]: unknown;
};

export type TestPaths = {
  root: string;
  vault: string;
  home: string;
  config: string;
  data: string;
  cache: string;
  state: string;
  temp: string;
  runtime: string;
  userData: string;
  pluginDir: string;
};

export type ModelStream = {
  response: http.ServerResponse;
  chunk: (delta: Record<string, unknown>, finishReason?: string | null) => void;
  finish: (finishReason?: string) => void;
};

export type AgentFixtureOptions = {
  data?: Record<string, unknown>;
  prepareVault?: (paths: TestPaths) => void | Promise<void>;
  modelHandler?: (request: ModelRequest, stream: ModelStream) => void | Promise<void>;
};

export type AgentFixture = {
  page: Page;
  paths: TestPaths;
  vault: string;
  pluginDir: string;
  modelPort: number;
  requests: ModelRequest[];
  view: () => Locator;
  openSidebar: () => Promise<void>;
  newChat: () => Promise<void>;
  send: (message: string) => Promise<void>;
  savedData: () => SavedData;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isModelRequest(value: unknown): value is ModelRequest {
  if (!isRecord(value)) return false;
  if (typeof value.model !== 'string' || typeof value.stream !== 'boolean') return false;
  if (!Array.isArray(value.messages)) return false;
  return value.messages.every((message) => isRecord(message) && typeof message.role === 'string');
}

function parseModelRequest(body: string): ModelRequest {
  const parsed: unknown = JSON.parse(body);
  if (!isModelRequest(parsed)) {
    throw new Error('Fixture server received a malformed chat completion request.');
  }
  return parsed;
}

function parseSavedData(text: string): SavedData {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error('Plugin data.json does not hold an object.');
  return parsed;
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

function createPaths(): TestPaths {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-agent-e2e-'));
  const vault = path.join(root, 'vault');
  const config = path.join(root, 'config');
  return {
    root,
    vault,
    config,
    home: path.join(root, 'home'),
    data: path.join(root, 'data'),
    cache: path.join(root, 'cache'),
    state: path.join(root, 'state'),
    temp: path.join(root, 'tmp'),
    runtime: path.join(root, 'runtime'),
    userData: path.join(config, 'obsidian'),
    pluginDir: path.join(vault, '.obsidian', 'plugins', 'agent'),
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Fixture server did not bind to a TCP port.');
  return address.port;
}

async function unusedPort(): Promise<number> {
  const server = http.createServer();
  const port = await listen(server);
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  return port;
}

function writeVault(paths: TestPaths, modelPort: number, data?: Record<string, unknown>): void {
  for (const directory of [
    paths.pluginDir,
    paths.userData,
    paths.home,
    paths.data,
    paths.cache,
    paths.state,
    paths.temp,
  ]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  fs.mkdirSync(paths.runtime, { recursive: true, mode: 0o700 });
  for (const name of ['manifest.json', 'main.js', 'styles.css']) {
    const source = path.join(pluginRoot, name);
    if (name === 'styles.css' && !fs.existsSync(source)) continue;
    fs.copyFileSync(source, path.join(paths.pluginDir, name));
  }
  fs.writeFileSync(path.join(paths.vault, 'Welcome.md'), '# Welcome\n\nFixture note content.\n');
  fs.writeFileSync(path.join(paths.vault, '.obsidian', 'community-plugins.json'), '["agent"]\n');
  fs.writeFileSync(
    path.join(paths.pluginDir, 'data.json'),
    JSON.stringify({
      model: 'custom-fixture::fixture-model',
      customEndpoints: [
        {
          id: 'fixture',
          name: 'Fixture',
          url: `http://127.0.0.1:${String(modelPort)}/v1`,
          models: ['fixture-model', 'fixture-alternate'],
        },
      ],
      ...data,
    }),
  );
  fs.writeFileSync(
    path.join(paths.userData, 'obsidian.json'),
    JSON.stringify({
      updateDisabled: true,
      vaults: { agenttest12345678: { path: paths.vault, ts: Date.now(), open: true } },
    }),
  );
}

async function handleModelRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  requests: ModelRequest[],
  events: string[],
  handler?: AgentFixtureOptions['modelHandler'],
): Promise<void> {
  try {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    for await (const chunk of req) body += String(chunk);
    const request = parseModelRequest(body);
    request.authorization = req.headers.authorization;
    requests.push(request);
    events.push(`request ${request.model} stream=${String(request.stream)}`);
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.on('close', () => {
      events.push('response closed');
    });
    const stream: ModelStream = {
      response: res,
      chunk: (delta, finishReason = null) => {
        if (res.destroyed || res.writableEnded) return;
        res.write(
          `data: ${JSON.stringify({
            id: 'chatcmpl-fixture',
            object: 'chat.completion.chunk',
            created: 1,
            model: request.model,
            choices: [{ index: 0, delta, finish_reason: finishReason }],
          })}\n\n`,
        );
      },
      finish: (finishReason = 'stop') => {
        if (res.destroyed || res.writableEnded) return;
        stream.chunk({}, finishReason);
        res.end('data: [DONE]\n\n');
      },
    };
    if (handler) await handler(request, stream);
    else {
      stream.chunk({ role: 'assistant', content: 'Hello ' });
      await wait(650);
      stream.chunk({ content: 'from the fixture.' });
      stream.finish();
    }
  } catch (error) {
    events.push(`fixture error: ${error instanceof Error ? error.message : String(error)}`);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
}

function modelServer(
  requests: ModelRequest[],
  events: string[],
  handler?: AgentFixtureOptions['modelHandler'],
): http.Server {
  return http.createServer((req, res) => {
    handleModelRequest(req, res, requests, events, handler).catch((error: unknown) => {
      events.push(`fixture error: ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
}

function resolveCompositor(): string {
  const override = process.env.OBSIDIAN_E2E_COMPOSITOR;
  const candidates = override
    ? [path.resolve(override)]
    : (process.env.PATH || '')
        .split(path.delimiter)
        .filter((directory) => directory.length > 0)
        .map((directory) => path.join(directory, 'sway'));
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found)
    throw new Error(
      'Headless compositor not found. Set OBSIDIAN_E2E_COMPOSITOR or run inside devenv.',
    );
  return fs.realpathSync(found);
}

function displaySize(): { width: number; height: number } {
  const value = process.env.OBSIDIAN_E2E_DISPLAY_SIZE || defaultDisplaySize;
  const match = /^(\d{3,5})x(\d{3,5})$/.exec(value);
  if (!match) throw new Error(`Invalid OBSIDIAN_E2E_DISPLAY_SIZE: ${value}`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

function resolveFontDirs(): string[] {
  return (process.env.OBSIDIAN_E2E_FONTS || '')
    .split(path.delimiter)
    .filter((entry) => entry.length > 0)
    .map((entry) => path.resolve(entry))
    .filter((entry) => fs.existsSync(entry));
}

function compositorConfig(): string {
  const { width, height } = displaySize();
  return [
    `output HEADLESS-1 resolution ${String(width)}x${String(height)}`,
    'default_border none',
    'default_floating_border none',
    'for_window [app_id="(?i)obsidian"] floating enable',
    `for_window [app_id="(?i)obsidian"] resize set ${String(width)} ${String(height)}`,
    'for_window [app_id="(?i)obsidian"] move position 0 0',
    '',
  ].join('\n');
}

function tailFile(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8').slice(-2000);
  } catch {
    return 'no compositor log';
  }
}

async function startHeadlessDisplay(): Promise<HeadlessDisplay> {
  const compositor = resolveCompositor();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), displayRootPrefix));
  const runtimeDir = path.join(root, 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  const configPath = path.join(root, 'sway.conf');
  fs.writeFileSync(configPath, compositorConfig());
  const logPath = path.join(root, 'compositor.log');
  const log = fs.openSync(logPath, 'w');
  let spawnError: Error | undefined;
  const child = spawn(compositor, ['-c', configPath], {
    detached: true,
    stdio: ['ignore', 'ignore', log],
    env: {
      HOME: root,
      XDG_RUNTIME_DIR: runtimeDir,
      XDG_CONFIG_HOME: path.join(root, 'config'),
      XDG_DATA_HOME: path.join(root, 'data'),
      XDG_CACHE_HOME: path.join(root, 'cache'),
      SWAYSOCK: path.join(runtimeDir, 'sway-ipc.sock'),
      WLR_BACKENDS: 'headless',
      WLR_RENDERER: 'pixman',
      WLR_LIBINPUT_NO_DEVICES: '1',
      PATH: process.env.PATH ?? '',
    },
  });
  child.on('error', (error) => {
    spawnError = error;
  });
  child.unref();
  fs.closeSync(log);
  const stop = () => {
    const running = child.exitCode === null && child.signalCode === null;
    if (child.pid) signalProcessGroup(child.pid, 'SIGKILL');
    if (running) fs.rmSync(root, { recursive: true, force: true });
  };
  process.once('exit', stop);
  process.once('SIGINT', () => {
    stop();
    process.exit(130);
  });
  process.once('SIGTERM', () => {
    stop();
    process.exit(143);
  });
  for (let i = 0; i < 200; i++) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`Headless compositor exited before opening its socket: ${tailFile(logPath)}`);
    const displayName = fs.readdirSync(runtimeDir).find((entry) => /^wayland-\d+$/.test(entry));
    if (displayName)
      return {
        root,
        runtimeDir,
        displayName,
        socketPath: path.join(runtimeDir, displayName),
        process: child,
      };
    await wait(100);
  }
  throw new Error(`Headless compositor did not open a Wayland socket: ${tailFile(logPath)}`);
}

function headlessDisplay(): Promise<HeadlessDisplay> {
  displayPromise ??= startHeadlessDisplay();
  return displayPromise;
}

function writeFontConfig(paths: TestPaths, fontconfig: string, fontDirs: string[]): string {
  const directory = path.join(paths.root, 'fontconfig');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'fonts.conf');
  fs.writeFileSync(
    file,
    [
      '<?xml version="1.0"?>',
      '<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">',
      '<fontconfig>',
      `  <include ignore_missing="yes">${fontconfig}/etc/fonts/fonts.conf</include>`,
      `  <include ignore_missing="yes">${fontconfig}/etc/fonts/conf.d</include>`,
      ...fontDirs.map((entry) => `  <dir>${entry}</dir>`),
      '</fontconfig>',
      '',
    ].join('\n'),
  );
  return file;
}

function resolveObsidian(): string {
  const executable = process.env.OBSIDIAN_EXECUTABLE || 'obsidian';
  const candidates = executable.includes('/')
    ? [path.resolve(executable)]
    : (process.env.PATH || '')
        .split(path.delimiter)
        .map((directory) => path.join(directory, executable));
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error(`Obsidian executable not found: ${executable}`);
  return fs.realpathSync(found);
}

function sandboxArgs(paths: TestPaths, debugPort: number, display: HeadlessDisplay): string[] {
  const binary = resolveObsidian();
  const storeRoot = binary.match(/^\/nix\/store\/[^/]+/)?.[0];
  if (!storeRoot) throw new Error('The E2E sandbox requires a Nix-store Obsidian executable.');
  const closure = execFileSync('nix-store', ['-qR', storeRoot], { encoding: 'utf8' })
    .trim()
    .split('\n');
  const bash = closure.find((item) => fs.existsSync(path.join(item, 'bin/bash')));
  const fontconfig = closure.find((item) => fs.existsSync(path.join(item, 'etc/fonts/fonts.conf')));
  if (!bash || !fontconfig) throw new Error('Obsidian Nix closure is missing Bash or fontconfig.');
  const fontDirs = resolveFontDirs();
  const fontsConf = writeFontConfig(paths, fontconfig, fontDirs);
  const sandboxSocket = path.join(paths.runtime, display.displayName);
  const runtimePath = closure
    .filter((item) => fs.existsSync(path.join(item, 'bin')))
    .map((item) => path.join(item, 'bin'))
    .join(path.delimiter);
  const mounts = [
    '--die-with-parent',
    '--unshare-pid',
    '--unshare-ipc',
    '--tmpfs',
    '/',
    '--dir',
    '/tmp',
    '--bind',
    paths.root,
    paths.root,
    '--dir',
    '/nix',
    '--dir',
    '/nix/store',
    ...closure.flatMap((item) => ['--ro-bind', item, item]),
    '--ro-bind',
    display.socketPath,
    sandboxSocket,
    ...fontDirs.flatMap((directory) => ['--ro-bind', directory, directory]),
    '--dev',
    '/dev',
    '--proc',
    '/proc',
    '--clearenv',
    '--setenv',
    'HOME',
    paths.home,
    '--setenv',
    'XDG_CONFIG_HOME',
    paths.config,
    '--setenv',
    'XDG_DATA_HOME',
    paths.data,
    '--setenv',
    'XDG_CACHE_HOME',
    paths.cache,
    '--setenv',
    'XDG_STATE_HOME',
    paths.state,
    '--setenv',
    'XDG_RUNTIME_DIR',
    paths.runtime,
    '--setenv',
    'WAYLAND_DISPLAY',
    display.displayName,
    '--setenv',
    'TMPDIR',
    paths.temp,
    '--setenv',
    'PATH',
    runtimePath,
    '--setenv',
    'FONTCONFIG_FILE',
    fontsConf,
    '--setenv',
    'FONTCONFIG_PATH',
    path.join(fontconfig, 'etc/fonts'),
    '--setenv',
    'LANG',
    'en_US.UTF-8',
    '--setenv',
    'LANGUAGE',
    'en_US:en',
    '--setenv',
    'LC_ALL',
    'C.UTF-8',
    '--setenv',
    'TZ',
    'UTC',
    '--chdir',
    paths.root,
  ];
  const visibilityCheck = spawnSync(
    'bwrap',
    [
      ...mounts,
      '--',
      path.join(bash, 'bin/bash'),
      '-c',
      [
        'test ! -e "$1"',
        'test ! -e /etc/passwd',
        'test ! -e /home',
        'test -e "$2"',
        'test -d "$3"',
        'test -S "$4"',
        'test -f "$5"',
        'for directory in "${@:6}"; do test -d "$directory" || exit 1; done',
      ].join(' && '),
      'sandbox-check',
      path.join(repositoryRoot, 'AGENTS.md'),
      binary,
      paths.vault,
      sandboxSocket,
      fontsConf,
      ...fontDirs,
    ],
    { encoding: 'utf8' },
  );
  if (visibilityCheck.status !== 0) {
    throw new Error(
      `Obsidian sandbox exposes host files or hides required mounts: ${visibilityCheck.stderr || visibilityCheck.error?.message || ''}`,
    );
  }
  return [
    ...mounts,
    '--',
    binary,
    `--user-data-dir=${paths.userData}`,
    `--remote-debugging-port=${String(debugPort)}`,
    '--lang=en-US',
    '--ozone-platform=wayland',
    '--no-sandbox',
    '--disable-gpu',
  ];
}

async function waitForCdp(
  port: number,
  child: ChildProcess,
  spawnError: () => Error | undefined,
): Promise<void> {
  for (let i = 0; i < 150; i++) {
    const error = spawnError();
    if (error) throw error;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Obsidian exited before CDP started (code ${String(child.exitCode)}, signal ${String(child.signalCode)}).`,
      );
    }
    const response = await fetch(`http://127.0.0.1:${String(port)}/json/version`).catch(
      () => undefined,
    );
    if (response?.ok) return;
    await wait(200);
  }
  throw new Error('Obsidian did not open its debugging endpoint.');
}

function fixture(
  paths: TestPaths,
  page: Page,
  modelPort: number,
  requests: ModelRequest[],
): AgentFixture {
  const view = () => page.locator('.agent-view');
  const openSidebar = async () => {
    if ((await view().count()) === 0)
      await page.locator('[aria-label="Open Obsidian Agent"]').click();
    await view().waitFor();
  };
  return {
    page,
    paths,
    vault: paths.vault,
    pluginDir: paths.pluginDir,
    modelPort,
    requests,
    view,
    openSidebar,
    newChat: async () => {
      await openSidebar();
      await view().getByRole('button', { name: 'New chat', exact: true }).click();
      await view().getByRole('button', { name: 'Send' }).waitFor();
    },
    send: async (message: string) => {
      await view().locator('textarea[aria-label="Message"]').fill(message);
      await view().getByRole('button', { name: 'Send' }).click();
      await view().getByRole('button', { name: 'Send' }).waitFor({ timeout: 15000 });
    },
    savedData: () =>
      parseSavedData(fs.readFileSync(path.join(paths.pluginDir, 'data.json'), 'utf8')),
  };
}

export async function withAgent(
  label: string,
  run: (agent: AgentFixture) => Promise<void>,
  options: AgentFixtureOptions = {},
): Promise<void> {
  const paths = createPaths();
  const requests: ModelRequest[] = [];
  const events: string[] = [];
  const pageErrors: string[] = [];
  let stderr = '';
  let server: http.Server | undefined;
  let child: ChildProcess | undefined;
  let browser: Browser | undefined;
  let page: Page | undefined;
  let passed = false;
  try {
    server = modelServer(requests, events, options.modelHandler);
    const modelPort = await listen(server);
    writeVault(paths, modelPort, options.data);
    await options.prepareVault?.(paths);
    const debugPort = await unusedPort();
    const display = await headlessDisplay();
    child = spawn('bwrap', sandboxArgs(paths, debugPort, display), {
      detached: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let spawnError: Error | undefined;
    child.on('error', (error) => {
      spawnError = error;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    await waitForCdp(debugPort, child, () => spawnError);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(debugPort)}`);
    const context = browser.contexts()[0];
    for (let i = 0; i < 100 && context.pages().length === 0; i++) await wait(200);
    page = context.pages().find((item) => item.url().startsWith('app://')) || context.pages()[0];
    assert.ok(page, 'Obsidian window did not open');
    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });
    page.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(message.text());
    });
    await page.locator('.workspace').waitFor({ timeout: 60000 });
    await page.evaluate(() => {
      localStorage.setItem('language', 'en');
    });
    await page.reload();
    await page.locator('.workspace').waitFor({ timeout: 60000 });
    assert.match(
      await page.evaluate(() => navigator.language),
      /^en\b/i,
      'Obsidian did not start in English',
    );
    assert.equal(await page.evaluate(() => localStorage.getItem('language')), 'en');
    const trust = page.getByRole('button', { name: 'Trust author and enable plugins' });
    await trust.waitFor({ timeout: 15000 });
    await trust.click();
    await page.getByText('Create new note').first().waitFor({ timeout: 10000 });
    await page.locator('[aria-label="Open Obsidian Agent"]').waitFor({ timeout: 30000 });
    await run(fixture(paths, page, modelPort, requests));
    passed = true;
  } catch (error) {
    if (page)
      await page
        .screenshot({ path: path.join(paths.root, `${label}-failure.png`) })
        .catch(() => undefined);
    console.error(`E2E artifacts: ${paths.root}`);
    console.error(`Obsidian stderr: ${stderr.slice(-2000)}`);
    console.error(`Page errors: ${pageErrors.slice(-10).join(' | ')}`);
    console.error(`Fixture requests: ${String(requests.length)}`);
    console.error(`Fixture events: ${events.slice(-15).join(' | ')}`);
    throw error;
  } finally {
    await browser?.close().catch(() => undefined);
    if (child?.pid) {
      signalProcessGroup(child.pid, 'SIGTERM');
      await wait(500);
      signalProcessGroup(child.pid, 'SIGKILL');
    }
    server?.closeAllConnections();
    const listeningServer = server;
    if (listeningServer?.listening) {
      await new Promise<void>((resolve) => {
        listeningServer.close(() => {
          resolve();
        });
      });
    }
    if (passed) fs.rmSync(paths.root, { recursive: true, force: true });
  }
}
