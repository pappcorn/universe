// The setup script end to end, as a real child process with a fake LinkedIn
// preloaded. What it requests, how it reads what LinkedIn grants, and above all
// when it is allowed to touch an existing credential: only on full success.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, describe, it } from 'node:test';

import { tempDir } from './helpers';

const SCRIPT = resolve(__dirname, '../scripts/setup.mjs');
const PRELOAD = pathToFileURL(
  resolve(__dirname, 'fixtures/fake-linkedin.mjs'),
).href;

const FIVE = [
  'w_organization_social',
  'r_organization_social',
  'w_organization_social_feed',
  'r_organization_social_feed',
  'rw_organization_admin',
];

const files = tempDir();
after(files.cleanup);

const freePort = (): Promise<number> =>
  new Promise((ok, no) => {
    const s = createServer();
    s.on('error', no);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => ok(port));
    });
  });

interface Fake {
  grantedScope?: string;
  organizations?: string[];
  tokenStatus?: number;
}

/** Run the script and deliver the redirect the way `curl` would, carrying this
 *  run's state. `query` decides what LinkedIn's redirect says. */
async function runSetup(
  fake: Fake,
  out: string | null,
  args: string[] = [],
  query = 'code=fake-code',
  env: Record<string, string> = {},
): Promise<{ code: number | null; output: string; authUrl: URL }> {
  const port = await freePort();
  const child = spawn(
    process.execPath,
    [
      '--import',
      PRELOAD,
      SCRIPT,
      '--client-id',
      'test-client',
      '--port',
      String(port),
      ...(out ? ['--out', out] : []),
      ...args,
    ],
    {
      env: {
        PATH: process.env.PATH,
        ...env,
        LINKEDIN_CLIENT_SECRET: 'fake-client-secret',
        FAKE_LINKEDIN: JSON.stringify({
          grantedScope: FIVE.join(','),
          organizations: ['urn:li:organization:42'],
          ...fake,
        }),
      },
    },
  );
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  const exited = new Promise<number | null>((ok) => child.on('exit', ok));

  while (!/Waiting \(timeout/.test(output)) {
    await new Promise((r) => setTimeout(r, 10));
  }
  const m = /https:\/\/www\.linkedin\.com\/oauth\/v2\/authorization\S+/.exec(
    output,
  );
  assert.ok(m, 'the script prints the consent URL');
  const authUrl = new URL(m[0]);
  const state = authUrl.searchParams.get('state');

  for (let i = 0; ; i++) {
    try {
      await fetch(`http://localhost:${port}/callback?state=${state}&${query}`);
      break;
    } catch (err) {
      if (i > 100) throw err;
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  return { code: await exited, output, authUrl };
}

const path = (name: string) => join(files.dir, name);

describe('what the setup requests', () => {
  it('asks for the five scopes, %20-separated, and waits 15 minutes', async () => {
    const out = path('scopes.json');
    const { authUrl, output, code } = await runSetup({}, out);
    assert.equal(code, 0);
    assert.deepEqual(authUrl.searchParams.get('scope')?.split(' '), FIVE);
    assert.match(authUrl.search, new RegExp(FIVE.join('%20')));
    assert.match(output, /timeout 15 min/);
  });

  it('tells someone on another device how to deliver the redirect', async () => {
    const { output } = await runSetup({}, path('device.json'));
    assert.match(output, /another device/);
    assert.match(output, /curl '<address>'/);
  });
});

describe('reading what LinkedIn granted', () => {
  it('understands a comma-separated scope list', async () => {
    const { output, code } = await runSetup(
      { grantedScope: FIVE.join(',') },
      path('comma.json'),
    );
    assert.equal(code, 0);
    assert.doesNotMatch(output, /did not grant/);
  });

  it('understands a space-separated scope list too', async () => {
    const { output } = await runSetup(
      { grantedScope: FIVE.join(' ') },
      path('space.json'),
    );
    assert.doesNotMatch(output, /did not grant/);
  });

  it('names exactly the scope LinkedIn withheld', async () => {
    const { output } = await runSetup(
      {
        grantedScope: FIVE.filter(
          (s) => s !== 'r_organization_social_feed',
        ).join(','),
      },
      path('withheld.json'),
    );
    assert.match(output, /did not grant: r_organization_social_feed\./);
  });
});

describe('where the setup writes by default', () => {
  it('uses ~/.config/pappcorn/linkedin-mcp/credentials.json', async () => {
    const home = path('home');
    const { code } = await runSetup({}, null, [], 'code=fake-code', {
      HOME: home,
    });
    assert.equal(code, 0);
    const written = join(
      home,
      '.config/pappcorn/linkedin-mcp/credentials.json',
    );
    assert.equal(
      JSON.parse(readFileSync(written, 'utf8')).organization,
      'urn:li:organization:42',
    );
    assert.equal(statSync(written).mode & 0o777, 0o600);
  });
});

describe('resolving the path like the connector does', () => {
  it('honors LINKEDIN_MCP_CREDENTIALS when --out is absent', async () => {
    const home = path('home-env');
    const custom = path('custom-location.json');
    const { code } = await runSetup({}, null, [], 'code=fake-code', {
      HOME: home,
      LINKEDIN_MCP_CREDENTIALS: custom,
    });
    assert.equal(code, 0);
    assert.equal(existsSync(custom), true);
    assert.equal(
      existsSync(join(home, '.config/pappcorn/linkedin-mcp/credentials.json')),
      false,
    );
  });

  it('lets --out win over LINKEDIN_MCP_CREDENTIALS', async () => {
    const custom = path('ignored.json');
    const out = path('explicit.json');
    await runSetup({}, out, [], 'code=fake-code', {
      LINKEDIN_MCP_CREDENTIALS: custom,
    });
    assert.equal(existsSync(out), true);
    assert.equal(existsSync(custom), false);
  });
});

describe('error output', () => {
  it("prints LinkedIn's named error, never the raw body", async () => {
    const { output, code } = await runSetup(
      { tokenStatus: 400 },
      path('echo.json'),
    );
    assert.equal(code, 1);
    assert.match(output, /HTTP 400\): invalid_request/);
    assert.doesNotMatch(output, /fake-code/);
  });
});

describe('the credential file', () => {
  const previous = '{"marker":"the credential that was already here"}\n';

  it('is written chmod 600 on success, and no token is printed', async () => {
    const out = path('ok.json');
    writeFileSync(out, previous, { mode: 0o644 });
    const { output, code } = await runSetup({}, out);
    assert.equal(code, 0);
    const cred = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(cred.organization, 'urn:li:organization:42');
    assert.equal(cred.refresh_token, 'fake-refresh-token');
    assert.equal(statSync(out).mode & 0o777, 0o600);
    assert.doesNotMatch(
      output,
      /fake-access-token|fake-refresh-token|fake-client-secret/,
    );
  });

  it('is left alone when an admin of several Pages omits --organization', async () => {
    const out = path('several.json');
    writeFileSync(out, previous);
    const { output, code } = await runSetup(
      { organizations: ['urn:li:organization:1', 'urn:li:organization:2'] },
      out,
    );
    assert.equal(code, 1);
    assert.match(output, /NOTHING WAS WRITTEN/);
    assert.match(output, /--organization <id> and authorize again/);
    assert.match(output, /1 {2}Page 1/);
    assert.equal(readFileSync(out, 'utf8'), previous);
  });

  it('records the Page --organization picks among several', async () => {
    const out = path('picked.json');
    const { code } = await runSetup(
      { organizations: ['urn:li:organization:1', 'urn:li:organization:2'] },
      out,
      ['--organization', '2'],
    );
    assert.equal(code, 0);
    assert.equal(
      JSON.parse(readFileSync(out, 'utf8')).organization,
      'urn:li:organization:2',
    );
  });

  it('is left alone for a Page the member does not administer', async () => {
    const out = path('foreign.json');
    writeFileSync(out, previous);
    const { code } = await runSetup({}, out, ['--organization', '999']);
    assert.equal(code, 1);
    assert.equal(readFileSync(out, 'utf8'), previous);
  });

  it('is left alone when the token exchange fails', async () => {
    const out = path('exchange.json');
    writeFileSync(out, previous);
    const { code } = await runSetup({ tokenStatus: 400 }, out);
    assert.equal(code, 1);
    assert.equal(readFileSync(out, 'utf8'), previous);
  });

  it('is left alone when the person declines on LinkedIn', async () => {
    const out = path('declined.json');
    writeFileSync(out, previous);
    const { code } = await runSetup(
      {},
      out,
      [],
      'error=user_cancelled_authorize',
    );
    assert.equal(code, 1);
    assert.equal(readFileSync(out, 'utf8'), previous);
  });

  it('is not created at all by a failed run', async () => {
    const out = path('never.json');
    await runSetup({ tokenStatus: 400 }, out);
    assert.equal(existsSync(out), false);
  });
});
