---
name: exploratory-vision-testing
description: Explore Obsidian plugin features through screenshots and mouse/keyboard input, record findings in a temporary bugs.md, independently validate each bug with its own subagent, and file valid bugs as GitHub issues with screenshots through gh. Use for extensive visual exploration or a scoped bug hunt, not automated testcase authoring or implementation.
---

# Exploratory Vision Testing

Discover the plugin's features, exercise their user-visible behavior in an isolated Obsidian instance, and record coverage and findings in a temporary `bugs.md`. After extensive testing, assign one fresh subagent to each bug, then use `gh` to file independently validated bugs with screenshots. A request to test every feature means every discovered feature gets an explicit disposition; it does not mean every possible input combination can be exhausted.

Use the project-local [Obsidian Computer Use](../obsidian-computer-use/SKILL.md) for launching, screenshots, input, and cleanup. Use [QA Methodology](../qa-methodology/SKILL.md) and its [exploratory testing reference](../qa-methodology/references/exploratory-testing.md) for charters and debriefs. This skill supplies the coverage and reporting workflow. Automated testcase authoring rules do not require a new feature plan for an exploratory run; use existing expectations and record gaps.

## Establish the run

- Inspect repository guidance and identify the target from the user's request and plugin manifests. If there is one plugin, use it. If several are equally plausible, ask which to test while inspecting their documentation.
- Follow any user scope or time budget. Otherwise cover the whole plugin, using bounded sessions and continuing across sessions until reachable features are exercised. Prioritize risky features first without silently dropping lower-risk ones.
- Create a unique temporary run folder with `mktemp -d /tmp/exploratory-vision-testing.XXXXXX`. Copy [the run template](assets/run-template.md) to `bugs.md`; use `evidence/`, `validation/`, and `issues/` for screenshots, validator results, and issue bodies. Keep the folder outside the checkout and the disposable vault/profile. Never stage or commit `bugs.md` or run artifacts. Checkpoint during the run and retain the temporary folder when finished.
- Record the plugin ID/version, commit, dirty-tree status and relevant diff, build command/result, Obsidian version, headless compositor, viewport/theme, fixtures, and tool limitations. The harness runs its own private headless compositor and fixed window size, so record the reported dimensions rather than a host display. Build the actual checkout before launching it.
- Test in the isolated vault/profile described by the computer-use skill. Use synthetic notes and local services. Real provider accounts, external service writes, and paid requests require existing user authorization; missing access becomes a named coverage gap. This workflow includes filing validated GitHub issues when explicitly invoked; honor local-only or dry-run constraints. Do not implement fixes or make commits.

## Build a feature inventory

Read current product documentation and applicable plans, then inspect registered commands, views, ribbon/context-menu actions, settings, integrations, and persisted state. Use code and existing tests to find overlooked surfaces, not to declare that their behavior is correct. Reconcile this inventory with the running UI and add features discovered during exploration.

Give each distinct capability a stable feature ID. Split independent settings and operations into separate rows rather than hiding them under a row such as "Settings" or "Chat." Include features disabled by default or dependent on credentials. Each row needs its entry point, expected behavior and source, risk rationale, scenario IDs, results, and evidence or gap reason.

For example, an agent plugin might expose chat submission, streaming/Stop, history search, model selection, note attachments, vault tools, skills, and MCP connections. These are discovery hints, not a fixed inventory or a claim that this checkout supports them.

Use explicit user requirements and current written contracts as the strongest oracles. When absent, identify expectations inferred from UI labels, comparable behavior, or product purpose. Conflicting requirements or an ambiguous result become an open question or suspected issue; do not silently bless current implementation behavior.

## Explore in charters

Write short charters: "Explore <feature IDs> with <data/conditions> to discover <specific risks>." Set a timebox that fits the launcher. The bundled Agent session expires after 20 minutes, so leave time for reporting and cleanup, then start another session when needed. A session ending does not complete a whole-plugin request.

First exercise an end-to-end success path for each reachable feature, including its observable effect. Then deepen exploration with relevant variations:

| Surface             | Useful variations                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| Inputs and settings | Empty/invalid values, boundaries, Unicode, multiline text, save and reopen                              |
| Stateful actions    | Repeat, cancel, switch context mid-action, retry after failure, reload and restore                      |
| Vault operations    | Empty/missing notes, renamed paths, stale edits, saved content and unintended changes                   |
| Integrations        | Local success/error/slow fixtures, unavailable service, disconnect and reconnect                        |
| UI and lifecycle    | Keyboard submission/navigation, focus, scrolling, narrow panes, themes, close/reopen, disable/re-enable |

Choose applicable variations from risk and discoveries; record exclusions. Use [test design techniques](../qa-methodology/references/test-design-techniques.md) when boundaries, state transitions, or interacting settings need systematic selection. Protect breadth by limiting investigation of one finding and returning to the inventory. After three non-converging diagnostic passes, retain evidence and move to an independent area.

For each scenario:

1. Record the starting state, expected outcome and oracle before acting. Distinguish fixture preparation from the behavior being tested.
2. View the current screenshot, select coordinates from that image, and act through mouse/keyboard input. Inspect a fresh screenshot after focus, layout, scroll, or window changes. Use actual key presses for shortcuts and key handling.
3. Wait for a specific visible outcome with a bounded deadline and fresh observations. An input command succeeding or a delay elapsing is not evidence of feature success. Do not use DOM selectors, accessibility locators, injected JavaScript, plugin methods, or direct file writes to perform the behavior under test.
4. Verify the visible effect and, when relevant, inspect resulting files in the disposable vault. Save decisive screenshots and supporting state. File inspection can corroborate a UI test, but cannot replace it.
5. Update the report with actions, actual result, verdict, evidence links and findings before moving on. Adapt the next scenario to what was learned, including interactions between features.

