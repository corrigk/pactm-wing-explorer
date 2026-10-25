// HW7 tail and trim: JavaScript against the hand-calculation golden values and the Python design reference.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as T from '../../docs/js/tail.js';
import { AIRFOILS } from '../../docs/js/airfoilData.js';
import { DEFAULTS, CONSTRAINTS } from '../../docs/js/config.js';
import { bestFor } from '../../docs/js/jobs.js';

const here = dirname(fileURLToPath(import.meta.url));
const ref = JSON.parse(readFileSync(join(here, '..', 'js_tail_reference.json'), 'utf8'));
const D = Math.PI / 180;
let fails = 0;
const close = (label, a, b, tol) => { const ok = Math.abs(a - b) <= tol; if (!ok) { fails++; console.log(`  FAIL ${label}: js ${a} vs ${b}`); } };

console.log('golden values (hand calculations)');
{ // PACTM, HW7 Part 2
  const ARw = 5.974591, cbar = 0.258448, St = 0.059583, Sw = 0.370318, ARt = 2.996993, lt = 0.569272, a0w = -2.216 * D;
  const r = St / Sw, CLaW = T.clAlphaEmpirical(ARw), CLaT = T.clAlphaEmpirical(ARt), deps = T.downwashGradient(CLaW, ARw);
  close('C_Lalpha wing', CLaW, 4.522579, 2e-6); close('C_Lalpha tail', CLaT, 3.360788, 2e-6); close('deps', deps, 0.481901, 2e-6);
  close('eps0', T.epsilon0(deps, 0, a0w), 0.018638, 2e-6); close('V_H', T.tailVolume(r, lt, cbar), 0.354401, 2e-6);
  const d = T.airplaneDerivs(CLaW, CLaT, deps, r, lt, cbar, 0.17);
  close('C_Lalpha airplane', d.CLa, 4.802736, 2e-6); close('C_Malpha', d.CMa, -1.001309, 2e-6); close('SM', d.SM, 0.208487, 2e-6);
  close('stability line, lecture', T.stabilityLine(0.17, CLaW, CLaT, deps, lt, cbar, 0.208487, 0.25, true), 0.160897, 2e-6);
  close('stability line, HW7', T.stabilityLine(0.17, CLaW, CLaT, deps, lt, cbar, 0.208487, 0.25, false), 0.170735, 2e-6);
  const t = T.trimCruise(0.547836, 0.17, r, lt, cbar, -0.055, CLaW, CLaT, deps, a0w, 0);
  close('cruise alpha_FRL [deg]', t.alphaFrl / D, 5.292854, 2e-5); close('cruise i_t [deg]', t.it / D, -6.428350, 2e-5);
}
{ // small UAV, HW7 Part 1
  const CLaW = T.clAlphaEmpirical(6), CLaT = T.clAlphaEmpirical(4), deps = T.downwashGradient(CLaW, 6), r = 0.08 / 0.7;
  const d = T.airplaneDerivs(CLaW, CLaT, deps, r, 1.1, 0.3, 0.28);
  close('UAV V_H', d.VH, 0.419048, 2e-6); close('UAV C_Lalpha', d.CLa, 4.759213, 2e-6); close('UAV SM', d.SM, 0.147624, 2e-6);
  close('UAV C_Malpha', d.CMa, -0.702573, 2e-6);
  for (const [it, CL, aF] of [[0, 0.851241, 4.354150], [-3, 1.400445, 11.245713]]) {
    const s = T.trimGivenIncidences(3 * D, it * D, 0.28, r, 1.1, 0.3, -0.05, CLaW, CLaT, deps, -3.5 * D);
    close(`UAV C_L,trim (i_t ${it})`, s.CL, CL, 2e-6); close(`UAV alpha_FRL (i_t ${it})`, s.alphaFrl / D, aF, 2e-5);
  }
}

console.log('six-airfoil design cycle vs Python (HW7 defaults)');
const on = Object.fromEntries(CONSTRAINTS.map((k) => [k, true]));
for (const [name, r] of Object.entries(ref)) {
  const af = AIRFOILS[name];
  const hw6 = bestFor(af, DEFAULTS, on);
  const wi = T.wingInputs(af, hw6, DEFAULTS);
  for (const mode of ['fit', 'fixed']) {
    const py = r[mode];
    const js = mode === 'fit' ? T.designAutoFit(wi, T.TAIL_DEFAULTS) : T.designAuto(wi, T.TAIL_DEFAULTS, 1.0);
    if (js.feasible !== py.feasible) { fails++; console.log(`  FAIL ${name} ${mode} feasibility`); continue; }
    // CG limits come from a 0.0005-MAC grid; a line tying with r at a node can move a limit by one grid step,
    // so design values are compared to that resolution. t/c is stored to 5 decimals on the web (C_D0 ~1e-7).
    const pairs = [['r', js.r, py.r, 1e-9], ['xcg', js.xcg, py.xcg, 6e-4], ['l_t', js.lt, py.lt, 1e-4], ['SM', js.SMlec, py.SM_lecture, 1e-3],
      ['SM hw7', js.SMhw7, py.SM_hw7, 1e-3], ['i_w', js.iw, py.i_w, 1e-4], ['i_t', js.it, py.i_t, 5e-4], ['C_D0', js.CD0, py.CD0, 1e-6],
      ['C_D', js.CD, py.CD, 1e-5], ['L/D', js.LD, py.LD, 5e-3], ['L_total', js.Ltotal, py.L_total, 1e-4], ['e_t', js.eT, py.e_t, 1e-6]];
    let bad = 0;
    for (const [k, a, b, tol] of pairs) { const before = fails; close(`${name} ${mode} ${k}`, a, b, tol); bad += fails - before; }
    console.log(`  ${bad ? 'FAIL' : 'ok  '} ${name.padEnd(19)} ${mode.padEnd(5)} S_t/S_w ${js.r.toFixed(4)}  x_cg ${js.xcg.toFixed(4)}  L/D ${js.LD.toFixed(3)} (python ${py.LD.toFixed(3)})`);
  }
}
console.log(fails ? `\n${fails} check(s) FAILED` : '\nall tail checks pass');
process.exit(fails ? 1 : 0);
