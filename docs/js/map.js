// Feasible-region map: AR (x) against taper ratio (y). Requirement violations are bilinearly interpolated
// from a grid of full evaluations (computed in the worker) and drawn per pixel as hatches, so the
// boundaries stay smooth. The expensive background is cached; markers are redrawn on top cheaply.
import { CONSTRAINTS } from './config.js';
import { color } from './plot.js';

export const REQ_STYLE = {
  alpha:  { label: 'cruise α outside the window',   css: 'k-alpha',  pattern: 'diag1' },
  span:   { label: 'span above the limit',          css: 'k-span',   pattern: 'diag2' },
  land:   { label: 'stalls at landing',             css: 'k-land',   pattern: 'dots' },
  fit:    { label: 'spar does not fit at the tip',  css: 'k-fit',    pattern: 'cross' },
  stress: { label: 'spar stress above yield',       css: 'k-stress', pattern: 'grid' },
};

const hexToRgb = (h) => {
  h = h.replace('#', '').trim();
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function hatch(pattern, x, y, P, t) {
  switch (pattern) {
    case 'diag1': return (x + y) % P < t;
    case 'diag2': return (((x - y) % P) + P) % P < t;
    case 'dots': return x % P < t * 1.7 && y % P < t * 1.7;
    case 'cross': return (x + y) % P < t || (((x - y) % P) + P) % P < t;
    default: return x % P < t || y % P < t;
  }
}

export class FeasibleMap {
  constructor(canvas, tipEl, onPick, tipHtml) {
    this.canvas = canvas; this.tip = tipEl; this.onPick = onPick; this.tipHtml = tipHtml;
    this.margin = { l: 50, r: 14, t: 12, b: 44 };
    this.state = null;
    const pick = (ev) => { const pt = this.toData(ev); if (pt) this.onPick(pt.AR, pt.lam); };
    canvas.addEventListener('pointerdown', (ev) => { canvas.setPointerCapture(ev.pointerId); this.dragging = true; pick(ev); });
    canvas.addEventListener('pointerup', () => { this.dragging = false; });
    canvas.addEventListener('pointercancel', () => { this.dragging = false; });
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
    this.tip.innerHTML = this.tipHtml(pt.AR, pt.lam);
    this.tip.style.display = 'block';
    const box = this.canvas.getBoundingClientRect();
    const left = pt.px + 16 + this.tip.offsetWidth > box.width ? pt.px - this.tip.offsetWidth - 16 : pt.px + 16;
    this.tip.style.left = `${left}px`;
    this.tip.style.top = `${Math.max(4, Math.min(pt.py + 12, box.height - this.tip.offsetHeight - 4))}px`;
  }

  /** data: { ars, lams, fields: {k: Float32Array}, LD: Float32Array, on, arMax, current, best } */
  draw(data) {
    const cv = this.canvas;
    const cssW = cv.clientWidth || 800;
    const cssH = Math.round(Math.min(560, Math.max(300, cssW * 0.56)));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
    cv.style.height = `${cssH}px`;
    const bg = document.createElement('canvas');
    bg.width = cv.width; bg.height = cv.height;
    const ctx = bg.getContext('2d');
    const { l, r, t, b } = this.margin;
    const X0 = Math.round(l * dpr), Y0 = Math.round(t * dpr);
    const PW = Math.round((cssW - l - r) * dpr), PH = Math.round((cssH - t - b) * dpr);
    const { ars, lams, fields, LD, on } = data;
    const arLo = ars[0], arHi = ars[ars.length - 1], lamLo = lams[0], lamHi = lams[lams.length - 1];
    this.state = { arLo, arHi, lamLo, lamHi };
    const nA = ars.length, nL = lams.length;

    let ldMin = Infinity, ldMax = -Infinity;
    for (const v of LD) { if (v < ldMin) ldMin = v; if (v > ldMax) ldMax = v; }
    const raw = (ldMax - ldMin) / 8, mag = 10 ** Math.floor(Math.log10(raw || 1)), f = raw / mag;
    const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;

    const surface = hexToRgb(color('surface')), gold = hexToRgb('#cfb991'), ink = hexToRgb(color('ink'));
    const dark = document.documentElement.dataset.theme !== 'light';
    const feasCol = mix(surface, gold, dark ? 0.27 : 0.38);
    const badBase = dark ? mix(surface, [0, 0, 0], 0.35) : mix(surface, [120, 120, 120], 0.08);
    const active = CONSTRAINTS.filter((k) => on[k]);
    const cols = Object.fromEntries(active.map((k) => [k, hexToRgb(color(REQ_STYLE[k].css))]));
    const img = ctx.createImageData(PW, PH);
    const d = img.data, level = new Int16Array(PW * PH);
    const P = Math.round(9 * dpr), tw = Math.max(1, Math.round(1.3 * dpr));
    const bad = new Array(active.length);
    for (let py = 0; py < PH; py++) {
      const v = (1 - py / (PH - 1)) * (nL - 1);
      const j0 = Math.min(nL - 2, Math.floor(v)), ty = v - j0;
      for (let px = 0; px < PW; px++) {
        const u = (px / (PW - 1)) * (nA - 1);
        const i0 = Math.min(nA - 2, Math.floor(u)), tx = u - i0;
        const idx = j0 * nA + i0, idx2 = idx + nA;
        const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
        let nb = 0;
        for (let a = 0; a < active.length; a++) {
          const fk = fields[active[a]];
          if (fk[idx] * w00 + fk[idx + 1] * w10 + fk[idx2] * w01 + fk[idx2 + 1] * w11 > 1e-6) bad[nb++] = active[a];
        }
        let c = nb ? badBase : feasCol;
        for (let a = 0; a < nb; a++) if (hatch(REQ_STYLE[bad[a]].pattern, px, py, P, tw)) c = cols[bad[a]];
        const o = (py * PW + px) * 4;
        d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
        level[py * PW + px] = Math.floor((LD[idx] * w00 + LD[idx + 1] * w10 + LD[idx2] * w01 + LD[idx2 + 1] * w11) / step);
      }
    }
    const lineCol = mix(ink, surface, 0.35);
    for (let py = 0; py < PH - 1; py++) {
      for (let px = 0; px < PW - 1; px++) {
        const L = level[py * PW + px];
        if (L !== level[py * PW + px + 1] || L !== level[(py + 1) * PW + px]) {
          const o = (py * PW + px) * 4;
          d[o] = lineCol[0]; d[o + 1] = lineCol[1]; d[o + 2] = lineCol[2];
        }
      }
    }
    ctx.fillStyle = color('surface'); ctx.fillRect(0, 0, bg.width, bg.height);
    ctx.putImageData(img, X0, Y0);

    const sx = (a) => X0 + ((a - arLo) / (arHi - arLo)) * PW;
    const sy = (lm) => Y0 + (1 - (lm - lamLo) / (lamHi - lamLo)) * PH;
    ctx.strokeStyle = color('axis'); ctx.lineWidth = dpr;
    ctx.strokeRect(X0 + 0.5, Y0 + 0.5, PW, PH);
    ctx.font = `${11 * dpr}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = color('muted');
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const arStep = arHi - arLo > 16 ? 4 : 2;
    for (let a = Math.ceil(arLo / arStep) * arStep; a <= arHi + 1e-9; a += arStep) ctx.fillText(String(a), sx(a), Y0 + PH + 7 * dpr);
    ctx.fillStyle = color('ink-2'); ctx.font = `${12 * dpr}px Inter, system-ui, sans-serif`;
    ctx.fillText('Aspect ratio, AR', X0 + PW / 2, Y0 + PH + 24 * dpr);
    ctx.font = `${11 * dpr}px Inter, system-ui, sans-serif`; ctx.fillStyle = color('muted');
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let lm = Math.ceil(lamLo * 10 - 1e-9) / 10; lm <= lamHi + 1e-9; lm += 0.1) ctx.fillText(lm.toFixed(1), X0 - 7 * dpr, sy(lm));
    ctx.save(); ctx.translate(13 * dpr, Y0 + PH / 2); ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = color('ink-2'); ctx.font = `${12 * dpr}px Inter, system-ui, sans-serif`;
    ctx.fillText('Taper ratio, λ', 0, 0); ctx.restore();

    // L/D contour labels along a scan line
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `600 ${11 * dpr}px Inter, system-ui, sans-serif`;
    const row = Math.round(PH * 0.42);
    for (let px = 1; px < PW; px++) {
      const a = level[row * PW + px - 1], c = level[row * PW + px];
      if (a !== c && px > 26 * dpr && px < PW - 26 * dpr) {
        const lab = `L/D ${(Math.max(a, c) * step).toFixed(step < 1 ? 1 : 0)}`;
        const x = X0 + px, y = Y0 + row;
        const w = ctx.measureText(lab).width + 10 * dpr;
        ctx.fillStyle = color('surface'); ctx.globalAlpha = 0.85;
        ctx.beginPath(); ctx.roundRect(x - w / 2, y - 9 * dpr, w, 18 * dpr, 9 * dpr); ctx.fill(); ctx.globalAlpha = 1;
        ctx.fillStyle = color('ink'); ctx.fillText(lab, x, y);
        px += Math.round(70 * dpr);
      }
    }
    if (on.span && data.arMax > arLo && data.arMax < arHi) {
      ctx.strokeStyle = color('k-span'); ctx.lineWidth = 2 * dpr; ctx.setLineDash([7 * dpr, 5 * dpr]);
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
    if (best) {
      const bx = sx(best.AR), by = sy(best.lam), R = 10 * dpr;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) { const rr = i % 2 ? R * 0.45 : R, a = -Math.PI / 2 + (i * Math.PI) / 5; ctx.lineTo(bx + rr * Math.cos(a), by + rr * Math.sin(a)); }
      ctx.closePath();
      ctx.fillStyle = best.ok ? '#cfb991' : color('surface'); ctx.fill();
      ctx.lineWidth = 1.6 * dpr; ctx.strokeStyle = best.ok ? '#000' : color('ink'); ctx.stroke();
    }
    const cx = sx(current.AR), cy = sy(current.lam);
    ctx.beginPath(); ctx.arc(cx, cy, 8 * dpr, 0, 2 * Math.PI);
    ctx.lineWidth = 4 * dpr; ctx.strokeStyle = color('surface'); ctx.stroke();
    ctx.lineWidth = 2.2 * dpr; ctx.strokeStyle = color('ink'); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 2.4 * dpr, 0, 2 * Math.PI); ctx.fillStyle = color('ink'); ctx.fill();
  }
}
