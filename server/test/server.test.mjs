// Run: npm test (inside server/). No network: AI key is unset, so AI routes must return 503.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STROKUNI_NO_LISTEN = '1';
process.env.FAMILY_CODES = 'uji-keluarga';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'strokuni-'));
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

const { server } = await import('../index.mjs');
const { guardSummary, SummarySchema, GuardError } = await import('../ai.mjs');
let base;

before(() => new Promise((r) => server.listen(0, () => { base = `http://localhost:${server.address().port}`; r(); })));
after(() => server.close());

const call = (path, { method = 'GET', body, code = 'uji-keluarga' } = {}) =>
  fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-family-code': code }, body: body ? JSON.stringify(body) : undefined })
    .then(async (r) => ({ status: r.status, data: await r.json() }));

test('rejects wrong family code', async () => {
  const r = await call('/api/health', { code: 'salah' });
  assert.equal(r.status, 401);
});

test('health reports AI off', async () => {
  const r = await call('/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.data.ai, false);
});

test('heartbeat + status snapshot', async () => {
  await call('/api/heartbeat', { method: 'POST', body: { role: 'lio', snapshot: { day: '2026-11-11', practiceMinutes: 7, doses: [], notes: [], plan: [] } } });
  const r = await call('/api/status');
  assert.equal(r.data.stale, false);
  assert.equal(r.data.snapshot.practiceMinutes, 7);
});

test('alerts dedupe', async () => {
  await call('/api/alerts', { method: 'POST', body: { type: 'missed_dose', message: 'a', dedupe: 'x1' } });
  await call('/api/alerts', { method: 'POST', body: { type: 'missed_dose', message: 'a', dedupe: 'x1' } });
  const r = await call('/api/alerts?since=0');
  assert.equal(r.data.alerts.filter((a) => a.dedupe === 'x1').length, 1);
});

test('summary without AI key -> 503 so app falls back', async () => {
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
  const r = await call('/api/config');
  assert.equal(r.data.config.meds.length, 1);
});

test('schema rejects more than 5 tasks', () => {
  const s = { catatan: 'x', pola: [], pertanyaan: [], rencana: Array.from({ length: 6 }, () => ({ type: 'trace', label: 'a', minutes: 5, reason: '' })) };
  assert.equal(SummarySchema.safeParse(s).success, false);
});

test('guard rejects medication change', () => {
  const s = { catatan: 'Hari baik.', pola: [], pertanyaan: [], rencana: [{ type: 'custom', label: 'Tambah dosis obat', minutes: 5, reason: '' }] };
  assert.throws(() => guardSummary(s), GuardError);
  const ok = { catatan: 'Obat 2 dari 3 dikonfirmasi.', pola: [], pertanyaan: ['Apakah obat jam 20:00 sudah diminum?'], rencana: [{ type: 'trace', label: 'Telusuri huruf', minutes: 5, reason: '' }] };
  assert.doesNotThrow(() => guardSummary(ok));
});
