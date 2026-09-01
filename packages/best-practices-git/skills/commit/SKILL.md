---
name: commit
description: |
  Stage and commit the pending changes the way this repository already does it.
  Reads the repo's own git history to infer its conventions (Conventional
  Commits or not, scopes, granularity, trailers) instead of imposing a house
  style, partitions the working tree so one commit is one logical change,
  screens for credentials and stray data files, stages by name, and writes a
  message whose body explains WHY. Refuses to commit on a protected branch,
  never runs `git add -A`, never `--no-verify`, never amends unasked. Use when
  the user says "commit", "commit this", "ship this", "save this", "haz un
  commit", or otherwise wants the current changes recorded.
user-invocable: true
argument-hint: '[scope hint or a subject line]'
allowed-tools:
  - Bash(git status:*)
  - Bash(git diff:*)
  - Bash(git log:*)
  - Bash(git branch:*)
  - Bash(git rev-parse:*)
  - Bash(git show:*)
  - Bash(git add:*)
  - Bash(git restore:*)
  - Bash(git commit:*)
  - Read
---

# /commit — record a change the way this repo records changes

Optional argument: `$ARGUMENTS` — treat it as a scope hint or a partial subject
the user wants in the message.

## Why this skill exists

A commit is not a save button. It is the only durable explanation of a change
that travels with the code — the thing someone reads at 2am, six months from
now, when `git blame` lands on a line nobody understands and the ticket system
that held the context has since been replaced.

Two failures cause most of the pain, and both are avoidable in the thirty
seconds before you type `git commit`:

- **The message narrates the diff.** "update user service" tells you nothing the
  diff does not already say better. The diff is a perfect record of _what_
  changed and a useless record of _why_. Only the message can carry the why, and
  only the author knows it — for about a day.
- **The commit mixes unrelated changes.** A commit that fixes a bug _and_ renames
  a variable _and_ bumps a dependency cannot be reverted, cherry-picked, or
  bisected. The moment you need any of those, you need them urgently.

Everything below serves those two points.

## Live state

Current branch:
!`git branch --show-current`

Working tree:

```!
git status --short
```

Unstaged:

```!
git diff --stat
```

Already staged:

```!
git diff --cached --stat
```

**This repo's actual convention** — the style oracle. Match it, do not override it:

```!
git log --oneline -20
```

Full recent messages (do bodies exist? do trailers exist? what do they look like?):

```!
git log -4 --format='%s%n%n%b%n---'
```

Top-level layout (candidate scopes, if this repo uses scopes):

```!
ls -1
```

## Step 1 — Branch guard

If the current branch is protected — `main`, `master`, `develop`, `release`,
`production`, `prod`, or anything listed under `protectedBranches` in
`.claude/best-practices-git.json` — **stop**. Do not commit.

Protected branches are shared history. A commit landed straight on one skips
review and skips CI, and if it turns out to be wrong, the fix is a public revert
rather than a closed pull request nobody had to see.

Offer to create a branch instead and carry the work over — `git switch -c
<type>/<slug>` is non-destructive and brings uncommitted changes with it. Suggest
a name from the repo's existing branch convention (`git branch -a` shows it); if
there is none, `<type>/<short-slug>` matching the commit type you are about to
use. Wait for the user before continuing.

## Step 2 — Learn the repo's conventions before writing anything

Read the two `git log` blocks above and answer these, in your head, for **this**
repo:

- **Format.** Conventional Commits (`feat:`, `fix(scope):`)? Bare imperative
  subjects? A ticket prefix (`PROJ-123: …`)? Sentence case or lower case?
- **Scopes.** If the repo uses them, what is the vocabulary? Derive it from the
  history and the top-level layout, not from your assumptions about how monorepos
  are usually organized. If existing subjects have no scopes, do not introduce
  them.
- **Granularity.** One tight commit per change, or several small logical ones?
  Stage to match (`git add -p` when the repo favors small commits).
- **Bodies.** Do messages carry a body? How long? Do they reference issues?
- **Trailers.** Does every commit end with something (`Co-Authored-By:`,
  `Signed-off-by:`, a ticket link)? Reproduce exactly what is already there.

A repo's conventions beat this skill's preferences, always. Consistency is worth
more than any individual style rule — the history is only searchable if it is
uniform. If `.claude/best-practices-git.json` sets `commit.convention`,
`commit.scopes`, `commit.trailers`, or `language`, those settings win over your
inference; they exist for the case where the team is deliberately changing style.

## Step 3 — Partition: one commit, one logical change

Group every changed path (staged and unstaged) by what it is _for_, not by where
it lives. Then check:

- Does this changeset contain **more than one reason to change**? A bug fix plus
  an unrelated refactor is two commits. A feature plus a formatting sweep is two
  commits — and the formatting sweep is the one that will bury the feature in
  review.
