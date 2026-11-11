// Run: npm test (inside server/). No network: Vertex is mocked via global fetch.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STROKUNI_NO_LISTEN = '1';
process.env.FAMILY_CODES = 'uji-keluarga';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'strokuni-'));
process.env.GCP_ACCESS_TOKEN = 'test-token';
delete process.env.GOOGLE_CLOUD_PROJECT;
delete process.env.FIRESTORE_DATABASE;

const { server } = await import('../index.mjs');
const ai = await import('../ai.mjs');
const { guardSummary, SummarySchema, GuardError } = ai;
let base;
const realFetch = globalThis.fetch;

before(() => new Promise((r) => server.listen(0, () => { base = `http://localhost:${server.address().port}`; r(); })));
after(() => server.close());

const call = (path, { method = 'GET', body, code = 'uji-keluarga' } = {}) =>
  realFetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-family-code': code }, body: body ? JSON.stringify(body) : undefined })
    .then(async (r) => ({ status: r.status, data: await r.json() }));

test('rejects wrong family code', async () => {
  assert.equal((await call('/api/health', { code: 'salah' })).status, 401);
});

test('health reports AI off without a project', async () => {
  const r = await call('/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.data.ai, false);
});

test('heartbeat + status snapshot, native confirmation merged', async () => {
  await call('/api/heartbeat', { method: 'POST', body: { role: 'lio', snapshot: { day: '2026-11-11', practiceMinutes: 7, doses: [{ key: 'm1@08:00', name: 'X', time: '08:00', takenAt: null }], notes: [], plan: [] }, taken: [{ date: '2026-11-11', key: 'm1@08:00', at: '2026-11-11T01:05:00.000Z' }] } });
  const r = await call('/api/status');
  assert.equal(r.data.stale, false);
  assert.equal(r.data.snapshot.practiceMinutes, 7);
  assert.equal(r.data.snapshot.doses[0].takenAt, '2026-11-11T01:05:00.000Z');
});

test('alerts dedupe', async () => {
  await call('/api/alerts', { method: 'POST', body: { type: 'missed_dose', message: 'a', dedupe: 'x1' } });
  await call('/api/alerts', { method: 'POST', body: { type: 'missed_dose', message: 'a', dedupe: 'x1' } });
  const r = await call('/api/alerts?since=0');
  assert.equal(r.data.alerts.filter((a) => a.dedupe === 'x1').length, 1);
});

test('summary without AI project -> 503 so app falls back', async () => {
  const r = await call('/api/summary', { method: 'POST', body: { log: { date: '2026-11-11' } } });
  assert.equal(r.status, 503);
});

test('plan is capped at 5 tasks and 15 minutes', async () => {
  const tasks = Array.from({ length: 8 }, () => ({ type: 'trace', label: 'x', minutes: 60 }));
  await call('/api/plan', { method: 'POST', body: { date: '2026-11-12', tasks } });
  const r = await call('/api/plan?date=2026-11-12');
  assert.equal(r.data.plan.tasks.length, 5);
  assert.equal(r.data.plan.tasks[0].minutes, 15);
});

test('config last-writer-wins', async () => {
  await call('/api/config', { method: 'POST', body: { updatedAt: 10, meds: [{ id: 'm1' }] } });
  const old = await call('/api/config', { method: 'POST', body: { updatedAt: 5, meds: [] } });
  assert.equal(old.data.applied, false);
  assert.equal((await call('/api/config')).data.config.meds.length, 1);
});

test('concurrent writes do not lose updates', async () => {
  await Promise.all(Array.from({ length: 10 }, (_, i) => call('/api/alerts', { method: 'POST', body: { type: 'other', message: 'c' + i, dedupe: 'conc' + i } })));
  const r = await call('/api/alerts?since=0');
  assert.equal(r.data.alerts.filter((a) => a.dedupe?.startsWith('conc')).length, 10);
});

test('schema rejects more than 5 or zero tasks', () => {
  const base = { catatan: 'x', pola: [], pertanyaan: [] };
  assert.equal(SummarySchema.safeParse({ ...base, rencana: Array.from({ length: 6 }, () => ({ type: 'trace', label: 'a', minutes: 5, reason: '' })) }).success, false);
  assert.equal(SummarySchema.safeParse({ ...base, rencana: [] }).success, false);
});

test('guard rejects medication change', () => {
  const s = { catatan: 'Hari baik.', pola: [], pertanyaan: [], rencana: [{ type: 'custom', label: 'Tambah dosis obat', minutes: 5, reason: '' }] };
  assert.throws(() => guardSummary(s), GuardError);
  const ok = { catatan: 'Obat 2 dari 3 dikonfirmasi.', pola: [], pertanyaan: ['Apakah obat jam 20:00 sudah diminum?'], rencana: [{ type: 'trace', label: 'Telusuri huruf', minutes: 5, reason: '' }] };
  assert.doesNotThrow(() => guardSummary(ok));
});

// ---------- Vertex (mocked) ----------
const goodSummary = { catatan: 'Obat 2 dari 3 dikonfirmasi.', pola: ['Latihan 7 menit'], pertanyaan: [], rencana: [{ type: 'trace', label: 'Telusuri huruf', minutes: 5, reason: 'Rencana standar' }] };
const vertexReply = (obj, extra = {}) => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'hmm' }, { text: JSON.stringify(obj) }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 30, thoughtsTokenCount: 200 }, ...extra }), { status: 200 });

