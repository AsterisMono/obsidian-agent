# Obsidian Agent

An AI chat sidebar for Obsidian that can work with notes in your vault.

- Chat with your chosen model, attach the active note or selection, and return to saved conversations.
- Search, read, create, and edit notes through the agent.
- Add instructions from vault skills and connect tools through MCP servers.

Requires desktop Obsidian 1.11.4 or later and access to a model provider. Note creation and edits are applied directly to your vault.

## Get started

1. [Build the plugin from source](docs/development.md#start-developing), then copy `main.js`, `manifest.json`, and `styles.css` into your vault's `.obsidian/plugins/agent/` folder, or use the guide's development-vault link.
2. Reload Obsidian and enable **Obsidian Agent** in **Settings → Community plugins**.
3. Open **Settings → Obsidian Agent**, choose a provider, and save an API key or use **OAuth login** where supported.
4. Run **Open agent sidebar** from the command palette, choose a model, and send a message. Use **Attach active note** to include note context.

For contributing and verification, see the [development guide](docs/development.md) and [Land Changes](.agents/skills/land-changes/SKILL.md).

Last updated at: `3529a258c50a731a37e4b72ae12207409a2c1cea`.
