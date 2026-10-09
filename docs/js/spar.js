// Cantilever half-wing spar: shear, moment, deflection, stress, fit (port of src/spar.py).
import { CONST } from './config.js';
import { HALF_GRID } from './liftingLine.js';
import { cumtrapzFromRoot, cumtrapzFromTip, trapz, ceilStep, floorStep } from './numerics.js';

/** Shear and moment on the right half-wing at load factor n (y runs root to tip). */
export function halfWingLoads(wing, CLcruise, p) {
  const q = 0.5 * CONST.rho * p.vCruise ** 2;
  const d = wing.distribution(CLcruise, HALF_GRID);
  const w = d.ccl.map((v) => p.loadFactor * q * v);
  const shear = cumtrapzFromTip(d.y, w);
  const moment = cumtrapzFromTip(d.y, shear);
  return { y: d.y, w, shear, moment, s: wing.b / 2 };
}

export function tipDeflectionIntegral(loads) {
  return trapz(loads.y, loads.moment.map((m, i) => m * (loads.s - loads.y[i])));
}

export const requiredI = (loads, b, p) => tipDeflectionIntegral(loads) / (p.deflFrac * b * p.E);

/** Deflection curve [m] of a constant-EI cantilever. */
export function deflectionCurve(loads, I, p) {
  const slope = cumtrapzFromRoot(loads.y, loads.moment.map((m) => m / (p.E * I)));
  return cumtrapzFromRoot(loads.y, slope);
}

/** Lightest solid spar with I >= Ireq that fits at the tip; best attempt (fitExcess > 0) if none fits. */
export function sizeSpar(Ireq, Mroot, ctip, tc, p) {
  const cands = [];
  const hMax = floorStep(tc * ctip, p.step);
  if (hMax >= p.step) {
    const w = ceilStep((12 * Ireq) / hMax ** 3, p.step);
    const wCap = p.widthFrac * ctip;
    cands.push({ kind: 'rect', w, h: hMax, area: w * hMax, I: (w * hMax ** 3) / 12, c: hMax / 2,
      fitExcess: Math.max(0, w / wCap - 1) });
  }
  const d = ceilStep(((64 * Ireq) / Math.PI) ** 0.25, p.step);
  cands.push({ kind: 'round', d, area: (Math.PI * d * d) / 4, I: (Math.PI * d ** 4) / 64, c: d / 2,
    fitExcess: Math.max(0, d / (tc * ctip) - 1) });
  const fits = cands.filter((k) => k.fitExcess <= 0);
  const best = fits.length ? fits.reduce((a, b) => (b.area < a.area ? b : a))
    : cands.reduce((a, b) => (b.fitExcess < a.fitExcess ? b : a));
  best.sigma = (Mroot * best.c) / best.I;
  best.stressOk = best.sigma <= p.yieldStress;
  return best;
}

export function describeSpar(s) {
  return s.kind === 'rect'
    ? `rectangle ${(s.w * 1e3).toFixed(0)} × ${(s.h * 1e3).toFixed(0)} mm`
    : `round Ø ${(s.d * 1e3).toFixed(0)} mm`;
}
