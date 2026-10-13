// The shared core (src/core/): one copy of each shared helper, and no plugin keeps its own copy
// (phase 1 section 5: dates and repeat rules; section 6: quick add, reminders, asList, clock
// times). Whether a file declares or uses a name is decided by esbuild's scope analysis
// (tests/lib/core-use.js), so a copy written as let/var/class or an indented local is seen too.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { source } = require('./lib/paths');
const { coreUse } = require('./lib/core-use');

const CORE = path.join(__dirname, '..', 'src', 'core');
const EXPORTS = {
  dates: ['pad2', 'dayOf', 'isDayStr', 'toDayStr', 'utcOf', 'fromUtc', 'addDays', 'daysBetween', 'weekdayOf', 'partsOf', 'daysInMonth', 'WD', 'parseRRule', 'monthDaysByDay', 'monthDaysByMonthDay', 'applySetPos', 'matchesPattern', 'occursOn', 'MONTHS_SHORT', 'WEEKDAYS_SHORT', 'halfOfTime', 'timeText'],
  lists: ['asList'],
  reminders: ['REMINDER_CHOICES', 'ringField', 'offsetMinutes', 'offsetIso', 'reminderOf', 'reminderShort', 'reminderWords'],
  quickadd: ['DOW_NAMES', 'DOW_CODES', 'MON_NAMES', 'dowIndex', 'nextDow', 'validDay', 'parseDayWord', 'DAY_RE', 'repeatRule', 'REPEAT_RE', 'understand', 'parseClock', 'whenValue', 'firstOccurrence', 'DOW_LONG', 'joinWords', 'ordinal', 'repeatWords', 'shortDay', 'halfWord', 'quickAddChips', 'quickAddPlan'],
};
let n = 0;
const check = (fn) => { fn(); n++; };
const core = {};
for (const [mod, names] of Object.entries(EXPORTS)) {
  core[mod] = require(path.join(CORE, mod));
  check(() => assert.deepStrictEqual(Object.keys(core[mod]), names, `src/core/${mod}.js exports exactly its helpers`));
}
check(() => assert.deepStrictEqual(fs.readdirSync(CORE).sort(), Object.keys(EXPORTS).map((m) => `${m}.js`).sort(), 'every core file is listed here'));

// Each plugin and each core file: no own copy of a core name, every core name it uses is
// imported, nothing imported that it does not use, each import names a real export of that file.
const ALL = Object.values(EXPORTS).flat();
check(() => assert.strictEqual(new Set(ALL).size, ALL.length, 'no name exported by two core files'));
const files = ['a4-projects', 'a4-today', 'a4-planner', 'a4-sidebar'].map((id) => [id, source(id), ALL])
  .concat(Object.keys(EXPORTS).map((mod) => [`core/${mod}`, path.join(CORE, `${mod}.js`), ALL.filter((x) => !EXPORTS[mod].includes(x))]));
for (const [id, file, names] of files) {
  const { imports, own, used } = coreUse(fs.readFileSync(file, 'utf8'), names);
  const imported = Object.values(imports).flat();
  check(() => assert.deepStrictEqual(own, [], `${id}: no own copy of a core helper`));
  check(() => assert.deepStrictEqual(used.filter((x) => !imported.includes(x)), [], `${id}: every core helper it uses is imported`));
  check(() => assert.deepStrictEqual(imported.filter((x) => !used.includes(x)), [], `${id}: imports only what it uses`));
  for (const [mod, list] of Object.entries(imports)) check(() => assert.deepStrictEqual(list.filter((x) => !(EXPORTS[mod] || []).includes(x)), [], `${id}: ${mod} exports all it imports`));
}

// The checks themselves catch what they are for (planted in memory, never on disk).
const SAMPLE = "const { addDays } = require('../core/dates');\nfunction f() { return addDays('2026-10-05', 1); }\n";
check(() => assert.deepStrictEqual(coreUse(SAMPLE, ALL), { imports: { dates: ['addDays'] }, own: [], used: ['addDays'] }));
for (const copy of ['let pad2 = (n) => n;', 'var pad2 = 1;', '  function pad2(n) { return n; }', 'class pad2 {}', 'function g() { const pad2 = 2; return pad2; }', 'const { pad2 } = obj;']) {
  check(() => assert.deepStrictEqual(coreUse(`${SAMPLE}${copy}\n`, ALL).own, ['pad2'], `own copy seen: ${copy}`));
}
check(() => assert.deepStrictEqual(coreUse(`${SAMPLE}const k = { timeText };\n`, ALL).used, ['addDays', 'timeText'], 'a use without an import is seen'));
check(() => assert.deepStrictEqual(coreUse(`${SAMPLE}x.timeText(); const s = 'timeText'; const o = { timeText: 1 };\n`, ALL).used, ['addDays'], 'a property, a string and a key are not uses'));
for (const use of ['const v = c ? timeText : 0;', 'switch (v) { case timeText: break; }', 'const v = c ? 0 : timeText;']) {
  check(() => assert.deepStrictEqual(coreUse(`${SAMPLE}${use}\n`, ALL).used, ['addDays', 'timeText'], `a use without an import is seen: ${use}`));
}
check(() => assert.deepStrictEqual(coreUse(`${SAMPLE}const o = c ? { timeText: 1 } : a?.timeText;\n`, ALL).used, ['addDays'], 'a key inside a ternary and an optional property are not uses'));

// A few behaviour pins on the one copy (the plugin suites cover it in depth).
const D = core.dates; const Q = core.quickadd; const R = core.reminders;
check(() => assert.strictEqual(D.addDays('2026-03-07', 1), '2026-03-08'));
check(() => assert.strictEqual(D.daysBetween('2026-10-01', '2026-11-01'), 31));
check(() => assert.ok(D.occursOn(D.parseRRule('DTSTART:20260905;FREQ=DAILY;INTERVAL=2'), '2026-09-07')));
check(() => assert.ok(!D.occursOn(D.parseRRule('DTSTART:20260905;FREQ=DAILY;INTERVAL=2'), '2026-09-06')));
check(() => assert.deepStrictEqual(Q.quickAddChips(Q.understand('call Ana friday 3pm', '2026-10-05'), '2026-10-05', null, 'normal'), ['Call Ana', 'Due Fri, Oct 9, 3:00 PM']));
check(() => assert.strictEqual(R.reminderOf({ due: '2026-10-08T16:30', reminders: { type: 'relative', relatedTo: 'due', offset: '-PT15M' } }), 15));
console.log(`core self-check: OK (${n} checks)`);
