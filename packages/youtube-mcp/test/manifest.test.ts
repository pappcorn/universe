// Version lockstep and the Desktop extension manifest. A plugin client only
// offers an update when the version moves, and a Desktop extension only
// installs when its manifest is well formed, so both are checked here rather
// than trusted. The archive itself is built and checked by the shared
// scripts/build-mcpb.mjs and its tests.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { buildServer, VERSION } from '../src/server';

const pkgDir = join(__dirname, '..');
const read = (p: string) => JSON.parse(readFileSync(join(pkgDir, p), 'utf8'));

const pkg = read('package.json');
const plugin = read('.claude-plugin/plugin.json');
const mcpb = read('mcpb/manifest.json');
const market = read('../../.claude-plugin/marketplace.json');

describe('version lockstep', () => {
  it('package.json, plugin.json, the mcpb manifest, the server and the catalog agree', () => {
    const entry = market.plugins.find(
      (p: { name: string }) => p.name === 'youtube-mcp',
    );
    assert.ok(entry, 'listed in marketplace.json');
    assert.equal(entry.source, './packages/youtube-mcp');
    for (const [where, v] of [
      ['plugin.json', plugin.version],
      ['mcpb/manifest.json', mcpb.version],
      ['src/server.ts', VERSION],
      ['marketplace.json', entry.version],
    ])
      assert.equal(v, pkg.version, `${where} matches package.json`);
  });
});

describe('the .mcpb manifest', () => {
  it('runs the committed bundle with node, on every platform', () => {
    assert.equal(mcpb.server.type, 'node');
    assert.equal(mcpb.server.entry_point, 'server/mcp.cjs');
    assert.deepEqual(mcpb.server.mcp_config.args, [
      '${__dirname}/server/mcp.cjs',
    ]);
    assert.deepEqual([...mcpb.compatibility.platforms].sort(), [
      'darwin',
      'linux',
      'win32',
    ]);
    assert.equal(mcpb.name, plugin.name);
  });

  it('passes the same setting the plugin does', () => {
    assert.equal(
      mcpb.server.mcp_config.env.YOUTUBE_MCP_LANGUAGE,
      '${user_config.default_language}',
    );
    assert.ok(mcpb.user_config.default_language);
    assert.ok(plugin.userConfig.default_language);
  });

  it('lists the same tools the server registers', () => {
    const registered = Object.keys(
      (buildServer() as unknown as { _registeredTools: object })
        ._registeredTools,
    ).sort();
    assert.deepEqual(
      mcpb.tools.map((t: { name: string }) => t.name).sort(),
      registered,
    );
  });
});
