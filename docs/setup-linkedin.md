# Connect your organization's LinkedIn Page

This guide gets your assistant **publishing to your company's LinkedIn Page**,
reading the comments, and answering them as the Page. You create your own
LinkedIn app and get it approved; nothing is shared with PappCorn or anyone
else.

> **Read this before you start. The bar is higher than for Gmail or WhatsApp.**
> LinkedIn grants the API this connector uses, the **Community Management API**,
> only to **registered legal organizations** with a commercial use case, and
> only after a manual review of your company. You need your own approval; there
> is no shared app to borrow. Budget **two to three weeks** of calendar time
> for the review, and about 15 minutes of work once it is through.

## Why this is the way it is

There are two ways to get an agent onto LinkedIn, and only one is allowed.

1. **A profile for the agent, or a browser that clicks for you.** LinkedIn's
   user agreement requires every profile to be a real person and forbids
   posting, commenting or reacting through bots or automation. An agent
   profile can cost you the Page it administers; a scripted browser session can
   cost the account that lends it.
2. **The Page speaks, through the official API.** LinkedIn built the Community
   Management API for exactly this: software that publishes and answers as a
   company Page, on behalf of a Page administrator who authorized it.

This connector does option 2, and only option 2. If your agent has a voice of
its own, it goes in the text of the post, not in an identity.

---

## Before you start

- **A registered company**: legal name, registered address, a website on your
  own domain, and a **privacy policy** published on it. LinkedIn checks all of
  them.
- **A business email address on that domain.** LinkedIn verifies it. Personal
  addresses (`@gmail.com` and the like) do not pass.
- **A LinkedIn Page for the company**, and a personal LinkedIn account that is
  a **super admin** of it.
- Node.js 20 or newer (`node --version`).

---

## Step 1 — Create the app

1. Go to the [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps)
   → **Create app**.
2. **App name:** your company's or product's name. LinkedIn rejects names or
   logos that contain any part of "LinkedIn" or "Microsoft".
3. **LinkedIn Page:** pick your company's Page. This association is what the
   review checks.
4. **Privacy policy URL** and **app logo**: required.
5. Create it.

Use a **new app with no other products on it.** LinkedIn only lets you request
the Community Management API on an app that has none, so do not reuse an app
you already use for "Sign In with LinkedIn" or ads.

## Step 2 — Have the Page verify the app

A super admin of the Page has to confirm the app belongs to it. In the app's
**Settings** tab, generate the verification link and open it while logged in
as that super admin. LinkedIn's help article
[Associate an app with a LinkedIn Page](https://www.linkedin.com/help/linkedin/answer/a548360/associate-an-app-with-a-linkedin-page)
walks through it.

## Step 3 — Request the Community Management API

1. In the app's **Products** tab, request **Community Management API**. You get
   the **Development tier** first.
2. Fill in the form **exactly as your company appears everywhere else**: the
   legal name and address on your privacy policy, website and email domain.
   Mismatches are the commonest reason for a rejection.
3. **Use cases.** Choose only what you will do. For this connector:
   - **Page management**: post and comment as your Page.
   - **Page analytics**: the follower and post statistics.
   - The form also asks for a primary use case. If you only manage your own
     company's Page, pick the one for a company acting on its own behalf (at
     the time of writing, **Direct Advertiser**), not an agency or platform
     case.
4. Verify the business email address when LinkedIn writes to it. **Check spam,
   junk and promotions folders**; the message is easy to miss.

LinkedIn quotes **10 to 15 business days** for the review, and it may ask for
more documents, such as your company's registration certificate. Answer with
documents that match what you put in the form.

> **A rejection is final for that app.** You cannot apply again with the same
> app; you would create a new one and start over. Take the form seriously.

## Step 4 — Register the redirect URL

Once approved, open the app's **Auth** tab. Under **OAuth 2.0 settings →
Authorized redirect URLs for your app**, add exactly:

```
http://localhost:8919/callback
```

The setup script listens there for the one moment LinkedIn sends you back
after you approve. LinkedIn only redirects to URLs registered on the app, so
the address must match character for character. The portal accepts this
plain-`http` localhost address. If port 8919 is taken on your
machine, register `http://localhost:<another-port>/callback` instead and pass
`--port <another-port>` in Step 6.

