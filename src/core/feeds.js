// News feeds (phase 4): headlines from feeds a person adds. Off until the widget is on: nothing here runs
// otherwise. Read with the browser's own XML reader, text only. The last results stay on this device.
'use strict';

import { requestUrl } from 'obsidian';
import { minutesWords } from './dates';

const CACHE_KEY = 'lifeworld-news';
const HOUR = 3600000;
const TIMEOUT_MS = 15000;
const MAX_CHARS = 5000000;
const KEEP_ITEMS = 12;
const MAX_FEEDS = 30;
const SHOW_CHOICES = [5, 8, 12];

/** @typedef {{ url: string, name: string }} Feed */
/** @typedef {{ title: string, link: string, at: number }} Headline */
/** @typedef {{ at: number, title: string, items: Headline[], error: string }} FeedResult */

// An http or https address in its full form, or ''.
/** @param {unknown} raw @param {string} [base] */
function cleanFeedUrl(raw, base) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return ''; // blank would come back as the feed's own address
  try {
    const u = new URL(text, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
  } catch { return ''; }
}

/** @param {unknown} raw @returns {Feed[]} */
function normalizeFeeds(raw) {
  /** @type {Feed[]} */
  const out = [];
  for (const f of Array.isArray(raw) ? /** @type {{ url?: unknown, name?: unknown }[]} */ (raw) : []) {
    const url = f ? cleanFeedUrl(f.url) : '';
    if (url && out.length < MAX_FEEDS && !out.some((x) => x.url === url)) out.push({ url, name: typeof f.name === 'string' ? f.name.trim().slice(0, 80) : '' });
  }
  return out;
}

/** @param {unknown} v */
function normalizeFeedCount(v) { return SHOW_CHOICES.includes(/** @type {number} */ (v)) ? /** @type {number} */ (v) : 8; }

/** @param {Element} el @param {string[]} names */
function childOf(el, names) {
  const kids = Array.from(el.children);
  // The plain element first: a podcast's itunes:title or a media:title may come before the real title.
  return kids.find((c) => names.includes(c.nodeName)) || kids.find((c) => names.includes(c.localName)) || null;
}
/** @param {Element} el @param {string[]} names */
function textOf(el, names) { const c = childOf(el, names); return c && c.textContent ? c.textContent.trim() : ''; }

/** @param {Element} item @param {string} base */
function linkOf(item, base) {
  const links = Array.from(item.children).filter((c) => c.localName === 'link');
  const atom = links.find((l) => (l.getAttribute('href') || '').trim() && (l.getAttribute('rel') || 'alternate') === 'alternate');
  const rss = links.map((l) => (l.getAttribute('href') ? '' : (l.textContent || '').trim())).find(Boolean);
  // A guid or id is only a link when it is a whole address; many are just a code.
  return cleanFeedUrl(atom ? atom.getAttribute('href') : rss, base) || cleanFeedUrl(textOf(item, ['guid', 'id']));
}

