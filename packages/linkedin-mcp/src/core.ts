// Typed LinkedIn operations — the shared core behind tools.ts (MCP) and cli.ts.
// Each function is one deliberate thing the connector can do AS THE PAGE.
// There is no delete and no edit: a published post or comment is removed by a
// human in LinkedIn itself (CONTRIBUTING rule 5 — destructive operations stay
// out).
//
// Endpoints, checked against LinkedIn's Marketing API docs (version 202610) on
// 2026-10-29:
//   posts          POST /rest/posts · GET /rest/posts?q=author
//   images         POST /rest/images?action=initializeUpload → PUT bytes → GET status
//   documents      POST /rest/documents?action=initializeUpload → PUT bytes → GET status
//   comments       GET/POST /rest/socialActions/{post or comment URN}/comments
//   mentions       GET /rest/organizations?q=vanityName · GET /rest/organizations/{id}
//                  (resolution lives in mentions.ts; checked 2026-11-12)
//   page           GET /rest/organizations/{id}
//   followers      GET /rest/networkSizes/{org URN}?edgeType=COMPANY_FOLLOWED_BY_MEMBER
//   share stats    GET /rest/organizationalEntityShareStatistics?q=organizationalEntity

import { createHash } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname } from 'node:path';

import {
  encodeUrn,
  LinkedInApiError,
  request,
  restliList,
  uploadBinary,
} from './api';
import { loadConfig } from './config';
import { commentMessage, postCommentary, type Piece } from './mentions';

// ──────────────────────────────────────────────────────────────────────────────
// Limits
// ──────────────────────────────────────────────────────────────────────────────

/** LinkedIn's limit for a post. Counted as in 0.1.0: characters (code points)
 *  of the text as readers see it, a mention counting as the name it shows.
 *  Checking here gives the human a clear error at preview time instead of at
 *  publish time. LinkedIn validates the commentary it receives, escapes and
 *  mention markup included, in a unit it does not document: when that is
 *  longer than this limit, the preview warns that LinkedIn may refuse the post
 *  (FIELD_LENGTH_TOO_LONG), but does not refuse it here. */
export const MAX_POST_CHARS = 3000;

/** LinkedIn's limit for a comment in its own interface, counted the same way
 *  as MAX_POST_CHARS, on the text with mentions expanded to their names. */
export const MAX_COMMENT_CHARS = 1250;

/** Characters, as MAX_POST_CHARS and MAX_COMMENT_CHARS count them. */
export function charCount(text: string): number {
  return Array.from(text).length;
}

export const IMAGE_TYPES: Record<string, string> = {
  '.jpg': 'JPG',
  '.jpeg': 'JPG',
  '.png': 'PNG',
  '.gif': 'GIF',
};
export const DOCUMENT_TYPES: Record<string, string> = {
  '.pdf': 'PDF',
  '.ppt': 'PPT',
  '.pptx': 'PPTX',
  '.doc': 'DOC',
  '.docx': 'DOCX',
};
/** Documents API: at most 100 MB and 300 pages. Pages are checked by LinkedIn. */
export const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;
/** The Images API documents a pixel cap, not a byte cap. This is a sanity
 *  ceiling so a wrong path (a video, a disk image) fails before any upload. */
export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;

// ──────────────────────────────────────────────────────────────────────────────
// little text format
// ──────────────────────────────────────────────────────────────────────────────

// Post commentary is parsed as LinkedIn's "little" format, where these
// characters are reserved and must be backslash-escaped to appear literally —
// even outside a mention or template. Unescaped, LinkedIn silently drops or
// misreads text (a stray "(" or "_" is enough).
const LITTLE_RESERVED = new Set([
  '|',
  '{',
  '}',
  '@',
  '[',
  ']',
  '(',
  ')',
  '<',
  '>',
  '#',
  '\\',
  '*',
  '_',
  '~',
]);

/** Escape plain text for a post's commentary. One exception, deliberately: a
 *  "#" that starts a word (#hashtag) is left alone, because that is how a
 *  hashtag is written in little format and people expect hashtags to work.
 *  "@" is always escaped here: mentions are recognized BEFORE this runs (see
 *  mentions.ts) and never pass through it. `before` is the character that
 *  precedes `text` in the full commentary, so a "#" right after a mention is
 *  judged in context. */
