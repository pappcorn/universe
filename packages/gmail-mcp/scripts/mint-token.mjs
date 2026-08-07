#!/usr/bin/env node
// One-time OAuth setup: mint a refresh token for YOUR OWN Gmail account.
// Zero npm dependencies; Node 20+ built-ins only.
//
// Run this AFTER creating your own OAuth client in Google Cloud — the full
// walkthrough is in docs/setup-google-cloud.md. Short version: create a
// project, enable the Gmail API, configure the consent screen (User type
// "External"), PUBLISH the app to Production, then create an OAuth client of
// type "Desktop app" and download its JSON.
//
// What this does:
//   1. Parses the OAuth client JSON you downloaded (--client <path>).
//   2. Starts a loopback HTTP server on 127.0.0.1 (random free port) — the
//      redirect target Google allows for Desktop clients with no pre-registration.
//   3. Prints the consent URL. Open it and log in as the account you want the
//      assistant to use. (access_type=offline + prompt=consent force a fresh
//      refresh token on every run.)
//   4. Captures the redirect, exchanges the code for tokens, then VERIFIES the
//      grant by calling the Gmail profile and printing the authenticated
//      address. With --account it refuses to write if you logged into the wrong
//      one — a token for the wrong mailbox is worse than no token.
//   5. Picks a destination that cannot silently destroy another mailbox's
//      credential (see "CHOOSING THE DESTINATION"), then writes it (chmod 600).
//
// The refresh token is NEVER printed to stdout — it only lands in the file.
//
// ── CHOOSING THE DESTINATION ─────────────────────────────────────────────────
// Writing every mailbox to one fixed path is how people lose credentials: run
// the script a second time for a second account and the first token is gone,
// unrecoverably. Worse, if that path is a symlink into somewhere else, the
// write follows it and destroys a file you were not even looking at.
//
// So, when --out is not given:
//   • Nothing at the default path yet → write the default
//     ~/.config/pappcorn-gmail-mcp/credentials.json. One mailbox, zero config:
//     every client on the machine finds it without being told.
//   • The default path already holds THIS mailbox → refresh it in place. This
//     is what re-running the setup has always meant.
//   • The default path holds a DIFFERENT (or unreadable) mailbox → write
//     ~/.config/pappcorn-gmail-mcp/<mailbox>.json instead and print the one
//     line of `.env` that points a project at it. Nothing is overwritten.
//
// And whatever the destination — default or --out — we never overwrite an
// existing file or symlink that does not provably hold the mailbox you just
// authenticated as. That needs --force, or a "yes" at the prompt.

import { createServer } from 'node:http';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
  existsSync,
  lstatSync,
  readlinkSync,
  realpathSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Must match SCOPES in src/auth.ts, and must match the scopes you added to the
// consent screen. gmail.modify = read/search/label/archive; gmail.send = send.
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
];
export const CREDENTIAL_DIR = `${homedir()}/.config/pappcorn-gmail-mcp`;
export const DEFAULT_OUT = `${CREDENTIAL_DIR}/credentials.json`;
const TIMEOUT_MS = 5 * 60 * 1000;

const pretty = (p) => p.replace(homedir(), '~');

function fail(code, msg) {
  process.stderr.write(`mint-token: ${msg}\n`);
  process.exit(code);
}

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq !== -1) {
      flags[a.slice(2, eq)] = a.slice(eq + 1);
    } else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) {
      flags[a.slice(2)] = argv[i + 1];
      i++;
    } else {
      flags[a.slice(2)] = true;
    }
  }
  return flags;
}

const USAGE = `Usage: node scripts/mint-token.mjs --client <oauth-client.json> [--account you@example.com] [--out <path>] [--force]

Mints an OAuth refresh token for your own Gmail account: opens a loopback
server, prints the Google consent URL, verifies which mailbox granted access,
and writes the credential file (chmod 600).

  --client   REQUIRED. The OAuth client JSON downloaded from Google Cloud
             (type "Desktop app").
  --account  Optional guard. If given, the script refuses to write unless you
             logged in as exactly this address. Recommended when your browser
             is signed into several Google accounts.
  --out      Where to write the credential. Default: ${pretty(DEFAULT_OUT)} for
             your first mailbox (and when re-minting that same mailbox);
             ${pretty(CREDENTIAL_DIR)}/<mailbox>.json for any other one, so a
             second account can never overwrite the first.
  --force    Overwrite the destination even when it holds a different mailbox.
             Without it, the script asks — or refuses, if there is no terminal.

Setup walkthrough: docs/setup-google-cloud.md
`;

