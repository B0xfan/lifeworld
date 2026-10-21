// Calendar links (launch section 6, criterion 31): a made-up calendar file in the shapes Google, Apple
// and Outlook send, read by ical.js at local time, under several time zones (child processes, as the
// Today suite does). Weekly and monthly repeats, a moved and a deleted single occurrence, a cancelled
// one, an event in another time zone, an all-day event. No network: the fetch is a stand-in.
'use strict';
const assert = require('assert');
const path = require('path');
const Module = require('module');
const { execFileSync } = require('child_process');

const ZONES = ['America/Regina', 'UTC', 'Asia/Kolkata', 'America/New_York', 'Pacific/Kiritimati'];
if (!process.env.LWC_CHILD) {
  let bad = 0;
  for (const tz of ZONES) {
    try { console.log(`${tz.padEnd(22)} ${execFileSync(process.execPath, [__filename], { env: { ...process.env, TZ: tz, LWC_CHILD: '1' }, encoding: 'utf8' }).trim()}`); }
    catch (e) { bad++; console.log(`${tz} FAILED\n${(e.stdout || '') + (e.stderr || '')}`); }
  }
  process.exit(bad ? 1 : 0);
}

let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (v, m) => { assert.ok(v, m); n++; };
const web = { calls: [] };
const ob = { requestUrl: async (r) => { web.calls.push(r.url); return web.answer(r); } };
const ld = Module._load;
Module._load = function (req, ...a) { return req === 'obsidian' ? ob : ld.call(this, req, ...a); };
const ROOT = path.join(__dirname, '..');
const code = require('esbuild').buildSync({ entryPoints: [path.join(ROOT, 'src', 'core', 'calendars.js')], bundle: true, format: 'cjs', platform: 'node', external: ['obsidian'], write: false, logLevel: 'error' }).outputFiles[0].text;
const m = new Module(path.join(ROOT, 'cal-bundle.js')); m.paths = Module._nodeModulePaths(ROOT); m._compile(code, m.id);
const C = m.exports;

