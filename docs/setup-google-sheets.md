# Connect your own Google account to the Sheets connector

This is the setup guide for [`gsheets-mcp`](../packages/gsheets-mcp/README.md) — the connector
that lets your assistant **edit spreadsheets that were shared with you**.

About 15 minutes the first time. **About 3 minutes if you already set up the
[Gmail connector](setup-google-cloud.md)** — jump to [the short path](#the-short-path) below.

---

## The one idea that makes the rest make sense

You are not connecting Claude to Google. **You are creating your own tiny Google app**, one
that only you can use, **and lending Claude its key.** Nobody else — not PappCorn, not
Anthropic — is in that loop.

That matters more here than it does for mail, because this connector **writes**. Every edit it
makes shows up in the spreadsheet's revision history under **your name**. So the account you
log in with at the end is not a detail: it is the identity that will appear next to every
change.

And the flip side is the safety story: a token minted by logging in as you can only ever reach
what **you** can already reach. A spreadsheet nobody shared with you does not exist for the
connector.

---

## The short path

**If you already set up the Gmail connector, you do not need a new Google Cloud project or a
new OAuth client.** Reuse the one you have:

1. Open [console.cloud.google.com](https://console.cloud.google.com) and select the **same
   project** you made for Gmail.
2. Enable **two** more APIs — _Google Sheets API_ and _Google Drive API_
   ([Step 2](#step-2--enable-the-two-apis) below).
3. Add the **three Sheets scopes** to the same consent screen
   ([Step 3](#step-3--add-the-scopes)). The Gmail scopes stay; you are adding, not replacing.
4. Re-mint, pointing at the OAuth client JSON you already downloaded:

   ```bash
   npx -p @pappcorn/gsheets-mcp pappcorn-gsheets-setup \
     --client ~/Downloads/client_secret_....json \
     --account you@yourcompany.com
   ```

   This writes a **separate** credential at `~/.config/pappcorn/gsheets-mcp/credentials.json`.
   Your Gmail credential is untouched — the two connectors hold different tokens with
   different scopes, which is the point.

5. [Install the plugin](#step-6--install-it-into-claude) and verify.

If you have never done the Google Cloud part, start here instead.

---

## Before you start

- A Google account. If it belongs to a Google Workspace organisation, your admin may restrict
  creating projects — check before you spend the 15 minutes.
- Node 20 or newer, to run the one setup command.

> **Workspace note.** If your Google account and the app you create live in the **same
> Workspace organisation**, Google does _not_ show the "unverified app" warning at the end.
> If you are on a personal `@gmail.com` account, you will see it, and it is expected — the app
> is yours, so Google has never heard of it.

---

## Step 1 — Create a Google Cloud project

Open [console.cloud.google.com](https://console.cloud.google.com) and click the project
dropdown in the top bar.

![Console top bar with the project dropdown](assets/gmail-setup/01-project-dropdown.png)

![Select-a-resource dialog with the New project button](assets/gmail-setup/01b-select-project-dialog.png)

Name it something you will recognise in a year — `my-assistant` is fine. No organisation
needed if you are on a personal account.

![New Project form filled in](assets/gmail-setup/02-new-project.png)

## Step 2 — Enable the two APIs

**This is the step people skip, and it produces the most confusing failure**: the connector
authenticates fine and then every call returns a 403.

With your new project selected, search the console for **Google Sheets API** and click
**Enable**. Then do it again for **Google Drive API**.

| API                   | Why the connector needs it                                                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Google Sheets API** | Reading and writing cells. Without it, nothing works at all.                                                                                                                                                              |
| **Google Drive API**  | Finding a spreadsheet by name (`sheet_locate`) and converting an `.xlsx` (`sheet_import_xlsx`). Without it, those two tools fail while everything else works — which is exactly the symptom in the troubleshooting table. |

The screens look identical to the Gmail ones, just with a different API name in the search box.

## Step 3 — Add the scopes

Go to **Google Auth Platform** and run the setup wizard if you have not configured a consent
screen on this project yet.

![Google Auth Platform not configured yet — Get started](assets/gmail-setup/05-auth-platform-get-started.png)

![App Information step with name and support email](assets/gmail-setup/06-app-information.png)

Choose **External** for the audience.

![Audience step with External selected](assets/gmail-setup/07-audience-external.png)

![OAuth overview after the wizard](assets/gmail-setup/08-auth-overview-configured.png)

Now open **Data Access** and add these three scopes. The picker does not always list them, so
paste them manually:

```
https://www.googleapis.com/auth/spreadsheets
https://www.googleapis.com/auth/drive.readonly
https://www.googleapis.com/auth/drive.file
```

| Scope            | What it buys                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| `spreadsheets`   | Read **and write** every spreadsheet your account can already open. The one that does the work.           |
| `drive.readonly` | Find spreadsheets by name; read an `.xlsx` before converting it.                                          |
| `drive.file`     | Create the converted Sheet. Scoped to files this app creates — it can never touch the rest of your Drive. |

**Want less?** If you always paste explicit spreadsheet links and never convert `.xlsx`, add
only `spreadsheets`. You lose `sheet_locate` and `sheet_import_xlsx`; everything else keeps
working. You would then also trim `SCOPES` in
[`src/auth.ts`](../packages/gsheets-mcp/src/auth.ts) to match.

Save, and check the scopes are listed before moving on.

## Step 4 — ⚠️ Publish the app to Production

**Do not skip this.** An app left in _Testing_ has its refresh tokens **expire after 7 days**.
Everything will work today and break next week with `invalid_grant`.

On the **Audience** page, click **Publish app**.

![Audience page showing Testing status and Publish app button](assets/gmail-setup/10-publishing-testing.png)

![Push to production confirmation dialog](assets/gmail-setup/10b-publish-confirm.png)

Confirm it now reads **In production**.

![Audience page showing In production](assets/gmail-setup/10-publish-production.png)

## Step 5 — Create the OAuth client and mint the token

Create an OAuth client of type **Desktop app** and download its JSON.

![Create OAuth client form, Desktop app type](assets/gmail-setup/11-create-client.png)

![OAuth client created dialog](assets/gmail-setup/12-client-created.png)

Then run:

```bash
npx -p @pappcorn/gsheets-mcp pappcorn-gsheets-setup \
  --client ~/Downloads/client_secret_....json \
  --account you@yourcompany.com
```

**Pass `--account`.** It is optional, but here it earns its keep: the script refuses to write
the credential if you log in as the wrong Google account. Since every edit is attributed to
whoever granted the token, a token for the wrong account is worse than no token — and browsers
love to auto-select a session you did not mean.

The command prints a URL. Open it, pick the account, and approve.

![Google account chooser](assets/gmail-setup/13-choose-account.png)

If you see the unverified-app warning, click **Advanced** and continue. Your app is yours;
Google has never heard of it.

![Google hasn't verified this app warning](assets/gmail-setup/14-unverified-warning.png)

![Warning screen with Advanced expanded showing the continue link](assets/gmail-setup/14b-unverified-advanced.png)

The permission screen will list spreadsheet and Drive access — read it, then approve. The
script catches the redirect, verifies which account authenticated, prints that address, and
writes `~/.config/pappcorn/gsheets-mcp/credentials.json` with mode `600`.

**The refresh token is never printed.** It only lands in that file.

Now delete the downloaded OAuth client JSON. Its fields live in the credential file.

## Step 6 — Install it into Claude

```
/plugin marketplace add pappcorn/universe
/plugin install gsheets-mcp@pappcorn-plugins
```

In **Claude Desktop's `Code` tab there is no `/plugin` command** — use the **`+`** button next
to the prompt box and the plugin browser instead.

Restart Claude, then ask it to run `sheet_whoami`. It should name your account. That is the
check worth doing before any write session: it tells you, out loud, whose name is going on the
edits.

---

## Where the credential lives

Two ways to supply it, checked in this order:

1. **Environment** — `GSHEETS_CLIENT_ID`, `GSHEETS_CLIENT_SECRET`, `GSHEETS_REFRESH_TOKEN`.
   This is what the plugin uses: collected at install time, stored in your OS keychain, never
   written to disk.
2. **Credential file** — `$GSHEETS_MCP_CREDENTIALS`, else
   `~/.config/pappcorn/gsheets-mcp/credentials.json` (mode `600`). This is what the setup
   script writes.

Anyone holding that file can read **and edit** every spreadsheet your account can open. Treat
it like a password.

### Everything lives under one folder

This connector keeps its three kinds of local state under a single `pappcorn/` parent, one
subdirectory per connector:

| What               | Where                                              |
| ------------------ | -------------------------------------------------- |
| Credential         | `~/.config/pappcorn/gsheets-mcp/credentials.json`  |
| Access-token cache | `~/.cache/pappcorn/gsheets-mcp/token.json`         |
| Write audit log    | `~/.local/state/pappcorn/gsheets-mcp/writes.jsonl` |

That grouping is about **revocation, not tidiness**. Someone who wants to know what their
assistant can reach — or to cut it off entirely — should have one place to look and one thing
to delete, not a handful of sibling folders to remember. It matters most in an offboarding,
where "delete this folder" has to be an instruction a non-technical person can follow without
wondering whether they missed one.

> The Gmail connector still writes to `~/.config/pappcorn-gmail-mcp/`, the older flat layout.
> It will move under `~/.config/pappcorn/gmail-mcp/` with a fallback for existing installs —
> that is a separate change, because it has live users and breaking their credential path
> silently would be worse than the inconsistency.

**Two ways to revoke, and they are not the same thing:**

- **Delete the folder** — this machine stops working. The token still exists.
- **Google account → Security → third-party access → remove the app** — the token dies
  everywhere, on every machine, immediately. This is the one that actually revokes.

Do the second one in an offboarding. Do both if the laptop is out of your hands.

---

## When something breaks

| Symptom                                                            | Cause                                                                                                                                                    |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invalid_grant` after about a week                                 | The app is still in _Testing_. Publish it to Production ([Step 4](#step-4--️-publish-the-app-to-production)) and re-mint.                                |
| Everything 403s right after setup                                  | The Google Sheets API is not enabled on the project ([Step 2](#step-2--enable-the-two-apis)).                                                            |
| `sheet_locate` and `sheet_import_xlsx` fail, everything else works | The Google **Drive** API is not enabled. Same step.                                                                                                      |
| `403` on a file you can see in Drive                               | Your account has **view** access, not **edit**. Sheets writes need edit — ask the owner.                                                                 |
| `404` on an id you copied                                          | The file was never shared with the account that granted the token. Run `sheet_whoami` and check it is the account you expected.                          |
| "over the 5000-cell read limit"                                    | Working as designed. Use `sheet_find` to locate the rows, then read only those.                                                                          |
| A write comes back **REFUSED**                                     | Someone edited the range between the preview and your confirmation, or the confirmation was already used. Read the fresh before/after and approve again. |
| `sheet_whoami` names the wrong account                             | You logged in as the wrong one. Re-run the setup with `--account`.                                                                                       |

---

## What this does not do

- **It cannot open an `.xlsx`.** The Google Sheets API simply cannot — a real Excel file in
  Drive is an opaque blob to it. `sheet_import_xlsx` makes a converted copy and leaves the
  original alone. See the connector README for the conversation to have with your team before
  converting a file someone re-uploads every month.
- **It cannot share, move, or change permissions** on a file.
- **It cannot write without you.** Every write is previewed and confirmed, and there is no
  bypass flag.
