<div align="center">

# 🍿 PappCorn Universe

**Open-source connectors, skills and agents. Claude-first, agent-agnostic —
standard MCP servers that run anywhere MCP does.**

Give your assistant real hands — your email, your WhatsApp — without handing
your credentials to anyone.

[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-black.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/Model_Context_Protocol-black.svg)](https://modelcontextprotocol.io)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-black.svg)](CONTRIBUTING.md)

</div>

---

## Connectors

| | Connector | What it does |
|:--:|---|---|
| ✉️ | [**gmail-mcp**](packages/gmail-mcp) | Read, search, triage, draft and **send** email — with attachments — from your own account |
| 💬 | [**whatsapp-mcp**](packages/whatsapp-mcp) | Send messages and approved templates from your own business number |

Claude's built-in Google connector reads and drafts but **deliberately cannot
send**. That gap is the reason this repo exists.

## Quick start

```bash
# 1. Add the marketplace (once)
/plugin marketplace add pappcorn/universe

# 2. Install what you need
/plugin install gmail-mcp@pappcorn
/plugin install whatsapp-mcp@pappcorn
```

The plugin asks for your credentials at install time and keeps them in your
operating system's keychain.

Each connector needs a one-time account setup first:

- ✉️ **Gmail** → [Connect your own Gmail account](docs/setup-google-cloud.md) · ~15 min
- 💬 **WhatsApp** → [Connect your own WhatsApp number](docs/setup-meta-whatsapp.md) · free test number, no line to buy

Prefer wiring it by hand, or not using plugins at all?
See [install.md](docs/install.md).

### Not on Claude?

The connectors are standard [MCP](https://modelcontextprotocol.io) servers over
stdio — nothing in them is Claude-specific. Codex CLI, Gemini CLI, Cursor, or
any other MCP-capable agent can run them: clone the repo and point your client
at the self-contained bundle (`node packages/gmail-mcp/bin/mcp.cjs` — no build
step, no dependencies). See
[install.md → any MCP client](docs/install.md#path-c--any-mcp-client).

---

## The one rule: your credentials are yours

Every connector here is **bring your own app**. You create your own Google or
Meta application, authorize your own account, and the credential never leaves
your machine. We host nothing, proxy nothing, and there is no PappCorn account
anywhere near your mailbox.

This is more work than clicking "connect". It is also the only version where
the honest answer to *"who else can read my email?"* is **nobody**.

There is a second benefit that is easy to miss. Because you run your own app for
your own account, you never cross the thresholds that trigger expensive vendor
security reviews. Those exist to protect other people's data from a shared app —
and with one user, there is no shared app.

### Why we write our own connectors

Installing a connector means handing an agent real power over a real account. An
unmaintained third-party server is both a supply-chain risk and a
prompt-injection surface. We build and maintain these ourselves so the tool
surface stays small, auditable and deliberate — and so you can read every line
before you trust it.

### What they will not do

- **Nothing autonomous.** They act when you ask. Nothing watches your inbox and
  replies on its own.
- **Sending always confirms first** — recipient, subject, full body.
- **Gmail never deletes mail.** It labels and archives; that is all.

---

## Repository layout

```
packages/    connectors and libraries (each publishable on its own)
apps/        deployable applications
tools/       operator scripts
docs/        setup guides
```

An Nx monorepo:

```bash
npm install
npx nx run-many -t build
```

## Contributing

Contributions are very welcome — start with [CONTRIBUTING.md](CONTRIBUTING.md).

These connectors are also used in production at PappCorn, so improvements made
here get pulled back into our own stack. Fixing something for yourself probably
fixes it for us too.

## License

[MIT](LICENSE) — do what you like with it.

<div align="center">
<sub>Built by <a href="https://pappcorn.com">PappCorn</a> 🍿</sub>
</div>
