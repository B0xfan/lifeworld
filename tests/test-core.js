// The shared core: one copy of the date and repeat-rule helpers (src/core/dates.js), and no
// plugin keeps its own copy (phase 1 section 5; before, Today, Planner and Projects each had one).
const assert = require('assert');
const fs = require('fs');
const { source } = require('./lib/paths');
const core = require('../src/core/dates');
const NAMES = ['pad2', 'dayOf', 'isDayStr', 'toDayStr', 'utcOf', 'fromUtc', 'addDays', 'daysBetween', 'weekdayOf', 'partsOf', 'daysInMonth', 'WD', 'parseRRule', 'monthDaysByDay', 'monthDaysByMonthDay', 'applySetPos', 'matchesPattern', 'occursOn'];
assert.deepStrictEqual(Object.keys(core), NAMES, 'core exports every date helper');
let n = 1;
for (const id of ['a4-projects', 'a4-today', 'a4-planner', 'a4-sidebar']) {
  const src = fs.readFileSync(source(id), 'utf8');
  const own = NAMES.filter((x) => new RegExp(`^\\s*(?:function ${x}\\(|const ${x} = )`, 'm').test(src));
  assert.deepStrictEqual(own, [], `${id}: no own copy of a core date helper`);
  const m = /^const \{ ([^}]*) \} = require\('\.\.\/core\/dates'\);/m.exec(src);
  assert.ok(m, `${id}: takes its date helpers from src/core/dates.js`);
  for (const x of m[1].split(', ')) assert.ok(NAMES.includes(x), `${id}: ${x} is a core helper`);
  n += 3;
}
// A few behaviour pins on the one copy (the plugin suites cover it in depth).
assert.strictEqual(core.addDays('2026-03-07', 1), '2026-03-08');
assert.strictEqual(core.daysBetween('2026-10-01', '2026-11-01'), 31);
assert.ok(core.occursOn(core.parseRRule('DTSTART:20260905;FREQ=DAILY;INTERVAL=2'), '2026-09-07'));
assert.ok(!core.occursOn(core.parseRRule('DTSTART:20260905;FREQ=DAILY;INTERVAL=2'), '2026-09-06'));
console.log(`core self-check: OK (${n + 4} checks)`);
