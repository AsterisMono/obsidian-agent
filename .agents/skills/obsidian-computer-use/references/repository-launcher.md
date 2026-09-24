# Repository launcher

Use this route for the Agent plugin in the `obsidian-plugins` pnpm repository. It requires the existing `plugins/agent/tests/e2e/support.ts` export `withAgent`. It is not a generic launcher for every plugin.

## Prerequisites and launch

Read the checkout's `AGENTS.md` and the shared harness, runtime, and filesystem isolation sections of `.agents/skills/e2e-testing/SKILL.md`. Its automated testcase authoring requirements do not require a new feature plan for exploratory computer use. Use the pinned development environment: Node.js 24, `playwright-core`, Obsidian, Bubblewrap, and Nix. The harness starts its own private headless compositor, so no host display is needed or used. Run commands from the repository root, inside `devenv shell` if the toolchain is not already active.

```bash
pnpm --filter obsidian-agent build
node .agents/skills/obsidian-computer-use/scripts/session.mts plugins/agent/tests/e2e/support.ts
```

The helper lives in this project's `.agents/skills/` directory. Its TypeScript check runs as part of `pnpm --filter obsidian-agent check:types`, included in the plugin's normal `check` command. Launch the second command in a persistent terminal with stdin available, for example `exec_command` with `tty: true` and a short yield. Retain its session ID and send subsequent JSON lines with `write_stdin`. Wait for the `ready` event before sending input. If the orchestrator yields an execution cell instead, resolve it before using the terminal session.

The helper prints its evidence directory immediately. Once ready, it prints the disposable vault, copied plugin directory, and screenshot path/dimensions. Use `view_image` or the available image-viewing tool to inspect each PNG. Evidence and the JSONL transcript remain in `/tmp/obsidian-computer-use-*` after the fixture cleans up its successful vault/profile. Failure diagnostics from the harness remain in a separate `/tmp/obsidian-agent-e2e-*` directory.

The existing harness seeds `Welcome.md`, enables the packaged Agent plugin, and provides a local completion endpoint that replies `Hello from the fixture.`. Harness setup uses locators to accept vault trust and establish English UI before the first screenshot. Do not count that setup as visually verified behavior. The helper does not use locators for interactive commands.

If a scenario needs different notes, settings, service failures, or controlled streaming, use the harness's existing `prepareVault`, `data`, and `modelHandler` options in a task-specific TypeScript driver, following repository guidance. Keep the screenshot/input loop for the behavior being tested. Do not modify the shared harness merely to keep an interactive session open.

## Input protocol

Send one JSON object followed by a newline. Commands run sequentially. Each nonterminal command emits a new screenshot with its pixel dimensions; inspect it before choosing the next target. Invalid commands emit an error and a screenshot without ending the session.

| Command            | JSON shape                                                                                      | Purpose                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Screenshot         | `{"action":"screenshot"}`                                                                       | Observe current state.                                                                                       |
| Click              | `{"action":"click","x":X,"y":Y}`                                                                | Click the visually identified target.                                                                        |
| Double/right click | `{"action":"click","x":X,"y":Y,"count":2}` or `{"action":"click","x":X,"y":Y,"button":"right"}` | Open or show a context menu.                                                                                 |
| Move               | `{"action":"move","x":X,"y":Y}`                                                                 | Hover, then observe any tooltip.                                                                             |
| Type               | `{"action":"type","text":"fixture text"}`                                                       | Insert text in the focused field.                                                                            |
| Key                | `{"action":"press","key":"Control+p"}`                                                          | Send a Playwright key or chord, such as `Enter` or `Escape`.                                                 |
| Scroll             | `{"action":"scroll","x":X,"y":Y,"deltaY":400}`                                                  | Move over the intended pane and scroll; optional `deltaX`.                                                   |
| Drag               | `{"action":"drag","x":X,"y":Y,"toX":X2,"toY":Y2}`                                               | Drag between observed coordinates.                                                                           |
| Wait               | `{"action":"wait","ms":500}`                                                                    | Briefly await rendering, then capture again; maximum 5 seconds per command.                                  |
| Reload             | `{"action":"reload"}`                                                                           | Reload the renderer for a lifecycle/persistence check, then capture it.                                      |
| Finish             | `{"action":"finish","passed":true}`                                                             | Record the agent's verdict and let the fixture clean up. Use `false` with a `reason` when failed or blocked. |

`X`, `Y`, `X2`, and `Y2` above stand for numeric coordinates read from the current screenshot, not literal JSON values. The helper rejects coordinates outside the latest screenshot. Screenshots use `scale: 'css'` and `fullPage: false`, so [mouse coordinates](https://playwright.dev/docs/api/class-mouse) and [screenshot pixels](https://playwright.dev/docs/api/class-page#page-screenshot) share the viewport origin. Inspect a new screenshot if the window has resized.

`type` uses Playwright's text insertion, which does not generate individual keydown/keyup events. Use `press` when those events matter. The helper captures immediately after input; animations, tooltips, and asynchronous work may require another observation. UI success is assessed by the agent, not inferred by the helper.

For persistence checks, `reload` calls `page.reload()` and emits `reloaded` after the new document loads; inspect subsequent screenshots for restoration. This is a lifecycle operation, not a verification of the app's reload shortcut or a full application restart. Sending a chord such as `Control+r` through CDP does not reliably establish that a reload happened. To test a shortcut itself, use `press` or native desktop input and verify its visible effect.

## Failure and cleanup

The session expires after 20 minutes. EOF, interruption, expiry, and `finish` without a passing verdict fail the run and retain harness artifacts. Finish explicitly while stdin is available so cleanup completes normally. If startup fails, read the emitted error and Obsidian diagnostics; inspect missing build files, compositor startup failures, or Bubblewrap permissions. If the execution tool reports a permission denial for local sockets or namespaces, use its approval mechanism to run the same isolated launcher when authorized. Correct the reported cause before one bounded retry. Do not bypass the repository's filesystem sandbox or fall back to a personal vault.

This launcher needs no host display. The harness starts one private headless Wayland compositor per process from `OBSIDIAN_E2E_COMPOSITOR` and binds only that socket into the sandbox, so the same command works inside a desktop session and on a headless server, and an inherited `DISPLAY` or `WAYLAND_DISPLAY` is never used. Do not substitute Xvfb: the harness drives Obsidian through Wayland ozone. The compositor creates a fixed-size output and floats the Obsidian window, so reported screenshot dimensions stay stable across runs and machines.
