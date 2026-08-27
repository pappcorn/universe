# Google Sheets connector

Lets your assistant **edit spreadsheets that were shared with you** — in place, cell by cell —
without ever pulling the file into its context.

Most Drive integrations can only read, and they read _everything_: ask about one cell in a
40,000-row sheet and the whole sheet goes into the context window. This one is built the other
way around. Its cost is a function of what you ask for, never of how big the file is, and it
can write.

Uses **your own** Google OAuth app. Your credentials never leave your machine, and the
connector can only reach what your Google account can already reach.

---

## What it can do

| Tool                 | What it does                                               | Cost             |
| -------------------- | ---------------------------------------------------------- | ---------------- |
| `sheet_whoami`       | Which Google account this connector is acting as           | flat             |
| `sheet_locate`       | Find spreadsheets by name among the files shared with you  | flat             |
| `sheet_info`         | Tabs, row/column counts, frozen headers — **no cell data** | flat             |
| `sheet_find`         | Search a range, get back **only where it matched**         | flat             |
| `sheet_read`         | Read an A1 range, hard-capped at 5,000 cells               | what you ask for |
| `sheet_update`       | Overwrite a range in an existing file                      | flat             |
| `sheet_append`       | Add rows after the last used row                           | flat             |
| `sheet_batch_update` | Several range edits, one atomic call, one confirmation     | flat             |
| `sheet_import_xlsx`  | Convert an `.xlsx` in Drive into a native Sheet            | flat             |

"Flat" means the same whether the spreadsheet has 40 rows or 400,000.

### The loop that makes big files cheap

```
sheet_info      → which tab, how many rows          (~200 tokens)
sheet_find      → "factura F-2291" is at C38104     (~50 tokens)
sheet_read      → just row 38104                    (~80 tokens)
sheet_update    → fix D38104                        (~100 tokens)
```

`sheet_find` is the piece that matters. The scan runs **inside the connector process**: it
pulls the range over HTTP, walks it in JavaScript, and returns only the matching A1
references. The 38,000 rows it walked through are discarded in Node and never reach the
model. Searching 50,000 rows costs about what searching 50 costs.

`sheet_read` is hard-capped at 5,000 cells and **refuses** a range over the cap rather than
truncating it, so you always know exactly what you got. There is deliberately no
"read the whole spreadsheet" function to reach for by accident.

---

## Every write is two-phase

A write tool called without `confirm_token` **does not write**. It reads what is in the target
range today, returns a before/after preview and a token, and stops.

```
1. sheet_update(file, "Movimientos!D38104", [["1250000"]])
   → PREVIEW
     BEFORE:  D38104 = 1150000
     AFTER:   D38104 = 1250000
     confirm_token: 9f2c1ab7de40551c

2. (the assistant shows that to you; you say yes)

3. sheet_update(..., confirm_token: "9f2c1ab7de40551c")
   → WRITTEN
```

The token is a fingerprint of _(file, range, **current state**, new values)_, so it does three
jobs at once:

- **The human gate.** No token, no write — enforced in the connector, not in a prompt that a
  model can talk itself out of.
- **Concurrency protection.** The token is recomputed at confirmation time. If anyone edited
  that range between the preview and the yes, the fingerprint no longer matches and the write
  is **refused**, with a fresh preview. A shared spreadsheet cannot be silently clobbered by a
  stale confirmation.
- **Single use.** The write moves the state the token was bound to, so the same token cannot
  be presented twice. One "yes" buys exactly one write.

**What "current state" means depends on the operation**, and getting this right is the whole
guarantee:

| Tool                                 | Bound to                                    |
| ------------------------------------ | ------------------------------------------- |
| `sheet_update`, `sheet_batch_update` | The values currently in the target range(s) |
| `sheet_append`                       | The **table's current height**              |

Append needs the special case because it overwrites nothing, so there is no prior grid to
fingerprint. Binding it to an empty "before" would leave the token a pure function of its own
arguments — valid forever, replayable, and blind to a concurrent append. Height fixes all
three: your own append moves it, and so does anyone else's.

There is no bypass flag. A connector that edits other people's spreadsheets should not ship
one.

Every committed write is appended to a local audit log at
`~/.local/state/pappcorn-gsheets-mcp/writes.jsonl` — timestamp, file, range, before, after.
Override the directory with `$GSHEETS_MCP_LOG_DIR`.

---

## About `.xlsx`

**The Google Sheets API cannot open an `.xlsx` file.** A real Excel file sitting in Drive is an
opaque blob to it — not a limitation of this connector, but of the API underneath. Every tool
here works on **native Google Sheets** only.

`sheet_import_xlsx` is the on-ramp: it converts an `.xlsx` into a native Sheet by making a
**converted copy**, leaving the original untouched so nobody loses the file they had. Do it
once per recurring file, then work the copy.

The thing to agree on with your team before converting: if someone keeps re-uploading a fresh
`.xlsx` every month, edits made in the converted Sheet will not appear in the next upload.
Decide which copy is the live one, and say so out loud.

---

## Setup

You need a Google Cloud project of your own. About ten minutes, once.

