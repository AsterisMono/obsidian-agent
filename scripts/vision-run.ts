import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Agent, type AgentTool } from '@earendil-works/pi-agent-core';
import { Type, type ImageContent, type JsonObject } from '@earendil-works/pi-ai';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux';
import { withAgent, type AgentFixture } from '../tests/e2e/support.ts';

const providerId = process.env.VISION_PROVIDER ?? 'opencode-go';
const modelId = process.env.VISION_MODEL ?? 'deepseek-v4.1-flash';
const requestedThinking = process.env.VISION_THINKING ?? 'xhigh';
const maxSteps = Number(process.env.VISION_MAX_STEPS ?? '60');
const deadlineMinutes = Number(process.env.VISION_DEADLINE_MINUTES ?? '15');
const task =
  process.env.VISION_TASK ??
  [
    'Open the Obsidian Agent sidebar and check that its chat panel renders and works.',
    'Send one message and confirm a reply is visible, then confirm the plugin stored the conversation.',
    'Report defects you actually observe, and finish with an explicit verdict.',
  ].join(' ');

const thinkingLevels = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
const thinkingLevel = thinkingLevels.find((level) => level === requestedThinking);
if (!thinkingLevel) throw new Error(`VISION_THINKING must be one of ${thinkingLevels.join(', ')}.`);

const systemPrompt = [
  'You drive a real Obsidian instance inside a disposable vault so an operator can judge plugin behaviour visually.',
  'The application runs in a private headless compositor; ignore the host desktop entirely.',
  'Use only the provided tools. Never guess at the UI: take a screenshot, read it, then act.',
  'Coordinates are CSS pixels measured from the most recent screenshot, and every command answers with a fresh one.',
  'Before each action state the expected visible result, then verify it on a new screenshot rather than assuming the command worked.',
  'Prefer real clicks and key presses. Typing inserts text without key events, so use press for shortcuts and submission.',
  'Reread the screenshot after focus changes, scrolling, layout shifts, or window resizes before reusing coordinates.',
  'You may inspect files in the vault to corroborate what you saw, but file state never replaces a visual check.',
  'When you are done, call finish with passed true only if the behaviour you were asked to check actually held.',
].join('\n');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toJsonObject(value: Record<string, unknown>): JsonObject {
  const result: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') result[key] = item;
    else if (typeof item === 'number') result[key] = item;
    else if (typeof item === 'boolean') result[key] = item;
    else if (item === null) result[key] = null;
  }
  return result;
}

function fauxSteps(text: string): unknown[] {
  const value: unknown = JSON.parse(text);
  if (!Array.isArray(value)) throw new Error('VISION_FAUX_RESPONSES must be a JSON array.');
  return value.map((item: unknown) => item);
}

function numberParam(params: Record<string, unknown>, name: string): number {
  const value = params[name];
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`${name} must be a finite number.`);
  return value;
}

function stringParam(params: Record<string, unknown>, name: string): string {
  const value = params[name];
  if (typeof value !== 'string') throw new Error(`${name} must be a string.`);
  return value;
}

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }], details: undefined };
}

type Verdict = { passed: boolean; reason: string };

type Counters = { steps: number; screenshots: number };

