// Minimal hash router.
const routes = [];
let current = null;
let outlet = null;

export function route(pattern, view, opts = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ re, keys, view, opts });
}

export function go(hash, { replace = false } = {}) {
  if (replace) { history.replaceState(null, '', hash); render(); }
  else if (location.hash === hash) render();
  else location.hash = hash;
}

let guard = null;
export function setGuard(fn) { guard = fn; }

export function render() {
  const raw = location.hash.slice(1) || '/';
  const [path, qs = ''] = raw.split('?');
  const query = new URLSearchParams(qs);
  for (const r of routes) {
    const m = path.match(r.re);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const redirect = guard?.({ path, params, query, opts: r.opts });
    if (redirect && redirect !== location.hash) { go(redirect, { replace: true }); return; }
    current?.destroy?.();
    const v = r.view({ params, query, path });
    current = v;
    outlet.replaceChildren(v.el);
    window.scrollTo(0, 0);
    return;
  }
  go('#/', { replace: true });
}

export function startRouter(el) {
  outlet = el;
  window.addEventListener('hashchange', render);
  render();
}

export function rerender() { render(); }
