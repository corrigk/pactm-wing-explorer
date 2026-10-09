// Check the JavaScript port against results exported from the Python code (tests/js_reference.json).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DEFAULTS, CONSTRAINTS } from '../../docs/js/config.js';
import { AIRFOILS } from '../../docs/js/airfoilData.js';
import { evaluate, searchGrid, scan, pickBest } from '../../docs/js/design.js';

const here = dirname(fileURLToPath(import.meta.url));
const ref = JSON.parse(readFileSync(join(here, '..', 'js_reference.json'), 'utf8'));
const on = Object.fromEntries(CONSTRAINTS.map((k) => [k, true]));
let fails = 0;

function close(label, js, py, rel = 2e-3, abs = 1e-9) {
  const ok = Math.abs(js - py) <= Math.max(abs, rel * Math.abs(py));
  if (!ok) { fails++; console.log(`  FAIL ${label}: js ${js} vs python ${py}`); }
  return ok;
}

function compare(name, r, py) {
  close(`${name} b`, r.b, py.b, 1e-6);
  close(`${name} S`, r.S, py.S, 1e-4);
  close(`${name} CL_cruise`, r.CLcr, py.CL_cruise, 1e-4);
  close(`${name} alpha_cruise`, r.alphaCr, py.alpha_cruise, 1e-3, 2e-3);
  close(`${name} alpha_land`, r.alphaLand, py.alpha_land, 1e-3, 2e-3);
  close(`${name} a_w`, r.aw, py.a_w, 1e-6);
  close(`${name} e`, r.e, py.e, 1e-6);
  close(`${name} CD0`, r.CD0, py.CD0, 1e-4);
  close(`${name} CDi`, r.CDi, py.CDi, 1e-4);
  close(`${name} L/D`, r.LD, py.LD, 1e-4);
  close(`${name} land_ratio`, r.landRatio, py.land_ratio, 2e-3);
  close(`${name} M_root`, r.Mroot, py.M_root, 2e-3);
  close(`${name} I_req`, r.Ireq, py.I_req, 3e-3);
  close(`${name} defl %`, r.deltaPct, py.delta_pct, 5e-3);
  if (r.spar.kind !== py.spar_kind) { fails++; console.log(`  FAIL ${name} spar kind ${r.spar.kind} vs ${py.spar_kind}`); }
  else if (r.spar.kind === 'rect') {
    close(`${name} spar w`, r.spar.w, py.spar_w, 1e-6, 1e-9);
    close(`${name} spar h`, r.spar.h, py.spar_h, 1e-6, 1e-9);
  } else close(`${name} spar d`, r.spar.d, py.spar_d, 1e-6, 1e-9);
  close(`${name} sigma`, r.spar.sigma, py.sigma, 5e-3);
}

console.log('best design per airfoil (grid search)');
for (const [name, py] of Object.entries(ref.best)) {
  const af = AIRFOILS[name];
  const { ars, lams } = searchGrid(af, DEFAULTS);
  const { best, ok } = pickBest(scan(af, ars, lams, DEFAULTS), on);
  const same = Math.abs(best.AR - py.AR) < 1e-6 && Math.abs(best.lam - py.lam) < 1e-9 && ok === py.feasible;
  console.log(`  ${name.padEnd(19)} js AR ${best.AR.toFixed(3)} lam ${best.lam.toFixed(2)} L/D ${best.LD.toFixed(3)}   `
    + `python AR ${py.AR.toFixed(3)} lam ${py.lam.toFixed(2)} L/D ${py.LD.toFixed(3)}  ${same ? 'same design' : 'DIFFERENT DESIGN'}`);
  if (!same) fails++;
  compare(name, evaluate(af, py.AR, py.lam, DEFAULTS), py);
}
console.log('probe points');
for (const py of ref.points) compare(`${py.airfoil} @ AR ${py.AR} lam ${py.lam}`, evaluate(AIRFOILS[py.airfoil], py.AR, py.lam, DEFAULTS), py);

console.log(fails ? `\n${fails} check(s) FAILED` : '\nall JavaScript checks match the Python reference');
process.exit(fails ? 1 : 0);
