// Working-directory-scoped configuration: find and parse the nearest `.env`.
//
// WHY THIS EXISTS. A credential path baked into a single global default means
// one machine can only ever hold one identity. People routinely need more than
// one — a work mailbox and a personal one, two clients, two projects. Without
// folder scoping the only way to switch is to overwrite the same file, which is
// how credentials get destroyed and how mail gets sent from the wrong mailbox.
//
// So: configuration is resolved from where you ARE, not from where the package
// was installed. We walk up from the process working directory looking for a
// `.env`, and stop at the repository root.
//
// THE WALK-UP CONTRACT (deliberately narrow — surprising resolution is worse
// than no resolution):
//   • Start at `process.cwd()`. Never at the package's install location.
//   • In each directory: if `.env` exists, that is the answer — stop.
//   • Otherwise, if the directory contains `.git`, this is the repo root: stop
//     and report "nothing found". The walk never leaves the repository.
//   • Never look inside the user's home directory. `~/.env` is a grab-bag that
//     would quietly reintroduce the one-identity-per-machine problem; the
//     global credential file is the explicit, documented fallback instead.
//   • Give up after MAX_DEPTH directories, or at the filesystem root.
//
// If no `.env` is found we do NOT borrow a neighbour's. The caller falls back
// to the process environment and then to the global credential file.
//
// The parser is intentionally dumb: no variable interpolation, no command
// substitution, no `.env.local` cascade. A line means exactly what it says.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/** How many directories up we are willing to walk before giving up. */
export const MAX_DEPTH = 16;

export interface EnvFile {
  /** Absolute path of the `.env` that was found. */
  path: string;
  /** Parsed key/value pairs. Empty object for an empty or comment-only file. */
  values: Record<string, string>;
}

/**
 * Walk up from `startDir` looking for a `.env`, honouring the contract above.
 * Returns the absolute path, or null when nothing is in scope.
 */
export function findEnvFile(
  startDir: string,
  home: string = homedir()
): string | null {
  let dir = resolve(startDir);
  const stopAt = home ? resolve(home) : null;

  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    // The home directory is out of bounds: a credential picked up from
    // `~/.env` would apply to every folder on the machine, which is the exact
    // failure mode this module exists to remove.
    if (stopAt && dir === stopAt) return null;

    const candidate = join(dir, '.env');
    if (existsSync(candidate)) return candidate;

    // Repository root reached with no `.env` — do not climb out of the repo.
    if (existsSync(join(dir, '.git'))) return null;

    const parent = dirname(dir);
    if (parent === dir) return null; // filesystem root
    dir = parent;
  }
  return null;
}

/**
 * Parse `.env` text. Supports `KEY=value`, a leading `export`, `#` comments,
 * and single/double-quoted values (escape sequences only inside double quotes).
 * Unparseable lines are ignored rather than throwing — a malformed `.env`
 * should not take a mailbox offline.
 */
export function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const withoutExport = line.startsWith('export ')
      ? line.slice('export '.length).trim()
      : line;
    const eq = withoutExport.indexOf('=');
    if (eq <= 0) continue;

    const key = withoutExport.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = withoutExport.slice(eq + 1).trim();

    if (value.startsWith('"') && value.length > 1) {
      const end = findClosingQuote(value, '"');
      if (end === -1) continue;
      value = unescapeDoubleQuoted(value.slice(1, end));
    } else if (value.startsWith("'") && value.length > 1) {
      const end = value.indexOf("'", 1);
      if (end === -1) continue;
      value = value.slice(1, end); // single quotes are literal
    } else {
      // Unquoted: a `#` starts a trailing comment.
      const hash = value.indexOf('#');
      if (hash !== -1) value = value.slice(0, hash);
      value = value.trim();
    }

    values[key] = value;
  }

  return values;
}

function findClosingQuote(value: string, quote: string): number {
  for (let i = 1; i < value.length; i++) {
    if (value[i] === '\\') {
      i++; // skip the escaped character
      continue;
    }
    if (value[i] === quote) return i;
  }
  return -1;
}

function unescapeDoubleQuoted(value: string): string {
  return value.replace(/\\([nrt"\\])/g, (_, ch: string) => {
    switch (ch) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      default:
        return ch;
    }
  });
}

/** Find and read the nearest in-scope `.env`. Unreadable files resolve to null. */
export function loadEnvFile(
  startDir: string,
  home: string = homedir()
): EnvFile | null {
  const path = findEnvFile(startDir, home);
  if (!path) return null;
  try {
    return { path, values: parseEnvFile(readFileSync(path, 'utf8')) };
  } catch {
    return null;
  }
}

/**
 * Expand a leading `~` and resolve relative paths against `baseDir`.
 *
 * A path written in a `.env` resolves against that file's own directory, so
 * `GMAIL_MCP_CREDENTIALS=.secrets/gmail.json` means what a reader expects. A
 * `~` never survives a config file the way it survives a shell, so we expand it
 * here rather than handing Gmail a directory literally named `~`.
 */
export function expandPath(
  value: string,
  baseDir: string,
  home: string = homedir()
): string {
  let path = value.trim();
  if (path === '~') path = home;
  else if (path.startsWith('~/')) path = join(home, path.slice(2));
  return isAbsolute(path) ? path : resolve(baseDir, path);
}
