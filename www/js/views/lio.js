// Mode Lio: one "Sekarang" card at a time, voice first.
import { h, icon, btn, iconBtn, topBar, snackbar, pickImage, switchEl, empty } from '../ui.js';
import { state, save, today, logFatigue, addNote } from '../store.js';
import { hm, longDate, greeting, spokenTime, fmtTime, keyToLongDate } from '../time.js';
import { currentCard, TASK_TYPES, markTaskDone } from '../plan.js';
import { markTaken, nextSlot, lastTaken, slotStatus, lateMinutes, dosesSummary } from '../meds.js';
import { speak, listen, canListen, stopSpeaking } from '../speech.js';
import { Native, isNative } from '../native.js';
import { go } from '../router.js';

const ui = { restUntil: 0, justTaken: null, lastSpokenCard: '' };

export function callFamily() {
  const n = state.settings.familyPhone;
  if (!n) { speak('Nomor keluarga belum diisi.'); snackbar('Nomor telepon keluarga belum diatur di Mode Keluarga'); return; }
  speak(`Menelepon ${state.settings.familyName}`);
  if (isNative && Native.available()) Native.callPhone(n);
  else location.href = `tel:${n.replace(/[^\d+]/g, '')}`;
}

function cardSpeech(card) {
  const name = state.settings.patientName;
  switch (card.kind) {
    case 'med': {
      const s = card.slots[0];
      return `${name}, waktunya minum obat ${s.med.name}${s.med.dose ? ', ' + s.med.dose : ''}. Setelah diminum, tekan tombol Sudah diminum.`;
    }
    case 'task': return `${TASK_TYPES[card.task.type]?.speak || card.task.label} ${card.task.minutes} menit. Tekan Mulai.`;
    case 'rest': return 'Waktunya istirahat. Tidak apa-apa, kita lanjut nanti.';
    case 'night': return `${greeting()}, ${name}. Ayo isi catatan malam.`;
    case 'done': return `Hebat, ${name}. Tugas hari ini sudah selesai.`;
    default: return '';
  }
}

function medCard(card, rerender) {
  const slot = card.slots[0];
  const status = slotStatus(slot);
  const late = lateMinutes(slot);
  const m = slot.med;
  const take = () => {
    if (markTaken(slot)) {
      ui.justTaken = { name: m.name, at: hm(), until: Date.now() + 3 * 60e3 };
      speak(`Terima kasih. Obat ${m.name} sudah diminum ${spokenTime(hm())}.`);
      window.dispatchEvent(new CustomEvent('strokuni:changed'));
    }
    rerender();
  };
  return h('section', { class: 'now-card med', 'aria-label': 'Waktunya minum obat' },
    h('div', { class: 'stack' },
      h('div', { class: 'kicker' }, icon('medication', 'fill'), `Obat ${slot.time}`,
        h('span', { class: 'grow' }), iconBtn('volume_up', { label: 'Dengar lagi', onClick: () => speak(cardSpeech(card)) })),
      h('div', { class: 'row', style: { alignItems: 'flex-start', gap: '20px' } },
        m.photo ? h('img', { class: 'med-photo', src: m.photo, alt: '' }) : h('span', { class: 'icon fill big-icon', 'aria-hidden': 'true' }, 'medication'),
        h('div', { class: 'grow' }, h('h1', {}, m.name), m.dose ? h('div', { class: 'sub' }, m.dose) : null, m.note ? h('div', { class: 'sub', style: { fontSize: '20px' } }, m.note) : null)),
      card.slots.length > 1 ? h('div', { class: 'sub', style: { fontSize: '18px' } }, `Masih ada ${card.slots.length - 1} obat lagi setelah ini.`) : null,
      status === 'overdue' ? h('div', { class: 'taken-lock', style: { fontSize: '20px', lineHeight: '28px' } }, icon('call'),
        `Obat ini sudah lewat ${late} menit. Jangan minum dua kali. Kalau ragu, telepon keluarga atau dokter.`) : null),
    h('div', { class: 'actions' },
      btn('Sudah diminum', { kind: 'med', size: 'xl', ico: 'check', onClick: take, cls: 'block' }),
      status === 'overdue' || late >= state.settings.escalation.alertMin
        ? btn(`Telepon ${state.settings.familyName}`, { kind: 'tonal', size: 'lg', ico: 'call', onClick: callFamily, cls: 'block' }) : null));
}

