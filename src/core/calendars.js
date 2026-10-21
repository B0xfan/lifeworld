// Calendar links (launch section 6): read-only calendar addresses (ICS) pasted in Settings, from
// Google, Apple or Outlook. Their events show on Today's Calendar card and in the Planner, in the same
// shape the calendar note gives ({ date, time, end, all_day, summary, calendar }), at local time,
// with weekly and monthly repeats and a single moved or deleted occurrence of a repeat.
//
// Repeats, single-occurrence changes and time zones are read by ical.js (Mozilla, MPL-2.0; the
// widely used calendar library the owner approved 2026-10-19, picked as the smallest well-known one that
// does all of that). The links are private addresses, so they are kept like the task keys: in
// Obsidian's per-vault local storage on this device, never in the settings file or a note.
'use strict';

import ICAL from 'ical.js';
import { requestUrl } from 'obsidian';
import { dayOf, addDays, pad2 } from './dates';
import { errStatus } from './sources';

const LINKS_KEY = 'lifeworld-calendar-links';
const REFRESH_MS = 30 * 60 * 1000;
const BACK_DAYS = 62; // occurrences kept from two months back...
const AHEAD_DAYS = 400; // ...to a year and a bit ahead (the Planner's Month view can look ahead)
const KEEP_MS = 2 * 24 * 3600 * 1000; // a link that keeps failing shows its last good events for 2 days, then none
const MAX_STEPS = 20000; // repeat steps walked per event, from its first day (a daily event since 1970 fits)

