// Typed operations on Apple Reminders, over the JXA bridge (jxa.ts).
//
// Everything runs on THIS Mac, through `osascript`, against the Reminders app
// the person already uses. Nothing leaves the machine and nothing is logged:
// reminder titles and notes are personal, so they appear only in tool results.
//
// The runner is injectable so tests never touch a real Reminders database.

import { execFile } from 'node:child_process';

import { loadConfig } from './config';
import {
  boundMs,
  DateInputError,
  formatDay,
  formatLocal,
  isLocalMidnight,
  parseWhen,
  sameLocalDay,
  syncSystemTimeZone,
  type When,
} from './dates';
import { JXA_SCRIPT } from './jxa';

// ── Running osascript ───────────────────────────────────────────────────────

export interface RunResult {
  stdout: string;
  stderr: string;
  /** Exit code; null when the process was killed. */
  code: number | null;
  timedOut: boolean;
}

export type Runner = (
  file: string,
  args: string[],
  timeoutMs: number,
) => Promise<RunResult>;

export const execRunner: Runner = (file, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        const e = err as
          (NodeJS.ErrnoException & { killed?: boolean; code?: unknown }) | null;
        resolve({
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          code: e ? (typeof e.code === 'number' ? e.code : null) : 0,
          timedOut: Boolean(e?.killed),
        });
      },
    );
  });

let runner: Runner = execRunner;
let sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
let platform: string = process.platform;
/** Where the system zone comes from. Tests swap it so the suite's pinned zone
 *  is never overwritten by the zone of the machine running it. */
let systemZone: (() => string | null) | null = null;

/** Tests only: swap the osascript runner (and pretend to be on macOS, so the
 *  suite runs on any CI). Returns a function that restores the real ones. */
export function useFakeRunner(
  r: Runner,
  zone: () => string | null = () => null,
): () => void {
  const prev = { runner, sleep, platform, systemZone };
  runner = r;
  sleep = async () => {};
  platform = 'darwin';
  systemZone = zone;
  return () => {
    ({ runner, sleep, platform, systemZone } = prev);
  };
}

export class RemindersError extends Error {
  constructor(
    message: string,
    readonly kind:
      | 'permission'
      | 'timeout'
      | 'not-macos'
      | 'not-found'
      | 'input'
      | 'reminders' = 'reminders',
  ) {
    super(message);
  }
}

const PERMISSION_HELP =
  'macOS has not allowed this connector to use Reminders. Open System Settings → ' +
  'Privacy & Security → Automation, find the app that runs the connector (Claude, or ' +
  'your terminal app if you use Claude Code), and switch on "Reminders" under it. ' +
  'If it is not listed, quit and reopen that app and try again so macOS asks.';

const NOT_RUNNING = [-609, -600];

interface Envelope {
  ok: boolean;
  data?: unknown;
  error?: string;
  number?: number;
  code?: string;
}

function errorNumberIn(text: string): number | undefined {
  const m = /\((-?\d+)\)\s*$/m.exec(text.trim());
  return m ? Number(m[1]) : undefined;
}

async function runOnce(payload: object): Promise<Envelope> {
  const cfg = loadConfig();
  const res = await runner(
    cfg.osascript,
    ['-l', 'JavaScript', '-e', JXA_SCRIPT, JSON.stringify(payload)],
    cfg.timeoutMs,
  );
  if (res.timedOut)
    throw new RemindersError(
      `Reminders did not answer within ${Math.round(cfg.timeoutMs / 1000)} s. ` +
        'If macOS is showing a permission prompt, answer it and try again. ' +
        'Large lists are slow: filter by list and status.',
      'timeout',
    );
  const out = res.stdout.trim();
  if (res.code === 0 && out) {
    try {
      return JSON.parse(out) as Envelope;
    } catch {
      throw new RemindersError('Reminders returned something unreadable.');
    }
  }
  // osascript itself failed (the script never ran, or crashed before replying).
  const msg = res.stderr.trim() || `osascript exited with code ${res.code}`;
  return { ok: false, error: msg, number: errorNumberIn(msg) };
}

async function launchReminders(): Promise<void> {
  const cfg = loadConfig();
  await runner(
    cfg.osascript,
    ['-e', 'tell application "Reminders" to launch'],
    cfg.timeoutMs,
  );
  await sleep(1500);
}

function isNotRunning(e: Envelope): boolean {
  return (
    (e.number !== undefined && NOT_RUNNING.includes(e.number)) ||
    /connection is invalid|isn.t running/i.test(e.error ?? '')
  );
}

/** Run one operation. Retries once after launching Reminders when the app is
 *  not running (error -609 "Connection is invalid", or -600). */
