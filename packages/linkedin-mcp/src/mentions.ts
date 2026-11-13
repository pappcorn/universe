// Mentions: turning "@[Name](target)" in the text a human approved into a real
// LinkedIn tag — linked, clickable, and notifying the mentioned account.
//
// ONE SYNTAX, for posts and comments alike:
//   @[Display Name](urn:li:organization:<id>)
//   @[Display Name](urn:li:organizationBrand:<id>)   (same as organization:<id>)
//   @[Display Name](urn:li:person:<id>)
//   @[Display Name](<a LinkedIn company or school page address>)
// The page address can be pasted from a browser as is: any LinkedIn host
// (www., m., a country prefix), with or without https://, a sub-page such as
// /about/ or /posts/, a query string, or a trailing slash. A numeric
// linkedin.com/company/<digits> is the organization's id, not a vanity name.
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
//     id that does not exist. So an organization id that is not yours fails,
//     and the error points at the vanity form.
//   · people — not at all. A person mention needs an explicit urn:li:person
//     (linkedin_list_comments shows commenters' URNs), and its display name
//     cannot be checked: LinkedIn matches any one of the member's names.
//
// Mentions are resolved once, at preview, with each distinct target looked up
// once and all of them in parallel. What was resolved is stored with the
// confirm token (gate.ts) and published as is: confirming makes no lookup.

import { LinkedInApiError, request } from './api';

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

/** Text with every mention already resolved: what the body builders take. A
 *  text run never contains a mention (see composeText), so nothing unresolved
 *  can reach LinkedIn. */
export type Piece = { text: string } | { mention: ResolvedMention };

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
// Anchored at the start, so a LinkedIn address quoted inside another site's URL
// is not mistaken for one. Any LinkedIn host; then optional sub-page, query or
// fragment after the vanity.
const LINKEDIN_HOST = String.raw`^(?:https?:\/\/)?(?:[a-z0-9-]+\.)*linkedin\.com\/`;
const PAGE_URL = new RegExp(
  `${LINKEDIN_HOST}(company|school)\\/([^/?#\\s]+)(?:[/?#]\\S*)?$`,
  'i',
);
const LINKEDIN_URL = new RegExp(LINKEDIN_HOST, 'i');
const PROFILE_URL = new RegExp(`${LINKEDIN_HOST}in\\/`, 'i');

export type Target =
  | { kind: 'org-id'; id: string }
  | { kind: 'person'; urn: string }
  | { kind: 'vanity'; vanity: string };

function describe(ref: MentionRef): string {
  return `The mention ${ref.raw}`;
}

