#!/usr/bin/env node
// Reminders CLI: the shell frontend over the shared core, for checking the
// connector and its macOS permission from a terminal.
//
// READ-ONLY ON PURPOSE. Creating and changing reminders goes through the MCP
// tools, where the model works on what the person asked for.
//
// Run via: npm run reminders -- <cmd> …
// Exit codes: 0 ok | 2 bad args | 3 Reminders refused or is not reachable.

import { listLists, listReminders, RemindersError, type Status } from './core';
import { zoneLabel } from './dates';
import { formatReminder } from './tools';

const USAGE = `reminders — Apple Reminders CLI (read-only)

Usage: npm run reminders -- <command> [flags]

Commands:
  whoami                      Check access: time zone and how many lists macOS lets us see
  lists                       Your reminder lists, with open counts
  reminders --list NAME       Reminders in one list
            [--status incomplete|completed|all] [--after DATE] [--before DATE] [--limit N]

The first run makes macOS ask whether this terminal may control Reminders.
Click "Allow" (or "OK").`;

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : undefined;
}

async function main(argv: string[]): Promise<number> {
  const [cmd] = argv;
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    process.stdout.write(`${USAGE}\n`);
    return cmd ? 0 : 2;
  }
  try {
    if (cmd === 'whoami') {
      const lists = await listLists();
      process.stdout.write(
        `Reminders: reachable\ntime zone: ${zoneLabel()}\nlists: ${lists.length}\n`,
      );
      return 0;
    }
    if (cmd === 'lists') {
      for (const l of await listLists())
        process.stdout.write(
          `${l.name}${l.isDefault ? ' (default)' : ''}\t${l.open} open\t${l.id}\n`,
        );
      return 0;
    }
    if (cmd === 'reminders') {
      const list = flag(argv, 'list');
      if (!list) {
        process.stderr.write('reminders: --list is required\n');
        return 2;
      }
      const limit = flag(argv, 'limit');
      const res = await listReminders({
        list,
        status: flag(argv, 'status') as Status | undefined,
        dueAfter: flag(argv, 'after'),
        dueBefore: flag(argv, 'before'),
        limit: limit ? Number(limit) : undefined,
      });
      process.stdout.write(
        `${res.reminders.length} of ${res.matched} in "${res.list.name}"\n`,
      );
      for (const r of res.reminders)
        process.stdout.write(`${formatReminder(r)}\n`);
      return 0;
    }
    process.stderr.write(`reminders: unknown command "${cmd}"\n\n${USAGE}\n`);
    return 2;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`reminders: ${msg}\n`);
    return e instanceof RemindersError && e.kind === 'input' ? 2 : 3;
  }
}

main(process.argv.slice(2)).then((code) => process.exit(code));
