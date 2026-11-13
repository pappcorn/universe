// Mentions, end to end against a fake LinkedIn, plus the pure pieces on their
// own. What must hold (issue #114):
//   1. A mention survives the little-format escaping while every reserved
//      character around it is still escaped; a bare @handle stays plain text.
//   2. Comment attributes count UTF-16 code units, so an emoji before a
//      mention does not shift the link.
//   3. A mention that does not resolve — an empty `elements` from the vanity
//      lookup, a 403/404 on an organization id — aborts before any request
//      that publishes, and before any confirm token.
//   4. The preview lists every mention, and what it resolved is stored with
//      the confirm token: confirming redeems the token first (a bad one costs
//      no network call) and publishes exactly what was shown, with no lookup.
//   5. Each distinct target is looked up once.

import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';

import { captureTools, fakeLinkedIn, isolate, ORG, tokenIn } from './helpers';

const cleanup = isolate();
after(cleanup);

import {
  buildCommentBody,
  buildPostBody,
  commentaryOf,
  escapeLittle,
  escapeLittleAll,
} from '../src/core';
import {
  classify,
  commentMessage,
  composeText,
  LOOKUP_CONCURRENCY,
  MentionError,
  mentionsOf,
  parseMentions,
  postCommentary,
  visibleText,
  type Piece,
  type ResolvedMention,
} from '../src/mentions';
import { registerTools } from '../src/tools';

// Illustrative organizations; ids are made up.
const ORGS: Record<
  string,
  { id: number; localizedName: string; primaryOrganizationType: string }
> = {
  'example-corp': {
    id: 1001,
    localizedName: 'Example Corp',
    primaryOrganizationType: 'NONE',
  },
  'example-university': {
    id: 2002,
    localizedName: 'Example University - Campus Norte',
    primaryOrganizationType: 'SCHOOL',
  },
  'paren-co': {
    id: 3003,
    localizedName: 'Paren Co (Latam)',
    primaryOrganizationType: 'NONE',
  },
};

const li = fakeLinkedIn((c) => {
  const u = new URL(c.url);
  if (u.pathname === '/rest/organizations/1234567') {
    return {
      json: {
        id: 1234567,
        localizedName: 'Example Co',
        vanityName: 'example-co',
        primaryOrganizationType: 'NONE',
      },
    };
  }
  if (u.pathname.startsWith('/rest/organizations/')) {
    return {
      status: 403,
      json: {
        message: `Viewer don't have permission to the ADMIN_ONLY VisibilityReduction`,
      },
    };
  }
  if (u.pathname === '/rest/organizations' && c.method === 'GET') {
    const v = u.searchParams.get('vanityName') ?? '';
    if (v === 'renamed-org') {
      // Results that are not the vanity asked for must not be used.
      return {
        json: {
          elements: [{ ...ORGS['example-corp'], vanityName: 'example-corp' }],
        },
      };
    }
    const o = ORGS[v.toLowerCase()];
    return {
      json: {
        elements: o ? [{ ...o, vanityName: v.toLowerCase() }] : [],
        paging: { start: 0, count: 10, links: [] },
      },
    };
  }
  if (u.pathname === '/rest/posts' && c.method === 'POST') {
    return {
      status: 201,
      headers: { 'x-restli-id': 'urn:li:share:7000000000000000001' },
    };
  }
  if (u.pathname.startsWith('/rest/socialActions/') && c.method === 'POST') {
    return {
      status: 201,
      json: { commentUrn: 'urn:li:comment:(urn:li:activity:111,222)' },
    };
  }
  return undefined;
});
after(li.restore);

const call = captureTools(registerTools as never);

const posts = () =>
  li.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/rest/posts'));
const comments = () =>
  li.calls.filter(
    (c) => c.method === 'POST' && c.url.includes('/rest/socialActions/'),
  );
const pageFetches = () =>
  li.calls.filter((c) => c.url.endsWith('/rest/organizations/1234567'));
const lookups = () =>
  li.calls.filter(
    (c) =>
      c.method === 'GET' &&
      new URL(c.url).pathname.startsWith('/rest/organizations') &&
      !c.url.endsWith('/rest/organizations/1234567'),
  );
const vanitiesAsked = () =>
  lookups().map((c) => new URL(c.url).searchParams.get('vanityName'));

