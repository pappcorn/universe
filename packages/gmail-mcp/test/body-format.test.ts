// What a plain-text body turns into on the wire, and which bodies get refused.
//
// Delivery is the part that can't be seen from the sender's side: the Sent copy
// looks right either way. So the MIME shape is asserted here, on the raw message
// the API would receive. Nothing in this file reaches the network.
//
// Node's built-in test runner — no test framework dependency.
//   npm test          (from packages/gmail-mcp)

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import {
  findHardWrappedLine,
  HardWrappedBodyError,
  textToHtml,
} from '../src/body-format';
import { buildMessage, stripHtml } from '../src/core';

const attachmentDir = mkdtempSync(join(tmpdir(), 'gmail-mcp-body-'));
after(() => rmSync(attachmentDir, { recursive: true, force: true }));

// Placeholders: with the account set, composing needs no call to Gmail.
process.env.GMAIL_CLIENT_ID = 'test-client';
process.env.GMAIL_CLIENT_SECRET = 'test-secret';
process.env.GMAIL_REFRESH_TOKEN = 'test-refresh';
process.env.GMAIL_ACCOUNT = 'sender@example.com';
process.env.GMAIL_ATTACHMENT_DIR = attachmentDir;

interface Entity {
  headers: string;
  contentType: string;
  body: string;
  parts: Entity[];
}

/** Just enough of a MIME parser to read back what buildMessage produced. */
function parseEntity(raw: string): Entity {
  const split = raw.indexOf('\r\n\r\n');
  const headers = raw.slice(0, split);
  const body = raw.slice(split + 4);
  const contentType = /^Content-Type: ([^;\r\n]+)/im.exec(headers)?.[1] ?? '';
  const boundary = /boundary="([^"]+)"/.exec(headers)?.[1];
  const parts = boundary
    ? body
        .split(`--${boundary}--`)[0]
        .split(`--${boundary}\r\n`)
        .slice(1)
        .map((part) => parseEntity(part.replace(/\r\n$/, '')))
    : [];
  return { headers, contentType, body, parts };
}

function decoded(entity: Entity): string {
  return Buffer.from(entity.body, 'base64').toString('utf8');
}

async function compose(
  args: Partial<Parameters<typeof buildMessage>[0]>,
): Promise<Entity> {
  const { raw } = await buildMessage({
    to: 'recipient@example.com',
    subject: 'Test',
    body: 'Hello.',
    ...args,
  });
  return parseEntity(Buffer.from(raw, 'base64url').toString('utf8'));
}

// Hand-wrapped at 72 columns, the way an agent or an editor would do it.
const WRAPPED = [
  'I signed you up for the waiting list and created your account with this',
  'address so you can come in whenever you want, without a password and',
  'without having to do anything else on your side for now, except for',
  'reading this note.',
].join('\n');

describe('textToHtml', () => {
  it('turns blocks into paragraphs and single newlines into <br>', () => {
    assert.equal(
      textToHtml('Hello,\n\nJane Doe\nExample Inc\n'),
      '<p>Hello,</p>\n<p>Jane Doe<br>Example Inc</p>',
    );
  });

  it('treats a whitespace-only line and CRLF as a block separator', () => {
    assert.equal(textToHtml('One\r\n  \r\nTwo'), '<p>One</p>\n<p>Two</p>');
  });

  it('escapes HTML in the text', () => {
    assert.equal(
      textToHtml(`a < b & "c" <script>'d'</script>`),
      '<p>a &lt; b &amp; &quot;c&quot; &lt;script&gt;&#39;d&#39;&lt;/script&gt;</p>',
    );
  });

  it('keeps the indentation HTML would otherwise collapse', () => {
    assert.equal(
      textToHtml('List:\n  nested\n\tdeeper'),
      '<p>List:<br>&nbsp;&nbsp;nested<br>&nbsp;&nbsp;&nbsp;&nbsp;deeper</p>',
    );
  });

  it('keeps runs of spaces inside a line, so aligned text stays aligned', () => {
    assert.equal(
      textToHtml('Total:    42 a b'),
      '<p>Total: &nbsp;&nbsp;&nbsp;42 a b</p>',
    );
  });

  it('links URLs and escapes them in the attribute too', () => {
    assert.equal(
      textToHtml('See http://example.com/?a=1&b=2 now'),
      '<p>See <a href="http://example.com/?a=1&amp;b=2">http://example.com/?a=1&amp;b=2</a> now</p>',
    );
  });

  for (const trailer of ['.', ',', ';', ':', '!', '?', ')', '...', ').']) {
    it(`leaves "${trailer}" out of a link that closes a sentence`, () => {
      assert.equal(
        textToHtml(`Go to https://example.com/a${trailer}`),
        `<p>Go to <a href="https://example.com/a">https://example.com/a</a>${trailer}</p>`,
      );
    });
  }

  it('keeps a closing bracket the URL itself opened', () => {
    assert.equal(
      textToHtml('(see https://example.com/a_(b).)'),
      '<p>(see <a href="https://example.com/a_(b)">https://example.com/a_(b)</a>.)</p>',
    );
  });

  it('does not link a scheme with nothing after it', () => {
    assert.equal(
      textToHtml('Starts with https://.'),
      '<p>Starts with https://.</p>',
    );
  });
});

