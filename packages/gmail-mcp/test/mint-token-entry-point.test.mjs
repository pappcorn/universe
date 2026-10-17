// The guard that decides whether `mint-token` runs `main()`. Installed bins
// (npx, global and local installs) reach the script through a
// `node_modules/.bin/` symlink, and a guard that compared paths as written
// silently skipped `main()` there: `pappcorn-gmail-setup` exited 0 having done
// nothing. These cases run the real script the way an installed bin does.
//
// Plain ESM: the script under test is an .mjs bin.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isEntryPoint } from '../scripts/mint-token.mjs';

const script = fileURLToPath(
  new URL('../scripts/mint-token.mjs', import.meta.url),
);

const root = realpathSync(mkdtempSync(join(tmpdir(), 'gmail-entry-test-')));
after(() => rmSync(root, { recursive: true, force: true }));

/** Run a file with node, the way a shebang bin is run. */
function run(file, args) {
  return spawnSync(process.execPath, [file, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
  });
}

describe('running the setup script', () => {
  it('runs main() when invoked directly', () => {
    const res = run(script, ['--help']);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /^Usage: /);
  });

  it('runs main() when invoked through a symlink, as an installed bin is', () => {
    const bin = join(root, 'pappcorn-gmail-setup');
    symlinkSync(script, bin);
    const res = run(bin, ['--help']);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /^Usage: /);
  });

  it('does not run main() when imported', () => {
    const res = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `await import(${JSON.stringify(pathToFileURL(script).href)});`,
      ],
      { encoding: 'utf8', timeout: 10_000 },
    );
    assert.equal(res.status, 0);
    assert.equal(res.stdout, '');
  });
});

describe('isEntryPoint', () => {
  const url = pathToFileURL(script).href;

  it('is false without an argv[1]', () => {
    assert.equal(isEntryPoint(undefined, url), false);
  });

  it('is false, not a throw, when argv[1] does not exist', () => {
    assert.equal(isEntryPoint(join(root, 'no-such-file'), url), false);
  });

  it('is false for a different file', () => {
    assert.equal(isEntryPoint(fileURLToPath(import.meta.url), url), false);
  });
});