export function escapeLittle(text: string, before = ''): string {
  const chars = Array.from(text);
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c === '#') {
      const prev = i === 0 ? before : chars[i - 1];
      const next = chars[i + 1] ?? '';
      const startsWord = prev === '' || /[\s([{"'¡¿]/u.test(prev);
      if (startsWord && /[\p{L}\p{N}]/u.test(next)) {
        out += c;
        continue;
      }
    }
    out += LITTLE_RESERVED.has(c) ? `\\${c}` : c;
  }
  return out;
}

/** Whether text holds a character little format reserves. A mention's name that
 *  does is escaped, and whether LinkedIn still matches it is unverified. */
export function hasLittleReserved(text: string): boolean {
  return Array.from(text).some((c) => LITTLE_RESERVED.has(c));
}

/** Escape every reserved character, hashtags included: for a mention's name,
 *  which is matched against LinkedIn's name for the entity, never a hashtag. */
export function escapeLittleAll(text: string): string {
  return Array.from(text)
    .map((c) => (LITTLE_RESERVED.has(c) ? `\\${c}` : c))
    .join('');
}

// ──────────────────────────────────────────────────────────────────────────────
// Media files
// ──────────────────────────────────────────────────────────────────────────────

export interface LocalMedia {
  kind: 'image' | 'document';
  path: string;
  name: string;
  type: string;
  bytes: number;
  /** sha256 of the file content — what a confirmation is bound to. */
  sha256: string;
}

/** Read and validate a local media file. The content digest is what the
 *  confirmation gate binds to, so swapping the file between preview and
 *  publish invalidates the approval. */
export function inspectMedia(
  kind: 'image' | 'document',
  path: string,
): LocalMedia & { data: Buffer } {
  const table = kind === 'image' ? IMAGE_TYPES : DOCUMENT_TYPES;
  const ext = extname(path).toLowerCase();
  const type = table[ext];
  if (!type) {
    throw new Error(
      `${basename(path)}: unsupported ${kind} type "${ext || '(none)'}". Allowed: ${Object.keys(
        table,
      ).join(', ')}.`,
    );
  }
  // One descriptor for the check and the read, so what was checked is what gets
  // hashed and uploaded even if the path changes underneath us.
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch {
    throw new Error(`Cannot read ${kind} file: ${path}`);
  }
  let data: Buffer;
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw new Error(`Cannot read ${kind} file: ${path}`);
    const max = kind === 'image' ? MAX_IMAGE_BYTES : MAX_DOCUMENT_BYTES;
    if (st.size === 0) throw new Error(`${basename(path)} is empty.`);
    if (st.size > max) {
      throw new Error(
        `${basename(path)} is ${(st.size / 1048576).toFixed(1)} MB; the limit is ${max / 1048576} MB.`,
      );
    }
    data = readFileSync(fd);
  } finally {
    closeSync(fd);
  }
  return {
    kind,
    path,
    name: basename(path),
    type,
    bytes: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
    data,
  };
}

interface InitializeUploadResponse {
  value: {
    uploadUrl: string;
    uploadUrlExpiresAt?: number;
    image?: string;
    document?: string;
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How long to wait for LinkedIn to finish processing an upload before giving
 *  up. A post created against an asset that is not AVAILABLE can end up
 *  invisible, so the connector waits rather than publishing blind. */
export const UPLOAD_POLL = { attempts: 30, intervalMs: 2000 };

/** Upload an image or document as the Page and wait until LinkedIn reports it
 *  AVAILABLE. Returns the asset URN (urn:li:image:… / urn:li:document:…). */
export async function uploadMedia(
  media: LocalMedia & { data: Buffer },
): Promise<string> {
  const { organization } = loadConfig();
  const resource = media.kind === 'image' ? 'images' : 'documents';
  const init = await request<InitializeUploadResponse>('POST', resource, {
    query: 'action=initializeUpload',
    body: { initializeUploadRequest: { owner: organization } },
  });
  const urn =
    media.kind === 'image' ? init.body.value?.image : init.body.value?.document;
  const uploadUrl = init.body.value?.uploadUrl;
  if (!urn || !uploadUrl) {
    throw new LinkedInApiError(
      `LinkedIn did not return an upload URL for the ${media.kind}.`,
      0,
    );
  }

  await uploadBinary(uploadUrl, media.data);

  for (let i = 0; i < UPLOAD_POLL.attempts; i++) {
    const st = await request<{ status?: string }>(
      'GET',
      `${resource}/${encodeUrn(urn)}`,
    );
    const status = st.body.status;
    if (status === 'AVAILABLE') return urn;
    if (status === 'PROCESSING_FAILED') {
      throw new LinkedInApiError(
        `LinkedIn could not process ${media.name} (PROCESSING_FAILED). Check the format and ` +
          (media.kind === 'document'
            ? 'that it has at most 300 pages.'
            : 'that it has fewer than 36 million pixels.'),
        0,
      );
    }
    await sleep(UPLOAD_POLL.intervalMs);
  }
  throw new LinkedInApiError(
    `${media.name} was uploaded but LinkedIn had not finished processing it after ` +
      `${(UPLOAD_POLL.attempts * UPLOAD_POLL.intervalMs) / 1000}s. Nothing was published.`,
    0,
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────────────────

export interface PageInfo {
  urn: string;
  id: string;
  name?: string;
  vanityName?: string;
  primaryOrganizationType?: string;
}

export function organizationId(urn: string): string {
  return urn.slice(urn.lastIndexOf(':') + 1);
}

export async function getPage(): Promise<PageInfo> {
  const { organization } = loadConfig();
  const id = organizationId(organization);
  const res = await request<{
    localizedName?: string;
    vanityName?: string;
    primaryOrganizationType?: string;
  }>('GET', `organizations/${id}`);
  return {
    urn: organization,
    id,
    name: res.body.localizedName,
    vanityName: res.body.vanityName,
    primaryOrganizationType: res.body.primaryOrganizationType,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Posts
// ──────────────────────────────────────────────────────────────────────────────

export interface PostSummary {
  id: string;
  createdAt?: number;
  publishedAt?: number;
  lifecycleState?: string;
  commentary?: string;
  media?: string;
  url: string;
}

export function postUrl(urn: string): string {
  return `https://www.linkedin.com/feed/update/${urn}/`;
}

interface RawPost {
  id: string;
  createdAt?: number;
  publishedAt?: number;
  lifecycleState?: string;
  commentary?: string;
  content?: {
    media?: { id?: string; title?: string };
    multiImage?: unknown;
    article?: { source?: string };
    poll?: unknown;
  };
}

function mediaLabel(p: RawPost): string | undefined {
  const c = p.content;
  if (!c) return undefined;
  if (c.media?.id) {
    const kind = c.media.id.split(':')[2] ?? 'media';
    return c.media.title ? `${kind} "${c.media.title}"` : kind;
  }
  if (c.multiImage) return 'multiImage';
  if (c.article) return `article ${c.article.source ?? ''}`.trim();
  if (c.poll) return 'poll';
  return undefined;
}

export async function listPosts(count = 10, start = 0): Promise<PostSummary[]> {
  const { organization } = loadConfig();
  const res = await request<{ elements?: RawPost[] }>('GET', 'posts', {
    query: `author=${encodeUrn(organization)}&q=author&count=${count}&start=${start}&sortBy=LAST_MODIFIED`,
    restliMethod: 'FINDER',
  });
  return (res.body.elements ?? []).map((p) => ({
    id: p.id,
    createdAt: p.createdAt,
    publishedAt: p.publishedAt,
    lifecycleState: p.lifecycleState,
    commentary: p.commentary,
    media: mediaLabel(p),
    url: postUrl(p.id),
  }));
}

export interface NewPost {
  /** The text the human approved, with its mentions resolved, as
   *  mentions.ts:composeText returns it. Escaped here, not before. */
  pieces: Piece[];
  media?: {
    urn: string;
    kind: 'image' | 'document';
    altText?: string;
    title?: string;
  };
}

export function buildPostBody(
  organization: string,
  post: NewPost,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    author: organization,
    commentary: commentaryOf(post.pieces),
    visibility: 'PUBLIC',
    distribution: {
      feedDistribution: 'MAIN_FEED',
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  };
  if (post.media) {
    const media: Record<string, string> = { id: post.media.urn };
    if (post.media.kind === 'image' && post.media.altText)
      media.altText = post.media.altText;
    if (post.media.kind === 'document' && post.media.title)
      media.title = post.media.title;
    body.content = { media };
  }
  return body;
}

/** The commentary exactly as LinkedIn receives it: little format, escaped,
 *  with mentions as @[Name](urn). */
export function commentaryOf(pieces: Piece[]): string {
  return postCommentary(pieces, escapeLittle, escapeLittleAll);
}

/** Publish a post as the Page. Returns the new post's URN. */
export async function createPost(post: NewPost): Promise<string> {
  const { organization } = loadConfig();
  const res = await request('POST', 'posts', {
    body: buildPostBody(organization, post),
  });
  if (!res.restliId) {
    throw new LinkedInApiError(
      'LinkedIn accepted the post but returned no id. Check the Page before retrying, ' +
        'so it is not published twice.',
      res.status,
    );
  }
  return res.restliId;
}

// ──────────────────────────────────────────────────────────────────────────────
// Comments
// ──────────────────────────────────────────────────────────────────────────────

export interface CommentSummary {
  urn: string;
  id: string;
  actor: string;
  byPage: boolean;
  createdAt?: number;
  text: string;
  parentComment?: string;
  object?: string;
}

interface RawComment {
  id: string;
  commentUrn?: string;
  actor: string;
  object?: string;
  parentComment?: string;
  created?: { time?: number };
  message?: { text?: string };
}

const POST_URN = /^urn:li:(share|ugcPost):\d+$/;
const COMMENT_URN =
  /^urn:li:comment:\(urn:li:(activity|share|ugcPost):\d+,\d+\)$/;

export function assertPostUrn(urn: string): void {
  if (!POST_URN.test(urn)) {
    throw new Error(
      `"${urn}" is not a post URN. Expected urn:li:share:<id> or urn:li:ugcPost:<id> ` +
        '(linkedin_list_posts returns them).',
    );
  }
}

export function assertCommentUrn(urn: string): void {
  if (!COMMENT_URN.test(urn)) {
    throw new Error(
      `"${urn}" is not a comment URN. Expected urn:li:comment:(urn:li:activity:<id>,<id>) ` +
        '(linkedin_list_comments returns them).',
    );
  }
}

/** A reply lands in its parent comment's thread, whatever post_urn says. When
 *  the parent's URN names its post, refuse a mismatch, so a preview can never
 *  promise one post and publish under another. An activity-form URN does not
 *  name its post, so that case cannot be checked from the URNs alone. */
export function assertReplyMatchesPost(postUrn: string, parent: string): void {
  const m = /^urn:li:comment:\((urn:li:(?:share|ugcPost):\d+),\d+\)$/.exec(
    parent,
  );
  if (m && m[1] !== postUrn) {
    throw new Error(
      `That comment belongs to ${m[1]}, not to ${postUrn}. Nothing was published.`,
    );
  }
}

/** Comments on a post, or replies to a comment when given a comment URN. */
export async function listComments(
  target: string,
  count = 20,
  start = 0,
): Promise<CommentSummary[]> {
  const { organization } = loadConfig();
  const res = await request<{ elements?: RawComment[] }>(
    'GET',
    `socialActions/${encodeUrn(target)}/comments`,
    { query: `count=${count}&start=${start}` },
  );
  return (res.body.elements ?? []).map((c) => ({
    urn: c.commentUrn ?? c.id,
    id: c.id,
    actor: c.actor,
    byPage: c.actor === organization,
    createdAt: c.created?.time,
    text: c.message?.text ?? '',
    parentComment: c.parentComment,
    object: c.object,
  }));
}

export interface NewComment {
  postUrn: string;
  /** Set to reply to a comment; omit for a top-level comment on the post. */
  parentCommentUrn?: string;
  /** The text the human approved, with its mentions resolved. */
  pieces: Piece[];
}

export function buildCommentBody(
  organization: string,
  c: NewComment,
): Record<string, unknown> {
  const message = commentMessage(c.pieces);
  const body: Record<string, unknown> = {
    actor: organization,
    object: c.postUrn,
    // Comments are not little format: a mention is an attribute over the
    // plain text, and a comment without one is sent exactly as before.
    message: message.attributes.length ? message : { text: message.text },
  };
  if (c.parentCommentUrn) body.parentComment = c.parentCommentUrn;
  return body;
}

/** Comment (or reply) as the Page. Returns the new comment's URN when LinkedIn
 *  sends it back, else its id. */
export async function createComment(c: NewComment): Promise<string> {
  const { organization } = loadConfig();
  const target = c.parentCommentUrn ?? c.postUrn;
  const res = await request<{ commentUrn?: string; id?: string }>(
    'POST',
    `socialActions/${encodeUrn(target)}/comments`,
    { body: buildCommentBody(organization, c) },
  );
  return (
    res.body.commentUrn ?? res.restliId ?? res.body.id ?? '(no id returned)'
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Analytics
// ──────────────────────────────────────────────────────────────────────────────

export interface ShareStats {
  impressionCount?: number;
  uniqueImpressionsCount?: number;
  clickCount?: number;
  likeCount?: number;
  commentCount?: number;
  shareCount?: number;
  engagement?: number;
}

export interface PageStats {
  followers?: number;
  lifetime?: ShareStats;
  posts: Array<{ urn: string; stats: ShareStats }>;
}

interface RawShareStatsElement {
  share?: string;
  ugcPost?: string;
  totalShareStatistics?: ShareStats;
}

export async function pageStats(postUrns: string[] = []): Promise<PageStats> {
  const { organization } = loadConfig();
  postUrns.forEach(assertPostUrn);

  const followers = await request<{ firstDegreeSize?: number }>(
    'GET',
    `networkSizes/${encodeUrn(organization)}`,
    { query: 'edgeType=COMPANY_FOLLOWED_BY_MEMBER' },
  );

  const base = `q=organizationalEntity&organizationalEntity=${encodeUrn(organization)}`;
  const lifetime = await request<{ elements?: RawShareStatsElement[] }>(
    'GET',
    'organizationalEntityShareStatistics',
    { query: base },
  );

  const posts: PageStats['posts'] = [];
  const shares = postUrns.filter((u) => u.startsWith('urn:li:share:'));
  const ugc = postUrns.filter((u) => u.startsWith('urn:li:ugcPost:'));
  if (shares.length || ugc.length) {
    const parts = [base];
    if (shares.length) parts.push(`shares=${restliList(shares)}`);
    if (ugc.length) parts.push(`ugcPosts=${restliList(ugc)}`);
    const per = await request<{ elements?: RawShareStatsElement[] }>(
      'GET',
      'organizationalEntityShareStatistics',
      { query: parts.join('&') },
    );
    const found = new Map(
      (per.body.elements ?? []).map((e) => [
        e.share ?? e.ugcPost ?? '',
        e.totalShareStatistics ?? {},
      ]),
    );
    // LinkedIn omits posts with no activity; those are zeros, not errors.
    for (const urn of postUrns)
      posts.push({ urn, stats: found.get(urn) ?? {} });
  }

  return {
    followers: followers.body.firstDegreeSize,
    lifetime: lifetime.body.elements?.[0]?.totalShareStatistics,
    posts,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Local audit log
// ──────────────────────────────────────────────────────────────────────────────

export const DEFAULT_LOG_DIR = `${homedir()}/.local/state/pappcorn/linkedin-mcp`;

function logDir(): string {
  return process.env.LINKEDIN_MCP_LOG_DIR || DEFAULT_LOG_DIR;
}

/** Append-only local record of everything published, so "what did the
 *  assistant post, and when?" always has an answer. Best-effort: a logging
 *  failure never fails the publish, but it is reported to the caller. Never
 *  leaves the machine. */
export function logAction(entry: {
  action: 'post' | 'comment';
  organization: string;
  urn: string;
  text: string;
  target?: string;
  media?: { kind: string; name: string; sha256: string };
  mentions?: Array<{ urn: string; name: string }>;
}): { logged: boolean; path: string; error?: string } {
  const dir = logDir();
  const path = `${dir}/actions.jsonl`;
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(
      path,
      `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
      { mode: 0o600 },
    );
    return { logged: true, path };
  } catch (err) {
    return {
      logged: false,
      path,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
