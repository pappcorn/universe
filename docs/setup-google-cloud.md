# Connect your own Gmail account

This guide gets your assistant sending email **from your own address**, in about
15 minutes. You will create your own Google app — nothing is shared with
PappCorn or anyone else.

> Prefer pictures? The same walkthrough exists with screenshots — including
> the "Google hasn't verified this app" warning — at
> [how-to-gmail.md](how-to-gmail.md).

## Why this is not one click

Claude's built-in Google connector can read, search and **draft** your mail, but
it deliberately **cannot send**. If you want an assistant that actually sends,
something has to hold a credential with permission to send as you.

There are only two ways to get that credential:

1. Use somebody else's published app and trust them with your mailbox.
2. **Create your own app and keep the credential on your own machine.**

We build option 2, and only option 2. It is more setup, and it is the only
version where the answer to "who can read my email?" is "nobody but me."

A side effect worth knowing: because the app is yours and you are its only
user, you never need Google's security review. That review — the thing that
makes publishing a Gmail app expensive and slow — exists to protect _other_
people's mailboxes from _your_ app. With one user, there are no other people.

---

## Before you start

- A Google account (personal `@gmail.com` or Workspace — both work).
- Node.js 20 or newer (`node --version`).

No cloning required — the setup and verification commands below run straight
off the published npm package via `npx`.

---

## Step 1 — Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com).
2. Click the project dropdown in the top bar → **New Project**.
3. Name it something you will recognize (e.g. `my-assistant`) → **Create**.
4. Make sure the new project is selected in that dropdown before continuing.

> Google Cloud is free for this. The Gmail API has no cost at personal volume,
> and nothing here requires a billing account.

## Step 2 — Enable the Gmail API

1. In the search bar, type **Gmail API** and open it.
2. Click **Enable**.

If you skip this, everything else appears to work and then fails at the last
step with a confusing error. Do not skip it.

## Step 3 — Configure the consent screen

This is the screen you will see when you authorize your own app.

1. Go to **APIs & Services → OAuth consent screen** (in newer consoles this may
   be called **Google Auth Platform → Branding / Audience**).
2. **User type: External.**
   - Personal `@gmail.com` accounts have no choice here — "Internal" only
     exists for Google Workspace organizations. External is correct.
   - External does **not** mean public. Your app stays yours.
3. Fill in the required fields: app name, your email as support contact, your
   email as developer contact. Nothing here is published anywhere.
4. **Add the scopes** your assistant needs:
   - `https://www.googleapis.com/auth/gmail.modify` — read, search, label, archive
   - `https://www.googleapis.com/auth/gmail.send` — send

## Step 4 — ⚠️ Publish the app to Production

**This is the step everyone gets wrong, and it is the one that matters.**

On the consent screen page, find **Publishing status** and click
**Publish app** so the status reads **In production**.

Why: an app left in **Testing** issues refresh tokens that **expire after 7
days**. Everything will work perfectly today, and then your assistant will
silently lose access next week. Publishing to Production makes the credential
durable.

You do **not** need Google's verification to publish. An unverified app in
production works fine — it simply shows a warning screen the first time you
authorize it (Step 6), and it is capped at 100 users. You are one user.

## Step 5 — Create the OAuth client

1. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. **Application type: Desktop app.** (This matters: Desktop clients can use a
   local loopback redirect, so you don't have to host anything.)
3. Name it, click **Create**, then **Download JSON**.
4. Keep that file somewhere you can point at in the next step.

## Step 6 — Mint your refresh token

From any terminal (no clone needed):

```bash
npx -y -p @pappcorn/gmail-mcp pappcorn-gmail-setup --client ~/Downloads/client_secret_xxx.json --account you@example.com
```

(From a clone of this repo, the equivalent is
`cd packages/gmail-mcp && npm run mint-token -- --client ... --account ...`.)

The `--account` flag is optional but recommended: it makes the script refuse to
save anything if you accidentally log in with a different Google account.

The script prints a URL. Open it and:

- **You will see "Google hasn't verified this app". This is expected** — the app
  is yours and you never asked Google to review it. Click **Advanced**, then
  continue.
- Approve the Gmail permissions.
- The browser redirects to a local address; the script catches it and closes.

It then prints which mailbox authorized it and writes the credential with
`chmod 600` — `~/.config/pappcorn-gmail-mcp/credentials.json` for your first
mailbox. **Your refresh token is never printed to the screen** — it only lands
in that file.

The script will not silently overwrite a credential that belongs to a different
mailbox, and it never follows a symlink at the destination without telling you.
See [One machine, several mailboxes](#one-machine-several-mailboxes).

## Step 7 — Verify

```bash
npx -y -p @pappcorn/gmail-mcp pappcorn-gmail whoami
```

You should see your own email address, message and thread totals, and a
`credential:` line naming where that credential was read from. If you do, you
are done.

Then delete the OAuth client JSON you downloaded — its contents now live in the
credential file.

---

## Where the credential comes from

The connector resolves the credential **from the working directory it is
started in**, never from where the package happens to be installed. Highest
precedence first:

| #   | Source                                                                               | Who uses it                                                |
| --- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| 1   | `GMAIL_CLIENT_ID` + `GMAIL_CLIENT_SECRET` + `GMAIL_REFRESH_TOKEN` in the environment | The Claude plugin — from your OS keychain, nothing on disk |
| 2   | The nearest `.env`                                                                   | Per-project setups: "this folder is that mailbox"          |
| 3   | `$GMAIL_MCP_CREDENTIALS`                                                             | Explicit per-process overrides, scripts                    |
| 4   | `~/.config/pappcorn-gmail-mcp/credentials.json`                                      | The single-mailbox default; still supported forever        |

**The `.env` search** starts in the working directory and walks up, stopping at
the first `.env` it finds. It stops at your repository root (the directory
holding `.git`) and never looks inside your home directory, so a stray `~/.env`
cannot quietly reroute every project on the machine. If no `.env` is in scope,
none is borrowed from anywhere else — resolution simply continues at row 3.

A `.env` **fills in** what the environment does not already set; it never
overrides a variable that is already there. So installing the plugin with
credentials in your keychain keeps working exactly as before, `.env` or not.

`whoami` prints which row won:

```
mailbox:    you@example.com
messages:   12043
threads:    8120
credential: ~/.config/gmail/work.json — resolved from ~/code/work-project/.env
```

---

## One machine, several mailboxes

A work mailbox and a personal one. Two clients. A shared address and your own.
This is the normal case, and the answer is one credential file per mailbox plus
one `.env` per project.

**1. Mint each mailbox.** Run Step 6 once per account. The first one lands in
the default path; every later one gets its own file, because overwriting the
first would destroy a refresh token that cannot be recovered:

```
~/.config/pappcorn-gmail-mcp/credentials.json          # you@personal.com
~/.config/pappcorn-gmail-mcp/you_at_work.com.json      # you@work.com
```

(Pass `--out <path>` if you want to choose the filenames yourself.)

**2. Point each project at one.** In the project folder — or its repo root —
create a `.env`:

```bash
GMAIL_MCP_CREDENTIALS=~/.config/pappcorn-gmail-mcp/you_at_work.com.json
GMAIL_ACCOUNT=you@work.com
```

**`GMAIL_ACCOUNT` is an assertion, not a label.** Before the connector does
anything, it asks Gmail which mailbox the credential actually opens. If the
answer is not the one you declared, it refuses — it does not guess, and it does
not fall back. Set it on every project where sending from the wrong address
would matter, which is most of them.

> ### ⚠️ If that folder is a git repository, `.env` must be in `.gitignore`
>
> A refresh token pushed to a remote is a **total leak**: it is a permanent key
> to your mailbox, and it survives in forks, clones, CI caches and mirrors long
> after you delete the commit. Assume anything pushed is burned — revoke it
> under your Google account → Security → third-party access, and mint a new one.
>
> The safest habit is to keep secrets out of the repository entirely: put only
> `GMAIL_MCP_CREDENTIALS` in `.env`, pointing at a credential file that lives
> under `~/.config`. Then the worst case of a leaked `.env` is a path.
>
> A `.env` is also a file that configures your mail access, so treat one you
> did not write with the same care as any other file in a repository you did
> not write.

**Registering more than one at once.** A running server is bound to exactly one
credential — there is no account-switching tool, by design. To have both
mailboxes available in a single session, register the server twice with
different names; see
[the connector README](../packages/gmail-mcp/README.md#multiple-mailboxes-one-google-cloud-project).

**Existing setups do not need to change.** If one mailbox on the default path is
all you have, nothing above applies to you and nothing has moved.

---

## Installing it into Claude

See [install.md](install.md) for wiring the connector into Claude Desktop or
Claude Code.

---

## When something breaks

| Symptom                                  | Cause                                     | Fix                                                                                 |
| ---------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------- |
| Worked for a week, then stopped          | App is in **Testing** status              | Publish to Production (Step 4), re-run Step 6                                       |
| `invalid_grant` right away               | Token revoked, or password changed        | Re-run Step 6                                                                       |
| Fails at Step 6 with an API error        | Gmail API not enabled                     | Step 2, then retry                                                                  |
| "Google hasn't verified this app"        | Normal for your own app                   | Advanced → continue                                                                 |
| No refresh token returned                | Google reused an old grant                | Revoke the app under your Google account's Security → third-party access, re-run    |
| Wrong mailbox, or `whoami` surprises you | The folder resolves to another credential | Run `whoami` and read its `credential:` line; fix the `.env`                        |
| "GMAIL_ACCOUNT asserts …"                | The assertion caught a mismatch           | Correct `.env`, or clear `GMAIL_ACCOUNT` and `whoami` to see what the credential is |
| Setup refuses to write                   | The destination holds another mailbox     | Use `--out <path>`, or `--force` if you really mean to replace it                   |

Changing your Google password revokes Gmail-scoped tokens. That is Google
protecting you, not a bug — just re-run Step 6.

---

## Hardening — how to make this stricter

The v1 above is the smallest thing that works. If you want to tighten it:

**Narrow the scopes.** `gmail.modify` lets the assistant read everything. If you
only want it to _send_, use `gmail.send` alone: edit `SCOPES` in both
`src/auth.ts` and `scripts/mint-token.mjs`, remove `gmail.modify` from the
consent screen, and re-mint. The read/search/label/archive tools will stop
working — by design. `gmail.send` is also a _sensitive_ rather than _restricted_
scope in Google's classification, a lower tier.

**Use a dedicated account.** Point the assistant at a purpose-made address that
forwards from your main one, instead of your primary mailbox. Then the blast
radius of a leaked credential is one inbox you control.

**Keep the credential off disk.** Installing as a Claude plugin stores your
secrets in the OS keychain and passes them to the server as environment
variables, so no credential file exists at all.

**Rotate deliberately.** To revoke everything instantly, go to your Google
account → Security → third-party access, and remove the app. Re-mint when you
want it back.

**If you ever share this beyond yourself,** you leave single-user territory: past
100 users, or to remove the warning screen, Google requires OAuth verification —
and for restricted scopes like `gmail.modify`, an annual third-party security
assessment. That is a real cost. Keeping one app per person avoids it entirely.

---

## What v1 does not do

- **No auto-replies, no inbound triggers.** The assistant acts when you ask it
  to. It does not watch your inbox and act on its own.
- **Sending always confirms first.** Recipient, subject and full body are shown
  to you before anything goes out.
- **It never deletes mail.** It can label and archive; that is all.
