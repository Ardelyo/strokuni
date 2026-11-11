// Strokuni relay server. Zero web framework: node:http + JSON file store.
// Holds the API key, enforces rules (schema, med guard, daily limits), relays between Lio's phone and family phones.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Store } from './store.mjs';
import { summarize, readLabel, aiEnabled, MODEL, GuardError } from './ai.mjs';

const PORT = Number(process.env.PORT || 8787);
const FAMILY_CODES = (process.env.FAMILY_CODES || '').split(',').map((s) => s.trim()).filter(Boolean);
const DAILY_CALL_LIMIT = Number(process.env.DAILY_CALL_LIMIT || 20);
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS || 30);
const STALE_MINUTES = Number(process.env.STALE_MINUTES || 180);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim());
const MAX_BODY = 8 * 1024 * 1024;

if (!FAMILY_CODES.length) console.warn('[strokuni] FAMILY_CODES is empty: every request will be rejected. Set FAMILY_CODES=kode-rahasia');
if (!aiEnabled()) console.warn('[strokuni] ANTHROPIC_API_KEY not set: AI endpoints return 503, apps fall back to manual summaries.');

const store = new Store(process.env.DATA_DIR || fileURLToPath(new URL('./data/', import.meta.url)));

const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);

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
  for await (const c of req) { size += c.length; if (size > MAX_BODY) throw Object.assign(new Error('Body terlalu besar'), { status: 413 }); chunks.push(c); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('JSON tidak valid'), { status: 400 }); }
}

function family(req) {
  const code = String(req.headers['x-family-code'] || '');
  if (!code || !FAMILY_CODES.includes(code)) throw Object.assign(new Error('Kode keluarga salah'), { status: 401 });
  return store.family(code);
}

