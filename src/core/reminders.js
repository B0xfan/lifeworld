// Task reminders: one copy for every part of LifeWorld (phase 1 section 6; before, a verbatim
// copy each in Today, Planner and Projects).
'use strict';

const { asList } = require('./lists');

// Reminders (reminder setup mockup, approved 2026-10-05; GL-002
// "Task reminders"). TaskNotes' own `reminders` list, in its format:
// { id: 'rem_<ms>', type: 'relative', relatedTo: 'due' | 'scheduled',
// offset: 'PT0M' | '-PT15M' | '-PT1H' | '-P1D' ... }. A4 uses the first
// relative entry on the field that rings: `due` for a one-off task,
// `scheduled` (its start) for a repeating one. Amounts are minutes BEFORE the
// time (0 = at the time). A task with no clock time never rings.
const REMINDER_CHOICES = [0, 5, 15, 30, 60, 1440];

function ringField(fm) { return fm && typeof fm.recurrence === 'string' && fm.recurrence.trim() ? 'scheduled' : 'due'; }

// ISO 8601 duration -> minutes before (a negative offset is before; a positive one, after).
function offsetMinutes(iso) {
  const m = /^\s*([-+])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?\s*$/i.exec(String(iso == null ? '' : iso));
  if (!m || !/\d/.test(m[0])) return null;
  const mins = ((Number(m[2] || 0) * 7) + Number(m[3] || 0)) * 1440 + Number(m[4] || 0) * 60 + Number(m[5] || 0) + Math.floor(Number(m[6] || 0) / 60);
  return m[1] === '-' ? mins : -mins;
}

// Minutes before -> the offset TaskNotes writes ('PT0M', '-PT15M', '-PT1H', '-P1D', '-PT1H30M').
function offsetIso(before) {
  const n = Math.abs(Math.round(Number(before) || 0));
  if (!n) return 'PT0M';
  const s = before > 0 ? '-' : '';
  if (n % 1440 === 0) return `${s}P${n / 1440}D`;
  const h = Math.floor(n / 60); const mi = n % 60;
  return `${s}PT${h ? `${h}H` : ''}${mi ? `${mi}M` : ''}`;
}

// The task's reminder: minutes before its time, or null (no reminder).
function reminderOf(fm) {
  const field = ringField(fm);
  for (const r of asList(fm && fm.reminders)) {
    if (!r || typeof r !== 'object' || r.type !== 'relative' || r.relatedTo !== field) continue;
    const n = offsetMinutes(r.offset);
    if (n != null) return n;
  }
  return null;
}

// The small mark after the bell: '' at the time, else '15m', '1h', '1d', '1h30m'.
function reminderShort(before) {
  if (!before) return '';
  const n = Math.abs(before); const d = Math.floor(n / 1440); const h = Math.floor((n % 1440) / 60); const mi = n % 60;
  return `${d ? `${d}d` : ''}${h ? `${h}h` : ''}${mi ? `${mi}m` : ''}${before < 0 ? ' after' : ''}`;
}

// 'At the time', '15 min before', '1 hour before', '2 hours 30 min before', '1 day before'.
function reminderWords(before) {
  if (!before) return 'At the time';
  const n = Math.abs(before); const d = Math.floor(n / 1440); const h = Math.floor((n % 1440) / 60); const mi = n % 60;
  const parts = [];
  if (d) parts.push(`${d} day${d === 1 ? '' : 's'}`);
  if (h) parts.push(`${h} hour${h === 1 ? '' : 's'}`);
  if (mi) parts.push(`${mi} min`);
  return `${parts.join(' ')} ${before < 0 ? 'after' : 'before'}`;
}

module.exports = { REMINDER_CHOICES, ringField, offsetMinutes, offsetIso, reminderOf, reminderShort, reminderWords };
