---
name: obsidian-plugin-development
description: Build, extend, and debug Obsidian plugins in this pnpm monorepo, including plugin scaffolding, API integration, bundling, and test-vault verification. Use for work on plugin code and build configuration, not ordinary vault note editing.
---

# Obsidian Plugin Development

Deliver plugins that Obsidian can load from this workspace. Follow the root `AGENTS.md` and any instructions inside the target plugin; use the existing plugin's conventions when extending it.

## Workspace and build

- Read the root `package.json`, `manifest.json`, and the source before changing the build or plugin setup. The root `README.md` describes the devenv toolchain and development vault workflow.
- This repository is one Obsidian plugin: `manifest.json`, the bundled `main.js`, and `styles.css` sit at the repository root, with sources under `src/`. Run `pnpm install` from the repository root and retain the lockfile.
- For a new plugin, use TypeScript with a default export extending `Plugin`. Start with `src/main.ts`, `manifest.json`, a plugin `package.json`, TypeScript configuration, and a bundler configuration. Add settings, views, CSS, and other files when the feature needs them.
- Adapt the [official sample build](https://github.com/obsidianmd/obsidian-sample-plugin/blob/master/esbuild.config.mjs) within the plugin directory. Bundle to CommonJS `main.js` beside `manifest.json`. Externalize `obsidian`, Electron, Node built-ins, and the CodeMirror/Lezer modules supplied by Obsidian, following the sample's explicit list. Bundle other runtime dependencies, including shared workspace code, so installation does not require `node_modules`.
- Provide plugin `dev` (watch), `build` (production), and `check` (type checking, plus configured linting) scripts. Esbuild does not type-check. Set the compilation target for the supported Obsidian runtime; the Node version used by devenv is a build tool, not the plugin's runtime contract.
- Keep `manifest.json` and `package.json` versions aligned. The [manifest](https://docs.obsidian.md/Reference/Manifest) requires `id`, `name`, `version`, `minAppVersion`, `description`, `author`, and `isDesktopOnly`. Match the plugin directory to `id`; use a lowercase hyphenated ID without `obsidian` or a trailing `plugin`. Set `minAppVersion` from the APIs actually used. Desktop-only dependencies require `isDesktopOnly: true` unless isolated behind a working mobile alternative.

## Obsidian integration

Check signatures and version availability in the installed `obsidian` declarations and [public API](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts). Prefer public APIs and `this.app`; avoid bypassing types to reach undocumented internals.

- Register commands with `addCommand`. Use `editorCallback`/`editorCheckCallback` for editor actions and `checkCallback` for other conditional commands. Availability checks must not perform the action. Keep command IDs stable and avoid default hotkeys unless requested.
- Load settings with `loadData()` and persist with `saveData()`. Apply defaults for missing fields and validate saved values before use; TypeScript types do not validate persisted JSON. Keep transformations independent of the plugin class when they benefit from focused tests.
- Keep startup light. Defer work requiring a restored workspace with `workspace.onLayoutReady`, and avoid rescanning the vault on every event. When a handler writes to files it observes, ensure it stops once the intended change is present.

## Resource ownership

Use [lifecycle helpers](https://docs.obsidian.md/plugins/guides/lifecycle-management): `registerEvent` for Obsidian events, `registerDomEvent` for DOM listeners, and `registerInterval` for intervals. Use `register` for other disposers, such as clearing a timeout or disconnecting an observer.

Tie resources to their actual lifetime. View resources should end when the view closes; modal listeners on global objects need cleanup on close. Pass an owned component to `MarkdownRenderer.render`, and attach child components with `addChild` so they unload with their parent. Prevent outstanding asynchronous work from updating disposed UI. Verify cleanup by disabling and re-enabling the plugin.

## Vault operations

Choose the operation that preserves the user's current document state. Prefer the [Vault API](https://docs.obsidian.md/Plugins/Vault); reserve the adapter for files the Vault API cannot access, such as hidden configuration files.

| Task | Approach |
| --- | --- |
| Change text in the active editor | Use the supplied `Editor` and targeted edits such as `replaceSelection` or `replaceRange`. |
| Read a note for display or analysis | Use `vault.cachedRead(file)`. |
| Transform a file in the background | Use `vault.process(file, current => updated)` with a synchronous callback. |
| Change frontmatter | Use `fileManager.processFrontMatter`. |
| Rename while respecting link settings | Use `fileManager.renameFile`. |
| Delete according to the user's trash preference | Use `fileManager.trashFile`. |
| Resolve a known path | Normalize vault-relative paths and look them up directly; handle missing files and narrow `TAbstractFile` to `TFile` or `TFolder`. |

For a transformation requiring asynchronous computation, read a snapshot, compute the result, then compare the current content with that snapshot inside `vault.process`. On mismatch, report the conflict or recompute with a bounded retry; do not overwrite newer edits. `normalizePath` normalizes separators and formatting, so validate any feature-specific path restrictions separately.

## UI and editor features

Follow the relevant [plugin guidelines](https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Plugins/Releasing/Plugin%20guidelines.md) when adding UI. Render untrusted text through DOM text APIs.

For a native appearance, use the public UI classes exported by `obsidian`: `PluginSettingTab` for settings pages, `Setting` for labeled controls, `Modal` for dialogs, `SuggestModal` or `FuzzySuggestModal` for searchable pickers, `ItemView` for workspace tabs and sidebars, `Menu` for context menus, `Notice` for temporary notifications, and `setIcon()` for icons. `Setting` controls also work inside dialogs and views. Keep custom layout styles in `styles.css`, scoped under plugin-specific classes, and use [Obsidian CSS variables](https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Reference/CSS%20variables/CSS%20variables.md) for colors, typography, spacing, borders, and radiuses so the UI follows the user's theme. Check light mode, dark mode, and the user's preferred theme when available.

For settings targeting Obsidian 1.13.0+, prefer declarative `getSettingDefinitions()` for standard controls and automatic persistence. Use the imperative `display()`/`Setting` approach when supporting older versions. Verify the chosen API against the installed declarations and `minAppVersion`; see the [settings guide](https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Plugins/User%20interface/Settings.md).

Choose `registerMarkdownPostProcessor` or `registerMarkdownCodeBlockProcessor` for rendered Markdown. Use `registerEditorExtension` with CodeMirror 6 for editor decorations and behavior. Reading view and Live Preview have different rendering paths; verify each mode the feature supports. For custom views, register a factory that creates an instance for each leaf, and account for content being moved to another window.

## Verification and handoff

- From the repository root, run `pnpm check`, `pnpm build`, and `pnpm test`. These run against this plugin directly rather than aggregating a workspace.
- Inspect the build output: `manifest.json`, nonempty bundled `main.js`, and `styles.css` when used must sit at the plugin root. Confirm imports of ordinary runtime dependencies were bundled. Keep generated bundles out of source control per `.gitignore`.
- Follow the [development vault workflow](https://docs.obsidian.md/Plugins/Getting%20started/Build%20a%20plugin) using a separate test vault. Copy or symlink the plugin directory into that vault's plugin folder. Reload the plugin after code changes and restart Obsidian after manifest changes. A watch build alone does not reload the running plugin.
- Exercise the changed feature, relevant empty/error states, persistence when settings change, and unload/reload behavior. For note edits, check that unrelated content survives; for UI changes, check supported themes and rendering modes. Test on mobile when claiming mobile behavior has been verified.
- If Obsidian or a test vault is unavailable, complete the build and automated checks and provide concrete manual steps with expected results. State which runtime checks remain unperformed.

These are personal plugins. Add distribution metadata and release automation when release work is requested; consult current Obsidian submission requirements then.
