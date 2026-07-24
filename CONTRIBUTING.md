# Contributing

Thanks for being here. These connectors are used in production at PappCorn, so
good contributions get pulled back into our own stack — fixing something for
yourself likely fixes it for us too.

## Getting set up

```bash
git clone https://github.com/pappcorn/universe.git
cd universe
npm install
npx nx run-many -t build
```

Node 20+. It's an Nx monorepo; each connector under `packages/` is also a
standalone publishable npm package.

## Before you open a PR

- **Build cleanly.** `npx nx run-many -t build` with no errors.
- **Actually run it.** Every connector has a CLI (`npm run gmail -- whoami`,
  `npm run whatsapp -- whoami`). Exercise the path you changed against a real
  account — these tools touch real inboxes and real people.
- **Format.** `npm run format`.

## How a PR gets merged

Every PR runs two checks: **CI** (`nx affected` lint/test/build) and
**`claude-review`** — an automated code review (workflow "Claude Code Review")
that posts a `## Findings` comment and fails the check while any 🔴 Important
finding remains. 🟡 Nit and 🟣 Pre-existing findings never block.

To clear a red review, fix the 🔴 findings and push (the gate re-runs on every
push and only grades the current diff), or reply on the PR mentioning `@claude`
if you believe a finding is wrong. Maintainers can run this loop with the
`/review-loop` skill in `.claude/skills/review-loop/`.

When the checks are green, the `ready-to-merge` label signals that a PR is
ready for human review: adding it triggers a comment asking the code owners
(@ni500, @lcaloguerea) to approve. The label never merges anything — `main` is
protected and a human code-owner approval is always required.

## The rules that aren't negotiable

These connectors hold credentials for people's email and phone numbers. A few
things we will not merge:

1. **No secret ever gets printed, logged, or returned by a tool.** Not in an
   error message, not in a debug line, not in a stack trace.
2. **No credential leaves the user's machine.** No telemetry, no phone-home, no
   "anonymous usage stats". If a connector needs to talk to anything other than
   the vendor's own API, that needs discussion first.
3. **No hardcoded account, tenant, number, or ID.** Everything comes from
   configuration. Someone else's setup must never be baked into the source.
4. **Outward-facing actions confirm first.** Sending an email or a WhatsApp
   message reaches a real person and can cost money. Tools that do this state it
   plainly in their description so the model asks before acting.
5. **Destructive operations stay out.** The Gmail connector labels and archives;
   it does not delete. If you need deletion, fork it.

## Adding a new connector

Same shape as the existing ones:

```
packages/<name>-mcp/
├── .claude-plugin/plugin.json   # plugin manifest + userConfig for secrets
├── .mcp.json                    # how the server is launched
├── package.json                 # publishable, own dependencies
├── tsconfig.lib.json
├── README.md
└── src/
    ├── config.ts   # env → typed config. process.env only.
    ├── core.ts     # typed API operations
    ├── tools.ts    # MCP tool definitions (transport-agnostic)
    ├── server.ts   # buildServer() shared by all transports
    ├── mcp.ts      # stdio entry point
    └── cli.ts      # CLI entry point
```

Then add it to `.claude-plugin/marketplace.json` and write a setup guide in
`docs/`.

**Bring your own app.** Any new connector must let each user supply their own
application credentials for their own account. We do not ship a shared
application that proxies other people's data.

## Reporting a security issue

Please do **not** open a public issue. Email `hola@pappcorn.com` with details
and we'll respond.

## Language

Code, comments and docs are in English so the widest set of people can
contribute. Issues and PR discussion in English or Spanish are both fine.
