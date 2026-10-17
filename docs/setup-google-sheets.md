# Connect your own Google Sheets account

This guide gets your assistant **editing spreadsheets that were shared with
you**, in about 10 minutes. You will create your own Google app — nothing is
shared with PappCorn or anyone else.

> Already set up Gmail? Sheets needs **different APIs, scopes and a token of
> its own**. The Gmail guide enables only the Gmail API, so a Gmail credential
> cannot open a spreadsheet. You can reuse the same Google Cloud project if you
> like; you still need to follow every step below.

## Why this is not one click

A connector that can _write_ to spreadsheets has to hold a credential with
permission to edit them as you. There are only two ways to get that:

1. Use somebody else's published app and trust them with every spreadsheet you
   can open.
2. **Create your own app and keep the credential on your own machine.**

We build option 2, and only option 2. The credential is a refresh token minted
by logging in as one Google account, so it can only ever reach what that
account can already reach. (A service account with domain-wide delegation, the
other common approach, can impersonate _anyone_ in a Workspace domain and
cannot be narrowed to one person.)

---

## Before you start

- A Google account (personal `@gmail.com` or Workspace — both work). Every edit
  the connector makes is attributed to this account, so pick the one that
  should appear in the spreadsheets' edit history.
- Node.js 20 or newer (`node --version`).

No cloning required — the setup command below runs straight off the published
npm package via `npx`.

---

## Step 1 — Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com).
2. Click the project dropdown in the top bar → **New Project**.
3. Name it something you will recognize (e.g. `my-assistant`) → **Create**.
4. Make sure the new project is selected in that dropdown before continuing.

> Google Cloud is free for this. The Sheets and Drive APIs have no cost at
> personal volume, and nothing here requires a billing account.

## Step 2 — Enable two APIs

Enable **both**:

1. Search for **Google Sheets API** → open it → **Enable**.
2. Search for **Google Drive API** → open it → **Enable**.

Missing the Drive API is the most common setup failure. The setup script uses
it to confirm which account you logged in as, so without it Step 6 fails at the
last moment; `sheet_locate` and `sheet_import_xlsx` need it too.

## Step 3 — Configure the consent screen

This is the screen you will see when you authorize your own app.

1. Go to **APIs & Services → OAuth consent screen** (in newer consoles,
   **Google Auth Platform**).
2. Run the wizard to the end **before** looking for the scopes: App Information
   → Audience **External** → Contact → Finish. The **Data Access** page, where
   scopes live, only becomes usable once the app exists.
   - Personal `@gmail.com` accounts have no choice here — "Internal" only
     exists for Google Workspace organizations. External is correct.
   - External does **not** mean public. Your app stays yours.
3. Under **Data Access**, add the three scopes:
   - `https://www.googleapis.com/auth/spreadsheets` — read and write the
     spreadsheets your account can already open. The one that does the work.
   - `https://www.googleapis.com/auth/drive.readonly` — find spreadsheets by
     name; read an `.xlsx` before converting it.
   - `https://www.googleapis.com/auth/drive.file` — create the converted Sheet.
     Limited to files this app creates; it can never touch the rest of your
     Drive.

