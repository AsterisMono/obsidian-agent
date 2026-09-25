---
name: land-changes
description: Orchestrate repository changes in a named Herdr worktree with separate planning and implementation agents, applicable verification, and a pull request against main. Preserve narrower planning-only or verification-only requests.
---

# Land Changes

Use distinct agents with these responsibilities:

| Role         | Launcher and model                                  | Owns                                                                                    |
| ------------ | --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Orchestrator | The agent receiving the user's Land Changes request | Codename, worktree, workspace, and planner handoff; never writes plans or code directly |
| Planner      | `codex`, `gpt-6-astra`, `xhigh` reasoning           | Written contract, applicable Lean artifacts, and implementation-agent startup           |
| Implementer  | `ocsh`, DeepSeek 4.1 Flash                          | Implementation, verification, commit, push, and PR against `main`                       |

Only the orchestrator accepts a new change request. If the user invokes Land Changes and you have no assigned planner or implementer role, act as the orchestrator. If you are already a planner or implementer, refuse to orchestrate another change and tell the user to send it through the orchestrator. Continue your existing assignment and its clarifications without changing roles or creating a nested workflow.

Planner and implementer coordinate directly with each other and the reviewer. They must not send status, completion reports, or prompts to the orchestrator. The orchestrator can inspect artifacts and agent state independently.

Respect the requested endpoint. Full delivery authorizes the applicable stages through pushing the task branch and opening a PR against `main`, without additional approval pauses. A planning-only request stops after the plan and its applicable Lean evidence; a verification-only request performs the requested verification. Pure docs or tooling changes can omit inapplicable plugin artifacts. Merging and publishing require separate authorization.

Follow the standing repository rules in [AGENTS.md](../../../AGENTS.md).

When a change affects repository guidance or user documentation, apply [Update Project Docs](../update-project-docs/SKILL.md).

## Orchestrator: create and hand off the change

1. Choose a fresh Heroku-style codename: a lowercase adjective and noun separated by a hyphen, such as `steady-falcon`. Add a lowercase hyphenated feature slug to form `<stem>`, such as `steady-falcon-formal-verification`. Check existing branches, worktrees, and plan folders for collisions. Never assign numbered plan names.
2. Apply the installed **Herdr** skill and verify `HERDR_ENV=1` before controlling the session. Inspect `herdr --help` and the relevant command groups. Create a new worktree with branch `worktree/<stem>` and a new Herdr workspace rooted in that checkout. The current `herdr worktree create` returns the workspace, tab, and root pane together; reuse those returned IDs instead of opening a duplicate workspace. Keep user focus unchanged with `--no-focus`.
3. In the returned root pane, start a fresh planner using `codex` with `gpt-6-astra` and `xhigh`. Pass the original user input verbatim, all subsequent corrections, the assigned planner role, `<stem>`, worktree path, branch, applicable skills, and authorized endpoint. Tell it to write `docs/<stem>/<stem>.md` and any applicable proof artifacts beneath that folder.

For the installed CLI, the launch sequence is:

```sh
herdr worktree create --cwd <repository> --branch worktree/<stem> --base main --label <stem> --no-focus
herdr agent start <planner-name> --kind codex --pane <returned-root-pane> -- -m gpt-6-astra -c 'model_reasoning_effort="xhigh"'
herdr agent prompt <planner-name> <handoff>
```

These are command templates: use the actual returned IDs and safely quote paths and prompt text. Do not replace the requested launcher or model if unavailable; surface the blocker in the affected agent's own session.

## Planner: write the contract and evidence

Read the repository guidance, the relevant plugin source, current plans, and existing E2E coverage. Identify the user's observable outcome, accepted inputs, failure outcomes, and important cancellation, concurrency, or recovery behavior. Resolve product ambiguities in the written contract instead of taking existing implementation behavior as the requirement. Ask for missing information only when it affects a decision; continue work that does not depend on the answer.

Write the plan at `docs/<stem>/<stem>.md`, using the orchestrator's codename and feature slug. All plans use codename folders; there is no numbered-plan exception. Record requirements and acceptance criteria precise enough for an independent test author to determine success and failure. Include scope, relevant production boundaries, assumptions, and open semantics.

Keep the plan's Lean sources and executable model cases in its adjacent `lean/` directory. Record proof scope, assumptions, model-to-implementation obligations, and check results in the plan Markdown itself. Do not add a separate README under a plan's `lean/` directory. The namespace and Lake target are `Plan` followed by the full stem in PascalCase, for example `PlanSteadyFalconFormalVerification`. Each plugin has one shared Lean project: `lean-toolchain`, Lake configuration, and the dependency manifest belong at the plugin root; shared proof tooling belongs in `lean/`. Add a library target pointing to each plan's sources. The checker discovers plan folders containing Lean sources, validates their matching Markdown and target, and checks every plan's audit and fixtures. Reuse definitions through imports when appropriate.

E2E scenarios live at `tests/e2e/<stem>.test.ts`, matching the Markdown filename. Link the behavioral contract, model evidence, and E2E scenarios so changes can be reassessed together.

### Planner-authored Lean verification

Apply [Lean Verification](../lean-verification/SKILL.md) to choose a useful computation or state transition boundary. The planner authors the actual Lean models, proofs, and executable cases during planning. Do not defer that work to the implementer.

