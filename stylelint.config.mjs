// The community review's CSS checks, as errors: browser features only partly supported by the
// Chromium in Obsidian's Electron (doiuse data), no !important, no :has.
// shortcut: browsers pinned to Chromium 124 for Obsidian 1.6.5; the flagged features (text-decoration
// longhands, multi-column) are partial in every Chromium, so the exact version does not change results.
export default {
  plugins: ['stylelint-no-unsupported-browser-features'],
  rules: {
    'plugin/no-unsupported-browser-features': [true, { browsers: ['chrome 124'], severity: 'error' }],
    'declaration-no-important': true,
    'selector-pseudo-class-disallowed-list': ['has'],
  },
};
