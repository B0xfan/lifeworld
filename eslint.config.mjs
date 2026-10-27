// Obsidian's official review rules: eslint-plugin-obsidianmd's recommended config at its own severities.
// npm scripts run with --max-warnings 0, so every warning fails. Stricter than the community scanner on purpose:
// the type-aware "unsafe any" rules are errors (the scanner warns), and disable comments need a reason
// (the scanner requires one too: eslint-comments/require-description).
import { defineConfig, globalIgnores } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';
import { DEFAULT_BRANDS } from 'eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js'; // internal path: re-check when the plugin version changes

// Names the sentence-case rule would wrongly lowercase: LifeWorld's name, the tools it reads, and labels
// quoted from other apps. The scanner switches sentence-case off for JS files, so this only affects npm test.
const BRANDS = [...DEFAULT_BRANDS, 'LifeWorld', 'TaskNotes', 'ClickUp', 'Google Calendar',
  'Apple', 'Outlook', 'Open-Meteo', 'Max', 'Secret address in iCal format', 'A to Z', 'Z to A', '°C', '°F'];
// Text the rule misreads: a leading number, tag or arrow is not the start of a sentence; a web address stays
// lowercase; and the view names Today, Planner and Projects are plain words the brand list would capitalize
// everywhere, so a string that already writes one with a capital is skipped whole (case-sensitive match).
const NOT_SENTENCES = ['^\\d', '^#', '^←', '://', '\\b(Today|Planner|Projects)\\b'];

const SECURITY = ['no-eval', 'no-implied-eval', 'no-unsanitized/method', 'no-unsanitized/property', 'obsidianmd/regex-lookbehind', 'obsidianmd/no-forbidden-elements'];
const UNSAFE = ['no-unsafe-argument', 'no-unsafe-member-access', 'no-unsafe-assignment', 'no-unsafe-call', 'no-unsafe-return'].map((r) => `@typescript-eslint/${r}`);
// The scanner switches these off too (docs/configuration.md): TypeScript covers them, or they misfire on plain JS.
const OFF = ['no-undef', '@typescript-eslint/restrict-template-expressions', '@typescript-eslint/no-base-to-string', 'import/no-unresolved'];

export default defineConfig([
  {
    languageOptions: {
      parserOptions: { projectService: { allowDefaultProject: ['eslint.config.*', 'manifest.json'] }, extraFileExtensions: ['.json'] },
    },
  },
  ...obsidianmd.configs.recommended,
  {
    files: ['**/*.{ts,cts,mts,tsx,js,cjs,mjs,jsx}'],
    rules: { ...Object.fromEntries([...UNSAFE, ...SECURITY].map((r) => [r, 'error'])), ...Object.fromEntries(OFF.map((r) => [r, 'off'])), 'eslint-comments/require-description': 'error',
      'obsidianmd/ui/sentence-case': ['warn', { brands: BRANDS, ignoreRegex: NOT_SENTENCES }] },
  },
  // What the scanner ignores (build output, tests, build scripts, docs), plus this repo's frozen test vault.
  globalIgnores(['node_modules', 'dist', 'build', 'main.js', 'tests/**', 'scripts/**', 'docs/**', '**/*.mjs', '**/*.cjs']),
]);
