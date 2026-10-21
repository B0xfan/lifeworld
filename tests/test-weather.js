// Weather for a town (launch section 7, criteria 33 to 35): Open-Meteo's answers (made up here in their
// documented shape) become the weather strip's data; tides from Open-Meteo's sea level, or Stormglass with
// a key at most once a day per place, falling back to Open-Meteo. No network: the fetch is a stand-in.
'use strict';
const assert = require('assert');
const path = require('path');
const Module = require('module');

let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (v, m) => { assert.ok(v, m); n++; };
const web = { calls: [], answer: null };
const ob = { requestUrl: async (r) => { web.calls.push(r); return web.answer(r); }, Platform: {}, TFile: class {}, moment: require('moment') };
const ld = Module._load;
Module._load = function (req, ...a) { return req === 'obsidian' ? ob : ld.call(this, req, ...a); };
const ROOT = path.join(__dirname, '..');
const code = require('esbuild').buildSync({ entryPoints: [path.join(ROOT, 'src', 'core', 'weather.js')], bundle: true, format: 'cjs', platform: 'node', external: ['obsidian'], write: false, logLevel: 'error' }).outputFiles[0].text;
const m = new Module(path.join(ROOT, 'weather-bundle.js')); m.paths = Module._nodeModulePaths(ROOT); m._compile(code, m.id);
const W = m.exports;

