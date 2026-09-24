# obsidian-agent

The **Obsidian Agent** plugin: a chat sidebar for Obsidian with model providers, vault tools, MCP connections, and skills. One repository, one plugin — `manifest.json`, the bundled `main.js`, and `styles.css` sit at the repository root so the directory can be loaded as a plugin directly.

## Start developing

1. Allow the included `.envrc` with `direnv allow` once. Direnv loads Node.js 24, pnpm, and the Obsidian desktop app from the locked Nix environment when you enter the repository.
2. Run `pnpm install`. The pre-commit hooks run Prettier and ESLint from `node_modules`, so install dependencies before committing.
3. Build with `pnpm build`, which bundles `src/main.ts` into `main.js` beside the manifest. `pnpm dev` rebuilds while you work.
4. Copy `.env.example` to `.env` and set `VAULT` to your separate development vault; relative paths resolve from the repository root. Run `pnpm build:link` to build and link the plugin into `$VAULT/.obsidian/plugins/agent`, then reload Obsidian. Enable the plugin in Obsidian's Community plugins settings after the first link.
5. `pnpm check` runs Prettier, ESLint, TypeScript, and the Lean proofs. `pnpm test` runs the Playwright E2E suite against a packaged plugin in a disposable vault, and `pnpm vision` runs an agent-driven visual check; both bring up their own headless compositor, so neither needs a desktop.

Use the [Obsidian sample plugin](https://github.com/obsidianmd/obsidian-sample-plugin) as a starting point for build setup changes.

## Advisory vision check

Configure the `OPENCODE_API_KEY` secret. Vision runs automatically after regular,
Lean, and E2E checks pass for main and same-repository pull requests. The Vision
workflow can also be dispatched manually. It keeps `opencode-go::deepseek-v4.1-flash` with
`xhigh` requested reasoning and records the SDK's effective reasoning level.

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

`pnpm test:vision` checks the runner's safety and publishing logic with local data.
`pnpm test` also exercises the real disposable Obsidian harness and a scripted
vision agent without provider charges or GitHub writes.
Artifacts named `vision-evidence-<attempt>` retain screenshots, structured findings,
the transcript, and harness diagnostics for 14 days.
