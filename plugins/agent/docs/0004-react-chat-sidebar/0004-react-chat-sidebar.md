# React chat sidebar with Beautiful UI patterns

## Outcome

Replace the Chat Sidebar's imperative DOM rendering with a React view. Adapt the chat, prompt bar, and sidebar navigation patterns from [Beautiful UI](https://www.beautifului.dev/) to the narrow Obsidian right sidebar, using the host theme's colors and typography. The result must show real plugin data and actions. The showcase's sample conversations, automatic animations, and unimplemented source, command, or dictation controls must not appear.

## Scope and production boundaries

- `AgentView` remains the Obsidian `ItemView` registered as `agent-chat`. It owns one React root for its open lifetime, passes current plugin state into the component on refresh, and unmounts on close. The plugin still owns chat data, model requests, attachment content, run cancellation, persistence, and errors.
- The React component owns ephemeral presentation state: composer draft, saved-chat panel visibility, and optional history search. A plugin refresh, stream update, or model response must not erase an unsent draft. Closing and reopening the view may reset that unsent draft, as it does today.
- Recreate the header, chat history panel, model/thinking controls, conversation, activity, attachment, and composer with a coherent Beautiful UI inspired visual system. Use only plugin-scoped CSS and Obsidian theme tokens; support light and dark themes and sidebar widths down to 260 px without horizontal overflow.
- Keep the existing `New chat`, `Saved chats`, `Model`, `Thinking`, `Attach active note`, `Send`, `Stop`, and `Message` accessible names. Preserve `button[data-chat-id]`, `.agent-tool-activity`, and `.agent-error` for existing desktop regression coverage.
- Add React and its TypeScript declarations as plugin-owned dependencies and bundle React into `main.js`. The test vault must load the packaged files without workspace dependencies.

## Behavioral contract

1. Opening the sidebar shows the current chat and its saved messages. Message text, streamed partial text, retained interrupted text, activity, and errors come from the plugin's actual state and render as text, not HTML. An empty chat shows a restrained empty state.
2. `New chat` creates and displays a fresh chat. `Saved chats` opens and closes a searchable list sorted by descending `updatedAt`. Its search field has the accessible name `Search chats`; choosing a chat displays it. A search that matches nothing shows an explicit empty result. Switching chats during a run retains the plugin's established cancellation behavior.
3. Model and thinking selections reflect persisted plugin state and invoke the existing setters. They are unavailable during a run. An empty model catalog presents a clear selection prompt; sending without a configured model surfaces the plugin's existing error.
4. A nonblank draft sends by clicking `Send` or pressing Enter. Shift+Enter inserts a newline. Empty or whitespace-only drafts never send. The draft survives plugin refreshes caused by streaming, attachment, model selection, and errors. A successful send clears it once. If a run ends with an error, the submitted text returns to an empty composer; a newer draft the user typed during that run takes precedence. The `Send` control is visible when idle and `Stop` replaces it during a run.
5. `Attach active note` retains the current plugin behavior: the attachment path appears in the composer, and the next send consumes its content. If no Markdown note is available, the existing error is visible in the conversation. The composer remains usable after that error.
6. `Stop`, `New chat`, and saved-chat switching retain run ownership and interruption semantics. Late stream completions cannot replace the active chat's content. A stopped partial reply and interruption indicator remain visible after sidebar close/reopen and plugin reload, subject to the existing persistence contract.
7. Obsidian closing the view unmounts React and releases its UI resources. Reopening renders the current persisted state and does not duplicate controls or handlers.

## Acceptance and evidence

- One new desktop scenario at `tests/e2e/0004-react-chat-sidebar.test.ts` exercises the packaged plugin through real Obsidian: idle and populated layouts, searchable history and no-match state, model/thinking controls, draft retention across an update and an errored run, Enter and Shift+Enter, attachment/error behavior, streaming and Stop, and view reopen. It checks light and dark appearance and a narrow sidebar for overflow. Deterministic service responses cover delayed completion.
- Existing `0001`, `0002`, and `0003` E2E scenarios remain passing, including cancellation, persistence, and reload cases.
- `pnpm --filter obsidian-agent check`, `pnpm --filter obsidian-agent build`, `pnpm --filter obsidian-agent test`, and `pnpm check` pass. The packaged bundle loads without runtime `node_modules`.

## Lean applicability

Lean is not applicable to this change. It moves presentation and ephemeral UI state to React while the consequential chat/run state transitions remain in the existing plugin code and existing Plan 0002 model. A formal model of layout, React reconciliation, or component mount/unmount would have no useful connection to the browser and Obsidian APIs. Desktop E2E coverage and an independent contract review verify these boundaries. No new Lean source or fixture is claimed for this plan.

## Assumptions and open semantics

- Beautiful UI supplies visual patterns, not a runtime dependency. Its published components are self-running showcases; their demo conversations and controls do not represent this plugin's capabilities.
- Search is local to the saved-chat panel, case insensitive, and matches chat titles. It does not modify persisted chat data.
- Stream updates may arrive while the user types a new draft; React keeps that draft in component state until the user sends, changes chat, or closes the view.
- Existing plugin methods define saved-data format and cancellation semantics. This plan does not change them.

## Verification record

Verified from working tree based on `0c2e0fb` using Node.js 24 and packaged Obsidian 1.13.7 in disposable vaults.

- `pnpm --filter obsidian-agent build`: passed; bundled `main.js` includes React and loaded without workspace `node_modules`.
- `node tests/e2e/0004-react-chat-sidebar.test.ts`: passed the new scenario after the final draft-recovery and test updates.
- `pnpm --filter obsidian-agent test`: passed all four desktop scenarios, including existing chat, verification, and OAuth regressions.
- `pnpm --filter obsidian-agent check`: passed TypeScript and the existing Plan 0002 Lean build, transitive axiom audit (63 theorem declarations), and 20 model cases with matching provenance.
- `pnpm check`: passed workspace Prettier, ESLint, TypeScript, and Lean checks.
- `git diff --check`: passed. A disposable-vault visual inspection checked the populated sidebar in light and dark themes and at 260 px.
- An independent E2E author derived the scenario from this plan. An independent verifier rechecked the contract against implementation and tests after draft recovery and found no material mismatch.

No new Lean model is claimed for this UI change. The existing Plan 0002 proofs apply to their unchanged state transitions; the packaged E2E scenarios sample their connection to the plugin. The desktop fixtures replace external model services, so provider-specific rendering and nondefault community themes remain external assumptions. No required check was skipped.
