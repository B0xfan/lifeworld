// Launch sections 5 and 5b, the wiring: Today and the Planner read and write through the chosen task
// source; the Settings choice "Where your tasks live" as drawn (mockup v6), Things only on a Mac, keys
// in password boxes that save to local storage only. Loads the built main.js with an Obsidian stand-in.
'use strict';
const assert = require('assert');
const Module = require('module');

let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (v, m) => { assert.ok(v, m); n++; };

// A small DOM stand-in: what an element was given (classes, attributes, text, children, listeners).
const el = (tag) => ({ tag, kids: [], cls: [], attr: {}, text: '', on: {}, style: {},
  createEl(t, o) { const d = el(t); if (o && o.text) d.text = o.text; if (o && o.cls) d.cls.push(...String(o.cls).split(' ')); if (o && o.attr) Object.assign(d.attr, o.attr); this.kids.push(d); return d; },
  createDiv(o) { return this.createEl('div', o); }, createSpan(o) { return this.createEl('span', o); },
  addClass(c) { this.cls.push(c); }, empty() { this.kids = []; }, setAttr(k, v) { this.attr[k] = v; },
  addEventListener(t, f) { (this.on[t] = this.on[t] || []).push(f); }, fire(t, e) { return Promise.all((this.on[t] || []).map((f) => f(e || {}))); }, isConnected: true });
const all = (e) => [e, ...e.kids.flatMap(all)];
class Setting {
  constructor(parent) { this.settingEl = el('setting'); this.rec = { texts: [] }; parent.kids.push(this.settingEl); this.settingEl.rec = this.rec; }
  setName(v) { this.rec.name = v; return this; } setDesc(v) { this.rec.desc = v; return this; } setHeading() { return this; }
  addText(cb) { const t = { inputEl: el('input'), value: '', setPlaceholder() { return t; }, setValue(v) { t.value = v; return t; }, getValue() { return t.value; } }; this.rec.texts.push(t); cb(t); return this; }
  addDropdown(cb) { const d = { addOption() { return d; }, setValue() { return d; }, onChange() { return d; } }; cb(d); return this; }
  addToggle(cb) { const t = { setValue() { return t; }, onChange() { return t; } }; cb(t); return this; }
}
const Platform = { isMacOS: false, isDesktopApp: true, isMobile: false };
const fake = new Proxy({ Setting, Platform, Notice: class { constructor(m) { notices.push(m); } }, moment: require('moment'), PluginSettingTab: class { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = el('page'); } } }, { get: (t, k) => (k in t ? t[k] : class {}) });
const notices = [];
const ld = Module._load;
Module._load = function (r, ...a) { return r === 'obsidian' ? fake : ld.call(this, r, ...a); };
const LW = require('./lib/paths').lifeworld();