export function classify(ref: MentionRef): Target | null {
  const t = ref.target;
  const org = ORG_URN.exec(t);
  if (org) return { kind: 'org-id', id: org[1] };
  if (PERSON_URN.test(t)) return { kind: 'person', urn: t };
  const page = PAGE_URL.exec(t);
  if (page) {
    let vanity = page[2];
    try {
      vanity = decodeURIComponent(vanity);
    } catch {
      // keep it as written
    }
    // linkedin.com/company/<digits> is how LinkedIn addresses a page by id.
    if (/^\d+$/.test(vanity)) return { kind: 'org-id', id: vanity };
    return { kind: 'vanity', vanity };
  }
  // Something that is clearly meant as a mention but is not one we can make
  // must not quietly become plain text.
  if (/^urn:li:/i.test(t) || LINKEDIN_URL.test(t)) {
    if (PROFILE_URL.test(t)) {
      throw new MentionError(
        `${describe(ref)} points at a member's profile URL. LinkedIn does not let this app ` +
          'look people up, so a person can only be mentioned by an explicit ' +
          'urn:li:person:<id> (linkedin_list_comments shows the URNs of people who comment). ' +
          'Nothing was published.',
      );
    }
    throw new MentionError(
      `${describe(ref)} has a target this connector cannot mention. Use ` +
        'urn:li:organization:<id>, urn:li:person:<id>, or the address of a LinkedIn company ' +
        'or school page. Nothing was published.',
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

/** Pieces for a text that must not contain mentions. Throws if it does, so a
 *  caller can never send a mention's markup without resolving it. */
export function plainPieces(text: string): Piece[] {
  const segs = parseMentions(text);
  if (segs.some((s) => 'mention' in s)) {
    throw new MentionError(
      'This text contains mentions that were not resolved. Nothing was published.',
    );
  }
  return text ? [{ text }] : [];
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

/** An organization already fetched (the Page, by getPage()), so mentioning it
 *  costs no second call. */
export interface KnownOrganization {
  id: string;
  localizedName?: string;
  primaryOrganizationType?: string;
}

interface Entity {
  urn: string;
  name?: string;
  kind: MentionKind;
}

function orgKind(type?: string): MentionKind {
  switch (type) {
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
    kind: orgKind(o.primaryOrganizationType),
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
  // Only an exact (case-insensitive) vanity match counts. Anything else — no
  // results, or results that are not this vanity — fails rather than tagging
  // whichever organization LinkedIn happened to list first.
  const hit = (res.body.elements ?? []).find(
    (e) => e.vanityName?.toLowerCase() === vanity.toLowerCase(),
  );
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
        `${describe(ref)} does not resolve (HTTP ${err.status}): by id, LinkedIn only shows ` +
          'this app organizations that the authorizing member administers. Use the ' +
          "address of the organization's page by its vanity name instead, e.g. " +
          '@[Name](linkedin.com/company/<vanity>); the connector then looks up its exact ' +
          'name. Nothing was published.',
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

function targetKey(t: Target): string {
  switch (t.kind) {
    case 'org-id':
      return `org:${t.id}`;
    case 'person':
      return `person:${t.urn}`;
    case 'vanity':
      return `vanity:${t.vanity.toLowerCase()}`;
  }
}

/** Resolve the text's mentions and return it as pieces. Each distinct target
 *  is looked up once, all in parallel; `known` organizations cost no call. Any
 *  mention that does not resolve fails the whole text. */
export async function composeText(
  segments: Segment[],
  known: KnownOrganization[] = [],
): Promise<Piece[]> {
  const targets = new Map<string, { target: Target; ref: MentionRef }>();
  const keyOf = new Map<MentionRef, string>();
  for (const s of segments) {
    if (!('mention' in s)) continue;
    const target = classify(s.mention);
    if (!target)
      throw new MentionError(`${describe(s.mention)} is not a mention.`);
    const key = targetKey(target);
    keyOf.set(s.mention, key);
    if (!targets.has(key)) targets.set(key, { target, ref: s.mention });
  }

  const seeded = new Map(known.map((k) => [k.id, k]));
  const entries = await Promise.all(
    [...targets].map(async ([key, { target, ref }]) => {
      let entity: Entity;
      if (target.kind === 'person') {
        entity = { urn: target.urn, kind: 'person' };
      } else if (
        target.kind === 'org-id' &&
        seeded.get(target.id)?.localizedName
      ) {
        const k = seeded.get(target.id) as KnownOrganization;
        entity = orgEntity(
          {
            id: Number(k.id),
            localizedName: k.localizedName,
            primaryOrganizationType: k.primaryOrganizationType,
          },
          ref,
        );
      } else if (target.kind === 'org-id') {
        entity = await byId(target.id, ref);
      } else {
        entity = await byVanity(target.vanity, ref);
      }
      return [key, entity] as const;
    }),
  );
  const entities = new Map(entries);

  return segments.map((s) => {
    if (!('mention' in s)) return s;
    const e = entities.get(keyOf.get(s.mention) as string) as Entity;
    return {
      mention: {
        typed: s.mention.typed,
        target: s.mention.target,
        urn: e.urn,
        name: e.name ?? s.mention.typed,
        kind: e.kind,
        verified: e.name !== undefined,
      },
    };
  });
}

export function mentionsOf(pieces: Piece[]): ResolvedMention[] {
  return pieces.flatMap((p) => ('mention' in p ? [p.mention] : []));
}

/** The plain-text runs around the mentions. Needs no lookup, so it gives a
 *  floor on the rendered length before any I/O. */
export function plainRuns(segments: Segment[]): string[] {
  return segments.flatMap((s) => ('text' in s ? [s.text] : []));
}

// ──────────────────────────────────────────────────────────────────────────────
// Rendering
// ──────────────────────────────────────────────────────────────────────────────

/** The text a reader sees: each mention replaced by the name that is published. */
export function visibleText(pieces: Piece[]): string {
  return pieces.map((p) => ('mention' in p ? p.mention.name : p.text)).join('');
}

/** A post's commentary in little format: plain runs escaped exactly as before
 *  (escape), mentions written as @[Name](urn) with the name's reserved
 *  characters escaped too. */
export function postCommentary(
  pieces: Piece[],
  escape: (text: string, prev?: string) => string,
  escapeName: (text: string) => string,
): string {
  let out = '';
  let prev = '';
  for (const p of pieces) {
    if ('mention' in p) {
      out += `@[${escapeName(p.mention.name)}](${p.mention.urn})`;
      prev = Array.from(p.mention.name).pop() ?? prev;
    } else {
      out += escape(p.text, prev);
      prev = Array.from(p.text).pop() ?? prev;
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
 *  Multilingual Plane counts as 2. Verified live: LinkedIn renders the tag on
 *  exactly the name with these offsets. */
export function commentMessage(pieces: Piece[]): {
  text: string;
  attributes: CommentAttribute[];
} {
  let text = '';
  const attributes: CommentAttribute[] = [];
  for (const p of pieces) {
    if ('mention' in p) {
      const m = p.mention;
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
      text += p.text;
    }
  }
  return { text, attributes };
}

/** Preview lines, one per mention, so the human confirms exactly what will be
 *  tagged. Empty when there are none. `reserved` tells whether a name holds a
 *  character the post markup reserves. */
export function describeMentions(
  mentions: ResolvedMention[],
  reserved?: (name: string) => boolean,
): string[] {
  if (!mentions.length) return [];
  const lines = ['Mentions:'];
  for (const m of mentions) {
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
    if (reserved?.(m.name)) {
      lines.push(
        '      WARNING: this name contains characters that LinkedIn post markup reserves. ' +
          'They are escaped, but whether LinkedIn still matches an escaped name is not ' +
          'verified: the tag may render as plain text. Check the post after publishing.',
      );
    }
  }
  return lines;
}
