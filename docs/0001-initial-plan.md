# Obsidian Agent

## Summary

Create a desktop plugin displayed as **Obsidian Agent**, with manifest ID `agent` in the repository root. Obsidian [prohibits `obsidian` in manifest IDs](https://docs.obsidian.md/Reference/Manifest). The plugin will use [pi’s agent core](https://github.com/earendil-works/pi/blob/main/packages/agent/README.md) for the agent loop and streaming, while Obsidian owns the sidebar, vault operations, settings, and chat storage.

## Implementation

- **Chat:** Add a right sidebar view with streamed replies, model and thinking selectors, new and saved chats, stop, active note or selection attachment, and visible tool activity. Save finalized conversations per vault in plugin data; restore them after restart and mark an interrupted response as interrupted.
- **Vault tools:** Give the agent search, read, create, and edit tools through Obsidian’s Vault API. Apply configured writes immediately, as requested. Restrict targets to vault notes and reject edits when a note changed since the agent read it. Exclude shell, deletion, and access outside the vault.
- **Providers:** Use pi’s model catalog for built-in providers, plus configured API keys, custom endpoints, and model IDs. Build Obsidian dialogs around [pi’s provider-owned OAuth login and refresh flows](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md). Store credentials and sensitive MCP headers in [Obsidian SecretStorage](https://docs.obsidian.md/plugins/guides/secret-storage); keep only references in plugin data.
- **Skills and MCP:** Let settings select vault folders containing `SKILL.md` files and enable individual text-based skills. Connect explicitly enabled local stdio and remote Streamable HTTP MCP servers, show connection errors, and expose their tools to pi under server-qualified names. Close connections when disabled or when the plugin unloads.
- **Packaging:** Add the plugin’s own TypeScript, esbuild, check, build, and dev configuration in the existing pnpm workspace. Bundle runtime dependencies into root-level `main.js`, add scoped `styles.css`, and mark the manifest desktop-only.

## Verification

- Check and build the plugin; confirm Obsidian can load the bundled files without workspace `node_modules`.
- Test streamed chat, model and thinking changes, stop, chat restoration, and active note or selection context.
- Test API-key and OAuth setup, credential refresh, skill discovery, local and remote MCP connections, vault writes, edit conflicts, and cleanup on disable or reload in a separate test vault.

## Assumptions

- Skills provide instructions and referenced vault content; the plugin does not execute skill scripts.
- Remote MCP authentication uses configured secret-backed headers; MCP-specific OAuth is outside v1.
