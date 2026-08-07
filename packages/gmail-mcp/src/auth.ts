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
// ── WHICH MAILBOX AM I? ──────────────────────────────────────────────────────
// One machine often has to serve more than one mailbox. Identity is therefore
// resolved from the WORKING DIRECTORY, not from a single global slot. In
// precedence order, highest first:
//
//   1. Process environment — GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET +
//      GMAIL_REFRESH_TOKEN. This is what the Claude plugin uses: it collects
//      them at install time, keeps them in the OS keychain, and passes them to
//      this process as env vars. Nothing touches disk.
//   2. The nearest `.env` — found by walking up from the working directory and
//      stopping at the repository root (see env-file.ts for the exact
//      contract). `.env` NEVER overrides a variable already set in the process
//      environment; it only fills in what is missing. It may carry the same
//      three variables inline, or — preferred — just GMAIL_MCP_CREDENTIALS
//      pointing at a credential file that lives outside the repo.
//   3. $GMAIL_MCP_CREDENTIALS — a credential file path.
//   4. ~/.config/pappcorn-gmail-mcp/credentials.json — the global default. It
//      still works, for every install that predates folder scoping, but it is
//      no longer the recommended path: it is one slot, so it cannot express
//      "this project uses that mailbox".
//
// If no `.env` is in scope we do not borrow one from anywhere else. Falling
// through to the global default is a documented decision, not an accident.
//
// GMAIL_ACCOUNT IS AN ASSERTION, AND IT FAILS CLOSED. If it is set, the first
// Gmail call verifies it against the mailbox the credential ACTUALLY opens —
// the live profile, never the `account` field written inside the credential
// file. A mismatch denies access with the same clean "no access" voice. Sending
// mail from the wrong mailbox is this tool's most expensive failure, because it
// is the only one a third party sees.
//
// If no credential is present the server has no mail access and says so
// plainly. No credential field is ever printed, logged, or returned by a tool.
//
// Token cache: ~/.cache/pappcorn-gmail-mcp/token-<id>.json (chmod 600), reused
// until ~60s before expiry. `<id>` is a non-reversible digest of the credential
// itself, so two mailboxes on one machine can never be served each other's
// access token, and re-minting or changing scopes invalidates the cache
// naturally.

import { createHash } from 'node:crypto';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  chmodSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname } from 'node:path';

import { expandPath, loadEnvFile, type EnvFile } from './env-file';

// gmail.modify = read, search, label, archive (a RESTRICTED scope).
// gmail.send   = send mail (a SENSITIVE scope).
// Together they cover the full v1 tool surface. To reduce what the token can
// do, see docs/setup-google-cloud.md → "Narrowing the scopes".
export const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
];
const SCOPE = SCOPES.join(' ');

export const DEFAULT_CREDENTIALS_PATH = `${homedir()}/.config/pappcorn-gmail-mcp/credentials.json`;
const TOKEN_CACHE_DIR = `${homedir()}/.cache/pappcorn-gmail-mcp`;

export interface MailCredentials {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  /** The mailbox that granted the token. Written by mint-token; informational
   *  only — identity is asserted against the live profile, never against this. */
  account?: string;
}

interface CachedToken {
  /** Digest of the credential in use. Never a credential field itself. */
  id: string;
  scope: string;
  access_token: string;
  expires_at: number;
}

/** Where a resolved setting came from. Reported to humans; never a secret. */
export type ConfigOrigin = 'environment' | 'env-file' | 'default';

export type CredentialPlan =
  | { kind: 'inline'; origin: ConfigOrigin; credentials: MailCredentials }
  | { kind: 'file'; origin: ConfigOrigin; path: string };

// Local-access failures (no credential, unreadable, revoked, wrong mailbox).
// The CLI maps this class to exit code 1 (local config), everything else to 3.
export class MailAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailAccessError';
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Layered configuration
// ──────────────────────────────────────────────────────────────────────────────

// An unset plugin user_config can surface as "" or as the literal unexpanded
// "${user_config.*}" placeholder — both mean "not configured" and must fall
// through to the next layer.
function clean(v: string | undefined): string | undefined {
  return v && v.trim() && !v.includes('${') ? v : undefined;
}

interface Resolved {
  value: string;
  origin: ConfigOrigin;
  /** Directory the value should be interpreted relative to (for paths). */
  baseDir: string;
}

