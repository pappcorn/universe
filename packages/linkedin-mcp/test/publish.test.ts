// The two outward tools end to end, against a fake LinkedIn. These assert on
// real effects ("was a post created?"), not on messages alone.
//
// What must hold:
//   1. A call without confirm_token publishes NOTHING and uploads nothing.
//   2. A wrong, replayed, or content-mismatched token publishes nothing.
//   3. Swapping the attached file after the preview voids the approval.
//   4. The right token publishes exactly once, with the documented request shape.
//   5. The access token never goes to a host other than LinkedIn.

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

import {
  isolate,
  fakeLinkedIn,
  captureTools,
  tokenIn,
  tempDir,
  ORG,
  type Call,
} from './helpers';

const cleanup = isolate();
const files = tempDir();
after(() => {
  cleanup();
  files.cleanup();
});

import { UPLOAD_POLL } from '../src/core';
import { registerTools } from '../src/tools';

UPLOAD_POLL.intervalMs = 0;

let uploadHost = 'www.linkedin.com';

const li = fakeLinkedIn((c: Call) => {
  const u = new URL(c.url);
  if (u.pathname === '/rest/organizations/1234567') {
    return { json: { localizedName: 'Example Co', vanityName: 'example-co' } };
  }
  if (u.pathname === '/rest/posts' && c.method === 'POST') {
    return {
      status: 201,
      json: undefined,
      headers: { 'x-restli-id': 'urn:li:share:7000000000000000001' },
    };
  }
  if (
    u.pathname === '/rest/images' &&
    u.search === '?action=initializeUpload'
  ) {
    return {
      json: {
        value: {
          uploadUrl: `https://${uploadHost}/dms-uploads/abc/uploaded-image/0`,
          image: 'urn:li:image:C4E10AQFoyyAjHPMQuQ',
        },
      },
    };
  }
  if (
    u.pathname === '/rest/documents' &&
    u.search === '?action=initializeUpload'
  ) {
    return {
      json: {
        value: {
          uploadUrl: `https://${uploadHost}/dms-uploads/def/ads-uploadedDocument/0`,
          document: 'urn:li:document:D5510AQHXjcP8QBYD9A',
        },
      },
    };
  }
  if (c.method === 'PUT' && u.pathname.startsWith('/dms-uploads/'))
    return { status: 201 };
  if (
    u.pathname.startsWith('/rest/images/') ||
    u.pathname.startsWith('/rest/documents/')
  ) {
    return { json: { status: 'AVAILABLE' } };
  }
  if (u.pathname.startsWith('/rest/socialActions/') && c.method === 'POST') {
    return {
      status: 201,
      json: {
        commentUrn: 'urn:li:comment:(urn:li:activity:111,222)',
        id: '222',
      },
      headers: { 'x-restli-id': '222' },
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
const uploads = () => li.calls.filter((c) => c.method === 'PUT');

beforeEach(() => {
  li.calls.length = 0;
  uploadHost = 'www.linkedin.com';
});

describe('linkedin_post — preview', () => {
  it('publishes nothing and uploads nothing', async () => {
    const img = join(files.dir, 'a.png');
    writeFileSync(img, 'png-bytes-1');
    const out = await call('linkedin_post', {
      text: 'Hola (mundo) #ia',
      image_path: img,
    });
    assert.match(out, /^PREVIEW/);
    assert.equal(posts().length, 0);
    assert.equal(uploads().length, 0);
    assert.ok(
      !li.calls.some((c) => c.url.includes('initializeUpload')),
      'no upload registered',
    );
  });

  it('shows the human the exact text, the Page and the attachment', async () => {
    const out = await call('linkedin_post', {
      text: 'Línea 1\nLínea 2 (sin escapes)',
    });
    assert.match(out, /Example Co \(urn:li:organization:1234567\)/);
    assert.match(
      out,
      /Línea 1\nLínea 2 \(sin escapes\)/,
      'the preview shows the raw text',
    );
  });

  it('rejects text over the limit before any token is issued', async () => {
    const out = await call('linkedin_post', { text: 'x'.repeat(3001) });
    assert.match(out, /^ERROR: .*3001/);
    assert.doesNotMatch(out, /confirm_token/);
  });

  it('rejects an image and a document together', async () => {
    const out = await call('linkedin_post', {
      text: 'x',
      image_path: '/tmp/a.png',
      document_path: '/tmp/b.pdf',
    });
    assert.match(out, /^ERROR: Attach an image OR a document/);
  });

  it('rejects an unsupported file type', async () => {
    const f = join(files.dir, 'clip.mp4');
    writeFileSync(f, 'video');
    const out = await call('linkedin_post', { text: 'x', document_path: f });
    assert.match(out, /^ERROR: .*unsupported document type/);
  });
});

describe('linkedin_post — confirmation', () => {
  it('refuses a token that was never issued', async () => {
    const out = await call('linkedin_post', {
      text: 'hola',
      confirm_token: 'deadbeefdeadbeef',
    });
    assert.match(out, /^REFUSED/);
    assert.equal(posts().length, 0);
  });

  it('refuses when the text changed after the preview', async () => {
    const preview = await call('linkedin_post', { text: 'hola' });
    const out = await call('linkedin_post', {
      text: 'hola!',
      confirm_token: tokenIn(preview),
    });
    assert.match(out, /^REFUSED/);
    assert.equal(posts().length, 0);
  });

  it('publishes a text post exactly once, with the documented body', async () => {
    const text = 'Soy Cris (agente) — 50% más_rápido #IA @todos';
    const preview = await call('linkedin_post', { text });
    const token = tokenIn(preview);
    const out = await call('linkedin_post', { text, confirm_token: token });
    assert.match(out, /^PUBLISHED/);
    assert.match(out, /urn:li:share:7000000000000000001/);
    assert.match(out, /logged to /);
    assert.equal(posts().length, 1);

    const body = posts()[0].body as Record<string, unknown>;
    assert.equal(body.author, ORG);
    assert.equal(body.visibility, 'PUBLIC');
    assert.equal(body.lifecycleState, 'PUBLISHED');
    assert.deepEqual(body.distribution, {
      feedDistribution: 'MAIN_FEED',
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    });
    assert.equal(
      body.commentary,
      'Soy Cris \\(agente\\) — 50% más\\_rápido #IA \\@todos',
      'reserved characters escaped, the hashtag left alone',
    );

    const replay = await call('linkedin_post', { text, confirm_token: token });
    assert.match(replay, /^REFUSED/, 'a token cannot publish twice');
    assert.equal(posts().length, 1);
  });

  it('uploads an image, waits for it, and posts it with alt text', async () => {
    const img = join(files.dir, 'b.png');
    writeFileSync(img, 'png-bytes-2');
    const args = {
      text: 'con imagen',
      image_path: img,
      image_alt_text: 'Un gráfico',
    };
    const preview = await call('linkedin_post', args);
    const out = await call('linkedin_post', {
      ...args,
      confirm_token: tokenIn(preview),
    });
    assert.match(out, /^PUBLISHED/);

    const init = li.calls.find((c) =>
      c.url.endsWith('/rest/images?action=initializeUpload'),
    );
    assert.deepEqual(init?.body, { initializeUploadRequest: { owner: ORG } });
    assert.equal(uploads().length, 1);
    assert.equal(
      uploads()[0].headers.Authorization,
      'Bearer test-access-token',
    );

    const body = posts()[0].body as {
      content: { media: Record<string, string> };
    };
    assert.deepEqual(body.content.media, {
      id: 'urn:li:image:C4E10AQFoyyAjHPMQuQ',
      altText: 'Un gráfico',
    });
  });

  it('posts a PDF as a document with a title', async () => {
    const pdf = join(files.dir, 'carrusel.pdf');
    writeFileSync(pdf, '%PDF-1.7 fake');
    const args = { text: 'carrusel', document_path: pdf };
    const preview = await call('linkedin_post', args);
    assert.match(preview, /document carrusel\.pdf \(PDF/);
    const out = await call('linkedin_post', {
      ...args,
      confirm_token: tokenIn(preview),
    });
    assert.match(out, /^PUBLISHED/);
    const body = posts()[0].body as {
      content: { media: Record<string, string> };
    };
    assert.deepEqual(body.content.media, {
      id: 'urn:li:document:D5510AQHXjcP8QBYD9A',
      title: 'carrusel.pdf',
    });
  });

  it('refuses when the file content changed after the preview', async () => {
    const img = join(files.dir, 'c.png');
    writeFileSync(img, 'approved-image');
    const preview = await call('linkedin_post', { text: 'x', image_path: img });
    writeFileSync(img, 'a-different-image');
    const out = await call('linkedin_post', {
      text: 'x',
      image_path: img,
      confirm_token: tokenIn(preview),
    });
    assert.match(out, /^REFUSED/);
    assert.equal(uploads().length, 0);
    assert.equal(posts().length, 0);
  });

  it('never sends the token to an upload URL off linkedin.com', async () => {
    uploadHost = 'evil.example.com';
    const img = join(files.dir, 'd.png');
    writeFileSync(img, 'png-bytes-4');
    const preview = await call('linkedin_post', { text: 'x', image_path: img });
    const out = await call('linkedin_post', {
      text: 'x',
      image_path: img,
      confirm_token: tokenIn(preview),
    });
    assert.match(out, /^ERROR: Refusing to upload/);
    assert.equal(uploads().length, 0);
    assert.equal(
      posts().length,
      0,
      'nothing published when the upload is refused',
    );
  });
});

describe('linkedin_comment', () => {
  const post = 'urn:li:share:6844785523593134080';
  const parent =
    'urn:li:comment:(urn:li:activity:6631349431612559360,6636062862760562688)';

  it('previews without publishing', async () => {
    const out = await call('linkedin_comment', {
      post_urn: post,
      text: 'Gracias',
    });
    assert.match(out, /^PREVIEW — comment/);
    assert.equal(comments().length, 0);
  });

  it('refuses a token issued for a post', async () => {
    const p = await call('linkedin_post', { text: 'Gracias' });
    const out = await call('linkedin_comment', {
      post_urn: post,
      text: 'Gracias',
      confirm_token: tokenIn(p),
    });
    assert.match(out, /^REFUSED/);
    assert.equal(comments().length, 0);
  });

  it('refuses a reply confirmed against a different parent comment', async () => {
    const preview = await call('linkedin_comment', {
      post_urn: post,
      parent_comment_urn: parent,
      text: 'Gracias',
    });
    const out = await call('linkedin_comment', {
      post_urn: post,
      parent_comment_urn:
        'urn:li:comment:(urn:li:activity:6631349431612559360,1)',
      text: 'Gracias',
      confirm_token: tokenIn(preview),
    });
    assert.match(out, /^REFUSED/);
    assert.equal(comments().length, 0);
  });

  it('replies as the Page, addressed to the parent comment', async () => {
    const args = {
      post_urn: post,
      parent_comment_urn: parent,
      text: 'Gracias (de verdad)',
    };
    const preview = await call('linkedin_comment', args);
    assert.match(preview, /^PREVIEW — reply/);
    const out = await call('linkedin_comment', {
      ...args,
      confirm_token: tokenIn(preview),
    });
    assert.match(out, /^PUBLISHED/);
    assert.equal(comments().length, 1);

    const c = comments()[0];
    assert.ok(
      c.url.endsWith(
        '/rest/socialActions/urn%3Ali%3Acomment%3A%28urn%3Ali%3Aactivity%3A6631349431612559360%2C6636062862760562688%29/comments',
      ),
      `the composite URN is fully encoded in the path: ${c.url}`,
    );
    assert.deepEqual(c.body, {
      actor: ORG,
      object: post,
      message: { text: 'Gracias (de verdad)' },
      parentComment: parent,
    });
  });

  it('refuses a reply whose parent comment names a different post', async () => {
    const out = await call('linkedin_comment', {
      post_urn: post,
      parent_comment_urn: 'urn:li:comment:(urn:li:ugcPost:999,1)',
      text: 'Gracias',
    });
    assert.match(out, /^ERROR: That comment belongs to urn:li:ugcPost:999/);
    assert.doesNotMatch(out, /confirm_token/);
  });

  it('rejects something that is not a post URN', async () => {
    const out = await call('linkedin_comment', {
      post_urn: 'urn:li:person:abc',
      text: 'x',
    });
    assert.match(out, /^ERROR: .*not a post URN/);
  });
});