function expandPath(p) {
  let out = p.trim();
  if (out === '~') out = homedir();
  else if (out.startsWith('~/')) out = join(homedir(), out.slice(2));
  return isAbsolute(out) ? out : resolve(process.cwd(), out);
}

// Set by main(); the request handler and writer close over them.
let flags = {};
let client;
let expectedAccount;
let explicitOut;
let force = false;

// ── 1. Parse Google's client-secret JSON ("installed" = Desktop type; accept
//       "web" too in case someone created that flavor — the loopback flow still
//       works if the redirect is allowed).
function main(argv) {
  flags = parseFlags(argv);
  if (flags.help || flags.h) {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  if (typeof flags.client !== 'string') {
    process.stderr.write(USAGE);
    process.exit(2);
  }
  expectedAccount =
    typeof flags.account === 'string' ? flags.account : undefined;
  explicitOut =
    typeof flags.out === 'string' ? expandPath(flags.out) : undefined;
  force = flags.force === true || flags.force === 'true';

  let clientRaw;
  try {
    clientRaw = JSON.parse(readFileSync(flags.client, 'utf8'));
  } catch (err) {
    fail(1, `cannot read/parse ${flags.client}: ${err.message}`);
  }
  client = clientRaw.installed || clientRaw.web;
  if (!client?.client_id || !client?.client_secret) {
    fail(
      1,
      `${flags.client} does not look like a Google OAuth client JSON (expected an "installed" block with client_id + client_secret).`,
    );
  }

  listenForGrant();
}

// ── 2. Loopback server on a random free port (port 0 → OS assigns).
function listenForGrant() {
  const state = randomBytes(16).toString('hex');
  const server = createServer();
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    const redirectUri = `http://127.0.0.1:${port}/callback`;

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', client.client_id);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', SCOPES.join(' '));
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('state', state);
    if (expectedAccount)
      authUrl.searchParams.set('login_hint', expectedAccount);

    process.stdout.write(
      '\n== Mint a Gmail refresh token ==\n\n' +
        `1. OPEN THIS URL${
          expectedAccount ? ` AND LOG IN AS ${expectedAccount}` : ''
        }:\n\n${authUrl.toString()}\n\n` +
        '   Your own app is unverified, so Google will show a warning. That is expected:\n' +
        '   choose "Advanced" and continue — you are trusting an app you created yourself.\n\n' +
        `2. Approve the Gmail permissions. You'll be redirected to 127.0.0.1:${port} — this script catches it.\n\n` +
        `Waiting for the redirect (timeout ${TIMEOUT_MS / 60000} min)...\n`,
    );

    const timer = setTimeout(() => {
      server.close();
      fail(
        1,
        'timed out waiting for the OAuth redirect. Re-run and complete the consent flow.',
      );
    }, TIMEOUT_MS);

    server.on('request', async (req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const finish = (html) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          `<html><body style="font-family:sans-serif">${html}</body></html>`,
        );
      };
      // Query params are attacker-influenced (anything can hit the loopback
      // port) — escape before embedding in the response HTML. Both quote
      // characters are covered even though today's only interpolation is in
      // element content: the next person to reuse this in an attribute should
      // not have to notice that it was incomplete.
      const escapeHtml = (s) =>
        s.replace(
          /[<>&"']/g,
          (c) =>
            ({
              '<': '&lt;',
              '>': '&gt;',
              '&': '&amp;',
              '"': '&quot;',
              "'": '&#39;',
            })[c],
        );

      if (url.searchParams.get('state') !== state) {
        finish(
          '<h3>State mismatch — ignore this window and re-run the script.</h3>',
        );
        return; // keep waiting; could be a stray request
      }
      const oauthError = url.searchParams.get('error');
      if (oauthError) {
        finish(
          `<h3>OAuth error: ${escapeHtml(
            oauthError,
          )}. You can close this tab.</h3>`,
        );
        clearTimeout(timer);
        server.close();
        fail(1, `Google returned an OAuth error: ${oauthError}`);
      }
      const code = url.searchParams.get('code');
      if (!code) {
        finish('<h3>No code in the redirect — re-run the script.</h3>');
        return;
      }
      finish(
        '<h3>Grant captured — you can close this tab and return to the terminal.</h3>',
      );
      clearTimeout(timer);
      server.close();

      try {
        await exchangeAndWrite(code, redirectUri);
      } catch (err) {
        fail(1, err.message || String(err));
      }
    });
  });
}

// ── 3. Destination safety ────────────────────────────────────────────────────
//
// Exported so the rules that decide whether a credential gets overwritten are
// covered by tests instead of by hope. See test/mint-token-destination.test.mjs.

