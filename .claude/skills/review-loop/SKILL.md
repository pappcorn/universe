---
name: review-loop
description: |
  Drive an open pull request through this repo's automated review gate until it
  is green and ready for human approval. Waits for the `claude-review` check
  (workflow "Claude Code Review") and CI to settle, reads the posted
  `## Findings` review comment, then fixes every blocking 🔴 Important finding
  (edit + conventional commit + push, which deterministically re-runs the gate)
  or disputes it by replying `@claude` on the PR. Loops until the check passes
  or escalates a contested finding to the maintainers. When green, applies the
  `ready-to-merge` label — which in this repo only pings the human reviewers
  for approval; it never merges anything. Use when asked to "run the review
  loop", "wait for the review", "get this PR to green", "address the review
  findings", or "poll the PR until it passes".
argument-hint: '[pr-number|url]  |  [--max N]  |  [--dry-run]'
allowed-tools:
  - Bash(git status:*)
  - Bash(git branch:*)
  - Bash(git diff:*)
  - Bash(git log:*)
  - Bash(git fetch:*)
  - Bash(git merge:*)
  - Bash(git add:*)
  - Bash(git commit:*)
  - Bash(git push:*)
  - Bash(git rev-parse:*)
  - Bash(gh pr view:*)
  - Bash(gh pr checks:*)
  - Bash(gh pr comment:*)
  - Bash(gh pr edit:*)
  - Bash(gh pr update-branch:*)
  - Bash(gh api:*)
  - Bash(gh run view:*)
  - Bash(gh run list:*)
  - Bash(gh label:*)
  - Read
  - Edit
  - Write
---

# /review-loop — drive a PR to a green review

Run the review loop on a pull request in `pappcorn/universe`: wait for the
automated gate, fix or dispute every blocking finding, and loop until the PR is
green — then hand it to the human reviewers.

Arguments (`$ARGUMENTS`, all optional, any order):

- A bare PR number or URL → the PR to run on. Default: the PR for the current
  branch.
- `--max N` → max fix/dispute iterations before escalating. Default: `3`.
- `--dry-run` → poll and report the findings, but do not fix, dispute, or push.

---

## The gate contract (this repo)

- **Check**: `claude-review`, from the workflow **"Claude Code Review"**
  (`.github/workflows/claude-code-review.yml`). It runs on every PR `opened` /
  `synchronize` event, posts a review comment, and fails the check unless the
  review verdict is PASS.
- **Findings**: the review is a PR comment containing a `## Findings` section.
  Always read the **latest** `## Findings` comment posted **after** the current
  head commit's run started — an older comment describes an older diff.
- **Severities**:
  - 🔴 **Important** — blocks merge. The check fails while any exists.
  - 🟡 **Nit** — does not block. Fix if cheap, otherwise leave a short comment.
  - 🟣 **Pre-existing** — informational, never blocks.
- **Determinism**: the gate grades the pushed diff. Same diff → same verdict.
  The only way to flip a failing check is to **change the code and push**. A
  comment triggers a conversation (`@claude` replies via
  `.github/workflows/claude.yml`), never a re-grade.

---

## Step 0 — Resolve the PR

- If `$ARGUMENTS` has a number/URL, use it; else `gh pr view` on the current
  branch. No PR → stop and say so (this skill does not open PRs).
- Confirm the PR is `OPEN`. Record its number, base, and head branch.

## Step 1 — Make the branch current and the diff pushed

The gate grades the pushed diff against the base.

1. `git fetch origin <base>` and check `git log --oneline HEAD..origin/<base>`.
   If the base moved ahead, merge it in (`git merge origin/<base>` or
   `gh pr update-branch`). Trivial conflicts only — anything non-obvious stops
   the loop and goes to a human.
2. Push any unpushed commits with a plain `git push`. Never force-push.
3. Uncommitted changes in the tree → stop and tell the user; the loop grades
   committed, pushed code.

## Step 2 — Wait for the gate and CI to settle

```bash
gh pr checks <PR> --watch --interval 30 --json name,state,bucket,workflow,link
```

`--watch` blocks until every check completes and exits non-zero if any failed —
that exit code is a signal, not an error. Capture the JSON either way. If the
`claude-review` check never appears after CI completes, surface that instead of
treating it as green.

## Step 3 — Read the verdict and the findings

- **Gate**: the `claude-review` check. Green iff its bucket is `pass`.
- **CI**: the `CI` workflow check (`nx affected -t lint test build`). For a
  red CI check, pull the failing detail: `gh run view <run-id> --log-failed`.
