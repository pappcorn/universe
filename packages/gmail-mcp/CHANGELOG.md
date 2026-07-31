# Changelog

All notable changes to `@pappcorn/gmail-mcp`. This project follows
[semantic versioning](https://semver.org/).

## 0.3.0

One machine can now serve more than one mailbox safely.

### Added

- **Working-directory-scoped configuration.** The connector looks for a `.env`
  starting at the process working directory and walking up to the repository
  root. That is how a folder says "this project uses that mailbox". The walk
  stops at the directory containing `.git`, never enters your home directory,
  and never resolves from the package's install location. If no `.env` is in
  scope, nothing is borrowed from elsewhere.
- **A documented precedence order**, highest first: process environment (what
  the Claude plugin supplies from your keychain) → the nearest `.env` →
  `$GMAIL_MCP_CREDENTIALS` → `~/.config/pappcorn-gmail-mcp/credentials.json`.
  `.env` fills in variables the environment does not set; it never overrides
  them.
- **`GMAIL_ACCOUNT` is now an assertion that fails closed.** When it is set, the
  first Gmail call verifies it against the mailbox the credential actually
  opens — the live profile, not the `account` field written inside the
  credential file. A mismatch denies access instead of acting on the wrong
  mailbox.
- **`whoami` reports where the credential came from** (`credential:` line, also
  in `mail_whoami` and in `--json`). Paths and origins only, never a credential
  field.
- **`mint-token --force`**, plus a confirmation prompt when the destination is
  not provably the same mailbox.
- Tests for the resolution and destination rules (`npm test`, Node's built-in
  runner, no new dependencies).

### Fixed

- **`mint-token` no longer destroys an existing credential.** It refuses to
  overwrite a file — or a **symlink**, which it previously followed silently —
  that holds a different or unreadable mailbox, reporting what is there and
  requiring a confirmation or `--force`.
- **Two mailboxes can no longer be served each other's access token.** The token
  cache is keyed by a non-reversible digest of the credential in use instead of
  by an optional account label, so credentials that declare no account no longer
  share one cache slot. Each identity also gets its own cache file, so
  alternating between mailboxes stops thrashing the cache.

### Changed

- **`mint-token` picks a safer default destination.** With no `--out`: the
  global default path for your first mailbox and when re-minting that same
  mailbox; `~/.config/pappcorn-gmail-mcp/<mailbox>.json` for any other one. It
  then prints the `.env` lines that point a project at it, including the
  reminder to add `.env` to `.gitignore`.
- A credential minted before this version carries no `account` field, so
  `mint-token` cannot tell which mailbox it holds and leaves it alone rather
  than refreshing it in place. It now says exactly that — and how to check what
  that older file is — instead of implying you had a second mailbox.
- The global credential path still works exactly as before — every existing
  install keeps running untouched — but it is no longer the recommended way to
  configure more than one mailbox.

## 0.2.0

- Visual setup walkthrough (`docs/how-to-gmail.md`) and clone-free `npx` setup.

## 0.1.0

- First release: `mail_whoami`, `mail_search`, `mail_read_thread`, `mail_send`,
  `mail_draft`, `mail_label`, `mail_archive`, plus the matching CLI.
