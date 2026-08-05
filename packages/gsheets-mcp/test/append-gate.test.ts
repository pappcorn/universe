// The append gate, which is a different problem from the update gate and was
// gotten wrong first: an append overwrites nothing, so there is no prior grid
// to fingerprint.
//
// Binding the token to an empty "before" made it a pure function of its own
// arguments, and that fails two ways:
//   1. REPLAY — the token stays valid after it is used, so one human "yes"
//      could append the same rows again and again.
//   2. BLIND to a concurrent append by someone else.
//
// The fix binds the token to the table's current height. These tests hold that
// fix down.
//
//   npm test          (from packages/gsheets-mcp)

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

const logDir = mkdtempSync(join(tmpdir(), 'gsheets-append-'));
after(() => rmSync(logDir, { recursive: true, force: true }));

process.env.GSHEETS_CLIENT_ID = 'test-client';
process.env.GSHEETS_CLIENT_SECRET = 'test-secret';
process.env.GSHEETS_REFRESH_TOKEN = 'test-refresh';
process.env.GSHEETS_MCP_LOG_DIR = logDir;

import { registerTools } from '../src/tools';

const ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
const TAB = 'Movimientos';

// ── The pretend table: `rows` is its height, and appends grow it ──────────────
let rows = 100;
let appendCount = 0;

const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
});

globalThis.fetch = (async (
  url: string | URL,
  init: { method?: string; body?: string } = {}
) => {
  const u = String(url);
  const json = (o: unknown) => ({
    ok: true,
    status: 200,
    json: async () => o,
    text: async () => JSON.stringify(o),
  });
  if (u.includes('oauth2.googleapis.com/token')) {
    return json({ access_token: 'test-access', expires_in: 3600 });
  }
  if (u.includes(':append')) {
    const added = (JSON.parse(init.body as string) as { values: string[][] })
      .values.length;
    appendCount++;
    rows += added;
    return json({
      updates: {
        updatedRange: `${TAB}!A${rows - added + 1}:C${rows}`,
        updatedRows: added,
        updatedColumns: 3,
        updatedCells: added * 3,
      },
    });
  }
  // The height probe — column A, one entry per used row.
  if (u.includes('/values/')) {
    return json({
      range: `${TAB}!A1:A${rows}`,
      values: Array.from({ length: rows }, (_, i) => [`r${i}`]),
    });
  }
  if (u.includes('?fields=')) {
    return json({
      spreadsheetId: ID,
      properties: { title: 'Conciliación' },
      sheets: [],
    });
  }
  throw new Error(`unexpected fetch in test: ${u}`);
}) as unknown as typeof fetch;

type Handler = (
  args: Record<string, unknown>
) => Promise<{ content: Array<{ text: string }> }>;
const handlers: Record<string, Handler> = {};
registerTools({
  registerTool: (name: string, _cfg: unknown, fn: Handler) => {
    handlers[name] = fn;
  },
} as never);

const call = async (
  tool: string,
  args: Record<string, unknown>
): Promise<string> => (await handlers[tool](args)).content[0].text;

const tokenIn = (text: string): string => {
  const m = /confirm_token: ([a-f0-9]+)/.exec(text);
  assert.ok(m, 'expected a confirm_token');
  return m[1];
};

const NEW_ROWS = [['F-9001', 'cliente nuevo', '250000']];

describe('sheet_append — the gate', () => {
  beforeEach(() => {
    rows = 100;
    appendCount = 0;
  });

  it('previews without appending, and says where the rows would land', async () => {
    const out = await call('sheet_append', {
      spreadsheet: ID,
      range: TAB,
      values: NEW_ROWS,
    });
    assert.match(out, /^PREVIEW/);
    assert.match(out, /after row 100/);
    assert.equal(appendCount, 0);
    assert.equal(rows, 100);
  });

  it('appends once the token matches', async () => {
    const preview = await call('sheet_append', {
      spreadsheet: ID,
      range: TAB,
      values: NEW_ROWS,
    });
    const out = await call('sheet_append', {
      spreadsheet: ID,
      range: TAB,
      values: NEW_ROWS,
      confirm_token: tokenIn(preview),
    });
    assert.match(out, /^APPENDED/);
    assert.equal(appendCount, 1);
    assert.equal(rows, 101);
  });
});

describe('sheet_append — replay', () => {
  beforeEach(() => {
    rows = 100;
    appendCount = 0;
  });

  it('will not let one confirmation append the same rows twice', async () => {
    const preview = await call('sheet_append', {
      spreadsheet: ID,
      range: TAB,
      values: NEW_ROWS,
    });
    const token = tokenIn(preview);

    const first = await call('sheet_append', {
      spreadsheet: ID,
      range: TAB,
      values: NEW_ROWS,
      confirm_token: token,
    });
    assert.match(first, /^APPENDED/);

    // The same token, again. One "yes" must buy exactly one append.
    const second = await call('sheet_append', {
      spreadsheet: ID,
      range: TAB,
      values: NEW_ROWS,
      confirm_token: token,
    });
    assert.match(second, /^REFUSED/);
    assert.equal(appendCount, 1, 'the replayed confirmation must not append');
    assert.equal(rows, 101);
  });
});

describe('sheet_append — concurrency', () => {
  beforeEach(() => {
    rows = 100;
    appendCount = 0;
  });

  it('refuses a confirmation issued before someone else appended', async () => {
    const preview = await call('sheet_append', {
      spreadsheet: ID,
      range: TAB,
      values: NEW_ROWS,
    });
    const token = tokenIn(preview);

    // A human adds three rows in the browser, between the preview and the yes.
    rows += 3;

    const out = await call('sheet_append', {
      spreadsheet: ID,
      range: TAB,
      values: NEW_ROWS,
      confirm_token: token,
    });
    assert.match(out, /^REFUSED/);
    assert.equal(appendCount, 0);
    assert.match(
      out,
      /103 row\(s\) tall now/,
      'the refusal must report the CURRENT height'
    );
    assert.match(out, /new confirm_token: [a-f0-9]+/);
  });

  it('accepts the re-approval against the new reality', async () => {
    await call('sheet_append', {
      spreadsheet: ID,
      range: TAB,
      values: NEW_ROWS,
    });
    rows += 3;
    const refusal = await call('sheet_append', {
      spreadsheet: ID,
      range: TAB,
      values: NEW_ROWS,
      confirm_token: 'staleauthorization',
    });
    const fresh = tokenIn(
      refusal.replace('new confirm_token', 'confirm_token')
    );

    const out = await call('sheet_append', {
      spreadsheet: ID,
      range: TAB,
      values: NEW_ROWS,
      confirm_token: fresh,
    });
    assert.match(out, /^APPENDED/);
    assert.equal(rows, 104);
  });
});
