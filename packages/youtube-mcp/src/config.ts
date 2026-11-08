// Config for the YouTube MCP: env vars → a typed object. Reads process.env and
// nothing else.
//
// There is no credential. Captions of a public video are public, so this
// connector needs no API key, no Google account and no OAuth app: it reads
// them from YouTube the way the YouTube app does, from the machine it runs on.
// Everything below is a preference, and every one has a working default.

export interface YouTubeConfig {
  /** Language to prefer when a call doesn't name one, e.g. "es". */
  defaultLanguage?: string;
  /** Per-request timeout towards YouTube, in milliseconds. */
  timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

function readVar(name: string): string | undefined {
  // An unset plugin or extension setting can surface as "" or as the literal
  // unexpanded "${user_config.*}" placeholder: both mean "not configured".
  const v = process.env[name]?.trim();
  return v && !v.includes('${') ? v : undefined;
}

export function loadConfig(): YouTubeConfig {
  const timeout = Number(readVar('YOUTUBE_MCP_TIMEOUT_MS'));
  return {
    defaultLanguage: readVar('YOUTUBE_MCP_LANGUAGE'),
    timeoutMs:
      Number.isFinite(timeout) && timeout >= 1000
        ? timeout
        : DEFAULT_TIMEOUT_MS,
  };
}
