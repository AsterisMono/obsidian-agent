import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  isRecord,
  parseReport,
  readContainedFile,
  textParam,
  type VisionReport,
} from './vision-report.ts';

export type GitHubApi = (
  endpoint: string,
  method?: 'GET' | 'POST' | 'PATCH',
  body?: unknown,
) => Promise<unknown>;
type Source = {
  id: number;
  attempt: number;
  repository: string;
  sha: string;
  event: string;
  branch: string;
  prNumber?: number;
};
const marker = '<!-- obsidian-agent-vision:v1 -->';

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('Invalid GitHub response.');
  return value;
}

function identifier(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new Error('Invalid GitHub identifier.');
  return value;
}

export function sourceFrom(value: unknown, repository: string): Source | undefined {
  const run = record(value);
  if (
    run.path !== '.github/workflows/ci.yml' ||
    run.conclusion !== 'success' ||
    record(run.repository).full_name !== repository ||
    record(run.head_repository).full_name !== repository ||
    (run.event !== 'pull_request' && run.event !== 'push')
  )
    return;
  const sha = textParam(run.head_sha, 'head SHA', 40);
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid source SHA.');
  const branch = textParam(run.head_branch, 'branch', 255);
  if (run.event === 'push' && branch !== 'main') return;
  let prNumber: number | undefined;
  if (run.event === 'pull_request') {
    if (!Array.isArray(run.pull_requests) || run.pull_requests.length !== 1) return;
    prNumber = identifier(record(run.pull_requests[0]).number);
  }
  return {
    id: identifier(run.id),
    attempt: identifier(run.run_attempt),
    repository,
    sha,
    event: run.event,
    branch,
    prNumber,
  };
}

