// Pure functions: no network, no environment. Everything here takes a value and
// returns a value, so it carries the bulk of the tests.
//
//   parseVideoId    any YouTube link shape (or a bare id) → the 11-char id
//   parseTimedText  the caption XML YouTube serves → timed segments
//   pickTrack       the caption tracks of a video + a wanted language → one
//   renderPlain / renderTimestamped   segments → the text the model reads

/** A YouTube video id is exactly 11 characters from this alphabet. */
const ID_RE = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

/** Path prefixes whose next segment is the id: /shorts/ID, /embed/ID, … */
const ID_PATH_PREFIXES = ['shorts', 'embed', 'live', 'v', 'e'];

export class InvalidVideoError extends Error {}

/**
 * Accepts a bare id, or any of the link shapes people paste:
 * youtube.com/watch?v=ID, youtu.be/ID, youtube.com/shorts/ID, /embed/ID,
 * /live/ID, m./music./nocookie hosts, with or without scheme, extra query
 * parameters (t=, si=, list=) or a trailing slash.
 */
export function parseVideoId(input: string): string {
  const raw = (input ?? '').trim();
  if (ID_RE.test(raw)) return raw;

  let url: URL;
  try {
    url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`,
    );
  } catch {
    throw new InvalidVideoError(notAVideo(raw));
  }

  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);
  let candidate: string | undefined;

  if (host === 'youtu.be' || host === 'www.youtu.be') {
    candidate = segments[0];
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (segments[0] === 'watch') {
      candidate = url.searchParams.get('v') ?? undefined;
    } else if (ID_PATH_PREFIXES.includes(segments[0] ?? '')) {
      candidate = segments[1];
    } else if (url.searchParams.get('v')) {
      candidate = url.searchParams.get('v') ?? undefined;
    }
  }

  if (candidate && ID_RE.test(candidate)) return candidate;
  throw new InvalidVideoError(notAVideo(raw));
}

function notAVideo(raw: string): string {
  const shown = raw.length > 120 ? `${raw.slice(0, 120)}…` : raw;
  return (
    `"${shown}" doesn't look like a link to a YouTube video. ` +
    'Paste the video link as it appears in the browser or the Share button ' +
    '(youtube.com/watch?v=…, youtu.be/…, or youtube.com/shorts/…). ' +
    'Channel and playlist links are not supported.'
  );
}

// ── Caption XML ─────────────────────────────────────────────────────────────

export interface Segment {
  /** Seconds from the start of the video. */
  start: number;
  /** Seconds the line stays on screen. */
  duration: number;
  text: string;
}

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Decode XML/HTML entities once. */
function decodeOnce(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : m;
    }
    return NAMED[body.toLowerCase()] ?? m;
  });
}

/**
 * Caption text arrives entity-encoded TWICE: the XML layer encodes the `&` of
 * an already-encoded `&#39;`, so a single decode leaves `&#39;` in the text.
 * Decode until stable, at most three passes.
 */
export function decodeEntities(s: string): string {
  let out = s;
  for (let i = 0; i < 3; i++) {
    const next = decodeOnce(out);
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Apply a removal until the string stops changing (at most 8 passes). */
function removeAll(s: string, re: RegExp): string {
  let out = s;
  for (let i = 0; i < 8; i++) {
    const next = out.replace(re, '');
    if (next === out) return out;
    out = next;
  }
  // Still changing after 8 passes: a crafted nesting. Drop every angle bracket.
  return out.replace(/[<>]/g, '');
}

/** Anything shaped like a tag: "<" … ">" with no other bracket inside. */
const TAG = /<[^<>]*>/g;

/**
 * One caption line → plain text.
 *
 * The classic format is HTML inside XML: the line's text is HTML-encoded, and
 * the XML layer encodes it again. So after ONE decode, styling such as
 * <font color=…> has become a real tag, while a "<" someone actually said is
 * still "&lt;". Tags are stripped at exactly that point, then the rest is
 * decoded: "Vec<String>" and "x < 5 and y > 3" survive intact.
 *
 * srv3 is encoded once: its only markup is the raw XML (<s> per word), so it
 * is stripped before decoding and nothing after.
 *
 * Every removal runs to a fixed point, so removing one tag can't assemble
 * another. The result is plain text for a model, never rendered as HTML.
 */
function cleanLine(inner: string, doubleEncoded: boolean): string {
  const raw = removeAll(inner, TAG);
  const text = doubleEncoded
    ? decodeEntities(removeAll(decodeOnce(raw), TAG))
    : decodeEntities(raw);
  return text.replace(/\s+/g, ' ').trim();
}

function attr(attrs: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1];
}

/**
 * Parses both caption formats YouTube serves:
 *   classic  <transcript><text start="1.2" dur="3.4">…</text></transcript>
 *   srv3     <timedtext><body><p t="1200" d="3400">…</p></body></timedtext>
 * Empty lines (music cues with no text, blank auto-caption frames) are dropped.
 */
export function parseTimedText(xml: string): Segment[] {
  const out: Segment[] = [];

  for (const m of xml.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const text = cleanLine(m[2], true);
    if (!text) continue;
    out.push({
      start: Number(attr(m[1], 'start') ?? 0),
      duration: Number(attr(m[1], 'dur') ?? 0),
      text,
    });
  }
  if (out.length) return out;

  for (const m of xml.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)) {
    const text = cleanLine(m[2], false);
    if (!text) continue;
    out.push({
      start: Number(attr(m[1], 't') ?? 0) / 1000,
      duration: Number(attr(m[1], 'd') ?? 0) / 1000,
      text,
    });
  }
  return out;
}

