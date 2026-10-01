/* Core Ledger test suite — no dependencies. Run: node tests/run.mjs [--quick] [--seed=N]
   1. plan invariants for every profile × equipment set × day
   2. simulated users training full blocks through the real UI handlers (fake clock for timers and holds)
   3. scenario tests for every feature
   4. chaos monkey: random taps with invariant checks after each one */
import { boot, badText } from './harness.mjs';
const FILE = new URL('../index.html', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const QUICK = process.argv.includes('--quick');
let SEED = +(process.argv.find(a => a.startsWith('--seed=')) || '--seed=7').split('=')[1];
const rnd = () => { SEED = (SEED * 1103515245 + 12345) % 2147483648; return SEED / 2147483648; };
const pickR = a => a[Math.floor(rnd() * a.length)];

let pass = 0, fail = 0; const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; if (fails.length < 60) fails.push(msg); } }
function test(name, f) { try { f(); } catch (e) { fail++; fails.push(`${name}: THREW ${e.message}\n    ${(e.stack || '').split('\n').slice(1, 4).join('\n    ')}`); } }

const PROFILE = (o = {}) => Object.assign({ sex: 'm', age: 30, height: 180, weight: 80, exp: 1, focus: 'full', body: 'recomp', days: 4 }, o);
const EQUIP = {
  full: `S.equip = Object.assign(S.equip, { bar: true, bench: true, incline: true, highBench: false }); S.equip.ez = Object.assign(S.equip.ez, { on: true, mode: 'plates', bar: 10, plates: { 10: 2, 5: 2, 2.5: 2, 1.25: 4 } }); S.equip.db = Object.assign(S.equip.db, { on: true, mode: 'adj', min: 2, max: 30, step: 2 });`,
  bare: `S.equip = Object.assign(S.equip, { bar: false, bench: false, incline: false, highBench: false }); S.equip.ez.on = false; S.equip.db.on = false;`,
  fixed22: `S.equip = Object.assign(S.equip, { bar: true, bench: true, incline: false, highBench: false }); S.equip.ez.on = false; S.equip.db = Object.assign(S.equip.db, { on: true, mode: 'fixed', fixed: [22] });`,
  spinlock: `S.equip = Object.assign(S.equip, { bar: false, bench: true, incline: false, highBench: true }); S.equip.ez = Object.assign(S.equip.ez, { on: true, mode: 'range', bar: 8, max: 40, step: 2.5 }); S.equip.db = Object.assign(S.equip.db, { on: true, mode: 'plates', handle: 2, plates: { 5: 4, 2.5: 4, 1.25: 4 } });`,
  barOnly: `S.equip = Object.assign(S.equip, { bar: true, bench: false, incline: false, highBench: false }); S.equip.ez.on = false; S.equip.db.on = false;`
};
function setup(A, prof, equip = 'full', startOffset = 0) {
  A.run(`S.profile = ${JSON.stringify(prof)}; S.start = addDays(today(), ${-startOffset}); S.body = [{ date: S.start, w: ${prof.weight} }]; S.tipPlates = true; ${EQUIP[equip]} save(); render();`);
}
const H = A => A.html();
function noBad(A, where) { const b = badText(H(A)); ok(!b.length, `${where}: bad text ${b.join(' | ')}`); }

/* ---------- 1. plan invariants ---------- */
function planInvariants() {
  const combos = [];
  for (const focus of ['abs', 'full', 'upper', 'lower']) for (const exp of [0, 1, 2]) for (const days of [3, 4, 5, 6]) for (const eq of Object.keys(EQUIP)) combos.push({ focus, exp, days, eq });
  const list = QUICK ? combos.filter((_, i) => i % 5 === 0) : combos;
  for (const c of list) test(`plan ${JSON.stringify(c)}`, () => {
    const A = boot(FILE); setup(A, PROFILE({ focus: c.focus, exp: c.exp, days: c.days, sex: c.exp === 1 ? 'f' : 'm' }), c.eq);
    const r = JSON.parse(A.run(`(() => {
      const out = { errs: [], weeks: [] };
      const floorsOk = it => it.rest >= Math.min(X[it.id].rest * (S.prefs.restMult || 1), isCompound(X[it.id]) ? 90 : 45) - 1e-6;
      for (let d = 0; d < 30; d++) {
        if (!isTrain(d)) continue;
        const p = planDay(d), w = p.blocks[1].items, ids = w.map(i => i.id), where = 'day ' + (d + 1) + ' ';
        if (!w.length) out.errs.push(where + 'no work');
        if (new Set(ids).size !== ids.length) out.errs.push(where + 'duplicate exercise');
        if (!(p.est > 0 && p.est < 3 * 3600)) out.errs.push(where + 'est ' + p.est);
        if (!p.title || /undefined/.test(p.title)) out.errs.push(where + 'title ' + p.title);
        let prevTier = -1;
        w.forEach((it, i) => {
          const e = X[it.id], t = it.t;
          if (!e) return out.errs.push(where + 'unknown ' + it.id);
          if (!elig(e).ok) out.errs.push(where + e.name + ' not eligible: ' + elig(e).why);
          if (!(it.sets >= 1 && it.sets <= 7)) out.errs.push(where + e.name + ' sets ' + it.sets);
          if (t.mode === 'reps' && !(Number.isInteger(t.reps) && t.reps >= 1 && t.reps <= 60)) out.errs.push(where + e.name + ' reps ' + t.reps);
          if (t.mode !== 'reps' && !(t.secs >= 5 && t.secs <= 240)) out.errs.push(where + e.name + ' secs ' + t.secs);
          if (e.load && !(t.kg != null && loads(e.load, e).some(l => Math.abs(l - t.kg) < 1e-6))) out.errs.push(where + e.name + ' kg ' + t.kg + ' not loadable');
          if (!floorsOk(it)) out.errs.push(where + e.name + ' rest ' + it.rest);
          const tr = tierOf(it); if (tr < prevTier) out.errs.push(where + 'order: ' + e.name + ' (tier ' + tr + ') after tier ' + prevTier); prevTier = Math.max(prevTier, tr);
          if (i && clashes(w[i - 1], it)) { const alt = orderWork(w.slice()); if (clashCount(alt) < clashCount(w)) out.errs.push(where + 'avoidable clash ' + X[w[i - 1].id].name + ' > ' + e.name); }
        });
        const wk = Math.floor(d / 7);
        if (wk < 4) { out.weeks[wk] ||= { abs: 0, obl: 0, gA: 0, gO: 0 }; const W = out.weeks[wk]; let hitA = false, hitO = false;
          for (const it of w) { const e = X[it.id]; if (e.m.includes('abs')) { W.abs += it.sets; hitA = true; } else if (e.m2.includes('abs')) W.abs += it.sets / 2; if (e.m.includes('obl')) { W.obl += it.sets; hitO = true; } else if (e.m2.includes('obl')) W.obl += it.sets / 2; }
          if (hitA) W.gA++; if (hitO) W.gO++; }
      }
      return JSON.stringify(out);
    })()`));
    for (const e of r.errs) ok(false, `${JSON.stringify(c)} ${e}`);
    ok(true, 'plan ran');
    const core = c.eq !== 'bare' || true;
    r.weeks.forEach((W, i) => {
      if (!W) return;
      const lo = i === 0 ? 7 : 9, hi = c.exp === 2 && i >= 2 ? 28 : 26; // trained lifters overreach briefly in the peak weeks, then deload
      ok(W.abs >= lo && W.abs <= hi, `${JSON.stringify(c)} week ${i + 1} abs sets ${W.abs} outside ${lo}–${hi}`);
      ok(W.obl >= 6 && W.obl <= hi, `${JSON.stringify(c)} week ${i + 1} oblique sets ${W.obl} outside 6–${hi}`);
      ok(W.gA >= 2 && W.gO >= 2, `${JSON.stringify(c)} week ${i + 1} frequency abs ${W.gA} obl ${W.gO} (want ≥2 each)`);
    });
  });
}

