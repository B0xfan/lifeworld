#!/usr/bin/env node
/* Self-check: a link in the note text of a project or area page opens when clicked (owner report 2026-10-29:
 * "Link doesn't work" on the Business Ideas page). The note text is drawn by MarkdownRenderer, which
 * leaves the click to whoever owns the view. Loads the built main.js with an Obsidian stand-in. */
'use strict';
const assert = require('assert');
const Module = require('module');

// A small DOM stand-in: classes, attributes, children, listeners, closest().
const node = (tag, parent) => ({
  tag, parent, kids: [], className: '', attrs: {}, on: {}, textContent: '',
  createEl(t) { const d = node(t, this); this.kids.push(d); return d; },
  addEventListener(type, f) { (this.on[type] = this.on[type] || []).push(f); },
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
  hasClass(c) { return this.className.split(' ').includes(c); },
  matches(sel) { return sel.split(',').some((s) => s.trim().split('.').slice(1).every((c) => this.hasClass(c)) && (!/^[a-z]/.test(s.trim()) || s.trim().startsWith(this.tag))); },
  closest(sel) { for (let e = this; e; e = e.parent) if (e.matches && e.matches(sel)) return e; return null; },
});
const link = (parent, href, cls = 'internal-link') => { const a = parent.createEl('a'); a.className = cls; a.attrs['data-href'] = href; a.attrs.href = href; return a; };

let rendered;
const fake = new Proxy({
  Component: class { load() {} },
  Keymap: { isModEvent: (e) => (e.metaKey ? 'tab' : e.button === 1 ? 'tab' : false) },
  MarkdownRenderer: { render: async (app, src, md) => { rendered = md; const p = md.createEl('p'); link(p, 'Business Ideas.base'); link(p, 'Article Vault'); link(p, 'https://example.com', 'external-link'); const tl = p.createEl('span'); tl.className = 'a4pj-tl'; link(tl, 'Some task'); } },
}, { get: (t, k) => (k in t ? t[k] : class {}) });
const ld = Module._load;
Module._load = function (r, ...a) { return r === 'obsidian' ? fake : ld.call(this, r, ...a); };
const { part } = require('./lib/paths');

(async () => {
  const opened = [];
  const view = Object.create(part('a4-projects').ProjectsView.prototype);
  view.app = { vault: { cachedRead: async () => '---\ntype: area\n---\n\n[[Business Ideas.base|Open the table]]\n' }, workspace: { openLinkText: (...a) => opened.push(a) } };
  const main = node('div', null);
  view.noteBody(main, { path: 'Projects/Business Ideas.md' }, {}, 'Notes');
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(rendered, 'the note text was drawn');
  const md = rendered;
  const [table, idea, ext, task] = [md.kids[0].kids[0], md.kids[0].kids[1], md.kids[0].kids[2], md.kids[0].kids[3].kids[0]];
  const click = (target, extra = {}, type = 'click') => { let prevented = false; for (const f of md.on[type] || []) f({ type, target, button: 0, preventDefault() { prevented = true; }, ...extra }); return prevented; };

  assert.ok(click(table), 'a click on the table link is handled (criterion 1)');
  click(idea);
  click(idea, { metaKey: true });
  click(idea, { button: 1 }, 'auxclick');
  click(idea, { button: 2 }, 'auxclick');
  assert.strictEqual(click(ext), false, 'an external link is left to Obsidian (criterion 4)');
  assert.strictEqual(click(task), false, 'a task row link keeps its own handling (criterion 3)');
  assert.deepStrictEqual(opened, [
    ['Business Ideas.base', 'Projects/Business Ideas.md', false],
    ['Article Vault', 'Projects/Business Ideas.md', false],
    ['Article Vault', 'Projects/Business Ideas.md', 'tab'],
    ['Article Vault', 'Projects/Business Ideas.md', 'tab'],
  ], 'opened from the page note; Cmd-click and middle-click open a new tab, right-click opens nothing (criteria 1, 2)');
  console.log('page links: 4 checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
