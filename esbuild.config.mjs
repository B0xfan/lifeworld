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
  // Obsidian runs main.js as a CommonJS script, so import() becomes require() (the CodeMirror modules).
  supported: { 'dynamic-import': false },
  logLevel: 'warning',
};

// esbuild drops ordinary comments; the third-party credit must stay in every built file with Projects in it.
const banner = { js: '/* LifeWorld. Contains code ported from TaskNotes (https://github.com/callumalpass/tasknotes) and @tasknotes/model,\n * Copyright 2025 Callum Alpass, MIT License. Contains ical.js 2.2.1 (https://github.com/kewisch/ical.js), unmodified,\n * Mozilla Public License 2.0 (https://mozilla.org/MPL/2.0/); its source is at that address. Full notices: THIRD_PARTY_NOTICES.md. */' };
const PARTS = ['projects', 'today', 'planner', 'sidebar'];

// The one plugin Obsidian loads: repo-root main.js, styles.css (LifeWorld's own, then the four
// parts' styles in start order) and manifest.json.
// Today's four bundled fonts are under the SIL Open Font License, which asks for its text to ship with
// them: it goes at the end of main.js, where the fonts are.
const fonts = fs.readdirSync('src/today/fonts').sort().map((f) => fs.readFileSync(`src/today/fonts/${f}`, 'utf8').trim());
const footer = { js: `/*! Font licences (Today's handwriting fonts)\n\n${fonts.join('\n\n')}\n*/` };
await esbuild.build({ ...common, entryPoints: ['src/main.js'], outfile: 'main.js', banner, footer });
fs.writeFileSync('styles.css', ['src', ...PARTS.map((p) => `src/${p}`)].map((d) => fs.readFileSync(`${d}/styles.css`, 'utf8')).join('\n'));

