// MCP tool registration for the Gmail integration. Tools are thin
// wrappers over core.ts: validate input, call one core function, format a
// human-readable text result with ids always included so the model can chain
// calls (search → read → reply → label → archive). 
//
// v1 is ON-DEMAND only — read, search, triage, draft, send-with-confirmation.
// No auto-replies, no inbound triggers (that's Fase 2, its own issue). The
// mailbox is the one that granted the token and ONLY that mailbox — the refresh token can't
// reach anything else.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  archive,
  draft,
  getProfile,
  listLabels,
  modifyLabels,
  readThread,
  search,
  send,
  type MessageRow,
  type ThreadMessage,
} from './core';

type TextResult = { content: Array<{ type: 'text'; text: string }> };

function ok(text: string): TextResult {
  return { content: [{ type: 'text', text }] };
}

function fail(err: unknown): TextResult {
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text', text: `ERROR: ${msg}` }] };
}

function pageTail(next?: string): string {
  return next ? `\n\n(more results — pass page_token: ${next})` : '';
}

// ──────────────────────────────────────────────────────────────────────────────
// Formatters
// ──────────────────────────────────────────────────────────────────────────────

function formatRow(r: MessageRow): string {
  const labels = r.labelIds?.length ? `  [${r.labelIds.join(',')}]` : '';
  return [
    `id:${r.id}  thread:${r.threadId ?? ''}  ${r.date ?? ''}${labels}`,
    `  from: ${r.from ?? ''}  —  ${r.subject ?? '(no subject)'}`,
    r.snippet ? `  ${r.snippet}` : undefined,
  ]
    .filter(Boolean)
    .join('\n');
}

function formatThreadMessage(m: ThreadMessage): string {
  return [
    `── message id:${m.id} ──`,
    `from:    ${m.from ?? ''}`,
    `to:      ${m.to ?? ''}`,
    ...(m.cc ? [`cc:      ${m.cc}`] : []),
    `date:    ${m.date ?? ''}`,
    `subject: ${m.subject ?? ''}`,
    ...(m.labelIds?.length ? [`labels:  ${m.labelIds.join(', ')}`] : []),
    '',
    m.body,
  ].join('\n');
}

// Shared composition schema for send/draft.
const composeShape = {
  to: z.union([z.string(), z.array(z.string())]).describe('Recipient(s): email or "Name <email>"; array or comma-separated string.'),
  subject: z.string().describe('Subject line (UTF-8 fine; encoded per RFC 2047 on the wire).'),
  body: z.string().describe('Message body. Plain text by default; when html=true this IS the HTML.'),
  cc: z.union([z.string(), z.array(z.string())]).optional().describe('Cc recipient(s).'),
  bcc: z.union([z.string(), z.array(z.string())]).optional().describe('Bcc recipient(s).'),
  reply_to_message_id: z
    .string()
    .optional()
    .describe('Message id being replied to (from mail_search / mail_read_thread). Sets In-Reply-To/References and inherits the thread.'),
  thread_id: z.string().optional().describe('Thread id to attach to (inferred from reply_to_message_id when replying).'),
  html: z.boolean().optional().describe('Send as HTML (multipart/alternative with an auto-derived text part). Default: plain text.'),
  attachments: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe(
      'Local file path(s) to attach (multipart/mixed; filename = basename, Content-Type by extension). Files must live inside the allowed directory (GMAIL_ATTACHMENT_DIR, default: the working directory) — paths outside it are rejected. Paths are NOT comma-split — pass an array for several files. Total ≤ 25MB (Gmail limit).',
    ),
};

// ──────────────────────────────────────────────────────────────────────────────
// Tool registration
// ──────────────────────────────────────────────────────────────────────────────

