#!/usr/bin/env node
// Gmail CLI — the shell/automation frontend over the shared core.
// Every command is a THIN wrapper: parse flags, call a core function
// (src/core.ts — the same code the MCP uses), format the result. No API/auth
// code here; auth lives in auth.ts, API ops in core.ts.
//
// Run via: node -r @swc-node/register src/cli.ts <cmd> …
// Auth: resolved from the WORKING DIRECTORY — process environment, then the
// nearest `.env` (walking up to the repo root), then $GMAIL_MCP_CREDENTIALS,
// then ~/.config/pappcorn-gmail-mcp/credentials.json. `whoami` prints which one
// won. See docs/setup-google-cloud.md.
//
// Exit codes: 0 ok | 1 local config (credential missing/revoked/wrong mailbox)
// | 2 bad args | 3 Gmail API failure. The CLI never prints any credential field.

import { credentialSource, loadCredentials, MailAccessError } from './auth';
import {
  archive,
  draft,
  getProfile,
  listLabels,
  modifyLabels,
  readThread,
  search,
  send,
  type ComposeArgs,
  type MessageRow,
  type ThreadMessage,
} from './core';

// ──────────────────────────────────────────────────────────────────────────────
// Argument parsing (repeatable flags collect into arrays)
// ──────────────────────────────────────────────────────────────────────────────

type FlagVal = string | boolean;
interface ParsedFlags {
  positional: string[];
  flags: Record<string, FlagVal | FlagVal[]>;
}