export const sameMailbox = (a, b) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** A filename that identifies the mailbox without becoming a path surprise. */
export function perMailboxPath(account, credentialDir = CREDENTIAL_DIR) {
  const slug = account
    .toLowerCase()
    .replace('@', '_at_')
    .replace(/[^a-z0-9._-]+/g, '-')
    // Leading dots and dashes are stripped so no address can produce a
    // dotfile, a "..", or a flag-looking filename.
    .replace(/^[.-]+|[.-]+$/g, '');
  return join(credentialDir, `${slug || 'mailbox'}.json`);
}

/** Read only the `account` field of an existing credential — never a secret. */
export function mailboxInFile(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return typeof parsed?.account === 'string' && parsed.account
      ? parsed.account
      : null;
  } catch {
    return null;
  }
}

/**
 * What is at `path` today. `exists` is true for a dangling symlink too: writing
 * would still follow it, which is exactly the case we must not do quietly.
 */
export function inspect(path) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return { exists: false, symlink: false, target: null, mailbox: null };
  }
  const symlink = stat.isSymbolicLink();
  let target = null;
  if (symlink) {
    try {
      target = realpathSync(path);
    } catch {
      try {
        target = readlinkSync(path);
      } catch {
        target = null;
      }
    }
  }
  return {
    exists: true,
    symlink,
    target,
    mailbox: existsSync(path) ? mailboxInFile(path) : null,
  };
}

