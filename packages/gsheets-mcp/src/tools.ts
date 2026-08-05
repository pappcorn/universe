// MCP tool registration. Tools are thin wrappers over core.ts: validate input,
// call one core function, format a human-readable result with A1 references
// always included so the model can chain calls (locate → info → find → read →
// update).
//
// ── EVERY WRITE IS TWO-PHASE. This is the load-bearing rule. ────────────────
// A write tool called WITHOUT `confirm_token` does not write. It reads what is
// in the target range today, shows the before/after, and returns a token. The
// assistant is expected to put that preview in front of the human; the human
// decides; only then does a second call carrying the token actually write.
//
// The token is a fingerprint of (file, range, CURRENT STATE, new values), so it
// does double duty:
//   · the human gate — no token, no write, enforced here rather than in prose;
//   · optimistic concurrency — if the sheet moved between the preview and the
//     confirmation, the fingerprint no longer matches and the write is refused
//     with a fresh preview. A shared finance sheet cannot be silently clobbered
//     by a stale confirmation, and a token cannot be replayed for a second
//     write, because the first write moves the state it was bound to.
//
// "Current state" differs by operation, and getting this right is the whole
// guarantee:
//   · update / batch_update — the values currently in the target range(s).
//   · append — overwrites nothing, so there is no prior grid. It binds to the
//     TABLE'S CURRENT HEIGHT instead. Binding to nothing (as an empty "before")
//     would leave the token a pure function of its own arguments: valid
//     forever, replayable, and blind to a concurrent append.
//
// There is deliberately no bypass flag. A connector that edits other people's
// spreadsheets should not ship one.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  DEFAULT_MAX_MATCHES,
  MAX_READ_CELLS,
  appendRows,
  batchRead,
  batchUpdate,
  columnLetter,
  editToken,
  find,
  getAccountInfo,
  getMeta,
  importXlsx,
  locate,
  logWrite,
  quoteSheetName,
  rangeAnchor,
  readRange,
  resolveSpreadsheetId,
  updateRange,
  usedRowCount,
  type BatchEdit,
  type Match,
  type RangeValues,
} from './core';

type TextResult = { content: Array<{ type: 'text'; text: string }> };

function ok(text: string): TextResult {
  return { content: [{ type: 'text', text }] };
}

function fail(err: unknown): TextResult {
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text', text: `ERROR: ${msg}` }] };
}

// ──────────────────────────────────────────────────────────────────────────────
// Formatters
// ──────────────────────────────────────────────────────────────────────────────

/** Render a grid as a row-numbered table so the model can address cells without
 *  a second lookup. `startRow` is the absolute row of the first line. */
function formatGrid(
  values: string[][],
  startRow: number,
  startCol: number
): string {
  if (values.length === 0) return '(empty range)';
  const width = Math.max(...values.map((r) => r.length));
  const header = ['     '];
  for (let c = 0; c < width; c++) header.push(columnLetter(startCol + c));
  const lines = [header.join(' | ')];
  values.forEach((row, i) => {
    const cells: string[] = [String(startRow + i).padStart(5)];
    for (let c = 0; c < width; c++) cells.push(row[c] ?? '');
    lines.push(cells.join(' | '));
  });
  return lines.join('\n');
}

function formatMatches(m: Match[]): string {
  return m
    .map(
      (x) =>
        `${x.a1}  (row ${x.row}, col ${columnLetter(x.column)})  ${x.value}`
    )
    .join('\n');
}

function cellCount(grid: string[][]): number {
  return grid.reduce((n, row) => n + row.length, 0);
}

/** The before/after a human is asked to approve. Truncated for display only —
 *  the token is computed over the FULL grids, never over this rendering. */
function formatDiff(
  range: string,
  before: string[][],
  after: string[][]
): string {
  const anchor = rangeAnchor(range);
  const cap = 12;
  const clip = (g: string[][]) => g.slice(0, cap);
  const more = Math.max(before.length, after.length) - cap;
  return [
    'BEFORE (what is in the sheet right now):',
    formatGrid(clip(before), anchor.row, anchor.col),
    '',
    'AFTER (what this write would leave):',
    formatGrid(clip(after), anchor.row, anchor.col),
    ...(more > 0
      ? [
          '',
          `(+${more} more rows — preview truncated, the write covers all of them)`,
        ]
      : []),
  ].join('\n');
}

