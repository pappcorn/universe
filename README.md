# PappCorn Universe

Open-source connectors, skills and agents for Claude — built by
[PappCorn](https://pappcorn.com), free for anyone to use, fork or contribute to.

## What's here

| Connector | What it does |
|---|---|
| [**gmail-mcp**](packages/gmail-mcp) | Read, search, triage, draft and **send** email from your own Gmail account |
| [**whatsapp-mcp**](packages/whatsapp-mcp) | Send WhatsApp messages and approved templates from your own business number |

## The one rule: your credentials are yours

Every connector here is **bring your own app**. You create your own Google or
Meta application, authorize your own account, and the credential never leaves
your machine. We do not host a service, we do not proxy your data, and there is
no PappCorn account in the middle of your mailbox.

This is more setup than clicking "connect". It is also the only version where
the honest answer to *"who else can read my email?"* is **nobody**.

It has a second benefit that is easy to miss: because you run your own app for
your own account, you never cross the thresholds that force expensive vendor
security reviews. Those exist to protect other people's data from a shared app.
With one user, there is no shared app.

### Why we build our own connectors

Installing a connector means handing an agent real power over a real account.
An unmaintained third-party server is a supply-chain risk and a prompt-injection
surface. We write and maintain these ourselves so the tool surface is small,
auditable and deliberate — and so you can read every line before you trust it.

## Install

Add the marketplace once, then install what you need:

```
/plugin marketplace add pappcorn/universe
/plugin install gmail-mcp@pappcorn
/plugin install whatsapp-mcp@pappcorn
```

The plugin asks for your credentials at install time and stores them in your
operating system's keychain.

Each connector needs a one-time account setup first:

- **Gmail** → [docs/setup-google-cloud.md](docs/setup-google-cloud.md) (~15 min)
- **WhatsApp** → [docs/setup-meta-whatsapp.md](docs/setup-meta-whatsapp.md)

Prefer wiring it up by hand, or not using the plugin system? See
[docs/install.md](docs/install.md).

## What these connectors will not do

- **No autonomous action.** They act when you ask. Nothing watches your inbox
  and replies on its own.
- **Sending always confirms first** — recipient, subject and full body.
- **Gmail never deletes mail.** It can label and archive; that is all.

## Repository layout

```
packages/    connectors and libraries (each publishable on its own)
apps/        deployable applications
tools/       operator scripts
docs/        setup guides
```

An Nx monorepo. `npm install`, then `npx nx run-many -t build`.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

These connectors are also used internally at PappCorn, so improvements made here
get pulled back into our own stack. Fixing something for yourself likely fixes it
for us too.

## License

MIT — see [LICENSE](LICENSE).
