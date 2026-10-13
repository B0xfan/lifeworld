// Where the moved suites find the code: the built file (what Obsidian loads; behaviour checks)
// and the source file (checks that read the code's text, which esbuild reprints).
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const PART = { 'a4-projects': 'projects', 'a4-today': 'today', 'a4-planner': 'planner', 'a4-sidebar': 'sidebar' };
exports.built = (id) => (id === 'a4-projects' ? path.join(ROOT, 'main.js') : path.join(ROOT, 'dist', id, 'main.js'));
exports.source = (id) => path.join(ROOT, 'src', PART[id], 'main.js');
// Notes the vault-reading checks read: the owner's vault with A4_VAULT, else the frozen,
// made-up copy in tests/fixtures/vault (so those checks also run on GitHub).
exports.FROZEN = !process.env.A4_VAULT;
exports.vault = process.env.A4_VAULT || path.join(ROOT, 'tests', 'fixtures', 'vault');
// Repeating tasks the Someday round trip runs on, by name (real names stay out of the repo).
exports.repeats = process.env.A4_REAL_REPEATS ? process.env.A4_REAL_REPEATS.split(',').filter(Boolean)
  : exports.FROZEN ? ['Water the plants', 'Log the mood of the day'] : [];
