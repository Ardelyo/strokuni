// Generates app icons (PNG) without dependencies: teal background, white capsule (pill), amber spark.
// node scripts/icons.mjs  -> www/icons/*.png and android mipmaps (if android/ exists)
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname } from 'node:path';

const BG = [0x00, 0x6a, 0x6a];
const FG = [0xff, 0xff, 0xff];
const HALF = [0x9c, 0xf1, 0xf0];
const SPARK = [0xf5, 0xbf, 0x48];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// signed distance helpers in unit space (0..1)
function sdCapsule(px, py, ax, ay, bx, by, r) {
  const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h) - r;
}
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r, qy = Math.abs(py - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

/** scale: how big the motif is (1 = full icon, 0.62 = adaptive safe zone) ; bg: draw background ; shape: 'square'|'round'|'full' */
function render(size, { scale = 0.8, bg = true, shape = 'full' } = {}) {
  const aa = 1.2 / size;
  return png(size, (x, y) => {
    const u = (x + 0.5) / size, v = (y + 0.5) / size;
    let col = [0, 0, 0], alpha = 0;
    if (bg) {
      const d = shape === 'round' ? Math.hypot(u - 0.5, v - 0.5) - 0.5 : shape === 'square' ? sdRoundRect(u, v, 0.5, 0.5, 0.5, 0.5, 0.18) : -1;
      alpha = Math.max(0, Math.min(1, 0.5 - d / aa));
      col = BG;
    }
    // motif coordinates
    const mu = (u - 0.5) / scale + 0.5, mv = (v - 0.5) / scale + 0.5;
    const ax = 0.3, ay = 0.7, bx = 0.7, by = 0.3, r = 0.15;
    const dc = sdCapsule(mu, mv, ax, ay, bx, by, r) * scale;
    if (dc < aa) {
      const t = Math.max(0, Math.min(1, 0.5 - dc / aa));
      // split capsule: lower-left half lighter
      const side = (mu - 0.5) + (mv - 0.5); // >0 lower-right of the perpendicular line through center
      const perp = (mu - 0.5) - (mv - 0.5);
      const fill = perp < 0 ? FG : HALF;
      const seam = Math.abs(perp) < 0.012 ? BG : fill;
      void side;
      col = alpha ? mix(col, seam, t) : seam;
      alpha = Math.max(alpha, t);
    }
    const ds = (Math.hypot(mu - 0.8, mv - 0.78) - 0.075) * scale;
    if (ds < aa) {
      const t = Math.max(0, Math.min(1, 0.5 - ds / aa));
      col = alpha ? mix(col, SPARK, t) : SPARK;
      alpha = Math.max(alpha, t);
    }
    return [...col, Math.round(alpha * 255)];
  });
}

function out(path, buf) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, buf); }

out('www/icons/icon-192.png', render(192, { shape: 'square' }));
out('www/icons/icon-512.png', render(512, { shape: 'square' }));
out('www/icons/icon-maskable-512.png', render(512, { scale: 0.62, shape: 'full' }));

if (existsSync('android/app/src/main/res')) {
  const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, f] of Object.entries(dens)) {
    const base = `android/app/src/main/res/mipmap-${d}`;
    out(`${base}/ic_launcher.png`, render(Math.round(48 * f), { shape: 'square' }));
    out(`${base}/ic_launcher_round.png`, render(Math.round(48 * f), { shape: 'round' }));
    out(`${base}/ic_launcher_foreground.png`, render(Math.round(108 * f), { scale: 0.55, bg: false }));
  }
  console.log('android mipmaps written');
}
console.log('icons written');