- Does it cross a **boundary the repo treats as separate** (independent packages
  in a monorepo, unrelated services, vendored code)? If the history shows one
  scope per commit, keep it that way.

If the working tree holds more than one logical change, show the user the
partition and propose an order. Do not silently commit them together, and do not
split without telling them — a split changes what lands on the branch.

## Step 4 — Safety screen

Look at the file list before staging. Refuse to stage, unless the user
explicitly insists after you have named the file:

- `.env`, `.env.*`, `*.env`
- `credentials*`, `service-account*`, `*-key.json`, `*.pem`, `*.key`, `id_rsa*`,
  `*.p12`, `*.gpg`
- Anything whose name or content looks like a token, an API key, or a connection
  string with a password in it
- Data dumps the user did not mention by name — CSV exports, scrapes,
  `*.sqlite`, `*.db`, `dump.*`, `backup.*`
- Binaries over ~1 MB that were not part of the conversation
- Build output and dependency directories (`dist/`, `build/`, `node_modules/`) —
  if these show up in `git status`, the `.gitignore` is wrong; say so.

Say plainly why. "A pushed credential is a leaked credential — rotating it is the
only fix, and it stays in the history of every fork and every clone forever" is
the whole argument, and it is worth making once rather than arguing about the
file.

## Step 5 — Stage by name

```bash
git add path/one path/two
```

Never `git add -A`, `git add .`, or `git add -u`. Those stage whatever happens to
be in the tree — including the file another agent wrote thirty seconds ago in a
parallel session, the debug print you meant to delete, and the local config you
never intended to share. Naming the files is the last checkpoint where a human
decision is still possible.

Confirm with `git status --short` after staging, then read the staged diff itself:

```bash
git diff --cached
```

You are looking for what you did not mean to include: leftover `console.log`,
commented-out code, a stray whitespace reflow. Fix those now — after the commit
they cost a second commit.

## Step 6 — Write the message

```
<subject — imperative, one line, fits in ~70 characters>

<body — only when the subject cannot carry the meaning>

<trailers the repo already uses>
```

**Subject.** Imperative mood: "add", not "added" or "adds" — a commit describes
what applying it does. No trailing period. Concrete over categorical: "reject
uploads over 10 MB" beats "improve upload validation". Use the format Step 2
inferred.

**Body — this is the part that matters.** Write one only when there is a _why_
worth keeping, and then write the why, not the what:

- the constraint that forced this shape ("the vendor API rate-limits at 5 rps, so
  the pool is fixed at 4")
- the incident behind it ("this silently dropped every message with an emoji in
  the subject")
- the option not taken, and why ("a cache would be faster but goes stale on
  rename, which is the case that actually breaks users")
- the consequence a future reader would otherwise trip over ("callers must now
  await this — the sync path was the only reason the tests passed")

Do not restate the diff in prose. If the body reads like a changelog of the
files, delete it — you have written the one thing the reader can already see.

Wrap the body at ~72 characters. If `$ARGUMENTS` was given, work it into the
subject naturally rather than pasting it.

## Step 7 — Commit

Use a heredoc so newlines and trailers survive intact:

```bash
git commit -m "$(cat <<'EOF'
<subject>

<body>

<trailers>
EOF
)"
```

Hard rules:

- **Never `--no-verify`.** Hooks are the team's agreement with itself. A hook you
  skipped runs in CI anyway, ten minutes later, in front of everyone.
- **Never `--amend`** unless the user asked for an amend in this turn. Amending
  rewrites a commit that may already be pushed and may already be someone else's
  base.
- **Never `commit -a`.** It stages by side effect and defeats Step 5.

## Step 8 — When a hook fails

The commit **did not happen**. This matters: `--amend` at this point would
rewrite the _previous_ commit — someone else's work — and that is the single most
common way this goes badly wrong.

1. Read the hook output and fix the underlying problem in the code.
2. Re-stage the fixed files by name.
3. Make a **new** commit with the same message.

If the hook keeps failing for a reason unrelated to the diff (a missing tool, a
broken environment), surface that to the user. Do not disable the hook.

## Step 9 — Report

Four lines at most: the commit hash and subject; the branch; anything you left
out (out-of-scope files, refused files); one next step if it is obvious. Do not
re-summarize the diff — the user just watched you stage it.

## Hard rules, in one place

- Never commit on a protected branch.
- Never `git add -A` / `.` / `-u`. Stage by name.
- Never `--no-verify`, never `--amend` unasked, never `commit -a`.
- Never commit a credential, an `.env`, or a data dump. Naming it and asking is
  not optional politeness — it is the last line of defense.
- Never invent a convention the repo does not have.
