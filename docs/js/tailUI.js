// "Tail & Trim" tab (HW7): tail inputs, scissor plot with a draggable design point, requirements, trimmed polar,
// and the six-airfoil design table. The wing is the one set on the Design tab.
import * as T from './tail.js';
import { lineChart, color } from './plot.js';

const D = Math.PI / 180;
const $ = (id) => document.getElementById(id);
const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// key, label, unit, step, min, max, decimals
const FIELDS = [
  ['ARt', 'Tail aspect ratio, AR<sub>t</sub>', '', 0.1, 1, 12, 2],
  ['lamT', 'Tail taper ratio, λ<sub>t</sub>', '', 0.05, 0.2, 1, 2],
  ['lengthMax', 'Max. length, wing LE → tail TE', 'm', 0.01, 0.3, 5, 2],
  ['lt', 'Tail arm ℓ<sub>t</sub> (fixed mode)', 'm', 0.01, 0.2, 5, 3],
  ['SM', 'Static margin target', '', 0.01, 0, 0.6, 2],
  ['rangeMin', 'Min. CG range (selection rule)', 'MAC', 0.01, 0.01, 0.4, 2],
  ['cgFrac', 'CG position in the range, from front', '', 0.05, 0, 1, 2],
  ['toCLt', 'Takeoff: tail C<sub>L</sub>', '', 0.05, -2, -0.05, 2],
  ['toCMreq', 'Takeoff: required C<sub>M,cg</sub>', '', 0.01, 0, 1, 2],
  ['alphaStallDeg', 'α<sub>stall</sub> (manual)', '°', 0.5, -5, 30, 1],
];
const SLIDE = {};
let t = { ...T.TAIL_DEFAULTS };
let mode = 'auto';            // 'auto' = selection rule, 'manual' = user point
let manual = { r: 0.07, xcg: 0.23 };
let ctx = null;               // accessors from main.js
let last = null;              // last design (for drag and hover)
let tableVersion = 0;

export const tailState = () => ({ t, mode, manual });
export function setTailState(s) {
  if (s.t) t = { ...T.TAIL_DEFAULTS, ...s.t };
  if (s.mode) mode = s.mode;
  if (s.manual) manual = { ...manual, ...s.manual };
}
export const tailDefaultsDiff = () => Object.fromEntries(Object.entries(t).filter(([k, v]) => v !== T.TAIL_DEFAULTS[k]));

/** C_Mac and stall data for an airfoil; computed from the polar for user-added airfoils. */
export function tailAirfoil(af) {
  if (af.cmac != null && af.stall) return af;
  const P = af.polar;
  const start = af.aL0Method === 'fit' ? 0 : af.aL0;
  const cms = P.alpha.map((a, i) => [a, P.cm ? P.cm[i] : NaN]).filter(([a, c]) => a >= start && a <= start + 8 && Number.isFinite(c));
  const cmac = cms.length ? cms.reduce((s, [, c]) => s + c, 0) / cms.length : 0;
  return { ...af, cmac, cmMissing: !cms.length, stall: T.stallMetrics ? T.stallMetrics(P.alpha, P.cl) : null };
}

function design(af, wing, p) {
  const wi = T.wingInputs(tailAirfoil(af), wing, p);
  if (mode === 'manual') {
    const lt = t.ltMode === 'fit' ? fitArm(wi, manual.r) : t.lt;
    return T.designManual(wi, t, lt, manual.r, manual.xcg);
  }
  return t.ltMode === 'fit' ? T.designAutoFit(wi, t) : T.designAuto(wi, t, t.lt);
}
function fitArm(wi, r) {               // l_t that gives the length limit for a given tail size
  const St = r * wi.S, bt = Math.sqrt(t.ARt * St);
  const ct = t.lamT === 1 ? St / bt : (2 * St) / (bt * (1 + t.lamT));
  const cr = (2 * wi.S) / (wi.b * (1 + wi.lam));
  return t.lengthMax - (0.25 * cr + 0.75 * ct);
}

