// Config and credentials for the LinkedIn MCP: environment + one credential
// file → a typed object, plus the access-token lifecycle. Shared by the MCP
// (mcp.ts) and the CLI (cli.ts) so both behave identically.
//
// THE ACCESS MODEL — "bring your own LinkedIn app".
// You create your OWN app in LinkedIn's developer portal, get it approved for
// the Community Management API, and authorize it once as an ADMINISTRATOR of
// your organization's Page (scripts/setup.mjs). The credential lives only on
// your machine. Everything this connector publishes goes out AS THE PAGE, never
// as a person, and only through LinkedIn's official API.
//
// Two ways to supply the credential, checked in this order:
//   1. Environment variables. This is what the Claude plugin uses: it collects
//      them at install time, keeps them in the OS keychain, and passes them to
//      this process as env vars.
//        LINKEDIN_ACCESS_TOKEN                       — used as is, or
//        LINKEDIN_REFRESH_TOKEN + LINKEDIN_CLIENT_ID + LINKEDIN_CLIENT_SECRET
//                                                    — renewed on demand.
//   2. A credential JSON file — $LINKEDIN_MCP_CREDENTIALS, else
//      ~/.config/pappcorn/linkedin-mcp/credentials.json (chmod 600). This is
//      what scripts/setup.mjs writes.
//
// The Page to act as: $LINKEDIN_ORGANIZATION_ID, else the one the setup script
// recorded in the credential file. Nothing about any account is hardcoded.
//
// TOKEN LIFETIMES (LinkedIn's documentation, and a real Development-tier
// authorization on 2026-11-04):
//   · access tokens last 60 days;
//   · refresh tokens last 365 days from the FIRST authorization — refreshing
//     does not extend them. Development-tier apps get one. The token-only path
//     below stays because LinkedIn's docs do not promise one to every app.
// So the connector works for a year, and then a human authorizes again. Both
// expiries are reported by linkedin_whoami so nobody is surprised.
//
// WHERE LOCAL FILES LIVE: one parent, one subfolder per connector, in each of
// the three standard locations, so there is one place to look at and one thing
// to delete:
//   ~/.config/pappcorn/linkedin-mcp/       the credential
//   ~/.cache/pappcorn/linkedin-mcp/        renewed access tokens
//   ~/.local/state/pappcorn/linkedin-mcp/  the local log of what was published
//
// No credential field is ever printed, logged, or returned by any tool.

import { createHash } from 'node:crypto';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';

// Marketing API version, YYYYMM. LinkedIn supports each version for about a
// year and sunsets the oldest monthly; override with LINKEDIN_API_VERSION when
// this default ages out (the API answers 426 for a sunset version).
export const DEFAULT_API_VERSION = '202610';

export const DEFAULT_CREDENTIALS_PATH = `${homedir()}/.config/pappcorn/linkedin-mcp/credentials.json`;
export const DEFAULT_CACHE_DIR = `${homedir()}/.cache/pappcorn/linkedin-mcp`;

export const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';

export interface LinkedInCredentials {
  client_id?: string;
  client_secret?: string;
  access_token?: string;
  /** Epoch seconds. Unknown when the token came from the environment. */
  access_token_expires_at?: number;
  refresh_token?: string;
  /** Epoch seconds. */
  refresh_token_expires_at?: number;
  scope?: string;
  /** urn:li:organization:<id> recorded by the setup script. */
  organization?: string;
  organization_name?: string;
}

export interface ResolvedConfig {
  creds: LinkedInCredentials;
  /** urn:li:organization:<id> */
  organization: string;
  /** Where the credential came from — a label, never a value. */
  source: string;
  apiVersion: string;
  apiUrl: string;
}

// Local-access failures (no credential, expired, not configured), kept distinct
// from API failures so callers can tell "you are not set up" from "LinkedIn
// said no".
export class LinkedInAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LinkedInAccessError';
  }
}

export function credentialsPath(): string {
  return process.env.LINKEDIN_MCP_CREDENTIALS || DEFAULT_CREDENTIALS_PATH;
}

function cacheDir(): string {
  return process.env.LINKEDIN_MCP_CACHE_DIR || DEFAULT_CACHE_DIR;
}

// An unset plugin user_config can surface as "" or as the literal unexpanded
// "${user_config.*}" placeholder — both mean "not configured".
function readVar(name: string): string | undefined {
  const v = process.env[name];
  return v && !v.includes('${') ? v.trim() : undefined;
}

function pretty(path: string): string {
  return path.replace(homedir(), '~');
}