// Saved links: [{ id, url, name }]. An old http:// link stays saved (never erased) but is never fetched.
/** @param {{ url: string }} l */
const isHttp = (l) => /^http:\/\//i.test(l.url);
/** @param {unknown} raw @returns {CalLink[]} */
function normalizeLinks(raw) {
  return Array.isArray(raw) ? /** @type {Fm[]} */ (raw).filter((l) => l && typeof l.url === 'string' && /^(https?|webcal):\/\//i.test(l.url.trim()) && typeof l.id === 'string')
    .map((l) => ({ id: /** @type {string} */ (l.id), url: /** @type {string} */ (l.url).trim(), name: typeof l.name === 'string' && l.name.trim() ? l.name.trim().slice(0, 60) : 'Calendar', ...(l.named ? { named: true } : {}) })) : [];
}
/** @param {import('obsidian').App | null | undefined} app */
function linksOf(app) { try { return normalizeLinks(app && app.loadLocalStorage ? app.loadLocalStorage(LINKS_KEY) : null); } catch { return []; } }
/** @param {import('obsidian').App | null | undefined} app @param {unknown} list */
function saveLinks(app, list) { if (app && app.saveLocalStorage) app.saveLocalStorage(LINKS_KEY, normalizeLinks(list).length ? normalizeLinks(list) : null); }
// webcal:// is the same address over https.
/** @param {string} url */
const fetchUrl = (url) => url.replace(/^webcal:\/\//i, 'https://');

// A JS Date -> the note feed's local 'YYYY-MM-DD' and 'HH:MM'.
/** @param {Date} d */
const hhmm = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

// ICS text -> { name, events: [{ date, time, end, all_day, summary, calendar }] } for occurrences between
// `from` and `to` ('YYYY-MM-DD', inclusive), each at local time. Pure (no Obsidian), unit-tested.
/** @param {unknown} text @param {string | null} calName @param {string} from @param {string} to */
function eventsFromIcs(text, calName, from, to) {
  const jcal = /** @type {unknown} */ (ICAL.parse(String(text))); // ical.js types its answer as any
  const root = new ICAL.Component(/** @type {unknown[]} */ (jcal));
  for (const tz of root.getAllSubcomponents('vtimezone')) { try { ICAL.TimezoneService.register(tz); } catch { /* a zone it cannot read: times there read as local */ } }
  const name = calName || /** @type {string | null} */ (root.getFirstPropertyValue('x-wr-calname')) || 'Calendar';
  /** @type {CalEvent[]} */
  const out = [];
  /** @param {ICAL.Time} start @param {ICAL.Time | null | undefined} end @param {unknown} summary */
  const push = (start, end, summary) => {
    const allDay = start.isDate;
    const s = start.toJSDate();
    const date = allDay ? `${start.year}-${pad2(start.month)}-${pad2(start.day)}` : dayOf(s);
    if (date < from || date > to) return;
    out.push({ date, time: allDay ? null : hhmm(s), end: allDay || !end ? null : hhmm(end.toJSDate()), all_day: allDay, summary: String(summary || '(untitled)'), calendar: name });
  };
  const fromT = ICAL.Time.fromDateString(from);
  const toT = ICAL.Time.fromDateString(addDays(to, 1));
  for (const comp of root.getAllSubcomponents('vevent')) {
    if (comp.hasProperty('recurrence-id')) continue; // a changed occurrence: drawn through its series below
    const ev = new ICAL.Event(comp);
    if (String(comp.getFirstPropertyValue('status') || '').toUpperCase() === 'CANCELLED') continue;
    if (!ev.startDate) continue;
    if (!ev.isRecurring()) { push(ev.startDate, ev.endDate, ev.summary); continue; }
    const it = ev.iterator();
    let next; let k = 0;
    while ((next = it.next()) && k++ < MAX_STEPS) {
      if (next.compare(toT) >= 0) break;
      const d = ev.getOccurrenceDetails(next); // a single changed occurrence (RECURRENCE-ID) comes back changed
      const item = d.item || ev;
      if (String(item.component.getFirstPropertyValue('status') || '').toUpperCase() === 'CANCELLED') continue;
      if (d.endDate && d.endDate.compare(fromT) < 0 && d.startDate.compare(fromT) < 0) continue;
      push(d.startDate, d.endDate, item.summary);
    }
  }
  return { name, events: out };
}

// The fetched calendars, kept for this Obsidian session: one copy for Today and the Planner.
/** @type {{ at: number, day: string, events: CalEvent[], byLink: Record<string, { at: number, events: CalEvent[] }>, errors: Record<string, string>, loading: Promise<void> | null, stale: boolean }} */
const cache = { at: 0, day: '', events: [], byLink: {}, errors: {}, loading: null, stale: false };

// Today's events from every link (refetched every 30 minutes and at a new day). onChange: told after a fetch.
/** @param {import('obsidian').App} app @param {() => void} [onChange] */
function calendarEvents(app, onChange) {
  const today = dayOf(new Date());
  if (!linksOf(app).some((l) => !isHttp(l))) return []; // none set: nothing to fetch (the owner's setup, a new install)
  if (!cache.loading && (Date.now() - cache.at > REFRESH_MS || cache.day !== today)) refreshCalendars(app).then(() => onChange && onChange());
  return cache.events;
}

/** @param {import('obsidian').App} app @returns {Promise<void>} */
function refreshCalendars(app) {
  // A reset during a running fetch (a link added or removed): wait it out, then fetch once more.
  if (cache.loading) return cache.stale ? cache.loading.then(() => refreshCalendars(app)) : cache.loading;
  cache.stale = false;
  const links = linksOf(app).filter((l) => !isHttp(l));
  cache.loading = (async () => {
    const today = dayOf(new Date());
    /** @type {Record<string, string>} */
    const errors = {};
    /** @type {Record<string, string>} */
    const names = {};
    for (const l of links) {
      try {
        const r = await requestUrl({ url: fetchUrl(l.url), method: 'GET', throw: false });
        if (r.status >= 400) throw Object.assign(new Error('http'), { status: r.status });
        const got = eventsFromIcs(r.text, l.named ? l.name : null, addDays(today, -BACK_DAYS), addDays(today, AHEAD_DAYS));
        cache.byLink[l.id] = { at: Date.now(), events: got.events };
        if (!l.named && got.name !== l.name) names[l.id] = got.name;
      } catch (e) {
        // The link itself is never logged (it is a private address).
        const status = errStatus(e);
        errors[l.id] = status ? `The calendar answered with an error (${String(status)}).` : 'Could not read this calendar. Check the link and the internet connection.';
        console.warn(`LifeWorld: calendar "${l.name}" could not be read`);
      }
    }
    // Names go onto the list as it is now: a link added or removed in Settings mid-fetch stays so.
    if (Object.keys(names).length) saveLinks(app, linksOf(app).map((x) => x.id in names && !x.named ? { ...x, name: names[x.id] } : x));
    // A link that failed keeps its last good events (up to KEEP_MS); a removed link's are dropped.
    cache.events = links.flatMap((l) => { const b = cache.byLink[l.id]; return b && Date.now() - b.at < KEEP_MS ? b.events : []; }); cache.errors = errors; cache.at = Date.now(); cache.day = today;
    if (app.workspace) app.workspace.trigger('lifeworld:calendars');
  })().finally(() => { cache.loading = null; }); // cleared here: with no link to fetch the body ends before cache.loading is set
  return cache.loading;
}
function calendarErrors() { return cache.errors; }
// Forget what was fetched (a link added or removed): the next look fetches again.
function resetCalendars() { cache.at = 0; cache.byLink = {}; cache.stale = true; }

export { isHttp, normalizeLinks, linksOf, saveLinks, fetchUrl, eventsFromIcs, calendarEvents, refreshCalendars, calendarErrors, resetCalendars };
