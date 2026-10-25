// Horizontal tail, static margin, scissor-plot limits, trim and trimmed drag (port of src/tail_trim.py and
// src/tail_design.py). Angles in radians; x-bar values are fractions of the wing MAC; r = S_t / S_w.
import { CONST } from './config.js';
import { Wing } from './liftingLine.js';
import { computeCD0 } from './drag.js';

export const TAIL_DEFAULTS = {
  ARt: 3.5, lamT: 1.0, ltMode: 'fit', lengthMax: 1.0, lt: 1.0, SM: 0.10, rangeMin: 0.08, cgFrac: 1 / 3,
  toCLt: -0.65, toCMreq: 0.15, stallAuto: true, alphaStallDeg: 9, downwashInCLa: false, xac: 0.25, kappa: 2,
};
const A0 = 2 * Math.PI;
const D = Math.PI / 180;
export const XGRID = Array.from({ length: 1201 }, (_, i) => (0.6 * i) / 1200);
const R_GRID = Array.from({ length: Math.ceil((0.80 - 0.01) / 0.0005) }, (_, k) => 0.01 + k * 0.0005);   // = np.arange(0.01, 0.80, 0.0005)

// ------------------------------------------------------------------ basic relations
export const macLinearTaper = (S, AR, lam) => {
  const b = Math.sqrt(AR * S), cr = (2 * S) / (b * (1 + lam));
  return ((2 / 3) * cr * (1 + lam + lam * lam)) / (1 + lam);
};
export const clAlphaEmpirical = (AR, a0 = A0) => (Math.PI * AR) / (1 + Math.sqrt(1 + ((Math.PI * AR) / a0) ** 2));
export const downwashGradient = (CLaW, ARw, kappa = 2) => (kappa * CLaW) / (Math.PI * ARw);
export const tailVolume = (r, lt, cbar) => (r * lt) / cbar;
export const epsilon0 = (deps, iw, a0w) => deps * (iw - a0w);

export function airplaneDerivs(CLaW, CLaT, deps, r, lt, cbar, xcg, xac = 0.25, downwashInCLa = true) {
  const VH = tailVolume(r, lt, cbar);
  const CLa = CLaW + r * CLaT * (downwashInCLa ? 1 - deps : 1);
  const CMa = (xcg - xac) * CLa - CLaT * (1 - deps) * VH;
  return { VH, CLa, CMa, SM: -CMa / CLa };
}

export function stabilityLine(x, CLaW, CLaT, deps, lt, cbar, SM = 0.10, xac = 0.25, downwashInCLa = false) {
  const f = downwashInCLa ? 1 - deps : 1;
  return (CLaW * (x - xac + SM)) / (CLaT * ((1 - deps) * (lt / cbar) - f * (x - xac + SM)));
}
export function requiredMomentRatio(x, CLw, CLt, CMacW, CMreq, lt, cbar, xac = 0.25) {
  return (CMacW + CLw * (x - xac) - CMreq) / (CLt * (lt / cbar - x + xac));
}
export const takeoffLine = (x, CLaW, iw, CMacW, lt, cbar, CLt = -0.65, CMreq = 0.15, xac = 0.25) =>
  requiredMomentRatio(x, CLaW * iw, CLt, CMacW, CMreq, lt, cbar, xac);
export const stallRecoveryLine = (x, CLmaxW, CLaT, aStall, CMacW, lt, cbar, SM = 0.10, xac = 0.25) =>
  requiredMomentRatio(x, CLmaxW, CLaT * aStall, CMacW, -CLmaxW * SM + CMacW, lt, cbar, xac);

/** Longest contiguous run of XGRID where r >= every line (arrays on XGRID). Returns [xFwd, xAft] or null. */
export function feasibleCgRange(r, lines) {
  let best = null, start = -1;
  for (let i = 0; i <= XGRID.length; i++) {
    const ok = i < XGRID.length && lines.every((l) => Number.isFinite(l[i]) && r >= l[i]);
    if (ok && start < 0) start = i;
    if (!ok && start >= 0) {
      const seg = [XGRID[start], XGRID[i - 1]];
      if (!best || seg[1] - seg[0] > best[1] - best[0]) best = seg;
      start = -1;
    }
  }
  return best;
}

export function trimCruise(CL, xcg, r, lt, cbar, CMacW, CLaW, CLaT, deps, a0w, iw = null, alphaFrlTrim = 0, xac = 0.25) {
  const VH = tailVolume(r, lt, cbar);
  const CLt = (CMacW + CL * (xcg - xac)) / VH;
  const CLw = CL - r * CLt;
  const alphaW = a0w + CLw / CLaW;
  const iW = iw == null ? alphaW - alphaFrlTrim : iw;
  const alphaFrl = alphaW - iW;
  const it = CLt / CLaT - alphaFrl * (1 - deps) + epsilon0(deps, iW, a0w);
  return { CLt, CLw, alphaW, alphaFrl, iw: iW, it, VH };
}

