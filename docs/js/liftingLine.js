// Prandtl lifting line for a symmetric, untwisted, singly tapered wing (port of src/lifting_line.py).
import { CONST } from './config.js';
import { solveLinear } from './numerics.js';

const N = CONST.nStations;
const HARM = Array.from({ length: N }, (_, k) => 2 * k + 1);
const TH0 = Array.from({ length: N }, (_, k) => ((k + 1) * Math.PI) / (2 * N));
const SIN0 = TH0.map((t) => HARM.map((n) => Math.sin(n * t)));
const SINT0 = TH0.map(Math.sin);

/** Precomputed sin(n theta) tables for a theta grid. */
function table(thetas) {
  return { thetas, sin: thetas.map((t) => HARM.map((n) => Math.sin(n * t))) };
}
const NH = 401;
export const HALF_GRID = table(Array.from({ length: NH }, (_, i) => Math.PI / 2 + (Math.PI / 2) * (i / (NH - 1))));
const NF = 401;
export const FULL_GRID = table(Array.from({ length: NF }, (_, i) => 1e-4 + (Math.PI - 2e-4) * (i / (NF - 1))));

export const chordTheta = (theta, cr, lam) => cr * (1 + (lam - 1) * Math.abs(Math.cos(theta)));

export class Wing {
  constructor(S, AR, lam) {
    this.S = S; this.AR = AR; this.lam = lam;
    this.b = Math.sqrt(AR * S);
    this.cr = S / (this.b * 0.5 * (1 + lam));
    this.ct = lam * this.cr;
    const M = TH0.map((t0, j) => {
      const c0 = chordTheta(t0, this.cr, lam);
      const lead = (2 * this.b) / (Math.PI * c0);
      return HARM.map((n, k) => (lead + n / SINT0[j]) * SIN0[j][k]);
    });
    this.A = solveLinear(M, new Array(N).fill(1));          // per radian of (alpha - alpha_L0)
    this.aw = Math.PI * AR * this.A[0];                      // 1/rad
    this.awDeg = (this.aw * Math.PI) / 180;                  // 1/deg
    let delta = 0;
    for (let k = 1; k < N; k++) delta += HARM[k] * (this.A[k] / this.A[0]) ** 2;
    this.delta = delta;
    this.e = 1 / (1 + delta);
  }

  alphaForCL(CL, aL0) { return aL0 + CL / this.awDeg; }
  CDi(CL) { return (CL * CL) / (Math.PI * this.e * this.AR); }

  /** Spanwise distribution for wing C_L on a theta grid: y, c_l(y), c(y), c*c_l (all arrays). */
  distribution(CL, grid) {
    const scale = CL / this.aw;
    const y = [], cl = [], c = [], ccl = [];
    grid.thetas.forEach((t, i) => {
      let s = 0;
      const row = grid.sin[i];
      for (let k = 0; k < N; k++) s += this.A[k] * row[k];
      const ch = chordTheta(t, this.cr, this.lam);
      const cc = 4 * this.b * scale * s;                    // c * c_l
      y.push(-(this.b / 2) * Math.cos(t));
      c.push(ch); ccl.push(cc); cl.push(cc / ch);
    });
    return { y, cl, c, ccl };
  }
}
