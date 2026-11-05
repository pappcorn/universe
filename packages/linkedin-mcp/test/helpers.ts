// Shared test scaffolding: a fake LinkedIn behind `fetch`, and a way to call
// registered MCP tool handlers directly. Nothing here talks to the network or
// reads the real machine's credential files.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  rawBody?: unknown;
}

export const ORG = 'urn:li:organization:1234567';

/** Point every path the connector writes or reads at a throwaway directory and
 *  supply a credential through the environment. Returns a cleanup. */
export function isolate(extraEnv: Record<string, string> = {}): () => void {
  const dir = mkdtempSync(join(tmpdir(), 'linkedin-mcp-test-'));
  const env: Record<string, string> = {
    LINKEDIN_MCP_CREDENTIALS: join(dir, 'missing.json'),
    LINKEDIN_MCP_CACHE_DIR: join(dir, 'cache'),
    LINKEDIN_MCP_LOG_DIR: join(dir, 'log'),
    LINKEDIN_ACCESS_TOKEN: 'test-access-token',
    LINKEDIN_ORGANIZATION_ID: '1234567',
    ...extraEnv,
  };
  for (const k of [
    'LINKEDIN_ACCESS_TOKEN',
    'LINKEDIN_REFRESH_TOKEN',
    'LINKEDIN_CLIENT_ID',
    'LINKEDIN_CLIENT_SECRET',
    'LINKEDIN_ORGANIZATION_ID',
    'LINKEDIN_API_VERSION',
  ])
    delete process.env[k];
  Object.assign(process.env, env);
  return () => rmSync(dir, { recursive: true, force: true });
}

export function tempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'linkedin-mcp-files-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

type Responder = (call: Call) =>
  | {
      status?: number;
      json?: unknown;
      headers?: Record<string, string>;
    }
  | undefined;

/** Install a fake fetch. `respond` returns undefined for an unexpected call,
 *  which fails the test loudly rather than silently passing. */
export function fakeLinkedIn(respond: Responder): {
  calls: Call[];
  restore: () => void;
} {
  const calls: Call[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (
    input: string | URL,
    init: {
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
    } = {},
  ) => {
    const raw = init.body;
    let body: unknown = raw;
    if (typeof raw === 'string') {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    } else if (raw instanceof URLSearchParams) {
      body = Object.fromEntries(raw);
    }
    const call: Call = {
      method: init.method ?? 'GET',
      url: String(input),
      headers: init.headers ?? {},
      body,
      rawBody: raw,
    };
    calls.push(call);
    const r = respond(call);
    if (!r)
      throw new Error(`unexpected fetch in test: ${call.method} ${call.url}`);
    const status = r.status ?? 200;
    const text = r.json === undefined ? '' : JSON.stringify(r.json);
    const headers = new Map(
      Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    );
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
      json: async () => JSON.parse(text),
      text: async () => text,
    };
  }) as unknown as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = real) };
}

type Handler = (
  args: Record<string, unknown>,
) => Promise<{ content: Array<{ text: string }> }>;

export function captureTools(
  register: (server: never) => void,
): (tool: string, args?: Record<string, unknown>) => Promise<string> {
  const handlers: Record<string, Handler> = {};
  register({
    registerTool: (name: string, _cfg: unknown, fn: Handler) => {
      handlers[name] = fn;
    },
  } as never);
  return async (tool, args = {}) => {
    const h = handlers[tool];
    if (!h) throw new Error(`no tool ${tool}`);
    return (await h(args)).content[0].text;
  };
}

export function tokenIn(preview: string): string {
  const m = /confirm_token: ([a-f0-9]+)/.exec(preview);
  if (!m) throw new Error(`no confirm_token in:\n${preview}`);
  return m[1];
}
