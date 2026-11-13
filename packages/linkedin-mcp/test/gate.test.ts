// The confirmation gate on its own: the properties every publish relies on.
//
//   npm test          (from packages/linkedin-mcp)

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ConfirmationGate, fingerprint, TOKEN_TTL_MS } from '../src/gate';

describe('ConfirmationGate', () => {
  const fp = fingerprint({ text: 'hola' });

  it('redeems a token once, for the content it was issued for', () => {
    const gate = new ConfirmationGate();
    const t = gate.issue('post', fp);
    assert.equal(gate.claim('post', t, fp).verdict, 'ok');
    assert.equal(
      gate.claim('post', t, fp).verdict,
      'unknown',
      'a token is single-use',
    );
  });

  it('hands back the payload only to a good redemption', () => {
    const gate = new ConfirmationGate();
    const plan = { pieces: [{ text: 'hola' }] };
    const t = gate.issue('post', fp, plan);
    assert.deepEqual(gate.claim('post', t, fp), {
      verdict: 'ok',
      payload: plan,
    });
    const u = gate.issue('post', fp, plan);
    assert.deepEqual(gate.claim('comment', u, fp), { verdict: 'mismatch' });
  });

  it('issues random tokens, never a function of the content', () => {
    const gate = new ConfirmationGate();
    assert.notEqual(gate.issue('post', fp), gate.issue('post', fp));
  });

  it('refuses a token never issued', () => {
    const gate = new ConfirmationGate();
    assert.equal(gate.claim('post', 'deadbeef', fp).verdict, 'unknown');
  });

  it('refuses changed content and spends the token', () => {
    const gate = new ConfirmationGate();
    const t = gate.issue('post', fp);
    assert.equal(
      gate.claim('post', t, fingerprint({ text: 'chao' })).verdict,
      'mismatch',
    );
    assert.equal(
      gate.claim('post', t, fp).verdict,
      'unknown',
      'a failed redeem burns it',
    );
  });

  it('refuses a token issued for the other action', () => {
    const gate = new ConfirmationGate();
    const t = gate.issue('comment', fp);
    assert.equal(gate.claim('post', t, fp).verdict, 'mismatch');
  });

  it('refuses an expired token', () => {
    let now = 1_000_000;
    const gate = new ConfirmationGate(() => now);
    const t = gate.issue('post', fp);
    now += TOKEN_TTL_MS + 1;
    assert.equal(gate.claim('post', t, fp).verdict, 'expired');
  });
});
