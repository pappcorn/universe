// OAuth auth for the Google Sheets MCP server.
//
// THE ACCESS MODEL — "bring your own Google app".
// You create your OWN Google Cloud OAuth client and mint a refresh token as
// YOUR OWN Google account (see scripts/mint-token.mjs). Nothing is shared with
// anyone: the credential lives only on your machine, and the refresh token is
// cryptographically bound to the one account that granted it and to the scopes
// you approved.
//
// Why 3-legged OAuth and NOT a service account with domain-wide delegation:
// domain-wide delegation can impersonate *any* user in a Google Workspace
// domain and cannot be limited to one person. A refresh token minted by logging
// in as one account can only ever reach what that account can already reach —
// so this connector can never see a spreadsheet that was not shared with you.
// For a tool that EDITS shared spreadsheets, that difference is the whole
// security story.
//
// Two ways to supply the credential, checked in this order:
//   1. Environment variables — GSHEETS_CLIENT_ID, GSHEETS_CLIENT_SECRET,
//      GSHEETS_REFRESH_TOKEN. This is what the Claude plugin uses: it collects
//      them at install time, stores them in the OS keychain, and passes them to
//      this process as env vars. Nothing touches disk.
//   2. A credential JSON file — $GSHEETS_MCP_CREDENTIALS, else
//      ~/.config/pappcorn/gsheets-mcp/credentials.json (chmod 600). This is what
//      scripts/mint-token.mjs writes.
//
// If neither is present the server has no access and says so plainly.
// No credential field is ever printed, logged, or returned by any tool.

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  chmodSync,
} from 'node:fs';
import { homedir } from 'node:os';

// spreadsheets   = read AND write every spreadsheet the signed-in account can
//                  already open. This is the one that does the actual work.
// drive.readonly = find a spreadsheet by name, and read an .xlsx before
//                  converting it. Needed only by sheet_locate / sheet_import_xlsx.
// drive.file     = create the converted Google Sheet (scoped to files this app
//                  creates — it can never touch the rest of your Drive).
//
// To narrow: drop drive.readonly and drive.file if you always pass explicit
// spreadsheet ids and never import .xlsx. See README → "Narrowing the scopes".
export const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
];
const SCOPE = SCOPES.join(' ');

// Everything this connector stores lives under a single `pappcorn/` parent in
// each XDG directory, one subdirectory per connector — rather than scattering
// sibling `pappcorn-<name>-mcp` folders across the user's config.
//
// The reason is revocation, not tidiness: a person who wants to know what an
// assistant can reach, or to cut it off entirely, should have ONE place to look
// and one thing to delete. That matters most in an offboarding, where "delete
// this folder" has to be an instruction a non-technical person can follow
// without wondering whether they missed a directory.
const DEFAULT_CREDENTIALS_PATH = `${homedir()}/.config/pappcorn/gsheets-mcp/credentials.json`;
const TOKEN_CACHE_DIR = `${homedir()}/.cache/pappcorn/gsheets-mcp`;
const TOKEN_CACHE_PATH = `${TOKEN_CACHE_DIR}/token.json`;

export interface SheetsCredentials {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  /** The account that granted the token. Written by mint-token; informational. */
  account?: string;
}

interface CachedToken {
  account: string;
  scope: string;
  access_token: string;
  expires_at: number;
}

// Local-access failures (no credential, unreadable, revoked), kept distinct from
// API failures so callers can tell "you are not set up" from "Google said no".
export class SheetsAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SheetsAccessError';
  }
}

export function credentialsPath(): string {
  return process.env.GSHEETS_MCP_CREDENTIALS || DEFAULT_CREDENTIALS_PATH;
}

// The single "no access" voice, so a misconfigured install always reads the
// same. Never mentions any secret.
function noAccessMessage(path: string): string {
  const pretty = path.replace(homedir(), '~');
  return (
    'No Google Sheets credential found. Either set GSHEETS_CLIENT_ID + ' +
    `GSHEETS_CLIENT_SECRET + GSHEETS_REFRESH_TOKEN in the environment, or create ${pretty} ` +
    'by running the one-time setup: `npx -p @pappcorn/gsheets-mcp pappcorn-gsheets-setup ' +
    '--client <your-oauth-client.json>`. Full walkthrough: docs/setup-google-sheets.md.'
  );
}

