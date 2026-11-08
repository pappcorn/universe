// MCP tool definitions. Thin wrappers over core.ts: validate input, call core,
// format a readable result that carries ids so the model can chain calls
// (list_lists → list_reminders → complete_reminder).
//
// Transport-agnostic: nothing here reads process.env or knows about stdio.
//
// THE SURFACE IS SMALL ON PURPOSE. Five tools: two read, three write. Nothing
// deletes — not a reminder, not a list — and nothing runs on its own: the
// connector acts only when asked. Everything stays on this Mac.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  completeReminder,
  createReminder,
  listLists,
  listReminders,
  updateReminder,
  type Reminder,
} from './core';
import { zoneLabel } from './dates';

type TextResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

const ok = (text: string): TextResult => ({
  content: [{ type: 'text', text }],
});

function fail(err: unknown): TextResult {
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text', text: `ERROR: ${msg}` }], isError: true };
}

const indent = (s: string) => s.replace(/\n/g, '\n      ');

export function formatReminder(r: Reminder): string {
  const bits: string[] = [];
  if (r.due) bits.push(r.allDay ? `due ${r.due} (all day)` : `due ${r.due}`);
  if (r.priority !== 'none') bits.push(`priority ${r.priority}`);
  if (r.completedAt) bits.push(`completed ${r.completedAt}`);
  return [
    `- [${r.completed ? 'x' : ' '}] ${r.title}${bits.length ? ` — ${bits.join(' · ')}` : ''}`,
    `    id: ${r.id}`,
    `    list: ${r.list.name}`,
    ...(r.notes ? [`    notes: ${indent(r.notes)}`] : []),
  ].join('\n');
}

const zone = () => zoneLabel();

const DATE_HELP = () =>
  `ISO 8601: "YYYY-MM-DD" for a whole day, "YYYY-MM-DDTHH:MM" for a time in this Mac's ` +
  `time zone, ${zone()}, or a full timestamp with an offset. Convert relative dates ` +
  `("tomorrow at 9") yourself before calling.`;

const listRef = z
  .string()
  .min(1)
  .describe(
    'The list name (case-insensitive) or its id, as list_lists returns it.',
  );

const priority = z
  .enum(['none', 'high', 'medium', 'low'])
  .describe('Reminders priority.');

const SAME_DATE =
  'In Apple Reminders the due time IS the alert time: one date per reminder. remind_at ' +
  'is accepted only on the same day as due, or alone.';

