// MCP tool registration for the WhatsApp integration. Tools are thin wrappers
// over core.ts: validate input, call one core function, format a human-readable
// result with ids included so the model can chain calls.
//
// Transport-agnostic on purpose: nothing here reads process.env or knows
// whether it's serving stdio or HTTP. server.ts is what both transports share.
//
// WHY send_message AND send_template ARE SEPARATE TOOLS, and must stay that
// way: their failure modes and their CONSENT semantics differ completely. A
// unified `send` would tempt the model to silently fall back to a template when
// free-form is rejected — which spends money and burns the number's quality
// rating without the user knowing. Vercel's own adapter refuses to auto-
// substitute for the same reason ("callers must opt in explicitly"). Keep the
// choice explicit.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  listTemplates,
  sendTemplate,
  sendText,
  whoami,
  type MessageTemplate,
  type SendResult,
  type WhatsAppIdentity,
} from './core';

type TextResult = { content: Array<{ type: 'text'; text: string }> };

function ok(text: string): TextResult {
  return { content: [{ type: 'text', text }] };
}

function fail(err: unknown): TextResult {
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text', text: `ERROR: ${msg}` }] };
}

// ──────────────────────────────────────────────────────────────────────────────
// Formatters
// ──────────────────────────────────────────────────────────────────────────────

function formatIdentity(id: WhatsAppIdentity): string {
  const lines = [
    `phone_number_id: ${id.id ?? '(unknown)'}`,
    `number:          ${id.display_phone_number ?? '(unknown)'}`,
    `verified_name:   ${id.verified_name ?? '(none)'}`,
    `quality_rating:  ${id.quality_rating ?? '(unknown)'}`,
  ];
  if (id.throughput?.level) lines.push(`throughput:      ${id.throughput.level}`);
  if (id.platform_type) lines.push(`platform:        ${id.platform_type}`);
  return lines.join('\n');
}

function formatSendResult(res: SendResult): string {
  const msgId = res.messages?.[0]?.id ?? '(no id returned)';
  const waId = res.contacts?.[0]?.wa_id;
  return `Sent. message_id: ${msgId}${waId ? `  wa_id: ${waId}` : ''}`;
}

// Surface the {{n}} slots: the model needs to know how many params a template
// takes before it can call send_template without a 132000.
function formatTemplateRow(t: MessageTemplate): string {
  const body = t.components?.find((c) => c.type === 'BODY')?.text ?? '';
  const slots = body.match(/\{\{\d+\}\}/g);
  const params = slots ? `  params: ${slots.length}` : '  params: 0';
  const head = `${t.name ?? '(unnamed)'}  [${t.language ?? '?'}]  ${t.status ?? '?'}  ${t.category ?? ''}${params}`;
  return body ? `${head}\n    ${body.replace(/\n/g, '\n    ')}` : head;
}

// ──────────────────────────────────────────────────────────────────────────────
// Tool registration
// ──────────────────────────────────────────────────────────────────────────────

export function registerTools(server: McpServer): void {
  server.registerTool(
    'whatsapp_whoami',
    {
      description:
        'Verify the WhatsApp credentials: returns the business phone number, verified name, ' +
        'quality rating, and throughput for the configured phone number id. Never prints the token. ' +
        'A falling quality_rating is the early warning before Meta throttles or bans the number.',
      inputSchema: {
        from_phone_number_id: z
          .string()
          .optional()
          .describe('Override the configured WHATSAPP_PHONE_NUMBER_ID.'),
      },
    },
    async ({ from_phone_number_id }) => {
      try {
        return ok(formatIdentity(await whoami(from_phone_number_id)));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'whatsapp_list_templates',
    {
      description:
        'List the message templates on the WhatsApp Business Account, with their language, ' +
        'status (APPROVED/PENDING/REJECTED), category, and how many {{n}} parameters each body ' +
        'takes. Call this before whatsapp_send_template — template names are case-sensitive and ' +
        'only APPROVED templates can be sent. Requires WHATSAPP_WABA_ID.',
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional().describe('Max templates to return (default 50).'),
      },
    },
    async ({ limit }) => {
      try {
        const templates = await listTemplates(limit);
        if (!templates.length) return ok('No message templates found on this WhatsApp Business Account.');
        return ok(templates.map(formatTemplateRow).join('\n'));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'whatsapp_send_template',
    {
      description:
        'Send a pre-approved template message. This is the ONLY message type WhatsApp accepts ' +
        'outside the 24-hour customer service window, so it is the only reliable way to start a ' +
        'conversation with someone who has not messaged first. The template must already be ' +
        'APPROVED (see whatsapp_list_templates). Sends a real, billed message to a real person — ' +
        'confirm the recipient and content with the user before calling.',
      inputSchema: {
        to: z
          .string()
          .describe('Recipient in international format, e.g. 573001234567. "+" and separators are stripped.'),
        template_name: z.string().describe('Exact template name (case-sensitive).'),
        language: z
          .string()
          .describe('Language code exactly as registered, e.g. "es" or "es_ES" — they are different templates.'),
        components: z
          .array(z.unknown())
          .optional()
          .describe('Template components array per the Cloud API schema, supplying the {{n}} parameter values.'),
        from_phone_number_id: z.string().optional().describe('Override the configured sending number.'),
      },
    },
    async ({ to, template_name, language, components, from_phone_number_id }) => {
      try {
        const res = await sendTemplate(to, template_name, language, components, from_phone_number_id);
        return ok(formatSendResult(res));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'whatsapp_send_message',
    {
      description:
        'Send a free-form text message. IMPORTANT: this only works inside an open 24-hour ' +
        'customer service window — i.e. within 24h of the recipient last messaging this number. ' +
        'Outside it, Meta rejects the send with error 131047 and you must use ' +
        'whatsapp_send_template instead. This server has no inbound receiver, so whether the ' +
        'window is open cannot be known in advance — attempting the send and reading the error ' +
        'is the intended flow. Free-form messages inside the window are free. Sends a real ' +
        'message to a real person — confirm recipient and content with the user before calling.',
      inputSchema: {
        to: z
          .string()
          .describe('Recipient in international format, e.g. 573001234567. "+" and separators are stripped.'),
        text: z.string().min(1).describe('Message body. WhatsApp caps text at 4096 characters.'),
        from_phone_number_id: z.string().optional().describe('Override the configured sending number.'),
      },
    },
    async ({ to, text, from_phone_number_id }) => {
      try {
        const res = await sendText(to, text, from_phone_number_id);
        return ok(formatSendResult(res));
      } catch (err) {
        return fail(err);
      }
    },
  );
}
