/* A4 Sidebar: the left sidebar laid out like the Lifeworld desktop app
 * (Lifeworld/src/renderer/components/Sidebar.tsx), approved from
 * 03 WiP/2026-09-22-business-ideas/mockup-sidebar.html on 2026-10-03.
 *
 * One deliberate change from Lifeworld: the type hierarchy is flipped.
 * Section names (My Life, Rooms) are the largest text, group names
 * (Direction, Wellbeing...) next, items smallest.
 *
 * It is a separate tab in the left sidebar. Obsidian's own Files tab stays
 * where it was, untouched.
 *
 * What each row does (every target below was read from that plugin's own
 * main.js, not guessed):
 *   Today    -> a4-today:open
 *   Planner  -> a4-planner:open (the A4 Planner, 2026-10-04)
 *   Focus    -> icor-for-life-focus:open-focus (the ICOR Focus map)
 *
 * Files tab chrome (0.7.0): the four toolbar buttons, the Audrey badge at the
 * bottom (opens the team roster) and the Terminal/Settings buttons on the
 * right sidebar's tab row. These used to come from ICOR Connect; A4 Sidebar
 * puts them there itself now, so Connect can stay off.
 *   Compass  -> left out: Lifeworld's Compass (Key Elements -> Goals ->
 *               Projects board) has no A4 equivalent, and the brief said not
 *               to invent one.
 *   My Life items open the item's existing dashboard where A4 has one
 *   (LANDING below), else its landing note/base, else unfold to its notes.
 *   The small chevron always unfolds the notes inside.
 *
 * "+" on a row = a4-quick-create's own modal via its public openCreate(key)
 * (added in quick-create 1.4.2), so notes come out identical to the Files
 * tab "+".
 *
 * Drag a NOTE onto any folder row to move it (fileManager.renameFile, so
 * links update). Folders are not draggable and there is no "New folder":
 * folders are the AI Team's job (CLAUDE.md hard rule 5).
 * Right-click a note: open in new tab / to the right, rename, delete, reveal
 * in Files, plus everything other plugins add through the 'file-menu' event.
 *
 * Writes nothing into notes. Its own data.json holds only fold state.
 */
'use strict';

import { Plugin, ItemView, Menu, Modal, Notice, Keymap, TFile, TFolder, normalizePath, setIcon, Platform, PluginSettingTab, Setting, FuzzySuggestModal } from 'obsidian';
import { dayOf } from '../core/dates'; // the one shared copy of the date helpers
import { partOf } from '../core/parts'; // the other parts, through LifeWorld (phase 2)
// The groups, rooms, icons and names shown (phase 2 section 6): LifeWorld's stored settings, read
// each time the panel draws. A new install has none and lists its top folders.
import { sidebarContent } from '../core/vault';
const SBC = sidebarContent;
// Phone and tablet (0.3.0): same panel, bigger touch targets, long-press for
// the menu, no drag-to-move (iOS sends no HTML drag events from a finger),
// and the drawer closes after something opens, as the Files tab does.
const IS_MOBILE = !!(Platform && Platform.isMobile);
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP = 10;

const VIEW_TYPE = 'a4-sidebar';

/* ------------------------------------------------------------------ *
 * Lifeworld's own definitions (ui.tsx), copied by value.
 * ------------------------------------------------------------------ */
const NAV = [
  { id: 'today', label: 'Today', icon: 'sun', command: 'a4-today:open', viewType: 'a4-today' },
  { id: 'planner', label: 'Planner', icon: 'board', command: 'a4-planner:open', viewType: 'a4-planner' },
  { id: 'focus', label: 'Focus', icon: 'orbit', command: 'icor-for-life-focus:open-focus', viewType: 'icor-focus-view' },
];

// Items that show part of a real folder, split ONLY on the project's GL-002
// `sphere` property (work / personal; ruling 2026-10-04). No rule, no guess:
// a project with no or another value shows under "Unsorted projects", which
// appears only when there is one.
const VIRTUAL = {
  'Work projects': { folder: 'Projects', kind: 'work' },
  'Personal projects': { folder: 'Projects', kind: 'personal' },
  'Unsorted projects': { folder: 'Projects', kind: 'unsorted', hideEmpty: true },
};
const itemFolder = (n) => (VIRTUAL[n] ? VIRTUAL[n].folder : n);
function sphereOf(fm) {
  const v = fm && typeof fm.sphere === 'string' ? fm.sphere.trim().toLowerCase() : '';
  return v === 'work' || v === 'personal' ? v : 'unsorted';
}
const PROJECT_STATUS_ORDER = { active: 0, paused: 1, backlog: 2 };
function sortProjects(list) {
  return list.slice().sort((a, b) => ((PROJECT_STATUS_ORDER[a.status] ?? 3) - (PROJECT_STATUS_ORDER[b.status] ?? 3)) || collator.compare(a.name, b.name));
}
// Work / Personal / Unsorted count = the projects A4 Projects lists as open
// (bug 2026-10-05: 16 shown, 14 listed; the 2 failed ones were counted). The
// rule is A4 Projects' own (`isOpenProjectNote`), never a copy here. Without
// A4 Projects there is no open list to match, so every project counts.
function openRuleFrom(projectsPlugin) {
  return projectsPlugin && typeof projectsPlugin.isOpenProjectNote === 'function'
    ? (fm) => !!projectsPlugin.isOpenProjectNote(fm) : () => true;
}
// The list that folds out under Work / Personal / Unsorted shows the same
// open projects as the count (ruling 2026-10-05, Audrey): failed, done and
// dropped ones stay reachable from the Projects page's Closed section.
const openProjects = (members) => members.filter((m) => m.open);
const openProjectCount = (members) => openProjects(members).length;

// A4's existing dashboards for the Lifeworld items that open one.
const LANDING = {
  'Client Analytics': { command: 'a4-analytics:open-client-analytics' },
  Finance: { command: 'a4-finance:open-finance-summary' },
  Health: { command: 'a4-health:open-health-dashboard' },
  Movies: { command: 'a4-media:open-a4-media-library' },
  Media: { command: 'a4-media:open-a4-music' },
  Reading: { command: 'reading-vault:open-reading' },
};

// Lifeworld's stroke icons (ui.tsx P), 24x24 viewBox.
const P = {
  sun: 'M12 4V2M12 22v-2M4.9 4.9 3.5 3.5M20.5 20.5l-1.4-1.4M4 12H2M22 12h-2M4.9 19.1l-1.4 1.4M20.5 3.5l-1.4 1.4M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',
  calendar: 'M8 2v4M16 2v4M3 9h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  board: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 3v18M15 3v18',
  compass: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM16.2 7.8l-2.1 6.3-6.3 2.1 2.1-6.3z',
  orbit: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.5 6.5a9.5 9.5 0 1 1-3-2.6M20 4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
  check: 'M20 6 9 17l-5-5',
  plus: 'M12 5v14M5 12h14',
  x: 'M18 6 6 18M6 6l12 12',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z',
  folder: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z',
  book: 'M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20',
  film: 'M3 3h18v18H3zM7 3v18M17 3v18M3 7.5h4M3 12h18M3 16.5h4M17 7.5h4M17 16.5h4',
  heart: 'M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z',
  pulse: 'M22 12h-4l-3 9L9 3l-3 9H2',
  wallet: 'M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4',
  chart: 'M3 3v18h18M7 16l4-4 4 4 5-6',
  trophy: 'M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.7V17c0 .6-.5 1-1 1.2C7.8 18.8 7 20.2 7 22M14 14.7V17c0 .6.5 1 1 1.2 1.2.6 2 2 2 3.8M18 2H6v7a6 6 0 0 0 12 0z',
  flame: 'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3.4.3 1.6 1.2 2.9 2.5 2.9z',
  smile: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01',
  note: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7zM14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8',
  pen: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  search: 'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM21 21l-4.3-4.3',
  chevL: 'M15 18l-6-6 6-6', chevR: 'M9 18l6-6-6-6', chevD: 'M6 9l6 6 6-6',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6v6l4 2',
  cloud: 'M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9z',
  drop: 'M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z',
  wave: 'M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1',
  target: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  diamond: 'M2.7 10.3a2.4 2.4 0 0 0 0 3.4l7.6 7.6a2.4 2.4 0 0 0 3.4 0l7.6-7.6a2.4 2.4 0 0 0 0-3.4l-7.6-7.6a2.4 2.4 0 0 0-3.4 0z',
  layers: 'M12 2 2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  kanban: 'M6 5v11M12 5v6M18 5v14',
  map: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15',
  plane: 'M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z',
  chef: 'M17 21a1 1 0 0 0 1-1v-5.4a6 6 0 0 0 1.7-11.4 5 5 0 0 0-9.4 0A6 6 0 0 0 6 14.6V20a1 1 0 0 0 1 1zM6 17h12',
  user: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  music: 'M9 18V5l12-2v13M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 13a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  cloudSun: 'M12 2v2M4.9 4.9l1.4 1.4M20 12h2M19.1 4.9l-1.4 1.4M15.9 13A4 4 0 0 0 8.1 11M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6z',
  hash: 'M4 9h16M4 15h16M10 3 8 21M16 3l-2 18',
  bolt: 'M13 2 3 14h9l-1 8 10-12h-9z',
  arrowUpRight: 'M7 7h10v10M7 17 17 7',
  bot: 'M12 8V4H8M4 8h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM2 14h2M20 14h2M15 13v2M9 13v2',
  box: 'M21 8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7zM3.3 7 12 12l8.7-5M12 22V12',
  bench: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z',
  sparkle: 'M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z',
  dot: 'M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
};

/* ------------------------------------------------------------------ *
 * Pure logic (exported for the node test suite; no Obsidian objects).
 * ------------------------------------------------------------------ */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const nameOf = (p) => p.slice(p.lastIndexOf('/') + 1);

// Lifeworld: rooms are keyed on the numeric prefix; a rename after it is a no-op. The room's colour
// is its place in the list. No rooms set (a new install): every top folder, A to Z, plain.
function findRoomFolders(rootFolderNames) {
  if (!SBC.rooms.length) return rootFolderNames.slice().sort(collator.compare).map((path) => ({ name: path, icon: 'folder', path }));
  return SBC.rooms.map((r, c) => {
    const path = rootFolderNames.filter((n) => n.startsWith(r.prefix)).sort(collator.compare)[0];
    return path ? { ...r, c, path } : null;
  }).filter(Boolean);
}

// My Life groups: Lifeworld's order; folders A4 does not have are skipped; any
// My Life folder no group names lands in "More" (Lifeworld does the same).
function buildLifeGroups(myLifeFolderNames) {
  const have = new Set(myLifeFolderNames);
  const used = new Set();
  const groups = SBC.groups.map((g) => {
    const items = g.folders.filter((n) => have.has(itemFolder(n)));
    items.forEach((n) => used.add(itemFolder(n)));
    return { id: g.id, label: g.label, items };
  });
  const rest = myLifeFolderNames.filter((n) => !used.has(n)).sort(collator.compare);
  if (rest.length) groups.push({ id: 'more', label: 'More', items: rest });
  return groups.filter((g) => g.items.length);
}

