# Development

## Start developing

1. Allow the included `.envrc` with `direnv allow` once. Direnv loads Node.js 24, pnpm, and the Obsidian desktop app from the locked Nix environment when you enter the repository.
2. Run `pnpm install`. The pre-commit hooks run Prettier and ESLint from `node_modules`, so install dependencies before committing.
3. Build with `pnpm build`, which bundles `src/main.ts` into `main.js` beside the manifest. `pnpm dev` rebuilds while you work.
4. Copy `.env.example` to `.env` and set `VAULT` to your separate development vault; relative paths resolve from the repository root. Run `pnpm build:link` to build and link the plugin into `$VAULT/.obsidian/plugins/agent`, then reload Obsidian. Enable the plugin in Obsidian's Community plugins settings after the first link.
5. `pnpm check` runs Prettier, ESLint, TypeScript, ActionLint, and the Lean proofs. `pnpm test` runs the tooling and Playwright E2E suites against a packaged plugin in a disposable vault, and `pnpm vision` runs an agent-driven visual check; both bring up their own headless compositor, so neither needs a desktop.

Use the [Obsidian sample plugin](https://github.com/obsidianmd/obsidian-sample-plugin) as a starting point for build setup changes.

## Advisory vision check

Configure the `OPENCODE_API_KEY` secret. CI has three jobs. Checks runs Prettier,
ESLint, the TypeScript type check, ActionLint, and the Lean proofs; Tests runs the
tooling suite and the E2E suite; Visual Test runs paid vision after both pass.
Vision runs only for main and same-repository pull requests; its failure is
advisory. The CI workflow can also be dispatched manually. It keeps
`opencode-go::deepseek-v4.1-flash` with `xhigh` requested reasoning and records
the SDK's effective reasoning level.

On the disposable Ubuntu 24.04 runner, CI temporarily permits unprivileged user
namespaces so Nix-provided bubblewrap can start. The harness still enforces its
empty-root filesystem and restricted mounts.

The agent completes a chat smoke check using a canned local reply. Results are
`observed-pass`, `candidate-defect`, or `inconclusive`; they are advisory and do
not verify real providers, MCP connections, or unvisited UI. No issues are filed
automatically. A separate workflow, running code from the default branch, updates
one PR summary for the latest revision and links to the source run's artifacts.
Main runs receive a commit-linked job summary. Manual runs never publish comments.
The publisher must be present on the default branch before PR summaries work.

Defaults are 60 actions plus eight reserved reporting attempts, 68 model requests,
8,192 output tokens per request, two retained screenshots, two million reserved
tokens, and a conservative $1 estimated run budget. The cost reservation uses
uncached catalog rates doubled to cover DeepSeek peak pricing; provider billing
remains external. Setup is limited to five minutes, exploration to fifteen, and
cleanup to thirty seconds. The workflow has a 45-minute emergency ceiling.
`VISION_MAX_STEPS`, `VISION_MAX_REQUESTS`, `VISION_MAX_OUTPUT_TOKENS`,
`VISION_MAX_TOTAL_TOKENS`, `VISION_MAX_COST_USD`, `VISION_SETUP_MINUTES`, and
`VISION_DEADLINE_MINUTES` configure these limits within validated ceilings.

`pnpm test:tooling` checks the runner's safety and publishing logic with local data
and exercises the real disposable Obsidian harness and a scripted vision agent
without provider charges or GitHub writes. `pnpm test:e2e` covers the plugin's
desktop scenarios, and `pnpm test` runs both suites.
Artifacts named `vision-evidence-<attempt>` retain screenshots, structured findings,
the transcript, and harness diagnostics for 14 days.
