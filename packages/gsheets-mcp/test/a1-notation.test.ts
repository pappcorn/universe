// A1 notation and id parsing — the arithmetic every other tool depends on. A
// silent off-by-one here would point an edit at the wrong row, which is the
// worst failure this connector can have.
//
// Node's built-in test runner — no test framework dependency.
//   npm test          (from packages/gsheets-mcp)

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  columnLetter,
  editToken,
  quoteSheetName,
  rangeAnchor,
  resolveSpreadsheetId,
} from '../src/core';

const ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';

describe('columnLetter', () => {
  it('maps the single-letter range', () => {
    assert.equal(columnLetter(1), 'A');
    assert.equal(columnLetter(26), 'Z');
  });

  it('carries into two letters', () => {
    assert.equal(columnLetter(27), 'AA');
    assert.equal(columnLetter(52), 'AZ');
    assert.equal(columnLetter(53), 'BA');
  });

  it('carries into three letters', () => {
    assert.equal(columnLetter(703), 'AAA');
  });
});

describe('resolveSpreadsheetId', () => {
  it('accepts a bare id', () => {
    assert.equal(resolveSpreadsheetId(ID), ID);
  });

  it('accepts the URL a human copies out of the address bar', () => {
    assert.equal(
      resolveSpreadsheetId(
        `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`
      ),
      ID
    );
    assert.equal(
      resolveSpreadsheetId(
        `https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing`
      ),
      ID
    );
  });

  it('accepts a Drive file URL (how a shared .xlsx arrives)', () => {
    assert.equal(
      resolveSpreadsheetId(`https://drive.google.com/file/d/${ID}/view`),
      ID
    );
  });

  it('accepts the legacy ?id= form', () => {
    assert.equal(
      resolveSpreadsheetId(`https://drive.google.com/open?id=${ID}`),
      ID
    );
  });

  it('rejects anything else instead of guessing', () => {
    assert.throws(
      () => resolveSpreadsheetId('the finance sheet'),
      /not a spreadsheet id/
    );
    assert.throws(() => resolveSpreadsheetId('abc123'), /not a spreadsheet id/);
  });
});

describe('rangeAnchor', () => {
  it('defaults to the top-left of the grid', () => {
    assert.deepEqual(rangeAnchor('A1:C9'), { row: 1, col: 1 });
  });

  it('reads a deep row behind a quoted tab name', () => {
    assert.deepEqual(rangeAnchor("'Q3 2026'!D38104:H38104"), {
      row: 38104,
      col: 4,
    });
  });

  it('treats a whole-column range as starting at row 1', () => {
    assert.deepEqual(rangeAnchor('Datos!C:C'), { row: 1, col: 3 });
  });

  it('handles two-letter columns', () => {
    assert.deepEqual(rangeAnchor('Hoja!AA5'), { row: 5, col: 27 });
  });

  it('ignores absolute-reference dollars', () => {
    assert.deepEqual(rangeAnchor('Hoja!$B$7'), { row: 7, col: 2 });
  });
});

describe('quoteSheetName', () => {
  it('leaves a simple name alone', () => {
    assert.equal(quoteSheetName('Datos'), 'Datos');
  });

  it('quotes a name with a space', () => {
    assert.equal(quoteSheetName('Q3 2026'), "'Q3 2026'");
  });

  it('doubles an embedded apostrophe', () => {
    assert.equal(quoteSheetName("Alexa's"), "'Alexa''s'");
  });
});

describe('editToken', () => {
  it('is stable for the same edit against the same prior state', () => {
    assert.equal(
      editToken('X', 'A1', [['a']], [['b']]),
      editToken('X', 'A1', [['a']], [['b']])
    );
  });

  it('changes when the prior state changed — this is the concurrency check', () => {
    const issued = editToken('X', 'A1', [['a']], [['b']]);
    const afterSomeoneElseEdited = editToken(
      'X',
      'A1',
      [['someone else']],
      [['b']]
    );
    assert.notEqual(issued, afterSomeoneElseEdited);
  });

  it('changes when the proposed values changed', () => {
    assert.notEqual(
      editToken('X', 'A1', [['a']], [['b']]),
      editToken('X', 'A1', [['a']], [['c']])
    );
  });

  it('is scoped to the file and the range', () => {
    assert.notEqual(
      editToken('X', 'A1', [['a']], [['b']]),
      editToken('Y', 'A1', [['a']], [['b']])
    );
    assert.notEqual(
      editToken('X', 'A1', [['a']], [['b']]),
      editToken('X', 'A2', [['a']], [['b']])
    );
  });
});
