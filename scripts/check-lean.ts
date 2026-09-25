import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const plugin = fileURLToPath(new URL('../', import.meta.url));
const writeFixtures = process.argv.includes('--write-fixtures');
const pin = readFileSync(path.join(plugin, 'lean-toolchain'), 'utf8').trim();
const pinnedVersion = /^leanprover\/lean4:v(\d+\.\d+\.\d+)$/.exec(pin)?.[1];
if (!pinnedVersion) throw new Error(`Unsupported Lean toolchain pin: ${pin}`);

function run(command: string, args: string[], input?: string): string {
  const result = spawnSync(command, args, {
    cwd: plugin,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    input,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed. Use the repository's devenv shell.\n${result.error?.message ?? ''}${result.stdout}${result.stderr}`,
    );
  }
  return result.stdout;
}

function leanSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === '.lake' ? [] : leanSources(fullPath);
    return entry.name.endsWith('.lean') ? [fullPath] : [];
  });
}

type GeneratedCase = {
  id: string;
  contract: string;
  input: unknown;
  expected: unknown;
};

type ModelOutput = {
  schemaVersion: number;
  cases: GeneratedCase[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isModelOutput(value: unknown): value is ModelOutput {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    Array.isArray(value.cases) &&
    value.cases.every(
      (item: unknown) =>
        isRecord(item) &&
        typeof item.id === 'string' &&
        typeof item.contract === 'string' &&
        'input' in item &&
        'expected' in item,
    )
  );
}

const version = run('lake', ['env', 'lean', '--version']).trim();
if (!version.includes(`version ${pinnedVersion},`)) {
  throw new Error(`Lean executable does not match ${pin}: ${version}`);
}
console.log(version);
console.log(run('lake', ['--version']).trim());

const plans = readdirSync(path.join(plugin, 'docs'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const directory = path.join(plugin, 'docs', entry.name, 'lean');
    const target = `Plan${entry.name
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join('')}`;
    return { stem: entry.name, directory, target };
  })
  .filter((plan) => existsSync(plan.directory) && leanSources(plan.directory).length > 0)
  .sort((left, right) => left.stem.localeCompare(right.stem));

if (plans.length === 0) throw new Error('No plan proof sources were found.');

for (const plan of plans) {
  if (!/^[a-z]+-[a-z]+(?:-[a-z0-9]+)+$/.test(plan.stem)) {
    throw new Error(`Expected a codename and feature slug for plan: ${plan.stem}`);
  }
  const markdown = path.join(plugin, 'docs', plan.stem, `${plan.stem}.md`);
  if (!existsSync(markdown)) throw new Error(`Missing written plan: ${markdown}`);
  if (plans.some((other) => other.stem !== plan.stem && other.target === plan.target)) {
    throw new Error(`Duplicate plan library target: ${plan.target}`);
  }
  const rootModule = path.join(plan.directory, `${plan.target}.lean`);
  if (!existsSync(rootModule)) throw new Error(`Missing plan library root: ${rootModule}`);
  const auditPath = path.join(plan.directory, plan.target, 'Audit.lean');
  const audit = readFileSync(auditPath, 'utf8');
  const claims = /audit_theorems\s*\[([\s\S]*?)\]/
    .exec(audit)?.[1]
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  if (!claims?.length) throw new Error(`Missing explicit theorem audit: ${auditPath}`);
  const declarations = leanSources(plan.directory).flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    if (/\b(?:sorry|admit|native_decide)\b|^\s*axiom\s/m.test(source)) {
      throw new Error(`Incomplete or unapproved proof construct in ${file}`);
    }
    const namespace = /^namespace (\S+)$/m.exec(source)?.[1];
    return [...source.matchAll(/^(?:@\[[^\]]*\]\s+)?theorem (\w+)/gm)].map((match) => {
      if (!namespace) throw new Error(`Expected a named plan namespace in ${file}`);
      return `${namespace}.${match[1]}`;
    });
  });
  if (
    new Set(claims).size !== claims.length ||
    JSON.stringify([...claims].sort()) !== JSON.stringify([...declarations].sort())
  ) {
    throw new Error(`The declared theorems and explicit audit differ for ${plan.stem}`);
  }
}

const manifestPath = path.join(plugin, 'lake-manifest.json');
const manifestBefore = readFileSync(manifestPath, 'utf8');
const build = run('lake', ['--wfail', 'build', ...plans.map((plan) => plan.target)]);
if (readFileSync(manifestPath, 'utf8') !== manifestBefore) {
  throw new Error(
    'Proof checking changed lake-manifest.json; review dependency updates explicitly.',
  );
}
console.log(build.trim().split('\n').at(-1));

for (const plan of plans) {
  const audit = run('lake', [
    'env',
    'lean',
    '-DwarningAsError=true',
    path.relative(plugin, path.join(plan.directory, plan.target, 'Audit.lean')),
  ]);
  const auditSummary = audit.split('\n').find((line) => line.includes('Axiom audit passed'));
  if (!auditSummary) throw new Error(`The axiom audit did not run for ${plan.stem}`);
  console.log(`${plan.stem}: ${auditSummary}`);

  const model: unknown = JSON.parse(
    run('lake', [
      'env',
      'lean',
      '-DwarningAsError=true',
      '--run',
      path.relative(plugin, path.join(plan.directory, 'Main.lean')),
    ]),
  );
  if (!isModelOutput(model)) throw new Error(`Invalid model output for ${plan.stem}`);
  const sources = [
    ...plans.flatMap((item) => leanSources(item.directory)),
    ...leanSources(path.join(plugin, 'lean')),
    path.join(plugin, 'lean-toolchain'),
    path.join(plugin, 'lakefile.toml'),
    manifestPath,
    fileURLToPath(import.meta.url),
  ].sort();
  const hash = createHash('sha256');
  for (const source of sources) {
    hash.update(path.relative(plugin, source));
    hash.update('\0');
    hash.update(readFileSync(source));
    hash.update('\0');
  }
  const output = {
    plan: plan.stem,
    toolchain: pin,
    modelSourceSha256: hash.digest('hex'),
    ...model,
  };
  const expected = run('pnpm', ['exec', 'prettier', '--parser', 'json'], JSON.stringify(output));
  const fixturePath = path.join(plan.directory, 'fixtures.json');
  if (writeFixtures) {
    writeFileSync(fixturePath, expected);
    console.log(`${plan.stem}: wrote ${String(model.cases.length)} model cases.`);
  } else if (!existsSync(fixturePath) || readFileSync(fixturePath, 'utf8') !== expected) {
    throw new Error(`Stale model fixtures for ${plan.stem}; run pnpm run fixtures:lean.`);
  } else {
    console.log(`${plan.stem}: ${String(model.cases.length)} model cases and provenance match.`);
  }
}