export function trimGivenIncidences(iw, it, xcg, r, lt, cbar, CMacW, CLaW, CLaT, deps, a0w, xac = 0.25) {
  const e0 = epsilon0(deps, iw, a0w);
  const f = (a) => {
    const CLw = CLaW * (a + iw - a0w), CLt = CLaT * (a * (1 - deps) + it - e0);
    return [CLw + r * CLt, CMacW + (CLw + r * CLt) * (xcg - xac) - (r * CLt * lt) / cbar];
  };
  const [c0, m0] = f(0), [c1, m1] = f(1);
  const a = -m0 / (m1 - m0);
  return { CL: c0 + (c1 - c0) * a, alphaFrl: a };
}

export function trimmedDrag(CL, CD0, xcg, r, lt, cbar, CMacW, eW, ARw, eT, ARt, xac = 0.25) {
  const CLt = (CMacW + CL * (xcg - xac)) / ((r * lt) / cbar);
  const CLw = CL - r * CLt;
  return CD0 + (CLw * CLw) / (Math.PI * eW * ARw) + (r * CLt * CLt) / (Math.PI * eT * ARt);
}

// ------------------------------------------------------------------ design cycle
/** Wing quantities for the tail design. wing = {S, AR, lam}; af = airfoil data (aL0, clmax, tc, cmac); p = mission. */
export function wingInputs(af, wing, p) {
  const w = new Wing(wing.S, wing.AR, wing.lam);
  const W = p.mass * 9.81;
  return {
    S: wing.S, AR: wing.AR, lam: wing.lam, b: w.b, cbar: macLinearTaper(wing.S, wing.AR, wing.lam), CLa: w.aw, e: w.e,
    alpha0: (af.aL0 + (p.aL0Shift || 0)) * D, CLmax: p.knockdown * af.clmax, CMac: af.cmac,
    CLcr: (2 * W) / (CONST.rho * p.vCruise ** 2 * wing.S), tc: af.tc, vCruise: p.vCruise,
  };
}

function lines(wi, t, iw, CLaT, deps, lt, aStall) {
  return [
    XGRID.map((x) => stabilityLine(x, wi.CLa, CLaT, deps, lt, wi.cbar, t.SM, t.xac, t.downwashInCLa)),
    XGRID.map((x) => takeoffLine(x, wi.CLa, iw, wi.CMac, lt, wi.cbar, t.toCLt, t.toCMreq, t.xac)),
    XGRID.map((x) => stallRecoveryLine(x, wi.CLmax, CLaT, aStall, wi.CMac, lt, wi.cbar, t.SM, t.xac)),
  ];
}

/** Smallest r on the grid whose feasible CG range is at least rangeMin wide. */
function selectTail(L, rangeMin) {
  for (const r of R_GRID) {
    const rng = feasibleCgRange(r, L);
    if (rng && rng[1] - rng[0] >= rangeMin - 1e-9) return { r, rng };
  }
  return null;
}

/** Evaluate a design point (r, xcg) with a given i_w-consistent trim; shared by auto and manual modes. */
function finish(wi, t, lt, r, xcg, rng, CLaT, deps, eT, L, aStall, iw0) {
  const trim = trimCruise(wi.CLcr, xcg, r, lt, wi.cbar, wi.CMac, wi.CLa, CLaT, deps, wi.alpha0, iw0);
  const St = r * wi.S, bt = Math.sqrt(t.ARt * St);
  const ct = t.lamT === 1 ? St / bt : (2 * St) / (bt * (1 + t.lamT));   // tail root chord (= chord when rectangular)
  const cd0 = computeCD0(wi.vCruise, wi.tc, wi.S, wi.b, St, ct);
  const CD = trimmedDrag(wi.CLcr, cd0.total, xcg, r, lt, wi.cbar, wi.CMac, wi.e, wi.AR, eT, t.ARt);
  const lec = airplaneDerivs(wi.CLa, CLaT, deps, r, lt, wi.cbar, xcg, t.xac, true);
  const hw7 = airplaneDerivs(wi.CLa, CLaT, deps, r, lt, wi.cbar, xcg, t.xac, false);
  const cr = (2 * wi.S) / (wi.b * (1 + wi.lam));
  return {
    feasible: true, wi, r, St, ARt: t.ARt, lamT: t.lamT, bt, ct, lt, xcg, cgRange: rng, SMlec: lec.SM, SMhw7: hw7.SM, VH: lec.VH,
    CLa: lec.CLa, CMa: lec.CMa, deps, CLaT, eT, CD0: cd0.total, cd0, CD, LD: wi.CLcr / CD, iw: trim.iw, it: trim.it, CLt: trim.CLt,
    CLw: trim.CLw, alphaStall: aStall, lines: L, Ltotal: 0.25 * cr + lt + 0.75 * ct,
  };
}

