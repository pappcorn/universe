// The two-phase write gate — the safety property this connector exists to
// guarantee, so it gets tests rather than trust.
//
// Three things must hold, and all three are load-bearing:
//   1. A call without confirm_token WRITES NOTHING. It only previews.
//   2. A wrong token writes nothing.
//   3. A token issued before someone else edited the range is REFUSED, so a
//      stale confirmation can never clobber a human's work.
//
// Google is stubbed at `fetch`, and the stub keeps a mutable cell so the tests
// assert on a real effect ("did the value change?") rather than on a message.
//
//   npm test          (from packages/gsheets-mcp)

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

const logDir = mkdtempSync(join(tmpdir(), 'gsheets-audit-'));
after(() => rmSync(logDir, { recursive: true, force: true }));

// Credentials via env, so the token exchange is exercised through the stub and
// nothing reads the real machine's credential file.
process.env.GSHEETS_CLIENT_ID = 'test-client';
process.env.GSHEETS_CLIENT_SECRET = 'test-secret';
process.env.GSHEETS_REFRESH_TOKEN = 'test-refresh';
process.env.GSHEETS_MCP_LOG_DIR = logDir;

import { registerTools } from '../src/tools';

const ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
const RANGE = 'Movimientos!D38104';

// ── The pretend spreadsheet ───────────────────────────────────────────────────
let cell = '1150000';
let putCount = 0;

const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
});

globalThis.fetch = (async (
  url: string | URL,
  init: { method?: string; body?: string } = {},
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
  if (u.includes('/values/') && (init.method ?? 'GET') === 'GET') {
    return json({ range: RANGE, values: [[cell]] });
  }
  if (u.includes('/values/') && init.method === 'PUT') {
    putCount++;
    cell = (JSON.parse(init.body as string) as { values: string[][] })
      .values[0][0];
    return json({
      updatedRange: RANGE,
      updatedRows: 1,
      updatedColumns: 1,
      updatedCells: 1,
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

// ── Capture the registered handlers ───────────────────────────────────────────
type Handler = (
  args: Record<string, unknown>,
) => Promise<{ content: Array<{ text: string }> }>;
const handlers: Record<string, Handler> = {};
registerTools({
  registerTool: (name: string, _cfg: unknown, fn: Handler) => {
    handlers[name] = fn;
  },
} as never);

const call = async (
  tool: string,
  args: Record<string, unknown>,
): Promise<string> => (await handlers[tool](args)).content[0].text;

const tokenIn = (preview: string): string => {
  const m = /confirm_token: ([a-f0-9]+)/.exec(preview);
  assert.ok(m, 'the preview must carry a confirm_token');
  return m[1];
};

describe('sheet_update — phase 1 (preview)', () => {
  beforeEach(() => {
    cell = '1150000';
    putCount = 0;
  });

  it('writes nothing and returns a preview', async () => {
    const out = await call('sheet_update', {
      spreadsheet: ID,
      range: RANGE,
      values: [['1250000']],
    });
    assert.match(out, /^PREVIEW/);
    assert.equal(putCount, 0, 'phase 1 must not issue a write');
    assert.equal(cell, '1150000', 'the sheet must be untouched');
  });

  it('shows the human both the current and the proposed value', async () => {
    const out = await call('sheet_update', {
      spreadsheet: ID,
      range: RANGE,
      values: [['1250000']],
    });
    assert.match(out, /BEFORE/);
    assert.match(out, /1150000/);
    assert.match(out, /AFTER/);
    assert.match(out, /1250000/);
  });
});

describe('sheet_update — phase 2 (confirmation)', () => {
  beforeEach(() => {
    cell = '1150000';
    putCount = 0;
  });

  it('refuses a token that does not match, and writes nothing', async () => {
    const out = await call('sheet_update', {
      spreadsheet: ID,
      range: RANGE,
      values: [['1250000']],
      confirm_token: 'deadbeefdeadbeef',
    });
    assert.match(out, /^REFUSED/);
    assert.equal(putCount, 0);
    assert.equal(cell, '1150000');
  });

  it('writes when the token matches, and records it in the audit log', async () => {
    const preview = await call('sheet_update', {
      spreadsheet: ID,
      range: RANGE,
      values: [['1250000']],
    });
    const out = await call('sheet_update', {
      spreadsheet: ID,
      range: RANGE,
      values: [['1250000']],
      confirm_token: tokenIn(preview),
    });
    assert.match(out, /^WRITTEN/);
    assert.equal(putCount, 1);
    assert.equal(cell, '1250000', 'the cell must actually have changed');
    assert.match(out, /logged to/);
  });
});

describe('sheet_update — concurrent edits', () => {
  beforeEach(() => {
    cell = '1150000';
    putCount = 0;
  });

  it('refuses a confirmation issued before someone else edited the range', async () => {
    const preview = await call('sheet_update', {
      spreadsheet: ID,
      range: RANGE,
      values: [['1250000']],
    });
    const token = tokenIn(preview);

    // A human edits the same cell in the browser, between the preview and the yes.
    cell = '999';

    const out = await call('sheet_update', {
      spreadsheet: ID,
      range: RANGE,
      values: [['1250000']],
      confirm_token: token,
    });
    assert.match(out, /^REFUSED/);
    assert.equal(putCount, 0, 'the stale confirmation must not write');
    assert.equal(cell, '999', "the other person's edit must survive");
  });

  it('hands back a fresh token so the human can re-approve against reality', async () => {
    const preview = await call('sheet_update', {
      spreadsheet: ID,
      range: RANGE,
      values: [['1250000']],
    });
    cell = '999';
    const refusal = await call('sheet_update', {
      spreadsheet: ID,
      range: RANGE,
      values: [['1250000']],
      confirm_token: tokenIn(preview),
    });
    assert.match(refusal, /new confirm_token: [a-f0-9]+/);
    assert.match(
      refusal,
      /999/,
      'the fresh preview must show the CURRENT value',
    );

    const out = await call('sheet_update', {
      spreadsheet: ID,
      range: RANGE,
      values: [['1250000']],
      confirm_token: tokenIn(
        refusal.replace('new confirm_token', 'confirm_token'),
      ),
    });
    assert.match(out, /^WRITTEN/);
    assert.equal(cell, '1250000');
  });
});