(async () => {
  const calls = [];
  const item = { path: 'todoist:1', ext: { source: 'todoist', id: '1' }, title: 'Pay rent', status: 'open', plannedDay: '2026-10-19', due: '2026-10-19', plannedHalf: null, time: null, recurrenceRaw: null, completeInstances: [], skippedInstances: [], blockedBy: [], plannedOrder: 0 };
  const ext = { id: 'todoist', items: () => [item], status: () => ({ error: '' }), place: async (...a) => calls.push(['place', ...a]), toggle: async (...a) => { calls.push(['toggle', a[1]]); return true; }, create: async (o) => calls.push(['create', o]) };
  const pj = { extSource: () => ext, openTask: (t) => calls.push(['open', t.path]), settings: { source: 'todoist' } };

  // The Planner reads and writes through the source (criteria 25, 26).
  const planner = Object.create(LW.parts['a4-planner'].prototype);
  planner.app = {}; planner.projectsPlugin = () => pj;
  eq(planner.collectItems().map((x) => [x.path, x.weeklyGoal]), [['todoist:1', false]], 'Planner: the source\'s tasks, never a weekly goal');
  await planner.moveTask(item, '2026-10-20', 'pm', null, []);
  await planner.toggleTask(item, '2026-10-19');
  await planner.unscheduleTask(item);
  await planner.createTyped('call Max friday 3pm', null, [], '2026-10-19');
  await planner.createTask({ title: 'From an event', day: '2026-10-21', half: 'am', time: '09:30' }, []);
  eq(calls, [['place', item, '2026-10-20', 'pm'], ['toggle', '2026-10-19'], ['place', item, null, null], ['create', { title: 'Call Max', day: '2026-10-23', time: '15:00', project: null }], ['create', { title: 'From an event', day: '2026-10-21', half: 'am', time: '09:30', project: null }]],
    'Planner: placing on a day, ticking, unscheduling and adding all go to the source');
  await assert.rejects(planner.somedayTask(item), /Someday is for LifeWorld tasks/); n++;

  // Today: ticks go to the source; the task cards follow the kind of source.
  calls.length = 0;
  const today = Object.create(LW.parts['a4-today'].prototype);
  today.app = {}; today.projectsPlugin = () => pj;
  eq(await today.toggleTask(item, '2026-10-19'), true, 'Today: a tick goes to the source');
  today.openTask(item);
  eq(calls, [['toggle', '2026-10-19'], ['open', 'todoist:1']], 'Today: a click opens it where it lives');
  eq(today.taskKind(), 'notes', 'Todoist: Morning and Afternoon cards (criterion 27)');
  pj.settings.source = 'checkbox';
  eq(today.taskKind(), 'checkbox', "Checkboxes: one Today's tasks card (criterion 21)");
  // A source that cannot be read: one short line in the card (criterion 28).
  const view = Object.create(LW.parts['a4-today'].TodayView.prototype);
  view.plugin = { extSource: () => ({ status: () => ({ error: 'Could not reach Todoist. Check the internet connection; nothing was lost.' }) }) };
  const body = el('div');
  ok(view.sourceProblem(body) && body.kids[0].text.startsWith('Could not reach Todoist') && body.kids[0].cls.includes('a4t-src-err'), 'Today: the source\'s plain message shows in the task card');

  // Settings › Tasks › Where your tasks live (mockup v6).
  const PJ = LW.parts['a4-projects'];
  eq(['builtin', 'tasknotes', 'checkbox', 'clickup', 'todoist', 'things', 'bogus'].map((s) => PJ.logic.normalizeSettings({ source: s }).source), ['builtin', 'tasknotes', 'checkbox', 'clickup', 'todoist', 'things', 'builtin'], 'the six choices are kept; anything else is LifeWorld tasks');
  const store = {}; const saved = [];
  const app = { loadLocalStorage: (k) => store[k] || null, saveLocalStorage: (k, v) => { if (v == null) delete store[k]; else store[k] = v; }, plugins: { plugins: {} }, workspace: { trigger() {} } };
  const plugin = { app, settings: PJ.logic.normalizeSettings({ source: 'todoist' }), ext: { status: () => ({ error: '' }), refresh: async () => {} }, save: async () => saved.push(JSON.parse(JSON.stringify(plugin.settings))), tnApi: () => null, cards: { refreshAll() {} }, setSource: async (id) => { plugin.settings.source = id; } };
  const tab = new PJ.ProjectsSettingTab(app, plugin);
  tab.display();
  const radios = () => all(tab.containerEl).filter((e) => e.attr.role === 'radio');
  eq(radios().map((r) => [r.attr['data-src'], r.attr['aria-checked']]), [['builtin', 'false'], ['tasknotes', 'false'], ['checkbox', 'false'], ['clickup', 'false'], ['todoist', 'true']], 'six choices, one picked; Things not offered off a Mac (criterion 17)');
  eq(all(tab.containerEl).filter((e) => e.tag === 'b').map((b) => b.text), ['LifeWorld tasks', 'TaskNotes plugin', 'Checkboxes in your notes', 'ClickUp', 'Todoist'], 'their names as drawn');
  const keyRow = all(tab.containerEl).find((e) => e.rec && e.rec.name === 'Todoist key');
  const box = keyRow.rec.texts[0];
  eq([box.inputEl.type, box.inputEl.attr['aria-label']], ['password', 'Todoist key'], 'the key box is a password field (criterion 29)');
  ok(/stays on this device: it is not synced or backed up/.test(keyRow.rec.desc), 'and says the key stays on this device');
  box.value = '  my-secret-key  ';
  await box.inputEl.fire('change');
  eq([store['lifeworld-key-todoist'], saved.length, JSON.stringify(plugin.settings).includes('my-secret')], ['my-secret-key', 0, false], 'a pasted key goes to local storage only, never into the settings file');
  Platform.isMacOS = true;
  tab.display();
  eq(radios().map((r) => r.attr['data-src']).slice(-1), ['things'], 'on a Mac: Things 3 is offered');
  ok(all(tab.containerEl).some((e) => e.tag === 'span' && e.text === 'Mac only'), 'with its "Mac only" tag');
  await radios().find((r) => r.attr['data-src'] === 'checkbox').fire('click');
  eq(plugin.settings.source, 'checkbox', 'picking a choice switches the source');
  tab.display();
  const tagRow = all(tab.containerEl).find((e) => e.rec && e.rec.name === 'Only lines with this tag');
  tagRow.rec.texts[0].value = 'task'; await tagRow.rec.texts[0].inputEl.fire('change');
  eq(plugin.settings.cbTag, '#task', 'Checkboxes: the tag box, saved with its #');
  ok(all(tab.containerEl).some((e) => /that day's daily note, under a "Tasks" heading/.test(e.text)) && all(tab.containerEl).some((e) => /does not get its next copy/.test(e.text)), 'Checkboxes: where new tasks go, and the stated limit without the Tasks plugin');
  Platform.isMacOS = false;
  console.log(`source wiring self-check: OK (${n} checks)`);
})().catch((e) => { console.error(e); process.exit(1); });
