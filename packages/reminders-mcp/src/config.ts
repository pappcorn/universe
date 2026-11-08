// Environment → typed config. process.env only.
//
// There is nothing secret to configure: the connector talks to the Reminders
// app on this Mac, and macOS itself decides (through its Automation privacy
// prompt) whether it may. No account, no token, no network.

export interface Config {
  /** The osascript binary. Fixed on purpose: an environment override would let
   *  a project's config swap in another program. Tests use a fake runner. */
  osascript: string;
  /** How long one call to Reminders may take. The FIRST call waits for the
   *  person to answer the macOS permission prompt, so this is generous. */
  timeoutMs: number;
}

export const DEFAULT_OSASCRIPT = '/usr/bin/osascript';
export const DEFAULT_TIMEOUT_MS = 120_000;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const raw = env.REMINDERS_MCP_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : NaN;
  return {
    osascript: DEFAULT_OSASCRIPT,
    timeoutMs:
      Number.isFinite(parsed) && parsed >= 1000 ? parsed : DEFAULT_TIMEOUT_MS,
  };
}
