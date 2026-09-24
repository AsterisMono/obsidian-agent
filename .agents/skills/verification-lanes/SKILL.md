---
name: verification-lanes
description: Define this repository's three verification lanes — Checks, Tests, and the Visual Test — and place new coverage in the right one. Use when adding, renaming, or reorganizing CI checks, test scripts, or the advisory vision run, or when classifying verification evidence for a change.
---

# Verification Lanes

Everything that verifies a change belongs to one of three named lanes. Use these names in scripts, workflow jobs, plans, and status reports so evidence stays comparable between changes and nobody mistakes one lane for another.

## Checks

Static gates. `pnpm check` runs all of them, and the CI job is `Checks`. They run first: when a check fails, Tests and the Visual Test do not start.

| Check      | Command                     | Covers                                                     |
| ---------- | --------------------------- | ---------------------------------------------------------- |
| Prettier   | `pnpm run check:format`     | formatting of every tracked file                           |
| ESLint     | `pnpm run check:lint`       | type-aware lint rules for TypeScript sources               |
| TypeScript | `pnpm run check:types`      | `tsc --noEmit` for the plugin and the computer-use project |
| ActionLint | `pnpm run check:actionlint` | workflow syntax and semantics                              |
| Lean       | `pnpm run check:lean`       | proofs, axiom audit, and model-case freshness              |

Add a new static gate as `check:<tool>`, include it in the `check` script, and keep it out of the test scripts. A check reports a pass or failure for the revision; it does not exercise the plugin in Obsidian.

## Tests

Deterministic suites that need no provider credentials. The CI job is `Tests`.

- **Tooling** — `pnpm test:tooling` runs `tests/tooling/*.test.ts`: vision budget, reporting, and publishing logic against local data, plus the coordinate tools and a scripted agent against the real disposable Obsidian harness.
- **E2E** — `pnpm test:e2e` runs `tests/e2e/*.test.ts`: Playwright scenarios that drive the packaged plugin in a disposable vault.

`pnpm test` runs Tooling and then E2E. Choose the lane by what is under test rather than by the harness it needs: `tests/e2e/` covers plugin behavior through the packaged plugin, while `tests/tooling/` covers scripts and the vision runner, even when it drives the disposable Obsidian harness. [E2E Testing](../e2e-testing/SKILL.md) owns scenario design, and [Land Changes](../land-changes/SKILL.md) owns when the suites are written.

## Visual Test

The agent-driven visual run: `pnpm vision` (`scripts/vision-run.ts`) drives the packaged plugin through the disposable Obsidian harness, judges screenshots, and writes `report.json`, `transcript.jsonl`, retained images, and saved vault data to `VISION_OUT_DIR`. The CI job is `Visual Test`; it needs Checks and Tests and runs only for main and same-repository pull requests.

The Visual Test is advisory rather than a gate. Verdicts are `observed-pass`, `candidate-defect`, or `inconclusive`; a candidate defect is evidence for a human, not a failing build, and the vision step is allowed to fail without failing its job. Budgets, model and thinking level, and artifact retention live in the workflow and in `scripts/vision-budget.ts`, so tune them there instead of introducing per-change limits.