The default Agent model fixture proves only behavior it actually exercises. Its canned text response does not prove tool calls, provider authentication, refresh, streaming cancellation, or MCP behavior. Use suitable isolated fixtures where available and record remaining limitations. Do not count harness setup or prior automated test results as computer-use observations.

## Record findings when encountered

Append a section for each stable bug ID, starting with `BUG-001`, to the temporary `bugs.md` using [the bug-section template](assets/bug.md). Capture the first observation immediately, including intermittent symptoms. Link feature/scenario IDs, minimal numbered steps, exact inputs and starting state, expected versus actual behavior, oracle, environment, impact/severity, reproducibility counts, and evidence. Save a decisive screenshot for every candidate bug and use relative links within the run folder. Record missing screenshots explicitly; do not fabricate them.

Try one controlled reproduction from a known state when safe; preserve the original evidence before resetting. Do not erase a finding because it does not recur. For this workflow, recording observations immediately takes precedence over the QA reference's generic advice to reproduce before reporting. Use **confirmed** for a reproduced contradiction of a supported expectation, **observed once** for a clear contradiction seen only once (including when a retry passes), **suspected** for inconclusive evidence or expectations, and **environment/fixture blocker** for missing test prerequisites. Record frequency separately, and attribute inherited operator evidence rather than claiming firsthand confirmation. Keep guesses about cause separate from observations. Add further occurrences of the same defect to its record instead of duplicating it.

Use Critical for data loss or an unusable plugin, High for a major workflow broken without a workaround, Medium for impaired behavior with a workaround, and Low for minor visual or usability defects. State the actual impact rather than assuming severity from a label. For destructive behavior in the test vault, preserve evidence before further mutations and continue in a fresh fixture if necessary. Report urgent findings promptly to the user while continuing independent areas.

Record missing credentials, unsupported fixture capabilities, and launcher failures as coverage blockers unless there is evidence of a product defect. Save raw errors, affected feature IDs, and what would unblock them. Bug discovery does not turn this task into a repair task; list regression candidates as follow-up work.

## Validate every bug, then file issues

After the broad feature sweep and applicable risk-focused charters, reconcile coverage and deduplicate findings. Do not stop exploration at the first bug. If a hard blocker or the user's budget stops testing early, disclose incomplete coverage and validate the findings collected so far.

Read [independent validation and GitHub filing](references/validation-and-issues.md). Spawn **one fresh subagent per distinct candidate bug**, including observed-once and suspected findings, with no inherited conversation. Queue validators in batches when concurrency slots are limited. Each independently checks the expected behavior, evidence and reproduction, then returns **Valid**, **Invalid**, or **Inconclusive** with reasons and screenshot paths. Validators do not publish issues or edit plugin code; the parent owns `bugs.md` and filing. Unavailable delegation leaves validation pending, never self-approved.

Record every verdict in `bugs.md`. For each **Valid** bug, the parent checks for existing duplicates and opens one issue using `gh issue create --body-file ... --attach ...`, then verifies the resulting issue and screenshot attachment. Do not file invalid, inconclusive, unreviewed, or screenshot-less findings. Keep them in `bugs.md` with the reason and next step. Treat a failed creation command as potentially having created an issue; reconcile its URL before any retry.

## Reconcile coverage and finish

Keep scenario outcomes separate from feature coverage:

- **Passed:** the scenario's expected result was observed with evidence.
- **Failed:** an observed result contradicted the expectation; link the finding.
- **Blocked:** the scenario cannot be judged or executed; state the missing prerequisite or oracle.
- **Not run:** the scenario was not attempted; state why.

A feature is **exercised** when its core workflow and the applicable planned risk checks have observed results, even if some failed; it is **partial**, **blocked**, or **not run** otherwise. An open panel alone is not exercised behavior. Keep documented out-of-scope features separate from the in-scope denominator. Report both exercised-feature counts and scenario outcome counts; neither is a defect-free guarantee.

After each session, record tested areas, findings, remaining gaps, next charters, and approximate time spent testing, investigating bugs, and handling setup/interruption. Reconcile discovered UI surfaces with the inventory before closing the run. Whole-plugin coverage is complete only when every in-scope feature is exercised and no required scenario remains blocked or not run. If a budget or missing capability prevents this, deliver an explicitly incomplete report with a resumable next-action list rather than claiming every feature passed.

When resuming or checkpointing an earlier run, preserve its IDs, tested build, and evidence provenance. Mark missing metadata as unknown. Do not invent prior expectations, executed actions, or completed risk checks; use partial coverage where the original scope cannot be reconstructed. Keep results from a new build separate from the earlier build's evidence.

For an explicitly local-only or dry-run request, finish the requested local artifacts and command plan without publication. Distinguish that completed deliverable from live validation, uploads, or filing that did not occur; a simulated issue URL is not a published result.

Copy evidence needed for reproduction into the temporary run folder before cleaning up test profiles. End each helper session with its explicit verdict: `passed: false` and a reason when that session has failures or blockers. A passing session verdict does not cover unvisited features in the wider run. Close only processes started for this test. Report the tested build, coverage totals, independent validation verdicts, GitHub issue URLs, filing/coverage blockers, fixture limitations, and the absolute path to `bugs.md`. For a full live run, the workflow is complete only after every candidate has a validator disposition and every valid bug is filed with a verified screenshot or linked to an existing duplicate; report pending work explicitly. Retain temporary evidence and never commit it. If no defects were observed, qualify that statement with the actual coverage.
