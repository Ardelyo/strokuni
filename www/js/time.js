// Date helpers (local time)

export const pad = (n) => String(n).padStart(2, '0');

export function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return dayKey(dt);
}

export function hm(d = new Date()) { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }

export function minutesOf(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }

export function nowMinutes(d = new Date()) { return d.getHours() * 60 + d.getMinutes(); }

/** Date object for HH:MM on given day key */
export function at(key, t) {
  const [y, m, d] = key.split('-').map(Number);
  const [hh, mm] = t.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

export function longDate(d = new Date()) {
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function keyToLongDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return longDate(new Date(y, m - 1, d));
}

export function greeting(d = new Date()) {
  const h = d.getHours();
  if (h < 11) return 'Selamat pagi';
  if (h < 15) return 'Selamat siang';
  if (h < 18) return 'Selamat sore';
  return 'Selamat malam';
}

/** Speakable Indonesian time, e.g. "jam delapan lewat lima" -> keep simple: "jam 08.05" */
export function spokenTime(t) {
  const [h, m] = t.split(':').map(Number);
  return m === 0 ? `jam ${h}` : `jam ${h} lewat ${m} menit`;
}

export function fmtTime(iso) { return hm(new Date(iso)); }

export function relMinutes(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return 'baru saja';
  if (m < 60) return `${m} menit lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  return `${Math.floor(h / 24)} hari lalu`;
}
