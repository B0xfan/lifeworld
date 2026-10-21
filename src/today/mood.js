// Mood (launch section 9, decision 8): the 25-card check-in and the Mood page, ported from the owner's health add-on
// (its check-in window, computeCuriousScore, bucketMoodTrend, renderMoodSection and renderMoodTrend,
// read 2026-10-19). Same words, same order, same score formula and trend buckets, so an existing set of
// check-in notes shows the same scores. Each check-in is one `type: mood-checkin` note in the Mood folder
// (Settings › Your vault), the same note shape, linked from that day's daily note.
'use strict';

import { ItemView, Modal, Notice, TFile, TFolder, setIcon } from 'obsidian';
import { pad2, dayOf } from '../core/dates';
import { vaultFolders } from '../core/vault';
import { insertUnderHeading, writeDailyNote } from '../core/daily';

const MOOD_VIEW = 'lifeworld-mood';
const EMOTIONS = ['peaceful', 'friendly', 'nervous', 'sad', 'amused', 'angry', 'tired', 'energized', 'happy',
  'disappointed', 'safe', 'afraid', 'carefree', 'confident', 'adventurous', 'social',
  'productive', 'exhausted', 'loving', 'confused', 'miserable', 'annoyed', 'strong',
  'cheerful', 'tense'];
const POSITIVE = ['safe', 'carefree', 'energized', 'confident', 'adventurous', 'amused', 'social',
  'productive', 'loving', 'strong', 'peaceful', 'friendly', 'cheerful', 'happy'];
const NEGATIVE = ['disappointed', 'afraid', 'tired', 'sad', 'exhausted', 'nervous', 'confused',
  'miserable', 'annoyed', 'angry', 'tense'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const RANGES = ['30d', '6m', '1y'];
const RANGE_EMPTY = { '30d': 'No check-ins in the last 30 days.', '6m': 'No check-ins in the last 6 months.', '1y': 'No check-ins in the last year.' };
const PAGE_STEP = 8; // tiles shown, then "Show more" adds as many again

// The score out of 100 (the health add-on's formula, verbatim): (yes to a good word + no to a hard word x 2) /
// (good words + hard words x 2) x 100. answers: { emotion: 0 | 1 }.
function moodScore(answers) {
  const denom = POSITIVE.length + NEGATIVE.length * 2;
  const yes = POSITIVE.reduce((s, k) => s + (answers[k] === 1 ? 1 : 0), 0);
  const no = NEGATIVE.reduce((s, k) => s + (answers[k] === 0 ? 1 : 0), 0);
  return denom === 0 ? 0 : ((yes + no * 2) / denom) * 100;
}
const scoreTier = (s) => (s >= 70 ? 'g' : s >= 45 ? 'm' : 'l');
const clockLabel = (d) => { const h = d.getHours(); return `${h % 12 === 0 ? 12 : h % 12}:${pad2(d.getMinutes())} ${h >= 12 ? 'PM' : 'AM'}`; };
const monthYear = (d) => `${MONTHS[parseInt(d.slice(5, 7), 10) - 1]} ${d.slice(0, 4)}`;
const monthDay = (d) => `${MONTHS[parseInt(d.slice(5, 7), 10) - 1]} ${parseInt(d.slice(8, 10), 10)}`;

// The trend's buckets (the health add-on's bucketMoodTrend, verbatim): 30d a point per day, 6m per Monday-start
// week, 1y per month, each the average score. rows: [{ date, score }]. -> [{ bucket, avg, xLabel }]
const minusDays = (day, n) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const minusMonths = (day, n) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - n); return d.toISOString().slice(0, 10); };
function isoWeek(day) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3);
  const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7) + 3);
  return `${d.getUTCFullYear()}-W${String(1 + Math.round((d - first) / (7 * 86400000))).padStart(2, '0')}`;
}
function moodTrend(rows, range, today) {
  const avg = (v) => v.reduce((a, b) => a + b, 0) / v.length;
  if (range === '30d') {
    const cut = minusDays(today, 30); const by = new Map();
    for (const r of rows) { if (r.date < cut) continue; by.set(r.date, [...(by.get(r.date) || []), Number(r.score) || 0]); }
    return [...by.keys()].sort().map((d) => ({ bucket: d, avg: avg(by.get(d)), xLabel: null }));
  }
  if (range === '6m') {
    const cut = minusMonths(today, 6); const by = new Map();
    for (const r of rows) { if (r.date < cut) continue; const k = isoWeek(r.date); const b = by.get(k) || { s: [], min: r.date }; b.s.push(Number(r.score) || 0); if (r.date < b.min) b.min = r.date; by.set(k, b); }
    let last = null;
    return [...by.keys()].sort().map((k) => { const b = by.get(k); const m = b.min.slice(5, 7); let xLabel = null; if (m !== last) { xLabel = MONTHS[parseInt(m, 10) - 1]; last = m; } return { bucket: k, avg: avg(b.s), xLabel }; });
  }
  const cut = minusMonths(today, 12); const by = new Map();
  for (const r of rows) { if (r.date < cut) continue; const k = r.date.slice(0, 7); by.set(k, [...(by.get(k) || []), Number(r.score) || 0]); }
  return [...by.keys()].sort().map((k) => ({ bucket: k, avg: avg(by.get(k)), xLabel: MONTHS[parseInt(k.slice(5, 7), 10) - 1] }));
}

