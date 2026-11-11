// Talks to the Strokuni relay server (server/index.mjs). The phone never calls an AI model directly.
import { state, save, touchConfig } from './store.js';
import { dosesSummary } from './meds.js';
import { today } from './store.js';
import { Native } from './native.js';

export const serverConfigured = () => !!(state.settings.serverUrl && state.settings.familyCode);

export async function api(path, { method = 'GET', body, timeout = 60000 } = {}) {
  if (!serverConfigured()) throw new Error('Server belum diatur');
  const base = state.settings.serverUrl.replace(/\/+$/, '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-family-code': state.settings.familyCode },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Server ${res.status}`);
    return data;
  } finally { clearTimeout(timer); }
}

export async function ping() {
  return api('/api/health', { timeout: 8000 });
}

/** Today snapshot shared with the family phone (no photos). */
export function snapshot() {
  const d = today();
  const ds = dosesSummary(d);
  const p = state.practice[d] || { minutes: 0 };
  return {
    day: d,
    patientName: state.settings.patientName,
    doses: ds.slots.map((s) => ({ key: s.key, name: s.med.name, dose: s.med.dose, time: s.time, takenAt: s.taken?.takenAt || null })),
    practiceMinutes: Math.round(p.minutes || 0),
    notes: state.settings.trackingPaused ? [] : state.notes.filter((n) => n.day === d && n.text).map((n) => ({ at: n.at, text: n.text })).slice(-10),
    fatigue: state.fatigue[d] || [],
    trackingPaused: state.settings.trackingPaused,
    plan: state.plans[d]?.tasks?.map((t) => ({ label: t.label, done: t.done })) || [],
  };
}

export async function heartbeat() {
  if (!serverConfigured()) return;
  try {
    await api('/api/heartbeat', { method: 'POST', body: { role: state.settings.role, at: new Date().toISOString(), snapshot: state.settings.role === 'lio' ? snapshot() : null }, timeout: 15000 });
  } catch (e) { console.warn('heartbeat', e.message); }
}

export async function sendAlert(type, message, dedupe) {
  state.alerts.push({ at: new Date().toISOString(), type, message, sent: false });
  save();
  if (!serverConfigured()) return false;
  try {
    await api('/api/alerts', { method: 'POST', body: { type, message, dedupe }, timeout: 15000 });
    state.alerts[state.alerts.length - 1].sent = true; save();
    return true;
  } catch { return false; }
}

/** Shared config: meds, words, default plan. Last writer wins by configUpdatedAt. */
export async function pushConfig() {
  if (!serverConfigured()) return;
  const s = state.settings;
  await api('/api/config', { method: 'POST', body: {
    updatedAt: s.configUpdatedAt || Date.now(),
    meds: state.meds.map(({ photo, ...m }) => m),
    words: state.words, defaultPlan: state.defaultPlan,
    settings: { sessionMinutes: s.sessionMinutes, summaryTime: s.summaryTime, escalation: s.escalation, patientName: s.patientName, familyPhone: s.familyPhone },
  } });
}

export async function pullConfig() {
  if (!serverConfigured()) return false;
  const r = await api('/api/config');
  const c = r.config;
  if (!c || !(c.updatedAt > (state.settings.configUpdatedAt || 0))) return false;
  // keep local photos for meds with same id
  const photos = Object.fromEntries(state.meds.map((m) => [m.id, m.photo]));
  state.meds = (c.meds || []).map((m) => ({ ...m, photo: photos[m.id] }));
  state.words = c.words || state.words;
  state.defaultPlan = c.defaultPlan || state.defaultPlan;
  Object.assign(state.settings, c.settings || {}, { configUpdatedAt: c.updatedAt });
  save();
  return true;
}

export async function pullApprovedPlan(day) {
  if (!serverConfigured()) return null;
  const r = await api(`/api/plan?date=${day}`);
  return r.plan || null;
}

export async function pushApprovedPlan(day, tasks) {
  if (!serverConfigured()) return;
  await api('/api/plan', { method: 'POST', body: { date: day, tasks } });
}

export async function fetchRemote() {
  if (!serverConfigured()) return null;
  const [status, alerts, drafts] = await Promise.all([
    api('/api/status'), api(`/api/alerts?since=${Date.now() - 864e5}`), api('/api/drafts?status=pending'),
  ]);
  state.remote = { fetchedAt: Date.now(), ...status, alerts: alerts.alerts || [] };
  // merge remote drafts
  for (const d of drafts.drafts || []) {
    if (!state.drafts.find((x) => x.id === d.id)) state.drafts.push({ ...d, remote: true });
  }
  save();
  return state.remote;
}

export async function decideRemoteDraft(id, status, summary) {
  if (!serverConfigured()) return;
  await api(`/api/drafts/${encodeURIComponent(id)}`, { method: 'POST', body: { status, summary } });
}

export function configureNative() {
  const s = state.settings;
  return Native.configure({ serverUrl: s.serverUrl, familyCode: s.familyCode, role: s.role, patientName: s.patientName, familyName: s.familyName, familyPhone: s.familyPhone });
}

export { touchConfig };