function itemLabel(name) { return SBC.labels[name] || name; }
function itemIcon(name) { return SBC.icons[name] || 'folder'; }
function itemShowsCount(name) { return !SBC.noCount.includes(name); }

// What clicking a My Life item does, in order: an A4 dashboard command that
// is actually registered; else a landing note named like the folder; else a
// single .base in the folder; else unfold.
function resolveLanding(name, folderPath, childPaths, hasCommand) {
  const l = LANDING[name];
  if (l && hasCommand(l.command)) return { kind: 'command', id: l.command };
  const note = `${folderPath}/${name}.md`;
  if (childPaths.includes(note)) return { kind: 'file', path: note };
  const bases = childPaths.filter((p) => parentOf(p) === folderPath && p.endsWith('.base'));
  if (bases.length === 1) return { kind: 'file', path: bases[0] };
  return { kind: 'toggle' };
}

// Markdown note count under a folder (recursive). One pass over all paths.
function countNotes(allFilePaths, folderPaths) {
  const out = {};
  for (const f of folderPaths) out[f] = 0;
  for (const p of allFilePaths) {
    if (!p.endsWith('.md')) continue;
    let d = parentOf(p);
    while (d) { if (d in out) out[d] += 1; d = parentOf(d); }
  }
  return out;
}

/* Sort order (0.8.0). Approved mockups: 03 WiP/2026-09-22-business-ideas/
 * mockup-sidebar-sort-settings.html (2026-10-07) and 03 WiP/2026-10-08-sort-
 * options-in-a4-plugin/mockup.html (2026-10-08, option A, no drag order).
 * Replaces Explorer Order Editor + Custom File Explorer sorting, whose saved
 * lists froze (new notes dropped to the bottom). Nothing here is a saved list
 * of notes: the order is worked out from the names on every render, so a new
 * note lands in its place by itself.
 *
 *   dates          'last' (Newest last) | 'first' (Newest first): notes whose
 *                  name starts with a date, by the real date and time.
 *   newestFirstIn  folders (and everything inside them) always newest first.
 *                  A plain name with no "/" ("Journal") means every folder
 *                  with that name, as the 0.7 rule did: the Inner World
 *                  Journal and every AI Team agent's Journal.
 *   text           'az' | 'za': everything without a date, after the dated ones.
 *   folders        false: folders on top, A to Z. true: folders on top, ordered
 *                  by the same rule as the notes. A folder with its own order
 *                  (Folder by folder, Always newest first, or a listed parent)
 *                  orders its subfolders by that order too, whatever this says
 *                  (0.8.1, 2026-10-08: WiP set to Newest first still
 *                  listed its dated work folders oldest first). Folders whose
 *                  name has no date (_archive) go after the dated ones.
 *   perFolder      { path: 'newest'|'oldest'|'az'|'za' } "Folder by folder";
 *                  a subfolder follows the nearest listed parent. The nearest
 *                  folder that is listed (here or in newestFirstIn) wins.
 * Pre-filled with what the two retired plugins did (progress report
 * 2026-10-08): Scratchpad and Reports newest first; Inner World, Library
 * Notes and My Life (Projects and its three folders, Sports, Topics) A to Z.
 */
const SORT_MODES = ['newest', 'oldest', 'az', 'za'];
const SORT_LABEL = { newest: 'Newest first', oldest: 'Oldest first', az: 'A to Z', za: 'Z to A' };
const DEFAULT_SORT = {
  dates: 'last',
  newestFirstIn: ['00 Daily Scratchpad', 'Journal', '06 AI Team/Scheduled Jobs/Reports'],
  text: 'az',
  folders: false,
  perFolder: {
    '00 Daily Scratchpad': 'newest',
    '04 Inner World': 'az',
    '04 Inner World/Library Notes': 'az',
    '04 Inner World/My Life': 'az',
    '06 AI Team/Scheduled Jobs/Reports': 'newest',
  },
};

// Saved settings -> a clean sort object. Missing = the pre-filled defaults; a
// damaged value falls back to its default rather than breaking the list.
function normalizeSort(saved) {
  const s = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  const out = {
    dates: s.dates === 'first' ? 'first' : 'last',
    text: s.text === 'za' ? 'za' : 'az',
    folders: s.folders === true,
    newestFirstIn: Array.isArray(s.newestFirstIn) ? [...new Set(s.newestFirstIn.filter((p) => typeof p === 'string' && p))] : DEFAULT_SORT.newestFirstIn.slice(),
    perFolder: {},
  };
  const pf = s.perFolder && typeof s.perFolder === 'object' && !Array.isArray(s.perFolder) ? s.perFolder : (s.perFolder === undefined ? DEFAULT_SORT.perFolder : {});
  for (const [p, m] of Object.entries(pf)) if (p && SORT_MODES.includes(m)) out.perFolder[p] = m;
  return out;
}

// Which rule orders this folder: its own entry, else the nearest parent's
// (per-folder entry or the always-newest-first list), else null = main setting.
function sortRuleFor(folderPath, sort) {
  for (let p = folderPath; p; p = parentOf(p)) {
    if (Object.prototype.hasOwnProperty.call(sort.perFolder, p)) return { mode: sort.perFolder[p], from: p };
    if (sort.newestFirstIn.includes(p) || sort.newestFirstIn.includes(nameOf(p))) return { mode: 'newest', from: p, always: true };
  }
  return null;
}

// Date at the START of a name, in A4's naming styles: 2026-10-08..., 10-08-2026,
// quick captures "10-08-2026 - 2-05 PM" and older "10-08-2026 - 1328".
// -> { day: 20261008, time: minutes or -1 } or null. Impossible dates are not dates.
function dateKey(name) {
  const n = String(name || '');
  let y, mo, d, rest;
  let m = /^(\d{4})-(\d{2})-(\d{2})(?!\d)(.*)$/.exec(n);
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; rest = m[4]; } else {
    m = /^(\d{2})-(\d{2})-(\d{4})(?!\d)(.*)$/.exec(n);
    if (!m) return null;
    mo = +m[1]; d = +m[2]; y = +m[3]; rest = m[4];
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  let time = -1;
  const ap = /^ - (\d{1,2})-(\d{2}) ?(AM|PM)\b/i.exec(rest);
  const hm = /^ - (\d{2})(\d{2})(?!\d)/.exec(rest);
  if (ap && +ap[1] >= 1 && +ap[1] <= 12 && +ap[2] < 60) time = ((+ap[1] % 12) + (/pm/i.test(ap[3]) ? 12 : 0)) * 60 + +ap[2];
  else if (hm && +hm[1] < 24 && +hm[2] < 60) time = +hm[1] * 60 + +hm[2];
  return { day: y * 10000 + mo * 100 + d, time };
}

// Comparator for one mode. 'az'/'za' = by name only (what the old plugins did).
// Date modes: dated names first, by date then time then name, in the date
// direction; then everything without a date in the Text order.
function sortComparator(mode, sort) {
  const byName = (a, b) => collator.compare(a.name, b.name);
  if (mode === 'az') return byName;
  if (mode === 'za') return (a, b) => -byName(a, b);
  const dir = mode === 'newest' ? -1 : mode === 'oldest' ? 1 : (sort.dates === 'first' ? -1 : 1);
  const tdir = sort.text === 'za' ? -1 : 1;
  return (a, b) => {
    const da = dateKey(a.name), db = dateKey(b.name);
    if (da && db) return (da.day - db.day || da.time - db.time || byName(a, b)) * dir;
    if (da) return -1;
    if (db) return 1;
    return byName(a, b) * tdir;
  };
}

// Folders on top, then notes. Called on every render, so it always reflects
// what is in the folder now (the bug in the two old plugins was a frozen list).
function sortChildren(folderPath, children, sortSettings) {
  const sort = sortSettings || normalizeSort(undefined);
  const rule = sortRuleFor(folderPath, sort);
  const cmp = sortComparator(rule ? rule.mode : 'main', sort);
  const folders = children.filter((c) => c.isFolder).sort(rule || sort.folders ? cmp : (a, b) => collator.compare(a.name, b.name));
  const files = children.filter((c) => !c.isFolder).sort(cmp);
  return folders.concat(files);
}

// "04 Inner World/Library Notes" -> "Inner World / Library Notes"
function folderDisplay(path) { return String(path || '').split('/').map((s) => s.replace(/^\d\d /, '')).join(' / '); }

// Set (mode) or clear (null) one folder's own order. Returns a new sort object.
function setFolderSort(sort, path, mode) {
  const perFolder = { ...sort.perFolder };
  if (mode && SORT_MODES.includes(mode)) perFolder[path] = mode; else delete perFolder[path];
  return { ...sort, perFolder };
}

// A folder was renamed or moved: carry its (and its subfolders') entries along.
function renameSortPaths(sort, oldPath, newPath) {
  const move = (p) => (p === oldPath ? newPath : p.startsWith(oldPath + '/') ? newPath + p.slice(oldPath.length) : p);
  const perFolder = {};
  for (const [p, m] of Object.entries(sort.perFolder)) perFolder[move(p)] = m;
  return { ...sort, perFolder, newestFirstIn: [...new Set(sort.newestFirstIn.map(move))] };
}

// Can this note be dropped into that folder? Returns { ok, reason, newPath }.
function planMove(srcPath, srcIsFolder, destFolder, exists) {
  if (srcIsFolder) return { ok: false, reason: 'folders-stay-put' };
  if (!destFolder) return { ok: false, reason: 'no-target' };
  if (parentOf(srcPath) === destFolder) return { ok: false, reason: 'same-folder' };
  const newPath = `${destFolder}/${nameOf(srcPath)}`;
  if (exists(newPath)) return { ok: false, reason: 'name-taken' };
  return { ok: true, newPath };
}

// A row only receives `drop` if it accepted `dragover`. A name clash is
// accepted (no highlight) so the drop can say why nothing moved; the other
// refusals (same folder, a folder, no target) stay silent no-drop targets.
function dropAccepts(p) { return !!p && (p.ok || p.reason === 'name-taken'); }
const showName = (folderName) => String(folderName || '').replace(/^\d\d /, ''); // "01 Inbox" shows as "Inbox"
function nameTakenMessage(fileName, folderName) {
  const n = String(fileName || '');
  return `A note called ${n.endsWith('.md') ? n.slice(0, -3) : n} is already in ${showName(folderName)}.`;
}

// Rename: keeps the extension and the folder; rejects empty, slashes, clashes.
function planRename(srcPath, newBase, exists) {
  const base = String(newBase || '').trim();
  if (!base) return { ok: false, reason: 'empty' };
  if (/[\\/:]/.test(base)) return { ok: false, reason: 'bad-character' };
  const name = nameOf(srcPath);
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot) : '';
  const dir = parentOf(srcPath);
  const newPath = (dir ? dir + '/' : '') + base + ext;
  if (newPath === srcPath) return { ok: false, reason: 'unchanged' };
  if (exists(newPath)) return { ok: false, reason: 'name-taken' };
  return { ok: true, newPath };
}

