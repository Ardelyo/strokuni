// Mode Keluarga: schedule, word list, settings, plan approval. PIN-locked.
import { h, icon, btn, iconBtn, topBar, navBar, field, input, select, switchEl, listItem, snackbar, dialog, confirmDialog, empty, pickImage } from '../ui.js';
import { state, save, today, uid, touchConfig, hashPin, exportData, importData, resetAll } from '../store.js';
import { fmtTime, keyToLongDate, addDays, relMinutes, minutesOf } from '../time.js';
import { slotsFor, slotStatus, undoTaken, markTaken, syncNativeAlarms, dosesSummary } from '../meds.js';
import { planFor, setPlan, TASK_TYPES, MAX_TASKS, tomorrow } from '../plan.js';
import { generateDraft, pendingDrafts, readLabel } from '../ai.js';
import { serverConfigured, ping, pushConfig, pushApprovedPlan, fetchRemote, decideRemoteDraft, configureNative, heartbeat } from '../sync.js';
import { speak } from '../speech.js';
import { Native, isNative } from '../native.js';
import { letterIds } from '../srs.js';
import { go } from '../router.js';

// ---------- lock ----------
const UNLOCK_MS = 15 * 60e3;
let unlockedUntil = 0;
export const isUnlocked = () => !state.settings.pinHash || unlockedUntil > Date.now();
export function lock() { unlockedUntil = 0; }
export function unlockOnce() { unlockedUntil = Date.now() + UNLOCK_MS; }
document.addEventListener('pointerdown', () => { if (unlockedUntil > Date.now()) unlockedUntil = Date.now() + UNLOCK_MS; }, { passive: true });

export function pinView({ query }) {
  const next = query.get('next') || '#/keluarga';
  let entered = '';
  const dots = h('div', { class: 'pin-dots' });
  const draw = () => dots.replaceChildren(...[0, 1, 2, 3].map((i) => h('i', { class: i < entered.length ? 'on' : '' })));
  draw();
  const press = async (d) => {
    if (d === 'del') entered = entered.slice(0, -1);
    else if (entered.length < 4) entered += d;
    draw();
    if (entered.length === 4) {
      if ((await hashPin(entered)) === state.settings.pinHash) { unlockedUntil = Date.now() + UNLOCK_MS; go(next, { replace: true }); }
      else { dots.classList.add('shake'); setTimeout(() => { dots.classList.remove('shake'); entered = ''; draw(); }, 400); }
    }
  };
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];
  return { el: h('div', { style: { flex: '1' } }, topBar('Mode Keluarga', { back: () => go('#/') }),
    h('main', { class: 'page center' },
      h('div', { style: { marginTop: '24px' } }, icon('lock', 'fill')),
      h('h1', { class: 'headline-s', style: { margin: '8px 0 0' } }, 'Masukkan PIN keluarga'),
      h('p', { class: 'body-m muted' }, 'Jadwal obat dan pengaturan hanya bisa diubah keluarga.'),
      state.settings.demo ? h('p', { class: 'chip assist', style: { display: 'inline-flex' } }, icon('info'), 'Mode demo: PIN 1234') : null,
      dots,
      h('div', { class: 'pin-pad' }, keys.map((k) => k === '' ? h('span') : h('button', { type: 'button', class: 'state', 'aria-label': k === 'del' ? 'Hapus' : k, onclick: () => press(k) }, k === 'del' ? icon('backspace') : k))))) };
}

// ---------- shell ----------
const TABS = [
  { key: 'beranda', label: 'Beranda', icon: 'home', href: '#/keluarga' },
  { key: 'obat', label: 'Obat', icon: 'medication', href: '#/keluarga/obat' },
  { key: 'latihan', label: 'Latihan', icon: 'gesture', href: '#/keluarga/latihan' },
  { key: 'rencana', label: 'Rencana', icon: 'today', href: '#/keluarga/rencana' },
  { key: 'lainnya', label: 'Lainnya', icon: 'settings', href: '#/keluarga/lainnya' },
];

function shell(tab, title, content, { fab, actions = [] } = {}) {
  const tabs = TABS.map((t) => t.key === 'beranda' ? { ...t, badge: pendingDrafts().length || null } : t);
  const isFamilyPhone = state.settings.role === 'family';
  return h('div', { style: { flex: '1' } },
    topBar(title, { back: isFamilyPhone ? null : () => { lock(); go('#/'); }, actions: [
      ...actions,
      isFamilyPhone ? null : iconBtn('logout', { label: 'Kembali ke Mode Lio', onClick: () => { lock(); go('#/'); } }),
    ].filter(Boolean) }),
    h('main', { class: 'page with-nav stack' }, content),
    fab || null,
    navBar(tabs, tab));
}

const afterConfigChange = async () => {
  touchConfig();
  await syncNativeAlarms();
  if (serverConfigured()) pushConfig().catch((e) => snackbar('Gagal sinkron ke server: ' + e.message));
};

