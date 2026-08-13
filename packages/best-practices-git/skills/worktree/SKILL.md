---
name: worktree
description: |
  Create, list, and remove git worktrees so several branches can be open at once
  without anyone switching a branch out from under anyone else — the default way
  to work when agents and humans share a repository. Modes: a new branch in its
  own checkout, an existing PR checked out for review, list, remove, prune.
  Worktrees land in a sibling directory, each with its own dependencies and its
  own local config, copied rather than symlinked. Backed by a zero-dep Node
  script. Use when the user says "worktree", "check out that PR locally",
  "work on two branches at once", "haz un worktree", "spin up a branch in
  parallel", or needs the current checkout free without losing what is in it.
user-invocable: true
argument-hint: '<branch> | pr <number> | list | remove <dir> | status'
allowed-tools:
  - Bash(node:*)
  - Bash(git worktree:*)
  - Bash(git branch:*)
  - Bash(git status:*)
  - Bash(git rev-parse:*)
  - Bash(git fetch:*)
  - Bash(gh pr view:*)
  - Bash(gh pr list:*)
  - Bash(ls:*)
  - Bash(test:*)
  - Read
  - AskUserQuestion
---

# /worktree — several branches, open at once

Argument: `$ARGUMENTS`.

## Why worktrees, and not the thing you were going to do instead

A worktree is a second working directory for the same repository, on its own
branch, sharing one object database. Cheap to make, cheap to throw away.

**Instead of `git stash`.** A stash is a single stack scoped to the whole
repository, and it is invisible: work goes into it with no branch, no message,
and no reminder. Stashes are where changes go to be forgotten. Worse, if a second
session stashes while yours is stashed, the pops come back in an order neither of
you chose.

**Instead of switching branches.** Switching rewrites every file in the
directory. Your editor reloads, your dev server rebuilds, your test watcher
restarts, and — the expensive one — anything running against that directory is
now running against different code than it was a second ago. With a build cache
in play, that is minutes each way.

**And, decisively, when agents are involved.** Two agents in one checkout is not
a slow setup, it is a broken one: agent A checks out its branch, agent B checks
out another, and A's next edit lands on B's branch. Nothing errors. The damage
shows up later, in a diff nobody can explain. Git's own invariant — a branch can
only be checked out in one worktree at a time — is the guard rail, and worktrees
are how you get it. One worktree per line of work, per worker, is the rule that
makes parallelism safe.

The cost is disk: each worktree wants its own `node_modules` (or equivalent).
That is the trade, and it is usually a good one.

## Live state

Where you are and where worktrees land:

```!
node "${CLAUDE_PLUGIN_ROOT:-.}/scripts/worktree.mjs" status 2>/dev/null || echo "(run the script from inside a git repo)"
```

Existing worktrees:

```!
git worktree list
```

## The script

Every mode below calls one zero-dep helper:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/worktree.mjs" <command>
```

If `$CLAUDE_PLUGIN_ROOT` is unset in this environment, the script is at
`../../scripts/worktree.mjs` relative to this file. Resolve the path once and
reuse it.

## Mode: new branch

`$ARGUMENTS` is a branch name, optionally followed by a description of the work.

1. **Name the branch.** Follow the repo's existing convention — check
   `git branch -a` and the merged history before inventing one. If there is no
   convention, use `<type>/<slug>` with the same type vocabulary as the commit
   messages (`feat`, `fix`, `chore`, `refactor`, `docs`). Ask with
   `AskUserQuestion` when the type is not obvious from the description; do not
   guess a name the user will have to live with.

2. **Create it.**

   ```bash
   node "$CLAUDE_PLUGIN_ROOT/scripts/worktree.mjs" create <branch> [--base <ref>]
   ```

   The base defaults to the repo's default branch, fetched first so the new
   branch starts from current code rather than from whatever your local ref
   happened to be. The script seeds the gitignored local files listed under
   `worktrees.copy` in `.claude/best-practices-git.json` (nothing by default) and
   installs dependencies with whatever package manager the lockfile indicates.

3. **Report** the path, the branch, the base, and the `cd` line. Then stop. The
   worktree is ready; what runs in it is the next decision, not this skill's.

## Mode: an existing PR

`$ARGUMENTS` is a PR number or URL — reviewing a PR locally is the single most
common reason to want a second checkout.

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/worktree.mjs" pr <number>
```

The directory is named `pr-<number>-<branch>`, so the number is the index: what a
worktree is for is legible from `ls` alone, without asking git or GitHub.

## Mode: list

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/worktree.mjs" list
```

Prints every worktree with its branch and flags the ones that are the main
checkout, on a protected branch, or holding uncommitted changes. Print the output
as-is; it is already the answer.

## Mode: remove

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/worktree.mjs" remove <dir-name>
```

The argument is the **directory** name, which for a PR worktree is
`pr-<n>-<branch>`, not the branch. The script refuses when the worktree has
uncommitted changes and prints them; `--force` throws that work away and is a
question for the user, never a default. Removing a worktree does not delete the
branch — say so, and let them decide about the branch separately.

Follow with `prune` when directories were deleted by hand outside git.

## Hard rules

- **Never remove a worktree the user did not ask about**, and never `--force`
  without an explicit yes. Uncommitted work in a worktree is invisible from
  everywhere else — that is precisely why it gets destroyed by accident.
- **Never check out a branch that is already checked out elsewhere.** Git refuses
  and it is right to. The fix is for the other worktree to move off it, or for
  this work to use a different branch — never a workaround.
- **Never symlink local config or dependencies between worktrees.** The script
  copies. A shared settings file means one session's change silently rewrites
  another's environment, which is the exact failure worktrees exist to prevent.
- **Never edit files inside another worktree** to "fix" it. This skill creates
  and removes worktrees; whoever is working in one owns its contents.
- **Do not start editors, dev servers, builds, or deploys.** Creating the
  checkout is the whole job.
- **Keep worktrees outside the repository directory.** The script puts them in a
  sibling; nesting them inside makes every `find`, every file watcher, and every
  build tool recurse into a full second copy of the project.
