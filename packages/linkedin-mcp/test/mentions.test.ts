// Mentions, end to end against a fake LinkedIn, plus the pure pieces on their
// own. What must hold (issue #114):
//   1. A mention survives the little-format escaping while every reserved
//      character around it is still escaped; a bare @handle stays plain text.
//   2. Comment attributes count UTF-16 code units, so an emoji before a
//      mention does not shift the link.
//   3. A mention that does not resolve — an empty `elements` from the vanity
//      lookup, a 403/404 on an organization id — aborts before any request
//      that publishes, and before any confirm token.
//   4. The preview lists every mention, and the confirm token is bound to the
//      resolved mentions: if what LinkedIn resolves changes, nothing publishes.
//   5. Each target is resolved once and reused between preview and publish.

import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';

import { captureTools, fakeLinkedIn, isolate, ORG, tokenIn } from './helpers';

const cleanup = isolate();
after(cleanup);

import { escapeLittle, escapeLittleAll } from '../src/core';
import { ConfirmationGate } from '../src/gate';
import {
  commentMessage,
  MentionError,
  MentionResolver,
  mentionRefs,
  parseMentions,
  postCommentary,
  visibleText,
  type ResolvedMention,
} from '../src/mentions';
import { registerTools } from '../src/tools';

// Public, well-known organizations only; ids are illustrative.
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
};

