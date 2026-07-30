# @pappcorn/gmail-mcp

An MCP server for Gmail. Lets Claude read, search, triage, draft and **send**
email from your own account.

Claude's built-in Google connector reads and drafts but deliberately cannot
send. This one can — because it runs on a credential you created, for a mailbox
you own.

## Setup

Two steps, roughly 15 minutes:

1. **[Create your own Google OAuth app and mint a token](../../docs/setup-google-cloud.md)** —
   your credential, on your machine. (Visual version with screenshots:
   [how-to-gmail.md](../../docs/how-to-gmail.md).)
2. **[Install it into Claude](../../docs/install.md)**.

```bash
npx -y -p @pappcorn/gmail-mcp pappcorn-gmail-setup --client ~/Downloads/client_secret_xxx.json --account you@example.com
npx -y -p @pappcorn/gmail-mcp pappcorn-gmail whoami
```

(From a clone: `npm run mint-token -- ...` and `npm run gmail -- whoami`.)

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

The credential is resolved **from the process working directory**, never from
where the package is installed. Highest precedence first:

1. `GMAIL_CLIENT_ID` + `GMAIL_CLIENT_SECRET` + `GMAIL_REFRESH_TOKEN` in the
   process environment — what the Claude plugin supplies from your OS keychain.
2. The nearest `.env`: searched from the working directory upward, stopping at
   the first one found, at the repository root (`.git`), or before your home
   directory — whichever comes first. It fills in variables the environment does
   not set and never overrides them. When no `.env` is in scope, none is
   borrowed from elsewhere.
3. `$GMAIL_MCP_CREDENTIALS` — a credential file path.
4. `~/.config/pappcorn-gmail-mcp/credentials.json` — the global default. Still
   supported; no longer the recommended way to hold more than one mailbox.

`mail_whoami` / `whoami` print which of the four won, so "which mailbox is this
session on?" never has to be inferred.

| Variable                | Purpose                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| `GMAIL_MCP_CREDENTIALS` | Credential file path. `~` is expanded; a relative path resolves against the `.env` that set it. |
| `GMAIL_ACCOUNT`         | **Assertion.** The mailbox this configuration is for — verified against the real one.           |
| `GMAIL_FROM_NAME`       | Display name on outgoing mail. Default: the bare address.                                       |
| `GMAIL_ATTACHMENT_DIR`  | Directory attachments may be read from. Default: the working directory.                         |

### `GMAIL_ACCOUNT` fails closed

When set, the first Gmail call verifies it against **the mailbox the credential
actually opens** — the live profile, not the `account` field written inside the
credential file. If they disagree, every tool denies access with the standard
"no access" message. Sending from the wrong mailbox is the one failure a third
party sees, so it is treated as a security boundary, not a warning.

> **`.env` in a git repository must be in `.gitignore`.** A refresh token pushed
> to a remote is a total leak — it survives in forks, clones and CI caches, and
> the only real remedy is revoking it. Prefer keeping the credential file
> outside the repo and putting only its _path_ in `.env`.

## Multiple mailboxes, one Google Cloud project

The OAuth client identifies your _app_; the refresh token identifies the
_mailbox_. So one Google Cloud project (one client ID/secret) can back as many
mailboxes as you like — mint one refresh token per mailbox by completing the
consent flow logged in as that account. No extra projects needed.

A running server is bound to exactly one credential set — there is no
account-switching tool. To use several mailboxes, register the server once per
mailbox in your own `.mcp.json` (or `claude mcp add`), each entry pinning its
own credentials. Tools arrive namespaced by server name
(`mcp__gmail-work__mail_send` vs `mcp__gmail-personal__mail_send`), so it is
always explicit which mailbox a call goes through.

**Variant A — env vars per entry.** Same client, different refresh tokens.
`GMAIL_ACCOUNT` is strongly recommended on every entry: it makes each entry
assert which mailbox it is, so a copy-paste slip is denied instead of acted on.

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

**Variant B — credential file per entry.** Mint once per mailbox. The setup
script already gives each mailbox its own file rather than overwriting the
previous one; `--out` picks the path when you want to choose it yourself:

```bash
npx -y -p @pappcorn/gmail-mcp pappcorn-gmail-setup --client oauth-client.json --account you@work.com     --out ~/.config/pappcorn-gmail-mcp/work.json
npx -y -p @pappcorn/gmail-mcp pappcorn-gmail-setup --client oauth-client.json --account you@personal.com --out ~/.config/pappcorn-gmail-mcp/personal.json
```

Each entry's `env` is then just
`{"GMAIL_MCP_CREDENTIALS": "/Users/you/.config/pappcorn-gmail-mcp/work.json"}`.

**Variant C — one mailbox per folder.** If a project always uses the same
mailbox, say so once in that folder's `.env` and stop configuring clients at
all — every client started there resolves it:

```bash
GMAIL_MCP_CREDENTIALS=~/.config/pappcorn-gmail-mcp/work.json
GMAIL_ACCOUNT=you@work.com
```

Notes:

- **Use manual entries, not two plugin installs.** The plugin's `user_config`
  binding supports one credential set per install; multi-mailbox is the
  manual-registration or per-folder path.
- The token cache is keyed by a digest of the credential itself, so each
  mailbox gets its own cache slot and its own file. Two mailboxes cannot be
  served each other's access token, and alternating between them does not
  invalidate the cache.
- The setup script refuses to overwrite a credential file — or a symlink,
  which it will not follow silently — that holds a different mailbox. That
  needs a confirmation, or `--force`.
- These are OAuth _user_ credentials, not Google service-account keys — the
  connector deliberately doesn't support domain-wide delegation (see
  Security). One consent flow per mailbox is the model.

## Not in v1

No auto-replies and no inbound triggers. The server acts when asked; it does not
watch your inbox. Receiving mail events requires a `users.watch` → Pub/Sub
subscription and an always-on worker — a separate service, not a local MCP
server.
