// Small numerical helpers (no dependencies).

/** Solve A x = b by Gaussian elimination with partial pivoting. A is an array of rows (modified copy). */
export function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (p !== c) [M[c], M[p]] = [M[p], M[c]];
    const piv = M[c][c];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / piv;
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let k = i + 1; k < n; k++) s -= M[i][k] * x[k];
    x[i] = s / M[i][i];
  }
  return x;
}

export function linspace(a, b, n) {
  return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
}

/** Trapezoid integral of f over y. */
export function trapz(y, f) {
  let s = 0;
  for (let i = 0; i < y.length - 1; i++) s += 0.5 * (f[i] + f[i + 1]) * (y[i + 1] - y[i]);
  return s;
}

/** F(y_i) = integral from y_i to the last point of f. */
export function cumtrapzFromTip(y, f) {
  const out = new Array(y.length).fill(0);
  for (let i = y.length - 2; i >= 0; i--) out[i] = out[i + 1] + 0.5 * (f[i] + f[i + 1]) * (y[i + 1] - y[i]);
  return out;
}

/** F(y_i) = integral from the first point to y_i of f. */
export function cumtrapzFromRoot(y, f) {
  const out = new Array(y.length).fill(0);
  for (let i = 1; i < y.length; i++) out[i] = out[i - 1] + 0.5 * (f[i] + f[i - 1]) * (y[i] - y[i - 1]);
  return out;
}

export const ceilStep = (x, step) => Math.ceil(x / step - 1e-9) * step;
export const floorStep = (x, step) => Math.floor(x / step + 1e-9) * step;