beforeEach(() => {
  li.calls.length = 0;
});

const POST_URN = 'urn:li:share:6844785523593134080';

function m(
  name: string,
  urn: string,
  kind: ResolvedMention['kind'] = 'organization',
): Piece {
  return {
    mention: {
      typed: name,
      target: urn,
      urn,
      name,
      kind,
      verified: kind !== 'person',
    },
  };
}

const ref = (target: string) => ({
  raw: `@[x](${target})`,
  typed: 'x',
  target,
});

describe('classify — the target forms', () => {
  for (const [target, vanity] of [
    ['linkedin.com/company/acme', 'acme'],
    ['linkedin.com/company/acme/', 'acme'],
    ['https://www.linkedin.com/company/acme/', 'acme'],
    ['https://www.linkedin.com/company/acme/?viewAsMember=true', 'acme'],
    ['https://www.linkedin.com/company/acme?viewAsMember=true', 'acme'],
    ['https://www.linkedin.com/company/acme/about/', 'acme'],
    ['https://www.linkedin.com/company/acme/posts/?feedView=all', 'acme'],
    ['https://m.linkedin.com/company/acme', 'acme'],
    [
      'https://es.linkedin.com/school/example-university/',
      'example-university',
    ],
    ['http://linkedin.com/school/example-university#top', 'example-university'],
    ['https://www.linkedin.com/company/caf%C3%A9-co/', 'café-co'],
  ] as const) {
    it(`reads ${target} as the vanity "${vanity}"`, () => {
      assert.deepEqual(classify(ref(target)), { kind: 'vanity', vanity });
    });
  }

  it('reads a numeric company address as an organization id', () => {
    assert.deepEqual(
      classify(ref('https://www.linkedin.com/company/1234567/')),
      { kind: 'org-id', id: '1234567' },
    );
  });

  it('reads organization and person URNs', () => {
    assert.deepEqual(classify(ref('urn:li:organization:1')), {
      kind: 'org-id',
      id: '1',
    });
    assert.deepEqual(classify(ref('urn:li:person:Ab-1_x')), {
      kind: 'person',
      urn: 'urn:li:person:Ab-1_x',
    });
  });
});

describe('parseMentions', () => {
  it('leaves a bare @handle and a non-LinkedIn link as plain text', () => {
    const t = 'hola @todos y @[web](https://example.com)';
    assert.deepEqual(parseMentions(t), [{ text: t }]);
  });

  it('does not take a LinkedIn address quoted inside another URL for one', () => {
    const t = '@[x](https://example.com/?u=linkedin.com/in/jane)';
    assert.deepEqual(parseMentions(t), [{ text: t }]);
  });

  it('refuses a profile URL instead of degrading it to plain text', () => {
    assert.throws(
      () => parseMentions('gracias @[Jane](linkedin.com/in/jane-doe)'),
      (e: Error) =>
        e instanceof MentionError &&
        /@\[Jane\]\(linkedin\.com\/in\/jane-doe\)/.test(e.message) &&
        /urn:li:person/.test(e.message),
    );
  });

  it('refuses a LinkedIn target it cannot mention', () => {
    assert.throws(
      () => parseMentions('@[X](linkedin.com/showcase/x)'),
      MentionError,
    );
    assert.throws(() => parseMentions('@[X](urn:li:group:9)'), MentionError);
  });

  it('refuses a brand URN instead of rewriting it', () => {
    assert.throws(
      () => parseMentions('@[B](urn:li:organizationBrand:5)'),
      (e: Error) =>
        e instanceof MentionError &&
        /urn:li:organizationBrand:5/.test(e.message) &&
        /urn:li:organization:<the same id>/.test(e.message),
    );
  });

  for (const malformed of [
    '@[Acme](acme)',
    '@[Acme]( https://linkedin.com/company/acme)',
    '@[Acme](https://linkedin.com/company/acme )',
    '@[Acme](lnkd.in/x)',
    '@[Acme](https://lnkd.in/x)',
    '@[Acme](www.example.com)',
    '@[Acme](mailto:hola@example.com)',
    '@[Acme]()',
  ]) {
    it(`refuses ${JSON.stringify(malformed)}, naming it and the accepted forms`, () => {
      assert.throws(
        () => parseMentions(`Gracias ${malformed}!`),
        (e: Error) =>
          e instanceof MentionError &&
          e.message.includes(malformed) &&
          /Accepted forms: .*company.*school.*urn:li:organization:<id>.*urn:li:person:<id>/.test(
            e.message,
          ),
      );
    });
  }

  it('keeps a link to another website as plain text', () => {
    for (const t of [
      '@[web](https://example.com)',
      '@[web](http://example.com/a?b=c#d)',
    ]) {
      assert.deepEqual(parseMentions(t), [{ text: t }]);
    }
  });
});