// ---------- Beranda ----------
function doseTimeline(day) {
  const slots = slotsFor(day);
  if (!slots.length) return empty('medication', 'Belum ada jadwal obat. Tambahkan di tab Obat.');
  return h('div', { class: 'surface-box' }, h('div', { class: 'timeline', style: { padding: '4px 16px' } }, slots.map((s) => {
    const st = slotStatus(s);
    const look = { taken: ['ok', 'check'], upcoming: ['', 'schedule'], due: ['med', 'alarm'], overdue: ['err', 'warning'] }[st];
    const sub = s.taken ? `Dikonfirmasi ${fmtTime(s.taken.takenAt)}${s.taken.by === 'keluarga' ? ' (oleh keluarga)' : ''}` : st === 'upcoming' ? 'Belum waktunya' : st === 'due' ? 'Menunggu konfirmasi' : 'Terlambat, belum dikonfirmasi';
    return h('div', { class: 'tl-item' }, h('div', { class: 'tl-time' }, s.time),
      h('div', { class: 'tl-dot list-item', style: { padding: 0, minHeight: 0 } }, h('span', { class: `lead ${look[0]}` }, icon(look[1]))),
      h('div', { class: 'grow', style: { paddingTop: '2px' } }, h('div', { class: 'title-m' }, `${s.med.name}${s.med.dose ? ' · ' + s.med.dose : ''}`), h('div', { class: 'body-m muted' }, sub)),
      s.taken ? iconBtn('more_horiz', { label: 'Opsi', onClick: async () => {
        if (await confirmDialog('Batalkan konfirmasi?', `Hanya bila ${state.settings.patientName} menekan tombol tidak sengaja. Pastikan dulu obat benar-benar belum diminum.`, 'Batalkan konfirmasi', 'warning')) { undoTaken(s); go('#/keluarga', { replace: true }); }
      } }) : st !== 'upcoming' ? btn('Sudah', { kind: 'text', onClick: async () => {
        if (await confirmDialog('Tandai sudah diminum?', `Gunakan bila keluarga melihat sendiri ${state.settings.patientName} sudah minum ${s.med.name}.`, 'Tandai')) { markTaken(s, 'keluarga'); go('#/keluarga', { replace: true }); }
      } }) : null);
  })));
}

function draftCard(d) {
  const sum = JSON.parse(JSON.stringify(d.summary));
  const tasksBox = h('div', { class: 'stack', style: { gap: '6px' } });
  const drawTasks = () => {
    tasksBox.replaceChildren(...sum.rencana.map((t, i) => h('div', { class: 'task-edit' },
      icon(TASK_TYPES[t.type]?.icon || 'task_alt'),
      h('div', { class: 'grow' }, h('div', {}, t.label), t.reason ? h('div', { class: 'body-s muted' }, t.reason) : null),
      iconBtn('timer', { label: 'Ubah menit', onClick: () => { t.minutes = t.minutes >= 15 ? 3 : t.minutes + 2; drawTasks(); } }),
      h('span', { class: 'label-l' }, `${t.minutes}m`),
      iconBtn('close', { label: 'Hapus tugas', onClick: () => { sum.rencana.splice(i, 1); drawTasks(); } }))),
    sum.rencana.length < MAX_TASKS ? btn('Tambah tugas', { kind: 'text', ico: 'add', onClick: async () => {
      const t = await chooseTask(); if (t) { sum.rencana.push(t); drawTasks(); }
    } }) : null);
  };
  drawTasks();
  const sec = (ico, title, body) => h('div', { class: 'draft-section' }, h('h3', {}, icon(ico), title), body);
  return h('article', { class: 'card elevated', style: { padding: 0, overflow: 'hidden' } },
    h('div', { class: 'row', style: { padding: '16px 16px 4px' } },
      h('span', { class: 'list-item', style: { padding: 0, minHeight: 0, width: 'auto' } }, h('span', { class: 'lead' }, icon(d.source === 'ai' ? 'auto_awesome' : 'edit_note'))),
      h('div', { class: 'grow' }, h('div', { class: 'title-m' }, `Catatan malam · ${keyToLongDate(d.date)}`),
        h('div', { class: 'body-s muted' }, d.source === 'ai' ? 'Disusun AI dari log hari ini. Periksa sebelum disetujui.' : 'Ringkasan otomatis tanpa AI (fakta dari log).'))),
    d.error ? h('div', { class: 'draft-section body-s muted' }, `AI tidak tersedia (${d.error}). Ringkasan standar dipakai.`) : null,
    sec('notes', 'Catatan hari ini', h('p', { class: 'body-m' }, sum.catatan)),
    sum.pola?.length ? sec('list', 'Pola yang terlihat (fakta & angka)', h('ul', { class: 'body-m' }, sum.pola.map((p) => h('li', {}, p)))) : null,
    sec('today', `Rencana besok (${keyToLongDate(d.forDate || addDays(d.date, 1))})`, tasksBox),
    sum.pertanyaan?.length ? sec('help', 'Pertanyaan untuk keluarga', h('ul', { class: 'body-m' }, sum.pertanyaan.map((p) => h('li', {}, p)))) : null,
    h('div', { class: 'row', style: { justifyContent: 'flex-end', padding: '8px 12px 16px' } },
      btn('Tolak', { kind: 'text', onClick: async () => {
        d.status = 'rejected'; save();
        if (d.remote || d.source === 'ai') decideRemoteDraft(d.id, 'rejected').catch(() => {});
        snackbar('Draf ditolak. Rencana standar tetap dipakai.'); go('#/keluarga', { replace: true });
      } }),
      btn('Setujui rencana', { kind: 'filled', ico: 'check', onClick: async () => {
        const day = d.forDate || addDays(d.date, 1);
        setPlan(day, sum.rencana, d.source === 'ai' ? 'ai' : 'family');
        d.status = 'approved'; d.summary = sum; d.approvedAt = new Date().toISOString(); save();
        try { await pushApprovedPlan(day, sum.rencana); if (d.remote || d.source === 'ai') await decideRemoteDraft(d.id, 'approved', sum); } catch (e) { snackbar('Disetujui di HP ini. Sinkron server gagal: ' + e.message); }
        snackbar('Rencana besok disetujui'); go('#/keluarga', { replace: true });
      } })));
}