// Every check-in note in the Mood folder (and its subfolders, as the health add-on reads them), newest first.
function collectMood(app) {
  const out = [];
  const root = vaultFolders.mood ? app.vault.getAbstractFileByPath(vaultFolders.mood) : null;
  const walk = (folder) => { for (const c of folder.children || []) { if (c instanceof TFolder) walk(c); else if (c instanceof TFile && c.extension === 'md') {
    const fm = (app.metadataCache.getFileCache(c) || {}).frontmatter;
    const date = fm && fm.type === 'mood-checkin' ? String(fm.date || '').slice(0, 10) : '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Number(fm.score))) out.push({ path: c.path, date, time: fm.time ? String(fm.time) : '', score: Number(fm.score), felt: Array.isArray(fm.felt) ? fm.felt.map(String) : [], ctime: c.stat ? c.stat.ctime : 0 });
  } } };
  if (root instanceof TFolder) walk(root);
  return out.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : b.ctime - a.ctime));
}

// Saves one check-in: the note (its frontmatter through the frontmatter API, in the health add-on's field order),
// then a line under "Mood" in that day's daily note linking to it. -> the note's path.
async function saveCheckin(app, { score, felt, notFelt, note }) {
  const folder = vaultFolders.mood;
  const steps = folder.split('/');
  for (let i = 1; i <= steps.length; i++) { const p = steps.slice(0, i).join('/'); if (!app.vault.getAbstractFileByPath(p)) await app.vault.createFolder(p); }
  const now = new Date(); const date = dayOf(now); const time = clockLabel(now);
  const stamp = `${pad2(now.getHours())}${pad2(now.getMinutes())}`;
  let name = `${date} ${stamp} Mood Check-in`;
  for (let k = 2; app.vault.getAbstractFileByPath(`${folder}/${name}.md`); k++) name = `${date} ${stamp} Mood Check-in ${k}`;
  const text = String(note || '').trim();
  const file = await app.vault.create(`${folder}/${name}.md`, `## Note\n\n${text || '_none_'}\n`);
  await app.fileManager.processFrontMatter(file, (fm) => {
    fm.type = 'mood-checkin'; fm.date = date; fm.time = time; fm.score = Math.round(score * 10) / 10; fm.route = 'curious';
    fm.felt = felt; fm.not_felt = notFelt;
    if (text) fm.note = text.replace(/\r?\n/g, ' ');
    fm.created = date;
  });
  // The check-in is saved now; a failure here must not make Save run again and count it twice.
  try { await writeDailyNote(app, now, (t) => insertUnderHeading(t, 'Mood', `- ${time}: [[${name}|mood check-in, ${Math.round(score)}]]`)); }
  catch (e) { console.warn('LifeWorld: the mood line could not be added to the daily note', e); new Notice('Check-in saved, but the line in today\'s daily note could not be added.'); }
  return file.path;
}