describe('postCommentary — a mention survives escaping', () => {
  it('writes the mention in little format and escapes everything around it', () => {
    const pieces: Piece[] = [
      { text: 'Gracias (de verdad) a ' },
      m('Acme', 'urn:li:organization:1'),
      { text: ' — 100%_listo #IA @todos' },
    ];
    assert.equal(
      commentaryOf(pieces),
      'Gracias \\(de verdad\\) a @[Acme](urn:li:organization:1) — 100%\\_listo #IA \\@todos',
    );
  });

  it("escapes reserved characters inside the entity's name", () => {
    assert.equal(
      postCommentary(
        [m('Foo (Bar) #1', 'urn:li:organization:1')],
        escapeLittle,
        escapeLittleAll,
      ),
      '@[Foo \\(Bar\\) \\#1](urn:li:organization:1)',
    );
  });

  it('judges a # right after a mention in context, not as a new word', () => {
    assert.equal(
      commentaryOf([m('Acme', 'urn:li:organization:1'), { text: '#tag' }]),
      '@[Acme](urn:li:organization:1)\\#tag',
    );
  });

  it('judges it after the markup\'s ")", not after the last character of the name', () => {
    // A name ending in a quote would let a hashtag start after it; what
    // LinkedIn parses before the "#" is the ")" that closes the mention.
    assert.equal(
      commentaryOf([m('Grupo "X"', 'urn:li:organization:1'), { text: '#tag' }]),
      '@[Grupo "X"](urn:li:organization:1)\\#tag',
    );
  });
});

describe('body builders take resolved pieces only', () => {
  it('a post body is built from the pieces, not by re-parsing text', () => {
    const body = buildPostBody(ORG, {
      pieces: [{ text: 'Hola ' }, m('Acme', 'urn:li:organization:1')],
    });
    assert.equal(body.commentary, 'Hola @[Acme](urn:li:organization:1)');
  });

  it('a comment without mentions is sent exactly as before', async () => {
    const body = buildCommentBody(ORG, {
      postUrn: POST_URN,
      pieces: await composeText(parseMentions('Gracias (de verdad)')),
    });
    assert.deepEqual(body.message, { text: 'Gracias (de verdad)' });
    assert.equal(li.calls.length, 0);
  });
});

describe('commentMessage — offsets in UTF-16 code units', () => {
  it('places the attribute after an emoji outside the BMP', () => {
    const msg = commentMessage([
      { text: '🚀🚀🚀 ' },
      m('Example Corp', 'urn:li:organization:1001'),
      { text: ', gracias' },
    ]);
    assert.equal(msg.text, '🚀🚀🚀 Example Corp, gracias');
    assert.deepEqual(msg.attributes, [
      {
        start: 7, // three 🚀 are 6 UTF-16 units (3 code points), plus a space
        length: 12,
        value: { organization: { organization: 'urn:li:organization:1001' } },
      },
    ]);
    const a = msg.attributes[0];
    assert.equal(msg.text.slice(a.start, a.start + a.length), 'Example Corp');
  });

  it('keeps two mentions right, including an emoji inside a name', () => {
    const msg = commentMessage([
      { text: 'é ' },
      m('Ana 🌻', 'urn:li:person:p1', 'person'),
      { text: ' y 👩🏽‍💻 ' },
      m('Beta', 'urn:li:organization:2'),
      { text: '.' },
    ]);
    const names = ['Ana 🌻', 'Beta'];
    msg.attributes.forEach((a, i) =>
      assert.equal(msg.text.slice(a.start, a.start + a.length), names[i]),
    );
    assert.deepEqual(msg.attributes[0].value, {
      person: { person: 'urn:li:person:p1' },
    });
    assert.equal(msg.attributes[0].length, 6, 'the sunflower counts as 2');
  });

  it('visibleText is the comment text', () => {
    const pieces: Piece[] = [
      { text: '🚀 ' },
      m('Acme', 'urn:li:organization:1'),
    ];
    assert.equal(visibleText(pieces), commentMessage(pieces).text);
  });
});

