#!/usr/bin/env node
// worktree.mjs — zero-dep worktree manager for the best-practices-git plugin.
//
// Git worktrees let several checkouts of the same repository exist side by side,
// each on its own branch. That is what makes parallel work — two people, or two
// agents, or you and an agent — possible without anyone switching a branch out
// from under anyone else.
//
// Usage (from anywhere inside the repo):
//   node worktree.mjs status
//   node worktree.mjs create <branch> [--base <ref>] [--dir <name>] [--no-install]
//   node worktree.mjs pr <number> [--no-install]
//   node worktree.mjs rename <number>
//   node worktree.mjs list
//   node worktree.mjs remove <dir-or-path> [--force]
//   node worktree.mjs prune
//
// Config (all keys optional): .claude/best-practices-git.json in the repo root.
// See the plugin README. Nothing here is specific to any one repo or team.
//
// Shells out to `git` and `gh`. No npm dependencies, on purpose: this has to run
// in a fresh clone before anyone has installed anything.

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

// ── shell helpers ──────────────────────────────────────────────────────────

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', ...opts }).trim();
}

/**
 * Contract, and it matters: `null` means the command FAILED. A command that
 * succeeded and printed nothing returns `''`, which is falsy — so callers must
 * test `=== null`, never `!result`. Commands like `git fetch` print nothing on
 * success, and a truthiness check there reads success as failure.
 */
