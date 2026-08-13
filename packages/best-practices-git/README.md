# best-practices-git

**Three skills that encode how a team working with agents commits, opens pull
requests, and keeps parallel branches from stepping on each other.**

```bash
/plugin marketplace add pappcorn/universe
/plugin install best-practices-git@pappcorn-plugins
```

No credentials, no server, no network calls of its own. It drives the `git` and
`gh` you already have.

---

## What it installs

| Skill       | What it does                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `/commit`   | Stages by name and writes a message whose body explains **why**, in whatever convention your repo's history already uses              |
| `/git-pr`   | Opens the PR from the current branch, keeps it small enough to actually be reviewed, and cannot push to a protected branch            |
| `/worktree` | Creates and manages worktrees so several branches — several agents — can be open at once without switching one out from under another |

Inside Claude Code they are namespaced by the plugin:
`/best-practices-git:commit`, `/best-practices-git:git-pr`,
`/best-practices-git:worktree`.

## The opinions, stated plainly

These are the parts worth arguing with. The skills carry the reasoning; this is
the summary.

**The commit message explains why, not what.** The diff is a perfect record of
what changed and a useless record of why. Only the message can carry the
constraint, the incident, or the option not taken — and only for about a day,
while the author still remembers.

**One commit, one reason to change.** A commit that fixes a bug _and_ renames a
variable _and_ bumps a dependency cannot be reverted, cherry-picked, or bisected.
You find that out on the day you urgently need all three.

**Stage by name. Never `git add -A`.** It sweeps in the file another session
wrote thirty seconds ago, the debug print you meant to delete, and the local
config you never intended to share. Naming the files is the last point where a
human decision is still possible.

**Small PRs get reviewed; large PRs get approved.** Attention is finite. A
40-line diff is read line by line; a 2,000-line diff is skimmed for anything
alarming and waved through. The large PR feels like more progress and delivers
less review. It also rots — a branch alive for a week competes with everyone
else's work instead of joining it.

**Pushing to a protected branch must be impossible, not discouraged.** `/git-pr`
enforces it three separate ways. The cost of being annoying about this is one
extra check; the cost of getting it wrong once is a rewritten shared history.

**Worktrees, not `git stash`, and not branch switching.** A stash is an invisible
global stack where changes go to be forgotten. Switching branches rewrites every
file, restarting your dev server and invalidating your build cache. And when two
agents share one checkout, the second one's `git switch` silently moves the first
one's edits onto the wrong branch — nothing errors, and the damage surfaces later
in a diff nobody can explain. One worktree per line of work is what makes
parallel agents safe.

**Hooks always run.** `--no-verify` skips a check that runs in CI anyway ten
minutes later, in front of everyone.

**The repo's existing conventions beat this plugin's preferences.** `/commit`
reads your history — Conventional Commits or not, scopes or not, trailers or not
— and matches it. Consistency is worth more than any individual style rule,
because a uniform history is the only searchable kind.

## Configuration

Everything works with no configuration. To override a default, create
`.claude/best-practices-git.json` in your repo root. Every key is optional.

```json
{
  "base": "auto",
  "protectedBranches": [
    "main",
    "master",
    "develop",
    "release",
    "production",
    "prod"
  ],
  "language": "en",
  "commit": {
    "convention": "auto",
    "scopes": "auto",
    "trailers": []
  },
  "pr": {
    "draft": false,
    "worktree": true,
    "reviewers": "codeowners",
    "signature": null
  },
  "worktrees": {
    "dir": "auto",
    "copy": [],
    "install": "auto"
  }
}
```

| Key                 | Default        | Meaning                                                                                                                        |
| ------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `base`              | `"auto"`       | PR base branch. `auto` = the repo's default branch, checked against what recent PRs actually target.                           |
| `protectedBranches` | the six listed | Branches `/commit` refuses to commit on and `/git-pr` refuses to push to. Add your own trunk names.                            |
| `language`          | `"en"`         | Language for commit subjects and PR bodies. Set it when your team writes history in another language.                          |
| `commit.convention` | `"auto"`       | `auto` infers from `git log`. Set `"conventional"` or `"plain"` to force it — useful when you are deliberately changing style. |
| `commit.scopes`     | `"auto"`       | `auto` derives candidate scopes from history and layout. `"off"` for no scopes, or a list to fix the vocabulary.               |
| `commit.trailers`   | `[]`           | Lines appended to every message, e.g. `["Co-Authored-By: … <…>"]`. Empty means: reproduce whatever the history already does.   |
| `pr.draft`          | `false`        | Open PRs as drafts. Worth turning on if review bots run on every PR.                                                           |
| `pr.worktree`       | `true`         | Move the PR into its own worktree so the checkout is free. `--no-worktree` overrides per invocation.                           |
| `pr.reviewers`      | `"codeowners"` | Resolve reviewers from the **base branch's** `.github/CODEOWNERS`. Or give an explicit list of handles.                        |
| `pr.signature`      | `null`         | Footer appended to PR bodies — where to disclose that an agent drafted the text posted under a human's account.                |
| `worktrees.dir`     | `"auto"`       | `auto` = `../<repo>.worktrees`, a sibling of the repo. Never nest worktrees inside the repo.                                   |
| `worktrees.copy`    | `[]`           | Gitignored local files to seed into a new worktree, e.g. `[".env*", ".claude/settings.local.json"]`. Copied, never symlinked.  |
| `worktrees.install` | `"auto"`       | `auto` picks the command from the lockfile (npm/pnpm/yarn/bun). `"off"` to skip, or give an explicit command.                  |

`worktrees.copy` is empty by default on purpose: seeding a worktree with your
`.env` is convenient and is also the plugin quietly making copies of your
credentials on disk. Opt in when you want it.

## The script

`scripts/worktree.mjs` — zero dependencies, shells out to `git` and `gh`, runs on
Node 20+. It has to work in a fresh clone before anyone has installed anything,
which is why it depends on nothing.

```bash
node scripts/worktree.mjs status                       # where you are, what the base is
node scripts/worktree.mjs create <branch> [--base R]   # new branch in its own checkout
node scripts/worktree.mjs pr <number>                  # check out a PR for review
node scripts/worktree.mjs rename [<number>]            # rename this worktree to pr-<n>-<branch>
node scripts/worktree.mjs list                         # branches, and which are dirty
node scripts/worktree.mjs remove <dir> [--force]       # refuses if there is uncommitted work
node scripts/worktree.mjs prune                        # drop records of deleted directories
```

Inside Claude Code the plugin's root is `$CLAUDE_PLUGIN_ROOT`, so the skills call
`node "$CLAUDE_PLUGIN_ROOT/scripts/worktree.mjs"`.

## Requirements

- **git** 2.17+ (for `git worktree move`)
- **[gh](https://cli.github.com)**, authenticated — needed by `/git-pr` and by
  the script's `pr` mode. `/commit` and local worktree work do not need it.
- **Node 20+** for the script.

## Not in this plugin

Reviewing the PR after it is open — waiting on an automated reviewer, triaging
its findings, driving the branch to green — is a different job with different
opinions, and it belongs to the team that owns the review gate rather than to
this one. `best-practices-git` stops at "the PR is open and reviewable".

## Part of a family

`best-practices-*` plugins each encode one practice a team otherwise learns the
hard way. This is the first. All of them are free and MIT-licensed, in
[pappcorn/universe](https://github.com/pappcorn/universe).

## License

[MIT](../../LICENSE).
