// Gmail API client for the Gmail integration. Shared by the MCP
// (tools.ts) and the CLI (cli.ts) — the single place that knows how to talk to
// Gmail. No auth code here (that's auth.ts), no presentation code (that's the
// frontends). Just typed functions over the endpoints we use.
//
// THE GOOGLE ERROR SHAPE: Google APIs put failures in the **HTTP status** plus
// a JSON `error` body ({ error: { code, message, status } }) — the opposite of
// Every call routes through `callGmail`, which throws a GmailApiError carrying
// the HTTP status and Google's message — so callers can rely on try/catch.
//
// Everything is scoped to ONE mailbox: the base path is users/me, and "me" is
// whoever the refresh token was minted as — your own account. There is no way
// to reach another mailbox from here — that's the point of the auth design.


import { randomBytes } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { basename, resolve, sep } from 'node:path';

import { authHeaders, loadCredentials } from './auth';

export const API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

// ──────────────────────────────────────────────────────────────────────────────
// Result types (only the fields we surface)
// ──────────────────────────────────────────────────────────────────────────────

export interface Profile {
  emailAddress?: string;
  messagesTotal?: number;
  threadsTotal?: number;
}

export interface MessageRow {
  id: string;
  threadId?: string;
  date?: string;
  from?: string;
  to?: string;
  subject?: string;
  snippet?: string;
  labelIds?: string[];
}

export interface ThreadMessage {
  id: string;
  from?: string;
  to?: string;
  cc?: string;
  date?: string;
  subject?: string;
  labelIds?: string[];
  body: string;
}

export interface ThreadResult {
  id: string;
  messages: ThreadMessage[];
}

export interface SendResult {
  id?: string;
  threadId?: string;
  labelIds?: string[];
}

export interface DraftResult {
  draft_id?: string;
  message_id?: string;
  threadId?: string;
}

export interface GmailLabel {
  id: string;
  name: string;
  type?: string;
}

export interface ModifyResult {
  id: string;
  target: 'message' | 'thread';
  added: string[];
  removed: string[];
  labelIds?: string[];
}

export interface Paged<T> {
  items: T[];
  next_page_token?: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Low-level call helper
// ──────────────────────────────────────────────────────────────────────────────

export class GmailApiError extends Error {
  constructor(
    public op: string,
    public status: number,
    public googleMessage: string,
  ) {
    super(`Gmail API ${op} failed (HTTP ${status}): ${googleMessage}`);
    this.name = 'GmailApiError';
  }
}

interface GmailErrorBody {
  error?: { code?: number; message?: string; status?: string };
}

type ParamVal = string | number | boolean | undefined | string[];

// GET for reads (params in the query string; repeated params — e.g.
// metadataHeaders — are appended once per value), POST for writes (JSON body).
// The HTTP status carries the error; the JSON error body carries the message.
async function callGmail(
  path: string,
  opts: { method?: string; params?: Record<string, ParamVal>; body?: Record<string, unknown> } = {},
): Promise<Record<string, unknown>> {
  const url = new URL(`${API_BASE}/${path}`);
  for (const [k, v] of Object.entries(opts.params ?? {})) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      for (const item of v) url.searchParams.append(k, item);
    } else {
      url.searchParams.set(k, String(v));
    }
  }

  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
  const res = await fetch(url, {
    method,
    headers: await authHeaders(
      opts.body !== undefined ? { 'Content-Type': 'application/json; charset=utf-8' } : {},
    ),
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });

  if (!res.ok) {
    let message = `http_${res.status}`;
    try {
      const data = (await res.json()) as GmailErrorBody;
      if (data.error?.message) message = data.error.message;
    } catch {
      // non-JSON error body; keep the status-only message
    }
    throw new GmailApiError(`${method} ${path}`, res.status, message);
  }

  const text = await res.text();
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

// ──────────────────────────────────────────────────────────────────────────────
// Header + MIME decoding helpers
// ──────────────────────────────────────────────────────────────────────────────

interface RawHeader {
  name?: string;
  value?: string;
}