function chooseTask() {
  let type = 'trace'; let minutes = state.settings.sessionMinutes; const label = input({ placeholder: 'Contoh: Jalan pagi 10 menit' });
  const sel = select(Object.entries(TASK_TYPES).map(([k, v]) => [k, v.label]), type, { onchange: (e) => { type = e.target.value; } });
  const min = input({ type: 'number', min: 1, max: 15, value: minutes });
  return dialog({ title: 'Tambah tugas', ico: 'add_task', content: h('div', { class: 'stack' }, field('Jenis', sel), field('Nama tugas (opsional)', label), field('Menit', min, 'Sesi 1–15 menit')),
    actions: [{ label: 'Batal', value: null }, { label: 'Tambah', kind: 'filled', value: () => ({ type, label: label.value.trim() || TASK_TYPES[type].label, minutes: Math.max(1, Math.min(15, Number(min.value) || 5)) }) }] });
}

export function berandaView() {
  const d = today();
  const remote = state.settings.role === 'family' ? state.remote : null;
  const snap = remote?.snapshot;
  const ds = dosesSummary(d);
  const minutes = snap ? snap.practiceMinutes : Math.round(state.practice[d]?.minutes || 0);
  const notesCount = snap ? snap.notes.length : state.notes.filter((n) => n.day === d).length;
  const dosesText = snap ? `${snap.doses.filter((x) => x.takenAt).length}/${snap.doses.length}` : `${ds.taken}/${ds.total}`;
  const alerts = [...(remote?.alerts || []), ...state.alerts.filter((a) => Date.now() - new Date(a.at) < 864e5)].slice(-5).reverse();
  const drafts = pendingDrafts();
  const content = [
    h('div', { class: 'fam-hero' },
      h('div', { class: 'stat' }, h('div', { class: 'k' }, icon('medication'), 'OBAT'), h('div', { class: 'v' }, dosesText)),
      h('div', { class: 'stat' }, h('div', { class: 'k' }, icon('gesture'), 'LATIHAN'), h('div', { class: 'v' }, `${minutes}m`)),
      h('div', { class: 'stat' }, h('div', { class: 'k' }, icon('edit_note'), 'CATATAN'), h('div', { class: 'v' }, notesCount)),
      serverConfigured() ? h('div', { class: 'stat' }, h('div', { class: 'k' }, icon(remote?.stale ? 'cloud_off' : 'cloud'), 'HP LIO'),
        h('div', { class: 'v', style: { fontSize: '18px', lineHeight: '40px' } }, remote?.lastHeartbeat ? relMinutes(Date.now() - new Date(remote.lastHeartbeat)) : state.settings.role === 'lio' ? 'HP ini' : '—')) : null),
    alerts.length ? h('div', { class: 'card error stack' }, h('div', { class: 'row title-m' }, icon('warning', 'fill'), 'Peringatan 24 jam terakhir'),
      alerts.map((a) => h('div', { class: 'body-m' }, `${fmtTime(a.at)} · ${a.message}`))) : null,
    h('div', { class: 'section-title' }, 'Catatan malam & persetujuan'),
    drafts.length ? drafts.map(draftCard) : h('div', { class: 'card outlined row' }, icon('auto_awesome'),
      h('div', { class: 'grow body-m' }, `Belum ada draf. Catatan malam dibuat otomatis sekitar jam ${state.settings.summaryTime}.`)),
    state.settings.role === 'lio' ? btn('Buat catatan malam sekarang', { kind: 'tonal', ico: 'auto_awesome', onClick: async (e) => {
      e.currentTarget.disabled = true; snackbar('Menyusun catatan…');
      const draft = await generateDraft();
      snackbar(draft.source === 'ai' ? 'Draf AI siap diperiksa' : 'Ringkasan standar dibuat'); go('#/keluarga', { replace: true });
    } }) : null,
    h('div', { class: 'section-title' }, snap ? `Obat hari ini (dari HP ${state.settings.patientName})` : 'Obat hari ini'),
    snap ? h('div', { class: 'surface-box' }, snap.doses.length ? snap.doses.map((x) => listItem({ lead: x.takenAt ? 'check' : 'schedule', leadCls: x.takenAt ? 'ok' : 'med', headline: `${x.time} · ${x.name}`, supporting: x.takenAt ? `Dikonfirmasi ${fmtTime(x.takenAt)}` : 'Belum dikonfirmasi' })) : empty('medication', 'Belum ada jadwal')) : doseTimeline(d),
    h('div', { class: 'section-title' }, 'Rencana hari ini'),
    h('div', { class: 'surface-box' }, (snap ? snap.plan : planFor(d).tasks).map((t) => listItem({ lead: t.done ? 'check' : 'radio_button_unchecked', leadCls: t.done ? 'ok' : '', headline: t.label, supporting: t.done ? 'Selesai' : 'Belum' }))),
    h('div', { class: 'section-title' }, 'Catatan hari ini'),
    (() => {
      const notes = snap ? snap.notes : state.notes.filter((n) => n.day === d);
      return notes.length ? h('div', { class: 'surface-box' }, notes.map((n) => listItem({ lead: n.photo ? h('img', { class: 'photo-thumb', src: n.photo, alt: '', style: { width: '40px', height: '40px', borderRadius: '50%' } }) : 'edit_note', headline: n.text || 'Foto', supporting: fmtTime(n.at) })))
        : empty('edit_note', state.settings.trackingPaused ? 'Pencatatan sedang dijeda oleh Lio.' : 'Belum ada catatan hari ini.');
    })(),
  ];
  const el = shell('beranda', 'Beranda Keluarga', content, { actions: serverConfigured() ? [iconBtn('refresh', { label: 'Muat ulang', onClick: async () => { try { await fetchRemote(); go('#/keluarga', { replace: true }); } catch (e) { snackbar(e.message); } } })] : [] });
  return { el };
}

