// LifeWorld's settings rows, as Obsidian 1.13+ asks for them (getSettingDefinitions): one list of
// named rows, so Obsidian's settings search finds them. Each row still builds its own controls in
// render(setting), as before; drawRows draws the same list on an older Obsidian, which has no search.
'use strict';
import { Setting } from 'obsidian';

// Draws groups and rows into el as Obsidian 1.13+ would: a heading, then a Setting per row (named first).
/** @param {HTMLElement} el @param {(Row | Group)[]} items */
function drawRows(el, items) {
  for (const d of items) {
    if ('type' in d) {
      const box = d.cls ? el.createDiv({ cls: d.cls }) : el;
      if (d.heading) new Setting(box).setName(d.heading).setHeading();
      drawRows(box, d.items);
      continue;
    }
    const s = new Setting(el).setName(d.name);
    if (d.desc) s.setDesc(d.desc);
    if (d.render) d.render(s);
  }
}

// Obsidian 1.13+ keeps whatever render() returns as a clean-up function and calls it on every redraw;
// LifeWorld's rows return the control they built, so each render is wrapped to return nothing.
/** @param {(Row | Group)[]} items @returns {(Row | Group)[]} */
function noCleanup(items) {
  return items.map((d) => ('type' in d ? { ...d, items: noCleanup(d.items) }
    : d.render ? { ...d, render: ((f) => (/** @type {import('obsidian').Setting} */ s) => { f(s); })(d.render) } : d));
}

/** @type {WeakMap<HTMLElement, HTMLElement>} */
const blocks = new WeakMap();

// A row that holds a block of its own (a list, a picker): under its name and description, or with
// none showing (bare: the name is only for the search). -> the block.
/** @param {import('obsidian').Setting} s @param {string} cls @param {boolean} [bare] */
function blockRow(s, cls, bare) {
  s.settingEl.addClass('lw-wrap');
  if (bare) s.settingEl.addClass('lw-bare');
  // Obsidian 1.13+ reuses the row on a redraw and empties only its controls: drop the old block.
  const old = blocks.get(s.settingEl);
  if (old) old.remove();
  const el = s.settingEl.createDiv({ cls: cls ? `lw-full ${cls}` : 'lw-full' });
  blocks.set(s.settingEl, el);
  return el;
}

export { drawRows, blockRow, noCleanup };