function createTools(
  fixture: AgentFixture,
  evidence: string,
  verdict: { value?: Verdict },
  counts: Counters,
): AgentTool[] {
  let width = 0;
  let height = 0;
  const page = fixture.page;
  const screenshot = async (label: string) => {
    const buffer = await page.screenshot({ scale: 'css', fullPage: false });
    counts.screenshots += 1;
    const index = counts.screenshots;
    const file = path.join(evidence, `${String(index).padStart(3, '0')}-${label}.png`);
    fs.writeFileSync(file, buffer);
    const size = await page.evaluate(() => [window.innerWidth, window.innerHeight]);
    width = size[0];
    height = size[1];
    const image: ImageContent = {
      type: 'image',
      data: buffer.toString('base64'),
      mimeType: 'image/png',
    };
    return {
      content: [
        {
          type: 'text' as const,
          text: `Screenshot ${file} (${String(width)}x${String(height)}).`,
        },
        image,
      ],
      details: undefined,
    };
  };
  const guard = () => {
    if (counts.steps > maxSteps)
      throw new Error(`Step budget of ${String(maxSteps)} is exhausted. Call finish now.`);
  };
  const point = (params: Record<string, unknown>, xKey = 'x', yKey = 'y') => {
    const x = numberParam(params, xKey);
    const y = numberParam(params, yKey);
    if (x < 0 || y < 0 || x >= width || y >= height)
      throw new Error('Coordinates are outside the latest screenshot.');
    return { x, y };
  };
  return [
    {
      name: 'screenshot',
      label: 'Screenshot',
      description: 'Capture the current Obsidian window and return it as an image.',
      parameters: Type.Object({}),
      execute: () => {
        guard();
        return screenshot('view');
      },
    },
    {
      name: 'click',
      label: 'Click',
      description: 'Click the visually identified target in the latest screenshot.',
      parameters: Type.Object({
        x: Type.Number(),
        y: Type.Number(),
        button: Type.Optional(Type.String()),
        count: Type.Optional(Type.Number()),
      }),
      execute: async (_id, raw) => {
        guard();
        if (!isRecord(raw)) throw new Error('Invalid click parameters.');
        const target = point(raw);
        const button = raw.button ?? 'left';
        if (button !== 'left' && button !== 'right' && button !== 'middle')
          throw new Error('Invalid mouse button.');
        const count = raw.count ?? 1;
        if (count !== 1 && count !== 2) throw new Error('Click count must be 1 or 2.');
        await page.mouse.click(target.x, target.y, { button, clickCount: count });
        return screenshot('click');
      },
    },
    {
      name: 'move',
      label: 'Move',
      description: 'Hover a point to reveal tooltips and hover states.',
      parameters: Type.Object({ x: Type.Number(), y: Type.Number() }),
      execute: async (_id, raw) => {
        guard();
        if (!isRecord(raw)) throw new Error('Invalid move parameters.');
        const target = point(raw);
        await page.mouse.move(target.x, target.y, { steps: 5 });
        return screenshot('move');
      },
    },
    {
      name: 'type',
      label: 'Type',
      description: 'Insert text into the focused field without generating key events.',
      parameters: Type.Object({ text: Type.String() }),
      execute: async (_id, raw) => {
        guard();
        if (!isRecord(raw)) throw new Error('Invalid type parameters.');
        await page.keyboard.insertText(stringParam(raw, 'text'));
        return screenshot('type');
      },
    },
    {
      name: 'press',
      label: 'Press key',
      description: 'Send a key or chord such as Enter or Control+p.',
      parameters: Type.Object({ key: Type.String() }),
      execute: async (_id, raw) => {
        guard();
        if (!isRecord(raw)) throw new Error('Invalid press parameters.');
        await page.keyboard.press(stringParam(raw, 'key'));
        return screenshot('press');
      },
    },
    {
      name: 'scroll',
      label: 'Scroll',
      description: 'Scroll over a point in the window.',
      parameters: Type.Object({
        x: Type.Number(),
        y: Type.Number(),
        deltaY: Type.Number(),
        deltaX: Type.Optional(Type.Number()),
      }),
      execute: async (_id, raw) => {
        guard();
        if (!isRecord(raw)) throw new Error('Invalid scroll parameters.');
        const target = point(raw);
        await page.mouse.move(target.x, target.y);
        await page.mouse.wheel(numberParam(raw, 'deltaX') || 0, numberParam(raw, 'deltaY'));
        return screenshot('scroll');
      },
    },
    {
      name: 'wait',
      label: 'Wait',
      description: 'Wait briefly for rendering, then capture the window again.',
      parameters: Type.Object({ ms: Type.Number() }),
      execute: async (_id, raw) => {
        guard();
        if (!isRecord(raw)) throw new Error('Invalid wait parameters.');
        const ms = numberParam(raw, 'ms');
        if (ms < 0 || ms > 5000) throw new Error('Wait must be between 0 and 5000 milliseconds.');
        await page.waitForTimeout(ms);
        return screenshot('wait');
      },
    },
    {
      name: 'reload',
      label: 'Reload',
      description: 'Reload the renderer to check that state is restored from disk.',
      parameters: Type.Object({}),
      execute: async () => {
        guard();
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('.workspace').waitFor({ timeout: 60000 });
        return screenshot('reload');
      },
    },
    {
      name: 'read_vault_file',
      label: 'Read vault file',
      description:
        'Read a Markdown file from the disposable vault to corroborate a visible result.',
      parameters: Type.Object({ path: Type.String() }),
      execute: (_id, raw) => {
        guard();
        if (!isRecord(raw)) throw new Error('Invalid read parameters.');
        const relative = stringParam(raw, 'path');
        if (relative.includes('..') || path.isAbsolute(relative))
          throw new Error('Vault paths must be relative.');
        const file = path.join(fixture.vault, relative);
        if (!fs.existsSync(file)) return Promise.resolve(textResult(`No such file: ${relative}`));
        return Promise.resolve(textResult(fs.readFileSync(file, 'utf8').slice(0, 4000)));
      },
    },
    {
      name: 'finish',
      label: 'Finish',
      description: 'Record the verdict and end the session.',
      parameters: Type.Object({
        passed: Type.Boolean(),
        reason: Type.Optional(Type.String()),
      }),
      execute: (_id, raw) => {
        if (!isRecord(raw)) throw new Error('Invalid finish parameters.');
        if (typeof raw.passed !== 'boolean') throw new Error('finish requires a boolean passed.');
        const reason =
          typeof raw.reason === 'string' && raw.reason.length > 0 ? raw.reason : 'No reason given.';
        verdict.value = { passed: raw.passed, reason };
        return Promise.resolve({
          content: [{ type: 'text' as const, text: `Verdict recorded: ${reason}` }],
          details: undefined,
          terminate: true,
        });
      },
    },
  ];
}

