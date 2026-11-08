# Changelog

All notable changes to `@pappcorn/reminders-mcp`. This project follows
[semantic versioning](https://semver.org/).

## 0.1.0

### Added

- **First release.** Apple Reminders on macOS through the Reminders app on
  your own Mac, over `osascript` (JXA). No account, no token, no network.
- **Five tools:** `list_lists`, `list_reminders` (by list; status and due-date
  filters), `create_reminder` (title, notes, list, due date, remind-me time,
  priority), `complete_reminder`, `update_reminder` (including reopening).
  Each carries a title and read-only / destructive annotations. Nothing
  deletes.
- **Dates in the Mac's own time zone**, in and out, with the offset written
  back on every date.
- **Recovers from `Connection is invalid (-609)`** by launching Reminders and
  retrying once, and turns a refused Automation permission (-1743) into the
  exact System Settings path to fix it.
- **One-click Claude Desktop extension** (`.mcpb`), runnable with Claude's
  built-in Node.js, for Claude Desktop and Cowork.
- **A read-only CLI**, `pappcorn-reminders`: `whoami`, `lists`, `reminders`.
