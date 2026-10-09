// Perspective 3D view of the wing under the design load (canvas 2D, painter's algorithm, flat shading).
// World axes: X spanwise (m), Y chordwise (+aft, m), Z up (m). Drag to orbit, double-click to reset.
import { color } from './plot.js';
import { rampRgb } from './visuals.js';

const DEF_VIEW = { yaw: -0.62, pitch: 0.42 };

export class Wing3D {
  constructor(canvas, noteEl) {
    this.cv = canvas; this.note = noteEl;
    this.view = { ...DEF_VIEW };
    this.exag = 3;
    this.mode = 'gold';
    this.geo = null;
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, ...this.view }; });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      this.view.yaw = drag.yaw + (e.clientX - drag.x) * 0.008;
      this.view.pitch = Math.max(-0.2, Math.min(1.35, drag.pitch + (e.clientY - drag.y) * 0.006));
      this.request();
    });
    const end = () => { drag = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('dblclick', () => { this.view = { ...DEF_VIEW }; this.request(); });
  }

  /** geo: { b, cr, lam, coords, deflY (root->tip, m), defl (m), tipDefl, loadFactor } */
  set(geo) { this.geo = geo; this.request(); }
  setExag(x) { this.exag = x; this.request(); }
  setMode(m) { this.mode = m; this.request(); }

  /** Colour field along |y| for the current mode (ratio to its limit), or null for plain gold. */
  field() {
    if (this.mode === 'cl') return this.geo.clField;
    if (this.mode === 'stress') return this.geo.stressField;
    return null;
  }

  request() {
    if (this.pending) return;
    this.pending = true;
    const go = () => { this.pending = false; this.render(); };
    if (document.hidden) setTimeout(go, 0); else requestAnimationFrame(go);
  }

  buildMesh() {
    const { b, cr, lam, coords, deflY, defl } = this.geo;
    const s = b / 2, ex = this.exag;
    const nS = 36;
    const loop = [];
    const step = 2;
    for (let i = coords.x.length - 1; i >= 0; i -= step) loop.push([coords.x[i], coords.yu[i]]);
    for (let i = step; i < coords.x.length; i += step) loop.push([coords.x[i], coords.yl[i]]);
    if (loop[loop.length - 1][0] < 1) loop.push([1, coords.yl[coords.yl.length - 1]]);
    const dAt = (yy) => {
      const a = Math.abs(yy);
      for (let i = 1; i < deflY.length; i++) if (a <= deflY[i]) return defl[i - 1] + ((defl[i] - defl[i - 1]) * (a - deflY[i - 1])) / (deflY[i] - deflY[i - 1]);
      return defl[defl.length - 1];
    };
    const stations = [];
    for (let j = 0; j <= nS; j++) {
      const t = -1 + (2 * j) / nS;
      const yy = s * Math.sign(t) * (1 - Math.cos((Math.abs(t) * Math.PI) / 2));
      const c = cr * (1 - (1 - lam) * Math.abs(yy / s));
      const xle = 0.25 * (cr - c), z0 = dAt(yy) * ex;
      stations.push({ yy, c, xle, z0, pts: loop.map(([u, v]) => [yy, xle + u * c, z0 + v * c]) });
    }
    return { stations, loopLen: loop.length };
  }

  render() {
    if (!this.geo) return;
    const cv = this.cv;
    const cssW = cv.clientWidth || 600, cssH = Math.round(Math.max(240, cssW * 0.56));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (cv.width !== Math.round(cssW * dpr) || cv.height !== Math.round(cssH * dpr)) {
      cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr); cv.style.height = `${cssH}px`;
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    const { b, cr } = this.geo;
    const { stations, loopLen } = this.buildMesh();
    const { yaw, pitch } = this.view;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cx0 = 0, cy0 = cr / 2, cz0 = this.geo.tipDefl * this.exag * 0.35;
    const D = b * 1.9;
    let F = 1, W2 = 0, H2 = 0;
    const toView = ([x, y, z]) => {
      const X = x - cx0, Y = y - cy0, Z = z - cz0;
      const x1 = X * cy - Y * sy, y1 = X * sy + Y * cy;
      const y2 = y1 * cp + Z * sp, z2 = -y1 * sp + Z * cp;
      return [x1, y2, z2];
    };
    const proj = ([x, y, z]) => { const dep = D + y; return [W2 + (x * F) / dep, H2 - (z * F) / dep, dep]; };
    // auto-fit: project every vertex (and the floor shadow) with unit scale, then scale/centre to the canvas
    {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      const zfFit = -0.16 * b;
      for (const st of stations) for (const pt of [...st.pts, [st.yy, st.xle, zfFit], [st.yy, st.xle + st.c, zfFit]]) {
        const [x, y, z] = toView(pt); const dep = D + y;
        const px = x / dep, py = -z / dep;
        if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
      }
      F = Math.min((cv.width * 0.86) / (x1 - x0), (cv.height * 0.8) / (y1 - y0));
      W2 = cv.width / 2 - ((x0 + x1) / 2) * F;
      H2 = cv.height * 0.47 - ((y0 + y1) / 2) * F;
    }

    // ground shadow (planform projected onto a floor below the wing)
    const zf = -0.16 * b;
    ctx.beginPath();
    const lead = stations.map((st) => proj(toView([st.yy, st.xle, zf])));
    const trail = stations.map((st) => proj(toView([st.yy, st.xle + st.c, zf]))).reverse();
    [...lead, ...trail].forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.closePath();
    ctx.fillStyle = document.documentElement.dataset.theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0.45)';
    ctx.filter = `blur(${6 * dpr}px)`; ctx.fill(); ctx.filter = 'none';

    // faces
    const V = stations.map((st) => st.pts.map(toView));
    const faces = [];
    const L = (() => { const v = [-0.35, -0.55, 0.76]; const n = Math.hypot(...v); return v.map((q) => q / n); })();
    const pushFace = (pts, centroidRef, yAbs) => {
      const [a, b2, c] = pts;
      const u = [b2[0] - a[0], b2[1] - a[1], b2[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const nl = Math.hypot(...n) || 1; n = n.map((q) => q / nl);
      const m = pts.reduce((acc, p) => [acc[0] + p[0] / pts.length, acc[1] + p[1] / pts.length, acc[2] + p[2] / pts.length], [0, 0, 0]);
      const out = [m[0] - centroidRef[0], m[1] - centroidRef[1], m[2] - centroidRef[2]];
      if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) n = n.map((q) => -q);
      const toCam = [-m[0], -D - m[1], -m[2]];
      if (n[0] * toCam[0] + n[1] * toCam[1] + n[2] * toCam[2] <= 0) return;
      faces.push({ pts, depth: m[1], light: n[0] * L[0] + n[1] * L[1] + n[2] * L[2], n, yAbs });
    };
    for (let j = 0; j < V.length - 1; j++) {
      const ca = V[j].reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]).map((q) => q / loopLen);
      const cb = V[j + 1].reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]).map((q) => q / loopLen);
      const cm = [(ca[0] + cb[0]) / 2, (ca[1] + cb[1]) / 2, (ca[2] + cb[2]) / 2];
      const ya = 0.5 * (Math.abs(stations[j].yy) + Math.abs(stations[j + 1].yy));
      for (let i = 0; i < loopLen - 1; i++) pushFace([V[j][i], V[j][i + 1], V[j + 1][i + 1], V[j + 1][i]], cm, ya);
    }
    const centroid = (pts) => pts.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]).map((q) => q / pts.length);
    pushFace(V[0].slice(0, loopLen - 1), centroid(V[1]), Math.abs(stations[0].yy));               // tip caps: neighbour is inside
    pushFace(V[V.length - 1].slice(0, loopLen - 1), centroid(V[V.length - 2]), Math.abs(stations[V.length - 1].yy));
    faces.sort((p, q) => q.depth - p.depth);
    const dark = document.documentElement.dataset.theme !== 'light';
    const gold = [207, 185, 145];
    const fld = this.field();
    const at = (ya) => {
      const { y, v } = fld;
      if (ya <= y[0]) return v[0];
      for (let i = 1; i < y.length; i++) if (ya <= y[i]) return v[i - 1] + ((v[i] - v[i - 1]) * (ya - y[i - 1])) / (y[i] - y[i - 1]);
      return v[v.length - 1];
    };
    for (const fc of faces) {
      const base = fld ? rampRgb(at(fc.yAbs), true) : gold;
      const k = (dark ? 0.32 : 0.45) + 0.68 * Math.max(0, fc.light);
      const spec = Math.max(0, fc.light) ** 18 * 0.35;
      const c = base.map((v) => Math.min(255, Math.round(v * k + 255 * spec)));
      ctx.beginPath();
      fc.pts.forEach((p, i) => { const [px, py] = proj(p); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
      ctx.closePath();
      ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 0.6;
      ctx.fill(); ctx.stroke();
    }

    // undeflected reference (leading and trailing edges) and the tip deflection callout
    if (this.exag > 0) {
      ctx.setLineDash([5 * dpr, 4 * dpr]); ctx.lineWidth = 1.2 * dpr; ctx.strokeStyle = color('muted');
      for (const edge of ['le', 'te']) {
        ctx.beginPath();
        stations.forEach((st, i) => {
          const [px, py] = proj(toView([st.yy, edge === 'le' ? st.xle : st.xle + st.c, 0]));
          if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        });
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    const tip = stations[stations.length - 1];
    const pA = proj(toView([tip.yy, tip.xle + tip.c, 0])), pB = proj(toView([tip.yy, tip.xle + tip.c, tip.z0]));
    ctx.strokeStyle = color('ink'); ctx.lineWidth = 1.4 * dpr;
    ctx.beginPath(); ctx.moveTo(pA[0], pA[1]); ctx.lineTo(pB[0], pB[1]); ctx.stroke();
    ctx.fillStyle = color('ink'); ctx.font = `600 ${12 * dpr}px Inter, system-ui, sans-serif`; ctx.textAlign = 'left';
    ctx.fillText(`δ tip ${(this.geo.tipDefl * 1e3).toFixed(0)} mm`, Math.min(pB[0] + 8 * dpr, cv.width - 110 * dpr), (pA[1] + pB[1]) / 2);
    if (this.note) {
      const what = this.mode === 'cl' ? 'colour: cruise c_l / c_l,max' : this.mode === 'stress' ? 'colour: spar σ / yield at the design load' : '';
      this.note.textContent = `${this.geo.loadFactor.toFixed(1)} g design load · deflection ×${this.exag}${what ? ' · ' + what : ''} · drag to orbit, double-click to reset`;
    }
  }
}
