---
name: land-changes
description: Orchestrate repository changes from the primary checkout into named Herdr worktrees with separate planning and implementation agents, applicable verification, and a pull request against main. Preserve narrower planning-only or verification-only requests.
---

# Land Changes

Use distinct agents with these responsibilities:

| Role         | Launcher and model                                      | Owns                                                                                                     |
| ------------ | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Orchestrator | The agent receiving the user's Land Changes request     | Codename, worktree, workspace, and planner handoff; never writes plans or code directly                  |
| Planner      | `codex`, `gpt-6-astra`, `xhigh` reasoning               | Design handoff, applicable Lean artifacts, implementer startup, ongoing design advice, and design review |
| Implementer  | `ocsh`, DeepSeek 4.1 Flash                              | Implementation sequence, production code, verification, commit, push, and PR against `main`              |
| Reviewer     | Fresh subagent of the implementer, without a Herdr pane | Independent final review of the contract, changes, and verification evidence                             |

Only the orchestrator accepts a new change request. It runs in the repository's primary checkout; planners, implementers, and their subagents run in the assigned linked worktree. Determine the checkout type from Git, not the directory name or checked-out branch:

```sh
git rev-parse --is-inside-work-tree
git rev-parse --path-format=absolute --git-dir --git-common-dir
```

Require the first command to return `true`. In this repository, matching Git-directory and common-directory paths identify the primary checkout; different paths identify a linked worktree. An unassigned agent in the primary checkout becomes the orchestrator when accepting a Land Changes request. An agent in a linked worktree uses its handoff's role; the path alone does not distinguish planner, implementer, or reviewer. Do not orchestrate a new change from a linked worktree; direct that request to the orchestrator in the primary checkout.

An existing planner or implementer must refuse to orchestrate another change, even if its current directory is wrong. Preserve assigned roles, resolve a checkout mismatch, and continue the existing assignment and its clarifications without promoting yourself or creating a nested workflow. A directory outside a Git checkout does not establish an orchestrator role.

As soon as you take the orchestrator role, apply the installed Herdr skill, verify `HERDR_ENV=1`, and set your own agent display to `Orchestrator`:

```sh
herdr pane report-metadata "$HERDR_PANE_ID" --source land-changes --agent codex --display-agent Orchestrator
```

Keep this role label rather than a planning or implementation stage, and reapply it when accepting another change. Preserve your stable coordination name and Herdr's detected lifecycle state.

Planner and implementer coordinate directly with each other and the reviewer. They must not send status, completion reports, or prompts to the orchestrator. Publish progress through Herdr's sidebar metadata instead, as described below. The orchestrator can inspect artifacts and agent state independently.

Respect the requested endpoint. Full delivery authorizes the applicable stages through pushing the task branch and opening a PR against `main`, without additional approval pauses. A planning-only request stops after the plan and its applicable Lean evidence; a verification-only request performs the requested verification. Pure docs or tooling changes can omit inapplicable plugin artifacts. Merging and publishing require separate authorization.

Follow the standing repository rules in [AGENTS.md](../../../AGENTS.md).

When a change affects repository guidance or user documentation, apply [Update Project Docs](../update-project-docs/SKILL.md).

## Orchestrator: create and hand off the change

1. Choose a fresh Heroku-style codename: a lowercase adjective and noun separated by a hyphen, such as `steady-falcon`. Add a lowercase hyphenated feature slug to form `<stem>`, such as `steady-falcon-formal-verification`. Check existing branches, worktrees, and plan folders for collisions. Never assign numbered plan names.
2. Apply the installed **Herdr** skill and verify `HERDR_ENV=1` before controlling the session. Inspect `herdr --help` and the relevant command groups. Create a new worktree with branch `worktree/<stem>` and a new Herdr workspace rooted in that checkout. Give the workspace a short descriptive title, such as `feat: Chat Composer` or `fix: Draft Recovery`, rather than the slug. The current `herdr worktree create` returns the workspace, tab, and root pane together; reuse those returned IDs instead of opening a duplicate workspace. Keep user focus unchanged with `--no-focus`.
3. In the returned root pane, start a fresh planner using `codex` with `gpt-6-astra` and `xhigh`. Pass the original user input verbatim, all subsequent corrections, the assigned planner role, `<stem>`, descriptive title, worktree path, branch, applicable skills, and authorized endpoint. Tell it to write the design handoff below at `docs/<stem>/<stem>.md`, with supporting design and proof artifacts beneath that folder. Give agents stable unique coordination names such as `amber-lark-plan` and `amber-lark-impl`; progress updates change their display metadata, not these names.

For the installed CLI, the launch sequence is:

