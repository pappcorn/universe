// Typed operations over YouTube's public caption data. Two network calls, both
// to youtube.com and nothing else:
//
//   1. POST /youtubei/v1/player — the request the YouTube app makes to open a
//      video. It answers with the title, channel, length, whether the video is
//      playable, and the list of caption tracks with a URL for each.
//   2. GET that track URL — the caption file itself (XML, timed lines).
//
// No API key, no account, no cookies, nothing stored. The calls go out from
// the machine the connector runs on, exactly like opening the video there.
//
// ONE CLIENT, NO WORKAROUNDS. When YouTube declines to serve a video (sign-in
// required, age-restricted, private, region-blocked, rate-limited) this
// connector says so plainly and stops. It does not retry under another client
// identity, rotate anything, or try to get around a check: if YouTube wants a
// signed-in person, the person should open the video themselves.

import { loadConfig } from './config';
import {
  parseTimedText,
  parseVideoId,
  pickTrack,
  type CaptionTrack,
  type Segment,
} from './parse';

const PLAYER_URL = 'https://www.youtube.com/youtubei/v1/player';

// The Android app's client identity, the same one the widely used open-source
// transcript libraries send. Its caption URLs work without the browser-only
// proof-of-origin token that web-client caption URLs now require.
const CLIENT = { clientName: 'ANDROID', clientVersion: '20.10.38' } as const;

/** A friendly, expected failure: no captions, private video, offline, … */
export class TranscriptError extends Error {}

export interface VideoInfo {
  id: string;
  url: string;
  title: string;
  channel: string;
  durationSeconds: number;
  isLive: boolean;
  tracks: CaptionTrack[];
  /** YouTube's own pick for the default caption track, when it gives one. */
  defaultTrackIndex?: number;
}

export interface Transcript {
  video: VideoInfo;
  track: CaptionTrack;
  /** The language asked for, when it wasn't available and another was used. */
  fallbackFrom?: string;
  segments: Segment[];
}

type Fetch = typeof fetch;

// Test seam: tests swap in a fake YouTube. No production caller changes it.
let fetchImpl: Fetch = (...args) => fetch(...args);
export function setFetch(f: Fetch | null): void {
  fetchImpl = f ?? ((...args) => fetch(...args));
}

/**
 * One request, body included. The timeout covers the whole exchange, so a
 * body that stalls or drops mid-download gets the same friendly message as a
 * connection that never opens.
 */
async function request(url: string, init: RequestInit = {}): Promise<string> {
  const { timeoutMs } = loadConfig();
  let res: Response;
  let body: string;
  try {
    res = await fetchImpl(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
    body = res.ok ? await res.text() : '';
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new TranscriptError(
        `YouTube did not answer within ${Math.round(timeoutMs / 1000)} seconds. ` +
          'Check the internet connection and try again.',
      );
    }
    throw new TranscriptError(
      "Couldn't reach YouTube. Check the internet connection and try again. " +
        `(${err instanceof Error ? err.message : String(err)})`,
    );
  }
  if (res.status === 429) {
    throw new TranscriptError(
      'YouTube is limiting requests from this network right now. ' +
        'Wait a while (an hour is usually enough) and try again.',
    );
  }
  if (!res.ok) {
    throw new TranscriptError(
      `YouTube answered with HTTP ${res.status}. Try again in a moment.`,
    );
  }
  return body;
}

// The slice of the player response this connector reads.
interface PlayerResponse {
  playabilityStatus?: { status?: string; reason?: string };
  videoDetails?: {
    videoId?: string;
    title?: string;
    author?: string;
    lengthSeconds?: string;
    isLiveContent?: boolean;
    isLive?: boolean;
  };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: Array<{
        baseUrl?: string;
        languageCode?: string;
        kind?: string;
        name?: { simpleText?: string; runs?: Array<{ text?: string }> };
      }>;
      audioTracks?: Array<{ defaultCaptionTrackIndex?: number }>;
      defaultAudioTrackIndex?: number;
    };
  };
}