// The check-in window (the health add-on's flow): one card at a time, progress bar, Yes / No and the arrow keys
// (right = yes, left = no; not while typing), Back, then the score, Felt, Didn't feel, a note, Save.
class MoodCheckinModal extends Modal {
  constructor(app, plugin, onDone) { super(app); this.plugin = plugin; this.onDone = onDone; this.index = 0; this.answers = {}; this.step = 'cards'; this.note = ''; }
  onOpen() {
    this.modalEl.addClass('a4t-capture-modal', 'a4t-mood-modal');
    if (this.plugin && this.plugin.styleLook) this.plugin.styleLook(this.modalEl);
    const typing = () => { const el = document.activeElement; return !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable); };
    this.scope.register([], 'ArrowRight', (e) => { if (typing()) return true; e.preventDefault(); this.answer(1); return false; });
    this.scope.register([], 'ArrowLeft', (e) => { if (typing()) return true; e.preventDefault(); this.answer(0); return false; });
    this.render();
  }
  onClose() { this.contentEl.empty(); }
  answer(v) { if (this.step !== 'cards') return; this.answers[EMOTIONS[this.index]] = v; this.index += 1; if (this.index >= EMOTIONS.length) this.step = 'result'; this.render(); }
  back() {
    if (this.step === 'result') { this.step = 'cards'; this.index = EMOTIONS.length - 1; delete this.answers[EMOTIONS[this.index]]; this.render(); return; }
    if (this.index === 0) return;
    this.index -= 1; delete this.answers[EMOTIONS[this.index]]; this.render();
  }
  render() { this.contentEl.empty(); if (this.step === 'cards') this.cards(this.contentEl); else this.result(this.contentEl); }
  cards(root) {
    root.createEl('p', { cls: 'a4t-mc-title', text: 'How are you feeling?' });
    const prog = root.createDiv({ cls: 'a4t-mc-prog' });
    const bar = prog.createDiv({ cls: 'a4t-mc-bar' }).createEl('i');
    bar.style.setProperty('--a4t-mc-p', `${Math.round((this.index / EMOTIONS.length) * 100)}%`);
    prog.createSpan({ cls: 'a4t-mc-count', text: `${this.index} of ${EMOTIONS.length}` });
    const q = root.createEl('p', { cls: 'a4t-mc-q' });
    q.appendText('Do you feel '); q.createEl('em', { text: EMOTIONS[this.index] }); q.appendText('?');
    const yn = root.createDiv({ cls: 'a4t-mc-yn' });
    yn.createEl('button', { cls: 'a4t-btn', text: 'No' }).addEventListener('click', () => this.answer(0));
    yn.createEl('button', { cls: 'a4t-btn a4t-primary', text: 'Yes' }).addEventListener('click', () => this.answer(1));
    root.createEl('p', { cls: 'a4t-mc-hint', text: 'Tap, or use the arrow keys (right = yes, left = no).' });
    const grid = root.createDiv({ cls: 'a4t-mc-grid' });
    EMOTIONS.forEach((em, i) => { const c = grid.createSpan({ text: em }); if (i < this.index) c.addClass(this.answers[em] === 1 ? 'yes' : 'no'); else if (i === this.index) c.addClass('cur'); });
    const foot = root.createDiv({ cls: 'a4t-mc-foot' });
    const b = foot.createEl('button', { cls: 'a4t-btn a4t-ghost', text: '← Back' });
    if (this.index === 0) { b.disabled = true; b.setAttr('aria-disabled', 'true'); } else b.addEventListener('click', () => this.back());
  }
  result(root) {
    const score = moodScore(this.answers);
    const felt = EMOTIONS.filter((e) => this.answers[e] === 1);
    const notFelt = EMOTIONS.filter((e) => this.answers[e] === 0);
    root.createEl('p', { cls: 'a4t-mc-title', text: `Today, ${clockLabel(new Date())}` });
    const sr = root.createDiv({ cls: 'a4t-mc-score' });
    sr.createEl('b', { cls: `is-${scoreTier(score)}`, text: String(Math.round(score)) }); sr.createSpan({ text: 'out of 100' });
    for (const [label, list, cls] of [['Felt', felt, ''], ["Didn't feel", notFelt, ' no']]) {
      root.createDiv({ cls: 'a4t-mc-lbl', text: label });
      const chips = root.createDiv({ cls: 'a4t-mc-chips' });
      if (list.length) list.forEach((e) => chips.createSpan({ cls: `a4t-mc-chip${cls}`, text: e })); else chips.createSpan({ cls: 'a4t-muted', text: 'none' });
    }
    root.createDiv({ cls: 'a4t-mc-lbl', text: 'Note (optional)' });
    const ta = root.createEl('textarea', { cls: 'a4t-mc-note', attr: { 'aria-label': 'Note' } });
    ta.value = this.note; ta.addEventListener('input', () => { this.note = ta.value; });
    const foot = root.createDiv({ cls: 'a4t-mc-foot' });
    foot.createEl('button', { cls: 'a4t-btn a4t-ghost', text: '← Change an answer' }).addEventListener('click', () => this.back());
    const save = foot.createEl('button', { cls: 'a4t-btn a4t-primary', text: 'Save check-in' });
    save.addEventListener('click', async () => {
      if (save.disabled) return;
      save.disabled = true;
      try { await saveCheckin(this.app, { score, felt, notFelt, note: this.note }); new Notice('Mood check-in saved.'); this.close(); if (this.onDone) this.onDone(); }
      catch (e) { console.error('LifeWorld: the mood check-in was not saved', e); new Notice('Could not save the check-in. Your answers are still here; try again.'); save.disabled = false; }
    });
  }
}

