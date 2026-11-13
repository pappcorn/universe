# Changelog

All notable changes to `@pappcorn/linkedin-mcp`. This project follows
[semantic versioning](https://semver.org/).

## 0.2.0

### Added

- **Mentions in posts and comments.** Write `@[Name](target)` in the text, where
  the target is `linkedin.com/company/<vanity>`, `linkedin.com/school/<vanity>`,
  `urn:li:organization:<id>` or `urn:li:person:<id>`, and the published post or
  comment tags that organization or person: linked, clickable, and notifying
  them. In a post the mention is written in LinkedIn's post markup; in a
  comment it becomes a Comments API attribute whose offsets count UTF-16 code
  units.
- **Organizations are looked up, and LinkedIn's name is what gets published.**
  A mention only links when its text is the organization's exact name, so the
  connector uses the `localizedName` LinkedIn returns and the preview shows it
  next to what was typed.
- **The preview lists every mention** (name, kind, URN), and the confirm token
  is bound to the resolved mentions.

### Changed

- **A mention that does not resolve fails the whole call** and names the
  mention; nothing is published. That covers an unknown vanity name (LinkedIn
  answers 200 with no results), an organization id the authorizing member does
  not administer (LinkedIn answers 403 to any other id), a member's profile URL
  (LinkedIn offers no lookup of people), and any other LinkedIn target the
  connector cannot mention. Text such as `@[x](https://example.com)` or a bare
  `@handle` stays plain text, as before.
- **The 3,000-character limit is counted on the text readers see**, where a
  mention counts as the name it shows.

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
