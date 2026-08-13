---
name: git-pr
description: |
  Open a pull request from the current branch against the repo's base branch,
  and leave the working checkout free by moving the PR into its own worktree.
  Three independent guards make pushing to a protected branch impossible; if the
  user is standing on one with work in progress, it branches off first instead of
  refusing. Delegates to the `commit` skill when the tree is dirty, composes
  title and body from the commits (what changed, why, how to check it), assigns
  the author, and requests the changed paths' CODEOWNERS as reviewers. Never
  force-pushes, never merges. Use when the user says "open a PR", "PR this",
  "ship this branch", "abre el PR", "create the pull request", or finishes a
  branch and wants it up for review.
user-invocable: true
argument-hint: '[base-branch] [--title "..."] [--draft] [--no-worktree]'
allowed-tools:
  - Bash(git status:*)
  - Bash(git branch:*)
  - Bash(git diff:*)
  - Bash(git log:*)
  - Bash(git rev-parse:*)
  - Bash(git fetch:*)
  - Bash(git switch:*)
  - Bash(git push:*)
  - Bash(git show:*)
  - Bash(gh repo view:*)
  - Bash(gh pr view:*)
  - Bash(gh pr list:*)
  - Bash(gh pr create:*)
  - Bash(gh pr edit:*)
  - Bash(gh api:*)
  - Bash(node:*)
  - Read
  - AskUserQuestion
---

# /git-pr — put a branch up for review

Optional `$ARGUMENTS`, in any order:

- a bare branch name → override the base branch
- `--title "..."` → override the PR title
- `--draft` → open as a draft
- `--no-worktree` → skip the worktree step

## Why this skill exists

**A small pull request gets reviewed. A large one gets approved.** That is not a
joke about discipline; it is what reviewers actually do. Attention is finite, so
a 40-line diff gets read line by line and a 2,000-line diff gets skimmed for
anything obviously alarming and then waved through. The large PR feels like more
progress and delivers less review — which is the entire point of opening it.

Large PRs also rot. They sit for days, the base moves, they conflict, the author
rebases, the reviewer's earlier comments no longer apply, and the whole thing has
to be re-read. A branch that lives a week is competing with everyone else's work
instead of joining it. If your change is genuinely large, the answer is a
sequence of small PRs, not one big one — and this skill will say so at Step 3.

The second reason this skill exists is narrower and mechanical: **it must be
impossible for this workflow to push to the base branch.** Three independent
checks enforce that (Steps 1, 4), because the cost of being annoying about it is
tiny and the cost of getting it wrong once is a rewritten shared history.

## Live state

Current branch:
!`git branch --show-current`

Working tree:

```!
git status --short
```

Repo default branch, and what recent PRs actually target:

```!
gh repo view --json defaultBranchRef --jq '"default: " + .defaultBranchRef.name' 2>/dev/null || echo "(gh unavailable)"
```

```!
gh pr list --state all --limit 10 --json baseRefName --jq '"recent bases: " + ([.[].baseRefName] | unique | join(", "))' 2>/dev/null || echo ""
```

## Step 1 — Resolve the base; get off a protected branch

`BASE` = the first bare token of `$ARGUMENTS`, else `base` from
`.claude/best-practices-git.json`, else the repo's default branch as reported
above. When recent PRs consistently target a _different_ branch than the
repo default, prefer what the team actually does and say so in the report — a
repo's default-branch metadata goes stale, team habit does not.

`PROTECTED` = `{main, master, develop, release, production, prod}` ∪ `{BASE}`, or
the `protectedBranches` list from config. The set is deliberately generous: any
branch a reasonable reader would call a trunk belongs in it. A false positive
costs the user one rename; a false negative costs a shared branch.

Then apply exactly two rules, **in this order** — `BASE` is itself in
`PROTECTED`, so the two overlap and the order is what disambiguates them:

**1. If `CURRENT == BASE`:** stop. A branch cannot be a pull request into itself.
There is no rescue here — the user picks a different base or moves. Check this
first, before anything else, so standing on `main` with `main` as the base gives
the accurate answer instead of an offer to branch that leads nowhere.

