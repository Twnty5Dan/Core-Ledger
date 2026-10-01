/* Headless harness: runs the app's <script> in a Node vm context with a tiny DOM stub,
   a controllable clock and an in-memory localStorage. No dependencies. */
import fs from 'node:fs';
import vm from 'node:vm';

export function boot(htmlPath, { now = '2026-10-01T09:00:00', storage = {} } = {}) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const src = scripts[scripts.length - 1];
  const clock = { t: new Date(now).getTime() };
  const RealDate = Date;
  class FDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(clock.t); else super(...a); }
    static now() { return clock.t; }
  }
  const handlers = {};
  const els = {};
  const mk = (id) => {
    const e = {
      id, innerHTML: '', textContent: '', value: '', checked: false, hidden: false, style: { setProperty() { } },
      dataset: {}, classList: { toggle() { }, add() { }, remove() { }, contains() { return false; } },
      addEventListener() { }, removeEventListener() { }, appendChild(c) { return c; }, remove() { },
      querySelector() { return null; }, querySelectorAll() { return []; }, setAttribute() { }, removeAttribute() { },
      getAttribute() { return null; }, focus() { }, setSelectionRange() { }, closest() { return null; }, click() { },
      scrollTo() { }, scrollIntoView() { }, getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; }
    };
    return e;
  };
  for (const id of ['#app', '#player', '#sheet', '#tabbar']) els[id] = mk(id);
  const mem = Object.assign({}, storage);
  const localStorage = {
    getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; }
  };
  const intervals = [], timeouts = [];
  const document = {
    querySelector: s => els[s] || null,
    querySelectorAll: () => [],
    addEventListener: (t, f) => { (handlers[t] ||= []).push(f); },
    removeEventListener() { },
    createElement: t => mk(t),
    body: mk('body'), documentElement: mk('html'), head: mk('head'), visibilityState: 'visible'
  };
  const ctx = {
    console, Date: FDate, Math, JSON, Promise, Set, Map, Object, Array, String, Number, Boolean, RegExp, Error, isNaN, parseFloat, parseInt, Infinity, NaN,
    Symbol, Intl, structuredClone, encodeURIComponent, decodeURIComponent,
    document, localStorage,
    navigator: { vibrate() { }, userAgent: 'node' },
    location: { search: '', protocol: 'http:', hostname: 'localhost', href: 'http://localhost/' },
    setInterval: (f, ms) => { intervals.push(f); return intervals.length; },
    clearInterval() { },
    setTimeout: (f, ms) => { timeouts.push({ f, at: clock.t + (ms || 0) }); return timeouts.length; },
    clearTimeout() { },
    requestAnimationFrame: f => { timeouts.push({ f, at: clock.t }); return 1; },
    matchMedia: () => ({ matches: false, addEventListener() { } }),
    scrollTo() { }, addEventListener() { }, removeEventListener() { },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() { } }, Blob: class { },
    innerWidth: 390, innerHeight: 844
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'index.html' });
  const run = code => vm.runInContext(code, ctx);
  const api = {
    ctx, els, mem, clock, run,
    /* advance the fake clock and fire the 200 ms interval like a browser would */
    advance(ms, step = 200) {
      const end = clock.t + ms;
      while (clock.t < end) {
        clock.t = Math.min(end, clock.t + step);
        for (const f of intervals) f();
        const due = timeouts.filter(t => t.at <= clock.t);
        for (const t of due) { timeouts.splice(timeouts.indexOf(t), 1); t.f(); }
      }
    },
    setDate(iso) { clock.t = new RealDate(iso + 'T09:00:00').getTime(); },
    addDays(n) { clock.t += n * 864e5; },
    html: () => els['#app'].innerHTML + els['#player'].innerHTML + els['#sheet'].innerHTML,
    input(id, value) { els['#' + id] = Object.assign(mk('#' + id), { value: String(value) }); },
    fire(type, target) { for (const f of handlers[type] || []) f({ target, preventDefault() { } }); },
    /* invoke a data-a action like a click would */
    act(name, dataset = {}, extra = {}) {
      const t = Object.assign(mk('btn'), { dataset }, extra);
      const f = run('ACT')[name];
      if (!f) throw new Error('No action ' + name);
      return f(t, { target: t });
    }
  };
  return api;
}

/* strings that should never reach the screen */
export function badText(s) {
  const bad = [];
  for (const needle of ['undefined', 'NaN', '[object Object]', 'Infinity', 'null kg', 'null reps', 'null s']) {
    const i = s.indexOf(needle);
    if (i >= 0) bad.push(needle + ' … ' + s.slice(Math.max(0, i - 80), i + 40).replace(/\s+/g, ' '));
  }
  return bad;
}
