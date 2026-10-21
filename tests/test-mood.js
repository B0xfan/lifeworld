// Mood (launch section 9, criteria 39 to 42): the 25-card check-in, its score, the note it saves and the
// link from the daily note, and the Mood page's trend buckets, against an Obsidian stand-in.
'use strict';
const assert = require('assert');
const path = require('path');
const Module = require('module');

let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (v, m) => { assert.ok(v, m); n++; };

// A small DOM stand-in.
const el = (tag) => ({ tag, kids: [], cls: [], attr: {}, text: '', on: {}, style: { setProperty(k, v) { this[k] = v; } }, disabled: false, value: '',
  createEl(t, o) { const d = el(t); if (o && o.text) d.text = o.text; if (o && o.cls) d.cls.push(...String(o.cls).split(' ')); if (o && o.attr) Object.assign(d.attr, o.attr); this.kids.push(d); return d; },
  createDiv(o) { return this.createEl('div', o); }, createSpan(o) { return this.createEl('span', o); }, appendText(t) { this.kids.push({ tag: '#text', text: t, kids: [] }); },
  addClass(...c) { this.cls.push(...c); }, empty() { this.kids = []; }, setAttr(k, v) { this.attr[k] = v; },
  addEventListener(t, f) { (this.on[t] = this.on[t] || []).push(f); }, click() { return Promise.all((this.on.click || []).map((f) => f({}))); } });
const all = (e) => [e, ...(e.kids || []).flatMap(all)];
const textOf = (e) => all(e).map((x) => x.text).join('');
class TFile { constructor(p) { this.path = p; this.extension = 'md'; this.basename = p.split('/').pop().replace(/\.md$/, ''); this.stat = { ctime: 0 }; } }
class TFolder { constructor(p, children) { this.path = p; this.children = children || []; } }
const notices = [];
global.document = { activeElement: null };
class Modal { constructor(app) { this.app = app; this.contentEl = el('div'); this.modalEl = el('div'); this.scope = { keys: {}, register(m, k, f) { this.keys[k] = f; } }; } open() { this.onOpen(); } close() { this.closed = true; this.onClose(); } }
const ob = { Modal, ItemView: class {}, TFile, TFolder, Notice: class { constructor(m) { notices.push(m); } }, setIcon() {}, moment: require('moment') };
const ld = Module._load;
Module._load = function (req, ...a) { return req === 'obsidian' ? ob : ld.call(this, req, ...a); };
const ROOT = path.join(__dirname, '..');
const code = require('esbuild').buildSync({ stdin: { contents: "export * from './src/today/mood'; export { setVault } from './src/core/vault';", resolveDir: ROOT, loader: 'js' }, bundle: true, format: 'cjs', platform: 'node', external: ['obsidian'], write: false, logLevel: 'error' }).outputFiles[0].text;
const m = new Module(path.join(ROOT, 'mood-bundle.js')); m.paths = Module._nodeModulePaths(ROOT); m._compile(code, m.id);
const M = m.exports;

