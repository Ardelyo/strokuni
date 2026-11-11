// Practice sessions: trace letters, find keys, write words. Short sessions, errorless, then rest.
import { h, icon, btn, iconBtn } from '../ui.js';
import { state, save, practiceDay, logFatigue } from '../store.js';
import { speak, stopSpeaking } from '../speech.js';
import { markTaskDone } from '../plan.js';
import { pickNext, record, helpLevel, letterIds, keyIds, wordIds } from '../srs.js';
import { go } from '../router.js';

const LETTER_NAMES = { A: 'a', B: 'be', C: 'ce', D: 'de', E: 'e', F: 'ef', G: 'ge', H: 'ha', I: 'i', J: 'je', K: 'ka', L: 'el', M: 'em', N: 'en', O: 'o', P: 'pe', Q: 'ki', R: 'er', S: 'es', T: 'te', U: 'u', V: 'fe', W: 'we', X: 'eks', Y: 'ye', Z: 'zet' };
export const sayLetter = (l) => `huruf ${LETTER_NAMES[l] || l}`;
const PRAISE = ['Bagus!', 'Hebat!', 'Pintar!', 'Mantap!', 'Betul!'];
const praise = () => PRAISE[Math.floor(Math.random() * PRAISE.length)];
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// ---------------- on-screen keyboard ----------------
const ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
export function keyboard(onKey) {
  const keys = {};
  const el = h('div', { class: 'kb', role: 'group', 'aria-label': 'Keyboard' }, ROWS.map((row) => h('div', { class: 'kb-row' },
    row.split('').map((ch) => (keys[ch] = h('button', { class: 'kb-key', type: 'button', 'aria-label': sayLetter(ch), onclick: () => onKey(ch) }, ch))))));
  return {
    el,
    clear() { for (const k of Object.values(keys)) k.className = 'kb-key'; },
    hint(ch, level) {
      this.clear();
      if (!ch) return;
      if (level >= 3) keys[ch]?.classList.add('hint');
      else if (level === 2) { const row = ROWS.find((r) => r.includes(ch)); for (const c of row) keys[c].classList.add('row-hint'); }
    },
    flash(ch, cls, ms = 600) { const k = keys[ch]; if (!k) return; k.classList.add(cls); setTimeout(() => k.classList.remove(cls), ms); },
  };
}

