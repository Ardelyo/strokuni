// Daily plan: default plan, approved AI/family plan, and the single "Sekarang" card.
import { state, save, today, uid, isTiredToday } from './store.js';
import { addDays, nowMinutes, minutesOf } from './time.js';
import { dueSlots } from './meds.js';

export const TASK_TYPES = {
  trace: { label: 'Telusuri huruf', icon: 'gesture', speak: 'Ayo menelusuri huruf dengan jari.' },
  keys: { label: 'Cari tombol keyboard', icon: 'keyboard', speak: 'Ayo mencari huruf di keyboard.' },
  word: { label: 'Tulis kata', icon: 'spellcheck', speak: 'Ayo menulis kata.' },
  voice: { label: 'Ceritakan hari ini', icon: 'mic', speak: 'Ceritakan sedikit tentang hari ini.' },
  rest: { label: 'Istirahat', icon: 'self_improvement', speak: 'Waktunya istirahat sebentar.' },
  custom: { label: 'Tugas', icon: 'task_alt', speak: '' },
};

export const MAX_TASKS = 5;

function makeTasks(list) {
  return list.slice(0, MAX_TASKS).map((t) => ({
    id: uid('t'),
    type: TASK_TYPES[t.type] ? t.type : 'custom',
    label: t.label || TASK_TYPES[t.type]?.label || 'Tugas',
    minutes: Math.max(1, Math.min(15, Number(t.minutes) || state.settings.sessionMinutes)),
    done: false,
  }));
}

/** Today's plan. Falls back to the default plan when no approved plan exists (works without AI/internet). */
export function planFor(day = today()) {
  if (!state.plans[day]) {
    state.plans[day] = { source: 'default', tasks: makeTasks(state.defaultPlan), approvedAt: null };
    save();
  }
  return state.plans[day];
}

export function setPlan(day, tasks, source) {
  const prev = state.plans[day];
  state.plans[day] = { source, tasks: makeTasks(tasks), approvedAt: new Date().toISOString() };
  // keep done flags if same type already done today
  if (prev) for (const t of state.plans[day].tasks) {
    const match = prev.tasks.find((p) => p.type === t.type && p.done);
    if (match && day === today()) t.done = true;
  }
  save();
}

export function tomorrow() { return addDays(today(), 1); }

export function markTaskDone(taskId, day = today()) {
  const t = planFor(day).tasks.find((x) => x.id === taskId);
  if (t && !t.done) { t.done = true; t.doneAt = new Date().toISOString(); save(); }
}

export function nextTask(day = today()) {
  return planFor(day).tasks.find((t) => !t.done) || null;
}

export function isEvening(now = new Date()) {
  return nowMinutes(now) >= minutesOf(state.settings.summaryTime || '21:00') - 30;
}

/**
 * Decide the one card Lio sees. Priority: medication > rest (tired / just finished) > evening note > next task > done.
 */
export function currentCard(now = new Date(), { restUntil = 0 } = {}) {
  const due = dueSlots(now);
  if (due.length) return { kind: 'med', slots: due };
  if (restUntil > Date.now() || isTiredToday()) return { kind: 'rest' };
  const day = today();
  const ci = state.checkins[day];
  const t = nextTask(day);
  if (isEvening(now) && (!ci || ci.confusing == null || ci.tiring == null)) return { kind: 'night' };
  if (t) return { kind: 'task', task: t };
  return { kind: 'done' };
}