Try counterexamples against the written requirements before proving them. State the representation mapping and assumptions about APIs, scheduling, storage, IDs, and time. Include useful success cases alongside rejection properties. Use the shared pinned toolchain, compile every claimed theorem, enforce the transitive axiom audit, and retain model provenance with generated expectations. Use [Devenv Dependencies](../devenv-dependencies/SKILL.md) when the required tools need to change.

Record the exact properties proved and the remaining model-to-implementation obligations. Unchecked models or unfinished obligations remain explicitly pending. A model proof does not establish plugin correctness. For behavior without a useful formal boundary, such as ordinary styling, record why Lean is not applicable and cover the behavior through the remaining stages instead of manufacturing a vacuous proof.

## Planner: start the implementer below

When the plan and applicable planning checks are ready, the planner opens a new pane **below itself**, in the same workspace, tab, and worktree. The right side is reserved for the automatically opened reviewer. Reuse that reviewer for independent final review; do not place the implementer on the right or open a duplicate reviewer.

Start the implementer through `ocsh`. This environment's native model ID for the requested `deepseek-4.1-flash` is `deepseek-v4.1-flash`. `ocsh` wraps Codex with its own provider configuration, so Herdr recognizes the running agent as `codex`; it does not have an `ocsh` agent kind. Launch the wrapper through the pane surface:

```sh
herdr pane split --current --direction down --cwd <worktree-path> --no-focus
herdr pane run <returned-pane> 'ocsh -m deepseek-v4.1-flash'
```

Wait for the new agent to be detected and ready for interactive input, then name it with `herdr agent rename` and submit the assignment with `herdr agent prompt`. Include the implementation role, original user input and corrections, written plan path, applicable Lean evidence, relevant skills, worktree/branch, delivery endpoint, and planner/reviewer coordination targets. Explicitly prohibit reports to the orchestrator. A detected shell or an unknown agent state is not a completed handoff. Inspect startup failures or blocked dialogs without bypassing protections.

The planner remains available to resolve contract changes and update its plan and Lean evidence. It does not take over implementation. A planning-only request ends before starting the implementer.

## Implementer: independent E2E testcase design

Follow [E2E Testing](../e2e-testing/SKILL.md) and its [QA Methodology](../qa-methodology/SKILL.md) reference. Before writing plugin code for the change, the implementing agent gives a fresh subagent with no inherited conversation the current written plan and these two skills. Include the planner's Lean evidence and model cases as supporting artifacts; the test author derives expected behavior independently from the written contract and checks the model oracle against it.

The subagent writes actual Playwright/Obsidian E2E test code, with exactly one top-level `test()` in the file named for the plan. Reuse the existing disposable-vault harness and deterministic service fixtures. Cover intended success, meaningful rejection or failure, and the event boundaries identified by the plan. Wait for the test code before implementing the change. Resolve ambiguous expected outcomes in the plan before encoding them in tests.

## Implementer: implement the change

Apply [Obsidian Plugin Development](../obsidian-plugin-development/SKILL.md). Implement the written contract through the real plugin, preserve the modeled boundaries, and connect the production decisions and effects to the planner's definitions. Follow repository conventions for TypeScript scripts, package ownership, lifecycle cleanup, vault operations, and bundling. Use the dependency skill when tools or libraries must change.

When a counterexample, API contract, or product decision changes the requirements, the planner updates the plan and Lean artifacts and the independent test author updates the E2E expectations before dependent implementation work proceeds. Fix implementation mismatches or expose the unresolved obligation; do not weaken a requirement merely to obtain passing proofs or tests.

## Implementer and reviewer: verification

Use the E2E and QA skills to run the new scenarios and relevant existing regression coverage through the packaged plugin in a separate test vault. Include the failure, cancellation, reload, and delayed-completion cases required by the plan. Keep deterministic fixtures, filesystem isolation, and failure diagnostics intact. Recheck Lean and fixture freshness when their inputs change, and run the repository's formatting, lint, type, and bundle checks.

Use the independent reviewer on the right for the final contract-to-evidence review. Review findings go directly to the planner or implementer responsible for fixing them. Record the revision, commands actually run, results, skipped checks, and remaining mismatches. Complete change delivery only when the applicable acceptance criteria, required tests, and review pass; an unavailable reviewer or skipped required check remains pending. A planning-only handoff identifies which implementation stages remain outstanding. State model proofs, sampled implementation agreement, and external assumptions separately.

## Implementer: commit and open the PR

When every verification and test required for the authorized task has passed, the implementer commits in the task worktree. Review the diff and working-tree status, stage only task changes, and use the repository's kernel-style `scope: msg` commit message with no body. Push `worktree/<stem>` and open a PR with base `main`. Include the concrete change, validation results, and any remaining external assumptions in the PR description. This is part of full delivery; do not ask for another confirmation to commit or open the PR.

If a required check or commit hook fails, fix the issue, rerun the affected checks, and retry without bypassing hooks. An unavailable or skipped required check is not a passing result; keep the dependent delivery stage pending. If push or PR creation fails, preserve the verified commit and surface the blocker in the implementation session. Record the commit hash, PR URL, and checks that passed there, without sending a completion report to the orchestrator. Do not merge the PR or publish a release.