```sh
herdr worktree create --cwd <repository> --branch worktree/<stem> --base main --label '<change-title>' --no-focus
herdr agent start <planner-name> --kind codex --pane <returned-root-pane> -- -m gpt-6-astra -c 'model_reasoning_effort="xhigh"'
herdr agent prompt <planner-name> <handoff>
```

These are command templates: use the actual returned IDs and safely quote paths and prompt text. Do not replace the requested launcher or model if unavailable; surface the blocker in the affected agent's own session.

## Planner and implementer: visible progress

Herdr's default agent sidebar puts the workspace label on the first line and the agent display name on the second. Use `workspace rename` for the descriptive change title and `pane report-metadata --display-agent` for the role and current activity. `--title` and `pane rename` do not control these two default rows. Keep the branch, plan stem, and agent coordination names unchanged.

```sh
herdr workspace rename <workspace-id> 'feat: Chat Composer'
herdr pane report-metadata "$HERDR_PANE_ID" --source land-changes --agent codex --display-agent 'Plan: Writing Plan'
```

Each agent updates its own pane on startup, whenever its stage changes, and about once per minute during ongoing work or waits. Refresh at the next tool boundary if a running call prevents an update. Omit `--ttl-ms` for role and activity labels so idle periods and long tool or subagent waits do not reset the display to the coordination name. The text shows the last reported stage; Herdr's separate lifecycle indicator shows detected activity. Publish the final state before yielding; an idle agent need not keep running solely to refresh a label.

Use short, truthful stages: `Plan: Reading Code`, `Plan: Writing Plan`, `Plan: Prototyping`, `Plan: Ready`, `Plan: Reviewing Design`, `Impl: Writing Tests`, `Impl: Implementing`, `Impl: Running Tests`, `Impl: Reviewing`, or `Impl: PR #42`. If blocked, identify the cause briefly, such as `Impl: Blocked on Auth`. Waiting on a test-author subagent can remain `Impl: Writing Tests`. `ocsh` is detected as `codex`, so both roles use `--agent codex` in the metadata command.

Use the same `--source land-changes` for subsequent updates and verify the resolved `display_agent` with `herdr agent get <stable-agent-name>`. This only changes the display; leave Herdr's detected working/idle/blocked state and indicator intact. Do not use `agent rename` or `pane report-agent` to publish progress, and do not send heartbeat prompts to the orchestrator. If the user has customized sidebar rows, inspect that configuration before promising the same placement; do not rewrite their global layout to make the labels appear.

## Planner: design the change and write the handoff

Read the repository guidance, the relevant plugin source, current plans, and existing E2E coverage. Identify the user's observable outcome, accepted inputs, failure outcomes, and important cancellation, concurrency, or recovery behavior. Resolve product ambiguities in the written contract instead of taking existing implementation behavior as the requirement. Ask for missing information only when it affects a decision; continue work that does not depend on the answer.

Write the plan at `docs/<stem>/<stem>.md`, using the orchestrator's codename and feature slug. All plans use codename folders; there is no numbered-plan exception. The planner owns product behavior, visual design, and architecture throughout the change. Provide a design handoff with enough detail for the implementer to build it and an independent test author to determine success and failure:

- **Chosen design:** State the outcome, scope, selected approach, consequential tradeoffs, and assumptions. Resolve significant design decisions and distinguish required behavior from choices left to the implementer.
- **Behavior contract:** Define observable acceptance criteria, user flows, and relevant states and transitions, including loading, empty, disabled, error, cancellation, and recovery behavior where applicable. Use a state table when it makes the outcomes easier to check.
- **Technical blueprint:** Identify components, state ownership, data flow, interfaces, affected files, API boundaries, and lifecycle constraints. Use interface sketches, diagrams, or pseudocode for complex logic when they reduce ambiguity.
- **Visual reference for UI changes:** Specify layout, hierarchy, product copy, controls, interactions, keyboard and focus behavior, responsive behavior, and relevant design tokens. For a substantial UI change, provide a rendered prototype or annotated mockup covering representative states and narrow and wide layouts, with dimensions and theme context recorded. Resolve consequential visual choices before handoff.
- **Worked examples:** Provide representative inputs, expected outputs, failure cases, and invariants that make the contract concrete. These support the independent test author, who still derives expectations from the contract and checks any supplied oracle.

Scale the artifacts to the change. A small fix may need only a concise contract, examples, and an affected-code map. Create supporting files only when they clarify the design; link them from the plan. The planner may write runnable prototypes under `docs/<stem>/` and should render or exercise them before treating them as a reference. Keep prototypes outside production code and bundles, use the pinned tools, and include any TypeScript prototype code or scripts in the repository's applicable type and lint checks. Prototype screenshots establish design intent; verification must still exercise the implemented plugin.