function escaped(text: string): string {
  return text
    .slice(0, 300)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/@/g, '@\u200b')
    .replace(/[\\`*_[\]{}()#!|~]/g, '\\$&');
}

export function renderSummary(report: VisionReport, source: Source, artifactId: number): string {
  const runUrl = `https://github.com/${source.repository}/actions/runs/${String(source.id)}`;
  const lines = [
    marker,
    `<!-- vision-run:${String(source.id)}:${String(source.attempt)} -->`,
    `## Vision observation: ${report.status}`,
    '',
    'Advisory, agent-reported, and unvalidated. This is a generic smoke check, not proof of PR-specific coverage or real provider behavior.',
    '',
    escaped(report.reason),
    '',
    `Source commit: [${source.sha.slice(0, 12)}](https://github.com/${source.repository}/commit/${source.sha}). Tested checkout: ${escaped(report.sha)}.`,
    `Model: ${escaped(report.provider)} / ${escaped(report.model)}; requested reasoning ${escaped(report.requestedThinking)}, effective ${escaped(report.effectiveThinking)}.`,
    `Actions: ${String(report.steps)}; model requests: ${String(report.requests)}; reported tokens: ${String(report.tokens)}; conservative cost estimate: $${report.estimatedCostUsd.toFixed(4)}.`,
    '',
    '### Coverage',
    '',
    ...report.coverage.map((item) => `- ${escaped(item)}`),
    '',
    `### Candidate findings (${String(report.findings.length)})`,
    '',
  ];
  for (const finding of report.findings) {
    lines.push(
      `**${escaped(finding.title)}** — ${finding.severity}; ${finding.reproduced ? 'reproduced by the same agent' : 'single observation'}.`,
      '',
      escaped(finding.summary),
      '',
      `Expectation source: ${escaped(finding.expectationSource)}`,
      '',
      `Expected: ${escaped(finding.expected)}`,
      '',
      `Observed: ${escaped(finding.actual)}`,
      '',
      ...finding.steps.map((step, index) => `${String(index + 1)}. ${escaped(step)}`),
      '',
      `Screenshots: ${finding.screenshots.join(', ')}.`,
      '',
    );
  }
  if (!report.findings.length)
    lines.push('No candidate findings recorded; unvisited surfaces remain untested.', '');
  lines.push(
    `[Run and logs](${runUrl}) · [vision-evidence artifact](${runUrl}/artifacts/${String(artifactId)})`,
    '',
    'Screenshots and complete structured evidence are in the artifact. Confirm candidates before filing issues.',
  );
  return lines.join('\n');
}

async function currentPull(api: GitHubApi, source: Source): Promise<boolean> {
  if (!source.prNumber) return true;
  const pull = record(await api(`/repos/${source.repository}/pulls/${String(source.prNumber)}`));
  const head = record(pull.head);
  return (
    pull.state === 'open' &&
    head.sha === source.sha &&
    record(head.repo).full_name === source.repository
  );
}

export async function publishSummary(
  api: GitHubApi,
  source: Source,
  report: VisionReport,
  artifactId: number,
): Promise<string> {
  if (
    report.repository !== source.repository ||
    report.headSha !== source.sha ||
    report.runId !== String(source.id) ||
    report.runAttempt !== String(source.attempt) ||
    !/^[a-f0-9]{40}$/.test(report.sha)
  )
    throw new Error('Report provenance does not match its source run.');
  const body = renderSummary(report, source, artifactId);
  if (!source.prNumber) return body;
  if (!(await currentPull(api, source))) return 'Skipped stale or closed pull request.';
  let existing: Record<string, unknown> | undefined;
  for (let page = 1; page <= 10; page++) {
    const comments = await api(
      `/repos/${source.repository}/issues/${String(source.prNumber)}/comments?per_page=100&page=${String(page)}`,
    );
    if (!Array.isArray(comments)) throw new Error('Invalid comments response.');
    for (const item of comments) {
      const comment = record(item);
      const user = record(comment.user);
      if (
        user.login === 'github-actions[bot]' &&
        user.type === 'Bot' &&
        typeof comment.body === 'string' &&
        comment.body.startsWith(marker)
      ) {
        if (existing) throw new Error('Multiple vision summary comments require manual cleanup.');
        existing = comment;
      }
    }
    if (comments.length < 100) break;
    if (page === 10)
      throw new Error('Comment search limit reached; refusing to create a possible duplicate.');
  }
  if (existing) {
    const previous = /<!-- vision-run:(\d+):(\d+) -->/.exec(String(existing.body));
    if (
      previous &&
      (Number(previous[1]) > source.id ||
        (Number(previous[1]) === source.id && Number(previous[2]) > source.attempt))
    )
      return 'Skipped an older run or attempt.';
    if (existing.body === body) return body;
  }
  if (!(await currentPull(api, source)))
    return 'Skipped a pull request that changed during publishing.';
  await api(
    existing
      ? `/repos/${source.repository}/issues/comments/${String(identifier(existing.id))}`
      : `/repos/${source.repository}/issues/${String(source.prNumber)}/comments`,
    existing ? 'PATCH' : 'POST',
    { body },
  );
  return body;
}

async function main(): Promise<void> {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_EVENT_NAME !== 'workflow_run')
    throw new Error('Publishing is restricted to the trusted workflow_run workflow.');
  const repository = textParam(process.env.GITHUB_REPOSITORY, 'repository', 200);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid repository.');
  const runId = textParam(process.env.VISION_SOURCE_RUN_ID, 'source run ID', 24);
  if (!/^\d+$/.test(runId)) throw new Error('Invalid source run ID.');
  textParam(process.env.GH_TOKEN, 'GitHub token', 1000);
  const execute = promisify(execFile);
  const api: GitHubApi = async (endpoint, method = 'GET', body) => {
    const args = ['api', '--hostname', 'github.com', '--method', method, endpoint];
    const directory =
      body === undefined ? undefined : fs.mkdtempSync(path.join(os.tmpdir(), 'vision-publish-'));
    try {
      if (directory) {
        const fields = record(body);
        const file = path.join(directory, 'request.json');
        fs.writeFileSync(
          file,
          JSON.stringify({ body: textParam(fields.body, 'comment body', 65536) }),
        );
        args.push('--input', file);
      }
      const result = await execute('gh', args, { timeout: 20000, maxBuffer: 2 * 1024 * 1024 });
      const parsed: unknown = JSON.parse(result.stdout);
      return parsed;
    } finally {
      if (directory) fs.rmSync(directory, { recursive: true, force: true });
    }
  };
  const source = sourceFrom(await api(`/repos/${repository}/actions/runs/${runId}`), repository);
  if (!source) {
    process.stdout.write('Source run is not eligible for publishing.\n');
    return;
  }
  if (!(await currentPull(api, source))) {
    process.stdout.write('Source revision is stale.\n');
    return;
  }
  const listed = record(
    await api(`/repos/${repository}/actions/runs/${runId}/artifacts?per_page=100`),
  );
  if (!Array.isArray(listed.artifacts)) throw new Error('Invalid artifacts response.');
  const artifacts = listed.artifacts.map((item: unknown) => record(item));
  const reportArtifact = artifacts.find(
    (item) => item.name === `vision-report-${String(source.attempt)}` && item.expired === false,
  );
  const evidenceArtifact = artifacts.find(
    (item) => item.name === `vision-evidence-${String(source.attempt)}` && item.expired === false,
  );
  if (!reportArtifact || !evidenceArtifact) {
    process.stdout.write('No complete vision artifacts; nothing to publish.\n');
    return;
  }
  if (Number(reportArtifact.size_in_bytes) > 1024 * 1024)
    throw new Error('Report artifact exceeds 1 MiB.');
  if (process.argv.includes('--locate')) {
    const output = textParam(process.env.GITHUB_OUTPUT, 'GitHub output path');
    fs.appendFileSync(output, `artifact-id=${String(identifier(reportArtifact.id))}\n`);
    return;
  }
  const directory = textParam(process.env.VISION_REPORT_DIR, 'report directory');
  const parsed: unknown = JSON.parse(readContainedFile(directory, 'report.json', 256 * 1024));
  const summary = await publishSummary(
    api,
    source,
    parseReport(parsed),
    identifier(evidenceArtifact.id),
  );
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}

if (import.meta.main) await main();