function noAccessMessage(path: string): string {
  return (
    'No LinkedIn credential found. Run the one-time setup, which authorizes your own ' +
    'LinkedIn app as an administrator of your Page and writes ' +
    `${pretty(path)}: \`npx -p @pappcorn/linkedin-mcp pappcorn-linkedin-setup --client-id ` +
    '<id> --client-secret-file <path>\`. Or set LINKEDIN_ACCESS_TOKEN (or LINKEDIN_REFRESH_TOKEN + ' +
    'LINKEDIN_CLIENT_ID + LINKEDIN_CLIENT_SECRET) in the environment. Full walkthrough: ' +
    'docs/setup-linkedin.md.'
  );
}

/** Accepts a bare numeric id or a full organization URN; returns the URN. */
export function toOrganizationUrn(value: string): string {
  const v = value.trim();
  if (/^\d+$/.test(v)) return `urn:li:organization:${v}`;
  if (/^urn:li:organization:\d+$/.test(v)) return v;
  throw new LinkedInAccessError(
    `"${v}" is not a LinkedIn organization id. Use the numeric id of your Page ` +
      '(urn:li:organization:<id> also works).',
  );
}

function readFileCreds(path: string): LinkedInCredentials | null {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw) as LinkedInCredentials;
  } catch {
    throw new LinkedInAccessError(
      `${noAccessMessage(path)} (that file exists but is not valid JSON — run the setup again)`,
    );
  }
}

let cached: ResolvedConfig | null = null;

export function loadConfig(): ResolvedConfig {
  if (cached) return cached;

  const apiVersion = readVar('LINKEDIN_API_VERSION') || DEFAULT_API_VERSION;
  const apiUrl = readVar('LINKEDIN_API_URL') || 'https://api.linkedin.com';
  const path = credentialsPath();

  const envAccess = readVar('LINKEDIN_ACCESS_TOKEN');
  const envRefresh = readVar('LINKEDIN_REFRESH_TOKEN');
  const envId = readVar('LINKEDIN_CLIENT_ID');
  const envSecret = readVar('LINKEDIN_CLIENT_SECRET');
  const envOrg = readVar('LINKEDIN_ORGANIZATION_ID');

  let creds: LinkedInCredentials;
  let source: string;
  // The file is still consulted on the env path, but only for the Page id —
  // so a plugin install can hold the token in the keychain while the setup
  // script's record of "which Page" stays the default.
  // A corrupt file only matters when the file is the credential.
  const fromEnv = Boolean(envAccess || (envRefresh && envId && envSecret));
  let file: LinkedInCredentials | null = null;
  try {
    file = readFileCreds(path);
  } catch (err) {
    if (!fromEnv) throw err;
  }

  if (fromEnv) {
    creds = {
      access_token: envAccess,
      refresh_token: envRefresh,
      client_id: envId,
      client_secret: envSecret,
    };
    source = 'environment';
  } else if (file) {
    if (!file.access_token && !file.refresh_token) {
      throw new LinkedInAccessError(
        `${noAccessMessage(path)} (that file has no token — run the setup again)`,
      );
    }
    creds = file;
    source = `credential file ${pretty(path)}`;
  } else {
    throw new LinkedInAccessError(noAccessMessage(path));
  }

  const orgValue = envOrg || creds.organization || file?.organization;
  if (!orgValue) {
    throw new LinkedInAccessError(
      'No LinkedIn Page configured. Set LINKEDIN_ORGANIZATION_ID to the numeric id of the ' +
        'Page you administer, or run the setup script, which records it for you.',
    );
  }

  cached = {
    creds,
    organization: toOrganizationUrn(orgValue),
    source,
    apiVersion,
    apiUrl,
  };
  return cached;
}

// ──────────────────────────────────────────────────────────────────────────────
// Access token lifecycle
// ──────────────────────────────────────────────────────────────────────────────

interface CachedToken {
  access_token: string;
  expires_at: number;
}

// The cache key is a digest of the credential, so two credentials on one machine
// never share an access token. It includes the stored access token because
// LinkedIn can return the same refresh token on re-authorization: without it, a
// token renewed before a re-authorization would outrank the new one and keep its
// old scopes. The digest is not reversible.
function cachePath(creds: LinkedInCredentials): string {
  const id = createHash('sha256')
    .update(
      `${creds.client_id ?? ''}\n${creds.refresh_token ?? ''}\n${creds.access_token ?? ''}`,
    )
    .digest('hex')
    .slice(0, 16);
  return `${cacheDir()}/token-${id}.json`;
}

