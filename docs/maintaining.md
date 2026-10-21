# Maintaining the catalog

How each product in the `pappcorn-plugins` marketplace is built, versioned,
released, verified and reviewed. This is the maintainer's side of
[CONTRIBUTING.md](../CONTRIBUTING.md): contributors need that file, maintainers
need both.

If you only remember one thing: **for plugin users, merging to `main` is the
release.** A plugin install runs what is committed on `main`, so every rule
below exists to keep what is committed equal to what we think we shipped.

---

## The catalog at a glance

| Product              | Kind                   | Source                                                          | Plugin install runs        | npm                                                    |
| -------------------- | ---------------------- | --------------------------------------------------------------- | -------------------------- | ------------------------------------------------------ |
| `gmail-mcp`          | Connector (MCP server) | [`packages/gmail-mcp`](../packages/gmail-mcp)                   | committed `server/mcp.cjs` | [`@pappcorn/gmail-mcp`][npm-gmail], built at tag       |
| `gsheets-mcp`        | Connector (MCP server) | [`packages/gsheets-mcp`](../packages/gsheets-mcp)               | committed `server/mcp.cjs` | [`@pappcorn/gsheets-mcp`][npm-gsheets], built at tag   |
| `whatsapp-mcp`       | Connector (MCP server) | [`packages/whatsapp-mcp`](../packages/whatsapp-mcp)             | committed `server/mcp.cjs` | [`@pappcorn/whatsapp-mcp`][npm-whatsapp], built at tag |
| `best-practices-git` | Skill pack             | [`packages/best-practices-git`](../packages/best-practices-git) | the skills, as committed   | not published                                          |
| `cris-asiste`        | Skill pack             | [`packages/cris-asiste`](../packages/cris-asiste)               | the skills, as committed   | not published                                          |
| `finanzas-usa`       | Agent pack             | [`packages/finanzas-usa`](../packages/finanzas-usa)             | the agents, as committed   | not published                                          |
| `product-team`       | Licensed plugin        | a private repository                                            | that repository            | not published                                          |

[npm-gmail]: https://www.npmjs.com/package/@pappcorn/gmail-mcp
[npm-gsheets]: https://www.npmjs.com/package/@pappcorn/gsheets-mcp
[npm-whatsapp]: https://www.npmjs.com/package/@pappcorn/whatsapp-mcp

Every product is listed in
[`.claude-plugin/marketplace.json`](../.claude-plugin/marketplace.json). Its
`version` line there is what a Claude client compares to decide whether an
installed plugin has an update.

---

## Rules that apply to every product

### Two delivery channels

The connectors reach people two ways, and the two are built differently:

- **Plugin install** (`/plugin install <name>@pappcorn-plugins`). The client
  fetches the repository and the connector's `.mcp.json` launches
  `node ${CLAUDE_PLUGIN_ROOT}/server/mcp.cjs`. That file is a self-contained
  esbuild bundle **committed to this repo**: no install step, no dependencies
  resolved on the user's machine. Whatever version of zod or the MCP SDK is
  inside the committed bundle is what plugin users run.
- **npm** (`npx @pappcorn/<name>`). The package's `bin` entries point at
  `dist/`, which `release.yml` builds from a clean checkout of the tagged commit.
  Dependencies resolve at install time.

