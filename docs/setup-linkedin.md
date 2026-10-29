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
the address must match character for character. If port 8919 is taken on your
machine, register `http://localhost:<another-port>/callback` instead and pass
`--port <another-port>` in Step 6.

While you are on the Auth tab, check the **OAuth 2.0 scopes** it lists. You
should see `w_organization_social`, `r_organization_social` and
`rw_organization_admin`. If the names differ, note them for `--scopes`.

## Step 5 — Keep the Client Secret in a file

The Auth tab also shows the **Client ID** (not secret) and the **Client
Secret** (secret). Put the secret, and nothing else, in a file only you can
read:

```bash
mkdir -p ~/.config/pappcorn-linkedin-mcp
pbpaste > ~/.config/pappcorn-linkedin-mcp/client_secret   # or paste it with an editor
chmod 600 ~/.config/pappcorn-linkedin-mcp/client_secret
```

The setup script reads it from there. It refuses a secret typed on the command
line, because that would land in your shell history.

## Step 6 — Authorize, once

```bash
npx -y -p @pappcorn/linkedin-mcp pappcorn-linkedin-setup \
  --client-id <your-client-id> \
  --client-secret-file ~/.config/pappcorn-linkedin-mcp/client_secret
```

1. The script prints a LinkedIn URL. Open it, **log in as an administrator of
   the Page**, and approve the permissions. (An incognito window helps if your
   browser keeps choosing another LinkedIn account.)
2. LinkedIn sends you back to `localhost:8919`, and the script catches it.
3. It asks LinkedIn which Pages you administer. With one, it records it. With
   several, it lists them and asks you to re-run with `--organization <id>`;
   approving again is instant.
4. It writes `~/.config/pappcorn-linkedin-mcp/credentials.json` (chmod 600) and
   tells you when your tokens expire. No token or secret is printed.

## Step 7 — Verify

Install the connector ([install.md](install.md)), start a new session, and ask
for `linkedin_whoami`. It should name your Page and show the token expiry.

Then ask the assistant to draft a short post. It will show you a **preview**
first, with the exact text and the Page that will publish it. Nothing goes out
until you say yes. For a first test, a plain post you are happy to leave up is
the safest choice; the connector cannot delete it.

---

## Tokens, and how long this lasts

- **Access tokens last 60 days.**
- If LinkedIn issues your app a **refresh token**, it lasts **one year from the
  first authorization** and the connector renews the access token on its own
  until then. Renewing does not extend the year.
- Not every app gets refresh tokens. The setup script tells you which case you
  are in. Without one, run Step 6 again before the 60 days are up.

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
  connector, the answer is: the member URN only, no name or profile data.

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
| A tool answers `HTTP 403`                     | Missing scope, or the authorizing account lost its admin role. Re-run the setup as a current Page admin.                           |
| A tool answers `HTTP 426`                     | LinkedIn sunset the API version the connector sends. Update the connector, or set `LINKEDIN_API_VERSION` to a current `YYYYMM`.    |
| A tool answers `HTTP 429`                     | Development-tier call budget used up for now. Wait and retry later.                                                                |
| `The access token expired … no refresh token` | Expected after 60 days on an app without refresh tokens. Re-run Step 6.                                                            |

## Revoking access

Deleting the credential file stops the connector but does not revoke the grant.
To revoke it, the administrator who authorized the app removes it under
**Permitted services** in their LinkedIn data-privacy settings. You can also
reset the Client Secret from the app's Auth tab, which stops every renewal.
