// The GMAIL_ACCOUNT gate's memo contract.
//
// The gate is what stands between a credential and every Gmail call, so what it
// chooses to REMEMBER is load-bearing in both directions: a denial that fades
// would let the wrong mailbox through on a retry, and a network blip that
// sticks would take a healthy mailbox offline for the life of the process.
// Neither failure is visible from the outside until it bites someone.
//
// Node's built-in test runner — no test framework dependency.
//   npm test          (from packages/gmail-mcp)

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MailAccessError } from '../src/auth';
import { createAssertionGate, GmailApiError } from '../src/core';

/** A verifier that records its calls and replays a scripted outcome per call. */
function scripted(...outcomes: (Error | null)[]) {
  const calls: string[] = [];
  const verify = async (expected: string): Promise<void> => {
    const outcome = outcomes[Math.min(calls.length, outcomes.length - 1)];
    calls.push(expected);
    if (outcome) throw outcome;
  };
  return { verify, calls };
}

const unreachable = () =>
  new GmailApiError('GET profile (account assertion)', 503, 'backend error');

describe('createAssertionGate', () => {
  it('does not verify anything when no account is asserted', async () => {
    const { verify, calls } = scripted(null);
    const gate = createAssertionGate(() => undefined, verify);

    await gate();
    await gate();

    assert.deepEqual(calls, []);
  });

  it('verifies once and remembers the success', async () => {
    const { verify, calls } = scripted(null);
    const gate = createAssertionGate(() => 'me@example.com', verify);

    await gate();
    await gate();
    await gate();

    assert.deepEqual(calls, ['me@example.com']);
  });

  it('shares one round trip between concurrent callers', async () => {
    const { verify, calls } = scripted(null);
    const gate = createAssertionGate(() => 'me@example.com', verify);

    await Promise.all([gate(), gate(), gate()]);

    assert.equal(calls.length, 1);
  });

  it('remembers a mailbox mismatch — a denial stays a denial', async () => {
    const denial = new MailAccessError('wrong mailbox');
    const { verify, calls } = scripted(denial);
    const gate = createAssertionGate(() => 'me@example.com', verify);

    await assert.rejects(gate(), denial);
    await assert.rejects(gate(), denial);

    // Re-asking Gmail would only deny more slowly.
    assert.equal(calls.length, 1);
  });

  it('retries after a failure to REACH Gmail, and can then succeed', async () => {
    // A 503 says nothing about which mailbox this credential opens.
    const { verify, calls } = scripted(unreachable(), null);
    const gate = createAssertionGate(() => 'me@example.com', verify);

    await assert.rejects(
      gate(),
      (err: unknown) => err instanceof GmailApiError,
    );
    await gate(); // Google recovered; the mailbox was never in question.
    await gate(); // and the success is now memoised

    assert.equal(calls.length, 2);
  });

  it('still denies when the retry turns out to be a real mismatch', async () => {
    const denial = new MailAccessError('wrong mailbox');
    const { verify, calls } = scripted(unreachable(), denial);
    const gate = createAssertionGate(() => 'me@example.com', verify);

    await assert.rejects(
      gate(),
      (err: unknown) => err instanceof GmailApiError,
    );
    await assert.rejects(gate(), denial);
    await assert.rejects(gate(), denial);

    assert.equal(calls.length, 2);
  });

  it('does not crash the process when nobody awaits the first rejection', async () => {
    const { verify } = scripted(unreachable());
    const gate = createAssertionGate(() => 'me@example.com', verify);

    gate(); // deliberately not awaited
    await new Promise((r) => setImmediate(r));

    await assert.rejects(
      gate(),
      (err: unknown) => err instanceof GmailApiError,
    );
  });
});
