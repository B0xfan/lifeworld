// Official Obsidian ESLint (eslint-plugin-obsidianmd), set up like the community plugin
// scanner (docs/configuration.md, "Community plugin scanner configuration"): only the security
// rules are errors, everything else is advice (warn). `npm run lint` fails on errors only.
import { defineConfig, globalIgnores } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

const SECURITY = ['no-eval', 'no-implied-eval', 'no-unsanitized/method', 'no-unsanitized/property', 'obsidianmd/regex-lookbehind', 'obsidianmd/no-forbidden-elements'];
const OFF = ['no-undef', '@typescript-eslint/no-unsafe-member-access', '@typescript-eslint/no-unsafe-assignment', '@typescript-eslint/no-unsafe-argument', '@typescript-eslint/no-unsafe-call', '@typescript-eslint/no-unsafe-return', '@typescript-eslint/restrict-template-expressions', '@typescript-eslint/no-base-to-string', 'import/no-unresolved', 'obsidianmd/validate-manifest', 'obsidianmd/validate-license', 'obsidianmd/commands/no-command-in-command-id', 'obsidianmd/commands/no-plugin-id-in-command-id'];

// The scanner downgrades every non-security rule to warn; do the same to the recommended set.
const warnOnly = (sev) => (sev === 'error' || sev === 2 ? 'warn' : sev);
const recommended = obsidianmd.configs.recommended.map((c) => (c.rules ? { ...c, rules: Object.fromEntries(Object.entries(c.rules).map(([k, v]) => [k, Array.isArray(v) ? [warnOnly(v[0]), ...v.slice(1)] : warnOnly(v)])) } : c));

export default defineConfig([
  {
    languageOptions: {
      parserOptions: { projectService: { allowDefaultProject: ['eslint.config.*', 'manifest.json'] }, extraFileExtensions: ['.json'] },
    },
  },
  ...recommended,
  {
    files: ['**/*.{ts,cts,mts,tsx,js,cjs,mjs,jsx}'],
    rules: { ...Object.fromEntries(SECURITY.map((r) => [r, 'error'])), ...Object.fromEntries(OFF.map((r) => [r, 'off'])) },
  },
  // What the scanner ignores (build output, tests, build scripts), plus this repo's frozen test vault.
  globalIgnores(['node_modules', 'dist', 'build', 'main.js', 'tests/**', '**/*.mjs', '**/*.cjs']),
]);
