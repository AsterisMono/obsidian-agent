---
name: lean-verification
description: Use Lean 4 to reduce bugs in this Obsidian plugin monorepo by proving small algorithm or state transition invariants and checking their connection to the TypeScript implementation. Use for formal verification work, concurrency contracts, or evaluating where proofs would help; skip ordinary UI, styling, and straightforward API wiring.
---

# Lean Verification

Use Lean as a development tool for precise models of consequential plugin behavior. Keep the shipped Obsidian plugin in TypeScript. A theorem establishes a property of its Lean definitions; connecting those definitions to production behavior is a separate obligation.

## Choose a useful boundary

Read the current feature plan, relevant source, and existing E2E coverage. Select a small computation or transition system whose failure could lose notes, misroute tool calls, or corrupt chat state. State the bug class the proof would exclude and how the real plugin will be checked against the model. If that connection costs more than the likely benefit, recommend a smaller boundary or ordinary E2E coverage.

Read [project targets](references/project-targets.md) when choosing a target. Guarded note replacement is a useful first pilot: it has a small decision surface and a costly failure mode. The other examples are candidates to reassess against current code, not guarantees already established.

For advice or skill documentation requests, deliver that analysis without installing Lean or changing plugin behavior. Introduce proof infrastructure when implementing an agreed verification task requires it.

## Write the contract before proving it

Record the following in the current feature plan or an adjacent verification note:

- The externally meaningful requirement, accepted inputs, preconditions, and observable success and failure outcomes.
- The Lean state, operations, and properties; the corresponding TypeScript functions and Obsidian boundaries.
- Assumptions about external APIs, event ordering, storage, and representation, plus the E2E scenario that exercises each important boundary.

Try a small counterexample before investing in a proof. When a property is false, preserve the counterexample and resolve the contract or implementation; do not weaken the statement until the existing code passes. Requirements come from the plan, and source describes current behavior. Flag unresolved product semantics instead of encoding an arbitrary policy as a theorem.

For a state machine, prove the invariant initially and after each permitted transition, then lift it to reachable traces. Include failure, cancellation, reload, and delayed completion when relevant. Split asynchronous operations at suspension points unless their atomicity has independent justification. Distinguish safety from eventual completion: a liveness claim needs explicit assumptions about scheduling and dependencies.

Show that the preconditions admit useful cases. A reject-everything implementation can satisfy a rejection property; also specify success for intended valid inputs. Check that each theorem refers to the intended definitions and does not assume its own conclusion.

## Preserve the E2E workflow

When plugin feature code will change, follow the root `AGENTS.md`: give a fresh subagent with no inherited conversation the current written feature plan and the [E2E Testing](../e2e-testing/SKILL.md) and [QA Methodology](../qa-methodology/SKILL.md) skills. Wait for that agent's E2E test code before implementing the feature. Put the behavioral contract and modeled boundaries in the plan so the test author can derive expectations independently.

Lean proofs supplement the repository's E2E feature tests. Keep feature scenarios in the existing Playwright/Obsidian harness; do not add a parallel unit or property test suite for TypeScript features under this skill.

An executable Lean model can supply expected outcomes for deterministic cases or event traces. Feed those cases through the real plugin UI and deterministic model/MCP fixtures, then compare observable vault changes, tool results, or saved state. Generate model outputs outside the Obsidian sandbox and pass only needed data through the existing harness. Retain the model revision, input trace, and expected output so stale fixtures can be detected; do not hand-copy the TypeScript function as the oracle.

Keep a small representative corpus for desktop E2E cost: meaningful boundaries, error outcomes, and counterexamples found during modeling. Finite agreement is implementation evidence, not a proof of equivalence. Direct testing of an isolated helper cannot establish the behavior of the packaged plugin.

## Build an honest model

Prefer total pure functions and explicit result types for accept, reject, conflict, and effect failure. Separate deciding an effect from executing it. If the model emits a write, prove the guard for that write and document where the actual API enforces it.

Treat time, generated IDs, external writes, and service completions as explicit inputs when they affect a property. Model nondeterministic scheduling with allowed events; do not bake in a favorable ordering. Preserve distinctions such as a missing snapshot versus a snapshot containing empty text.

Account for representation differences at the boundary: JavaScript number bounds and special values, UTF-16 string operations, JSON decoding, and Obsidian path normalization. Use a suitable representation or state and enforce a restricted input domain. A proof over mathematical integers or abstract path segments does not by itself verify JavaScript arithmetic or string parsing.

Keep changes to the TypeScript boundary small and reviewable. Use [Obsidian Plugin Development](../obsidian-plugin-development/SKILL.md) when changing plugin code. Do not introduce a runtime Lean dependency, transpiler, or native bridge merely to obtain a proof.

## Check and report the evidence

Read [tooling and proof checks](references/tooling.md) when adding or running Lean. Build every claimed theorem with the pinned toolchain, reject incomplete proofs, and inspect transitive axiom dependencies. Review the statement and its assumptions as well as the proof result.

Keep the model, theorem, production boundary, and E2E scenario linked in the verification note. When one changes, reassess the others. A passing proof of an obsolete model supplies no evidence for changed behavior.

Report the exact property established, its assumptions, the Lean checks actually run, the implementation scenarios actually exercised, and any remaining mismatch. Use precise wording such as “the modeled edit guard is proved; stale disk and editor cases passed E2E.” If Lean could not run, label the result an unchecked model or proposal.
