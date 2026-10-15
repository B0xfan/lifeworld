// How the parts of LifeWorld find each other (phase 2 section 1). src/main.js puts each part here,
// under its old plugin id, before it starts; before, each part looked the others up in
// Obsidian's undocumented plugin list.
'use strict';

const PARTS = {};

// shortcut: falls back to Obsidian's plugin list, which the moved test suites stub and which the
// parts built alone (dist/) still need; drop it when the suites load the one built file (section 8).
function partOf(app, id) {
  return PARTS[id] || (app && app.plugins && app.plugins.plugins ? app.plugins.plugins[id] : null) || null;
}

export { PARTS, partOf };