// Which My Life group holds the active note (Lifeworld opens that group).
function activeGroupFor(activePath, groups, classify) {
  if (!activePath) return null;
  for (const g of groups) for (const n of g.items) {
    if (!activePath.startsWith(`${SBC.life}/${itemFolder(n)}/`)) continue;
    if (!VIRTUAL[n]) return g.id;
    if (classify && classify(activePath) === VIRTUAL[n].kind) return g.id;
  }
  return null;
}

// Which room the open note belongs to (highlighted like Today/Planner/Focus).
// A note the My Life section already shows highlights its My Life item instead.
function activeRoomFor(activePath, roomPaths, hidden) {
  if (!activePath) return null;
  for (const h of hidden || []) if (activePath.startsWith(h + '/')) return null;
  return roomPaths.find((r) => activePath.startsWith(r + '/')) || null;
}

// Outside files being dragged in? Same test Obsidian's Files list uses
// (any item of kind "file"; iOS only reports the "Files" type).
function hasExternalFiles(dt) {
  if (!dt) return false;
  for (const it of Array.from(dt.items || [])) if (it.kind === 'file') return true;
  return Array.from(dt.types || []).includes('Files');
}

// "report.final.pdf" -> { name: 'report.final', ext: 'pdf' }; ".env" -> { name: '.env', ext: '' }
function splitName(n) {
  const i = n.lastIndexOf('.');
  return i > 0 ? { name: n.slice(0, i), ext: n.slice(i + 1) } : { name: n, ext: '' };
}

// Obsidian's getAvailablePath: "name.ext", then "name 1.ext", "name 2.ext"...
function freePath(folderPath, name, ext, exists) {
  const at = (b) => (folderPath ? folderPath + '/' : '') + b + (ext ? '.' + ext : '');
  let p = at(name);
  for (let n = 1; exists(p); n++) p = at(`${name} ${n}`);
  return p;
}

// Split a drop into files and folders (folders are never imported here).
function collectDropped(dt) {
  const files = []; let folders = 0;
  for (const it of Array.from((dt && dt.items) || [])) {
    if (it.kind !== 'file') continue;
    const entry = typeof it.webkitGetAsEntry === 'function' ? it.webkitGetAsEntry() : null;
    if (entry && entry.isDirectory) { folders += 1; continue; }
    const f = it.getAsFile();
    if (f) files.push(f);
  }
  if (!files.length && !folders && dt && dt.files) for (const f of Array.from(dt.files)) files.push(f);
  return { files, folders };
}

// Long-press: fires once the finger has stayed put long enough.
function longPressState(start, now, moved) {
  if (moved > LONG_PRESS_SLOP) return 'cancel';
  return now - start >= LONG_PRESS_MS ? 'fire' : 'wait';
}

// Placement is per device kind: data.json syncs between Mac and phone, so the
// Mac's "already placed" must not stop the phone from adding its own tab.
function placedKey(isMobile) { return isMobile ? 'placedMobile' : 'placed'; }

// Group open state: remembered once toggled, else open only if active.
function isGroupOpen(id, remembered, activeGroup) {
  return Object.prototype.hasOwnProperty.call(remembered, id) ? !!remembered[id] : id === activeGroup;
}

// quick-create targets keyed by folder path.
function plusTargetsByPath(targets) {
  const out = {};
  for (const t of targets || []) if (t && t.navPath) out[t.navPath] = t;
  return out;
}

// Folders the My Life section already shows: the My Life folder itself (it IS
// the section) and every item folder in it. Rooms skip these, so nothing is
// listed twice (2026-10-03). Display only; no folder is moved.
function hiddenUnderRooms(groups) {
  const out = new Set();
  if (!groups || !groups.length) return out;
  out.add(SBC.life);
  for (const g of groups) for (const n of g.items) out.add(`${SBC.life}/${itemFolder(n)}`);
  return out;
}

// Markdown count under a folder, leaving out notes inside hidden folders.
function countNotesExcluding(allFilePaths, folderPaths, hidden) {
  const keep = allFilePaths.filter((p) => { for (const h of hidden) if (p.startsWith(h + '/')) return false; return true; });
  return countNotes(keep, folderPaths);
}

// Toolbar (approved 2026-10-03; "New unique note" added and the commands made
// our own in 0.7.0, plugin overhaul step 3, mockup approved 2026-10-06).
// The same four buttons sit on BOTH the A4 tab and the Files tab, in this
// order, with the icons and tooltips already known. They used to call the
// ICOR Connect plugin's commands; that plugin is switched off now, so the
// commands below are A4 Sidebar's own. Three of them only run an Obsidian core
// command; the canvas one is a few lines of our own.
const TOOLS = [
  { id: 'daily', icon: 'calendar-check', label: "Open today's daily note", command: 'a4-sidebar:open-daily-note' },
  { id: 'unique', icon: 'file-clock', label: 'New unique note', command: 'a4-sidebar:new-unique-note' },
  { id: 'canvas', icon: 'layout-dashboard', label: 'New canvas in the Daily Scratchpad', command: 'a4-sidebar:new-scratchpad-canvas' },
  { id: 'graph', icon: 'git-fork', label: 'Open graph view', command: 'a4-sidebar:open-graph-view' },
];
// Obsidian core commands behind three of the buttons, and the core plugin to
// name in the notice when it is turned off. The unique-note NAME
// (MM-DD-YYYY - h-mm A) comes from core "Unique note creator" settings
// (.obsidian/zk-prefixer.json), never from this plugin.
const CORE_TOOLS = {
  'open-daily-note': { name: "Open today's daily note", core: 'daily-notes', plugin: 'Daily notes' },
  'new-unique-note': { name: 'New unique note', core: 'zk-prefixer', plugin: 'Unique note creator' },
  'open-graph-view': { name: 'Open graph view', core: 'graph:open', plugin: 'Graph view' },
};
// Bases button (0.9.0, mockup approved 2026-10-08): one more icon in
// both rows, between graph and the rest. It drops down every .base file in the
// vault, A to Z, with the folder it lives in shown faintly on the right. The
// list is read from the vault on every click, so a new base appears with no
// upkeep. TaskNotes' starter views are left out (TaskNotes is not used;
// the files stay where they are).
const BASES_TOOL = { id: 'bases', icon: 'database', label: 'Open a base' };
// Added by an add-on through LifeWorld (phase 2 section 7): rows under Today/Planner/Focus ('nav') and
// toolbar buttons on both toolbars ('tools'), { id, label, icon, onClick }, in the order added.
// shortcut: kept for this LifeWorld start only; an add-on adds them again when LifeWorld restarts.
const EXTRA = { nav: [], tools: [] };
function addExtra(kind, def) {
  // 'toggle-all' is the Expand/Collapse button, found by that id (syncToggleAll; review p2-s7b).
  const taken = kind === 'nav' ? NAV.concat(EXTRA.nav) : TOOLS.concat([BASES_TOOL, { id: 'toggle-all' }], EXTRA.tools);
  if (taken.some((x) => x.id === def.id)) throw new Error(`LifeWorld: there is already a Sidebar ${kind === 'nav' ? 'item' : 'button'} "${def.id}"`);
  EXTRA[kind].push(def);
  return () => { const i = EXTRA[kind].indexOf(def); if (i !== -1) EXTRA[kind].splice(i, 1); };
}
// An add-on's click: an error (thrown or a rejected promise) is logged, never breaks the Sidebar.
function runExtra(x) {
  return Promise.resolve().then(() => x.onClick()).catch((e) => console.error(`LifeWorld: add-on button ${x.id} failed`, e));
}
// One add-on button: Obsidian's icon names (setIcon), as the toolbar's own buttons use.
function extraButton(parent, cls, x) {
  const b = parent.createDiv({ cls, attr: { 'aria-label': x.label, 'data-tool': x.id } });
  setIcon(b, x.icon);
  b.addEventListener('click', () => runExtra(x));
  return b;
}
// The faint folder name: the folder the base sits in, or the one above when
// the base is named after its own folder (People.base in Contacts/People
// reads "Contacts"); a room's number is dropped ("Inner World").
function baseWhere(path, name) {
  const parts = path.split('/').slice(0, -1);
  let i = parts.length - 1;
  if (i > 0 && collator.compare(parts[i], name) === 0) i--;
  return i < 0 ? '' : parts[i].replace(/^\d\d /, '');
}
function listBases(paths) {
  return paths
    .filter((p) => /\.base$/i.test(p) && !SBC.basesSkip.some((s) => p.startsWith(s)))
    .map((p) => { const name = nameOf(p).replace(/\.base$/i, ''); return { path: p, name, where: baseWhere(p, name) }; })
    .sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.path, b.path));
}
const SCRATCHPAD = '00 Daily Scratchpad';
// the retired add-on whose Files-tab buttons these replace (see connectOn)
const LEGACY_CHROME = ['icor', 'for', 'life', 'connect'].join('-');
// The Audrey badge at the bottom of the Files tab opens the team roster
// (2026-10-06).
const ROSTER = '06 AI Team/Agents/agent-index.md';

// New canvas path: 00 Daily Scratchpad/YYYY-MM-DD_canvas.canvas, then
// _canvas-1, _canvas-2... when the name is taken (the naming already in use).
function canvasPath(date, exists) {
  const base = `${SCRATCHPAD}/${dayOf(date)}_canvas`;
  let p = `${base}.canvas`;
  for (let i = 1; exists(p); i++) p = `${base}-${i}.canvas`;
  return p;
}

// The A4 mark (06 AI Team/AI Team Knowledge/Brand/a4-mark.svg geometry): ink
// strokes take the text colour, the crossbar the marker orange (styles.css),
// so one SVG serves light and dark.
function a4Mark() {
  const svg = document.createElementNS(SVGNS_MARK, 'svg');
  svg.setAttribute('class', 'a4sb-audrey-mark'); svg.setAttribute('viewBox', '0 0 112 74'); svg.setAttribute('aria-hidden', 'true');
  const g = document.createElementNS(SVGNS_MARK, 'g');
  g.setAttribute('class', 'a4sb-mark-ink'); g.setAttribute('fill', 'none'); g.setAttribute('stroke-width', '6');
  g.setAttribute('stroke-linejoin', 'round'); g.setAttribute('stroke-linecap', 'round'); g.setAttribute('transform', 'translate(10,2)');
  for (const d of ['M6 42 L26 6 L46 42', 'M78 6 L58 30 L92 30', 'M78 6 V44']) { const p = document.createElementNS(SVGNS_MARK, 'path'); p.setAttribute('d', d); g.appendChild(p); }
  svg.appendChild(g);
  const bar = document.createElementNS(SVGNS_MARK, 'path');
  bar.setAttribute('class', 'a4sb-mark-bar'); bar.setAttribute('d', 'M24 32 H102'); bar.setAttribute('fill', 'none'); bar.setAttribute('stroke-width', '6'); bar.setAttribute('stroke-linecap', 'round');
  svg.appendChild(bar);
  return svg;
}
const SVGNS_MARK = 'http://www.w3.org/2000/svg';

