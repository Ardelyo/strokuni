// Strokuni relay server. Zero web framework: node:http. Storage: Firestore (prod) or JSON file (dev).
// Holds AI credentials (service account), enforces rules (schema, med guard, daily limits),
// relays between Lio's phone and family phones.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.mjs';
import { summarize, readLabel, aiEnabled, MODEL, FALLBACK_MODEL, GuardError } from './ai.mjs';

const PORT = Number(process.env.PORT || 8787);
const FAMILY_CODES = (process.env.FAMILY_CODES || '').split(',').map((s) => s.trim()).filter(Boolean);
const DAILY_CALL_LIMIT = Number(process.env.DAILY_CALL_LIMIT || 20);
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS || 30);
const STALE_MINUTES = Number(process.env.STALE_MINUTES || 180);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim());
const MAX_BODY = 8 * 1024 * 1024;

if (!FAMILY_CODES.length) console.warn('[strokuni] FAMILY_CODES is empty: every request will be rejected.');
if (!aiEnabled()) console.warn('[strokuni] GOOGLE_CLOUD_PROJECT not set: AI endpoints return 503, apps fall back to manual summaries.');

const store = createStore({ dir: process.env.DATA_DIR || fileURLToPath(new URL('./data/', import.meta.url)) });

const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);
const httpError = (status, message) => Object.assign(new Error(message), { status });

function cors(req, res) {
  const origin = req.headers.origin;
  const allow = ALLOWED_ORIGINS.includes('*') ? '*' : ALLOWED_ORIGINS.includes(origin) ? origin : '';
  if (allow) res.setHeader('access-control-allow-origin', allow);
  res.setHeader('vary', 'origin');
  res.setHeader('access-control-allow-headers', 'content-type, x-family-code');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-max-age', '86400');
}

function send(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > MAX_BODY) throw httpError(413, 'Body terlalu besar'); chunks.push(c); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw httpError(400, 'JSON tidak valid'); }
}

/** Validates the family code header and returns the code. */
function auth(req) {
  const code = String(req.headers['x-family-code'] || '');
  if (!code || !FAMILY_CODES.includes(code)) throw httpError(401, 'Kode keluarga salah');
  return code;
}

function takeQuota(fam) {
  const d = dayKey();
  if (fam.usage.day !== d) fam.usage = { day: d, calls: 0, inputTokens: 0, outputTokens: 0 };
  if (fam.usage.calls >= DAILY_CALL_LIMIT) throw httpError(429, `Batas ${DAILY_CALL_LIMIT} panggilan AI hari ini tercapai`);
  fam.usage.calls++;
}
function addUsage(fam, usage) {
  if (!usage) return;
  fam.usage.inputTokens += usage.input_tokens || 0;
  fam.usage.outputTokens += usage.output_tokens || 0;
}

function prune(fam) {
  const cutoff = Date.now() - RETENTION_DAYS * 864e5;
  fam.alerts = fam.alerts.filter((a) => new Date(a.at).getTime() > cutoff);
  fam.drafts = fam.drafts.filter((d) => new Date(d.createdAt).getTime() > cutoff);
  for (const k of Object.keys(fam.plans)) if (new Date(k).getTime() < cutoff) delete fam.plans[k];
}

function staleAlert(fam) {
  const hb = fam.heartbeats.lio;
  if (!hb) return null;
  const mins = (Date.now() - new Date(hb).getTime()) / 60000;
  if (mins < STALE_MINUTES) return null;
  return { id: 'stale', type: 'stale', at: new Date().toISOString(), message: `HP Lio tidak mengirim sinyal "masih hidup" selama ${Math.round(mins / 60)} jam. Periksa HP dan alarm cadangan.` };
}

const aiFailure = (e) => (e instanceof GuardError ? httpError(422, e.message) : httpError(502, 'AI gagal: ' + (e.message || e)));

