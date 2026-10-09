// Feasible-region map: AR (x) against taper ratio (y). Requirement violations are bilinearly interpolated
// from a coarse grid of full evaluations and drawn per pixel as hatches, so boundaries stay smooth.
import { CONSTRAINTS } from './config.js';
import { color } from './plot.js';

export const REQ_STYLE = {
  alpha:  { label: 'cruise α outside window',        css: 's1', pattern: 'diag1' },
  span:   { label: 'span above the limit',           css: 's2', pattern: 'diag2' },
  land:   { label: 'landing stall (c_l ≥ c_l,max)',  css: 's3', pattern: 'dots' },
  fit:    { label: 'spar does not fit at the tip',   css: 's4', pattern: 'cross' },
  stress: { label: 'spar stress above yield',        css: 's5', pattern: 'grid' },
};

const hexToRgb = (h) => {
  h = h.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};

function hatch(pattern, x, y, P, t) {
  switch (pattern) {
    case 'diag1': return (x + y) % P < t;
    case 'diag2': return (((x - y) % P) + P) % P < t;
    case 'dots': return x % P < t * 1.6 && y % P < t * 1.6;
    case 'cross': return (x + y) % P < t || (((x - y) % P) + P) % P < t;
    default: return x % P < t || y % P < t;
  }
}

export class FeasibleMap {
  constructor(canvas, tipEl, onPick, evalAt) {
    this.canvas = canvas; this.tip = tipEl; this.onPick = onPick; this.evalAt = evalAt;
    this.margin = { l: 52, r: 12, t: 10, b: 40 };
    this.state = null;
    const pick = (ev) => {
      const pt = this.toData(ev);
      if (pt) this.onPick(pt.AR, pt.lam);
    };
    canvas.addEventListener('pointerdown', (ev) => { canvas.setPointerCapture(ev.pointerId); this.dragging = true; pick(ev); });
    canvas.addEventListener('pointerup', () => { this.dragging = false; });
    canvas.addEventListener('pointermove', (ev) => { if (this.dragging) pick(ev); this.showTip(ev); });
    canvas.addEventListener('pointerleave', () => { this.tip.style.display = 'none'; });
  }

  toData(ev) {
    if (!this.state) return null;
    const r = this.canvas.getBoundingClientRect();
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    const { l, r: mr, t, b } = this.margin, { arLo, arHi, lamLo, lamHi } = this.state;
    const w = r.width - l - mr, h = r.height - t - b;
    if (x < l || x > l + w || y < t || y > t + h) return null;
    return { AR: arLo + ((x - l) / w) * (arHi - arLo), lam: lamHi - ((y - t) / h) * (lamHi - lamLo), px: x, py: y };
  }

  showTip(ev) {
    const pt = this.toData(ev);
    if (!pt) { this.tip.style.display = 'none'; return; }
    const r = this.evalAt(pt.AR, pt.lam);
    this.tip.innerHTML = r;
    this.tip.style.display = 'block';
    const box = this.canvas.getBoundingClientRect();
    const left = pt.px + 14 + this.tip.offsetWidth > box.width ? pt.px - this.tip.offsetWidth - 14 : pt.px + 14;
    this.tip.style.left = `${left}px`;
    this.tip.style.top = `${Math.min(pt.py + 10, box.height - this.tip.offsetHeight - 4)}px`;
  }