describe('findHardWrappedLine', () => {
  it('finds a hand-wrapped paragraph and names its first line', () => {
    assert.equal(findHardWrappedLine(WRAPPED), WRAPPED.split('\n')[0]);
  });

  it('finds one with CRLF line endings, in a later paragraph', () => {
    const body = `Hello,\r\n\r\n${WRAPPED.replace(/\n/g, '\r\n')}`;
    assert.equal(findHardWrappedLine(body), WRAPPED.split('\n')[0]);
  });

  it('passes the same text on one line per paragraph', () => {
    assert.equal(findHardWrappedLine(WRAPPED.replace(/\n/g, ' ')), null);
  });

  it('passes a signature block', () => {
    const body = [
      'Thanks for the quick reply.',
      '',
      'Jane Doe',
      'Head of Partnerships and Customer Success at Example Inc',
      'Example Inc, 123 Example Street, Suite 400, Example City 00000',
      'jane@example.com',
      'https://example.com',
    ].join('\n');
    assert.equal(findHardWrappedLine(body), null);
  });

  it('passes a bullet list, numbered list and wrapped list items', () => {
    const body = [
      '- First item of the list with a length much like a wrapped line',
      '- Second item of the list with a length much like a wrapped line',
      '- Third item of the list with a length much like a wrapped line',
      '- Fourth item of the list with a length much like a wrapped line',
      '',
      '1. First item of the list with a length much like a wrapped line',
      '2. Second item of the list with a length much like a wrapped line',
      '3. Third item of the list with a length much like a wrapped line',
      '4. Fourth item of the list with a length much like a wrapped line',
      '',
      '* An item that was wrapped by hand, which is how lists tend to look',
      '  in plain text, where the continuation lines are indented to match',
      '  the marker so the eye can follow where each of the items ends and',
      '  the next one begins',
    ].join('\n');
    assert.equal(findHardWrappedLine(body), null);
  });

  it('passes short complete sentences on their own lines', () => {
    const body = [
      'This first sentence is about as long as a line wrapped by hand.',
      'This second sentence is also about as long as a wrapped line.',
      'This third sentence closes the same way and should not block it.',
      'And this is the last one.',
    ].join('\n');
    assert.equal(findHardWrappedLine(body), null);
  });

  it('passes quoted lines', () => {
    const body = WRAPPED.split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
    assert.equal(findHardWrappedLine(body), null);
  });

  it('passes code: indented, fenced, or code-looking', () => {
    const lines = WRAPPED.split('\n');
    const indented = lines.map((line) => `    ${line}`).join('\n');
    const fenced = ['```', ...lines, '```'].join('\n');
    const codeLooking = [
      'export FIRST_SETTING_NAME=some-long-value-for-this-setting-here',
      'export SECOND_SETTING_NAME=some-long-value-for-this-setting-too',
      'export THIRD_SETTING_NAME=some-long-value-for-this-setting-again',
      'export FOURTH_SETTING_NAME=some-long-value-for-this-setting-also',
    ].join('\n');
    assert.equal(findHardWrappedLine(indented), null);
    assert.equal(findHardWrappedLine(fenced), null);
    assert.equal(findHardWrappedLine(codeLooking), null);
  });

  it('passes a list of bare URLs', () => {
    const url =
      'https://example.com/a/path/that/is/long/enough/to/look/wrapped/';
    const body = [`${url}1`, `${url}2`, `${url}3`, `${url}4`].join('\n');
    assert.equal(findHardWrappedLine(body), null);
  });

  it('needs three lines of wrap width, and more text after them', () => {
    const [one, two, three] = WRAPPED.split('\n');
    assert.equal(findHardWrappedLine(`${one}\n${two}\nend of it.`), null);
    assert.equal(findHardWrappedLine(`${one}\n${two}\n${three}`), null);
    assert.equal(
      findHardWrappedLine(`${one}\n${two}\n${three}\n\nNext.`),
      null,
    );
    assert.equal(findHardWrappedLine(`${one}\n${two}\n${three}\nmore`), one);
  });

  it('ignores lines outside the wrap width', () => {
    const long = 'word '.repeat(20).trim();
    assert.equal(
      findHardWrappedLine([long, long, long, long].join('\n')),
      null,
    );
    const short = 'a short line of text';
    assert.equal(
      findHardWrappedLine([short, short, short, short].join('\n')),
      null,
    );
  });
});

