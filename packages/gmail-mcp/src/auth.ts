// OAuth auth for the Gmail MCP server. Shared by the MCP (mcp.ts) and the CLI
// (cli.ts) so both behave identically.
//
// THE ACCESS MODEL — "bring your own Google app".
// You create your OWN Google Cloud OAuth client and mint a refresh token for
// YOUR OWN mailbox (see scripts/mint-token.mjs and docs/setup-google-cloud.md).
// Nothing is shared with anyone: the credential lives only on your machine, and
// the refresh token is cryptographically bound to the one mailbox that granted
// it and to the scopes you approved.
//
// Why 3-legged OAuth and NOT a service account with domain-wide delegation:
// domain-wide delegation can impersonate *any* user in a Google Workspace
// domain and cannot be limited to a single mailbox. A refresh token minted by
// logging in as one account can only ever touch that account. For a tool that
// reads and sends your email, that difference is the whole security story.
//
// Two ways to supply the credential, checked in this order:
//   1. Environment variables — GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET,
//      GMAIL_REFRESH_TOKEN. This is what the Claude plugin uses: it collects
//      them at install time, stores them in the OS keychain, and passes them to
//      this process as env vars. Nothing touches disk.
//   2. A credential JSON file — $GMAIL_MCP_CREDENTIALS, else
//      ~/.config/pappcorn-gmail-mcp/credentials.json (chmod 600). This is what
//      scripts/mint-token.mjs writes, and what the CLI uses.
//
// If neither is present the server has no mail access and says so plainly.
// No credential field is ever printed, logged, or returned by any tool.
//
// Token cache: ~/.cache/pappcorn-gmail-mcp/token.json (chmod 600), reused until
// ~60s before expiry. Keyed by account + scope, so re-minting or changing
// scopes invalidates it naturally.

import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';

// gmail.modify = read, search, label, archive (a RESTRICTED scope).
// gmail.send   = send mail (a SENSITIVE scope).
// Together they cover the full v1 tool surface. To reduce what the token can
// do, see docs/setup-google-cloud.md → "Narrowing the scopes".
export const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
];
const SCOPE = SCOPES.join(' ');

const DEFAULT_CREDENTIALS_PATH = `${homedir()}/.config/pappcorn-gmail-mcp/credentials.json`;
const TOKEN_CACHE_DIR = `${homedir()}/.cache/pappcorn-gmail-mcp`;
const TOKEN_CACHE_PATH = `${TOKEN_CACHE_DIR}/token.json`;

export interface MailCredentials {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  /** The mailbox that granted the token. Written by mint-token; informational. */
  account?: string;
}

interface CachedToken {
  account: string;
  scope: string;
  access_token: string;
  expires_at: number;
}

// Local-access failures (no credential, unreadable, revoked). The CLI maps this
// class to exit code 1 (local config), everything else to 3.
export class MailAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailAccessError';
  }
}

export function credentialsPath(): string {
  return process.env.GMAIL_MCP_CREDENTIALS || DEFAULT_CREDENTIALS_PATH;
}

// The single "no access" voice — identical across the MCP server and the CLI so
// a misconfigured install always reads the same. Never mentions any secret.
function noAccessMessage(path: string): string {
  const pretty = path.replace(homedir(), '~');
  return (
    'No Gmail credential found. Either set GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET + ' +
    `GMAIL_REFRESH_TOKEN in the environment, or create ${pretty} by running the ` +
    'one-time setup: `node scripts/mint-token.mjs --client <your-oauth-client.json>`. ' +
    'Full walkthrough: docs/setup-google-cloud.md.'
  );
}

let cachedCredentials: MailCredentials | null = null;

