// Validates the finanzas-usa agent pack: the agents, the plugin manifest, and
// the Claude Projects kit built from the same files.
// Zero dependencies: node --test packages/finanzas-usa/test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(PKG, '..', '..');
const AGENTS = join(PKG, 'agents');
const KIT = join(PKG, 'kit');
const NAMES = readdirSync(AGENTS)
  .filter((f) => f.endsWith('.md'))
  .map((f) => f.replace(/\.md$/, ''));

const plugin = JSON.parse(
  readFileSync(join(PKG, '.claude-plugin', 'plugin.json'), 'utf8'),
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

// This repo is public, and these agents handle people's money. Nothing
// personal or secret belongs in a file thousands of strangers will install.
const FORBIDDEN = [
  [/\/Users\/|\/home\/[a-z]|C:\\Users/, 'absolute user path'],
  [
    /(\+\d{1,3}[\s-]?)?\(?\d{3}\)?[\s-]\d{3}[\s-]\d{4}|\+\d{8,}/,
    'phone number',
  ],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/, 'email address'],
  [/\b\d{3}-\d{2}-\d{4}\b/, 'something shaped like an SSN'],
  [
    /(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_|AKIA[A-Z0-9]{12,}|xox[abp]-)/,
    'possible secret',
  ],
];

test('the pack carries the two agents', () => {
  assert.deepEqual(NAMES.sort(), ['indexandro', 'tributina']);
});

test('plugin.json and marketplace.json agree (versions move in lockstep)', () => {
  const market = JSON.parse(
    readFileSync(join(REPO, '.claude-plugin', 'marketplace.json'), 'utf8'),
  );
  const entry = market.plugins.find((p) => p.name === plugin.name);
  assert.ok(entry, `${plugin.name} is not listed in marketplace.json`);
  assert.equal(entry.source, './packages/finanzas-usa');
  assert.equal(entry.version, plugin.version);
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  assert.equal(plugin.license, 'MIT');
});

for (const name of NAMES) {
  const text = readFileSync(join(AGENTS, `${name}.md`), 'utf8');

  test(`${name}: frontmatter names the file, routes, and stays in scope`, () => {
    const fm = frontmatter(text);
    assert.equal(fm.name, name);
    assert.match(fm.name, /^[a-z0-9-]{1,64}$/);
    assert.ok(fm.description && fm.description.length > 200);
    assert.ok(fm.tools, 'tools must be declared, never inherited');
    // Advisors read statements and write notes. Running commands is not part
    // of the job, and its absence is a safety limit.
    assert.ok(!/\bBash\b/.test(fm.tools), 'an advisor does not need Bash');
    assert.ok(fm.model);
  });

  test(`${name}: the first body line is the version, equal to plugin.json`, () => {
    const body = text.replace(/^---\n[\s\S]*?\n---\n\n?/, '');
    assert.equal(body.split('\n')[0], `<!-- versión: ${plugin.version} -->`);
  });

  test(`${name}: kit/instrucciones/${name}.md is the agent body, rebuilt`, () => {
    const out = mkdtempSync(join(tmpdir(), 'finanzas-usa-kit-'));
    try {
      execFileSync('bash', [join(PKG, 'scripts', 'build-kit.sh'), out], {
        stdio: 'pipe',
      });
      const fresh = readFileSync(
        join(out, 'instrucciones', `${name}.md`),
        'utf8',
      );
      const committed = readFileSync(
        join(KIT, 'instrucciones', `${name}.md`),
        'utf8',
      );
      assert.equal(
        committed,
        fresh,
        'kit is stale: run bash packages/finanzas-usa/scripts/build-kit.sh and commit',
      );
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
}

test('the doctrine that must survive any rewrite is still there', () => {
  const idx = readFileSync(join(AGENTS, 'indexandro.md'), 'utf8');
  const tri = readFileSync(join(AGENTS, 'tributina.md'), 'utf8');
  for (const [re, what] of [
    [/Nunca ejecutas órdenes/, 'never places orders'],
    [/contra el IPS/, 'everything against the IPS'],
    [/3% a 4%/, 'reference withdrawal rate'],
    [/no se repone desde el núcleo/, 'capped learning sleeve'],
    [/incluidas las IRA/, 'wash sale across every account'],
    [/fee-only fiduciary/, 'recommends a fee-only fiduciary'],
    [/resumen-vigente\.md/, 'phone fallback'],
  ])
    assert.match(idx, re, `indexandro lost: ${what}`);
  for (const [re, what] of [
    [/No eres CPA/, 'not a CPA, never files'],
    [/con el año/, 'cites the IRS with the year'],
    [/personal holding company/, 'PHC risk'],
    [/accumulated earnings tax/, 'AET risk'],
    [/incluidas las IRA/, 'wash sale across every account'],
    [/no se mezcla con la personal/, 'no commingling'],
    [/resumen-vigente\.md/, 'phone fallback'],
  ])
    assert.match(tri, re, `tributina lost: ${what}`);
  const points = tri
    .split('## Los 11 puntos')[1]
    .split('\n## ')[0]
    .match(/^\d+\. \*\*/gm);
  assert.equal(points?.length, 11, 'the eleven tax points');
});

test('the dashboard template carries every placeholder the agent fills', () => {
  const html = readFileSync(join(KIT, 'plantillas', 'como-vamos.html'), 'utf8');
  for (const p of [
    'FECHA',
    'FRASE_HONESTA',
    'VALOR_TOTAL',
    'RETIRADO_ANO',
    'ESTADO_PLAN',
    'CUENTA',
    'PARTE',
    'CUPO_USADO',
    'CUPO_TOPE',
    'DECISION',
  ])
    assert.ok(html.includes(`{{${p}}}`), `missing {{${p}}}`);
});

test('no personal data, no secrets, no em dashes', () => {
  for (const f of walk(PKG)) {
    if (f.endsWith('.test.mjs')) continue;
    const text = readFileSync(f, 'utf8');
    const rel = relative(PKG, f);
    for (const [re, what] of FORBIDDEN)
      assert.doesNotMatch(text, re, `${rel}: contains ${what}`);
    assert.ok(!text.includes('\u2014'), `${rel}: contains an em dash`);
  }
});
