// Strokuni entry: routes, guards, background loops (escalation, heartbeat, night summary, sync).
import { route, startRouter, setGuard, rerender } from './router.js';
import { state, save, prune, today, seedDemo } from './store.js';
import { nowView, voiceNoteView, recordedView, repeatReminder } from './views/lio.js';
import { practiceView, restView } from './views/practice.js';
import { pinView, berandaView, obatView, latihanView, rencanaView, lainnyaView, izinView, isUnlocked, applyTheme, unlockOnce } from './views/family.js';
import { onboardingView } from './views/onboarding.js';
import { dueSlots, lateMinutes, syncNativeAlarms, pullNativeTaken } from './meds.js';
import { generateDraft } from './ai.js';
import { setPlan, planFor } from './plan.js';
import { serverConfigured, heartbeat, sendAlert, fetchRemote, pullConfig, pullApprovedPlan, configureNative } from './sync.js';
import { minutesOf, nowMinutes } from './time.js';
import { isNative } from './native.js';

route('/', nowView);
route('/mulai', onboardingView, { open: true });
route('/catatan', voiceNoteView);
route('/dicatat', recordedView);
route('/latihan/:type', practiceView);
route('/istirahat', restView);
route('/pin', pinView, { open: true });
route('/keluarga', berandaView, { family: true });
route('/keluarga/obat', obatView, { family: true });
route('/keluarga/latihan', latihanView, { family: true });
route('/keluarga/rencana', rencanaView, { family: true });
route('/keluarga/lainnya', lainnyaView, { family: true });
route('/keluarga/izin', izinView, { family: true });

setGuard(({ path, opts }) => {
  if (!state.settings.onboarded && path !== '/mulai') return '#/mulai';
  if (opts.family && !isUnlocked()) return `#/pin?next=${encodeURIComponent(location.hash || '#/keluarga')}`;
  if (state.settings.role === 'family' && !opts.family && !opts.open) return '#/keluarga';
  return null;
});

applyTheme();
prune();
const qs = new URLSearchParams(location.search);
if (qs.has('demo') && !state.settings.onboarded) await seedDemo();
if (state.settings.demo && qs.get('pin') === '1234') unlockOnce(); // demo-only shortcut for previews
startRouter(document.getElementById('app'));

// ---------- background loops ----------
const spokenAt = {}; // slot key -> late minutes when last spoken

function notifyWeb(title, body) {
  if (isNative || !('Notification' in window) || Notification.permission !== 'granted') return;
  try { new Notification(title, { body, icon: 'icons/icon-192.png', tag: 'strokuni-' + title }); } catch { /* ignore */ }
}

async function escalate() {
  if (state.settings.role !== 'lio') return;
  const { repeatMin, alertMin } = state.settings.escalation;
  state.escalated ||= {};
  for (const slot of dueSlots()) {
    const late = lateMinutes(slot);
    const k = `${slot.day}|${slot.key}`;
    const last = spokenAt[k];
    if (!document.hidden && (last == null ? late >= repeatMin : late - last >= repeatMin) && ['', '#', '#/'].includes(location.hash)) {
      spokenAt[k] = late;
      repeatReminder(slot);
    }
    if (document.hidden && (last == null || late - last >= repeatMin)) {
      spokenAt[k] = late;
      notifyWeb('Waktunya minum obat', `${slot.med.name} ${slot.med.dose || ''} · ${slot.time}`);
    }
    if (late >= alertMin && !state.escalated[k]) {
      state.escalated[k] = Date.now(); save();
      sendAlert('missed_dose', `${state.settings.patientName} belum mengonfirmasi ${slot.med.name} jam ${slot.time} (${late} menit).`, k);
    }
  }
}

async function nightly() {
  if (state.settings.role !== 'lio') return;
  if (nowMinutes() < minutesOf(state.settings.summaryTime || '21:00')) return;
  if (state.lastSummaryDay === today()) return;
  state.lastSummaryDay = today(); save();
  try { await generateDraft(); } catch (e) { console.warn('night summary', e); }
}

async function pullForLio() {
  if (state.settings.role !== 'lio' || !serverConfigured()) return;
  try {
    if (await pullConfig()) await syncNativeAlarms();
    const p = planFor(today());
    if (p.source === 'default') {
      const remote = await pullApprovedPlan(today());
      if (remote?.tasks?.length) { setPlan(today(), remote.tasks, remote.source || 'family'); rerenderIfLio(); }
    }
  } catch (e) { console.warn('pull', e.message); }
}

let lastAlertSeen = Number(localStorage.getItem('strokuni.lastAlert') || 0);
async function pollFamily() {
  if (state.settings.role !== 'family' || !serverConfigured() || document.hidden) return;
  try {
    const r = await fetchRemote();
    const fresh = (r.alerts || []).filter((a) => new Date(a.at).getTime() > lastAlertSeen);
    if (fresh.length) {
      lastAlertSeen = Math.max(...fresh.map((a) => new Date(a.at).getTime()));
      localStorage.setItem('strokuni.lastAlert', String(lastAlertSeen));
      notifyWeb('Peringatan Strokuni', fresh[fresh.length - 1].message);
    }
    if (location.hash === '#/keluarga') rerender();
  } catch (e) { console.warn('poll', e.message); }
}

function rerenderIfLio() { if (['', '#/', '#'].includes(location.hash)) rerender(); }

async function onResume() {
  if (await pullNativeTaken()) rerenderIfLio();
  pullForLio();
  pollFamily();
}

window.addEventListener('strokuni:doseTaken', onResume);
document.addEventListener('visibilitychange', () => { if (!document.hidden) onResume(); });

setInterval(escalate, 30e3);
setInterval(nightly, 60e3);
setInterval(heartbeat, 15 * 60e3);
setInterval(pullForLio, 30 * 60e3);
setInterval(pollFamily, 60e3);

(async () => {
  if (isNative) { await configureNative(); await pullNativeTaken(); await syncNativeAlarms(); }
  heartbeat();
  pullForLio();
  pollFamily();
  escalate();
  nightly();
})();

if ('serviceWorker' in navigator && !isNative && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
