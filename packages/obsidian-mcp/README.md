# obsidian-mcp

Read and search your own [Obsidian](https://obsidian.md) vault from Claude.
Your notes are plain files on your own disk and they stay there.

> **This is packaging, not a PappCorn connector.** Every other connector in this
> repo is server code we wrote and maintain. This one is not: it is a plugin
> manifest that launches **[MCPVault](https://github.com/bitbonsai/mcpvault)**,
> a third-party MIT-licensed MCP server by **Mauricio Wolff** (`bitbonsai`). We
> package and pin it; we did not write it. See [NOTICE](NOTICE) for the full
> attribution and licence, and please
> [support the author](https://github.com/sponsors/bitbonsai) if you find it
> useful.

## Install

```
/plugin marketplace add pappcorn/universe
/plugin install obsidian-mcp@pappcorn-plugins
```

There is no account to create and no credential to mint — an Obsidian vault is
just a folder. The plugin asks you for two things at install time:

| Option       | Type      | Default | What it is                                                        |
| ------------ | --------- | :-----: | ----------------------------------------------------------------- |
| `vault_path` | directory |    —    | The folder you open in Obsidian. Nothing outside it is reachable. |
| `read_only`  | boolean   | `true`  | Keeps Claude to reading and searching only.                       |

Step-by-step guide written for non-technical users:
[docs/setup-obsidian.md](../../docs/setup-obsidian.md).

## What it can do

With `read_only` **on** (the default), 11 tools, all non-mutating:

`read_note` · `read_note_lines` · `read_multiple_notes` · `search_notes` ·
`list_directory` · `list_all_tags` · `get_frontmatter` · `get_note_outline` ·
`get_notes_info` · `get_vault_stats` · `wiki_link`

That is enough for the thing most people actually want: asking questions across
everything they have ever written, and having Claude cite the note it came from.

## Turning `read_only` off

Switching it off adds seven mutating tools — including **`delete_note`, which
deletes permanently by default and says so: _"This action cannot be undone."_**

This repo's [CONTRIBUTING](../../CONTRIBUTING.md) rule 5 is _"destructive
operations stay out"_, and that is why `read_only` ships **on**. We do not
control MCPVault's tool surface, so we cannot drop `delete_note` on its own
while keeping `write_note` — it is all seven or none. If you switch it off, you
are opting into that trade knowingly, on your own notes.

Since a vault is version-controllable plain text, the honest mitigation is
`git init` in your vault before you enable writes.

## Why the version is pinned

`.mcp.json` pins `@bitbonsai/mcpvault@0.16.0` rather than `@latest`, matching
how this catalog pins every other plugin. A floating tag would let a future
release change what an already-installed plugin can do on your disk without you
choosing it.

`0.16.0` is also the first version we would ship: **0.14.1 fixed a path-filter
bypass** that let note tools read dotfiles such as `.env` and `.bashrc` at any
depth inside the vault. Anything older than 0.14.1 should not be pointed at a
folder that might contain secrets.

## How it differs from the other connectors

- **No credential.** Nothing to authorise, nothing in your keychain.
- **Not bundled.** The other connectors run a self-contained bundle committed to
  this repo. This one resolves `@bitbonsai/mcpvault@0.16.0` from npm on first
  run, so the first start needs network access; later starts use the npm cache.
- **Not published by us.** There is no `@pappcorn/obsidian-mcp` on npm, and there
  will not be — the package is not ours to publish.