// ------------------------------------------------------------------ controls
function buildControls() {
  const box = $('t-controls');
  box.innerHTML = `
    <label class="tctl"><span>Tail airfoil</span><span class="tval">NACA 0012 (symmetric)</span></label>
    <label class="tctl"><span>Tail arm</span><select id="t-ltMode"><option value="fit">Fit to the max. length</option><option value="fixed">Fixed ℓ<sub>t</sub></option></select></label>
    <label class="tctl"><span>α<sub>stall</sub> (stall recovery)</span><select id="t-stallAuto"><option value="1">Auto: α(C<sub>L</sub><sup>max</sup>) − i<sub>w</sub></option><option value="0">Manual value</option></select></label>
    <label class="tctl"><span>Stability line</span><select id="t-dw"><option value="0">HW7 eq. (5) as printed</option><option value="1">Lecture (downwash in C<sub>Lα</sub>)</option></select></label>`
    + FIELDS.map(([k, label, unit, step, min, max]) => `<label class="tctl" id="tc-${k}"><span>${label}</span><span class="numbox"><input type="number" id="t-${k}" step="${step}" min="${min}" max="${max}"><span class="unit">${unit}</span></span><span class="ctl-msg" id="tm-${k}"></span></label>`).join('');
  FIELDS.forEach(([k, , , , min, max]) => {
    SLIDE[k] = { min, max };
    $(`t-${k}`).addEventListener('input', (e) => {
      const v = e.target.value === '' ? NaN : +e.target.value;
      const ok = Number.isFinite(v) && v >= min && v <= max;
      $(`tc-${k}`).classList.toggle('invalid', !ok);
      $(`tm-${k}`).textContent = ok ? '' : `Enter ${min} to ${max}.`;
      if (ok) { t[k] = v; changed(); }
    });
  });
  $('t-ltMode').addEventListener('change', (e) => { t.ltMode = e.target.value; changed(); });
  $('t-stallAuto').addEventListener('change', (e) => { t.stallAuto = e.target.value === '1'; changed(); });
  $('t-dw').addEventListener('change', (e) => { t.downwashInCLa = e.target.value === '1'; changed(); });
  $('t-auto').addEventListener('click', () => { mode = 'auto'; changed(); });
  $('t-reset').addEventListener('click', () => { t = { ...T.TAIL_DEFAULTS }; mode = 'auto'; changed(); });
  ['r', 'xcg'].forEach((k) => $(`t-man-${k}`).addEventListener('input', (e) => {
    const v = +e.target.value, ok = e.target.value !== '' && (k === 'r' ? v > 0.005 && v <= 1.5 : v >= 0 && v <= 0.6);
    e.target.style.borderColor = ok ? '' : color('bad');
    if (ok) { manual[k] = v; mode = 'manual'; changed(); }
  }));
}
function syncControls() {
  FIELDS.forEach(([k, , , , , , dec]) => { const n = $(`t-${k}`); if (document.activeElement !== n) n.value = (+t[k]).toFixed(dec); });
  $('t-ltMode').value = t.ltMode; $('t-stallAuto').value = t.stallAuto ? '1' : '0'; $('t-dw').value = t.downwashInCLa ? '1' : '0';
  $('tc-lt').style.opacity = t.ltMode === 'fixed' ? 1 : 0.45;
  $('tc-lengthMax').style.opacity = t.ltMode === 'fit' ? 1 : 0.45;
  $('tc-alphaStallDeg').style.opacity = t.stallAuto ? 0.45 : 1;
  $('tc-rangeMin').style.opacity = mode === 'auto' ? 1 : 0.45;
  $('tc-cgFrac').style.opacity = mode === 'auto' ? 1 : 0.45;
  $('t-mode').innerHTML = mode === 'auto'
    ? 'Design point: <b>selection rule</b> (smallest tail with the required CG range). Drag the point on the scissor plot to choose your own.'
    : 'Design point: <b>your choice</b>. <button class="linkbtn" id="t-auto2" type="button">Back to the selection rule</button>';
  if ($('t-auto2')) $('t-auto2').addEventListener('click', () => { mode = 'auto'; changed(); });
  if (last && last.feasible !== false) {
    for (const [k, v, dec] of [['r', last.r, 4], ['xcg', last.xcg, 3]]) { const n = $(`t-man-${k}`); if (document.activeElement !== n) n.value = v.toFixed(dec); }
  }
}
const changed = () => { ctx.onChange(); };