describe('composeText', () => {
  const compose = (text: string) => composeText(parseMentions(text));

  it("uses LinkedIn's localizedName, whatever was typed", async () => {
    const [p] = await compose('@[EU](linkedin.com/school/example-university)');
    assert.deepEqual(p, {
      mention: {
        typed: 'EU',
        target: 'linkedin.com/school/example-university',
        urn: 'urn:li:organization:2002',
        name: 'Example University - Campus Norte',
        kind: 'school',
        verified: true,
      },
    });
  });

  it('looks a pasted browser address up by its vanity', async () => {
    await compose(
      '@[x](https://www.linkedin.com/company/Example-Corp/posts/?feedView=all)',
    );
    assert.deepEqual(vanitiesAsked(), ['Example-Corp']);
  });

  it('treats an empty `elements` as a mention that does not resolve', async () => {
    await assert.rejects(
      compose('@[Nope](linkedin.com/company/no-such-org)'),
      (e: Error) =>
        e instanceof MentionError &&
        /@\[Nope\]\(linkedin\.com\/company\/no-such-org\)/.test(e.message) &&
        /no-such-org/.test(e.message),
    );
  });

  it('refuses results that are not the vanity asked for', async () => {
    await assert.rejects(
      compose('@[R](linkedin.com/company/renamed-org)'),
      (e: Error) =>
        e instanceof MentionError && /"renamed-org"/.test(e.message),
    );
  });

  it('fails on a 403 for an organization id, pointing at the page address', async () => {
    await assert.rejects(
      compose('@[Other](urn:li:organization:42)'),
      (e: Error) =>
        e instanceof MentionError &&
        /HTTP 403/.test(e.message) &&
        /linkedin\.com\/company\/<vanity>/.test(e.message),
    );
  });

  it('routes a numeric company address to the id path, never the vanity one', async () => {
    await assert.rejects(
      compose('@[Other](https://www.linkedin.com/company/42/)'),
      (e: Error) =>
        e instanceof MentionError &&
        /HTTP 403/.test(e.message) &&
        !/vanity name "42"/.test(e.message),
    );
    assert.deepEqual(vanitiesAsked(), [null], 'one by-id call, no vanity call');
  });

  it('resolves an id the member administers', async () => {
    const [p] = await compose('@[x](urn:li:organization:1234567)');
    assert.equal(
      (p as { mention: ResolvedMention }).mention.name,
      'Example Co',
    );
  });

  it('uses an organization it already knows without a call', async () => {
    const [p] = await composeText(
      parseMentions('@[x](urn:li:organization:1234567)'),
      [{ id: '1234567', localizedName: 'Example Co' }],
    );
    assert.equal(li.calls.length, 0);
    assert.equal((p as { mention: ResolvedMention }).mention.urn, ORG);
  });

  it('uses an organization it already knows by vanity name without a call', async () => {
    const [p] = await composeText(
      parseMentions('@[x](https://www.linkedin.com/company/Example-Co/)'),
      [
        {
          id: '1234567',
          vanityName: 'example-co',
          localizedName: 'Example Co',
        },
      ],
    );
    assert.equal(li.calls.length, 0);
    assert.equal((p as { mention: ResolvedMention }).mention.urn, ORG);
  });

  it(`runs at most ${LOOKUP_CONCURRENCY} lookups at once`, async () => {
    let active = 0;
    let peak = 0;
    let calls = 0;
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL) => {
      calls++;
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      const v = new URL(String(input)).searchParams.get('vanityName') ?? '';
      const text = JSON.stringify({
        elements: [{ id: v.length, localizedName: v, vanityName: v }],
      });
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => text,
        json: async () => JSON.parse(text),
      };
    }) as unknown as typeof fetch;
    try {
      await composeText(
        parseMentions(
          Array.from(
            { length: 8 },
            (_, i) => `@[o${i}](linkedin.com/company/org-${i})`,
          ).join(' '),
        ),
      );
      assert.equal(calls, 8);
      assert.equal(peak, LOOKUP_CONCURRENCY);
    } finally {
      globalThis.fetch = real;
    }
  });

  it('takes a person URN as given, unverified, with no call', async () => {
    const [p] = await compose('@[Jane](urn:li:person:abc123)');
    const mention = (p as { mention: ResolvedMention }).mention;
    assert.equal(li.calls.length, 0);
    assert.deepEqual(
      { name: mention.name, kind: mention.kind, verified: mention.verified },
      { name: 'Jane', kind: 'person', verified: false },
    );
  });

  it('looks each distinct target up once, case-insensitively', async () => {
    const pieces = await compose(
      '@[a](linkedin.com/company/example-corp) y @[b](https://linkedin.com/company/Example-Corp/) ' +
        'y @[c](linkedin.com/school/example-university)',
    );
    assert.equal(lookups().length, 2);
    assert.deepEqual(
      mentionsOf(pieces).map((x) => x.typed),
      ['a', 'b', 'c'],
      'every mention keeps its own place and typed name',
    );
  });
});