So a dependency bump that updates the lockfile reaches npm users at the next
release, but reaches plugin users **only** when someone rebuilds the bundle and
commits it. That gap is the most expensive mistake in this repo's history (see
[Failure modes](#failure-modes-weve-already-hit)).

Skill packs have one channel: the plugin install reads their `skills/` folders
directly. Nothing is built.

### Version lockstep

A user-visible change to a product bumps its version everywhere it is declared,
in the same PR:

| Where                                        | Connectors | Skill packs | `product-team` |
| -------------------------------------------- | :--------: | :---------: | :------------: |
| `packages/<name>/package.json`               |    yes     |   (none)    |   (not here)   |
| `packages/<name>/.claude-plugin/plugin.json` |    yes     |     yes     |   (not here)   |
| its own `version` line in `marketplace.json` |    yes     |     yes     |  yes, by hand  |
| its workspace entry in `package-lock.json`   |    yes     |   (none)    |   (not here)   |
| `packages/<name>/CHANGELOG.md`               |    yes     | if present  |   (not here)   |

Notes:

- **Without the bump, plugin users never see the change.** The client only
  offers an update when the version moves. A merged fix with an unchanged
  version is invisible to everyone who already installed.
- Bump the lockfile entry by editing its `version` field, not by regenerating
  the lockfile. A regenerated lockfile drags in unrelated churn that depends on
  the npm version used to write it.
- Only `gmail-mcp` has a `CHANGELOG.md` today. When you cut the next release of
  `gsheets-mcp` or `whatsapp-mcp`, start one in the same format.
- Touch only your product's own line in `marketplace.json`. Other open PRs edit
  neighboring lines; a reformat of the whole file conflicts with all of them.
- Patch for fixes and dependency rebuilds, minor for new tools or new
  behavior. These are all `0.x`, so a minor may change behavior; say so in the
  CHANGELOG.

### The bundle rebuild rule

Any change that can alter a connector's bundle must commit the rebuilt bundle
in the same PR. That means a change under `packages/<name>/src/`, or a change to
a **runtime** dependency (anything in the connector's `dependencies`, today zod
and `@modelcontextprotocol/sdk`, and anything they pull in).

```bash
npm ci --legacy-peer-deps
npx nx run-many -t build      # runs tsc and the esbuild bundle for every connector
git status -- 'packages/*/server/mcp.cjs'
```

Commit whatever bundle changed, and bump that connector's patch version (see
above). The build is deterministic: two clean builds of the same tree are
byte-identical, so any diff you see is real.

Use `npm ci`, not `npm install`. `npm ci` installs exactly what the lockfile
says and never rewrites it. `npm ci` also marks bin scripts executable in your
working tree (for example `packages/gmail-mcp/scripts/mint-token.mjs`); don't
commit that mode change by accident.

The bundles are excluded from Prettier on purpose (see `.prettierignore`):
they must stay byte-for-byte what esbuild emits.

### The drift gate