interface RawPart {
  mimeType?: string;
  headers?: RawHeader[];
  body?: { data?: string; size?: number };
  parts?: RawPart[];
}

interface RawMessage {
  id?: string;
  threadId?: string;
  snippet?: string;
  labelIds?: string[];
  payload?: RawPart;
}

function headerOf(headers: RawHeader[] | undefined, name: string): string | undefined {
  const lower = name.toLowerCase();
  return headers?.find((h) => (h.name ?? '').toLowerCase() === lower)?.value;
}

// Decode RFC 2047 encoded-words (=?charset?B|Q?...?=) in From/Subject headers
// so non-ASCII senders/subjects read as text, not base64 soup. Best-effort:
// UTF-8 and Latin-1 cover essentially all real mail; unknown charsets fall
// through untouched.
export function decodeEncodedWords(value: string): string {
  return value
    .replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=\s*(?==\?)/g, '=?$1?$2?$3?=') // join adjacent words
    .replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (match, charset: string, enc: string, text: string) => {
      try {
        let bytes: Buffer;
        if (enc.toLowerCase() === 'b') {
          bytes = Buffer.from(text, 'base64');
        } else {
          const out: number[] = [];
          for (let i = 0; i < text.length; i++) {
            const c = text[i];
            if (c === '_') out.push(0x20);
            else if (c === '=' && i + 2 < text.length) {
              out.push(parseInt(text.slice(i + 1, i + 3), 16));
              i += 2;
            } else out.push(text.charCodeAt(i));
          }
          bytes = Buffer.from(out);
        }
        return /iso-8859-1|latin1|windows-1252/i.test(charset)
          ? bytes.toString('latin1')
          : bytes.toString('utf8');
      } catch {
        return match;
      }
    });
}

function decodeB64Url(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf8');
}

// Best-effort text/html → plain text: drop script/style, turn structural tags
// into line breaks, strip the rest, decode the common entities. Not a
// renderer — just enough to read a notification email.
function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Walk the MIME tree collecting the first text/plain and first text/html
// leaves. Plain wins; html is the stripped fallback.
function extractBody(payload: RawPart | undefined): string {
  const found: { plain?: string; html?: string } = {};
  const walk = (part: RawPart): void => {
    for (const child of part.parts ?? []) walk(child);
    const mime = part.mimeType ?? '';
    const data = part.body?.data;
    if (!data) return;
    if (mime.startsWith('text/plain') && found.plain === undefined) found.plain = decodeB64Url(data);
    else if (mime.startsWith('text/html') && found.html === undefined) found.html = decodeB64Url(data);
  };
  if (payload) walk(payload);
  if (found.plain !== undefined) return found.plain.trim();
  if (found.html !== undefined) return stripHtml(found.html);
  return '(no text body)';
}

