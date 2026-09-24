import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { VisionBudget } from '../../scripts/vision-budget.ts';
import {
  isRecord,
  findingFrom,
  verdictFrom,
  parseReport,
  readContainedFile,
  readVaultFile,
  type VisionReport,
} from '../../scripts/vision-report.ts';
import { publishSummary, sourceFrom, type GitHubApi } from '../../scripts/vision-publish.ts';
import { retainRecentImages } from '../../scripts/vision-run.ts';

const sha = 'a'.repeat(40);
const sourceRun = {
  path: '.github/workflows/ci.yml',
  conclusion: 'success',
  event: 'pull_request',
  repository: { full_name: 'owner/repo' },
  head_repository: { full_name: 'owner/repo' },
  head_sha: sha,
  head_branch: 'change',
  id: 100,
  run_attempt: 1,
  pull_requests: [{ number: 4 }],
};
const candidate = {
  title: 'Chat panel clips text',
  summary: 'The last line is hidden.',
  severity: 'medium',
  expectationSource: 'The message should remain readable.',
  expected: 'The full line is visible.',
  actual: 'Its bottom half is hidden.',
  steps: ['Open the panel.', 'Send a message.'],
  screenshots: ['shot-1'],
  reproduced: false,
};
const report: VisionReport = {
  schemaVersion: 1,
  repository: 'owner/repo',
  sha,
  headSha: sha,
  runId: '100',
  runAttempt: '1',
  provider: 'opencode-go',
  model: 'deepseek-v4.1-flash',
  requestedThinking: 'xhigh',
  effectiveThinking: 'max',
  status: 'candidate-defect',
  reason: 'Observed clipped text.',
  coverage: ['Exercised: chat rendering.'],
  screenshots: ['shot-1'],
  steps: 4,
  requests: 5,
  tokens: 1000,
  estimatedCostUsd: 0.001,
  findings: [candidate],
  images: [{ id: 'shot-1', file: 'shot-1.png', width: 1280, height: 800 }],
};

