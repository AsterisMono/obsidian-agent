# Repository guidance

This repository holds one Obsidian plugin: **Obsidian Agent**. `manifest.json`, the bundled `main.js`, and `styles.css` live at the repository root, sources under `src/`, tests under `tests/`, and the root scripts build and check the plugin directly.

## Land changes

Follow [Land Changes](.agents/skills/land-changes/SKILL.md) for every change that lands in this repository, including features, bugfixes, and refactors that change plugin behavior. The workflow covers planning, Lean verification, independent E2E testcase design, implementation, E2E regression, and commit. Pure docs or tooling changes with no plugin behavior change can omit inapplicable plugin artifacts. The skill owns the plan layout and the planner's responsibility for Lean artifacts.

## Scripts

Write repository scripts in TypeScript (`.ts`, `.mts`, or `.cts`), never JavaScript (`.js`, `.mjs`, or `.cjs`). Run TypeScript scripts with the repository's Node.js 24 runtime and include them in the repository's TypeScript checks. TypeScript scripts follow the same lint and no-comments rules as other TypeScript sources.

## Commits

Use kernel-style commit messages in the form `scope: msg`, with no commit message body.

## Linting and formatting

Prettier formats the repository and ESLint lints TypeScript sources with strict type-checked rules; comments are banned in TypeScript files. `pnpm check` runs the formatting check, ESLint, TypeScript, and the Lean proofs. devenv installs pre-commit hooks that run the same Prettier and ESLint binaries from `node_modules`, so a commit fails until the staged files are formatted and lint-clean.

## devenv

`devenv.nix` selects Node.js 24 and supplies pnpm, Git, Obsidian, Bubblewrap, Lean, sway, and fonts; pnpm comes from `languages.javascript.pnpm.enable`. Keep the generated `devenv.lock` when Nix inputs are updated. Install JavaScript dependencies with `pnpm install` at the repository root. References: [devenv JavaScript options](https://devenv.sh/languages/javascript/), [devenv direnv integration](https://devenv.sh/integrations/direnv/), and [pnpm](https://pnpm.io/).

## Testing

Plugin behavior change tests are E2E only; follow [E2E Testing](.agents/skills/e2e-testing/SKILL.md) and its [QA Methodology](.agents/skills/qa-methodology/SKILL.md) reference. Before writing plugin code for a change, the implementing agent gives a fresh subagent with no inherited conversation the current written change plan and these two skills. The subagent writes the E2E test code; wait for those tests before implementing the change.

## Obsidian plugin development

Build the plugin so `manifest.json` and bundled `main.js` sit at the repository root; include `styles.css` when needed. Develop and manually verify the plugin in a separate test vault, then reload Obsidian after code or manifest changes. Use the Obsidian API for vault operations and register events, DOM listeners, and timers with the plugin lifecycle helpers so they are cleaned up on unload. References: [build a plugin](https://docs.obsidian.md/Plugins/Getting%20started/Build%20a%20plugin), [manifest reference](https://docs.obsidian.md/Reference/Manifest), [vault API guide](https://docs.obsidian.md/Plugins/Vault), and [lifecycle management](https://docs.obsidian.md/plugins/guides/lifecycle-management).