// ---------- Obat ----------
function medForm(existing) {
  const m = existing ? JSON.parse(JSON.stringify(existing)) : { id: uid('m'), name: '', dose: '', note: '', times: ['08:00'], active: true };
  let fromAI = false;
  const name = input({ value: m.name, placeholder: 'Nama obat sesuai resep' });
  const dose = input({ value: m.dose, placeholder: 'Contoh: 1 tablet 5 mg' });
  const note = input({ value: m.note || '', placeholder: 'Contoh: sesudah makan' });
  const times = h('div', { class: 'chips' });
  const newTime = input({ type: 'time', value: '12:00', style: { minHeight: '40px', padding: '6px 12px', width: 'auto' } });
  const preview = h('div');
  const verify = h('input', { type: 'checkbox', id: 'verify' });
  const verifyRow = h('label', { class: 'row card med', for: 'verify', style: { padding: '12px', cursor: 'pointer' } }, verify, h('span', { class: 'body-m' }, 'Saya sudah mencocokkan nama, dosis, dan jam dengan resep dokter.'));
  const drawTimes = () => times.replaceChildren(...m.times.sort().map((t) => h('span', { class: 'chip selected' }, icon('alarm'), t, h('button', { type: 'button', class: 'icon-btn', style: { width: '24px', height: '24px', marginRight: '-10px' }, 'aria-label': `Hapus ${t}`, onclick: () => { m.times = m.times.filter((x) => x !== t); drawTimes(); } }, icon('close')))));
  const drawPhoto = () => preview.replaceChildren(m.photo ? h('img', { src: m.photo, alt: 'Foto obat', style: { width: '100%', maxHeight: '160px', objectFit: 'cover', borderRadius: '12px' } }) : '');
  drawTimes(); drawPhoto();
  const aiStatus = h('div', { class: 'body-s muted' });
  const content = h('div', { class: 'stack' },
    h('div', { class: 'row wrap' },
      btn('Foto obat/label', { kind: 'tonal', ico: 'photo_camera', onClick: async () => {
        const photo = await pickImage(); if (!photo) return;
        m.photo = photo; drawPhoto();
        if (!serverConfigured()) { aiStatus.textContent = 'Foto disimpan. Atur server di Lainnya agar AI bisa membaca label.'; return; }
        aiStatus.textContent = 'AI membaca label…';
        try {
          const l = await readLabel(photo);
          if (l.name) name.value = l.name;
          if (l.dose) dose.value = l.dose;
          if (l.instructions) note.value = l.instructions;
          if (l.times?.length) { m.times = [...new Set(l.times)]; drawTimes(); }
          fromAI = true;
          aiStatus.textContent = `Draf dari AI${l.uncertain ? ' (beberapa bagian tidak jelas: ' + l.uncertain + ')' : ''}. Wajib dicocokkan dengan resep.`;
        } catch (e) { aiStatus.textContent = 'AI gagal membaca: ' + e.message; }
      } })),
    aiStatus, preview,
    field('Nama obat', name), field('Dosis', dose), field('Aturan pakai', note),
    h('div', { class: 'label-l muted' }, 'Jam minum'),
    times,
    h('div', { class: 'row' }, newTime, btn('Tambah jam', { kind: 'outlined', ico: 'add', onClick: () => { if (newTime.value && !m.times.includes(newTime.value)) { m.times.push(newTime.value); drawTimes(); } } })),
    verifyRow,
    h('p', { class: 'body-s muted', style: { margin: 0 } }, 'Strokuni tidak pernah menentukan atau mengubah dosis. Isi hanya dari resep dokter.'));
  return dialog({ title: existing ? 'Ubah obat' : 'Tambah obat', ico: 'medication', content, actions: [
    { label: 'Batal', value: null },
    { label: 'Simpan', kind: 'filled', validate: () => {
      if (!name.value.trim()) { snackbar('Nama obat wajib diisi'); return false; }
      if (!m.times.length) { snackbar('Tambahkan minimal satu jam'); return false; }
      if (!verify.checked) { snackbar(fromAI ? 'Draf AI wajib dicocokkan dengan resep' : 'Centang konfirmasi resep dulu'); return false; }
      return true;
    }, value: () => ({ ...m, name: name.value.trim(), dose: dose.value.trim(), note: note.value.trim() }) },
  ] });
}

