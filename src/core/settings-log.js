// A log of settings changes, kept in the settings file so a Sync conflict cannot lose them. Sync merges two
// devices' files with this device's top-level keys on top (obsidian.md/help/sync/troubleshoot), so a change under
// an existing key can be lost, while a new key always survives. Each change gets a key of its own, and every
// read plays them back in time order. shortcut: a value is replaced whole, so two devices adding to one list
// keep the later list; a change older than a week is dropped; a device on 1.1.7 or older keeps the log but does
// not add to it, so within that week its change to the same setting loses. Upgrade if settings need finer merging.
const PREFIX = '~change-';
const WEEK = 7 * 864e5;
/** @typedef {{ at: number, corner: string, key: string, value?: unknown, gone?: boolean }} Change */
/** @typedef {Record<string, Change>} Changes */
const isObj = (/** @type {unknown} */ v) => !!v && typeof v === 'object' && !Array.isArray(v);
const SAFE = (/** @type {unknown} */ s) => typeof s === 'string' && s !== '__proto__' && s !== 'constructor' && s !== 'prototype';

// Newest change per setting, none older than a week.
/** @param {Changes} changes @param {number} now @returns {Changes} */
function prune(changes, now) {
  /** @type {Record<string, [string, Change]>} */
  const best = {}; // keys are JSON arrays, so never a name objects inherit
  for (const [id, c] of Object.entries(changes)) {
    if (now - c.at > WEEK) continue;
    const slot = JSON.stringify([c.corner, c.key]);
    if (!best[slot] || c.at > best[slot][1].at || (c.at === best[slot][1].at && id > best[slot][0])) best[slot] = [id, c];
  }
  return Object.fromEntries(Object.values(best));
}

// The file's settings with its changes played back, and the changes themselves.
/** @param {Record<string, unknown>} file @param {number} now @returns {{ store: Record<string, unknown>, changes: Changes }} */
function readFile(file, now) {
  /** @type {Record<string, unknown>} */
  const store = {};
  /** @type {Changes} */
  const found = {};
  for (const [k, v] of Object.entries(file)) {
    if (!k.startsWith(PREFIX)) store[k] = v;
    else if (isObj(v) && typeof (/** @type {Change} */ (v)).at === 'number' && SAFE((/** @type {Change} */ (v)).corner) && SAFE((/** @type {Change} */ (v)).key)) found[k] = /** @type {Change} */ (v);
  }
  const changes = prune(found, now);
  for (const c of Object.values(changes).sort((a, b) => a.at - b.at)) {
    if (!isObj(store[c.corner])) store[c.corner] = {};
    const corner = /** @type {Record<string, unknown>} */ (store[c.corner]);
    if (c.gone) delete corner[c.key]; else corner[c.key] = c.value;
  }
  return { store, changes };
}

// The changes with what differs between two versions of the settings added.
/** @param {Changes} changes @param {Record<string, unknown>} before @param {Record<string, unknown>} after @param {number} now @returns {Changes} */
function addChanges(changes, before, after, now) {
  const out = { ...changes };
  let n = 0;
  for (const corner of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = isObj(before[corner]) ? /** @type {Record<string, unknown>} */ (before[corner]) : {};
    const b = isObj(after[corner]) ? /** @type {Record<string, unknown>} */ (after[corner]) : {};
    if (!SAFE(corner)) continue;
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!SAFE(key) || JSON.stringify(a[key]) === JSON.stringify(b[key])) continue;
      const id = `${PREFIX}${now.toString(36)}-${(n++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      out[id] = key in b ? { at: now, corner, key, value: b[key] } : { at: now, corner, key, gone: true };
    }
  }
  return prune(out, now);
}

export { readFile, addChanges };
