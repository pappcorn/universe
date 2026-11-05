// The HTTP layer: the headers LinkedIn requires on every call, URN encoding,
// the single renewal on 401, and error messages that carry LinkedIn's words
// but never the request.

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

import { fakeLinkedIn, isolate, tempDir } from './helpers';
import { encodeUrn, LinkedInApiError, request, restliList } from '../src/api';
import { resetConfigCache } from '../src/config';
import { listComments, listPosts, pageStats } from '../src/core';

const files = tempDir();
after(files.cleanup);
let cleanup = () => {};
beforeEach(() => {
  cleanup();
  cleanup = isolate();
  resetConfigCache();
});
after(() => cleanup());

describe('request', () => {
  it('sends the versioned-API headers on every call', async () => {
    const li = fakeLinkedIn(() => ({ json: {} }));
    try {
      await request('GET', 'organizations/1234567');
      const h = li.calls[0].headers;
      assert.equal(h.Authorization, 'Bearer test-access-token');
      assert.equal(h['LinkedIn-Version'], '202610');
      assert.equal(h['X-Restli-Protocol-Version'], '2.0.0');
      assert.equal(
        li.calls[0].url,
        'https://api.linkedin.com/rest/organizations/1234567',
      );
    } finally {
      li.restore();
    }
  });

  it('honors LINKEDIN_API_VERSION', async () => {
    process.env.LINKEDIN_API_VERSION = '202701';
    const li = fakeLinkedIn(() => ({ json: {} }));
    try {
      await request('GET', 'x');
      assert.equal(li.calls[0].headers['LinkedIn-Version'], '202701');
    } finally {
      li.restore();
    }
  });

  it('renews once on 401 and retries', async () => {
    delete process.env.LINKEDIN_ACCESS_TOKEN;
    const p = join(files.dir, 'c.json');
    writeFileSync(
      p,
      JSON.stringify({
        client_id: 'cid',
        client_secret: 's',
        access_token: 'revoked-early',
        access_token_expires_at: Math.floor(Date.now() / 1000) + 86400,
        refresh_token: 'r',
        organization: 'urn:li:organization:1',
      }),
    );
    process.env.LINKEDIN_MCP_CREDENTIALS = p;
    const li = fakeLinkedIn((c) => {
      if (c.url.includes('/oauth/v2/accessToken'))
        return { json: { access_token: 'fresh', expires_in: 100 } };
      return c.headers.Authorization === 'Bearer fresh'
        ? { json: { ok: 1 } }
        : { status: 401, json: {} };
    });
    try {
      const res = await request<{ ok: number }>('GET', 'x');
      assert.equal(res.body.ok, 1);
      assert.equal(li.calls.filter((c) => c.url.includes('/rest/x')).length, 2);
    } finally {
      li.restore();
    }
  });

  it("surfaces LinkedIn's error with a hint, never the token", async () => {
    const li = fakeLinkedIn(() => ({
      status: 403,
      json: { code: 'ACCESS_DENIED', message: 'Not enough permissions' },
    }));
    try {
      await assert.rejects(request('GET', 'x'), (e: Error) => {
        assert.ok(e instanceof LinkedInApiError);
        assert.match(
          e.message,
          /HTTP 403\): ACCESS_DENIED: Not enough permissions\. .*ADMINISTRATOR/,
        );
        assert.doesNotMatch(e.message, /test-access-token/);
        return true;
      });
    } finally {
      li.restore();
    }
  });

  it('explains a sunset API version', async () => {
    const li = fakeLinkedIn(() => ({
      status: 426,
      json: { code: 'NONEXISTENT_VERSION' },
    }));
    try {
      await assert.rejects(request('GET', 'x'), /LINKEDIN_API_VERSION/);
    } finally {
      li.restore();
    }
  });
});