function takenCard(rerender) {
  const j = ui.justTaken;
  return h('section', { class: 'now-card done' },
    h('div', { class: 'stack' }, h('div', { class: 'kicker' }, icon('lock', 'fill'), 'Terkunci sampai jadwal berikutnya'),
      h('span', { class: 'icon fill big-icon', 'aria-hidden': 'true' }, 'check_circle'),
      h('h1', {}, `Sudah diminum jam ${j.at}`), h('div', { class: 'sub' }, j.name)),
    h('div', { class: 'actions' }, btn('Lanjut', { kind: 'filled', size: 'lg', ico: 'chevron_right', cls: 'block', onClick: () => { ui.justTaken = null; rerender(); } })));
}

function taskCard(card, rerender) {
  const t = card.task; const meta = TASK_TYPES[t.type] || TASK_TYPES.custom;
  const start = () => {
    stopSpeaking();
    if (t.type === 'voice') go(`#/catatan?task=${t.id}`);
    else if (t.type === 'rest') { markTaskDone(t.id); ui.restUntil = Date.now() + 15 * 60e3; rerender(); }
    else if (t.type === 'custom') { markTaskDone(t.id); speak('Bagus. Tugas selesai.'); rerender(); }
    else go(`#/latihan/${t.type}?task=${t.id}&min=${t.minutes}`);
  };
  return h('section', { class: 'now-card task' },
    h('div', { class: 'stack' },
      h('div', { class: 'kicker' }, icon('today', 'fill'), 'Sekarang', h('span', { class: 'grow' }), iconBtn('volume_up', { label: 'Dengar lagi', onClick: () => speak(cardSpeech(card)) })),
      h('span', { class: 'icon big-icon', 'aria-hidden': 'true' }, meta.icon),
      h('h1', {}, t.label), h('div', { class: 'sub' }, `${t.minutes} menit`)),
    h('div', { class: 'actions' },
      btn(t.type === 'custom' ? 'Selesai' : 'Mulai', { kind: 'filled', size: 'xl', ico: t.type === 'custom' ? 'check' : 'play_arrow', cls: 'block', onClick: start }),
      btn('Istirahat dulu', { kind: 'text', size: 'lg', ico: 'self_improvement', cls: 'block', onClick: () => { ui.restUntil = Date.now() + 20 * 60e3; speak('Baik, istirahat dulu.'); rerender(); } })));
}

function restCard(rerender) {
  return h('section', { class: 'now-card rest' },
    h('div', { class: 'stack' }, h('div', { class: 'kicker' }, icon('self_improvement'), 'Istirahat'),
      h('span', { class: 'icon big-icon', 'aria-hidden': 'true' }, 'self_improvement'),
      h('h1', {}, 'Waktunya istirahat'), h('div', { class: 'sub' }, 'Pejamkan mata, tarik napas pelan. Kita lanjut nanti.')),
    h('div', { class: 'actions' }, btn('Saya sudah segar', { kind: 'filled', size: 'lg', ico: 'sentiment_satisfied', cls: 'block', onClick: () => { ui.restUntil = 0; logFatigue('baik'); rerender(); } })));
}

