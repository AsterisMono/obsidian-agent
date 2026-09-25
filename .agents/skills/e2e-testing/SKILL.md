---
name: e2e-testing
description: Design, write, run, and debug Obsidian plugin end-to-end tests.
---

# E2E Testing

## Design and authoring

- Require a written current feature plan. If it is missing, stop and request it. Treat it as the source of expected behavior; earlier plans, current code, existing tests, and the test harness may provide context but must not replace its requirements.
- Apply the repository's [QA Methodology](../qa-methodology/SKILL.md) skill to choose meaningful behaviors, boundaries, and failure states. Read its relevant test-design or risk references when needed. If the current plan leaves an expected result unclear, flag the ambiguity rather than infer it from code.
- Write TypeScript Playwright tests. Create one `tests/e2e/<plan-stem>.test.ts` file per written plan, using the plan's filename without `.md` as `<plan-stem>` (for example, `docs/bright-otter-initial-plan/bright-otter-initial-plan.md` becomes `tests/e2e/bright-otter-initial-plan.test.ts`). Use codename stems, never numbered plans. Cover that plan in its file with exactly one top-level `test()`. Share setup in non-test helpers such as `support.ts`; update them when needed. Check the filename correspondence when reviewing the plan and tests.

## Shared test harness

- Keep [tests/e2e/support.ts](../../../tests/e2e/support.ts) when replacing feature testcases. It owns the disposable vault and profile, packaged plugin copy, local model fixture, empty-root Bubblewrap launch, English Obsidian startup, Playwright CDP connection, diagnostics, and cleanup. Delete or replace only feature `.test.ts` files unless the helper itself needs a change.
- In each feature test, call `withAgent(label, async agent => { ... }, options?)`. The callback receives `page`, `paths`, `vault`, `pluginDir`, `modelPort`, captured `requests`, and UI helpers: `view()`, `openSidebar()`, `newChat()`, `send(message)`, and `savedData()`. `send()` waits for a completed response; control a live stream through `page` when testing Stop or partial output.
- Use `options.data` to seed plugin data and `options.prepareVault(paths)` to add notes or skill files before Obsidian starts. Use `options.modelHandler(request, stream)` for deterministic model behavior. `stream.chunk(delta)` emits an OpenAI-compatible streaming chunk, `stream.finish()` completes it, and `stream.response` allows a deliberate error or long-running stream. The default handler emits a two-part text reply.
- The helper closes its own Obsidian process, Playwright connection, and model server. Close any additional fixture server started by a feature test. Successful temporary profiles are removed; failure artifacts remain under `/tmp/obsidian-agent-e2e-*`.
- Reload the app with `reloadApp(agent.page)` instead of `page.reload()`. Once the plugin is loaded the helper asks Obsidian to reload itself, then confirms a fresh document with a restored workspace and retries with a driver-initiated navigation if that fails; before the plugin loads it drives the reload directly. A bare `page.reload()` can be superseded by Obsidian's own reload, which strands Playwright on a detached frame so every later query hangs or times out.
- Read plugin state through `savedData()`. It keeps re-reading `data.json` for a short window while the plugin's save is still landing, because a save is not atomic and a direct read can catch a truncated file.

## Runtime

- Build the plugin before testing. Launch the Obsidian executable provided by the locked `devenv` shell. `OBSIDIAN_EXECUTABLE` can override the path when needed.
- Never use the host display. The harness starts one private headless Wayland compositor per test process from `OBSIDIAN_E2E_COMPOSITOR` (sway with the headless backend and the pixman renderer) and binds only that socket into the sandbox, so an inherited `DISPLAY` or `WAYLAND_DISPLAY` is ignored on a desktop and unnecessary on a server. Configure it with a fixed output size and float Obsidian at that size, because the compositor otherwise tiles the main window next to Obsidian's secondary window and halves the viewport.
- Fonts come from `OBSIDIAN_E2E_FONTS`, a colon-separated list of font directories mounted read-only into the sandbox. The generated fontconfig file includes the Obsidian closure's `conf.d` and every listed directory, so screenshots render non-Latin scripts and emoji without host fonts.
- Use `playwright-core` to attach to Obsidian's Electron Chromium through `chromium.connectOverCDP`; the Nix Obsidian wrapper accepts `--remote-debugging-port`. Do not download a separate browser for these tests. See [Playwright's CDP API](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp).
- Give each scenario its own disposable vault and Obsidian profile. Copy only the packaged plugin files (`manifest.json`, `main.js`, and `styles.css` when present) into the vault. This checks that the bundle loads without workspace `node_modules`.
- Use deterministic local fixtures for external services such as model endpoints. Exercise the real Obsidian UI and Vault API. Keep credentials and production vaults out of automated tests.
- Write tests in TypeScript. Node.js 24 can strip types while running `node --test --test-concurrency=1 tests/e2e/*.test.ts`; use `playwright-core` for automation and `tsc --noEmit` for type checking. Vitest is unnecessary for this desktop E2E setup. See [Node's TypeScript support](https://nodejs.org/api/typescript.html).

## Filesystem isolation

- Launch the real Obsidian binary through `bubblewrap` (`bwrap`), which is pinned in `devenv.nix`. Start with an empty root using `--tmpfs /`. Never bind `/`, the host home, the repository, or a broad system directory into the sandbox.
- Mount only inputs the test explicitly needs: the exact read-only Nix runtime closure of the pinned Obsidian executable, one writable temporary test root containing its vault and profile, the harness-owned compositor socket, and the configured font directories. Create private `/dev` and `/proc` mounts; isolate PID and IPC namespaces. Keep all XDG directories, `HOME`, and `TMPDIR` inside the temporary root.
- Clear the inherited environment with `--clearenv`, then set only required variables. Pass an explicit English locale and `--lang=en-US`; set Obsidian's `localStorage.language` to `en` and reload before using English UI selectors.
- Probe the sandbox before launch: repository and host system paths such as `AGENTS.md`, `/home`, and `/etc/passwd` must be absent, while the explicitly mounted Obsidian binary, test vault, compositor socket, generated fontconfig file, and font directories are present. Add any new filesystem dependency as a narrow, documented mount and check its necessity. Do not weaken isolation to fix a failing test.
- The local model fixture and Playwright CDP connection use loopback TCP outside the sandbox. Do not mount host credential files, service sockets, or workspace `node_modules` for them.

## Test behavior

- Interact through accessible roles, labels, and stable plugin classes. Wait for observable UI or file state, especially after vault trust, workspace restoration, streaming, and reload. Avoid fixed delays except when a fixture deliberately creates a streaming interval.
- Cover the feature's success path and its meaningful failure state in its single E2E scenario when practical. Check effects in the disposable vault, such as saved chat data or note content, after the UI action.
- Close Playwright, Obsidian, and local fixture servers after each scenario. Keep a screenshot and diagnostics for failures, and remove successful test profiles.
- Run the plugin's UI test script from the repository root inside `devenv shell`, then run `pnpm check` and `pnpm build`. The headless compositor makes UI tests run without a desktop environment, so a missing display is no longer a reason to skip them.
