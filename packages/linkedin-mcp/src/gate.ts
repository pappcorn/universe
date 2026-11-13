// The confirmation gate for outward actions. Publishing a post or a comment
// reaches every follower of the Page and cannot be taken back by this
// connector, so neither happens on the first call.
//
// ── THE RULE ────────────────────────────────────────────────────────────────
// A publish tool called WITHOUT `confirm_token` publishes nothing. It validates
// the input, shows exactly what would go out, and issues a token. The assistant
// puts that preview in front of the human; the human decides; only a second
// call with the SAME arguments and the token publishes.
//
// The token is:
//   · random — it cannot be derived from the arguments, so the only way to get
//     one is to produce a preview first;
//   · bound to a fingerprint of the exact content — text, target, and the
//     sha256 of any attached file — so approving one thing never publishes
//     another, and swapping a file after the preview voids the approval;
//   · single-use — it is spent the moment it is redeemed, BEFORE the API call,
//     so a retry after a timeout can never publish twice;
//   · short-lived — it expires, so an approval from an hour ago does not
//     quietly authorize something now;
//   · in memory only — restarting the server voids every pending approval;
//   · carrying what was resolved for the preview (the mentions, looked up on
//     LinkedIn) — redeeming hands it back, so the publish sends exactly what was
//     shown, with no new lookup, and a bad token costs no network call at all.
//
// There is deliberately no bypass flag.

import { createHash, randomBytes } from 'node:crypto';

export const TOKEN_TTL_MS = 15 * 60 * 1000;

export type GateAction = 'post' | 'comment';

export type RedeemResult = 'ok' | 'unknown' | 'mismatch' | 'expired';

interface Pending {
  action: GateAction;
  fingerprint: string;
  expiresAt: number;
  payload?: unknown;
}

export function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export class ConfirmationGate {
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly now: () => number = Date.now) {}

  /** `payload` is what the preview resolved and the publish must reuse. */
  issue(action: GateAction, fp: string, payload?: unknown): string {
    this.sweep();
    const token = randomBytes(12).toString('hex');
    this.pending.set(token, {
      action,
      fingerprint: fp,
      expiresAt: this.now() + TOKEN_TTL_MS,
      payload,
    });
    return token;
  }

  /** Spend a token. Any presented token is consumed whatever the outcome, so a
   *  token that failed once (wrong content, wrong tool) cannot be retried. */
  redeem(action: GateAction, token: string, fp: string): RedeemResult {
    return this.claim(action, token, fp).verdict;
  }

  /** redeem(), also handing back the preview's payload when the token is good. */
  claim<T = unknown>(
    action: GateAction,
    token: string,
    fp: string,
  ): { verdict: RedeemResult; payload?: T } {
    const p = this.pending.get(token);
    if (!p) return { verdict: 'unknown' };
    this.pending.delete(token);
    if (p.expiresAt <= this.now()) return { verdict: 'expired' };
    if (p.action !== action || p.fingerprint !== fp)
      return { verdict: 'mismatch' };
    return { verdict: 'ok', payload: p.payload as T };
  }

  private sweep(): void {
    const t = this.now();
    for (const [k, v] of this.pending)
      if (v.expiresAt <= t) this.pending.delete(k);
  }
}

export function refusal(result: Exclude<RedeemResult, 'ok'>): string {
  const why = {
    unknown:
      'that confirm_token was never issued by this server, or was already used (tokens are ' +
      'single-use and do not survive a restart).',
    expired: `that confirm_token expired (they last ${TOKEN_TTL_MS / 60000} minutes).`,
    mismatch:
      'the content is not what was previewed: the text, the target or the attached file ' +
      'changed after the preview. The token is now spent.',
  }[result];
  return (
    `REFUSED — nothing was published: ${why}\n` +
    'Call the tool again WITHOUT confirm_token to get a fresh preview, show it to the person ' +
    'you work for, and confirm only after their explicit yes.'
  );
}
