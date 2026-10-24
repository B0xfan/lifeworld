// Obsidian's directory scanner CSS rules, exactly (obsidianmd/obsidian-workflows src/lint.ts, SCANNER_STYLELINT_CONFIG):
// stylelint-config-obsidianmd's own rules WITHOUT its stylelint-config-standard base, which the scanner does not run
// (decided 2026-10-21: match the review, no formatting rewrite). npm scripts run with --max-warnings 0.
// Browser target follows manifest minAppVersion (1.7.2 -> Electron 30); stylelint-disable comments are ignored, as the scanner ignores them.
import obsidianmd from 'stylelint-config-obsidianmd';

export default {
  ...obsidianmd,
  extends: [],
  ignoreDisables: true,
  rules: {
    ...obsidianmd.rules,
    'plugin/no-unsupported-browser-features': [true, { severity: 'warning', browsers: ['electron >= 30'], ignore: ['css-nesting', 'css-cascade-layers'] }],
  },
};
