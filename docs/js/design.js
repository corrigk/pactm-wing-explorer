// Design evaluation, requirement checks, grid search (port of src/design_space.py).
import { CONST, CONSTRAINTS } from './config.js';
import { Wing, HALF_GRID } from './liftingLine.js';
import { computeCD0 } from './drag.js';
import { halfWingLoads, requiredI, sizeSpar, tipDeflectionIntegral } from './spar.js';
import { linspace } from './numerics.js';

/** Weight, wing C_L^max and the planform area that gives the stall speed. */
export function sizing(af, p) {
  const W = p.mass * CONST.g;
  const CLmax = p.knockdown * af.clmax;
  const Sreq = (2 * W) / (CONST.rho * p.vStall ** 2 * CLmax);
  return { W, CLmax, Sreq };
}

/** All requirements for one design. af = {clmax, aL0, tc}. */
export function evaluate(af, AR, lam, p) {
  const { W, Sreq } = sizing(af, p);
  const S = Sreq;
  const aL0 = af.aL0 + p.aL0Shift;
  const wing = new Wing(S, AR, lam);
  const b = wing.b;
  const CLcr = (2 * W) / (CONST.rho * p.vCruise ** 2 * S);
  const alphaCr = wing.alphaForCL(CLcr, aL0);
  const Vland = p.landFactor * p.vStall;
  const CLland = (2 * W * Math.cos((p.descentDeg * Math.PI) / 180)) / (CONST.rho * Vland ** 2 * S);
  const alphaLand = wing.alphaForCL(CLland, aL0);

  // loads at cruise lift; the landing c_l(y) has the same shape scaled by CLland/CLcr (untwisted wing)
  const loads = halfWingLoads(wing, CLcr, { ...p, W });
  const dist = wing.distribution(CLcr, HALF_GRID);
  const clPeakCruise = Math.max(...dist.cl);
  const clPeakLand = (clPeakCruise * CLland) / CLcr;
  const landRatio = clPeakLand / af.clmax;

  const Ireq = requiredI(loads, b, p);
  const Mroot = loads.moment[0];
  const spar = sizeSpar(Ireq, Mroot, wing.ct, af.tc, p);
  const deltaTip = tipDeflectionIntegral(loads) / (p.E * spar.I);

  const cd0 = computeCD0(p.vCruise, af.tc, S, b);
  const CDi = wing.CDi(CLcr);
  const CD = cd0.total + CDi;
  const viol = {
    alpha: Math.max(0, alphaCr - p.alphaMax, p.alphaMin - alphaCr) / 4,
    span: Math.max(0, b / p.spanMax - 1),
    land: Math.max(0, landRatio - 1),
    fit: spar.fitExcess,
    stress: Math.max(0, spar.sigma / p.yieldStress - 1),
  };
  return { AR, lam, S, b, cr: wing.cr, ct: wing.ct, aw: wing.awDeg, e: wing.e, CLcr, alphaCr, CLland, alphaLand,
    landRatio, clPeakCruise, clPeakLand, Ireq, spar, deltaPct: (100 * deltaTip) / b, Mroot,
    CD0: cd0.total, cd0Parts: cd0, CDi, CD, LD: CLcr / CD, viol, aL0, W };
}

export const totalViolation = (r, on) => CONSTRAINTS.reduce((s, k) => s + (on[k] ? r.viol[k] : 0), 0);
export const isFeasible = (r, on) => CONSTRAINTS.every((k) => !on[k] || r.viol[k] <= 0);
export const violated = (r, on) => CONSTRAINTS.filter((k) => on[k] && r.viol[k] > 0);

/** Search grid: same as the Python scripts (AR from arMin to the span limit, taper in 0.05 steps). */
export function searchGrid(af, p) {
  const { Sreq } = sizing(af, p);
  const arMax = p.spanMax ** 2 / Sreq;
  const ars = linspace(CONST.arMin, Math.max(arMax, CONST.arMin + 0.5), CONST.nAR);
  const lams = [];
  for (let l = CONST.taperMin; l <= CONST.taperMax + 1e-9; l += CONST.taperStep) lams.push(Math.round(l * 1e6) / 1e6);
  return { ars, lams, arMax };
}

export function scan(af, ars, lams, p) {
  return lams.map((lam) => ars.map((AR) => evaluate(af, AR, lam, p)));
}

/** Highest L/D among designs meeting every enabled requirement; else least total violation, then L/D. */
export function pickBest(res, on) {
  let best = null, bestOk = false;
  for (const row of res) for (const r of row) {
    const ok = isFeasible(r, on);
    if (ok) {
      if (!bestOk || r.LD > best.LD) { best = r; bestOk = true; }
    } else if (!bestOk) {
      if (!best || totalViolation(r, on) < totalViolation(best, on) - 1e-9
        || (Math.abs(totalViolation(r, on) - totalViolation(best, on)) <= 1e-9 && r.LD > best.LD)) best = r;
    }
  }
  return { best, ok: bestOk };
}