export function obatView() {
  const list = state.meds;
  const content = [
    h('p', { class: 'body-m muted', style: { margin: '0 4px' } }, 'Satu sumber kebenaran: isi jadwal dari resep dokter. Setelah Lio menekan "Sudah diminum", tombol terkunci sampai jadwal berikutnya.'),
    list.length ? h('div', { class: 'stack' }, list.map((m) => h('article', { class: 'card filled stack', style: { opacity: m.active === false ? .6 : 1 } },
      h('div', { class: 'row' },
        m.photo ? h('img', { class: 'photo-thumb', src: m.photo, alt: '' }) : h('span', { class: 'list-item', style: { padding: 0, width: 'auto', minHeight: 0 } }, h('span', { class: 'lead med' }, icon('medication'))),
        h('div', { class: 'grow' }, h('div', { class: 'title-m' }, m.name), h('div', { class: 'body-m muted' }, [m.dose, m.note].filter(Boolean).join(' · ') || '—')),
        switchEl(m.active !== false, async (on) => { m.active = on; save(); await afterConfigChange(); }, 'Aktif')),
      h('div', { class: 'chips' }, m.times.map((t) => h('span', { class: 'chip assist' }, icon('alarm'), t))),
      h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
        btn('Hapus', { kind: 'text', ico: 'delete', onClick: async () => {
          if (!(await confirmDialog('Hapus obat?', `${m.name} dan semua alarmnya akan dihapus.`, 'Hapus', 'delete'))) return;
          state.meds = state.meds.filter((x) => x.id !== m.id); save(); await afterConfigChange(); go('#/keluarga/obat', { replace: true });
        } }),
        btn('Ubah', { kind: 'tonal', ico: 'edit', onClick: async () => {
          const r = await medForm(m); if (!r) return;
          Object.assign(m, r); save(); await afterConfigChange(); go('#/keluarga/obat', { replace: true });
        } }))))) : empty('medication', 'Belum ada obat. Tekan "Tambah obat".'),
    h('div', { class: 'card outlined stack' },
      h('div', { class: 'row title-m' }, icon('shield'), 'Pengaman'),
      h('ul', { class: 'body-m', style: { margin: 0, paddingLeft: '20px' } },
        h('li', {}, `Pengingat ulang setiap ${state.settings.escalation.repeatMin} menit.`),
        h('li', {}, `Belum dikonfirmasi ${state.settings.escalation.alertMin} menit: HP keluarga diberi peringatan (butuh server).`),
        h('li', {}, `Setelah ${state.settings.escalation.callMin} menit: layar Lio menampilkan tombol besar Telepon.`),
        h('li', {}, 'Dosis terlewat: aplikasi tidak pernah menyarankan menggandakan dosis.'),
        h('li', {}, 'Selama masa uji, tetap pasang alarm bawaan HP pada jam obat sebagai cadangan.'))),
  ];
  const fab = h('button', { class: 'fab state', onclick: async () => {
    const r = await medForm(null); if (!r) return;
    state.meds.push(r); save(); await afterConfigChange(); snackbar('Obat disimpan, alarm dipasang'); go('#/keluarga/obat', { replace: true });
  } }, icon('add'), 'Tambah obat');
  return { el: shell('obat', 'Jadwal Obat', content, { fab }) };
}

// ---------- Latihan ----------
export function latihanView() {
  const s = state.settings;
  const seg = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Lama sesi' }, [5, 10, 15].map((n) => h('button', { type: 'button', 'aria-pressed': String(s.sessionMinutes === n), onclick: async () => {
    s.sessionMinutes = n;
    for (const t of state.defaultPlan) if (['trace', 'keys', 'word'].includes(t.type)) t.minutes = n;
    save(); await afterConfigChange(); go('#/keluarga/latihan', { replace: true });
  } }, s.sessionMinutes === n ? icon('check') : null, `${n} menit`)));
  const days = [...Array(7)].map((_, i) => addDays(today(), -6 + i));
  const maxMin = Math.max(15, ...days.map((d) => state.practice[d]?.minutes || 0));
  const content = [
    h('div', { class: 'section-title' }, 'Lama satu sesi'),
    seg,
    h('p', { class: 'body-s muted', style: { margin: '0 4px' } }, 'Sebaiknya ditentukan bersama terapis. Setelah sesi selesai, layar istirahat muncul.'),
    h('div', { class: 'section-title' }, 'Menit latihan 7 hari terakhir'),
    h('div', { class: 'surface-box', style: { padding: '8px 16px' } }, days.map((d) => {
      const m = Math.round(state.practice[d]?.minutes || 0);
      return h('div', { class: 'row', style: { padding: '6px 0' } }, h('span', { class: 'label-l', style: { width: '96px' } }, keyToLongDate(d).split(',')[0]),
        h('div', { class: 'progress grow', style: { height: '12px', borderRadius: '6px' } }, h('i', { style: { width: `${(m / maxMin) * 100}%` } })),
        h('span', { class: 'label-l', style: { width: '44px', textAlign: 'right' } }, `${m}m`));
    })),
    h('div', { class: 'section-title' }, 'Penguasaan huruf (makin gelap makin lancar)'),
    h('div', { class: 'surface-box', style: { padding: '16px' } }, h('div', { class: 'letter-grid' }, letterIds().map((id) => {
      const it = state.srs[id]; const kid = 'key:' + id.split(':')[1]; const k = state.srs[kid];
      const box = Math.max(it?.box || 0, 0); const b2 = k?.box || 0;
      return h('div', { class: 'letter-cell', 'data-box': Math.round((box + b2) / 2), title: `Telusur ${box}, keyboard ${b2}` }, id.split(':')[1]);
    }))),
    h('div', { class: 'section-title' }, 'Daftar kata dari keluarga'),
    h('p', { class: 'body-s muted', style: { margin: '0 4px' } }, 'Pakai kata yang dekat dengan Lio: nama keluarga, obat, benda di rumah.'),
    h('div', { class: 'surface-box' }, state.words.length ? state.words.map((w) => listItem({ lead: h('span', { style: { fontSize: '22px' } }, w.hint || '📝'), headline: w.word, supporting: w.note || null,
      trail: iconBtn('delete', { label: `Hapus ${w.word}`, onClick: async () => { state.words = state.words.filter((x) => x.id !== w.id); save(); await afterConfigChange(); go('#/keluarga/latihan', { replace: true }); } }) })) : empty('spellcheck', 'Belum ada kata')),
  ];
  const fab = h('button', { class: 'fab state', onclick: async () => {
    const word = input({ placeholder: 'Contoh: SINTA', autocapitalize: 'characters' });
    const hint = input({ placeholder: 'Emoji, contoh: 👧', maxlength: 4 });
    const note = input({ placeholder: 'Contoh: cucu' });
    const r = await dialog({ title: 'Tambah kata', ico: 'spellcheck', content: h('div', { class: 'stack' }, field('Kata', word, 'Huruf saja, 2–10 huruf'), field('Gambar (emoji)', hint), field('Keterangan', note)),
      actions: [{ label: 'Batal', value: null }, { label: 'Tambah', kind: 'filled', validate: () => /^[A-Za-z ]{2,12}$/.test(word.value.trim()) || (snackbar('Gunakan 2–12 huruf'), false), value: () => ({ id: uid('w'), word: word.value.trim().toUpperCase(), hint: hint.value.trim(), note: note.value.trim() }) }] });
    if (!r) return;
    state.words.push(r); save(); await afterConfigChange(); go('#/keluarga/latihan', { replace: true });
  } }, icon('add'), 'Tambah kata');
  return { el: shell('latihan', 'Latihan', content, { fab }) };
}

