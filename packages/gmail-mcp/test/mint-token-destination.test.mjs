// The rules that decide whether `mint-token` is allowed to overwrite an
// existing credential. This is the code path that destroyed a working
// credential in the field, so it gets tests rather than trust.
//
// Plain ESM: the script under test is an .mjs bin, imported directly.

import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import {
  chooseDestination,
  inspect,
  mailboxInFile,
  perMailboxPath,
  sameMailbox,
} from '../scripts/mint-token.mjs';

// realpath, because `inspect` resolves symlink targets and macOS's temp dir is
// itself a symlink (/var → /private/var).
const root = realpathSync(mkdtempSync(join(tmpdir(), 'gmail-mint-test-')));
after(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
/** A fresh, empty credential directory per case. */
function credentialDir() {
  const dir = join(root, `case-${n++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function credential(path, account) {
  writeFileSync(
    path,
    JSON.stringify({
      client_id: 'id',
      client_secret: 'secret',
      refresh_token: 'refresh',
      account,
    }),
  );
  return path;
}

describe('perMailboxPath', () => {
  it('derives a readable, path-safe filename from the mailbox', () => {
    assert.equal(
      perMailboxPath('You@Example.com', '/c'),
      '/c/you_at_example.com.json',
    );
  });

  it('never lets an address escape the credential directory', () => {
    assert.equal(
      perMailboxPath('../../etc/passwd@x.com', '/c'),
      '/c/etc-passwd_at_x.com.json',
    );
  });

  it('never produces a dotfile or an empty name', () => {
    assert.equal(perMailboxPath('...', '/c'), '/c/mailbox.json');
  });
});

describe('inspect', () => {
  it('reports a plain credential file and the mailbox it holds', () => {
    const dir = credentialDir();
    const path = credential(join(dir, 'credentials.json'), 'a@example.com');
    assert.deepEqual(inspect(path), {
      exists: true,
      symlink: false,
      target: null,
      mailbox: 'a@example.com',
    });
  });

  it('sees through a symlink and reports both the target and its mailbox', () => {
    const dir = credentialDir();
    const real = credential(join(dir, 'vault.json'), 'vault@example.com');
    const link = join(dir, 'credentials.json');
    symlinkSync(real, link);

    const at = inspect(link);
    assert.equal(at.exists, true);
    assert.equal(at.symlink, true);
    assert.equal(at.target, real);
    assert.equal(at.mailbox, 'vault@example.com');
  });

  it('treats a dangling symlink as an existing destination', () => {
    // Writing would still follow it, so it must never count as "free".
    const dir = credentialDir();
    const link = join(dir, 'credentials.json');
    symlinkSync(join(dir, 'gone.json'), link);

    const at = inspect(link);
    assert.equal(at.exists, true);
    assert.equal(at.symlink, true);
    assert.equal(at.mailbox, null);
  });

  it('reports a missing path as free', () => {
    assert.deepEqual(inspect(join(credentialDir(), 'nothing.json')), {
      exists: false,
      symlink: false,
      target: null,
      mailbox: null,
    });
  });

  it('returns no mailbox for a file that is not a credential', () => {
    const dir = credentialDir();
    const path = join(dir, 'credentials.json');
    writeFileSync(path, 'not json at all');
    assert.equal(mailboxInFile(path), null);
  });
});

describe('chooseDestination', () => {
  it('uses the default path when nothing is there yet', () => {
    const dir = credentialDir();
    const dflt = join(dir, 'credentials.json');
    assert.equal(chooseDestination('a@example.com', dflt, dir), dflt);
  });

  it('refreshes in place when the default path holds the same mailbox', () => {
    const dir = credentialDir();
    const dflt = credential(join(dir, 'credentials.json'), 'a@example.com');
    assert.equal(chooseDestination('A@Example.com', dflt, dir), dflt);
  });

  it('gives a second mailbox its own file instead of overwriting the first', () => {
    const dir = credentialDir();
    const dflt = credential(join(dir, 'credentials.json'), 'first@example.com');
    assert.equal(
      chooseDestination('second@example.com', dflt, dir),
      join(dir, 'second_at_example.com.json'),
    );
  });

  it('does not write through a symlink pointing at another mailbox', () => {
    // The field failure: the default path was a symlink into a credential
    // vault, and minting a second mailbox destroyed the first.
    const dir = credentialDir();
    const vault = credential(join(dir, 'vault.json'), 'first@example.com');
    const dflt = join(dir, 'credentials.json');
    symlinkSync(vault, dflt);

    assert.equal(
      chooseDestination('second@example.com', dflt, dir),
      join(dir, 'second_at_example.com.json'),
    );
  });

  it('does not overwrite a destination whose mailbox cannot be determined', () => {
    const dir = credentialDir();
    const dflt = join(dir, 'credentials.json');
    writeFileSync(dflt, '{"client_id":"id"}'); // no account field
    assert.equal(
      chooseDestination('a@example.com', dflt, dir),
      join(dir, 'a_at_example.com.json'),
    );
  });
});

describe('sameMailbox', () => {
  it('compares case- and whitespace-insensitively', () => {
    assert.equal(sameMailbox(' A@Example.com ', 'a@example.com'), true);
    assert.equal(sameMailbox('a@example.com', 'b@example.com'), false);
    assert.equal(sameMailbox(null, 'a@example.com'), false);
    assert.equal(sameMailbox('a@example.com', undefined), false);
  });
});
