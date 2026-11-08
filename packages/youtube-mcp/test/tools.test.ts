// The tools end to end against a fake YouTube behind `fetch`: what the model
// reads back, every friendly failure, long-video paging, and the promises the
// connector makes (read-only, youtube.com only, one request per step and no
// retries under another identity). Nothing here touches the network.

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { setFetch } from '../src/core';
import {
  charsWithinBudget,
  cutAt,
  PART_TOKEN_BUDGET,
  registerTools,
  tokenCost,
} from '../src/tools';

type Handler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ text: string }>;
  isError?: boolean;
}>;

const handlers: Record<string, Handler> = {};
const configs: Record<string, { annotations?: Record<string, unknown> }> = {};
registerTools({
  registerTool: (name: string, cfg: never, fn: Handler) => {
    handlers[name] = fn;
    configs[name] = cfg;
  },
} as never);

async function call(tool: string, args: Record<string, unknown>) {
  const r = await handlers[tool](args);
  return { text: r.content[0].text, isError: Boolean(r.isError) };
}

const ID = 'abcDEF12_-x';

interface Seen {
  method: string;
  url: string;
  body?: unknown;
}
let seen: Seen[] = [];

function track(lang: string, asr = false, name?: string) {
  return {
    baseUrl: `https://www.youtube.com/api/timedtext?v=${ID}&lang=${lang}${asr ? '&kind=asr' : ''}&fmt=srv3`,
    languageCode: lang,
    ...(asr ? { kind: 'asr' } : {}),
    name: {
      runs: [{ text: name ?? (asr ? `${lang} (auto-generated)` : lang) }],
    },
  };
}

function player(overrides: Record<string, unknown> = {}) {
  return {
    playabilityStatus: { status: 'OK' },
    videoDetails: {
      videoId: ID,
      title: 'Una charla',
      author: 'Un canal',
      lengthSeconds: '754',
    },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          track('en', false, 'English'),
          track('es', false, 'Spanish'),
          track('es', true),
        ],
        audioTracks: [{ defaultCaptionTrackIndex: 0 }],
        defaultAudioTrackIndex: 0,
      },
    },
    ...overrides,
  };
}

const xml = (lang: string, lines = 3) =>
  '<?xml version="1.0" encoding="utf-8" ?><transcript>' +
  Array.from(
    { length: lines },
    (_, i) => `<text start="${i * 2}" dur="2">${lang} line ${i}</text>`,
  ).join('') +
  '</transcript>';

