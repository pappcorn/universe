// The bridge to Reminders: what reaches osascript, how its failures become
// messages a person can act on, and the date rules Reminders imposes.

import { LIST, errJson, fakeOsascript, okJson, raw } from './helpers';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  completeReminder,
  createReminder,
  listLists,
  listReminders,
  RemindersError,
  resolveWhen,
  updateReminder,
} from '../src/core';
import { JXA_SCRIPT } from '../src/jxa';

let restore = () => {};
afterEach(() => restore());

function fake(...replies: Parameters<typeof fakeOsascript>) {
  const f = fakeOsascript(...replies);
  restore = f.restore;
  return f;
}

describe('the osascript call', () => {
  it('passes user text as one JSON argument, never inside the script', async () => {
    const title = 'Llamar a "mamá" \'hoy\' `ya` ${x} 🎂';
    const f = fake(okJson({ ...raw({ name: title }), list: LIST }));
    await createReminder({ title, list: 'Mercado' });
    const [call] = f.seen;
    assert.equal(call.file, '/usr/bin/osascript');
    assert.deepEqual(call.args.slice(0, 3), ['-l', 'JavaScript', '-e']);
    assert.equal(call.args[3], JXA_SCRIPT);
    assert.equal(call.args.length, 5);
    assert.equal((call.payload!.fields as { name: string }).name, title);
    assert.ok(!JXA_SCRIPT.includes('mamá'));
  });

  it('launches Reminders and retries once on -609 "Connection is invalid"', async () => {
    const f = fake(
      errJson('Error: Connection is invalid.', -609),
      {},
      okJson([{ id: 'L', name: 'Mercado', open: 2, isDefault: true }]),
    );
    const lists = await listLists();
    assert.equal(lists.length, 1);
    assert.deepEqual(f.seen[1].args, [
      '-e',
      'tell application "Reminders" to launch',
    ]);
    assert.equal(f.seen.length, 3);
  });

  it('also recognises -609 when osascript itself fails', async () => {
    fake(
      {
        code: 1,
        stderr: 'execution error: Error: Connection is invalid. (-609)',
      },
      {},
      okJson([]),
    );
    assert.deepEqual(await listLists(), []);
  });

  it('does not retry forever', async () => {
    fake(
      errJson('Connection is invalid.', -609),
      {},
      errJson('Connection is invalid.', -609),
    );
    await assert.rejects(listLists(), RemindersError);
  });

  it('turns a refused Automation permission into instructions', async () => {
    fake({
      code: 1,
      stderr:
        'execution error: Error: Not authorized to send Apple events to Reminders. (-1743)',
    });
    await assert.rejects(
      listLists(),
      (e: RemindersError) =>
        e.kind === 'permission' &&
        /Privacy & Security → Automation/.test(e.message),
    );
  });

  it('says what to do on a timeout', async () => {
    fake({ timedOut: true, code: null });
    await assert.rejects(
      listLists(),
      (e: RemindersError) =>
        e.kind === 'timeout' && /permission prompt/.test(e.message),
    );
  });

  it('reports a missing list as not-found, with the hint from the script', async () => {
    fake(
      errJson(
        'No list called "X". Call list_lists to see the lists that exist.',
        undefined,
        'NO_LIST',
      ),
    );
    await assert.rejects(
      listReminders({ list: 'X' }),
      (e: RemindersError) =>
        e.kind === 'not-found' && /list_lists/.test(e.message),
    );
  });
});

describe('list_reminders', () => {
  const rows = [
    raw({ id: 'a', name: 'sin fecha' }),
    raw({
      id: 'b',
      name: 'tarde',
      dueDate: '2026-11-08T22:00:00.000Z',
      priority: 1,
    }),
    raw({ id: 'c', name: 'todo el día', dueDate: '2026-11-08T05:00:00.000Z' }),
    raw({
      id: 'd',
      name: 'la otra semana',
      dueDate: '2026-11-15T14:00:00.000Z',
      priority: 9,
    }),
  ];

  it('defaults to incomplete, sorts by due date with undated last, and shows local times', async () => {
    const f = fake(okJson({ list: LIST, reminders: rows }));
    const res = await listReminders({ list: 'Mercado' });
    assert.equal(f.seen[0].payload!.status, 'incomplete');
    assert.deepEqual(
      res.reminders.map((r) => r.id),
      ['c', 'b', 'd', 'a'],
    );
    assert.equal(res.reminders[0].due, '2026-11-08');
    assert.equal(res.reminders[0].allDay, true);
    assert.equal(res.reminders[1].due, '2026-11-08T17:00:00-05:00');
    assert.equal(res.reminders[1].priority, 'high');
    assert.equal(res.reminders[2].priority, 'low');
  });

  it('filters due_after inclusive and due_before exclusive, dropping undated', async () => {
    fake(okJson({ list: LIST, reminders: rows }));
    const res = await listReminders({
      list: 'Mercado',
      dueAfter: '2026-11-08',
      dueBefore: '2026-11-09',
    });
    assert.deepEqual(
      res.reminders.map((r) => r.id),
      ['c', 'b'],
    );
    assert.equal(res.matched, 2);
  });

  it('applies the limit after filtering and reports how many matched', async () => {
    fake(okJson({ list: LIST, reminders: rows }));
    const res = await listReminders({ list: 'Mercado', limit: 1 });
    assert.equal(res.reminders.length, 1);
    assert.equal(res.matched, 4);
  });

  it('refuses an unreadable filter before calling Reminders', async () => {
    const f = fake();
    await assert.rejects(
      listReminders({ list: 'Mercado', dueBefore: 'next week' }),
      RemindersError,
    );
    assert.equal(f.seen.length, 0);
  });
});

