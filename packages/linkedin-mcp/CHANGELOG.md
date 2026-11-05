# Changelog

All notable changes to `@pappcorn/linkedin-mcp`. This project follows
[semantic versioning](https://semver.org/).

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
