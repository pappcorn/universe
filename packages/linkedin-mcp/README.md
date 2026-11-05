# @pappcorn/linkedin-mcp

An MCP server for **LinkedIn Pages**. Lets Claude publish posts (text, one
image, or a PDF that shows as a carousel), read the comments on them, answer
those comments, and read basic analytics, all **as your organization's Page**,
through LinkedIn's official **Community Management API**.

It never acts as a person and never drives a browser. LinkedIn's user agreement
requires every profile to belong to a real person and forbids posting or
commenting through bots or automation, so this connector speaks only as the
Page, through the API LinkedIn built for that. If your agent has a voice of its
own, put it in the text.

## Read this first: you need an approved company app

This is a higher bar than the Gmail or WhatsApp connectors:

- **A registered legal organization.** LinkedIn grants the Community Management
  API only to registered companies, for commercial use cases, after verifying
  your business email, legal name, address, website and privacy policy.
- **Your own LinkedIn app, approved by LinkedIn.** Nobody can share theirs with
  you, and this connector ships none. LinkedIn quotes 10 to 15 business days
  for the review.
- **A LinkedIn Page you administer**, verified as associated with that app.
- **The Development tier is temporary and small.** It has a low call budget and
  a time limit. Permanent use needs the Standard tier, which LinkedIn grants
  only after the integration is finished and you send a screen recording of
  each use case.

The full walkthrough, including what LinkedIn asks for, is
**[docs/setup-linkedin.md](../../docs/setup-linkedin.md)**.

## Setup

1. **[Create and get your LinkedIn app approved](../../docs/setup-linkedin.md)**.
2. Register this redirect URL in the app's **Auth** tab:
   `http://localhost:8919/callback`.
3. Authorize once, as a Page administrator:

   ```bash
   npx -y -p @pappcorn/linkedin-mcp pappcorn-linkedin-setup \
     --client-id <your-client-id> --client-secret-file <file-holding-only-the-secret>
   ```

4. **[Install it into Claude](../../docs/install.md)**, then ask for
   `linkedin_whoami`. It should name your Page.

(From a clone: `npm run setup -w @pappcorn/linkedin-mcp -- --help`, and
`npm run linkedin -w @pappcorn/linkedin-mcp -- whoami`.)

## Tools

| Tool                     | What it does                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| `linkedin_whoami`        | The Page this connector acts as, where the credential came from, and when the tokens expire        |
| `linkedin_list_posts`    | The Page's recent posts: URN, date, state, text, media, link                                       |
| `linkedin_post`          | **Publish** a post as the Page: text, text + image, or text + document (PDF carousel). Two-phase   |
| `linkedin_list_comments` | Comments on a post, or the replies under a comment                                                 |
| `linkedin_comment`       | **Comment or reply** as the Page. Two-phase                                                        |
| `linkedin_page_stats`    | Follower count and organic share statistics for the Page, optionally broken out for specific posts |

There is no delete and no edit. A post or comment that should come down is
removed by a person, in LinkedIn.

## Every publish is two-phase

Posting and commenting reach the public, so neither happens on the first call.

1. Called **without** `confirm_token`, the tool publishes nothing and uploads
   nothing. It validates the input and returns a **preview**: the Page that
   will speak, the exact text, the attachment, and a `confirm_token`.
2. The assistant shows that preview to you. Only after your explicit yes does
   it call again with the **same arguments** plus the token.

The token is random, single-use, expires after 15 minutes, lives only in the
server's memory, and is bound to the exact content, including the SHA-256 of an
attached file. Change a word, swap the image, point the reply at another
comment, or replay the token, and the call is refused with nothing published.
There is no bypass flag.

Everything published is appended to a local log,
`~/.local/state/pappcorn/linkedin-mcp/actions.jsonl`, so "what did the
assistant post, and when?" always has an answer. It never leaves your machine.

## Text

Post text is sent as plain text. LinkedIn parses post text in its own markup,
where characters such as `( ) [ ] _ * @ #` are reserved; the connector escapes
them so they appear exactly as written. Two consequences:

- **Hashtags work.** A `#` that starts a word stays a hashtag.
- **Mentions do not.** `@` is always escaped, so v1 never tags anyone.

Posts are capped at 3,000 characters, LinkedIn's limit.

## Media