// A title as text: feeds often escape it twice, so an entity left over is decoded. Inside a textarea only entities
// are read, so a real "<" stays. An inert page: nothing in it runs or loads.
/** @param {string} s */
function plainTitle(s) {
  if (!/&(#\d+|#x[0-9a-f]+|[a-z]+);/i.test(s)) return s;
  const box = new DOMParser().parseFromString(`<textarea>${s.replace(/<\/textarea/gi, '&lt;/textarea')}</textarea>`, 'text/html').querySelector('textarea');
  return box ? box.value.trim() : s;
}

// RSS, RDF and Atom text -> { title, items }, newest first. Throws Error('not-feed').
/** @param {string} text @param {string} base the feed's own address, for links written relative to it */
function parseFeed(text, base) {
  const reader = new DOMParser();
  let doc = reader.parseFromString(text.trimStart(), 'text/xml');
  // One &nbsp; or bare & fails strict reading, though most readers accept the feed: try again with those escaped.
  if (doc.querySelector('parsererror')) doc = reader.parseFromString(text.trimStart().replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/gi, '&amp;'), 'text/xml');
  const root = doc.documentElement;
  if (doc.querySelector('parsererror') || !root || !['rss', 'feed', 'RDF'].includes(root.localName)) throw new Error('not-feed');
  const items = Array.from(doc.querySelectorAll('item, entry')).map((el) => {
    // First published before last edited, whichever the file lists first; a date ahead of now counts as no date.
    const at = ['pubDate', 'published', 'date', 'updated'].map((n) => Date.parse(textOf(el, [n]))).find(Number.isFinite);
    return { title: textOf(el, ['title']), link: linkOf(el, base), at: at && at <= Date.now() ? at : 0 };
  }).filter((x) => x.title);
  return {
    title: plainTitle(textOf(childOf(root, ['channel']) || root, ['title'])).slice(0, 80),
    items: items.sort((a, b) => b.at - a.at).slice(0, KEEP_ITEMS).map((x) => ({ ...x, title: plainTitle(x.title).slice(0, 300) })).filter((x) => x.title),
  };
}

/** @param {unknown} e */
function feedError(e) {
  const m = e instanceof Error ? e.message : '';
  if (m === 'not-feed') return "this link isn't a feed";
  if (m === 'too-large') return 'the feed is too large';
  if (/^\d+$/.test(m)) return `the site answered with error ${m}`;
  return "the site didn't answer";
}

/** @param {string} url */
async function readFeed(url) {
  /** @type {number | undefined} */
  let timer;
  // shortcut: Obsidian's requestUrl cannot be stopped, so a late answer still downloads in the background.
  /** @type {Promise<never>} */
  const late = new Promise((_, no) => { timer = window.setTimeout(() => no(new Error('late')), TIMEOUT_MS); });
  try {
    const r = await Promise.race([requestUrl({ url, method: 'GET', throw: false }), late]);
    if (r.status >= 400) throw new Error(String(r.status));
    if (r.text.length > MAX_CHARS) throw new Error('too-large');
    return parseFeed(r.text, url);
  } finally { window.clearTimeout(timer); }
}

/** @param {import('obsidian').App} app @returns {Record<string, FeedResult>} */
function newsResults(app) {
  const v = /** @type {unknown} */ (app.loadLocalStorage(CACHE_KEY));
  return v && typeof v === 'object' ? /** @type {Record<string, FeedResult>} */ (v) : {};
}

// A feed never read, or last read over an hour ago.
/** @param {Record<string, FeedResult>} results @param {Feed[]} feeds @param {number} now */
function feedsStale(results, feeds, now) { return feeds.some((f) => !results[f.url] || now - results[f.url].at >= HOUR); }

/** @type {Promise<void> | null} */
let loading = null;
// Reads the feeds due again, each on its own, so a slow or broken one holds up none of the others.
/** @param {import('obsidian').App} app @param {Feed[]} feeds */
function refreshNews(app, feeds) {
  if (loading) return loading;
  loading = (async () => {
    const before = newsResults(app);
    const now = Date.now();
    app.saveLocalStorage(CACHE_KEY, Object.fromEntries(feeds.filter((f) => before[f.url]).map((f) => [f.url, before[f.url]]))); // removed feeds go
    // Each result is saved and drawn as it lands, so one slow feed holds up nothing.
    await Promise.all(feeds.filter((f) => !before[f.url] || now - before[f.url].at >= HOUR).map(async (f) => {
      const old = before[f.url];
      /** @type {FeedResult} */
      let res;
      try { const r = await readFeed(f.url); res = { at: now, title: r.title, items: r.items, error: '' }; }
      catch (e) { res = { at: now, title: old ? old.title : '', items: old ? old.items : [], error: feedError(e) }; }
      app.saveLocalStorage(CACHE_KEY, { ...newsResults(app), [f.url]: res });
      app.workspace.trigger('lifeworld:news');
    }));
  })().finally(() => { loading = null; });
  return loading;
}

// What the card draws: the newest headlines across the feeds, and the feeds that could not be read.
/** @param {Record<string, FeedResult>} results @param {Feed[]} feeds @param {number} show */
function newsCard(results, feeds, show) {
  /** @param {Feed} f */
  const nameOf = (f) => { const r = results[f.url]; if (f.name) return f.name; if (r && r.title) return r.title; try { return new URL(f.url).hostname; } catch { return f.url; } };
  const items = feeds.flatMap((f) => ((results[f.url] && results[f.url].items) || []).map((x) => ({ ...x, source: nameOf(f) })));
  return {
    headlines: items.sort((a, b) => b.at - a.at).slice(0, show),
    failed: feeds.filter((f) => results[f.url] && results[f.url].error).map((f) => ({ source: nameOf(f), error: results[f.url].error })),
    waiting: feeds.some((f) => !results[f.url]),
  };
}

// '5 min', '3 h', '2 d', or '' when the feed gave no date.
/** @param {number} at @param {number} now */
function newsAge(at, now) {
  if (!at) return '';
  const min = Math.max(0, Math.round((now - at) / 60000));
  return minutesWords(min);
}

export { MAX_FEEDS, SHOW_CHOICES, cleanFeedUrl, normalizeFeeds, normalizeFeedCount, parseFeed, newsResults, feedsStale, refreshNews, newsCard, newsAge };
