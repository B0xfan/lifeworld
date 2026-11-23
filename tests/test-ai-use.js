#!/usr/bin/env node
/* Self-check for the AI use tab and card line (mockup approved
 * 2026-10-15), no Obsidian needed: shares from the nightly file, the high mark,
 * the untied share by reason, "<1%", a missing or broken file hiding the tab,
 * the week / 30-day switch, card lines and the high pill. The page look needs
 * a real Obsidian. */
'use strict';
const path = require('path');
const Module = require('module');
const assert = require('assert');
const fake = { Plugin: class {}, ItemView: class {}, MarkdownView: class {}, Modal: class {}, SuggestModal: class {}, PluginSettingTab: class {}, Setting: class {}, TFile: class {}, TFolder: class {}, Notice: class {}, setIcon() {}, Platform: {}, Component: class {} };
const load = Module._load;
Module._load = function (req, ...a) { return req === 'obsidian' ? fake : load.call(this, req, ...a); };
const { part } = require('./lib/paths');
const plugin = part('a4-projects');
const L = plugin.logic;
const V = plugin.ProjectsView.prototype;

const data = { generated: '2026-10-15T03:30:00-06:00', measure: 'tokens processed', high_share: 0.25, windows: {
  '7d': { from: '2026-10-08', to: '2026-10-14', total: 1000, projects: { 'Pottery': 60, 'Big Build': 300, Gone: 2, Zero: 0 }, untied: { main_sessions: 300, no_folder: 338 } },
  '30d': { from: '2026-09-15', to: '2026-10-14', total: 4000, projects: { 'Pottery': 2000 }, untied: { folder_without_project: 2000 } } } };

/* ---- shares ------------------------------------------------------------------ */
const a = L.aiShares(data, '7d');
assert.deepStrictEqual(a.rows.map((r) => [r.name, r.share]), [['Big Build', 0.3], ['Pottery', 0.06], ['Gone', 0.002]], 'largest first, zero left out');
assert.deepStrictEqual(a.untied.map((r) => r.reason), ['no_folder', 'main_sessions']);
assert.ok(Math.abs(a.untiedShare - 0.638) < 1e-9);
assert.strictEqual(a.high, 0.25);
assert.strictEqual(L.pctText(0.002), '<1%'); assert.strictEqual(L.pctText(0), '0%'); assert.strictEqual(L.pctText(0.255), '26%');
assert.strictEqual(L.aiShares({}, '7d'), null, 'wrong shape: null');
assert.strictEqual(L.aiShares({ windows: { '7d': { total: 'x' } } }, '7d'), null);
assert.strictEqual(L.aiShares({ windows: { '7d': { total: 0 } } }, '7d').rows.length, 0, 'an empty week is a real answer');
assert.strictEqual(L.aiShares({ high_share: 7, windows: { '7d': { total: 1 } } }, '7d').high, 0.25, 'a silly high mark falls back to a quarter');
assert.ok(L.isHighShare(0.246, 0.25) && !L.isHighShare(0.244, 0.25), 'red on the number shown');

