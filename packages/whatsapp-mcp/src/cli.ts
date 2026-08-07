#!/usr/bin/env node
// WhatsApp CLI — the shell/automation frontend over the shared core. Every
// command is a THIN wrapper: parse flags, call a core function (src/core.ts —
// the same code the MCP uses), format the result. No API code here (graph.ts),
// no auth code here (config.ts).
//
// This frontend exists for a specific reason beyond scripting: it is the only
// human-readable way to verify a real send BEFORE an MCP client is in the loop.
// Build and validate here first, then wire the MCP.
//
// Run via: npm run whatsapp -- <cmd> …
// Auth: Meta access token in $WHATSAPP_ACCESS_TOKEN (Bearer header) — resolved
// from process env, else the repo-root .env. See README.md.
//
// Exit codes: 0 ok | 1 local config (token/id unset) | 2 bad args | 3 Graph API
// failure. The CLI never prints the token.

import { WhatsAppApiError } from './graph';
import {
  listTemplates,
  sendTemplate,
  sendText,
  whoami,
  type MessageTemplate,
} from './core';

// ──────────────────────────────────────────────────────────────────────────────
// Argument parsing
// ──────────────────────────────────────────────────────────────────────────────

interface ParsedFlags {
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseFlags(argv: string[]): ParsedFlags {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) {
          flags[a.slice(2)] = true;
        } else {
          flags[a.slice(2)] = next;
          i++;
        }
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function str(v: string | boolean | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

const USAGE = `whatsapp — WhatsApp Cloud API CLI

Usage: npm run whatsapp -- <command> [flags]

Commands:
  whoami                          Verify credentials; print number, verified name, quality rating
  templates [--limit N]           List message templates (name, language, status, param count)
  send --to N --text "…"          Send free-form text (ONLY inside an open 24h window)
  send-template --to N --name X --language es [--params a,b]
                                  Send a pre-approved template (works cold)

Common flags:
  --from <phone_number_id>        Override the configured sending number

The 24-hour window: free-form text only works within 24h of the recipient's last
inbound message. Outside it Meta rejects with 131047 — use send-template.
`;

// ──────────────────────────────────────────────────────────────────────────────
// Formatters
// ──────────────────────────────────────────────────────────────────────────────

function printTemplate(t: MessageTemplate): void {
  const body = t.components?.find((c) => c.type === 'BODY')?.text ?? '';
  const slots = body.match(/\{\{\d+\}\}/g);
  process.stdout.write(
    `${t.name ?? '(unnamed)'}  [${t.language ?? '?'}]  ${t.status ?? '?'}  ${t.category ?? ''}  params: ${slots ? slots.length : 0}\n`,
  );
  if (body) process.stdout.write(`    ${body.replace(/\n/g, '\n    ')}\n`);
}

// Positional {{1}}, {{2}}… values from a simple --params a,b list. Anything
// richer (headers, buttons, media) needs the full components array — use the
// MCP tool or the API directly rather than growing a flag DSL here.
function buildBodyComponents(params?: string): unknown[] | undefined {
  if (!params) return undefined;
  const values = params
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!values.length) return undefined;
  return [
    {
      type: 'body',
      parameters: values.map((text) => ({ type: 'text', text })),
    },
  ];
}

// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const { positional, flags } = parseFlags(process.argv.slice(2));
  const cmd = positional[0];

  if (!cmd || cmd === 'help' || flags.help) {
    process.stdout.write(USAGE);
    return cmd ? 0 : 2;
  }

  const from = str(flags.from);

  switch (cmd) {
    case 'whoami': {
      const id = await whoami(from);
      process.stdout.write(
        [
          `phone_number_id: ${id.id ?? '(unknown)'}`,
          `number:          ${id.display_phone_number ?? '(unknown)'}`,
          `verified_name:   ${id.verified_name ?? '(none)'}`,
          `quality_rating:  ${id.quality_rating ?? '(unknown)'}`,
          id.throughput?.level
            ? `throughput:      ${id.throughput.level}`
            : null,
        ]
          .filter(Boolean)
          .join('\n') + '\n',
      );
      return 0;
    }

    case 'templates': {
      const limitRaw = str(flags.limit);
      const templates = await listTemplates(
        limitRaw ? Number(limitRaw) : undefined,
      );
      if (!templates.length) {
        process.stdout.write(
          'No message templates found on this WhatsApp Business Account.\n',
        );
        return 0;
      }
      templates.forEach(printTemplate);
      return 0;
    }

    case 'send': {
      const to = str(flags.to);
      const text = str(flags.text);
      if (!to || !text) {
        process.stderr.write('send requires --to and --text\n');
        return 2;
      }
      const res = await sendText(to, text, from);
      process.stdout.write(
        `Sent. message_id: ${res.messages?.[0]?.id ?? '(none)'}\n`,
      );
      return 0;
    }

    case 'send-template': {
      const to = str(flags.to);
      const name = str(flags.name);
      const language = str(flags.language);
      if (!to || !name || !language) {
        process.stderr.write(
          'send-template requires --to, --name and --language\n',
        );
        return 2;
      }
      const res = await sendTemplate(
        to,
        name,
        language,
        buildBodyComponents(str(flags.params)),
        from,
      );
      process.stdout.write(
        `Sent. message_id: ${res.messages?.[0]?.id ?? '(none)'}\n`,
      );
      return 0;
    }

    default:
      process.stderr.write(`Unknown command: ${cmd}\n\n${USAGE}`);
      return 2;
  }
}

// Surface config errors (exit 1) distinctly from Graph failures (exit 3) so
// scripts can tell "you're not set up" from "Meta said no".
main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    if (err instanceof WhatsAppApiError) {
      process.stderr.write(`whatsapp: ${err.message}\n`);
      process.exit(3);
    }
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`whatsapp: ${msg}\n`);
    process.exit(1);
  });
