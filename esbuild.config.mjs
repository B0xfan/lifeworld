// Bundles src/ with esbuild: the one LifeWorld plugin at the repo root (phase 2 section 1), and
// each of its four parts alone in dist/<old plugin id>/ for the tests.
import esbuild from 'esbuild';
import { builtinModules } from 'node:module';
import fs from 'node:fs';

// Owner-only values (a name, a local interpreter path) live in local.json, which git ignores
// and which never ships; without it the build uses empty values.
const local = fs.existsSync('local.json') ? JSON.parse(fs.readFileSync('local.json', 'utf8')) : {};

const common = {
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  // Provided by Obsidian at runtime, never bundled.
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*', ...builtinModules],
  define: {
    LW_LOCAL_USER_NAME: JSON.stringify(local.userName || ''),
    LW_LOCAL_SYNC_PYTHON: JSON.stringify(local.syncPython || ''),
    LW_START_VAULT: 'null',
  },
  logLevel: 'warning',
};

// esbuild drops ordinary comments; the third-party credit must stay in every built file with Projects in it.
const banner = { js: '/* LifeWorld. Contains code ported from TaskNotes (https://github.com/callumalpass/tasknotes) and @tasknotes/model,\n * Copyright 2025 Callum Alpass, MIT License. Full notice: THIRD_PARTY_NOTICES.md. */' };
const PARTS = ['projects', 'today', 'planner', 'sidebar'];

// The one plugin Obsidian loads: repo-root main.js, styles.css (LifeWorld's own, then the four
// parts' styles in start order) and manifest.json.
await esbuild.build({ ...common, entryPoints: ['src/main.js'], outfile: 'main.js', banner });
fs.writeFileSync('styles.css', ['src', ...PARTS.map((p) => `src/${p}`)].map((d) => fs.readFileSync(`${d}/styles.css`, 'utf8')).join('\n'));

// Each part also built alone to dist/a4-<part>/, for the moved test suites (section 8 points
// them at the one file). Those start on the frozen test vault's "Your vault" settings and Daily
// notes setting (its folders are A4-shaped), as LifeWorld itself would after reading them.
const fixture = (p) => JSON.parse(fs.readFileSync(`tests/fixtures/vault/.obsidian/${p}`, 'utf8'));
const testVault = { ...fixture('plugins/lifeworld/data.json').lifeworld.vault, daily: fixture('daily-notes.json') };
for (const part of PARTS) {
  const out = `dist/a4-${part}`;
  fs.rmSync(out, { recursive: true, force: true });
  await esbuild.build({ ...common, define: { ...common.define, LW_START_VAULT: JSON.stringify(testVault) }, entryPoints: [`src/${part}/main.js`], outfile: `${out}/main.js`, ...(part === 'projects' ? { banner } : {}) });
  for (const f of ['manifest.json', 'styles.css']) fs.copyFileSync(`src/${part}/${f}`, `${out}/${f}`);
  if (fs.existsSync(`src/${part}/fonts`)) fs.cpSync(`src/${part}/fonts`, `${out}/fonts`, { recursive: true });
}
