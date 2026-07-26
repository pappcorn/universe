# @pappcorn/gmail-mcp

An MCP server for Gmail. Lets Claude read, search, triage, draft and **send**
email from your own account.

Claude's built-in Google connector reads and drafts but deliberately cannot
send. This one can — because it runs on a credential you created, for a mailbox
you own.

## Setup

Two steps, roughly 15 minutes:

1. **[Create your own Google OAuth app and mint a token](../../docs/setup-google-cloud.md)** —
   your credential, on your machine. (Visual version with a screenshot of every
   screen: [how-to-gmail.md](../../docs/how-to-gmail.md).)
2. **[Install it into Claude](../../docs/install.md)**.

```bash
node scripts/mint-token.mjs --client ~/Downloads/client_secret_xxx.json --account you@example.com
npm run gmail -- whoami
```

## Tools

| Tool               | What it does                                                             |
| ------------------ | ------------------------------------------------------------------------ |
| `mail_whoami`      | Which mailbox is authenticated, plus message/thread totals               |
| `mail_search`      | Gmail query syntax (`from:`, `is:unread`, `newer_than:7d`, …)            |
| `mail_read_thread` | Full thread, decoded — including HTML mail as readable text              |
| `mail_send`        | Send. Plain text or HTML, **with attachments**; replies thread correctly |
| `mail_draft`       | Compose into Drafts without sending — attachments included               |
| `mail_label`       | Add/remove labels, creating them if needed                               |
| `mail_archive`     | Remove from inbox                                                        |

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

Attachments may only come from one allowed directory: `GMAIL_ATTACHMENT_DIR`
(default: the server's working directory). Paths that resolve outside it —
including via symlinks — are rejected, so a hostile or confused prompt can't
mail out arbitrary files the process happens to be able to read.

## Configuration

Credentials come from environment variables (`GMAIL_CLIENT_ID`,
`GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`) — what the Claude plugin supplies
from your OS keychain — or from a credential file
(`$GMAIL_MCP_CREDENTIALS`, default `~/.config/pappcorn-gmail-mcp/credentials.json`).

Optional: `GMAIL_FROM_NAME` sets a display name on outgoing mail. Default is the
bare address.

## Multiple mailboxes, one Google Cloud project

The OAuth client identifies your *app*; the refresh token identifies the
*mailbox*. So one Google Cloud project (one client ID/secret) can back as many
mailboxes as you like — mint one refresh token per mailbox by completing the
consent flow logged in as that account. No extra projects needed.

A running server is bound to exactly one credential set — there is no
account-switching tool. To use several mailboxes, register the server once per
mailbox in your own `.mcp.json` (or `claude mcp add`), each entry pinning its
own credentials. Tools arrive namespaced by server name
(`mcp__gmail-work__mail_send` vs `mcp__gmail-personal__mail_send`), so it is
always explicit which mailbox a call goes through.

**Variant A — env vars per entry.** Same client, different refresh tokens.
`GMAIL_ACCOUNT` is **required** on every entry here: the token cache is keyed
by account, and two entries without it share one cache slot — one mailbox can
briefly be served the other's access token.

```json
{
  "mcpServers": {
    "gmail-work": {
      "command": "node",
      "args": ["/path/to/gmail-mcp/bin/mcp.cjs"],
      "env": {
        "GMAIL_CLIENT_ID": "<same client>",
        "GMAIL_CLIENT_SECRET": "<same secret>",
        "GMAIL_REFRESH_TOKEN": "<work token>",
        "GMAIL_ACCOUNT": "you@work.com"
      }
    },
    "gmail-personal": {
      "command": "node",
      "args": ["/path/to/gmail-mcp/bin/mcp.cjs"],
      "env": {
        "GMAIL_CLIENT_ID": "<same client>",
        "GMAIL_CLIENT_SECRET": "<same secret>",
        "GMAIL_REFRESH_TOKEN": "<personal token>",
        "GMAIL_ACCOUNT": "you@personal.com"
      }
    }
  }
}
```

**Variant B — credential file per entry.** Mint once per mailbox;
`--account` writes the mailbox into the file (which keys the token cache, so
the collision above can't happen on this route), `--out` picks the path:

```bash
node scripts/mint-token.mjs --client oauth-client.json --account you@work.com     --out ~/.config/pappcorn-gmail-mcp/work.json
node scripts/mint-token.mjs --client oauth-client.json --account you@personal.com --out ~/.config/pappcorn-gmail-mcp/personal.json
```

Each entry's `env` is then just
`{"GMAIL_MCP_CREDENTIALS": "/Users/you/.config/pappcorn-gmail-mcp/work.json"}`.

Notes:

- **Use manual entries, not two plugin installs.** The plugin's `user_config`
  binding supports one credential set per install; multi-mailbox is the
  manual-registration path.
- Instances under one OS user share the single token-cache file, so
  alternating mailboxes re-mints access tokens a bit more often. Harmless.
- These are OAuth *user* credentials, not Google service-account keys — the
  connector deliberately doesn't support domain-wide delegation (see
  Security). One consent flow per mailbox is the model.

## Not in v1

No auto-replies and no inbound triggers. The server acts when asked; it does not
watch your inbox. Receiving mail events requires a `users.watch` → Pub/Sub
subscription and an always-on worker — a separate service, not a local MCP
server.