1. **Create a project** at [console.cloud.google.com](https://console.cloud.google.com).
2. **Enable two APIs**: _Google Sheets API_ **and** _Google Drive API_. Missing the Drive one
   is the most common setup failure — `sheet_locate` and `sheet_import_xlsx` need it.
3. **Configure the OAuth consent screen** — **Google Auth Platform** in newer consoles. Run its
   wizard to the end (App Information → Audience _External_ → Contact → Finish) _before_ going
   looking for the scopes: the **Data Access** page, where they live, only becomes usable once
   the app exists. Then add the three scopes listed below.
4. **Publish the app to Production** — **Audience** → **Publish app**. If you leave it in
   _Testing_, Google expires your refresh token after 7 days and the connector stops working
   with `invalid_grant`.

   The console will push **verification** at you around this step. Publishing and verifying are
   separate flows: `Audience → Publish app` is the one you need, and the _Verification Center_
   can be left alone. An unverified production app works — it shows a **"Google hasn't verified
   this app"** screen the first time you authorize it (**Advanced** → continue), and it caps the
   project at **100 users for its lifetime**, a cap that never resets. You are one user.

   Getting verified for real is the expensive path here: `drive.readonly` is one of Google's
   _restricted_ scopes, the tier that also wants an annual third-party security assessment.
   [Narrowing the scopes](#scopes) drops the app to _sensitive_ and avoids that tier entirely.

5. **Create an OAuth client** of type _Desktop app_ and download its JSON.
6. **Mint the token** — this logs you in and writes the credential file:

   ```bash
   npx -p @pappcorn/gsheets-mcp pappcorn-gsheets-setup \
     --client ~/Downloads/client_secret_....json \
     --account you@yourcompany.com
   ```

   Pass `--account` and the script refuses to write if you log into the wrong Google account.
   Worth it: every edit this connector makes is attributed to whoever granted the token.

7. **Install the plugin** and restart your assistant:

   ```
   /plugin marketplace add pappcorn/universe
   /plugin install gsheets-mcp@pappcorn-plugins
   ```

   Leave the three credential fields **empty**. Step 6 already wrote the credential file, and
   blank fields are exactly what makes the connector fall back to reading it.

   In Claude Desktop's `Code` tab there is no `/plugin` command — use the **`+`** button next
   to the prompt box and the plugin browser.

8. **Verify** — ask the assistant to run `sheet_whoami`. It should name your account.

### Scopes

| Scope            | Why                                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| `spreadsheets`   | Read and write the spreadsheets your account can already open. The one that does the work.                |
| `drive.readonly` | Find spreadsheets by name; read an `.xlsx` before converting it.                                          |
| `drive.file`     | Create the converted Sheet. Scoped to files this app creates — it can never touch the rest of your Drive. |

**Narrowing them:** if you always paste explicit spreadsheet links and never convert `.xlsx`,
drop `drive.readonly` and `drive.file` from both the consent screen and `SCOPES` in
`src/auth.ts`, and re-mint. You lose `sheet_locate` and `sheet_import_xlsx`; everything else
keeps working — and the app no longer asks for a _restricted_ scope at all.

### Credentials

Two ways to supply them, checked in this order:

1. **Environment** — `GSHEETS_CLIENT_ID`, `GSHEETS_CLIENT_SECRET`, `GSHEETS_REFRESH_TOKEN`.
   This is the plugin path: collected at install time, stored in your OS keychain, never
   written to disk.
2. **Credential file** — `$GSHEETS_MCP_CREDENTIALS`, else
   `~/.config/pappcorn-gsheets-mcp/credentials.json` (chmod 600). This is what the setup script
   writes.

**Why 3-legged OAuth and not a service account with domain-wide delegation:** domain-wide
delegation can impersonate _any_ user in a Workspace domain and cannot be narrowed to one
person. A refresh token minted by logging in as one account can only ever reach what that
account can already reach. For a tool that edits shared spreadsheets, that difference is the
whole security story.

---

## Troubleshooting

| Symptom                                     | Cause                                                                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `invalid_grant` after ~7 days               | The OAuth app is still in _Testing_. Publish it to Production and re-mint.                                                                       |
| "Google hasn't verified this app"           | Expected for an app you built for yourself. **Advanced** → continue. Verification is optional; the step you needed was `Audience → Publish app`. |
| `403` on a file you can see in Drive        | The account has **view** access, not **edit**. Sheets writes need edit.                                                                          |
| `404` on an id you copied                   | The file was never shared with the account that granted the token. Check `sheet_whoami`.                                                         |
| `sheet_locate` fails, everything else works | The Drive API is not enabled on your Cloud project.                                                                                              |
| "over the 5000-cell read limit"             | Working as designed. Use `sheet_find` to locate rows, then read those.                                                                           |
| A write is REFUSED with a fresh preview     | Someone edited the range after the preview. Read the new before/after and confirm again.                                                         |

---

## Development

```bash
npm install
npm run build          # tsc + esbuild bundle → server/mcp.cjs
```

The plugin runs the bundled `server/mcp.cjs`, so **rebuild after changing `src/`** or the plugin
keeps running the old code.

MIT. Issues and PRs: [pappcorn/universe](https://github.com/pappcorn/universe).