// Preflight + load. Any failure resolves to the same clean "no access" message —
// never a stack trace, never a credential field.
export function loadCredentials(): MailCredentials {
  if (cachedCredentials) return cachedCredentials;

  // 1. Environment (the plugin path — keychain-backed, never written to disk).
  const envId = process.env.GMAIL_CLIENT_ID;
  const envSecret = process.env.GMAIL_CLIENT_SECRET;
  const envRefresh = process.env.GMAIL_REFRESH_TOKEN;
  if (envId && envSecret && envRefresh) {
    cachedCredentials = {
      client_id: envId,
      client_secret: envSecret,
      refresh_token: envRefresh,
      account: process.env.GMAIL_ACCOUNT,
    };
    return cachedCredentials;
  }

  // 2. Credential file (the CLI / mint-token path).
  const path = credentialsPath();
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new MailAccessError(noAccessMessage(path));
  }
  let creds: MailCredentials;
  try {
    creds = JSON.parse(raw) as MailCredentials;
  } catch {
    throw new MailAccessError(
      `${noAccessMessage(path)} (that file exists but is not valid JSON — re-run the setup script)`,
    );
  }
  if (!creds.client_id || !creds.client_secret || !creds.refresh_token) {
    throw new MailAccessError(
      `${noAccessMessage(path)} (that file exists but is missing fields — re-run the setup script)`,
    );
  }
  cachedCredentials = creds;
  return cachedCredentials;
}

function readCachedToken(account: string): string | null {
  if (!existsSync(TOKEN_CACHE_PATH)) return null;
  try {
    const cached = JSON.parse(readFileSync(TOKEN_CACHE_PATH, 'utf8')) as CachedToken;
    if (cached.account !== account) return null;
    if (cached.scope !== SCOPE) return null;
    if (!cached.expires_at || cached.expires_at - Math.floor(Date.now() / 1000) < 60) return null;
    return cached.access_token;
  } catch {
    return null;
  }
}

function writeCachedToken(account: string, access_token: string, expires_at: number): void {
  mkdirSync(TOKEN_CACHE_DIR, { recursive: true });
  writeFileSync(
    TOKEN_CACHE_PATH,
    JSON.stringify({ account, scope: SCOPE, access_token, expires_at } satisfies CachedToken),
    { mode: 0o600 },
  );
  try {
    chmodSync(TOKEN_CACHE_PATH, 0o600);
  } catch {
    // best-effort; ignore if the filesystem doesn't support it
  }
}

// Exchange the refresh token for a short-lived access token (or serve the
// cached one).
export async function getAccessToken(): Promise<string> {
  const creds = loadCredentials();
  const account = creds.account || 'default';
  const cached = readCachedToken(account);
  if (cached) return cached;

  const now = Math.floor(Date.now() / 1000);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: creds.refresh_token,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    let errorCode: string | undefined;
    try {
      errorCode = (JSON.parse(body) as { error?: string }).error;
    } catch {
      // non-JSON error body — fall through to the generic error below
    }
    if (errorCode === 'invalid_grant') {
      throw new MailAccessError(
        'The refresh token is no longer valid. The three usual causes: (1) your OAuth app is ' +
          'still in "Testing" publishing status, which expires refresh tokens after 7 days — ' +
          'publish it to Production (see docs/setup-google-cloud.md); (2) the Google account ' +
          'password changed, which revokes Gmail-scoped tokens; (3) access was revoked from the ' +
          "Google account's third-party access settings. Re-run scripts/mint-token.mjs to fix.",
      );
    }
    // The request is never echoed; the body carries only Google's error.
    throw new Error(
      `Gmail token exchange failed (HTTP ${res.status}): ${body}\n` +
        'Common causes: the Gmail API is not enabled on your Google Cloud project, the client ' +
        'secret was rotated, or the system clock is skewed.',
    );
  }
  const data = (await res.json()) as { access_token: string; expires_in?: number };
  writeCachedToken(account, data.access_token, now + (data.expires_in ?? 3600));
  return data.access_token;
}

// Google access tokens go in a standard Bearer header.
export async function authHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await getAccessToken()}`, ...extra };
}
