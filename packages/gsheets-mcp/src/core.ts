// Google Sheets + Drive API client. The single place that knows how to talk to
// Google. No auth code here (that's auth.ts), no presentation code (that's
// tools.ts). Just typed functions over the endpoints we use.
//
// ── THE DESIGN CONTRACT: cost is a function of what you ASK FOR, never of how
// big the spreadsheet is. ────────────────────────────────────────────────────
// A 40,000-row sheet and a 40-row sheet cost the same to inspect and the same
// to edit. Three rules make that true:
//
//   1. Metadata never returns cell data. `getMeta` asks Google for the
//      `sheets.properties` field mask only — tab names and grid dimensions come
//      back, values do not.
//   2. Reads are range-scoped and hard-capped. There is deliberately no
//      "read the whole spreadsheet" function to call by accident.
//   3. Search scans IN THIS PROCESS, not in the model's context. `find` pulls
//      the search range over HTTP, scans it in JS, and returns only the matching
//      cell coordinates. The 40,000 rows pass through Node and are discarded;
//      what reaches the caller is a handful of A1 references.
//
// The intended loop is find → read that one row → write that one row.
//
// ── THE GOOGLE ERROR SHAPE ──────────────────────────────────────────────────
// Google APIs put failures in the HTTP status plus a JSON `error` body
// ({ error: { code, message, status } }). Every call routes through `callGoogle`,
// which throws a SheetsApiError carrying the status and Google's message, so
// callers can rely on try/catch.

import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

import { authHeaders } from './auth';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3/files';

export const SPREADSHEET_MIME = 'application/vnd.google-apps.spreadsheet';
export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Hard ceiling on cells returned by a single read, so one call can't blow up a
 *  context window. Callers asking for more get a clear error, not a silent cut. */
export const MAX_READ_CELLS = 5000;
/** Ceiling on cells `find` will pull INTO THIS PROCESS while scanning. Two
 *  orders of magnitude above the caller-facing cap, because none of it reaches
 *  the model — but bounded, so a pathological sheet cannot exhaust memory. */
export const MAX_SCAN_CELLS = 2_000_000;
/** Default ceiling on matches returned by `find`. */
export const DEFAULT_MAX_MATCHES = 50;

export class SheetsApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'SheetsApiError';
    this.status = status;
  }
}

