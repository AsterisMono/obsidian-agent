---
name: land-changes
description: Land repository changes, including features, bugfixes, and refactors that change plugin behavior, through planning, planner-authored Lean verification, independent E2E test design, implementation, E2E regression, and a verified commit. Preserve the requested stage for planning-only or verification-only tasks; pure docs and tooling without plugin behavior changes can omit inapplicable plugin artifacts.
---

# Land Changes

Follow this sequence for every change that lands in this repository, including features, bugfixes, and refactors that change plugin behavior:

**Plan → Lean verification → independent E2E testcase design → implementation → E2E regression → commit.**

Respect the user's requested scope. A request to land a change authorizes progressing through the applicable stages; do not add approval pauses between them. A planning request produces the plan and its Lean artifacts, while implementation and desktop regression remain subsequent work. Pure documentation or tooling changes with no plugin behavior change do not require inventing a plugin feature or desktop scenario.

## 1. Understand the proposed change

Read the repository guidance, the relevant plugin source, current plans, and existing E2E coverage. Identify the user's observable outcome, accepted inputs, failure outcomes, and important cancellation, concurrency, or recovery behavior. Resolve product ambiguities in the written contract instead of taking existing implementation behavior as the requirement. Ask for missing information only when it affects a decision; continue work that does not depend on the answer.

## 2. Write the change plan

For plugin changes, starting with `0002`, create each plan at `docs/<plan-stem>/<plan-stem>.md`. Use the next available numbered stem. Existing `0001` plans may retain their layout. Record requirements and acceptance criteria precise enough for an independent test author to determine success and failure. Include scope, relevant production boundaries, assumptions, and open semantics.

Keep the plan's Lean sources and executable model cases in its adjacent `lean/` directory. Record proof scope, assumptions, model-to-implementation obligations, and check results in the plan Markdown itself. Do not add a separate README under a plan's `lean/` directory; maintain the narrative evidence in one place. Use a distinct module namespace such as `Plan0002`. Each plugin has one shared Lean project: `lean-toolchain`, Lake configuration, and the dependency manifest belong at the plugin root; shared proof tooling belongs in the plugin's `lean/` directory. Add a library target pointing to each plan's sources and keep all plan targets in the plugin's checks. Reuse definitions through imports when appropriate.

E2E scenarios remain at `tests/e2e/<plan-stem>.test.ts`, derived from the Markdown filename. Link the behavioral contract, model evidence, and E2E scenarios so changes can be reassessed together.

## 3. Planner writes and checks the Lean verification

Apply [Lean Verification](../lean-verification/SKILL.md) to choose a useful computation or state transition boundary. The planner authors the actual Lean models, proofs, and executable cases during planning. Do not defer that work to the implementer.

Try counterexamples against the written requirements before proving them. State the representation mapping and assumptions about APIs, scheduling, storage, IDs, and time. Include useful success cases alongside rejection properties. Use the shared pinned toolchain, compile every claimed theorem, enforce the transitive axiom audit, and retain model provenance with generated expectations. Use [Devenv Dependencies](../devenv-dependencies/SKILL.md) when the required tools need to change.

Record the exact properties proved and the remaining model-to-implementation obligations. Unchecked models or unfinished obligations remain explicitly pending. A model proof does not establish plugin correctness. For behavior without a useful formal boundary, such as ordinary styling, record why Lean is not applicable and cover the behavior through the remaining stages instead of manufacturing a vacuous proof.

## 4. Independent E2E testcase design and authoring

Follow [E2E Testing](../e2e-testing/SKILL.md) and its [QA Methodology](../qa-methodology/SKILL.md) reference. Before writing plugin code for the change, the implementing agent gives a fresh subagent with no inherited conversation the current written plan and these two skills. Include the planner's Lean evidence and model cases as supporting artifacts; the test author derives expected behavior independently from the written contract and checks the model oracle against it.

The subagent writes actual Playwright/Obsidian E2E test code, with exactly one top-level `test()` in the file named for the plan. Reuse the existing disposable-vault harness and deterministic service fixtures. Cover intended success, meaningful rejection or failure, and the event boundaries identified by the plan. Wait for the test code before implementing the change. Resolve ambiguous expected outcomes in the plan before encoding them in tests.

## 5. Implement the change

Apply [Obsidian Plugin Development](../obsidian-plugin-development/SKILL.md). Implement the written contract through the real plugin, preserve the modeled boundaries, and connect the production decisions and effects to the planner's definitions. Follow repository conventions for TypeScript scripts, package ownership, lifecycle cleanup, vault operations, and bundling. Use the dependency skill when tools or libraries must change.

When a counterexample, API contract, or product decision changes the requirements, the planner updates the plan and Lean artifacts and the independent test author updates the E2E expectations before dependent implementation work proceeds. Fix implementation mismatches or expose the unresolved obligation; do not weaken a requirement merely to obtain passing proofs or tests.

## 6. E2E regression and completion

Use the E2E and QA skills to run the new scenarios and relevant existing regression coverage through the packaged plugin in a separate test vault. Include the failure, cancellation, reload, and delayed-completion cases required by the plan. Keep deterministic fixtures, filesystem isolation, and failure diagnostics intact. Recheck Lean and fixture freshness when their inputs change, and run the repository's formatting, lint, type, and bundle checks.

Use an independent verifier for the final contract-to-evidence review. Record the revision, commands actually run, results, skipped checks, and remaining mismatches. Complete change delivery only when the applicable acceptance criteria and regression checks pass; a planning-only handoff instead identifies which implementation stages remain outstanding. State model proofs, sampled implementation agreement, and external assumptions separately.

## 7. Commit

When every verification and test required for the authorized task has passed, commit the task's changes as the final local delivery step. Do not ask for another confirmation to make this commit. Review the diff and working-tree status, stage only changes belonging to the task, and use the repository's kernel-style `scope: msg` commit message with no body.

If a required check or commit hook fails, fix the issue, rerun the affected checks, and retry without bypassing hooks. An unavailable or skipped required check is not a passing result; keep the commit pending and report the missing evidence. Report the resulting commit hash and the checks that passed. Pushing, merging, publishing, or sending results elsewhere requires separate authorization.