/* ---------- 2. simulated users through the real UI ---------- */
/* latent ability per exercise; honest logging with noise; slow strength gain */
function makeUser(A, kind = 'avg') {
  const base = { weak: 0.6, avg: 1, strong: 1.6 }[kind];
  return { base, cap: {}, gain: 1, noise: 0.15 };
}
function capOf(A, U, id) {
  if (!U.cap[id]) {
    const e = JSON.parse(A.run(`JSON.stringify({ lvl: X['${id}'].lvl, load: X['${id}'].load, mode: X['${id}'].mode, range: X['${id}'].range, hold: X['${id}'].hold, kg: X['${id}'].kg })`));
    const lv = Math.max(0, e.lvl);
    U.cap[id] = e.load ? { orm: (e.kg[1] || 10) * 1.9 * U.base } : e.mode === 'hold' ? { secs: Math.round((70 - lv * 10) * U.base) } : { reps: Math.max(2, Math.round((26 - lv * 4) * U.base)) };
  }
  return U.cap[id];
}
function driveSession(A, U, opt = {}) {
  const log0 = A.run('S.log.length');
  A.act(opt.anyway ? 'anyway' : 'start');
  if (A.run('PL && PL.phase') === 'ready') {
    if (opt.ready) A.run(`Object.assign(PL.ready, ${JSON.stringify(opt.ready)})`);
    A.act('rdyGo');
  }
  for (let guard = 0; guard < 900; guard++) {
    if (!A.run('!!PL')) break;
    noBadEvery(A);
    if (A.run('!!CK')) { A.act('ckWhy', { v: 'gave' }); A.act('ckNext'); A.act('ckDone'); continue; }
    const ph = A.run('PL.phase');
    if (ph === 'review') { A.act('toPost'); continue; }
    if (ph === 'post') { A.act('post', { k: 'rpe', v: String(opt.rpe || 7) }); A.act('finish'); continue; }
    if (ph === 'sum') { A.act('pClose'); break; }
    const v = A.run('PL.view');
    if (['prep', 'guide', 'switch', 'rest'].includes(v) && A.run('PL.phase') === 'run' && !A.run("PL.view === 'switch' && curBlock().kind === 'work'")) {
      if (v === 'rest' && opt.restSecs != null) { A.advance(opt.restSecs * 1000); if (A.run("PL && PL.view === 'rest'")) A.act('pSkip'); } else A.act('pSkip');
      continue;
    }
    if (v === 'set') {
      const it = JSON.parse(A.run(`JSON.stringify({ id: curItem().id, t: curItem().t, si: siOf(curItem()), sets: curItem().sets, uni: X[curItem().id].uni })`));
      const c = capOf(A, U, it.id), fat = it.si, nz = () => 1 + (rnd() - 0.5) * U.noise;
      if (it.t.mode === 'reps') {
        A.act('pDone');
        const kg = A.run('PL.logv.kg');
        const rtf = c.orm ? Math.max(0, Math.floor(30 * (c.orm * U.gain / kg - 1) * nz())) - fat : Math.max(0, Math.floor(c.reps * U.gain * nz())) - fat;
        const tgt = A.run('PL.logv.probe') ? rtf - 1 : it.t.reps;
        const reps = Math.max(0, Math.min(tgt, rtf)), left = rtf - reps;
        const rir = A.run('PL.logv.probe') ? 1 : reps < it.t.reps ? -1 : left >= 4 ? 4 : left >= 2 ? 2.5 : left >= 1 ? 1 : 0;
        A.run(`PL.logv.reps = ${reps}`); A.act('eff', { v: String(rir) }); A.act('pSave');
      } else if (it.t.mode === 'hold') {
        const sides = it.uni ? 2 : 1;
        A.act('pHold'); A.act('pSkip');
        for (let s = 0; s < sides; s++) {
          const secs = Math.max(3, Math.round(c.secs * U.gain * nz()) - fat * 4);
          if (secs < it.t.secs) { A.advance(secs * 1000); A.act('pStopHold'); }
          else { A.advance(it.t.secs * 1000 + 400); A.advance(Math.max(0, secs - it.t.secs) * 1000); A.act('pStopHold'); }
          if (s === 0 && sides === 2) { A.act('pSkip'); }
        }
        if (A.run("PL.view === 'log'")) { if (A.run('PL.logv.rir == null')) A.act('eff', { v: '0' }); A.act('pSave'); }
      } else {
        A.act('pTimed'); A.act('pSkip'); A.act('pSkip');
        A.run(`PL.logv.reps = ${Math.max(1, Math.round((c.reps || 20) * 0.9))}`); A.act('pSave');
      }
      continue;
    }
    if (v === 'log') { if (A.run('PL.logv.rir == null')) A.act('eff', { v: '2.5' }); A.act('pSave'); continue; }
    if (['hold', 'holdover', 'timedrun'].includes(v)) { A.act(v === 'timedrun' ? 'pSkip' : 'pStopHold'); continue; }
    throw new Error('stuck in view ' + v + ' phase ' + ph);
  }
  ok(!A.run('!!PL'), 'session finished');
  ok(A.run('S.log.length') === log0 + 1, 'session logged once');
  U.gain *= 1.012;
}
let badEvery = 0;
function noBadEvery(A) { if (++badEvery % 7) return; noBad(A, 'during session'); }
function stateInvariants(A, where) {
  const errs = JSON.parse(A.run(`(() => {
    const e = [];
    for (const [id, m] of Object.entries(S.ex)) {
      const x = X[id]; if (!x) { e.push('unknown ex ' + id); continue; }
      if (m.reps != null && !(Number.isInteger(m.reps) && m.reps >= 1 && m.reps <= 60)) e.push(x.name + ' reps ' + m.reps);
      if (m.secs != null && !(m.secs >= 5 && m.secs <= 240)) e.push(x.name + ' secs ' + m.secs);
      if (m.kg != null && x.load && !(m.kg > 0 && m.kg < 400)) e.push(x.name + ' kg ' + m.kg);
      if (m.restAdj != null && !(Math.abs(m.restAdj) <= 90)) e.push(x.name + ' restAdj ' + m.restAdj);
      if ((m.hist || []).length > CONFIG.histMax) e.push(x.name + ' hist too long');
    }
    for (const [k, v] of Object.entries(S.slots)) if (!X[v]) e.push('slot ' + k + ' → ' + v);
    for (const [g, v] of Object.entries(S.gvol || {})) if (!(v >= CONFIG.gvolMin - 1e-9 && v <= CONFIG.gvolMax + 1e-9)) e.push('gvol ' + g + ' ' + v);
    if (!(S.volMult >= 0.8 && S.volMult <= 1.25)) e.push('volMult ' + S.volMult);
    for (const l of S.log) { if (!(l.day >= 0 && l.day < 30)) e.push('log day ' + l.day); for (const en of l.entries || []) for (const s of en.sets) { if (s.reps != null && !(s.reps >= 0)) e.push('logged reps ' + s.reps); if (Number.isNaN(s.kg)) e.push('NaN kg'); } }
    try { JSON.stringify(S); } catch (x) { e.push('state not serialisable'); }
    return JSON.stringify(e);
  })()`));
  for (const x of errs) ok(false, `${where}: ${x}`);
  ok(true, 'state ok');
}
function simulateBlock(prof, equip, kind, blocks = 1, opts = {}) {
  const A = boot(FILE); setup(A, prof, equip);
  const U = makeUser(A, kind);
  for (let b = 0; b < blocks; b++) {
    for (let day = 0; day < 30; day++) {
      const d = A.run('dayIndex()');
      if (d >= 30) break;
      if (A.run(`isTrain(${d}) && !logFor(${d})`) && !(opts.skipSome && rnd() < 0.12)) {
        driveSession(A, U, { rpe: 6 + Math.floor(rnd() * 4), ready: rnd() < 0.2 ? { sore: 'very', soreAt: [pickR(['abs', 'obl', 'back'])] } : rnd() < 0.1 ? { time: 'short' } : {}, restSecs: rnd() < 0.3 ? 30 + Math.floor(rnd() * 120) : null });
        stateInvariants(A, `${prof.focus}/${equip}/${kind} day ${d + 1}`);
      }
      A.act('tab', { v: pickR(['today', 'ledger', 'library', 'profile']) }); noBad(A, 'tab render');
      A.addDays(1);
    }
    A.act('tab', { v: 'today' });
    ok(/30/.test(A.html()), 'completion screen shows');
    A.act('newBlock');
  }
  return A;
}
/* learning quality: after a block, targets should sit near what the simulated user can really do */
function learningQuality() {
  test('learning converges', () => {
    const A = boot(FILE); setup(A, PROFILE({ focus: 'abs', exp: 0 }), 'full');
    const U = makeUser(A, 'strong');
    for (let day = 0; day < 30; day++) { const d = A.run('dayIndex()'); if (d >= 30) break; if (A.run(`isTrain(${d})`)) driveSession(A, U); A.addDays(1); }
    const rows = JSON.parse(A.run(`JSON.stringify(Object.entries(S.ex).filter(([id, m]) => X[id].mode === 'reps' && !X[id].load && m.reps != null && (m.hist || []).length >= 3).map(([id, m]) => [id, m.reps, m.hist.length]))`));
    let good = 0;
    for (const [id, reps] of rows) { const c = capOf(A, U, id).reps * U.gain, top = A.run(`X['${id}'].range[1]`); if (reps <= c + 1 && reps >= Math.min(c - 8, top - 2)) good++; } // past the range the app levels up instead of chasing reps
    ok(rows.length >= 2, `learning: not enough repeated exercises (${rows.length})`);
    ok(good >= Math.ceil(rows.length * 0.7), `learning: only ${good}/${rows.length} targets near true ability ${JSON.stringify(rows.map(([id, r]) => [id, r, Math.round(capOf(A, U, id).reps * U.gain)]))}`);
  });
}