Before starting the implementer, check that it can proceed without inventing significant product behavior, visual design, or architecture. Record remaining implementation discretion explicitly; resolve open semantics that affect the outcome before dependent work starts. The implementer owns the implementation sequence, task breakdown, and execution order. The planner supplies design constraints and dependencies without prescribing that sequence.

Keep the plan's Lean sources and executable model cases in its adjacent `lean/` directory. Record proof scope, assumptions, model-to-implementation obligations, and check results in the plan Markdown itself. Do not add a separate README under a plan's `lean/` directory. The namespace and Lake target are `Plan` followed by the full stem in PascalCase, for example `PlanSteadyFalconFormalVerification`. Each plugin has one shared Lean project: `lean-toolchain`, Lake configuration, and the dependency manifest belong at the plugin root; shared proof tooling belongs in `lean/`. Add a library target pointing to each plan's sources. The checker discovers plan folders containing Lean sources, validates their matching Markdown and target, and checks every plan's audit and fixtures. Reuse definitions through imports when appropriate.

E2E scenarios live at `tests/e2e/<stem>.test.ts`, matching the Markdown filename. Link the behavioral contract, model evidence, and E2E scenarios so changes can be reassessed together.

### Planner-authored Lean verification

Apply [Lean Verification](../lean-verification/SKILL.md) to choose a useful computation or state transition boundary. The planner authors the actual Lean models, proofs, and executable cases during planning. Do not defer that work to the implementer.

Try counterexamples against the written requirements before proving them. State the representation mapping and assumptions about APIs, scheduling, storage, IDs, and time. Include useful success cases alongside rejection properties. Use the shared pinned toolchain, compile every claimed theorem, enforce the transitive axiom audit, and retain model provenance with generated expectations. Use [Devenv Dependencies](../devenv-dependencies/SKILL.md) when the required tools need to change.

Record the exact properties proved and the remaining model-to-implementation obligations. Unchecked models or unfinished obligations remain explicitly pending. A model proof does not establish plugin correctness. For behavior without a useful formal boundary, such as ordinary styling, record why Lean is not applicable and cover the behavior through the remaining stages instead of manufacturing a vacuous proof.

## Planner: start the implementer below

When the design handoff and applicable planning checks are ready, the planner opens a new pane **below itself**, in the same workspace, tab, and worktree. An automatically opened `reviewr` pane on the right is Herdr's diff viewer, not a reviewer agent. Leave that viewer in place. The independent reviewer is a fresh subagent without a separate pane; do not launch a reviewer through Herdr or replace the diff viewer with one.

Start the implementer through `ocsh`. This environment's native model ID for the requested `deepseek-4.1-flash` is `deepseek-v4.1-flash`. `ocsh` wraps Codex with its own provider configuration, so Herdr recognizes the running agent as `codex`; it does not have an `ocsh` agent kind. Launch the wrapper through the pane surface:

```sh
herdr pane split --current --direction down --cwd <worktree-path> --no-focus
herdr pane run <returned-pane> 'ocsh -m deepseek-v4.1-flash'
```

Wait for the new agent to be detected and ready for interactive input, then assign its stable name with `herdr agent rename` and submit the assignment with `herdr agent prompt`. Include the implementation role, original user input and corrections, written plan and design artifact paths, applicable Lean evidence, relevant skills, worktree/branch, descriptive title, delivery endpoint, and planner coordination target. Assign implementation sequencing to the implementer and require it to return implementation evidence directly to the planner for design review. Require the periodic sidebar updates above and a fresh reviewer subagent; explicitly prohibit reports to the orchestrator. A detected shell or an unknown agent state is not a completed handoff. Inspect startup failures or blocked dialogs without bypassing protections.

The planner remains available to resolve design and contract questions, update its design artifacts and Lean evidence, and review the implemented result. Production implementation remains with the implementer. A planning-only request ends before starting the implementer.

## Implementer: choose the implementation sequence

Read the design handoff and inspect the affected code. Choose and record the implementation steps, dependencies, completion criteria, and verification points in the plan's implementation section; keep this section current as work progresses. Preserve the agreed design and mandatory workflow gates, including independent E2E testcase authoring before plugin implementation. Send material design gaps directly to the planner and continue independent work while they are resolved.

## Implementer and planner: ongoing design consultation

The implementer may ask the planner for design feedback and suggestions at any stage, including before committing to an approach or while refining the implementation. Consult early when consequential architectural, behavioral, or visual choices remain uncertain, or a second look could improve the design. The existing planner is the design advisor; use the installed **Ask Astra** skill's briefing and reasoning approach, reusing this planner through Herdr instead of launching another advisor or pane. Routine implementation choices within the recorded discretion remain with the implementer.