// The Mood page (step 0 mockup, approved): count and since when, the last one, New check-in; the trend
// with 30d / 6m / 1y; the latest check-ins as tiles with "Show more"; a tile opens its note.
class MoodView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this.range = '30d'; this.shown = PAGE_STEP; }
  getViewType() { return MOOD_VIEW; }
  getDisplayText() { return 'Mood'; }
  getIcon() { return 'smile'; }
  async onOpen() {
    this.contentEl.addClass('a4t-root', 'a4t-mood-root');
    const redraw = (f) => { const p = f && f.path; if (typeof p === 'string' && vaultFolders.mood && p.startsWith(`${vaultFolders.mood}/`)) this.scheduleRender(); };
    this.registerEvent(this.app.metadataCache.on('changed', redraw));
    this.registerEvent(this.app.vault.on('delete', redraw));
    this.registerEvent(this.app.vault.on('rename', (f, old) => { redraw(f); redraw({ path: old }); }));
    this.plugin.styleLook(this.contentEl);
    this.render();
  }
  scheduleRender() { window.clearTimeout(this.t); this.t = window.setTimeout(() => this.render(), 350); }
  async onClose() { window.clearTimeout(this.t); }
  render() {
    const root = this.contentEl; root.empty();
    const page = root.createDiv({ cls: 'a4t-scroll' }).createDiv({ cls: 'a4t-page' });
    const rows = collectMood(this.app);
    const today = dayOf(new Date());
    const head = page.createDiv({ cls: 'a4t-head' });
    const left = head.createDiv();
    left.createDiv({ cls: 'a4t-kicker', text: 'Mood' });
    left.createEl('h2', { cls: 'a4t-title', text: 'How you have been' });
    left.createSpan({ cls: 'a4t-hand-note', text: rows.length ? `${rows.length} check-in${rows.length === 1 ? '' : 's'} since ${monthYear(rows[rows.length - 1].date)} · last one ${rows[0].date === today ? 'today' : monthDay(rows[0].date)}` : 'no check-ins yet' });
    const nb = head.createDiv({ cls: 'a4t-head-actions' }).createEl('button', { cls: 'a4t-btn a4t-primary' });
    setIcon(nb.createSpan({ cls: 'a4t-ic' }), 'plus'); nb.appendText('New check-in');
    nb.addEventListener('click', () => this.plugin.newMoodCheckin(() => this.render()));
    if (!rows.length) { page.createDiv({ cls: 'a4t-empty', text: 'No check-ins yet. Use New check-in to start.' }); return; }
    const trend = page.createDiv({ cls: 'a4t-w a4t-card a4t-mood-card' }).createDiv({ cls: 'a4t-wbody' });
    const th = trend.createDiv({ cls: 'a4t-card-head' });
    const tl = th.createDiv(); tl.createDiv({ cls: 'a4t-kicker', text: 'Trend' }); tl.createEl('h3', { text: 'Average score' });
    const seg = th.createDiv({ cls: 'a4t-mood-seg', attr: { role: 'group', 'aria-label': 'Trend range' } });
    const chart = trend.createDiv();
    const draw = () => { chart.empty(); drawTrend(chart, moodTrend(rows, this.range, today), this.range); seg.querySelectorAll('button').forEach((b) => b.toggleClass('is-on', b.dataset.range === this.range)); };
    for (const r of RANGES) { const b = seg.createEl('button', { text: r, attr: { 'data-range': r } }); b.addEventListener('click', () => { this.range = r; draw(); }); }
    draw();
    const hist = page.createDiv({ cls: 'a4t-w a4t-card a4t-mood-card' }).createDiv({ cls: 'a4t-wbody' });
    const hl = hist.createDiv({ cls: 'a4t-card-head' }).createDiv(); hl.createDiv({ cls: 'a4t-kicker', text: 'History' }); hl.createEl('h3', { text: 'Latest check-ins' });
    const tiles = hist.createDiv({ cls: 'a4t-mood-tiles' });
    for (const r of rows.slice(0, this.shown)) {
      const t = tiles.createEl('button', { cls: 'a4t-mood-tile', attr: { 'aria-label': `Open the check-in of ${r.date}` } });
      t.createSpan({ cls: `a4t-mood-tile-score is-${scoreTier(r.score)}`, text: String(Math.round(r.score)) });
      t.createEl('small', { text: `${r.date === today ? 'Today' : monthDay(r.date)}${r.time ? ` · ${r.time}` : ''}` });
      t.createDiv({ text: r.felt.slice(0, 3).join(', ') });
      t.addEventListener('click', () => { const f = this.app.vault.getAbstractFileByPath(r.path); if (f instanceof TFile) this.app.workspace.getLeaf(false).openFile(f); });
    }
    if (this.shown < rows.length) { const m = hist.createEl('button', { cls: 'a4t-btn a4t-small', text: 'Show more' }); m.addEventListener('click', () => { this.shown += PAGE_STEP; this.render(); }); }
  }
}