describe('one date per reminder', () => {
  it('a bare day becomes an all-day date', () => {
    assert.deepEqual(resolveWhen('2026-11-08'), { dueDay: [2026, 11, 8] });
  });

  it('a time becomes an instant', () => {
    assert.deepEqual(resolveWhen('2026-11-08T09:00'), {
      dueMs: Date.parse('2026-11-08T14:00:00Z'),
    });
  });

  it('remind_at alone becomes the due time', () => {
    assert.deepEqual(resolveWhen(undefined, '2026-11-08T09:00'), {
      dueMs: Date.parse('2026-11-08T14:00:00Z'),
    });
  });

  it('a day plus a time that day becomes that time', () => {
    assert.deepEqual(resolveWhen('2026-11-08', '2026-11-08T07:30'), {
      dueMs: Date.parse('2026-11-08T12:30:00Z'),
    });
  });

  it('refuses a remind_at that contradicts due', () => {
    assert.throws(
      () => resolveWhen('2026-11-08T09:00', '2026-11-08T08:00'),
      /single date/,
    );
    assert.throws(
      () => resolveWhen('2026-11-08', '2026-11-07T20:00'),
      /single date/,
    );
  });

  it('refuses a remind_at without a time', () => {
    assert.throws(() => resolveWhen(undefined, '2026-11-08'), /needs a time/);
  });
});

describe('writes', () => {
  it('create sends title, notes, priority and date; default list when none given', async () => {
    const f = fake(
      okJson({
        ...raw({
          name: 'Pagar luz',
          priority: 5,
          dueDate: '2026-11-10T13:00:00.000Z',
          body: 'factura\n#2',
        }),
        list: LIST,
      }),
    );
    const r = await createReminder({
      title: '  Pagar luz ',
      notes: 'factura\n#2',
      due: '2026-11-10T08:00',
      priority: 'medium',
    });
    assert.deepEqual(f.seen[0].payload, {
      op: 'create',
      fields: {
        name: 'Pagar luz',
        dueMs: Date.parse('2026-11-10T13:00:00Z'),
        body: 'factura\n#2',
        priority: 5,
      },
    });
    assert.equal(r.due, '2026-11-10T08:00:00-05:00');
    assert.equal(r.notes, 'factura\n#2');
    assert.equal(r.priority, 'medium');
  });

  it('create refuses an empty title', async () => {
    fake();
    await assert.rejects(createReminder({ title: '   ' }), /title/);
  });

  it('complete only sets completed', async () => {
    const f = fake(
      okJson({
        ...raw({ completed: true, completionDate: '2026-11-07T20:00:00.000Z' }),
        list: LIST,
      }),
    );
    const r = await completeReminder({
      id: 'x-apple-reminder://R1',
      list: 'Mercado',
    });
    assert.deepEqual(f.seen[0].payload, {
      op: 'update',
      id: 'x-apple-reminder://R1',
      list: 'Mercado',
      fields: { completed: true },
    });
    assert.equal(r.completed, true);
    assert.equal(r.completedAt, '2026-11-07T15:00:00-05:00');
  });

  it('update sends only the fields given, and can reopen', async () => {
    const f = fake(okJson({ ...raw(), list: LIST }));
    await updateReminder({ id: 'R1', title: 'Nuevo', completed: false });
    assert.deepEqual(f.seen[0].payload!.fields, {
      name: 'Nuevo',
      completed: false,
    });
  });

  it('update with nothing to change is refused before calling Reminders', async () => {
    const f = fake();
    await assert.rejects(updateReminder({ id: 'R1' }), /Nothing to change/);
    assert.equal(f.seen.length, 0);
  });
});
