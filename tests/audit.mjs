/* Programme audit: weekly muscle volume, pattern frequency and exercise-order conflicts
   for every profile combination. Usage: node tests/audit.mjs [path/to/index.html] */
import { boot } from './harness.mjs';
const file = process.argv[2] || new URL('../index.html', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

const rows = [];
let conflicts = 0, lowFreq = 0, samples = [];
for (const focus of ['abs', 'full', 'upper', 'lower'])
  for (const exp of [0, 1, 2])
    for (const days of [3, 4, 5, 6]) {
      const A = boot(file);
      A.run(`S.profile = { sex: 'm', age: 30, height: 180, weight: 80, exp: ${exp}, focus: '${focus}', body: 'recomp', days: ${days} };
        S.start = today(); S.body = [{ date: today(), w: 80 }];
        S.equip.db = { on: true, mode: 'adj', fixed: [], min: 2, max: 30, step: 2 };`);
      const r = JSON.parse(A.run(`(() => {
        const wk = { sets: {}, freq: {}, conf: [] };
        for (let d = 7; d < 14; d++) {
          if (!isTrain(d)) continue;
          const p = planDay(d), work = p.blocks[1].items.filter(i => i.sets > 0);
          const seen = new Set();
          work.forEach((it, i) => {
            const e = X[it.id];
            e.m.forEach(k => wk.sets[k] = (wk.sets[k] || 0) + it.sets);
            e.m2.forEach(k => wk.sets[k] = (wk.sets[k] || 0) + it.sets * 0.5);
            if (!seen.has(e.pat)) { seen.add(e.pat); wk.freq[e.pat] = (wk.freq[e.pat] || 0) + 1; }
            const prev = work[i - 1] && X[work[i - 1].id];
            if (prev) {
              if (prev.stress.includes('grip') && e.stress.includes('grip')) wk.conf.push('grip: ' + prev.name + ' > ' + e.name);
              if (prev.pat === 'hinge' && e.pat === 'ext') wk.conf.push('lowback: ' + prev.name + ' > ' + e.name);
              const core = x => ['flex', 'rflex', 'rot', 'lat', 'antiext', 'ext'].includes(x.pat);
              if (core(prev) && !core(e)) wk.conf.push('core before lift: ' + prev.name + ' > ' + e.name);
              if (['antiext', 'ext'].includes(prev.pat) && prev.mode === 'hold' && ['flex', 'rflex', 'rot'].includes(e.pat) && e.lvl >= 3) wk.conf.push('easy hold before hard dynamic: ' + prev.name + ' > ' + e.name);
            }
          });
          if (d === 8 || d === 9) wk.order = (wk.order || []).concat(p.title + ': ' + work.map(i => X[i.id].name).join(' > '));
        }
        return JSON.stringify(wk);
      })()`));
      const abs = r.sets.abs || 0, obl = r.sets.obl || 0;
      const coreFreq = ['flex', 'rflex', 'rot', 'lat'].map(p => r.freq[p] || 0);
      if (Math.min(...coreFreq) < 1) lowFreq++;
      conflicts += r.conf.length;
      rows.push(`${focus.padEnd(5)} exp${exp} ${days}d | abs ${String(abs).padStart(4)} obl ${String(obl).padStart(4)} | freq flex/rflex/rot/lat ${coreFreq.join('/')} | conflicts ${r.conf.length}`);
      if (r.conf.length && samples.length < 12) samples.push(...r.conf.slice(0, 2).map(c => `${focus} exp${exp} ${days}d  ${c}`));
      if (focus !== 'abs' && exp === 1 && days === 4) samples.push(...(r.order || []).map(o => `ORDER ${focus}: ${o}`));
    }
console.log(rows.join('\n'));
console.log('\nOrder conflicts (week 2, all profiles):', conflicts, '| profiles with a core pattern missing in week 2:', lowFreq);
console.log(samples.join('\n'));