const FORECAST = {
  timezone: 'America/Regina',
  current: { time: '2026-10-19T09:45', temperature_2m: 24.4, weather_code: 2 },
  hourly: { time: Array.from({ length: 48 }, (_, h) => `2026-10-${h < 24 ? 19 : 20}T${String(h % 24).padStart(2, '0')}:00`), temperature_2m: Array.from({ length: 48 }, (_, h) => 20 + (h % 24) / 2) },
  daily: { time: ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'], weather_code: [2, 61, 3, 0, 1, 2, 95], temperature_2m_max: [27, 28, 26, 29, 30, 31, 25], temperature_2m_min: [19, 20, 18, 21, 22, 23, 17], precipitation_probability_max: [20, 80, 10, 0, 5, 15, 90], sunrise: ['2026-10-19T05:35', '', '', '', '', '', ''], sunset: ['2026-10-19T17:28', '', '', '', '', '', ''] },
};

(async () => {
  eq(W.normalizeWeather({}), { place: null, span: 'hours', units: 'c', tides: true, tideSrc: 'om' }, 'defaults: next hours, Celsius, tides on from Open-Meteo');
  const w = W.fromOpenMeteo(FORECAST, 'hours', Date.UTC(2026, 9, 19, 15, 45));
  eq([w.temp, w.weathercode, w.description, w.high, w.low, w.rain_chance, w.sunrise, w.sunset], [24.4, 2, 'Partly cloudy', 27, 19, 20, '5:35 AM', '5:28 PM'], 'now, today\'s range, rain chance, sun times, in the place\'s own clock');
  eq(w.next, ['10 AM 25°', '11 AM 26°', '12 PM 26°', '1 PM 27°', '2 PM 27°', '3 PM 28°'], 'Next 6 hours, from the hour after now');
  eq(W.fromOpenMeteo(FORECAST, 'days').next, ['Tue 28°/20°', 'Wed 26°/18°', 'Thu 29°/21°', 'Fri 30°/22°', 'Sat 31°/23°', 'Sun 25°/17°'], 'Next 6 days, high and low');
  // Tides from hourly sea level: a 12.4 h tide, extremes found between the hours.
  const times = Array.from({ length: 48 }, (_, h) => `2026-10-${h < 24 ? 19 : 20}T${String(h % 24).padStart(2, '0')}:00`);
  const levels = times.map((_, h) => Math.cos(((h - 4.2) / 12.42) * 2 * Math.PI));
  const tides = W.tidesFromSeaLevel(times, levels, '2026-10-19');
  eq(tides.map((t) => t.type), ['high', 'low', 'high', 'low'], 'two highs and two lows in a day');
  const mins = (t) => { const [, h, mm, ap] = /(\d+):(\d+) (AM|PM)/.exec(t); return (Number(h) % 12 + (ap === 'PM' ? 12 : 0)) * 60 + Number(mm); };
  ok(Math.abs(mins(tides[0].time) - (4 * 60 + 12)) <= 2, `the first high near 4:12, refined between the hours (got ${tides[0].time})`);
  eq(W.tidesFromSeaLevel(times, times.map(() => null), '2026-10-19'), [], 'inland (no sea level): no tides');
  const sg = W.tidesFromStormglass([{ height: 1.2, time: '2026-10-19 10:12:00+00:00', type: 'high' }, { height: 0.1, time: '2026-10-19 16:30:00+00:00', type: 'low' }, { height: 1, time: '2026-10-20 10:50:00+00:00', type: 'high' }], '2026-10-19', 'America/Regina');
  eq(sg, [{ type: 'high', time: '4:12 AM' }, { type: 'low', time: '10:30 AM' }], 'Stormglass times in the place\'s time zone, today only');

  // Fetching: the forecast and the marine sea level; Stormglass once a day per place, kept on the device.
  const store = {}; const fired = [];
  const app = { loadLocalStorage: (k) => (k in store ? store[k] : null), saveLocalStorage: (k, v) => { if (v == null) delete store[k]; else store[k] = v; }, workspace: { trigger: (e) => fired.push(e) } };
  const MARINE = { hourly: { time: times, sea_level_height_msl: levels } };
  let sgFails = false;
  web.answer = (r) => {
    if (r.url.startsWith('https://api.open-meteo.com/v1/forecast')) return { status: 200, json: FORECAST };
    if (r.url.startsWith('https://marine-api.open-meteo.com/v1/marine')) return { status: 200, json: MARINE };
    if (r.url.startsWith('https://api.stormglass.io/v2/tide/extremes/point')) return sgFails === 'blip' ? (() => { throw new Error('offline'); })() : sgFails ? { status: 402, json: null } : { status: 200, json: { data: [{ time: '2026-10-19 10:12:00+00:00', type: 'high' }] } };
    return { status: 404, json: null };
  };
  const cfg = { place: { name: 'Springfield', lat: 9.98, lon: -85.65 }, units: 'f', tides: true, tideSrc: 'om' };
  eq(W.weatherFor(app, { place: null }), null, 'no town yet: nothing fetched, nothing shown');
  eq(web.calls.length, 0, 'and no call made');
  await W.refreshWeather(app, W.normalizeWeather(cfg));
  ok(web.calls[0].url.includes('temperature_unit=fahrenheit') && web.calls[0].url.includes('latitude=9.98') && web.calls.some((c) => c.url.includes('marine-api')), 'Fahrenheit asked for when set; the marine sea level for tides');
  ok(fired.includes('lifeworld:weather') && W.weatherFor(app, cfg).tides_today.length === 4, 'Open-Meteo tides by default (criterion 34)');
  // Stormglass chosen, no key: falls back to Open-Meteo, no Stormglass call.
  web.calls.length = 0;
  await W.refreshWeather(app, W.normalizeWeather({ ...cfg, tideSrc: 'sg' }));
  ok(!web.calls.some((c) => c.url.includes('stormglass')) && web.calls.some((c) => c.url.includes('marine-api')), 'Stormglass without a key: Open-Meteo instead (criterion 35)');
  // With a key: called once, kept for the day; a second read uses the kept answer.
  store['lifeworld-key-stormglass'] = 'sg-secret-key';
  web.calls.length = 0;
  await W.refreshWeather(app, W.normalizeWeather({ ...cfg, tideSrc: 'sg' }));
  const sgCalls = () => web.calls.filter((c) => c.url.includes('stormglass'));
  eq([sgCalls().length, sgCalls()[0].headers.Authorization], [1, 'sg-secret-key'], 'Stormglass called with the key in its header');
  web.calls.length = 0;
  await W.refreshWeather(app, W.normalizeWeather({ ...cfg, tideSrc: 'sg' }));
  eq(sgCalls().length, 0, 'at most once a day per place: the kept answer is used (criterion 35)');
  // A failing Stormglass call: Open-Meteo tides instead.
  delete store['lifeworld-tides-stormglass']; sgFails = true;
  const logs = []; const cw = console.warn; console.warn = (...x) => logs.push(x.join(' '));
  try { web.calls.length = 0; await W.refreshWeather(app, W.normalizeWeather({ ...cfg, tideSrc: 'sg' })); } finally { console.warn = cw; }
  ok(sgCalls().length === 1 && web.calls.some((c) => c.url.includes('marine-api')) && W.weatherFor(app, { ...cfg, tideSrc: 'sg' }).tides_today.length === 4, 'Stormglass failed: Open-Meteo tides (criterion 35)');
  ok(!logs.some((l) => l.includes('sg-secret')), 'the key is never logged');
  web.calls.length = 0; console.warn = () => {};
  try { await W.refreshWeather(app, W.normalizeWeather({ ...cfg, tideSrc: 'sg' })); } finally { console.warn = cw; }
  eq(sgCalls().length, 0, 'a refused Stormglass call (402) is not tried again the same day (review r1 #3)');
  delete store[W.SG_KEY]; sgFails = 'blip'; console.warn = () => {};
  try { await W.refreshWeather(app, W.normalizeWeather({ ...cfg, tideSrc: 'sg' })); web.calls.length = 0; await W.refreshWeather(app, W.normalizeWeather({ ...cfg, tideSrc: 'sg' })); } finally { console.warn = cw; }
  eq(sgCalls().length, 1, 'a Stormglass network blip is tried again on the next refresh (review r2)');
  // A key pasted while a fetch runs: one more fetch after it (review r2).
  web.calls.length = 0; const first = W.refreshWeather(app, W.normalizeWeather(cfg)); await W.refreshWeather(app, W.normalizeWeather(cfg), true); await first;
  eq(web.calls.filter((c) => c.url.includes('/v1/forecast')).length, 2, 'refresh asked again mid-fetch: fetched once more after the running one');
  sgFails = false; store[W.SG_KEY] = null; delete store[W.SG_KEY]; // what a new key in Settings does
  // Another town: nothing (Reading the forecast) rather than the old town's forecast.
  eq(W.weatherFor(app, { ...cfg, tideSrc: 'sg', place: { name: 'Elsewhere', lat: 1, lon: 2 } }), null, 'another town: never the old town\'s forecast while the new one loads (review r1 #14)');
  await W.refreshWeather(app, W.normalizeWeather(cfg)); // joins the fetch for that town, started by the look above
  await W.refreshWeather(app, W.normalizeWeather({ ...cfg, tideSrc: 'sg' }));
  // No internet: a short message, the last forecast kept.
  web.answer = () => { throw new Error('offline'); };
  const cw2 = console.warn; console.warn = () => {};
  const same = { ...cfg, tideSrc: 'sg' };
  try { await W.refreshWeather(app, W.normalizeWeather(same)); } finally { console.warn = cw2; }
  ok(W.weatherError().startsWith('Could not reach the forecast') && W.weatherFor(app, same) && W.weatherFor(app, same).temp === 24.4, 'no internet: a short message; the last forecast stays');
  web.answer = () => ({ status: 500, json: null }); console.warn = () => {};
  try { await W.refreshWeather(app, W.normalizeWeather({ ...same, units: 'c' })); } finally { console.warn = cw2; }
  eq(W.weatherError(), 'The forecast answered with an error (500).', 'nothing kept for the new settings: the message does not claim to show the last one (review r2)');
  // Place search (Weather's town search, also World clock's Add a place, 2026-10-20): each match brings its time zone.
  web.answer = (r) => (r.url.startsWith('https://geocoding-api.open-meteo.com/v1/search?name=Windsor') ? { status: 200, json: { results: [
    { name: 'Windsor', admin1: 'Colorado', country: 'United States', latitude: 40.48, longitude: -104.9, timezone: 'America/Denver' },
    { name: 'Windsor', admin1: 'Ontario', country: 'Canada', latitude: 42.3, longitude: -83.03, timezone: 'America/Toronto' }] } } : { status: 404, json: null });
  const found = await W.findPlaces(' Windsor ');
  eq(found, [{ name: 'Windsor, Colorado, United States', lat: 40.48, lon: -104.9, tz: 'America/Denver', short: 'Windsor, Colorado' }, { name: 'Windsor, Ontario, Canada', lat: 42.3, lon: -83.03, tz: 'America/Toronto', short: 'Windsor, Ontario' }], 'place search: full name for the picker, the time zone, and the name without the country');
  eq(W.normalizeWeather({ place: found[0] }).place, { name: 'Windsor, Colorado, United States', lat: 40.48, lon: -104.9 }, 'Weather saves the same fields as before (the time zone is not kept)');
  let sent = ''; web.answer = (r) => { sent = r.url; return { status: 200, json: { results: [] } }; };
  await W.findPlaces(` ${'x'.repeat(200)} `);
  eq(new URL(sent).searchParams.get('name'), 'x'.repeat(80), 'place search: the typed text is cut to 80 characters (a long paste is not sent whole)');
  await W.findPlaces(`${'x'.repeat(79)}\u{1F600}yz`);
  eq(new URL(sent).searchParams.get('name'), `${'x'.repeat(79)}\u{1F600}`, 'place search: an emoji at position 80 is kept whole, never cut in half (review s1: half of one threw "URI malformed")');
  console.log(`weather self-check: OK (${n} checks)`);
})().catch((e) => { console.error(e); process.exit(1); });
