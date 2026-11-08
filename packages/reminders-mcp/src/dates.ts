// Dates and time zones, decided in one place.
//
// Input: the model sends ISO 8601 text, never natural language.
//   "2026-11-08"                  → an all-day date (no time)
//   "2026-11-08T09:00"            → 09:00 in THIS MAC'S time zone
//   "2026-11-08T09:00:00-05:00"   → that exact instant, whatever the Mac's zone
//   "2026-11-08T14:00:00Z"        → that exact instant
// Output: every date is written back in the Mac's local time with its offset,
// "2026-11-08T09:00:00-05:00", so the model never has to convert from UTC.
//
// The Mac's zone is the process's zone: Node inherits it from the system (or
// from TZ, which tests use to pin it). Node reads the zone ONCE, at startup,
// while every osascript call starts fresh in the CURRENT system zone. A
// long-lived server (Claude Desktop keeps it running for days) on a laptop that
// travels would then parse and format in the old zone while Reminders builds
// dates in the new one. syncSystemTimeZone() closes that gap before each call.

import { readlinkSync } from 'node:fs';

/** The system's IANA zone, from the /etc/localtime link macOS maintains
 *  (…/zoneinfo/America/Bogota). Null when it cannot be read. */
export function readSystemTimeZone(): string | null {
  try {
    const m = /zoneinfo\/(.+)$/.exec(readlinkSync('/etc/localtime'));
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** Make Node's zone match the system's. Assigning process.env.TZ is what
 *  makes Node drop its cached zone. Returns true when it changed. */
export function syncSystemTimeZone(
  read: () => string | null = readSystemTimeZone,
): boolean {
  const zone = read();
  if (!zone) return false;
  if (Intl.DateTimeFormat().resolvedOptions().timeZone === zone) return false;
  process.env.TZ = zone;
  return true;
}

export type When =
  | { kind: 'instant'; ms: number }
  | { kind: 'day'; y: number; m: number; d: number };

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?$/i;

export class DateInputError extends Error {}

function validDay(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d));
  return (
    t.getUTCFullYear() === y &&
    t.getUTCMonth() === m - 1 &&
    t.getUTCDate() === d
  );
}

/** Parse one date from the model. Throws DateInputError with a message the
 *  model can act on. */
export function parseWhen(input: string, field = 'date'): When {
  const s = input.trim();
  const day = DAY_RE.exec(s);
  if (day) {
    const [y, m, d] = [Number(day[1]), Number(day[2]), Number(day[3])];
    if (!validDay(y, m, d))
      throw new DateInputError(`${field}: ${s} is not a real calendar date.`);
    return { kind: 'day', y, m, d };
  }
  const dt = DATETIME_RE.exec(s);
  if (!dt)
    throw new DateInputError(
      `${field}: "${s}" is not ISO 8601. Use YYYY-MM-DD for a whole day, ` +
        `or YYYY-MM-DDTHH:MM for a time in this Mac's time zone (${zoneLabel()}).`,
    );
  const [y, mo, d, h, mi, se] = [1, 2, 3, 4, 5, 6].map((i) =>
    Number(dt[i] ?? 0),
  );
  if (!validDay(y, mo, d) || h > 23 || mi > 59 || se > 59)
    throw new DateInputError(`${field}: ${s} is not a real date and time.`);
  const zone = dt[7];
  let ms: number;
  if (!zone) {
    ms = new Date(y, mo - 1, d, h, mi, se).getTime();
  } else {
    let offsetMin = 0;
    if (zone.toUpperCase() !== 'Z') {
      const sign = zone[0] === '-' ? -1 : 1;
      const digits = zone.slice(1).replace(':', '');
      offsetMin =
        sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2)));
    }
    ms = Date.UTC(y, mo - 1, d, h, mi, se) - offsetMin * 60_000;
  }
  return { kind: 'instant', ms };
}

/** Local midnight of a day, as epoch ms. */
export function dayStartMs(w: { y: number; m: number; d: number }): number {
  return new Date(w.y, w.m - 1, w.d).getTime();
}

/** Lower bound (inclusive) of a filter, as epoch ms. A bare day means its start. */
export function boundMs(w: When): number {
  return w.kind === 'instant' ? w.ms : dayStartMs(w);
}

const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, '0');

function offsetOf(d: Date): string {
  const off = -d.getTimezoneOffset();
  return `${off < 0 ? '-' : '+'}${pad(Math.trunc(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}

/** An instant in the Mac's local time, with offset: 2026-11-08T09:00:00-05:00 */
export function formatLocal(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${offsetOf(d)}`
  );
}

/** A local calendar day: 2026-11-08 */
export function formatDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** True when an instant falls exactly on local midnight. Reminders reports an
 *  all-day reminder's due date as local midnight, and that is the only signal
 *  scripting gives us. */
export function isLocalMidnight(ms: number): boolean {
  const d = new Date(ms);
  return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
}

export function sameLocalDay(
  aMs: number,
  b: { y: number; m: number; d: number },
): boolean {
  const d = new Date(aMs);
  return (
    d.getFullYear() === b.y && d.getMonth() + 1 === b.m && d.getDate() === b.d
  );
}

/** "America/Bogota (UTC-05:00)" */
export function zoneLabel(now = Date.now()): string {
  let name = 'local time';
  try {
    name = Intl.DateTimeFormat().resolvedOptions().timeZone || name;
  } catch {
    /* keep the fallback */
  }
  return `${name} (UTC${offsetOf(new Date(now))})`;
}