// ------------------------------------------------------------------ render
export function renderTail() {
  const { af, wing, p, on } = ctx.current();
  const d = design(af, wing, p);
  last = d;
  syncControls();
  if (!d.feasible) {
    $('t-status').innerHTML = `<div><div class="hint">Wing from the Design tab</div><div class="air">${esc(af.name)}</div></div><span class="pill bad">✕ No tail size up to S<sub>t</sub>/S<sub>w</sub> = 0.8 gives the required CG range</span>`;
    $('t-kpis').innerHTML = ''; $('t-reqs').innerHTML = '';
    drawScissor(d); scheduleTable(p, on);
    return;
  }
  const reqs = requirements(d);
  const bad = reqs.filter((q) => !q.ok);
  $('t-status').innerHTML = `<div><div class="hint">Wing from the Design tab · AR ${fmt(d.wi.AR)} · λ ${fmt(d.wi.lam)}</div><div class="air">${esc(af.name)}</div></div>`
    + `<div class="ld"><span class="v">${fmt(d.LD, 1)}</span><span class="k">trimmed cruise L/D</span></div>`
    + (bad.length ? `<span class="pill bad">✕ Misses ${bad.length} of ${reqs.length}: ${bad.map((q) => q.name.toLowerCase()).join(', ')}</span>`
      : `<span class="pill ok">✓ All ${reqs.length} requirements met</span>`);
  const tiles = [
    ['Tail area S<sub>t</sub>', fmt(d.St, 4), 'm²', `S<sub>t</sub>/S<sub>w</sub> = ${fmt(d.r, 4)}`],
    ['Tail span × chord', `${(d.bt * 1e3).toFixed(0)} × ${(d.ct * 1e3).toFixed(0)}`, 'mm', `AR<sub>t</sub> ${fmt(d.ARt, 2)} · λ<sub>t</sub> ${fmt(d.lamT, 2)}`],
    ['Tail arm ℓ<sub>t</sub>', fmt(d.lt, 3), 'm', `overall ${fmt(d.Ltotal, 3)} m`],
    ['CG, x̄<sub>cg</sub>', fmt(d.xcg, 3), 'MAC', d.cgRange ? `range ${fmt(d.cgRange[0], 3)}–${fmt(d.cgRange[1], 3)}` : 'outside the feasible range'],
    ['Static margin', fmt(d.SMlec, 3), '', `HW7 eq. (3) as printed: ${fmt(d.SMhw7, 3)}`],
    ['Tail volume V<sub>H</sub>', fmt(d.VH, 3), '', `dε/dα ${fmt(d.deps, 3)}`],
    ['Wing set angle i<sub>w</sub>', fmt(d.iw / D, 2), '°', 'trimmed α<sub>FRL</sub> = 0°'],
    ['Tail incidence i<sub>t</sub>', fmt(d.it / D, 2), '°', `tail C<sub>L</sub> ${fmt(d.CLt, 3)}`],
    ['Trimmed C<sub>D</sub>', fmt(d.CD, 4), '', `C<sub>D0</sub> ${fmt(d.CD0, 4)}`],
    ['Cruise C<sub>L</sub>', fmt(d.wi.CLcr, 3), '', `wing ${fmt(d.CLw, 3)}`],
  ];
  $('t-kpis').innerHTML = tiles.map(([k, v, u, s]) => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}<span class="u">${u}</span></div><div class="s">${s}</div></div>`).join('');
  $('t-reqs').innerHTML = reqs.map((q) => `<div class="req"><div class="req-top"><label>${q.name}</label>${q.ok ? '<span class="badge ok">✓ Met</span>' : '<span class="badge bad">✕ Not met</span>'}</div>${gauge(q.ratio)}<div class="detail">${q.detail}</div></div>`).join('');
  drawScissor(d);
  drawPolar(d);
  scheduleTable(p, on);
}

function lineAt(L, x) {
  const i = Math.max(0, Math.min(T.XGRID.length - 1, Math.round((x / 0.6) * (T.XGRID.length - 1))));
  return L[i];
}
function requirements(d) {
  const [stab, to, st] = d.lines;
  const SMv = d.SMlec;
  const toR = lineAt(to, d.xcg), stR = lineAt(st, d.xcg);
  return [
    { name: 'Static margin', ok: SMv >= t.SM - 1e-9, ratio: SMv > 0 ? t.SM / SMv : 2, detail: `SM ${fmt(SMv, 3)} at x̄<sub>cg</sub> ${fmt(d.xcg, 3)} · target ≥ ${fmt(t.SM, 2)}` },
    { name: 'Takeoff rotation', ok: d.r >= toR - 1e-9, ratio: toR / d.r, detail: `needs S<sub>t</sub>/S<sub>w</sub> ≥ ${fmt(toR, 4)} at this CG · have ${fmt(d.r, 4)}` },
    { name: 'Stall recovery', ok: d.r >= stR - 1e-9, ratio: stR / d.r, detail: `needs S<sub>t</sub>/S<sub>w</sub> ≥ ${fmt(stR, 4)} at this CG · α<sub>stall</sub> ${fmt(d.alphaStall / D, 1)}°` },
    { name: 'Overall length', ok: d.Ltotal <= t.lengthMax + 1e-6, ratio: d.Ltotal / t.lengthMax, detail: `wing root LE to tail TE ${fmt(d.Ltotal, 3)} m · limit ${fmt(t.lengthMax, 2)} m` },
    { name: 'Tail AR below wing AR', ok: d.ARt < d.wi.AR, ratio: d.ARt / d.wi.AR, detail: `AR<sub>t</sub> ${fmt(d.ARt, 2)} · AR<sub>w</sub> ${fmt(d.wi.AR, 2)} · C<sub>Lα,t</sub> ${fmt(d.CLaT, 2)} vs ${fmt(d.wi.CLa, 2)} /rad` },
    { name: 'Trimmed at α_FRL = 0', ok: Math.abs(d.iw / D) <= 8, ratio: Math.abs(d.iw / D) / 8, detail: `i<sub>w</sub> ${fmt(d.iw / D, 2)}° · i<sub>t</sub> ${fmt(d.it / D, 2)}° (flagged if |i<sub>w</sub>| > 8°)` },
  ];
}
function gauge(ratio) {
  const span = 1.25, w = (Math.min(Math.max(ratio, 0), span) / span) * 100;
  return `<div class="gauge"><div class="fill ${ratio > 1 ? 'bad' : ''}" style="width:${w.toFixed(1)}%"></div><div class="mark" style="left:${100 / span}%"></div></div>`;
}

// ------------------------------------------------------------------ scissor plot (SVG, draggable point)
function drawScissor(d) {
  const el = $('t-scissor');
  const W = Math.max(320, Math.round(el.clientWidth || 600)), H = Math.round(Math.min(440, Math.max(280, W * 0.62)));
  const m = { l: 56, r: 14, t: 14, b: 44 };
  const L = d.lines;
  const yMax = d.feasible ? Math.max(0.25, Math.ceil(d.r * 2.6 * 20) / 20) : 0.5;
  const sx = (x) => m.l + (x / 0.6) * (W - m.l - m.r), sy = (y) => H - m.b - (y / yMax) * (H - m.t - m.b);
  const clip = (y) => Math.max(-0.05 * yMax, Math.min(yMax * 1.05, y));
  const path = (arr) => T.XGRID.map((x, i) => (Number.isFinite(arr[i]) ? `${i ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(clip(arr[i])).toFixed(1)}` : '')).join('');
  const lo = T.XGRID.map((_, i) => Math.max(...L.map((l) => (Number.isFinite(l[i]) ? l[i] : Infinity))));
  let region = '';
  T.XGRID.forEach((x, i) => { if (i % 2 === 0 && lo[i] < yMax) region += `${sx(x).toFixed(1)},${sy(Math.max(0, lo[i])).toFixed(1)} `; });
  const regionPoly = region ? `<polygon points="${region}${sx(T.XGRID.filter((_, i) => i % 2 === 0 && lo[i] < yMax).slice(-1)[0]).toFixed(1)},${sy(yMax)} ${sx(T.XGRID.find((_, i) => i % 2 === 0 && lo[i] < yMax)).toFixed(1)},${sy(yMax)}" fill="#cfb991" fill-opacity="0.16"/>` : '';
  let grid = '', ax = '';
  for (let x = 0; x <= 0.6001; x += 0.1) { grid += `<line x1="${sx(x)}" x2="${sx(x)}" y1="${m.t}" y2="${H - m.b}"/>`; ax += `<text x="${sx(x)}" y="${H - m.b + 16}" text-anchor="middle">${x.toFixed(1)}</text>`; }
  const ys = yMax > 0.4 ? 0.1 : 0.05;
  for (let y = 0; y <= yMax + 1e-9; y += ys) { grid += `<line x1="${m.l}" x2="${W - m.r}" y1="${sy(y)}" y2="${sy(y)}"/>`; ax += `<text x="${m.l - 7}" y="${sy(y) + 4}" text-anchor="end">${y.toFixed(2)}</text>`; }
  const cs = color('k-alpha'), co = color('k-span'), cl = color('k-land'), ink = color('ink');
  let point = '';
  if (d.feasible !== false && d.r != null) {
    const seg = d.cgRange ? `<line x1="${sx(d.cgRange[0])}" x2="${sx(d.cgRange[1])}" y1="${sy(d.r)}" y2="${sy(d.r)}" stroke="${ink}" stroke-width="3.5" stroke-linecap="round"/>` : '';
    const cx = sx(d.xcg), cy = sy(d.r), R = 11;
    let star = '';
    for (let k = 0; k < 10; k++) { const rr = k % 2 ? R * 0.45 : R, a = -Math.PI / 2 + (k * Math.PI) / 5; star += `${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)} `; }
    point = `${seg}<polygon points="${star}" fill="#cfb991" stroke="#000" stroke-width="1.5"/>`;
  }
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Scissor plot of tail area ratio against CG position">`
    + `<defs><clipPath id="tsc"><rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}"/></clipPath></defs>`
    + `<g class="grid">${grid}</g><line class="axisline" x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/><line class="axisline" x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${H - m.b}"/>${ax}`
    + `<text class="axis-label" x="${(m.l + W - m.r) / 2}" y="${H - 6}" text-anchor="middle">CG position, x̄_cg [fraction of wing MAC]</text>`
    + `<text class="axis-label" transform="translate(14 ${(m.t + H - m.b) / 2}) rotate(-90)" text-anchor="middle">Tail-to-wing area ratio, S_t/S_w</text>`
    + `<g clip-path="url(#tsc)">${regionPoly}<path d="${path(L[0])}" fill="none" stroke="${cs}" stroke-width="2.4"/><path d="${path(L[1])}" fill="none" stroke="${co}" stroke-width="2.4"/><path d="${path(L[2])}" fill="none" stroke="${cl}" stroke-width="2.4"/>${point}</g>`
    + `<rect class="hit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent" style="cursor:crosshair"/></svg><div class="tip"></div>`;
  $('t-scissor-legend').innerHTML = `<span><i style="border-color:${cs}"></i>stability, SM = ${fmt(t.SM, 2)}</span><span><i style="border-color:${co}"></i>takeoff rotation (forward limit)</span>`
    + `<span><i style="border-color:${cl}"></i>stall recovery (aft limit)</span><span><i style="border-color:${ink}"></i>chosen S<sub>t</sub>/S<sub>w</sub> over the feasible CG range</span><span>shaded: feasible · ★ design point</span>`;
  const svg = el.querySelector('svg'), hit = el.querySelector('.hit'), tip = el.querySelector('.tip');
  const toData = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W, py = ((ev.clientY - r.top) / r.height) * H;
    return { x: Math.max(0, Math.min(0.6, ((px - m.l) / (W - m.l - m.r)) * 0.6)), y: Math.max(0.005, ((H - m.b - py) / (H - m.t - m.b)) * yMax), px, py, r };
  };
  let drag = false;
  const pick = (ev) => { const q = toData(ev); manual = { r: +q.y.toFixed(4), xcg: +q.x.toFixed(3) }; mode = 'manual'; changed(); };
  hit.addEventListener('pointerdown', (ev) => { hit.setPointerCapture(ev.pointerId); drag = true; pick(ev); });
  hit.addEventListener('pointerup', () => { drag = false; });
  hit.addEventListener('pointermove', (ev) => {
    if (drag) { pick(ev); return; }
    const q = toData(ev);
    const vals = L.map((l) => lineAt(l, q.x));
    tip.innerHTML = `<b>x̄<sub>cg</sub> ${fmt(q.x, 3)} · S<sub>t</sub>/S<sub>w</sub> ${fmt(q.y, 4)}</b><br>`
      + `<span style="color:${cs}">●</span> stability needs ${fmt(vals[0], 4)}<br><span style="color:${co}">●</span> takeoff needs ${fmt(vals[1], 4)}<br><span style="color:${cl}">●</span> stall recovery needs ${fmt(vals[2], 4)}<br>`
      + (vals.every((v) => q.y >= v) ? `<span style="color:${color('ok')}">✓ feasible</span>` : `<span style="color:${color('bad')}">✕ outside the feasible region</span>`)
      + '<br><span class="hint">click or drag to place the design</span>';
    tip.style.display = 'block';
    const left = (q.px / W) * q.r.width;
    tip.style.left = `${left + 14 + tip.offsetWidth > q.r.width ? left - tip.offsetWidth - 14 : left + 14}px`;
    tip.style.top = `${Math.max(4, (q.py / H) * q.r.height - 20)}px`;
  });
  hit.addEventListener('pointerleave', () => { tip.style.display = 'none'; drag = false; });
}

