// Meta Graph API client for the WhatsApp Cloud API. Every HTTP call to Meta
// goes through here — this is also the reuse seam for the future inbound
// listener (1.b), which needs to SEND replies but will receive via its own
// long-running service. Keeping sends here means outbound stays one
// implementation.
//
// Graph carries errors in the HTTP STATUS: a failed call is a non-2xx with an
// `error` envelope in the body. (Worth stating because several popular APIs do
// the opposite — returning HTTP 200 on failure and hiding the real status in a
// body field.)
//
// Error mapping is the main thing hand-rolling buys us over
// @chat-adapter/whatsapp, which just throws the raw error. Meta's codes are
// numerous and opaque; an unmapped 131047 tells the model nothing, while
// "the 24h window is closed, use whatsapp_send_template" tells it exactly what
// to do next.


import { loadConfig } from './config';

// ──────────────────────────────────────────────────────────────────────────────
// Error envelope
// ──────────────────────────────────────────────────────────────────────────────

interface GraphErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    error_data?: { details?: string };
    fbtrace_id?: string;
  };
}

export class WhatsAppApiError extends Error {
  constructor(
    message: string,
    public code?: number,
    public subcode?: number,
    public fbtraceId?: string,
    public httpStatus?: number,
  ) {
    super(message);
    this.name = 'WhatsAppApiError';
  }
}

// Actionable text for the codes we can actually do something about. The value
// of this table is that it names the NEXT STEP, not the failure.
function explain(code?: number, subcode?: number): string | undefined {
  switch (code) {
    case 131047:
      return (
        'The 24-hour customer service window is closed for this recipient. Free-form text ' +
        'only works within 24h of their last inbound message. Use whatsapp_send_template ' +
        'with an APPROVED template instead (whatsapp_list_templates shows which exist).'
      );
    case 131030:
      return (
        'Recipient is not in the allowed list. The app is in development mode, which only ' +
        'permits messaging numbers you have explicitly added under WhatsApp > API Setup.'
      );
    case 190:
      return (
        'Access token is invalid or expired. This is almost always the TEMPORARY dev token ' +
        'from the API Setup dashboard — it expires quickly. Generate a System User permanent ' +
        'token (expiration "Never") with business_management + whatsapp_business_messaging + ' +
        'whatsapp_business_management. See README.md.'
      );
    case 131026:
      return (
        'Message undeliverable. The number may not be on WhatsApp, or cannot receive messages. ' +
        'Check the country code and that the number has no "+" or separators.'
      );
    case 132000:
      return 'Template parameter count does not match the template definition. Check the {{n}} slots with whatsapp_list_templates.';
    case 132001:
      return (
        'Template does not exist for that name + language pair. Names are case-sensitive and ' +
        'the language must match exactly (e.g. "es" and "es_ES" are different templates). ' +
        'Run whatsapp_list_templates to see what exists.'
      );
    case 132005:
      return 'Template content was rejected or is not APPROVED yet. Only APPROVED templates can be sent.';
    case 80007:
    case 130429:
      return 'Rate or throughput limit reached. Back off and retry; whatsapp_whoami shows the current messaging tier.';
    case 100:
      return subcode
        ? undefined // subcode-specific detail is already in error_data.details
        : 'Invalid parameter. Meta puts the real reason in error_data.details — see below.';
    default:
      return undefined;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Call helper
// ──────────────────────────────────────────────────────────────────────────────

export interface GraphRequest {
  method?: 'GET' | 'POST';
  /** Path after the version, e.g. `/123456/messages`. */
  path: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
}

export async function callGraph<T>({ method = 'GET', path, query, body }: GraphRequest): Promise<T> {
  const { accessToken, apiUrl, graphVersion } = loadConfig();

  const url = new URL(`${apiUrl}/${graphVersion}${path}`);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const raw = await res.text();
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    // Non-JSON body — surface the status and a snippet rather than a JSON
    // parse error, which would hide what actually happened.
    throw new WhatsAppApiError(
      `Graph ${method} ${path} returned HTTP ${res.status} with a non-JSON body: ${raw.slice(0, 200)}`,
      undefined,
      undefined,
      undefined,
      res.status,
    );
  }

  if (!res.ok) {
    const err = (parsed as GraphErrorBody).error ?? {};
    const parts = [err.message ?? `HTTP ${res.status}`];

    const hint = explain(err.code, err.error_subcode);
    if (hint) parts.push(hint);
    if (err.error_data?.details) parts.push(`Details: ${err.error_data.details}`);

    // Always include fbtrace_id: it's free, and it's the first thing Meta
    // support asks for.
    if (err.fbtrace_id) parts.push(`(code ${err.code ?? '?'}, fbtrace_id ${err.fbtrace_id})`);

    throw new WhatsAppApiError(
      parts.join(' — '),
      err.code,
      err.error_subcode,
      err.fbtrace_id,
      res.status,
    );
  }

  return parsed as T;
}
