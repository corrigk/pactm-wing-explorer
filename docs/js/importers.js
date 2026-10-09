// Parsers for user airfoils: coordinate files (Selig or Lednicer .dat) and polar exports (XFLR5 / XFOIL
// text), plus an inviscid linear-vorticity panel method (port of src/panel.py) for a zero-lift-angle check.

const isNum = (t) => t !== '' && Number.isFinite(+t);
const N_COORD = 61;

function interp(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]) return ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / (xs[i] - xs[i - 1]);
  return ys[ys.length - 1];
}

/** Monotone-x version of a surface (drops points that step backwards). */
function monotone(pts) {
  const out = [pts[0]];
  for (const p of pts.slice(1)) if (p[0] > out[out.length - 1][0]) out.push(p);
  return out;
}

/**
 * Parse a .dat file. Returns { name, xy (Selig order, TE -> upper -> LE -> lower -> TE), coords }.
 * coords: upper/lower y at cosine-spaced x, max thickness and its location (chord normalised to 1).
 */
export function parseDat(text, fallbackName = 'Custom airfoil') {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length);
  if (!lines.length) throw new Error('The coordinate file is empty.');
  let name = fallbackName;
  const rows = [];
  for (const l of lines) {
    const tok = l.split(/[\s,;]+/).filter(Boolean);
    if (tok.length >= 2 && isNum(tok[0]) && isNum(tok[1])) rows.push([+tok[0], +tok[1]]);
    else if (!rows.length) name = l.slice(0, 40);
  }
  if (rows.length < 10) throw new Error('Could not find coordinate pairs in the .dat file.');
  let upper, lower, xy;
  if (rows[0][0] > 1.5 && rows[0][1] > 1.5) {                     // Lednicer: counts line, upper LE->TE, lower LE->TE
    const nU = Math.round(rows[0][0]), nL = Math.round(rows[0][1]);
    upper = rows.slice(1, 1 + nU); lower = rows.slice(1 + nU, 1 + nU + nL);
    if (upper.length < 5 || lower.length < 5) throw new Error('Lednicer-format file looks incomplete.');
    xy = [...[...upper].reverse(), ...lower.slice(1)];
  } else {                                                          // Selig: TE -> upper -> LE -> lower -> TE
    xy = rows;
    let le = 0;
    for (let i = 1; i < xy.length; i++) if (xy[i][0] < xy[le][0]) le = i;
    upper = xy.slice(0, le + 1).reverse(); lower = xy.slice(le);
  }
  // normalise chord to 1 with the leading edge at x = 0
  const xmin = Math.min(...xy.map((p) => p[0])), xmax = Math.max(...xy.map((p) => p[0]));
  const ch = xmax - xmin;
  if (!(ch > 0)) throw new Error('Coordinates have zero chord.');
  const norm = (p) => [(p[0] - xmin) / ch, p[1] / ch];
  xy = xy.map(norm); upper = monotone(upper.map(norm)); lower = monotone(lower.map(norm));
  const ux = upper.map((p) => p[0]), uy = upper.map((p) => p[1]), lx = lower.map((p) => p[0]), ly = lower.map((p) => p[1]);
  const x = Array.from({ length: N_COORD }, (_, i) => 0.5 * (1 - Math.cos((Math.PI * i) / (N_COORD - 1))));
  const yu = x.map((v) => interp(ux, uy, v)), yl = x.map((v) => interp(lx, ly, v));
  let tMax = 0, xt = 0.3;
  for (let i = 0; i <= 2000; i++) {
    const v = i / 2000, t = interp(ux, uy, v) - interp(lx, ly, v);
    if (t > tMax) { tMax = t; xt = v; }
  }
  if (Math.min(...yu.map((v, i) => v - yl[i]).slice(1, -1)) < -1e-3) throw new Error('Upper and lower surfaces cross; check the point order in the .dat file.');
  return { name, xy, coords: { x, yu, yl, xt, tcGeom: tMax } };
}

/**
 * Parse a polar export: every line made only of numbers with at least 3 columns is a data row
 * (alpha, c_l, c_d, [c_dp], [c_m] ...). Works for XFLR5/Flow5 and XFOIL polar files.
 */
