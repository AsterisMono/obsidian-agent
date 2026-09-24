# Proof targets in this repository

Reopen these files before using the examples; the observations describe the code inspected when this skill was written. Paths below are relative to the repository root. The behavior in `docs/0001-initial-plan.md` supplies the original intent; use the current written plan for subsequent work.

| Priority    | Boundary                                                               | Useful property                                                                                                    | Main obligation outside Lean                                                                          |
| ----------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| First pilot | `src/vault-tools.ts`: `edit_note`                        | A replacement requires a remembered snapshot equal to the current disk text; a conflict leaves the note unchanged. | The comparison and write occur in the real Vault API transaction; editor state is handled separately. |
| High        | `src/main.ts`: send, stop, switch, reload                | A completion affects its owning run; stale events cannot clear or overwrite a newer run's state.                   | The model includes real suspension points and callback lifetimes.                                     |
| Focused     | `src/mcp.ts`: exposed names and dispatch                 | Every registered name resolves to exactly one server/tool pair; collisions are rejected or resolved explicitly.    | Registration and dispatch use the same mapping and real provider limits.                              |
| Focused     | `src/vault-tools.ts`: `notePath`; `skills.ts`: discovery | Accepted paths satisfy the declared lexical policy; discovered skills are within configured folders.               | Obsidian normalization and actual file lookup agree with the model.                                   |
| Later       | `src/data.ts`: decoding; `main.ts`: restore/persist      | Decoded state meets specified invariants; interrupted runs restore consistently.                                   | JSON serialization, message validation, and storage behavior match the contract.                      |

## Guarded note replacement

Model the remembered snapshot as optional text, the current disk text, an optional relevant editor buffer, the proposed replacement, and the result. Empty text is a valid snapshot. Keep path acceptance separate from content equality.

Useful obligations, stated schematically rather than as prewritten Lean theorems:

- A successful replacement implies that a snapshot exists and equals the disk text observed inside the commit operation.
- A snapshot conflict leaves disk text and the remembered snapshot unchanged.
- A matching snapshot permits a replacement when the remaining guards and modeled I/O outcome permit it; an empty note is included.
- After a successful replacement, the remembered snapshot equals the committed replacement.
- Changes to other paths do not alter this note's snapshot or commit decision.

The current implementation compares text inside `vault.process` and updates the snapshot after success. Model a failing process call too. Snapshot equality means “same content now,” not “no edit ever occurred”: a change from A to B and back to A is invisible to this mechanism. A stronger requirement needs a revision contract.

The active editor check happens before `vault.process`. Treat it as a separate observation and account for the interval before commit. An atomic disk model alone does not establish that unsaved edits in all open panes are preserved. Start with a narrow disk property and document the editor gap, or include the required editor synchronization in the feature plan and E2E scenario.

The existing harness can use its deterministic model endpoint to request `read_note`, pause, change the disposable vault or editor, and then request `edit_note`. Compare the tool outcome and final note content. Include a successful edit as well as a rejected stale edit. Creation uses different semantics: existing paths must not be overwritten, but creating parent folders can leave partial effects if a later step fails. Do not generalize edit rejection atomicity to all vault tools.

## Chat and connection lifetimes

For chat state, model run ownership separately from the selected chat. Candidate phases include preparation, streaming, cancellation requested, and finished; select phases that correspond to actual code. Include events for provider failure, completion, chat switch, persistence success/failure, and reload as needed by the chosen property.

Inspect `send` before choosing an atomic transition. It checks `isStreaming`, then awaits skill loading before installing the new agent. Persistence also occurs before `agent.prompt`. A model that treats the entire send as atomic can hide overlapping starts. Inspect event handlers that mutate shared `partialText`, `error`, or `activeAgent`; chat identity alone may not distinguish successive runs in one chat.

Useful trace obligations include at most one owner of a live run, unchanged current-run state after a stale completion, and consistent restored flags after loading a saved pending chat. Prove initial-state and transition preservation. Derive deterministic E2E traces for rapid sends, switch during preparation or streaming, delayed old completions, and reload after interruption according to the current plan.

For `McpConnections.sync`, consider connect completion arriving after disable or unload, repeated sync calls, and configuration changes while a connection exists. “Eventually closes” depends on transport behavior; a model can instead prove that a stale connection is never published into the active map under an explicit ownership rule. Confirm disposal with real local fixtures.

## MCP name collisions

The inspected code strips non-alphanumerics from server IDs and truncates to 12 characters. It replaces characters in tool names and truncates to 40. Distinct source names therefore need not remain distinct: server IDs `a-b` and `ab`, each exposing `ping`, both yield `mcp_ab_ping`.

Use this as a counterexample to an unconditional injectivity claim, not as a reason to assume IDs never collide. The requirement should specify whether registration rejects collisions or allocates distinct names with a reverse map. Prove uniqueness among successfully registered entries and that dispatch resolves to their original server/tool pairs. Also show intended valid registrations succeed.

Replacing truncation with hashing does not prove collision freedom over unbounded inputs. A bounded namespace needs explicit capacity, collision handling, and failure behavior. Exercise punctuation and shared-prefix collisions through local MCP servers, inspecting the tools offered to the model and which server receives the call.

## Paths and discovery

Separate parsing, validation, normalization, and lookup. The current note policy rejects absolute paths, drive prefixes, backslashes, dot-prefixed segments, and non-Markdown extensions. It allows some repeated separators after normalization. Decide the accepted language from the feature plan; do not silently add a stricter path policy just to simplify a proof.

Possible claims are that an accepted output is relative, has no forbidden segments, and has the required extension; that normalization preserves the chosen target; and that a discovered skill is beneath a configured folder on a segment boundary. Test legitimate nested paths and sibling-prefix cases such as `skills-extra/SKILL.md` when only `skills` is configured.

A theorem about lexical paths does not establish physical filesystem containment, symlink behavior, case handling, or Obsidian adapter behavior. Keep those claims outside the theorem unless the boundary is modeled and justified.

## Persisted data

Use an explicit JSON value type for a decoding model. Avoid assuming arbitrary persisted input already has the TypeScript shape. The inspected `isAgentMessage` checks a role but not its payload, so a proof of complete message validity would require a richer contract and decoder.

Candidate properties include repair of invalid active-chat references, preservation of valid entries, and normalization of pending/interrupted flags on reload. Decide duplicate-ID behavior rather than assuming IDs are unique. Supply time and fresh IDs as explicit model inputs; isolate the deterministic part before claiming idempotence.

Inspect persistence semantics before modeling a queue of snapshots. The current `persist` reads mutable `this.data` when each queued save runs. A proof assuming the state was captured at enqueue time would describe a different implementation. Scope crash guarantees to the documented storage behavior.

Treat credential reference filtering as a structural property only. Hash-derived identifiers do not establish secrecy, collision freedom, or absence of credentials from arbitrary chat text.
