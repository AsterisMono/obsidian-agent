import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { withAgent } from '../e2e/support.ts';
import { createTools, type ToolState } from '../../scripts/vision-tools.ts';
import { parseReport } from '../../scripts/vision-report.ts';

await test(
  'coordinate tools preserve evidence, reject stale actions, and handle optional horizontal scrolling',
  { timeout: 120000 },
  async () => {
    const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'vision-tools-'));
    try {
      await withAgent('vision-tools', async (fixture) => {
        const state: ToolState = { images: [], findings: [] };
        const tools = createTools(
          fixture,
          evidence,
          state,
          () => 'Budget available.',
          () => undefined,
        );
        const call = async (name: string, args: Record<string, unknown>) => {
          const tool = tools.find((entry) => entry.name === name);
          assert.ok(tool);
          return tool.execute(name, args);
        };
        await call('screenshot', {});
        await call('scroll', {
          screenshotId: 'shot-1',
          expected: 'The welcome view remains visible.',
          x: 600,
          y: 400,
          deltaY: 150,
        });
        assert.equal(state.images.length, 2);
        await assert.rejects(
          call('click', {
            screenshotId: 'shot-1',
            expected: 'Stale action is blocked.',
            x: 10,
            y: 10,
          }),
          /latest screenshot/,
        );
        assert.equal(state.images.length, 2);
        await fixture.openSidebar();
        await fixture.send('Vision tooling persistence check');
        const result = await call('read_vault_file', { path: '.obsidian/plugins/agent/data.json' });
        assert.ok(JSON.stringify(result).includes('Vision tooling persistence check'));
        await call('reload', { screenshotId: 'shot-2', expected: 'Obsidian reloads.' });
        await call('report_finding', {
          title: 'Synthetic tooling candidate',
          summary: 'Exercises the reporting protocol only.',
          severity: 'low',
          expectationSource: 'Tooling test specification',
          expected: 'A local finding is retained.',
          actual: 'A screenshot was captured.',
          steps: ['Capture a screenshot.'],
          screenshots: ['shot-3'],
          reproduced: false,
        });
        await assert.rejects(
          call('finish', {
            status: 'observed-pass',
            reason: 'Invalid contradictory verdict.',
            coverage: ['Chat exercised.'],
            screenshots: ['shot-3'],
          }),
          /cannot claim/,
        );
        await call('finish', {
          status: 'candidate-defect',
          reason: 'Synthetic reporting verification.',
          coverage: ['Reporting protocol exercised.'],
          screenshots: ['shot-3'],
        });
        assert.equal(state.verdict?.status, 'candidate-defect');
        assert.ok(fs.statSync(path.join(evidence, 'shot-3.png')).size > 0);
      });
    } finally {
      fs.rmSync(evidence, { recursive: true, force: true });
    }
  },
);

await test(
  'scripted runner can finish after exhausting actions and retains complete local evidence',
  { timeout: 120000 },
  async () => {
    const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'vision-runner-'));
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      VISION_OUT_DIR: evidence,
      VISION_MAX_STEPS: '1',
      VISION_FAUX_RESPONSES: JSON.stringify([
        { tool: 'screenshot', arguments: {} },
        {
          tool: 'click',
          arguments: {
            screenshotId: 'shot-1',
            expected: 'This over-budget action is blocked.',
            x: 10,
            y: 10,
          },
        },
        {
          tool: 'finish',
          arguments: {
            status: 'inconclusive',
            reason: 'The deliberately tiny action budget was exhausted.',
            coverage: ['Screenshot exercised; chat not reached.'],
            screenshots: ['shot-1'],
          },
        },
      ]),
    };
    delete env.GITHUB_ACTIONS;
    delete env.OPENCODE_API_KEY;
    delete env.GH_TOKEN;
    try {
      const child = spawn(process.execPath, ['scripts/vision-run.ts'], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });
      child.stderr.on('data', (data: Buffer) => {
        output += data.toString();
      });
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', resolve);
      });
      assert.equal(code, 1, output);
      const parsed: unknown = JSON.parse(
        fs.readFileSync(path.join(evidence, 'report.json'), 'utf8'),
      );
      const report = parseReport(parsed);
      assert.equal(report.status, 'inconclusive');
      assert.match(report.reason, /deliberately tiny/);
      assert.equal(report.model, 'deepseek-v4.1-flash');
      assert.equal(report.requestedThinking, 'xhigh');
      assert.equal(report.images.length, 1);
      assert.ok(fs.existsSync(path.join(evidence, 'saved-data.json')));
      const transcript = fs.readFileSync(path.join(evidence, 'transcript.jsonl'), 'utf8');
      assert.ok(transcript.includes('over-budget action'));
      assert.ok(transcript.includes('Action budget exhausted'));
      assert.ok(transcript.includes('tool_execution_end'));
    } finally {
      fs.rmSync(evidence, { recursive: true, force: true });
    }
  },
);