function askYesNo(question) {
  return new Promise((resolveAnswer) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolveAnswer(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

/** Where to write when the operator did not say. */
export function chooseDestination(
  account,
  defaultOut = DEFAULT_OUT,
  credentialDir = CREDENTIAL_DIR,
) {
  const current = inspect(defaultOut);
  if (!current.exists) return defaultOut; // first mailbox on this machine
  if (sameMailbox(current.mailbox, account)) return defaultOut; // refresh in place
  return perMailboxPath(account, credentialDir); // a different mailbox gets its own file
}

/**
 * Refuse to clobber anything that is not provably this same mailbox. Returns
 * only if it is safe (or the operator said so) to write to `path`.
 */
async function confirmDestination(path, account) {
  const at = inspect(path);
  if (!at.exists) return;

  if (sameMailbox(at.mailbox, account)) {
    process.stdout.write(
      `\nRefreshing the existing credential for ${account} at ${pretty(path)}` +
        (at.symlink ? ` (a symlink → ${pretty(at.target ?? '?')})` : '') +
        '.\n',
    );
    return;
  }

  process.stderr.write(
    '\n*** THAT DESTINATION ALREADY HOLDS A CREDENTIAL ***\n' +
      `  path:    ${pretty(path)}\n` +
      (at.symlink
        ? `  symlink: → ${pretty(at.target ?? '(broken link)')}\n`
        : '') +
      `  mailbox: ${
        at.mailbox ?? 'unknown — the file could not be read as a credential'
      }\n` +
      `  you just authenticated as: ${account}\n\n` +
      'Overwriting replaces the refresh token above, and a refresh token cannot be recovered:\n' +
      'the only way back is another consent flow for that mailbox.\n',
  );

  if (force) {
    process.stderr.write('--force given — overwriting.\n');
    return;
  }
  if (process.stdin.isTTY) {
    const yes = await askYesNo(`Overwrite ${pretty(path)}? [y/N] `);
    if (yes) return;
    process.stderr.write(
      `\nNothing was written. Re-run with --out <path> to write elsewhere; ${pretty(
        perMailboxPath(account),
      )} is free.\n`,
    );
    process.exit(1);
  }
  process.stderr.write(
    '\nNothing was written (no terminal to ask at). Re-run with --force to overwrite, or\n' +
      `--out ${pretty(perMailboxPath(account))} to keep both.\n`,
  );
  process.exit(1);
}

// ── 4. Code → tokens, verify the mailbox, write the file.
async function exchangeAndWrite(code, redirectUri) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: client.client_id,
      client_secret: client.client_secret,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `token exchange failed (HTTP ${res.status}): ${await res.text()}`,
    );
  }
  const tokens = await res.json();
  if (!tokens.refresh_token) {
    throw new Error(
      'Google returned no refresh_token. Re-run — prompt=consent should force one; if it ' +
        "persists, revoke the app under your Google account's Security → third-party access and retry.",
    );
  }

  // Verify which mailbox actually granted the token BEFORE writing anything.
  const profileRes = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/profile',
    {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    },
  );
  if (!profileRes.ok) {
    throw new Error(
      `grant verification failed (HTTP ${
        profileRes.status
      }): ${await profileRes.text()}\n` +
        'Is the Gmail API enabled on your Google Cloud project?',
    );
  }
  const profile = await profileRes.json();
  const account = profile.emailAddress;
  process.stdout.write(`\nAuthenticated mailbox: ${account}\n`);

  if (expectedAccount && !sameMailbox(account, expectedAccount)) {
    process.stderr.write(
      '\n*** WRONG ACCOUNT ***\n' +
        `You logged in as ${account}, but --account asked for ${expectedAccount}.\n` +
        'NOTHING WAS WRITTEN. Re-run and pick the right account at the Google login screen\n' +
        '(use an incognito window if your browser keeps auto-selecting another session).\n',
    );
    process.exit(1);
  }

  const outPath = explicitOut ?? chooseDestination(account);
  // A credential minted before 0.3.0 has no `account` field, so we cannot tell
  // which mailbox it holds and must not refresh it in place. That is the right
  // call, but it looks identical to "you have a second mailbox" unless the
  // closing message says which one actually happened — so record it here.
  const divertedFrom =
    !explicitOut && outPath !== DEFAULT_OUT ? inspect(DEFAULT_OUT) : null;
  const divertedBecauseUnlabelled =
    !!divertedFrom && divertedFrom.mailbox === null;

  await confirmDestination(outPath, account);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        client_id: client.client_id,
        client_secret: client.client_secret,
        refresh_token: tokens.refresh_token,
        account,
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
  try {
    chmodSync(outPath, 0o600);
  } catch {
    // best-effort
  }

  const isDefaultSlot = outPath === DEFAULT_OUT;
  const wiring = isDefaultSlot
    ? 'USING IT: this is the path every client looks at last, so nothing else is needed for a\n' +
      'single mailbox. To pin one project to this mailbox explicitly — the right move as soon as\n' +
      "you have a second one — put this in that folder's .env:\n"
    : 'USING IT: this path is not looked at by default, so point the folder that should use this\n' +
      "mailbox at it. In that folder's .env:\n";

  // Only for the case above: the default path was left alone not because it
  // belongs to someone else, but because we could not tell whose it is.
  const unlabelledNote = divertedBecauseUnlabelled
    ? `\nWHY NOT THE USUAL PATH: ${pretty(
        DEFAULT_OUT,
      )} already exists but carries no\n` +
      'readable `account` field — most likely minted by a version of this script older than\n' +
      '0.3.0, which did not record one. There is no way to tell which mailbox it holds, and a\n' +
      "refresh token that turns out to be another mailbox's cannot be recovered, so it was left\n" +
      'untouched instead of refreshed in place.\n\n' +
      '  • See what it actually is:\n' +
      `        GMAIL_MCP_CREDENTIALS=${pretty(
        DEFAULT_OUT,
      )} npx -y -p @pappcorn/gmail-mcp pappcorn-gmail whoami\n` +
      `  • If it is this same mailbox and you want one file again, replace it deliberately:\n` +
      `        ...pappcorn-gmail-setup --client <client.json> --out ${pretty(
        DEFAULT_OUT,
      )} --force\n` +
      `    then delete ${pretty(outPath)}.\n` +
      '  • If it is a different mailbox, you are already done — keep both.\n'
    : '';

  process.stdout.write(
    `\nWrote ${pretty(
      outPath,
    )} (chmod 600). The refresh token was NOT printed — it lives only in that file.\n` +
      unlabelledNote +
      '\n' +
      wiring +
      `\n    GMAIL_MCP_CREDENTIALS=${pretty(outPath)}\n` +
      `    GMAIL_ACCOUNT=${account}\n\n` +
      'GMAIL_ACCOUNT is an assertion, not a label: if that folder ever resolves to a different\n' +
      'mailbox, the connector refuses instead of acting on the wrong one.\n\n' +
      '⚠️  IF THAT FOLDER IS A GIT REPOSITORY, PUT `.env` IN .gitignore FIRST. A refresh token\n' +
      '    pushed to a remote is a total leak — treat it as burned and revoke it under your\n' +
      '    Google account → Security → third-party access.\n\n' +
      'NEXT STEPS:\n' +
      '  1. Verify it works, from that folder:  npx -y -p @pappcorn/gmail-mcp pappcorn-gmail whoami\n' +
      `  2. Delete the downloaded OAuth client JSON (${flags.client}) — its fields now live\n` +
      '     in the credential file.\n' +
      '  3. Keep the credential file private. Anyone holding it can read and send your mail.\n\n' +
      'If mail stops working after about a week, your OAuth app is still in "Testing" status.\n' +
      'Publish it to Production — see docs/setup-google-cloud.md.\n',
  );
  process.exit(0);
}

// Run only when invoked as a program. Importing it (the tests do) must not open
// a loopback server or read anyone's credentials.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2));
}