export function parsePolar(text) {
  const data = [];
  for (const l of text.split(/\r?\n/)) {
    const tok = l.trim().split(/\s+/).filter(Boolean);
    if (tok.length < 3 || !tok.every(isNum)) continue;
    const [a, cl, cd] = tok.map(Number);
    if (Math.abs(a) > 45 || Math.abs(cl) > 6 || !(cd > 0) || cd > 2) continue;
    data.push({ a, cl, cd, cm: tok.length >= 5 ? +tok[4] : NaN });
  }
  if (data.length < 8) throw new Error('Could not find a polar table (alpha, CL, CD columns) in the file.');
  data.sort((p, q) => p.a - q.a);
  const rows = data.filter((r, i) => i === 0 || r.a !== data[i - 1].a);
  const alpha = rows.map((r) => r.a), cl = rows.map((r) => r.cl), cd = rows.map((r) => r.cd), cm = rows.map((r) => r.cm);
  let iMax = 0;
  cl.forEach((v, i) => { if (v > cl[iMax]) iMax = i; });
  const cdMin = Math.min(...cd);

  // zero-lift angle: crossing nearest alpha = 0 between close points; if that crossing is on a separated
  // branch (c_d far above the minimum), fit the attached branch over 0..4 deg instead (as done for S1223)
  let best = null;
  for (let i = 0; i < alpha.length - 1; i++) {
    if (cl[i] * cl[i + 1] < 0 && alpha[i + 1] - alpha[i] <= 1.01) {
      const z = alpha[i] - (cl[i] * (alpha[i + 1] - alpha[i])) / (cl[i + 1] - cl[i]);
      const cdz = cd[i] + ((cd[i + 1] - cd[i]) * (z - alpha[i])) / (alpha[i + 1] - alpha[i]);
      if (!best || Math.abs(z) < Math.abs(best.z)) best = { z, cdz };
    }
  }
  let aL0, method, note = '';
  const fit = (lo, hi) => {
    const pts = alpha.map((a, i) => [a, cl[i]]).filter(([a]) => a >= lo && a <= hi);
    if (pts.length < 3) return null;
    const n = pts.length, sx = pts.reduce((s, p) => s + p[0], 0), sy = pts.reduce((s, p) => s + p[1], 0);
    const sxx = pts.reduce((s, p) => s + p[0] * p[0], 0), sxy = pts.reduce((s, p) => s + p[0] * p[1], 0);
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx), icpt = (sy - slope * sx) / n;
    return { aL0: -icpt / slope, slope };
  };
  if (best && best.cdz <= 5 * cdMin) {
    aL0 = best.z; method = 'cross';
    if (best.cdz > 2.5 * cdMin) note = `Caution: c_d at the c_l = 0 crossing is ${(best.cdz / cdMin).toFixed(1)}× the minimum, so the flow there may be partly separated.`;
  }
  else {
    const f = fit(0, 4);
    if (!f) throw new Error('Could not determine the zero-lift angle (no c_l = 0 crossing and no data between 0° and 4°).');
    aL0 = f.aL0; method = 'fit';
    note = best ? `The c_l = 0 crossing (${best.z.toFixed(2)}°) is on a separated branch (c_d ${best.cdz.toFixed(3)}), so α_L0 was fitted on 0°–4°.`
      : 'No c_l = 0 crossing in the data, so α_L0 was extrapolated from a fit on 0°–4°.';
  }
  return { alpha, cl, cd, cm, clmax: cl[iMax], aStall: alpha[iMax], aL0, aL0Method: method, note, nRows: rows.length };
}

// ---------------------------------------------------------------- panel method (inviscid)
function influence(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz), tx = dx / l, tz = dz / l, nx = -tz, nz = tx;
  const rx = px - ax, rz = pz - az, x = rx * tx + rz * tz, z = rx * nx + rz * nz;
  const r1 = Math.hypot(x, z), r2 = Math.hypot(x - l, z);
  const dth = Math.atan2(z, x - l) - Math.atan2(z, x);
  const lnr = Math.log(Math.max(r1, 1e-12) / Math.max(r2, 1e-12));
  const uc = dth / (2 * Math.PI), wc = -lnr / (2 * Math.PI);
  const ul = (x * dth - z * lnr) / (2 * Math.PI * l), wl = -(x * lnr - l + z * dth) / (2 * Math.PI * l);
  const g = (u, w) => [u * tx + w * nx, u * tz + w * nz];
  return [g(uc - ul, wc - wl), g(ul, wl)];
}

/** Inviscid zero-lift angle [deg] and lift slope [1/deg] from Selig-ordered coordinates. */
export function panelAlphaL0(xyIn) {
  let xy = xyIn.map((p) => [...p]);
  const gap = Math.hypot(xy[0][0] - xy[xy.length - 1][0], xy[0][1] - xy[xy.length - 1][1]);
  if (gap > 1e-9) {
    const te = [(xy[0][0] + xy[xy.length - 1][0]) / 2, (xy[0][1] + xy[xy.length - 1][1]) / 2];
    xy[0] = te; xy[xy.length - 1] = [...te];
  }
  xy = xy.filter((p, i) => i === 0 || Math.hypot(p[0] - xy[i - 1][0], p[1] - xy[i - 1][1]) > 1e-9);
  const N = xy.length - 1;
  const mid = [], nrm = [], len = [];
  for (let j = 0; j < N; j++) {
    const [ax, az] = xy[j], [bx, bz] = xy[j + 1], l = Math.hypot(bx - ax, bz - az);
    mid.push([(ax + bx) / 2, (az + bz) / 2]); len.push(l); nrm.push([-(bz - az) / l, (bx - ax) / l]);
  }
  const M = Array.from({ length: N + 1 }, () => new Float64Array(N + 1));
  for (let j = 0; j < N; j++) {
    const [ax, az] = xy[j], [bx, bz] = xy[j + 1];
    for (let i = 0; i < N; i++) {
      const [ga, gb] = influence(mid[i][0], mid[i][1], ax, az, bx, bz);
      M[i][j] += ga[0] * nrm[i][0] + ga[1] * nrm[i][1];
      M[i][j + 1] += gb[0] * nrm[i][0] + gb[1] * nrm[i][1];
    }
  }
  M[N][0] = 1; M[N][N] = 1;
  const solve = (alphaDeg) => {
    const a = (alphaDeg * Math.PI) / 180, rhs = new Float64Array(N + 1);
    for (let i = 0; i < N; i++) rhs[i] = -(nrm[i][0] * Math.cos(a) + nrm[i][1] * Math.sin(a));
    const A = M.map((r) => Float64Array.from(r)), b = Float64Array.from(rhs), n = N + 1;
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
      for (let r = c + 1; r < n; r++) {
        const f = A[r][c] / A[c][c];
        if (f) { for (let k = c; k < n; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
      }
    }
    const g = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let k = i + 1; k < n; k++) s -= A[i][k] * g[k]; g[i] = s / A[i][i]; }
    let G = 0;
    for (let j = 0; j < N; j++) G += 0.5 * (g[j] + g[j + 1]) * len[j];
    return 2 * G;
  };
  let c0 = solve(0), c4 = solve(4);
  let slope = (c4 - c0) / 4;
  if (slope < 0) { c0 = -c0; slope = -slope; }
  return { aL0: -c0 / slope, slope };
}
