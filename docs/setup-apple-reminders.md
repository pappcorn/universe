# Connect Apple Reminders

This guide gets your assistant **reading and creating your Apple Reminders**,
in about two minutes, on a Mac. There is no account to create and no token to
copy: the connector talks to the Reminders app on your own Mac, and macOS asks
you once whether that is allowed.

## Why it has to run on your Mac

Reminders lives in an app on your Mac (and in your iCloud). A cloud service
cannot reach it without your Apple ID password, and we will never ask for
that. So the connector is a small program that runs **on the Mac itself**, next
to the Reminders app, and Claude talks to it.

In **Cowork**, the commands Claude runs execute inside an isolated virtual
machine that cannot see your Mac's apps. Extensions are different: Claude
starts them on the Mac, outside that machine, which is why the extension below
works in Cowork too.

---

## Before you start

- A Mac with the **Reminders** app, signed in to iCloud if you want your
  reminders on your phone as well.
- One of:
  - **Claude Desktop** (Chat or Cowork), up to date. Nothing else to install:
    the extension runs with Claude's own built-in Node.js.
  - **Claude Code**, plus **Node.js 20 or newer** (`node --version` in the
    terminal).

Using both? Do both paths. They run the same connector and don't interfere.

---

## Path A — Claude Desktop and Cowork (one click)

1. **Download** the extension:
   [`reminders-mcp.mcpb`](https://pappcorn.github.io/universe/extensions/reminders-mcp.mcpb).
   (Every version is also attached to its
   [GitHub Release](https://github.com/pappcorn/universe/releases?q=reminders-mcp).)
2. **Double-click** the downloaded file (in Downloads). Claude opens and shows
   the extension: **Apple Reminders**, with its five tools.
3. Click **Install**. Claude warns that the extension is not from its
   directory and will run on your computer. That is expected: it is open
   source, and you can read every line in this repository.
4. Make sure **Apple Reminders** shows as **Enabled** in **Settings →
   Extensions**.

If double-clicking opens something else, install it from Claude instead:
**Settings** (`⌘,`) → **Extensions** (on newer versions **Settings → Desktop
app → Extensions → Manage**) → **Advanced settings** → **Extension
Developer** → **Install Extension…**, and pick the file.

## Path B — Claude Code

In Claude Code, run:

```
/plugin marketplace add pappcorn/universe
/plugin install reminders-mcp@pappcorn-plugins
```

Then restart Claude Code (or run `/reload-plugins`). `/mcp` should list
`plugin:reminders-mcp:reminders` as connected.

Already added the `pappcorn-plugins` marketplace for another connector? Skip
the first line, and run `/plugin marketplace update pappcorn-plugins` instead.

---

## The first time: allow Claude to use Reminders

Ask Claude something simple, like _"what reminder lists do I have?"_.

macOS then shows a dialog. Who it names depends on where Claude runs:

- **Claude Desktop / Cowork:** _"Claude" wants access to control "Reminders"._
- **Claude Code in a terminal:** the dialog names your **terminal app**, not
  Claude: _"Terminal"_, _"iTerm"_, _"Ghostty"_, or whichever you use. That is
  normal: macOS gives the permission to the app that started the connector.

Click **Allow** (on older macOS: **OK**). Claude's answer then arrives. You
answer this once per app.

> The dialog can open behind other windows. If Claude seems stuck on the first
> request, look for it in the Dock or with `⌘Tab`. The connector waits up to two
> minutes for you.

### If you clicked "Don't Allow"

1. Open **System Settings → Privacy & Security → Automation**.
2. Find **Claude** (or your terminal app) and switch on **Reminders** under it.
3. Quit and reopen that app, and ask again.

If the app is not in the list, quit it and reopen it, then ask Claude again:
macOS shows the dialog once more.

---

## Try it

- _"What's due this week in my Groceries list?"_
- _"Remind me to call the bank tomorrow at 9."_
- _"Mark 'buy coffee' as done."_

Claude reads dates in your Mac's time zone. When it creates a reminder, the
reply shows the date with its offset (for example `2026-11-08T09:00:00-05:00`),
so you can check the time is right.

## What it will not do

- **Delete.** Not a reminder, not a list. Completing keeps the reminder, and
  Claude can reopen it.
- **Remove a date** from a reminder. Reminders does not allow it from a
  script; Claude can move the date, and you can clear it in the app.
- **Anything on its own.** It acts only when you ask.

## Uninstalling

- **Claude Desktop:** Settings → Extensions → Apple Reminders → **Uninstall**.
- **Claude Code:** `/plugin uninstall reminders-mcp@pappcorn-plugins`.
- To withdraw the permission too: **System Settings → Privacy & Security →
  Automation** → switch off **Reminders** under Claude or your terminal app.

Nothing else was stored: the connector keeps no files and no credentials.
