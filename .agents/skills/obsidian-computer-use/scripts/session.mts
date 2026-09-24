import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';

interface PixelPage {
  reload(options: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<unknown>;
  screenshot(options: {
    path: string;
    scale: 'css';
    fullPage: false;
    timeout: number;
  }): Promise<Buffer>;
  mouse: {
    click(
      x: number,
      y: number,
      options: { button: 'left' | 'right' | 'middle'; clickCount: number },
    ): Promise<void>;
    move(x: number, y: number, options?: { steps: number }): Promise<void>;
    down(): Promise<void>;
    up(): Promise<void>;
    wheel(x: number, y: number): Promise<void>;
  };
  keyboard: {
    insertText(text: string): Promise<void>;
    press(key: string): Promise<void>;
  };
}

type Fixture = { page: PixelPage; vault: string; pluginDir: string };
type Harness = {
  withAgent: (label: string, run: (fixture: Fixture) => Promise<void>) => Promise<void>;
};

const harnessPath = process.argv[2];
if (!harnessPath || !fs.statSync(harnessPath, { throwIfNoEntry: false })?.isFile()) {
  throw new Error('Usage: node session.mts /absolute/path/to/plugins/agent/tests/e2e/support.ts');
}
const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-computer-use-'));
const transcript = path.join(artifacts, 'transcript.jsonl');
function emit(event: Record<string, unknown>): void {
  const line = JSON.stringify({ time: new Date().toISOString(), ...event });
  fs.appendFileSync(transcript, `${line}\n`);
  process.stdout.write(`${line}\n`);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('Expected a JSON object.');
  return value;
}
function isHarness(value: unknown): value is Harness {
  return isRecord(value) && typeof value.withAgent === 'function';
}
function number(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`${name} must be a finite number.`);
  return value;
}
function string(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`${name} must be a string.`);
  return value;
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

emit({ event: 'starting', artifacts, harness: path.resolve(harnessPath) });
try {
  const imported: unknown = await import(pathToFileURL(path.resolve(harnessPath)).href);
  if (!isHarness(imported)) throw new Error('Harness must export withAgent.');
  await imported.withAgent('computer-use', async ({ page, vault, pluginDir }) => {
    let sequence = 0;
    let width = 0;
    let height = 0;
    async function screenshot(event = 'screenshot'): Promise<void> {
      const imagePath = path.join(artifacts, `${String(++sequence).padStart(4, '0')}.png`);
      const buffer = await page.screenshot({
        path: imagePath,
        scale: 'css',
        fullPage: false,
        timeout: 10000,
      });
      width = buffer.readUInt32BE(16);
      height = buffer.readUInt32BE(20);
      emit({
        event,
        screenshot: imagePath,
        width,
        height,
        ...(event === 'ready' ? { vault, pluginDir } : {}),
      });
    }
    function point(command: Record<string, unknown>, xKey = 'x', yKey = 'y'): [number, number] {
      const x = number(command[xKey], xKey);
      const y = number(command[yKey], yKey);
      if (x < 0 || y < 0 || x >= width || y >= height)
        throw new Error('Coordinates are outside the latest screenshot.');
      return [x, y];
    }
    const input = readline.createInterface({
      input: process.stdin,
      terminal: false,
    });
    let stopReason = 'Input closed without an explicit verdict.';
    const interrupt = () => {
      stopReason = 'Session interrupted.';
      input.close();
    };
    const timer = setTimeout(
      () => {
        stopReason = 'Session exceeded its 20 minute limit.';
        input.close();
      },
      20 * 60 * 1000,
    );
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', interrupt);
    try {
      await screenshot('ready');
      for await (const line of input) {
        let command: Record<string, unknown>;
        try {
          const parsed: unknown = JSON.parse(line);
          command = record(parsed);
          emit({ event: 'input', command });
          if (command.action === 'finish') {
            if (typeof command.passed !== 'boolean')
              throw new Error('finish requires passed: true or false.');
            if (command.reason !== undefined) string(command.reason, 'reason');
          } else {
            switch (command.action) {
              case 'screenshot':
                break;
              case 'click': {
                const [x, y] = point(command);
                const button = command.button ?? 'left';
                if (button !== 'left' && button !== 'right' && button !== 'middle')
                  throw new Error('Invalid mouse button.');
                const clickCount = command.count ?? 1;
                if (clickCount !== 1 && clickCount !== 2)
                  throw new Error('Click count must be 1 or 2.');
                await page.mouse.click(x, y, { button, clickCount });
                break;
              }
              case 'move':
                await page.mouse.move(...point(command));
                break;
              case 'type':
                await page.keyboard.insertText(string(command.text, 'text'));
                break;
              case 'press':
                await page.keyboard.press(string(command.key, 'key'));
                break;
              case 'reload':
                await page.reload({
                  waitUntil: 'domcontentloaded',
                  timeout: 30000,
                });
                emit({ event: 'reloaded' });
                break;
              case 'scroll': {
                const [x, y] = point(command);
                const deltaX = number(command.deltaX ?? 0, 'deltaX');
                const deltaY = number(command.deltaY, 'deltaY');
                await page.mouse.move(x, y);
                await page.mouse.wheel(deltaX, deltaY);
                break;
              }
              case 'drag': {
                const start = point(command);
                const end = point(command, 'toX', 'toY');
                await page.mouse.move(...start);
                await page.mouse.down();
                try {
                  await page.mouse.move(...end, { steps: 12 });
                } finally {
                  await page.mouse.up();
                }
                break;
              }
              case 'wait': {
                const ms = number(command.ms, 'ms');
                if (ms < 0 || ms > 5000)
                  throw new Error('Wait must be between 0 and 5000 milliseconds.');
                await new Promise((resolve) => setTimeout(resolve, ms));
                break;
              }
              default:
                throw new Error('Unknown action.');
            }
          }
        } catch (error) {
          emit({ event: 'command-error', message: message(error) });
          await screenshot();
          continue;
        }
        if (command.action === 'finish') {
          emit({
            event: 'verdict',
            passed: command.passed,
            reason: command.reason,
          });
          if (command.passed === true) return;
          throw new Error(
            typeof command.reason === 'string'
              ? command.reason
              : 'Visual verification failed or was blocked.',
          );
        }
        await screenshot();
      }
      throw new Error(stopReason);
    } finally {
      clearTimeout(timer);
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', interrupt);
      input.close();
    }
  });
  emit({ event: 'closed', passed: true, artifacts });
} catch (error) {
  emit({ event: 'closed', passed: false, message: message(error), artifacts });
  process.exitCode = 1;
}