// The trend line (the health add-on's renderMoodTrend: 0 / 50 / 100 lines, area, line, last point, date labels).
function drawTrend(host, points, range) {
  const VW = 640; const VH = 140; const L = 40; const R = 20; const T = 20; const B = 20;
  const svg = host.createSvg('svg', { cls: 'a4t-mood-trend', attr: { viewBox: `0 0 ${VW} ${VH}`, width: '100%', preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Mood score over time, 0 to 100' } });
  const text = (x, y, s, anchor) => { const t = svg.createSvg('text', { attr: { x, y, ...(anchor ? { 'text-anchor': anchor } : {}) } }); t.textContent = s; };
  for (const [y, label] of [[T, '100'], [VH / 2, '50'], [VH - B, '0']]) { svg.createSvg('line', { cls: 'a4t-mood-grid', attr: { x1: L, x2: VW - R, y1: y, y2: y } }); text(6, y + 4, label); }
  const x = (i) => (points.length > 1 ? L + (i / (points.length - 1)) * (VW - L - R) : VW / 2);
  const y = (v) => (VH - B) - (Math.max(0, Math.min(100, v)) / 100) * (VH - T - B);
  if (points.length) {
    const pts = points.map((p, i) => `${x(i).toFixed(1)},${y(p.avg).toFixed(1)}`).join(' ');
    svg.createSvg('polygon', { cls: 'a4t-mood-area', attr: { points: `${x(0).toFixed(1)},${VH - B} ${pts} ${x(points.length - 1).toFixed(1)},${VH - B}` } });
    svg.createSvg('polyline', { cls: 'a4t-mood-line', attr: { points: pts } });
    svg.createSvg('circle', { cls: 'a4t-mood-dot', attr: { cx: x(points.length - 1), cy: y(points[points.length - 1].avg), r: 4 } });
    if (range === '30d') {
      text(L, VH - 2, monthDay(points[0].bucket));
      if (points.length > 2) { const mid = Math.floor((points.length - 1) / 2); text(x(mid), VH - 2, monthDay(points[mid].bucket), 'middle'); }
      text(VW - R, VH - 2, monthDay(points[points.length - 1].bucket), 'end');
    } else points.forEach((p, i) => { if (p.xLabel) text(x(i), VH - 2, p.xLabel, i === 0 ? null : i === points.length - 1 ? 'end' : 'middle'); });
  } else host.createDiv({ cls: 'a4t-empty', text: RANGE_EMPTY[range] });
}

export { MOOD_VIEW, EMOTIONS, POSITIVE, NEGATIVE, moodScore, scoreTier, moodTrend, isoWeek, collectMood, saveCheckin, MoodCheckinModal, MoodView };
