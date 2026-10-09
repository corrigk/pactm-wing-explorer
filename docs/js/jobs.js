// Heavy jobs shared by the worker and the main-thread fallback: map grid, best design, airfoil table.
import { AIRFOILS } from './airfoilData.js';
import { CONST, CONSTRAINTS } from './config.js';
import { evaluate, searchGrid, scan, pickBest } from './design.js';

const summary = (r, ok) => ({
  AR: r.AR, lam: r.lam, S: r.S, b: r.b, alphaCr: r.alphaCr, CD: r.CD, LD: r.LD, viol: r.viol, ok,
  spar: { kind: r.spar.kind, w: r.spar.w, h: r.spar.h, d: r.spar.d },
});

/** Map grid on a fixed AR lattice (0.25 steps) so cached (AR, lambda) solutions are reused across changes. */
function mapGrid(af, p) {
  const { arMax } = searchGrid(af, p);
  const hi = Math.max(CONST.arMin + 3, Math.ceil((arMax * 1.25) / 0.25) * 0.25);
  const ars = [];
  for (let a = CONST.arMin; a <= hi + 1e-9; a += 0.25) ars.push(Math.round(a * 1e6) / 1e6);
  const lams = [];
  for (let l = CONST.taperMin; l <= CONST.taperMax + 1e-9; l += CONST.taperStep / 2) lams.push(Math.round(l * 1e6) / 1e6);
  return { ars, lams, arMax };
}

export function bestFor(af, p, on) {
  const g = searchGrid(af, p);
  const b = pickBest(scan(af, g.ars, g.lams, p), on);
  return summary(b.best, b.ok);
}

export function runJob(job, post) {
  const { id, airfoil, p, on, table } = job;
  const af = AIRFOILS[airfoil];
  const { ars, lams, arMax } = mapGrid(af, p);
  const nA = ars.length, nL = lams.length;
  const fields = Object.fromEntries(CONSTRAINTS.map((k) => [k, new Float32Array(nA * nL)]));
  const LD = new Float32Array(nA * nL);
  for (let j = 0; j < nL; j++) {
    for (let i = 0; i < nA; i++) {
      const r = evaluate(af, ars[i], lams[j], p);
      const o = j * nA + i;
      for (const k of CONSTRAINTS) fields[k][o] = r.viol[k];
      LD[o] = r.LD;
    }
  }
  post({ id, type: 'map', ars, lams, fields, LD, arMax, on, best: bestFor(af, p, on) },
    [...Object.values(fields).map((f) => f.buffer), LD.buffer]);
  if (!table) return;
  const rows = Object.keys(AIRFOILS).map((name) => ({ name, ...bestFor(AIRFOILS[name], p, on) }));
  post({ id, type: 'table', rows });
}
