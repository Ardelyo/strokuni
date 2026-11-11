// Storage: one document per family (id = hash of the family code).
//  - FirestoreStore: production (Cloud Run + Firestore database "strokuni"), transactional.
//  - FileStore: local dev and tests.
// Interface: get(code) -> family snapshot, mutate(code, fn) -> runs fn(family) atomically and persists it.
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const famId = (code) => createHash('sha256').update('strokuni:' + code).digest('hex').slice(0, 24);

function normalize(f = {}) {
  f.alerts ||= []; f.drafts ||= []; f.plans ||= {}; f.heartbeats ||= {};
  f.usage ||= { day: '', calls: 0, inputTokens: 0, outputTokens: 0 };
  return f;
}

export class FileStore {
  constructor(dir) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'strokuni.json');
    this.data = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : { families: {} };
    this.queue = Promise.resolve();
  }

  async get(code) { return structuredClone(normalize((this.data.families[famId(code)] ||= {}))); }

  mutate(code, fn) {
    const run = async () => {
      const fam = normalize((this.data.families[famId(code)] ||= {}));
      const result = await fn(fam);
      const tmp = this.file + '.tmp';
      writeFileSync(tmp, JSON.stringify(this.data));
      renameSync(tmp, this.file);
      return result;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }
}

export class FirestoreStore {
  constructor({ projectId, databaseId }) {
    this.ready = import('@google-cloud/firestore').then(({ Firestore }) => {
      this.db = new Firestore({ projectId, databaseId, ignoreUndefinedProperties: true });
    });
  }

  async ref(code) { await this.ready; return this.db.collection('families').doc(famId(code)); }

  async get(code) {
    const snap = await (await this.ref(code)).get();
    return normalize(snap.exists ? snap.data() : {});
  }

  async mutate(code, fn) {
    const ref = await this.ref(code);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const fam = normalize(snap.exists ? snap.data() : {});
      const result = await fn(fam);
      tx.set(ref, fam);
      return result;
    });
  }
}

export function createStore({ dir } = {}) {
  const databaseId = process.env.FIRESTORE_DATABASE;
  if (databaseId) return new FirestoreStore({ projectId: process.env.GOOGLE_CLOUD_PROJECT, databaseId });
  return new FileStore(dir);
}