await test('vault reads reject traversal, symlinks, implementation files, directories, and oversized data', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vision-files-'));
  try {
    const vault = path.join(directory, 'vault');
    fs.mkdirSync(path.join(vault, '.obsidian/plugins/agent'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'outside.md'), 'outside');
    fs.writeFileSync(path.join(vault, 'Note.md'), 'inside');
    fs.writeFileSync(path.join(vault, '.obsidian/plugins/agent/data.json'), '{"chats":[]}');
    fs.symlinkSync(path.join(directory, 'outside.md'), path.join(vault, 'link.md'));
    fs.symlinkSync(directory, path.join(vault, 'linked'));
    fs.mkdirSync(path.join(vault, 'directory.md'));
    fs.writeFileSync(path.join(vault, 'large.md'), 'x'.repeat(65537));
    assert.equal(readVaultFile(vault, 'Note.md'), 'inside');
    assert.equal(readVaultFile(vault, '.obsidian/plugins/agent/data.json'), '{"chats":[]}');
    for (const file of [
      '../outside.md',
      '/etc/passwd',
      'link.md',
      'linked/outside.md',
      'directory.md',
      'large.md',
      '.obsidian/plugins/agent/main.js',
    ])
      assert.throws(() => readVaultFile(vault, file), file);
    assert.throws(() => readContainedFile(vault, 'Note.md', 2));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

await test('tool exhaustion reserves reporting calls while request, token, and cost caps reject work before dispatch', () => {
  const budget = new VisionBudget({ VISION_MAX_STEPS: '1', VISION_MAX_REQUESTS: '2' });
  assert.equal(budget.tool('screenshot'), undefined);
  assert.match(budget.tool('click') ?? '', /Action budget/);
  assert.equal(budget.tool('report_finding'), undefined);
  assert.equal(budget.tool('finish'), undefined);
  budget.reserve(100, 0.3, 1.2);
  budget.reserve(100, 0.3, 1.2);
  assert.throws(() => {
    budget.reserve(100, 0.3, 1.2);
  }, /request budget/);
  assert.equal(budget.requests, 2);
  const tokens = new VisionBudget({ VISION_MAX_TOTAL_TOKENS: '10' });
  assert.throws(() => {
    tokens.reserve(1, 0.3, 1.2);
  }, /token budget/);
  assert.equal(tokens.requests, 0);
  const cost = new VisionBudget({ VISION_MAX_COST_USD: '0.0001' });
  assert.throws(() => {
    cost.reserve(1, 0.3, 1.2);
  }, /cost budget/);
  assert.equal(cost.requests, 0);
  for (const value of ['NaN', 'Infinity', '0', '-1', '1.5', '201'])
    assert.throws(() => new VisionBudget({ VISION_MAX_STEPS: value }));
});

await test('findings and verdicts require registered evidence and reject contradictory claims', () => {
  const ids = new Set(['shot-1']);
  const finding = findingFrom(candidate, ids);
  assert.throws(() => findingFrom({ ...candidate, screenshots: ['/tmp/arbitrary.png'] }, ids));
  assert.throws(() => findingFrom({ ...candidate, screenshots: [] }, ids));
  assert.throws(() => findingFrom({ ...candidate, severity: 'urgent' }, ids));
  assert.throws(() => verdictFrom({ ...report, status: 'observed-pass' }, [finding], ids));
  assert.throws(() => verdictFrom(report, [], ids));
  assert.throws(() =>
    verdictFrom({ ...report, status: 'observed-pass', screenshots: [] }, [], ids),
  );
  assert.equal(parseReport(report).status, 'candidate-defect');
  assert.throws(() =>
    parseReport({ ...report, images: [{ ...report.images[0], file: '../other.png' }] }),
  );
  assert.throws(() =>
    parseReport({ ...report, findings: Array.from({ length: 6 }, () => candidate) }),
  );
});

await test('only the two newest images enter model context without removing tool history', () => {
  const messages: AgentMessage[] = [1, 2, 3, 4].map((index) => ({
    role: 'toolResult',
    toolCallId: String(index),
    toolName: 'screenshot',
    content: [
      { type: 'text', text: `shot-${String(index)}` },
      { type: 'image', data: String(index), mimeType: 'image/png' },
    ],
    isError: false,
    timestamp: index,
  }));
  const filtered = retainRecentImages(messages);
  assert.equal(filtered.length, 4);
  const images = filtered.flatMap((message) =>
    message.role === 'toolResult' ? message.content.filter((part) => part.type === 'image') : [],
  );
  assert.deepEqual(
    images.map((image) => image.data),
    ['3', '4'],
  );
  assert.equal(messages[0].role === 'toolResult' && messages[0].content[1].type, 'image');
});

await test('publishing eligibility excludes dispatch, forks, other branches, failed runs, and ambiguous PRs', () => {
  assert.ok(sourceFrom(sourceRun, 'owner/repo'));
  assert.ok(sourceFrom({ ...sourceRun, event: 'push', head_branch: 'main' }, 'owner/repo'));
  for (const change of [
    { event: 'workflow_dispatch' },
    { head_repository: { full_name: 'fork/repo' } },
    { path: '.github/workflows/vision.yml' },
    { conclusion: 'failure' },
    { event: 'push', head_branch: 'change' },
    { pull_requests: [] },
  ])
    assert.equal(sourceFrom({ ...sourceRun, ...change }, 'owner/repo'), undefined);
});

await test('publisher updates a single bot comment, suppresses stale revisions, and escapes untrusted text', async () => {
  const source = sourceFrom(sourceRun, 'owner/repo');
  assert.ok(source);
  let head = sha;
  let comments: Array<Record<string, unknown>> = [];
  const writes: Array<{ endpoint: string; method: string }> = [];
  const api: GitHubApi = (endpoint, method = 'GET', body) => {
    if (method !== 'GET') {
      assert.ok(isRecord(body));
      writes.push({ endpoint, method });
      comments = [{ id: 8, body: body.body, user: { login: 'github-actions[bot]', type: 'Bot' } }];
      return Promise.resolve({});
    }
    if (endpoint.includes('/pulls/'))
      return Promise.resolve({
        state: 'open',
        head: { sha: head, repo: { full_name: 'owner/repo' } },
      });
    return Promise.resolve(comments);
  };
  const malicious = { ...report, reason: '@everyone <img src=x> [click](https://example.com)' };
  const first = await publishSummary(api, source, malicious, 12);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, 'POST');
  assert.ok(first.includes('@\u200beveryone'));
  assert.ok(first.includes('&lt;img'));
  assert.ok(!first.includes('[click](https://example.com)'));
  await publishSummary(api, source, malicious, 12);
  assert.equal(writes.length, 1);
  await publishSummary(api, { ...source, attempt: 2 }, { ...report, runAttempt: '2' }, 14);
  assert.equal(writes.length, 2);
  assert.equal(writes[1].method, 'PATCH');
  await publishSummary(api, source, report, 12);
  assert.equal(writes.length, 2);
  head = 'b'.repeat(40);
  await publishSummary(api, { ...source, id: 101 }, { ...report, runId: '101' }, 16);
  assert.equal(writes.length, 2);
  await assert.rejects(publishSummary(api, source, { ...report, headSha: head }, 12), /provenance/);
  const main = { ...source, event: 'push', branch: 'main', prNumber: undefined };
  const summary = await publishSummary(
    () => {
      throw new Error('Main must not write comments.');
    },
    main,
    report,
    12,
  );
  assert.ok(summary.includes(`/commit/${sha}`));
});