**2. Otherwise, if `CURRENT` is protected:** do not refuse. The user asked
to open a PR; they clearly meant to be on a branch. Move them:

1. Take stock — `git status --short` and `git log --oneline @{u}..HEAD`. If both
   are empty there is nothing to PR; stop and say so rather than creating an
   empty branch.
2. Ask for the branch name (`AskUserQuestion` for the type — `feat`, `fix`,
   `chore`, `refactor` — then the slug in chat). Follow the repo's existing
   branch convention if `git branch -a` shows one.
3. `git switch -c <type>/<slug>` — non-destructive; uncommitted changes come
   along, and any local commits are now reachable from the new branch.
4. If the protected branch had **local commits ahead of its remote**, ask before
   cleaning up, then `git branch -f <protected> origin/<protected>`. Those
   commits are safe: they live on the new branch. Never do this silently.

From here `CURRENT` means the new branch.

## Step 2 — Commit whatever is uncommitted

If the tree is dirty, run the **`commit` skill** rather than inlining a
`git commit` here. There is exactly one definition of "a commit in this repo" and
it lives there — conventions inferred from history, the secrets screen, staging
by name, hooks. Duplicating those rules here guarantees the two drift, and the
one that goes stale is this one.

If `commit` stops (an unsplit changeset, a refused file, a failing hook), stop
too. Continue only once it reports a commit.

If the user says "PR what is already pushed, leave my working tree alone",
respect that and skip to Step 3.

## Step 3 — Confirm there is something to review, and that it is reviewable

```bash
git fetch origin <BASE>
git log --oneline origin/<BASE>..HEAD
git diff --stat origin/<BASE>...HEAD
```

Empty log → nothing to PR. Stop.

Now look at the size. If the diff is large (a few hundred changed lines across
unrelated areas is the useful threshold, not a hard number) **and** the commits
split cleanly along a seam — a refactor separable from the feature, a dependency
bump, a formatting sweep, one package independent of another — say so in one
line and offer to open the independent part as its own PR first. Offer once,
then proceed with whatever the user chooses. This is advice, not a gate; the
author knows things you do not.

Never pad a PR to look complete. A PR that does one thing and says so is finished.

## Step 4 — Push the branch

**One form, always:**

```bash
git push -u origin <CURRENT>
```

Do not first check "does this branch have an upstream" and take a bare `git push`
if so. Having _an_ upstream does not mean having _its own_ upstream: a branch cut
from a remote ref (`git checkout -b work origin/main`, the correct move when your
local base is stale) has `origin/main` as its upstream. A bare `git push` then
does whatever `push.default` says — which, on the `upstream` setting, pushes your
commits to the base branch. The explicit form cannot push anywhere but the branch
you name, and it repairs the upstream on the way. There is nothing to decide.

Never `--force` or `--force-with-lease` in this skill at all. Force-pushing a
branch someone is reviewing throws away the review's anchor points; when it is
genuinely needed, it is a deliberate, separate act.

If the push is rejected by branch protection, surface the error verbatim and
stop. Do not rename the branch to get around it.

## Step 5 — Open the PR

### 5a. Check whether one already exists — carefully

```bash
gh pr list --head <CURRENT> --state all --json number,url,state
```

Use `--head`. A bare `gh pr view` resolves "the current branch's PR" through the
branch's **tracking config**, not its name — so on a branch cut from a remote ref
it cheerfully reports _that other branch's_ PR as yours. The failure is silent
and expensive: you skip PR creation, report success, and leave the work pushed
with nothing open on it. The opposite mistake is harmless, because `gh pr create`
refuses to open a duplicate, loudly.

If a PR really exists for `CURRENT`, print its URL and go to Step 6.

### 5b. Compose the title and body

**Title** (≤70 characters): `--title` if given; else the subject of the single
commit; else the most informative recent subject. Same conventions as the commit
subjects — a PR title is read in the same lists.

**Body.** Derive it from the commits, then write it for a reviewer who has not
seen any of this:

```markdown
## What this changes

- <2–4 bullets, condensed from the commits — not one bullet per commit>

## Why

<the constraint, bug, or decision behind it — one short paragraph. Skip only
when the title genuinely says it all.>

## How to check it

- [ ] <the actual command or click-path a reviewer would use>
```

