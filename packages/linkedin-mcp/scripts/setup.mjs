#!/usr/bin/env node
// One-time OAuth setup: authorize YOUR OWN LinkedIn app as an administrator of
// your organization's Page, and write the credential file the MCP server reads.
// Zero npm dependencies; Node 20+ built-ins only.
//
// Run this AFTER LinkedIn has approved your app for the Community Management
// API and you have added the redirect URL below in the app's Auth tab — the
// walkthrough is docs/setup-linkedin.md.
//
// What this does:
//   1. Reads your app's Client ID (--client-id) and Client Secret (from a file,
//      --client-secret-file, or $LINKEDIN_CLIENT_SECRET — never from the command
//      line, where it would land in your shell history).
//   2. Listens on http://localhost:<port>/callback. LinkedIn only redirects to
//      URLs registered on the app, so the port is FIXED (default 8919) and must
//      match what you registered.
//   3. Prints the consent URL. Open it, log in as a Page ADMINISTRATOR, approve.
//   4. Exchanges the code for tokens, then asks LinkedIn which Pages this member
//      administers. With exactly one, it is recorded; with several, pass
//      --organization <id>. A Page you are not an ADMINISTRATOR of is refused.
//   5. Writes the credential file (chmod 600) and reports when the tokens
//      expire. No token or secret is ever printed.

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname } from 'node:path';

// Must match the defaults in src/config.ts.
const API_VERSION = process.env.LINKEDIN_API_VERSION || '202610';
const DEFAULT_OUT = `${homedir()}/.config/pappcorn-linkedin-mcp/credentials.json`;
const DEFAULT_PORT = 8919;
// w_organization_social  publish posts and comments as the Page.
// r_organization_social  read the Page's posts and their comments.
// rw_organization_admin  look up the Pages you administer, and Page analytics.
// All three come with the Community Management API; the consent screen shows
// them to you. --scopes overrides, e.g. if your app's Auth tab lists others.
const DEFAULT_SCOPES = [
  'w_organization_social',
  'r_organization_social',
  'rw_organization_admin',
];
const TIMEOUT_MS = 5 * 60 * 1000;

function fail(msg) {
  process.stderr.write(`linkedin-setup: ${msg}\n`);
  process.exit(1);
}

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq !== -1) flags[a.slice(2, eq)] = a.slice(eq + 1);
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) {
      flags[a.slice(2)] = argv[i + 1];
      i++;
    } else flags[a.slice(2)] = true;
  }
  return flags;
}

const pretty = (p) => p.replace(homedir(), '~');
const expand = (p) => (p.startsWith('~/') ? `${homedir()}${p.slice(1)}` : p);

const USAGE = `Usage: pappcorn-linkedin-setup --client-id <id> --client-secret-file <path>
       [--organization <id>] [--port ${DEFAULT_PORT}] [--out ${pretty(DEFAULT_OUT)}]
       [--scopes "${DEFAULT_SCOPES.join(' ')}"]

Authorizes your own LinkedIn app as an administrator of your Page and writes the
credential file the connector reads (chmod 600).

  --client-id           REQUIRED (or $LINKEDIN_CLIENT_ID). From the app's Auth tab.
  --client-secret-file  A file holding ONLY the Client Secret (or set
                        $LINKEDIN_CLIENT_SECRET). Never pass the secret itself on
                        the command line.
  --organization        Numeric id of the Page to act as. Needed only if you
                        administer more than one.
  --port                Local callback port. Default ${DEFAULT_PORT}. The redirect URL
                        http://localhost:<port>/callback must be registered on the
                        app, exactly.
  --out                 Where to write the credential. Default: the path the
                        connector reads.
  --scopes              Space-separated OAuth scopes. Default:
                        ${DEFAULT_SCOPES.join(' ')}

Walkthrough: docs/setup-linkedin.md
`;

const flags = parseFlags(process.argv.slice(2));
if (flags.help || flags.h) {
  process.stdout.write(USAGE);
  process.exit(0);
}

const clientId =
  (typeof flags['client-id'] === 'string' && flags['client-id']) ||
  process.env.LINKEDIN_CLIENT_ID;
if (!clientId) {
  process.stderr.write(USAGE);
  process.exit(2);
}
if (typeof flags['client-secret'] === 'string') {
  fail(
    '--client-secret is not accepted: a secret on the command line ends up in your shell ' +
      'history. Put it in a file and pass --client-secret-file, or set $LINKEDIN_CLIENT_SECRET.',
  );
}

let clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
if (typeof flags['client-secret-file'] === 'string') {
  const path = expand(flags['client-secret-file']);
  try {
    clientSecret = readFileSync(path, 'utf8').trim();
  } catch {
    fail(`cannot read the client secret file ${path}`);
  }
}
if (!clientSecret) {
  fail(
    'no Client Secret: pass --client-secret-file <path> or set $LINKEDIN_CLIENT_SECRET.',
  );
}

const port = flags.port ? Number(flags.port) : DEFAULT_PORT;
if (!Number.isInteger(port) || port < 1 || port > 65535)
  fail(`invalid --port ${flags.port}`);
const outPath = expand(typeof flags.out === 'string' ? flags.out : DEFAULT_OUT);
const scopes =
  typeof flags.scopes === 'string'
    ? flags.scopes.split(/[\s,]+/).filter(Boolean)
    : DEFAULT_SCOPES;
let wantedOrg;
if (typeof flags.organization === 'string') {
  const m = /^(?:urn:li:organization:)?(\d+)$/.exec(flags.organization.trim());
  if (!m)
    fail(
      `--organization must be a numeric Page id, got "${flags.organization}"`,
    );
  wantedOrg = `urn:li:organization:${m[1]}`;
}

const redirectUri = `http://localhost:${port}/callback`;
const state = randomBytes(16).toString('hex');

const authUrl = new URL('https://www.linkedin.com/oauth/v2/authorization');
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('client_id', clientId);
authUrl.searchParams.set('redirect_uri', redirectUri);
authUrl.searchParams.set('state', state);
authUrl.searchParams.set('scope', scopes.join(' '));
// URLSearchParams writes spaces as "+"; LinkedIn documents the scope list as
// %20-separated, so match the documentation rather than rely on "+" decoding.
authUrl.search = authUrl.searchParams.toString().replace(/\+/g, '%20');

// `localhost` may resolve to 127.0.0.1 or ::1 depending on the browser, so
// listen on both loopback addresses — never on a public interface.
const servers = [];
let settled = false;
const timer = setTimeout(() => {
  closeAll();
  fail(
    'timed out waiting for the LinkedIn redirect. Re-run and finish the consent screen.',
  );
}, TIMEOUT_MS);

function closeAll() {
  for (const s of servers) s.close();
}

