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
//   5. Writes the credential file (chmod 600).
//
// The refresh token is NEVER printed to stdout — it only lands in the file.

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname } from 'node:path';

// Must match SCOPES in src/auth.ts, and must match the scopes you added to the
// consent screen. gmail.modify = read/search/label/archive; gmail.send = send.
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
];
const DEFAULT_OUT = `${homedir()}/.config/pappcorn-gmail-mcp/credentials.json`;
const TIMEOUT_MS = 5 * 60 * 1000;

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

const USAGE = `Usage: node scripts/mint-token.mjs --client <oauth-client.json> [--account you@example.com] [--out ${DEFAULT_OUT.replace(homedir(), '~')}]

Mints an OAuth refresh token for your own Gmail account: opens a loopback
server, prints the Google consent URL, verifies which mailbox granted access,
and writes the credential file (chmod 600).

  --client   REQUIRED. The OAuth client JSON downloaded from Google Cloud
             (type "Desktop app").
  --account  Optional guard. If given, the script refuses to write unless you
             logged in as exactly this address. Recommended when your browser
             is signed into several Google accounts.
  --out      Where to write the credential. Defaults to the path the MCP server
             reads.

Setup walkthrough: docs/setup-google-cloud.md
`;

const flags = parseFlags(process.argv.slice(2));
if (flags.help || flags.h) {
  process.stdout.write(USAGE);
  process.exit(0);
}
if (typeof flags.client !== 'string') {
  process.stderr.write(USAGE);
  process.exit(2);
}
const expectedAccount = typeof flags.account === 'string' ? flags.account : undefined;
const outPath = typeof flags.out === 'string' ? flags.out : DEFAULT_OUT;

// ── 1. Parse Google's client-secret JSON ("installed" = Desktop type; accept
//       "web" too in case someone created that flavor — the loopback flow still
//       works if the redirect is allowed).
let clientRaw;
try {
  clientRaw = JSON.parse(readFileSync(flags.client, 'utf8'));
} catch (err) {
  fail(1, `cannot read/parse ${flags.client}: ${err.message}`);
}
const client = clientRaw.installed || clientRaw.web;
if (!client?.client_id || !client?.client_secret) {
  fail(
    1,
    `${flags.client} does not look like a Google OAuth client JSON (expected an "installed" block with client_id + client_secret).`,
  );
}

// ── 2. Loopback server on a random free port (port 0 → OS assigns).
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
  if (expectedAccount) authUrl.searchParams.set('login_hint', expectedAccount);

  process.stdout.write(
    '\n== Mint a Gmail refresh token ==\n\n' +
      `1. OPEN THIS URL${expectedAccount ? ` AND LOG IN AS ${expectedAccount}` : ''}:\n\n${authUrl.toString()}\n\n` +
      '   Your own app is unverified, so Google will show a warning. That is expected:\n' +
      '   choose "Advanced" and continue — you are trusting an app you created yourself.\n\n' +
      `2. Approve the Gmail permissions. You'll be redirected to 127.0.0.1:${port} — this script catches it.\n\n` +
      `Waiting for the redirect (timeout ${TIMEOUT_MS / 60000} min)...\n`,
  );

  const timer = setTimeout(() => {
    server.close();
    fail(1, 'timed out waiting for the OAuth redirect. Re-run and complete the consent flow.');
  }, TIMEOUT_MS);

  server.on('request', async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.pathname !== '/callback') {
      res.writeHead(404).end();
      return;
    }
    const finish = (html) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<html><body style="font-family:sans-serif">${html}</body></html>`);
    };
    // Query params are attacker-influenced (anything can hit the loopback
    // port) — escape before embedding in the response HTML.
    const escapeHtml = (s) =>
      s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

    if (url.searchParams.get('state') !== state) {
      finish('<h3>State mismatch — ignore this window and re-run the script.</h3>');
      return; // keep waiting; could be a stray request
    }
    const oauthError = url.searchParams.get('error');
    if (oauthError) {
      finish(`<h3>OAuth error: ${escapeHtml(oauthError)}. You can close this tab.</h3>`);
      clearTimeout(timer);
      server.close();
      fail(1, `Google returned an OAuth error: ${oauthError}`);
    }
    const code = url.searchParams.get('code');
    if (!code) {
      finish('<h3>No code in the redirect — re-run the script.</h3>');
      return;
    }
    finish('<h3>Grant captured — you can close this tab and return to the terminal.</h3>');
    clearTimeout(timer);
    server.close();

    try {
      await exchangeAndWrite(code, redirectUri);
    } catch (err) {
      fail(1, err.message || String(err));
    }
  });
});

// ── 3. Code → tokens, verify the mailbox, write the file.
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
    throw new Error(`token exchange failed (HTTP ${res.status}): ${await res.text()}`);
  }
  const tokens = await res.json();
  if (!tokens.refresh_token) {
    throw new Error(
      'Google returned no refresh_token. Re-run — prompt=consent should force one; if it ' +
        "persists, revoke the app under your Google account's Security → third-party access and retry.",
    );
  }

  // Verify which mailbox actually granted the token BEFORE writing anything.
  const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!profileRes.ok) {
    throw new Error(
      `grant verification failed (HTTP ${profileRes.status}): ${await profileRes.text()}\n` +
        'Is the Gmail API enabled on your Google Cloud project?',
    );
  }
  const profile = await profileRes.json();
  process.stdout.write(`\nAuthenticated mailbox: ${profile.emailAddress}\n`);

  if (expectedAccount && (profile.emailAddress || '').toLowerCase() !== expectedAccount.toLowerCase()) {
    process.stderr.write(
      '\n*** WRONG ACCOUNT ***\n' +
        `You logged in as ${profile.emailAddress}, but --account asked for ${expectedAccount}.\n` +
        'NOTHING WAS WRITTEN. Re-run and pick the right account at the Google login screen\n' +
        '(use an incognito window if your browser keeps auto-selecting another session).\n',
    );
    process.exit(1);
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        client_id: client.client_id,
        client_secret: client.client_secret,
        refresh_token: tokens.refresh_token,
        account: profile.emailAddress,
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

  const pretty = outPath.replace(homedir(), '~');
  process.stdout.write(
    `\nWrote ${pretty} (chmod 600). The refresh token was NOT printed — it lives only in that file.\n\n` +
      'NEXT STEPS:\n' +
      '  1. Verify it works:  npm run gmail -- whoami\n' +
      `  2. Delete the downloaded OAuth client JSON (${flags.client}) — its fields now live\n` +
      '     in the credential file.\n' +
      '  3. Keep the credential file private. Anyone holding it can read and send your mail.\n\n' +
      'If mail stops working after about a week, your OAuth app is still in "Testing" status.\n' +
      'Publish it to Production — see docs/setup-google-cloud.md.\n',
  );
  process.exit(0);
}
