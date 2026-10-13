// Bundles src/ into the plugin's main.js at the repo root (where Obsidian and a release expect it).
import esbuild from 'esbuild';
import { builtinModules } from 'node:module';

await esbuild.build({
  entryPoints: ['src/projects/main.js'],
  outfile: 'main.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  // Provided by Obsidian at runtime, never bundled.
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*', ...builtinModules],
  // esbuild drops ordinary comments; the third-party credit must stay in the shipped file.
  banner: { js: '/* LifeWorld. Contains code ported from TaskNotes (https://github.com/callumalpass/tasknotes) and @tasknotes/model,\n * Copyright 2025 Callum Alpass, MIT License. Full notice: THIRD_PARTY_NOTICES.md. */' },
  logLevel: 'warning',
});
