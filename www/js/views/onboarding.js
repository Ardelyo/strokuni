// First run, done by family (not by Lio).
import { h, icon, btn, field, input, snackbar } from '../ui.js';
import { state, save, hashPin } from '../store.js';
import { isNative } from '../native.js';
import { configureNative } from '../sync.js';
import { go } from '../router.js';
import { unlockOnce } from './family.js';

export function onboardingView() {
  const root = h('div', { style: { flex: '1', display: 'flex' } });
  const s = state.settings;
  let step = 0;
  const steps = [
    () => [
      h('div', { class: 'logo' }, icon('favorite', 'fill')),
      h('h1', { class: 'display-s', style: { margin: 0 } }, 'Strokuni'),
      h('p', { class: 'body-l muted', style: { margin: 0 } }, 'Pengingat obat, latihan huruf dan keyboard, dan catatan malam untuk pemulihan pasca stroke.'),
      h('div', { class: 'card tonal stack' },
        h('div', { class: 'row title-m' }, icon('family_restroom'), 'Disiapkan oleh keluarga'),
        h('div', { class: 'body-m' }, 'Pengaturan awal ini sekitar 5 menit. Setelah itu HP menampilkan satu layar sederhana, "Sekarang", untuk Lio.')),
      h('div', { class: 'card outlined body-s muted' }, 'Ini uji coba keluarga, bukan alat medis. Jadwal dan dosis obat hanya dari resep dokter. AI tidak pernah menentukan obat atau dosis.'),
      btn('Mulai', { kind: 'filled', size: 'lg', ico: 'play_arrow', cls: 'block', onClick: () => next() }),
    ],
    () => {
      const name = input({ value: s.patientName });
      const fam = input({ value: s.familyName, placeholder: 'Contoh: Ibu, Kak Sinta' });
      const phone = input({ type: 'tel', value: s.familyPhone, placeholder: '08xxxxxxxxxx' });
      return [
        h('h1', { class: 'headline-m', style: { margin: 0 } }, 'Profil'),
        field('Nama pasien', name),
        field('Panggilan keluarga', fam, 'Muncul di tombol besar "Telepon …"'),
        field('Nomor telepon keluarga', phone),
        btn('Lanjut', { kind: 'filled', size: 'lg', cls: 'block', onClick: () => {
          if (!name.value.trim()) return snackbar('Nama wajib diisi');
          Object.assign(s, { patientName: name.value.trim(), familyName: fam.value.trim() || 'Keluarga', familyPhone: phone.value.trim() });
          save(); next();
        } }),
      ];
    },
    () => {
      const a = input({ type: 'password', inputmode: 'numeric', maxlength: 4, placeholder: '4 angka' });
      const b = input({ type: 'password', inputmode: 'numeric', maxlength: 4, placeholder: 'Ulangi' });
      return [
        h('h1', { class: 'headline-m', style: { margin: 0 } }, 'PIN Mode Keluarga'),
        h('p', { class: 'body-m muted', style: { margin: 0 } }, 'Mode Keluarga memegang jadwal obat, daftar kata, pengaturan, dan persetujuan rencana. Simpan PIN ini di pemegang PIN keluarga.'),
        field('PIN', a), field('Ulangi PIN', b),
        btn('Lanjut', { kind: 'filled', size: 'lg', cls: 'block', onClick: async () => {
          if (!/^\d{4}$/.test(a.value)) return snackbar('PIN harus 4 angka');
          if (a.value !== b.value) return snackbar('PIN tidak sama');
          s.pinHash = await hashPin(a.value); save(); next();
        } }),
      ];
    },
    () => [
      h('h1', { class: 'headline-m', style: { margin: 0 } }, 'HP siapa ini?'),
      h('button', { class: 'card filled row state', style: { border: 'none', textAlign: 'left', cursor: 'pointer' }, onclick: () => finish('lio') },
        icon('phone_android'), h('div', { class: 'grow' }, h('div', { class: 'title-m' }, `HP ${s.patientName}`), h('div', { class: 'body-m muted' }, 'Layar "Sekarang", alarm obat, latihan.')), icon('chevron_right')),
      h('button', { class: 'card filled row state', style: { border: 'none', textAlign: 'left', cursor: 'pointer' }, onclick: () => finish('family') },
        icon('family_restroom'), h('div', { class: 'grow' }, h('div', { class: 'title-m' }, 'HP Keluarga'), h('div', { class: 'body-m muted' }, 'Jadwal, peringatan, dan persetujuan rencana. Butuh server untuk tersambung ke HP Lio.')), icon('chevron_right')),
    ],
  ];
  function draw() { root.replaceChildren(h('main', { class: 'onb' }, steps[step]())); }
  function next() { step++; draw(); }
  async function finish(role) {
    s.role = role; s.onboarded = true; save();
    await configureNative();
    // unlock family mode once to add medicines
    unlockOnce();
    go(role === 'lio' && isNative ? '#/keluarga/izin' : '#/keluarga/obat', { replace: true });
    snackbar(role === 'lio' ? 'Langkah berikutnya: izin Android dan jadwal obat' : 'Atur server di Lainnya agar tersambung ke HP Lio');
  }
  draw();
  return { el: root };
}