const routes = {
  'GET /api/health': async (req) => {
    const fam = await store.get(auth(req));
    const used = fam.usage.day === dayKey() ? fam.usage.calls : 0;
    return { ok: true, ai: aiEnabled(), model: aiEnabled() ? MODEL : null, fallbackModel: aiEnabled() ? FALLBACK_MODEL : null, remainingToday: Math.max(0, DAILY_CALL_LIMIT - used) };
  },

  'POST /api/heartbeat': async (req) => {
    const code = auth(req); const b = await readJson(req);
    const role = b.role === 'family' ? 'family' : 'lio';
    await store.mutate(code, (fam) => {
      fam.heartbeats[role] = new Date().toISOString();
      if (role === 'lio' && b.snapshot && typeof b.snapshot === 'object') fam.snapshot = { ...b.snapshot, receivedAt: new Date().toISOString() };
      if (Array.isArray(b.taken)) fam.nativeTaken = b.taken.slice(-50).map((t) => ({ date: String(t.date || ''), key: String(t.key || ''), at: String(t.at || '') }));
    });
    return { ok: true };
  },

  'GET /api/status': async (req) => {
    const fam = await store.get(auth(req));
    let snapshot = fam.snapshot || null;
    // Confirmations made on the native alarm screen while the web layer was closed
    if (snapshot && Array.isArray(fam.nativeTaken)) {
      snapshot = { ...snapshot, doses: (snapshot.doses || []).map((d) => {
        const t = fam.nativeTaken.find((x) => x.date === snapshot.day && x.key === d.key);
        return d.takenAt || !t ? d : { ...d, takenAt: t.at };
      }) };
    }
    return { lastHeartbeat: fam.heartbeats.lio || null, stale: !!staleAlert(fam), snapshot };
  },

  'POST /api/alerts': async (req) => {
    const code = auth(req); const b = await readJson(req);
    const type = ['missed_dose', 'help', 'stale', 'other'].includes(b.type) ? b.type : 'other';
    const message = String(b.message || '').slice(0, 300);
    const dedupe = b.dedupe ? String(b.dedupe).slice(0, 120) : null;
    return store.mutate(code, (fam) => {
      if (dedupe && fam.alerts.some((a) => a.dedupe === dedupe)) return { ok: true, duplicate: true };
      fam.alerts.push({ id: randomUUID(), type, message, dedupe, at: new Date().toISOString() });
      prune(fam);
      return { ok: true };
    });
  },

  'GET /api/alerts': async (req, url) => {
    const fam = await store.get(auth(req));
    const since = Number(url.searchParams.get('since') || 0);
    const list = fam.alerts.filter((a) => new Date(a.at).getTime() > since);
    const st = staleAlert(fam);
    if (st) list.push(st);
    return { alerts: list.slice(-50) };
  },

  'POST /api/summary': async (req) => {
    const code = auth(req); const b = await readJson(req);
    if (!aiEnabled()) throw httpError(503, 'AI belum diatur di server');
    if (!b.log || typeof b.log !== 'object' || !/^\d{4}-\d{2}-\d{2}$/.test(b.log.date || '')) throw httpError(400, 'Log tidak valid');
    await store.mutate(code, (fam) => takeQuota(fam));
    let out;
    try { out = await summarize(b.log); } catch (e) { throw aiFailure(e); }
    const next = new Date(b.log.date); next.setDate(next.getDate() + 1);
    const draft = { id: randomUUID(), date: b.log.date, forDate: next.toISOString().slice(0, 10), createdAt: new Date().toISOString(), source: 'ai', model: out.model, summary: out.summary, status: 'pending' };
    await store.mutate(code, (fam) => {
      addUsage(fam, out.usage);
      fam.drafts = fam.drafts.filter((d) => !(d.date === draft.date && d.status === 'pending'));
      fam.drafts.push(draft);
      prune(fam);
    });
    return { draft };
  },

  'POST /api/label': async (req) => {
    const code = auth(req); const b = await readJson(req);
    if (!aiEnabled()) throw httpError(503, 'AI belum diatur di server');
    await store.mutate(code, (fam) => takeQuota(fam));
    let out;
    try { out = await readLabel(b.image); } catch (e) { throw aiFailure(e); }
    await store.mutate(code, (fam) => addUsage(fam, out.usage));
    return { label: out.label };
  },

  'GET /api/drafts': async (req, url) => {
    const fam = await store.get(auth(req));
    const status = url.searchParams.get('status');
    return { drafts: fam.drafts.filter((d) => !status || d.status === status).slice(-10) };
  },

  'POST /api/drafts/:id': async (req, url, params) => {
    const code = auth(req); const b = await readJson(req);
    if (!['approved', 'rejected'].includes(b.status)) throw httpError(400, 'Status tidak valid');
    return store.mutate(code, (fam) => {
      const d = fam.drafts.find((x) => x.id === params.id);
      if (!d) return { ok: true, missing: true };
      d.status = b.status; d.decidedAt = new Date().toISOString();
      if (b.summary && typeof b.summary === 'object') d.summary = b.summary;
      return { ok: true };
    });
  },

  'GET /api/plan': async (req, url) => {
    const fam = await store.get(auth(req));
    return { plan: fam.plans[url.searchParams.get('date')] || null };
  },

  'POST /api/plan': async (req) => {
    const code = auth(req); const b = await readJson(req);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '') || !Array.isArray(b.tasks)) throw httpError(400, 'Rencana tidak valid');
    const tasks = b.tasks.slice(0, 5).map((t) => ({ type: String(t.type || 'custom').slice(0, 20), label: String(t.label || 'Tugas').slice(0, 60), minutes: Math.max(1, Math.min(15, Number(t.minutes) || 5)) }));
    await store.mutate(code, (fam) => { fam.plans[b.date] = { tasks, source: 'family', approvedAt: new Date().toISOString() }; });
    return { ok: true };
  },

  'GET /api/config': async (req) => ({ config: (await store.get(auth(req))).config || null }),

  'POST /api/config': async (req) => {
    const code = auth(req); const b = await readJson(req);
    if (!b.updatedAt) throw httpError(400, 'updatedAt wajib');
    return store.mutate(code, (fam) => {
      if (!fam.config || b.updatedAt > fam.config.updatedAt) { fam.config = b; return { ok: true, applied: true }; }
      return { ok: true, applied: false };
    });
  },
};

const compiled = Object.entries(routes).map(([k, fn]) => {
  const [method, path] = k.split(' ');
  const keys = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, n) => { keys.push(n); return '([^/]+)'; }) + '$');
  return { method, re, keys, fn };
});

export const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/' || url.pathname === '/healthz') return send(res, 200, { name: 'strokuni-server', ok: true });
  for (const r of compiled) {
    if (r.method !== req.method) continue;
    const m = url.pathname.match(r.re);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    try { return send(res, 200, await r.fn(req, url, params)); }
    catch (e) {
      const status = e.status || 500;
      if (status >= 500 && status !== 503) console.error('[strokuni]', req.method, url.pathname, e);
      return send(res, status, { error: e.message || 'Kesalahan server' });
    }
  }
  send(res, 404, { error: 'Tidak ditemukan' });
});

if (process.env.STROKUNI_NO_LISTEN !== '1') {
  server.listen(PORT, () => console.log(`[strokuni] server on :${PORT} · AI ${aiEnabled() ? `${MODEL} (cadangan ${FALLBACK_MODEL})` : 'off'} · store ${process.env.FIRESTORE_DATABASE ? 'firestore:' + process.env.FIRESTORE_DATABASE : 'file'} · ${FAMILY_CODES.length} family code(s)`));
}
