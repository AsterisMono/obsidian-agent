# Exploratory vision testing: <plugin> — <run ID>

Keep this file as `bugs.md` in the temporary run folder, outside the checkout. Do not stage or commit it or its evidence.

## Run

- Scope and user budget:
- Coverage status: In progress / Complete / Incomplete
- Started / ended (UTC):
- Tester and independence from implementation:
- Plugin ID/version; commit; dirty-tree status and relevant diff:
- Build command and result:
- Obsidian version; headless compositor and viewport/theme:
- Isolated vault/profile; launcher and input tool:
- Fixtures and seeded data; environment limitations:
- Evidence directory:
- GitHub repository and publication scope:
- Validation/filing status: Pending / Complete / Blocked

## Coverage inventory

Split distinct operations and settings into their own feature rows. Keep IDs stable as discoveries extend the inventory.

| Feature ID | Capability and UI entry point | Expected behavior and source | Risk and rationale | Scenarios | Coverage | Evidence or gap |
| ---------- | ----------------------------- | ---------------------------- | ------------------ | --------- | -------- | --------------- |
| F-001      |                               |                              |                    |           | Not run  |                 |

Feature coverage: Exercised / Partial / Blocked / Not run. Track excluded features separately with scope reasons.

## Charters and session notes

### C-001 — <target>

Explore <feature IDs> with <data/conditions> to discover <specific risks>.

- Timebox and actual start/end:
- Setup/fixture changes and starting state:
- Planned scenarios and applicable risk variations:
- Chronological observations and new leads:
- Approximate minutes: testing / bug investigation / setup and interruption:
- Debrief: tested areas, discoveries, remaining gaps, next charter:

## Scenario results

Repeat this block for each scenario; set expectations before execution.

### S-001 — <behavior>

- Feature / charter IDs:
- Starting state and exact test data:
- Expected result and oracle/source (mark inferences):
- UI actions, in order:
- Observed result:
- Verdict: Passed / Failed / Blocked / Not run
- Decisive screenshots and supporting file/transcript evidence:
- Finding IDs or gap reason:

## Findings

| Finding             | Title | Feature/scenario | Observation status | Severity and impact | Reproduction count | Validator / verdict | Issue URL or filing status |
| ------------------- | ----- | ---------------- | ------------------ | ------------------- | ------------------ | ------------------- | -------------------------- |
| [BUG-001](#bug-001) |       |                  |                    |                     |                    | Pending             | Pending validation         |

Remove the example row when there are no findings. Keep environment/fixture blockers distinguishable from product defects; retain observed-once findings.

Append one bug section per finding using `assets/bug.md` from the skill. Each candidate bug gets its own fresh validator after exploration. Keep environment-only blockers in the coverage gaps, outside the candidate bug count.

## Coverage reconciliation

- In-scope features: <total>; exercised: <count>; partial: <count>; blocked: <count>; not run: <count>.
- Scenarios: <total>; passed: <count>; failed: <count>; blocked: <count>; not run: <count>.
- Excluded features and reasons:
- Unresolved expectations, platform/service limits and untested variants:
- Newly discovered features accounted for:
- Blocking prerequisites and exact next actions to resume:
- Regression candidates and other follow-up work:
- Session verdicts, process cleanup and preserved evidence:
- Candidate bugs: <count>; independently valid: <count>; invalid: <count>; inconclusive: <count>; pending: <count>.
- Validated bugs: filed with screenshots: <count>; existing duplicates: <count>; filing blocked: <count>.
- Validator output paths, issue URLs and unresolved upload/filing errors:

State whether coverage is complete separately from whether tested behavior passed. If no bugs were observed, state the coverage and limitations of that observation.