The "how to check it" section is the one reviewers use most and authors write
least. Derive it from the diff — the test command, the endpoint, the page. If
nothing honest comes to mind, leave `- [ ] <fill in>` for the human. Never invent
a test plan; a fabricated one is worse than none, because it gets trusted.

Append whatever footer `pr.signature` in the config specifies. If an agent wrote
the body but a human's account is posting it, say so there — a reader deserves to
know who is on the other end. Write the body in the author's voice, first person
or plainly impersonal. Never refer to the author in the third person ("Nic asked
for…"): under their own avatar it reads as a stranger narrating them.

### 5c. Assignee and reviewers

- **Assignee:** the author (`--assignee "@me"`), so the PR has an owner in every
  board and filter. An unassigned PR is nobody's.
- **Reviewers:** resolve `.github/CODEOWNERS` **from the base branch**, not the
  working tree — GitHub enforces the base's copy, and a branch cut before
  CODEOWNERS landed will not have it locally, which would silently request nobody:

```bash
git diff --name-only origin/<BASE>...HEAD
git show origin/<BASE>:.github/CODEOWNERS
```

Apply it last-match-wins to each changed file, union the owners, and subtract the
author (GitHub refuses a request to review your own PR). If the base has no
CODEOWNERS, or the author owns everything they touched, request nobody and say
so in the report — do not invent a reviewer. If the config sets
`pr.reviewers`, use that instead.

### 5d. Create it

```bash
gh pr create --base <BASE> --head <CURRENT> \
  --assignee "@me" \
  --reviewer <owner1>,<owner2> \
  --title "<title>" --body "$(cat <<'EOF'
<body>
EOF
)"
```

Include `--reviewer` only when the set is non-empty — never pass the placeholder.
Add `--draft` when asked, or when `pr.draft` is true in config. Opening as a
draft is the right default for a team whose review bots run on every PR: it says
"not yet" without a comment thread about it.

If `gh` rejects a reviewer, **the PR may already exist** — the reviewer step
failed after creation. Check with `gh pr list --head <CURRENT>` before retrying;
if it exists, fix it with `gh pr edit --add-reviewer`, and only re-run
`gh pr create` if nothing is open. Blindly retrying is how you end up with two
PRs for one branch.

Print the URL on its own line. The user wants to click it.

## Step 6 — Move the PR into a worktree

This is the default, not a follow-up question. Opening the PR is what frees you
to start the next thing; the worktree is what actually frees the checkout, and
review comments will arrive on this branch for the rest of the day.

Skip only when `--no-worktree` was passed, `pr.worktree` is false in config, the
user has said they do not want one, or a worktree for this PR already exists.

**If you are already in a linked worktree**, rename it so the directory carries
the PR number — with five worktrees open, `pr-412-fix-login` is a working index:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/worktree.mjs" rename <PR-NUMBER>
```

**If you are in the main checkout**, move it off the branch and create a worktree
for the PR (`git worktree add` refuses a branch that is checked out elsewhere —
a git invariant, not a policy):

```bash
git switch <BASE>
node "$CLAUDE_PLUGIN_ROOT/scripts/worktree.mjs" pr <PR-NUMBER>
```

If `$CLAUDE_PLUGIN_ROOT` is not set in this environment, the script sits at
`../../scripts/worktree.mjs` relative to this file — resolve it once and reuse
the path.

If the script fails, surface the error and continue to Step 7 with the worktree
marked skipped. Do not try to repair worktree state from here.

## Step 7 — Report

Six lines at most: PR URL and base; title; commit count; whether `commit` ran;
assignee and reviewers (or why there are none); worktree path; anything `gh`
warned about. No diff summary — they have the link.

## Hard rules

- **Never push to a protected branch.** Three checks, no exceptions.
- **Never `--force` / `--force-with-lease`** in this skill.
- **Never merge.** `gh pr merge` is out of scope. Opening the PR is the contract;
  merging is a decision with an owner, and it is not this workflow.
- **Never bypass the `commit` skill** by inlining `git commit`.
- **Never `--no-verify`**, on commit or on push.
- **Never move a protected branch's ref without explicit confirmation.**
