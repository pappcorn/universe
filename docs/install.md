# Installing a connector

Do the account setup first — the connector is useless without a credential:

- **Gmail** → [setup-google-cloud.md](setup-google-cloud.md)
  (visual version with screenshots: [how-to-gmail.md](how-to-gmail.md))
- **Google Sheets** → [setup-google-sheets.md](setup-google-sheets.md)
- **WhatsApp** → [setup-meta-whatsapp.md](setup-meta-whatsapp.md)
- **LinkedIn Pages** → [setup-linkedin.md](setup-linkedin.md) (needs a
  registered company and LinkedIn's approval of your own app)
- **Apple Reminders** (macOS) → [setup-apple-reminders.md](setup-apple-reminders.md)
  (no account: one macOS permission click)

Then pick a path below. On **Claude Desktop or Cowork**, a connector that ships
a one-click extension is easiest through [the extension](#claude-desktop-and-cowork--one-click-extension-mcpb).

---

## Claude Desktop and Cowork — one-click extension (.mcpb)

Some connectors also ship as a **Claude Desktop extension**, a single `.mcpb`
file. Today: **Apple Reminders**.

| Connector       | Download                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------- |
| Apple Reminders | [`reminders-mcp.mcpb`](https://pappcorn.github.io/universe/extensions/reminders-mcp.mcpb) |

Double-click the downloaded file; Claude opens its install dialog. Or, in
Claude: **Settings → Extensions → Advanced settings → Install Extension…** and
pick the file.

Why this path for Desktop and Cowork:

- **It runs on your computer, not in Cowork's sandbox.** Cowork executes
  commands inside an isolated virtual machine, but Claude Desktop starts
  extensions itself, on the host, where they can reach your apps and files.
  That is what a connector to a Mac app needs.
- **Nothing to install first.** Claude Desktop runs the extension with its own
  built-in Node.js. The plugin path below starts the same server with the
  `node` on your machine, so it needs Node.js 20 or newer.
- **Same code.** The `.mcpb` holds the manifest and the committed
  `server/mcp.cjs` bundle, the exact file the plugin install runs. The stable
  link is rebuilt from `main` on every change; each version is also attached
  to its [GitHub Release](https://github.com/pappcorn/universe/releases).

The extension is not in Claude's directory, so Claude says so before
installing. Extensions you install this way do not update themselves: download
the file again for a new version.

---

## Path A — as a Claude plugin (recommended)

Works in Claude Desktop and Claude Code. Nothing to clone, no files to edit.

```
/plugin marketplace add pappcorn/universe
/plugin install gmail-mcp@pappcorn-plugins
```

You will be asked for your credentials. They go into your operating system's
keychain and are handed to the connector as environment variables — no
credential file is written to disk.

**Gmail** asks for: OAuth client ID, client secret, refresh token (all produced
by the setup guide).

**Google Sheets** asks for: OAuth client ID, client secret, refresh token —
or leave all three empty to use the credential file its setup guide wrote.

**WhatsApp** asks for: access token, phone number ID, and optionally the
WhatsApp Business Account ID.

**LinkedIn Pages** asks for: client ID, client secret, refresh token, access
token and Page ID. Leave all five empty to use the credential file its setup
script wrote, which is the recommended path: that script is the only way to
authorize the app anyway.

**Apple Reminders** asks for nothing. The first call makes macOS ask whether
the app running Claude Code (your **terminal app**: Terminal, iTerm, Ghostty…)
may control Reminders. Click **Allow**. It needs Node.js 20 or newer.

> This path runs a self-contained bundle committed to the repo — nothing is
> fetched from npm and there is no build step.

---

## Path B — from npm (no clone, no plugin)

The connectors are published —
[`@pappcorn/gmail-mcp`](https://www.npmjs.com/package/@pappcorn/gmail-mcp),
[`@pappcorn/gsheets-mcp`](https://www.npmjs.com/package/@pappcorn/gsheets-mcp),
[`@pappcorn/whatsapp-mcp`](https://www.npmjs.com/package/@pappcorn/whatsapp-mcp)
and [`@pappcorn/linkedin-mcp`](https://www.npmjs.com/package/@pappcorn/linkedin-mcp) —
so any MCP config can launch them with `npx` — nothing to download first. The
examples below use Gmail; swap in `@pappcorn/gsheets-mcp`,
`@pappcorn/whatsapp-mcp` or `@pappcorn/linkedin-mcp` (and a matching server
name) for the others.

**Claude Code** — add to `.mcp.json` in your project:

```json
{
  "mcpServers": {
    "gmail": {
      "command": "npx",
      "args": ["-y", "@pappcorn/gmail-mcp"]
    }
  }
}
```

**Claude Desktop** — same block, in `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

With no `env` block, the connector resolves the credential from the working
directory it is started in: the nearest `.env`, then `$GMAIL_MCP_CREDENTIALS`,
then the file the setup script wrote
(`~/.config/pappcorn-gmail-mcp/credentials.json`). See
[Which mailbox does a folder use?](#which-mailbox-does-a-folder-use) below.

To pass secrets explicitly instead, add:

```json
"env": {
  "GMAIL_CLIENT_ID": "...",
  "GMAIL_CLIENT_SECRET": "...",
  "GMAIL_REFRESH_TOKEN": "..."
}
```

**Restart your Claude client** after editing config — servers are only picked up
at startup.

---

## Path C — any MCP client

Nothing in these connectors is Claude-specific: they are standard
[MCP](https://modelcontextprotocol.io) servers over stdio. Any MCP-capable
agent — Codex CLI, Gemini CLI, Cursor, your own — runs them with the same
`npx` launch as Path B, with credentials supplied either as environment
variables or via the credential file (see the tables below). For example:

**Codex CLI** — `~/.codex/config.toml`:

```toml
[mcp_servers.gmail]
command = "npx"
args = ["-y", "@pappcorn/gmail-mcp"]
```

**Gemini CLI** — `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "gmail": {
      "command": "npx",
      "args": ["-y", "@pappcorn/gmail-mcp"]
    }
  }
}
```

### Running from a clone instead

For contributors, or if you want to read and run exactly what's on disk:
`git clone https://github.com/pappcorn/universe.git` and point any of the
configs above at `node /absolute/path/to/universe/packages/<connector>/server/mcp.cjs` —
each package commits that self-contained bundle, so there is nothing to
install or build just to _run_ it. (Contributors changing source:
`npm install` + `npm run build` inside the package rebuilds `dist/` and the
bundle.)

The setup guides, the credential file, and the `Verify it works` step below are
identical regardless of client.

---

## Verify it works

Before wiring it into your client, check the credential from a terminal:

```bash
npx -y -p @pappcorn/gmail-mcp    pappcorn-gmail    whoami
npx -y -p @pappcorn/whatsapp-mcp pappcorn-whatsapp whoami
npx -y -p @pappcorn/linkedin-mcp pappcorn-linkedin whoami
npx -y -p @pappcorn/reminders-mcp pappcorn-reminders whoami   # macOS
```

`whoami` prints the account the connector is authenticated as — plus a
`credential:` line saying where that credential was read from — and never prints
any secret. If it fails, the error tells you what to fix.

Run it **from the folder you will be working in**: Gmail identity is scoped to
the working directory, so the answer can legitimately differ between folders.

Google Sheets has no terminal CLI. Once it is wired in, ask your agent to run
`sheet_whoami`: it names the account the connector acts as, without printing
any secret.

Once installed, ask your agent something simple — _"what's in my inbox from
this week?"_ — and confirm the tools appear.

---

## Which mailbox does a folder use?

The Gmail connector resolves its credential from the directory it is started
in, so one machine can serve several mailboxes without them overwriting each
other. Highest precedence first:

1. `GMAIL_CLIENT_ID` + `GMAIL_CLIENT_SECRET` + `GMAIL_REFRESH_TOKEN` in the
   process environment — what Path A supplies from your keychain.
2. The nearest `.env`, searched from the working directory upward and stopping
   at the repository root. It fills in what the environment does not set; it
   never overrides it. Your home directory is never searched.
3. `$GMAIL_MCP_CREDENTIALS`.
4. `~/.config/pappcorn-gmail-mcp/credentials.json`.

A per-project `.env` is the recommended shape:

```bash
GMAIL_MCP_CREDENTIALS=~/.config/pappcorn-gmail-mcp/you_at_work.com.json
GMAIL_ACCOUNT=you@work.com
```

`GMAIL_ACCOUNT` is checked against the mailbox the credential really opens, and
access is denied on a mismatch — so a misconfigured folder fails loudly instead
of sending from the wrong address.

> **If that folder is a git repository, add `.env` to `.gitignore`.** A refresh
> token pushed to a remote is a total leak and survives in forks and caches;
> revoke it rather than trying to erase it. Keeping the credential file itself
> outside the repo and putting only the _path_ in `.env` avoids the risk
> entirely.

Full walkthrough: [setup-google-cloud.md](setup-google-cloud.md#one-machine-several-mailboxes).

---

## Environment variables

Useful when running from source or scripting.

**Gmail** — resolved from the process environment first, then from the nearest
`.env` (see above).

| Variable                                                          | Purpose                                                                                                                                  |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN` | Credential, supplied directly. Takes precedence over any file.                                                                           |
| `GMAIL_MCP_CREDENTIALS`                                           | Path to the credential file. `~` and paths relative to the `.env` are expanded. Default `~/.config/pappcorn-gmail-mcp/credentials.json`. |
| `GMAIL_ACCOUNT`                                                   | Asserts which mailbox this folder is for. A mismatch with the real mailbox denies access.                                                |
| `GMAIL_FROM_NAME`                                                 | Optional display name on outgoing mail. Default: bare address.                                                                           |

**Google Sheets** — read from the process environment only (no `.env` search).

| Variable                                                                | Purpose                                                                                            |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `GSHEETS_CLIENT_ID` / `GSHEETS_CLIENT_SECRET` / `GSHEETS_REFRESH_TOKEN` | Credential, supplied directly. Takes precedence over any file.                                     |
| `GSHEETS_MCP_CREDENTIALS`                                               | Path to the credential file. Default `~/.config/pappcorn-gsheets-mcp/credentials.json`.            |
| `GSHEETS_MCP_LOG_DIR`                                                   | Where the local audit log of committed writes goes. Default `~/.local/state/pappcorn-gsheets-mcp`. |

**WhatsApp**

| Variable                     | Purpose                                                      |
| ---------------------------- | ------------------------------------------------------------ |
| `WHATSAPP_ACCESS_TOKEN`      | Meta System User permanent token.                            |
| `WHATSAPP_PHONE_NUMBER_ID`   | Numeric ID from WhatsApp → API Setup (not the phone number). |
| `WHATSAPP_WABA_ID`           | Business account ID; needed only to list templates.          |
| `WHATSAPP_GRAPH_API_VERSION` | Defaults to `v25.0`.                                         |

**LinkedIn Pages** — read from the process environment only (no `.env` search).

| Variable                                                                   | Purpose                                                                                                   |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `LINKEDIN_MCP_CREDENTIALS`                                                 | Path to the credential file. Default `~/.config/pappcorn/linkedin-mcp/credentials.json`.                  |
| `LINKEDIN_ACCESS_TOKEN`                                                    | Access token supplied directly (60-day life). Takes precedence over the file.                             |
| `LINKEDIN_REFRESH_TOKEN` + `LINKEDIN_CLIENT_ID` + `LINKEDIN_CLIENT_SECRET` | Renewable credential supplied directly. Takes precedence over the file.                                   |
| `LINKEDIN_ORGANIZATION_ID`                                                 | The Page to act as. Default: the one the setup recorded.                                                  |
| `LINKEDIN_API_VERSION`                                                     | LinkedIn API version, `YYYYMM`. Defaults to `202610`.                                                     |
| `LINKEDIN_MCP_LOG_DIR`                                                     | Where the local log of published posts and comments goes. Default `~/.local/state/pappcorn/linkedin-mcp`. |

**Apple Reminders** — read from the process environment only. Nothing is required.

| Variable                   | Purpose                                                    |
| -------------------------- | ---------------------------------------------------------- |
| `REMINDERS_MCP_TIMEOUT_MS` | How long one call to Reminders may take. Default `120000`. |

---

## Uninstalling / revoking

Removing the plugin stops the connector, but **does not revoke access**. To
actually revoke:

- **Gmail** — Google account → Security → third-party access → remove your app.
- **Google Sheets** — Google account → Security → third-party access → remove
  your app. (If you reused one app for Gmail and Sheets, this revokes both.)
- **WhatsApp** — Meta Business Settings → System users → revoke the token.
- **LinkedIn Pages** — the administrator who authorized the app removes it
  under **Permitted services** in their LinkedIn data-privacy settings; you can
  also reset the Client Secret in the app's Auth tab. Deleting
  `~/.config/pappcorn/linkedin-mcp/` only stops that machine: the token stays
  alive until it is revoked in LinkedIn.

- **Apple Reminders** — no credential exists. To withdraw access, System
  Settings → Privacy & Security → Automation → switch off **Reminders** under
  Claude or your terminal app. A Desktop extension is removed under
  Settings → Extensions.

Then delete the credential file if you created one.
