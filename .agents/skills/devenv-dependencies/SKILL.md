---
name: devenv-dependencies
description: Add or update development tools, language runtimes, and helper libraries in this repository's devenv environment. Use when a task needs a tool or library available in the development shell.
---

# Devenv Dependencies

Use the repository's devenv configuration for tools and helper libraries needed to develop, test, or validate this workspace.

- The project Codex configuration at [`.codex/config.toml`](../../../.codex/config.toml) registers the `devenv` MCP server. When it is available, use its `search_packages` and `search_options` tools to find the package and configuration option before editing. If the server is unavailable, use `devenv search` or the official devenv documentation.
- Check `devenv.nix`, `devenv.yaml`, and existing language manifests before adding anything. Put shell packages and language options in `devenv.nix`; use `devenv.yaml` for Nix inputs and devenv YAML settings. For an importable Python library, add it to the configured Python interpreter with `withPackages` or the project's Python dependency manager.
- Keep application dependencies in their own manifests. For JavaScript packages, edit the relevant workspace `package.json` and run `pnpm install` at the repository root so `pnpm-lock.yaml` stays current. Use devenv for the Node and pnpm toolchain, not for packages bundled into a plugin.
- Keep `devenv.lock` when Nix inputs change. Avoid undeclared global installs as the final solution to a missing development dependency.
- Verify the requested executable or import inside `devenv shell`. Run the affected check or script there to confirm the configured environment supplies it.