/* ---- loadAi: no file / broken file hide the tab ------------------------------- */
(async () => {
  const loadWith = async (files) => { const v = Object.assign(Object.create(V), { ai: 'old', contentEl: { isConnected: true }, scheduleRender() { v.redrawn = true; },
    app: { vault: { adapter: { exists: async (p) => p in files, read: async (p) => files[p] } } } }); await v.loadAi(); return v; };
  assert.strictEqual((await loadWith({})).ai, null, 'no file: no tab (no work folders)');
  assert.strictEqual((await loadWith({ 'Scripts/data/ai-use-by-project.json': '{oops' })).ai, null, 'broken file: no tab');
  assert.strictEqual((await loadWith({ 'Scripts/data/ai-use-by-project.json': '{"windows":{}}' })).ai, null, 'unexpected shape: no tab');
  const ok = await loadWith({ 'Scripts/data/ai-use-by-project.json': JSON.stringify(data) });
  assert.deepStrictEqual(ok.ai, data); assert.ok(ok.redrawn);

  /* ---- the page on a tiny fake DOM -------------------------------------------- */
  const node = (tag) => { const n = { tag, kids: [], listeners: {}, className: '', textContent: '', dataset: {}, attrs: {}, style: {},
    createEl(t) { const c = node(t); n.kids.push(c); return c; }, setAttr(k, v) { n.attrs[k] = v; }, addEventListener(t, f) { n.listeners[t] = f; },
    empty() { n.kids = []; }, setText(t) { n.textContent = t; }, appendText(t) { n.kids.push({ kids: [], textContent: t }); }, addClass() {}, removeClass() {} }; return n; };
  const walk = (n, f, out = []) => { if (f(n)) out.push(n); for (const k of n.kids || []) walk(k, f, out); return out; };
  const text = (n) => n.textContent + (n.kids || []).map(text).join('');
  const P = (name, status) => ({ path: `P/${name}.md`, name, key: name, status, sphere: 'work', why: '', mtime: 1 });
  const host = { settings: L.normalizeSettings({ ui: { view: 'board' } }), engine: { file: () => null }, okWork: () => null, goalFiles: () => [] };
  const gone = [];
  const view = Object.assign(Object.create(V), { plugin: host, app: {}, cfg: { statuses: [], priorities: [] }, today: '2026-10-15', tasks: [],
    projects: [P('Big Build', 'active'), P('Pottery', 'active'), P('Quiet', 'active')], query: '', tab: 'projects', area: null, descs: new Map(), ai: null, aiWin: '7d', render() {}, go: (s) => gone.push(s) });

  let page = node('div'); view.renderBoard(page);
  assert.ok(!walk(page, (n) => n.className === 'a4pj-tabs')[0].kids.map(text).includes('AI use'), 'no file: no tab');
  assert.strictEqual(walk(page, (n) => /a4pj-use/.test(n.className)).length, 0, 'no file: no card lines');
  view.tab = 'ai'; page = node('div'); view.renderBoard(page);
  assert.strictEqual(view.tab, 'projects', 'an AI tab left open after the file went: back to Projects');

  view.ai = data; view.tab = 'projects'; page = node('div'); view.renderBoard(page);
  assert.deepStrictEqual(walk(page, (n) => n.className === 'a4pj-tabs')[0].kids.map(text), ['Projects3', 'Ideas0', 'Cold Storage0', 'AI use', 'Activity'], 'tab before Activity');
  const lines = walk(page, (n) => /^a4pj-use/.test(n.className));
  assert.deepStrictEqual(lines.map((n) => [n.className, text(n.kids[0])]), [['a4pj-use is-high', 'High AI use: 30%'], ['a4pj-use', 'AI use 6%']], 'card lines; none for a project with no use');
  assert.strictEqual(walk(page, (n) => n.className === 'a4pj-pill is-high').map(text).join(), 'high AI use', 'one high pill');

  view.tab = 'ai'; page = node('div'); view.renderBoard(page);
  const rows = walk(page, (n) => /^a4pj-urow/.test(n.className));
  assert.deepStrictEqual(rows.map((r) => [r.className, text(r)]), [['a4pj-urow is-high', 'Big Buildhigh30%'], ['a4pj-urow', 'Pottery6%'], ['a4pj-urow', 'Gone<1%'], ['a4pj-urow is-none', 'Not tied to a project64%']]);
  assert.strictEqual(rows[0].tag, 'button', 'a project on the board opens its page');
  assert.strictEqual(rows[0].attrs['aria-label'], 'Big Build, 30% of AI use, high');
  assert.strictEqual(rows[2].tag, 'div', 'a name with no project note is plain');
  rows[0].listeners.click();
  assert.deepStrictEqual(gone, [{ page: 'project', project: 'P/Big Build.md' }]);
  assert.strictEqual(text(walk(page, (n) => n.className === 'a4pj-callout')[0]),
    "64% of AI use can't be tied to one project: team jobs that name no work folder 34%, main conversations and scheduled runs 30%. That share is shown, never guessed into a project.");
  assert.match(text(walk(page, (n) => n.className === 'a4pj-by')[0]), /2026-10-08 to 2026-10-14; updated Oct 15/);

  walk(page, (n) => n.textContent === 'Last 30 days')[0].listeners.click();
  assert.strictEqual(view.aiWin, '30d');
  page = node('div'); view.renderBoard(page);
  assert.strictEqual(walk(page, (n) => n.tag === 'h2').map(text)[0], 'AI use, last 30 days');
  assert.deepStrictEqual(walk(page, (n) => /^a4pj-urow/.test(n.className)).map(text), ['Potteryhigh50%', 'Not tied to a project50%']);
  assert.ok(/30 days/.test(text(walk(page, (n) => n.className === 'a4pj-secnote')[0])));

  view.ai = { ...data, windows: { ...data.windows, '7d': { from: 'a', to: 'b', total: 0 } } }; view.aiWin = '7d'; page = node('div'); view.renderBoard(page);
  assert.deepStrictEqual(walk(page, (n) => n.className === 'a4pj-empty').map(text), ['no AI use recorded in this period']);
  view.ai = { ...data, generated: 'nope', windows: { '7d': data.windows['7d'] } }; view.aiWin = '30d'; page = node('div'); view.renderBoard(page);
  assert.deepStrictEqual(walk(page, (n) => n.className === 'a4pj-empty').map(text), ['no data for this period'], 'a missing window is not called empty');
  view.aiWin = '7d'; page = node('div'); view.renderBoard(page);
  assert.ok(!/Invalid/.test(text(walk(page, (n) => n.className === 'a4pj-by')[0])), 'a bad date is left out');
  // Case: a link typed in other capitals still finds the project.
  view.ai = { ...data, windows: { '7d': { ...data.windows['7d'], projects: { 'pottery': 300 } } } }; view.tab = 'projects'; page = node('div'); view.renderBoard(page);
  assert.deepStrictEqual(walk(page, (n) => /^a4pj-use/.test(n.className)).map((n) => text(n.kids[0])), ['High AI use: 30%']);
  console.log('ai use self-check: OK');
})().catch((e) => { console.error(e); process.exit(1); });