async function withVertex(handler, fn) {
  process.env.GOOGLE_CLOUD_PROJECT = 'proj-test';
  const calls = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('http://localhost')) return realFetch(url, init);
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return handler(calls.length, String(url));
  };
  try { return await fn(calls); } finally { globalThis.fetch = realFetch; delete process.env.GOOGLE_CLOUD_PROJECT; }
}

test('summarize uses global Vertex endpoint, schema, and counts thinking tokens', async () => {
  await withVertex(() => vertexReply(goodSummary), async (calls) => {
    const r = await ai.summarize({ date: '2026-11-11' });
    assert.equal(r.summary.rencana.length, 1);
    assert.equal(r.usage.output_tokens, 230);
    assert.match(calls[0].url, /^https:\/\/aiplatform\.googleapis\.com\/v1\/projects\/proj-test\/locations\/global\/publishers\/google\/models\/gemini-3\.8-flash:generateContent$/);
    assert.equal(calls[0].body.generationConfig.responseMimeType, 'application/json');
    assert.equal(calls[0].body.generationConfig.responseSchema.properties.rencana.minItems, 1);
  });
});

test('summarize falls back to the lite model when the main model fails', async () => {
  await withVertex((n) => n === 1 ? new Response(JSON.stringify({ error: { message: 'overloaded' } }), { status: 503 }) : vertexReply(goodSummary), async (calls) => {
    const r = await ai.summarize({ date: '2026-11-11' });
    assert.equal(calls.length, 2);
    assert.match(calls[1].url, /gemini-3\.5-flash-lite/);
    assert.equal(r.model, 'gemini-3.5-flash-lite');
  });
});

test('summarize rejects medication change from both models', async () => {
  const bad = { ...goodSummary, rencana: [{ type: 'custom', label: 'Tambah dosis obat', minutes: 5, reason: '' }] };
  await withVertex(() => vertexReply(bad), async (calls) => {
    await assert.rejects(ai.summarize({ date: '2026-11-11' }), GuardError);
    assert.equal(calls.length, 2);
  });
});

test('summarize retries on empty plan (schema)', async () => {
  await withVertex((n) => vertexReply(n === 1 ? { ...goodSummary, rencana: [] } : goodSummary), async (calls) => {
    const r = await ai.summarize({ date: '2026-11-11' });
    assert.equal(calls.length, 2);
    assert.equal(r.summary.rencana.length, 1);
  });
});

test('readLabel sends inline image and validates output', async () => {
  const label = { name: 'Amlodipin', dose: '1 tablet 5 mg', instructions: '1x sehari', times: ['08:00'], uncertain: '' };
  await withVertex(() => vertexReply(label), async (calls) => {
    const r = await ai.readLabel('data:image/jpeg;base64,/9j/AAAA');
    assert.equal(r.label.name, 'Amlodipin');
    assert.equal(calls[0].body.contents[0].parts[0].inlineData.mimeType, 'image/jpeg');
  });
  await assert.rejects(ai.readLabel('data:text/html;base64,AAAA'), GuardError);
});