Send a focused brief with `herdr agent prompt <planner-name> <brief>`. Include the objective, constraints, relevant plan sections, code paths or revision, screenshots or other evidence when useful, viable options, uncertainties, the exact question, and the implementer's coordination name for the reply. Ask the planner to challenge assumptions and return actionable recommendations with rationale, tradeoffs, concrete locations or examples, and remaining uncertainty. Give it time to reason; use bounded waits and continue independent work while it thinks. A wait timeout alone does not invalidate the consultation. Retrieve the response with `herdr agent read` when needed, following Herdr's output-retrieval and blocked-agent guidance.

The planner returns advice directly to the implementer without taking over production edits or implementation sequencing. The implementer checks recommendations against the code and user constraints, asks focused follow-ups, and records consequential decisions and reasons for disagreements in the plan. If a recommendation changes the agreed design or contract, resolve it with the planner and update its artifacts and affected test expectations before dependent work proceeds. This consultation does not replace the planner's final design review, independent reviewer, or verification, and neither agent routes it through the orchestrator.

## Implementer: independent E2E testcase design

Follow [E2E Testing](../e2e-testing/SKILL.md) and its [QA Methodology](../qa-methodology/SKILL.md) reference. Before writing plugin code for the change, the implementing agent gives a fresh subagent with no inherited conversation the current written plan and these two skills. Include the planner's Lean evidence and model cases as supporting artifacts; the test author derives expected behavior independently from the written contract and checks the model oracle against it.

The subagent writes actual Playwright/Obsidian E2E test code, with exactly one top-level `test()` in the file named for the plan. Reuse the existing disposable-vault harness and deterministic service fixtures. Cover intended success, meaningful rejection or failure, and the event boundaries identified by the plan. Wait for the test code before implementing the change. Resolve ambiguous expected outcomes in the plan before encoding them in tests.

## Implementer: implement the change

Apply [Obsidian Plugin Development](../obsidian-plugin-development/SKILL.md). Implement the written contract through the real plugin, preserve the modeled boundaries, and connect the production decisions and effects to the planner's definitions. Follow repository conventions for TypeScript scripts, package ownership, lifecycle cleanup, vault operations, and bundling. Use the dependency skill when tools or libraries must change.

When a counterexample, API contract, or product decision changes the requirements, the planner updates the plan and Lean artifacts and the independent test author updates the E2E expectations before dependent implementation work proceeds. Fix implementation mismatches or expose the unresolved obligation; do not weaken a requirement merely to obtain passing proofs or tests.

## Implementer, planner, and reviewer: verification

Use the E2E and QA skills to run the new scenarios and relevant existing regression coverage through the packaged plugin in a separate test vault. Include the failure, cancellation, reload, and delayed-completion cases required by the plan. Keep deterministic fixtures, filesystem isolation, and failure diagnostics intact. Recheck Lean and fixture freshness when their inputs change, and run the repository's formatting, lint, type, and bundle checks.

The implementer sends the revision and relevant implementation evidence directly to the planner for design review. For UI changes, include screenshots or access to the running plugin at the representative states and sizes specified in the design handoff. The planner checks the implemented behavior, architecture, and visual result against the design, records its verdict and concrete corrections in the plan, and coordinates fixes directly with the implementer. Recheck affected evidence after fixes. Scale this review to the design decisions involved; do not add a user or orchestrator approval step.

The implementer also spawns a fresh reviewer subagent with no inherited conversation for the final contract-to-evidence review. Give it the original request and corrections, current written plan and design artifacts, diff or revision, independently authored tests, and actual verification evidence, including the planner's design review. Use the agent's subagent tools, without creating a Herdr pane, tab, or workspace. The planner's design review and Herdr's diff viewer do not replace this independent review.

Review findings return to the implementer through the subagent channel. The implementer handles fixes and coordinates contract questions directly with the planner; neither reports to the orchestrator. Record the revision, commands actually run, results, skipped checks, and remaining mismatches. Complete change delivery only when the applicable acceptance criteria, required tests, planner design review, and independent review pass; unavailable review or a skipped required check remains pending. A planning-only handoff identifies which implementation stages remain outstanding. State model proofs, sampled implementation agreement, and external assumptions separately.

## Implementer: commit and open the PR

When every verification and test required for the authorized task has passed, the implementer commits in the task worktree. Review the diff and working-tree status, stage only task changes, and use the repository's kernel-style `scope: msg` commit message with no body. Push `worktree/<stem>` and open a PR with base `main`. Include the concrete change, validation results, and any remaining external assumptions in the PR description. This is part of full delivery; do not ask for another confirmation to commit or open the PR.

If a required check or commit hook fails, fix the issue, rerun the affected checks, and retry without bypassing hooks. An unavailable or skipped required check is not a passing result; keep the dependent delivery stage pending. If push or PR creation fails, preserve the verified commit and surface the blocker in the implementation session. Record the commit hash, PR URL, and checks that passed there, without sending a completion report to the orchestrator. Do not merge the PR or publish a release.
