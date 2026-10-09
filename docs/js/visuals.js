// Geometry drawings (SVG): wing planform coloured by section c_l, tip section with the spar to scale,
// and a small airfoil thumbnail.
import { color } from './plot.js';

const f1 = (v) => v.toFixed(1);

/** Sequential gold ramp for a ratio in [0, 1] as [r, g, b]; red at or above 1 (stalled / yielded). */
export function rampRgb(t, forSurface = false) {
  const dark = document.documentElement.dataset.theme !== 'light';
  if (t >= 1) return [226, 74, 74];
  const lo = forSurface ? [70, 62, 48] : dark ? [42, 36, 24] : [246, 240, 226];
  const hi = forSurface ? [250, 214, 100] : dark ? [242, 206, 92] : [142, 104, 20];
  const u = Math.max(0, Math.min(1, t)) ** 0.9;
  return lo.map((v, i) => Math.round(v + (hi[i] - v) * u));
}
export function rampColor(t) {
  if (t >= 1) return color('bad');
  const c = rampRgb(t);
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function colorbarHtml(label) {
  const stops = Array.from({ length: 11 }, (_, i) => `${rampColor(Math.min(i / 10, 0.999))} ${i * 10}%`).join(',');
  return `<span>0</span><span class="bar" style="background:linear-gradient(90deg,${stops})"></span><span>1</span><span>${label}</span>`
    + `<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:12px;height:8px;border-radius:2px;background:${color('bad')}"></span>stalled</span>`;
}

function interp(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]) return ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / (xs[i] - xs[i - 1]);
  return ys[ys.length - 1];
}

/**
 * Planform, top view, true aspect ratio. LE at the top, unswept quarter-chord line.
 * opt: { b, cr, lam, y, cl, clmax, xt, spar, mode }
 */
