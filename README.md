<div align="center">

# 🍿 PappCorn Universe

**PappCorn's open catalog of Claude plugins and connectors.**

Connectors for your email, your spreadsheets and your WhatsApp that run on your
own credentials, skill packs that help you configure your AI for your own work,
and a licensed product team of agents. Open source, MIT, readable line by line.

[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-black.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/Model_Context_Protocol-black.svg)](https://modelcontextprotocol.io)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-black.svg)](CONTRIBUTING.md)

[pappcorn.ai](https://pappcorn.ai/) · [Front door (Spanish)](https://pappcorn.github.io/universe/) · [Contributing](CONTRIBUTING.md)

</div>

---

## What this is

Universe is the home of `pappcorn-plugins`, PappCorn's plugin marketplace for
Claude. It is for:

- **People who use Claude** and want it to act on their own accounts (send the
  email, edit the sheet, message the customer) without handing their
  credentials to anyone.
- **Teams that work with agents** and want shared, written-down ways of
  working, packaged as skills.
- **Developers on any MCP client.** The connectors are standard MCP servers;
  nothing in them is Claude-specific.

The catalog is maintained by [PappCorn](https://pappcorn.com). If you would
rather have someone walk you through it, talk to **Cris** at
[pappcorn.ai](https://pappcorn.ai/). Cris is PappCorn's AI agent, the friend
who knows AI and helps you configure it for your own work. Plans live there
too.

## The catalog

| Plugin                                                   | Kind              | What it does                                                                                                                                                       |
| -------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ✉️ [**gmail-mcp**](packages/gmail-mcp)                   | Connector · free  | Read, search, triage, draft and **send** email, with attachments, from your own account                                                                            |
| 📊 [**gsheets-mcp**](packages/gsheets-mcp)               | Connector · free  | Inspect, search and **edit** Google Sheets shared with you, without loading them into the context                                                                  |
| 💬 [**whatsapp-mcp**](packages/whatsapp-mcp)             | Connector · free  | Send messages and approved templates from your own business number                                                                                                 |
| 🌿 [**best-practices-git**](packages/best-practices-git) | Skill pack · free | How a team that works with agents commits (`/commit`), opens pull requests (`/git-pr`), and runs parallel branches (`/worktree`)                                   |
| 🧭 [**cris-asiste**](packages/cris-asiste)               | Skill pack · free | In Spanish: configure your own AI. Build a focused agent (`/crear-agente`), teach Claude a task (`/crear-skill`), set up a personal assistant (`/crear-asistente`) |
| 🏭 **product-team**                                      | Agents · licensed | PappCorn's six-agent [INSPIRED](https://www.svpg.com/books/inspired-how-to-create-tech-products-customers-love-2nd-edition/) product team plus its dev-loop skills |

**Connectors** are open-source and bring-your-own-credentials; the source lives
right here. Each one runs as a local process on your own machine, signs in with
your own Google or Meta credentials, and talks straight to Google or Meta with
no server in between. The Sheets connector edits cells by range, so a file with
tens of thousands of rows never has to be loaded into the conversation. And
because they are standard MCP servers, they work in any MCP client, not only
Claude.

**Skill packs** need no credentials and no server: just skills that encode a
way of working. `best-practices-git` is the first of a `best-practices-*`
family, one plugin per practice a team otherwise learns the hard way.
`cris-asiste` also ships each skill as an uploadable `.zip` for people who use
Claude in the chat, where plugins don't run; see [its README](packages/cris-asiste)
and the [front door](https://pappcorn.github.io/universe/#cris-asiste).

**Licensed plugins** keep their source in a private repository. The marketplace
entry points at that repo, and **read access to the repo is the license**: with
access granted, installation just works; without it, the install fails, which
is expected, not broken. To request access to `product-team`, write to
[cris@pappcorn.com](mailto:cris@pappcorn.com).

## Quick start

```bash
# 1. Add the marketplace (once)
/plugin marketplace add pappcorn/universe

# 2. Install what you need
/plugin install gmail-mcp@pappcorn-plugins
/plugin install gsheets-mcp@pappcorn-plugins
/plugin install whatsapp-mcp@pappcorn-plugins
/plugin install best-practices-git@pappcorn-plugins
/plugin install cris-asiste@pappcorn-plugins
```

The plugin asks for your credentials at install time and keeps them in your
operating system's keychain.

Each connector needs a one-time account setup first:

- ✉️ **Gmail** → [Connect your own Gmail account](docs/setup-google-cloud.md) · ~15 min · [screenshot walkthrough](docs/how-to-gmail.md)
- 💬 **WhatsApp** → [Connect your own WhatsApp number](docs/setup-meta-whatsapp.md) · free test number, no line to buy

The skill packs need none of that — no credentials and no server.
`best-practices-git` drives the `git` and `gh` already on your machine, and
`cris-asiste` only writes the files you agree to, where you agree to.

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
packages/    connectors, skill packs and libraries (each installable on its own)
apps/        deployable applications
site/        the public front door — GitHub Pages, in Spanish (see site/README.md)
tools/       operator scripts
docs/        setup guides
```

The masterclass kit ("Tu Ventaja con IA", in Spanish) lives on its own page:
[pappcorn.github.io/universe/masterclass.html](https://pappcorn.github.io/universe/masterclass.html).

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
<sub>Built by <a href="https://pappcorn.com">PappCorn</a> 🍿 · Talk to Cris at <a href="https://pappcorn.ai/">pappcorn.ai</a></sub>
</div>