/** Run before anything turns a date into text or text into a date: the Mac may
 *  have changed zone since this process started. Cheap (one readlink). */
function syncZone(): void {
  if (systemZone) syncSystemTimeZone(systemZone);
  else syncSystemTimeZone();
}

export async function call<T>(payload: object): Promise<T> {
  if (platform !== 'darwin')
    throw new RemindersError(
      'This connector only works on macOS.',
      'not-macos',
    );
  syncZone();
  let env = await runOnce(payload);
  if (!env.ok && isNotRunning(env)) {
    await launchReminders();
    env = await runOnce(payload);
  }
  if (env.ok) return env.data as T;
  if (
    env.number === -1743 ||
    env.number === -1744 ||
    /not authori[sz]ed/i.test(env.error ?? '')
  )
    throw new RemindersError(PERMISSION_HELP, 'permission');
  if (
    env.code === 'NO_LIST' ||
    env.code === 'NO_REMINDER' ||
    env.code === 'AMBIGUOUS_LIST'
  )
    throw new RemindersError(env.error ?? 'Not found.', 'not-found');
  throw new RemindersError(
    `Reminders refused: ${env.error ?? 'unknown error'}`,
  );
}

// ── Shapes ──────────────────────────────────────────────────────────────────

export type Priority = 'none' | 'high' | 'medium' | 'low';

const PRIORITY_VALUE: Record<Priority, number> = {
  none: 0,
  high: 1,
  medium: 5,
  low: 9,
};

export function priorityLabel(n: number | null | undefined): Priority {
  if (!n) return 'none';
  if (n <= 4) return 'high';
  if (n === 5) return 'medium';
  return 'low';
}

export interface ListInfo {
  id: string;
  name: string;
  open: number;
  isDefault: boolean;
}

interface RawReminder {
  id: string;
  name: string;
  body: string | null;
  completed: boolean;
  completionDate: string | null;
  dueDate: string | null;
  alldayDueDate: string | null;
  remindMeDate: string | null;
  priority: number;
  creationDate: string | null;
  list?: { id: string; name: string };
}

export interface Reminder {
  id: string;
  title: string;
  notes: string | null;
  completed: boolean;
  completedAt: string | null;
  /** "YYYY-MM-DD" when all-day, local date-time with offset otherwise. */
  due: string | null;
  allDay: boolean;
  priority: Priority;
  createdAt: string | null;
  list: { id: string; name: string };
  /** Epoch ms of the due moment (local midnight for all-day), for sorting. */
  dueMs: number | null;
}

function toReminder(
  r: RawReminder,
  list: { id: string; name: string },
): Reminder {
  const dueMs = r.dueDate ? Date.parse(r.dueDate) : null;
  const allDay = dueMs !== null && isLocalMidnight(dueMs);
  return {
    id: r.id,
    title: r.name,
    notes: r.body ? r.body : null,
    completed: r.completed,
    completedAt: r.completionDate
      ? formatLocal(Date.parse(r.completionDate))
      : null,
    due: dueMs === null ? null : allDay ? formatDay(dueMs) : formatLocal(dueMs),
    allDay,
    priority: priorityLabel(r.priority),
    createdAt: r.creationDate ? formatLocal(Date.parse(r.creationDate)) : null,
    list: r.list ?? list,
    dueMs,
  };
}

// ── Operations ──────────────────────────────────────────────────────────────

export async function listLists(): Promise<ListInfo[]> {
  return call<ListInfo[]>({ op: 'lists' });
}

export type Status = 'incomplete' | 'completed' | 'all';

export interface ListRemindersInput {
  list: string;
  status?: Status;
  dueBefore?: string;
  dueAfter?: string;
  limit?: number;
}

export interface ListRemindersResult {
  list: { id: string; name: string };
  reminders: Reminder[];
  /** Matches before `limit` was applied. */
  matched: number;
}

function parseOrInputError(s: string, field: string): When {
  try {
    return parseWhen(s, field);
  } catch (e) {
    if (e instanceof DateInputError)
      throw new RemindersError(e.message, 'input');
    throw e;
  }
}