  /**
   * data: { ars, lams, res (res[iLam][iAR] = evaluation), on, current: {AR, lam}, best: {AR, lam, ok}, arMax }
   */
  draw(data) {
    const cv = this.canvas;
    const cssW = cv.clientWidth || 800;
    const cssH = Math.round(cssW * 0.62);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
    cv.style.height = `${cssH}px`;
    const bg = document.createElement('canvas');
    bg.width = cv.width; bg.height = cv.height;
    const ctx = bg.getContext('2d');
    const { l, r, t, b } = this.margin;
    const X0 = Math.round(l * dpr), Y0 = Math.round(t * dpr);
    const PW = Math.round((cssW - l - r) * dpr), PH = Math.round((cssH - t - b) * dpr);
    const { ars, lams, res, on } = data;
    const arLo = ars[0], arHi = ars[ars.length - 1], lamLo = lams[0], lamHi = lams[lams.length - 1];
    this.state = { arLo, arHi, lamLo, lamHi };
    const nA = ars.length, nL = lams.length;

    const fields = {};
    CONSTRAINTS.forEach((k) => { fields[k] = Float32Array.from(res.flat().map((q) => q.viol[k])); });
    const LD = Float32Array.from(res.flat().map((q) => q.LD));
    const ldMin = Math.min(...LD), ldMax = Math.max(...LD);
    const step = (() => { const raw = (ldMax - ldMin) / 8; const mag = 10 ** Math.floor(Math.log10(raw)); const f = raw / mag; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag; })();

    const surface = hexToRgb(color('surface')), good = hexToRgb(color('s3')), ink = hexToRgb(color('ink'));
    const cols = Object.fromEntries(CONSTRAINTS.map((k) => [k, hexToRgb(color(REQ_STYLE[k].css))]));
    const img = ctx.createImageData(PW, PH);
    const d = img.data, level = new Int16Array(PW * PH);
    const P = Math.round(8 * dpr), tw = Math.max(1, Math.round(1.4 * dpr));
    for (let py = 0; py < PH; py++) {
      const v = (1 - py / (PH - 1)) * (nL - 1);               // lam rows: bottom = lamLo
      const j0 = Math.min(nL - 2, Math.floor(v)), ty = v - j0;
      for (let px = 0; px < PW; px++) {
        const u = (px / (PW - 1)) * (nA - 1);
        const i0 = Math.min(nA - 2, Math.floor(u)), tx = u - i0;
        const idx = (j0 * nA + i0), idx2 = idx + nA;
        const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
        let rgb = surface, anyBad = false;
        const bad = [];
        for (const k of CONSTRAINTS) {
          if (!on[k]) continue;
          const f = fields[k];
          const val = f[idx] * w00 + f[idx + 1] * w10 + f[idx2] * w01 + f[idx2 + 1] * w11;
          if (val > 1e-6) { bad.push(k); anyBad = true; }
        }
        let r0 = rgb[0], g0 = rgb[1], b0 = rgb[2];
        if (!anyBad) { r0 = surface[0] * 0.8 + good[0] * 0.2; g0 = surface[1] * 0.8 + good[1] * 0.2; b0 = surface[2] * 0.8 + good[2] * 0.2; }
        for (const k of bad) {
          if (hatch(REQ_STYLE[k].pattern, px, py, P, tw)) { [r0, g0, b0] = cols[k]; }
        }
        const o = (py * PW + px) * 4;
        d[o] = r0; d[o + 1] = g0; d[o + 2] = b0; d[o + 3] = 255;
        const ld = LD[idx] * w00 + LD[idx + 1] * w10 + LD[idx2] * w01 + LD[idx2 + 1] * w11;
        level[py * PW + px] = Math.floor(ld / step);
      }
    }
    for (let py = 0; py < PH - 1; py++) {
      for (let px = 0; px < PW - 1; px++) {
        const L = level[py * PW + px];
        if (L !== level[py * PW + px + 1] || L !== level[(py + 1) * PW + px]) {
          const o = (py * PW + px) * 4;
          d[o] = ink[0]; d[o + 1] = ink[1]; d[o + 2] = ink[2];
        }
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = color('surface'); ctx.fillRect(0, 0, bg.width, bg.height);
    ctx.putImageData(img, X0, Y0);

    const sx = (a) => X0 + ((a - arLo) / (arHi - arLo)) * PW;
    const sy = (lm) => Y0 + (1 - (lm - lamLo) / (lamHi - lamLo)) * PH;
    ctx.font = `${12 * dpr}px system-ui, sans-serif`;
    ctx.fillStyle = color('ink2'); ctx.strokeStyle = color('axis'); ctx.lineWidth = dpr;
    ctx.strokeRect(X0 + 0.5, Y0 + 0.5, PW, PH);
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let a = Math.ceil(arLo); a <= arHi; a += 2) { ctx.fillText(String(a), sx(a), Y0 + PH + 6 * dpr); }
    ctx.fillText('Aspect ratio, AR', X0 + PW / 2, Y0 + PH + 22 * dpr);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let lm = 0.3; lm <= lamHi + 1e-9; lm += 0.1) ctx.fillText(lm.toFixed(1), X0 - 6 * dpr, sy(lm));
    ctx.save(); ctx.translate(12 * dpr, Y0 + PH / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('Taper ratio, λ', 0, 0); ctx.restore();

    // L/D labels along the mid-height scan line
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `${11 * dpr}px system-ui, sans-serif`;
    const rowMid = Math.round(PH * 0.5);
    for (let px = 1; px < PW; px++) {
      const a = level[rowMid * PW + px - 1], c = level[rowMid * PW + px];
      if (a !== c && px > 24 * dpr && px < PW - 24 * dpr) {
        const lab = (Math.max(a, c) * step).toFixed(step < 1 ? 1 : 0);
        const x = X0 + px, y = Y0 + rowMid;
        ctx.lineWidth = 3 * dpr; ctx.strokeStyle = color('surface'); ctx.strokeText(lab, x, y);
        ctx.fillStyle = color('ink'); ctx.fillText(lab, x, y);
        px += Math.round(30 * dpr);
      }
    }

    // span limit line
    if (data.arMax > arLo && data.arMax < arHi) {
      ctx.strokeStyle = color('s2'); ctx.lineWidth = 2 * dpr; ctx.setLineDash([6 * dpr, 4 * dpr]);
      ctx.beginPath(); ctx.moveTo(sx(data.arMax), Y0); ctx.lineTo(sx(data.arMax), Y0 + PH); ctx.stroke(); ctx.setLineDash([]);
    }
    this.bg = bg;
    this.geom = { dpr, sx, sy };
    this.overlay(data.current, data.best);
  }

  /** Cheap redraw: cached background plus the best-design and current-design markers. */
  overlay(current, best) {
    if (!this.bg) return;
    const cv = this.canvas, ctx = cv.getContext('2d');
    const { dpr, sx, sy } = this.geom;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bg, 0, 0);
    const star = (cx, cy, rad, fill) => {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) { const rr = i % 2 ? rad * 0.45 : rad, a = -Math.PI / 2 + (i * Math.PI) / 5; ctx.lineTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a)); }
      ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 1.5 * dpr; ctx.strokeStyle = color('surface'); ctx.stroke();
    };
    if (best) {
      const bx = sx(best.AR), by = sy(best.lam);
      if (best.ok) star(bx, by, 9 * dpr, color('ink'));
      else {
        ctx.beginPath(); ctx.moveTo(bx, by - 8 * dpr); ctx.lineTo(bx + 8 * dpr, by); ctx.lineTo(bx, by + 8 * dpr); ctx.lineTo(bx - 8 * dpr, by); ctx.closePath();
        ctx.fillStyle = color('surface'); ctx.fill(); ctx.lineWidth = 2 * dpr; ctx.strokeStyle = color('ink'); ctx.stroke();
      }
    }
    const cx = sx(current.AR), cy = sy(current.lam);
    ctx.beginPath(); ctx.arc(cx, cy, 7 * dpr, 0, 2 * Math.PI);
    ctx.lineWidth = 3 * dpr; ctx.strokeStyle = color('surface'); ctx.stroke();
    ctx.lineWidth = 2 * dpr; ctx.strokeStyle = color('ink'); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 2 * dpr, 0, 2 * Math.PI); ctx.fillStyle = color('ink'); ctx.fill();
  }
}