// Expand/collapse all, mirroring the Files button: it reads "Expand all" while
// anything is folded, "Collapse all" once everything is open.
function isAllOpen(state, groupIds, sectionIds, activeGroup) {
  return sectionIds.every((id) => state.sections[id] !== false) && groupIds.every((id) => isGroupOpen(id, state.groups, activeGroup));
}
function toggleAll(state, groupIds, sectionIds, activeGroup) {
  const open = !isAllOpen(state, groupIds, sectionIds, activeGroup);
  const sections = { ...state.sections }; const groups = { ...state.groups };
  for (const id of sectionIds) { if (open) delete sections[id]; else sections[id] = false; }
  for (const id of groupIds) groups[id] = open;
  return { ...state, sections, groups, open: open ? state.open : {} };
}

const FILE_CAP = 400; // Lifeworld caps a folder's file list at 400 rows

/* ------------------------------------------------------------------ *
 * DOM helpers
 * ------------------------------------------------------------------ */
const SVGNS = 'http://www.w3.org/2000/svg';
function icon(name, size, cls) {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('class', 'a4sb-icon' + (cls ? ' ' + cls : ''));
  s.setAttribute('width', String(size || 16)); s.setAttribute('height', String(size || 16));
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.75'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', P[name] || P.dot); s.appendChild(p);
  return s;
}

class RenameModal extends Modal {
  constructor(app, file) { super(app); this.file = file; }
  onOpen() {
    const { contentEl } = this;
    this.titleEl.setText('Rename note');
    const input = contentEl.createEl('input', { type: 'text', cls: 'a4sb-rename-input' });
    input.value = this.file.basename;
    const err = contentEl.createDiv({ cls: 'a4sb-rename-err' });
    const row = contentEl.createDiv({ cls: 'modal-button-container' });
    const go = row.createEl('button', { text: 'Rename', cls: 'mod-cta' });
    row.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    const submit = async () => {
      const plan = planRename(this.file.path, input.value, (p) => !!this.app.vault.getAbstractFileByPath(p));
      if (!plan.ok) {
        if (plan.reason === 'unchanged') { this.close(); return; }
        err.setText({ empty: 'Type a name.', 'bad-character': 'Names cannot contain / \\ or :', 'name-taken': 'A note with that name is already there.' }[plan.reason] || 'Cannot rename.');
        return;
      }
      await this.app.fileManager.renameFile(this.file, normalizePath(plan.newPath));
      this.close();
    };
    go.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    window.setTimeout(() => { input.focus(); input.select(); }, 0);
  }
  onClose() { this.contentEl.empty(); }
}

/* ------------------------------------------------------------------ *
 * The view
 * ------------------------------------------------------------------ */
