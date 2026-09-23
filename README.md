# Obsidian plugins

Personal Obsidian plugins in a pnpm workspace. `plugins/<plugin-id>/` holds each installable plugin; `packages/` is reserved for code shared between plugins.

## Start developing

1. Allow the included `.envrc` with `direnv allow` once. Direnv loads the Node.js 24 and pnpm toolchain when you enter the repository.
2. Run `pnpm install` from the repository root. The workspace uses one lockfile.
3. Create a plugin at `plugins/<plugin-id>/`. Give it a `package.json` with its own `build`, `check`, and `dev` scripts as needed, a `manifest.json`, and source files such as `src/main.ts`. Build `main.js` beside the manifest so Obsidian can load it. Add `styles.css` when the plugin needs styles.
4. Build one plugin with `pnpm --filter <package-name> build`, or build all plugins with `pnpm build`. Use `pnpm check` and `pnpm test` to run the scripts that packages provide.
5. Load the plugin from a separate development vault at `.obsidian/plugins/<plugin-id>/`. A symlink to the plugin directory lets Obsidian see the built files. Reload Obsidian after changing the plugin code or manifest.

Use the [Obsidian sample plugin](https://github.com/obsidianmd/obsidian-sample-plugin) as a starting point for a plugin's build setup. Its package files belong inside that plugin's workspace directory; install dependencies from this repository's root.