export function registerTools(server: McpServer): void {
  server.registerTool(
    'list_lists',
    {
      title: 'List reminder lists',
      description:
        "The person's Apple Reminders lists on this Mac: name, id, how many open (not " +
        'completed) reminders each has, and which one is the default for new reminders. ' +
        'Start here to learn list names. Read-only.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const lists = await listLists();
        if (lists.length === 0) return ok('No reminder lists on this Mac.');
        const lines = lists.map(
          (l) =>
            `- ${l.name}${l.isDefault ? ' (default)' : ''} · ${l.open} open · id ${l.id}`,
        );
        return ok(
          [`Reminder lists (times in ${zone()}):`, ...lines].join('\n'),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'list_reminders',
    {
      title: 'List reminders',
      description:
        'Reminders in ONE list, sorted by due date (undated last). Defaults to open ' +
        '(incomplete) reminders only. Filter by due date with due_after (inclusive) and ' +
        'due_before (exclusive); either filter leaves out reminders with no due date. Every ' +
        'reminder comes back with its id, needed to complete or update it. Read-only. ' +
        `Dates are shown in this Mac's time zone, ${zone()}.`,
      inputSchema: {
        list: listRef,
        status: z
          .enum(['incomplete', 'completed', 'all'])
          .optional()
          .describe('Which reminders. Default incomplete.'),
        due_after: z
          .string()
          .optional()
          .describe(`Only reminders due at or after this. ${DATE_HELP()}`),
        due_before: z
          .string()
          .optional()
          .describe(`Only reminders due before this. ${DATE_HELP()}`),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe('At most this many. Default 50.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (a) => {
      try {
        const res = await listReminders({
          list: a.list,
          status: a.status,
          dueAfter: a.due_after,
          dueBefore: a.due_before,
          limit: a.limit,
        });
        const head =
          `List "${res.list.name}" · ${a.status ?? 'incomplete'} · ` +
          `${res.reminders.length} shown of ${res.matched} · times in ${zone()}`;
        if (res.reminders.length === 0)
          return ok(`${head}\n(no reminders match)`);
        return ok([head, ...res.reminders.map(formatReminder)].join('\n'));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'create_reminder',
    {
      title: 'Create a reminder',
      description:
        "Create one reminder in the person's Apple Reminders, on this Mac. It syncs to " +
        'their other devices through their own iCloud, as any reminder does. Without list it ' +
        'goes to the default list. Returns the new reminder with its id. Create only what ' +
        `the person asked for. ${SAME_DATE}`,
      inputSchema: {
        title: z
          .string()
          .min(1)
          .describe('The reminder text. Any language, emoji welcome.'),
        notes: z
          .string()
          .optional()
          .describe('Longer notes shown under the title.'),
        list: listRef.optional(),
        due: z.string().optional().describe(`When it is due. ${DATE_HELP()}`),
        remind_at: z
          .string()
          .optional()
          .describe(`When to alert, with a time. ${DATE_HELP()}`),
        priority: priority.optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (a) => {
      try {
        const r = await createReminder({
          title: a.title,
          notes: a.notes,
          list: a.list,
          due: a.due,
          remindAt: a.remind_at,
          priority: a.priority,
        });
        return ok(`Created:\n${formatReminder(r)}`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'complete_reminder',
    {
      title: 'Complete a reminder',
      description:
        'Mark one reminder as completed (checked off). It is not deleted: it stays in the ' +
        'list as completed, and update_reminder with completed=false reopens it. Pass list ' +
        'too when you know it: without it every list is searched, which can take several ' +
        'seconds.',
      inputSchema: {
        id: z
          .string()
          .min(1)
          .describe('The reminder id, from list_reminders or create_reminder.'),
        list: listRef.optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (a) => {
      try {
        const r = await completeReminder({ id: a.id, list: a.list });
        return ok(`Completed:\n${formatReminder(r)}`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'update_reminder',
    {
      title: 'Update a reminder',
      description:
        'Change one reminder: title, notes, due date, priority, or reopen it with ' +
        'completed=false. Only the fields you pass change; the new value REPLACES the old ' +
        'one (notes are overwritten, not appended), so confirm with the person before ' +
        'rewriting text they wrote. A due date can be moved but not removed: Apple ' +
        `Reminders does not allow clearing a date by script. ${SAME_DATE} Pass list when ` +
        'you know it, to avoid searching every list.',
      inputSchema: {
        id: z
          .string()
          .min(1)
          .describe('The reminder id, from list_reminders or create_reminder.'),
        list: listRef.optional(),
        title: z.string().optional().describe('New title.'),
        notes: z
          .string()
          .optional()
          .describe('New notes. Replaces the existing notes. "" empties them.'),
        due: z.string().optional().describe(`New due date. ${DATE_HELP()}`),
        remind_at: z
          .string()
          .optional()
          .describe(`New alert time. ${DATE_HELP()}`),
        priority: priority.optional(),
        completed: z
          .boolean()
          .optional()
          .describe('false reopens a completed reminder; true completes it.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (a) => {
      try {
        const r = await updateReminder({
          id: a.id,
          list: a.list,
          title: a.title,
          notes: a.notes,
          due: a.due,
          remindAt: a.remind_at,
          priority: a.priority,
          completed: a.completed,
        });
        return ok(`Updated:\n${formatReminder(r)}`);
      } catch (e) {
        return fail(e);
      }
    },
  );
}