describe('stripHtml', () => {
  it('leaves a blank line between paragraphs', () => {
    assert.equal(stripHtml('<p>One</p><p>Two</p>'), 'One\n\nTwo');
    assert.equal(stripHtml('<P>One</P>\n<p>Two</p>\n'), 'One\n\nTwo');
  });

  it('keeps single newlines for <br> and other block tags', () => {
    assert.equal(stripHtml('<p>One<br>Two</p>'), 'One\nTwo');
    assert.equal(stripHtml('<div>One</div><div>Two</div>'), 'One\nTwo');
  });
});

describe('stripHtml, on hostile or tricky input', () => {
  it('removes a script split so that stripping it forms a new one', () => {
    assert.equal(stripHtml('a<scr<script>x</script>ipt>y</script>b'), 'ab');
  });

  it('does not spend a pass per nested layer, and leaves no tag behind', () => {
    const layers = 60_000;
    const hostile = `${'<scr'.repeat(layers)}<script></script>${'ipt></script>'.repeat(layers)}`;
    const started = performance.now();
    const text = stripHtml(hostile);
    assert.ok(performance.now() - started < 2_000, 'took too long');
    assert.doesNotMatch(text, /[<>]/);
  });

  it('keeps a bare angle bracket in ordinary text', () => {
    assert.equal(stripHtml('<p>2 < 3</p>'), '2 < 3');
  });

  it('decodes entities exactly once', () => {
    assert.equal(
      stripHtml('&amp;lt;b&amp;gt; &lt;b&gt; &amp;'),
      '&lt;b&gt; <b> &',
    );
  });

  it('leaves a lone angle bracket in text alone', () => {
    assert.equal(stripHtml('<p>a < b</p>'), 'a < b');
  });
});

describe('buildMessage', () => {
  it('sends plain text as multipart/alternative, text first', async () => {
    const body = 'One paragraph, on one line.\n\nJane Doe\nExample Inc\n';
    const message = await compose({ body });

    assert.equal(message.contentType, 'multipart/alternative');
    const [plain, html] = message.parts;
    assert.equal(message.parts.length, 2);
    assert.equal(plain.contentType, 'text/plain');
    assert.equal(decoded(plain), body);
    assert.equal(html.contentType, 'text/html');
    assert.equal(
      decoded(html),
      '<p>One paragraph, on one line.</p>\n<p>Jane Doe<br>Example Inc</p>',
    );
  });

  it('survives non-ASCII text in both parts', async () => {
    const body = 'Revisión del año: ¿todo bien? 🚀';
    const [plain, html] = (await compose({ body })).parts;
    assert.equal(decoded(plain), body);
    assert.equal(decoded(html), `<p>${body}</p>`);
  });

  it('nests the alternative inside multipart/mixed with attachments', async () => {
    writeFileSync(join(attachmentDir, 'notes.txt'), 'attached');
    const body = 'See the attached notes.\n\nThanks.';
    const message = await compose({ body, attachments: 'notes.txt' });

    assert.equal(message.contentType, 'multipart/mixed');
    assert.equal(message.parts.length, 2);
    const [alternative, attachment] = message.parts;

    assert.equal(alternative.contentType, 'multipart/alternative');
    const [plain, html] = alternative.parts;
    assert.equal(plain.contentType, 'text/plain');
    assert.equal(decoded(plain), body);
    assert.equal(html.contentType, 'text/html');
    assert.equal(
      decoded(html),
      '<p>See the attached notes.</p>\n<p>Thanks.</p>',
    );

    assert.match(attachment.headers, /Content-Disposition: attachment/);
    assert.equal(decoded(attachment), 'attached');
  });

  it('uses the body as the HTML when html is set, and derives the text', async () => {
    const body = '<p>One</p><p>Two</p>';
    const message = await compose({ body, html: true });
    const [plain, html] = message.parts;
    assert.equal(message.contentType, 'multipart/alternative');
    assert.equal(decoded(plain), 'One\n\nTwo');
    assert.equal(decoded(html), body);
  });

  it('refuses a hard-wrapped plain-text body and says how to fix it', async () => {
    await assert.rejects(compose({ body: WRAPPED }), (err: Error) => {
      assert.ok(err instanceof HardWrappedBodyError);
      assert.match(err.message, /each paragraph on one line/);
      assert.match(err.message, /allow_hard_wraps/);
      return true;
    });
  });

  it('sends the same body when allow_hard_wraps is set', async () => {
    const [plain, html] = (
      await compose({ body: WRAPPED, allow_hard_wraps: true })
    ).parts;
    assert.equal(decoded(plain), WRAPPED);
    assert.equal(decoded(html), `<p>${WRAPPED.replace(/\n/g, '<br>')}</p>`);
  });

  it('does not apply the wrap check to an HTML body', async () => {
    const message = await compose({ body: WRAPPED, html: true });
    assert.equal(message.contentType, 'multipart/alternative');
  });
});
