// Weather for someone without a weather note (launch section 7): Open-Meteo (free, no account) for a town
// picked in Settings, next hours or next days, Celsius or Fahrenheit; tides from Open-Meteo's marine sea
// level (free, the default) or Stormglass with the person's own key, called at most once a day per place
// and kept, falling back to Open-Meteo when the key is missing or the call fails. Built into the same
// object the weather note gives, so the Today strip draws both the same way. An owner's weather note,
// when set, is used instead and never changes (criterion 36).
// Facts read on the official docs 2026-10-19: open-meteo.com/en/docs (forecast, geocoding, marine),
// docs.stormglass.io/tide.md and authentication.md.
'use strict';

import { requestUrl } from 'obsidian';
import { keyOf } from './sources';
import { dayOf } from './dates';

const REFRESH_MS = 30 * 60 * 1000;
const SG_KEY = 'lifeworld-tides-stormglass'; // the kept Stormglass answer (not a secret: times and heights)
const WMO_WORDS = [[0, 'Clear'], [1, 'Mostly clear'], [2, 'Partly cloudy'], [3, 'Cloudy'], [45, 'Fog'], [48, 'Fog'], [51, 'Light drizzle'], [53, 'Drizzle'], [55, 'Heavy drizzle'], [56, 'Freezing drizzle'], [57, 'Freezing drizzle'], [61, 'Light rain'], [63, 'Rain'], [65, 'Heavy rain'], [66, 'Freezing rain'], [67, 'Freezing rain'], [71, 'Light snow'], [73, 'Snow'], [75, 'Heavy snow'], [77, 'Snow grains'], [80, 'Showers'], [81, 'Showers'], [82, 'Heavy showers'], [85, 'Snow showers'], [86, 'Snow showers'], [95, 'Thunderstorm'], [96, 'Thunderstorm, hail'], [99, 'Thunderstorm, hail']];
const wmoWords = (c) => { const hit = WMO_WORDS.find(([k]) => k === Number(c)); return hit ? hit[1] : ''; };

// Saved settings: { place: { name, lat, lon } | null, span: 'hours' | 'days', units: 'c' | 'f', tides, tideSrc: 'om' | 'sg' }.
function normalizeWeather(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const p = r.place && typeof r.place === 'object' && Number.isFinite(r.place.lat) && Number.isFinite(r.place.lon) ? { name: String(r.place.name || 'Your town').slice(0, 80), lat: r.place.lat, lon: r.place.lon } : null;
  return { place: p, span: r.span === 'days' ? 'days' : 'hours', units: r.units === 'f' ? 'f' : 'c', tides: r.tides !== false, tideSrc: r.tideSrc === 'sg' ? 'sg' : 'om' };
}

// 'YYYY-MM-DDTHH:MM' (a place's own clock) -> '6:05 AM'.
function clock12(iso) { const m = /T(\d{2}):(\d{2})/.exec(String(iso || '')); if (!m) return ''; const h = Number(m[1]); return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`; }
const hourWord = (iso) => { const m = /T(\d{2})/.exec(String(iso || '')); if (!m) return ''; const h = Number(m[1]); return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`; };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayWord = (d) => DAYS[new Date(`${d}T12:00:00Z`).getUTCDay()];

// Open-Meteo's forecast answer -> the weather note's shape, plus `next` (the hours or days line).
function fromOpenMeteo(j, span, now) {
  const c = j.current || {}; const d = j.daily || {}; const h = j.hourly || {};
  const today = String(c.time || '').slice(0, 10) || (d.time && d.time[0]);
  const i = Math.max(0, (d.time || []).indexOf(today));
  let next = [];
  if (span === 'days') next = (d.time || []).slice(i + 1, i + 7).map((day, k) => `${dayWord(day)} ${Math.round(d.temperature_2m_max[i + 1 + k])}°/${Math.round(d.temperature_2m_min[i + 1 + k])}°`);
  else { const start = (h.time || []).findIndex((t) => t > String(c.time || '')); if (start >= 0) next = h.time.slice(start, start + 6).map((t, k) => `${hourWord(t)} ${Math.round(h.temperature_2m[start + k])}°`); }
  return {
    temp: c.temperature_2m, weathercode: c.weather_code, description: wmoWords(c.weather_code),
    high: d.temperature_2m_max ? d.temperature_2m_max[i] : null, low: d.temperature_2m_min ? d.temperature_2m_min[i] : null,
    rain_chance: d.precipitation_probability_max ? d.precipitation_probability_max[i] : null,
    sunrise: clock12(d.sunrise && d.sunrise[i]), sunset: clock12(d.sunset && d.sunset[i]),
    updated: new Date(now || Date.now()).toISOString(), next, day: today, timezone: j.timezone || null,
  };
}

// Hourly sea level (Open-Meteo marine) -> today's high and low tides: each turn of the curve, its time
// refined between the hours by a parabola through the three points. -> [{ type, time }]
function tidesFromSeaLevel(times, levels, day) {
  const out = [];
  for (let k = 1; k < levels.length - 1; k++) {
    const [a, b, c] = [levels[k - 1], levels[k], levels[k + 1]];
    if (![a, b, c].every(Number.isFinite)) continue;
    const high = b > a && b >= c; const low = b < a && b <= c;
    if (!high && !low) continue;
    const denom = a - 2 * b + c;
    const shift = denom ? Math.max(-0.5, Math.min(0.5, (a - c) / (2 * denom))) : 0; // in hours
    const base = new Date(`${times[k]}:00Z`).getTime() + shift * 3600000; // the place's clock, read as if UTC
    const t = new Date(base).toISOString().slice(0, 16);
    if (t.slice(0, 10) !== day) continue;
    out.push({ type: high ? 'high' : 'low', time: clock12(t) });
  }
  return out;
}