function playabilityError(status: string, reason?: string): TranscriptError {
  const why = reason ? ` YouTube says: "${reason}"` : '';
  switch (status) {
    case 'LOGIN_REQUIRED':
      return new TranscriptError(
        'YouTube only shows this video to a signed-in person (it may be ' +
          'age-restricted, private, or YouTube may be asking this network to ' +
          'confirm it is not a bot). This connector does not sign in, so it ' +
          `can't read it.${why}`,
      );
    case 'LIVE_STREAM_OFFLINE':
      return new TranscriptError(
        `This live stream hasn't started yet, so there is nothing to transcribe.${why}`,
      );
    case 'ERROR':
      return new TranscriptError(
        `This video isn't available: it may have been removed, made private, or the link is mistyped.${why}`,
      );
    default:
      return new TranscriptError(
        `YouTube won't play this video here (${status}).${why}`,
      );
  }
}

function trackName(t: {
  name?: { simpleText?: string; runs?: Array<{ text?: string }> };
  languageCode?: string;
}): string {
  return (
    t.name?.simpleText ??
    t.name?.runs?.map((r) => r.text ?? '').join('') ??
    t.languageCode ??
    'unknown'
  );
}

/** Title, channel, length and the caption tracks of one video. */
export async function getVideo(input: string): Promise<VideoInfo> {
  const id = parseVideoId(input);
  const raw = await request(PLAYER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: { client: CLIENT }, videoId: id }),
  });

  let data: PlayerResponse;
  try {
    data = JSON.parse(raw) as PlayerResponse;
  } catch {
    throw new TranscriptError(
      "YouTube's answer couldn't be read. Try again in a moment.",
    );
  }

  const status = data.playabilityStatus?.status ?? 'UNKNOWN';
  if (status !== 'OK') {
    throw playabilityError(status, data.playabilityStatus?.reason);
  }

  const d = data.videoDetails ?? {};
  const list = data.captions?.playerCaptionsTracklistRenderer;
  const tracks: CaptionTrack[] = (list?.captionTracks ?? [])
    .filter((t) => t.baseUrl && t.languageCode)
    .map((t) => ({
      languageCode: t.languageCode as string,
      name: trackName(t),
      autoGenerated: t.kind === 'asr',
      baseUrl: t.baseUrl as string,
    }));
  const audio = list?.audioTracks?.[list?.defaultAudioTrackIndex ?? 0];

  return {
    id,
    url: `https://www.youtube.com/watch?v=${id}`,
    title: d.title ?? '(untitled)',
    channel: d.author ?? '(unknown channel)',
    durationSeconds: Number(d.lengthSeconds ?? 0),
    isLive: Boolean(d.isLive),
    tracks,
    defaultTrackIndex: audio?.defaultCaptionTrackIndex,
  };
}

function noCaptions(video: VideoInfo): TranscriptError {
  return new TranscriptError(
    video.isLive
      ? `"${video.title}" is live right now, and YouTube publishes its captions ` +
          'only after the stream ends. Try again once it has finished.'
      : `"${video.title}" has no captions on YouTube, neither uploaded by the ` +
          'channel nor auto-generated, so there is no transcript to read. ' +
          'This connector reads captions only; it does not download or listen ' +
          'to the audio.',
  );
}

/** The transcript of one video, in the wanted language when it exists. */
export async function getTranscript(
  input: string,
  language?: string,
): Promise<Transcript> {
  const video = await getVideo(input);
  if (!video.tracks.length) throw noCaptions(video);

  const wanted = language?.trim() || loadConfig().defaultLanguage;
  const choice = pickTrack(video.tracks, wanted, video.defaultTrackIndex);

  // fmt=srv3 asks for the word-timed format; the classic one is simpler and
  // parseTimedText reads both, so drop it.
  const url = choice.track.baseUrl.replace(/&fmt=[^&]*/g, '');
  const xml = await request(url);
  const segments = parseTimedText(xml);
  if (!segments.length) {
    throw new TranscriptError(
      `YouTube listed ${choice.track.name} captions for "${video.title}" but ` +
        'sent back an empty file. Try again in a moment; if it keeps happening, ' +
        'the captions may be unavailable from this network.',
    );
  }

  // Only report a fallback when the person (not the config default) asked.
  const askedHere = Boolean(language?.trim());
  return {
    video,
    track: choice.track,
    ...(choice.fallbackFrom && askedHere
      ? { fallbackFrom: choice.fallbackFrom }
      : {}),
    segments,
  };
}
