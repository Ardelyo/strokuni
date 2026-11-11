// Small DOM helpers + Material components (dialog, snackbar, ripple)

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) sk.startsWith('--') ? el.style.setProperty(sk, sv) : (el.style[sk] = sv);
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const icon = (name, cls = '') => h('span', { class: `icon ${cls}`.trim(), 'aria-hidden': 'true' }, name);

export function btn(label, { kind = 'filled', ico, size = '', onClick, cls = '', disabled, type = 'button', aria } = {}) {
  return h('button', {
    type, class: `btn state ${kind} ${size} ${cls}`.trim(), onclick: onClick, disabled, 'aria-label': aria,
  }, ico ? icon(ico) : null, label);
}

export function iconBtn(name, { onClick, label, cls = '' } = {}) {
  return h('button', { type: 'button', class: `icon-btn state ${cls}`.trim(), onclick: onClick, 'aria-label': label, title: label }, icon(name));
}

export function field(label, input, help) {
  const wrap = h('label', { class: 'field' }, input, h('label', {}, label));
  if (input.tagName === 'SELECT') wrap.append(icon('expand_more', 'select-caret'));
  if (help) wrap.append(h('div', { class: 'help' }, help));
  return wrap;
}

export function input(attrs = {}) { return h('input', { type: 'text', ...attrs }); }

export function select(options, value, attrs = {}) {
  const s = h('select', attrs);
  for (const o of options) {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    s.append(h('option', { value: v, selected: String(v) === String(value) }, l));
  }
  return s;
}

export function switchEl(checked, onChange, label) {
  const inp = h('input', { type: 'checkbox', role: 'switch', checked, 'aria-label': label, onchange: (e) => onChange(e.target.checked) });
  return h('span', { class: 'switch' }, inp, h('span', { class: 'track' }), h('span', { class: 'thumb' }));
}

export function listItem({ lead, leadCls = '', headline, supporting, trail, onClick, href }) {
  const tag = href ? 'a' : onClick ? 'button' : 'div';
  return h(tag, { class: `list-item ${onClick || href ? 'state' : ''}`, href, onclick: onClick, type: tag === 'button' ? 'button' : null },
    lead ? h('span', { class: `lead ${leadCls}` }, typeof lead === 'string' ? icon(lead) : lead) : null,
    h('span', { class: 'content' }, h('div', { class: 'headline' }, headline), supporting ? h('div', { class: 'supporting' }, supporting) : null),
    trail ? h('span', { class: 'trail' }, typeof trail === 'string' ? icon(trail) : trail) : null,
  );
}

// ripple on any .state element
document.addEventListener('pointerdown', (e) => {
  const t = e.target.closest('.state, .kb-key, .quick');
  if (!t || t.disabled) return;
  const r = t.getBoundingClientRect();
  const size = Math.max(r.width, r.height) * 2;
  const s = document.createElement('span');
  s.className = 'ripple';
  Object.assign(s.style, { width: `${size}px`, height: `${size}px`, left: `${e.clientX - r.left - size / 2}px`, top: `${e.clientY - r.top - size / 2}px` });
  if (getComputedStyle(t).position === 'static') t.style.position = 'relative';
  t.style.overflow = 'hidden';
  t.append(s);
  setTimeout(() => s.remove(), 600);
}, { passive: true });

let snackTimer;
export function snackbar(text, action) {
  document.querySelector('.snackbar')?.remove();
  const el = h('div', { class: 'snackbar', role: 'status' }, h('span', {}, text),
    action ? h('button', { onclick: () => { el.remove(); action.onClick(); } }, action.label) : null);
  document.body.append(el);
  clearTimeout(snackTimer);
  snackTimer = setTimeout(() => el.remove(), action ? 6000 : 3500);
}

/** Opens an M3 dialog. `content` is a node or builder (close) => node. Returns a promise resolved with the action value. */
export function dialog({ title, ico, content, actions = [{ label: 'Tutup', value: null }], dismissable = true }) {
  return new Promise((resolve) => {
    const close = (v) => { scrim.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape' && dismissable) close(null); };
    const body = typeof content === 'function' ? content(close) : content;
    const box = h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      ico ? h('span', { class: 'd-icon' }, icon(ico)) : null,
      title ? h('h2', { class: ico ? 'center' : '' }, title) : null,
      body,
      actions.length ? h('div', { class: 'actions' }, actions.map((a) => btn(a.label, {
        kind: a.kind || 'text', ico: a.ico,
        onClick: async () => {
          if (a.validate && !(await a.validate())) return;
          close(typeof a.value === 'function' ? a.value() : a.value);
        },
      }))) : null,
    );
    const scrim = h('div', { class: 'scrim', onclick: (e) => { if (e.target === scrim && dismissable) close(null); } }, box);
    document.body.append(scrim);
    document.addEventListener('keydown', onKey);
    box.querySelector('input,textarea,select')?.focus();
  });
}

export const confirmDialog = (title, text, okLabel = 'Ya', ico) => dialog({
  title, ico, content: h('p', { class: 'body-m muted', style: { margin: 0 } }, text),
  actions: [{ label: 'Batal', value: false }, { label: okLabel, value: true, kind: 'filled' }],
});

export function topBar(title, { back, actions = [] } = {}) {
  const bar = h('header', { class: 'top-bar' },
    back ? iconBtn('arrow_back', { label: 'Kembali', onClick: typeof back === 'function' ? back : () => history.back() }) : h('span', { style: { width: '8px' } }),
    h('div', { class: 'title' }, title),
    ...actions);
  const onScroll = () => bar.classList.toggle('scrolled', window.scrollY > 4);
  window.addEventListener('scroll', onScroll, { passive: true });
  return bar;
}

export function navBar(items, current) {
  return h('nav', { class: 'nav-bar', 'aria-label': 'Navigasi' }, items.map((it) =>
    h('a', { href: it.href, 'aria-current': it.key === current ? 'page' : null },
      h('span', { class: 'pill' }, icon(it.icon), it.badge ? h('span', { class: 'badge' }, it.badge) : null),
      h('span', {}, it.label))));
}

export function empty(ico, text) {
  return h('div', { class: 'empty' }, icon(ico), h('div', { class: 'body-m' }, text));
}

export function readFileAsDataURL(file, maxDim = 1024, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export function pickImage({ capture = true } = {}) {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    if (capture) inp.setAttribute('capture', 'environment');
    inp.onchange = async () => {
      const f = inp.files?.[0];
      inp.remove();
      resolve(f ? await readFileAsDataURL(f) : null);
    };
    document.body.append(inp);
    inp.click();
  });
}