export function drawPlanform(el, opt) {
  const { b, cr, lam, y, cl, clmax, xt, spar } = opt;
  const W = Math.max(320, Math.round(el.clientWidth || 900)), ml = 16, mr = 84, mt = 24, mb = 50;
  const sc = (W - ml - mr) / b;
  const H = Math.round(mt + cr * sc + mb);
  const X = (yy) => ml + (yy + b / 2) * sc;
  const chord = (yy) => cr * (1 - (1 - lam) * Math.abs((2 * yy) / b));
  const xle = (yy) => 0.25 * (cr - chord(yy));
  const Y = (xx) => mt + xx * sc;
  const ink2 = color('ink-2'), muted = color('muted'), gold = '#cfb991';

  let strips = '';
  const n = 160;
  for (let k = 0; k < n; k++) {
    const ya = -b / 2 + (b * k) / n, yb = -b / 2 + (b * (k + 1)) / n, ym = 0.5 * (ya + yb);
    const t = interp(y, cl, ym) / clmax;
    strips += `<polygon points="${f1(X(ya))},${f1(Y(xle(ya)))} ${f1(X(yb))},${f1(Y(xle(yb)))} ${f1(X(yb))},${f1(Y(xle(yb) + chord(yb)))} ${f1(X(ya))},${f1(Y(xle(ya) + chord(ya)))}" fill="${rampColor(t)}" stroke="${rampColor(t)}" stroke-width="0.6"/>`;
  }
  const out = [[-b / 2, xle(-b / 2)], [0, 0], [b / 2, xle(b / 2)], [b / 2, xle(b / 2) + chord(b / 2)], [0, cr], [-b / 2, xle(-b / 2) + chord(-b / 2)]];
  const outline = `<polygon points="${out.map(([a, c]) => `${f1(X(a))},${f1(Y(c))}`).join(' ')}" fill="none" stroke="${ink2}" stroke-width="1.6" stroke-linejoin="round"/>`;

  // spar band at the max-thickness line (constant width)
  const sw = spar.kind === 'rect' ? spar.w : spar.d;
  const top = [], bot = [];
  for (let k = 0; k <= 40; k++) {
    const yy = -b / 2 + (b * k) / 40, xc = xle(yy) + xt * chord(yy);
    top.push(`${f1(X(yy))},${f1(Y(xc - sw / 2))}`); bot.unshift(`${f1(X(yy))},${f1(Y(xc + sw / 2))}`);
  }
  const sparPoly = `<polygon points="${top.join(' ')} ${bot.join(' ')}" fill="rgba(0,0,0,0.28)" stroke="${gold}" stroke-width="1.4" stroke-dasharray="6 4"/>`;
  const qc = `<line x1="${X(-b / 2)}" x2="${X(b / 2)}" y1="${Y(cr / 4)}" y2="${Y(cr / 4)}" stroke="${muted}" stroke-width="0.8" stroke-dasharray="2 5"/>`;
  const center = `<line x1="${X(0)}" x2="${X(0)}" y1="${mt - 10}" y2="${Y(cr) + 8}" stroke="${muted}" stroke-width="1" stroke-dasharray="4 4"/>`;

  // dimensions
  const dy = Y(Math.max(cr, xle(b / 2) + chord(b / 2))) + 26;
  const arrow = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${ink2}" stroke-width="1.1" marker-start="url(#pa)" marker-end="url(#pa)"/>`;
  const tipX = X(b / 2) + 18;
  const dims = `${arrow(X(-b / 2), dy, X(b / 2), dy)}<rect x="${X(0) - 58}" y="${dy - 11}" width="116" height="22" rx="11" fill="${color('surface')}"/>`
    + `<text x="${X(0)}" y="${dy + 4}" text-anchor="middle" style="font-weight:650;fill:${color('ink')}">b = ${b.toFixed(3)} m</text>`
    + `${arrow(tipX, Y(xle(b / 2)), tipX, Y(xle(b / 2) + chord(b / 2)))}`
    + `<text x="${tipX + 8}" y="${Y(xle(b / 2) + chord(b / 2) / 2) + 4}">c<tspan dy="3" font-size="9">t</tspan><tspan dy="-3"> ${(chord(b / 2) * 1e3).toFixed(0)} mm</tspan></text>`
    + `<text x="${X(0) + 8}" y="${mt - 6}">c<tspan dy="3" font-size="9">r</tspan><tspan dy="-3"> ${(cr * 1e3).toFixed(0)} mm</tspan></text>`
    + `<text x="${X(-b / 2)}" y="${mt - 6}">LE</text>`;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Wing planform, top view, span ${b.toFixed(2)} m">`
    + `<defs><marker id="pa" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1 L9 5 L0 9 z" fill="${ink2}"/></marker></defs>`
    + `${strips}${qc}${sparPoly}${outline}${center}${dims}</svg>`;
}

/**
 * Tip section with the spar to scale, root section dashed behind (side view, both aligned on the
 * unswept quarter-chord line). opt: { coords, cr, ct, tc, spar, fitOk }
 */
export function drawSection(el, opt) {
  const { coords, cr, ct, spar, fitOk } = opt;
  const crm = cr * 1e3, ctm = ct * 1e3;
  const W = Math.max(300, Math.round(el.clientWidth || 600)), ml = 12, mr = 12;
  const sc = (W - ml - mr) / crm;
  const ymax = Math.max(...coords.yu), ymin = Math.min(...coords.yl);
  const top = 40, H = Math.round(top + (ymax - ymin) * crm * sc + 56);
  const zeroY = top + ymax * crm * sc;
  const X = (mm) => ml + mm * sc, Y = (mm) => zeroY - mm * sc;
  const path = (c, x0) => {
    const up = coords.x.map((x, i) => `${f1(X(x0 + x * c))},${f1(Y(coords.yu[i] * c))}`);
    const lo = coords.x.map((x, i) => `${f1(X(x0 + x * c))},${f1(Y(coords.yl[i] * c))}`);
    return `M${[...up].reverse().join(' L')} L${lo.join(' L')} Z`;
  };
  const xleTip = 0.25 * (crm - ctm);
  const xt = coords.xt;
  const yuT = interp(coords.x, coords.yu, xt), ylT = interp(coords.x, coords.yl, xt);
  const xs = xleTip + xt * ctm, ycam = 0.5 * (yuT + ylT) * ctm;
  const tAvail = opt.tc * ctm;
  const gold = '#cfb991', ink2 = color('ink-2'), bad = color('bad');
  let sparSvg;
  if (spar.kind === 'rect') {
    const w = spar.w * 1e3, h = spar.h * 1e3;
    sparSvg = `<rect x="${f1(X(xs - w / 2))}" y="${f1(Y(ycam + h / 2))}" width="${f1(w * sc)}" height="${f1(h * sc)}" rx="2" fill="${fitOk ? gold : bad}" stroke="#000" stroke-width="1.2" opacity="0.95"/>`;
  } else {
    const d = spar.d * 1e3;
    sparSvg = `<circle cx="${f1(X(xs))}" cy="${f1(Y(ycam))}" r="${f1((d / 2) * sc)}" fill="${fitOk ? gold : bad}" stroke="#000" stroke-width="1.2"/>`;
  }
  const tx = X(xs) + ((spar.kind === 'rect' ? spar.w : spar.d) * 1e3 * sc) / 2 + 18;
  const thick = `<line x1="${tx}" x2="${tx}" y1="${f1(Y(yuT * ctm))}" y2="${f1(Y(ylT * ctm))}" stroke="${ink2}" stroke-width="1" marker-start="url(#sa)" marker-end="url(#sa)"/>`
    + `<text x="${tx + 8}" y="${f1(Y(ycam) + 4)}">t = ${tAvail.toFixed(1)} mm</text>`;
  const label = spar.kind === 'rect' ? `spar ${(spar.w * 1e3).toFixed(0)} × ${(spar.h * 1e3).toFixed(0)} mm` : `spar Ø ${(spar.d * 1e3).toFixed(0)} mm`;
  const ybase = Y(ymin * crm) + 30;
  const tipLabel = W < 460 ? `tip ${ctm.toFixed(0)} mm` : `tip chord ${ctm.toFixed(0)} mm`;
  const rootLabel = W < 460 ? `root ${crm.toFixed(0)} mm (dashed)` : `root chord ${crm.toFixed(0)} mm (dashed)`;

  // ---- magnified spar-fit detail at the tip ----
  const sw = (spar.kind === 'rect' ? spar.w : spar.d) * 1e3, shh = (spar.kind === 'rect' ? spar.h : spar.d) * 1e3;
  const capW = (opt.widthFrac || 0) * ctm;
  const xsL = xt * ctm;
  const hw = Math.max(sw, spar.kind === 'rect' ? capW : 0) / 2 + Math.max(shh, tAvail) * 0.9 + 3;
  const u0 = Math.max(0, xsL - hw), u1 = Math.min(ctm, xsL + hw);
  const us = Array.from({ length: 61 }, (_, i) => u0 + ((u1 - u0) * i) / 60);
  const yuL = us.map((u) => interp(coords.x, coords.yu, u / ctm) * ctm), ylL = us.map((u) => interp(coords.x, coords.yl, u / ctm) * ctm);
  const dTop = H + 34, sD = (W - 2 * ml - 70) / (u1 - u0);
  const yTop = Math.max(...yuL), yBot = Math.min(...ylL);
  const H2 = Math.round((yTop - yBot) * sD + 64);
  const DX = (u) => ml + (u - u0) * sD, DY = (y) => dTop + 14 + (yTop - y) * sD;
  const shapePts = [...us.map((u, i) => `${f1(DX(u))},${f1(DY(yuL[i]))}`), ...us.map((u, i) => `${f1(DX(u))},${f1(DY(ylL[i]))}`).reverse()].join(' ');
  const sparD = spar.kind === 'rect'
    ? `<rect x="${f1(DX(xsL - sw / 2))}" y="${f1(DY(ycam + shh / 2))}" width="${f1(sw * sD)}" height="${f1(shh * sD)}" rx="2" fill="${fitOk ? gold : bad}" stroke="#000" stroke-width="1.2"/>`
    : `<circle cx="${f1(DX(xsL))}" cy="${f1(DY(ycam))}" r="${f1((sw / 2) * sD)}" fill="${fitOk ? gold : bad}" stroke="#000" stroke-width="1.2"/>`;
  const vx = DX(xsL + sw / 2) + 14;
  const dimT = `<line x1="${f1(vx)}" x2="${f1(vx)}" y1="${f1(DY(yuT * ctm))}" y2="${f1(DY(ylT * ctm))}" stroke="${ink2}" stroke-width="1" marker-start="url(#sa)" marker-end="url(#sa)"/>`
    + `<text x="${f1(vx + 6)}" y="${f1(DY(ycam) - 2)}" style="font-weight:600;fill:${color('ink')}">${spar.kind === 'rect' ? 'depth' : 'Ø'} ${shh.toFixed(0)} mm</text>`
    + `<text x="${f1(vx + 6)}" y="${f1(DY(ycam) + 13)}">of ${tAvail.toFixed(1)} mm</text>`;
  let dimW = '';
  if (spar.kind === 'rect') {
    const by = DY(Math.min(...ylL)) + 16;
    dimW = `<line x1="${f1(DX(xsL - capW / 2))}" x2="${f1(DX(xsL + capW / 2))}" y1="${f1(by)}" y2="${f1(by)}" stroke="${color('muted')}" stroke-width="1" stroke-dasharray="4 3" marker-start="url(#sa)" marker-end="url(#sa)"/>`
      + `<line x1="${f1(DX(xsL - sw / 2))}" x2="${f1(DX(xsL + sw / 2))}" y1="${f1(by - 9)}" y2="${f1(by - 9)}" stroke="${ink2}" stroke-width="1" marker-start="url(#sa)" marker-end="url(#sa)"/>`
      + `<text x="${f1(DX(xsL))}" y="${f1(by + 15)}" text-anchor="middle">width ${sw.toFixed(0)} mm of ${capW.toFixed(1)} mm cap</text>`;
  }
  const detail = `<text x="${ml}" y="${dTop}" style="font-weight:650;fill:${color('ink')}">Spar fit at the tip · magnified ×${(sD / sc).toFixed(0)}</text>`
    + `<polygon points="${shapePts}" fill="rgba(207,185,145,0.10)" stroke="${gold}" stroke-width="1.8" stroke-linejoin="round"/>${sparD}${dimT}${dimW}`;
  const Htot = H + H2 + 40;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${Htot}" width="${W}" height="${Htot}" role="img" aria-label="Tip section with ${label}">${detail}`
    + `<defs><marker id="sa" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 1 L9 5 L0 9 z" fill="${ink2}"/></marker></defs>`
    + `<path d="${path(crm, 0)}" fill="none" stroke="${color('muted')}" stroke-width="1.3" stroke-dasharray="6 5"/>`
    + `<path d="${path(ctm, xleTip)}" fill="rgba(207,185,145,0.10)" stroke="${gold}" stroke-width="2"/>`
    + `<line x1="${X(xleTip)}" x2="${X(xleTip + ctm)}" y1="${Y(0)}" y2="${Y(0)}" stroke="${color('muted')}" stroke-width="0.8" stroke-dasharray="2 4"/>`
    + `${sparSvg}${thick}`
    + `<text x="${X(xs)}" y="${top - 18}" text-anchor="middle" style="font-weight:650;fill:${fitOk ? color('ink') : bad}">${label}${fitOk ? '' : ' · does not fit'}</text>`
    + `<line x1="${X(xs)}" x2="${X(xs)}" y1="${top - 12}" y2="${f1(Y(ycam + (spar.kind === 'rect' ? spar.h * 1e3 : spar.d * 1e3) / 2) - 2)}" stroke="${ink2}" stroke-width="0.8"/>`
    + `<text x="${X(xleTip)}" y="${ybase}" style="fill:${gold};font-weight:600">${tipLabel}</text>`
    + `<text x="${X(crm)}" y="${ybase}" text-anchor="end">${rootLabel}</text></svg>`;
}

export function drawThumb(el, coords) {
  const W = 300, H = 64, ml = 6, sc = (W - 2 * ml);
  const ymax = Math.max(...coords.yu), ymin = Math.min(...coords.yl);
  const mid = H / 2 + ((ymax + ymin) / 2) * sc;
  const up = coords.x.map((x, i) => `${f1(ml + x * sc)},${f1(mid - coords.yu[i] * sc)}`).reverse();
  const lo = coords.x.map((x, i) => `${f1(ml + x * sc)},${f1(mid - coords.yl[i] * sc)}`);
  el.innerHTML = `<line x1="${ml}" x2="${W - ml}" y1="${mid}" y2="${mid}" stroke="${color('grid')}" stroke-width="1"/>`
    + `<path d="M${up.join(' L')} L${lo.join(' L')} Z" fill="rgba(207,185,145,0.16)" stroke="#cfb991" stroke-width="1.8" stroke-linejoin="round"/>`;
}

/** Several planforms on one scale (top view, LE up, unswept quarter-chord). designs: [{b, cr, lam, color, label}] */
export function drawPlanformOverlay(el, designs) {
  const W = Math.max(320, Math.round(el.clientWidth || 900)), ml = 16, mr = 16, mt = 30 + designs.length * 17;
  const bMax = Math.max(...designs.map((d) => d.b)), crMax = Math.max(...designs.map((d) => d.cr));
  const sc = (W - ml - mr) / bMax;
  const H = Math.round(mt + crMax * sc + 46);
  const X = (yy) => W / 2 + yy * sc, cq = mt + 0.25 * crMax * sc;   // quarter-chord line shared by all
  let svg = `<line x1="${X(-bMax / 2)}" x2="${X(bMax / 2)}" y1="${cq}" y2="${cq}" stroke="${color('muted')}" stroke-width="0.8" stroke-dasharray="2 5"/>`;
  designs.forEach((d, k) => {
    const ct = d.lam * d.cr, s = d.b / 2;
    const pts = [[-s, 0.25 * ct], [0, 0.25 * d.cr], [s, 0.25 * ct], [s, -0.75 * ct], [0, -0.75 * d.cr], [-s, -0.75 * ct]]
      .map(([yy, up]) => `${f1(X(yy))},${f1(cq - up * sc)}`).join(' ');
    svg += `<polygon points="${pts}" fill="${d.color}" fill-opacity="0.13" stroke="${d.color}" stroke-width="2.2" stroke-linejoin="round" ${k ? 'stroke-dasharray="7 4"' : ''}/>`;
    svg += `<line x1="${ml}" x2="${ml + 22}" y1="${12 + k * 17}" y2="${12 + k * 17}" stroke="${d.color}" stroke-width="2.4" ${k ? 'stroke-dasharray="7 4"' : ''}/>`
      + `<text x="${ml + 30}" y="${16 + k * 17}" style="fill:${d.color};font-weight:650">${d.label} · b ${d.b.toFixed(3)} m · S ${(d.b * d.cr * (1 + d.lam) / 2).toFixed(4)} m² · c_r ${(d.cr * 1e3).toFixed(0)} mm · c_t ${(ct * 1e3).toFixed(0)} mm</text>`;
  });
  svg += `<line x1="${X(0)}" x2="${X(0)}" y1="${mt - 6}" y2="${H - 8}" stroke="${color('muted')}" stroke-width="1" stroke-dasharray="4 4"/>`;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Planforms of design A and B to scale">${svg}</svg>`;
}
