# Repository guidance

- Write repository scripts in TypeScript (`.ts`, `.mts`, or `.cts`), never JavaScript (`.js`, `.mjs`, or `.cjs`). Run them with the repository's pinned Node.js runtime and include them in its TypeScript checks.
- Comments are banned in TypeScript sources and scripts. Follow the configured Prettier formatting and strict type-checked ESLint rules.
- Use kernel-style commit messages: `scope: msg`, with no body.
- Use devenv for development tools and pnpm for JavaScript dependencies. Keep the generated `devenv.lock` when Nix inputs change and retain `pnpm-lock.yaml` when dependencies change.
- Plugin behavior tests are E2E only. Develop and manually verify the plugin in a separate test vault.
- Use the Obsidian API for vault operations. Register events, DOM listeners, and timers with the plugin lifecycle helpers so they are cleaned up on unload.

Follow [Land Changes](.agents/skills/land-changes/SKILL.md) for changes that land in this repository.

Use [Update Project Docs](.agents/skills/update-project-docs/SKILL.md) when reviewing or updating repository guidance or the README.

Use [Obsidian Plugin Development](.agents/skills/obsidian-plugin-development/SKILL.md) for plugin work and [Devenv Dependencies](.agents/skills/devenv-dependencies/SKILL.md) for development environment changes.

Last updated at: `be178047ccc08eac6239dfde72b73854f6faf5bb`.