- **Image:** one `.jpg`, `.png` or `.gif`, under LinkedIn's limit of about 36
  million pixels. Add `image_alt_text`; screen readers use it.
- **Document:** one `.pdf`, `.pptx`, `.ppt`, `.docx` or `.doc`, at most 100 MB
  and 300 pages. A PDF is how a carousel is posted on LinkedIn.

The file is uploaded only after you confirm, and the post is created only once
LinkedIn reports the file processed, so a post never goes out with a broken
attachment.

## Comments and personal data

`linkedin_list_comments` shows each author as the URN LinkedIn returns: a member
(`urn:li:person:…`) or an organization (`urn:li:organization:…`), with the
Page's own comments marked. It does not resolve names: the connector requests
no profile data about the people who comment. Bear that in mind when you describe your app to LinkedIn for the
Standard tier, where they ask which commenter fields your app displays.

## Scopes

The setup script requests five scopes, all part of the Community Management
API:

| Scope                        | Why                                                   |
| ---------------------------- | ----------------------------------------------------- |
| `w_organization_social`      | Publish posts as the Page                             |
| `r_organization_social`      | Read the Page's posts                                 |
| `w_organization_social_feed` | Comment and reply as the Page                         |
| `r_organization_social_feed` | Read comments (LinkedIn answers 403 without it)       |
| `rw_organization_admin`      | Find the Pages you administer, and the Page analytics |

The consent screen lists them. If your app's Auth tab shows different scope
names, pass `--scopes "…"` to the setup script.

## Tokens

LinkedIn access tokens last about **two months**, and a Development-tier app
also gets a refresh token that lasts about **twelve months from the first
authorization** (renewing does not extend it). The connector renews the access
token on its own until then. The setup script reports what LinkedIn issued, and
`linkedin_whoami` always shows both expiry dates. When they run out, run the
setup again. It takes a minute.

## Configuration

| Variable                                                                   | Purpose                                                                                            |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `LINKEDIN_MCP_CREDENTIALS`                                                 | Credential file. Default `~/.config/pappcorn/linkedin-mcp/credentials.json`, written by the setup. |
| `LINKEDIN_ACCESS_TOKEN`                                                    | A token supplied directly. Takes precedence over the file.                                         |
| `LINKEDIN_REFRESH_TOKEN` + `LINKEDIN_CLIENT_ID` + `LINKEDIN_CLIENT_SECRET` | Renewable credential supplied directly. Takes precedence over the file.                            |
| `LINKEDIN_ORGANIZATION_ID`                                                 | The Page to act as. Default: the one the setup recorded.                                           |
| `LINKEDIN_API_VERSION`                                                     | `YYYYMM`. Default `202610`. Raise it if LinkedIn answers 426 for a sunset version.                 |
| `LINKEDIN_MCP_LOG_DIR`                                                     | Where the local publish log goes. Default `~/.local/state/pappcorn/linkedin-mcp`.                  |

## Security

- The credential stays on your machine: in the setup's file (chmod 600) or, as
  a plugin, in your OS keychain. No credential field is ever printed, logged or
  returned by a tool.
- The connector talks to `api.linkedin.com`, `www.linkedin.com` (tokens) and
  LinkedIn's upload URLs, and nothing else. An upload URL that is not https on
  `linkedin.com` is refused before the token is sent.
- The setup script refuses a Client Secret on the command line, where it would
  land in your shell history, and refuses to record a Page you do not
  administer.
- Nothing runs on its own. The connector acts only when asked, and publishes
  only after a confirmed preview.

## Local files

Everything sits under one parent, so there is one place to look:
`~/.config/pappcorn/linkedin-mcp/` (the credential),
`~/.cache/pappcorn/linkedin-mcp/` (renewed access tokens) and
`~/.local/state/pappcorn/linkedin-mcp/` (the publish log).

Deleting them stops this machine, but **the token stays alive until it is
revoked in LinkedIn**. See
[Where the files live, and revoking access](../../docs/setup-linkedin.md#where-the-files-live-and-revoking-access).

## Not in v1

Mentions, video, multi-image posts, polls, scheduling, reactions, editing and
deleting, time-bound analytics, and posting as a person.

## Development

```bash
npm test -w @pappcorn/linkedin-mcp     # mocked LinkedIn; no credential needed
npx nx run linkedin-mcp:build          # tsc + the committed plugin bundle
```