function pick(
  name: string,
  env: NodeJS.ProcessEnv,
  file: EnvFile | null,
  cwd: string,
): Resolved | undefined {
  const direct = clean(env[name]);
  if (direct) return { value: direct, origin: 'environment', baseDir: cwd };
  const fromFile = file ? clean(file.values[name]) : undefined;
  if (fromFile && file)
    return { value: fromFile, origin: 'env-file', baseDir: dirname(file.path) };
  return undefined;
}

/**
 * Pure resolution of the precedence rules above. Exported so the contract can
 * be tested without touching the filesystem or the real environment.
 */
export function resolveCredentialPlan(
  env: NodeJS.ProcessEnv,
  file: EnvFile | null,
  cwd: string,
  defaultPath: string = DEFAULT_CREDENTIALS_PATH,
): CredentialPlan {
  const id = pick('GMAIL_CLIENT_ID', env, file, cwd);
  const secret = pick('GMAIL_CLIENT_SECRET', env, file, cwd);
  const refresh = pick('GMAIL_REFRESH_TOKEN', env, file, cwd);

  if (id && secret && refresh) {
    // Mixed layers are reported as the weakest one that contributed, so the
    // human sees the file they would need to edit.
    const origin: ConfigOrigin =
      id.origin === 'env-file' ||
      secret.origin === 'env-file' ||
      refresh.origin === 'env-file'
        ? 'env-file'
        : 'environment';
    return {
      kind: 'inline',
      origin,
      credentials: {
        client_id: id.value,
        client_secret: secret.value,
        refresh_token: refresh.value,
        account: pick('GMAIL_ACCOUNT', env, file, cwd)?.value,
      },
    };
  }

  const configured = pick('GMAIL_MCP_CREDENTIALS', env, file, cwd);
  if (configured) {
    return {
      kind: 'file',
      origin: configured.origin,
      path: expandPath(configured.value, configured.baseDir),
    };
  }
  return { kind: 'file', origin: 'default', path: defaultPath };
}

let envFileLayer: EnvFile | null | undefined;

function envFile(): EnvFile | null {
  if (envFileLayer === undefined) envFileLayer = loadEnvFile(process.cwd());
  return envFileLayer;
}

/** The mailbox the operator asserts this configuration belongs to, if any. */
export function assertedAccount(): string | undefined {
  return pick('GMAIL_ACCOUNT', process.env, envFile(), process.cwd())?.value;
}

let plan: CredentialPlan | null = null;

function credentialPlan(): CredentialPlan {
  if (!plan)
    plan = resolveCredentialPlan(process.env, envFile(), process.cwd());
  return plan;
}

/** Path of the credential file this working directory resolves to. */
export function credentialsPath(): string {
  const p = credentialPlan();
  return p.kind === 'file' ? p.path : '(supplied as environment variables)';
}

const pretty = (path: string): string => path.replace(homedir(), '~');

/**
 * One line naming where the credential came from — shown by `whoami` so
 * "which mailbox is this folder on?" is answerable without guessing. Paths and
 * origins only; never a credential field.
 */
export function credentialSource(): string {
  const p = credentialPlan();
  const file = envFile();
  const via = file ? ` ${pretty(file.path)}` : '';
  if (p.kind === 'inline') {
    return p.origin === 'env-file'
      ? `inline variables from${via}`
      : 'environment variables';
  }
  switch (p.origin) {
    case 'env-file':
      return `${pretty(p.path)} — resolved from${via}`;
    case 'environment':
      return `${pretty(p.path)} — from $GMAIL_MCP_CREDENTIALS`;
    default:
      return `${pretty(p.path)} — global default`;
  }
}

// The single "no access" voice — identical across the MCP server and the CLI so
// a misconfigured install always reads the same. Never mentions any secret.
function noAccessMessage(path: string): string {
  return (
    'No Gmail credential for this working directory. Supply one of, in precedence order: ' +
    '(1) GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET + GMAIL_REFRESH_TOKEN in the environment — what the ' +
    'Claude plugin does; (2) a `.env` in this folder or its repo root setting GMAIL_MCP_CREDENTIALS ' +
    'to your credential file (keep the credential outside the repo, and `.env` in .gitignore); ' +
    `(3) $GMAIL_MCP_CREDENTIALS; (4) the global default ${pretty(
      DEFAULT_CREDENTIALS_PATH,
    )}. ` +
    `This folder currently resolves to ${pretty(
      path,
    )} — create it with the one-time setup: ` +
    '`npx -y -p @pappcorn/gmail-mcp pappcorn-gmail-setup --client <your-oauth-client.json>`. ' +
    'Full walkthrough: docs/setup-google-cloud.md.'
  );
}