/** Automatic design (selection rule), fixed point on i_w. Mirrors tail_design.design(). */
export function designAuto(wi, t, lt) {
  const CLaT = clAlphaEmpirical(t.ARt), deps = downwashGradient(wi.CLa, wi.AR, t.kappa);
  const eT = new Wing(1.0, t.ARt, t.lamT).e;
  const aWmax = wi.alpha0 + wi.CLmax / wi.CLa;
  let iw = 3 * D, sel = null, L = null, xcg = 0, aStall = 0, trim = null;
  for (let k = 0; k < 60; k++) {
    aStall = t.stallAuto ? aWmax - iw : t.alphaStallDeg * D;
    L = lines(wi, t, iw, CLaT, deps, lt, aStall);
    sel = selectTail(L, t.rangeMin);
    if (!sel) return { feasible: false, wi, lines: L, iw, lt };
    xcg = sel.rng[0] + t.cgFrac * (sel.rng[1] - sel.rng[0]);
    trim = trimCruise(wi.CLcr, xcg, sel.r, lt, wi.cbar, wi.CMac, wi.CLa, CLaT, deps, wi.alpha0);
    if (Math.abs(trim.iw - iw) < 1e-7) { iw = trim.iw; break; }
    iw = 0.5 * iw + 0.5 * trim.iw;
  }
  return finish(wi, t, lt, sel.r, xcg, sel.rng, CLaT, deps, eT, L, aStall, null);
}

/** Auto design with l_t shortened until the overall length (root LE to tail TE) equals lengthMax. */
export function designAutoFit(wi, t) {
  let lt = t.lengthMax, d = null;
  for (let k = 0; k < 30; k++) {
    d = designAuto(wi, t, lt);
    if (!d.feasible) return d;
    const cr = (2 * wi.S) / (wi.b * (1 + wi.lam));
    const next = t.lengthMax - (0.25 * cr + 0.75 * d.ct);
    if (Math.abs(next - lt) < 1e-6) break;
    lt = next;
  }
  return d;
}

/** Manual design point: the user picks r and xcg; i_w comes from trim at that point (alpha_FRL = 0). */
export function designManual(wi, t, lt, r, xcg) {
  const CLaT = clAlphaEmpirical(t.ARt), deps = downwashGradient(wi.CLa, wi.AR, t.kappa);
  const eT = new Wing(1.0, t.ARt, t.lamT).e;
  const iw = trimCruise(wi.CLcr, xcg, r, lt, wi.cbar, wi.CMac, wi.CLa, CLaT, deps, wi.alpha0).iw;
  const aStall = t.stallAuto ? wi.alpha0 + wi.CLmax / wi.CLa - iw : t.alphaStallDeg * D;
  const L = lines(wi, t, iw, CLaT, deps, lt, aStall);
  return finish(wi, t, lt, r, xcg, feasibleCgRange(r, L), CLaT, deps, eT, L, aStall, null);
}

/** Trimmed C_L-C_D polar from near 0 to the wing C_L^max at the design CG. */
export function trimmedPolar(d, n = 60) {
  const { wi } = d, CL = [], CD = [];
  for (let i = 0; i < n; i++) {
    const c = 0.02 + ((wi.CLmax - 0.02) * i) / (n - 1);
    CL.push(c);
    CD.push(trimmedDrag(c, d.CD0, d.xcg, d.r, d.lt, wi.cbar, wi.CMac, wi.e, wi.AR, d.eT, d.ARt));
  }
  return { CL, CD };
}

/** Stall character from a polar (port of tail_trim.stall_metrics / stall_label). */
export function stallMetrics(alpha, cl) {
  let i = 0;
  cl.forEach((v, k) => { if (v > cl[i]) i = k; });
  const pk = cl[i];
  let lo = i, hi = i;
  while (lo > 0 && cl[lo - 1] >= 0.95 * pk) lo--;
  while (hi < alpha.length - 1 && cl[hi + 1] >= 0.95 * pk) hi++;
  const at = (a) => {
    const x = Math.min(a, alpha[alpha.length - 1]);
    for (let k = 0; k < alpha.length - 1; k++) if (x >= alpha[k] && x <= alpha[k + 1]) return cl[k] + ((cl[k + 1] - cl[k]) * (x - alpha[k])) / (alpha[k + 1] - alpha[k]);
    return cl[cl.length - 1];
  };
  const m = { loss2: (pk - at(alpha[i] + 2)) / pk, loss4: (pk - at(alpha[i] + 4)) / pk, post: alpha[alpha.length - 1] - alpha[i], plateau: alpha[hi] - alpha[lo] };
  m.label = (m.loss4 >= 0.15 ? 'sharp' : m.loss4 <= 0.06 ? 'gradual' : 'moderate') + (m.post < 2 ? ' (sweep ends before stall)' : '');
  return m;
}
