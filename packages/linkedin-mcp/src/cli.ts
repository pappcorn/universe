#!/usr/bin/env node
// LinkedIn CLI: the shell frontend over the shared core. Every command is a
// thin wrapper: parse flags, call a core function (the same code the MCP uses),
// format the result.
//
// READ-ONLY ON PURPOSE. Publishing a post or a comment goes through the MCP
// tools, where every write is previewed and confirmed (gate.ts). A CLI publish
// command would be a second path around that gate, so there is none.
//
// Run via: npm run linkedin -- <cmd> …
// Exit codes: 0 ok | 1 local config | 2 bad args | 3 LinkedIn API failure.
// The CLI never prints a token.

import { LinkedInApiError } from './api';
import { canRenew, formatDate, loadConfig } from './config';
import {
  assertCommentUrn,
  assertPostUrn,
  getPage,
  listComments,
  listPosts,
  pageStats,
} from './core';

function parseFlags(argv: string[]): {
  positional: string[];
  flags: Record<string, string | boolean>;
} {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    if (eq !== -1) {
      flags[a.slice(2, eq)] = a.slice(eq + 1);
    } else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) {
      flags[a.slice(2)] = argv[i + 1];
      i++;
    } else {
      flags[a.slice(2)] = true;
    }
  }
  return { positional, flags };
}

const str = (v: string | boolean | undefined) =>
  typeof v === 'string' ? v : undefined;

const USAGE = `linkedin — LinkedIn Pages CLI (read-only)

Usage: npm run linkedin -- <command> [flags]

Commands:
  whoami                         The Page this credential acts as, and token expiry
  posts [--count N]              The Page's recent posts
  comments --post URN            Comments on a post
  comments --comment URN         Replies under a comment
  stats [--posts URN,URN]        Followers and organic share statistics

Publishing and commenting are MCP-only, behind a preview-and-confirm gate.
`;

async function main(): Promise<number> {
  const { positional, flags } = parseFlags(process.argv.slice(2));
  const cmd = positional[0];
  if (!cmd || cmd === 'help' || flags.help) {
    process.stdout.write(USAGE);
    return cmd ? 0 : 2;
  }

  switch (cmd) {
    case 'whoami': {
      const cfg = loadConfig();
      const page = await getPage();
      const c = cfg.creds;
      process.stdout.write(
        [
          `page:          ${page.name ?? '(name not returned)'}`,
          `organization:  ${page.urn}`,
          `credential:    ${cfg.source}`,
          `access token:  ${
            c.access_token_expires_at
              ? `expires ${formatDate(c.access_token_expires_at)}`
              : 'expiry unknown'
          }`,
          `renewal:       ${canRenew() ? 'refresh token' : 'none'}`,
          `api version:   ${cfg.apiVersion}`,
        ].join('\n') + '\n',
      );
      return 0;
    }
    case 'posts': {
      const n = str(flags.count);
      const posts = await listPosts(n ? Number(n) : 10);
      for (const p of posts) {
        const text = (p.commentary ?? '').replace(/\s+/g, ' ').slice(0, 100);
        process.stdout.write(
          `${p.id}  ${p.lifecycleState ?? '?'}${p.media ? `  [${p.media}]` : ''}\n    ${text}\n`,
        );
      }
      if (!posts.length) process.stdout.write('No posts.\n');
      return 0;
    }
    case 'comments': {
      const post = str(flags.post);
      const comment = str(flags.comment);
      if (!!post === !!comment) {
        process.stderr.write(
          'comments requires exactly one of --post or --comment\n',
        );
        return 2;
      }
      if (post) assertPostUrn(post);
      if (comment) assertCommentUrn(comment);
      const list = await listComments((post ?? comment) as string);
      for (const c of list) {
        process.stdout.write(
          `${c.urn}\n    ${c.actor}${c.byPage ? ' (this Page)' : ''}\n    ${c.text.replace(/\n/g, '\n    ')}\n`,
        );
      }
      if (!list.length) process.stdout.write('No comments.\n');
      return 0;
    }
    case 'stats': {
      const urns = (str(flags.posts) ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const s = await pageStats(urns);
      process.stdout.write(`${JSON.stringify(s, null, 2)}\n`);
      return 0;
    }
    default:
      process.stderr.write(`Unknown command: ${cmd}\n\n${USAGE}`);
      return 2;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`linkedin: ${msg}\n`);
    process.exit(err instanceof LinkedInApiError ? 3 : 1);
  });
