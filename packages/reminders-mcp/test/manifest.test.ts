// Version lockstep and the one-click bundle. A plugin client only offers an
// update when the version moves, and a Desktop extension only installs when
// its manifest is well formed, so both are checked here rather than trusted.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { inflateRawSync } from 'node:zlib';

import { VERSION } from '../src/server';

const pkgDir = join(__dirname, '..');
const read = (p: string) => JSON.parse(readFileSync(join(pkgDir, p), 'utf8'));

const pkg = read('package.json');
const plugin = read('.claude-plugin/plugin.json');
const mcpb = read('mcpb/manifest.json');
const market = read('../../.claude-plugin/marketplace.json');

describe('version lockstep', () => {
  it('package.json, plugin.json, the mcpb manifest, the server and the catalog agree', () => {
    const entry = market.plugins.find(
      (p: { name: string }) => p.name === 'reminders-mcp',
    );
    assert.ok(entry, 'listed in marketplace.json');
    assert.equal(entry.source, './packages/reminders-mcp');
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
  it('runs the committed bundle with node, on macOS only', () => {
    assert.equal(mcpb.server.type, 'node');
    assert.equal(mcpb.server.entry_point, 'server/mcp.cjs');
    assert.deepEqual(mcpb.server.mcp_config.args, [
      '${__dirname}/server/mcp.cjs',
    ]);
    assert.deepEqual(mcpb.compatibility.platforms, ['darwin']);
    assert.equal(mcpb.name, plugin.name);
  });

  it('lists the same tools the server registers', async () => {
    const { buildServer } = await import('../src/server');
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

describe('build-mcpb', () => {
  it('writes a valid zip holding the manifest and the bundle, byte-identical across builds', async () => {
    const mod = await import(
      join(pkgDir, '..', '..', 'scripts', 'build-mcpb.mjs')
    );
    const dir = mkdtempSync(join(tmpdir(), 'reminders-mcpb-'));
    try {
      const a = readFileSync(mod.build(pkgDir, { outDir: join(dir, 'a') }));
      const b = readFileSync(
        mod.build(pkgDir, { outDir: join(dir, 'b'), stable: true }),
      );
      assert.ok(
        mod
          .build(pkgDir, { outDir: join(dir, 'b'), stable: true })
          .endsWith('/reminders-mcp.mcpb'),
      );
      assert.ok(a.equals(b), 'deterministic');

      // Walk the local file headers.
      const files: Record<string, Buffer> = {};
      let off = 0;
      while (a.readUInt32LE(off) === 0x04034b50) {
        const method = a.readUInt16LE(off + 8);
        const size = a.readUInt32LE(off + 18);
        const nameLen = a.readUInt16LE(off + 26);
        const extra = a.readUInt16LE(off + 28);
        const name = a.subarray(off + 30, off + 30 + nameLen).toString('utf8');
        const body = a.subarray(
          off + 30 + nameLen + extra,
          off + 30 + nameLen + extra + size,
        );
        files[name] = method === 8 ? inflateRawSync(body) : Buffer.from(body);
        off += 30 + nameLen + extra + size;
      }
      assert.deepEqual(Object.keys(files), ['manifest.json', 'server/mcp.cjs']);
      assert.deepEqual(
        JSON.parse(files['manifest.json'].toString('utf8')),
        mcpb,
      );
      assert.ok(
        files['server/mcp.cjs'].equals(
          readFileSync(join(pkgDir, 'server/mcp.cjs')),
        ),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