(async () => {
  // The words and the score (the health add-on's lists and formula).
  eq(M.EMOTIONS.length, 25, '25 cards');
  eq([...M.POSITIVE, ...M.NEGATIVE].sort(), M.EMOTIONS.slice().sort(), 'every word is a good one or a hard one, once');
  const ans = (yes) => Object.fromEntries(M.EMOTIONS.map((e) => [e, yes.includes(e) ? 1 : 0]));
  eq(Math.round(M.moodScore(ans(['peaceful', 'tired', 'safe', 'productive', 'loving'])) * 10) / 10, 66.7, 'the score a saved check-in has (66.7 for these five), so old notes and new ones agree (criterion 42)');
  eq([M.moodScore(ans(M.POSITIVE)), M.moodScore(ans(M.NEGATIVE)), Math.round(M.moodScore(ans([])) * 10) / 10], [100, 0, 61.1], 'all good: 100; all hard: 0; nothing felt: 61.1');
  eq([M.scoreTier(70), M.scoreTier(45), M.scoreTier(44.9)], ['g', 'm', 'l'], 'score bands 70 / 45');
  // Trend buckets (30d by day, 6m by Monday-start week, 1y by month), averaged.
  const rows = [{ date: '2026-10-19', score: 80 }, { date: '2026-10-19', score: 60 }, { date: '2026-10-12', score: 50 }, { date: '2026-06-02', score: 40 }, { date: '2025-12-01', score: 10 }];
  eq(M.moodTrend(rows, '30d', '2026-10-19'), [{ bucket: '2026-10-12', avg: 50, xLabel: null }, { bucket: '2026-10-19', avg: 70, xLabel: null }], '30d: a point per day, averaged');
  eq(M.moodTrend(rows, '6m', '2026-10-19').map((p) => [p.bucket, p.avg, p.xLabel]), [['2026-W23', 40, 'Jun'], ['2026-W42', 50, 'Oct'], ['2026-W43', 70, null]], '6m: a point per week, the month named once');
  eq(M.moodTrend(rows, '1y', '2026-10-19').map((p) => [p.bucket, p.avg]), [['2025-12', 10], ['2026-06', 40], ['2026-10', 190 / 3]], '1y: a point per month');
  eq(M.isoWeek('2026-01-01'), '2026-W01', 'ISO weeks');

  // The check-in window: cards, Back, arrow keys, then the result and Save (criterion 39).
  M.setVault({ folders: { mood: 'Mood' } });
  const files = {}; const fms = {}; const folders = [];
  const app = {
    vault: { getAbstractFileByPath: (p) => (p in files ? new TFile(p) : folders.includes(p) ? new TFolder(p) : null), createFolder: async (p) => folders.push(p), create: async (p, c) => { files[p] = c; fms[p] = {}; return new TFile(p); }, process: async (f, fn) => { files[f.path] = fn(files[f.path]); }, read: async (f) => files[f.path] },
    fileManager: { processFrontMatter: async (f, fn) => fn(fms[f.path]) },
    internalPlugins: { getEnabledPluginById: () => ({ options: { folder: 'Days', format: 'YYYY-MM-DD', template: '' } }) },
    metadataCache: { getFileCache: (f) => ({ frontmatter: fms[f.path] }) },
  };
  let done = 0;
  const modal = new M.MoodCheckinModal(app, { styleLook() {} }, () => done++);
  modal.open();
  ok(textOf(modal.contentEl).includes('Do you feel peaceful?') && textOf(modal.contentEl).includes('0 of 25'), 'the first card');
  const back = () => all(modal.contentEl).find((x) => /Back|Change an answer/.test(x.text));
  ok(back().disabled, 'Back is there but off on the first card');
  const btn = (t) => all(modal.contentEl).find((x) => x.tag === 'button' && x.text === t);
  await btn('Yes').click();
  ok(textOf(modal.contentEl).includes('1 of 25') && textOf(modal.contentEl).includes('friendly'), 'Yes moves to the next card');
  await back().click();
  ok(textOf(modal.contentEl).includes('Do you feel peaceful?'), 'Back returns to the card before');
  global.document.activeElement = { tagName: 'TEXTAREA' };
  eq(modal.scope.keys.ArrowRight({ preventDefault() {} }), true, 'arrow keys do nothing while typing in a box');
  ok(textOf(modal.contentEl).includes('Do you feel peaceful?'), 'still the same card');
  global.document.activeElement = null;
  modal.scope.keys.ArrowRight({ preventDefault() {} }); // peaceful: yes
  for (let i = 1; i < 25; i++) { const e = M.EMOTIONS[i]; if (['tired', 'safe', 'productive', 'loving'].includes(e)) modal.scope.keys.ArrowRight({ preventDefault() {} }); else modal.scope.keys.ArrowLeft({ preventDefault() {} }); }
  ok(textOf(modal.contentEl).includes('67') && textOf(modal.contentEl).includes('out of 100'), 'after 25 answers: the score out of 100');
  ok(all(modal.contentEl).some((x) => x.text === 'Felt') && all(modal.contentEl).some((x) => x.text === "Didn't feel"), 'Felt and Didn\'t feel');
  const ta = all(modal.contentEl).find((x) => x.tag === 'textarea');
  ta.value = 'A calm morning'; ta.on.input[0]();
  await btn('Save check-in').click();
  const note = Object.keys(files).find((p) => p.startsWith('Mood/'));
  ok(/^Mood\/\d{4}-\d\d-\d\d \d{4} Mood Check-in\.md$/.test(note), 'saved as one note in the Mood folder, named as before');
  eq(Object.keys(fms[note]), ['type', 'date', 'time', 'score', 'route', 'felt', 'not_felt', 'note', 'created'], 'the same fields, in the same order, as the health add-on writes (criterion 40)');
  eq([fms[note].type, fms[note].score, fms[note].felt, fms[note].not_felt.length, fms[note].note], ['mood-checkin', 66.7, ['peaceful', 'tired', 'safe', 'productive', 'loving'], 20, 'A calm morning'], 'type, score, felt, not felt, note');
  ok(files[note].startsWith('## Note\n\nA calm morning'), 'the note text in its body');
  const day = Object.keys(files).find((p) => p.startsWith('Days/'));
  ok(day && /## Mood\n\n- \d{1,2}:\d\d [AP]M: \[\[\d{4}-\d\d-\d\d \d{4} Mood Check-in\|mood check-in, 67\]\]\n$/.test(files[day]), "linked from that day's daily note (criterion 40)");
  ok(modal.closed && done === 1 && notices.includes('Mood check-in saved.'), 'the window closes and the page redraws');
  const proc = app.vault.process; app.vault.process = async () => { throw new Error('locked'); };
  const before = Object.keys(files).filter((p) => p.startsWith('Mood/')).length;
  const cw = console.warn; console.warn = () => {};
  try { await M.saveCheckin(app, { score: 50, felt: [], notFelt: [], note: '' }); } finally { console.warn = cw; app.vault.process = proc; }
  eq(Object.keys(files).filter((p) => p.startsWith('Mood/')).length, before + 1, 'the daily note line failing does not fail the save, so no retry makes a second check-in (review r1 #12)');
  // The Mood page reads them newest first (criterion 41).
  folders.length = 0;
  const f1 = new TFile('Mood/a.md'); const f2 = new TFile('Mood/b.md'); f2.stat.ctime = 5;
  fms['Mood/a.md'] = { type: 'mood-checkin', date: '2026-10-18', score: 50 }; fms['Mood/b.md'] = { type: 'mood-checkin', date: '2026-10-18', score: 71, felt: ['calm'] };
  app.vault.getAbstractFileByPath = (p) => (p === 'Mood' ? new TFolder('Mood', [f1, f2, new TFile('Mood/other.md')]) : null);
  fms['Mood/other.md'] = { type: 'note' };
  eq(M.collectMood(app).map((r) => [r.path, r.score]), [['Mood/b.md', 71], ['Mood/a.md', 50]], 'the Mood page: check-ins newest first (same day: newest made first); other notes left out');
  console.log(`mood self-check: OK (${n} checks)`);
})().catch((e) => { console.error(e); process.exit(1); });