describe('linkedin_post with mentions', () => {
  const text =
    'Gracias a @[Example](linkedin.com/company/example-corp) y a @[EU](linkedin.com/school/example-university) (hoy) #IA';

  it('lists every mention in the preview and publishes nothing', async () => {
    const out = await call('linkedin_post', { text });
    assert.match(out, /^PREVIEW/);
    assert.match(
      out,
      /Gracias a Example Corp y a Example University - Campus Norte \(hoy\) #IA/,
      'the text as readers will see it',
    );
    assert.match(out, /Example Corp — organization — urn:li:organization:1001/);
    assert.match(
      out,
      /Example University - Campus Norte — school — urn:li:organization:2002/,
    );
    assert.match(
      out,
      /you wrote "EU"; LinkedIn's name is "Example University - Campus Norte"/,
    );
    assert.doesNotMatch(out, /WARNING/);
    assert.equal(posts().length, 0);
  });

  it('publishes what the preview resolved, with no lookup at confirm', async () => {
    const preview = await call('linkedin_post', { text });
    const before = li.calls.length;
    const out = await call('linkedin_post', {
      text,
      confirm_token: tokenIn(preview),
    });
    assert.match(out, /^PUBLISHED/);
    assert.equal(posts().length, 1);
    assert.equal(
      (posts()[0].body as { commentary: string }).commentary,
      'Gracias a @[Example Corp](urn:li:organization:1001) y a ' +
        '@[Example University - Campus Norte](urn:li:organization:2002) \\(hoy\\) #IA',
    );
    assert.equal(
      li.calls.length,
      before + 1,
      'confirming makes exactly one call: the post itself',
    );
  });

  it('publishes the names that were shown, even if LinkedIn changes them after', async () => {
    const t = '@[E](linkedin.com/company/example-corp)';
    const preview = await call('linkedin_post', { text: t });
    ORGS['example-corp'].localizedName = 'Example Corporation';
    try {
      await call('linkedin_post', { text: t, confirm_token: tokenIn(preview) });
    } finally {
      ORGS['example-corp'].localizedName = 'Example Corp';
    }
    assert.equal(
      (posts()[0].body as { commentary: string }).commentary,
      '@[Example Corp](urn:li:organization:1001)',
    );
  });

  it('refuses a bad token with no network call at all', async () => {
    const out = await call('linkedin_post', {
      text,
      confirm_token: 'deadbeefdeadbeef',
    });
    assert.match(out, /^REFUSED/);
    assert.equal(li.calls.length, 0);
  });

  it('mentioning the Page itself costs no second fetch', async () => {
    await call('linkedin_post', {
      text: 'Somos @[x](urn:li:organization:1234567)',
    });
    assert.equal(pageFetches().length, 1);
  });

  it('mentioning the Page by its vanity address costs no lookup', async () => {
    const out = await call('linkedin_post', {
      text: 'Somos @[x](https://www.linkedin.com/company/example-co/)',
    });
    assert.match(
      out,
      /Example Co — organization — urn:li:organization:1234567/,
    );
    assert.equal(lookups().length, 0);
    assert.equal(pageFetches().length, 1);
  });

  it('aborts on an unresolved mention before any token or publish', async () => {
    const out = await call('linkedin_post', {
      text: 'Hola @[Nope](linkedin.com/company/no-such-org)',
    });
    assert.match(out, /^ERROR: .*@\[Nope\]/);
    assert.doesNotMatch(out, /confirm_token/);
    assert.equal(posts().length, 0);
  });

  it('warns when a name holds characters the post markup reserves', async () => {
    const out = await call('linkedin_post', {
      text: '@[P](linkedin.com/company/paren-co)',
    });
    assert.match(out, /Paren Co \(Latam\) — organization/);
    assert.match(
      out,
      /WARNING: this name contains characters that LinkedIn post markup reserves.*not verified.*plain text/s,
    );
  });

  it('does not warn for the same name in a comment, which has no markup', async () => {
    const out = await call('linkedin_comment', {
      post_urn: POST_URN,
      text: '@[P](linkedin.com/company/paren-co)',
    });
    assert.match(out, /Paren Co \(Latam\) — organization/);
    assert.doesNotMatch(out, /WARNING/);
  });
});