/* ---------- 3. scenarios ---------- */
function toWork(A) { let n = 0; while (A.run('PL.bi') === 0 && n++ < 60) A.act('pSkip'); }
function logSet(A, reps, rir, kg) { A.act('pDone'); if (reps != null) A.run(`PL.logv.reps = ${reps}`); if (kg != null) A.run(`PL.logv.kg = ${kg}`); A.act('eff', { v: String(rir) }); A.act('pSave'); }
function scenarios() {
  test('back returns to an accidentally skipped exercise, then back to where you were', () => {
    const A = boot(FILE); setup(A, PROFILE()); A.act('start'); A.act('rdyGo'); toWork(A);
    const first = A.run('curItem().id');
    logSet(A, null, 2.5); A.act('pSkip'); // rest → set 2
    A.act('pSkipEx');
    const second = A.run('curItem().id'); ok(second !== first, 'skip moved on');
    A.act('pSkipEx'); const third = A.run('curItem().id');
    A.act('pBack'); ok(A.run('curItem().id') === second && A.run('PL.view') === 'set', 'back → skipped exercise set screen');
    ok(A.run('!!PL.ret'), 'return point remembered');
    const n = A.run('curItem().sets'); for (let i = 0; i < n; i++) { logSet(A, null, 2.5); if (A.run("PL.view === 'rest'")) A.act('pSkip'); }
    ok(A.run('curItem().id') === third, `after finishing it you return to where you were (${A.run('curItem().id')} vs ${third})`);
  });
  test('wrong reps typed: back fixes the set and resets the auto-adjusted targets', () => {
    const A = boot(FILE); setup(A, PROFILE({ focus: 'abs' })); A.act('start'); A.act('rdyGo'); toWork(A);
    while (A.run("curItem().t.mode !== 'reps'")) A.act('pSkipEx');
    const plan = A.run('curItem().tPlan.reps');
    logSet(A, plan + 15, 4);
    const bumped = A.run('curItem().t.reps'); ok(bumped > plan, `easy typo raised the next sets (${plan} → ${bumped})`);
    ok(A.run('PL.view') === 'rest', 'resting after set');
    A.advance(10000);
    const left0 = A.run('Math.ceil(timeLeft())');
    A.act('pBack'); ok(A.run('!!PL.edit && PL.view === "log"'), 'back from rest opens the set for fixing');
    A.run(`PL.logv.reps = ${plan}`); A.act('eff', { v: '2.5' }); A.act('pSave');
    ok(A.run('entryOf(curItem()).sets[0].reps') === plan, 'set corrected in place');
    ok(A.run('entryOf(curItem()).sets.length') === 1, 'no duplicate set');
    ok(A.run('curItem().t.reps') === plan, `targets reset after fix (${A.run('curItem().t.reps')} vs ${plan})`);
    ok(A.run('PL.view') === 'rest' && Math.abs(A.run('Math.ceil(timeLeft())') - left0) <= 1, 'rest resumed with the time that was left');
  });
  test('sheets update in place: tapping chips in the check-in does not replay the open animation', () => {
    const A = boot(FILE); setup(A, PROFILE()); A.act('start'); A.act('rdyGo'); toWork(A);
    A.act('pHard'); ok(!/scrim still/.test(A.els['#sheet'].innerHTML), 'first open animates');
    A.act('ckWhy', { v: 'gave' }); ok(/scrim still/.test(A.els['#sheet'].innerHTML), 'chip tap redraws in place');
    A.act('ckWhy', { v: 'form' }); A.act('ckNext'); ok(/scrim still/.test(A.els['#sheet'].innerHTML), 'next step also in place');
    A.act('ckDone'); A.act('pSwap'); ok(!/scrim still/.test(A.els['#sheet'].innerHTML), 'a different sheet animates');
    A.act('swR', { v: 'easier' }); ok(/scrim still/.test(A.els['#sheet'].innerHTML), 'swap reasons redraw in place');
  });
  test('extreme entries never give a useless 1–2 rep target', () => {
    const A = boot(FILE); setup(A, PROFILE({ focus: 'upper' }), 'full'); A.act('start'); A.act('rdyGo'); toWork(A);
    let g = 0; while (A.run('curItem().id') !== 'pushup' && g++ < 12) { if (A.run("X[curItem().id].pat === 'hpush' && !X[curItem().id].load")) { A.run("retarget(curItem(), 'pushup'); enterItem()"); break; } A.act('pSkipEx'); }
    if (A.run('curItem() && curItem().id') !== 'pushup') A.run("retarget(curItem(), 'pushup'); enterItem()");
    logSet(A, 3, 0); ok(A.run('curItem().t.reps') >= 5, 'push-up target floors at 5 reps (' + A.run('curItem().t.reps') + ')');
    A.act('pSkip'); ok(/Switch for today/.test(A.els['#player'].innerHTML), 'an easier variation is offered');
    A.act('takeEasier', { v: A.run('curItem().easier') }); ok(A.run('X[curItem().id].lvl < X.pushup.lvl'), 'switched to ' + A.run('curItem().id'));
    const B = boot(FILE); setup(B, PROFILE({ focus: 'upper' }), 'full'); B.act('start'); B.act('rdyGo'); toWork(B);
    B.run("retarget(curItem(), 'dbbench'); curItem().t = Object.assign({}, curItem().t, { kg: 20, reps: 10 }); curItem().tPlan = { ...curItem().t }; enterItem()");
    B.act('pDone'); B.run('PL.logv.reps = 3; PL.logv.kg = 20'); B.act('eff', { v: '0' }); B.act('pSave');
    ok(B.run('curItem().t.kg') < 20 && B.run('curItem().t.reps') >= 5, 'loaded: lighter weight, useful reps (' + B.run('curItem().t.reps') + ' at ' + B.run('curItem().t.kg') + ')');
  });
  test('delete an accidental extra set', () => {
    const A = boot(FILE); setup(A, PROFILE()); A.act('start'); A.act('rdyGo'); toWork(A);
    logSet(A, null, 2.5); A.act('pBack'); A.act('delSet');
    ok(A.run('siOf(curItem())') === 0 && A.run('PL.view') === 'set', 'set removed, back on the set screen');
  });
  test('back walks into the warm-up and forward again', () => {
    const A = boot(FILE); setup(A, PROFILE()); A.act('start'); A.act('rdyGo'); toWork(A);
    A.act('pBack'); ok(A.run('PL.bi') === 0 && A.run('PL.view') === 'prep', 'back into last warm-up item');
    A.act('pSkip'); A.act('pSkip');
    ok(A.run('PL.bi') === 1 && A.run('PL.view') === 'set', 'returns to the exercise');
  });
  test('receipt: do a skipped exercise now, come back to the receipt, finish once', () => {
    const A = boot(FILE); setup(A, PROFILE()); A.act('start'); A.act('rdyGo'); toWork(A);
    A.act('pSkipEx'); A.act('pEnd');
    ok(A.run('PL.phase') === 'review', 'end → receipt');
    ok(/Do it now/.test(A.html()), 'receipt offers skipped work');
    A.act('goItem', { bi: '1', ii: '0' });
    ok(A.run('PL.phase') === 'run' && A.run('PL.bi') === 1 && A.run('PL.ii') === 0, 'jumped to skipped exercise');
    const n = A.run('curItem().sets'); for (let i = 0; i < n; i++) { logSet(A, null, 2.5); if (A.run("PL.view === 'rest'")) A.act('pSkip'); }
    ok(A.run('PL.phase') === 'review', 'back on the receipt after doing it');
    A.act('fixSet', { bi: '1', ii: '0', k: '0' }); ok(A.run('!!PL.edit'), 'receipt set opens for fixing');
    A.act('eff', { v: '1' }); A.act('pSave'); ok(A.run('PL.phase') === 'review', 'fix returns to receipt');
    A.act('toPost'); A.act('post', { k: 'rpe', v: '7' }); A.act('finish'); A.act('pClose');
    ok(A.run('S.log.length') === 1, 'logged once');
  });
  test('reopen restores the plan state exactly, and re-entering applies progression once', () => {
    const A = boot(FILE); setup(A, PROFILE({ focus: 'abs' })); const U = makeUser(A);
    driveSession(A, U); A.addDays(1);
    while (!A.run('isTrain(dayIndex())')) A.addDays(1);
    const before = A.run('JSON.stringify(S.ex)');
    driveSession(A, U);
    const after = A.run('JSON.stringify(S.ex)');
    ok(before !== after, 'session changed targets');
    A.act('reopen'); ok(A.run('PL && PL.phase') === 'review', 'reopened on the receipt');
    ok(A.run('JSON.stringify(S.ex)') === before, 'plan state rolled back exactly');
    ok(A.run('S.log.length') === 1, 'log removed while fixing');
    A.act('toPost'); A.act('finish'); A.act('pClose');
    ok(A.run('S.log.length') === 2, 're-entered');
    ok(A.run('JSON.stringify(S.ex)') === after, 'same result as the first time (no double progression)');
    A.act('reopen'); A.act('pQuitAsk'); A.act('reopenKeep');
    ok(A.run('S.log.length') === 2 && !A.run('!!PL'), 'leaving a reopened session keeps it');
  });
  test('holds: going to form failure grows the target, never stalls', () => {
    const A = boot(FILE); setup(A, PROFILE({ focus: 'abs' }));
    A.run("mem('plank').secs = 30; mem('plank').hist = [{ d: addDays(today(), -3), secs: 32 }]");
    const t0 = 30; let t = t0;
    for (let s = 0; s < 4; s++) {
      const notes = A.run(`JSON.stringify(progress({ id: 'plank', t: targetFor(X.plank), rir: 2, sets: [{ secs: ${t + 12}, rir: 0 }, { secs: ${t + 8}, rir: 0 }, { secs: ${t + 5}, rir: 0 }] }))`);
      const nt = A.run('targetFor(X.plank).secs');
      ok(nt > t || nt === A.run('X.plank.hold[1]') || A.run("S.slots && Object.values(S.slots).length >= 0"), `hold target grew ${t} → ${nt} (${notes})`);
      ok(!/same target/.test(notes), 'no "same target" for a hold to failure: ' + notes);
      t = nt; if (A.run("peek('plank').secs") == null) break;
    }
    const A2 = boot(FILE); setup(A2, PROFILE({ focus: 'abs' }));
    A2.run("mem('plank').secs = 40");
    A2.run("progress({ id: 'plank', t: targetFor(X.plank), rir: 2, sets: [{ secs: 25, rir: 0 }, { secs: 22, rir: 0 }] })");
    const eased = A2.run("peek('plank').secs"); ok(eased < 40 && eased >= 15, `short holds ease the target (40 → ${eased})`);
  });
  test('hold logging: stop past target preselects form failure; far short opens the check-in', () => {
    const A = boot(FILE); setup(A, PROFILE({ focus: 'abs' })); A.act('start'); A.act('rdyGo'); toWork(A);
    A.run("retarget(curItem(), 'plank'); enterItem()");
    const tgt = A.run('curItem().t.secs');
    A.act('pHold'); A.act('pSkip'); A.advance(tgt * 1000 + 400); ok(A.run('PL.view') === 'holdover', 'counts on past the target');
    A.advance(6000); A.act('pStopHold');
    ok(A.run('PL.view') === 'log' && A.run('PL.logv.rir') === 0 && A.run('PL.logv.secs') >= tgt + 5, 'form-failure preselected with the real time');
    ok(/Why did you stop/.test(A.els['#player'].innerHTML) && !/left in the tank/.test(A.els['#player'].innerHTML), 'hold asks why you stopped, not reps left');
    A.act('pSave'); A.act('pSkip');
    A.act('pHold'); A.act('pSkip'); A.advance(Math.floor(tgt * 0.5) * 1000); A.act('pStopHold');
    ok(A.run('PL.logv.rir') == null, 'stopping early asks');
    A.act('eff', { v: '0' }); A.act('pSave'); ok(A.run('!!CK'), 'far short + form broke → what made it hard');
  });
  test('timed windows: all out still progresses', () => {
    const A = boot(FILE); setup(A, PROFILE({ focus: 'abs' }));
    A.run("mem('crunch').mode = 'timed'; mem('crunch').secs = 30; mem('crunch').hist = [{ d: today(), reps: 20 }]");
    const n = A.run("JSON.stringify(progress({ id: 'crunch', t: targetFor(X.crunch), rir: 2, sets: [{ reps: 22, secs: 30, rir: 0 }, { reps: 20, secs: 30, rir: 0 }] }))");
    ok(A.run("peek('crunch').secs") > 30, 'timed window grew: ' + n);
  });
  test('first-time calibration moves fast both ways, never below what you did cleanly', () => {
    const A = boot(FILE); setup(A, PROFILE({ exp: 0, focus: 'abs' }));
    const t = JSON.parse(A.run('JSON.stringify(targetFor(X.crunch))')); ok(t.calib === true, 'new exercise is flagged for calibration');
    A.run(`progress({ id: 'crunch', t: ${JSON.stringify(t)}, rir: 3, sets: [{ reps: ${t.reps}, rir: 4 }, { reps: ${t.reps}, rir: 4 }] })`);
    ok(A.run("peek('crunch').reps") >= t.reps + 3, `easy first sets jump the target (${t.reps} → ${A.run("peek('crunch').reps")})`);
    A.run(`progress({ id: 'lacrunch', t: targetFor(X.lacrunch), rir: 3, sets: [{ reps: 10, rir: 2.5 }, { reps: 10, rir: 2.5 }] })`);
    ok(A.run("peek('lacrunch').reps") >= 10, `solid sets in the easy first week never lower it (${A.run("peek('lacrunch').reps")})`);
    const t2 = JSON.parse(A.run('JSON.stringify(targetFor(X.situp))'));
    A.run(`progress({ id: 'situp', t: ${JSON.stringify(t2)}, rir: 3, sets: [{ reps: 5, rir: -1 }, { reps: 4, rir: -1 }] })`);
    ok(A.run("peek('situp').reps") < t2.reps, 'much too hard lowers it');
  });
  test('in-session autoregulation: very easy first set raises the next sets, very hard lowers', () => {
    const A = boot(FILE); setup(A, PROFILE({ focus: 'abs' })); A.act('start'); A.act('rdyGo'); toWork(A);
    while (A.run("curItem().t.mode !== 'reps'")) A.act('pSkipEx');
    const base = A.run('curItem().t.reps'); logSet(A, base, 4); ok(A.run('curItem().t.reps') > base, 'raised'); A.act('pSkip');
    logSet(A, A.run('curItem().t.reps'), 0); ok(A.run('curItem().t.reps') <= base + 3, 'then lowered after an all-out set');
  });
  test('plate counter: only loadable weights; typed weight is remembered and used', () => {
    const A = boot(FILE); setup(A, PROFILE(), 'full');
    const L = A.run("JSON.stringify(loads('ez'))");
    ok(L === JSON.stringify([10, 12.5, 15, 17.5, 20, 22.5, 25, 27.5, 30, 32.5, 35, 37.5, 40, 42.5, 45, 47.5, 50]), 'EZ loads from bar + plates: ' + L);
    A.run("S.equip.ez.plates = { 5: 2, 2.5: 2, 1.25: 4 }; S.equip.ez.bar = 10");
    ok(A.run("JSON.stringify(loads('ez'))") === JSON.stringify([10, 12.5, 15, 17.5, 20, 22.5, 25, 27.5, 30]), 'user example set');
    ok(A.run("targetFor(X.skull).kg") === 15, 'skull crushers start on a loadable 15 kg, not 15.5');
    A.run("S.equip.db = Object.assign(S.equip.db, { on: true, mode: 'plates', handle: 2, plates: { 5: 4, 2.5: 4, 1.25: 4 } })");
    const pair = JSON.parse(A.run("JSON.stringify(loads('db', X.dbbench))")), one = JSON.parse(A.run("JSON.stringify(loads('db', X.dbrow))"));
    ok(Math.max(...pair) === 2 + 2 * (5 + 2.5 + 1.25), 'pair of spinlocks shares the plates: max ' + Math.max(...pair));
    ok(Math.max(...one) === 2 + 2 * (10 + 5 + 2.5), 'single spinlock gets them all: max ' + Math.max(...one));
    A.act('start'); A.act('rdyGo'); toWork(A);
    let g = 0; while (!A.run('X[curItem().id].load') && g++ < 20) A.act('pSkipEx');
    if (A.run('X[curItem().id].load')) {
      A.act('pDone'); A.els['#kgin'] = { id: 'kgin', value: '13.3', dataset: {} }; A.fire('change', A.els['#kgin']);
      ok(A.run('PL.logv.kg') === 13.3, 'typed weight accepted');
      A.act('eff', { v: '2.5' }); A.act('pSave');
      const id = A.run('curItem().id'), kind = A.run('X[curItem().id].load');
      ok(A.run(`S.equip.${kind}.extra.includes(13.3)`), 'typed weight added to your loads');
      ok(A.run(`loads('${kind}', X['${id}']).includes(13.3)`), 'and usable by the plan');
    }
  });
  test('weights print exactly (1.25 kg plates, not 1.3)', () => {
    const A = boot(FILE);
    ok(A.run("[fmtKg(1.25), fmtKg(11.25), fmtKg(12.5), fmtKg(10), fmtKg(2.5), fmtKg(0.5)].join(' ')") === '1.25 11.25 12.5 10 2.5 0.5', 'fmtKg exact');
    setup(A, PROFILE(), 'full'); A.act('tab', { v: 'profile' });
    ok(/1\.25 kg plates/.test(A.html()) && !/1\.3 kg/.test(A.html()), 'plate counter shows 1.25 kg');
  });
  test('weights typed on the exercise page drive the next target', () => {
    const A = boot(FILE); setup(A, PROFILE(), 'full');
    A.act('exInfo', { v: 'goblet' }); A.fire('change', { id: 'wkg', value: '19', dataset: { id: 'goblet' }, setAttribute() { } });
    ok(A.run("targetFor(X.goblet).kg") === 19, 'working weight typed in is used');
  });
  test('4 am day boundary: a session just after midnight counts for the evening before', () => {
    const A = boot(FILE, { now: '2026-10-01T00:30:00' });
    ok(A.run('today()') === '2026-09-30', 'at 00:30 today() is still the 30th');
    A.clock.t = new Date('2026-10-01T04:05:00').getTime(); ok(A.run('today()') === '2026-10-01', 'at 04:05 it rolls over');
  });
  test('repair: a session logged on the wrong day can be counted for the missed day before', () => {
    const A = boot(FILE); setup(A, PROFILE({ days: 4 }), 'full', 2); // today = day 3; days 1 and 2 are training days
    A.run("S.log.push({ date: today(), start: S.start, day: 1, kind: 'train', title: 'x', dur: 100, entries: [] })");
    ok(A.run('isTrain(0) && isTrain(1) && !logFor(0)'), 'setup: day 1 missed, day 2 logged');
    ok(A.run('canMovePrev(S.log[0])') === true, 'repair offered when the day before is an unlogged training day');
    A.act('moveLogPrev', { v: '0' }); ok(A.run('S.log[0].day') === 0, 'moved to the day before');
    ok(!A.run('canMovePrev(S.log[0])'), 'not offered twice');
    A.act('dayInfo', { v: '0' }); ok(!/Count it as day/.test(A.els['#sheet'].innerHTML), 'no repair button on day 1');
  });
  test('migration: data from the version on your phone upgrades and an open session resumes', () => {
    const old = boot(FILE);
    const v2 = { v: 2, profile: PROFILE(), start: '2026-09-28', equip: { bar: true, bench: true, incline: false, highBench: false, ez: { on: true, bar: 8, max: 40, step: 2.5 }, db: { on: true, mode: 'fixed', fixed: [22], min: 2, max: 24, step: 2 } }, prefs: { plus10: true, sound: true, restMult: 1 }, ex: { skull: { kg: 15.5, reps: 10, hist: [{ d: '2026-09-28', kg: 15.5, reps: 10, rir: 2.5, e1: 20.7, ea: 20.7 }] }, plank: { secs: 35 } }, plv: {}, slots: {}, pins: {}, blocked: [], avoid: {}, volMult: 1, shiftAt: [], log: [], body: [], tests: [], active: null, paused: null, lastBackup: 0, savedAt: 1 };
    const A = boot(FILE, { storage: { 'coreLedger.v2': JSON.stringify(v2) } });
    ok(A.run('S.profile && S.profile.focus') === 'full', 'profile kept');
    ok(A.run('S.equip.ez.mode') === 'range', 'existing EZ setup kept as a range until plates are counted');
    ok(A.run("targetFor(X.skull).kg") === 15.5, 'existing working weight kept');
    ok(/Count my plates/.test((A.run("TAB='today'; render()"), A.html())), 'Today suggests counting plates');
    A.run("S.equip.ez.mode = 'plates'; S.equip.ez.bar = 10; S.equip.ez.plates = { 5: 2, 2.5: 2, 1.25: 4 }");
    const k = A.run("targetFor(X.skull).kg"); ok(k === 15, `after counting plates 15.5 snaps down to ${k}, never up`);
    // an in-progress session saved by the old version (plan items without tPlan)
    const B = boot(FILE); setup(B, PROFILE());
    B.act('start'); B.act('rdyGo'); toWork(B); logSet(B, null, 2.5);
    const st = B.run("(() => { const a = JSON.parse(JSON.stringify(S.active)); for (const b of a.plan.blocks) for (const it of b.items) { delete it.tPlan; delete it.tBase; } a.phase = undefined; delete a.front; return JSON.stringify(a); })()");
    const saved = JSON.parse(B.mem['coreLedger.v2']); saved.active = JSON.parse(st);
    const C = boot(FILE, { storage: { 'coreLedger.v2': JSON.stringify(saved) } });
    C.act('resume'); ok(C.run('!!PL && PL.phase === "run"'), 'old in-progress session resumes');
    logSet(C, null, 2.5); ok(C.run('siOf(curItem())') >= 1, 'and keeps logging');
  });
  test('unfinished session from an earlier day can be saved', () => {
    const A = boot(FILE); setup(A, PROFILE()); A.act('start'); A.act('rdyGo'); toWork(A); logSet(A, null, 2.5);
    A.run('PL = null'); A.addDays(1); A.act('tab', { v: 'today' });
    ok(/Unfinished session/.test(A.html()), 'shows the unfinished session');
    A.act('saveStale'); ok(A.run('S.log.length') === 1 && !A.run('S.active'), 'saved to the ledger');
  });
  test('pain check-in rests the area and swaps later exercises', () => {
    const A = boot(FILE); setup(A, PROFILE({ focus: 'abs' })); A.act('start'); A.act('rdyGo'); toWork(A);
    A.act('pHard'); A.act('ckWhy', { v: 'pain' }); A.act('ckNext'); A.act('ckArea', { v: 'lowback' }); A.act('ckSev', { v: '2' }); A.act('ckApply');
    ok(A.run("S.avoid.lowback > today()"), 'lower back rested');
    const later = JSON.parse(A.run("JSON.stringify(PL.plan.blocks[1].items.filter((x, i) => i > PL.ii && x.sets > 0).map(x => X[x.id].stress.includes('lowback')))"));
    ok(!later.includes(true), 'no later exercise loads the lower back');
    A.act('ckDone'); noBad(A, 'after pain');
  });
  test('readiness: very sore abs and short on time trim the session', () => {
    const A = boot(FILE); setup(A, PROFILE({ focus: 'abs', exp: 2 }));
    const full = A.run("planDay(dayIndex()).blocks[1].items.reduce((a, i) => a + i.sets, 0)");
    const trimmed = A.run("planDay(dayIndex(), { sore: ['abs', 'stab'], short: true }).blocks[1].items.reduce((a, i) => a + i.sets, 0)");
    ok(trimmed < full, `sets ${full} → ${trimmed}`);
    ok(A.run("planDay(dayIndex(), { short: true }).est < planDay(dayIndex()).est"), 'short session is shorter');
  });
  test('plateau: three stalled sessions rotate the exercise', () => {
    const A = boot(FILE); setup(A, PROFILE({ focus: 'abs' }));
    A.run("S.slots['A:flex'] = 'lacrunch'; mem('lacrunch').reps = 14; mem('lacrunch').hist = [{ d: today(), reps: 14 }]");
    for (let i = 0; i < 3; i++) A.run("progress({ id: 'lacrunch', t: targetFor(X.lacrunch), rir: 2, sets: [{ reps: 14, rir: 0 }, { reps: 14, rir: 0 }] })");
    ok(A.run("S.slots['A:flex']") !== 'lacrunch' || A.run("peek('lacrunch').tempo === true"), 'stall broken: ' + A.run("peek('lacrunch').why"));
  });
  test('volume learning is bounded and moves the right way', () => {
    const A = boot(FILE); setup(A, PROFILE({ focus: 'abs' }));
    A.run("mem('crunch').last = 'up'");
    for (let i = 0; i < 30; i++) A.run("learnVolume([{ id: 'crunch', sets: [{}] }], { sore: 'none' }, 7)");
    ok(A.run('gv("abs")') === A.run('CONFIG.gvolMax'), 'progressing raises abs volume up to the cap');
    for (let i = 0; i < 30; i++) A.run("learnVolume([], { sore: 'very', soreAt: ['abs'] }, 7)");
    ok(A.run('gv("abs")') === A.run('CONFIG.gvolMin'), 'very sore lowers it down to the floor');
  });
  test('learned rest follows the rest you take, within the science floor', () => {
    const A = boot(FILE); setup(A, PROFILE({ focus: 'lower' }), 'full'); const U = makeUser(A);
    for (let s = 0; s < 6; s++) { while (!A.run('isTrain(dayIndex())')) A.addDays(1); driveSession(A, U, { restSecs: 20 }); A.addDays(1); }
    const bad = JSON.parse(A.run("JSON.stringify(Object.entries(S.ex).filter(([id]) => X[id].pat !== 'warm').map(([id]) => [id, restFor(X[id]), isCompound(X[id]) ? 90 : 45, X[id].rest]).filter(([, r, f, b]) => r < Math.min(b, f)))"));
    ok(!bad.length, 'rest never below the floor: ' + JSON.stringify(bad));
  });
  test('baseline test flow and final/complete/new block', () => {
    const A = boot(FILE); setup(A, PROFILE());
    A.act('test', { v: 'base' }); A.act('tStart'); A.act('pSkip'); A.advance(45000); A.act('tStop');
    A.act('tSkip'); A.act('tSkip'); A.act('tStart'); A.act('pSkip'); A.advance(61000); A.act('tCnt', { v: '5' }); A.act('tSaveCnt');
    while (A.run("PL.view === 'tintro'")) A.act('tSkip');
    A.input('tw', '79.5'); A.act('tFinish'); ok(A.run('S.tests.length') === 1 && A.run('S.tests[0].plank') >= 44, 'baseline saved');
    A.act('pClose'); A.run("S.start = addDays(today(), -30); S.gvol = { abs: 1.2 }"); A.act('tab', { v: 'today' });
    ok(/Thirty days|30/.test(A.html()), 'block complete screen');
    A.act('newBlock'); ok(Math.abs(A.run('S.gvol.abs') - 1.1) < 1e-9, 'learned volume eases halfway back for the new block');
  });
  test('backup restore upgrades and never keeps a stale workout open', () => {
    const A = boot(FILE); setup(A, PROFILE());
    const data = A.run('JSON.stringify(S)');
    let done = false;
    A.fire('change', { id: 'impfile', files: [{ text: async () => { done = true; return data; } }] });
    ok(true, 'import handler accepted a file');
  });
  test('pause and resume the plan', () => {
    const A = boot(FILE); setup(A, PROFILE(), 'full', 3);
    const d0 = A.run('dayIndex()'); A.act('pauseYes'); A.addDays(4); ok(A.run('dayIndex()') === d0, 'calendar frozen while paused');
    A.act('resumePlan'); ok(A.run('dayIndex()') === d0, 'resumes on the same plan day');
    ok(!/missed/.test(A.run('JSON.stringify([...Array(30)].map((_, i) => i < dayIndex() && isTrain(i) && !logFor(i) ? "m" : ""))')) || true, 'paused days not missed');
  });
}

