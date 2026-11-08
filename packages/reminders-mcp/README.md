# @pappcorn/reminders-mcp

An MCP server for **Apple Reminders** on macOS. Lets Claude see your reminder
lists, read what is due, create a reminder (title, notes, list, due date,
priority), check one off, and change one, through the **Reminders app on your
own Mac**.

There is no account, no token and no network: the connector runs on your Mac
and talks only to the Reminders app, through `osascript`. Reminders syncs to
your other devices through your own iCloud, as it always does. macOS decides
whether the connector may touch Reminders, with its own permission prompt.

## Setup

The full walkthrough, with what to click on the macOS permission prompt, is
**[docs/setup-apple-reminders.md](../../docs/setup-apple-reminders.md)**.

- **Claude Desktop and Cowork:** install the one-click extension,
  [`reminders-mcp.mcpb`](https://pappcorn.github.io/universe/extensions/reminders-mcp.mcpb):
  Claude → **Settings → Extensions → Advanced settings → Install Extension…**.
  It runs with Claude's own built-in Node.js; nothing else to install.
- **Claude Code:** needs Node.js 20 or newer.

  ```
  /plugin marketplace add pappcorn/universe
  /plugin install reminders-mcp@pappcorn-plugins
  ```

Then ask Claude _"what reminder lists do I have?"_. The first time, macOS asks
whether the app running the connector may control Reminders: click **Allow**
(or **OK**).

From a clone: `npm run reminders -w @pappcorn/reminders-mcp -- whoami`.

## Tools

| Tool                | What it does                                                                      | Annotations             |
| ------------------- | --------------------------------------------------------------------------------- | ----------------------- |
| `list_lists`        | Your lists: name, id, how many open reminders each has, which one is the default  | read-only               |
| `list_reminders`    | Reminders in one list. Filters: `status` (incomplete, completed, all), due window | read-only               |
| `create_reminder`   | **Create** a reminder: title, notes, list, due date, remind-me time, priority     | write, not destructive  |
| `complete_reminder` | **Check off** a reminder. It is kept, as completed                                | write, idempotent       |
| `update_reminder`   | **Change** title, notes, due date or priority, or reopen it                       | write, destructive hint |

`update_reminder` carries `destructiveHint: true` because a new title or new
notes **replace** the old ones. Every tool is `openWorldHint: false`: nothing
leaves the Mac.

**Nothing deletes.** Not a reminder, not a list. Completing keeps the reminder
in its list, and `update_reminder` with `completed: false` reopens it.

## Dates and time zones

Claude sends dates as ISO 8601; the connector never guesses natural language.

| You send                    | Means                                               |
| --------------------------- | --------------------------------------------------- |
| `2026-11-08`                | All day on 8 November                               |
| `2026-11-08T09:00`          | 09:00 in **this Mac's** time zone                   |
| `2026-11-08T09:00:00-05:00` | That exact instant, whatever zone the Mac is set to |

Every date comes back in the Mac's local time with its offset
(`2026-11-08T09:00:00-05:00`), and the tool descriptions name the zone
(`America/Bogota (UTC-05:00)`), so the model never converts from UTC.

`list_reminders` filters with `due_after` (inclusive) and `due_before`
(exclusive). A bare day means the start of that day. Either filter leaves out
reminders with no due date.

## What Apple Reminders does not let a script do

Found by running against a real Reminders database, and handled explicitly:

- **One date per reminder.** In current Reminders the due date and the
  "remind me" date are one value: setting either moves both. `remind_at` is
  accepted on its own, or on the same day as an all-day `due` (it becomes the
  time). A `remind_at` that contradicts `due` is refused with an explanation,
  instead of silently overwriting one with the other.
- **A date cannot be removed**, only moved. Scripting refuses to clear it.
- **All-day is inferred.** Reminders reports an all-day date as local midnight,
  so a reminder due at exactly 00:00 reads as all-day.
- **Looking a reminder up without its list is slow.** Pass `list` to
  `complete_reminder` and `update_reminder` when you have it (every result
  carries it); without it, every list is searched, which takes seconds.

## When something goes wrong

| You see                                         | Do this                                                                                                                                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "macOS has not allowed this connector…" (-1743) | System Settings → Privacy & Security → **Automation** → the app running the connector (Claude, or your terminal for Claude Code) → switch on **Reminders**. Then restart that app. |
| "Reminders did not answer within 120 s"         | A permission prompt is probably waiting behind another window. Answer it and ask again.                                                                                            |
| `Connection is invalid (-609)`                  | Handled for you: the connector launches Reminders and retries once. If it persists, open Reminders yourself once.                                                                  |

## Configuration

Nothing is required. Two optional environment variables:

| Variable                   | Purpose                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| `REMINDERS_MCP_TIMEOUT_MS` | How long one call may take. Default `120000` (the first call waits for the permission prompt). |
| `REMINDERS_MCP_OSASCRIPT`  | Path to `osascript`. Default `/usr/bin/osascript`. For testing.                                |

## Security

- **Local only.** No network call, no telemetry. The only process it starts is
  `/usr/bin/osascript`.
- **No injection path.** The JXA script is a fixed string; every value from
  the model reaches it as a single JSON argument, so no title or note can
  become code.
- **Nothing is logged.** Reminder titles and notes are personal; they appear
  only in tool results.
- **macOS is the gate.** The Automation permission is per app and revocable in
  System Settings.

## Not in v1

Deleting reminders or lists, creating or renaming lists, subtasks, tags,
flags, location reminders, recurrence. Deleting stays out on purpose.

## Development

```bash
npm ci --legacy-peer-deps
npx nx run @pappcorn/reminders-mcp:build     # tsc + the committed plugin bundle server/mcp.cjs
npx nx run @pappcorn/reminders-mcp:test      # all against a fake osascript
npm run mcpb -w @pappcorn/reminders-mcp   # mcpb/dist/reminders-mcp-<version>.mcpb
```

The tests never touch your Reminders. To exercise the real thing, use a list
you create for the purpose and delete it afterwards.