function fauxScript(): string | undefined {
  return process.env.VISION_FAUX_RESPONSES;
}

async function main(): Promise<void> {
  const evidence =
    process.env.VISION_OUT_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-vision-'));
  fs.mkdirSync(evidence, { recursive: true });
  const transcript = path.join(evidence, 'transcript.jsonl');
  const record = (event: Record<string, unknown>) => {
    fs.appendFileSync(
      transcript,
      `${JSON.stringify({ time: new Date().toISOString(), ...event })}\n`,
    );
  };
  const models = builtinModels();
  const faux = fauxScript();
  if (faux) {
    const configured = fauxProvider();
    models.setProvider(configured.provider);
    configured.setResponses(
      fauxSteps(faux).map((step) =>
        isRecord(step) && typeof step.tool === 'string'
          ? fauxAssistantMessage([
              fauxToolCall(step.tool, isRecord(step.arguments) ? toJsonObject(step.arguments) : {}),
            ])
          : fauxAssistantMessage(typeof step === 'string' ? step : 'ok'),
      ),
    );
  } else if (!process.env.OPENCODE_API_KEY) {
    throw new Error('OPENCODE_API_KEY is required to run the vision agent.');
  }
  const model = models.getModel(providerId, modelId);
  if (!model)
    throw new Error(
      `Unknown model ${providerId}::${modelId}. Run with VISION_PROVIDER and VISION_MODEL set to a catalog entry.`,
    );
  record({ event: 'start', provider: providerId, model: modelId, thinkingLevel, task, evidence });
  const verdict: { value?: Verdict } = {};
  const counters: Counters = { steps: 0, screenshots: 0 };
  await withAgent('vision', async (fixture) => {
    const tools = createTools(fixture, evidence, verdict, counters);
    const agent = new Agent({
      initialState: {
        model,
        thinkingLevel,
        systemPrompt,
        tools,
      },
      streamFn: (activeModel, context, options) =>
        models.streamSimple(activeModel, context, options),
      toolExecution: 'sequential',
      beforeToolCall: ({ toolCall }) => {
        counters.steps += 1;
        if (counters.steps > maxSteps)
          return Promise.resolve({
            block: true,
            reason: `Step budget of ${String(maxSteps)} is exhausted. Call finish now.`,
            terminate: true,
          });
        record({ event: 'tool', step: counters.steps, name: toolCall.name });
        return Promise.resolve(undefined);
      },
    });
    agent.subscribe((event) => {
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        const text = event.message.content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('');
        if (text.length > 0) record({ event: 'assistant', text });
      }
    });
    const deadline = setTimeout(
      () => {
        record({ event: 'timeout', minutes: deadlineMinutes });
        agent.abort();
      },
      deadlineMinutes * 60 * 1000,
    );
    try {
      await agent.prompt(task);
    } finally {
      clearTimeout(deadline);
    }
  });
  const result: Verdict = verdict.value ?? {
    passed: false,
    reason: 'The agent stopped without calling finish.',
  };
  record({ event: 'result', ...result, steps: counters.steps, screenshots: counters.screenshots });
  process.stdout.write(
    `${JSON.stringify({
      event: 'result',
      passed: result.passed,
      reason: result.reason,
      steps: counters.steps,
      screenshots: counters.screenshots,
      evidence,
    })}\n`,
  );
  if (!result.passed) process.exitCode = 1;
}

await main();
