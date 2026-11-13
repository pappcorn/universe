// Mentions: turning "@[Name](target)" in the text a human approved into a real
// LinkedIn tag — linked, clickable, and notifying the mentioned account.
//
// ONE SYNTAX, for posts and comments alike:
//   @[Display Name](urn:li:organization:<id>)
//   @[Display Name](urn:li:organizationBrand:<id>)   (same as organization:<id>)
//   @[Display Name](urn:li:person:<id>)
//   @[Display Name](linkedin.com/company/<vanity>)
//   @[Display Name](linkedin.com/school/<vanity>)
// Anything else keeps being plain text, escaped exactly as before: a bare
// "@handle" is never a mention.
//
// WHY THE CONNECTOR, NOT THE HUMAN, PICKS AN ORGANIZATION'S NAME. LinkedIn only
// turns a mention into a link when the text equals the entity's name as LinkedIn
// has it — case-sensitive, and the full name for organizations. A mismatch is
// not an error: it silently renders as plain text, the exact failure mentions
// exist to remove. So every organization is looked up, and the text published
// is LinkedIn's `localizedName`. The preview shows it next to what the human
// typed. A lookup that does not resolve fails the whole call.
//
// What LinkedIn lets a Development-tier app look up:
//   · by vanity name — GET /rest/organizations?q=vanityName — any organization.
//     An unknown vanity is HTTP 200 with an empty `elements`, not a 404.
//   · by id — GET /rest/organizations/{id} — only organizations the
//     authorizing member administers; any other id answers 403, the same as an
//     id that does not exist. So an organization URN that is not yours fails,
//     and the error points at the vanity form.
//   · people — not at all. A person mention needs an explicit urn:li:person
//     (linkedin_list_comments shows commenters' URNs), and its display name
//     cannot be checked: LinkedIn matches any one of the member's names.
//
// Each distinct target is resolved once and reused between the preview and the
// publish (an in-memory cache that lives as long as a confirm token), so the
// small daily call budget of a Development-tier app is not spent twice.

import { LinkedInApiError, request } from './api';
import { TOKEN_TTL_MS } from './gate';

export type MentionKind = 'organization' | 'school' | 'brand' | 'person';

export interface MentionRef {
  /** The whole "@[Name](target)" as written. */
  raw: string;
  /** The name between the brackets, as the human typed it. */
  typed: string;
  /** What is between the parentheses. */
  target: string;
}

export type Segment = { text: string } | { mention: MentionRef };

export interface ResolvedMention {
  typed: string;
  target: string;
  /** urn:li:organization:<id> or urn:li:person:<id> */
  urn: string;
  /** The text that will be published in place of the mention. */
  name: string;
  kind: MentionKind;
  /** false for a person: LinkedIn offers no lookup, so the name is the human's. */
  verified: boolean;
}

/** A mention problem. Always raised before anything is published. */
export class MentionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MentionError';
  }
}

// "@[" name "](" target ")". The name holds no brackets or line breaks; the
// target no whitespace or parentheses.
const MENTION = /@\[([^[\]\n]+)\]\(([^()\s]+)\)/g;

