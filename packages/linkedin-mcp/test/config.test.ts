// Where the credential comes from, which Page it acts as, and the token
// lifecycle. Every path here decides WHICH Page speaks, or whether a stale
// credential fails cleanly — so they get tests, and no message may carry a
// secret.

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

import { fakeLinkedIn, isolate, tempDir } from './helpers';
import { homedir } from 'node:os';
import { DEFAULT_LOG_DIR } from '../src/core';
import {
  DEFAULT_CACHE_DIR,
  DEFAULT_CREDENTIALS_PATH,
  getAccessToken,
  loadConfig,
  LinkedInAccessError,
  resetConfigCache,
  toOrganizationUrn,
} from '../src/config';

const files = tempDir();
after(files.cleanup);

let cleanup = () => {};
beforeEach(() => {
  cleanup();
  cleanup = isolate();
  resetConfigCache();
});
after(() => cleanup());

const now = () => Math.floor(Date.now() / 1000);

function writeCreds(obj: Record<string, unknown>): string {
  const p = join(
    files.dir,
    `creds-${Math.random().toString(36).slice(2)}.json`,
  );
  writeFileSync(p, JSON.stringify(obj));
  return p;
}

describe('where local files live', () => {
  it('keeps everything under one pappcorn parent, one folder per connector', () => {
    const home = homedir();
    assert.equal(
      DEFAULT_CREDENTIALS_PATH,
      join(home, '.config/pappcorn/linkedin-mcp/credentials.json'),
    );
    assert.equal(DEFAULT_CACHE_DIR, join(home, '.cache/pappcorn/linkedin-mcp'));
    assert.equal(
      DEFAULT_LOG_DIR,
      join(home, '.local/state/pappcorn/linkedin-mcp'),
    );
  });
});

describe('credential resolution', () => {
  it('uses the environment first and labels the source without a value', () => {
    const cfg = loadConfig();
    assert.equal(cfg.source, 'environment');
    assert.equal(cfg.organization, 'urn:li:organization:1234567');
    assert.equal(cfg.apiVersion, '202610');
  });

  it('treats unexpanded plugin placeholders as unset and falls to the file', () => {
    process.env.LINKEDIN_ACCESS_TOKEN = '${user_config.access_token}';
    process.env.LINKEDIN_ORGANIZATION_ID = '${user_config.organization_id}';
    process.env.LINKEDIN_MCP_CREDENTIALS = writeCreds({
      access_token: 'file-token',
      organization: 'urn:li:organization:42',
    });
    const cfg = loadConfig();
    assert.match(cfg.source, /^credential file /);
    assert.equal(cfg.organization, 'urn:li:organization:42');
  });

  it('lets LINKEDIN_ORGANIZATION_ID override the Page the file recorded', () => {
    delete process.env.LINKEDIN_ACCESS_TOKEN;
    process.env.LINKEDIN_ORGANIZATION_ID = '99';
    process.env.LINKEDIN_MCP_CREDENTIALS = writeCreds({
      access_token: 'file-token',
      organization: 'urn:li:organization:42',
    });
    assert.equal(loadConfig().organization, 'urn:li:organization:99');
  });

  it('says plainly when there is no credential, and how to fix it', () => {
    delete process.env.LINKEDIN_ACCESS_TOKEN;
    assert.throws(loadConfig, (e: Error) => {
      assert.ok(e instanceof LinkedInAccessError);
      assert.match(e.message, /pappcorn-linkedin-setup/);
      return true;
    });
  });

  it('refuses to guess a Page', () => {
    delete process.env.LINKEDIN_ORGANIZATION_ID;
    assert.throws(loadConfig, /No LinkedIn Page configured/);
  });

  it('accepts a numeric id or an organization URN, nothing else', () => {
    assert.equal(toOrganizationUrn('123'), 'urn:li:organization:123');
    assert.equal(
      toOrganizationUrn('urn:li:organization:123'),
      'urn:li:organization:123',
    );
    assert.throws(() => toOrganizationUrn('urn:li:person:abc'));
    assert.throws(() => toOrganizationUrn('acme'));
  });
});

describe('access token lifecycle', () => {
  it('uses a stored token while it is valid', async () => {
    delete process.env.LINKEDIN_ACCESS_TOKEN;
    process.env.LINKEDIN_MCP_CREDENTIALS = writeCreds({
      access_token: 'still-good',
      access_token_expires_at: now() + 86400,
      organization: 'urn:li:organization:1',
    });
    assert.equal(await getAccessToken(), 'still-good');
  });

  it('fails cleanly when the token expired and there is nothing to renew it with', async () => {
    delete process.env.LINKEDIN_ACCESS_TOKEN;
    process.env.LINKEDIN_MCP_CREDENTIALS = writeCreds({
      access_token: 'stale-secret-value',
      access_token_expires_at: now() - 10,
      organization: 'urn:li:organization:1',
    });
    await assert.rejects(getAccessToken(), (e: Error) => {
      assert.match(e.message, /expired on \d{4}-\d{2}-\d{2}/);
      assert.match(e.message, /setup script again/);
      assert.doesNotMatch(e.message, /stale-secret-value/);
      return true;
    });
  });

  it('renews with the refresh token, caches the result, and reuses the cache', async () => {
    delete process.env.LINKEDIN_ACCESS_TOKEN;
    process.env.LINKEDIN_MCP_CREDENTIALS = writeCreds({
      client_id: 'cid',
      client_secret: 'csecret-value',
      access_token: 'stale',
      access_token_expires_at: now() - 10,
      refresh_token: 'rtoken-value',
      refresh_token_expires_at: now() + 86400 * 300,
      organization: 'urn:li:organization:1',
    });
    const li = fakeLinkedIn((c) =>
      c.url === 'https://www.linkedin.com/oauth/v2/accessToken'
        ? { json: { access_token: 'renewed', expires_in: 5184000 } }
        : undefined,
    );
    try {
      assert.equal(await getAccessToken(), 'renewed');
      assert.deepEqual(li.calls[0].body, {
        grant_type: 'refresh_token',
        refresh_token: 'rtoken-value',
        client_id: 'cid',
        client_secret: 'csecret-value',
      });
      assert.equal(await getAccessToken(), 'renewed');
      assert.equal(
        li.calls.length,
        1,
        'the second call is served from the cache',
      );
    } finally {
      li.restore();
    }
  });

  it('does not echo the refresh request when LinkedIn refuses it', async () => {
    delete process.env.LINKEDIN_ACCESS_TOKEN;
    process.env.LINKEDIN_MCP_CREDENTIALS = writeCreds({
      client_id: 'cid',
      client_secret: 'csecret-value',
      refresh_token: 'rtoken-value',
      organization: 'urn:li:organization:1',
    });
    const li = fakeLinkedIn(() => ({
      status: 400,
      json: {
        error: 'invalid_request',
        error_description: 'refresh token is invalid, expired or revoked',
      },
    }));
    try {
      await assert.rejects(getAccessToken(), (e: Error) => {
        assert.match(e.message, /invalid_request/);
        assert.doesNotMatch(e.message, /rtoken-value|csecret-value/);
        return true;
      });
    } finally {
      li.restore();
    }
  });

  it('refuses to use a refresh token past its one-year life', async () => {
    delete process.env.LINKEDIN_ACCESS_TOKEN;
    process.env.LINKEDIN_MCP_CREDENTIALS = writeCreds({
      client_id: 'cid',
      client_secret: 's',
      refresh_token: 'r',
      refresh_token_expires_at: now() - 1,
      organization: 'urn:li:organization:1',
    });
    await assert.rejects(getAccessToken(), /refresh token expired/);
  });
});