describe('URN encoding', () => {
  it('encodes composite URNs completely, parentheses included', () => {
    assert.equal(
      encodeUrn('urn:li:comment:(urn:li:activity:1,2)'),
      'urn%3Ali%3Acomment%3A%28urn%3Ali%3Aactivity%3A1%2C2%29',
    );
  });
  it('builds Rest.li 2.0 lists', () => {
    assert.equal(
      restliList(['urn:li:share:1', 'urn:li:share:2']),
      'List(urn%3Ali%3Ashare%3A1,urn%3Ali%3Ashare%3A2)',
    );
  });
});

describe('read operations', () => {
  it('lists posts with the author finder', async () => {
    const li = fakeLinkedIn(() => ({
      json: {
        elements: [
          {
            id: 'urn:li:share:1',
            commentary: 'hola',
            content: { media: { id: 'urn:li:document:D1', title: 'x.pdf' } },
          },
        ],
      },
    }));
    try {
      const posts = await listPosts(5);
      const u = new URL(li.calls[0].url);
      assert.equal(u.pathname, '/rest/posts');
      assert.equal(u.searchParams.get('q'), 'author');
      assert.equal(u.searchParams.get('author'), 'urn:li:organization:1234567');
      assert.equal(li.calls[0].headers['X-RestLi-Method'], 'FINDER');
      assert.equal(posts[0].media, 'document "x.pdf"');
      assert.equal(
        posts[0].url,
        'https://www.linkedin.com/feed/update/urn:li:share:1/',
      );
    } finally {
      li.restore();
    }
  });

  it("marks the Page's own comments", async () => {
    const li = fakeLinkedIn(() => ({
      json: {
        elements: [
          {
            id: '1',
            commentUrn: 'urn:li:comment:(urn:li:activity:9,1)',
            actor: 'urn:li:person:abc',
            message: { text: 'Buenísimo' },
          },
          {
            id: '2',
            commentUrn: 'urn:li:comment:(urn:li:activity:9,2)',
            actor: 'urn:li:organization:1234567',
            message: { text: 'Gracias' },
          },
          {
            id: '3',
            commentUrn: 'urn:li:comment:(urn:li:activity:9,3)',
            actor: 'urn:li:organization:7654321',
            message: { text: 'Felicitaciones' },
          },
        ],
      },
    }));
    try {
      const list = await listComments('urn:li:share:9');
      assert.deepEqual(
        list.map((c) => c.byPage),
        [false, true, false],
        'another organization is an author, not this Page',
      );
      assert.equal(list[2].actor, 'urn:li:organization:7654321');
      assert.ok(
        li.calls[0].url.startsWith(
          'https://api.linkedin.com/rest/socialActions/urn%3Ali%3Ashare%3A9/comments?',
        ),
      );
    } finally {
      li.restore();
    }
  });

  it('reads followers and share statistics, zero-filling quiet posts', async () => {
    const li = fakeLinkedIn((c) => {
      const u = new URL(c.url);
      if (u.pathname.startsWith('/rest/networkSizes/'))
        return { json: { firstDegreeSize: 321 } };
      if (u.searchParams.get('shares')) {
        return {
          json: {
            elements: [
              {
                share: 'urn:li:share:1',
                totalShareStatistics: { impressionCount: 10 },
              },
            ],
          },
        };
      }
      return {
        json: {
          elements: [
            { totalShareStatistics: { impressionCount: 500, likeCount: 7 } },
          ],
        },
      };
    });
    try {
      const s = await pageStats(['urn:li:share:1', 'urn:li:share:2']);
      assert.equal(s.followers, 321);
      assert.equal(s.lifetime?.impressionCount, 500);
      assert.deepEqual(s.posts, [
        { urn: 'urn:li:share:1', stats: { impressionCount: 10 } },
        { urn: 'urn:li:share:2', stats: {} },
      ]);
      assert.match(
        li.calls[0].url,
        /networkSizes\/urn%3Ali%3Aorganization%3A1234567\?edgeType=COMPANY_FOLLOWED_BY_MEMBER$/,
      );
    } finally {
      li.restore();
    }
  });
});