function toRow(msg: RawMessage): MessageRow {
  const h = msg.payload?.headers;
  return {
    id: msg.id ?? '',
    threadId: msg.threadId,
    date: headerOf(h, 'Date'),
    from: decodeEncodedWords(headerOf(h, 'From') ?? ''),
    to: decodeEncodedWords(headerOf(h, 'To') ?? ''),
    subject: decodeEncodedWords(headerOf(h, 'Subject') ?? ''),
    snippet: msg.snippet,
    labelIds: msg.labelIds,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// MIME building (RFC 2822 + RFC 2047 headers, base64url raw for the API)
// ──────────────────────────────────────────────────────────────────────────────

// RFC 2047 B-encode a header value when it contains non-ASCII; printable
// ASCII passes through untouched.
function encodeWord(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

// Encode one address, RFC 2047-encoding the display name if present
// ("Nombre Ñoño <a@b.co>" → "=?UTF-8?B?...?= <a@b.co>").
function encodeAddress(addr: string): string {
  const m = addr.trim().match(/^(.*)<([^<>]+)>$/);
  if (!m) return addr.trim();
  const name = m[1].trim().replace(/^"(.*)"$/, '$1');
  if (!name) return `<${m[2].trim()}>`;
  const encoded = /^[\x20-\x7e]*$/.test(name)
    ? /^[A-Za-z0-9 .'-]*$/.test(name)
      ? name
      : `"${name.replace(/"/g, '\\"')}"`
    : encodeWord(name);
  return `${encoded} <${m[2].trim()}>`;
}

function toList(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr
    .flatMap((s) => s.split(','))
    .map((s) => s.trim())
    .filter(Boolean);
}

// Body lines ride as base64 (wrapped at 76 cols) — immune to line-length and
// bare-CRLF pitfalls regardless of what the model puts in the body.
function b64Body(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  return buf.toString('base64').replace(/(.{76})/g, '$1\r\n');
}

// Content-Type by extension for attachments; anything unknown ships as
// application/octet-stream (Gmail sniffs for preview anyway).
const ATTACHMENT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  html: 'text/html',
  zip: 'application/zip',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

// Gmail rejects messages over 25MB total; guard on the base64-encoded
// attachment bytes (what actually ships on the wire) so the caller gets a
// clear local error instead of an opaque HTTP 413.
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

// MIME parameter values can't carry RFC 2047 encoded-words (that syntax is
// for unstructured header text). ASCII names go plain-quoted; non-ASCII names
// get an ASCII fallback plus the RFC 5987 extended form (attr*=UTF-8''pct).
function mimeParam(attr: string, value: string): string {
  const quoted = (s: string) => `${attr}="${s.replace(/"/g, "'")}"`;
  if (/^[\x20-\x7e]*$/.test(value)) return quoted(value);
  const pct = encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${quoted(value.replace(/[^\x20-\x7e]/g, '_'))}; ${attr}*=UTF-8''${pct}`;
}

export interface ComposeArgs {
  to: string | string[];
  subject: string;
  body: string;
  cc?: string | string[];
  bcc?: string | string[];
  reply_to_message_id?: string;
  thread_id?: string;
  html?: boolean;
  attachments?: string | string[];
}

// Attachment paths are NOT comma-split (paths may contain commas) — a string
// is one path, an array is one path per entry.
function toAttachmentList(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return (Array.isArray(v) ? v : [v]).map((s) => s.trim()).filter(Boolean);
}

// Attachments may only come from ONE allowed directory (GMAIL_ATTACHMENT_DIR,
// default: the process working directory). These paths are model-supplied, so
// without a fence anything the process can read — SSH keys, browser profiles,
// /etc/passwd — could be attached and mailed out by a hostile prompt. Both
// sides go through realpath so a symlink inside the fence can't point out.
function resolveAttachmentPath(path: string): string {
  const base = realpathSync(resolve(process.env.GMAIL_ATTACHMENT_DIR ?? process.cwd()));
  let real: string;
  try {
    real = realpathSync(resolve(base, path));
  } catch {
    throw new Error(`Attachment not found or unreadable: ${path}`);
  }
  if (real !== base && !real.startsWith(base + sep)) {
    throw new Error(
      `Attachment is outside the allowed directory (${base}): ${path}. ` +
        'Move the file there, or point GMAIL_ATTACHMENT_DIR at the folder you attach from.',
    );
  }
  return real;
}

// Read each file and render it as a multipart/mixed part: base64 payload,
// Content-Type by extension, Content-Disposition: attachment with RFC 5987
// filename parameters.
function buildAttachmentParts(paths: string[]): string[][] {
  let total = 0;
  return paths.map((path) => {
    const real = resolveAttachmentPath(path);
    let data: Buffer;
    try {
      data = readFileSync(real);
    } catch {
      throw new Error(`Attachment not found or unreadable: ${path}`);
    }
    const payload = b64Body(data);
    total += payload.length;
    if (total > MAX_ATTACHMENT_BYTES) {
      throw new Error(
        `Attachments exceed Gmail's 25MB message limit (${Math.round(total / 1024 / 1024)}MB encoded so far at ${path}).`,
      );
    }
    const name = basename(real);
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
    const mimeType = ATTACHMENT_MIME[ext] ?? 'application/octet-stream';
    return [
      `Content-Type: ${mimeType}; ${mimeParam('name', name)}`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; ${mimeParam('filename', name)}`,
      '',
      payload,
    ];
  });
}

interface BuiltMessage {
  raw: string;
  threadId?: string;
}

// Build the RFC 2822 message and resolve threading. When replying, the
// original message's Message-ID header feeds In-Reply-To/References (that's
// what makes mail clients — including Gmail itself — thread the reply), and
// its threadId is inherited unless the caller passed one explicitly.
async function buildMessage(args: ComposeArgs): Promise<BuiltMessage> {
  // The sending address is always the authenticated mailbox — never a
  // configured value, so this tool cannot be pointed at someone else's From.
  // Prefer the account recorded when the token was minted; otherwise ask Gmail
  // who we are. There is deliberately NO hardcoded fallback: a wrong From
  // silently sends mail under the wrong identity.
  const creds = loadCredentials();
  let account = creds.account;
  if (!account) {
    const profile = (await callGmail('profile')) as { emailAddress?: string };
    account = profile.emailAddress;
  }
  if (!account) {
    throw new Error(
      'Could not determine the sending address for this mailbox. Re-run scripts/mint-token.mjs ' +
        'so the credential records its account, or set GMAIL_ACCOUNT.',
    );
  }
  const to = toList(args.to);
  if (!to.length) throw new Error('send/draft requires at least one recipient in `to`.');
  if (!args.subject) throw new Error('send/draft requires a `subject`.');
  if (args.body === undefined || args.body === '') throw new Error('send/draft requires a `body`.');

  let threadId = args.thread_id;
  let inReplyTo: string | undefined;
  let references: string | undefined;
  if (args.reply_to_message_id) {
    const orig = (await callGmail(`messages/${args.reply_to_message_id}`, {
      params: { format: 'metadata', metadataHeaders: ['Message-ID', 'References'] },
    })) as RawMessage;
    const origMsgId = headerOf(orig.payload?.headers, 'Message-ID');
    const origRefs = headerOf(orig.payload?.headers, 'References');
    if (origMsgId) {
      inReplyTo = origMsgId;
      references = origRefs ? `${origRefs} ${origMsgId}` : origMsgId;
    }
    threadId = threadId ?? orig.threadId;
  }

  const headers: string[] = [
    // Display name is opt-in via GMAIL_FROM_NAME. Default to the bare address:
    // this tool must never stamp someone else's name on your outgoing mail.
    `From: ${process.env.GMAIL_FROM_NAME ? encodeAddress(`${process.env.GMAIL_FROM_NAME} <${account}>`) : encodeAddress(account)}`,
    `To: ${to.map(encodeAddress).join(', ')}`,
  ];
  const cc = toList(args.cc);
  const bcc = toList(args.bcc);
  if (cc.length) headers.push(`Cc: ${cc.map(encodeAddress).join(', ')}`);
  if (bcc.length) headers.push(`Bcc: ${bcc.map(encodeAddress).join(', ')}`);
  headers.push(`Subject: ${encodeWord(args.subject)}`);
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
  if (references) headers.push(`References: ${references}`);
  headers.push('MIME-Version: 1.0');

  // The text/html content, expressed as its own headers + body so it can sit
  // either at the top level (no attachments) or as the first part of a
  // multipart/mixed envelope (with attachments).
  const contentHeaders: string[] = [];
  let contentBody: string;
  if (args.html) {
    // multipart/alternative: a stripped-text part first (lowest fidelity),
    // then the HTML the caller supplied.
    const boundary = `=_pappcorn_${randomBytes(12).toString('hex')}`;
    contentHeaders.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    contentBody = [
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64Body(stripHtml(args.body)),
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64Body(args.body),
      `--${boundary}--`,
    ].join('\r\n');
  } else {
    contentHeaders.push('Content-Type: text/plain; charset=UTF-8');
    contentHeaders.push('Content-Transfer-Encoding: base64');
    contentBody = b64Body(args.body);
  }

  let bodyBlock: string;
  const attachmentPaths = toAttachmentList(args.attachments);
  if (attachmentPaths.length) {
    const mixed = `=_pappcorn_mixed_${randomBytes(12).toString('hex')}`;
    headers.push(`Content-Type: multipart/mixed; boundary="${mixed}"`);
    const parts: string[] = [`--${mixed}`, ...contentHeaders, '', contentBody];
    for (const part of buildAttachmentParts(attachmentPaths)) {
      parts.push(`--${mixed}`, ...part);
    }
    parts.push(`--${mixed}--`);
    bodyBlock = parts.join('\r\n');
  } else {
    headers.push(...contentHeaders);
    bodyBlock = contentBody;
  }

  const mime = `${headers.join('\r\n')}\r\n\r\n${bodyBlock}`;
  return { raw: Buffer.from(mime, 'utf8').toString('base64url'), threadId };
}

// ──────────────────────────────────────────────────────────────────────────────
// API operations
// ──────────────────────────────────────────────────────────────────────────────

// whoami — confirm the grant and report mailbox identity. Never returns any
// credential field.
export async function getProfile(): Promise<Profile> {
  const data = await callGmail('profile');
  return {
    emailAddress: data.emailAddress as string | undefined,
    messagesTotal: data.messagesTotal as number | undefined,
    threadsTotal: data.threadsTotal as number | undefined,
  };
}

// Search messages with Gmail's query syntax (from:, to:, subject:, label:,
// newer_than:, is:unread, …). messages.list returns bare ids; each is
// hydrated in parallel via format=metadata to get From/To/Subject/Date.
export async function search(opts: {
  q?: string;
  label_ids?: string[];
  max?: number;
  page_token?: string;
}): Promise<Paged<MessageRow>> {
  const list = await callGmail('messages', {
    params: {
      q: opts.q,
      labelIds: opts.label_ids,
      maxResults: opts.max ?? 20,
      pageToken: opts.page_token,
    },
  });
  const stubs = (list.messages as Array<{ id: string }> | undefined) ?? [];
  const rows = await Promise.all(
    stubs.map(async (stub) => {
      const msg = (await callGmail(`messages/${stub.id}`, {
        params: { format: 'metadata', metadataHeaders: ['From', 'To', 'Subject', 'Date'] },
      })) as RawMessage;
      return toRow(msg);
    }),
  );
  return { items: rows, next_page_token: list.nextPageToken as string | undefined };
}

// Read a full thread: every message's From/To/Cc/Date/Subject plus a
// best-effort text body (prefer text/plain; fall back to stripped text/html).
export async function readThread(opts: { thread_id: string }): Promise<ThreadResult> {
  const data = await callGmail(`threads/${opts.thread_id}`, { params: { format: 'full' } });
  const messages = ((data.messages as RawMessage[] | undefined) ?? []).map((msg): ThreadMessage => {
    const h = msg.payload?.headers;
    return {
      id: msg.id ?? '',
      from: decodeEncodedWords(headerOf(h, 'From') ?? ''),
      to: decodeEncodedWords(headerOf(h, 'To') ?? ''),
      cc: headerOf(h, 'Cc') ? decodeEncodedWords(headerOf(h, 'Cc') ?? '') : undefined,
      date: headerOf(h, 'Date'),
      subject: decodeEncodedWords(headerOf(h, 'Subject') ?? ''),
      labelIds: msg.labelIds,
      body: extractBody(msg.payload),
    };
  });
  return { id: (data.id as string | undefined) ?? opts.thread_id, messages };
}

// Send an email (OUTWARD-FACING — frontends confirm with the user first).
export async function send(args: ComposeArgs): Promise<SendResult> {
  const built = await buildMessage(args);
  const data = await callGmail('messages/send', {
    body: { raw: built.raw, ...(built.threadId ? { threadId: built.threadId } : {}) },
  });
  return {
    id: data.id as string | undefined,
    threadId: data.threadId as string | undefined,
    labelIds: data.labelIds as string[] | undefined,
  };
}

// Create a draft (same composition as send; lands in Drafts, nothing goes out).
export async function draft(args: ComposeArgs): Promise<DraftResult> {
  const built = await buildMessage(args);
  const data = await callGmail('drafts', {
    body: { message: { raw: built.raw, ...(built.threadId ? { threadId: built.threadId } : {}) } },
  });
  const message = data.message as { id?: string; threadId?: string } | undefined;
  return { draft_id: data.id as string | undefined, message_id: message?.id, threadId: message?.threadId };
}

// ──────────────────────────────────────────────────────────────────────────────
// Labels
// ──────────────────────────────────────────────────────────────────────────────

export async function listLabels(): Promise<GmailLabel[]> {
  const data = await callGmail('labels');
  return ((data.labels as GmailLabel[] | undefined) ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    type: l.type,
  }));
}

// Find a label by name (case-insensitive) or create it. Nested labels use "/"
// (the taxonomy convention: partners/<slug>, soporte, plataformas, facturación).
export async function ensureLabel(name: string): Promise<GmailLabel> {
  const labels = await listLabels();
  const found = labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
  if (found) return found;
  const data = await callGmail('labels', {
    body: { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' },
  });
  return { id: data.id as string, name: data.name as string, type: data.type as string | undefined };
}

// Resolve label NAMES (or raw ids) to ids. Labels being ADDED are auto-created
// when missing; labels being REMOVED must exist (you can't remove a label the
// mailbox doesn't have — that's a caller error worth surfacing).
async function resolveLabelIds(names: string[], createMissing: boolean): Promise<string[]> {
  const ids: string[] = [];
  let labels = await listLabels();
  for (const name of names) {
    const found = labels.find(
      (l) => l.name.toLowerCase() === name.toLowerCase() || l.id === name,
    );
    if (found) {
      ids.push(found.id);
    } else if (createMissing) {
      const created = await ensureLabel(name);
      ids.push(created.id);
      labels = [...labels, created];
    } else {
      throw new Error(`Label "${name}" not found in the mailbox (run listLabels to see what exists).`);
    }
  }
  return ids;
}

// Add/remove labels on a message OR a whole thread (exactly one target).
export async function modifyLabels(opts: {
  message_id?: string;
  thread_id?: string;
  add?: string[];
  remove?: string[];
}): Promise<ModifyResult> {
  const hasMessage = Boolean(opts.message_id);
  const hasThread = Boolean(opts.thread_id);
  if (hasMessage === hasThread) {
    throw new Error('modifyLabels requires exactly one of message_id or thread_id.');
  }
  const add = opts.add ?? [];
  const remove = opts.remove ?? [];
  if (!add.length && !remove.length) {
    throw new Error('modifyLabels requires at least one label in add or remove.');
  }
  const addLabelIds = add.length ? await resolveLabelIds(add, true) : [];
  const removeLabelIds = remove.length ? await resolveLabelIds(remove, false) : [];
  const path = opts.message_id
    ? `messages/${opts.message_id}/modify`
    : `threads/${opts.thread_id}/modify`;
  const data = await callGmail(path, {
    body: {
      ...(addLabelIds.length ? { addLabelIds } : {}),
      ...(removeLabelIds.length ? { removeLabelIds } : {}),
    },
  });
  return {
    id: (data.id as string | undefined) ?? (opts.message_id || opts.thread_id || ''),
    target: opts.message_id ? 'message' : 'thread',
    added: add,
    removed: remove,
    labelIds: data.labelIds as string[] | undefined,
  };
}

// Archive = remove INBOX (never delete — v1 has no delete by design).
export async function archive(opts: { message_id?: string; thread_id?: string }): Promise<ModifyResult> {
  const hasMessage = Boolean(opts.message_id);
  const hasThread = Boolean(opts.thread_id);
  if (hasMessage === hasThread) {
    throw new Error('archive requires exactly one of message_id or thread_id.');
  }
  const path = opts.message_id
    ? `messages/${opts.message_id}/modify`
    : `threads/${opts.thread_id}/modify`;
  const data = await callGmail(path, { body: { removeLabelIds: ['INBOX'] } });
  return {
    id: (data.id as string | undefined) ?? (opts.message_id || opts.thread_id || ''),
    target: opts.message_id ? 'message' : 'thread',
    added: [],
    removed: ['INBOX'],
    labelIds: data.labelIds as string[] | undefined,
  };
}