// Local wall-clock of an instant, as the plugin shows it.
const local = (iso) => { const d = new Date(iso); const p = (x) => String(x).padStart(2, '0'); return [`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, `${p(d.getHours())}:${p(d.getMinutes())}`]; };

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Example//EN
X-WR-CALNAME:Personal
BEGIN:VTIMEZONE
TZID:Europe/Paris
BEGIN:STANDARD
DTSTART:19701025T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:19700329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VEVENT
UID:weekly-1
DTSTART:20261005T150000Z
DTEND:20261005T160000Z
RRULE:FREQ=WEEKLY;BYDAY=MO
EXDATE:20261019T150000Z
SUMMARY:Team call
END:VEVENT
BEGIN:VEVENT
UID:weekly-1
RECURRENCE-ID:20261026T150000Z
DTSTART:20261027T170000Z
DTEND:20261027T180000Z
SUMMARY:Team call (moved)
END:VEVENT
BEGIN:VEVENT
UID:monthly-1
DTSTART;TZID=Europe/Paris:20260915T090000
DTEND;TZID=Europe/Paris:20260915T100000
RRULE:FREQ=MONTHLY;BYMONTHDAY=15
SUMMARY:Rent check
END:VEVENT
BEGIN:VEVENT
UID:monthly-1
RECURRENCE-ID;TZID=Europe/Paris:20261115T090000
DTSTART;TZID=Europe/Paris:20261115T090000
DTEND;TZID=Europe/Paris:20261115T100000
STATUS:CANCELLED
SUMMARY:Rent check
END:VEVENT
BEGIN:VEVENT
UID:allday-1
DTSTART;VALUE=DATE:20261022
DTEND;VALUE=DATE:20261023
SUMMARY:Car service
END:VEVENT
BEGIN:VEVENT
UID:old-daily
DTSTART:19900101T120000Z
RRULE:FREQ=DAILY
SUMMARY:Since 1990
END:VEVENT
END:VCALENDAR`;

(async () => {
  const r = C.eventsFromIcs(ICS, null, '2026-10-01', '2026-11-30');
  eq(r.name, 'Personal', 'the calendar takes its own name');
  const of = (s) => r.events.filter((e) => e.summary === s).map((e) => [e.date, e.time]);
  eq(of('Team call'), [local('2026-10-05T15:00:00Z'), local('2026-10-12T15:00:00Z'), local('2026-11-02T15:00:00Z'), local('2026-11-09T15:00:00Z'), local('2026-11-16T15:00:00Z'), local('2026-11-23T15:00:00Z'), local('2026-11-30T15:00:00Z')].filter(([d]) => d >= '2026-10-01' && d <= '2026-11-30'),
    'weekly repeat at local time; the deleted occurrence (EXDATE) and the moved one are not in the plain series');
  eq(of('Team call (moved)'), [local('2026-10-27T17:00:00Z')], 'the single moved occurrence shows on its new day and time');
  // Paris 09:00: 07:00Z in summer time (until Oct 25), 08:00Z after.
  eq(of('Rent check'), [local('2026-10-15T07:00:00Z')], 'monthly repeat from another time zone at local time; the cancelled November one is gone');
  eq(r.events.filter((e) => e.summary === 'Car service').map((e) => [e.date, e.time, e.all_day]), [['2026-10-22', null, true]], 'an all-day event stays on its own day in every time zone');
  ok(of('Since 1990').length >= 60, 'a daily repeat that started long ago still reaches today');
  ok(r.events.find((e) => e.summary === 'Team call').end === local('2026-10-05T16:00:00Z')[1] && r.events.every((e) => e.calendar === 'Personal'), 'end time and calendar name, as the calendar note gives them');

  // Links: kept in local storage only; webcal works; a fetch failure is a short message, the link never logged.
  const store = {}; const fired = [];
  const app = { loadLocalStorage: (k) => store[k] || null, saveLocalStorage: (k, v) => { if (v == null) delete store[k]; else store[k] = v; }, workspace: { trigger: (e) => fired.push(e) } };
  C.saveLinks(app, [{ id: 'a', url: ' webcal://example.com/private-abc/basic.ics ', name: 'Personal' }, { id: 'b', url: 'not a link' }]);
  eq(C.linksOf(app), [{ id: 'a', url: 'webcal://example.com/private-abc/basic.ics', name: 'Personal' }], 'a link is saved on this device; something that is not a link is dropped');
  web.answer = () => ({ status: 200, text: ICS });
  const logs = []; const cw = console.warn; console.warn = (...x) => logs.push(x.join(' '));
  try {
    C.resetCalendars(); C.calendarEvents(app); await C.refreshCalendars(app);
    eq(web.calls, ['https://example.com/private-abc/basic.ics'], 'webcal:// is fetched over https');
    ok(C.calendarEvents(app).some((e) => e.summary === 'Team call') && fired.includes('lifeworld:calendars'), 'events ready for Today and the Planner, and the pages are told');
    web.answer = () => ({ status: 404, text: '' });
    await C.refreshCalendars(app);
    eq(C.calendarErrors(), { a: 'The calendar answered with an error (404).' }, 'a broken link: a short message under it in Settings');
    ok(C.calendarEvents(app).some((e) => e.summary === 'Team call'), 'a failed fetch keeps that link\'s last good events (review r1 #7)');
    const now = Date.now; Date.now = () => now() + 3 * 24 * 3600 * 1000;
    try { await C.refreshCalendars(app); } finally { Date.now = now; }
    ok(!C.calendarEvents(app).length, 'a link still failing after 2 days: its old events are no longer shown (review r2)');
  } finally { console.warn = cw; }
  ok(logs.length === 2 && !logs.some((l) => /private-abc|example\.com/.test(l)), 'the private address is never logged');
  web.answer = () => ({ status: 200, text: ICS }); await C.refreshCalendars(app); web.answer = () => ({ status: 404, text: '' });
  C.resetCalendars();
  ok(C.calendarEvents(app).some((e) => e.summary === 'Team call') && (await C.refreshCalendars(app), !C.calendarEvents(app).length), 'a link added or removed: kept events are forgotten too (review r2)');
  web.calls.length = 0;
  C.saveLinks(app, [{ id: 'h', url: 'http://example.com/a.ics', name: 'Old' }]);
  await C.refreshCalendars(app);
  ok(C.linksOf(app).length === 1 && C.isHttp(C.linksOf(app)[0]) && !web.calls.length, 'an old http:// link stays saved but is never fetched: it would send the private address unprotected (review r2)');
  // A slow fetch: a link added in Settings meanwhile is kept when the found name is saved (review r2, calendars.js:103).
  let release; const slow = () => { const gate = new Promise((r) => { release = r; }); web.answer = async () => { await gate; return { status: 200, text: ICS }; }; };
  slow();
  C.saveLinks(app, [{ id: 'a', url: 'https://example.com/a.ics', name: 'Calendar' }]);
  let run = C.refreshCalendars(app);
  C.saveLinks(app, [...C.linksOf(app), { id: 'b', url: 'https://example.com/b.ics', name: 'Work', named: true }]);
  release(); await run;
  eq(C.linksOf(app).map((l) => [l.id, l.name]), [['a', 'Personal'], ['b', 'Work']], 'the found name is saved and the link added mid-fetch stays');
  // A reset during a running fetch: that run is waited out, then the new link is fetched too (review r2, calendars.js:112).
  C.saveLinks(app, [{ id: 'a', url: 'https://example.com/a.ics', name: 'Personal' }]);
  slow(); web.calls.length = 0; run = C.refreshCalendars(app);
  C.saveLinks(app, [...C.linksOf(app), { id: 'b', url: 'https://example.com/b.ics', name: 'Work', named: true }]); C.resetCalendars();
  const after = C.refreshCalendars(app);
  release(); await run; await after;
  eq(web.calls, ['https://example.com/a.ics', 'https://example.com/a.ics', 'https://example.com/b.ics'], 'a refresh after a reset mid-fetch runs once more and reads the new link');
  C.saveLinks(app, []);
  eq(store, {}, 'removing the last link clears it from the device');
  console.log(`${n} checks, 0 failed`);
})().catch((e) => { console.error(e); process.exit(1); });
