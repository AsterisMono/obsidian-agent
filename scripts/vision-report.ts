import fs from 'node:fs';
import path from 'node:path';

export const statuses = ['observed-pass', 'candidate-defect', 'inconclusive'] as const;
export type VisionStatus = (typeof statuses)[number];
export type Finding = {
  title: string;
  summary: string;
  severity: string;
  expectationSource: string;
  expected: string;
  actual: string;
  steps: string[];
  screenshots: string[];
  reproduced: boolean;
};
export type Screenshot = { id: string; file: string; width: number; height: number };
export type Verdict = {
  status: VisionStatus;
  reason: string;
  coverage: string[];
  screenshots: string[];
};
export type VisionReport = Verdict & {
  schemaVersion: 1;
  repository: string;
  sha: string;
  headSha: string;
  runId: string;
  runAttempt: string;
  provider: string;
  model: string;
  requestedThinking: string;
  effectiveThinking: string;
  steps: number;
  requests: number;
  tokens: number;
  estimatedCostUsd: number;
  findings: Finding[];
  images: Screenshot[];
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function textParam(value: unknown, name: string, maximum = 2000): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum)
    throw new Error(`${name} must contain 1 to ${String(maximum)} characters.`);
  return value;
}

export function strings(value: unknown, name: string, maximum = 20): string[] {
  if (!Array.isArray(value) || value.length > maximum)
    throw new Error(`${name} must be an array of at most ${String(maximum)} strings.`);
  return value.map((item: unknown) => textParam(item, name));
}

export function positiveSetting(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  ceiling: number,
): number {
  const value = Number(env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0 || value > ceiling)
    throw new Error(`${name} must be positive and at most ${String(ceiling)}.`);
  return value;
}

export function readContainedFile(root: string, relative: string, maximum: number): string {
  const parts = relative.split(/[\\/]/);
  if (path.isAbsolute(relative) || parts.some((part) => !part || part === '.' || part === '..'))
    throw new Error('File paths must be relative and cannot traverse directories.');
  const canonicalRoot = fs.realpathSync(root);
  let file = canonicalRoot;
  for (const part of parts) {
    file = path.join(file, part);
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Symbolic links are not permitted.');
  }
  const fd = fs.openSync(
    file,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  );
  try {
    const resolved = fs.realpathSync(`/proc/self/fd/${String(fd)}`);
    if (!resolved.startsWith(`${canonicalRoot}${path.sep}`))
      throw new Error('File is outside the permitted directory.');
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > maximum)
      throw new Error(`Expected a regular file no larger than ${String(maximum)} bytes.`);
    const buffer = Buffer.alloc(maximum + 1);
    const length = fs.readSync(fd, buffer, 0, buffer.length, 0);
    if (length > maximum) throw new Error('File grew beyond the byte limit.');
    return buffer.subarray(0, length).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

export function readVaultFile(vault: string, relative: string): string {
  const note =
    relative.endsWith('.md') && !relative.split('/').some((part) => part.startsWith('.'));
  if (!note && relative !== '.obsidian/plugins/agent/data.json')
    throw new Error('Only Markdown notes and .obsidian/plugins/agent/data.json may be read.');
  return readContainedFile(vault, relative, 64 * 1024);
}

export function findingFrom(value: unknown, imageIds: Set<string>): Finding {
  if (!isRecord(value)) throw new Error('Invalid finding.');
  const shots = strings(value.screenshots, 'screenshots', 4);
  if (shots.length === 0 || shots.some((shot) => !imageIds.has(shot)))
    throw new Error('A finding requires registered screenshot IDs.');
  const severity = textParam(value.severity, 'severity');
  if (!['critical', 'high', 'medium', 'low'].includes(severity))
    throw new Error('Invalid severity.');
  if (typeof value.reproduced !== 'boolean') throw new Error('reproduced must be a boolean.');
  const steps = strings(value.steps, 'steps', 12);
  if (steps.length === 0) throw new Error('Reproduction steps are required.');
  return {
    title: textParam(value.title, 'title', 160),
    summary: textParam(value.summary, 'summary'),
    severity,
    expectationSource: textParam(value.expectationSource, 'expectationSource'),
    expected: textParam(value.expected, 'expected'),
    actual: textParam(value.actual, 'actual'),
    steps,
    screenshots: shots,
    reproduced: value.reproduced,
  };
}

export function verdictFrom(value: unknown, findings: Finding[], imageIds: Set<string>): Verdict {
  if (!isRecord(value)) throw new Error('Invalid verdict.');
  const status = statuses.find((entry) => entry === value.status);
  if (!status) throw new Error('Invalid vision status.');
  const coverage = strings(value.coverage, 'coverage');
  const shots = strings(value.screenshots, 'screenshots', 8);
  if (shots.some((shot) => !imageIds.has(shot))) throw new Error('Unknown screenshot ID.');
  if (status !== 'inconclusive' && (coverage.length === 0 || shots.length === 0))
    throw new Error('A completed observation requires coverage and screenshots.');
  if (status === 'observed-pass' && findings.length > 0)
    throw new Error('A run with candidate findings cannot claim observed-pass.');
  if (status === 'candidate-defect' && findings.length === 0)
    throw new Error('candidate-defect requires at least one recorded finding.');
  return { status, reason: textParam(value.reason, 'reason'), coverage, screenshots: shots };
}

export function parseReport(value: unknown): VisionReport {
  if (!isRecord(value) || value.schemaVersion !== 1) throw new Error('Unsupported report schema.');
  if (!Array.isArray(value.images) || value.images.length > 250) throw new Error('Invalid images.');
  const images = value.images.map((item: unknown): Screenshot => {
    if (!isRecord(item)) throw new Error('Invalid image.');
    const id = textParam(item.id, 'image ID', 32);
    const file = textParam(item.file, 'image file', 64);
    if (!/^shot-\d+$/.test(id) || file !== `${id}.png`) throw new Error('Invalid screenshot name.');
    for (const dimension of [item.width, item.height])
      if (
        typeof dimension !== 'number' ||
        !Number.isInteger(dimension) ||
        dimension < 1 ||
        dimension > 10000
      )
        throw new Error('Invalid screenshot dimensions.');
    return { id, file, width: Number(item.width), height: Number(item.height) };
  });
  const imageIds = new Set(images.map((image) => image.id));
  if (imageIds.size !== images.length) throw new Error('Duplicate screenshot IDs.');
  if (!Array.isArray(value.findings) || value.findings.length > 5)
    throw new Error('Invalid findings.');
  const findings = value.findings.map((item: unknown) => findingFrom(item, imageIds));
  const count = (name: string) => {
    const number = value[name];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < 0)
      throw new Error(`Invalid ${name}.`);
    return number;
  };
  return {
    ...verdictFrom(value, findings, imageIds),
    schemaVersion: 1,
    repository: textParam(value.repository, 'repository', 200),
    sha: textParam(value.sha, 'sha', 64),
    headSha: textParam(value.headSha, 'headSha', 64),
    runId: textParam(value.runId, 'runId', 32),
    runAttempt: textParam(value.runAttempt, 'runAttempt', 16),
    provider: textParam(value.provider, 'provider', 80),
    model: textParam(value.model, 'model', 100),
    requestedThinking: textParam(value.requestedThinking, 'requestedThinking', 20),
    effectiveThinking: textParam(value.effectiveThinking, 'effectiveThinking', 20),
    steps: count('steps'),
    requests: count('requests'),
    tokens: count('tokens'),
    estimatedCostUsd: count('estimatedCostUsd'),
    findings,
    images,
  };
}
