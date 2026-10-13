// Where the moved suites find the code: the built file (what Obsidian loads; behaviour checks)
// and the source file (checks that read the code's text, which esbuild reprints).
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const PART = { 'a4-projects': 'projects', 'a4-today': 'today', 'a4-planner': 'planner', 'a4-sidebar': 'sidebar' };
exports.built = (id) => (id === 'a4-projects' ? path.join(ROOT, 'main.js') : path.join(ROOT, 'dist', id, 'main.js'));
exports.source = (id) => path.join(ROOT, 'src', PART[id], 'main.js');