export function registerTools(server: McpServer): void {
  server.registerTool(
    'mail_whoami',
    {
      description:
        'Verify the mail credential: returns the authenticated mailbox (emailAddress — the account that granted the token) plus messagesTotal/threadsTotal. Never prints any credential field.',
      inputSchema: {},
    },
    async () => {
      try {
        const p = await getProfile();
        return ok(
          [
            `mailbox:  ${p.emailAddress ?? ''}`,
            `messages: ${p.messagesTotal ?? '?'}`,
            `threads:  ${p.threadsTotal ?? '?'}`,
          ].join('\n'),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'mail_search',
    {
      description:
        'Search messages in the authenticated mailbox with Gmail query syntax (from:, to:, subject:, label:, is:unread, newer_than:7d, …). Returns one block per message: message id + thread id + date + from + subject + snippet. Use the thread id with mail_read_thread, the message id with mail_send (reply_to_message_id) / mail_label / mail_archive.',
      inputSchema: {
        q: z.string().optional().describe('Gmail search query (e.g. "from:noreply@vercel.com is:unread newer_than:7d").'),
        label_ids: z.array(z.string()).optional().describe('Restrict to these label IDS (e.g. ["INBOX","UNREAD"]). Names must be resolved via mail_label / labels first.'),
        max: z.number().int().min(1).max(100).optional().describe('Messages per page (default 20, max 100).'),
        page_token: z.string().optional().describe('Pagination token from a previous call.'),
      },
    },
    async (args) => {
      try {
        const page = await search({ q: args.q, label_ids: args.label_ids, max: args.max, page_token: args.page_token });
        const rows = page.items.map(formatRow);
        return ok((rows.length ? rows.join('\n\n') : '(0 messages)') + pageTail(page.next_page_token));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'mail_read_thread',
    {
      description:
        'Read a full email thread by thread id (from mail_search): every message with From/To/Cc/Date/Subject headers plus a best-effort text body (text/plain preferred, stripped text/html as fallback). Message ids in the output feed mail_send (reply_to_message_id), mail_label, and mail_archive.',
      inputSchema: {
        thread_id: z.string().describe('Thread id (from mail_search rows).'),
      },
    },
    async (args) => {
      try {
        const t = await readThread({ thread_id: args.thread_id });
        return ok(
          `thread:${t.id}  (${t.messages.length} message${t.messages.length === 1 ? '' : 's'})\n\n` +
            t.messages.map(formatThreadMessage).join('\n\n'),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'mail_send',
    {
      description:
        'Send an email from the authenticated mailbox. OUTWARD-FACING — real people receive it immediately: ALWAYS confirm recipient(s) + subject + FULL body (and any attachments) with the user before calling. v1 has no auto-sends. Plain text by default; html=true sends multipart/alternative; attachments (local file paths) ride multipart/mixed. To reply in a thread pass reply_to_message_id (In-Reply-To/References are set from the original and the thread is inherited). Returns the sent message id + thread id.',
      inputSchema: composeShape,
    },
    async (args) => {
      try {
        const res = await send(args);
        return ok(`Sent. message id:${res.id ?? '?'}  thread:${res.threadId ?? '?'}`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'mail_draft',
    {
      description:
        'Create a DRAFT in the authenticated mailbox (same composition as mail_send, attachments included; nothing goes out — it lands in Drafts for a human to review/send in Gmail). Still OUTWARD-FACING content: confirm recipient(s) + subject + full body with the user before calling. Returns the draft id + underlying message id.',
      inputSchema: composeShape,
    },
    async (args) => {
      try {
        const res = await draft(args);
        return ok(`Draft created. draft id:${res.draft_id ?? '?'}  message id:${res.message_id ?? '?'}  thread:${res.threadId ?? '?'}`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'mail_label',
    {
      description:
        'List labels, or add/remove labels on a message or thread. With no arguments: lists all labels (id + name). With message_id OR thread_id (exactly one) + add/remove: label names are resolved case-insensitively; names being ADDED are auto-created if missing (taxonomy: partners/<slug>, soporte, plataformas, facturación). Labeling never deletes mail.',
      inputSchema: {
        message_id: z.string().optional().describe('Message id to label (mutually exclusive with thread_id).'),
        thread_id: z.string().optional().describe('Thread id to label (mutually exclusive with message_id).'),
        add: z.array(z.string()).optional().describe('Label NAMES to add (auto-created if missing).'),
        remove: z.array(z.string()).optional().describe('Label NAMES to remove (must exist).'),
      },
    },
    async (args) => {
      try {
        if (!args.message_id && !args.thread_id) {
          const labels = await listLabels();
          const rows = labels.map((l) => `${l.id}  ${l.name}${l.type === 'system' ? '  (system)' : ''}`);
          return ok(rows.length ? rows.join('\n') : '(0 labels)');
        }
        const res = await modifyLabels({
          message_id: args.message_id,
          thread_id: args.thread_id,
          add: args.add,
          remove: args.remove,
        });
        return ok(
          `Labeled ${res.target} id:${res.id}.` +
            (res.added.length ? `  added: ${res.added.join(', ')}` : '') +
            (res.removed.length ? `  removed: ${res.removed.join(', ')}` : '') +
            (res.labelIds ? `\nlabels now: ${res.labelIds.join(', ')}` : ''),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'mail_archive',
    {
      description:
        'Archive a message or thread (exactly one id): removes the INBOX label so it leaves the inbox but stays searchable. This is the strongest removal v1 allows — there is NO delete by design.',
      inputSchema: {
        message_id: z.string().optional().describe('Message id to archive (mutually exclusive with thread_id).'),
        thread_id: z.string().optional().describe('Thread id to archive (mutually exclusive with message_id).'),
      },
    },
    async (args) => {
      try {
        const res = await archive({ message_id: args.message_id, thread_id: args.thread_id });
        return ok(`Archived ${res.target} id:${res.id} (INBOX removed).`);
      } catch (err) {
        return fail(err);
      }
    },
  );
}