class A4SidebarView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this.dragging = null; this.classify = (p) => this.classifyPath(p); }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return SBC.brand; }
  // A changed Sidebar name reaches the tab title too (review p2-s6); Obsidian reads it only when the tab opens.
  // shortcut: titleEl and leaf.updateHeader are Obsidian internals (not in obsidian.d.ts 1.14.4, read in its
  // app code; reviewed in section 8: no public call redraws a tab title). Upgrade if Obsidian adds one.
  syncTitle() {
    if (this.shownTitle !== undefined && this.shownTitle !== SBC.brand) {
      // An Obsidian update that makes these throw must not blank the Sidebar (review p2-s7).
      try {
        if (this.titleEl) this.titleEl.setText(SBC.brand);
        if (this.leaf && typeof this.leaf.updateHeader === 'function') this.leaf.updateHeader();
      } catch (e) { console.error('LifeWorld: the Sidebar tab title did not update', e); }
    }
    this.shownTitle = SBC.brand;
  }
  getIcon() { return 'layout-list'; }

  async onOpen() {
    this.contentEl.addClass('a4sb');
    this.render();
    const later = () => this.plugin.scheduleRender();
    this.registerEvent(this.app.vault.on('create', later));
    this.registerEvent(this.app.vault.on('delete', later));
    this.registerEvent(this.app.vault.on('rename', later));
    // a project gaining a client or Career moves between the two lists
    this.registerEvent(this.app.metadataCache.on('changed', (file) => { if (SBC.life && file && file.path.startsWith(`${SBC.life}/Projects/`)) later(); }));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.markActive()));
    this.registerEvent(this.app.workspace.on('file-open', () => this.markActive()));
  }

  // 'work' / 'personal' for a project note directly in My Life/Projects, else null.
  classifyPath(path) {
    const dir = `${SBC.life}/Projects/`;
    if (!SBC.life || !path || !path.startsWith(dir) || path.slice(dir.length).includes('/')) return null;
    const f = this.app.vault.getAbstractFileByPath(path);
    const fm = f && (this.app.metadataCache.getFileCache(f) || {}).frontmatter;
    if (!fm || fm.type !== 'project') return null;
    return sphereOf(fm);
  }

  hasCommand(id) { const c = this.app.commands; return !!(c && c.commands && c.commands[id]); }
  run(id) {
    if (id !== 'switcher:open') this.clicked = null;
    if (this.hasCommand(id)) { this.app.commands.executeCommandById(id); this.markActive(); if (id !== 'switcher:open') this.closeDrawer(); return true; }
    new Notice('That part is not turned on.');
    return false;
  }

  folder(path) { const f = this.app.vault.getAbstractFileByPath(path); return f instanceof TFolder ? f : null; }

  render() {
    const root = this.contentEl;
    const scroller = root.querySelector('.a4sb-scroll');
    const keep = scroller ? scroller.scrollTop : 0;
    root.empty();
    this.syncTitle();
    const st = this.plugin.state;
    const all = this.app.vault.getAllLoadedFiles();
    const filePaths = all.filter((f) => f instanceof TFile).map((f) => f.path);
    const vaultRoot = this.app.vault.getRoot();
    const rooms = findRoomFolders(vaultRoot.children.filter((c) => c instanceof TFolder).map((c) => c.path));
    const myLife = SBC.life ? this.folder(SBC.life) : null;
    const groups = buildLifeGroups(myLife ? myLife.children.filter((c) => c instanceof TFolder).map((c) => c.name) : []);
    this.groups = groups;
    const countFolders = rooms.map((r) => r.path).concat(groups.flatMap((g) => g.items.map((n) => `${SBC.life}/${itemFolder(n)}`)));
    this.hideInRooms = hiddenUnderRooms(groups);
    this.counts = Object.assign(
      countNotes(filePaths, countFolders),
      countNotesExcluding(filePaths, rooms.map((r) => r.path), this.hideInRooms),
    );
    const qc = this.app.plugins && this.app.plugins.plugins && this.app.plugins.plugins['a4-quick-create'];
    this.qc = qc && typeof qc.openCreate === 'function' ? qc : null;
    this.plus = plusTargetsByPath(this.qc && this.qc.createTargets ? this.qc.createTargets() : []);
    const activePath = this.activePath();
    const activeGroup = activeGroupFor(activePath, groups, this.classify);

    // toolbar, same look as the Files tab's
    const header = root.createDiv({ cls: 'nav-header a4sb-header' });
    const bar = header.createDiv({ cls: 'nav-buttons-container a4sb-tools' });
    for (const t of TOOLS) {
      const b = bar.createDiv({ cls: 'clickable-icon nav-action-button', attr: { 'aria-label': t.label, 'data-tool': t.id } });
      setIcon(b, t.icon);
      b.addEventListener('click', () => this.run(t.command));
    }
    const bb = bar.createDiv({ cls: 'clickable-icon nav-action-button', attr: { 'aria-label': BASES_TOOL.label, 'data-tool': BASES_TOOL.id } });
    setIcon(bb, BASES_TOOL.icon);
    bb.addEventListener('click', () => this.plugin.showBases(bb));
    for (const x of EXTRA.tools) extraButton(bar, 'clickable-icon nav-action-button', x);
    const sectionIds = ['mylife', 'rooms'].filter((id) => id !== 'mylife' || groups.length);
    const allOpen = isAllOpen(st, groups.map((g) => g.id), sectionIds, activeGroup);
    const ex = bar.createDiv({ cls: 'clickable-icon nav-action-button', attr: { 'aria-label': allOpen ? 'Collapse all' : 'Expand all', 'data-tool': 'toggle-all' } });
    setIcon(ex, allOpen ? 'chevrons-down-up' : 'chevrons-up-down');
    ex.addEventListener('click', () => {
      const next = toggleAll(this.plugin.state, groups.map((g) => g.id), sectionIds, activeGroupFor(this.activePath(), groups, this.classify));
      Object.assign(this.plugin.state, next);
      this.plugin.saveState();
      this.render();
    });

    // top: brand + search
    const top = root.createDiv({ cls: 'a4sb-top' });
    const brand = top.createDiv({ cls: 'a4sb-brand' });
    brand.createSpan({ cls: 'a4sb-brand-mark' }).createEl('i');
    brand.createSpan({ cls: 'a4sb-brand-name', text: SBC.brand });
    const search = root.createDiv({ cls: 'a4sb-search', attr: { role: 'button', tabindex: '0' } });
    search.appendChild(icon('search', 14));
    search.createSpan({ text: 'Search' });
    search.addEventListener('click', () => this.run('switcher:open'));

    const scroll = root.createDiv({ cls: 'a4sb-scroll' });
    const nav = scroll.createEl('nav', { cls: 'a4sb-nav' });
    for (const n of NAV) {
      if (!this.hasCommand(n.command)) continue; // a plugin that is off shows no dead link
      const b = nav.createDiv({ cls: 'a4sb-nav-item', attr: { role: 'button', tabindex: '0', 'data-nav': n.id, 'data-view': n.viewType } });
      b.appendChild(icon(n.icon, 16));
      b.createSpan({ text: n.label });
      b.addEventListener('click', async () => {
        if (!this.run(n.command)) return;
        // Some views only bring an existing tab forward without making it the
        // active one (a4-today's openToday uses revealLeaf), which would leave
        // the previous page highlighted. Make the opened view the active tab.
        await new Promise((r) => window.setTimeout(r, 250));
        const leaf = this.app.workspace.getLeavesOfType(n.viewType)[0];
        if (leaf && this.app.workspace.getMostRecentLeaf() !== leaf) this.app.workspace.setActiveLeaf(leaf, { focus: true });
        this.markActive();
      });
    }
    for (const x of EXTRA.nav) {
      const b = nav.createDiv({ cls: 'a4sb-nav-item', attr: { role: 'button', tabindex: '0', 'data-nav': x.id } });
      setIcon(b.createSpan({ cls: 'a4sb-icon' }), x.icon);
      b.createSpan({ text: x.label });
      b.addEventListener('click', () => runExtra(x));
    }

    // My Life
    if (groups.length) {
      const sec = this.section(scroll, 'mylife', nameOf(SBC.life));
      for (const g of groups) {
        const open = isGroupOpen(g.id, st.groups, activeGroup);
        const wrap = sec.createDiv({ cls: 'a4sb-group', attr: { 'data-group': g.id } });
        const head = wrap.createDiv({ cls: 'a4sb-grp-head' + (open ? '' : ' is-closed'), attr: { role: 'button', tabindex: '0', 'data-group-head': g.id } });
        head.appendChild(icon('chevD', 12, 'a4sb-chev'));
        head.createSpan({ text: g.label });
        const body = wrap.createDiv({ cls: 'a4sb-group-body' + (open ? '' : ' is-hidden') });
        head.addEventListener('click', () => {
          st.groups[g.id] = !isGroupOpen(g.id, st.groups, activeGroupFor(this.activePath(), this.groups, this.classify));
          this.plugin.saveState();
          head.toggleClass('is-closed', !st.groups[g.id]);
          body.toggleClass('is-hidden', !st.groups[g.id]);
          this.syncToggleAll();
        });
        for (const name of g.items) this.lifeItem(body, name, filePaths);
      }
    }

    // Rooms; with none set, the top folders under "Folders" (as drawn in the step 0 mockup)
    const rs = this.section(scroll, 'rooms', SBC.rooms.length ? 'Rooms' : 'Folders');
    for (const r of rooms) {
      const f = this.folder(r.path);
      const box = rs.createDiv();
      this.folderRow(box, f, {
        cls: 'a4sb-room', label: r.name, icon: r.icon, depth: 0, count: this.counts[r.path],
        style: r.c == null ? null : `--a4sb-room: var(--a4sb-room-${r.c})`, attrs: { 'data-room': r.name },
      });
    }

    const foot = root.createDiv({ cls: 'a4sb-foot' });
    foot.createSpan({ cls: 'a4sb-hand', text: this.app.vault.getName() }); // the vault's name, as drawn
    foot.createSpan({ cls: 'a4sb-small', text: `${filePaths.filter((p) => p.endsWith('.md')).length.toLocaleString()} notes` });

    root.querySelectorAll('[role="button"]').forEach((el) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); } }));
    scroll.scrollTop = keep;
    this.markActive();
  }

  section(parent, id, label) {
    const st = this.plugin.state;
    const open = st.sections[id] !== false;
    const wrap = parent.createDiv({ cls: 'a4sb-section', attr: { 'data-section': id } });
    const head = wrap.createDiv({ cls: 'a4sb-sec-head' + (open ? '' : ' is-closed'), attr: { role: 'button', tabindex: '0' } });
    head.appendChild(icon('chevD', 13, 'a4sb-chev'));
    head.createSpan({ text: label });
    const body = wrap.createDiv({ cls: 'a4sb-sec-body' + (open ? '' : ' is-hidden') });
    head.addEventListener('click', () => {
      st.sections[id] = st.sections[id] === false;
      this.plugin.saveState();
      head.toggleClass('is-closed', st.sections[id] === false);
      body.toggleClass('is-hidden', st.sections[id] === false);
      this.syncToggleAll();
    });
    return body;
  }

  syncToggleAll() {
    const ex = this.contentEl.querySelector('[data-tool="toggle-all"]');
    if (!ex) return;
    const groups = this.groups || [];
    const sectionIds = ['mylife', 'rooms'].filter((id) => id !== 'mylife' || groups.length);
    const open = isAllOpen(this.plugin.state, groups.map((g) => g.id), sectionIds, activeGroupFor(this.activePath(), groups, this.classify));
    ex.setAttr('aria-label', open ? 'Collapse all' : 'Expand all');
    ex.empty(); setIcon(ex, open ? 'chevrons-down-up' : 'chevrons-up-down');
  }

  // Projects folder notes of one kind ('work' / 'personal'), active first.
  projectsOf(kind) {
    const f = SBC.life ? this.folder(`${SBC.life}/Projects`) : null;
    if (!f) return [];
    const list = [];
    const isOpen = openRuleFrom(partOf(this.app, 'a4-projects'));
    for (const c of f.children) {
      if (!(c instanceof TFile) || c.extension !== 'md') continue;
      const fm = (this.app.metadataCache.getFileCache(c) || {}).frontmatter;
      if (!fm || fm.type !== 'project') continue;
      if (sphereOf(fm) !== kind) continue;
      list.push({ file: c, name: c.basename, status: String(fm.status || ''), open: isOpen(fm) });
    }
    return sortProjects(list);
  }

  lifeItem(parent, name, filePaths) {
    if (VIRTUAL[name]) {
      const v = VIRTUAL[name];
      const f = this.folder(`${SBC.life}/${v.folder}`);
      if (!f) return;
      const box = parent.createDiv();
      const members = openProjects(this.projectsOf(v.kind));
      if (v.hideEmpty && !members.length) { box.remove(); return; }
      // A4 Projects (0.6.0, 2026-10-04): the Work and Personal items open its
      // overview at that list, and a project opens its project page. The
      // arrow still folds the list; Cmd/Ctrl-click a project opens its note.
      const pjCmd = v.kind === 'unsorted' ? null : `a4-projects:open-${v.kind}`;
      const pj = pjCmd && this.hasCommand(pjCmd) ? partOf(this.app, 'a4-projects') : null;
      this.folderRow(box, f, {
        cls: 'a4sb-life', label: name, icon: itemIcon(name), depth: 0, count: openProjectCount(members),
        landing: pj ? { kind: 'command', id: pjCmd } : { kind: 'toggle' }, attrs: { 'data-life': name, 'data-virtual': v.kind },
        openKey: `${f.path}#${v.kind}`, noDrop: true, plusPreset: v.kind === 'unsorted' ? null : { sphere: v.kind }, noPlus: v.kind === 'unsorted',
        fillWith: (el, depth) => {
          for (const m of members) {
            this.fileRow(el, m.file, depth, m.status !== 'active' ? m.status : null);
            const row = el.lastElementChild;
            if (!pj || !row || typeof pj.openProject !== 'function') continue;
            row.addEventListener('click', (e) => {
              if (!IS_MOBILE && Keymap.isModEvent(e)) return; // the note itself, as before
              e.stopImmediatePropagation(); e.preventDefault();
              this.clicked = null;
              pj.openProject(m.file.path);
              this.closeDrawer();
            }, true);
          }
        },
      });
      return;
    }
    const path = `${SBC.life}/${name}`;
    const f = this.folder(path);
    if (!f) return;
    const box = parent.createDiv();
    const landing = resolveLanding(name, path, filePaths.filter((p) => p.startsWith(path + '/')), (id) => this.hasCommand(id));
    this.folderRow(box, f, {
      cls: 'a4sb-life', label: itemLabel(name), icon: itemIcon(name), depth: 0,
      count: itemShowsCount(name) ? this.counts[path] : null, landing, attrs: { 'data-life': name },
    });
  }

  // One folder row + its lazily rendered children.
  folderRow(parent, folder, o) {
    const st = this.plugin.state;
    const key = o.openKey || folder.path;
    const open = !!st.open[key];
    const row = parent.createDiv({ cls: 'a4sb-row a4sb-folder ' + (o.cls || ''), attr: { 'data-path': folder.path, ...(o.attrs || {}) } });
    if (o.style) row.setAttr('style', o.style);
    if (o.depth) row.style.paddingLeft = `${12 + o.depth * 14}px`;
    const fold = row.createSpan({ cls: 'a4sb-fold' + (open ? '' : ' is-closed') });
    fold.appendChild(icon('chevD', 12));
    if (o.icon) row.appendChild(icon(o.icon, 14, o.cls === 'a4sb-room' ? 'a4sb-room-icon' : 'a4sb-life-icon'));
    row.createSpan({ cls: 'a4sb-label', text: o.label || folder.name });
    if (o.count != null) row.createSpan({ cls: 'a4sb-count', text: Number(o.count).toLocaleString() });
    const t = this.plus[folder.path];
    if (t && this.qc && !o.noPlus) {
      const b = row.createSpan({ cls: 'a4sb-act', attr: { 'data-plus': t.key, title: t.label } });
      b.appendChild(icon('plus', 13));
      b.addEventListener('click', (e) => { e.stopPropagation(); this.qc.openCreate(t.key, o.plusPreset || undefined); });
    }
    const kids = parent.createDiv({ cls: 'a4sb-kids' + (open ? '' : ' is-hidden') });
    let filled = false;
    const fill = () => { if (!filled) { filled = true; if (o.fillWith) o.fillWith(kids, (o.depth || 0) + 1); else this.renderChildren(kids, folder, (o.depth || 0) + 1); } };
    if (open) fill();
    const toggle = () => {
      st.open[key] = !st.open[key];
      if (!st.open[key]) delete st.open[key];
      this.plugin.saveState();
      if (st.open[key]) fill();
      fold.toggleClass('is-closed', !st.open[key]);
      kids.toggleClass('is-hidden', !st.open[key]);
    };
    fold.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
    row.addEventListener('click', (e) => {
      const l = o.landing;
      if (!l || l.kind === 'toggle') return toggle();
      if (l.kind === 'command') return this.run(l.id);
      const file = this.app.vault.getAbstractFileByPath(l.path);
      if (file instanceof TFile) this.openFile(file, e); else toggle();
    });
    if (o.cls === 'a4sb-room') row.addEventListener('click', () => this.lightRoom(folder.path), true);
    this.menuOn(row, folder, o.fillWith ? { noSort: true } : null);
    if (!o.noDrop) this.dropTarget(row, folder);
    return row;
  }

  renderChildren(el, folder, depth) {
    const items = sortChildren(folder.path, folder.children.map((c) => ({ c, name: c.name, isFolder: c instanceof TFolder })), this.plugin.state.sort);
    let files = 0;
    for (const it of items) {
      if (it.isFolder && this.hideInRooms && this.hideInRooms.has(it.c.path)) continue;
      if (it.isFolder) { const box = el.createDiv(); this.folderRow(box, it.c, { cls: 'a4sb-sub', depth }); continue; }
      files += 1;
      if (files > FILE_CAP) {
        const more = el.createDiv({ cls: 'a4sb-row a4sb-more', text: `${items.filter((x) => !x.isFolder).length - FILE_CAP} more: show in Files` });
        more.style.paddingLeft = `${26 + depth * 14}px`;
        more.addEventListener('click', () => this.revealInFiles(folder));
        break;
      }
      this.fileRow(el, it.c, depth);
    }
  }

  fileRow(parent, file, depth, tag) {
    const row = parent.createDiv({ cls: 'a4sb-row a4sb-file', attr: { 'data-path': file.path, draggable: IS_MOBILE ? 'false' : 'true' } });
    row.style.paddingLeft = `${26 + depth * 14}px`;
    row.createSpan({ cls: 'a4sb-label', text: file.basename });
    if (tag) row.createSpan({ cls: 'a4sb-status', text: tag });
    if (file.extension !== 'md') row.createSpan({ cls: 'a4sb-ext', text: file.extension });
    row.addEventListener('click', (e) => this.openFile(file, e));
    row.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); this.app.workspace.getLeaf('tab').openFile(file); } });
    this.menuOn(row, file);
    row.addEventListener('dragstart', (e) => {
      this.dragging = file;
      const dm = this.app.dragManager;
      try { if (dm && dm.dragFile) dm.onDragStart(e, dm.dragFile(e, file)); } catch { /* internal API: drag still works inside this sidebar */ }
      if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'all'; }
      row.addClass('is-dragging');
    });
    row.addEventListener('dragend', () => { this.dragging = null; row.removeClass('is-dragging'); this.contentEl.querySelectorAll('.is-drop').forEach((x) => x.removeClass('is-drop')); });
  }

  draggedFile() {
    if (this.dragging) return this.dragging;
    const d = this.app.dragManager && this.app.dragManager.draggable; // a note dragged in from the Files tab
    if (d && d.file instanceof TFile) return d.file;
    if (d && d.type === 'folder') return d.file || null;
    return null;
  }

  dropTarget(row, folder) {
    const plan = () => {
      const f = this.draggedFile();
      if (!f) return null;
      return { f, p: planMove(f.path, f instanceof TFolder, folder.path, (x) => !!this.app.vault.getAbstractFileByPath(x)) };
    };
    // Files dragged in from outside Obsidian (Finder, the Desktop): accepted
    // like Obsidian's own Files list does, copied into this folder.
    const external = (e) => !this.draggedFile() && hasExternalFiles(e.dataTransfer);
    row.addEventListener('dragover', (e) => {
      if (external(e)) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        row.addClass('is-drop');
        return;
      }
      const x = plan();
      if (!x || !dropAccepts(x.p)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      if (x.p.ok) row.addClass('is-drop');
    });
    row.addEventListener('dragleave', () => row.removeClass('is-drop'));
    row.addEventListener('drop', async (e) => {
      row.removeClass('is-drop');
      if (external(e)) {
        e.preventDefault();
        e.stopPropagation();
        await this.importExternal(e.dataTransfer, folder);
        return;
      }
      const x = plan();
      if (!x) return;
      e.preventDefault();
      if (!x.p.ok) {
        if (x.p.reason === 'name-taken') new Notice(nameTakenMessage(x.f.name, folder.name));
        return;
      }
      this.dragging = null;
      await this.app.fileManager.renameFile(x.f, normalizePath(x.p.newPath));
    });
  }

  // Copy dropped outside files into `folder`. Uses Obsidian's own import
  // routine (the one its Files list calls), which numbers a clashing name
  // ("photo 1.png") and never overwrites. Dropped folders are skipped:
  // folders are the AI Team's job (CLAUDE.md hard rule 5).
  async importExternal(dt, folder) {
    const { files, folders } = collectDropped(dt);
    const where = showName(folder.name);
    if (folders) new Notice(folders === 1 ? 'Folders are not added here. Ask the team to make the folder.' : `${folders} folders were not added. Ask the team to make folders.`);
    if (!files.length) return [];
    const entries = files.map((f) => { const n = splitName(f.name); return { name: n.name, extension: n.ext, filepath: '', data: f.arrayBuffer() }; });
    let made = [];
    try {
      if (typeof this.app.importAttachments === 'function') made = await this.app.importAttachments(entries, folder);
      else {
        for (const en of entries) {
          const path = freePath(folder.path, en.name, en.extension, (p) => !!(this.app.vault.getAbstractFileByPathInsensitive ? this.app.vault.getAbstractFileByPathInsensitive(p) : this.app.vault.getAbstractFileByPath(p)));
          made.push(await this.app.vault.createBinary(path, await en.data));
        }
      }
    } catch (err) {
      console.error('a4-sidebar: import failed', err);
      new Notice(`Could not add the file to ${where}: ${err && err.message ? err.message : err}`);
      return made;
    }
    made = (made || []).filter(Boolean);
    if (made.length) new Notice(made.length === 1 ? `Added ${made[0].name} to ${where}.` : `Added ${made.length} files to ${where}.`);
    return made;
  }

  openFile(file, e) {
    this.clicked = null;
    const mode = e && !IS_MOBILE ? Keymap.isModEvent(e) : false;
    this.app.workspace.getLeaf(mode || false).openFile(file);
    this.closeDrawer();
  }

  // Phone: close the left drawer once a page or note opens (Files does too).
  closeDrawer() {
    if (!IS_MOBILE) return;
    const ls = this.app.workspace.leftSplit;
    if (ls && ls.collapse && !ls.collapsed) ls.collapse();
  }

  // Computer: right-click. Phone: long-press opens the same menu. iOS fires no
  // contextmenu on long-press, so the touch is timed; Android (and Obsidian's
  // phone emulation) does fire one, so whichever comes first wins and the
  // other is swallowed: one press, one menu.
  menuOn(row, f, opts) {
    if (!IS_MOBILE) { row.addEventListener('contextmenu', (e) => this.menuFor(f, e, opts)); return; }
    let t = null, sx = 0, sy = 0, fired = false;
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (t) { window.clearTimeout(t); t = null; }
      if (fired) return;
      fired = true;
      this.showMenu(f, { x: e.clientX || sx, y: e.clientY || sy }, opts);
    });
    const clear = () => { if (t) { window.clearTimeout(t); t = null; } };
    row.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return clear();
      fired = false; sx = e.touches[0].clientX; sy = e.touches[0].clientY;
      clear();
      t = window.setTimeout(() => { t = null; fired = true; this.showMenu(f, { x: sx, y: sy }, opts); }, LONG_PRESS_MS);
    }, { passive: true });
    row.addEventListener('touchmove', (e) => {
      const m = e.touches[0]; if (!m) return;
      if (longPressState(0, 0, Math.hypot(m.clientX - sx, m.clientY - sy)) === 'cancel') clear();
    }, { passive: true });
    row.addEventListener('touchend', (e) => { clear(); if (fired && e.cancelable) e.preventDefault(); });
    row.addEventListener('touchcancel', clear);
    // the tap that ends a long-press must not also open or fold the row
    row.addEventListener('click', (e) => { if (fired) { fired = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  }

  revealInFiles(f) {
    const fe = this.app.internalPlugins && this.app.internalPlugins.getPluginById && this.app.internalPlugins.getPluginById('file-explorer');
    if (fe && fe.instance && fe.instance.revealInFolder) fe.instance.revealInFolder(f);
    else new Notice('Open the files tab to find it.');
  }

  menuFor(f, e, opts) {
    e.preventDefault();
    this.showMenu(f, e, opts);
  }

  // e: a mouse event (computer) or { x, y } (phone long-press)
  showMenu(f, e, opts) {
    const menu = new Menu();
    if (f instanceof TFolder && !(opts && opts.noSort)) this.addSortItems(menu, f);
    if (f instanceof TFile) {
      menu.addItem((i) => i.setTitle('Open in new tab').setIcon('file-plus').setSection('open').onClick(() => { this.app.workspace.getLeaf('tab').openFile(f); this.closeDrawer(); }));
      if (!IS_MOBILE) menu.addItem((i) => i.setTitle('Open to the right').setIcon('separator-vertical').setSection('open').onClick(() => this.app.workspace.getLeaf('split').openFile(f)));
      menu.addItem((i) => i.setTitle('Rename...').setIcon('pencil').setSection('action').onClick(() => new RenameModal(this.app, f).open()));
      menu.addItem((i) => i.setTitle('Delete').setIcon('trash').setSection('danger').onClick(() => this.app.fileManager.promptForDeletion(f)));
    }
    menu.addItem((i) => i.setTitle('Show in files').setIcon('folder-open').setSection('view').onClick(() => this.revealInFiles(f)));
    this.app.workspace.trigger('file-menu', menu, f, 'a4-sidebar', this.leaf);
    if (e instanceof MouseEvent) menu.showAtMouseEvent(e); else menu.showAtPosition({ x: e.x, y: e.y });
  }

  // "Sort this folder" (approved mockup 2026-10-08, section 3): a submenu where
  // Obsidian offers one, else the same items inline. The tick marks this
  // folder's own setting; "Use main setting" = no own setting (it then follows
  // a listed parent folder, or the main setting).
  addSortItems(menu, folder) {
    const own = this.plugin.state.sort.perFolder[folder.path] || null;
    const choices = [[null, 'Use main setting']].concat(SORT_MODES.map((m) => [m, SORT_LABEL[m]]));
    const fill = (target, prefix) => {
      for (const [mode, label] of choices) {
        target.addItem((i) => {
          i.setTitle(prefix + label).setSection('sort').onClick(() => this.plugin.setFolderSort(folder.path, mode));
          if (typeof i.setChecked === 'function') i.setChecked(own === mode);
        });
      }
    };
    let sub = null;
    menu.addItem((i) => {
      i.setTitle('Sort this folder').setIcon('arrow-up-down').setSection('sort');
      if (typeof i.setSubmenu === 'function') sub = i.setSubmenu();
    });
    if (sub) fill(sub, ''); else fill(menu, 'Sort: ');
  }

  activePath() { const f = this.app.workspace.getActiveFile(); return f ? f.path : null; }

  // A clicked room stays lit until a note or page opens (2026-10-03).
  // "Opens" = the front tab or its note changes, or the user clicks something
  // that opens a page (run/openFile clear it directly, which covers clicking
  // Today while Today is already in front: no workspace event fires then).
  lightRoom(path) {
    const leaf = this.app.workspace.getMostRecentLeaf ? this.app.workspace.getMostRecentLeaf() : null;
    this.clicked = { path, leaf, file: this.activePath() };
    this.markActive();
  }

  clearClicked() { if (this.clicked) { this.clicked = null; this.markActive(); } }

  markActive() {
    const root = this.contentEl;
    const leaf = this.app.workspace.getMostRecentLeaf ? this.app.workspace.getMostRecentLeaf() : null;
    if (this.clicked && (this.clicked.leaf !== leaf || this.clicked.file !== this.activePath())) this.clicked = null;
    if (this.clicked) {
      root.querySelectorAll('.a4sb-nav-item.is-on, .a4sb-row.is-on').forEach((r) => r.removeClass('is-on'));
      root.querySelectorAll('.a4sb-room').forEach((r) => { if (r.dataset.path === this.clicked.path) r.addClass('is-on'); });
      return;
    }
    const vt = leaf && leaf.view ? leaf.view.getViewType() : '';
    root.querySelectorAll('.a4sb-nav-item').forEach((b) => b.toggleClass('is-on', b.dataset.view === vt));
    const p = vt === 'markdown' || (leaf && leaf.view && leaf.view.file) ? this.activePath() : null;
    root.querySelectorAll('.a4sb-row.is-on').forEach((r) => r.removeClass('is-on'));
    if (!p) return;
    root.querySelectorAll('.a4sb-file').forEach((r) => { if (r.dataset.path === p) r.addClass('is-on'); });
    root.querySelectorAll('.a4sb-life').forEach((r) => {
      if (!p.startsWith(r.dataset.path + '/')) return;
      if (r.dataset.virtual && this.classify(p) !== r.dataset.virtual) return;
      r.addClass('is-on');
    });
    const rooms = [...root.querySelectorAll('.a4sb-room')];
    const room = activeRoomFor(p, rooms.map((r) => r.dataset.path), this.hideInRooms);
    rooms.forEach((r) => { if (r.dataset.path === room) r.addClass('is-on'); });
  }
}


/* ------------------------------------------------------------------ *
 * Files tab chrome (0.7.0). Obsidian's own Files tab gets the four toolbar
 * buttons and the Audrey badge; the right sidebar's tab row gets Terminal and
 * Settings. All of it is our own DOM, re-attached when Obsidian rebuilds those
 * areas (the Files tab is built late when it is not the front tab), and
 * removed again when the plugin is turned off.
 * ------------------------------------------------------------------ */
class FilesChrome {
  constructor(plugin) { this.plugin = plugin; this.app = plugin.app; this.stamp = String(Date.now()); this.observer = null; this.frame = 0; }

  start() {
    this.attach();
    const p = this.plugin;
    p.registerEvent(this.app.workspace.on('layout-change', () => this.schedule()));
    p.registerEvent(this.app.workspace.on('active-leaf-change', () => this.schedule()));
    // A deferred Files tab builds its DOM the first time it is shown, with no
    // workspace event; watch the two sidebars for that and re-attach.
    const roots = [this.app.workspace.leftSplit, this.app.workspace.rightSplit].map((x) => x && x.containerEl).filter(Boolean);
    if (roots.length && typeof MutationObserver !== 'undefined') {
      this.observer = new MutationObserver(() => this.schedule());
      for (const r of roots) this.observer.observe(r, { childList: true, subtree: true });
    }
  }

  schedule() {
    if (this.frame) return;
    this.frame = window.requestAnimationFrame(() => { this.frame = 0; this.attach(); });
  }

  // If the old ICOR Connect add-on is switched on again (the phone has
  // overwritten the add-on list before), it draws its own copy of all this;
  // step aside so nothing shows twice, and come back when it is off.
  connectOn() { const p = this.app.plugins && this.app.plugins.plugins; return !!(p && p[LEGACY_CHROME]); }

  attach() {
    if (this.connectOn()) { this.clear(); return; }
    for (const ex of document.querySelectorAll('.workspace-leaf-content[data-type="file-explorer"]')) {
      this.attachTools(ex);
      this.attachBadge(ex);
    }
    this.attachTopButtons();
  }

  fresh(el) { return el && el.dataset.a4sb === this.stamp; }

  // Add-on buttons changed: a new stamp makes every piece draw again on the next attach.
  refresh() { this.stamp = `${Date.now()}-${(this.round = (this.round || 0) + 1)}`; if (this.observer) this.schedule(); }

  attachTools(ex) {
    const bar = ex.querySelector('.nav-header .nav-buttons-container');
    if (!bar) return;
    const have = bar.querySelector('.a4sb-files-tool');
    if (have && this.fresh(have)) return;
    bar.querySelectorAll('.a4sb-files-tool').forEach((b) => b.remove());
    bar.addClass('a4sb-files-tools');
    let at = bar.firstChild;
    for (const t of TOOLS) {
      const b = createDiv({ cls: 'clickable-icon nav-action-button a4sb-files-tool', attr: { 'aria-label': t.label, 'data-tool': t.id } });
      b.dataset.a4sb = this.stamp;
      setIcon(b, t.icon);
      b.addEventListener('click', () => this.plugin.runTool(t.command));
      bar.insertBefore(b, at);
    }
    const bb = createDiv({ cls: 'clickable-icon nav-action-button a4sb-files-tool', attr: { 'aria-label': BASES_TOOL.label, 'data-tool': BASES_TOOL.id } });
    bb.dataset.a4sb = this.stamp;
    setIcon(bb, BASES_TOOL.icon);
    bb.addEventListener('click', () => this.plugin.showBases(bb));
    bar.insertBefore(bb, at);
    for (const x of EXTRA.tools) bar.insertBefore(extraButton(createDiv(), 'clickable-icon nav-action-button a4sb-files-tool', x), at);
  }

  attachBadge(ex) {
    const have = ex.querySelector(':scope > .a4sb-audrey');
    if (have && this.fresh(have)) return;
    if (have) have.remove();
    const foot = ex.createDiv({ cls: 'a4sb-audrey' });
    foot.dataset.a4sb = this.stamp;
    const btn = foot.createDiv({ cls: 'a4sb-audrey-btn', attr: { role: 'button', tabindex: '0', 'aria-label': 'Open the AI Team roster' } });
    btn.appendChild(a4Mark());
    btn.createSpan({ cls: 'a4sb-audrey-label', text: 'Audrey' });
    const go = (e) => this.plugin.openRoster(e);
    btn.addEventListener('click', go);
    btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(e); } });
  }

  attachTopButtons() {
    const row = document.querySelector('.workspace-split.mod-right-split .workspace-tab-header-container');
    if (!row) return;
    const have = row.querySelector('.a4sb-top-btn');
    if (have && this.fresh(have)) return;
    row.querySelectorAll('.a4sb-top-btn').forEach((b) => b.remove());
    const add = (cls, ic, label, fn) => {
      const b = row.createDiv({ cls: `clickable-icon a4sb-top-btn ${cls}`, attr: { 'aria-label': label } });
      b.dataset.a4sb = this.stamp;
      setIcon(b, ic);
      b.addEventListener('click', fn);
    };
    // Terminal is a desktop-only plugin; no dead button on the phone.
    if (!IS_MOBILE) add('a4sb-top-terminal', 'terminal', 'Open terminal', () => {
      if (!this.app.commands.executeCommandById('terminal:open-terminal.integrated.root')) new Notice('Turn on the terminal plugin to use this button.');
    });
    add('a4sb-top-settings', 'settings', 'Settings', () => this.app.setting.open());
  }

  stop() {
    if (this.observer) this.observer.disconnect();
    if (this.frame) window.cancelAnimationFrame(this.frame);
    this.clear();
  }

  clear() {
    document.querySelectorAll('.a4sb-files-tool, .a4sb-audrey, .a4sb-top-btn').forEach((e) => e.remove());
    document.querySelectorAll('.a4sb-files-tools').forEach((e) => e.removeClass('a4sb-files-tools'));
  }
}
/* ------------------------------------------------------------------ */
class A4SidebarPlugin extends Plugin {
  async onload() {
    // A half-synced or damaged data.json must never stop the plugin loading
    // (Obsidian turns a plugin back off when onload throws). Fall back to
    // defaults; the next fold or click writes a clean file.
    let saved = {};
    try { saved = (await this.loadData()) || {}; } catch (e) { console.warn('a4-sidebar: settings unreadable, using defaults', e); saved = {}; }
    if (typeof saved !== 'object' || Array.isArray(saved)) saved = {};
    const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
    this.state = { groups: obj(saved.groups), sections: obj(saved.sections), open: obj(saved.open), placed: !!saved.placed, placedMobile: !!saved.placedMobile, sort: normalizeSort(saved.sort) };
    const sortIsNew = !saved.sort;
    this.registerView(VIEW_TYPE, (leaf) => new A4SidebarView(leaf, this));
    this.addSettingTab(new A4SidebarSettingTab(this.app, this));
    // A folder renamed or moved keeps its sort setting (and its subfolders').
    this.registerEvent(this.app.vault.on('rename', (f, oldPath) => {
      if (!(f instanceof TFolder)) return;
      const next = renameSortPaths(this.state.sort, oldPath, f.path);
      if (JSON.stringify(next) === JSON.stringify(this.state.sort)) return;
      this.state.sort = next;
      this.saveState();
    }));
    this.addRibbonIcon('layout-list', 'Open the A4 sidebar', () => this.activate());
    this.addCommand({ id: 'open', name: 'Open the sidebar', callback: () => this.activate() });
    // The toolbar commands (0.7.0): ours, so the buttons work with ICOR Connect off.
    for (const [id, c] of Object.entries(CORE_TOOLS)) {
      this.addCommand({ id, name: c.name, callback: () => {
        if (!this.app.commands.executeCommandById(c.core)) new Notice(`Turn on the ${c.plugin} core plugin in Settings to use this.`);
      } });
    }
    this.addCommand({ id: 'new-scratchpad-canvas', name: 'New canvas in the daily scratchpad', callback: () => this.newCanvas() });
    this.addCommand({ id: 'open-team-roster', name: 'Open the AI team roster', callback: () => this.openRoster() });
    this.chrome = new FilesChrome(this);
    this.app.workspace.onLayoutReady(async () => {
      // First run only: add the tab next to Files and show it. After that
      // Obsidian's own layout memory decides (closing it is respected).
      const key = placedKey(IS_MOBILE);
      if (!this.state[key] && !this.app.workspace.getLeavesOfType(VIEW_TYPE).length) {
        if (IS_MOBILE) await this.placeInDrawer(); else await this.activate();
        this.state[key] = true;
        await this.saveState();
      }
      // First run of 0.8.0: write the pre-filled sort settings, so the phone
      // and the settings page read the same list.
      if (sortIsNew) await this.saveState();
      this.chrome.start();
      // Plugins that load later (quick-create, dashboards) change what rows show.
      window.setTimeout(() => this.scheduleRender(), 1500);
    });
  }