// ---------------- trace ----------------
function traceExercise(ctx) {
  const wrap = h('div', { class: 'trace-wrap' });
  const canvas = h('canvas', { 'aria-label': 'Area menelusuri huruf' });
  wrap.append(canvas);
  const prompt = h('div', { class: 'prompt' });
  let letter, id, level, extraHelp, targets, covered, size, drawing = false, last = null, solved = false;

  function setup() {
    id = pickNext(letterIds(), { exclude: ctx.recent });
    letter = id.split(':')[1];
    level = helpLevel(id); extraHelp = false; solved = false;
    prompt.replaceChildren('Telusuri', h('span', { class: 'target' }, letter), iconBtn('volume_up', { label: 'Dengar', onClick: () => speak(sayLetter(letter)) }));
    layout();
    speak(`Telusuri ${sayLetter(letter)} dengan jari.`);
  }

  function layout() {
    const r = wrap.getBoundingClientRect();
    size = Math.max(200, Math.round(r.width));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr; canvas.height = size * dpr;
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // mask for coverage
    const off = document.createElement('canvas'); off.width = size; off.height = size;
    const o = off.getContext('2d');
    o.font = `700 ${Math.round(size * 0.78)}px Roboto, "Segoe UI", Arial, sans-serif`;
    o.textAlign = 'center'; o.textBaseline = 'middle';
    o.fillText(letter, size / 2, size * 0.53);
    const data = o.getImageData(0, 0, size, size).data;
    const step = Math.max(6, Math.round(size / 42));
    targets = [];
    for (let y = 0; y < size; y += step) for (let x = 0; x < size; x += step) if (data[(y * size + x) * 4 + 3] > 140) targets.push([x, y]);
    covered = new Uint8Array(targets.length);
    drawGuide();
  }

  function drawGuide() {
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, size, size);
    const lv = extraHelp ? 3 : level;
    g.font = `700 ${Math.round(size * 0.78)}px Roboto, "Segoe UI", Arial, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (lv >= 3) { g.fillStyle = css('--md-primary-container'); g.fillText(letter, size / 2, size * 0.53); }
    else if (lv === 2) { g.fillStyle = css('--md-surface-container-highest'); g.fillText(letter, size / 2, size * 0.53); }
    g.setLineDash(lv >= 2 ? [] : [10, 12]);
    g.lineWidth = lv >= 3 ? 3 : 2;
    g.strokeStyle = css('--md-outline');
    g.strokeText(letter, size / 2, size * 0.53);
    g.setLineDash([]);
    // already covered dots
    g.fillStyle = css('--md-primary');
    const r = size * 0.045;
    targets.forEach(([x, y], i) => { if (covered[i]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); } });
  }

  function pos(e) { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * (size / r.width), (e.clientY - r.top) * (size / r.height)]; }
  function paint(p) {
    const g = canvas.getContext('2d');
    g.strokeStyle = css('--md-primary'); g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = size * 0.09;
    g.beginPath(); g.moveTo(...(last || p)); g.lineTo(...p); g.stroke();
    last = p;
    const rad = size * 0.075, r2 = rad * rad;
    for (let i = 0; i < targets.length; i++) {
      if (covered[i]) continue;
      const dx = targets[i][0] - p[0], dy = targets[i][1] - p[1];
      if (dx * dx + dy * dy < r2) covered[i] = 1;
    }
  }
  function coverage() { let c = 0; for (const v of covered) c += v; return targets.length ? c / targets.length : 0; }
  function check() {
    if (solved) return;
    if (coverage() >= 0.8) {
      solved = true;
      const independent = !extraHelp;
      record(id, independent);
      wrap.append(h('div', { class: 'success-burst' }, icon('check_circle', 'fill')));
      speak(`${praise()} Ini ${sayLetter(letter)}.`);
      ctx.itemDone({ independent, id });
      setTimeout(() => { wrap.querySelector('.success-burst')?.remove(); if (!ctx.finished()) setup(); }, 1600);
    }
  }
  canvas.addEventListener('pointerdown', (e) => { if (solved) return; drawing = true; canvas.setPointerCapture(e.pointerId); last = null; paint(pos(e)); });
  canvas.addEventListener('pointermove', (e) => { if (!drawing) return; for (const ce of e.getCoalescedEvents?.() || [e]) paint(pos(ce)); });
  const end = () => { if (!drawing) return; drawing = false; last = null; check(); };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);

  const actions = h('div', { class: 'practice-actions' },
    btn('Dengar', { kind: 'tonal', ico: 'volume_up', onClick: () => speak(sayLetter(letter)) }),
    btn('Ulangi', { kind: 'tonal', ico: 'refresh', onClick: () => { covered.fill(0); drawGuide(); } }),
    btn('Bantu', { kind: 'tonal', ico: 'lightbulb', onClick: () => { extraHelp = true; covered.fill(0); drawGuide(); speak(`Ikuti garis yang berwarna. ${sayLetter(letter)}.`); } }));
  const onResize = () => { if (letter) { covered = null; layout(); } };
  window.addEventListener('resize', onResize);
  return { el: h('div', {}, prompt, wrap, actions), start: () => requestAnimationFrame(setup), destroy: () => window.removeEventListener('resize', onResize) };
}

// ---------------- find key ----------------
function keysExercise(ctx) {
  const prompt = h('div', { class: 'prompt' });
  let id, letter, level, misses, done;
  const kb = keyboard((ch) => {
    if (done) return;
    if (ch === letter) {
      done = true;
      kb.clear(); kb.flash(ch, 'good', 900);
      const independent = misses === 0;
      record(id, independent);
      speak(`${praise()} ${sayLetter(letter)}.`);
      ctx.itemDone({ independent, id });
      setTimeout(() => { if (!ctx.finished()) next(); }, 1100);
    } else {
      misses++;
      kb.flash(ch, 'soft-miss');
      level = Math.min(3, level + 1);
      kb.hint(letter, level);
      speak(level >= 3 ? `Cari ${sayLetter(letter)}, yang menyala.` : `Cari ${sayLetter(letter)}. Lihat baris yang berwarna.`);
    }
  });
  function next() {
    id = pickNext(keyIds(), { exclude: ctx.recent });
    letter = id.split(':')[1]; level = helpLevel(id); misses = 0; done = false;
    prompt.replaceChildren('Cari', h('span', { class: 'target' }, letter), iconBtn('volume_up', { label: 'Dengar', onClick: () => speak(`Cari ${sayLetter(letter)}`) }));
    kb.hint(letter, level);
    speak(`Cari ${sayLetter(letter)}.`);
  }
  return {
    el: h('div', {}, prompt, h('div', { class: 'card filled', style: { padding: '12px 8px' } }, kb.el),
      h('div', { class: 'practice-actions' },
        btn('Dengar', { kind: 'tonal', ico: 'volume_up', onClick: () => speak(`Cari ${sayLetter(letter)}`) }),
        btn('Bantu', { kind: 'tonal', ico: 'lightbulb', onClick: () => { misses++; level = 3; kb.hint(letter, 3); speak('Tekan yang menyala.'); } }),
        btn('Lewati', { kind: 'tonal', ico: 'chevron_right', onClick: () => next() }))),
    start: next,
  };
}

// ---------------- write word ----------------
function wordExercise(ctx) {
  const pic = h('div', { class: 'word-picture', 'aria-hidden': 'true' });
  const boxes = h('div', { class: 'word-boxes' });
  const caption = h('div', { class: 'center body-l muted' });
  let id, w, target, pos, level, misses, done;
  const kb = keyboard((ch) => {
    if (done) return;
    if (ch === target[pos]) {
      pos++;
      while (pos < target.length && !/[A-Z]/.test(target[pos])) pos++;
      kb.flash(ch, 'good', 300);
      if (pos >= target.length) {
        done = true; drawBoxes(); kb.clear();
        const independent = misses === 0;
        record(id, independent);
        speak(`${praise()} ${w.word}.`);
        ctx.itemDone({ independent, id });
        setTimeout(() => { if (!ctx.finished()) next(); }, 1600);
        return;
      }
      drawBoxes(); hintNext();
    } else {
      misses++;
      kb.flash(ch, 'soft-miss');
      level = Math.min(3, level + 1);
      drawBoxes(); hintNext();
      speak(`Huruf berikutnya ${sayLetter(target[pos])}.`);
    }
  });
  function hintNext() { kb.hint(target[pos], level >= 3 ? 3 : 0); }
  function drawBoxes() {
    boxes.replaceChildren(...target.split('').map((c, i) => {
      if (!/[A-Z]/.test(c)) return h('span', { style: { width: '16px' } });
      const filled = i < pos;
      const show = filled || level >= 2;
      return h('span', { class: `word-box ${filled ? 'filled' : show ? 'ghost' : ''} ${i === pos && !done ? 'current' : ''}` }, show ? c : '');
    }));
  }
  function next() {
    if (!state.words.length) { caption.textContent = 'Daftar kata kosong. Minta keluarga menambah kata.'; return; }
    id = pickNext(wordIds(), { exclude: ctx.recent });
    w = state.words.find((x) => `word:${x.id}` === id) || state.words[0];
    target = w.word.toUpperCase().normalize('NFD').replace(/[^A-Z ]/g, '');
    pos = 0; misses = 0; done = false; level = helpLevel(id);
    pic.textContent = w.hint || '📝';
    caption.textContent = w.note || '';
    drawBoxes(); hintNext();
    speak(`Tulis kata ${w.word}.`);
  }
  return {
    el: h('div', {}, pic, caption, boxes, h('div', { class: 'card filled', style: { padding: '12px 8px', marginTop: '8px' } }, kb.el),
      h('div', { class: 'practice-actions' },
        btn('Dengar', { kind: 'tonal', ico: 'volume_up', onClick: () => speak(w ? `${w.word}. ${target.split('').filter((c) => c !== ' ').map(sayLetter).join(', ')}` : '') }),
        btn('Bantu', { kind: 'tonal', ico: 'lightbulb', onClick: () => { misses++; level = 3; drawBoxes(); hintNext(); } }),
        btn('Lewati', { kind: 'tonal', ico: 'chevron_right', onClick: () => next() }))),
    start: next,
  };
}

const EXERCISES = { trace: traceExercise, keys: keysExercise, word: wordExercise };
const TITLES = { trace: 'Telusuri huruf', keys: 'Cari tombol', word: 'Tulis kata' };

// ---------------- session wrapper ----------------
export function practiceView({ params, query }) {
  const type = params.type;
  const make = EXERCISES[type];
  if (!make) { go('#/'); return { el: h('div') }; }
  const minutes = Math.max(1, Math.min(15, Number(query.get('min')) || state.settings.sessionMinutes));
  const taskId = query.get('task');
  const startedAt = Date.now();
  const session = { type, start: new Date().toISOString(), items: 0, independent: 0, helped: 0, minutes: 0 };
  const recent = [];
  let timeUp = false, ended = false;
  const bar = h('i');
  const ctx = {
    recent,
    finished: () => timeUp || ended,
    itemDone({ independent, id }) {
      session.items++; independent ? session.independent++ : session.helped++;
      recent.push(id); if (recent.length > 2) recent.shift();
      if (timeUp) setTimeout(() => finish(true), 1400);
    },
  };
  const ex = make(ctx);
  const tick = setInterval(() => {
    const frac = (Date.now() - startedAt) / (minutes * 60e3);
    bar.style.width = `${Math.min(100, frac * 100)}%`;
    if (frac >= 1 && !timeUp) { timeUp = true; if (session.items === 0) finish(true); else speak('Waktunya hampir habis. Satu lagi, lalu istirahat.'); }
    if (frac >= 1.5) finish(true);
  }, 1000);

  function finish(complete) {
    if (ended) return; ended = true;
    clearInterval(tick);
    session.minutes = (Date.now() - startedAt) / 60e3;
    session.end = new Date().toISOString();
    // Minutes are always counted (for pacing); item details are dropped while tracking is paused.
    const pd = practiceDay();
    pd.minutes += session.minutes;
    pd.sessions.push(state.settings.trackingPaused ? { type, minutes: session.minutes } : session);
    save();
    if (taskId && complete) markTaskDone(taskId);
    stopSpeaking();
    go(`#/istirahat?n=${session.items}`, { replace: true });
  }

  const el = h('div', { class: 'lio', style: { flex: '1', display: 'flex', flexDirection: 'column' } },
    h('header', { class: 'practice-top' },
      iconBtn('close', { label: 'Selesai', onClick: () => finish(session.items > 0) }),
      h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Waktu sesi' }, bar),
      h('span', { class: 'label-l muted', style: { padding: '0 8px' } }, `${minutes} mnt`)),
    h('main', { class: 'page' },
      h('h2', { class: 'title-l center', style: { margin: '4px 0' } }, TITLES[type]),
      ex.el,
      h('div', { class: 'center', style: { marginTop: '16px' } },
        btn('Saya lelah', { kind: 'text', size: 'lg', ico: 'bedtime', onClick: () => { logFatigue('lelah'); finish(session.items > 0); } }))));
  setTimeout(() => ex.start(), 50);
  return { el, destroy() { clearInterval(tick); ex.destroy?.(); ended = true; } };
}

// ---------------- rest screen ----------------
export function restView({ query }) {
  const n = Number(query.get('n') || 0);
  setTimeout(() => speak(`Latihan selesai. ${n ? `Kamu mengerjakan ${n} soal. ` : ''}Sekarang istirahat dulu. Minum air, dan tarik napas pelan.`), 300);
  return { el: h('div', { class: 'rest-screen lio' },
    h('span', { class: 'icon huge', 'aria-hidden': 'true' }, 'self_improvement'),
    h('h1', {}, 'Waktunya istirahat'),
    h('p', {}, n ? `Latihan selesai: ${n} soal. Minum air dan tarik napas pelan.` : 'Minum air dan tarik napas pelan.'),
    btn('Kembali', { kind: 'filled', size: 'xl', ico: 'home', onClick: () => go('#/') })) };
}