describe('linkedin_post — the length limit', () => {
  const mention = '@[E](linkedin.com/company/example-corp)'; // "Example Corp", 12

  it('refuses before any I/O when the text cannot fit', async () => {
    const out = await call('linkedin_post', {
      text: `${'x'.repeat(3000)} ${mention}`,
      image_path: '/nonexistent/never-read.png',
    });
    assert.match(
      out,
      /^ERROR: The text is 3002 characters; LinkedIn allows 3000/,
    );
    assert.equal(li.calls.length, 0, 'no lookup, no Page fetch, no file read');
  });

  it('counts the text readers see, as 0.1.0 did', async () => {
    // As read: 2987 + 1 + 12 = 3000. As typed: 3027. Fits.
    const fits = await call('linkedin_post', {
      text: `${'x'.repeat(2987)} ${mention}`,
    });
    assert.match(fits, /^PREVIEW/);
    assert.match(fits, /Length: {4}3000 characters/);
    // As read: 2988 + 1 + 12 = 3001. Over.
    const over = await call('linkedin_post', {
      text: `${'x'.repeat(2988)} ${mention}`,
    });
    assert.match(over, /^ERROR: The text is 3001 characters/);
    assert.doesNotMatch(over, /confirm_token/);
  });

  it('a post that passed 0.1.0 still passes: escapes do not count against it', async () => {
    const out = await call('linkedin_post', { text: '('.repeat(1600) });
    assert.match(out, /^PREVIEW/);
    assert.match(out, /Length: {4}1600 characters/);
    assert.match(
      out,
      /WARNING: {3}as LinkedIn receives it .* the post is 3200 characters, over its 3000\. LinkedIn may refuse it/,
    );
    assert.match(out, /confirm_token/, 'a warning, not a refusal');
  });

  it('warns when the markup takes the commentary past the limit', async () => {
    // As read 2961; as sent 2948 + 1 + 41 ("@[Example Corp](urn:li:organization:1001)") = 2990, no warning.
    const quiet = await call('linkedin_post', {
      text: `${'x'.repeat(2948)} ${mention}`,
    });
    assert.doesNotMatch(quiet, /WARNING/);
    // As read 2985 + 1 + 12 = 2998; as sent 2985 + 1 + 41 = 3027: warned, not refused.
    const loud = await call('linkedin_post', {
      text: `${'x'.repeat(2985)} ${mention}`,
    });
    assert.match(loud, /WARNING: .*3027 characters/);
    assert.match(loud, /confirm_token/);
  });

  it('never refuses on length after an upload', async () => {
    // Preview passes with a warning; confirming publishes without a length
    // refusal, so an uploaded file is always used.
    const text = '('.repeat(1600);
    const preview = await call('linkedin_post', { text });
    const out = await call('linkedin_post', {
      text,
      confirm_token: tokenIn(preview),
    });
    assert.match(out, /^PUBLISHED/);
  });
});

