// Medication schedule, double-dose lock, escalation.
// Rule: the app never decides or changes a dose. Family enters it from the prescription.
import { state, save, today } from './store.js';
import { at, nowMinutes, minutesOf, dayKey } from './time.js';
import { Native } from './native.js';

export const slotKey = (medId, time) => `${medId}@${time}`;

/** All dose slots for a day, sorted by time. */
export function slotsFor(day = today()) {
  const taken = state.doses[day] || {};
  const out = [];
  for (const m of state.meds) {
    if (m.active === false) continue;
    for (const t of m.times || []) {
      const key = slotKey(m.id, t);
      out.push({ key, med: m, time: t, day, taken: taken[key] || null });
    }
  }
  return out.sort((a, b) => minutesOf(a.time) - minutesOf(b.time) || a.med.name.localeCompare(b.med.name));
}

/** Status of a slot relative to now. */
export function slotStatus(slot, now = new Date()) {
  if (slot.taken) return 'taken';
  const due = at(slot.day, slot.time).getTime();
  const late = (now.getTime() - due) / 60000;
  if (late < 0) return 'upcoming';
  const { callMin } = state.settings.escalation;
  if (late >= callMin) return 'overdue';
  return 'due';
}

export function lateMinutes(slot, now = new Date()) {
  return Math.max(0, Math.round((now.getTime() - at(slot.day, slot.time).getTime()) / 60000));
}

/** Slots that need attention now (due or overdue, today only, not taken). Doses from earlier days are never surfaced as "take now". */
export function dueSlots(now = new Date()) {
  return slotsFor(dayKey(now)).filter((s) => ['due', 'overdue'].includes(slotStatus(s, now)));
}

export function nextSlot(now = new Date()) {
  const n = nowMinutes(now);
  return slotsFor(dayKey(now)).find((s) => !s.taken && minutesOf(s.time) > n) || null;
}

/** Last taken slot today (for "Sudah diminum jam 08:05" lock display). */
export function lastTaken(now = new Date()) {
  const list = slotsFor(dayKey(now)).filter((s) => s.taken);
  return list.sort((a, b) => new Date(b.taken.takenAt) - new Date(a.taken.takenAt))[0] || null;
}

/** Double-dose lock: returns false if already taken. */
export function markTaken(slot, by = 'lio', when = new Date()) {
  const d = (state.doses[slot.day] ||= {});
  if (d[slot.key]) return false;
  d[slot.key] = { takenAt: when.toISOString(), by };
  save();
  Native.markTaken(slot.key, slot.day, when.toISOString());
  return true;
}

/** Family can undo a mistaken confirmation. */
export function undoTaken(slot) {
  const d = state.doses[slot.day];
  if (d) { delete d[slot.key]; save(); }
}

/** Push the schedule to the native alarm layer (setAlarmClock + full-screen intent). */
export async function syncNativeAlarms() {
  const s = state.settings;
  const doses = [];
  for (const m of state.meds) {
    if (m.active === false) continue;
    for (const t of m.times || []) doses.push({ key: slotKey(m.id, t), time: t, name: m.name, dose: m.dose || '', note: m.note || '' });
  }
  await Native.scheduleMeds({
    doses,
    escalation: s.escalation,
    summaryTime: s.summaryTime,
    patientName: s.patientName,
  });
}

/** Merge confirmations made on the native alarm screen while the web layer was closed. */
export async function pullNativeTaken() {
  const r = await Native.getTaken();
  if (!r?.taken) return 0;
  let n = 0;
  for (const t of r.taken) {
    const d = (state.doses[t.date] ||= {});
    if (!d[t.key]) { d[t.key] = { takenAt: t.at, by: 'lio' }; n++; }
  }
  if (n) save();
  return n;
}

export function dosesSummary(day = today()) {
  const slots = slotsFor(day);
  return { total: slots.length, taken: slots.filter((s) => s.taken).length, slots };
}