let cachedCredentials: MailCredentials | null = null;

// Preflight + load. Any failure resolves to the same clean "no access" message —
// never a stack trace, never a credential field.
export function loadCredentials(): MailCredentials {
  if (cachedCredentials) return cachedCredentials;

  const p = credentialPlan();
  if (p.kind === 'inline') {
    cachedCredentials = p.credentials;
    return cachedCredentials;
  }

  let raw: string;
  try {
    raw = readFileSync(p.path, 'utf8');
  } catch {
    throw new MailAccessError(noAccessMessage(p.path));
  }
  let creds: MailCredentials;
  try {
    creds = JSON.parse(raw) as MailCredentials;
  } catch {
    throw new MailAccessError(
      `${noAccessMessage(
        p.path,
      )} (that file exists but is not valid JSON — re-run the setup script)`,
    );
  }
  if (!creds.client_id || !creds.client_secret || !creds.refresh_token) {
    throw new MailAccessError(
      `${noAccessMessage(
        p.path,
      )} (that file exists but is missing fields — re-run the setup script)`,
    );
  }
  cachedCredentials = creds;
  return cachedCredentials;
}

/**
 * Denial for a failed GMAIL_ACCOUNT assertion. It names the mailbox the
 * OPERATOR declared and where the credential was resolved from — never the
 * mailbox the credential actually opens, which is precisely the fact this
 * configuration turned out not to be entitled to.
 */
export function accountMismatchMessage(expected: string): string {
  return (
    `No Gmail access: GMAIL_ACCOUNT asserts ${expected}, but the credential in use opens a ` +
    'different mailbox. Refusing rather than acting on the wrong one. That credential came from ' +
    `${credentialSource()} — point this folder at the right one (a \`.env\` next to your project ` +
    'setting GMAIL_MCP_CREDENTIALS is the tidiest way), or clear GMAIL_ACCOUNT and run `whoami` to ' +
    'see which mailbox this credential actually is.'
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Access tokens
// ──────────────────────────────────────────────────────────────────────────────

// Cache slot identity: a non-reversible digest of the credential in use, so two
// mailboxes on one machine get separate slots even when neither declares an
// account. It exists only inside the chmod-600 cache file; never printed.
function cacheId(creds: MailCredentials): string {
  return createHash('sha256')
    .update(`${creds.client_id}\n${creds.refresh_token}`)
    .digest('hex')
    .slice(0, 16);
}

function cachePath(id: string): string {
  return `${TOKEN_CACHE_DIR}/token-${id}.json`;
}

function readCachedToken(id: string): string | null {
  const path = cachePath(id);
  if (!existsSync(path)) return null;
  try {
    const cached = JSON.parse(readFileSync(path, 'utf8')) as CachedToken;
    if (cached.id !== id) return null;
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
  id: string,
  access_token: string,
  expires_at: number,
): void {
  mkdirSync(TOKEN_CACHE_DIR, { recursive: true });
  const path = cachePath(id);
  writeFileSync(
    path,
    JSON.stringify({
      id,
      scope: SCOPE,
      access_token,
      expires_at,
    } satisfies CachedToken),
    {
      mode: 0o600,
    },
  );
  try {
    chmodSync(path, 0o600);
  } catch {
    // best-effort; ignore if the filesystem doesn't support it
  }
}

// Exchange the refresh token for a short-lived access token (or serve the
// cached one).
export async function getAccessToken(): Promise<string> {
  const creds = loadCredentials();
  const id = cacheId(creds);
  const cached = readCachedToken(id);
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
  const data = (await res.json()) as {
    access_token: string;
    expires_in?: number;
  };
  writeCachedToken(id, data.access_token, now + (data.expires_in ?? 3600));
  return data.access_token;
}

// Google access tokens go in a standard Bearer header.
export async function authHeaders(
  extra: Record<string, string> = {},
): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await getAccessToken()}`, ...extra };
}
