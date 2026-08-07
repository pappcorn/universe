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

## The catalog

This repo is PappCorn's plugin marketplace for Claude — `pappcorn-plugins`.
It carries two kinds of plugins:

### Free connectors (bring your own credentials)

Open-source, MIT-licensed, installable by anyone. The source lives right here.

|     | Connector                                 | What it does                                                                                      |
| :-: | ----------------------------------------- | ------------------------------------------------------------------------------------------------- |
| ✉️  | [**gmail-mcp**](packages/gmail-mcp)       | Read, search, triage, draft and **send** email — with attachments — from your own account         |
| 📊  | [**gsheets-mcp**](packages/gsheets-mcp)   | Inspect, search and **edit** Google Sheets shared with you, without loading them into the context |
| 💬  | [**whatsapp-mcp**](packages/whatsapp-mcp) | Send messages and approved templates from your own business number                                |

Claude's built-in Google connector reads and drafts but **deliberately cannot
send**, and it cannot **edit** a spreadsheet — only read one, in full, which
gets expensive fast on a file with tens of thousands of rows. Those gaps are the
reason this repo exists.

### Licensed plugins

Commercial plugins whose source lives in a private repository. The marketplace
entry points at that repo, and **read access to the repo is the license**:
with access granted, installation just works; without it, the install fails —
that's expected, not broken.

|     | Plugin           | What it does                                                                                                                                                       |
| :-: | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 🏭  | **product-team** | PappCorn's six-agent [INSPIRED](https://www.svpg.com/books/inspired-how-to-create-tech-products-customers-love-2nd-edition/) product team plus its dev-loop skills |

To request access, write to [cris@pappcorn.com](mailto:cris@pappcorn.com).

## Quick start

> **New here from the masterclass?** The guided front door — the
> "Tu Ventaja con IA" kit plus this catalog, in Spanish — lives at
> <https://pappcorn.github.io/universe/>.

```bash
# 1. Add the marketplace (once)
/plugin marketplace add pappcorn/universe

# 2. Install what you need
/plugin install gmail-mcp@pappcorn-plugins
/plugin install gsheets-mcp@pappcorn-plugins
/plugin install whatsapp-mcp@pappcorn-plugins
```

> **Marketplace renamed (July 2026):** this marketplace used to be called
> `pappcorn`; it is now `pappcorn-plugins`. If you installed a plugin as
> `gmail-mcp@pappcorn` or `whatsapp-mcp@pappcorn`, your installed copy keeps
> working — but it will no longer receive updates. To migrate, re-add the
> marketplace (`/plugin marketplace add pappcorn/universe`) and reinstall
> (`/plugin install gmail-mcp@pappcorn-plugins`).

The plugin asks for your credentials at install time and keeps them in your
operating system's keychain.

Each connector needs a one-time account setup first:

- ✉️ **Gmail** → [Connect your own Gmail account](docs/setup-google-cloud.md) · ~15 min · [screenshot walkthrough](docs/how-to-gmail.md)
- 💬 **WhatsApp** → [Connect your own WhatsApp number](docs/setup-meta-whatsapp.md) · free test number, no line to buy

Prefer wiring it by hand, or not using plugins at all?
See [install.md](docs/install.md).

### Not on Claude?

The connectors are standard [MCP](https://modelcontextprotocol.io) servers over
stdio — nothing in them is Claude-specific. Codex CLI, Gemini CLI, Cursor, or
any other MCP-capable agent can run them: clone the repo and point your client
at the self-contained bundle (`node packages/gmail-mcp/server/mcp.cjs` — no build
step, no dependencies). See
[install.md → any MCP client](docs/install.md#path-c--any-mcp-client).

---

## The one rule: your credentials are yours

Every connector here is **bring your own app**. You create your own Google or
Meta application, authorize your own account, and the credential never leaves
your machine. We host nothing, proxy nothing, and there is no PappCorn account
anywhere near your mailbox.

This is more work than clicking "connect". It is also the only version where
the honest answer to _"who else can read my email?"_ is **nobody**.

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
site/        the public front door — GitHub Pages, in Spanish (see site/README.md)
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