const li = fakeLinkedIn((c) => {
  const u = new URL(c.url);
  if (u.pathname === '/rest/organizations/1234567') {
    return { json: { id: 1234567, localizedName: 'Example Co' } };
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

/** A server of its own, so its resolver starts with an empty cache. */
const fresh = () => captureTools(registerTools as never);

const posts = () =>
  li.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/rest/posts'));
const comments = () =>
  li.calls.filter(
    (c) => c.method === 'POST' && c.url.includes('/rest/socialActions/'),
  );
const lookups = () =>
  li.calls.filter(
    (c) =>
      c.method === 'GET' &&
      new URL(c.url).pathname.startsWith('/rest/organizations') &&
      !c.url.endsWith('/rest/organizations/1234567'),
  );

beforeEach(() => {
  li.calls.length = 0;
});

const POST_URN = 'urn:li:share:6844785523593134080';

function resolved(
  name: string,
  urn: string,
  kind: ResolvedMention['kind'] = 'organization',
): ResolvedMention {
  return {
    typed: name,
    target: urn,
    urn,
    name,
    kind,
    verified: kind !== 'person',
  };
}

describe('parseMentions', () => {
  it('finds each supported target form', () => {
    const refs = mentionRefs(
      parseMentions(
        'a @[A](urn:li:organization:1) b @[B](urn:li:person:Ab-1_x) ' +
          'c @[C](https://www.linkedin.com/company/c-co/) d @[D](linkedin.com/school/d-u) ' +
          'e @[E](urn:li:organizationBrand:5)',
      ),
    );
    assert.deepEqual(
      refs.map((r) => r.target),
      [
        'urn:li:organization:1',
        'urn:li:person:Ab-1_x',
        'https://www.linkedin.com/company/c-co/',
        'linkedin.com/school/d-u',
        'urn:li:organizationBrand:5',
      ],
    );
  });

  it('leaves a bare @handle and a non-LinkedIn link as plain text', () => {
    const segs = parseMentions('hola @todos y @[web](https://example.com)');
    assert.deepEqual(segs, [
      { text: 'hola @todos y @[web](https://example.com)' },
    ]);
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
});

describe('postCommentary — a mention survives escaping', () => {
  it('writes the mention in little format and escapes everything around it', () => {
    const text =
      'Gracias (de verdad) a @[Acme](urn:li:organization:1) — 100%_listo #IA @todos';
    const out = postCommentary(
      parseMentions(text),
      [resolved('Acme', 'urn:li:organization:1')],
      escapeLittle,
      escapeLittleAll,
    );
    assert.equal(
      out,
      'Gracias \\(de verdad\\) a @[Acme](urn:li:organization:1) — 100%\\_listo #IA \\@todos',
    );
  });

  it("escapes reserved characters inside the entity's name", () => {
    const out = postCommentary(
      parseMentions('@[x](urn:li:organization:1)'),
      [resolved('Foo (Bar) #1', 'urn:li:organization:1')],
      escapeLittle,
      escapeLittleAll,
    );
    assert.equal(out, '@[Foo \\(Bar\\) \\#1](urn:li:organization:1)');
  });

  it('judges a # right after a mention in context, not as a new word', () => {
    const out = postCommentary(
      parseMentions('@[Acme](urn:li:organization:1)#tag'),
      [resolved('Acme', 'urn:li:organization:1')],
      escapeLittle,
      escapeLittleAll,
    );
    assert.equal(out, '@[Acme](urn:li:organization:1)\\#tag');
  });

  it('refuses to build a commentary whose mentions were not resolved', () => {
    assert.throws(
      () =>
        postCommentary(
          parseMentions('@[Acme](urn:li:organization:1)'),
          [],
          escapeLittle,
          escapeLittleAll,
        ),
      MentionError,
    );
  });
});

describe('commentMessage — offsets in UTF-16 code units', () => {
  it('places the attribute after an emoji outside the BMP', () => {
    const text = '🚀🚀🚀 @[Acme](urn:li:organization:1), gracias';
    const msg = commentMessage(parseMentions(text), [
      resolved('Example Corp', 'urn:li:organization:1001'),
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
    const text = 'é @[A](urn:li:person:p1) y 👩🏽‍💻 @[B](urn:li:organization:2).';
    const msg = commentMessage(parseMentions(text), [
      resolved('Ana 🌻', 'urn:li:person:p1', 'person'),
      resolved('Beta', 'urn:li:organization:2'),
    ]);
    for (const [a, name] of msg.attributes.map(
      (x, i) => [x, ['Ana 🌻', 'Beta'][i]] as const,
    )) {
      assert.equal(msg.text.slice(a.start, a.start + a.length), name);
    }
    assert.deepEqual(msg.attributes[0].value, {
      person: { person: 'urn:li:person:p1' },
    });
    assert.equal(msg.attributes[0].length, 6, 'the sunflower counts as 2');
  });

  it('visibleText is the comment text', () => {
    const segs = parseMentions('🚀 @[x](urn:li:organization:1)');
    const r = [resolved('Acme', 'urn:li:organization:1')];
    assert.equal(visibleText(segs, r), commentMessage(segs, r).text);
  });
});

describe('MentionResolver', () => {
  it("uses LinkedIn's localizedName, whatever was typed", async () => {
    const [m] = await new MentionResolver().resolve(
      mentionRefs(
        parseMentions('@[EU](linkedin.com/school/example-university)'),
      ),
    );
    assert.deepEqual(m, {
      typed: 'EU',
      target: 'linkedin.com/school/example-university',
      urn: 'urn:li:organization:2002',
      name: 'Example University - Campus Norte',
      kind: 'school',
      verified: true,
    });
  });

  it('treats an empty `elements` as a mention that does not resolve', async () => {
    await assert.rejects(
      new MentionResolver().resolve(
        mentionRefs(parseMentions('@[Nope](linkedin.com/company/no-such-org)')),
      ),
      (e: Error) =>
        e instanceof MentionError &&
        /@\[Nope\]\(linkedin\.com\/company\/no-such-org\)/.test(e.message) &&
        /no-such-org/.test(e.message),
    );
  });

  it('fails on a 403 for an organization id, pointing at the vanity form', async () => {
    await assert.rejects(
      new MentionResolver().resolve(
        mentionRefs(parseMentions('@[Other](urn:li:organization:42)')),
      ),
      (e: Error) =>
        e instanceof MentionError &&
        /HTTP 403/.test(e.message) &&
        /linkedin\.com\/company\/<vanity>/.test(e.message),
    );
  });

  it('resolves an id the member administers', async () => {
    const [m] = await new MentionResolver().resolve(
      mentionRefs(parseMentions('@[x](urn:li:organization:1234567)')),
    );
    assert.equal(m.name, 'Example Co');
    assert.equal(m.urn, ORG);
  });

  it('maps an organizationBrand URN to its organization URN', async () => {
    const [m] = await new MentionResolver().resolve(
      mentionRefs(parseMentions('@[x](urn:li:organizationBrand:1234567)')),
    );
    assert.equal(m.urn, ORG);
  });

  it('takes a person URN as given, unverified, with no call', async () => {
    const [m] = await new MentionResolver().resolve(
      mentionRefs(parseMentions('@[Jane](urn:li:person:abc123)')),
    );
    assert.equal(lookups().length, 0);
    assert.deepEqual(
      { name: m.name, kind: m.kind, verified: m.verified },
      { name: 'Jane', kind: 'person', verified: false },
    );
  });

  it('resolves a repeated target once, case-insensitively', async () => {
    await new MentionResolver().resolve(
      mentionRefs(
        parseMentions(
          '@[a](linkedin.com/company/example-corp) y @[b](https://linkedin.com/company/Example-Corp/)',
        ),
      ),
    );
    assert.equal(lookups().length, 1);
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
    assert.equal(posts().length, 0);
  });

  it("publishes LinkedIn's names as mentions, resolving each target once", async () => {
    const own = fresh();
    const preview = await own('linkedin_post', { text });
    const out = await own('linkedin_post', {
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
    assert.equal(lookups().length, 2, 'two targets, two lookups in total');
  });

  it('aborts on an unresolved mention before any token or publish', async () => {
    const out = await call('linkedin_post', {
      text: 'Hola @[Nope](linkedin.com/company/no-such-org)',
    });
    assert.match(out, /^ERROR: .*@\[Nope\]/);
    assert.doesNotMatch(out, /confirm_token/);
    assert.equal(posts().length, 0);
  });

  it('counts the limit on the text readers see, not on the markup', async () => {
    const mention = '@[E](linkedin.com/company/example-corp)'; // 39 characters
    // 2980 + 1 + 39 = 3020 as typed, 2980 + 1 + 12 = 2993 as read: fits.
    const fits = await call('linkedin_post', {
      text: `${'x'.repeat(2980)} ${mention}`,
    });
    assert.match(fits, /^PREVIEW/);
    assert.match(fits, /Length: {4}2993 characters/);
    // 2990 + 1 + 12 = 3003 as read: over.
    const over = await call('linkedin_post', {
      text: `${'x'.repeat(2990)} ${mention}`,
    });
    assert.match(over, /^ERROR: The text is 3003 characters/);
    assert.doesNotMatch(over, /confirm_token/);
  });
});

describe('linkedin_post — the token is bound to the resolved mentions', () => {
  it('refuses when LinkedIn resolves a mention differently at publish time', async () => {
    let clock = 0;
    const local = captureTools(((s: never) =>
      registerTools(
        s,
        new ConfirmationGate(),
        new MentionResolver(() => clock, 1000),
      )) as never);
    const t = '@[E](linkedin.com/company/example-corp)';
    const preview = await local('linkedin_post', { text: t });

    ORGS['example-corp'].localizedName = 'Example Corporation';
    clock = 5000; // past the resolver's cache: the publish call looks it up again
    try {
      const out = await local('linkedin_post', {
        text: t,
        confirm_token: tokenIn(preview),
      });
      assert.match(out, /^REFUSED/);
      assert.equal(posts().length, 0);
    } finally {
      ORGS['example-corp'].localizedName = 'Example Corp';
    }
  });
});

describe('linkedin_comment with mentions', () => {
  it('sends plain text plus UTF-16 attributes, emoji first', async () => {
    const text =
      '🚀🚀🚀 @[Example](linkedin.com/company/example-corp), gracias';
    const own = fresh();
    const preview = await own('linkedin_comment', {
      post_urn: POST_URN,
      text,
    });
    assert.match(preview, /🚀🚀🚀 Example Corp, gracias/);
    assert.match(preview, /Mentions:/);
    assert.equal(comments().length, 0);

    const out = await own('linkedin_comment', {
      post_urn: POST_URN,
      text,
      confirm_token: tokenIn(preview),
    });
    assert.match(out, /^PUBLISHED/);
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
    assert.equal(lookups().length, 1, 'resolved once, reused at publish');
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

  it('refuses a token issued for a different mention target', async () => {
    const a = '@[x](linkedin.com/company/example-corp)';
    const preview = await call('linkedin_comment', {
      post_urn: POST_URN,
      text: a,
    });
    const out = await call('linkedin_comment', {
      post_urn: POST_URN,
      text: '@[x](linkedin.com/school/example-university)',
      confirm_token: tokenIn(preview),
    });
    assert.match(out, /^REFUSED/);
    assert.equal(comments().length, 0);
  });
});
