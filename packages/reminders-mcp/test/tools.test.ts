// The surface the model sees: exactly five tools, each annotated honestly, and
// nothing that deletes.

import './helpers';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildServer } from '../src/server';

type Registered = Record<
  string,
  {
    title?: string;
    annotations?: Record<string, boolean>;
    description?: string;
  }
>;

const tools = (buildServer() as unknown as { _registeredTools: Registered })
  ._registeredTools;

describe('tool surface', () => {
  it('is exactly the five v1 tools', () => {
    assert.deepEqual(Object.keys(tools).sort(), [
      'complete_reminder',
      'create_reminder',
      'list_lists',
      'list_reminders',
      'update_reminder',
    ]);
  });

  it('has no delete tool and no description invites deleting', () => {
    for (const [name, t] of Object.entries(tools)) {
      assert.ok(!/delete|remove/i.test(name), name);
      assert.ok(!/\bdeletes? (a|the|one)\b/i.test(t.description ?? ''), name);
    }
  });

  it('gives every tool a title and annotations', () => {
    for (const [name, t] of Object.entries(tools)) {
      assert.ok(t.title, `${name} has a title`);
      assert.equal(
        typeof t.annotations?.readOnlyHint,
        'boolean',
        `${name} readOnlyHint`,
      );
      assert.equal(t.annotations?.openWorldHint, false, `${name} is local`);
    }
  });

  it('marks reads read-only and the overwriting update destructive', () => {
    assert.equal(tools.list_lists.annotations!.readOnlyHint, true);
    assert.equal(tools.list_reminders.annotations!.readOnlyHint, true);
    for (const w of ['create_reminder', 'complete_reminder', 'update_reminder'])
      assert.equal(tools[w].annotations!.readOnlyHint, false, w);
    assert.equal(tools.create_reminder.annotations!.destructiveHint, false);
    assert.equal(tools.complete_reminder.annotations!.destructiveHint, false);
    assert.equal(tools.update_reminder.annotations!.destructiveHint, true);
  });
});