While you are on the Auth tab, check the **OAuth 2.0 scopes** it lists. You
should see these five, which the setup script requests:

- `w_organization_social` and `r_organization_social`: publish and read the
  Page's posts.
- `w_organization_social_feed` and `r_organization_social_feed`: comment as the
  Page, and read comments.
- `rw_organization_admin`: find the Pages you administer, read analytics, and
  look up the organizations a post or comment mentions.

If the names differ, note them for `--scopes`.

## Step 5 — Keep the Client Secret in a file

The Auth tab also shows the **Client ID** (not secret) and the **Client
Secret** (secret). Put the secret, and nothing else, in a file only you can
read:

```bash
mkdir -p ~/.config/pappcorn/linkedin-mcp
pbpaste > ~/.config/pappcorn/linkedin-mcp/client_secret   # or paste it with an editor
chmod 600 ~/.config/pappcorn/linkedin-mcp/client_secret
```

The setup script reads it from there. It refuses a secret typed on the command
line, because that would land in your shell history.

## Step 6 — Authorize, once

```bash
npx -y -p @pappcorn/linkedin-mcp pappcorn-linkedin-setup \
  --client-id <your-client-id> \
  --client-secret-file ~/.config/pappcorn/linkedin-mcp/client_secret
```

1. The script prints a LinkedIn URL. Open it, **log in as an administrator of
   the Page**, and approve the permissions. (An incognito window helps if your
   browser keeps choosing another LinkedIn account.)
2. LinkedIn sends you back to `localhost:8919`, and the script catches it.
3. It asks LinkedIn which Pages you administer. With one, it records it.
   **With several, you must pass `--organization <id>`.** Without it, the script
   lists your Pages and exits without saving anything, and you repeat the
   authorization with the flag added.
4. It writes `~/.config/pappcorn/linkedin-mcp/credentials.json` (chmod 600) and
   tells you when your tokens expire. No token or secret is printed.

A credential you already have is replaced only when the whole flow succeeds. A
failed or abandoned run leaves it as it was.

### Approving on another device

The redirect goes to `localhost`, which means _the device whose browser you
approve in_. If that is not the machine running the script, such as an iPad or
another computer, the last step fails in the browser with a page that cannot
connect. Nothing is wrong, and the approval is not lost:

1. Keep the script running. It waits 15 minutes.
2. Copy the **whole address** from that browser's address bar. It starts with
   `http://localhost:8919/callback?` and holds a one-time authorization code,
   so do not paste it anywhere shared.
3. On the machine running the script, in another terminal, run it with `curl`.
   Keep the single quotes; the address contains `&`.

   ```bash
   curl '<the address you copied>'
   ```

The script takes it from there. If you administer several Pages, pass
`--organization <id>` from the start: otherwise you make this round trip twice.

## Step 7 — Verify

Install the connector ([install.md](install.md)), start a new session, and ask
for `linkedin_whoami`. It should name your Page and show the token expiry.

Then ask the assistant to draft a short post. It will show you a **preview**
first, with the exact text and the Page that will publish it. Keep your client's
permission prompt on `linkedin_post` and `linkedin_comment`, and do not pre-allow
them: the preview makes the assistant show its work, and that prompt is what
makes the final yes yours. For a first test, a plain post you are happy to leave up is
the safest choice; the connector cannot delete it.

To tag another organization, write `@[Name](linkedin.com/company/<vanity>)` (or
`linkedin.com/school/<vanity>`) in the text. The preview shows the name LinkedIn
has for it, which is the one that gets published. The full syntax is in the
connector's README, under "Mentions".

---

## Tokens, and how long this lasts

- **Access tokens last about two months.**
- A Development-tier app also gets a **refresh token**, which lasts about
  **twelve months from the first authorization**. The connector renews the
  access token on its own until then. Renewing does not extend the twelve
  months; after that, run Step 6 again.
- The setup script reports what LinkedIn issued. If it says no refresh token was
  issued, run Step 6 again before the access token expires.

`linkedin_whoami` always shows both dates.

## The Development tier is temporary

