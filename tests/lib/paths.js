// Where the moved suites find the code: the one built file Obsidian loads (behaviour checks; each
// part is taken from it, phase 2 section 8) and the source file (checks that read the code's text,
// which esbuild reprints).
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const PART = { 'a4-projects': 'projects', 'a4-today': 'today', 'a4-planner': 'planner', 'a4-sidebar': 'sidebar' };
exports.MAIN = path.join(ROOT, 'main.js');
exports.STYLES = path.join(ROOT, 'styles.css');
// The LifeWorld plugin class from main.js, started on the frozen test vault's settings (its folders
// follow the owner's folder layout), as it would be after reading them. Require 'obsidian' stand-ins first.
// The four parts load together now, so a stand-in written for one part gets an empty class for any
// base class another part extends at load time.
// shortcut: base classes and test settings are set on the first load only (until main.js leaves
// require.cache): install the 'obsidian' stand-in before the first lifeworld() call and keep that same
// object (adding to it later is fine); run-all.js gives each test file its own process. Upgrade if a
// file ever needs two stand-ins.
const BASES = ['Plugin', 'ItemView', 'Modal', 'PluginSettingTab', 'SuggestModal', 'FuzzySuggestModal'];
exports.lifeworld = () => {
  const first = !require.cache[exports.MAIN];
  if (first) { const ob = require('module')._load('obsidian', module); for (const k of BASES) if (!ob[k]) ob[k] = class {}; }
  const LW = require(exports.MAIN).default;
  if (first) {
    const fixture = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'vault', '.obsidian', p), 'utf8'));
    LW.vault.startWith({ ...fixture('plugins/lifeworld/data.json').lifeworld.vault, daily: fixture('daily-notes.json') });
  }
  return LW;
};
// A src/ file on its own (now ES module syntax), bundled in memory with esbuild; a fresh copy each call.
exports.fromSrc = (rel) => {
  const file = path.join(ROOT, 'src', `${rel}.js`);
  const code = require('esbuild').buildSync({ entryPoints: [file], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'error' }).outputFiles[0].text;
  const m = new (require('module'))(file); m.filename = file; m.paths = require('module')._nodeModulePaths(path.dirname(file));
  m._compile(code, file);
  return m.exports;
};
// One part's plugin class (its old id), with the helpers it exports for the tests.
exports.part = (id) => exports.lifeworld().parts[id];
exports.source = (id) => path.join(ROOT, 'src', PART[id], 'main.js');
// The settings were renamed in phase 2 section 9; an old name still set would quietly fall back to
// the frozen copy, so stop loudly instead.
const oldNames = Object.keys(process.env).filter((k) => /^A\d_(VAULT|REAL_REPEATS|TASKS_JSON)$/.test(k));
if (oldNames.length) throw new Error(`renamed test settings: use LIFEWORLD_${oldNames[0].slice(3)} instead of ${oldNames[0]}`);
// Notes the vault-reading checks read: the owner's vault with LIFEWORLD_VAULT, else the frozen,
// made-up copy in tests/fixtures/vault (so those checks also run on GitHub).
exports.FROZEN = !process.env.LIFEWORLD_VAULT;
exports.vault = process.env.LIFEWORLD_VAULT || path.join(ROOT, 'tests', 'fixtures', 'vault');
// Repeating tasks the Someday round trip runs on, by name (real names stay out of the repo).
exports.repeats = process.env.LIFEWORLD_REAL_REPEATS ? process.env.LIFEWORLD_REAL_REPEATS.split(',').filter(Boolean)
  : exports.FROZEN ? ['Water the plants', 'Log the mood of the day'] : [];
