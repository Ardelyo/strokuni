// Errorless learning + expanding-interval retrieval (Leitner-style boxes).
// No scores are ever shown to Lio. Boxes only decide how much help to give and when to re-test.
import { state, save } from './store.js';

// box -> wait before re-test
const INTERVALS = [0, 10 * 60e3, 60 * 60e3, 864e5, 3 * 864e5, 7 * 864e5, 14 * 864e5];
export const MAX_BOX = INTERVALS.length - 1;

export const LETTER_ORDER = 'LIOAEUMSTNKRBDPGHJCWYFVZQX'.split('');

export function item(id) {
  return (state.srs[id] ||= { box: 0, due: 0, seen: 0 });
}

/** Help level from mastery: 3 = full help (model shown), 2 = partial, 1 = minimal. */
export function helpLevel(id) {
  const b = item(id).box;
  if (b <= 1) return 3;
  if (b <= 3) return 2;
  return 1;
}

/** Record an attempt. `independent` = finished without extra help. */
export function record(id, independent) {
  const it = item(id);
  it.seen++;
  it.last = Date.now();
  if (independent) it.box = Math.min(MAX_BOX, it.box + 1);
  else it.box = Math.max(0, it.box - 1);
  it.due = Date.now() + INTERVALS[it.box];
  save();
}

/** Pick next item: due reviews first, then one new item, then least-recently seen. */
export function pickNext(ids, { exclude = [], newLimit = 3 } = {}) {
  const now = Date.now();
  const pool = ids.filter((id) => !exclude.includes(id));
  const seen = pool.filter((id) => state.srs[id]?.seen);
  const due = seen.filter((id) => state.srs[id].due <= now).sort((a, b) => state.srs[a].due - state.srs[b].due);
  if (due.length) return due[0];
  const fresh = pool.filter((id) => !state.srs[id]?.seen);
  const learning = seen.filter((id) => state.srs[id].box < 3);
  if (fresh.length && learning.length < newLimit) return fresh[0];
  if (seen.length) return seen.sort((a, b) => (state.srs[a].last || 0) - (state.srs[b].last || 0))[0];
  return fresh[0] || pool[0];
}

export function letterIds() { return LETTER_ORDER.map((l) => `letter:${l}`); }
export function keyIds() { return LETTER_ORDER.map((l) => `key:${l}`); }
export function wordIds() { return state.words.map((w) => `word:${w.id}`); }