Only want to work with spreadsheet links you paste in? See
[Narrow the scopes](#narrow-the-scopes) below.

## Step 4 — ⚠️ Publish the app to Production

**This is the step everyone gets wrong, and it is the one that matters.**

Go to **Audience** → **Publish app**, so the status reads **In production**.

Why: an app left in **Testing** issues refresh tokens that **expire after 7
days**. Everything will work today, and next week the connector fails with
`invalid_grant`.

The console will push **verification** at you around this step. Publishing and
verifying are separate flows: **Publish app** is the one you need, and the
_Verification Center_ can be left alone. An unverified production app works —
it shows a warning screen the first time you authorize it (Step 6), and it is
capped at 100 users for the project's lifetime. You are one user.

## Step 5 — Create the OAuth client

1. Go to **APIs & Services → Credentials → Create Credentials → OAuth client
   ID** (or **Google Auth Platform → Clients**).
2. **Application type: Desktop app.** (This matters: Desktop clients can use a
   local loopback redirect, so you don't have to host anything.)
3. Name it, click **Create**, then **Download JSON**.
4. Keep that file somewhere you can point at in the next step.

## Step 6 — Mint your refresh token

From any terminal (no clone needed):

```bash
npx -y -p @pappcorn/gsheets-mcp pappcorn-gsheets-setup --client ~/Downloads/client_secret_xxx.json --account you@example.com
```

(From a clone of this repo, the equivalent is
`cd packages/gsheets-mcp && npm run mint-token -- --client ... --account ...`.)

The `--account` flag is optional but strongly recommended here: it makes the
script refuse to save anything if you log in with a different Google account,
and every edit the connector makes will carry that account's name.

The script prints a URL. Open it and:

- **You will see "Google hasn't verified this app". This is expected** — the app
  is yours and you never asked Google to review it. Click **Advanced**, then
  continue.
- Approve the Sheets and Drive permissions.
- The browser redirects to a local address; the script catches it and closes.

It then prints which account authorized it and writes the credential to
`~/.config/pappcorn-gsheets-mcp/credentials.json` with `chmod 600`. **Your
refresh token is never printed to the screen** — it only lands in that file.

> **Re-running replaces that file.** Unlike the Gmail setup, this script does
> not check what is already at the destination. To keep a credential for a
> second Google account, pass `--out <path>` for it, and point the connector at
> that file with `GSHEETS_MCP_CREDENTIALS`.

## Step 7 — Install and verify

Install the plugin and restart your assistant:

```
/plugin marketplace add pappcorn/universe
/plugin install gsheets-mcp@pappcorn-plugins
```

When the plugin asks for credentials, **leave all three fields empty**. Step 6
already wrote the credential file, and blank fields are what make the connector
read it. (Pasting the three values in instead also works: they go into your
operating system's keychain and no file is needed.)

In Claude Desktop's **Code** tab there is no `/plugin` command — use the **`+`**
button next to the prompt box and the plugin browser.

Then ask your assistant to run **`sheet_whoami`**. It should name your account.
If it does, you are done.

Delete the OAuth client JSON you downloaded — its contents now live in the
credential file.

Not using plugins? See [install.md](install.md) for wiring the connector into
any MCP client by hand.

---

## Where the credential comes from

Highest precedence first:

| #   | Source                                                                                     | Who uses it                                                |
| --- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| 1   | `GSHEETS_CLIENT_ID` + `GSHEETS_CLIENT_SECRET` + `GSHEETS_REFRESH_TOKEN` in the environment | The Claude plugin — from your OS keychain, nothing on disk |
| 2   | `$GSHEETS_MCP_CREDENTIALS`                                                                 | Explicit per-process overrides, a second account           |
| 3   | `~/.config/pappcorn-gsheets-mcp/credentials.json`                                          | The default; what Step 6 writes                            |

---

## What the connector will and won't do

- **Every write asks first.** A write tool called without confirmation does not
  write: it returns a before/after preview and stops. Only your "yes" commits
  it, and if someone else edited that range in the meantime the write is
  refused with a fresh preview.
- **Every committed write is logged locally** to
  `~/.local/state/pappcorn-gsheets-mcp/writes.jsonl` (timestamp, file, range,
  before, after). Override the directory with `GSHEETS_MCP_LOG_DIR`.
- **It never pulls a whole spreadsheet into the conversation.** Reads are
  capped at 5,000 cells and refuse a larger range instead of truncating it.
- **It works on native Google Sheets only.** An `.xlsx` in Drive is opaque to
  the Sheets API; `sheet_import_xlsx` makes a converted copy and leaves the
  original untouched.

The full tool list and how the confirmation token works are in
[the connector README](../packages/gsheets-mcp/README.md).

---

## When something breaks

| Symptom                                    | Cause                                       | Fix                                                                                 |
| ------------------------------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------- |
| Worked for a week, then `invalid_grant`    | App is in **Testing** status                | Publish to Production (Step 4), re-run Step 6 (pasted fields: see below the table)  |
| Step 6 fails with "grant verification"     | Drive API not enabled                       | Step 2, then retry                                                                  |
| `sheet_locate` fails, `sheet_whoami` works | Token lacks `drive.readonly`                | Add the scope (Step 3) and re-run Step 6                                            |
| "Google hasn't verified this app"          | Normal for your own app                     | Advanced → continue                                                                 |
| No refresh token returned                  | Google reused an old grant                  | Revoke the app under your Google account's Security → third-party access, re-run    |
| `403` on a file you can see in Drive       | The account has **view** access, not edit   | Ask for edit access; Sheets writes need it                                          |
| `404` on an id you copied                  | The file was never shared with this account | Run `sheet_whoami` and check which account the connector is acting as               |
| "over the 5000-cell read limit"            | Working as designed                         | Ask the assistant to find the rows first (`sheet_find`), then read only those       |
| A write is refused with a fresh preview    | Someone edited the range after the preview  | Read the new before/after and confirm again                                         |
| `whoami` names the wrong account           | You logged in as another account in Step 6  | Re-run Step 6 with `--account`, using an incognito window if the browser auto-picks |

If you pasted the credential into the plugin's fields (Step 7) instead of
leaving them empty, re-running Step 6 changes nothing: the connector reads the
fields first and never opens the new file. Clear the three fields, or paste the
new values into them, delete `~/.cache/pappcorn-gsheets-mcp/token.json`, and
restart your assistant.

With the Drive API off, Step 6 itself fails and no credential is written, so a
working `sheet_whoami` already rules that cause out.

---

## Hardening — how to make this stricter

### Narrow the scopes

If you always paste explicit spreadsheet links and never convert `.xlsx`, you
can remove `drive.readonly` from the consent screen and from `SCOPES` in both
`src/auth.ts` and `scripts/mint-token.mjs` (this means running from a clone),
rebuild, and re-mint. Keep `drive.file`: the account check in Step 6 and
`sheet_whoami` both read Drive's `about` endpoint, and `drive.file` is enough
for it while touching only files the connector creates. You lose
`sheet_locate` and `sheet_import_xlsx`, which reads the original `.xlsx`;
everything else keeps working.

It also changes the app's tier with Google: `drive.readonly` is a _restricted_
scope, the tier that requires an annual third-party security assessment if you
ever verify the app for other people. Without it the app is _sensitive_ at
most.

### Use a dedicated account

Share the spreadsheets the assistant should work on with a purpose-made Google
account, and mint the token as that account. The connector can then reach only
what you deliberately shared with it, and its edits are easy to tell apart from
yours in the version history.

### Keep the credential off disk

Paste the three values into the plugin's fields instead of leaving them empty.
They live in your OS keychain and reach the server as environment variables;
then delete `~/.config/pappcorn-gsheets-mcp/credentials.json`.

### Revoke

To cut access instantly, go to your Google account → Security → third-party
access, and remove the app. Then delete the credential file. Re-mint when you
want it back.