// ── Track choice ────────────────────────────────────────────────────────────

export interface CaptionTrack {
  /** BCP-47-ish code as YouTube reports it: "en", "es", "es-419", "pt-BR". */
  languageCode: string;
  /** Human name as YouTube reports it, e.g. "Spanish (auto-generated)". */
  name: string;
  /** true when YouTube's speech recognition made it, false when uploaded. */
  autoGenerated: boolean;
  baseUrl: string;
}

export interface TrackChoice {
  track: CaptionTrack;
  /** Set when a language was asked for and could not be honored. */
  fallbackFrom?: string;
}

const base = (code: string) => code.toLowerCase().split(/[-_]/)[0];

/**
 * Picks one track.
 *
 * With a wanted language: an exact match, then the same base language
 * ("es" matches "es-419", "es-419" matches "es"), uploaded captions before
 * auto-generated ones each time. If none matches, fall back to the default
 * below and report what was asked for, so the reply can say so.
 *
 * Without one: the language of the auto-generated track, when there is one, is
 * the language actually spoken in the video. Prefer an uploaded track in that
 * language, then the auto-generated one. Without auto-captions, YouTube's own
 * default track, then the first listed.
 */
export function pickTrack(
  tracks: CaptionTrack[],
  wanted?: string,
  youtubeDefaultIndex?: number,
): TrackChoice {
  if (!tracks.length) throw new Error('pickTrack: no tracks');
  const manualFirst = (a: CaptionTrack, b: CaptionTrack) =>
    Number(a.autoGenerated) - Number(b.autoGenerated);

  const want = wanted?.trim();
  if (want) {
    const w = want.toLowerCase();
    const exact = tracks
      .filter((t) => t.languageCode.toLowerCase() === w)
      .sort(manualFirst);
    if (exact[0]) return { track: exact[0] };
    const sameBase = tracks
      .filter((t) => base(t.languageCode) === base(w))
      .sort(manualFirst);
    if (sameBase[0]) return { track: sameBase[0] };
  }

  const spoken = tracks.find((t) => t.autoGenerated);
  let track: CaptionTrack | undefined;
  if (spoken) {
    track =
      tracks.find(
        (t) => !t.autoGenerated && t.languageCode === spoken.languageCode,
      ) ??
      tracks.find(
        (t) =>
          !t.autoGenerated &&
          base(t.languageCode) === base(spoken.languageCode),
      ) ??
      spoken;
  } else if (
    youtubeDefaultIndex !== undefined &&
    tracks[youtubeDefaultIndex] !== undefined
  ) {
    track = tracks[youtubeDefaultIndex];
  }
  return {
    track: track ?? tracks[0],
    ...(want ? { fallbackFrom: want } : {}),
  };
}

// ── Rendering ───────────────────────────────────────────────────────────────

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** A silence at least this long starts a new paragraph. */
const PAUSE_SECONDS = 2.5;
/** Auto-captions rarely pause; break anyway after this much speech. */
const PARAGRAPH_SECONDS = 60;

/**
 * Plain text: lines joined with spaces into paragraphs. A paragraph ends at a
 * pause, or after about a minute of speech so auto-captions (which have no
 * punctuation and few pauses) don't come out as one wall of text.
 */
export function renderPlain(segments: Segment[]): string {
  const paragraphs: string[] = [];
  let current: string[] = [];
  let paragraphStart = 0;
  let prevEnd = 0;

  for (const seg of segments) {
    const pause = seg.start - prevEnd;
    const long = seg.start - paragraphStart >= PARAGRAPH_SECONDS;
    if (current.length && (pause >= PAUSE_SECONDS || long)) {
      paragraphs.push(current.join(' '));
      current = [];
    }
    if (!current.length) paragraphStart = seg.start;
    current.push(seg.text);
    prevEnd = seg.start + seg.duration;
  }
  if (current.length) paragraphs.push(current.join(' '));
  return paragraphs.join('\n\n');
}

/** One caption line per row, prefixed with where it starts: "[1:02:03] …". */
export function renderTimestamped(segments: Segment[]): string {
  return segments.map((s) => `[${formatClock(s.start)}] ${s.text}`).join('\n');
}