function nightCard(rerender) {
  const d = today();
  const ci = (state.checkins[d] ||= { confusing: null, tiring: null });
  const q = ci.confusing == null ? ['confusing', 'Apakah layar hari ini membingungkan?'] : ['tiring', 'Apakah latihan hari ini terlalu melelahkan?'];
  const answer = (v) => { ci[q[0]] = v; save(); speak(v ? 'Terima kasih, kami catat.' : 'Baik, terima kasih.'); rerender(); };
  setTimeout(() => speak(q[1]), 300);
  return h('section', { class: 'now-card night' },
    h('div', { class: 'stack' }, h('div', { class: 'kicker' }, icon('bedtime', 'fill'), 'Catatan malam'),
      h('h1', {}, q[1])),
    h('div', { class: 'actions' },
      h('div', { class: 'quick-row', style: { marginTop: 0 } },
        h('button', { class: 'quick call', onclick: () => answer(true) }, icon('thumb_up', 'fill'), 'Ya'),
        h('button', { class: 'quick tired', onclick: () => answer(false) }, icon('thumb_down', 'fill'), 'Tidak')),
      btn('Ceritakan hari ini', { kind: 'tonal', size: 'lg', ico: 'mic', cls: 'block', onClick: () => go('#/catatan') })));
}

function doneCard() {
  const n = nextSlot();
  return h('section', { class: 'now-card done' },
    h('div', { class: 'stack' }, h('div', { class: 'kicker' }, icon('task_alt', 'fill'), 'Selesai'),
      h('span', { class: 'icon fill big-icon', 'aria-hidden': 'true' }, 'favorite'),
      h('h1', {}, 'Hebat! Tugas hari ini selesai.'),
      h('div', { class: 'sub' }, n ? `Obat berikutnya jam ${n.time}.` : 'Tidak ada obat lagi hari ini.')),
    h('div', { class: 'actions' }, btn('Lihat hari ini', { kind: 'tonal', size: 'lg', ico: 'menu_book', cls: 'block', onClick: () => go('#/dicatat') })));
}

export function nowView() {
  const root = h('div', { class: 'lio', style: { display: 'flex', flexDirection: 'column', flex: '1' } });
  let timer;
  const render = () => {
    const now = new Date();
    if (ui.justTaken && ui.justTaken.until < Date.now()) ui.justTaken = null;
    const card = ui.justTaken ? { kind: 'taken' } : currentCard(now, { restUntil: ui.restUntil });
    const sig = card.kind + (card.task?.id || '') + (card.slots?.[0]?.key || '');
    const nxt = nextSlot(now); const last = lastTaken(now);
    const body = card.kind === 'med' ? medCard(card, render)
      : card.kind === 'taken' ? takenCard(render)
      : card.kind === 'task' ? taskCard(card, render)
      : card.kind === 'rest' ? restCard(render)
      : card.kind === 'night' ? nightCard(render)
      : doneCard();
    root.replaceChildren(
      h('header', { class: 'lio-head' },
        h('div', { class: 'grow' }, h('div', { class: 'clock' }, hm(now)), h('div', { class: 'date' }, longDate(now))),
        iconBtn('lock', { label: 'Mode Keluarga', onClick: () => go('#/keluarga') })),
      h('main', { class: 'page' },
        h('div', { class: 'status-strip' },
          h('span', { class: 'chip assist' }, icon('sentiment_satisfied'), `${greeting(now)}, ${state.settings.patientName}`),
          last ? h('span', { class: 'chip assist' }, icon('check_circle'), `Obat ${last.taken ? fmtTime(last.taken.takenAt) : ''}`) : null,
          nxt && card.kind !== 'med' ? h('span', { class: 'chip assist' }, icon('alarm'), `Berikutnya ${nxt.time}`) : null,
          state.settings.trackingPaused ? h('span', { class: 'chip assist' }, icon('pause'), 'Pencatatan dijeda') : null),
        body,
        h('div', { class: 'quick-row' },
          h('button', { class: 'quick call', onclick: callFamily }, icon('call', 'fill'), `Telepon ${state.settings.familyName}`),
          h('button', { class: 'quick tired', onclick: () => { logFatigue('lelah'); ui.restUntil = Date.now() + 30 * 60e3; speak('Baik. Istirahat dulu ya. Tidak apa-apa.'); render(); } }, icon('bedtime', 'fill'), 'Saya lelah')),
        h('div', { class: 'lio-foot' },
          btn('Catatan suara', { kind: 'text', ico: 'mic', onClick: () => go('#/catatan') }),
          btn('Yang dicatat', { kind: 'text', ico: 'visibility', onClick: () => go('#/dicatat') }))));
    if (sig !== ui.lastSpokenCard) {
      ui.lastSpokenCard = sig;
      if (card.kind !== 'night' && card.kind !== 'taken') setTimeout(() => speak(cardSpeech(card)), 400);
    }
  };
  render();
  timer = setInterval(render, 20000);
  const onChange = () => render();
  window.addEventListener('strokuni:changed', onChange);
  return { el: root, destroy() { clearInterval(timer); window.removeEventListener('strokuni:changed', onChange); } };
}

