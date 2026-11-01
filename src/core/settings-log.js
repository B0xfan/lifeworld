// A log of settings changes, kept in the settings file so a Sync conflict cannot lose them. Sync merges two
// devices' files with this device's top-level keys on top (obsidian.md/help/sync/troubleshoot), so a change under
// an existing key can be lost, while a new key always survives. Each changed setting gets a key of its own, and
// every read plays them back in time order, down to the single setting inside a map (a Parts switch, a folder).
// A read that finds a merged-away change has it saved straight away, so a change lives in the log for a week at most.
// shortcut: a list is replaced whole, so two devices adding to one list keep the later list; a device on 1.1.7 or
// older keeps the log but does not add to it, so its change to a setting logged in the same week loses.
const PREFIX = '~change-';
const WEEK = 7 * 864e5;
// Per device or machine-written, and large: not worth a second copy, and a stale one must not beat a newer one.
const UNLOGGED = new Set(['a4-sidebar/groups', 'a4-sidebar/sections', 'a4-sidebar/open', 'a4-projects/activity', 'a4-projects/tnSnapshot', 'a4-projects/archiveQueue', 'a4-planner/collapsed']);
/** @typedef {{ at: number, path: string[], value?: unknown, gone?: boolean }} Change */
/** @typedef {Record<string, Change>} Changes */
/** @typedef {Record<string, unknown>} Obj */
const isObj = (/** @type {unknown} */ v) => !!v && typeof v === 'object' && !Array.isArray(v);
const safe = (/** @type {unknown} */ s) => typeof s === 'string' && s !== '__proto__' && s !== 'constructor' && s !== 'prototype';
const own = (/** @type {object} */ o, /** @type {string} */ k) => Object.prototype.hasOwnProperty.call(o, k);

// What differs from a to b, one entry per setting, as { path, value } or { path, gone }.
/** @param {Obj} a @param {Obj} b @param {string[]} path @param {boolean} all include the unlogged settings @returns {Omit<Change, 'at'>[]} */
function differences(a, b, path, all) {
  /** @type {Omit<Change, 'at'>[]} */
  const out = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const at = [...path, k];
    if (!safe(k) || (!all && UNLOGGED.has(at.join('/')))) continue;
    if (!own(b, k)) out.push({ path: at, gone: true });
    else if (isObj(b[k]) && (own(a, k) ? isObj(a[k]) : Object.keys(/** @type {Obj} */ (b[k])).length > 0)) out.push(...differences(/** @type {Obj} */ (own(a, k) ? a[k] : {}), /** @type {Obj} */ (b[k]), at, all));
    else if (!own(a, k) || JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push({ path: at, value: b[k] });
  }
  return out;
}

/** @param {Obj} store @param {Omit<Change, 'at'>} c */
function put(store, c) {
  let o = store;
  for (const k of c.path.slice(0, -1)) {
    if (c.gone && (!own(o, k) || !isObj(o[k]))) return;
    if (!own(o, k) || !isObj(o[k])) o[k] = {};
    o = /** @type {Obj} */ (o[k]);
  }
  const last = c.path[c.path.length - 1];
  if (c.gone) delete o[last]; else o[last] = c.value;
}

// The settings changed from `before` to `after`, played onto `onto`.
/** @param {Obj} onto @param {Obj} before @param {Obj} after @returns {Obj} */
function carryChanges(onto, before, after) {
  for (const c of differences(before, after, [], true)) put(onto, c);
  return onto;
}

// Newest change per setting.
/** @param {Changes} changes @returns {Changes} */
function newest(changes) {
  /** @type {Record<string, [string, Change]>} */
  const best = {}; // keys are JSON arrays, so never a name objects inherit
  for (const [id, c] of Object.entries(changes)) {
    const slot = JSON.stringify(c.path);
    if (!best[slot] || c.at > best[slot][1].at || (c.at === best[slot][1].at && id > best[slot][0])) best[slot] = [id, c];
  }
  return Object.fromEntries(Object.values(best));
}

// The file's settings with its changes played back, the changes, and whether that differs from the settings saved.
// A time ahead of now is taken as now, so another device's fast clock cannot hold a setting.
/** @param {Obj} file @param {number} now @returns {{ store: Obj, changes: Changes, stale: boolean }} */
function readFile(file, now) {
  /** @type {Obj} */
  const store = {};
  /** @type {Changes} */
  const found = {};
  for (const [k, v] of Object.entries(file)) {
    if (!safe(k)) continue;
    if (!k.startsWith(PREFIX)) { store[k] = v; continue; }
    const c = /** @type {Change} */ (v);
    if (isObj(v) && Number.isFinite(c.at) && now - c.at <= WEEK && Array.isArray(c.path) && c.path.length && c.path.every(safe)) found[k] = { ...c, at: Math.min(c.at, now) };
  }
  const changes = newest(found);
  const saved = JSON.stringify(store);
  for (const c of Object.values(changes).sort((a, b) => a.at - b.at)) put(store, c);
  return { store, changes, stale: JSON.stringify(store) !== saved };
}

// The changes with what differs between two versions of the settings added. A new change always beats the log.
/** @param {Changes} changes @param {Obj} before @param {Obj} after @param {number} now @returns {Changes} */
function addChanges(changes, before, after, now) {
  const stamp = Math.max(now, ...Object.values(changes).map((c) => c.at + 1));
  const out = Object.fromEntries(Object.entries(changes).filter(([, c]) => now - c.at <= WEEK));
  differences(before, after, [], false).forEach((c, n) => {
    out[`${PREFIX}${stamp.toString(36)}-${n.toString(36)}-${Math.random().toString(36).slice(2, 8)}`] = { at: stamp, ...c };
  });
  return newest(out);
}

export { readFile, addChanges, carryChanges };