function fakeYouTube(
  opts: {
    player?: unknown;
    status?: number;
    captions?: (url: URL) => string;
  } = {},
) {
  setFetch((async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    seen.push({
      method: init?.method ?? 'GET',
      url,
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
    });
    if (opts.status) return new Response('', { status: opts.status });
    const u = new URL(url);
    if (u.pathname === '/youtubei/v1/player') {
      return new Response(JSON.stringify(opts.player ?? player()), {
        status: 200,
      });
    }
    if (u.pathname === '/api/timedtext') {
      const body = opts.captions
        ? opts.captions(u)
        : xml(u.searchParams.get('lang') ?? '?');
      return new Response(body, { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch);
}

beforeEach(() => {
  seen = [];
  delete process.env.YOUTUBE_MCP_LANGUAGE;
});
afterEach(() => setFetch(null));

describe('youtube_get_transcript', () => {
  it('returns the header and the spoken-language text by default', async () => {
    fakeYouTube();
    const r = await call('youtube_get_transcript', {
      video: `https://youtu.be/${ID}?si=x`,
    });
    assert.equal(r.isError, false);
    assert.match(r.text, /^title: {5}Una charla$/m);
    assert.match(r.text, /^channel: {3}Un canal$/m);
    assert.match(r.text, /^duration: {2}12:34$/m);
    assert.match(
      r.text,
      new RegExp(`^url: {7}https://www.youtube.com/watch\\?v=${ID}$`, 'm'),
    );
    assert.match(r.text, /^language: {2}Spanish \[es\], uploaded captions$/m);
    assert.match(r.text, /es line 0 es line 1 es line 2/);
  });

  it('asks YouTube for the classic caption format, not srv3', async () => {
    fakeYouTube();
    await call('youtube_get_transcript', { video: ID });
    assert.ok(!seen[1].url.includes('fmt='), seen[1].url);
  });

  it('honors a requested language', async () => {
    fakeYouTube();
    const r = await call('youtube_get_transcript', {
      video: ID,
      language: 'en',
    });
    assert.match(r.text, /^language: {2}English \[en\]/m);
    assert.match(r.text, /en line 0/);
    assert.doesNotMatch(r.text, /no captions in/);
  });

  it('says so when the requested language is missing', async () => {
    fakeYouTube();
    const r = await call('youtube_get_transcript', {
      video: ID,
      language: 'de',
    });
    assert.match(
      r.text,
      /no captions in "de"; used es instead\. Available: en, es\./,
    );
  });

  it('uses the configured default language without calling it a fallback', async () => {
    process.env.YOUTUBE_MCP_LANGUAGE = 'en';
    fakeYouTube();
    assert.match(
      (await call('youtube_get_transcript', { video: ID })).text,
      /\[en\]/,
    );
    process.env.YOUTUBE_MCP_LANGUAGE = 'de';
    assert.doesNotMatch(
      (await call('youtube_get_transcript', { video: ID })).text,
      /no captions in/,
    );
  });

  it('treats an unexpanded plugin placeholder as no preference', async () => {
    process.env.YOUTUBE_MCP_LANGUAGE = '${user_config.default_language}';
    fakeYouTube();
    assert.match(
      (await call('youtube_get_transcript', { video: ID })).text,
      /\[es\]/,
    );
  });

  it('warns that auto-generated captions are rough', async () => {
    fakeYouTube({
      player: player({
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [track('es', true)],
          },
        },
      }),
    });
    const r = await call('youtube_get_transcript', { video: ID });
    assert.match(r.text, /^language: {2}es \(auto-generated\) \[es\]$/m);
    assert.match(r.text, /auto-generated by YouTube and can mishear/);
  });

  it('prints timestamps when asked', async () => {
    fakeYouTube();
    const r = await call('youtube_get_transcript', {
      video: ID,
      timestamps: true,
    });
    assert.match(
      r.text,
      /^\[0:00\] es line 0\n\[0:02\] es line 1\n\[0:04\] es line 2$/m,
    );
  });

  it('pages a long transcript and the pages add up to the whole', async () => {
    fakeYouTube({ captions: () => xml('es', 2000) });
    const parts: string[] = [];
    let offset: number | undefined = 0;
    let calls = 0;
    while (offset !== undefined) {
      const r = await call('youtube_get_transcript', {
        video: ID,
        offset,
        max_chars: 5000,
      });
      const body = r.text.split('\n\n').slice(1).join('\n\n');
      const m = /offset=(\d+)\]$/.exec(r.text);
      parts.push(
        m ? body.replace(/\n\n\[transcript continues[^\]]*\]$/, '') : body,
      );
      offset = m ? Number(m[1]) : undefined;
      assert.ok(++calls < 100, 'paging never ends');
    }
    assert.ok(calls > 3);
    const all = parts.join(' ').replace(/\s+/g, ' ');
    for (const i of [0, 999, 1999])
      assert.ok(
        all.includes(`es line ${i} `) || all.endsWith(`es line ${i}`),
        `line ${i}`,
      );
    assert.equal(
      (all.match(/es line \d+/g) ?? []).length,
      2000,
      'no line lost or repeated',
    );
  });

  it('explains a video with no captions, and does not fetch any audio', async () => {
    fakeYouTube({ player: player({ captions: undefined }) });
    const r = await call('youtube_get_transcript', { video: ID });
    assert.equal(r.isError, true);
    assert.match(r.text, /"Una charla" has no captions on YouTube/);
    assert.match(r.text, /does not download/);
    assert.equal(seen.length, 1);
  });

  it('explains a live stream', async () => {
    fakeYouTube({
      player: player({
        captions: undefined,
        videoDetails: { title: 'En vivo', isLive: true },
      }),
    });
    assert.match(
      (await call('youtube_get_transcript', { video: ID })).text,
      /live right now/,
    );
  });

  const refusals: Array<[string, RegExp]> = [
    ['LOGIN_REQUIRED', /only shows this video to a signed-in person/],
    ['ERROR', /isn't available/],
    ['LIVE_STREAM_OFFLINE', /hasn't started yet/],
    ['UNPLAYABLE', /won't play this video here \(UNPLAYABLE\)/],
  ];
  for (const [status, msg] of refusals) {
    it(`stops on ${status} after one request, with no retry`, async () => {
      fakeYouTube({
        player: { playabilityStatus: { status, reason: 'Some reason' } },
      });
      const r = await call('youtube_get_transcript', { video: ID });
      assert.equal(r.isError, true);
      assert.match(r.text, msg);
      assert.match(r.text, /YouTube says: "Some reason"/);
      assert.equal(seen.length, 1);
    });
  }

  it('explains rate limiting without retrying', async () => {
    fakeYouTube({ status: 429 });
    const r = await call('youtube_get_transcript', { video: ID });
    assert.match(r.text, /limiting requests from this network/);
    assert.equal(seen.length, 1);
  });

  it('explains an empty caption file', async () => {
    fakeYouTube({ captions: () => '' });
    assert.match(
      (await call('youtube_get_transcript', { video: ID })).text,
      /sent back an empty file/,
    );
  });

  it('explains a caption download that times out mid-body', async () => {
    let n = 0;
    setFetch((async () => {
      if (n++ === 0)
        return new Response(JSON.stringify(player()), { status: 200 });
      const stream = new ReadableStream({
        start(c) {
          c.error(
            new DOMException(
              'The operation was aborted due to timeout',
              'TimeoutError',
            ),
          );
        },
      });
      return new Response(stream, { status: 200 });
    }) as typeof fetch);
    const r = await call('youtube_get_transcript', { video: ID });
    assert.equal(r.isError, true);
    assert.match(r.text, /did not answer within 20 seconds/);
  });

  it('explains a network failure', async () => {
    setFetch((async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch);
    assert.match(
      (await call('youtube_get_transcript', { video: ID })).text,
      /Couldn't reach YouTube/,
    );
  });

  it('rejects something that is not a video before any request', async () => {
    fakeYouTube();
    const r = await call('youtube_get_transcript', {
      video: 'https://www.youtube.com/@canal',
    });
    assert.equal(r.isError, true);
    assert.equal(seen.length, 0);
  });

  it('refuses a player answer for a different video', async () => {
    fakeYouTube({
      player: player({
        videoDetails: { videoId: 'aaaaaaaaaaa', title: 'Otro video' },
      }),
    });
    const r = await call('youtube_get_transcript', { video: ID });
    assert.equal(r.isError, true);
    assert.match(r.text, /different video \(aaaaaaaaaaa\)/);
    assert.doesNotMatch(r.text, /Otro video/);
  });

  it('says so when the offset is past the end', async () => {
    fakeYouTube();
    const r = await call('youtube_get_transcript', {
      video: ID,
      offset: 1_000_000,
    });
    assert.equal(r.isError, true);
    assert.match(r.text, /past the end/);
  });
});

describe('paging', () => {
  it('sizes CJK parts by tokens, not characters', () => {
    const cjk = '字'.repeat(200_000);
    const latin = 'a'.repeat(200_000);
    assert.equal(charsWithinBudget(cjk, 0, 80_000), PART_TOKEN_BUDGET);
    assert.equal(charsWithinBudget(latin, 0, 80_000), 60_000);
    assert.equal(charsWithinBudget(latin, 0, 5_000), 5_000);
    assert.equal(tokenCost('é'), 0.3);
    assert.equal(tokenCost('ж'), 0.5);
    assert.equal(tokenCost('α'), 0.5);
    for (const ch of [
      'ա',
      'א',
      'ა',
      'ह',
      'ক',
      'த',
      'ก',
      'က',
      'ع',
      '字',
      '한',
    ]) {
      assert.equal(tokenCost(ch), 1, ch);
    }
    const hindi = 'ह'.repeat(200_000);
    assert.equal(charsWithinBudget(hindi, 0, 80_000), PART_TOKEN_BUDGET);
  });

  it('keeps every timestamped line whole across parts', () => {
    const text = Array.from(
      { length: 500 },
      (_, i) => `[${i}:00] some words here ${i}`,
    ).join('\n');
    let offset: number | undefined = 0;
    const lines: string[] = [];
    while (offset !== undefined) {
      const { part, next }: { part: string; next?: number } = cutAt(
        text,
        offset,
        1_000,
      );
      lines.push(...part.split('\n'));
      offset = next;
    }
    assert.equal(lines.length, 500);
    for (const l of lines) assert.match(l, /^\[\d+:00\] some words here \d+$/);
  });

  it('a Japanese transcript comes in parts under the token budget, with the offset in the header', async () => {
    fakeYouTube({
      captions: () =>
        '<transcript>' +
        Array.from(
          { length: 3000 },
          (_, i) =>
            `<text start="${i * 2}" dur="2">${'日本語の字幕'.repeat(5)}${i}</text>`,
        ).join('') +
        '</transcript>',
    });
    const r = await call('youtube_get_transcript', { video: ID });
    const m = /^part: .*; the rest starts at offset=(\d+)$/m.exec(r.text);
    assert.ok(m, r.text.slice(0, 600));
    // Every character costs at least 0.3 tokens, most of these cost 1.
    assert.ok(Number(m[1]) < PART_TOKEN_BUDGET * 1.3, m[1]);
  });
});

describe('youtube_list_transcript_languages', () => {
  it('lists every track, marking uploaded ones', async () => {
    fakeYouTube();
    const r = await call('youtube_list_transcript_languages', {
      video: `https://www.youtube.com/shorts/${ID}`,
    });
    assert.match(r.text, /^ {2}en {7}English \(uploaded\)$/m);
    assert.match(r.text, /^ {2}es {7}es \(auto-generated\)$/m);
    assert.equal(seen.length, 1, 'listing languages downloads no captions');
  });

  it('says when there are none', async () => {
    fakeYouTube({ player: player({ captions: undefined }) });
    assert.match(
      (await call('youtube_list_transcript_languages', { video: ID })).text,
      /No captions/,
    );
  });
});

describe('the promises', () => {
  it('both tools are marked read-only and titled', () => {
    for (const name of [
      'youtube_get_transcript',
      'youtube_list_transcript_languages',
    ]) {
      assert.equal(configs[name].annotations?.readOnlyHint, true, name);
      assert.equal(configs[name].annotations?.destructiveHint, false, name);
      assert.equal(
        typeof (configs[name] as { title?: string }).title,
        'string',
        name,
      );
    }
  });

  it('talks to youtube.com only, with one client identity', async () => {
    fakeYouTube();
    await call('youtube_get_transcript', { video: ID });
    await call('youtube_list_transcript_languages', { video: ID });
    for (const s of seen)
      assert.equal(new URL(s.url).hostname, 'www.youtube.com', s.url);
    const clients = seen
      .filter((s) => s.body)
      .map((s) => JSON.stringify((s.body as { context: unknown }).context));
    assert.equal(new Set(clients).size, 1);
    assert.deepEqual((seen[0].body as { videoId: string }).videoId, ID);
  });
});
