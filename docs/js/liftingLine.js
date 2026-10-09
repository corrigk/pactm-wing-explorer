// Prandtl lifting line for a symmetric, untwisted, singly tapered wing (port of src/lifting_line.py).
//
// Speed-up: with c(theta) = c_r g(theta; lambda) and b / c_r = AR (1 + lambda) / 2, the lifting-line
// matrix, the Fourier coefficients and every normalised spanwise integral depend on (AR, lambda) only,
// not on the wing area. They are solved once per (AR, lambda) and cached, so changing mass, speeds or
// structural limits never re-solves the lifting-line system.
import { CONST } from './config.js';
import { solveLinear } from './numerics.js';

const N = CONST.nStations;
const HARM = Array.from({ length: N }, (_, k) => 2 * k + 1);
const TH0 = Array.from({ length: N }, (_, k) => ((k + 1) * Math.PI) / (2 * N));
const SIN0 = TH0.map((t) => HARM.map((n) => Math.sin(n * t)));
const SINT0 = TH0.map(Math.sin);
const COS0 = TH0.map((t) => Math.abs(Math.cos(t)));

function table(thetas) {
  return { thetas, sin: thetas.map((t) => Float64Array.from(HARM, (n) => Math.sin(n * t))), absCos: thetas.map((t) => Math.abs(Math.cos(t))) };
}
const NH = 401;
/** Half-span grid, root (theta = pi/2) to tip (theta = pi); eta = y / (b/2) = -cos(theta). */
export const HALF_GRID = table(Array.from({ length: NH }, (_, i) => Math.PI / 2 + (Math.PI / 2) * (i / (NH - 1))));
const ETA = HALF_GRID.thetas.map((t) => -Math.cos(t));
const NF = 401;
export const FULL_GRID = table(Array.from({ length: NF }, (_, i) => 1e-4 + (Math.PI - 2e-4) * (i / (NF - 1))));

export const chordTheta = (theta, cr, lam) => cr * (1 + (lam - 1) * Math.abs(Math.cos(theta)));

// ---- (AR, lambda) shape cache ----
const CACHE = new Map();
const CACHE_MAX = 12000;
let hits = 0, misses = 0;
export const cacheStats = () => ({ size: CACHE.size, hits, misses });

function solveShape(AR, lam) {
  const bOverCr = (AR * (1 + lam)) / 2;
  const M = new Array(N);
  for (let j = 0; j < N; j++) {
    const g = 1 + (lam - 1) * COS0[j];
    const lead = (2 * bOverCr) / (Math.PI * g);
    const row = new Array(N);
    for (let k = 0; k < N; k++) row[k] = (lead + HARM[k] / SINT0[j]) * SIN0[j][k];
    M[j] = row;
  }
  const A = solveLinear(M, new Array(N).fill(1));
  const aw = Math.PI * AR * A[0];
  let delta = 0;
  for (let k = 1; k < N; k++) delta += HARM[k] * (A[k] / A[0]) ** 2;

  // normalised half-span sums: s_i = sum_k A_k sin(n_k theta_i); c*c_l = 4 b (CL/aw) s_i
  const sums = new Float64Array(NH);
  let peak = 0;
  for (let i = 0; i < NH; i++) {
    const row = HALF_GRID.sin[i];
    let s = 0;
    for (let k = 0; k < N; k++) s += A[k] * row[k];
    sums[i] = s;
    const g = 1 + (lam - 1) * HALF_GRID.absCos[i];
    if (s / g > peak) peak = s / g;
  }
  // shear and moment shapes (trapezoid, tip -> root), and the tip-deflection integral shape
  const Sh = new Float64Array(NH), Mo = new Float64Array(NH);
  for (let i = NH - 2; i >= 0; i--) Sh[i] = Sh[i + 1] + 0.5 * (sums[i] + sums[i + 1]) * (ETA[i + 1] - ETA[i]);
  for (let i = NH - 2; i >= 0; i--) Mo[i] = Mo[i + 1] + 0.5 * (Sh[i] + Sh[i + 1]) * (ETA[i + 1] - ETA[i]);
  let T = 0;
  for (let i = 0; i < NH - 1; i++) T += 0.5 * (Mo[i] * (1 - ETA[i]) + Mo[i + 1] * (1 - ETA[i + 1])) * (ETA[i + 1] - ETA[i]);
  return { A, aw, delta, e: 1 / (1 + delta), peak, Mo0: Mo[0], T };
}

export function shape(AR, lam) {
  const key = `${AR.toFixed(9)}|${lam.toFixed(9)}`;
  let s = CACHE.get(key);
  if (s) { hits++; return s; }
  misses++;
  s = solveShape(AR, lam);
  if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
  CACHE.set(key, s);
  return s;
}

export class Wing {
  constructor(S, AR, lam) {
    this.S = S; this.AR = AR; this.lam = lam;
    this.b = Math.sqrt(AR * S);
    this.cr = S / (this.b * 0.5 * (1 + lam));
    this.ct = lam * this.cr;
    const sh = shape(AR, lam);
    this.shape = sh;
    this.A = sh.A;
    this.aw = sh.aw;                          // 1/rad
    this.awDeg = (sh.aw * Math.PI) / 180;     // 1/deg
    this.delta = sh.delta;
    this.e = sh.e;
  }

  alphaForCL(CL, aL0) { return aL0 + CL / this.awDeg; }
  CDi(CL) { return (CL * CL) / (Math.PI * this.e * this.AR); }

  /** Peak section c_l on the half-span grid for wing lift coefficient CL. */
  peakCl(CL) { return ((2 * this.AR * (1 + this.lam) * CL) / this.aw) * this.shape.peak; }

  /** Root bending moment and the tip-deflection integral (int M (s - y) dy) for a half-wing load
   *  w(y) = n q c c_l(y) at wing lift coefficient CL. */
  bending(CL, n, q) {
    const K = (n * q * 4 * this.b * CL) / this.aw;
    const s = this.b / 2;
    return { Mroot: K * s * s * this.shape.Mo0, tipIntegral: K * s ** 4 * this.shape.T };
  }

  /** Spanwise distribution for wing C_L on a theta grid: y, c_l(y), c(y), c*c_l (arrays). */
  distribution(CL, grid) {
    const scale = CL / this.aw;
    const n = grid.thetas.length;
    const y = new Array(n), cl = new Array(n), c = new Array(n), ccl = new Array(n);
    for (let i = 0; i < n; i++) {
      const row = grid.sin[i];
      let s = 0;
      for (let k = 0; k < N; k++) s += this.A[k] * row[k];
      const ch = this.cr * (1 + (this.lam - 1) * grid.absCos[i]);
      const cc = 4 * this.b * scale * s;
      y[i] = -(this.b / 2) * Math.cos(grid.thetas[i]);
      c[i] = ch; ccl[i] = cc; cl[i] = cc / ch;
    }
    return { y, cl, c, ccl };
  }
}
