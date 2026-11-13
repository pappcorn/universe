# Changelog

All notable changes to `@pappcorn/linkedin-mcp`. This project follows
[semantic versioning](https://semver.org/).

## 0.2.0

### Added

- **Mentions in posts and comments.** Write `@[Name](target)` in the text and
  the published post or comment tags that organization or person: linked,
  clickable, and notifying them. The target is the address of a LinkedIn
  company or school page, pasted from the browser as it is (any LinkedIn host,
  sub-page, query string or trailing slash), `urn:li:organization:<id>` or
  `urn:li:person:<id>`. In a post the mention is written in LinkedIn's post
  markup; in a comment it becomes a Comments API attribute whose offsets count
  UTF-16 code units.
- **Organizations are looked up, and LinkedIn's name is what gets published.**
  A mention only links when its text is the organization's exact name, so the
  connector uses the `localizedName` LinkedIn returns and the preview shows it
  next to what was typed.
- **The preview lists every mention** (name, kind, URN), and warns when a
  name holds a character post markup reserves, since LinkedIn's match on an
  escaped name is unverified.
- **What the preview resolved is kept with the confirm token.** Confirming
  redeems the token first, so a wrong or expired one is refused without any
  call to LinkedIn, and then publishes exactly the mentions that were shown,
  with no new lookup. Each distinct target is looked up once, in parallel, and
  a mention of your own Page costs no extra call.

### Changed

- **A mention that does not resolve fails the whole call** and names the
  mention; nothing is published. That covers an unknown vanity name (LinkedIn
  answers 200 with no results), an organization id the authorizing member does
  not administer, including a numeric `linkedin.com/company/<id>` address
  (LinkedIn answers 403 to any other id), a member's profile URL (LinkedIn
  offers no lookup of people), and any other LinkedIn target the connector
  cannot mention. Text such as `@[x](https://example.com)` or a bare `@handle`
  stays plain text, as before.
- **The 3,000-character limit is checked on the commentary LinkedIn
  receives**, escapes and mention markup included, in UTF-16 code units, the
  stricter of the two possible units. It is checked first with no I/O on the
  text around the mentions, and never after an upload.

## 0.1.0

### Added

- **First release.** Publish to an organization's LinkedIn Page through the
  official Community Management API: text posts, one image, or one document
  (a PDF shows as a carousel). Read the Page's posts and their comments,
  comment and reply as the Page, and read the follower count and organic share
  statistics.
- **Every post and comment is two-phase.** A preview first, then a random,
  single-use, 15-minute `confirm_token` bound to the exact content, including
  the SHA-256 of any attached file.
- **`pappcorn-linkedin-setup`**, a zero-dependency OAuth setup with a local
  callback on `http://localhost:8919/callback`. It records the Page you
  administer and refuses one you do not.
- **One place for local files:** `~/.config/pappcorn/linkedin-mcp/`,
  `~/.cache/pappcorn/linkedin-mcp/` and `~/.local/state/pappcorn/linkedin-mcp/`.
- **A read-only CLI**, `pappcorn-linkedin`: `whoami`, `posts`, `comments`,
  `stats`. Publishing is MCP-only, behind the gate.
