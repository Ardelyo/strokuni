// Night summary ("otak kedua"): build the day log, ask the relay server, fall back to a rule-based summary.
// AI proposes, family decides. AI never touches medication or dose.
import { state, save, today, uid } from './store.js';
import { dosesSummary } from './meds.js';
import { fmtTime, addDays } from './time.js';
import { api, serverConfigured } from './sync.js';
import { TASK_TYPES, MAX_TASKS } from './plan.js';

/** Compact JSON log of one day — the only thing the AI ever sees. */
export function buildDayLog(day = today()) {
  const ds = dosesSummary(day);
  const p = state.practice[day] || { minutes: 0, sessions: [] };
  const paused = state.settings.trackingPaused;
  return {
    date: day,
    patientName: state.settings.patientName,
    medication: {
      scheduled: ds.total,
      confirmed: ds.taken,
      slots: ds.slots.map((s) => ({ time: s.time, med: s.med.name, confirmedAt: s.taken ? fmtTime(s.taken.takenAt) : null })),
    },
    practice: {
      minutes: Math.round(p.minutes || 0),
      sessions: (p.sessions || []).map((s) => ({ type: s.type, minutes: Math.round(s.minutes * 10) / 10, items: s.items, independent: s.independent, helped: s.helped })),
    },
    plan: (state.plans[day]?.tasks || []).map((t) => ({ type: t.type, label: t.label, minutes: t.minutes, done: t.done })),
    fatigue: (state.fatigue[day] || []).map((f) => ({ time: fmtTime(f.at), level: f.level })),
    checkin: state.checkins[day] || null,
    notes: paused ? [] : state.notes.filter((n) => n.day === day && n.text).map((n) => ({ time: fmtTime(n.at), kind: n.kind, text: n.text.slice(0, 600) })),
    trackingPaused: paused,
    allowedTaskTypes: Object.keys(TASK_TYPES),
    sessionMinutes: state.settings.sessionMinutes,
  };
}

/** Deterministic summary from facts only. Used when offline, no server, or AI fails. */
export function manualSummary(log) {
  const m = log.medication;
  const missed = m.slots.filter((s) => !s.confirmedAt);
  const tired = log.fatigue.some((f) => f.level === 'lelah') || log.checkin?.tiring === true;
  const catatan = [
    `Obat: ${m.confirmed} dari ${m.scheduled} jadwal dikonfirmasi${m.slots.filter((s) => s.confirmedAt).length ? ` (${m.slots.filter((s) => s.confirmedAt).map((s) => s.confirmedAt).join(', ')})` : ''}.`,
    `Latihan: ${log.practice.minutes} menit dalam ${log.practice.sessions.length} sesi.`,
    log.fatigue.length ? `Tombol "Saya lelah" ditekan ${log.fatigue.filter((f) => f.level === 'lelah').length} kali.` : null,
    log.notes.length ? `${log.notes.length} catatan direkam.` : null,
  ].filter(Boolean).join(' ');
  const pola = [];
  const byType = {};
  for (const s of log.practice.sessions) (byType[s.type] ||= []).push(s);
  for (const [type, list] of Object.entries(byType)) {
    const items = list.reduce((a, s) => a + (s.items || 0), 0);
    const ind = list.reduce((a, s) => a + (s.independent || 0), 0);
    pola.push(`${TASK_TYPES[type]?.label || type}: ${items} soal, ${ind} tanpa bantuan tambahan.`);
  }
  if (log.checkin?.confusing === true) pola.push('Lio menjawab layar terasa membingungkan.');
  if (log.checkin?.tiring === true) pola.push('Lio menjawab latihan terasa melelahkan.');
  const base = state.defaultPlan.slice(0, MAX_TASKS);
  const rencana = (tired ? base.slice(0, 3).map((t) => ({ ...t, minutes: Math.max(3, Math.round(t.minutes * 0.6)) })) : base)
    .map((t) => ({ type: t.type, label: t.label, minutes: t.minutes, reason: tired ? 'Hari ini tercatat lelah, jadi tugas dikurangi.' : 'Rencana standar.' }));
  const pertanyaan = missed.map((s) => `Jadwal ${s.med} jam ${s.time} belum dikonfirmasi. Apakah sudah diminum?`);
  if (log.checkin?.confusing === true) pertanyaan.push('Bagian mana yang membingungkan bagi Lio?');
  return { catatan, pola, rencana, pertanyaan };
}

/** Generate tonight's draft. Prefers the server AI, always falls back to the manual summary. */
export async function generateDraft(day = today(), { forceManual = false } = {}) {
  const log = buildDayLog(day);
  let summary = null; let source = 'manual'; let error = null; let remoteId = null;
  if (!forceManual && serverConfigured()) {
    try {
      const r = await api('/api/summary', { method: 'POST', body: { log }, timeout: 120000 });
      summary = r.draft.summary; source = 'ai'; remoteId = r.draft.id;
    } catch (e) { error = e.message; }
  }
  if (!summary) summary = manualSummary(log);
  const draft = { id: remoteId || uid('d'), date: day, forDate: addDays(day, 1), createdAt: new Date().toISOString(), source, summary, status: 'pending', error };
  state.drafts = state.drafts.filter((d) => !(d.date === day && d.status === 'pending'));
  state.drafts.push(draft);
  state.lastSummaryDay = day;
  save();
  return draft;
}

export function pendingDrafts() {
  return state.drafts.filter((d) => d.status === 'pending').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Ask the server AI to read a medicine label photo. Returns a form draft; family must verify against the prescription. */
export async function readLabel(dataUrl) {
  const r = await api('/api/label', { method: 'POST', body: { image: dataUrl }, timeout: 90000 });
  return r.label;
}
