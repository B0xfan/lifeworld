// Bundles src/ with esbuild: the one LifeWorld plugin at the repo root (phase 2 section 1). The
// test suites load the parts from this same file (phase 2 section 8).
import esbuild from 'esbuild';
import { builtinModules } from 'node:module';
import fs from 'node:fs';

const common = {
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  // Provided by Obsidian at runtime, never bundled.
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*', ...builtinModules],
  logLevel: 'warning',
};

// esbuild drops ordinary comments; the third-party credit must stay in every built file with Projects in it.
const banner = { js: '/* LifeWorld. Contains code ported from TaskNotes (https://github.com/callumalpass/tasknotes) and @tasknotes/model,\n * Copyright 2025 Callum Alpass, MIT License. Full notice: THIRD_PARTY_NOTICES.md. */' };
const PARTS = ['projects', 'today', 'planner', 'sidebar'];

// The one plugin Obsidian loads: repo-root main.js, styles.css (LifeWorld's own, then the four
// parts' styles in start order) and manifest.json.
await esbuild.build({ ...common, entryPoints: ['src/main.js'], outfile: 'main.js', banner });
fs.writeFileSync('styles.css', ['src', ...PARTS.map((p) => `src/${p}`)].map((d) => fs.readFileSync(`${d}/styles.css`, 'utf8')).join('\n'));