const CONFIRM_INSTRUCTIONS =
  'This is a PREVIEW. Nothing has been written. Show the before/after above to the person ' +
  'you are working for, in their own words, and get an explicit yes. Then call this tool ' +
  'again with the SAME arguments plus confirm_token to actually write. Do not confirm on ' +
  'their behalf.';

// ──────────────────────────────────────────────────────────────────────────────
// Tool registration
// ──────────────────────────────────────────────────────────────────────────────

const spreadsheetArg = z
  .string()
  .describe(
    'Spreadsheet id, or any Google Sheets URL (https://docs.google.com/spreadsheets/d/<id>/...).'
  );

export function registerTools(server: McpServer): void {
  // ── whoami ────────────────────────────────────────────────────────────────
  server.registerTool(
    'sheet_whoami',
    {
      description:
        'Verify the credential: returns the Google account that granted the token — the account ' +
        "whose access this connector has, and the identity that will appear in a spreadsheet's " +
        'edit history. Never prints any credential field. Use this before any write session so ' +
        'the human knows who is about to edit.',
      inputSchema: {},
    },
    async () => {
      try {
        const who = await getAccountInfo();
        return ok(
          [
            `account: ${who.email}`,
            ...(who.displayName ? [`name:    ${who.displayName}`] : []),
            '',
            "Edits made through this connector are attributed to that account in Google's " +
              'revision history.',
          ].join('\n')
        );
      } catch (err) {
        return fail(err);
      }
    }
  );

  // ── locate ────────────────────────────────────────────────────────────────
  server.registerTool(
    'sheet_locate',
    {
      description:
        'Find spreadsheets by name among the files the signed-in account can already open ' +
        '(including ones shared with it). Returns ids, names and last-modified — no cell data, ' +
        'so it is cheap regardless of how big the files are. Use it when the human names a file ' +
        'instead of pasting a link.',
      inputSchema: {
        name: z
          .string()
          .min(1)
          .describe('Substring of the file name (case-insensitive).'),
        include_xlsx: z
          .boolean()
          .optional()
          .describe(
            'Also list .xlsx files. They CANNOT be read or edited directly — convert one first ' +
              'with sheet_import_xlsx. Default: false (native Google Sheets only).'
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Max results. Default 20.'),
      },
    },
    async ({ name, include_xlsx, limit }) => {
      try {
        const files = await locate(name, { includeXlsx: include_xlsx, limit });
        if (files.length === 0) return ok(`No spreadsheet matches "${name}".`);
        return ok(
          files
            .map((f) => {
              const kind = f.mimeType.endsWith('spreadsheet')
                ? 'Sheet'
                : 'XLSX (needs conversion)';
              return [
                `id:${f.id}  [${kind}]`,
                `  ${f.name}`,
                `  modified: ${f.modifiedTime ?? '?'}${
                  f.owners ? `  owner: ${f.owners}` : ''
                }`,
              ].join('\n');
            })
            .join('\n')
        );
      } catch (err) {
        return fail(err);
      }
    }
  );

  // ── info ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'sheet_info',
    {
      description:
        'The map of a spreadsheet: title, url, and every tab with its row/column counts and ' +
        'frozen-header count. Returns NO cell data, so it costs the same on a 40-row file and a ' +
        '400,000-row file. ALWAYS call this first on an unfamiliar spreadsheet — it tells you ' +
        'which tab and which ranges to aim at, so you never read more than you need.',
      inputSchema: { spreadsheet: spreadsheetArg },
    },
    async ({ spreadsheet }) => {
      try {
        const id = resolveSpreadsheetId(spreadsheet);
        const meta = await getMeta(id);
        return ok(
          [
            `title: ${meta.title}`,
            `id:    ${meta.spreadsheetId}`,
            `url:   ${meta.url}`,
            '',
            'tabs:',
            ...meta.tabs.map(
              (t) =>
                `  ${quoteSheetName(t.title)}  —  ${t.rowCount} rows × ${
                  t.columnCount
                } cols` +
                (t.frozenRowCount
                  ? `  (${t.frozenRowCount} frozen header row(s))`
                  : '')
            ),
            '',
            `Read limit: ${MAX_READ_CELLS} cells per call. To work a big tab, use sheet_find to ` +
              'locate the rows, then sheet_read just those.',
          ].join('\n')
        );
      } catch (err) {
        return fail(err);
      }
    }
  );

  // ── read ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'sheet_read',
    {
      description:
        `Read one or more A1 ranges. Hard-capped at ${MAX_READ_CELLS} cells per call — a range ` +
        'over the cap is refused, not truncated, so you always know what you got. Prefer narrow ' +
        'ranges: read the header row plus the rows sheet_find pointed you at, not the whole tab.',
      inputSchema: {
        spreadsheet: spreadsheetArg,
        ranges: z
          .union([z.string(), z.array(z.string())])
          .describe(
            'A1 range(s), e.g. "Movimientos!A1:H1" or ["Datos!A1:F1","Datos!A2043:F2043"]. ' +
              'Include the tab name when the file has more than one.'
          ),
        render: z
          .enum(['FORMATTED_VALUE', 'UNFORMATTED_VALUE', 'FORMULA'])
          .optional()
          .describe(
            'FORMATTED_VALUE (default) = what a human sees. UNFORMATTED_VALUE = raw numbers/dates, ' +
              'best for arithmetic. FORMULA = the formula text, best before editing a computed cell.'
          ),
      },
    },
    async ({ spreadsheet, ranges, render }) => {
      try {
        const id = resolveSpreadsheetId(spreadsheet);
        const list = Array.isArray(ranges) ? ranges : [ranges];
        const results: RangeValues[] =
          list.length === 1
            ? [await readRange(id, list[0], { render })]
            : await batchRead(id, list, { render });
        return ok(
          results
            .map((r) => {
              const anchor = rangeAnchor(r.range);
              return [
                `── ${r.range} ──`,
                formatGrid(r.values, anchor.row, anchor.col),
              ].join('\n');
            })
            .join('\n\n')
        );
      } catch (err) {
        return fail(err);
      }
    }
  );

  // ── find ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'sheet_find',
    {
      description:
        'Search a range for a value and get back ONLY where it matched (A1 references and row ' +
        'numbers) — not the rows themselves. The scan runs inside the connector, so searching ' +
        '50,000 rows costs about as much as searching 50. This is how you work a large ' +
        'spreadsheet: find the row, then sheet_read that one row, then edit it.',
      inputSchema: {
        spreadsheet: spreadsheetArg,
        range: z
          .string()
          .describe(
            'Where to search, A1. A whole tab ("Movimientos") or a column ("Movimientos!C:C") are ' +
              'both fine and both cheap — narrowing to the column you expect the value in is faster.'
          ),
        query: z.string().min(1).describe('The text to look for.'),
        exact: z
          .boolean()
          .optional()
          .describe(
            'Match the whole cell instead of a substring. Default: false (substring).'
          ),
        case_sensitive: z.boolean().optional().describe('Default: false.'),
        max_matches: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe(
            `Stop after this many hits. Default ${DEFAULT_MAX_MATCHES}.`
          ),
      },
    },
    async ({
      spreadsheet,
      range,
      query,
      exact,
      case_sensitive,
      max_matches,
    }) => {
      try {
        const id = resolveSpreadsheetId(spreadsheet);
        const res = await find(id, range, query, {
          exact,
          caseSensitive: case_sensitive,
          maxMatches: max_matches,
        });
        if (res.matches.length === 0) {
          return ok(
            `No match for "${query}" in ${range} (scanned ${res.scannedRows} rows).`
          );
        }
        return ok(
          [
            `${res.matches.length} match(es) for "${query}" in ${range} ` +
              `(scanned ${res.scannedRows} rows${
                res.truncated ? ', stopped at the cap' : ''
              }):`,
            '',
            formatMatches(res.matches),
            '',
            'Next: sheet_read the specific rows you need, then sheet_update them.',
          ].join('\n')
        );
      } catch (err) {
        return fail(err);
      }
    }
  );

  // ── update (two-phase) ────────────────────────────────────────────────────
  server.registerTool(
    'sheet_update',
    {
      description:
        'Overwrite an A1 range IN AN EXISTING spreadsheet — this is the tool for editing a file ' +
        'someone shared with you, rather than creating a new one. TWO-PHASE BY DESIGN: call it ' +
        'without confirm_token to get a before/after preview and a token, show that preview to ' +
        'the human, and only call again with the token once they say yes. The token also detects ' +
        'a concurrent edit: if the range changed since the preview, the write is refused rather ' +
        "than overwriting someone else's work.",
      inputSchema: {
        spreadsheet: spreadsheetArg,
        range: z
          .string()
          .describe(
            'The A1 range to overwrite, e.g. "Movimientos!D2043" or "Datos!B5:E5". Its shape must ' +
              'match the values grid.'
          ),
        values: z
          .array(z.array(z.string()))
          .describe(
            'Rows of cells, outer array = rows. A single cell is [["nuevo valor"]]. Values are ' +
              'interpreted as if typed by a user, so "=SUMA(A1:A9)" becomes a formula and "1.234,5" ' +
              'is parsed per the sheet locale — pass raw:true to store text verbatim instead.'
          ),
        confirm_token: z
          .string()
          .optional()
          .describe('The token from the preview call. Omit on the first call.'),
        raw: z
          .boolean()
          .optional()
          .describe(
            'Store values verbatim, without formula/number parsing. Default: false.'
          ),
      },
    },
    async ({ spreadsheet, range, values, confirm_token, raw }) => {
      try {
        const id = resolveSpreadsheetId(spreadsheet);
        const current = await readRange(id, range, {
          render: 'FORMULA',
          cap: Infinity,
        });
        const token = editToken(id, range, current.values, values);

        if (!confirm_token) {
          return ok(
            [
              `PREVIEW — sheet_update on ${range}`,
              '',
              formatDiff(range, current.values, values),
              '',
              `cells affected: ${cellCount(values)}`,
              `confirm_token: ${token}`,
              '',
              CONFIRM_INSTRUCTIONS,
            ].join('\n')
          );
        }
        if (confirm_token !== token) {
          return ok(
            [
              'REFUSED — the confirmation does not match the sheet as it stands now.',
              '',
              'Either the values changed since the preview, or someone else edited this range in ' +
                'the meantime. Nothing was written. Here is the CURRENT state:',
              '',
              formatDiff(range, current.values, values),
              '',
              `new confirm_token: ${token}`,
              '',
              'Show this fresh before/after to the human and get their yes again.',
            ].join('\n')
          );
        }

        const meta = await getMeta(id).catch(() => null);
        const result = await updateRange(id, range, values, { raw });
        const audit = logWrite({
          spreadsheetId: id,
          title: meta?.title,
          range: result.updatedRange,
          before: current.values,
          after: values,
          cells: result.updatedCells,
        });
        return ok(
          [
            `WRITTEN — ${result.updatedRange}`,
            `${result.updatedCells} cell(s) across ${result.updatedRows} row(s).`,
            audit.logged
              ? `logged to ${audit.path}`
              : `WARNING: could not write the audit log (${audit.error})`,
          ].join('\n')
        );
      } catch (err) {
        return fail(err);
      }
    }
  );

  // ── append (two-phase) ────────────────────────────────────────────────────
  server.registerTool(
    'sheet_append',
    {
      description:
        'Add rows after the last used row of a tab. Two-phase like sheet_update: preview first, ' +
        'then confirm with the token. Appending cannot overwrite existing data, but it still ' +
        'changes a file someone else owns, so the human still approves it. The token is bound ' +
        "to the table's current height, which means it is single-use — confirming appends once, " +
        'not once per call — and a concurrent append by someone else invalidates it.',
      inputSchema: {
        spreadsheet: spreadsheetArg,
        range: z
          .string()
          .describe(
            'The tab (or a range inside it) whose table to extend, e.g. "Movimientos" or ' +
              '"Movimientos!A:H". Google appends below the last row it finds there.'
          ),
        values: z
          .array(z.array(z.string()))
          .describe('Rows to add, outer array = rows.'),
        confirm_token: z
          .string()
          .optional()
          .describe('The token from the preview call. Omit on the first call.'),
        raw: z
          .boolean()
          .optional()
          .describe(
            'Store values verbatim, without formula/number parsing. Default: false.'
          ),
      },
    },
    async ({ spreadsheet, range, values, confirm_token, raw }) => {
      try {
        const id = resolveSpreadsheetId(spreadsheet);
        // An append overwrites nothing, so there is no prior grid to hash.
        // Anchor the token to how tall the table is RIGHT NOW instead: that
        // makes the token single-use (our own append moves the anchor) and
        // detects a concurrent append (someone else's moves it too).
        const height = await usedRowCount(id, range);
        const token = editToken(id, `append:${range}`, { height }, values);

        if (!confirm_token) {
          const anchor = rangeAnchor(range);
          return ok(
            [
              `PREVIEW — sheet_append to ${range}`,
              '',
              `${values.length} row(s) would be added after row ${height}:`,
              formatGrid(values.slice(0, 12), height + 1, anchor.col),
              ...(values.length > 12
                ? [`(+${values.length - 12} more rows)`]
                : []),
              '',
              `confirm_token: ${token}`,
              '',
              CONFIRM_INSTRUCTIONS,
            ].join('\n')
          );
        }
        if (confirm_token !== token) {
          return ok(
            [
              'REFUSED — the confirmation no longer matches this sheet. Nothing was written.',
              '',
              `The table is ${height} row(s) tall now. Either these are not the rows that were ` +
                'previewed, someone else appended in the meantime, or this confirmation was ' +
                'already used once.',
              '',
              `new confirm_token: ${token}`,
              '',
              'Re-run the preview, show the human what would land now, and get their yes again.',
            ].join('\n')
          );
        }

        const meta = await getMeta(id).catch(() => null);
        const result = await appendRows(id, range, values, { raw });
        const audit = logWrite({
          spreadsheetId: id,
          title: meta?.title,
          range: result.updatedRange,
          before: [],
          after: values,
          cells: result.updatedCells,
        });
        return ok(
          [
            `APPENDED — ${result.updatedRange}`,
            `${result.updatedRows} row(s), ${result.updatedCells} cell(s).`,
            audit.logged
              ? `logged to ${audit.path}`
              : `WARNING: could not write the audit log (${audit.error})`,
          ].join('\n')
        );
      } catch (err) {
        return fail(err);
      }
    }
  );

  // ── batch update (two-phase) ──────────────────────────────────────────────
  server.registerTool(
    'sheet_batch_update',
    {
      description:
        'Apply several range edits to one spreadsheet in a single atomic call — the right tool ' +
        'when you are correcting many scattered cells, since it is one confirmation and one ' +
        'round trip instead of N. Two-phase, with the same concurrency check as sheet_update ' +
        'applied across every range at once.',
      inputSchema: {
        spreadsheet: spreadsheetArg,
        edits: z
          .array(
            z.object({
              range: z.string().describe('A1 range for this edit.'),
              values: z
                .array(z.array(z.string()))
                .describe('Rows of cells for this range.'),
            })
          )
          .min(1)
          .describe('The edits to apply together.'),
        confirm_token: z
          .string()
          .optional()
          .describe('The token from the preview call. Omit on the first call.'),
        raw: z
          .boolean()
          .optional()
          .describe('Store values verbatim. Default: false.'),
      },
    },
    async ({ spreadsheet, edits, confirm_token, raw }) => {
      try {
        const id = resolveSpreadsheetId(spreadsheet);
        const befores = await batchRead(
          id,
          edits.map((e) => e.range),
          { render: 'FORMULA', cap: Infinity }
        );
        const beforeGrids = edits.map((e, i) => befores[i]?.values ?? []);
        const token = editToken(
          id,
          edits.map((e) => e.range).join('|'),
          beforeGrids,
          edits.map((e) => e.values)
        );

        if (!confirm_token) {
          return ok(
            [
              `PREVIEW — sheet_batch_update, ${edits.length} range(s)`,
              '',
              ...edits.map((e, i) =>
                [
                  `── ${e.range} ──`,
                  formatDiff(e.range, beforeGrids[i], e.values),
                  '',
                ].join('\n')
              ),
              `cells affected: ${edits.reduce(
                (n, e) => n + cellCount(e.values),
                0
              )}`,
              `confirm_token: ${token}`,
              '',
              CONFIRM_INSTRUCTIONS,
            ].join('\n')
          );
        }
        if (confirm_token !== token) {
          return ok(
            [
              'REFUSED — the confirmation does not match the sheet as it stands now. Nothing was ' +
                'written; one of these ranges changed since the preview.',
              '',
              ...edits.map((e, i) =>
                [
                  `── ${e.range} ──`,
                  formatDiff(e.range, beforeGrids[i], e.values),
                  '',
                ].join('\n')
              ),
              `new confirm_token: ${token}`,
            ].join('\n')
          );
        }

        const meta = await getMeta(id).catch(() => null);
        const payload: BatchEdit[] = edits.map((e) => ({
          range: e.range,
          values: e.values,
        }));
        const results = await batchUpdate(id, payload, { raw });
        const audits = results.map((r, i) =>
          logWrite({
            spreadsheetId: id,
            title: meta?.title,
            range: r.updatedRange,
            before: beforeGrids[i],
            after: edits[i].values,
            cells: r.updatedCells,
          })
        );
        const failedLogs = audits.filter((a) => !a.logged).length;
        return ok(
          [
            `WRITTEN — ${results.length} range(s)`,
            ...results.map(
              (r) => `  ${r.updatedRange}: ${r.updatedCells} cell(s)`
            ),
            failedLogs
              ? `WARNING: ${failedLogs} audit-log entr(ies) could not be written`
              : `logged to ${audits[0]?.path ?? '(no entries)'}`,
          ].join('\n')
        );
      } catch (err) {
        return fail(err);
      }
    }
  );

  // ── xlsx on-ramp ──────────────────────────────────────────────────────────
  server.registerTool(
    'sheet_import_xlsx',
    {
      description:
        'Convert an .xlsx file in Drive into a native Google Sheet, and return the new id. Every ' +
        'other tool here works ONLY on native Google Sheets — the Sheets API cannot open an .xlsx ' +
        'blob at all. The original .xlsx is left untouched: this makes a converted copy, so ' +
        'nobody loses the file they had. Do this ONCE per recurring file, then work the copy.',
      inputSchema: {
        file: z.string().describe('Drive file id or URL of the .xlsx.'),
        name: z
          .string()
          .optional()
          .describe(
            'Name for the converted Sheet. Default: the original name.'
          ),
        folder: z
          .string()
          .optional()
          .describe(
            "Drive folder id to put it in. Default: the account's My Drive root."
          ),
      },
    },
    async ({ file, name, folder }) => {
      try {
        const fileId = resolveSpreadsheetId(file);
        const created = await importXlsx(fileId, {
          name,
          parentFolderId: folder,
        });
        return ok(
          [
            `CONVERTED — "${created.name}"`,
            `id:  ${created.id}`,
            `url: ${created.url}`,
            '',
            'The original .xlsx was not modified. From here on, edit this Sheet id — and if the ' +
              'file is one the team refreshes regularly, agree with them that the Sheet is now ' +
              'the live copy, so edits do not get lost on the next .xlsx upload.',
          ].join('\n')
        );
      } catch (err) {
        return fail(err);
      }
    }
  );
}