CI enforces the rule above (added in #86). After the affected build, the `CI`
workflow rebuilds every connector bundle (`npx nx run-many -t bundle`),
whether or not `affected` selected that connector, and fails if any
`packages/*/server/mcp.cjs` differs from the committed one. It also fails if a
package's `.mcp.json` launches `server/mcp.cjs` and that file is not committed,
which is how a new connector would otherwise slip through:

> The committed plugin bundle (packages/&lt;name&gt;/server/mcp.cjs) is out of
> date. …

When it fails, run the three commands in
[the bundle rebuild rule](#the-bundle-rebuild-rule), commit the bundle, bump the
patch version, push. The gate only compares bundles, so lockfile or npm-version
differences cannot trip it.

### Cutting a release

**Connectors** (anything with a `package.json` under `packages/`):

1. Land the version bump on `main` through a PR: all lockstep points, the
   rebuilt bundle, the CHANGELOG entry. **This merge already releases the
   plugin**: plugin users get it on their next marketplace update.
2. Tag the merge commit and push the tag. The tag format is
   `<package-dir>@<version>`:

   ```bash
   git fetch origin && git checkout origin/main
   git tag gsheets-mcp@0.1.2
   git push origin gsheets-mcp@0.1.2
   ```

3. [`release.yml`](../.github/workflows/release.yml) takes it from there. It
   refuses to publish if the tag's version disagrees with `package.json`, or if
   the tagged commit is not on `main`. It runs `npm ci`, builds and tests the
   whole workspace, then `npm publish --provenance`. It needs either the
   `NPM_TOKEN` repository secret or npm trusted publishing configured for this
   repo.
4. Check the result: `npm view @pappcorn/<name> version` shows the new version,
   and the npm page shows the provenance badge. The registry can take a minute
   or two to list a fresh version, so a stale answer right after a green run is
   not a failed publish. Ask for the exact version instead:
   `curl -s -o /dev/null -w '%{http_code}' https://registry.npmjs.org/@pappcorn%2f<name>/<version>`
   returns `200` once it is live.

Tag the same commit that carries the bump, so npm and the plugin ship the same
code under the same number. Never retag a published version; bump and release
again instead.

**Skill packs** have no `package.json`, so `release.yml` does not apply and
there is no tag. Step 1 is the whole release.

**`product-team`** releases from its own repository. See its section below.

### Review

[`CODEOWNERS`](../.github/CODEOWNERS) makes **@ni500**, **@lcaloguerea** and
**@cris-pappcorn** the owners of every path, with both humans named explicitly
on the two connectors that hold the most sensitive credentials (`gmail-mcp`,
`whatsapp-mcp`). `main` requires a code-owner approval. Who may approve which
PR, and where the agent maintainer may and may not sign, is spelled out in
[CONTRIBUTING → Who can approve](../CONTRIBUTING.md#who-can-approve). Two files
are humans-only: `.github/workflows/cris-approve.yml` and `.github/CODEOWNERS`.

Every PR opens with an assignee and a named human reviewer, even though
CODEOWNERS would request one anyway.

---

## Per product

### gmail-mcp

- **Source:** `packages/gmail-mcp/src` (TypeScript). Setup script:
  `scripts/mint-token.mjs` (bin `pappcorn-gmail-setup`). Tests:
  `packages/gmail-mcp/test`.
- **Ships:** plugin runs the committed `server/mcp.cjs`; npm ships `dist/`,
  `server/`, `scripts/`, README and CHANGELOG. npm bins: `gmail-mcp`,
  `pappcorn-gmail-mcp` (server), `pappcorn-gmail` (CLI), `pappcorn-gmail-setup`.
- **Version lockstep:** `package.json`, `.claude-plugin/plugin.json`, its
  `marketplace.json` line, its `package-lock.json` entry, `CHANGELOG.md`.
- **Release tag:** `gmail-mcp@<version>`.
- **Setup guides:** [setup-google-cloud.md](setup-google-cloud.md) (text) and
  [how-to-gmail.md](how-to-gmail.md) (screenshots), plus
  [install.md](install.md). Update them when the setup script's flags or output
  change, when the plugin's `userConfig` prompts change, when the required
  scopes change, or when Google moves a console screen. Screenshots go stale
  first; recheck them whenever the text changes.
- **Verify end to end:**
  1. From a clone: `npm run gmail -w @pappcorn/gmail-mcp -- whoami` against
     your own account.
  2. From npm, in an empty directory:
     `npx -y -p @pappcorn/gmail-mcp@<version> pappcorn-gmail-setup --help`
     must print usage (this is the #79 regression), and
     `npx -y -p @pappcorn/gmail-mcp@<version> pappcorn-gmail whoami` must name
     your mailbox.
  3. As a plugin: update the marketplace, update or install the plugin, start a
     new session, check `/mcp` shows the server connected, and ask for
     `mail_whoami`.
- **Specific risk:** it can send email. `mail_send` must keep saying, in its
  description, that it confirms first. It never deletes; it labels and
  archives.

### gsheets-mcp

- **Source:** `packages/gsheets-mcp/src`. Setup script:
  `scripts/mint-token.mjs` (bin `pappcorn-gsheets-setup`). Tests:
  `packages/gsheets-mcp/test`. There is no CLI.
- **Ships:** plugin runs the committed `server/mcp.cjs`; npm ships `dist/`,
  `server/`, `scripts/` and README. npm bins: `gsheets-mcp`,
  `pappcorn-gsheets-mcp` (server), `pappcorn-gsheets-setup`.
- **Version lockstep:** `package.json`, `.claude-plugin/plugin.json`, its
  `marketplace.json` line, its `package-lock.json` entry. No CHANGELOG yet;
  start one at the next release.
- **Release tag:** `gsheets-mcp@<version>`.
- **Setup guide:** [setup-google-sheets.md](setup-google-sheets.md); the
  package [README → Setup](../packages/gsheets-mcp/README.md#setup) stays the
  canonical reference for the tool list. Update the guide when the setup script, the scopes, the
  `userConfig` prompts or the Google console change. The most common setup
  failure is a missing Drive API enablement (`sheet_locate` and
  `sheet_import_xlsx` need it); keep that called out.
- **Verify end to end:**
  1. From npm, in an empty directory:
     `npx -y -p @pappcorn/gsheets-mcp@<version> pappcorn-gsheets-setup --help`.
  2. As a plugin: update, start a new session, `/mcp` shows it connected, ask
     for `sheet_whoami`, then `sheet_info` on a sheet shared with you. Every
     write tool previews first; check a preview, and only confirm on a scratch
     sheet.
- **Specific risk:** it writes to other people's files. Every write must keep
  its preview-then-confirm flow.

### whatsapp-mcp

- **Source:** `packages/whatsapp-mcp/src`. No setup script: credentials come
  from Meta's developer console. No tests yet.
- **Ships:** plugin runs the committed `server/mcp.cjs`; npm ships `dist/`,
  `server/` and README. npm bins: `whatsapp-mcp`, `pappcorn-whatsapp-mcp`
  (server), `pappcorn-whatsapp` (CLI).
- **Version lockstep:** `package.json`, `.claude-plugin/plugin.json`, its
  `marketplace.json` line, its `package-lock.json` entry. No CHANGELOG yet;
  start one at the next release.
- **Release tag:** `whatsapp-mcp@<version>`.
- **Setup guide:** [setup-meta-whatsapp.md](setup-meta-whatsapp.md), plus
  [install.md](install.md). Update it when the `userConfig` prompts change, when
  the Graph API version the connector targets changes, or when Meta moves a
  console screen. Meta's console changes often; recheck the guide at least
  every quarter even without code changes.
- **Verify end to end:**
  1. From a clone: `npm run whatsapp -w @pappcorn/whatsapp-mcp -- whoami`.
  2. From npm: `npx -y -p @pappcorn/whatsapp-mcp@<version> pappcorn-whatsapp whoami`
     shows your number, its verified name and quality rating.
  3. As a plugin: update, new session, `/mcp` connected, ask for
     `whatsapp_whoami`. Only test a send against a number you own.
- **Specific risk:** a send reaches a real person and can cost money. Send
  tools must keep saying they confirm first.

### best-practices-git

- **Source:** `packages/best-practices-git/skills/` (`commit`, `git-pr`,
  `worktree`), plus the helper `scripts/worktree.mjs`.
- **Ships:** skills only. The plugin reads the folders as committed; nothing is
  built, nothing goes to npm, and there is no release tag.
- **Version lockstep:** `.claude-plugin/plugin.json` and its
  `marketplace.json` line.
- **Release:** merge the bump to `main`.
- **Guide:** its [README](../packages/best-practices-git/README.md). Update it
  when a skill is added, renamed, or changes what it refuses to do.
- **Verify end to end:** install the plugin, open a new session in a throwaway
  repository, and run `/best-practices-git:commit` on a small change and
  `/best-practices-git:worktree` to create a branch. Check `/git-pr` refuses to
  push to a protected branch. It drives the `git` and `gh` already on the
  machine; there are no credentials to configure.

### cris-asiste

- **Source:** `packages/cris-asiste/skills/` (`crear-agente`, `crear-skill`,
  `crear-asistente`), written in Spanish for a LATAM audience. Each skill
  folder carries a `SKILL.md` for Claude and a `GUIA.md` for people.
- **Ships:** two packagings from one source. The plugin installs straight from
  `skills/`. For chat users, where plugins do not run, `scripts/build-kits.sh`
  zips each skill (without its `GUIA.md`); the Pages workflow builds the zips
  on every merge to `main` and serves them under
  `https://pappcorn.github.io/universe/kits/`. The zips are never committed.
  Nothing goes to npm, and there is no release tag.
- **Version lockstep:** `.claude-plugin/plugin.json` and its
  `marketplace.json` line.
- **Release:** merge the bump to `main`. That also republishes the zips.
- **Tests:** `npx nx run cris-asiste:test` checks frontmatter, that every
  top-level file in `references/` and `assets/` is named in its `SKILL.md`, privacy rules,
  the zip shape, and the assistant setup script. `npx nx run cris-asiste:build`
  builds the zips locally into `packages/cris-asiste/dist/`.
- **Guides:** each skill's `GUIA.md` and the package README. Update them when a
  skill's flow changes, and when the Claude app moves the screens the guides
  walk through.
- **Verify end to end:** install the plugin, open a new session and say
  "quiero crear un agente". For the chat path, download a zip from the site and
  upload it as a skill in a fresh Claude account.

### finanzas-usa

- **Source:** `packages/finanzas-usa/agents/` (`indexandro`, `tributina`),
  written in Spanish for a LATAM audience living in the United States. They
  are advisors on real money: they never place orders and never file.
- **Ships:** two packagings from one source. The plugin installs the agents
  straight from `agents/`. For people who use a Project in the Claude app,
  `scripts/build-kit.sh` writes each agent body without its frontmatter to
  `kit/instrucciones/`, which is committed so it can be downloaded from GitHub,
  next to the dashboard template in `kit/plantillas/`. Nothing goes to npm, and
  there is no release tag.
- **Version lockstep:** `.claude-plugin/plugin.json`, its `marketplace.json`
  line, and the `<!-- versión: X.Y.Z -->` first line of each agent body (the
  line a Project uses to notice stale pasted instructions). Rebuild the kit in
  the same PR.
- **Release:** merge the bump to `main`.
- **Tests:** `npx nx run finanzas-usa:test` checks frontmatter, version
  lockstep, that the committed kit matches a fresh build, the doctrine that
  must survive any rewrite, and privacy rules. `npx nx run finanzas-usa:kit`
  rebuilds the kit.
- **Guide:** its [README](../packages/finanzas-usa/README.md), including the
  Projects install for people without a terminal. Update it when the Claude
  app moves the screens it walks through, and when Interactive Brokers moves
  the statement menus the agent describes.
- **Verify end to end:** install the plugin, open a new session in an empty
  folder, say "armemos mi plan de retiro", and check the interview writes under
  `vault/2. Areas/Finanzas/retiro/`. Run a monthly review against a sample IBKR
  Activity Statement CSV with made-up numbers, never a real one.
- **Specific risk:** people act on what these agents say. Any change that
  softens a rule (orders, the IPS, the learning-sleeve cap, wash sales, IRS
  citations with the year, sensitive data) needs a human reviewer who reads the
  rule, not only the diff.

### product-team (licensed)

- **Source:** a private repository. The catalog entry points at it, and
  installation requires granted read access to that repository. Without access
  the install fails; that is expected, not broken.
- **Access:** requests go to [cris@pappcorn.com](mailto:cris@pappcorn.com).
- **In this repo:** only its entry in `marketplace.json`. Its `version` line is
  bumped by hand, in a PR here, after each release of the plugin, so clients
  see the update. Keep the description in line with what the plugin does.
- **Verify:** with an account that has access, update the marketplace and check
  the installed version matches the catalog line.

---

## Failure modes we've already hit

**Stale committed bundles (#50, #84).** Runtime dependency bumps (zod 3 to 4,
several MCP SDK releases) merged with the lockfile updated and the bundles
untouched. npm users got the new code at the next release; plugin users kept
running the old bundle for months. #50 was closed without a rebuild, and the
drift came back. The fix is the [rebuild rule](#the-bundle-rebuild-rule), and
the [drift gate](#the-drift-gate) makes it impossible to merge around.

**Dependabot lockfile-only bumps.** This is how the stale bundles happened.
Dependabot updates manifests and the lockfile, never the bundles, and its
routine minor/patch group merges on its own once CI is green. With the drift
gate, a Dependabot PR that changes a bundled dependency now fails CI and does
not auto-merge. To land it, check out its branch, run the rebuild, commit the
bundles and the patch bumps, and push. Once a human has pushed to it, the PR
is no longer a pure Dependabot PR: it waits for a human approval, and
Dependabot stops rebasing it. Dev-only bumps don't change the bundles and
still merge on their own.
An automated rebuild path for the bot lane is tracked in #89.

**A version that already merged is spent.** #81 put gmail-mcp 0.3.2 on `main`
with the old bundle, and #86 then rebuilt that bundle without bumping. Plugin
updates are keyed on the version, so anyone already on 0.3.2 would never have
received the rebuild. The fix was 0.3.3. Once a version reaches `main`, any
later change to that plugin's shipped files needs a new one, even if npm never
published the first.

**The npx symlink guard (#79).** `pappcorn-gmail-setup` exited 0 without
doing anything when run through `npx`. The script's "was I run directly?"
guard compared `process.argv[1]` to `import.meta.url`; through an installed
bin, `argv[1]` is the `node_modules/.bin` symlink and the module URL is the
real path, so they never matched. Any script exposed as an npm `bin` must
compare real paths on both sides, and should have a test that runs it through
a symlink. The fix for gmail is #81. Verifying from a clone with
`node scripts/...` does not catch this; verify through `npx`.

**A version that didn't move.** A merged change with no version bump never
reaches existing plugin installs. Check the lockstep table on every PR that
changes what a user runs.

**`bin/` at the plugin root (#33).** claude.ai's plugin validation rejects a
plugin with a top-level `bin/` directory. The bundles live in `server/` for
that reason. Don't move them back, and don't add a `bin/` folder to any plugin.

---

## Monthly upkeep

Once a month, ideally the week after the monthly Dependabot run for GitHub
Actions:

- [ ] **Dependabot.** Drain the open PRs. Routine npm bumps merge on their own
      when green; any that failed the drift gate need a rebuild (see above).
      Decide on each pending major: merge, defer, or ignore it explicitly. The
      monthly GitHub Actions group always needs a human approval.
- [ ] **Alerts.** Check the repository's Security tab: Dependabot alerts,
      code scanning, secret scanning. If a fix lands in a runtime dependency,
      make sure it reached the bundles and was released on both channels. Never
      discuss an open vulnerability in a public issue or PR; reports go to
      `hola@pappcorn.com`.
- [ ] **Drift.** From a fresh clone of `main`, run the
      [rebuild commands](#the-bundle-rebuild-rule); the bundles must come out
      unchanged. Also check that `npm view @pappcorn/<name> version` matches
      `package.json` on `main` for each connector, and that a
      `<name>@<version>` tag exists for it. A version on `main` with no npm
      release means a tag was never pushed.
- [ ] **Guide links.** Walk each setup guide against the live vendor consoles
      (Google Cloud, Meta for Developers) and click every link in `README.md`,
      `docs/` and the package READMEs. Fix anything that moved.
- [ ] **Site link check.** Every link on the public site must resolve,
      including the skill downloads and the masterclass PDF and map, which
      sent emails link to. A quick pass over both pages:

  ```bash
  base=https://pappcorn.github.io/universe/
  for page in "" masterclass.html; do curl -fsS "$base$page"; done |
    grep -oE '(href|src)="[^"#]+' | cut -d'"' -f2 | sort -u |
    while read -r u; do
      case "$u" in mailto:*) continue ;; http*) ;; *) u="$base$u" ;; esac
      code=$(curl -s -o /dev/null -L -w '%{http_code}' "$u")
      [ "$code" = 200 ] || echo "$code $u"
    done
  ```

  No output means every link answered 200. Some sites refuse scripted requests
  (claude.ai answers 403, LinkedIn 999); open those by hand.

- [ ] **Catalog.** Every `version` line in `marketplace.json` matches its
      product's current release, including `product-team`'s.
