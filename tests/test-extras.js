#!/usr/bin/env node
/* Self-check for the seven 1.7.0 Today widgets' logic (src/today/extras.js) and the wide row in the layout.
 * The cards themselves need a real Obsidian (sandbox run). */
'use strict';
const Module = require('module');
const assert = require('assert');
const { EventEmitter } = require('events');
const { part } = require('./lib/paths');
const fake = { Plugin: class {}, ItemView: class {}, MarkdownView: class {}, Modal: class {}, SuggestModal: class {}, PluginSettingTab: class {}, Setting: class {}, TFile: class {}, TFolder: class {}, Notice: class {}, setIcon() {}, Platform: {}, Component: class {} };
const load = Module._load;
Module._load = function (req, ...a) { return req === 'obsidian' ? fake : load.call(this, req, ...a); };
const T = part('a4-today').logic;
global.window = global.window || { setTimeout, clearTimeout }; // askDateline's timer
const eq = (a, b, m) => assert.deepStrictEqual(a, b, m || 'check');
let n = 0; const ok = (fn) => { fn(); n++; };

// Settings: junk in, clean out; nothing set yet means no source and birthdays on.
ok(() => eq(T.normalizeMore(null), { calSource: '', quotesNote: '', countdowns: [], birthdays: true, exclude: [], focus: { day: '', done: 0 }, statsBase: null }));
ok(() => eq(T.normalizeMore({ calSource: 'outlook', exclude: [' /Templates/ ', 'Templates', 3, ''], countdowns: [{ name: ' Trip ', date: '2026-12-01' }, { name: '', date: '2026-12-01' }, { name: 'x', date: 'soon' }] }).exclude, ['Templates']));
ok(() => eq(T.normalizeMore({ countdowns: [{ name: ' Trip ', date: '2026-12-01', yearly: 'yes' }] }).countdowns, [{ name: 'Trip', date: '2026-12-01', yearly: false }]));

// Month grid: Monday first, whole weeks. November 2026 starts on a Sunday, ends on a Monday.
ok(() => { const g = T.monthGrid('2026-11'); eq([g[0].day, g[g.length - 1].day, g.length], ['2026-10-26', '2026-12-06', 42]); eq(g.filter((x) => !x.out).length, 30); });
ok(() => { const g = T.monthGrid('2027-02'); eq([g[0].day, g[g.length - 1].day, g.length], ['2027-02-01', '2027-02-28', 28], 'February 2027 fits four weeks exactly'); });
ok(() => eq([T.nextMonth('2026-12'), T.prevMonth('2026-01'), T.nextMonth('2026-09')], ['2027-01', '2025-12', '2026-10']));
ok(() => eq([...T.calendarSlots([{ calendar: 'Work' }, { calendar: 'Home' }, { calendar: 'Work' }, { calendar: 'a' }, { calendar: 'b' }, { calendar: 'c' }])], [['Work', 1], ['Home', 2], ['a', 3], ['b', 4], ['c', 1]]));

// Dateline's answer -> events at this device's time; all-day keeps its own day.
ok(() => {
  const s = new Date(2026, 10, 23, 9, 30); const e = new Date(2026, 10, 23, 10, 0);
  eq(T.fromDateline([{ title: 'Call', start: s.toISOString(), end: e.toISOString(), all_day: false, calendar: 'Work' }, { title: '', start: '2026-11-23T00:00:00-06:00', all_day: true }, { nope: 1 }, 'x']),
    [{ date: '2026-11-23', time: '09:30', end: '10:00', all_day: false, summary: 'Call', calendar: 'Work' }, { date: '2026-11-23', time: null, end: null, all_day: true, summary: '(untitled)', calendar: '' }]);
});

// askDateline with a stand-in socket: one request line out, the events back; refusals become plain sentences.
const sockWith = (answer, how) => {
  const s = new EventEmitter(); s.sent = ''; s.setEncoding = () => {}; s.destroy = () => {}; s.write = (x) => { s.sent += x; };
  setImmediate(() => { if (how === 'error') s.emit('error', new Error('ENOENT')); else if (how === 'close') s.emit('close'); else { s.emit('connect'); setImmediate(() => s.emit('data', `${JSON.stringify(answer)}\n`)); } });
  return s;
};
const ask = (answer, how, t) => { let sock; const p = T.askDateline(() => (sock = sockWith(answer, how)), '/x.sock', '2026-10-26', '2026-12-07', t); return p.then((v) => ({ v, sent: sock.sent }), (e) => ({ err: e.plain, sent: sock.sent })); };