// Stormglass extremes -> [{ type, time }] for `day` in the place's time zone.
function tidesFromStormglass(data, day, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || undefined, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return (Array.isArray(data) ? data : []).map((x) => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(String(x.time).replace(' ', 'T'))).map((y) => [y.type, y.value]));
    return { type: x.type === 'high' ? 'high' : 'low', at: `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}` };
  }).filter((x) => x.at.slice(0, 10) === day).map((x) => ({ type: x.type, time: clock12(x.at) }));
}

async function getJson(url, headers) {
  let r;
  try { r = await requestUrl({ url, method: 'GET', headers, throw: false }); } catch { throw new Error('network'); }
  if (r.status >= 400) throw Object.assign(new Error('http'), { status: r.status });
  return r.json;
}

// Town search (Settings): -> [{ name, lat, lon, tz, short }]. tz: the result's IANA time zone; short: the
// name without the country (World clock). Weather keeps only name, lat and lon (normalizeWeather).
// The typed text is cut to 80 characters: a long paste would only be refused by the service (review 2026-10-20).
// Cut by whole characters, not 16-bit units: half an emoji makes encodeURIComponent throw (review s1).
async function findPlaces(text) {
  const j = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(Array.from(String(text).trim()).slice(0, 80).join(''))}&count=8&language=en&format=json`);
  const join = (a) => a.filter(Boolean).filter((v, k, l) => l.indexOf(v) === k).join(', ');
  return ((j && j.results) || []).map((x) => ({ name: join([x.name, x.admin1, x.country]), lat: x.latitude, lon: x.longitude, tz: x.timezone || '', short: join([x.name, x.admin1]) }));
}

const cache = { key: '', at: 0, day: '', data: null, error: '', loading: null };

// The weather for the saved settings (fetched every 30 minutes; the last good one kept). null: no place yet.
function weatherFor(app, settings) {
  const s = normalizeWeather(settings);
  if (!s.place) return null;
  const key = JSON.stringify(s);
  if (!cache.loading && (cache.key !== key || Date.now() - cache.at > REFRESH_MS || cache.day !== dayOf(new Date()))) refreshWeather(app, s);
  return cache.key === key ? cache.data : null; // another town or units: "Reading the forecast" until it lands
}
function weatherError() { return cache.error; }

// again: a fetch already running is waited out, then one more is made (a Stormglass key pasted mid-fetch).
function refreshWeather(app, s, again) {
  if (cache.loading) return again ? cache.loading.then(() => refreshWeather(app, s)) : cache.loading;
  const key = JSON.stringify(s);
  cache.loading = (async () => {
    try {
      const { lat, lon } = s.place;
      const j = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&hourly=temperature_2m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset&timezone=auto&forecast_days=7${s.units === 'f' ? '&temperature_unit=fahrenheit' : ''}`);
      const w = fromOpenMeteo(j, s.span);
      if (s.tides) w.tides_today = await tidesFor(app, s, w.day, w.timezone);
      cache.data = w; cache.error = '';
    } catch (e) {
      if (cache.key !== key) cache.data = null; // never another town's forecast under this one
      cache.error = e && e.status ? `The forecast answered with an error (${e.status}).${cache.data ? ' Showing the last one.' : ''}` : 'Could not reach the forecast. Check the internet connection.';
      console.warn('LifeWorld: the weather could not be read');
    }
    cache.key = key; cache.at = Date.now(); cache.day = dayOf(new Date()); cache.loading = null;
    if (app.workspace) app.workspace.trigger('lifeworld:weather');
  })();
  return cache.loading;
}

// Tides: Stormglass when chosen and a key is set (once a day per place, kept on the device), else Open-Meteo.
async function tidesFor(app, s, day, timeZone) {
  if (s.tideSrc === 'sg' && keyOf(app, 'stormglass')) {
    const place = `${s.place.lat},${s.place.lon}`;
    const kept = app.loadLocalStorage ? app.loadLocalStorage(SG_KEY) : null;
    const keptToday = kept && kept.day === day && kept.place === place;
    if (keptToday && Array.isArray(kept.tides)) return kept.tides;
    // A refused call is kept too (bad key, free plan used up): no second try until tomorrow or a new key.
    if (!keptToday) try {
      const start = Math.floor(Date.now() / 1000) - 36 * 3600; const end = start + 72 * 3600;
      const j = await getJson(`https://api.stormglass.io/v2/tide/extremes/point?lat=${s.place.lat}&lng=${s.place.lon}&start=${start}&end=${end}`, { Authorization: keyOf(app, 'stormglass') });
      const tides = tidesFromStormglass(j && j.data, day, timeZone);
      if (app.saveLocalStorage) app.saveLocalStorage(SG_KEY, { day, place, tides });
      return tides;
    } catch (e) {
      console.warn('LifeWorld: Stormglass tides could not be read; using Open-Meteo');
      if ([401, 402, 403, 429].includes(e && e.status) && app.saveLocalStorage) app.saveLocalStorage(SG_KEY, { day, place, failed: true }); // a network blip tries again next refresh
    }
  }
  try {
    const m = await getJson(`https://marine-api.open-meteo.com/v1/marine?latitude=${s.place.lat}&longitude=${s.place.lon}&hourly=sea_level_height_msl&timezone=auto&past_days=1&forecast_days=2`);
    return tidesFromSeaLevel((m && m.hourly && m.hourly.time) || [], (m && m.hourly && m.hourly.sea_level_height_msl) || [], day);
  } catch { return []; } // inland, or the sea level could not be read: no tides line
}

export { SG_KEY, normalizeWeather, wmoWords, fromOpenMeteo, tidesFromSeaLevel, tidesFromStormglass, findPlaces, weatherFor, weatherError, refreshWeather };
