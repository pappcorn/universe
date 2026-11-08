// Dates decide WHEN a person gets nagged. Every input form, the offset the
// model gets back, and the inputs we refuse.

import './helpers';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  boundMs,
  DateInputError,
  formatDay,
  formatLocal,
  isLocalMidnight,
  parseWhen,
  zoneLabel,
} from '../src/dates';

describe('parseWhen', () => {
  it('reads a bare day as an all-day date', () => {
    assert.deepEqual(parseWhen('2026-11-08'), {
      kind: 'day',
      y: 2026,
      m: 11,
      d: 8,
    });
  });

  it("reads a time without offset in the Mac's zone", () => {
    const w = parseWhen('2026-11-08T09:00');
    assert.equal(w.kind, 'instant');
    assert.equal(
      new Date((w as { ms: number }).ms).toISOString(),
      '2026-11-08T14:00:00.000Z',
    );
  });

  it('accepts a space instead of T, and seconds', () => {
    const w = parseWhen('2026-11-08 09:00:30') as { ms: number };
    assert.equal(new Date(w.ms).toISOString(), '2026-11-08T14:00:30.000Z');
  });

  it('honours an explicit offset regardless of the local zone', () => {
    const w = parseWhen('2026-11-08T09:00:00+01:00') as { ms: number };
    assert.equal(new Date(w.ms).toISOString(), '2026-11-08T08:00:00.000Z');
    const z = parseWhen('2026-11-08T14:00:00Z') as { ms: number };
    assert.equal(new Date(z.ms).toISOString(), '2026-11-08T14:00:00.000Z');
    const compact = parseWhen('2026-11-08T09:00-0500') as { ms: number };
    assert.equal(
      new Date(compact.ms).toISOString(),
      '2026-11-08T14:00:00.000Z',
    );
  });

  it('refuses dates that do not exist', () => {
    assert.throws(() => parseWhen('2026-02-30'), DateInputError);
    assert.throws(() => parseWhen('2026-11-08T24:00'), DateInputError);
  });

  it('refuses natural language, and names the expected form and zone', () => {
    assert.throws(
      () => parseWhen('tomorrow at 9', 'due'),
      (e: Error) =>
        e instanceof DateInputError &&
        /due:/.test(e.message) &&
        /America\/Bogota/.test(e.message),
    );
  });
});

describe('formatting', () => {
  it('writes instants back in local time with the offset', () => {
    assert.equal(
      formatLocal(Date.parse('2026-11-08T14:00:00Z')),
      '2026-11-08T09:00:00-05:00',
    );
  });

  it('writes local days, not UTC days', () => {
    // 02:00 UTC on the 9th is still the 8th in Bogotá.
    assert.equal(formatDay(Date.parse('2026-11-09T02:00:00Z')), '2026-11-08');
  });

  it('recognises local midnight as all-day', () => {
    assert.equal(isLocalMidnight(Date.parse('2026-11-09T05:00:00Z')), true);
    assert.equal(isLocalMidnight(Date.parse('2026-11-09T00:00:00Z')), false);
  });

  it('a day bound starts at local midnight', () => {
    assert.equal(
      new Date(boundMs(parseWhen('2026-11-08'))).toISOString(),
      '2026-11-08T05:00:00.000Z',
    );
  });

  it('labels the zone with its offset', () => {
    assert.equal(zoneLabel(), 'America/Bogota (UTC-05:00)');
  });
});