const escapeHtml = (s) =>
  s.replace(
    /[<>&"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c],
  );

async function onRequest(req, res) {
  const url = new URL(req.url, redirectUri);
  if (url.pathname !== '/callback') {
    res.writeHead(404).end();
    return;
  }
  const finish = (html) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<html><body style="font-family:sans-serif">${html}</body></html>`);
  };
  if (url.searchParams.get('state') !== state) {
    finish('<h3>State mismatch. Ignore this window and re-run the setup.</h3>');
    return; // a stray request; keep waiting
  }
  if (settled) {
    finish('<h3>Already handled. You can close this tab.</h3>');
    return;
  }
  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    settled = true;
    const desc = url.searchParams.get('error_description') || '';
    finish(
      `<h3>LinkedIn returned: ${escapeHtml(oauthError)}. You can close this tab.</h3>`,
    );
    clearTimeout(timer);
    closeAll();
    fail(
      `LinkedIn returned an OAuth error: ${oauthError}${desc ? ` (${desc})` : ''}`,
    );
  }
  const code = url.searchParams.get('code');
  if (!code) {
    finish('<h3>No code in the redirect. Re-run the setup.</h3>');
    return;
  }
  settled = true;
  finish(
    '<h3>Authorization captured. You can close this tab and return to the terminal.</h3>',
  );
  clearTimeout(timer);
  closeAll();
  try {
    await exchangeAndWrite(code);
  } catch (err) {
    fail(err.message || String(err));
  }
}

// ::1 can be absent (IPv6 disabled); one loopback is enough. Fail only when
// neither address could be bound.
let listenFailures = 0;
for (const host of ['127.0.0.1', '::1']) {
  const s = createServer(onRequest);
  s.on('error', (err) => {
    if (++listenFailures < 2) return;
    clearTimeout(timer);
    fail(
      `cannot listen on localhost:${port} (${err.code || err.message}). Is another program ` +
        'using it? Free the port, or register another redirect URL and pass --port.',
    );
  });
  s.listen(port, host);
  servers.push(s);
}

process.stdout.write(
  '\n== Authorize your LinkedIn app for your Page ==\n\n' +
    `Redirect URL (must be registered in the app's Auth tab, exactly): ${redirectUri}\n\n` +
    '1. OPEN THIS URL and log in as an ADMINISTRATOR of the Page:\n\n' +
    `${authUrl.toString()}\n\n` +
    `2. Approve. LinkedIn redirects to ${redirectUri}, and this script catches it.\n\n` +
    `Waiting (timeout ${TIMEOUT_MS / 60000} min)...\n`,
);

async function api(token, path) {
  const res = await fetch(`https://api.linkedin.com/rest/${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'LinkedIn-Version': API_VERSION,
      'X-Restli-Protocol-Version': '2.0.0',
    },
  });
  if (!res.ok) {
    throw new Error(
      `LinkedIn API ${path.split('?')[0]} failed (HTTP ${res.status}): ${await res.text()}`,
    );
  }
  return res.json();
}

async function exchangeAndWrite(code) {
  const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `token exchange failed (HTTP ${res.status}): ${await res.text()}\n` +
        'Usual causes: the redirect URL registered on the app does not match ' +
        `${redirectUri} exactly, the Client Secret is wrong, or the code expired (30 min).`,
    );
  }
  const tokens = await res.json();
  const now = Math.floor(Date.now() / 1000);

  // Which Pages does this member administer? Requires rw_organization_admin.
  const acls = await api(
    tokens.access_token,
    'organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&count=100',
  );
  const orgs = [
    ...new Set(
      (acls.elements || [])
        .map((e) => e.organization || e.organizationTarget)
        .filter(
          (u) => typeof u === 'string' && u.startsWith('urn:li:organization:'),
        ),
    ),
  ];
  const names = {};
  for (const urn of orgs) {
    try {
      const o = await api(
        tokens.access_token,
        `organizations/${urn.split(':').pop()}`,
      );
      names[urn] = o.localizedName;
    } catch {
      names[urn] = undefined;
    }
  }
  const list = orgs
    .map((u) => `  ${u.split(':').pop()}  ${names[u] || ''}`)
    .join('\n');

  let organization;
  if (wantedOrg) {
    if (!orgs.includes(wantedOrg)) {
      fail(
        `you are not an ADMINISTRATOR of ${wantedOrg}. NOTHING WAS WRITTEN.\n` +
          (orgs.length
            ? `Pages you administer:\n${list}`
            : 'You administer no Pages.'),
      );
    }
    organization = wantedOrg;
  } else if (orgs.length === 1) {
    organization = orgs[0];
  } else if (orgs.length === 0) {
    fail(
      'the account you logged in with is not an ADMINISTRATOR of any Page. NOTHING WAS WRITTEN.\n' +
        'Log in as a Page admin (an incognito window helps if the browser auto-selects another account).',
    );
  } else {
    fail(
      `you administer ${orgs.length} Pages. NOTHING WAS WRITTEN. Re-run with --organization <id>:\n${list}`,
    );
  }

  const granted = (tokens.scope || '').split(/[\s,]+/).filter(Boolean);
  const missing = scopes.filter((s) => granted.length && !granted.includes(s));

  const cred = {
    client_id: clientId,
    client_secret: clientSecret,
    access_token: tokens.access_token,
    access_token_expires_at: now + (tokens.expires_in || 0),
    ...(tokens.refresh_token
      ? {
          refresh_token: tokens.refresh_token,
          refresh_token_expires_at:
            now + (tokens.refresh_token_expires_in || 0),
        }
      : {}),
    scope: tokens.scope || scopes.join(' '),
    organization,
    organization_name: names[organization],
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(cred, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(outPath, 0o600);
  } catch {
    // best-effort
  }

  const day = (s) => new Date(s * 1000).toISOString().slice(0, 10);
  process.stdout.write(
    `\nPage:          ${names[organization] || '(name not returned)'} (${organization})\n` +
      `Access token:  expires ${day(cred.access_token_expires_at)}\n` +
      (cred.refresh_token
        ? `Refresh token: yes, valid until ${day(cred.refresh_token_expires_at)} — the connector renews on its own until then.\n`
        : 'Refresh token: NOT issued to this app. Re-run this setup before the access token expires.\n') +
      (missing.length
        ? `\nWARNING: LinkedIn did not grant: ${missing.join(' ')}. Some tools will fail.\n`
        : '') +
      `\nWrote ${pretty(outPath)} (chmod 600). No token or secret was printed.\n\n` +
      'NEXT STEPS:\n' +
      '  1. Restart your assistant and ask for linkedin_whoami: it should name the Page above.\n' +
      '  2. Keep the credential file private. Anyone holding it can publish as your Page.\n',
  );
  process.exit(0);
}
