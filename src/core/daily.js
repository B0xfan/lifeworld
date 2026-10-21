// A day's daily note, as Obsidian's own Daily notes setting names it (folder, date format, template):
// one copy for the Today page (Quick capture, Journal box) and the checkbox task source (new tasks
// under "Tasks" in that day's note, decision C). Moved from src/today/main.js (launch section 5).
'use strict';

import { TFile, moment } from 'obsidian';
import { pad2 } from './dates';
import { dailyNotes } from './vault';

// Minimal moment-style formatter for template tokens (used when Obsidian's
// moment isn't available, e.g. in tests).
function formatDateTokens(d, fmt) {
  const map = { YYYY: String(d.getFullYear()), MM: pad2(d.getMonth() + 1), DD: pad2(d.getDate()), HH: pad2(d.getHours()), mm: pad2(d.getMinutes()) };
  return fmt.replace(/YYYY|MM|DD|HH|mm/g, (t) => map[t]);
}
// Obsidian's moment, when there is one (not in the logic tests).
function momentFormat() { return moment ? (d, p) => moment(d).format(p) : null; }

// The daily note's name and path for a Date. `fmt` formats a date the moment way.
function scratchNameFor(d, dn, fmt) { return (fmt || formatDateTokens)(d, (dn || dailyNotes(null)).format); }
function scratchPathFor(d, dn, fmt) {
  const folder = (dn || dailyNotes(null)).folder;
  return `${folder ? folder + '/' : ''}${scratchNameFor(d, dn, fmt)}.md`;
}

function renderTemplate(tpl, d, fmt, title) {
  const f = fmt || ((date, pattern) => formatDateTokens(date, pattern));
  const name = title == null ? scratchNameFor(d, null, f) : title;
  return String(tpl)
    .replace(/\{\{\s*date\s*:\s*([^}]+?)\s*\}\}/g, (_, p) => f(d, p))
    .replace(/\{\{\s*time\s*:\s*([^}]+?)\s*\}\}/g, (_, p) => f(d, p))
    .replace(/\{\{\s*date\s*\}\}/g, f(d, 'YYYY-MM-DD'))
    .replace(/\{\{\s*time\s*\}\}/g, f(d, 'HH:mm'))
    .replace(/\{\{\s*title\s*\}\}/g, name);
}

// Adds `line` at the end of the section under the heading `## <name>` (any level, the first one found),
// before any blank lines that close it; a missing heading is added at the end of the note. Nothing
// else in the note changes.
function insertUnderHeading(text, name, line) {
  text = String(text == null ? '' : text).replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^(#{1,6}) ${esc}[ \t]*$`);
  let h = -1; let level = 0;
  for (let i = 0; i < lines.length; i++) { const m = re.exec(lines[i]); if (m) { h = i; level = m[1].length; break; } }
  if (h === -1) {
    const body = text.replace(/\s+$/, '');
    return `${body}${body ? '\n\n' : ''}## ${name}\n\n${line}\n`;
  }
  let end = lines.length;
  for (let i = h + 1; i < lines.length; i++) { const m = /^(#{1,6}) /.exec(lines[i]); if (m && m[1].length <= level) { end = i; break; } }
  let last = end - 1;
  while (last > h && lines[last].trim() === '') last--;
  const before = lines.slice(0, last + 1);
  if (last === h) before.push('');
  const after = lines.slice(last + 1);
  const out = before.concat([line], end < lines.length ? [''] : [], lines.slice(end));
  if (end >= lines.length && after.length && after[after.length - 1] === '') out.push('');
  let r = out.join('\n');
  if (!r.endsWith('\n')) r += '\n';
  return r;
}

// A new daily note's text: the Daily notes template filled in, or empty without one (as Obsidian's own
// Daily notes makes it; no type line, launch section 3).
async function newDailyContent(app, now, dn) {
  const d = dn || dailyNotes(app);
  // Obsidian stores the template without '.md'.
  const tpl = d.template ? app.vault.getAbstractFileByPath(/\.md$/i.test(d.template) ? d.template : `${d.template}.md`) : null;
  const fmt = momentFormat();
  if (tpl instanceof TFile) {
    // {{title}} is the note's own name, also when the date format nests it in folders.
    try { return renderTemplate(await app.vault.read(tpl), now, fmt, scratchNameFor(now, d, fmt).split('/').pop()); } catch { /* fall through */ }
  }
  return '';
}

// The daily note of `now` (a Date) changed by fn(text) -> text; made from the template (folders on the
// way too) when it is missing. -> its path.
async function writeDailyNote(app, now, fn) {
  const dn = dailyNotes(app);
  const path = scratchPathFor(now, dn, momentFormat());
  let file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) {
    const content = fn(await newDailyContent(app, now, dn));
    try {
      // Every missing folder on the way, so a nested date format ('YYYY/MM/YYYY-MM-DD') works too.
      const steps = path.split('/').slice(0, -1);
      for (let i = 1; i <= steps.length; i++) {
        const dir = steps.slice(0, i).join('/');
        if (!app.vault.getAbstractFileByPath(dir)) await app.vault.createFolder(dir);
      }
      await app.vault.create(path, content);
      return path;
    } catch (e) {
      file = app.vault.getAbstractFileByPath(path); // created meanwhile (e.g. by Daily notes)
      if (!(file instanceof TFile)) throw e;
    }
  }
  await app.vault.process(file, fn);
  return path;
}

export { formatDateTokens, momentFormat, scratchNameFor, scratchPathFor, renderTemplate, insertUnderHeading, newDailyContent, writeDailyNote };