function takeQuota(fam) {
  const d = dayKey();
  if (fam.usage.day !== d) fam.usage = { day: d, calls: 0, inputTokens: 0, outputTokens: 0 };
  if (fam.usage.calls >= DAILY_CALL_LIMIT) throw Object.assign(new Error(`Batas ${DAILY_CALL_LIMIT} panggilan AI hari ini tercapai`), { status: 429 });
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

const routes = {
  'GET /api/health': async (req) => {
    const fam = family(req);
    const d = dayKey();
    const used = fam.usage.day === d ? fam.usage.calls : 0;
    return { ok: true, ai: aiEnabled(), model: aiEnabled() ? MODEL : null, remainingToday: Math.max(0, DAILY_CALL_LIMIT - used) };
  },

  'POST /api/heartbeat': async (req) => {
    const fam = family(req); const b = await readJson(req);
    const role = b.role === 'family' ? 'family' : 'lio';
    fam.heartbeats[role] = new Date().toISOString();
    if (role === 'lio' && b.snapshot && typeof b.snapshot === 'object') fam.snapshot = { ...b.snapshot, receivedAt: new Date().toISOString() };
    if (b.taken && Array.isArray(b.taken)) fam.nativeTaken = b.taken.slice(-50);
    store.save();
    return { ok: true };
  },

  'GET /api/status': async (req) => {
    const fam = family(req);
    const hb = fam.heartbeats.lio || null;
    let snapshot = fam.snapshot || null;
    // Confirmations made on the native alarm screen while the web layer was closed
    if (snapshot && Array.isArray(fam.nativeTaken)) {
      snapshot = { ...snapshot, doses: (snapshot.doses || []).map((d) => {
        const t = fam.nativeTaken.find((x) => x.date === snapshot.day && x.key === d.key);
        return d.takenAt || !t ? d : { ...d, takenAt: t.at };
      }) };
    }
    return { lastHeartbeat: hb, stale: !!staleAlert(fam), snapshot };
  },

  'POST /api/alerts': async (req) => {
    const fam = family(req); const b = await readJson(req);
    const type = ['missed_dose', 'help', 'stale', 'other'].includes(b.type) ? b.type : 'other';
    const message = String(b.message || '').slice(0, 300);
    const dedupe = b.dedupe ? String(b.dedupe).slice(0, 120) : null;
    if (dedupe && fam.alerts.some((a) => a.dedupe === dedupe)) return { ok: true, duplicate: true };
    fam.alerts.push({ id: randomUUID(), type, message, dedupe, at: new Date().toISOString() });
    prune(fam); store.save();
    return { ok: true };
  },

  'GET /api/alerts': async (req, url) => {
    const fam = family(req);
    const since = Number(url.searchParams.get('since') || 0);
    const list = fam.alerts.filter((a) => new Date(a.at).getTime() > since);
    const st = staleAlert(fam);
    if (st) list.push(st);
    return { alerts: list.slice(-50) };
  },

  'POST /api/summary': async (req) => {
    const fam = family(req); const b = await readJson(req);
    if (!aiEnabled()) throw Object.assign(new Error('AI belum diatur di server'), { status: 503 });
    if (!b.log || typeof b.log !== 'object' || !/^\d{4}-\d{2}-\d{2}$/.test(b.log.date || '')) throw Object.assign(new Error('Log tidak valid'), { status: 400 });
    takeQuota(fam); store.save();
    let out;
    try { out = await summarize(b.log); }
    catch (e) {
      if (e instanceof GuardError) throw Object.assign(new Error(e.message), { status: 422 });
      throw Object.assign(new Error('AI gagal: ' + (e.message || e)), { status: 502 });
    }
    addUsage(fam, out.usage);
    const next = new Date(b.log.date); next.setDate(next.getDate() + 1);
    const draft = { id: randomUUID(), date: b.log.date, forDate: next.toISOString().slice(0, 10), createdAt: new Date().toISOString(), source: 'ai', model: out.model, summary: out.summary, status: 'pending' };
    fam.drafts = fam.drafts.filter((d) => !(d.date === draft.date && d.status === 'pending'));
    fam.drafts.push(draft);
    prune(fam); store.save();
    return { draft };
  },

  'POST /api/label': async (req) => {
    const fam = family(req); const b = await readJson(req);
    if (!aiEnabled()) throw Object.assign(new Error('AI belum diatur di server'), { status: 503 });
    takeQuota(fam); store.save();
    try {
      const out = await readLabel(b.image);
      addUsage(fam, out.usage); store.save();
      return { label: out.label };
    } catch (e) {
      if (e instanceof GuardError) throw Object.assign(new Error(e.message), { status: 422 });
      throw Object.assign(new Error('AI gagal: ' + (e.message || e)), { status: 502 });
    }
  },

  'GET /api/drafts': async (req, url) => {
    const fam = family(req);
    const status = url.searchParams.get('status');
    return { drafts: fam.drafts.filter((d) => !status || d.status === status).slice(-10) };
  },

  'POST /api/drafts/:id': async (req, url, params) => {
    const fam = family(req); const b = await readJson(req);
    const d = fam.drafts.find((x) => x.id === params.id);
    if (!d) return { ok: true, missing: true };
    if (!['approved', 'rejected'].includes(b.status)) throw Object.assign(new Error('Status tidak valid'), { status: 400 });
    d.status = b.status; d.decidedAt = new Date().toISOString();
    if (b.summary) d.summary = b.summary;
    store.save();
    return { ok: true };
  },

  'GET /api/plan': async (req, url) => {
    const fam = family(req);
    return { plan: fam.plans[url.searchParams.get('date')] || null };
  },

  'POST /api/plan': async (req) => {
    const fam = family(req); const b = await readJson(req);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '') || !Array.isArray(b.tasks)) throw Object.assign(new Error('Rencana tidak valid'), { status: 400 });
    const tasks = b.tasks.slice(0, 5).map((t) => ({ type: String(t.type || 'custom').slice(0, 20), label: String(t.label || 'Tugas').slice(0, 60), minutes: Math.max(1, Math.min(15, Number(t.minutes) || 5)) }));
    fam.plans[b.date] = { tasks, source: 'family', approvedAt: new Date().toISOString() };
    store.save();
    return { ok: true };
  },

  'GET /api/config': async (req) => ({ config: family(req).config || null }),

  'POST /api/config': async (req) => {
    const fam = family(req); const b = await readJson(req);
    if (!b.updatedAt) throw Object.assign(new Error('updatedAt wajib'), { status: 400 });
    if (!fam.config || b.updatedAt > fam.config.updatedAt) { fam.config = b; store.save(); return { ok: true, applied: true }; }
    return { ok: true, applied: false };
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
  server.listen(PORT, () => console.log(`[strokuni] server on http://localhost:${PORT} · AI ${aiEnabled() ? MODEL : 'off'} · ${FAMILY_CODES.length} family code(s)`));
}