- **Findings**: fetch the newest qualifying review comment:

```bash
gh api "repos/pappcorn/universe/issues/<PR>/comments" --paginate \
  --jq '[.[] | select(.body | contains("## Findings"))] | last | .body'
```

Verify it postdates the current head commit's review run (compare `created_at`
against the run's start time from `gh run list`). Split findings by severity.

### Red without a verdict — infrastructure failures

`claude-review` can fail **before any review runs**. If the check is red and no
`## Findings` comment postdates the run, read the failure log
(`gh run view <run-id> --log-failed`) and classify instead of looping:

- **The PR modifies `claude-code-review.yml` itself.** The action's app-token
  exchange requires the workflow file on the PR head to be byte-identical to
  the one on the default branch, and otherwise fails with
  `401 Workflow validation failed`. That is the action's tamper guard, not a review
  verdict — no push can turn the check green while the workflow change is part
  of the PR. Post the classification as a PR comment so the human reviewers
  know the red is expected, then stop; the check heals on the first PR after
  the workflow change merges.
- **Any other pre-review error** (bad or expired credentials, a retired model
  id, runner issues): there is no code finding to fix. Surface the relevant
  log excerpt on the PR and escalate (Step 6) — never retry-loop hoping for a
  different outcome, and never weaken the workflow to get past it.

If `--dry-run`: report verdict + findings and stop here.

## Step 4 — Fix or dispute each 🔴 (and red CI)

Default to **fix** — the reviewer is usually right, and only a code change can
flip the gate.

**Fix**: make the minimal edit for that finding (no drive-by refactors), commit
with a conventional-commit message scoped like the repo history
(`fix(gmail-mcp): …`, `chore(ci): …`), and let Step 5 push. Fix red CI the same
way (lint rule, failing test, build error).

**Dispute** (when the finding is genuinely wrong): reply on the PR tagging the
reviewer so the exchange is on the record:

```bash
gh pr comment <PR> --body "@claude Re: <finding>. <concrete counter-argument with file:line evidence>. Do you still consider this blocking?"
```

Know the limit: a comment gets a reply, not a re-grade. If the dispute ends
with no code change, that is an escalation (Step 6), never a workaround.

🟡 Nits: fix them when cheap; otherwise leave a one-line comment saying why
not. 🟣 Pre-existing: acknowledge if useful; they never block and out-of-scope
fixes belong in their own PR.

## Step 5 — Re-push and re-grade

If Step 4 produced commits, `git push` (plain form). That `synchronize` event
re-runs the gate on the new diff. Increment the iteration counter and go back
to Step 2 — until green or `--max` is hit. If Step 4 produced no commits
(pure dispute), go straight to Step 6.

## Step 6 — Terminate

### Green (success)

When `claude-review` and CI both pass:

1. Post a short summary comment: verdict, iterations, what was fixed.
2. Apply the label:

```bash
gh pr edit <PR> --add-label ready-to-merge
```

In this repo the `ready-to-merge` label is an **authorization**: it triggers
`.github/workflows/cris-approve.yml`, which re-checks the objective gate and —
when the PR's author is a human code owner of everything it touches — approves
as Cris and arms GitHub's native auto-merge. When the author is Cris or an
outside contributor, or the PR touches a governance carve-out
(`cris-approve.yml`, `CODEOWNERS`), a human code owner (@ni500, @lcaloguerea)
must approve — branch protection enforces it. The full decision table lives in
CONTRIBUTING.md ("Who can approve").

### Escalate

When `--max` iterations are spent with a 🔴 remaining, or a 🔴 is contested
and will not be changed in code: post a PR comment tagging **@ni500
@lcaloguerea** with the unresolved finding (file:line, one line each), a link
to any `@claude` dispute thread, and a recommendation. Then stop — the
maintainers break the tie.

---

## Hard rules

- **Never fake green.** No editing the workflow, weakening the check, or
  merging around it. The only paths to green are a code fix or a maintainer's
  ruling.
- **Never force-push.** Plain `git push` only.
- **Never merge.** `gh pr merge` is out of scope in every form. Merging is the
  human reviewers' call after approval.
- **Only 🔴 blocks.** Don't chase 🟡/🟣 to green, and don't ignore them
  silently either — a one-line disposition is enough.
- **A comment doesn't re-grade.** Only a push re-runs the gate; build the loop
  around that.
- **Scope discipline.** Fix the finding, not adjacent code.
