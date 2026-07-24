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

> This path runs the published npm package. If the plugin fails to start because
> the package is not yet published, use Path B.

---

## Path B — from source

For contributors, or if you want to read and run exactly what's on disk.

```bash
git clone https://github.com/pappcorn/universe.git
cd universe
npm install
npx nx run-many -t build      # or: cd packages/gmail-mcp && npm run build
```

Then register the server with your Claude client.

**Claude Code** — add to `.mcp.json` in your project:

```json
{
  "mcpServers": {
    "gmail": {
      "command": "node",
      "args": ["/absolute/path/to/universe/packages/gmail-mcp/dist/mcp.js"]
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

## Verify it works

Before wiring it into Claude, check the credential from a terminal:

```bash
cd packages/gmail-mcp   && npm run gmail -- whoami
cd packages/whatsapp-mcp && npm run whatsapp -- whoami
```

`whoami` prints the account the connector is authenticated as, and never prints
any secret. If it fails, the error tells you what to fix.

Once installed, ask Claude something simple — *"what's in my inbox from this
week?"* — and confirm the tools appear.

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