function readCache(creds: LinkedInCredentials): string | null {
  const p = cachePath(creds);
  if (!existsSync(p)) return null;
  try {
    const c = JSON.parse(readFileSync(p, 'utf8')) as CachedToken;
    if (!c.expires_at || c.expires_at - nowSeconds() < 60) return null;
    return c.access_token;
  } catch {
    return null;
  }
}

function writeCache(
  creds: LinkedInCredentials,
  access_token: string,
  expires_at: number,
): void {
  const dir = cacheDir();
  mkdirSync(dir, { recursive: true });
  const p = cachePath(creds);
  // Write a private temp file, then rename it over the cache: a reader never
  // sees a half-written token, and two writers never interleave.
  const tmp = `${p}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    writeFileSync(
      tmp,
      JSON.stringify({ access_token, expires_at } satisfies CachedToken),
      { mode: 0o600 },
    );
    try {
      chmodSync(tmp, 0o600);
    } catch {
      // best-effort
    }
    renameSync(tmp, p);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function formatDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

function canRefresh(c: LinkedInCredentials): boolean {
  return Boolean(c.refresh_token && c.client_id && c.client_secret);
}

async function refresh(c: LinkedInCredentials): Promise<string> {
  if (
    c.refresh_token_expires_at &&
    c.refresh_token_expires_at - nowSeconds() < 60
  ) {
    throw new LinkedInAccessError(
      `The refresh token expired on ${formatDate(c.refresh_token_expires_at)}. LinkedIn ` +
        'refresh tokens last one year from the first authorization and cannot be extended. ' +
        'Run the setup script again to re-authorize.',
    );
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: c.refresh_token as string,
      client_id: c.client_id as string,
      client_secret: c.client_secret as string,
    }),
  });
  if (!res.ok) {
    // The request is never echoed: only LinkedIn's error code and description.
    let detail = `HTTP ${res.status}`;
    try {
      const b = (await res.json()) as {
        error?: string;
        error_description?: string;
      };
      if (b.error)
        detail += `: ${b.error}${b.error_description ? ` — ${b.error_description}` : ''}`;
    } catch {
      // non-JSON body
    }
    throw new LinkedInAccessError(
      `LinkedIn refused to renew the access token (${detail}). The refresh token was ` +
        'revoked, expired, or the client secret was rotated. Run the setup script again.',
    );
  }
  const data = (await res.json()) as {
    access_token: string;
    expires_in?: number;
  };
  writeCache(c, data.access_token, nowSeconds() + (data.expires_in ?? 86400));
  return data.access_token;
}

// One renewal at a time. Requests that run in parallel (mention lookups) and
// all hit a 401 share this promise: one call to LinkedIn, one cache write.
let inflight: Promise<string> | null = null;

function renewOnce(c: LinkedInCredentials): Promise<string> {
  if (!inflight) {
    inflight = refresh(c).finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

/** A usable access token: the cached renewal, the stored token while it is
 *  valid, or a fresh renewal. `forceRefresh` is for the one retry after a 401;
 *  `rejected` is the token LinkedIn refused, so a request whose 401 arrives
 *  after another one already renewed it takes the new token instead of
 *  renewing again. */
export async function getAccessToken(
  forceRefresh = false,
  rejected?: string,
): Promise<string> {
  const { creds } = loadConfig();

  if (forceRefresh && canRefresh(creds)) {
    if (inflight) return inflight;
    const renewed = readCache(creds);
    if (renewed && renewed !== rejected) return renewed;
  }

  if (!forceRefresh) {
    const fromCache = canRefresh(creds) ? readCache(creds) : null;
    if (fromCache) return fromCache;
    if (
      creds.access_token &&
      (!creds.access_token_expires_at ||
        creds.access_token_expires_at - nowSeconds() > 60)
    ) {
      return creds.access_token;
    }
  }

  if (canRefresh(creds)) return renewOnce(creds);

  if (forceRefresh) {
    throw new LinkedInAccessError(
      'LinkedIn rejected the access token (401) and there is no refresh token to renew it. ' +
        'Run the setup script again to re-authorize.',
    );
  }
  throw new LinkedInAccessError(
    `The access token expired${
      creds.access_token_expires_at
        ? ` on ${formatDate(creds.access_token_expires_at)}`
        : ''
    } and LinkedIn issued no refresh token to this app, so it cannot be renewed ` +
      'automatically. Run the setup script again (it takes a minute).',
  );
}

export function canRenew(): boolean {
  return canRefresh(loadConfig().creds);
}

// Test seam only — no production caller.
export function resetConfigCache(): void {
  cached = null;
}