const ORG_URN = /^urn:li:(?:organization|organizationBrand):(\d+)$/;
const PERSON_URN = /^urn:li:person:([A-Za-z0-9_-]+)$/;
const VANITY_URL =
  /^(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/(company|school)\/([^/?#\s]+)\/?$/i;

type Target =
  | { kind: 'org-id'; id: string }
  | { kind: 'person'; urn: string }
  | { kind: 'vanity'; page: 'company' | 'school'; vanity: string };

function describe(ref: MentionRef): string {
  return `The mention ${ref.raw}`;
}

function classify(ref: MentionRef): Target | null {
  const t = ref.target;
  const org = ORG_URN.exec(t);
  if (org) return { kind: 'org-id', id: org[1] };
  if (PERSON_URN.test(t)) return { kind: 'person', urn: t };
  const v = VANITY_URL.exec(t);
  if (v) {
    let vanity = v[2];
    try {
      vanity = decodeURIComponent(vanity);
    } catch {
      // keep it as written
    }
    return {
      kind: 'vanity',
      page: v[1].toLowerCase() as 'company' | 'school',
      vanity,
    };
  }
  // Something that is clearly meant as a mention but is not one we can make
  // must not quietly become plain text.
  if (/^urn:li:/i.test(t) || /linkedin\.com\//i.test(t)) {
    if (/linkedin\.com\/in\//i.test(t)) {
      throw new MentionError(
        `${describe(ref)} points at a member's profile URL. LinkedIn does not let this app ` +
          'look people up, so a person can only be mentioned by an explicit ' +
          'urn:li:person:<id> (linkedin_list_comments shows the URNs of people who comment). ' +
          'Nothing was published.',
      );
    }
    throw new MentionError(
      `${describe(ref)} has a target this connector cannot mention. Use ` +
        'urn:li:organization:<id>, urn:li:person:<id>, linkedin.com/company/<vanity> or ' +
        'linkedin.com/school/<vanity>. Nothing was published.',
    );
  }
  return null;
}

/** Split text into plain-text runs and mentions. Throws on a mention-shaped
 *  target the connector cannot handle, so it never degrades to plain text. */
export function parseMentions(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(MENTION)) {
    const ref: MentionRef = { raw: m[0], typed: m[1].trim(), target: m[2] };
    if (!classify(ref)) continue; // not a mention target: stays plain text
    if (!ref.typed) {
      throw new MentionError(
        `${describe(ref)} has no name between the brackets. Nothing was published.`,
      );
    }
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at) });
    out.push({ mention: ref });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export function mentionRefs(segments: Segment[]): MentionRef[] {
  return segments.flatMap((s) => ('mention' in s ? [s.mention] : []));
}

// ──────────────────────────────────────────────────────────────────────────────
// Resolution
// ──────────────────────────────────────────────────────────────────────────────

interface RawOrganization {
  id?: number;
  localizedName?: string;
  vanityName?: string;
  primaryOrganizationType?: string;
}

interface Entity {
  urn: string;
  name?: string;
  kind: MentionKind;
}

function orgKind(o: RawOrganization): MentionKind {
  switch (o.primaryOrganizationType) {
    case 'SCHOOL':
      return 'school';
    case 'BRAND':
      return 'brand';
    default:
      return 'organization';
  }
}

function orgEntity(o: RawOrganization, ref: MentionRef): Entity {
  if (o.id === undefined || !o.localizedName) {
    throw new MentionError(
      `${describe(ref)}: LinkedIn returned the organization without an id or a name. ` +
        'Nothing was published.',
    );
  }
  return {
    urn: `urn:li:organization:${o.id}`,
    name: o.localizedName,
    kind: orgKind(o),
  };
}

async function byVanity(vanity: string, ref: MentionRef): Promise<Entity> {
  let res;
  try {
    res = await request<{ elements?: RawOrganization[] }>(
      'GET',
      'organizations',
      { query: `q=vanityName&vanityName=${encodeURIComponent(vanity)}` },
    );
  } catch (err) {
    throw wrap(err, ref);
  }
  const els = res.body.elements ?? [];
  const hit =
    els.find((e) => e.vanityName?.toLowerCase() === vanity.toLowerCase()) ??
    els[0];
  if (!hit) {
    throw new MentionError(
      `${describe(ref)} does not resolve: LinkedIn has no organization with the vanity name ` +
        `"${vanity}". Check the address of its LinkedIn page. Nothing was published.`,
    );
  }
  return orgEntity(hit, ref);
}

async function byId(id: string, ref: MentionRef): Promise<Entity> {
  try {
    const res = await request<RawOrganization>('GET', `organizations/${id}`);
    return orgEntity({ ...res.body, id: res.body.id ?? Number(id) }, ref);
  } catch (err) {
    if (
      err instanceof LinkedInApiError &&
      (err.status === 403 || err.status === 404)
    ) {
      throw new MentionError(
        `${describe(ref)} does not resolve (HTTP ${err.status}): LinkedIn only shows this app ` +
          'organizations that the authorizing member administers, by id. Write it as ' +
          '@[Name](linkedin.com/company/<vanity>) or linkedin.com/school/<vanity> instead; ' +
          'the connector then looks up its exact name. Nothing was published.',
      );
    }
    throw wrap(err, ref);
  }
}

function wrap(err: unknown, ref: MentionRef): Error {
  const msg = err instanceof Error ? err.message : String(err);
  return new MentionError(
    `${describe(ref)} could not be resolved: ${msg} Nothing was published.`,
  );
}

function cacheKey(t: Target): string {
  switch (t.kind) {
    case 'org-id':
      return `org:${t.id}`;
    case 'person':
      return `person:${t.urn}`;
    case 'vanity':
      return `vanity:${t.vanity.toLowerCase()}`;
  }
}

/** Resolves mentions, at most once per distinct target while a confirmation
 *  can still be redeemed. One per server, like the confirmation gate. */
export class MentionResolver {
  private readonly cache = new Map<
    string,
    { entity: Entity; expiresAt: number }
  >();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs: number = TOKEN_TTL_MS,
  ) {}

  /** Resolve every mention, in order. The first failure aborts the lot. */
  async resolve(refs: MentionRef[]): Promise<ResolvedMention[]> {
    const out: ResolvedMention[] = [];
    for (const ref of refs) {
      const target = classify(ref);
      if (!target) throw new MentionError(`${describe(ref)} is not a mention.`);
      const entity = await this.entity(target, ref);
      out.push({
        typed: ref.typed,
        target: ref.target,
        urn: entity.urn,
        name: entity.name ?? ref.typed,
        kind: entity.kind,
        verified: entity.name !== undefined,
      });
    }
    return out;
  }

  private async entity(t: Target, ref: MentionRef): Promise<Entity> {
    const key = cacheKey(t);
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > this.now()) return hit.entity;
    let entity: Entity;
    if (t.kind === 'person') entity = { urn: t.urn, kind: 'person' };
    else if (t.kind === 'org-id') entity = await byId(t.id, ref);
    else entity = await byVanity(t.vanity, ref);
    this.cache.set(key, { entity, expiresAt: this.now() + this.ttlMs });
    return entity;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Rendering
// ──────────────────────────────────────────────────────────────────────────────

function pair(
  segments: Segment[],
  resolved: ResolvedMention[],
): Array<{ text: string } | { mention: ResolvedMention }> {
  const refs = mentionRefs(segments);
  if (refs.length !== resolved.length) {
    throw new MentionError(
      `Internal error: ${refs.length} mention(s) in the text but ${resolved.length} resolved. ` +
        'Nothing was published.',
    );
  }
  let i = 0;
  return segments.map((s) => ('mention' in s ? { mention: resolved[i++] } : s));
}

/** The text a reader sees: each mention replaced by the name that is published. */
export function visibleText(
  segments: Segment[],
  resolved: ResolvedMention[],
): string {
  return pair(segments, resolved)
    .map((s) => ('mention' in s ? s.mention.name : s.text))
    .join('');
}

/** A post's commentary in little format: plain runs escaped exactly as before
 *  (escape), mentions written as @[Name](urn) with the name's reserved
 *  characters escaped too. */
export function postCommentary(
  segments: Segment[],
  resolved: ResolvedMention[],
  escape: (text: string, prev?: string) => string,
  escapeName: (text: string) => string,
): string {
  let out = '';
  let prev = '';
  for (const s of pair(segments, resolved)) {
    if ('mention' in s) {
      out += `@[${escapeName(s.mention.name)}](${s.mention.urn})`;
      prev = Array.from(s.mention.name).pop() ?? prev;
    } else {
      out += escape(s.text, prev);
      prev = Array.from(s.text).pop() ?? prev;
    }
  }
  return out;
}

export interface CommentAttribute {
  start: number;
  length: number;
  value:
    { organization: { organization: string } } | { person: { person: string } };
}

/** A comment's message for the Comments API: plain text with each mention's
 *  name in place, plus one attribute per mention. `start` and `length` count
 *  UTF-16 code units (JavaScript string indices): an emoji outside the Basic
 *  Multilingual Plane counts as 2. */
export function commentMessage(
  segments: Segment[],
  resolved: ResolvedMention[],
): { text: string; attributes: CommentAttribute[] } {
  let text = '';
  const attributes: CommentAttribute[] = [];
  for (const s of pair(segments, resolved)) {
    if ('mention' in s) {
      const m = s.mention;
      attributes.push({
        start: text.length,
        length: m.name.length,
        value:
          m.kind === 'person'
            ? { person: { person: m.urn } }
            : { organization: { organization: m.urn } },
      });
      text += m.name;
    } else {
      text += s.text;
    }
  }
  return { text, attributes };
}

/** Preview lines, one per mention, so the human confirms exactly what will be
 *  tagged. Empty when there are none. */
export function describeMentions(resolved: ResolvedMention[]): string[] {
  if (!resolved.length) return [];
  const lines = ['Mentions:'];
  for (const m of resolved) {
    lines.push(`  • ${m.name} — ${m.kind} — ${m.urn}`);
    if (!m.verified) {
      lines.push(
        '      not checked: LinkedIn offers no lookup of members. It links only if this is ' +
          "the member's first, last or full name exactly as on their profile.",
      );
    } else if (m.typed !== m.name) {
      lines.push(
        `      you wrote "${m.typed}"; LinkedIn's name is "${m.name}", and that is what ` +
          'will be published (a different name would not link).',
      );
    }
  }
  return lines;
}
