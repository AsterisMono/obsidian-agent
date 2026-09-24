import fs from 'node:fs';
import path from 'node:path';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type, type ImageContent } from '@earendil-works/pi-ai';
import { reloadApp, type AgentFixture } from '../tests/e2e/support.ts';
import {
  findingFrom,
  isRecord,
  readVaultFile,
  textParam,
  verdictFrom,
  type Finding,
  type Screenshot,
  type Verdict,
} from './vision-report.ts';

export type ToolState = {
  images: Screenshot[];
  findings: Finding[];
  verdict?: Verdict;
};

function numberParam(params: Record<string, unknown>, name: string): number {
  const value = params[name];
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`${name} must be a finite number.`);
  return value;
}

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }], details: undefined };
}

export function createTools(
  fixture: Pick<AgentFixture, 'page' | 'vault'>,
  evidence: string,
  state: ToolState,
  budget: () => string,
  checkpoint: () => void,
): AgentTool[] {
  const page = fixture.page;
  const ids = () => new Set(state.images.map((shot) => shot.id));
  const screenshot = async () => {
    const buffer = await page.screenshot({ scale: 'css', fullPage: false, timeout: 15000 });
    const size = [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
    if (size.some((dimension) => dimension > 2000))
      throw new Error('Vision screenshots must fit within 2000x2000 CSS pixels.');
    const id = `shot-${String(state.images.length + 1)}`;
    const shot = { id, file: `${id}.png`, width: size[0], height: size[1] };
    fs.writeFileSync(path.join(evidence, shot.file), buffer);
    state.images.push(shot);
    checkpoint();
    const image: ImageContent = {
      type: 'image',
      data: buffer.toString('base64'),
      mimeType: 'image/png',
    };
    return {
      content: [
        {
          type: 'text' as const,
          text: `Screenshot ${id} (${String(shot.width)}x${String(shot.height)} CSS pixels). ${budget()}`,
        },
        image,
      ],
      details: shot,
    };
  };
  const point = (params: Record<string, unknown>, xKey = 'x', yKey = 'y') => {
    const shot = state.images.at(-1);
    const x = numberParam(params, xKey);
    const y = numberParam(params, yKey);
    if (!shot || x < 0 || y < 0 || x >= shot.width || y >= shot.height)
      throw new Error('Coordinates are outside the latest screenshot.');
    return { x, y };
  };
  const ui = (
    name: string,
    description: string,
    properties: Parameters<typeof Type.Object>[0],
    action: (params: Record<string, unknown>) => Promise<void>,
  ): AgentTool => ({
    name,
    label: name,
    description,
    parameters: Type.Object({
      screenshotId: Type.String(),
      expected: Type.String({ maxLength: 2000 }),
      ...properties,
    }),
    execute: async (_id, raw, signal) => {
      signal?.throwIfAborted();
      if (!isRecord(raw)) throw new Error('Invalid action parameters.');
      if (!state.images.length || raw.screenshotId !== state.images.at(-1)?.id)
        throw new Error('Use the latest screenshot ID, or capture a screenshot first.');
      textParam(raw.expected, 'expected');
      await action(raw);
      signal?.throwIfAborted();
      return screenshot();
    },
  });
  return [
    {
      name: 'screenshot',
      label: 'Screenshot',
      description:
        'Capture this Obsidian renderer. Native dialogs and other windows are outside coverage.',
      parameters: Type.Object({}),
      execute: (_id, _raw, signal) => {
        signal?.throwIfAborted();
        return screenshot();
      },
    },
    ui(
      'click',
      'Click a visually identified target.',
      {
        x: Type.Number(),
        y: Type.Number(),
        button: Type.Optional(
          Type.Union([Type.Literal('left'), Type.Literal('right'), Type.Literal('middle')]),
        ),
        count: Type.Optional(Type.Union([Type.Literal(1), Type.Literal(2)])),
      },
      async (raw) => {
        const target = point(raw);
        const button = raw.button ?? 'left';
        const count = raw.count ?? 1;
        if (button !== 'left' && button !== 'right' && button !== 'middle')
          throw new Error('Invalid mouse button.');
        if (count !== 1 && count !== 2) throw new Error('Invalid click count.');
        await page.mouse.click(target.x, target.y, { button, clickCount: count });
      },
    ),
    ui(
      'move',
      'Hover to reveal tooltips; use a bounded wait if rendering is delayed.',
      {
        x: Type.Number(),
        y: Type.Number(),
      },
      async (raw) => {
        const target = point(raw);
        await page.mouse.move(target.x, target.y, { steps: 5 });
      },
    ),
    ui(
      'drag',
      'Drag between visible points, for example a pane divider.',
      {
        x: Type.Number(),
        y: Type.Number(),
        toX: Type.Number(),
        toY: Type.Number(),
      },
      async (raw) => {
        const from = point(raw);
        const to = point(raw, 'toX', 'toY');
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        try {
          await page.mouse.move(to.x, to.y, { steps: 10 });
        } finally {
          await page.mouse.up();
        }
      },
    ),
    ui(
      'type',
      'Insert text into the focused field without key events.',
      {
        text: Type.String({ maxLength: 8000 }),
      },
      async (raw) => {
        await page.keyboard.insertText(textParam(raw.text, 'text', 8000));
      },
    ),
    ui(
      'press',
      'Send a key or chord, such as Enter or Control+p.',
      {
        key: Type.String({ maxLength: 80 }),
      },
      async (raw) => {
        await page.keyboard.press(textParam(raw.key, 'key', 80));
      },
    ),
    ui(
      'scroll',
      'Scroll over a point in the renderer.',
      {
        x: Type.Number(),
        y: Type.Number(),
        deltaY: Type.Number(),
        deltaX: Type.Optional(Type.Number()),
      },
      async (raw) => {
        const target = point(raw);
        const dx = raw.deltaX === undefined ? 0 : numberParam(raw, 'deltaX');
        const dy = numberParam(raw, 'deltaY');
        if (Math.abs(dx) > 5000 || Math.abs(dy) > 5000)
          throw new Error('Scroll deltas must be within 5000 pixels.');
        await page.mouse.move(target.x, target.y);
        await page.mouse.wheel(dx, dy);
      },
    ),
    ui(
      'wait',
      'Wait for an expected visible outcome, then inspect the returned screenshot.',
      {
        ms: Type.Number({ minimum: 0, maximum: 5000 }),
      },
      async (raw) => {
        const ms = numberParam(raw, 'ms');
        if (ms < 0 || ms > 5000) throw new Error('Wait must be between 0 and 5000 milliseconds.');
        await page.waitForTimeout(ms);
      },
    ),
    ui(
      'reload',
      'Reload the renderer; inspect restored state visually after it settles.',
      {},
      async () => {
        await reloadApp(page);
      },
    ),
    {
      name: 'read_vault_file',
      label: 'Read vault data',
      description:
        'Read a Markdown note or .obsidian/plugins/agent/data.json (64 KiB maximum). Corroborates visible results; never an oracle for expected behavior.',
      parameters: Type.Object({ path: Type.String({ maxLength: 500 }) }),
      execute: (_id, raw, signal) => {
        signal?.throwIfAborted();
        if (!isRecord(raw)) throw new Error('Invalid read parameters.');
        return Promise.resolve(
          textResult(
            `${readVaultFile(fixture.vault, textParam(raw.path, 'path', 500))}\n${budget()}`,
          ),
        );
      },
    },
    {
      name: 'report_finding',
      label: 'Record candidate finding',
      description:
        'Record an unvalidated observation with screenshot IDs, an expectation source, and reproduction status. At most five distinct candidates.',
      parameters: Type.Object({
        title: Type.String({ maxLength: 160 }),
        summary: Type.String({ maxLength: 2000 }),
        severity: Type.Union(
          ['critical', 'high', 'medium', 'low'].map((value) => Type.Literal(value)),
        ),
        expectationSource: Type.String({ maxLength: 2000 }),
        expected: Type.String({ maxLength: 2000 }),
        actual: Type.String({ maxLength: 2000 }),
        steps: Type.Array(Type.String({ maxLength: 2000 }), { minItems: 1, maxItems: 12 }),
        screenshots: Type.Array(Type.String(), { minItems: 1, maxItems: 4 }),
        reproduced: Type.Boolean(),
      }),
      execute: (_id, raw) => {
        const finding = findingFrom(raw, ids());
        if (state.findings.some((item) => item.title.toLowerCase() === finding.title.toLowerCase()))
          throw new Error('This candidate title is already recorded.');
        if (state.findings.length >= 5)
          throw new Error('Five candidates are already recorded. Finish the run.');
        state.findings.push(finding);
        checkpoint();
        return Promise.resolve(textResult(`Candidate recorded locally. ${budget()}`));
      },
    },
    {
      name: 'finish',
      label: 'Finish',
      description:
        'Finish with an evidence-scoped observation, candidate defect, or inconclusive status.',
      parameters: Type.Object({
        status: Type.Union(
          ['observed-pass', 'candidate-defect', 'inconclusive'].map((value) => Type.Literal(value)),
        ),
        reason: Type.String({ maxLength: 2000 }),
        coverage: Type.Array(Type.String({ maxLength: 2000 }), { maxItems: 20 }),
        screenshots: Type.Array(Type.String(), { maxItems: 8 }),
      }),
      execute: (_id, raw) => {
        state.verdict = verdictFrom(raw, state.findings, ids());
        checkpoint();
        return Promise.resolve({ ...textResult('Verdict recorded.'), terminate: true });
      },
    },
  ];
}