  async activate() {
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      // Same tab group as Files when it exists, else a fresh left leaf.
      const files = ws.getLeavesOfType('file-explorer')[0];
      const parent = files && files.parent;
      if (parent && ws.createLeafInParent) leaf = ws.createLeafInParent(parent, (parent.children || []).length);
      if (!leaf) leaf = ws.getLeftLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    ws.revealLeaf(leaf);
  }

  // Phone, first run only: put the tab first in the left drawer and make it
  // the drawer's front tab, without sliding the drawer open on startup.
  async placeInDrawer() {
    const ws = this.app.workspace; const ls = ws.leftSplit;
    let leaf = null;
    if (ls && ws.createLeafInParent) { try { leaf = ws.createLeafInParent(ls, 0); } catch { leaf = null; } }
    if (!leaf) leaf = ws.getLeftLeaf(false);
    await leaf.setViewState({ type: VIEW_TYPE, active: false });
    if (ls && ls.selectTab) ls.selectTab(leaf);
  }

  scheduleRender() {
    window.clearTimeout(this.renderTimer);
    this.renderTimer = window.setTimeout(() => {
      for (const l of this.app.workspace.getLeavesOfType(VIEW_TYPE)) if (l.view && l.view.render) l.view.render();
    }, 300);
  }

  async saveState() { await this.saveData(this.state); }