// ---------- Rencana ----------
function taskListEditor(tasks, onChange) {
  const box = h('div', { class: 'stack', style: { gap: '6px' } });
  const draw = () => {
    box.replaceChildren(...tasks.map((t, i) => h('div', { class: 'task-edit' },
      icon(TASK_TYPES[t.type]?.icon || 'task_alt'),
      h('div', { class: 'grow' }, t.label, t.done ? h('span', { class: 'body-s muted' }, ' · selesai') : null),
      iconBtn('timer', { label: 'Ubah menit', onClick: () => { t.minutes = t.minutes >= 15 ? 2 : t.minutes + 1; onChange(); draw(); } }),
      h('span', { class: 'label-l' }, `${t.minutes}m`),
      iconBtn('close', { label: 'Hapus', onClick: () => { tasks.splice(i, 1); onChange(); draw(); } }))),
    tasks.length < MAX_TASKS ? btn('Tambah tugas', { kind: 'text', ico: 'add', onClick: async () => { const t = await chooseTask(); if (t) { tasks.push(t); onChange(); draw(); } } }) : h('div', { class: 'body-s muted' }, `Maksimal ${MAX_TASKS} tugas sehari.`));
  };
  draw();
  return box;
}

export function rencanaView() {
  const tm = tomorrow();
  const tPlan = state.plans[tm];
  const tomorrowTasks = (tPlan?.tasks || state.defaultPlan).map((t) => ({ ...t }));
  const todayPlan = planFor(today());
  const content = [
    h('div', { class: 'section-title' }, `Hari ini · ${keyToLongDate(today())}`),
    h('div', { class: 'body-s muted', style: { margin: '0 4px' } }, `Sumber: ${({ default: 'rencana standar', ai: 'usulan AI yang disetujui', family: 'keluarga' })[todayPlan.source] || todayPlan.source}`),
    taskListEditor(todayPlan.tasks, () => save()),
    h('div', { class: 'section-title' }, `Besok · ${keyToLongDate(tm)}`),
    h('div', { class: 'body-s muted', style: { margin: '0 4px' } }, tPlan ? 'Sudah disetujui.' : 'Belum ada rencana yang disetujui. Bila kosong, rencana standar dipakai.'),
    taskListEditor(tomorrowTasks, () => {}),
    btn('Simpan rencana besok', { kind: 'filled', ico: 'check', onClick: async () => {
      setPlan(tm, tomorrowTasks, 'family');
      try { await pushApprovedPlan(tm, tomorrowTasks); } catch (e) { snackbar('Tersimpan di HP ini. Server: ' + e.message); }
      snackbar('Rencana besok disimpan');
    } }),
    h('div', { class: 'section-title' }, 'Rencana standar (dipakai bila tidak ada rencana lain / tanpa internet)'),
    taskListEditor(state.defaultPlan, () => afterConfigChange()),
  ];
  return { el: shell('rencana', 'Rencana', content) };
}

