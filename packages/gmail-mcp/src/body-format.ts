// How a plain-text body is shaped for delivery. No I/O, no Gmail calls.
//
// WHY THIS EXISTS: a text/plain message sent through the Gmail API stays one
// line per paragraph in the sender's Sent copy, but the copy that gets delivered
// has its plain part cut at about 70-75 columns, so recipients read sentences
// broken mid-line. The text/html part is what reflows to the width of the
// screen, so plain-text callers get a generated one.

const URL_RE = /https?:\/\/[^\s<>"]+/gi;
const URL_TRAILER_RE = /[.,;:!?'’”»…)\]]$/;
const BLOCK_SEPARATOR_RE = /\n(?:[ \t]*\n)+/;

// A wrapped line runs to about the width it was wrapped at.
const WRAP_MIN_COLUMNS = 55;
const WRAP_MAX_COLUMNS = 80;
const WRAP_MIN_RUN = 3;

const SENTENCE_END_RE = /[.!?:;…)\]"'”’»]$/;
// Indentation, list markers, quotes, tables, headings, shell prompts, fences.
const NOT_PROSE_START_RE =
  /^(?:\s|[-*+•>|#]|\d+[.)]\s|[a-z][.)]\s|\$\s|`{3}|~{3})/i;
const CODE_RE = /[{}=`\\]|&&|\|\||\(\)|::/;
const FENCE_RE = /^\s*(?:`{3}|~{3})/;

/** A plain-text body that was refused because it looks hard-wrapped by hand. */
export class HardWrappedBodyError extends Error {
  constructor(line: string) {
    super(
      `Refused: this plain-text body looks hard-wrapped by hand, at: "${line}". ` +
        'Put each paragraph on one line and separate paragraphs with a blank line; mail clients wrap it to the screen. ' +
        'If these line breaks are intentional, retry with allow_hard_wraps: true (CLI: --allow-hard-wraps).',
    );
    this.name = 'HardWrappedBodyError';
  }
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function occurrences(text: string, char: string): number {
  return text.split(char).length - 1;
}

// The period or comma closing a sentence is not part of the link. A closing
// bracket is, when the URL opened it: https://example.com/page_(section)
function trimUrl(raw: string): string {
  let url = raw;
  while (URL_TRAILER_RE.test(url)) {
    const last = url[url.length - 1];
    if (last === ')' && occurrences(url, '(') >= occurrences(url, ')')) break;
    if (last === ']' && occurrences(url, '[') >= occurrences(url, ']')) break;
    url = url.slice(0, -1);
  }
  return url;
}

// HTML collapses a run of spaces, which would break aligned lines. The first
// space stays breakable so the line can still wrap.
function textToInlineHtml(text: string): string {
  return escapeHtml(text).replace(
    / {2,}/g,
    (run) => ` ${'&nbsp;'.repeat(run.length - 1)}`,
  );
}

function lineToHtml(line: string): string {
  const indent = /^[ \t]*/.exec(line)?.[0] ?? '';
  const text = line.slice(indent.length);
  let html = indent.replace(/\t/g, '    ').replace(/ /g, '&nbsp;');
  let from = 0;
  for (const match of text.matchAll(URL_RE)) {
    const url = trimUrl(match[0]);
    if (/^https?:\/\/$/i.test(url)) continue;
    html += textToInlineHtml(text.slice(from, match.index));
    html += `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`;
    from = match.index + url.length;
  }
  return html + textToInlineHtml(text.slice(from));
}

/**
 * Plain text → HTML. Blocks separated by a blank line become paragraphs; a
 * single newline is kept as <br>, which is what signatures and lists rely on.
 */
export function textToHtml(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/^(?:[ \t]*\n)+/, '')
    .trimEnd()
    .split(BLOCK_SEPARATOR_RE)
    .map((block) => `<p>${block.split('\n').map(lineToHtml).join('<br>')}</p>`)
    .join('\n');
}

function isNotProse(line: string): boolean {
  return NOT_PROSE_START_RE.test(line) || CODE_RE.test(line);
}

function looksWrapped(line: string): boolean {
  const text = line.trimEnd();
  return (
    text.length >= WRAP_MIN_COLUMNS &&
    text.length <= WRAP_MAX_COLUMNS &&
    !isNotProse(text) &&
    // A lone token (a bare URL, a path) has no words to wrap.
    /\s/.test(text) &&
    !SENTENCE_END_RE.test(text)
  );
}

/**
 * The first line of a hand-wrapped run, or null if there is none. The signal is
 * WRAP_MIN_RUN or more consecutive lines of wrap width that stop mid-sentence
 * with more prose following in the same block. Lists, quotes and code don't
 * count. Line breaks are the only thing this looks at, so a block of long
 * unpunctuated lines can match on purpose: allow_hard_wraps is the way out.
 */
export function findHardWrappedLine(text: string): string | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let inFence = false;
  let run = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      run = 0;
      continue;
    }
    if (inFence || !looksWrapped(line)) {
      run = 0;
      continue;
    }
    run++;
    const next = lines[i + 1];
    const moreProseFollows =
      next !== undefined && next.trim() !== '' && !isNotProse(next);
    if (run >= WRAP_MIN_RUN && moreProseFollows) {
      return lines[i - run + 1].trimEnd();
    }
  }
  return null;
}
