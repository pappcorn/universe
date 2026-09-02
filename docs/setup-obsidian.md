# Connect your Obsidian vault

**Time: about 3 minutes. Nothing to sign up for, nothing to pay, no password to
create.**

Every other connector in this catalog needs an account setup first. This one
does not. An Obsidian vault is just a folder of text files on your own computer,
so the only thing Claude needs is _which folder_.

By the end, you will be able to ask Claude things like:

- _"What did I write about the pricing conversation with that client?"_
- _"Find every note where I mentioned onboarding and summarise what I concluded."_
- _"What are my open questions across all my meeting notes from this month?"_

---

## Before you start

You need two things:

1. **Obsidian, with at least one vault.** If you already use it, you are ready.
2. **Node.js on your computer.** If you already installed the Gmail or Sheets
   connector, you have it. If not, download the "LTS" version from
   <https://nodejs.org> and click through the installer.

---

## Step 1 — Find your vault folder

You need the folder's full path. Obsidian will tell you:

1. Open Obsidian.
2. Click the vault name in the bottom-left corner.
3. Choose **Manage vaults…**
4. Your vaults are listed with their location underneath. That location is what
   you need — something like `/Users/yourname/Documents/My Vault`.

You can also find it the usual way: right-click the folder in Finder (macOS),
hold **Option**, and choose **Copy … as Pathname**. On Windows, click the
address bar in File Explorer and copy what it shows.

> **Which folder is the vault?** The one that contains a hidden `.obsidian`
> folder. If you picked a folder _inside_ your vault, Claude will only see that
> part — which is sometimes exactly what you want.

---

## Step 2 — Install the connector

In Claude, type:

```
/plugin marketplace add pappcorn/universe
```

Then:

```
/plugin install obsidian-mcp@pappcorn-plugins
```

If you have installed one of our other connectors before, you already added the
marketplace and can skip the first line.

---

## Step 3 — Answer the two questions

Claude shows you what it is about to install — a list under **"Will install"**
that names one MCP server called `obsidian`. Then it asks you to choose a scope;
**User** (available in all your projects) is the right answer for notes.

Then it asks for two settings:

**"Vault folder"** — paste the path from Step 1. Press Enter.

**"Read-only"** — leave this **ON**.

That second one deserves a sentence. With read-only ON, Claude can read and
search your notes but cannot change, move, or remove a single file. With it OFF,
Claude can also write notes — and delete them permanently. We ship it ON because
this catalog's rule is that connectors do not destroy things. See
[the connector's README](../packages/obsidian-mcp/README.md) before you change
it, and if you do turn it off, put your vault in version control first.

---

## Step 4 — The permission screen

The first time Claude actually uses your vault, it stops and asks. This is the
screen people are most unsure about, so here is exactly what happens.

You will see a prompt naming the server (`obsidian`) and the specific tool it
wants to run — for example `search_notes` or `read_note` — with the options:

- **Yes** — allow it this once
- **Yes, and don't ask again for this tool** — allow this kind of action from now on
- **No, and tell Claude what to do differently** — refuse and redirect

Choosing "don't ask again" for the reading tools is safe and will save you a lot
of clicking. You can always review what you approved with the `/mcp` command.

If the very first run takes a few seconds longer than you expect, that is
normal: the connector downloads itself once, then starts instantly after that.

---

## Step 5 — Check it works

Ask Claude:

> How many notes are in my vault?

If it answers with a real number, you are done. Try a real question next — the
point of this connector is that Claude can finally answer from what _you_ wrote,
not from the internet.

---

## Troubleshooting

**"Plugin option 'vault_path' isn't set."**
The path did not save. Run `/plugin` and reconfigure the plugin, then paste the
path again.

**Claude says the folder is empty, but it isn't.**
You probably pointed at the folder _containing_ your vault instead of the vault
itself. Go back to Step 1 and use the exact location Obsidian reports.

**"Cannot find module" or the server won't start.**
Node.js is missing or too old. Install the LTS version from
<https://nodejs.org> and restart Claude.

**Your path has spaces in it.**
That is fine — paste it exactly as it is. Do not add quotes.

---

## What this connector does not do

- It never sees anything outside the folder you chose.
- It never sends your notes anywhere. The connector runs on your computer and
  talks only to Claude.
- With read-only on, it cannot change or delete your notes.
- It does nothing on its own. It acts when you ask, and not otherwise.

---

## Credit

This connector packages **[MCPVault](https://github.com/bitbonsai/mcpvault)**,
an open-source MCP server written by **Mauricio Wolff**. PappCorn packaged and
pinned it; the server itself is his work, shared under the MIT licence. If it
becomes part of how you work,
[consider sponsoring him](https://github.com/sponsors/bitbonsai).