  // An add-on row or button was added or removed (LifeWorld calls this): both toolbars and the tab draw again.
  extrasChanged() { this.scheduleRender(); if (this.chrome) this.chrome.refresh(); }

  // Sort settings changed here (settings page, right-click menu).
  async updateSort(next) {
    this.state.sort = normalizeSort(next);
    await this.saveState();
    this.scheduleRender();
  }
  setFolderSort(path, mode) { return this.updateSort(setFolderSort(this.state.sort, path, mode)); }

  // data.json changed underneath us (Obsidian Sync from the phone): take the
  // new sort settings; fold state stays per device as before.
  async onExternalSettingsChange() {
    let d = null;
    try { d = await this.loadData(); } catch { return; }
    if (!d || typeof d !== 'object' || Array.isArray(d)) return;
    this.state.sort = normalizeSort(d.sort);
    this.scheduleRender();
    for (const t of [this.settingTab]) if (t && t.containerEl && t.containerEl.isConnected) t.display();
  }

  runTool(id) {
    if (this.app.commands.executeCommandById(id)) return true;
    new Notice('That part is not turned on.');
    return false;
  }

  async newCanvas() {
    if (!(this.app.vault.getAbstractFileByPath(SCRATCHPAD) instanceof TFolder)) { new Notice(`The ${SCRATCHPAD} folder is missing, so there is nowhere to put the canvas.`); return; }
    const p = canvasPath(new Date(), (x) => !!this.app.vault.getAbstractFileByPath(x));
    try {
      const file = await this.app.vault.create(p, '{"nodes":[],"edges":[]}');
      await this.app.workspace.getLeaf(true).openFile(file);
    } catch (e) {
      new Notice('Could not make the canvas: ' + (e && e.message ? e.message : e));
    }
  }

