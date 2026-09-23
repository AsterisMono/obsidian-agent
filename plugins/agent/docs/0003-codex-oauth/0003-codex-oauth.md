# Codex OAuth in Obsidian

## Problem

Starting OAuth for the `openai-codex` provider from Obsidian Agent fails before the provider can ask for a login method. The packaged CommonJS plugin executes the pi-ai OAuth loader in an environment where `import.meta.url` is unavailable, then the loader calls `.endsWith()` on that undefined value.

## Contract

- Selecting `openai-codex` and clicking **OAuth login** must open the provider-owned login-method prompt.
- The prompt must preserve pi-ai's browser and device-code choices and continue through the existing `LoginDialog` prompt and notification hooks.
- Starting login must not show an `endsWith` error.
- Credentials must continue to use the existing `SecretCredentials` store after a provider flow succeeds.
- Other provider loaders and Electron-compatible Node imports must retain their current behavior.

## Implementation boundary

The production change belongs in the plugin's esbuild compatibility transform. It must make pi-ai's variable OAuth module loader resolvable inside the CommonJS bundle without changing provider IDs, OAuth behavior, prompt handling, notifications, or credential persistence.

## Verification

The E2E regression packages the plugin, opens real Obsidian settings, selects `openai-codex`, clicks **OAuth login**, and verifies that the provider's login-method prompt appears with both supported choices and no `endsWith` notice. It cancels before external authentication, so no Codex subscription or secret is required.

Run:

- `pnpm --filter obsidian-agent check`
- `pnpm --filter obsidian-agent build`
- `pnpm --filter obsidian-agent test`
- `pnpm check`

## Lean applicability

Lean verification is not applicable. The defect is a JavaScript module-format compatibility failure at the esbuild/runtime boundary, with no algorithmic or state-transition invariant that a Lean model would usefully establish. The packaged desktop E2E scenario directly exercises the failing boundary.

## Manual verification

In a separate test vault, open Obsidian Agent settings, select OpenAI Codex, click **OAuth login**, choose browser login, complete the external ChatGPT authorization, and confirm that Obsidian reports **Provider connected.** Repeat with device-code login if the account supports it. No existing credential should need to be removed before starting this verification.
