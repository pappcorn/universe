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
    assert.equal(gate.redeem('post', t, fp), 'ok');
    assert.equal(
      gate.redeem('post', t, fp),
      'unknown',
      'a token is single-use',
    );
  });

  it('issues random tokens, never a function of the content', () => {
    const gate = new ConfirmationGate();
    assert.notEqual(gate.issue('post', fp), gate.issue('post', fp));
  });

  it('refuses a token never issued', () => {
    const gate = new ConfirmationGate();
    assert.equal(gate.redeem('post', 'deadbeef', fp), 'unknown');
  });

  it('refuses changed content and spends the token', () => {
    const gate = new ConfirmationGate();
    const t = gate.issue('post', fp);
    assert.equal(
      gate.redeem('post', t, fingerprint({ text: 'chao' })),
      'mismatch',
    );
    assert.equal(
      gate.redeem('post', t, fp),
      'unknown',
      'a failed redeem burns it',
    );
  });

  it('refuses a token issued for the other action', () => {
    const gate = new ConfirmationGate();
    const t = gate.issue('comment', fp);
    assert.equal(gate.redeem('post', t, fp), 'mismatch');
  });

  it('refuses an expired token', () => {
    let now = 1_000_000;
    const gate = new ConfirmationGate(() => now);
    const t = gate.issue('post', fp);
    now += TOKEN_TTL_MS + 1;
    assert.equal(gate.redeem('post', t, fp), 'expired');
  });
});