  // The Bases drop-down. Always Obsidian's own drawn menu (not the Mac
  // system menu used elsewhere), so the folder names can sit faintly
  // on the right as mocked. Arrow keys and Enter come with Obsidian's menu.
  showBases(btn) {
    const bases = listBases(this.app.vault.getFiles().map((f) => f.path));
    if (!bases.length) { new Notice('There are no bases in the vault yet.'); return; }
    const menu = new Menu();
    if (typeof menu.setUseNativeMenu === 'function') menu.setUseNativeMenu(false);
    // disabled too, so the arrow keys step over the title row
    menu.addItem((i) => { i.setTitle('Bases, A to Z').setDisabled(true); if (typeof i.setIsLabel === 'function') i.setIsLabel(true); });
    for (const b of bases) {
      menu.addItem((i) => {
        const t = document.createDocumentFragment();
        t.append(b.name);
        if (b.where) t.append(createSpan({ cls: 'a4sb-base-where', text: b.where }));
        i.setTitle(t).setIcon('table').onClick((e) => this.openBase(b.path, e));
      });
    }
    if (menu.dom) menu.dom.addClass('a4sb-bases-menu');
    btn.addClass('is-open');
    menu.onHide(() => btn.removeClass('is-open'));
    const r = btn.getBoundingClientRect();
    // the button's own window (Obsidian would otherwise use whichever window
    // last had focus, which can be a different one)
    menu.showAtPosition({ x: r.left, y: r.bottom + 4 }, btn.ownerDocument);
  }

  async openBase(path, e) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) { new Notice('That base is not in the vault any more.'); return; }
    await this.app.workspace.getLeaf((e && !IS_MOBILE && Keymap.isModEvent(e)) || false).openFile(f);
    if (IS_MOBILE) { const ls = this.app.workspace.leftSplit; if (ls && ls.collapse && !ls.collapsed) ls.collapse(); }
  }

  async openRoster(e) {
    const f = this.app.vault.getAbstractFileByPath(ROSTER);
    if (!(f instanceof TFile)) { new Notice('The AI team roster note is missing.'); return; }
    await this.app.workspace.getLeaf(e && Keymap.isModEvent(e)).openFile(f);
    if (IS_MOBILE) { const ls = this.app.workspace.leftSplit; if (ls && ls.collapse && !ls.collapsed) ls.collapse(); }
  }

  onunload() { window.clearTimeout(this.renderTimer); if (this.chrome) this.chrome.stop(); }
}

/* ------------------------------------------------------------------ *
 * Settings page: Settings > A4 Sidebar > Sort order (approved mockups
 * 2026-10-07 and 2026-10-08; drawn with Obsidian's own controls).
 * ------------------------------------------------------------------ */
class FolderPickModal extends FuzzySuggestModal {
  constructor(app, onPick, skip) { super(app); this.onPick = onPick; this.skip = skip || new Set(); this.setPlaceholder('Pick a folder'); }
  getItems() { return this.app.vault.getAllLoadedFiles().filter((f) => f instanceof TFolder && f.path && f.path !== '/' && !this.skip.has(f.path) && !f.path.startsWith('.')).sort((a, b) => collator.compare(a.path, b.path)); }
  getItemText(f) { return folderDisplay(f.path); }
  onChooseItem(f) { this.onPick(f.path); }
}

class NewestFirstListModal extends Modal {
  constructor(app, plugin, onDone) { super(app); this.plugin = plugin; this.onDone = onDone; }
  onOpen() { this.titleEl.setText('Always newest first in'); this.draw(); }
  draw() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createDiv({ cls: 'setting-item-description', text: 'These folders, and every folder inside them, list newest first whatever the main Dates setting is. "Journal" covers every folder called Journal (yours and the AI Team\'s).' });
    const list = this.plugin.state.sort.newestFirstIn;
    if (!list.length) contentEl.createDiv({ cls: 'setting-item-description a4sb-sort-empty', text: 'No folders.' });
    for (const p of list) {
      new Setting(contentEl).setName(folderDisplay(p)).addExtraButton((b) => b.setIcon('x').setTooltip('Remove').onClick(async () => {
        await this.plugin.updateSort({ ...this.plugin.state.sort, newestFirstIn: list.filter((x) => x !== p) });
        this.draw();
      }));
    }
    new Setting(contentEl).addButton((b) => b.setButtonText('Add a folder').onClick(() => new FolderPickModal(this.app, async (path) => {
      await this.plugin.updateSort({ ...this.plugin.state.sort, newestFirstIn: this.plugin.state.sort.newestFirstIn.concat(path) });
      this.draw();
    }, new Set(this.plugin.state.sort.newestFirstIn)).open()));
  }
  onClose() { this.contentEl.empty(); if (this.onDone) this.onDone(); }
}

class A4SidebarSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; plugin.settingTab = this; }
  display() {
    const el = this.containerEl;
    el.empty();
    el.addClass('a4sb-settings');
    const sort = () => this.plugin.state.sort;
    const save = async (patch) => { await this.plugin.updateSort({ ...sort(), ...patch }); };
    // No own heading: LifeWorld's page puts these under "Sidebar" (decided 2026-10-13).
    new Setting(el).setName('Dates').setDesc('Notes whose name starts with a date are sorted by the real date and time.')
      .addDropdown((d) => d.addOption('last', 'Newest last').addOption('first', 'Newest first').setValue(sort().dates).onChange((v) => save({ dates: v })));
    const nf = sort().newestFirstIn;
    new Setting(el).setName('Always newest first in').setDesc(nf.length ? nf.map(folderDisplay).join(', ') : 'No folders.')
      .addButton((b) => b.setButtonText('Edit').onClick(() => new NewestFirstListModal(this.app, this.plugin, () => this.display()).open()));
    new Setting(el).setName('Text').setDesc('Everything without a date.')
      .addDropdown((d) => d.addOption('az', 'A to Z').addOption('za', 'Z to A').setValue(sort().text).onChange((v) => save({ text: v })));
    new Setting(el).setName('Sort folders by these rules too').setDesc('Off: folders stay on top, A to Z. A folder with its own order below sorts its folders that way too.')
      .addDropdown((d) => d.addOption('off', 'Off').addOption('on', 'On').setValue(sort().folders ? 'on' : 'off').onChange((v) => save({ folders: v === 'on' })));

    new Setting(el).setName('Folder by folder').setHeading()
      .setDesc("Any folder can get its own order. Folders not on this list follow the settings above. A subfolder follows its parent unless it's listed too. You can also set this by right-clicking a folder in the sidebar.");
    const entries = Object.entries(sort().perFolder).sort((a, b) => collator.compare(a[0], b[0]));
    for (const [path, mode] of entries) {
      const s = new Setting(el).setName(folderDisplay(path)).setClass('a4sb-sort-folder');
      s.settingEl.dataset.folder = path;
      if (!this.app.vault.getAbstractFileByPath(path)) s.setDesc('This folder is not in the vault right now.');
      s.addDropdown((d) => {
        d.addOption('main', 'Use main setting');
        for (const m of SORT_MODES) d.addOption(m, SORT_LABEL[m]);
        d.setValue(mode).onChange(async (v) => { await this.plugin.setFolderSort(path, v === 'main' ? null : v); if (v === 'main') this.display(); });
      });
      s.addExtraButton((b) => b.setIcon('x').setTooltip('Remove').onClick(async () => { await this.plugin.setFolderSort(path, null); this.display(); }));
    }
    new Setting(el).addButton((b) => b.setButtonText('Add a folder').onClick(() => new FolderPickModal(this.app, async (path) => {
      await this.plugin.setFolderSort(path, 'az');
      this.display();
    }, new Set(Object.keys(sort().perFolder))).open()));
  }
}

export default A4SidebarPlugin;
A4SidebarPlugin.addExtra = addExtra; // for LifeWorld's add-on hooks (phase 2 section 7)
A4SidebarPlugin.__logic = {
  NAV, LANDING, FILE_CAP, SBC, A4SidebarView, FilesChrome, EXTRA, runExtra, extraButton,
  findRoomFolders, buildLifeGroups, itemLabel, itemIcon, itemShowsCount, resolveLanding,
  hasExternalFiles, splitName, freePath, VIRTUAL, sphereOf, sortProjects, openRuleFrom, openProjects, openProjectCount, dropAccepts, nameTakenMessage, itemFolder, activeRoomFor, longPressState, placedKey, LONG_PRESS_MS, TOOLS, CORE_TOOLS, BASES_TOOL, baseWhere, listBases, SCRATCHPAD, ROSTER, canvasPath, isAllOpen, toggleAll, countNotes, countNotesExcluding, hiddenUnderRooms, sortChildren, SORT_MODES, SORT_LABEL, DEFAULT_SORT, normalizeSort, sortRuleFor, dateKey, sortComparator, folderDisplay, setFolderSort, renameSortPaths, planMove, planRename, activeGroupFor, isGroupOpen, plusTargetsByPath, parentOf, nameOf,
};