async function callGoogle<T>(
  url: string,
  init: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  const headers = await authHeaders({
    ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...init.headers,
  });
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  if (!res.ok) {
    const raw = await res.text();
    let message = raw;
    try {
      message =
        (JSON.parse(raw) as { error?: { message?: string } }).error?.message ??
        raw;
    } catch {
      // non-JSON error body — keep the raw text
    }
    if (res.status === 403) {
      message +=
        ' (403 usually means the signed-in account does not have edit access to this file, ' +
        'or the Sheets/Drive API is not enabled on your Google Cloud project)';
    }
    if (res.status === 404) {
      message +=
        ' (404 usually means the spreadsheet id is wrong, or the file was never shared with ' +
        'the signed-in account)';
    }
    throw new SheetsApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ──────────────────────────────────────────────────────────────────────────────
// Ids and A1 notation
// ──────────────────────────────────────────────────────────────────────────────

/** Accept a bare id, or any Google URL a human is likely to paste. */
export function resolveSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  const fromUrl = /\/(?:spreadsheets|file)\/d\/([a-zA-Z0-9_-]{20,})/.exec(
    trimmed,
  );
  if (fromUrl) return fromUrl[1];
  const openById = /[?&]id=([a-zA-Z0-9_-]{20,})/.exec(trimmed);
  if (openById) return openById[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) return trimmed;
  throw new SheetsApiError(
    400,
    `"${input}" is not a spreadsheet id or a Google Sheets URL. Pass the id, or the full ` +
      'https://docs.google.com/spreadsheets/d/<id>/... link.',
  );
}

/** 1 → A, 27 → AA. Column indexes are 1-based, like the A1 grid itself. */
export function columnLetter(index: number): string {
  let n = index;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Quote a tab name for A1 notation when it needs it ("Q3 2026" → 'Q3 2026'). */
export function quoteSheetName(name: string): string {
  return /^[A-Za-z0-9_]+$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

/** Parse the top-left anchor of an A1 range so `find` can report absolute
 *  coordinates even when the caller searched a sub-range. */
export function rangeAnchor(range: string): { row: number; col: number } {
  const body = range.includes('!')
    ? range.slice(range.lastIndexOf('!') + 1)
    : range;
  const m = /^\$?([A-Za-z]*)\$?(\d*)/.exec(body);
  const letters = m?.[1] ?? '';
  const digits = m?.[2] ?? '';
  let col = 0;
  for (const ch of letters.toUpperCase())
    col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: digits ? Number(digits) : 1, col: col || 1 };
}

// ──────────────────────────────────────────────────────────────────────────────
// Metadata — cheap at any file size (no cell data crosses the wire)
// ──────────────────────────────────────────────────────────────────────────────

export interface TabInfo {
  sheetId: number;
  title: string;
  index: number;
  rowCount: number;
  columnCount: number;
  frozenRowCount: number;
}

export interface SpreadsheetMeta {
  spreadsheetId: string;
  title: string;
  url: string;
  tabs: TabInfo[];
}

export async function getMeta(spreadsheetId: string): Promise<SpreadsheetMeta> {
  const fields =
    'spreadsheetId,properties.title,spreadsheetUrl,' +
    'sheets.properties(sheetId,title,index,gridProperties(rowCount,columnCount,frozenRowCount))';
  const data = await callGoogle<{
    spreadsheetId: string;
    spreadsheetUrl?: string;
    properties?: { title?: string };
    sheets?: Array<{
      properties?: {
        sheetId?: number;
        title?: string;
        index?: number;
        gridProperties?: {
          rowCount?: number;
          columnCount?: number;
          frozenRowCount?: number;
        };
      };
    }>;
  }>(`${SHEETS_BASE}/${spreadsheetId}?fields=${encodeURIComponent(fields)}`);

  return {
    spreadsheetId: data.spreadsheetId,
    title: data.properties?.title ?? '(untitled)',
    url:
      data.spreadsheetUrl ??
      `https://docs.google.com/spreadsheets/d/${data.spreadsheetId}/edit`,
    tabs: (data.sheets ?? []).map((s) => ({
      sheetId: s.properties?.sheetId ?? 0,
      title: s.properties?.title ?? '',
      index: s.properties?.index ?? 0,
      rowCount: s.properties?.gridProperties?.rowCount ?? 0,
      columnCount: s.properties?.gridProperties?.columnCount ?? 0,
      frozenRowCount: s.properties?.gridProperties?.frozenRowCount ?? 0,
    })),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Reads
// ──────────────────────────────────────────────────────────────────────────────

export type ValueRender = 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA';

export interface RangeValues {
  range: string;
  values: string[][];
}

/** Fetch a range. `cap` guards the CALLER's budget; pass Infinity for internal
 *  scans (find), which never hand the rows onward. */
export async function readRange(
  spreadsheetId: string,
  range: string,
  opts: { render?: ValueRender; cap?: number } = {},
): Promise<RangeValues> {
  const render = opts.render ?? 'FORMATTED_VALUE';
  const url =
    `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}` +
    `?majorDimension=ROWS&valueRenderOption=${render}`;
  const data = await callGoogle<{ range?: string; values?: string[][] }>(url);
  const values = (data.values ?? []).map((row) =>
    row.map((c) => (c === undefined ? '' : String(c))),
  );

  const cap = opts.cap ?? MAX_READ_CELLS;
  const cells = values.reduce((n, row) => n + row.length, 0);
  if (cells > cap) {
    throw new SheetsApiError(
      400,
      `That range holds ${cells} cells, over the ${cap}-cell read limit. This limit exists so a ` +
        'single read cannot flood the context. Narrow the range, or use sheet_find to locate the ' +
        'rows you actually need and read only those.',
    );
  }
  return { range: data.range ?? range, values };
}

/** Several ranges in one round trip. Same per-call cell cap, applied to the total. */
export async function batchRead(
  spreadsheetId: string,
  ranges: string[],
  opts: { render?: ValueRender; cap?: number } = {},
): Promise<RangeValues[]> {
  const render = opts.render ?? 'FORMATTED_VALUE';
  const qs = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&');
  const url =
    `${SHEETS_BASE}/${spreadsheetId}/values:batchGet?${qs}` +
    `&majorDimension=ROWS&valueRenderOption=${render}`;
  const data = await callGoogle<{
    valueRanges?: Array<{ range?: string; values?: string[][] }>;
  }>(url);
  const out = (data.valueRanges ?? []).map((vr, i) => ({
    range: vr.range ?? ranges[i],
    values: (vr.values ?? []).map((row) =>
      row.map((c) => (c === undefined ? '' : String(c))),
    ),
  }));
  const cells = out.reduce(
    (n, vr) => n + vr.values.reduce((m, row) => m + row.length, 0),
    0,
  );
  const cap = opts.cap ?? MAX_READ_CELLS;
  if (cells > cap) {
    throw new SheetsApiError(
      400,
      `Those ranges hold ${cells} cells in total, over the ${cap}-cell read limit. ` +
        'Narrow them, or locate the rows with sheet_find first.',
    );
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────────
// Find — the reason big files stop being expensive
// ──────────────────────────────────────────────────────────────────────────────

export interface Match {
  row: number;
  column: number;
  a1: string;
  value: string;
}

/** Scan a range for a value and return only WHERE it matched. The scanned rows
 *  are read into this process and dropped here; they never reach the caller. */
export async function find(
  spreadsheetId: string,
  range: string,
  query: string,
  opts: { exact?: boolean; caseSensitive?: boolean; maxMatches?: number } = {},
): Promise<{ matches: Match[]; scannedRows: number; truncated: boolean }> {
  const maxMatches = opts.maxMatches ?? DEFAULT_MAX_MATCHES;
  const needle = opts.caseSensitive ? query : query.toLowerCase();
  // Far above the caller-facing MAX_READ_CELLS — this data does NOT flow
  // outward, so the model's budget doesn't apply. But it is still a ceiling:
  // without one, a pathological sheet could OOM the server process.
  const { values } = await readRange(spreadsheetId, range, {
    render: 'UNFORMATTED_VALUE',
    cap: MAX_SCAN_CELLS,
  });

  const anchor = rangeAnchor(range);
  const sheetPrefix = range.includes('!')
    ? range.slice(0, range.lastIndexOf('!') + 1)
    : '';
  const matches: Match[] = [];
  let truncated = false;

  for (let r = 0; r < values.length && !truncated; r++) {
    const row = values[r];
    for (let c = 0; c < row.length; c++) {
      const raw = row[c];
      const hay = opts.caseSensitive ? raw : raw.toLowerCase();
      const hit = opts.exact ? hay === needle : hay.includes(needle);
      if (!hit) continue;
      const absRow = anchor.row + r;
      const absCol = anchor.col + c;
      matches.push({
        row: absRow,
        column: absCol,
        a1: `${sheetPrefix}${columnLetter(absCol)}${absRow}`,
        value: raw.length > 120 ? `${raw.slice(0, 117)}...` : raw,
      });
      if (matches.length >= maxMatches) {
        truncated = true;
        break;
      }
    }
  }
  return { matches, scannedRows: values.length, truncated };
}

// ──────────────────────────────────────────────────────────────────────────────
// Writes — always two-phase (see tools.ts for the gate)
// ──────────────────────────────────────────────────────────────────────────────

/** Stable fingerprint of "this exact edit, applied to this exact prior state".
 *  Phase 1 issues it; phase 2 recomputes it. If anyone changed the target range
 *  in between, the fingerprint no longer matches and the write is refused —
 *  optimistic concurrency, so a lola can never silently clobber a human's edit. */
// `before`/`after` are the grids being compared — a single grid for one range,
// or the array of grids for a batch. Anything JSON-serializable works; what
// matters is that phase 1 and phase 2 hash the exact same shape.
export function editToken(
  spreadsheetId: string,
  range: string,
  before: unknown,
  after: unknown,
): string {
  const payload = JSON.stringify({ spreadsheetId, range, before, after });
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

/** How tall the target tab's table is right now — the "before" state an APPEND
 *  has to be fingerprinted against.
 *
 *  An append overwrites nothing, so there is no prior grid to hash. Without an
 *  anchor its token would be a pure function of its own arguments, which breaks
 *  the gate in two ways: a token stays valid forever (so one human "yes" could
 *  be replayed to append the same rows again and again), and a concurrent
 *  append goes undetected. Anchoring to the table's height fixes both — our own
 *  append changes it, and so does anyone else's.
 *
 *  It reads column A only, so it stays cheap on a huge tab. That is also its
 *  limit, and it is worth stating plainly: the anchor is the used height of
 *  column A, so a table whose first column is sparse gives a weaker signal. For
 *  append targets — tables with a populated first column — it is exact. */
export async function usedRowCount(
  spreadsheetId: string,
  range: string,
): Promise<number> {
  const tab = range.includes('!')
    ? range.slice(0, range.lastIndexOf('!'))
    : range;
  // A bare "A:H" is a range, not a tab name; anything else is the tab.
  const looksLikeBareRange =
    /^\$?[A-Za-z]{1,3}(\$?\d+)?(:\$?[A-Za-z]{1,3}(\$?\d+)?)?$/.test(tab);
  const probe = looksLikeBareRange ? 'A:A' : `${tab}!A:A`;
  const { values } = await readRange(spreadsheetId, probe, {
    render: 'UNFORMATTED_VALUE',
    cap: MAX_SCAN_CELLS,
  });
  return values.length;
}

export interface WriteResult {
  updatedRange: string;
  updatedRows: number;
  updatedColumns: number;
  updatedCells: number;
}

export async function updateRange(
  spreadsheetId: string,
  range: string,
  values: string[][],
  opts: { raw?: boolean } = {},
): Promise<WriteResult> {
  const valueInputOption = opts.raw ? 'RAW' : 'USER_ENTERED';
  const url =
    `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}` +
    `?valueInputOption=${valueInputOption}&includeValuesInResponse=false`;
  const data = await callGoogle<{
    updatedRange?: string;
    updatedRows?: number;
    updatedColumns?: number;
    updatedCells?: number;
  }>(url, { method: 'PUT', body: { range, majorDimension: 'ROWS', values } });
  return {
    updatedRange: data.updatedRange ?? range,
    updatedRows: data.updatedRows ?? values.length,
    updatedColumns: data.updatedColumns ?? values[0]?.length ?? 0,
    updatedCells: data.updatedCells ?? 0,
  };
}

export async function appendRows(
  spreadsheetId: string,
  range: string,
  values: string[][],
  opts: { raw?: boolean } = {},
): Promise<WriteResult> {
  const valueInputOption = opts.raw ? 'RAW' : 'USER_ENTERED';
  const url =
    `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(
      range,
    )}:append` +
    `?valueInputOption=${valueInputOption}&insertDataOption=INSERT_ROWS`;
  const data = await callGoogle<{
    updates?: {
      updatedRange?: string;
      updatedRows?: number;
      updatedColumns?: number;
      updatedCells?: number;
    };
  }>(url, { method: 'POST', body: { range, majorDimension: 'ROWS', values } });
  const u = data.updates ?? {};
  return {
    updatedRange: u.updatedRange ?? range,
    updatedRows: u.updatedRows ?? values.length,
    updatedColumns: u.updatedColumns ?? values[0]?.length ?? 0,
    updatedCells: u.updatedCells ?? 0,
  };
}

export interface BatchEdit {
  range: string;
  values: string[][];
}

export async function batchUpdate(
  spreadsheetId: string,
  edits: BatchEdit[],
  opts: { raw?: boolean } = {},
): Promise<WriteResult[]> {
  const valueInputOption = opts.raw ? 'RAW' : 'USER_ENTERED';
  const data = await callGoogle<{
    responses?: Array<{
      updatedRange?: string;
      updatedRows?: number;
      updatedColumns?: number;
      updatedCells?: number;
    }>;
  }>(`${SHEETS_BASE}/${spreadsheetId}/values:batchUpdate`, {
    method: 'POST',
    body: {
      valueInputOption,
      data: edits.map((e) => ({
        range: e.range,
        majorDimension: 'ROWS',
        values: e.values,
      })),
    },
  });
  return (data.responses ?? []).map((r, i) => ({
    updatedRange: r.updatedRange ?? edits[i].range,
    updatedRows: r.updatedRows ?? edits[i].values.length,
    updatedColumns: r.updatedColumns ?? edits[i].values[0]?.length ?? 0,
    updatedCells: r.updatedCells ?? 0,
  }));
}

// ──────────────────────────────────────────────────────────────────────────────
// Audit log — every committed write, on disk, locally
// ──────────────────────────────────────────────────────────────────────────────

const LOG_DIR =
  process.env.GSHEETS_MCP_LOG_DIR ||
  `${homedir()}/.local/state/pappcorn-gsheets-mcp`;
const LOG_PATH = `${LOG_DIR}/writes.jsonl`;

/** Append-only record of what was changed, so a write is always answerable
 *  after the fact. Best-effort: a failure to log never fails the write, but it
 *  is surfaced to the caller rather than swallowed. */
export function logWrite(entry: {
  spreadsheetId: string;
  title?: string;
  range: string;
  before: string[][];
  after: string[][];
  cells: number;
}): { logged: boolean; path: string; error?: string } {
  const trim = (grid: string[][]) =>
    grid
      .slice(0, 20)
      .map((row) =>
        row
          .slice(0, 20)
          .map((c) => (c.length > 200 ? `${c.slice(0, 197)}...` : c)),
      );
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(
      LOG_PATH,
      `${JSON.stringify({
        at: new Date().toISOString(),
        spreadsheetId: entry.spreadsheetId,
        title: entry.title,
        range: entry.range,
        cells: entry.cells,
        before: trim(entry.before),
        after: trim(entry.after),
      })}\n`,
      { mode: 0o600 },
    );
    return { logged: true, path: LOG_PATH };
  } catch (err) {
    return {
      logged: false,
      path: LOG_PATH,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Drive — locating spreadsheets, and the .xlsx on-ramp
// ──────────────────────────────────────────────────────────────────────────────

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  owners?: string;
  url: string;
}

/** Escape a value for Drive's query language, which delimits strings with `'`
 *  and uses `\` as its escape character.
 *
 *  ORDER MATTERS: backslashes first, then quotes. Escaping quotes first would
 *  leave an attacker-supplied `\` free to escape the backslash we just added,
 *  so `x\' or '1'='1` would break out of the string literal. */
export function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export async function locate(
  nameQuery: string,
  opts: { includeXlsx?: boolean; limit?: number } = {},
): Promise<DriveFile[]> {
  const mimeClause = opts.includeXlsx
    ? `(mimeType='${SPREADSHEET_MIME}' or mimeType='${XLSX_MIME}')`
    : `mimeType='${SPREADSHEET_MIME}'`;
  const q = `${mimeClause} and name contains '${escapeDriveQuery(
    nameQuery,
  )}' and trashed=false`;
  const params = new URLSearchParams({
    q,
    pageSize: String(opts.limit ?? 20),
    fields:
      'files(id,name,mimeType,modifiedTime,owners(emailAddress),webViewLink)',
    orderBy: 'modifiedTime desc',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });
  const data = await callGoogle<{
    files?: Array<{
      id: string;
      name: string;
      mimeType: string;
      modifiedTime?: string;
      owners?: Array<{ emailAddress?: string }>;
      webViewLink?: string;
    }>;
  }>(`${DRIVE_BASE}?${params.toString()}`);
  return (data.files ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    modifiedTime: f.modifiedTime,
    owners: f.owners
      ?.map((o) => o.emailAddress)
      .filter(Boolean)
      .join(', '),
    url: f.webViewLink ?? `https://docs.google.com/spreadsheets/d/${f.id}/edit`,
  }));
}

export async function getFileMeta(fileId: string): Promise<DriveFile> {
  const params = new URLSearchParams({
    fields: 'id,name,mimeType,modifiedTime,owners(emailAddress),webViewLink',
    supportsAllDrives: 'true',
  });
  const f = await callGoogle<{
    id: string;
    name: string;
    mimeType: string;
    modifiedTime?: string;
    owners?: Array<{ emailAddress?: string }>;
    webViewLink?: string;
  }>(`${DRIVE_BASE}/${fileId}?${params.toString()}`);
  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    modifiedTime: f.modifiedTime,
    owners: f.owners
      ?.map((o) => o.emailAddress)
      .filter(Boolean)
      .join(', '),
    url: f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view`,
  };
}

/** Convert an .xlsx living in Drive into a native Google Sheet, by copying it
 *  with a converting mimeType. The original .xlsx is left untouched — this is
 *  the honest on-ramp, not an in-place migration, so nobody loses the file they
 *  had. Everything else in this connector only works on native Sheets. */
export async function importXlsx(
  fileId: string,
  opts: { name?: string; parentFolderId?: string } = {},
): Promise<DriveFile> {
  const source = await getFileMeta(fileId);
  if (source.mimeType === SPREADSHEET_MIME) {
    throw new SheetsApiError(
      400,
      `"${source.name}" is already a native Google Sheet — no conversion needed. Use its id directly.`,
    );
  }
  if (source.mimeType !== XLSX_MIME) {
    throw new SheetsApiError(
      400,
      `"${source.name}" is ${source.mimeType}, not an .xlsx. Only .xlsx files can be converted here.`,
    );
  }
  const params = new URLSearchParams({
    fields: 'id,name,mimeType,modifiedTime,webViewLink',
    supportsAllDrives: 'true',
  });
  const body: Record<string, unknown> = {
    name: opts.name ?? source.name.replace(/\.xlsx$/i, ''),
    mimeType: SPREADSHEET_MIME,
  };
  if (opts.parentFolderId) body.parents = [opts.parentFolderId];
  const f = await callGoogle<{
    id: string;
    name: string;
    mimeType: string;
    modifiedTime?: string;
    webViewLink?: string;
  }>(`${DRIVE_BASE}/${fileId}/copy?${params.toString()}`, {
    method: 'POST',
    body,
  });
  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    modifiedTime: f.modifiedTime,
    url: f.webViewLink ?? `https://docs.google.com/spreadsheets/d/${f.id}/edit`,
  };
}

/** Who the refresh token belongs to. Used by the whoami tool to prove which
 *  account is about to write, before anyone lets it write. */
export async function getAccountInfo(): Promise<{
  email: string;
  displayName?: string;
}> {
  const data = await callGoogle<{
    user?: { emailAddress?: string; displayName?: string };
  }>(
    'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)',
  );
  return {
    email: data.user?.emailAddress ?? '(unknown)',
    displayName: data.user?.displayName,
  };
}