(async () => {
  const good = await ask({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify([{ title: 'Surf', start: '2026-11-23T17:15:00-06:00', end: '2026-11-23T18:30:00-06:00', all_day: false, calendar: 'Personal' }]) }], isError: false } });
  eq(JSON.parse(good.sent), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_events', arguments: { from: '2026-10-26', to: '2026-12-07' } } }); n++;
  eq([good.v.length, good.v[0].summary, good.v[0].calendar], [1, 'Surf', 'Personal']); n++;
  eq((await ask({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: "The user has turned this off in Dateline's settings." }], isError: true } })).err, "Dateline: The user has turned this off in Dateline's settings."); n++;
  assert.match((await ask(null, 'error')).err, /not open, or its Assistant is off/); n++;
  assert.match((await ask(null, 'close')).err, /did not let LifeWorld/); n++;
  // No answer at all (Dateline asking the person whether LifeWorld may connect): the wait ends with a plain line.
  const slow = await new Promise((res) => { T.askDateline(() => { const s = new EventEmitter(); s.setEncoding = () => {}; s.destroy = () => {}; s.write = () => {}; return s; }, '/x', 'a', 'b', 20).catch((e) => res(e.plain)); });
  assert.match(slow, /asking whether LifeWorld may use your calendar/); n++;

  // Focus timer.
  ok(() => eq([T.mmss(25 * 60000), T.mmss(61000), T.mmss(1), T.mmss(0)], ['25:00', '1:01', '0:01', '0:00']));
  ok(() => eq([T.focusLeft({ endsAt: 1000, left: null }, 400), T.focusLeft({ endsAt: 1000, left: 5000 }, 99999), T.focusLeft({ endsAt: 1000, left: null }, 5000)], [600, 5000, 0]));
  ok(() => eq([T.focusDone({ day: '2026-11-23', done: 2 }, '2026-11-23'), T.focusDone({ day: '2026-11-22', done: 2 }, '2026-11-23')], [2, 0], 'the count starts again each day'));

  // Vault stats.
  ok(() => eq(T.countWords('---\ntags: [a, b]\n---\n# Title here\nOne two, three. [[Link note]] ```code block``` four'), 8));
  ok(() => eq(T.linkStats(['a.md', 'b.md', 'c.md', 'd.md'], { 'a.md': { 'b.md': 2, 'a.md': 1 }, 'c.md': { 'c.md': 3 } }), { links: 2, unlinked: ['c.md', 'd.md'] }, 'a link to itself does not count'));
  ok(() => eq([T.weekStart('2026-11-23'), T.weekStart('2026-11-29'), T.weekStart('2026-12-01')], ['2026-11-23', '2026-11-23', '2026-11-30']));
  ok(() => eq([T.bigNumber(4812), T.bigNumber(18406), T.bigNumber(1920000), T.bigNumber(1000000)], ['4,812', '18.4k', '1.92M', '1M']));
  ok(() => eq([T.deltaText(0), T.deltaText(37), T.deltaText(-11400)], ['', '+37', '−11.4k']));

  // Daily quote.
  ok(() => eq(T.parseQuotes('# Mine\n- Do it now — Me\n- "Plain one"\n* Dash - Someone Else\n- [ ] a task\ntext line'), [{ text: 'Do it now', author: 'Me' }, { text: 'Plain one', author: '' }, { text: 'Dash', author: 'Someone Else' }]));
  ok(() => { const a = T.quoteFor(T.QUOTES, '2026-11-23', 0); eq(T.quoteFor(T.QUOTES, '2026-11-23', 0), a, 'same quote all day'); assert.notStrictEqual(T.quoteFor(T.QUOTES, '2026-11-23', 1), a); eq(T.quoteFor([], '2026-11-23', 0), null); eq(T.quoteFor(['x', 'y'], '2026-11-23', -7) != null, true); });

  // Countdowns and birthdays.
  ok(() => eq([T.nextDate({ date: '2026-11-26', yearly: false }, '2026-11-23'), T.nextDate({ date: '2026-11-20', yearly: false }, '2026-11-23'), T.nextDate({ date: '2020-02-29', yearly: true }, '2026-11-23'), T.nextDate({ date: '2020-02-29', yearly: true }, '2027-03-01'), T.nextDate({ date: '1999-11-23', yearly: true }, '2026-11-23')], ['2026-11-26', null, '2027-02-28', '2028-02-29', '2026-11-23']));
  ok(() => eq(T.countdownRows([{ name: 'Christmas', date: '2026-12-25', yearly: true }, { name: 'Gone', date: '2026-01-01', yearly: false }, { name: 'Thanksgiving', date: '2026-11-26', yearly: false }], [{ name: 'Sam', date: '2003-02-12', known: true }, { name: 'Lee', date: '2000-11-23', known: false }], '2026-11-23').map((r) => [r.name, r.days, r.turns, r.own]),
    [["Lee's birthday", 0, 0, -1], ['Thanksgiving', 3, 0, 2], ['Christmas', 32, 0, 0], ["Sam's birthday", 81, 24, -1]]));
  ok(() => eq([T.birthdayOf('1990-03-14'), T.birthdayOf('--03-14'), T.birthdayOf('03-14'), T.birthdayOf('02-30'), T.birthdayOf('1990-02-30'), T.birthdayOf('soon'), T.birthdayOf(null)], [{ date: '1990-03-14', known: true }, { date: '2000-03-14', known: false }, { date: '2000-03-14', known: false }, null, null, null, null]));
  ok(() => eq([T.daysWord(0), T.daysWord(1), T.daysWord(5)], ['Today', 'Tomorrow', '5 days']));

  // On this day, random note.
  ok(() => eq(T.onThisDay([{ date: '2024-11-23' }, { date: '2025-11-23' }, { date: '2026-11-23' }, { date: '2025-11-22' }], '2026-11-23'), [{ date: '2025-11-23' }, { date: '2024-11-23' }]));
  ok(() => eq([T.yearsAgo('2025-11-23', '2026-11-23'), T.yearsAgo('2023-11-23', '2026-11-23')], ['2025 · 1 year ago', '2023 · 3 years ago']));
  ok(() => eq([T.excluded('Templates/a.md', ['Templates']), T.excluded('Templates2/a.md', ['Templates']), T.excluded('a.md', [])], [true, false, false]));
  ok(() => { eq(T.pickOne(['a', 'b'], 'a', () => 0.99), 'b', 'never the same note twice in a row'); eq(T.pickOne(['a'], 'a', () => 0), 'a'); eq(T.pickOne([], null, Math.random), null); });

  // The wide row: only the Month calendar lives there, and it goes nowhere else.
  ok(() => {
    let l = T.defaultLayout();
    eq(l.zones.wide, []);
    l = T.setWidgetOn(l, 'monthcal', true);
    eq(l.zones.wide, ['monthcal'], 'switched on: in the wide row');
    eq(T.placeWidget(l, 'monthcal', 'c1', 0), l, 'cannot be dropped in a column');
    eq(T.placeWidget(l, 'calendar', 'wide', 0).zones.wide, ['monthcal'], 'a column card cannot go in the wide row');
    eq([T.canMoveWidget(l, 'monthcal', 1), T.canMoveWidget(l, 'monthcal', -1)], [false, false]);
    const top = l.zones.c1[0];
    eq(T.moveWidget(l, top, -1).zones.wide, ['monthcal'], 'moving up from Left never enters the wide row');
    eq(T.addWidget(T.removeWidget(l, 'monthcal'), 'monthcal').zones.wide, ['monthcal'], 'Add widget puts it back in the wide row');
    eq(T.normalizeLayout({ zones: { top: [], wide: ['calendar'], c1: ['monthcal'], c2: [], c3: [] }, hidden: [] }).zones.wide, ['monthcal'], 'a hand-edited layout is put right');
    const old = T.normalizeLayout({ zones: { top: ['capture'], c1: ['morning'], c2: ['calendar'], c3: [] }, hidden: [] });
    eq([old.zones.wide, ['monthcal', 'focus', 'countdowns', 'vaultstats', 'quote', 'onthisday', 'randomnote'].every((id) => old.hidden.includes(id))], [[], true], 'an existing layout: the new widgets start off');
  });

  console.log(`extras self-check: OK (${n} checks)`);
})().catch((e) => { console.error(e); process.exit(1); });