// ---------- Lainnya ----------
export function lainnyaView() {
  const s = state.settings;
  const bind = (key, el, after) => { el.addEventListener('change', async () => { s[key] = el.type === 'number' ? Number(el.value) : el.value.trim(); save(); await after?.(); }); return el; };
  const syncAfter = async () => { await configureNative(); await afterConfigChange(); };
  const serverStatus = h('span', { class: 'body-s muted' }, serverConfigured() ? 'Belum dites' : 'Belum diatur');
  const esc = s.escalation;
  const escInput = (k, label) => { const el = input({ type: 'number', min: 1, max: 240, value: esc[k] }); el.onchange = async () => { esc[k] = Math.max(1, Number(el.value) || esc[k]); save(); await afterConfigChange(); }; return field(label, el); };
  const theme = h('div', { class: 'segmented' }, [['auto', 'Otomatis'], ['light', 'Terang'], ['dark', 'Gelap']].map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(s.theme === v), onclick: () => { s.theme = v; save(); applyTheme(); go('#/keluarga/lainnya', { replace: true }); } }, l)));
  const role = h('div', { class: 'segmented' }, [['lio', 'HP Lio'], ['family', 'HP Keluarga']].map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(s.role === v), onclick: async () => { s.role = v; save(); await configureNative(); go('#/keluarga/lainnya', { replace: true }); } }, l)));
  const content = [
    h('div', { class: 'section-title' }, 'Profil'),
    h('div', { class: 'card filled stack', style: { '--bg-field': 'var(--md-surface-container-highest)' } },
      field('Nama pasien', bind('patientName', input({ value: s.patientName }), syncAfter)),
      field('Panggilan keluarga (untuk tombol Telepon)', bind('familyName', input({ value: s.familyName }), configureNative)),
      field('Nomor telepon keluarga', bind('familyPhone', input({ type: 'tel', value: s.familyPhone, placeholder: '08xxxxxxxxxx' }), syncAfter))),
    h('div', { class: 'section-title' }, 'HP ini'),
    role,
    h('p', { class: 'body-s muted', style: { margin: '0 4px' } }, 'HP Lio: menampilkan Mode Lio dan alarm obat. HP Keluarga: langsung membuka Mode Keluarga, menerima peringatan, dan menyetujui rencana.'),
    h('div', { class: 'section-title' }, 'Server perantara AI & sinkron'),
    h('div', { class: 'card filled stack', style: { '--bg-field': 'var(--md-surface-container-highest)' } },
      field('Alamat server', bind('serverUrl', input({ type: 'url', value: s.serverUrl, placeholder: 'https://strokuni-server.contoh.com' }), configureNative)),
      field('Kode keluarga', bind('familyCode', input({ value: s.familyCode, placeholder: 'Sama di semua HP keluarga' }), configureNative), 'Kunci API AI hanya disimpan di server, tidak di HP.'),
      h('div', { class: 'row wrap' }, btn('Tes koneksi', { kind: 'tonal', ico: 'cloud', onClick: async () => {
        serverStatus.textContent = 'Menghubungi…';
        try { const r = await ping(); serverStatus.textContent = `Tersambung · AI ${r.ai ? 'aktif (' + r.model + ')' : 'belum diatur'} · sisa ${r.remainingToday} panggilan hari ini`; heartbeat(); }
        catch (e) { serverStatus.textContent = 'Gagal: ' + e.message; }
      } }), serverStatus)),
    h('div', { class: 'section-title' }, 'Jam & pengingat'),
    h('div', { class: 'card filled stack', style: { '--bg-field': 'var(--md-surface-container-highest)' } },
      field('Jam catatan malam', bind('summaryTime', input({ type: 'time', value: s.summaryTime }), afterConfigChange)),
      escInput('repeatMin', 'Ulangi pengingat setiap (menit)'),
      escInput('alertMin', 'Peringatan ke keluarga setelah (menit)'),
      escInput('callMin', 'Tampilkan tombol Telepon setelah (menit)')),
    h('div', { class: 'section-title' }, 'Suara & tampilan'),
    h('div', { class: 'card filled stack', style: { '--bg-field': 'var(--md-surface-container-highest)' } },
      field('Kecepatan suara', bind('speechRate', select([[0.7, 'Pelan sekali'], [0.85, 'Pelan'], [0.9, 'Sedang'], [1, 'Normal']], s.speechRate)), null),
      btn('Tes suara', { kind: 'tonal', ico: 'volume_up', onClick: () => speak(`Halo ${s.patientName}. Ini suara Strokuni.`) }),
      h('div', { class: 'label-l muted' }, 'Tema'), theme),
    h('div', { class: 'section-title' }, 'Android'),
    h('div', { class: 'surface-box' },
      listItem({ lead: 'shield', headline: 'Panduan izin', supporting: isNative ? 'Alarm, layar penuh, baterai, mikrofon, kamera' : 'Hanya untuk aplikasi Android (APK)', trail: 'chevron_right', href: '#/keluarga/izin' })),
    h('div', { class: 'section-title' }, 'PIN & data'),
    h('div', { class: 'surface-box' },
      listItem({ lead: 'lock', headline: 'Ganti PIN keluarga', trail: 'chevron_right', onClick: async () => { const pin = await askNewPin(); if (pin) { s.pinHash = await hashPin(pin); save(); snackbar('PIN diganti'); } } }),
      listItem({ lead: 'download', headline: 'Simpan cadangan data', supporting: 'File JSON', onClick: () => {
        const a = h('a', { href: URL.createObjectURL(new Blob([exportData()], { type: 'application/json' })), download: `strokuni-${today()}.json` }); document.body.append(a); a.click(); a.remove();
      } }),
      listItem({ lead: 'upload', headline: 'Pulihkan dari cadangan', onClick: () => {
        const f = h('input', { type: 'file', accept: 'application/json', style: { display: 'none' } });
        f.onchange = async () => { try { importData(await f.files[0].text()); snackbar('Data dipulihkan'); location.reload(); } catch (e) { snackbar(e.message); } };
        document.body.append(f); f.click();
      } }),
      listItem({ lead: 'delete', leadCls: 'err', headline: 'Hapus semua data di HP ini', onClick: async () => {
        if (await confirmDialog('Hapus semua data?', 'Jadwal obat, catatan, dan pengaturan di HP ini akan dihapus. Tidak bisa dibatalkan.', 'Hapus semua', 'warning')) { resetAll(); location.hash = '#/'; location.reload(); }
      } })),
    h('p', { class: 'body-s muted center' }, 'Strokuni v0.1 · uji keluarga. Bukan alat medis. Keputusan klinis tetap pada dokter dan terapis.'),
  ];
  return { el: shell('lainnya', 'Lainnya', content) };
}