function drawPolar(d) {
  const pol = T.trimmedPolar(d);
  const wi = d.wi;
  const untrim = pol.CL.map((c) => d.CD0 + (c * c) / (Math.PI * wi.e * wi.AR));
  lineChart($('t-polar'), $('t-polar-legend'), {
    xLabel: 'Drag coefficient, C_D', yLabel: 'Lift coefficient, C_L',
    xDomain: [0, Math.max(...pol.CD, ...untrim) * 1.08], yDomain: [0, wi.CLmax * 1.08],
    series: [{ name: 'Trimmed (wing + tail)', x: pol.CD, y: pol.CL, color: color('c1'), extra: (i) => `L/D ${fmt(pol.CL[i] / pol.CD[i], 1)}` },
      { name: 'Wing alone, untrimmed', x: untrim, y: pol.CL, color: color('muted'), dash: '6 5', width: 1.6 }],
    points: [{ x: d.CD, y: wi.CLcr, color: color('c2'), label: `cruise: C_D ${fmt(d.CD, 4)}, L/D ${fmt(d.LD, 1)}` }],
    hover: 'nearest', digits: { x: 4, y: 3 },
  });
}

// ------------------------------------------------------------------ six-airfoil table (part f)
function scheduleTable(p, on) {
  const v = ++tableVersion;
  $('t-tbl-note').textContent = 'Computing…';
  const names = ctx.airfoilNames();
  const rows = [];
  let i = 0;
  const step = () => {
    if (v !== tableVersion) return;
    if (i < names.length) {
      const name = names[i++];
      const af = ctx.airfoil(name);
      const hw6 = ctx.bestWing(af, p, on);
      const wi = T.wingInputs(tailAirfoil(af), hw6, p);
      const d = t.ltMode === 'fit' ? T.designAutoFit(wi, t) : T.designAuto(wi, t, t.lt);
      rows.push({ name, af: tailAirfoil(af), d });
      setTimeout(step, 0);
      return;
    }
    renderTable(rows);
  };
  setTimeout(step, 30);
}
function renderTable(rows) {
  const cur = ctx.current().af.name;
  const head = '<tr><th>Wing airfoil</th><th>C<sub>D0</sub></th><th>S<sub>w</sub> [m²]</th><th>AR<sub>w</sub></th><th>S<sub>t</sub> [m²]</th><th>AR<sub>t</sub></th><th>x̄<sub>cg</sub></th><th>SM</th><th>Trimmed C<sub>D</sub></th><th>L/D</th><th>i<sub>w</sub></th><th>ℓ<sub>t</sub> [m]</th><th>Stall</th></tr>';
  const best = rows.filter((r) => r.d.feasible).reduce((a, b) => (!a || b.d.LD > a.d.LD ? b : a), null);
  $('t-tbl').innerHTML = head + rows.map(({ name, af, d }) => {
    if (!d.feasible) return `<tr class="row" data-name="${esc(name)}"><td>${esc(name)}</td><td colspan="12">no feasible tail size</td></tr>`;
    const SMv = d.SMlec;
    const stall = af.stall ? (af.stall.label || '').replace(' (sweep ends before stall)', '*') : '—';
    return `<tr class="row ${name === cur ? 'sel' : ''}" data-name="${esc(name)}" tabindex="0"><td>${af.custom ? '★ ' : ''}${esc(name)}</td><td>${fmt(d.CD0, 5)}</td><td>${fmt(d.wi.S, 4)}</td><td>${fmt(d.wi.AR, 2)}</td>`
      + `<td>${fmt(d.St, 4)}</td><td>${fmt(d.ARt, 2)}</td><td>${fmt(d.xcg, 3)}</td><td>${fmt(SMv, 3)}</td><td>${fmt(d.CD, 5)}</td>`
      + `<td><b>${fmt(d.LD, 2)}</b>${best && best.name === name ? ' ★' : ''}</td><td>${fmt(Math.abs(d.iw / D) < 0.05 ? 0 : d.iw / D, 1)}°</td><td>${fmt(d.lt, 3)}</td><td>${stall}</td></tr>`;
  }).join('');
  $('t-tbl-note').innerHTML = 'Each row: that airfoil\'s best HW6 wing for the current mission, with the tail settings above and the selection rule. '
    + '* the polar ends before the post-stall region. ★ highest trimmed L/D. Click a row to load that wing.';
  $('t-tbl').querySelectorAll('tr.row').forEach((tr) => tr.addEventListener('click', () => ctx.selectAirfoil(tr.dataset.name)));
}

export function initTail(accessors) {
  ctx = accessors;
  buildControls();
}
