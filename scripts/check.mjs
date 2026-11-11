// Static check for the no-build web app: every named import must be exported by its module.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const root = resolve('www/js');
const files = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') && files.push(p); } })(root);

const exportsOf = new Map();
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) for (const n of m[1].split(',')) names.add(n.trim().split(/\s+as\s+/).pop());
  exportsOf.set(f, names);
}

let errors = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*'([^']+)'/g)) {
    const target = resolve(dirname(f), m[2]);
    const ex = exportsOf.get(target);
    if (!ex) { console.error(`✖ ${f}: module not found ${m[2]}`); errors++; continue; }
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0];
      if (name && !ex.has(name)) { console.error(`✖ ${f.replace(root, 'www/js')}: '${name}' is not exported by ${m[2]}`); errors++; }
    }
  }
}
console.log(errors ? `${errors} problem(s)` : `✔ ${files.length} modules, all imports resolve`);
process.exit(errors ? 1 : 0);
