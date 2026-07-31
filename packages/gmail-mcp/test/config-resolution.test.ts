// The identity-resolution contract, tested where it is cheapest to get wrong:
// which `.env` is in scope, and which credential a folder resolves to.
//
// Node's built-in test runner — no test framework dependency.
//   npm test          (from packages/gmail-mcp)

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { resolveCredentialPlan } from '../src/auth';
import { expandPath, findEnvFile, parseEnvFile } from '../src/env-file';

// A fake home so the walk-up boundary can be exercised without touching the
// real one. Everything lives under it, as it would on a real machine.
const home = mkdtempSync(join(tmpdir(), 'gmail-mcp-test-'));
after(() => rmSync(home, { recursive: true, force: true }));

function dir(...parts: string[]): string {
  const path = join(home, ...parts);
  mkdirSync(path, { recursive: true });
  return path;
}

function file(path: string, contents = ''): string {
  writeFileSync(path, contents);
  return path;
}

describe('findEnvFile', () => {
  it('finds a .env in the working directory itself', () => {
    const project = dir('a', 'project');
    const env = file(join(project, '.env'), 'X=1');
    assert.equal(findEnvFile(project, home), env);
  });

  it('walks up to the repo root', () => {
    const repo = dir('b', 'repo');
    file(join(repo, '.git'), 'gitdir: elsewhere');
    const env = file(join(repo, '.env'), 'X=1');
    const deep = dir('b', 'repo', 'packages', 'thing', 'src');
    assert.equal(findEnvFile(deep, home), env);
  });

  it('prefers the nearest .env over the repo root one', () => {
    const repo = dir('c', 'repo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    file(join(repo, '.env'), 'X=root');
    const inner = dir('c', 'repo', 'app');
    const nearest = file(join(inner, '.env'), 'X=inner');
    assert.equal(findEnvFile(inner, home), nearest);
  });

  it('stops at the repo root instead of climbing out of the repository', () => {
    // A .env one level ABOVE the repo must not leak into it.
    file(join(dir('d'), '.env'), 'X=outside');
    const repo = dir('d', 'repo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    assert.equal(findEnvFile(join(repo, 'src'), home), null);
  });

  it('never reads ~/.env — the home directory is out of bounds', () => {
    file(join(home, '.env'), 'X=home');
    assert.equal(findEnvFile(dir('e', 'loose-folder'), home), null);
    assert.equal(findEnvFile(home, home), null);
  });

  it('returns null rather than borrowing from a sibling', () => {
    file(join(dir('f', 'other'), '.env'), 'X=1');
    assert.equal(findEnvFile(dir('f', 'mine'), home), null);
  });
});

describe('parseEnvFile', () => {
  it('reads plain, exported, quoted and commented lines', () => {
    const values = parseEnvFile(
      [
        '# a comment',
        '',
        'PLAIN=value',
        'export EXPORTED=value2',
        'SPACED = spaced value ',
        'DQ="double quoted # not a comment"',
        "SQ='single \\n literal'",
        'TRAILING=value # trailing comment',
        'ESCAPED="line1\\nline2"',
        'not a line',
        '1INVALID=nope',
      ].join('\n')
    );

    assert.deepEqual(values, {
      PLAIN: 'value',
      EXPORTED: 'value2',
      SPACED: 'spaced value',
      DQ: 'double quoted # not a comment',
      SQ: 'single \\n literal',
      TRAILING: 'value',
      ESCAPED: 'line1\nline2',
    });
  });

  it('does not interpolate variables — a value means what it says', () => {
    assert.deepEqual(parseEnvFile('A=1\nB=$A/x'), { A: '1', B: '$A/x' });
  });
});

describe('expandPath', () => {
  it('expands a leading ~', () => {
    assert.equal(
      expandPath('~/creds/work.json', '/base', home),
      join(home, 'creds/work.json')
    );
  });

  it('resolves a relative path against the file that declared it', () => {
    assert.equal(
      expandPath('.secrets/work.json', '/base', home),
      '/base/.secrets/work.json'
    );
  });

  it('leaves an absolute path alone', () => {
    assert.equal(
      expandPath('/etc/creds.json', '/base', home),
      '/etc/creds.json'
    );
  });
});

describe('resolveCredentialPlan', () => {
  const DEFAULT = '/home/u/.config/pappcorn-gmail-mcp/credentials.json';
  const envFileAt = (path: string, values: Record<string, string>) => ({
    path,
    values,
  });
  const inline = {
    GMAIL_CLIENT_ID: 'id',
    GMAIL_CLIENT_SECRET: 'secret',
    GMAIL_REFRESH_TOKEN: 'refresh',
  };

  it('prefers inline credentials from the process environment', () => {
    const plan = resolveCredentialPlan(
      { ...inline },
      envFileAt('/w/.env', { GMAIL_MCP_CREDENTIALS: '/w/other.json' }),
      '/w',
      DEFAULT
    );
    assert.equal(plan.kind, 'inline');
    assert.equal(plan.kind === 'inline' && plan.origin, 'environment');
  });

  it('falls through to the .env when the environment has nothing', () => {
    const plan = resolveCredentialPlan(
      {},
      envFileAt('/w/.env', inline),
      '/w',
      DEFAULT
    );
    assert.equal(plan.kind, 'inline');
    assert.equal(plan.kind === 'inline' && plan.origin, 'env-file');
  });

  it('treats an unexpanded plugin placeholder as "not configured"', () => {
    // The Claude plugin substitutes user_config into env vars; when the user
    // left them blank the literal "${user_config.x}" arrives instead.
    const plan = resolveCredentialPlan(
      {
        GMAIL_CLIENT_ID: '${user_config.client_id}',
        GMAIL_CLIENT_SECRET: '',
        GMAIL_REFRESH_TOKEN: '   ',
      },
      envFileAt('/w/.env', { GMAIL_MCP_CREDENTIALS: '/w/creds.json' }),
      '/w',
      DEFAULT
    );
    assert.deepEqual(plan, {
      kind: 'file',
      origin: 'env-file',
      path: '/w/creds.json',
    });
  });

  it('takes the credential path from the .env, resolved against the .env dir', () => {
    const plan = resolveCredentialPlan(
      {},
      envFileAt('/w/repo/.env', {
        GMAIL_MCP_CREDENTIALS: '.secrets/work.json',
      }),
      '/w/repo/apps/x',
      DEFAULT
    );
    assert.deepEqual(plan, {
      kind: 'file',
      origin: 'env-file',
      path: '/w/repo/.secrets/work.json',
    });
  });

  it('lets $GMAIL_MCP_CREDENTIALS in the environment win over the .env copy', () => {
    const plan = resolveCredentialPlan(
      { GMAIL_MCP_CREDENTIALS: '/from/env.json' },
      envFileAt('/w/.env', { GMAIL_MCP_CREDENTIALS: '/from/file.json' }),
      '/w',
      DEFAULT
    );
    assert.deepEqual(plan, {
      kind: 'file',
      origin: 'environment',
      path: '/from/env.json',
    });
  });

  it('falls back to the global default when nothing is configured', () => {
    assert.deepEqual(resolveCredentialPlan({}, null, '/w', DEFAULT), {
      kind: 'file',
      origin: 'default',
      path: DEFAULT,
    });
  });

  it('ignores a partial inline triple rather than half-using it', () => {
    const plan = resolveCredentialPlan(
      { GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 'secret' },
      null,
      '/w',
      DEFAULT
    );
    assert.equal(plan.kind, 'file');
  });
});
