// Tiny JSON-file store, one document per family code (hashed). Writes are debounced and atomic.
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export class Store {
  constructor(dir) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'strokuni.json');
    this.data = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : { families: {} };
    this.timer = null;
  }

  family(code) {
    const id = createHash('sha256').update('strokuni:' + code).digest('hex').slice(0, 24);
    const f = (this.data.families[id] ||= {});
    f.alerts ||= []; f.drafts ||= []; f.plans ||= {}; f.heartbeats ||= {};
    f.usage ||= { day: '', calls: 0, inputTokens: 0, outputTokens: 0 };
    return f;
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 200);
  }

  flush() {
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.file);
  }
}
