// Local-first state, persisted to localStorage. One JSON document.
import { dayKey, addDays } from './time.js';

const KEY = 'strokuni.v1';
const listeners = new Set();

export const DEFAULT_WORDS = [
  { id: 'w1', word: 'LIO', hint: '🙂', note: 'Nama sendiri' },
  { id: 'w2', word: 'TEH', hint: '🍵', note: 'Minuman pagi' },
  { id: 'w3', word: 'OBAT', hint: '💊', note: '' },
  { id: 'w4', word: 'MAKAN', hint: '🍚', note: '' },
  { id: 'w5', word: 'RUMAH', hint: '🏠', note: '' },
  { id: 'w6', word: 'AIR', hint: '💧', note: '' },
  { id: 'w7', word: 'KURSI', hint: '🪑', note: '' },
  { id: 'w8', word: 'IBU', hint: '👩', note: '' },
];

export const DEFAULT_PLAN = [
  { type: 'trace', label: 'Telusuri huruf', minutes: 5 },
  { type: 'keys', label: 'Cari tombol keyboard', minutes: 5 },
  { type: 'word', label: 'Tulis kata', minutes: 5 },
  { type: 'voice', label: 'Ceritakan hari ini', minutes: 2 },
];

function fresh() {
  return {
    version: 1,
    settings: {
      onboarded: false,
      pinHash: '',
      patientName: 'Lio',
      familyName: 'Keluarga',
      familyPhone: '',
      sessionMinutes: 5,
      summaryTime: '21:00',
      speechRate: 0.9,
      trackingPaused: false,
      theme: 'auto',
      role: 'lio', // 'lio' | 'family'
      serverUrl: '',
      familyCode: '',
      escalation: { repeatMin: 10, alertMin: 30, callMin: 60 },
      configUpdatedAt: 0,
    },
    meds: [],
    words: DEFAULT_WORDS,
    defaultPlan: DEFAULT_PLAN,
    doses: {},       // { day: { "medId@HH:MM": { takenAt, by } } }
    srs: {},         // { "letter:A": { box, due, seen } }
    practice: {},    // { day: { minutes, sessions: [] } }
    notes: [],       // { id, at, day, kind, text, photo }
    fatigue: {},     // { day: [ { at, level } ] }
    checkins: {},    // { day: { confusing, tiring } }
    plans: {},       // { day: { source, tasks: [{id,type,label,minutes,done}], approvedAt } }
    drafts: [],      // AI/manual night summaries waiting for family
    alerts: [],      // local alert log
    remote: null,    // last snapshot from server (family phone)
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const data = JSON.parse(raw);
    const base = fresh();
    return { ...base, ...data, settings: { ...base.settings, ...data.settings, escalation: { ...base.settings.escalation, ...(data.settings?.escalation || {}) } } };
  } catch (e) {
    console.warn('state load failed', e);
    return fresh();
  }
}

export const state = load();

let saveTimer;
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 50);
  for (const fn of listeners) fn(state);
}
export function flush() {
  clearTimeout(saveTimer);
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) {
    // storage full: drop old photos first
    for (const n of state.notes) if (n.photo && Date.now() - new Date(n.at).getTime() > 7 * 864e5) delete n.photo;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e2) { console.error('save failed', e2); }
  }
}
window.addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Marks shared config (meds, words, plan template) as changed so sync pushes it. */
export function touchConfig() { state.settings.configUpdatedAt = Date.now(); save(); }

export const uid = (p = '') => p + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

export function today() { return dayKey(); }

export function practiceDay(day = today()) {
  state.practice[day] ||= { minutes: 0, sessions: [] };
  return state.practice[day];
}

export function logFatigue(level) {
  const d = today();
  (state.fatigue[d] ||= []).push({ at: new Date().toISOString(), level });
  save();
}

export function isTiredToday() {
  const list = state.fatigue[today()] || [];
  const last = list[list.length - 1];
  return last && last.level === 'lelah' && Date.now() - new Date(last.at).getTime() < 2 * 3600e3;
}

export function addNote(note) {
  if (state.settings.trackingPaused && note.kind !== 'system') return null;
  const n = { id: uid('n'), at: new Date().toISOString(), day: today(), ...note };
  state.notes.push(n);
  save();
  return n;
}

/** Remove old data (retention, default 60 days). Photos dropped after 14 days. */
export function prune(days = 60) {
  const cutoff = addDays(today(), -days);
  const photoCutoff = Date.now() - 14 * 864e5;
  for (const k of ['doses', 'practice', 'fatigue', 'checkins', 'plans']) {
    for (const day of Object.keys(state[k])) if (day < cutoff) delete state[k][day];
  }
  state.notes = state.notes.filter((n) => n.day >= cutoff);
  for (const n of state.notes) if (n.photo && new Date(n.at).getTime() < photoCutoff) delete n.photo;
  state.drafts = state.drafts.filter((d) => d.date >= cutoff).slice(-30);
  state.alerts = state.alerts.slice(-100);
  save();
}

export function exportData() { return JSON.stringify(state, null, 2); }

export function importData(json) {
  const data = JSON.parse(json);
  if (!data || data.version !== 1) throw new Error('Format file tidak dikenal');
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, fresh(), data);
  flush();
}

export function resetAll() {
  localStorage.removeItem(KEY);
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, fresh());
  flush();
}

/** Demo data for the public web preview (?demo). PIN keluarga: 1234. */
export async function seedDemo() {
  const now = new Date();
  const t = (offsetMin) => { const d = new Date(now.getTime() + offsetMin * 60e3); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  Object.assign(state.settings, { onboarded: true, pinHash: await hashPin('1234'), patientName: 'Lio', familyName: 'Ibu', familyPhone: '081234567890', role: 'lio', demo: true });
  state.meds = [
    { id: 'demo1', name: 'Amlodipin', dose: '1 tablet 5 mg', note: 'Sesudah makan', times: [t(-2)], active: true },
    { id: 'demo2', name: 'Aspirin', dose: '1 tablet 80 mg', note: 'Sesudah makan siang', times: [t(240)], active: true },
  ];
  save();
}

export async function hashPin(pin) {
  const data = new TextEncoder().encode('strokuni:' + pin);
  if (crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 0; for (const b of data) h = (h * 31 + b) >>> 0; return 'x' + h.toString(16);
}
