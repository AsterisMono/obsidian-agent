# Repository guidance

This is a pnpm monorepo for personal Obsidian plugins. Put each plugin in `plugins/<plugin-id>/` and reusable workspace code in `packages/`. Keep plugin-specific dependencies and build scripts in the plugin's `package.json`; use the root scripts to run available scripts across the workspace.

## Feature workflow

Follow [Feature Workflow](.agents/skills/feature-workflow/SKILL.md) to take a user-suggested feature through its plan, Lean verification, independent E2E testcase design, implementation, E2E regression, and commit. The skill owns the plan layout and the planner's responsibility for Lean artifacts.

## Scripts

Write repository scripts in TypeScript (`.ts`, `.mts`, or `.cts`), never JavaScript (`.js`, `.mjs`, or `.cjs`). Run TypeScript scripts with the repository's Node.js 24 runtime and include them in the owning package's TypeScript checks. TypeScript scripts follow the same lint and no-comments rules as other TypeScript sources.

## Commits

Use kernel-style commit messages in the form `scope: msg`, with no commit message body.

## Linting and formatting

Prettier formats the workspace and ESLint lints TypeScript sources with strict type-checked rules; comments are banned in TypeScript files. `pnpm check` runs the formatting check, ESLint, and the per-package checks. devenv installs pre-commit hooks that run the same Prettier and ESLint binaries from `node_modules`, so a commit fails until the staged files are formatted and lint-clean.

## devenv

`devenv.nix` selects Node.js 24 and supplies pnpm, Git, and Obsidian; pnpm comes from `languages.javascript.pnpm.enable`. Keep the generated `devenv.lock` when Nix inputs are updated. Install JavaScript dependencies with `pnpm install` at the repository root so all workspaces share `pnpm-lock.yaml`. References: [devenv JavaScript options](https://devenv.sh/languages/javascript/), [devenv direnv integration](https://devenv.sh/integrations/direnv/), and [pnpm workspaces](https://pnpm.io/workspaces).

## Testing

Plugin feature tests are E2E only; follow [E2E Testing](.agents/skills/e2e-testing/SKILL.md) and its [QA Methodology](.agents/skills/qa-methodology/SKILL.md) reference. Before writing feature code, the feature implementation agent gives a fresh subagent with no inherited conversation the current written feature plan and these two skills. The subagent writes the E2E test code; wait for those tests before implementing the feature.

## Obsidian plugin development

Build each plugin so `manifest.json` and bundled `main.js` sit at the root of its `plugins/<plugin-id>/` directory; include `styles.css` there when needed. Match the directory name to the manifest ID. Develop and manually verify plugins in a separate test vault, then reload Obsidian after code or manifest changes. Use the Obsidian API for vault operations and register events, DOM listeners, and timers with the plugin lifecycle helpers so they are cleaned up on unload. References: [build a plugin](https://docs.obsidian.md/Plugins/Getting%20started/Build%20a%20plugin), [manifest reference](https://docs.obsidian.md/Reference/Manifest), [vault API guide](https://docs.obsidian.md/Plugins/Vault), and [lifecycle management](https://docs.obsidian.md/plugins/guides/lifecycle-management).
