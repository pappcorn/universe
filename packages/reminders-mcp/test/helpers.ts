// Shared test scaffolding: a fake osascript, so no test ever touches the real
// Reminders database of the machine it runs on. Times are pinned to a fixed
// zone (UTC-5, no daylight saving) so results do not depend on the runner.

process.env.TZ = 'America/Bogota';

import { useFakeRunner, type RunResult } from '../src/core';

export interface Seen {
  file: string;
  args: string[];
  /** The decoded JSON payload, when the call ran the JXA script. */
  payload?: Record<string, unknown>;
}

type Reply = Partial<RunResult> | ((seen: Seen) => Partial<RunResult>);

/** Answer each osascript call with the next reply. Running out of replies
 *  fails the test loudly. */
export function fakeOsascript(...replies: Reply[]): {
  seen: Seen[];
  restore: () => void;
} {
  const seen: Seen[] = [];
  const restore = useFakeRunner(async (file, args) => {
    const s: Seen = { file, args };
    if (args[0] === '-l') s.payload = JSON.parse(args[4]);
    seen.push(s);
    const next = replies.shift();
    if (!next)
      throw new Error(
        `unexpected osascript call: ${JSON.stringify(s.payload ?? args)}`,
      );
    const r = typeof next === 'function' ? next(s) : next;
    return { stdout: '', stderr: '', code: 0, timedOut: false, ...r };
  });
  return { seen, restore };
}

export const okJson = (data: unknown): Partial<RunResult> => ({
  stdout: JSON.stringify({ ok: true, data }),
});

export const errJson = (
  error: string,
  number?: number,
  code?: string,
): Partial<RunResult> => ({
  stdout: JSON.stringify({ ok: false, error, number, code }),
});

export const LIST = { id: 'LIST-1', name: 'Mercado' };

export function raw(over: Record<string, unknown> = {}) {
  return {
    id: 'x-apple-reminder://R1',
    name: 'Comprar café ☕️',
    body: null,
    completed: false,
    completionDate: null,
    dueDate: null,
    alldayDueDate: null,
    remindMeDate: null,
    priority: 0,
    creationDate: '2026-11-01T14:00:00.000Z',
    ...over,
  };
}