function parseFlags(argv: string[]): ParsedFlags {
  const positional: string[] = [];
  const flags: Record<string, FlagVal | FlagVal[]> = {};
  const setFlag = (k: string, v: FlagVal): void => {
    if (k in flags) {
      const cur = flags[k];
      flags[k] = Array.isArray(cur) ? [...cur, v] : [cur, v];
    } else {
      flags[k] = v;
    }
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        setFlag(a.slice(2, eq), a.slice(eq + 1));
      } else {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) {
          setFlag(a.slice(2), true);
        } else {
          setFlag(a.slice(2), next);
          i++;
        }
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

// Flags that may repeat (--to a --to b) or carry comma lists (--to a,b).
function listFlag(v: FlagVal | FlagVal[] | undefined): string[] | undefined {
  if (v === undefined) return undefined;
  const arr = Array.isArray(v) ? v : [v];
  const out = arr
    .filter((x): x is string => typeof x === 'string')
    .flatMap((s) => s.split(','))
    .map((s) => s.trim())
    .filter(Boolean);
  return out.length ? out : undefined;
}

// ──────────────────────────────────────────────────────────────────────────────
// Output helpers
// ──────────────────────────────────────────────────────────────────────────────

function printJson(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

function fail(code: number, msg: string): never {
  process.stderr.write(`gmail: ${msg}\n`);
  process.exit(code);
}

function printRows(rows: MessageRow[]): void {
  if (!rows.length) {
    process.stdout.write('(0 messages)\n');
    return;
  }
  for (const r of rows) {
    const labels = r.labelIds?.length ? `  [${r.labelIds.join(',')}]` : '';
    process.stdout.write(
      `id:${r.id}  thread:${r.threadId ?? ''}  ${r.date ?? ''}${labels}\n`,
    );
    process.stdout.write(
      `  from: ${r.from ?? ''}  —  ${r.subject ?? '(no subject)'}\n`,
    );
    if (r.snippet) process.stdout.write(`  ${r.snippet}\n`);
    process.stdout.write('\n');
  }
}

function printThreadMessage(m: ThreadMessage): void {
  process.stdout.write(`── message id:${m.id} ──\n`);
  process.stdout.write(`from:    ${m.from ?? ''}\n`);
  process.stdout.write(`to:      ${m.to ?? ''}\n`);
  if (m.cc) process.stdout.write(`cc:      ${m.cc}\n`);
  process.stdout.write(`date:    ${m.date ?? ''}\n`);
  process.stdout.write(`subject: ${m.subject ?? ''}\n`);
  if (m.labelIds?.length)
    process.stdout.write(`labels:  ${m.labelIds.join(', ')}\n`);
  process.stdout.write(`\n${m.body}\n\n`);
}

function pageTail(next?: string): void {
  if (next) process.stderr.write(`(more results — pass --page ${next})\n`);
}

// `--body -` reads the body from stdin — lets the operator pipe long bodies
// (heredocs, files, another tool's output) without shell-quoting pain.
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

// ──────────────────────────────────────────────────────────────────────────────
// Subcommands
// ──────────────────────────────────────────────────────────────────────────────

async function cmdWhoami(argv: string[]): Promise<void> {
  const { flags } = parseFlags(argv);
  const p = await getProfile();
  // `credential` answers "which mailbox is this folder on, and why" — the
  // question that made multi-mailbox setups dangerous. Paths only, no secrets.
  if (flags.json) {
    printJson({ ...p, credential: credentialSource() });
    return;
  }
  process.stdout.write(
    [
      `mailbox:    ${p.emailAddress ?? ''}`,
      `messages:   ${p.messagesTotal ?? '?'}`,
      `threads:    ${p.threadsTotal ?? '?'}`,
      `credential: ${credentialSource()}`,
    ].join('\n') + '\n',
  );
}

async function cmdSearch(argv: string[]): Promise<void> {
  const { positional, flags } = parseFlags(argv);
  const q =
    positional.join(' ') || (typeof flags.q === 'string' ? flags.q : undefined);
  if (!q)
    fail(
      2,
      'Usage: search <query> [--max N] [--page P] [--json]   (Gmail query syntax, e.g. "from:x is:unread")',
    );
  const page = await search({
    q,
    max: flags.max !== undefined ? Number(flags.max) : undefined,
    page_token: typeof flags.page === 'string' ? flags.page : undefined,
  });
  if (flags.json) {
    printJson(page);
    return;
  }
  printRows(page.items);
  pageTail(page.next_page_token);
}

async function cmdRead(argv: string[]): Promise<void> {
  const { positional, flags } = parseFlags(argv);
  const threadId =
    positional[0] ??
    (typeof flags.thread === 'string' ? flags.thread : undefined);
  if (!threadId) fail(2, 'Usage: read <threadId> [--json]');
  const t = await readThread({ thread_id: threadId });
  if (flags.json) {
    printJson(t);
    return;
  }
  process.stdout.write(
    `thread:${t.id}  (${t.messages.length} message${
      t.messages.length === 1 ? '' : 's'
    })\n\n`,
  );
  for (const m of t.messages) printThreadMessage(m);
}

// --attach paths are NOT comma-split (paths may contain commas) — repeat the
// flag for several files: --attach a.pdf --attach b.png
function attachFlag(v: FlagVal | FlagVal[] | undefined): string[] | undefined {
  if (v === undefined) return undefined;
  const out = (Array.isArray(v) ? v : [v]).filter(
    (x): x is string => typeof x === 'string',
  );
  return out.length ? out : undefined;
}

async function composeFromFlags(
  argv: string[],
  cmd: 'send' | 'draft',
): Promise<ComposeArgs> {
  const { flags } = parseFlags(argv);
  const usage = `Usage: ${cmd} --to <addr> --subject <s> --body <text|-> [--cc <addr>] [--bcc <addr>] [--attach <file>]... [--reply-to-message <id>] [--thread <id>] [--html] [--json]   (--body - reads stdin)`;
  const to = listFlag(flags.to);
  if (!to) fail(2, usage);
  if (typeof flags.subject !== 'string')
    fail(2, `${cmd} requires --subject <s>.\n${usage}`);
  if (typeof flags.body !== 'string')
    fail(
      2,
      `${cmd} requires --body <text> (or --body - to read stdin).\n${usage}`,
    );
  const body = flags.body === '-' ? await readStdin() : flags.body;
  if (!body.trim()) fail(2, `${cmd}: the body is empty.`);
  return {
    to,
    subject: flags.subject,
    body,
    cc: listFlag(flags.cc),
    bcc: listFlag(flags.bcc),
    reply_to_message_id:
      typeof flags['reply-to-message'] === 'string'
        ? flags['reply-to-message']
        : undefined,
    thread_id: typeof flags.thread === 'string' ? flags.thread : undefined,
    html: flags.html === true,
    attachments: attachFlag(flags.attach),
  };
}

async function cmdSend(argv: string[]): Promise<void> {
  const { flags } = parseFlags(argv);
  const args = await composeFromFlags(argv, 'send');
  const res = await send(args);
  if (flags.json) {
    printJson(res);
    return;
  }
  process.stdout.write(
    `Sent. message id:${res.id ?? '?'}  thread:${res.threadId ?? '?'}\n`,
  );
}

async function cmdDraft(argv: string[]): Promise<void> {
  const { flags } = parseFlags(argv);
  const args = await composeFromFlags(argv, 'draft');
  const res = await draft(args);
  if (flags.json) {
    printJson(res);
    return;
  }
  process.stdout.write(
    `Draft created. draft id:${res.draft_id ?? '?'}  message id:${
      res.message_id ?? '?'
    }  thread:${res.threadId ?? '?'}\n`,
  );
}

async function cmdLabels(argv: string[]): Promise<void> {
  const { flags } = parseFlags(argv);
  const labels = await listLabels();
  if (flags.json) {
    printJson(labels);
    return;
  }
  if (!labels.length) {
    process.stdout.write('(0 labels)\n');
    return;
  }
  for (const l of labels) {
    process.stdout.write(
      `${l.id}  ${l.name}${l.type === 'system' ? '  (system)' : ''}\n`,
    );
  }
}

async function cmdLabel(argv: string[]): Promise<void> {
  const { positional, flags } = parseFlags(argv);
  const id = positional[0];
  const add = listFlag(flags.add);
  const remove = listFlag(flags.remove);
  if (!id || (!add && !remove)) {
    fail(
      2,
      'Usage: label <id> --add a,b [--remove c,d] [--thread] [--json]   (--thread targets a thread id; default is a message id)',
    );
  }
  const res = await modifyLabels({
    ...(flags.thread ? { thread_id: id } : { message_id: id }),
    add,
    remove,
  });
  if (flags.json) {
    printJson(res);
    return;
  }
  process.stdout.write(
    `Labeled ${res.target} id:${res.id}.` +
      (res.added.length ? `  added: ${res.added.join(', ')}` : '') +
      (res.removed.length ? `  removed: ${res.removed.join(', ')}` : '') +
      (res.labelIds ? `\nlabels now: ${res.labelIds.join(', ')}` : '') +
      '\n',
  );
}

async function cmdArchive(argv: string[]): Promise<void> {
  const { positional, flags } = parseFlags(argv);
  const id = positional[0];
  if (!id)
    fail(
      2,
      'Usage: archive <id> [--thread] [--json]   (--thread targets a thread id; default is a message id)',
    );
  const res = await archive(
    flags.thread ? { thread_id: id } : { message_id: id },
  );
  if (flags.json) {
    printJson(res);
    return;
  }
  process.stdout.write(
    `Archived ${res.target} id:${res.id} (INBOX removed).\n`,
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Dispatch
// ──────────────────────────────────────────────────────────────────────────────

const USAGE = `Usage: gmail <command> [...args]   (your own mailbox — on-demand v1)

Commands:
  whoami    Verify the credential; print mailbox identity.  whoami [--json]
  search    Search messages (Gmail query syntax).           search <query> [--max N] [--page P] [--json]
  read      Read a full thread (headers + text bodies).     read <threadId> [--json]
  send      Send an email — OUTWARD-FACING: confirm         send --to <addr> --subject <s> --body <text|->
            recipient + subject + body with the user first.      [--cc <addr>] [--bcc <addr>] [--attach <file>]...
                                                                 [--reply-to-message <id>] [--thread <id>] [--html] [--json]
  draft     Create a draft (same flags as send).            draft --to <addr> --subject <s> --body <text|-> [...]
  labels    List labels (id + name).                        labels [--json]
  label     Add/remove labels on a message or thread.       label <id> --add a,b [--remove c,d] [--thread] [--json]
  archive   Archive (remove INBOX); never deletes.          archive <id> [--thread] [--json]

Auth is resolved from the working directory, highest precedence first:
  1. GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET + GMAIL_REFRESH_TOKEN in the environment
  2. the nearest .env (this folder, walking up to the repo root) — fills in what the environment lacks
  3. $GMAIL_MCP_CREDENTIALS (a credential file path)
  4. ~/.config/pappcorn-gmail-mcp/credentials.json (global default; still supported, no longer recommended)
Set GMAIL_ACCOUNT to assert which mailbox this folder is for: a mismatch is denied, not guessed.
Run \`whoami\` to see which of the four won.

Notes: --body - reads the body from stdin (pipe long bodies). --to/--cc/--bcc repeat or take comma lists.
       --attach repeats per file (never comma-split; total ≤ 25MB — the Gmail message limit).
       Label names resolve case-insensitively; names being ADDED are auto-created. v1 never deletes mail.
Exit codes: 0 ok | 1 local config (credential missing/revoked/wrong mailbox) | 2 bad args | 3 Gmail API failure.
`;

type Handler = (argv: string[]) => Promise<void> | void;

const handlers: Record<string, Handler> = {
  whoami: cmdWhoami,
  search: cmdSearch,
  read: cmdRead,
  send: cmdSend,
  draft: cmdDraft,
  labels: cmdLabels,
  label: cmdLabel,
  archive: cmdArchive,
  help: () => {
    process.stdout.write(USAGE);
  },
  '--help': () => {
    process.stdout.write(USAGE);
  },
  '-h': () => {
    process.stdout.write(USAGE);
  },
};

async function main(): Promise<void> {
  const cmd = process.argv[2];
  const rest = process.argv.slice(3);

  if (!cmd || !handlers[cmd]) {
    process.stderr.write(USAGE);
    process.exit(cmd ? 2 : 0);
  }

  // Preflight the credential file up front so a locked-out session exits 1
  // (local config) with the clean "no access" message — the HARD GATE from
  if (cmd !== 'help' && cmd !== '--help' && cmd !== '-h') {
    try {
      loadCredentials();
    } catch (err) {
      fail(1, err instanceof Error ? err.message : String(err));
    }
  }

  await handlers[cmd](rest);
}

main().catch((err: unknown) => {
  // A revoked grant surfaces mid-call as MailAccessError → still exit 1
  // (local credential problem). Anything else is an API failure → exit 3.
  if (err instanceof MailAccessError) fail(1, err.message);
  const e = err as { stack?: string; message?: string };
  fail(3, e?.stack || e?.message || String(err));
});