/** Make the in-app reminder speak again (called by the escalation loop). */
export function repeatReminder(slot) {
  speak(`${state.settings.patientName}, ingat minum obat ${slot.med.name}. Tekan Sudah diminum setelah minum.`);
}

// ---------- voice note ----------
export function voiceNoteView({ query }) {
  const taskId = query.get('task');
  let text = '';
  let busy = false;
  const transcript = h('div', { class: 'transcript', 'aria-live': 'polite' }, h('span', { class: 'muted' }, 'Tekan tombol mikrofon, lalu bicara.'));
  const mic = h('button', { class: 'mic-big', 'aria-label': 'Mulai bicara' }, icon('mic', 'fill'));
  const typed = h('textarea', { placeholder: 'Atau ketik di sini (boleh dibantu keluarga)', rows: 3 });
  const finish = (saved) => {
    if (taskId) markTaskDone(taskId);
    if (saved) speak('Catatan disimpan. Terima kasih.');
    go('#/');
  };
  mic.onclick = async () => {
    if (busy) { listen.stop?.(); return; }
    if (!canListen()) { snackbar('Dikte suara tidak tersedia. Silakan ketik.'); typed.focus(); return; }
    busy = true; mic.classList.add('live'); stopSpeaking();
    try {
      const t = await listen({ onPartial: (p) => { transcript.textContent = p; } });
      if (t) { text = (text ? text + ' ' : '') + t; transcript.textContent = text; }
    } catch (e) { snackbar('Mikrofon tidak bisa dipakai: ' + e.message); }
    busy = false; mic.classList.remove('live');
  };
  const paused = state.settings.trackingPaused;
  setTimeout(() => speak(paused ? 'Pencatatan sedang dijeda.' : 'Ceritakan hari ini. Tekan tombol biru, lalu bicara.'), 300);
  const el = h('div', { class: 'lio', style: { flex: '1' } },
    topBar('Catatan suara', { back: () => go('#/') }),
    h('main', { class: 'page stack lg' },
      paused ? h('div', { class: 'card tonal row' }, icon('pause'), h('div', { class: 'grow' }, 'Pencatatan sedang dijeda. Catatan tidak akan disimpan.'),
        btn('Lanjutkan', { kind: 'filled', onClick: () => { state.settings.trackingPaused = false; save(); go('#/catatan'); } })) : null,
      mic, transcript, h('label', { class: 'field' }, typed, h('label', {}, 'Tulis catatan')),
      h('div', { class: 'row wrap' },
        btn('Simpan', { kind: 'filled', size: 'lg', ico: 'check', cls: 'grow', onClick: () => {
          const all = [text, typed.value.trim()].filter(Boolean).join(' ');
          if (!all) { speak('Belum ada catatan.'); return; }
          addNote({ kind: text ? 'voice' : 'text', text: all });
          finish(true);
        } }),
        btn('Foto', { kind: 'tonal', size: 'lg', ico: 'photo_camera', onClick: async () => {
          const photo = await pickImage();
          if (photo) { addNote({ kind: 'photo', text: typed.value.trim() || text || '', photo }); snackbar('Foto disimpan di Buku Ingatan'); }
        } })),
      btn('Lewati', { kind: 'text', size: 'lg', cls: 'block', onClick: () => finish(false) })));
  return { el, destroy() { listen.stop?.(); } };
}