export async function listReminders(
  input: ListRemindersInput,
): Promise<ListRemindersResult> {
  syncZone();
  const after = input.dueAfter
    ? boundMs(parseOrInputError(input.dueAfter, 'due_after'))
    : null;
  const before = input.dueBefore
    ? boundMs(parseOrInputError(input.dueBefore, 'due_before'))
    : null;
  const limit = Math.max(1, Math.min(input.limit ?? 50, 500));
  const raw = await call<{
    list: { id: string; name: string };
    reminders: RawReminder[];
  }>({
    op: 'reminders',
    list: input.list,
    status: input.status ?? 'incomplete',
  });
  let rows = raw.reminders.map((r) => toReminder(r, raw.list));
  if (after !== null || before !== null) {
    rows = rows.filter(
      (r) =>
        r.dueMs !== null &&
        (after === null || r.dueMs >= after) &&
        (before === null || r.dueMs < before),
    );
  }
  rows.sort((a, b) => {
    if (a.dueMs !== b.dueMs) {
      if (a.dueMs === null) return 1;
      if (b.dueMs === null) return -1;
      return a.dueMs - b.dueMs;
    }
    return a.title.localeCompare(b.title);
  });
  return {
    list: raw.list,
    reminders: rows.slice(0, limit),
    matched: rows.length,
  };
}

interface Fields {
  name?: string;
  body?: string;
  priority?: number;
  dueMs?: number;
  dueDay?: [number, number, number];
  completed?: boolean;
}

/** Turn `due` and `remind_at` into the ONE date Reminders keeps.
 *
 *  In current Reminders the due date and the remind-me date are a single
 *  value: setting either one moves both. So `remind_at` is accepted as the
 *  time of the alert, and refused only when it contradicts `due`. */
export function resolveWhen(
  due?: string,
  remindAt?: string,
): Pick<Fields, 'dueMs' | 'dueDay'> {
  const d = due ? parseOrInputError(due, 'due') : undefined;
  const r = remindAt ? parseOrInputError(remindAt, 'remind_at') : undefined;
  if (r && r.kind === 'day')
    throw new RemindersError(
      'remind_at needs a time (YYYY-MM-DDTHH:MM). For a whole day with no time, use due alone.',
      'input',
    );
  if (!d && !r) return {};
  if (d && !r)
    return d.kind === 'day' ? { dueDay: [d.y, d.m, d.d] } : { dueMs: d.ms };
  if (!d && r && r.kind === 'instant') return { dueMs: r.ms };
  if (d && r && r.kind === 'instant') {
    if (d.kind === 'day' && sameLocalDay(r.ms, d)) return { dueMs: r.ms };
    if (d.kind === 'instant' && d.ms === r.ms) return { dueMs: r.ms };
  }
  throw new RemindersError(
    'Apple Reminders keeps a single date and time per reminder: the due time IS the ' +
      'alert time. Give only due (a day, or a day and time), or a remind_at on the same day as due.',
    'input',
  );
}

export interface CreateInput {
  title: string;
  notes?: string;
  list?: string;
  due?: string;
  remindAt?: string;
  priority?: Priority;
}

export async function createReminder(input: CreateInput): Promise<Reminder> {
  syncZone();
  const title = input.title.trim();
  if (!title) throw new RemindersError('title must not be empty.', 'input');
  const fields: Fields = {
    name: title,
    ...resolveWhen(input.due, input.remindAt),
  };
  if (input.notes !== undefined && input.notes !== '')
    fields.body = input.notes;
  if (input.priority) fields.priority = PRIORITY_VALUE[input.priority];
  const raw = await call<RawReminder>({
    op: 'create',
    list: input.list,
    fields,
  });
  return toReminder(raw, raw.list!);
}

export interface UpdateInput {
  id: string;
  list?: string;
  title?: string;
  notes?: string;
  due?: string;
  remindAt?: string;
  priority?: Priority;
  completed?: boolean;
}

export async function updateReminder(input: UpdateInput): Promise<Reminder> {
  syncZone();
  const fields: Fields = { ...resolveWhen(input.due, input.remindAt) };
  if (input.title !== undefined) {
    const t = input.title.trim();
    if (!t) throw new RemindersError('title must not be empty.', 'input');
    fields.name = t;
  }
  if (input.notes !== undefined) fields.body = input.notes;
  if (input.priority) fields.priority = PRIORITY_VALUE[input.priority];
  if (input.completed !== undefined) fields.completed = input.completed;
  if (Object.keys(fields).length === 0)
    throw new RemindersError(
      'Nothing to change: pass at least one field.',
      'input',
    );
  const raw = await call<RawReminder>({
    op: 'update',
    id: input.id,
    list: input.list,
    fields,
  });
  return toReminder(raw, raw.list!);
}

export async function completeReminder(input: {
  id: string;
  list?: string;
}): Promise<Reminder> {
  syncZone();
  const raw = await call<RawReminder>({
    op: 'update',
    id: input.id,
    list: input.list,
    fields: { completed: true },
  });
  return toReminder(raw, raw.list!);
}
