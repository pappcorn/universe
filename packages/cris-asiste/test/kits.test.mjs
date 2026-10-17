// Validates the cris-asiste skill pack: the skills themselves, the plugin
// manifest, and the uploadable zips built from the same folders.
// Zero dependencies: node --test packages/cris-asiste/test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(PKG, '..', '..');
const SKILLS = join(PKG, 'skills');
const KITS = readdirSync(SKILLS).filter(
  (n) =>
    statSync(join(SKILLS, n)).isDirectory() &&
    existsSync(join(SKILLS, n, 'SKILL.md')),
);

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'dist' || e.name === '.DS_Store') return [];
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });

const frontmatter = (text) => {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, 'missing frontmatter');
  const out = {};
  let key = null;
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-z-]+):\s*(.*)$/);
    if (kv) {
      key = kv[1];
      out[key] = kv[2].replace(/^>-?$/, '').trim();
    } else if (key) out[key] = `${out[key]} ${line.trim()}`.trim();
  }
  return out;
};

// This repo is public. Nothing personal or secret belongs in a skill that
// thousands of strangers will install.
const FORBIDDEN = [
  [/\/Users\/|\/home\/[a-z]|C:\\Users/, 'absolute user path'],
  [
    /(\+\d{1,3}[\s-]?)?\(?\d{3}\)?[\s-]\d{3}[\s-]\d{4}|\+\d{8,}/,
    'phone number',
  ],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/, 'email address'],
  [
    /(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_|AKIA[A-Z0-9]{12,}|xox[abp]-)/,
    'possible secret',
  ],
];

test('the pack carries the three skills', () => {
  for (const k of ['crear-agente', 'crear-skill', 'crear-asistente'])
    assert.ok(KITS.includes(k), `missing ${k}`);
});

test('plugin.json and marketplace.json agree (versions move in lockstep)', () => {
  const plugin = JSON.parse(
    readFileSync(join(PKG, '.claude-plugin', 'plugin.json'), 'utf8'),
  );
  const market = JSON.parse(
    readFileSync(join(REPO, '.claude-plugin', 'marketplace.json'), 'utf8'),
  );
  const entry = market.plugins.find((p) => p.name === plugin.name);
  assert.ok(entry, `${plugin.name} is not listed in marketplace.json`);
  assert.equal(entry.source, './packages/cris-asiste');
  assert.equal(entry.version, plugin.version);
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  assert.equal(plugin.license, 'MIT');
});

for (const kit of KITS) {
  const dir = join(SKILLS, kit);

  test(`${kit}: SKILL.md name matches the folder, description routes`, () => {
    const fm = frontmatter(readFileSync(join(dir, 'SKILL.md'), 'utf8'));
    assert.equal(fm.name, kit);
    assert.match(fm.name, /^[a-z0-9-]{1,64}$/);
    assert.ok(
      fm.description && fm.description.length > 80,
      'description empty or too short',
    );
    assert.ok(
      fm.description.length <= 1024,
      `description is ${fm.description.length} chars (max 1024)`,
    );
    assert.deepEqual(Object.keys(fm).sort(), ['description', 'name']);
  });

  test(`${kit}: ships a GUIA.md for people`, () => {
    assert.ok(existsSync(join(dir, 'GUIA.md')), 'missing GUIA.md');
  });

  test(`${kit}: every file SKILL.md mentions exists, every file is mentioned`, () => {
    const text = readFileSync(join(dir, 'SKILL.md'), 'utf8');
    const refs = [
      ...text.matchAll(/`((?:references|assets|scripts)\/[^`\s]+?)`/g),
    ].map((m) => m[1]);
    for (const r of refs)
      assert.ok(existsSync(join(dir, r)), `SKILL.md mentions ${r}, missing`);
    for (const d of ['references', 'assets']) {
      if (!existsSync(join(dir, d))) continue;
      for (const f of readdirSync(join(dir, d), { withFileTypes: true }).filter(
        (e) => e.isFile(),
      ))
        assert.ok(
          text.includes(`${d}/${f.name}`),
          `${d}/${f.name} is never mentioned in SKILL.md`,
        );
    }
  });

  test(`${kit}: no personal data, no secrets, no em dashes`, () => {
    for (const f of walk(dir)) {
      const text = readFileSync(f, 'utf8');
      const rel = relative(PKG, f);
      for (const [re, what] of FORBIDDEN)
        assert.doesNotMatch(text, re, `${rel}: contains ${what}`);
      assert.ok(!text.includes('\u2014'), `${rel}: contains an em dash`);
    }
  });
}

test('build-kits.sh: one zip per skill, folder at the root, only what Claude reads', () => {
  const out = mkdtempSync(join(tmpdir(), 'cris-asiste-kits-'));
  try {
    execFileSync('bash', [join(PKG, 'scripts', 'build-kits.sh'), out], {
      stdio: 'pipe',
    });
    for (const kit of KITS) {
      const zip = join(out, `${kit}.zip`);
      assert.ok(existsSync(zip), `${kit}.zip was not built`);
      const names = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' })
        .split('\n')
        .filter(Boolean);
      assert.ok(
        names.includes(`${kit}/SKILL.md`),
        'SKILL.md not at the root folder',
      );
      assert.ok(
        names.every((n) => n.startsWith(`${kit}/`)),
        'files outside the root folder',
      );
      assert.ok(!names.includes(`${kit}/GUIA.md`), 'GUIA.md must stay out');
      assert.deepEqual(
        names.filter((n) => n.endsWith('/SKILL.md')),
        [`${kit}/SKILL.md`],
        'a second SKILL.md inside the zip would confuse the upload',
      );
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('crear-asistente.sh: builds a complete folder and refuses to overwrite', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'asistente-'));
  const dest = join(tmp, 'mi-asistente');
  const script = join(
    SKILLS,
    'crear-asistente',
    'scripts',
    'crear-asistente.sh',
  );
  try {
    execFileSync('bash', [script, dest, 'Luna'], { stdio: 'pipe' });
    for (const f of [
      'CLAUDE.md',
      'profile.json',
      '.claude/settings.json',
      '.claude/agents/foco.md',
      '.claude/agents/escritor.md',
      '.claude/skills/configurar/SKILL.md',
      '.claude/skills/bobeda/SKILL.md',
      'vault/README.md',
      'vault/0. Inbox',
      'vault/4. Archives',
    ])
      assert.ok(existsSync(join(dest, f)), `missing ${f}`);
    const profile = JSON.parse(
      readFileSync(join(dest, 'profile.json'), 'utf8'),
    );
    assert.equal(profile.assistant_name, 'Luna');
    assert.equal(profile.configured, false);
    JSON.parse(readFileSync(join(dest, '.claude/settings.json'), 'utf8'));
    for (const a of ['foco', 'escritor']) {
      const fm = frontmatter(
        readFileSync(join(dest, `.claude/agents/${a}.md`), 'utf8'),
      );
      assert.equal(fm.name, a);
      assert.ok(fm.description.length > 80);
    }
    for (const s of ['configurar', 'bobeda'])
      assert.equal(
        frontmatter(
          readFileSync(join(dest, `.claude/skills/${s}/SKILL.md`), 'utf8'),
        ).name,
        s,
      );
    assert.throws(
      () => execFileSync('bash', [script, dest], { stdio: 'pipe' }),
      'must refuse to write into a folder that already has content',
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
