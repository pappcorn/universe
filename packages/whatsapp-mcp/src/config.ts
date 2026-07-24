// Config for the WhatsApp MCP: env vars → a typed object. Reads process.env and
// nothing else. No hardcoded phone number, WABA id, token, or tenant lives here
// or anywhere else in src/ — your account details are yours, supplied at
// install time (the Claude plugin collects them and passes them in as env).
//
// Env var names deliberately match Vercel's @chat-adapter/whatsapp, which is
// the de-facto standard now. Matching costs nothing and means an extracted copy
// lands in a shape people already recognize.
//
// THE TOKEN TRAP, because every team hits it exactly once:
// The token shown on the WhatsApp > API Setup dashboard is a TEMPORARY dev
// token. It works perfectly the day you set it up and is dead tomorrow,
// surfacing as Graph error 190. Production needs a System User permanent token:
//   Business Settings > Users > System users > Add > Assign Assets
//   (the app with "Manage app" + the WABA with "Manage WhatsApp Business
//   accounts", both Full control) > Generate token > expiration "Never"
// with THREE permissions — business_management, whatsapp_business_messaging,
// and whatsapp_business_management. The first is the one most guides drop.

// Graph API version. From @chat-adapter/whatsapp@4.34.0's shipped default
// (published 2026-07-13). Override with WHATSAPP_GRAPH_API_VERSION if Meta has
// moved on — Meta ships a new version roughly quarterly and old ones keep
// working for ~2 years.
const DEFAULT_GRAPH_VERSION = 'v25.0';
const DEFAULT_API_URL = 'https://graph.facebook.com';

export interface WhatsAppConfig {
  accessToken: string;
  /** Numeric id from WhatsApp > API Setup. NOT the phone number itself. */
  phoneNumberId: string;
  /** WhatsApp Business Account id. Needed to list templates. */
  wabaId?: string;
  apiUrl: string;
  graphVersion: string;
}

function readVar(name: string): string | undefined {
  // An unset plugin user_config can surface as "" or as the literal
  // unexpanded "${user_config.*}" placeholder — both mean "not configured".
  const v = process.env[name];
  return v && !v.includes('${') ? v : undefined;
}

let cached: WhatsAppConfig | null = null;

export function loadConfig(): WhatsAppConfig {
  if (cached) return cached;

  const accessToken = readVar('WHATSAPP_ACCESS_TOKEN');
  if (!accessToken) {
    throw new Error(
      'WHATSAPP_ACCESS_TOKEN is not set. Set it in the environment (the Claude ' +
        'plugin does this for you). See docs/setup-meta-whatsapp.md for how to obtain ' +
        'a permanent token.',
    );
  }

  // Deliberately NO prefix assertion: Meta tokens have no reliable prefix
  // (EAA… is common but not guaranteed), so checking one would reject valid
  // tokens. Presence check only — `whatsapp_whoami` is the real probe.

  const phoneNumberId = readVar('WHATSAPP_PHONE_NUMBER_ID');
  if (!phoneNumberId) {
    throw new Error(
      'WHATSAPP_PHONE_NUMBER_ID is not set. It is the numeric id shown under ' +
        'WhatsApp > API Setup in the Meta app dashboard — not the phone number itself.',
    );
  }

  cached = {
    accessToken,
    phoneNumberId,
    // Optional: only list_templates needs it, so don't fail whoami/send over it.
    wabaId: readVar('WHATSAPP_WABA_ID'),
    apiUrl: readVar('WHATSAPP_API_URL') || DEFAULT_API_URL,
    graphVersion: readVar('WHATSAPP_GRAPH_API_VERSION') || DEFAULT_GRAPH_VERSION,
  };
  return cached;
}

// Every send tool takes an optional from_phone_number_id; this resolves it
// against the process default. That optional param is the whole multi-number
// story — Cris and Lola run separate numbers (separate Meta apps, separate
// tokens), and a future multi-number setup needs no redesign.
export function resolvePhoneNumberId(override?: string): string {
  return override || loadConfig().phoneNumberId;
}

export function requireWabaId(): string {
  const { wabaId } = loadConfig();
  if (!wabaId) {
    throw new Error(
      'WHATSAPP_WABA_ID is not set. It is required to list message templates. ' +
        'Find it in the Meta app dashboard under WhatsApp > API Setup.',
    );
  }
  return wabaId;
}

// Test seam only — no production caller.
export function resetConfigCache(): void {
  cached = null;
}