// ---------- what is recorded / memory book ----------
export function recordedView() {
  const d = today();
  const ds = dosesSummary(d);
  const p = state.practice[d] || { minutes: 0, sessions: [] };
  const notes = state.notes.slice().reverse();
  const byDay = {};
  for (const n of notes) (byDay[n.day] ||= []).push(n);
  const pausedRow = h('div', { class: 'card filled row' },
    icon(state.settings.trackingPaused ? 'pause' : 'visibility'),
    h('div', { class: 'grow' }, h('div', { class: 'title-m' }, 'Pencatatan'), h('div', { class: 'body-m muted' }, state.settings.trackingPaused ? 'Sedang dijeda. Hanya obat yang tetap dicatat demi keamanan.' : 'Aktif. Keluarga bisa melihat catatan ini.')),
    switchEl(!state.settings.trackingPaused, (on) => { state.settings.trackingPaused = !on; save(); speak(on ? 'Pencatatan aktif.' : 'Pencatatan dijeda.'); go('#/dicatat', { replace: true }); }, 'Pencatatan aktif'));
  setTimeout(() => speak(`Hari ini, obat diminum ${ds.taken} dari ${ds.total}. Latihan ${Math.round(p.minutes)} menit.`), 300);
  return { el: h('div', { class: 'lio', style: { flex: '1' } },
    topBar('Yang dicatat', { back: () => go('#/') }),
    h('main', { class: 'page stack' },
      h('p', { class: 'body-l muted', style: { margin: '0 4px' } }, `Ini yang dicatat Strokuni. Setiap malam catatan ini dirangkum, lalu keluarga memeriksanya.`),
      pausedRow,
      h('div', { class: 'section-title' }, 'Hari ini'),
      h('div', { class: 'surface-box' },
        ...ds.slots.map((s) => h('div', { class: 'list-item' }, h('span', { class: `lead ${s.taken ? 'ok' : 'med'}` }, icon(s.taken ? 'check' : 'medication')),
          h('span', { class: 'content' }, h('div', { class: 'headline' }, `${s.med.name} · ${s.time}`), h('div', { class: 'supporting' }, s.taken ? `Sudah diminum jam ${fmtTime(s.taken.takenAt)}` : 'Belum')))),
        h('div', { class: 'list-item' }, h('span', { class: 'lead' }, icon('gesture')), h('span', { class: 'content' }, h('div', { class: 'headline' }, `Latihan ${Math.round(p.minutes)} menit`), h('div', { class: 'supporting' }, `${p.sessions.length} sesi`)))),
      h('div', { class: 'section-title' }, 'Buku Ingatan'),
      notes.length ? Object.entries(byDay).slice(0, 14).map(([day, list]) => h('div', { class: 'stack' },
        h('div', { class: 'label-l muted', style: { margin: '8px 4px 0' } }, keyToLongDate(day)),
        h('div', { class: 'surface-box' }, list.map((n) => h('div', { class: 'list-item' },
          n.photo ? h('img', { class: 'photo-thumb', src: n.photo, alt: '' }) : h('span', { class: 'lead' }, icon(n.kind === 'voice' ? 'mic' : 'edit_note')),
          h('span', { class: 'content' }, h('div', { class: 'headline' }, n.text || 'Foto'), h('div', { class: 'supporting' }, fmtTime(n.at))),
          n.text ? iconBtn('volume_up', { label: 'Dengar', onClick: () => speak(n.text) }) : null))))) : empty('menu_book', 'Belum ada catatan. Tekan "Catatan suara" untuk mulai.'))) };
}
