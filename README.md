# Obsidian plugins

Personal Obsidian plugins in a pnpm workspace. `plugins/<plugin-id>/` holds each installable plugin; `packages/` is reserved for code shared between plugins.

## Start developing

1. Allow the included `.envrc` with `direnv allow` once. Direnv loads Node.js 24, pnpm, and the Obsidian desktop app from the locked Nix environment when you enter the repository.
2. Run `pnpm install` from the repository root. The workspace uses one lockfile, and the pre-commit hooks run Prettier and ESLint from it, so install dependencies before committing.
3. Create a plugin at `plugins/<plugin-id>/`. Give it a `package.json` with its own `build`, `check`, and `dev` scripts as needed, a `manifest.json`, and source files such as `src/main.ts`. Build `main.js` beside the manifest so Obsidian can load it. Add `styles.css` when the plugin needs styles.
4. Build one plugin with `pnpm --filter <package-name> build`, or build all plugins with `pnpm build`. Format and lint the workspace with `pnpm format` and `pnpm lint`; `pnpm check` runs the formatting check, ESLint, and the per-package checks. Use `pnpm test` for desktop E2E scenarios; it requires a display.
5. Copy `.env.example` to `.env` and set `VAULT` to your separate development vault. Devenv loads the file when you enter the repository; relative paths resolve from the repository root. Create or open that vault in Obsidian, then run `pnpm --filter obsidian-agent build:link` to build the agent plugin and link it into `$VAULT/.obsidian/plugins/agent`. Run the command again after code changes, then reload Obsidian. Enable the plugin in Obsidian's Community plugins settings after the first link.

Use the [Obsidian sample plugin](https://github.com/obsidianmd/obsidian-sample-plugin) as a starting point for a plugin's build setup. Its package files belong inside that plugin's workspace directory; install dependencies from this repository's root.
