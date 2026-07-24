# @pappcorn/gmail-mcp

An MCP server for Gmail. Lets Claude read, search, triage, draft and **send**
email from your own account.

Claude's built-in Google connector reads and drafts but deliberately cannot
send. This one can — because it runs on a credential you created, for a mailbox
you own.

## Setup

Two steps, roughly 15 minutes:

1. **[Create your own Google OAuth app and mint a token](../../docs/setup-google-cloud.md)** —
   your credential, on your machine.
2. **[Install it into Claude](../../docs/install.md)**.

```bash
node scripts/mint-token.mjs --client ~/Downloads/client_secret_xxx.json --account you@example.com
npm run gmail -- whoami
```

## Tools

| Tool | What it does |
|---|---|
| `mail_whoami` | Which mailbox is authenticated, plus message/thread totals |
| `mail_search` | Gmail query syntax (`from:`, `is:unread`, `newer_than:7d`, …) |
| `mail_read_thread` | Full thread, decoded — including HTML mail as readable text |
| `mail_send` | Send. Plain text or HTML, **with attachments**; replies thread correctly |
| `mail_draft` | Compose into Drafts without sending — attachments included |
| `mail_label` | Add/remove labels, creating them if needed |
| `mail_archive` | Remove from inbox |

## Security

- **Three-legged OAuth, not a service account.** Domain-wide delegation can
  impersonate any user in a Workspace domain and cannot be scoped to one
  mailbox. A refresh token minted by logging in as one account can only ever
  touch that account.
- **Scoped to `users/me`.** There is no code path to another mailbox.
- **Credentials never printed.** Not by a tool, not in an error, not in a log.
  The setup script writes the refresh token to a `chmod 600` file and never
  echoes it.
- **The From address is always the authenticated mailbox** — it cannot be
  configured, so this server cannot send as someone else.
- **It never deletes mail.** Labels and archives only.
- **Sending is outward-facing** and the tool descriptions say so, so Claude
  confirms recipient, subject and body with you before it sends.

Scopes: `gmail.modify` (read/search/label/archive) and `gmail.send`. To narrow
them, see [Hardening](../../docs/setup-google-cloud.md#hardening--how-to-make-this-stricter).

## Attachments

`mail_send` and `mail_draft` take local file paths via `attachments` (one path or
a list). Content-Type is inferred from the extension, filenames are encoded per
RFC 5987 so non-ASCII names survive, and the total is checked against Gmail's
25 MB message limit before anything is sent. Paths are never comma-split, so
filenames containing commas work.

## Configuration

Credentials come from environment variables (`GMAIL_CLIENT_ID`,
`GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`) — what the Claude plugin supplies
from your OS keychain — or from a credential file
(`$GMAIL_MCP_CREDENTIALS`, default `~/.config/pappcorn-gmail-mcp/credentials.json`).

Optional: `GMAIL_FROM_NAME` sets a display name on outgoing mail. Default is the
bare address.

## Not in v1

No auto-replies and no inbound triggers. The server acts when asked; it does not
watch your inbox. Receiving mail events requires a `users.watch` → Pub/Sub
subscription and an always-on worker — a separate service, not a local MCP
server.
