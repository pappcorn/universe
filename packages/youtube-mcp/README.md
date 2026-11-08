# youtube-mcp

An MCP server that reads the transcript of a YouTube video. Paste a link, and
Claude (or any MCP client) gets the text from the video's captions, to
summarize, quote, search or translate it.

- **Nothing to set up.** No API key, no Google account, no OAuth app. It reads
  public captions, from your own machine.
- **Read-only.** Two tools, both annotated `readOnlyHint`. It changes nothing
  anywhere, stores nothing and logs nothing.
- **One destination.** It talks to `www.youtube.com` and nothing else.

**Install:** see [docs/setup-youtube.md](../../docs/setup-youtube.md). In
short: a one-click `.mcpb` extension for Claude Desktop and Cowork, or the
plugin for Claude Code:

```
/plugin marketplace add pappcorn/universe
/plugin install youtube-mcp@pappcorn-plugins
```

## Tools

| Tool                                | Input                                                             | Returns                                                                                          |
| ----------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `youtube_get_transcript`            | `video`, optional `language`, `timestamps`, `offset`, `max_chars` | Title, channel, duration, the caption language used (uploaded or auto-generated), then the text. |
| `youtube_list_transcript_languages` | `video`                                                           | Title, channel, duration and every caption language the video has.                               |

`video` is any YouTube link (`watch?v=`, `youtu.be`, Shorts, `/embed`,
`/live`, mobile and music hosts) or the bare 11-character id.

**Which language.** With `language`, an exact match first, then the same base
language (`es` finds `es-419`), uploaded captions before auto-generated ones.
If none exists, it uses the spoken language and says what it used instead.
Without `language`, the language spoken in the video: an uploaded track in
that language if there is one, otherwise YouTube's auto-generated one.

**Long videos.** The text comes in parts of `max_chars` (default 80,000,
about an hour and a half of speech), under the default size limit Claude Code
puts on one tool result. Parts are sized by estimated tokens, so Chinese,
Japanese and Korean text comes in smaller parts. A part that isn't the last says, in its header and
at its end, the `offset` to call again with.

## Configuration

All optional.

| Variable                 | Plugin / extension setting            | Purpose                                                  |
| ------------------------ | ------------------------------------- | -------------------------------------------------------- |
| `YOUTUBE_MCP_LANGUAGE`   | Preferred caption language (optional) | Language to prefer when a request names none, e.g. `es`. |
| `YOUTUBE_MCP_TIMEOUT_MS` | none                                  | Per-request timeout towards YouTube. Default `20000`.    |

## How it works

Two requests, both to `www.youtube.com`:

1. `POST /youtubei/v1/player` with the video id: the request the YouTube app
   makes to open a video. It returns the title, channel, length, whether the
   video is playable, and its caption tracks.
2. `GET` the chosen track's caption file, a small XML of timed lines.

The connector sends one client identity, the Android app's, and never another.
When YouTube declines (sign-in required, age-restricted, private, rate-limited)
it reports the reason in plain words and stops: no retries, no rotation, no
attempt to get around a check.

Because it runs on your computer, YouTube sees an ordinary request from your
connection. From a cloud server, YouTube often asks for sign-in instead; this
connector is meant to run locally.

## CLI

From a clone:

```bash
npm run youtube -w @pappcorn/youtube-mcp -- transcript https://youtu.be/<id> --lang es
npm run youtube -w @pappcorn/youtube-mcp -- transcript <id> --timestamps
npm run youtube -w @pappcorn/youtube-mcp -- languages https://www.youtube.com/shorts/<id>
```

From npm: `npx -y -p @pappcorn/youtube-mcp pappcorn-youtube transcript <link>`.

The metadata line goes to stderr and the transcript to stdout, so
`> transcript.txt` saves just the text. Exit codes: 0 ok, 2 not a video link,
3 YouTube refused or the video has no captions.

## Layout

```
src/
├── config.ts   env → typed config (process.env only)
├── parse.ts    pure: link → id, caption XML → lines, track choice, rendering
├── core.ts     the two YouTube requests, and the friendly errors
├── tools.ts    the two MCP tools
├── server.ts   buildServer(), shared by every transport
├── mcp.ts      stdio entry point
└── cli.ts      CLI entry point
mcpb/manifest.json      Claude Desktop extension manifest; npm run mcpb packs it
                        with server/mcp.cjs (repo-root scripts/build-mcpb.mjs)
```

Tests: `npx nx run youtube-mcp:test`, all against a fake YouTube, no network.

## Not in this version

Videos without captions. Transcribing them means downloading the audio and
running a local speech model (for example whisper.cpp), which is much heavier
than reading captions. It is a possible future addition, as a separate,
opt-in tool.

## License

MIT
