# obsidian-agent

The **Obsidian Agent** plugin: a chat sidebar for Obsidian with model providers, vault tools, MCP connections, and skills. One repository, one plugin — `manifest.json`, the bundled `main.js`, and `styles.css` sit at the repository root so the directory can be loaded as a plugin directly.

## Start developing

1. Allow the included `.envrc` with `direnv allow` once. Direnv loads Node.js 24, pnpm, and the Obsidian desktop app from the locked Nix environment when you enter the repository.
2. Run `pnpm install`. The pre-commit hooks run Prettier and ESLint from `node_modules`, so install dependencies before committing.
3. Build with `pnpm build`, which bundles `src/main.ts` into `main.js` beside the manifest. `pnpm dev` rebuilds while you work.
4. Copy `.env.example` to `.env` and set `VAULT` to your separate development vault; relative paths resolve from the repository root. Run `pnpm build:link` to build and link the plugin into `$VAULT/.obsidian/plugins/agent`, then reload Obsidian. Enable the plugin in Obsidian's Community plugins settings after the first link.
5. `pnpm check` runs Prettier, ESLint, TypeScript, and the Lean proofs. `pnpm test` runs the Playwright E2E suite against a packaged plugin in a disposable vault, and `pnpm vision` runs an agent-driven visual check; both bring up their own headless compositor, so neither needs a desktop.

Use the [Obsidian sample plugin](https://github.com/obsidianmd/obsidian-sample-plugin) as a starting point for build setup changes.