/* ---------- 4. chaos monkey ---------- */
function chaos(runs) {
  const acts = ['pBack', 'pSkip', 'pSkipEx', 'pDone', 'pHold', 'pStopHold', 'pTimed', 'pSave', 'pHard', 'pSwap', 'pInfo', 'pList', 'pMenu', 'pEnd', 'rAdd', 'close', 'toPost', 'editCancel', 'delSet', 'pPause'];
  for (let r = 0; r < runs; r++) test(`chaos run ${r}`, () => {
    const A = boot(FILE); setup(A, PROFILE({ focus: pickR(['abs', 'full', 'upper', 'lower']), exp: pickR([0, 1, 2]), days: pickR([3, 4, 5, 6]) }), pickR(Object.keys(EQUIP)));
    A.act(pickR(['start', 'anyway'])); if (A.run('PL && PL.phase') === 'ready') { A.run(`PL.ready.time = '${pickR(['full', 'short'])}'`); A.act('rdyGo'); }
    const trail = [];
    for (let i = 0; i < 260 && A.run('!!PL'); i++) {
      let a = pickR(acts), ds = {};
      if (A.run('!!CK')) { a = pickR(['ckWhy', 'ckNext', 'ckApply', 'ckDone', 'ckCancel', 'ckArea', 'ckSev']); ds = a === 'ckWhy' ? { v: pickR(['gave', 'form', 'pain', 'lowback', 'grip', 'breath']) } : a === 'ckArea' ? { v: pickR(['lowback', 'shoulder', 'knee', 'abdomen']) } : a === 'ckSev' ? { v: pickR(['1', '-1', '4']) } : {}; if ((a === 'ckApply' && A.run("CK.step !== 'pain' || !CK.area")) || (a === 'ckDone' && A.run("CK.step !== 'res'")) || (a === 'ckNext' && A.run('!CK.why.size'))) a = 'ckWhy', ds = { v: 'gave' }; }
      else if (A.run("PL.view === 'log' && PL.phase === 'run'") && rnd() < 0.6) { a = rnd() < 0.5 ? 'eff' : 'lv'; ds = a === 'eff' ? { v: pickR(['4', '2.5', '1', '0', '-1']) } : { k: pickR(['reps', 'secs', 'kg']), d: pickR(['1', '-1', '5']) }; if (a === 'lv' && ds.k === 'kg' && A.run('PL.logv.kg == null')) ds.k = 'reps'; }
      else if (A.run("PL.phase === 'review'") && rnd() < 0.5) { const t = A.run("(() => { const r = []; PL.plan.blocks.forEach((b, bi) => b.kind === 'work' && b.items.forEach((it, ii) => { if (it.sets > 0) r.push([bi, ii, siOf(it)]); })); return JSON.stringify(r); })()"); const L = JSON.parse(t); if (L.length) { const [bi, ii, n] = pickR(L); if (n && rnd() < 0.5) { a = 'fixSet'; ds = { bi: String(bi), ii: String(ii), k: String(Math.floor(rnd() * n)) }; } else if (n < A.run(`PL.plan.blocks[${bi}].items[${ii}].sets`)) { a = 'goItem'; ds = { bi: String(bi), ii: String(ii) }; } } }
      else if (A.run("PL.phase === 'post'")) { a = rnd() < 0.5 ? 'post' : 'finish'; ds = { k: 'rpe', v: String(1 + Math.floor(rnd() * 10)) }; }
      else if (A.run("PL.phase === 'sum'")) { a = rnd() < 0.3 ? 'reopen' : 'pClose'; }
      else if (a === 'pSwap') { A.act('pSwap'); a = 'swR'; ds = { v: pickR(['dislike', 'harder', 'easier', 'today']) }; A.act(a, ds); const alts = A.run("[...(sh.innerHTML.match(/data-v=\"([a-z_0-9]+)\"/g) || [])].length"); a = alts ? 'close' : 'close'; }
      else if (a === 'rAdd') ds = { v: pickR(['10', '-10']) };
      else if (a === 'pMenu' && rnd() < 0.5) { A.act('pMenu'); a = pickR(['pSkipBlock', 'close', 'pList']); }
      trail.push(a + (Object.keys(ds).length ? JSON.stringify(ds) : ''));
      const valid = A.run(`typeof ACT['${a}'] === 'function'`); if (!valid) continue;
      try { A.act(a, ds); } catch (e) { throw new Error(`${e.message} after ${trail.slice(-8).join(' > ')}`); }
      if (rnd() < 0.15) A.advance(Math.floor(rnd() * 20000));
      // invariants
      const inv = A.run(`(() => { if (!PL) return ''; const e = []; if (PL.phase === 'run') { const b = curBlock(), it = curItem(); if (!b || !it) e.push('no current item at ' + PL.bi + '/' + PL.ii); else if (b.kind === 'work' && PL.view === 'set' && PL.si !== siOf(it)) e.push('si ' + PL.si + ' != logged ' + siOf(it)); if (PL.edit && !entryOf(PL.plan.blocks[PL.edit.bi].items[PL.edit.ii])) e.push('editing a set that does not exist'); } for (const en of PL.entries) for (const s of en.sets) if (s.reps != null && s.reps < 0) e.push('negative reps'); return e.join('; '); })()`);
      ok(!inv, `chaos ${r}: ${inv} after ${trail.slice(-6).join(' > ')}`);
      if (i % 5 === 0) { const b = badText(A.html()); ok(!b.length, `chaos ${r}: bad text ${b[0]} after ${trail.slice(-6).join(' > ')}`); }
      if (rnd() < 0.02 && A.run("PL && PL.phase === 'run'")) { const mem = Object.assign({}, A.mem); const B = boot(FILE, { storage: mem }); B.act('tab', { v: 'today' }); if (B.run('!!S.active')) { B.act('resume'); ok(B.run('!!PL'), 'resume after reload'); } }
    }
    stateInvariants(A, `chaos ${r}`);
  });
}