let cachedCredentials: SheetsCredentials | null = null;

// Preflight + load. Any failure resolves to the same clean "no access" message —
// never a stack trace, never a credential field.
export function loadCredentials(): SheetsCredentials {
  if (cachedCredentials) return cachedCredentials;

  // 1. Environment (the plugin path — keychain-backed, never written to disk).
  // An unset plugin user_config can surface here as "" or as the literal
  // unexpanded "${user_config.*}" placeholder — both mean "not configured",
  // and must fall through to the credential file.
  const clean = (v: string | undefined) =>
    v && !v.includes('${') ? v : undefined;
  const envId = clean(process.env.GSHEETS_CLIENT_ID);
  const envSecret = clean(process.env.GSHEETS_CLIENT_SECRET);
  const envRefresh = clean(process.env.GSHEETS_REFRESH_TOKEN);
  if (envId && envSecret && envRefresh) {
    cachedCredentials = {
      client_id: envId,
      client_secret: envSecret,
      refresh_token: envRefresh,
      account: process.env.GSHEETS_ACCOUNT,
    };
    return cachedCredentials;
  }

  // 2. Credential file (the mint-token path).
  const path = credentialsPath();
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new SheetsAccessError(noAccessMessage(path));
  }
  let creds: SheetsCredentials;
  try {
    creds = JSON.parse(raw) as SheetsCredentials;
  } catch {
    throw new SheetsAccessError(
      `${noAccessMessage(
        path
      )} (that file exists but is not valid JSON — re-run the setup script)`
    );
  }
  if (!creds.client_id || !creds.client_secret || !creds.refresh_token) {
    throw new SheetsAccessError(
      `${noAccessMessage(
        path
      )} (that file exists but is missing fields — re-run the setup script)`
    );
  }
  cachedCredentials = creds;
  return cachedCredentials;
}

function readCachedToken(account: string): string | null {
  if (!existsSync(TOKEN_CACHE_PATH)) return null;
  try {
    const cached = JSON.parse(
      readFileSync(TOKEN_CACHE_PATH, 'utf8')
    ) as CachedToken;
    if (cached.account !== account) return null;
    if (cached.scope !== SCOPE) return null;
    if (
      !cached.expires_at ||
      cached.expires_at - Math.floor(Date.now() / 1000) < 60
    )
      return null;
    return cached.access_token;
  } catch {
    return null;
  }
}

function writeCachedToken(
  account: string,
  access_token: string,
  expires_at: number
): void {
  mkdirSync(TOKEN_CACHE_DIR, { recursive: true });
  writeFileSync(
    TOKEN_CACHE_PATH,
    JSON.stringify({
      account,
      scope: SCOPE,
      access_token,
      expires_at,
    } satisfies CachedToken),
    { mode: 0o600 }
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
      throw new SheetsAccessError(
        'The refresh token is no longer valid. The three usual causes: (1) your OAuth app is ' +
          'still in "Testing" publishing status, which expires refresh tokens after 7 days — ' +
          'publish it to Production; (2) the Google account password changed, which revokes ' +
          "tokens; (3) access was revoked from the Google account's third-party access " +
          'settings. Re-run the setup script to fix.'
      );
    }
    // The request is never echoed; the body carries only Google's error.
    throw new Error(
      `Google token exchange failed (HTTP ${res.status}): ${body}\n` +
        'Common causes: the Google Sheets API (or Drive API) is not enabled on your Google ' +
        'Cloud project, the client secret was rotated, or the system clock is skewed.'
    );
  }
  const data = (await res.json()) as {
    access_token: string;
    expires_in?: number;
  };
  writeCachedToken(account, data.access_token, now + (data.expires_in ?? 3600));
  return data.access_token;
}

// Google access tokens go in a standard Bearer header.
export async function authHeaders(
  extra: Record<string, string> = {}
): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await getAccessToken()}`, ...extra };
}
