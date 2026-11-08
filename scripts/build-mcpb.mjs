#!/usr/bin/env node
// Build a connector's one-click Claude Desktop extension (.mcpb).
//
// An .mcpb is a zip with manifest.json at its root plus the files it names. A
// connector opts in by keeping its manifest at packages/<name>/mcpb/manifest.json;
// the archive holds that manifest and the file its server.entry_point names,
// which for our connectors is the self-contained esbuild bundle
// (server/mcp.cjs, the same file the plugin install runs). Claude Desktop
// runs it with its own built-in Node.js, so the person installing it needs
// nothing else on their computer.
//
// Zero dependencies, and deterministic: fixed timestamps and order, so two
// builds of the same tree are byte-identical. Used by the package's
// `npm run mcpb`, by release.yml (GitHub Release asset) and by pages.yml
// (stable download link).
//
// Usage: node scripts/build-mcpb.mjs <package-dir> [--out DIR] [--stable]
//   --out     where to write it (default <package-dir>/mcpb/dist)
//   --stable  name it <name>.mcpb instead of <name>-<version>.mcpb

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

/** Build a zip archive from [name, Buffer] entries. Store-or-deflate, no extras. */
export function zip(entries) {
  // 1980-01-01 00:00, the zip epoch: keeps builds reproducible.
  const DOS_TIME = 0;
  const DOS_DATE = (0 << 9) | (1 << 5) | 1;
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const crc = crc32(data) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made by: Unix
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(useDeflate ? 8 : 0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // -rw-r--r--
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

export function build(
  root,
  { outDir = join(root, 'mcpb', 'dist'), stable = false } = {},
) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const manifestText = readFileSync(
    join(root, 'mcpb', 'manifest.json'),
    'utf8',
  );
  const manifest = JSON.parse(manifestText);
  if (manifest.version !== pkg.version)
    throw new Error(
      `mcpb/manifest.json says ${manifest.version} but package.json says ${pkg.version}. Bump both.`,
    );
  const entry = manifest.server.entry_point;
  const bundle = readFileSync(join(root, entry));
  const archive = zip([
    ['manifest.json', Buffer.from(manifestText, 'utf8')],
    [entry, bundle],
  ]);
  mkdirSync(outDir, { recursive: true });
  const out = join(
    outDir,
    stable
      ? `${manifest.name}.mcpb`
      : `${manifest.name}-${manifest.version}.mcpb`,
  );
  writeFileSync(out, archive);
  return out;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--out');
  const dir = args.find(
    (a, n) => !a.startsWith('--') && args[n - 1] !== '--out',
  );
  if (!dir) {
    process.stderr.write(
      'usage: build-mcpb.mjs <package-dir> [--out DIR] [--stable]\n',
    );
    process.exit(2);
  }
  const out = build(resolve(dir), {
    ...(i !== -1 ? { outDir: resolve(args[i + 1]) } : {}),
    stable: args.includes('--stable'),
  });
  process.stdout.write(`${out}\n`);
}