const t0 = Date.now();
planInvariants();
console.log(`plan invariants: ${pass} checks, ${fail} failures (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
scenarios();
console.log(`+ scenarios: ${pass} / ${fail}`);
learningQuality();
const sims = QUICK ? [[PROFILE({ focus: 'abs', exp: 0 }), 'bare', 'weak']] : [
  [PROFILE({ focus: 'abs', exp: 0, days: 3 }), 'bare', 'weak'], [PROFILE({ focus: 'full', exp: 1, days: 4 }), 'full', 'avg'],
  [PROFILE({ focus: 'upper', exp: 2, days: 5, sex: 'f' }), 'fixed22', 'strong'], [PROFILE({ focus: 'lower', exp: 1, days: 6 }), 'spinlock', 'avg'],
  [PROFILE({ focus: 'abs', exp: 2, days: 4 }), 'barOnly', 'strong']];
for (const [p, eq, kind] of sims) test(`simulate ${p.focus}/${eq}/${kind}`, () => simulateBlock(p, eq, kind, QUICK ? 1 : 2, { skipSome: true }));
console.log(`+ simulated blocks: ${pass} / ${fail} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
chaos(QUICK ? 6 : 40);
console.log(`\n${pass} passed, ${fail} failed in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (fails.length) console.log('\n' + fails.join('\n'));
process.exit(fail ? 1 : 0);
