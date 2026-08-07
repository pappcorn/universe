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
- **Test.** `npx nx run-many -t test` where a connector has tests (Node's
  built-in runner — no test framework to install). Logic that decides _which
  account a credential belongs to_, or whether a credential file gets
  overwritten, should come with tests: those are the paths that hurt when wrong.
- **Actually run it.** Every connector has a CLI (`npm run gmail -- whoami`,
  `npm run whatsapp -- whoami`). Exercise the path you changed against a real
  account — these tools touch real inboxes and real people. If you can't, say so
  in the PR rather than implying you did.
- **Format.** `npm run format`.

## How a PR gets merged

Every PR runs four checks: **CI** (`nx affected` lint/test/build),
**`claude-review`** — an automated code review (workflow "Claude Code Review")
that posts a `## Findings` comment and fails the check while any 🔴 Important
finding remains — plus **CodeQL** and a **secret scan** on the diff. 🟡 Nit and
🟣 Pre-existing review findings never block.

To clear a red review, fix the 🔴 findings and push (the gate re-runs on every
push and only grades the current diff), or reply on the PR mentioning `@claude`
if you believe a finding is wrong. Maintainers can run this loop with the
`/review-loop` skill in `.claude/skills/review-loop/`.

When the checks are green, the `ready-to-merge` label is the request to merge.

### Who can approve

Three maintainers own this repo: **@ni500**, **@lcaloguerea**, and
**@cris-pappcorn** — PappCorn's AI agent, a maintainer here in the same sense as
the other two. `main` is protected and requires a code-owner approval, so that is
a real permission, not a courtesy title. It comes with a boundary that is
enforced in code, not in a promise, by
[`.github/workflows/cris-approve.yml`](.github/workflows/cris-approve.yml):

**Cris only signs where its signature cannot be the thing that lets unreviewed
code through.** Who approves depends on who wrote the PR:

| PR author          | Who approves                                                                                                                                                                                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A human code owner | **Cris can approve and arm the merge.** The author is the human in the loop — they wrote it — and GitHub will not let them approve themselves. This is the one deadlock the agent exists to break, and it includes changes under `.github/`, except the two carve-out files below. |
| Cris               | **A human code owner.** Cris never approves its own PRs, and GitHub blocks self-approval outright.                                                                                                                                                                                 |
| Anyone else        | **A human code owner.** Cris may review and comment, but it never approves code from an author who is not already a code owner of everything they touched. If you are new here, a human reads your PR. Full stop.                                                                  |

Two files are carved out and stay owned by humans only, no matter who authored
the change: [`cris-approve.yml`](.github/workflows/cris-approve.yml) and
[`CODEOWNERS`](.github/CODEOWNERS) itself. They define **who approves** — an
agent must never be able to sign changes to its own approver. A PR touching
either always waits for a human who did not write it. On those paths Cris may
still leave a review, but it is explicitly **non-binding**: GitHub keeps
waiting for the real owner.

Where Cris does approve, it arms GitHub's **native auto-merge**, which waits
for every branch protection rather than overriding any. Cris never merges
directly and never uses an admin bypass.

Dependency bumps follow the same logic in
[`dependabot-auto-merge.yml`](.github/workflows/dependabot-auto-merge.yml):
routine patch/minor bumps that touch nothing under `.github/` merge on their own
once green; majors and workflow bumps wait for a human.

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