What LinkedIn approves first is the **Development tier**:

- **A small call budget.** LinkedIn's FAQ lists 500 calls per app and 100 per
  member. A post with an image uses about five; a day of ordinary use fits
  easily, a bulk job does not. Your app's **Analytics** tab shows the live
  numbers.
- **A time limit.** Development access expires; LinkedIn's approval states
  when (12 months at most at the time of writing).

For permanent use, request the **Standard tier** from the app's **Products**
tab once everything works. LinkedIn asks for a finished integration and a
**screen recording of each use case** you were approved for. For Page
management, that means showing:

- an administrator approving access through the full OAuth flow (Step 6);
- a post published to the Page through the app (`linkedin_post`);
- how a member's comment on that post is displayed (`linkedin_list_comments`);
- which personal data fields of the commenter the app displays. With this
  connector, the answer is: the author's URN only, no name or profile data.

For Page analytics, show how post performance is displayed
(`linkedin_page_stats`). A rejection at this stage is also final for that app,
so record carefully.

## Troubleshooting

| Symptom                                       | Cause and fix                                                                                                                      |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| LinkedIn says the redirect URI does not match | The URL in the Auth tab differs from `http://localhost:8919/callback`, even by a slash. Fix it there, or use `--port` to match it. |
| LinkedIn says the scope is invalid            | Your app was not granted one of the scopes. Check the Auth tab's scope list and pass `--scopes "…"` with the names it shows.       |
| `cannot listen on localhost:8919`             | Another program holds the port. Free it, or register another port and pass `--port`.                                               |
| `you administer no Pages`                     | You logged in with an account that is not an ADMINISTRATOR of the Page. Use the right account; Page "content admin" is not enough. |
| Reading comments answers `HTTP 403`           | The credential was authorized without `r_organization_social_feed`. Re-run Step 6 with the default scopes.                         |
| A tool answers `HTTP 403`                     | Missing scope, or the authorizing account lost its admin role. Re-run the setup as a current Page admin.                           |
| The browser cannot connect to `localhost`     | You approved on another device. See [Approving on another device](#approving-on-another-device).                                   |
| `you administer 2 Pages`                      | Nothing was saved. Re-run with `--organization <id>`, using an id from the list, and authorize again.                              |
| A tool answers `HTTP 426`                     | LinkedIn sunset the API version the connector sends. Update the connector, or set `LINKEDIN_API_VERSION` to a current `YYYYMM`.    |
| A tool answers `HTTP 429`                     | Development-tier call budget used up for now. Wait and retry later.                                                                |
| `The access token expired … no refresh token` | Your credential holds no refresh token, so it cannot renew. Re-run Step 6.                                                         |
| A mention `does not resolve`                  | The page address is wrong, or an `urn:li:organization` id is not one you administer. Use `@[Name](linkedin.com/company/<vanity>)`. |

## Where the files live, and revoking access

Everything this connector keeps on your machine sits under one parent, one
subfolder per connector, so there is one place to look:

| Folder                                  | What it holds                                                 |
| --------------------------------------- | ------------------------------------------------------------- |
| `~/.config/pappcorn/linkedin-mcp/`      | The credential, and the Client Secret file if you made one    |
| `~/.cache/pappcorn/linkedin-mcp/`       | Renewed access tokens                                         |
| `~/.local/state/pappcorn/linkedin-mcp/` | The log of what was published. Keep it if you want the record |

Stopping a machine and revoking access are two different things:

- **Deleting the folders stops this machine, but the token stays alive.**
  LinkedIn does not know you deleted anything, so any copy of that credential
  can still publish as your Page until it expires.

  ```bash
  rm -rf ~/.config/pappcorn/linkedin-mcp ~/.cache/pappcorn/linkedin-mcp
  ```

- **Revoking in LinkedIn kills it everywhere.** The administrator who authorized
  the app removes it under **Permitted services** in their LinkedIn data-privacy
  settings. You can also reset the Client Secret in the app's Auth tab (run
  Step 6 again afterwards, since the credential file holds a copy), which
  stops every renewal.

If someone is leaving, or a machine is lost, do the second. Deleting a folder is
not enough.
