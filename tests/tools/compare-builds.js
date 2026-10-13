// Manual tool, not part of npm test: old vs new built files. Every moved task helper the builds
// expose is called on the same inputs; the return value AND the changed input are compared as JSON.
// Inputs: every task note in the vault (A4_VAULT, read only; else the frozen copy) plus edge values.
// Run after `npm run build`, with an old checkout built the same way:
//   node tests/tools/compare-builds.js <old repo root> [new repo root, default this repo]
// Exit 1 on any difference. To see it fail, plant a change in one build (e.g. order + 1 in applyMove).
const fs = require('fs'); const path = require('path'); const M = require('module');
const { vault: VAULT } = require('../lib/paths');
const OLD = process.argv[2]; const NEW = process.argv[3] || path.join(__dirname, '..', '..');
if (!OLD) { console.error('usage: node tests/tools/compare-builds.js <old repo root> [new repo root]'); process.exit(2); }
const o = M._load; M._load = function (r, ...a) { return r === 'obsidian' ? new Proxy({}, { get: () => class {} }) : o.call(this, r, ...a); };
const load = (root, f) => { const p = path.resolve(root, f); delete require.cache[p]; return require(p).logic; };
const parse = (t) => { const b = (/^---\n([\s\S]*?)\n---/.exec(t) || [])[1]; if (!b) return null; const fm = {}; let k = null; for (const line of b.split('\n')) { let m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line); if (m) { k = m[1]; const v = m[2].trim(); fm[k] = v === '' ? null : v === '[]' ? [] : v === 'true' ? true : v === 'false' ? false : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v.replace(/^"(.*)"$/, '$1'); continue; } m = /^\s+-\s+(.*)$/.exec(line); if (m && k) { if (!Array.isArray(fm[k])) fm[k] = []; const v = m[1].trim(); const kv = /^(\w+):\s*(.*)$/.exec(v); fm[k].push(kv && k === 'blockedBy' ? { uid: kv[2].replace(/^"(.*)"$/, '$1') } : v.replace(/^"(.*)"$/, '$1')); } } return fm; };
const notes = [];
for (const dir of ['02 Planner/TaskNotes/Tasks', '02 Planner/TaskNotes/Archive']) { const d = path.join(VAULT, dir); if (!fs.existsSync(d)) continue; for (const f of fs.readdirSync(d).filter((x) => x.endsWith('.md'))) { const fm = parse(fs.readFileSync(path.join(d, f), 'utf8')); if (fm) notes.push({ fm, path: `${dir}/${f}`, base: f.slice(0, -3) }); } }
const EDGE = [{}, null, { tags: ['task'] }, { tags: 'task', status: 'someday', due: '2026-10-05T16:30', recurrence: '' }, { tags: ['task'], recurrence: 'DTSTART:20261012T090000Z;FREQ=DAILY', scheduled: '2026-10-12', planned_half: 'pm' }, { tags: ['task'], due: '2026-10-05T00:00', planned_order: 'x', title: ['a', 'b'] }, { tags: ['task', 'archived'] }, { tags: ['task'], archived: true }, { tags: ['task'], blockedBy: ['[[A]]', { uid: '[[B#h|x]]' }, 'A', 3] }];
for (const fm of EDGE) notes.push({ fm, path: '02 Planner/TaskNotes/Tasks/E.md', base: 'E' });
const DAYS = ['2026-10-05', '2026-10-06', '2026-10-12', '2026-12-31', '2027-03-14']; const HALVES = ['am', 'pm', null];
const VALS = [null, undefined, '', '2026-10-05', '2026-10-05T09:30', ' 2026-10-05T13:00Z', '2026-10-05 16:45', 'x', 42, new Date(2026, 9, 5)];
const ORDERS = [[], [0], [0, 0, 0], [10, 20, 30], [10, 10, 40], [-5, 7.5, 100]];
const fakeApp = (all) => ({ metadataCache: { getFirstLinkpathDest: (l) => { const n = all.find((x) => x.base === l); return n ? { path: n.path, basename: n.base } : null; }, getFileCache: (f) => { const n = all.find((x) => x.path === f.path); return n ? { frontmatter: n.fm } : null; } } });
let calls = 0; const diffs = [];
const cl = (x) => (x === undefined ? undefined : x instanceof Date ? new Date(x) : JSON.parse(JSON.stringify(x)));
const J = (x) => JSON.stringify(x === undefined ? '__undef' : x);
for (const f of ['main.js', 'dist/a4-today/main.js', 'dist/a4-planner/main.js']) {
  const A = load(OLD, f); const B = load(NEW, f);
  const same = (fn, args) => { if (typeof A[fn] !== 'function') return; calls++; const a1 = args.map(cl); const b1 = args.map(cl); let ra; let rb; try { ra = A[fn](...a1); } catch (e) { ra = 'THROW ' + e.message; } try { rb = B[fn](...b1); } catch (e) { rb = 'THROW ' + e.message; } if (J(ra) !== J(rb) || J(a1) !== J(b1)) diffs.push(`${f} ${fn} ${J(args).slice(0, 120)}`); };
  const items = [];
  for (const n of notes) {
    same('taskTitleOf', [n.fm, n.base]); same('taskFromFrontmatter', [n.fm, n.path, n.base]); same('blockerLinks', [n.fm]); same('isSomeday', [n.fm]);
    same('applySomeday', [n.fm]); same('blockerHolds', [n.fm, n.path]); same('blockerHolds', [n.fm, n.path, ['done']]);
    if (n.fm) same('ruleTimeOf', [n.fm.recurrence]);
    for (const d of DAYS) for (const h of HALVES) for (const ord of [10, 15.5]) same('applyMove', [n.fm || {}, d, h, ord]);
    const it = A.taskFromFrontmatter && n.fm ? A.taskFromFrontmatter(cl(n.fm), n.path, n.base) : null;
    if (it) { items.push(it); for (const d of DAYS) { same('isTaskDone', [it, d]); same('isTaskDone', [it, d, ['done']]); same('taskOnDay', [it, d]); } }
  }
  if (A.openBlockersOf) { const app = fakeApp(notes); for (const it of items) { calls++; const ra = J(A.openBlockersOf(app, it)); const rb = J(B.openBlockersOf(app, it)); if (ra !== rb) diffs.push(`${f} openBlockersOf ${it.path}`); } }
  same('sortByOrder', [items]);
  for (const v of VALS) { same('timeOf', [v]); for (const d of DAYS) { same('onDay', [v, d]); for (const h of HALVES) same('movedDate', [v, d, h]); } }
  for (const ord of ORDERS) for (const i of [-1, 0, 1, 2, 3, 9, null]) { same('orderForInsert', [ord, i]); same('planInsert', [ord, i]); same('untimedSlot', [items.slice(0, ord.length + 2), i]); }
}
console.log(`${notes.length} notes, ${calls} calls compared, ${diffs.length} differences`); if (diffs.length) console.log(diffs.slice(0, 20).join('\n'));
process.exit(diffs.length ? 1 : 0);