function shTry(cmd, args, opts = {}) {
  try {
    return sh(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  } catch {
    return null;
  }
}

function die(msg) {
  console.error(`x ${msg}`);
  process.exit(1);
}

const ok = (msg) => console.log(`* ${msg}`);
const note = (msg) => console.log(`  ${msg}`);

// ── repo discovery ─────────────────────────────────────────────────────────

/**
 * The MAIN worktree, not the current one. `git rev-parse --show-toplevel`
 * answers "which checkout am I in", which is the wrong question when you are
 * already inside a linked worktree: the siblings directory would then be
 * computed relative to the worktree and nest inside itself. `git worktree list`
 * always reports the main worktree first, from anywhere.
 */
function mainRoot() {
  const raw = shTry('git', ['worktree', 'list', '--porcelain']);
  if (!raw) die('not inside a git repository');
  const first = raw.split('\n').find((l) => l.startsWith('worktree '));
  return first
    ? first.slice('worktree '.length).trim()
    : sh('git', ['rev-parse', '--show-toplevel']);
}

function currentBranch() {
  return shTry('git', ['symbolic-ref', '--quiet', '--short', 'HEAD']);
}

/**
 * The repo's default branch, asked of the forge first. A local `origin/HEAD` is
 * a symbolic ref frozen at clone time; when a repo renames or switches its
 * default branch, every clone made before the change keeps pointing at the old
 * one and silently opens PRs against a dead branch.
 */
function defaultBranch() {
  const api = shTry('gh', [
    'repo',
    'view',
    '--json',
    'defaultBranchRef',
    '--jq',
    '.defaultBranchRef.name',
  ]);
  if (api) return api;
  const ref = shTry('git', [
    'symbolic-ref',
    '--quiet',
    '--short',
    'refs/remotes/origin/HEAD',
  ]);
  if (ref) return ref.replace(/^origin\//, '');
  for (const candidate of ['main', 'master', 'trunk']) {
    if (
      shTry('git', [
        'rev-parse',
        '--verify',
        '--quiet',
        `refs/remotes/origin/${candidate}`,
      ])
    )
      return candidate;
  }
  return 'main';
}

// ── config ─────────────────────────────────────────────────────────────────

const DEFAULTS = {
  protectedBranches: [
    'main',
    'master',
    'develop',
    'release',
    'production',
    'prod',
  ],
  worktrees: {
    dir: 'auto', // auto -> ../<repo>.worktrees
    copy: [], // gitignored local files to seed into a new worktree
    install: 'auto', // auto | off | "<command>"
  },
};

function loadConfig(root) {
  const path = join(root, '.claude', 'best-practices-git.json');
  if (!existsSync(path)) return DEFAULTS;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    die(`could not parse ${relative(root, path)}: ${e.message}`);
  }
  const cfg = {
    ...DEFAULTS,
    ...parsed,
    worktrees: { ...DEFAULTS.worktrees, ...(parsed.worktrees || {}) },
  };
  // Validate here, not at the point of use: a bad install command discovered
  // after `git worktree add` leaves a half-made worktree behind for the user
  // to clean up. Refuse before anything exists.
  assertRunnableInstall(cfg.worktrees.install);
  return cfg;
}

function worktreesDir(root, cfg) {
  const configured = cfg.worktrees.dir;
  if (configured && configured !== 'auto') return resolve(root, configured);
  return join(dirname(root), `${basename(root)}.worktrees`);
}

function isProtected(cfg, branch) {
  return !!branch && cfg.protectedBranches.includes(branch);
}

// ── arg parsing ────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

const slug = (s) =>
  s
    .replace(/[^a-zA-Z0-9._/-]+/g, '-')
    .replace(/\//g, '-')
    .replace(/^-+|-+$/g, '');

// ── seeding a new worktree ─────────────────────────────────────────────────

/**
 * Copy the gitignored local files a fresh worktree cannot get from git.
 * Patterns are simple: a path, or a directory, or a trailing-`*` prefix match
 * on a basename (".env*"). Copies, never symlinks — a symlinked local settings
 * file means one checkout's edits leak into another's, which is exactly the
 * isolation a worktree is for.
 */
function seedLocalFiles(root, target, patterns) {
  if (!patterns || patterns.length === 0) return 0;
  let copied = 0;

  const copyOne = (from, rel) => {
    const dest = join(target, rel);
    if (existsSync(dest)) return; // the branch's own version always wins
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(from, dest);
    copied++;
  };

  for (const pattern of patterns) {
    const star = pattern.indexOf('*');
    if (star === -1) {
      const from = join(root, pattern);
      if (existsSync(from) && statSync(from).isFile()) copyOne(from, pattern);
      continue;
    }
    // ".env*" or "config/*.local" — glob the basename inside its directory only.
    const dir = dirname(pattern) === '.' ? '' : dirname(pattern);
    const prefix = basename(pattern).slice(0, basename(pattern).indexOf('*'));
    const scanDir = join(root, dir);
    if (!existsSync(scanDir)) continue;
    for (const entry of readdirSync(scanDir)) {
      if (!entry.startsWith(prefix)) continue;
      const from = join(scanDir, entry);
      if (!statSync(from).isFile()) continue;
      copyOne(from, dir ? join(dir, entry) : entry);
    }
  }
  return copied;
}

// Shell metacharacters. A configured install command is read from a file that
// travels with the repository, so `git clone && create a worktree` would be
// enough to run whatever a stranger wrote there. Nothing here ever reaches a
// shell (no `shell: true` anywhere in this file) and a command carrying any of
// these is refused outright rather than quietly split into something else.
const SHELL_METACHARS = /[;&|<>`$(){}[\]!*?~\n\r\\"']/;

const isCustomInstall = (configured) =>
  typeof configured === 'string' &&
  configured !== 'auto' &&
  configured !== 'off';

function assertRunnableInstall(configured) {
  if (!isCustomInstall(configured)) return;
  if (SHELL_METACHARS.test(configured)) {
    die(
      `refusing worktrees.install: ${configured}\n` +
        '  It contains shell metacharacters, and this script never invokes a shell.\n' +
        '  Use a plain "program arg arg" command, or put the logic in a script and name that.',
    );
  }
}

/**
 * The install command as an argv array — never as a string for a shell to
 * re-parse. `null` means "install nothing".
 */
function installCommand(target, configured) {
  if (configured === 'off' || configured === false) return null;
  if (isCustomInstall(configured)) {
    assertRunnableInstall(configured);
    const argv = configured.trim().split(/\s+/).filter(Boolean);
    return argv.length ? argv : null;
  }
  if (!existsSync(join(target, 'package.json'))) return null;
  if (existsSync(join(target, 'pnpm-lock.yaml')))
    return ['pnpm', 'install', '--frozen-lockfile'];
  if (existsSync(join(target, 'yarn.lock')))
    return ['yarn', 'install', '--immutable'];
  if (
    existsSync(join(target, 'bun.lockb')) ||
    existsSync(join(target, 'bun.lock'))
  )
    return ['bun', 'install'];
  if (existsSync(join(target, 'package-lock.json'))) return ['npm', 'ci'];
  return ['npm', 'install'];
}

function tryInstall(target, argv) {
  try {
    execFileSync(argv[0], argv.slice(1), {
      cwd: target,
      stdio: ['ignore', 'ignore', 'pipe'],
      encoding: 'utf8',
    });
    return true;
  } catch {
    return false;
  }
}

function runInstall(target, configured) {
  const argv = installCommand(target, configured);
  if (!argv) {
    note('no dependency install (nothing to install, or disabled in config)');
    return;
  }
  const pretty = argv.join(' ');
  process.stdout.write(`  installing dependencies: ${pretty}\n`);

  if (tryInstall(target, argv)) {
    ok(`dependencies installed (${pretty})`);
    return;
  }
  // `npm ci` fails on a lockfile that is out of sync with package.json, which
  // is common on a branch that changed dependencies. `npm install` is the
  // documented recovery, so try it before giving up.
  if (pretty === 'npm ci') {
    note('npm ci failed, falling back to npm install');
    if (tryInstall(target, ['npm', 'install'])) {
      ok('dependencies installed (npm install)');
      return;
    }
  }
  note(
    `! install failed — the worktree exists, run "${pretty}" in it yourself`,
  );
}

// ── commands ───────────────────────────────────────────────────────────────

function addWorktree({ root, cfg, branch, base, dirName, install }) {
  const dir = join(worktreesDir(root, cfg), dirName);
  if (existsSync(dir))
    die(
      `target already exists: ${dir}\n  remove it, or pass a different --dir`,
    );

  shTry('git', ['fetch', 'origin', base]);
  const baseRef = shTry('git', [
    'rev-parse',
    '--verify',
    '--quiet',
    `refs/remotes/origin/${base}`,
  ])
    ? `origin/${base}`
    : base;

  mkdirSync(dirname(dir), { recursive: true });

  const branchExists =
    shTry('git', [
      'rev-parse',
      '--verify',
      '--quiet',
      `refs/heads/${branch}`,
    ]) ||
    shTry('git', [
      'rev-parse',
      '--verify',
      '--quiet',
      `refs/remotes/origin/${branch}`,
    ]);

  let how;
  if (branchExists) {
    try {
      sh('git', ['worktree', 'add', dir, branch], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      how = `existing branch ${branch}`;
    } catch (e) {
      die(
        `git worktree add failed: ${(e.stderr || e.message).trim()}\n` +
          `  A branch can only be checked out in one worktree at a time.\n` +
          `  Run "git worktree list" to find where "${branch}" already lives.`,
      );
    }
  } else {
    try {
      sh('git', ['worktree', 'add', '-b', branch, dir, baseRef], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      how = `new branch from ${baseRef}`;
    } catch (e) {
      die(`git worktree add failed: ${(e.stderr || e.message).trim()}`);
    }
  }
  ok(`worktree created (${how})`);

  const seeded = seedLocalFiles(root, dir, cfg.worktrees.copy);
  if (seeded > 0) ok(`seeded ${seeded} local file(s) from the main checkout`);

  if (install !== false) runInstall(dir, cfg.worktrees.install);

  console.log('');
  console.log(`  path:   ${dir}`);
  console.log(`  branch: ${branch}`);
  console.log(`  base:   ${baseRef}`);
  console.log('');
  console.log(`  cd ${dir}`);
  return dir;
}

function cmdCreate(root, cfg, args) {
  const branch = args._[0];
  if (!branch)
    die('usage: worktree.mjs create <branch> [--base <ref>] [--dir <name>]');
  if (isProtected(cfg, branch))
    die(`refusing to create a worktree on the protected branch "${branch}"`);
  addWorktree({
    root,
    cfg,
    branch,
    base: args.base || defaultBranch(),
    dirName: args.dir ? String(args.dir) : slug(branch),
    install: !args['no-install'],
  });
}

function cmdPr(root, cfg, args) {
  const num = args._[0];
  if (!num || !/^\d+$/.test(String(num)))
    die('usage: worktree.mjs pr <number>');
  const raw = shTry('gh', [
    'pr',
    'view',
    String(num),
    '--json',
    'headRefName,baseRefName',
  ]);
  if (!raw)
    die(`could not read PR #${num} — is gh authenticated for this repo?`);
  const { headRefName, baseRefName } = JSON.parse(raw);

  // Fetch the PR's head ref by number, not by branch name. `origin/<branch>`
  // does not exist when the PR comes from a fork, and it disappears when the
  // branch is deleted after merge — in both cases a name-based lookup would
  // quietly create a NEW branch off the base and present it as the PR.
  // An existing local branch of that name is left alone: it is the user's.
  if (
    !shTry('git', [
      'rev-parse',
      '--verify',
      '--quiet',
      `refs/heads/${headRefName}`,
    ])
  ) {
    // `!== null` and not a truthiness check: a successful fetch prints nothing
    // to stdout, so a bare `if (!shTry(...))` reads success as failure.
    if (
      shTry('git', ['fetch', 'origin', `pull/${num}/head:${headRefName}`]) ===
      null
    ) {
      die(`could not fetch the head of PR #${num} (pull/${num}/head)`);
    }
  }

  addWorktree({
    root,
    cfg,
    branch: headRefName,
    base: baseRefName || defaultBranch(),
    dirName: `pr-${num}-${slug(headRefName)}`,
    install: !args['no-install'],
  });
}

/**
 * Rename the worktree you are standing in so its directory carries the PR
 * number. The number is the index: with five worktrees open, "pr-412-fix-login"
 * tells you what it is and where to review it without running a single command.
 */
function cmdRename(root, cfg, args) {
  const here = sh('git', ['rev-parse', '--show-toplevel']);
  if (here === root)
    die('this is the main checkout, not a linked worktree — nothing to rename');

  let num = args._[0];
  if (!num) {
    const branch = currentBranch();
    const raw = branch
      ? shTry('gh', [
          'pr',
          'list',
          '--head',
          branch,
          '--state',
          'open',
          '--json',
          'number',
          '--jq',
          '.[0].number',
        ])
      : null;
    if (!raw)
      die('no open PR found for this branch — pass the number explicitly');
    num = raw;
  }
  const target = join(
    worktreesDir(root, cfg),
    `pr-${num}-${slug(currentBranch() || 'branch')}`,
  );
  if (here === target) {
    ok(`already named ${basename(target)}`);
    return;
  }
  try {
    sh('git', ['worktree', 'move', here, target], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    console.error(
      `! could not rename the worktree: ${(e.stderr || e.message).trim()}`,
    );
    console.error(
      '  (a process may be holding the directory open; retry with "rename" later)',
    );
    return;
  }
  ok(`worktree renamed -> ${target}`);
  console.log(`  cd ${target}`);
}

function cmdList(root, cfg) {
  const raw = sh('git', ['worktree', 'list', '--porcelain']);
  for (const block of raw.split('\n\n').filter(Boolean)) {
    const lines = block.split('\n');
    const path = (lines.find((l) => l.startsWith('worktree ')) || '').slice(
      'worktree '.length,
    );
    const branch =
      (lines.find((l) => l.startsWith('branch ')) || '').replace(
        'branch refs/heads/',
        '',
      ) || '(detached)';
    const tags = [];
    if (path === root) tags.push('main checkout');
    if (isProtected(cfg, branch)) tags.push('protected');
    const dirty = shTry('git', ['-C', path, 'status', '--porcelain']);
    if (dirty) tags.push('uncommitted changes');
    console.log(
      `${path}\n    ${branch}${tags.length ? `  [${tags.join(', ')}]` : ''}`,
    );
  }
}

function cmdRemove(root, cfg, args) {
  const nameOrPath = args._[0];
  if (!nameOrPath) die('usage: worktree.mjs remove <dir-or-path> [--force]');
  const target =
    nameOrPath.includes(sep) || nameOrPath.startsWith('.')
      ? resolve(nameOrPath)
      : join(worktreesDir(root, cfg), nameOrPath);
  if (target === root) die('refusing to remove the main checkout');
  if (!existsSync(target)) die(`no such worktree: ${target}`);

  const dirty = shTry('git', ['-C', target, 'status', '--porcelain']);
  if (dirty && !args.force) {
    console.error(`x ${target} has uncommitted changes:`);
    console.error(
      dirty
        .split('\n')
        .map((l) => `    ${l}`)
        .join('\n'),
    );
    console.error('  Commit them, or pass --force to throw them away.');
    process.exit(1);
  }

  try {
    sh(
      'git',
      ['worktree', 'remove', ...(args.force ? ['--force'] : []), target],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (e) {
    die(`git worktree remove failed: ${(e.stderr || e.message).trim()}`);
  }
  ok(`removed ${target}`);
  note(
    'the branch itself is untouched — delete it with "git branch -d <branch>" if you are done with it',
  );
}

function cmdPrune() {
  const out = sh('git', ['worktree', 'prune', '-v']);
  ok('pruned stale worktree records');
  if (out) console.log(out);
}

function cmdStatus(root, cfg) {
  const here = sh('git', ['rev-parse', '--show-toplevel']);
  const branch = currentBranch() || '(detached HEAD)';
  console.log(`main checkout:  ${root}`);
  console.log(
    `you are in:     ${here}${
      here === root ? '  (main checkout)' : '  (linked worktree)'
    }`,
  );
  console.log(
    `branch:         ${branch}${
      isProtected(cfg, branch) ? '  [protected — branch before you commit]' : ''
    }`,
  );
  console.log(`default base:   ${defaultBranch()}`);
  console.log(`worktrees dir:  ${worktreesDir(root, cfg)}`);
  const cfgPath = join(root, '.claude', 'best-practices-git.json');
  console.log(
    `config:         ${
      existsSync(cfgPath) ? cfgPath : '(none — using defaults)'
    }`,
  );
}

// ── entry point ────────────────────────────────────────────────────────────

const [, , sub, ...rest] = process.argv;
const args = parseArgs(rest);
const root = mainRoot();
const cfg = loadConfig(root);

switch (sub) {
  case 'create':
    cmdCreate(root, cfg, args);
    break;
  case 'pr':
    cmdPr(root, cfg, args);
    break;
  case 'rename':
    cmdRename(root, cfg, args);
    break;
  case 'list':
    cmdList(root, cfg);
    break;
  case 'remove':
    cmdRemove(root, cfg, args);
    break;
  case 'prune':
    cmdPrune();
    break;
  case 'status':
    cmdStatus(root, cfg);
    break;
  default:
    console.error(
      [
        'usage: worktree.mjs <command>',
        '',
        '  status                     where you are, what the base is, where worktrees land',
        '  create <branch> [--base R] [--dir N] [--no-install]',
        '  pr <number> [--no-install] check out an existing PR in its own worktree',
        '  rename [<number>]          rename this worktree to pr-<number>-<branch>',
        '  list                       every worktree, its branch, and whether it is dirty',
        '  remove <dir> [--force]     remove a worktree (refuses if it has uncommitted work)',
        '  prune                      drop records of worktrees whose directories are gone',
      ].join('\n'),
    );
    process.exit(1);
}
