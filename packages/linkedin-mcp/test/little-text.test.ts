// Post commentary is LinkedIn "little" text: reserved characters must be
// backslash-escaped or LinkedIn drops or misreads them. Hashtags stay live.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { escapeLittle } from '../src/core';

describe('escapeLittle', () => {
  it('leaves plain text alone', () => {
    assert.equal(
      escapeLittle('Hola, ¿cómo vas? 50% listo.'),
      'Hola, ¿cómo vas? 50% listo.',
    );
  });

  it('escapes every reserved character', () => {
    assert.equal(
      escapeLittle('| { } @ [ ] ( ) < > \\ * _ ~'),
      '\\| \\{ \\} \\@ \\[ \\] \\( \\) \\< \\> \\\\ \\* \\_ \\~',
    );
  });

  it('keeps hashtags, including accented ones', () => {
    assert.equal(escapeLittle('#IA y #educación'), '#IA y #educación');
    assert.equal(escapeLittle('(#tag)'), '\\(#tag\\)');
  });

  it('escapes a # that does not start a hashtag', () => {
    assert.equal(
      escapeLittle('issue#12 and # alone'),
      'issue\\#12 and \\# alone',
    );
  });

  it('escapes list bullets so they are not read as formatting', () => {
    assert.equal(escapeLittle('* uno\n* dos'), '\\* uno\n\\* dos');
  });

  it('escapes @ so no mention is ever created by accident', () => {
    assert.equal(
      escapeLittle('@[Acme](urn:li:organization:1)'),
      '\\@\\[Acme\\]\\(urn:li:organization:1\\)',
    );
  });

  it('keeps emoji and astral characters intact', () => {
    assert.equal(escapeLittle('🍿 listo_'), '🍿 listo\\_');
  });
});
