# Installing a connector

Do the account setup first — the connector is useless without a credential:

- **Gmail** → [setup-google-cloud.md](setup-google-cloud.md)
  (visual version with screenshots: [how-to-gmail.md](how-to-gmail.md))
- **WhatsApp** → [setup-meta-whatsapp.md](setup-meta-whatsapp.md)

Then pick one of the two paths below.

---

## Path A — as a Claude plugin (recommended)

Works in Claude Desktop and Claude Code. Nothing to clone, no files to edit.

```
/plugin marketplace add pappcorn/universe
/plugin install gmail-mcp@pappcorn
```

You will be asked for your credentials. They go into your operating system's
keychain and are handed to the connector as environment variables — no
credential file is written to disk.

**Gmail** asks for: OAuth client ID, client secret, refresh token (all produced
by the setup guide).

**WhatsApp** asks for: access token, phone number ID, and optionally the
WhatsApp Business Account ID.

> This path runs a self-contained bundle committed to the repo — nothing is
> fetched from npm and there is no build step.

---

## Path B — from npm (no clone, no plugin)

Both connectors are published as [`@pappcorn/gmail-mcp`](https://www.npmjs.com/package/@pappcorn/gmail-mcp)
and [`@pappcorn/whatsapp-mcp`](https://www.npmjs.com/package/@pappcorn/whatsapp-mcp),
so any MCP config can launch them with `npx` — nothing to download first.

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

With no `env` block, the connector reads the credential file that the setup
script wrote (`~/.config/pappcorn-gmail-mcp/credentials.json`). To pass secrets
explicitly instead, add:

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
configs above at `node /absolute/path/to/universe/packages/<connector>/bin/mcp.cjs` —
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
```

`whoami` prints the account the connector is authenticated as, and never prints
any secret. If it fails, the error tells you what to fix.

Once installed, ask your agent something simple — _"what's in my inbox from
this week?"_ — and confirm the tools appear.

---

## Environment variables

Useful when running from source or scripting.

**Gmail**

| Variable                                                          | Purpose                                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN` | Credential, supplied directly. Takes precedence over the file.                        |
| `GMAIL_MCP_CREDENTIALS`                                           | Path to the credential file. Default `~/.config/pappcorn-gmail-mcp/credentials.json`. |
| `GMAIL_FROM_NAME`                                                 | Optional display name on outgoing mail. Default: bare address.                        |

**WhatsApp**

| Variable                     | Purpose                                                      |
| ---------------------------- | ------------------------------------------------------------ |
| `WHATSAPP_ACCESS_TOKEN`      | Meta System User permanent token.                            |
| `WHATSAPP_PHONE_NUMBER_ID`   | Numeric ID from WhatsApp → API Setup (not the phone number). |
| `WHATSAPP_WABA_ID`           | Business account ID; needed only to list templates.          |
| `WHATSAPP_GRAPH_API_VERSION` | Defaults to `v25.0`.                                         |

---

## Uninstalling / revoking

Removing the plugin stops the connector, but **does not revoke access**. To
actually revoke:

- **Gmail** — Google account → Security → third-party access → remove your app.
- **WhatsApp** — Meta Business Settings → System users → revoke the token.

Then delete the credential file if you created one.
