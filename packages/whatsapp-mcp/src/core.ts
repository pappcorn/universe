// Typed operations over the WhatsApp Cloud API. Shared by the MCP frontend
// (tools.ts) and the CLI (cli.ts) — the single place that knows what a "send"
// or a "template" is. No auth here (config.ts), no HTTP here (graph.ts), no
// presentation here (the frontends).
//
// v1 is OUTBOUND only. The Cloud API has no read-messages endpoint at all, so
// there is nothing to expose for reading history. Receiving messages requires a
// separate always-on webhook listener, which is out of scope here.

import { callGraph } from './graph';
import { requireWabaId, resolvePhoneNumberId } from './config';

// ──────────────────────────────────────────────────────────────────────────────
// Result types (only the fields we surface)
// ──────────────────────────────────────────────────────────────────────────────

export interface WhatsAppIdentity {
  id?: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
  /** Present on some numbers; shape varies by account. */
  throughput?: { level?: string };
  platform_type?: string;
}

export interface TemplateComponent {
  type?: string;
  format?: string;
  text?: string;
  buttons?: Array<{ type?: string; text?: string }>;
}

export interface MessageTemplate {
  id?: string;
  name?: string;
  language?: string;
  status?: string;
  category?: string;
  components?: TemplateComponent[];
}

export interface SendResult {
  messaging_product?: string;
  contacts?: Array<{ input?: string; wa_id?: string }>;
  messages?: Array<{ id?: string; message_status?: string }>;
}

// ──────────────────────────────────────────────────────────────────────────────
// Recipient normalization
// ──────────────────────────────────────────────────────────────────────────────

// Meta wants a plain international number: digits only, country code included,
// no '+', no spaces, no dashes. Sending "+57 300 123 4567" yields a 131026
// "undeliverable" that looks like the number is wrong when it isn't — so
// normalize rather than make every caller remember.
export function normalizeRecipient(to: string): string {
  const digits = to.replace(/[^\d]/g, '');
  // E.164 bounds (country code included): under 7 digits can't be a routable
  // international number, over 15 violates the spec. Catching it here beats
  // forwarding it to Meta and getting an opaque 131026 back.
  if (digits.length < 7 || digits.length > 15) {
    throw new Error(
      `Recipient "${to}" is not a valid international number (got ${digits.length} digit${digits.length === 1 ? '' : 's'}, ` +
        'expected 7-15 including country code, e.g. 573001234567).',
    );
  }
  return digits;
}

// ──────────────────────────────────────────────────────────────────────────────
// Operations
// ──────────────────────────────────────────────────────────────────────────────

// The cheapest config probe, and the token's real validity check. Also surfaces
// quality_rating, which is operationally load-bearing: a dropping rating is the
// early warning before Meta throttles or bans the number.
export async function whoami(
  phoneNumberId?: string,
): Promise<WhatsAppIdentity> {
  const id = resolvePhoneNumberId(phoneNumberId);
  return callGraph<WhatsAppIdentity>({
    path: `/${id}`,
    query: {
      fields:
        'id,display_phone_number,verified_name,quality_rating,throughput,platform_type',
    },
  });
}

// Free-form text. ONLY works inside an open 24-hour customer service window —
// i.e. within 24h of the recipient's last inbound message. Outside it, Meta
// rejects with 131047 and graph.ts maps that to a readable next step.
export async function sendText(
  to: string,
  text: string,
  phoneNumberId?: string,
): Promise<SendResult> {
  const id = resolvePhoneNumberId(phoneNumberId);
  return callGraph<SendResult>({
    method: 'POST',
    path: `/${id}/messages`,
    body: {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalizeRecipient(to),
      type: 'text',
      text: { body: text },
    },
  });
}

// Pre-approved template. The only message type WhatsApp accepts outside the 24h
// window, and therefore the only way to start a conversation cold.
export async function sendTemplate(
  to: string,
  templateName: string,
  language: string,
  components?: unknown[],
  phoneNumberId?: string,
): Promise<SendResult> {
  const id = resolvePhoneNumberId(phoneNumberId);
  return callGraph<SendResult>({
    method: 'POST',
    path: `/${id}/messages`,
    body: {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalizeRecipient(to),
      type: 'template',
      template: {
        name: templateName,
        language: { code: language },
        ...(components && components.length ? { components } : {}),
      },
    },
  });
}

// Without this, the model cannot know what templates exist or what variables
// they take — it would guess names and every send would fail with 132001. This
// is what makes sendTemplate usable.
export async function listTemplates(limit = 50): Promise<MessageTemplate[]> {
  const wabaId = requireWabaId();
  const res = await callGraph<{ data?: MessageTemplate[] }>({
    path: `/${wabaId}/message_templates`,
    query: {
      fields: 'id,name,language,status,category,components',
      limit: String(limit),
    },
  });
  return res.data ?? [];
}