export function askNewPin() {
  const a = input({ type: 'password', inputmode: 'numeric', maxlength: 4, pattern: '\\d{4}', placeholder: '4 angka' });
  const b = input({ type: 'password', inputmode: 'numeric', maxlength: 4, placeholder: 'Ulangi' });
  return dialog({ title: 'PIN keluarga', ico: 'lock', content: h('div', { class: 'stack' }, field('PIN baru', a), field('Ulangi PIN', b)), actions: [
    { label: 'Batal', value: null },
    { label: 'Simpan', kind: 'filled', validate: () => {
      if (!/^\d{4}$/.test(a.value)) { snackbar('PIN harus 4 angka'); return false; }
      if (a.value !== b.value) { snackbar('PIN tidak sama'); return false; }
      return true;
    }, value: () => a.value },
  ] });
}

export function applyTheme() {
  const t = state.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

// ---------- Panduan izin ----------
export function izinView() {
  const list = h('div', { class: 'surface-box' });
  const refresh = async () => {
    if (!isNative) {
      list.replaceChildren(h('div', { class: 'draft-section stack' },
        h('div', { class: 'title-m' }, 'Versi web'),
        h('p', { class: 'body-m' }, 'Di browser, pengingat hanya berbunyi saat Strokuni sedang terbuka. Untuk alarm layar penuh yang menyala sendiri di atas kunci layar, pasang APK Android.'),
        btn('Izinkan notifikasi browser', { kind: 'tonal', ico: 'notifications', onClick: async () => { const r = await Notification?.requestPermission?.(); snackbar('Notifikasi: ' + r); } })));
      return;
    }
    const st = (await Native.status()) || {};
    const perms = (await Native.checkPerms()) || {};
    const steps = [
      ['notifications', 'Notifikasi dan suara', 'Cadangan bila layar penuh gagal', st.notifications, () => Native.requestPerms(['notifications'])],
      ['alarm', 'Alarm & pengingat', 'Jadwal obat tepat jam (setAlarmClock)', st.exactAlarm, () => Native.openSetting('exactAlarm')],
      ['phone_android', 'Layar penuh di atas kunci layar', 'Layar obat menyala sendiri', st.fullScreen, () => Native.openSetting('fullScreen')],
      ['battery_alert', 'Abaikan optimasi baterai', 'Agar pengingat tidak dimatikan sistem', st.batteryIgnored, () => Native.openSetting('battery')],
      ['tune', 'Mulai otomatis (menu merek HP)', 'Xiaomi/Oppo/Vivo/Samsung punya menu sendiri. Cari "Mulai otomatis" atau "Autostart".', null, () => Native.openSetting('appDetails')],
      ['mic', 'Mikrofon', 'Catatan suara', perms.microphone === 'granted', () => Native.requestPerms(['microphone'])],
      ['photo_camera', 'Kamera', 'Foto label obat dan kejadian', perms.camera === 'granted', () => Native.requestPerms(['camera'])],
      ['call', 'Telepon', 'Tombol besar Telepon keluarga', perms.phone === 'granted', () => Native.requestPerms(['phone'])],
      ['open_in_new', 'Tampil di atas aplikasi lain (opsional)', 'Cadangan layar penuh saat HP sedang dipakai', st.overlay, () => Native.openSetting('overlay')],
    ];
    list.replaceChildren(...steps.map(([ico, title, sub, ok, act]) => h('div', { class: 'perm-step' },
      h('span', { class: `state-ico ${ok ? 'ok' : 'todo'}` }, icon(ok ? 'check' : ico)),
      h('div', { class: 'grow' }, h('div', { class: 'title-m' }, title), h('div', { class: 'body-s muted' }, sub)),
      ok ? h('span', { class: 'label-l', style: { color: 'var(--md-ok)' } }, 'Aktif') : btn('Buka', { kind: 'tonal', onClick: async () => { await act(); setTimeout(refresh, 800); } }))));
  };
  refresh();
  const onVis = () => { if (!document.hidden) refresh(); };
  document.addEventListener('visibilitychange', onVis);
  return { el: h('div', { style: { flex: '1' } }, topBar('Panduan izin', { back: () => go('#/keluarga/lainnya') }),
    h('main', { class: 'page stack' },
      h('p', { class: 'body-m muted', style: { margin: '0 4px' } }, 'Dikerjakan keluarga sekali, sekitar 15 menit. Setiap izin perlu diaktifkan manual di Pengaturan HP.'),
      list,
      isNative ? btn('Tes alarm (10 detik lagi)', { kind: 'filled', ico: 'alarm', onClick: async () => { await Native.testAlarm(10); snackbar('Kunci layar sekarang. Alarm tes akan muncul dalam 10 detik.'); } }) : null,
      h('div', { class: 'card outlined body-m' }, 'Tahap berikutnya (fase 2): kalender, galeri, aktivitas, pemakaian aplikasi.'))),
    destroy: () => document.removeEventListener('visibilitychange', onVis) };
}
