# Installing a connector

Do the account setup first — the connector is useless without a credential:

- **Gmail** → [setup-google-cloud.md](setup-google-cloud.md)
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

## Path B — from source

For contributors, or if you want to read and run exactly what's on disk.

```bash
git clone https://github.com/pappcorn/universe.git
```

That's it — each package commits a self-contained bundle at `bin/mcp.cjs`, so
there is nothing to install or build just to *run* a connector. (Contributors
changing source: `npm install` + `npm run build` inside the package rebuilds
`dist/` and the bundle.)

Then register the server with your Claude client.

**Claude Code** — add to `.mcp.json` in your project:

```json
{
  "mcpServers": {
    "gmail": {
      "command": "node",
      "args": ["/absolute/path/to/universe/packages/gmail-mcp/bin/mcp.cjs"]
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
agent — Codex CLI, Gemini CLI, Cursor, your own — runs them the same way:
launch `node /absolute/path/to/universe/packages/<connector>/bin/mcp.cjs`,
with credentials supplied either as environment variables or via the
credential file (see the tables below).

Clone as in Path B (no build needed), then use your client's MCP config
syntax. For example:

**Codex CLI** — `~/.codex/config.toml`:

```toml
[mcp_servers.gmail]
command = "node"
args = ["/absolute/path/to/universe/packages/gmail-mcp/bin/mcp.cjs"]
```

**Gemini CLI** — `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "gmail": {
      "command": "node",
      "args": ["/absolute/path/to/universe/packages/gmail-mcp/bin/mcp.cjs"]
    }
  }
}
```

The setup guides, the credential file, and the `Verify it works` step below are
identical regardless of client.

---

## Verify it works

Before wiring it into your client, check the credential from a terminal:

```bash
cd packages/gmail-mcp   && npm run gmail -- whoami
cd packages/whatsapp-mcp && npm run whatsapp -- whoami
```

`whoami` prints the account the connector is authenticated as, and never prints
any secret. If it fails, the error tells you what to fix.

Once installed, ask your agent something simple — *"what's in my inbox from
this week?"* — and confirm the tools appear.

---

## Environment variables

Useful when running from source or scripting.

**Gmail**

| Variable | Purpose |
|---|---|
| `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN` | Credential, supplied directly. Takes precedence over the file. |
| `GMAIL_MCP_CREDENTIALS` | Path to the credential file. Default `~/.config/pappcorn-gmail-mcp/credentials.json`. |
| `GMAIL_FROM_NAME` | Optional display name on outgoing mail. Default: bare address. |

**WhatsApp**

| Variable | Purpose |
|---|---|
| `WHATSAPP_ACCESS_TOKEN` | Meta System User permanent token. |
| `WHATSAPP_PHONE_NUMBER_ID` | Numeric ID from WhatsApp → API Setup (not the phone number). |
| `WHATSAPP_WABA_ID` | Business account ID; needed only to list templates. |
| `WHATSAPP_GRAPH_API_VERSION` | Defaults to `v25.0`. |

---

## Uninstalling / revoking

Removing the plugin stops the connector, but **does not revoke access**. To
actually revoke:

- **Gmail** — Google account → Security → third-party access → remove your app.
- **WhatsApp** — Meta Business Settings → System users → revoke the token.

Then delete the credential file if you created one.