describe('linkedin_comment — the 1,250-character limit', () => {
  it('refuses before any I/O when the text cannot fit', async () => {
    const out = await call('linkedin_comment', {
      post_urn: POST_URN,
      text: 'x'.repeat(1251),
    });
    assert.match(
      out,
      /^ERROR: The text is 1251 characters; LinkedIn allows 1250/,
    );
    assert.equal(li.calls.length, 0);
  });

  it("counts mentions expanded to LinkedIn's names", async () => {
    // Typed: 1220 + 1 + "@[EU](linkedin.com/school/example-university)" = 1267
    // characters, but the name it expands to is what counts:
    // 1220 + 1 + "Example University - Campus Norte" (33) = 1254.
    const t = `${'x'.repeat(1220)} @[EU](linkedin.com/school/example-university)`;
    const out = await call('linkedin_comment', { post_urn: POST_URN, text: t });
    assert.match(
      out,
      /^ERROR: The text is 1254 characters; LinkedIn allows 1250/,
    );
    assert.doesNotMatch(out, /confirm_token/);
    assert.equal(comments().length, 0);
  });

  it('a short typed name that expands past the limit is refused', async () => {
    // As typed the visible floor is 1240 + 1 + 1 = 1242, under the limit; the
    // name LinkedIn has is 33 characters: 1240 + 1 + 33 = 1274.
    const t = `${'x'.repeat(1240)} @[U](linkedin.com/school/example-university)`;
    const out = await call('linkedin_comment', { post_urn: POST_URN, text: t });
    assert.match(out, /^ERROR: The text is 1274 characters/);
    assert.doesNotMatch(out, /confirm_token/);
  });

  it('accepts exactly 1,250 characters, emoji counted as one', async () => {
    const out = await call('linkedin_comment', {
      post_urn: POST_URN,
      text: `🚀${'x'.repeat(1249)}`,
    });
    assert.match(out, /^PREVIEW/);
  });
});

describe('linkedin_comment with mentions', () => {
  it('sends plain text plus UTF-16 attributes, emoji first', async () => {
    const text =
      '🚀🚀🚀 @[Example](linkedin.com/company/example-corp), gracias';
    const preview = await call('linkedin_comment', {
      post_urn: POST_URN,
      text,
    });
    assert.match(preview, /🚀🚀🚀 Example Corp, gracias/);
    assert.match(preview, /Mentions:/);
    assert.equal(comments().length, 0);

    const before = li.calls.length;
    const out = await call('linkedin_comment', {
      post_urn: POST_URN,
      text,
      confirm_token: tokenIn(preview),
    });
    assert.match(out, /^PUBLISHED/);
    assert.equal(li.calls.length, before + 1, 'no lookup at confirm');
    assert.deepEqual(comments()[0].body, {
      actor: ORG,
      object: POST_URN,
      message: {
        text: '🚀🚀🚀 Example Corp, gracias',
        attributes: [
          {
            start: 7,
            length: 12,
            value: {
              organization: { organization: 'urn:li:organization:1001' },
            },
          },
        ],
      },
    });
  });

  it('mentions a person by explicit URN and says the name is unchecked', async () => {
    const text = 'Gracias @[Jane](urn:li:person:abc123)!';
    const preview = await call('linkedin_comment', {
      post_urn: POST_URN,
      text,
    });
    assert.match(preview, /Jane — person — urn:li:person:abc123/);
    assert.match(preview, /not checked/);
    await call('linkedin_comment', {
      post_urn: POST_URN,
      text,
      confirm_token: tokenIn(preview),
    });
    assert.deepEqual((comments()[0].body as { message: unknown }).message, {
      text: 'Gracias Jane!',
      attributes: [
        {
          start: 8,
          length: 4,
          value: { person: { person: 'urn:li:person:abc123' } },
        },
      ],
    });
  });

  it('aborts on a 403 organization id before any token or publish', async () => {
    const out = await call('linkedin_comment', {
      post_urn: POST_URN,
      text: 'Hola @[Other](urn:li:organization:42)',
    });
    assert.match(out, /^ERROR: .*@\[Other\]\(urn:li:organization:42\).*403/);
    assert.doesNotMatch(out, /confirm_token/);
    assert.equal(comments().length, 0);
  });

  it('refuses a token issued for a different mention target, with no call', async () => {
    const preview = await call('linkedin_comment', {
      post_urn: POST_URN,
      text: '@[x](linkedin.com/company/example-corp)',
    });
    li.calls.length = 0;
    const out = await call('linkedin_comment', {
      post_urn: POST_URN,
      text: '@[x](linkedin.com/school/example-university)',
      confirm_token: tokenIn(preview),
    });
    assert.match(out, /^REFUSED/);
    assert.equal(li.calls.length, 0);
  });
});
