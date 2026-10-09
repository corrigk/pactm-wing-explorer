// UI wiring: controls -> state -> evaluation -> charts, requirement list, map and table.
import { DEFAULTS, CONST, CONSTRAINTS } from './config.js';
import { AIRFOILS } from './airfoilData.js';
import { Wing, FULL_GRID } from './liftingLine.js';
import { halfWingLoads, deflectionCurve, describeSpar } from './spar.js';
import { evaluate, sizing, searchGrid, scan, pickBest, isFeasible, violated } from './design.js';
import { linspace } from './numerics.js';
import { lineChart, color } from './plot.js';
import { FeasibleMap, REQ_STYLE } from './map.js';

const $ = (id) => document.getElementById(id);
const REQ_NAMES = {
  alpha: 'Cruise angle of attack', span: 'Span limit', land: 'No stall at landing',
  fit: 'Spar fits in the airfoil at the tip', stress: 'Spar bending stress',
};

// ---- slider definitions: id -> display format. Values live in `ui`; `params()` converts to SI. ----
const SLIDERS = {
  AR: (v) => v.toFixed(2),
  lam: (v) => v.toFixed(2),
  mass: (v) => `${v.toFixed(2)} kg`,
  vCruise: (v) => `${v.toFixed(1)} m/s`,
  vStall: (v) => `${v.toFixed(1)} m/s`,
  knockdown: (v) => v.toFixed(2),
  deflPct: (v) => `${v.toFixed(1)} %`,
  loadFactor: (v) => `${v.toFixed(1)} g`,
  Egpa: (v) => `${v.toFixed(1)} GPa`,
  yieldMpa: (v) => `${v.toFixed(1)} MPa`,
  widthFrac: (v) => `${(v * 100).toFixed(0)} %`,
  spanMax: (v) => `${v.toFixed(2)} m`,
  alphaMax: (v) => `${v.toFixed(1)}°`,
  alphaMin: (v) => `${v.toFixed(1)}°`,
  aL0Shift: (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}°`,
};
const UI_DEFAULTS = {
  mass: DEFAULTS.mass, vCruise: DEFAULTS.vCruise, vStall: DEFAULTS.vStall, knockdown: DEFAULTS.knockdown,
  deflPct: DEFAULTS.deflFrac * 100, loadFactor: DEFAULTS.loadFactor, Egpa: DEFAULTS.E / 1e9,
  yieldMpa: DEFAULTS.yieldStress / 1e6, widthFrac: DEFAULTS.widthFrac, spanMax: DEFAULTS.spanMax,
  alphaMax: DEFAULTS.alphaMax, alphaMin: DEFAULTS.alphaMin, aL0Shift: DEFAULTS.aL0Shift,
};

let ui = { ...UI_DEFAULTS, AR: 12.88, lam: 0.65 };
let airfoilName = 'S7062';
let on = Object.fromEntries(CONSTRAINTS.map((k) => [k, true]));

const params = () => ({
  ...DEFAULTS, mass: ui.mass, vCruise: ui.vCruise, vStall: ui.vStall, knockdown: ui.knockdown,
  deflFrac: ui.deflPct / 100, loadFactor: ui.loadFactor, E: ui.Egpa * 1e9, yieldStress: ui.yieldMpa * 1e6,
  widthFrac: ui.widthFrac, spanMax: ui.spanMax, alphaMax: ui.alphaMax, alphaMin: ui.alphaMin, aL0Shift: ui.aL0Shift,
});
const airfoil = (name = airfoilName) => ({ name, ...AIRFOILS[name] });

// ---- URL hash state ----
function readHash() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (h.has('airfoil') && AIRFOILS[h.get('airfoil')]) airfoilName = h.get('airfoil');
  for (const k of [...Object.keys(UI_DEFAULTS), 'AR', 'lam']) if (h.has(k) && Number.isFinite(+h.get(k))) ui[k] = +h.get(k);
  if (h.has('off')) h.get('off').split(',').forEach((k) => { if (k in on) on[k] = false; });
  return h.has('AR');
}
let hashTimer = null;
function writeHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const h = new URLSearchParams();
    h.set('airfoil', airfoilName);
    h.set('AR', ui.AR.toFixed(3)); h.set('lam', ui.lam.toFixed(3));
    for (const k of Object.keys(UI_DEFAULTS)) if (Math.abs(ui[k] - UI_DEFAULTS[k]) > 1e-9) h.set(k, String(ui[k]));
    const off = CONSTRAINTS.filter((k) => !on[k]);
    if (off.length) h.set('off', off.join(','));
    history.replaceState(null, '', `#${h.toString()}`);
  }, 200);
}

// ---- controls ----
function syncControls() {
  for (const id of Object.keys(SLIDERS)) { $(id).value = ui[id]; $(`v-${id}`).textContent = SLIDERS[id](ui[id]); }
  $('airfoil').value = airfoilName;
  const af = airfoil();
  const { Sreq } = sizing(af, params());
  $('v-vStall').textContent = `${SLIDERS.vStall(ui.vStall)} · S = ${Sreq.toFixed(4)} m²`;
  $('airfoil-facts').innerHTML = `c<sub>l,max</sub> ${af.clmax.toFixed(3)} at ${af.aStall.toFixed(2)}° · α<sub>L0</sub> `
    + `${(af.aL0 + ui.aL0Shift).toFixed(2)}° · t/c ${af.tc.toFixed(3)}`
    + (af.aL0Method === 'fit' ? ' · α<sub>L0</sub> from a fitted attached branch (uncertain)' : '');
}

function initControls() {
  const sel = $('airfoil');
  sel.innerHTML = Object.keys(AIRFOILS).map((n) => `<option>${n}</option>`).join('');
  for (const id of Object.keys(SLIDERS)) {
    $(id).addEventListener('input', () => {
      ui[id] = +$(id).value;
      render();
    });
  }
  sel.addEventListener('change', () => {
    airfoilName = sel.value;
    applyBest();
  });
  $('btn-best').addEventListener('click', applyBest);
  $('btn-reset').addEventListener('click', () => {
    ui = { ...UI_DEFAULTS, AR: 12.88, lam: 0.65 }; airfoilName = 'S7062';
    on = Object.fromEntries(CONSTRAINTS.map((k) => [k, true]));
    applyBest();
  });
  $('btn-copy').addEventListener('click', async () => {
    writeHashNow();
    try { await navigator.clipboard.writeText(location.href); $('btn-copy').textContent = 'Link copied'; }
    catch { $('btn-copy').textContent = 'Copy the address bar'; }
    setTimeout(() => { $('btn-copy').textContent = 'Copy link to this design'; }, 1800);
  });
}
function writeHashNow() { clearTimeout(hashTimer); hashTimer = null; const h = new URLSearchParams(); h.set('airfoil', airfoilName); h.set('AR', ui.AR.toFixed(3)); h.set('lam', ui.lam.toFixed(3)); for (const k of Object.keys(UI_DEFAULTS)) if (Math.abs(ui[k] - UI_DEFAULTS[k]) > 1e-9) h.set(k, String(ui[k])); const off = CONSTRAINTS.filter((k) => !on[k]); if (off.length) h.set('off', off.join(',')); history.replaceState(null, '', `#${h.toString()}`); }

// ---- best design for the current airfoil and settings ----
function findBest(af = airfoil(), p = params()) {
  const { ars, lams } = searchGrid(af, p);
  return pickBest(scan(af, ars, lams, p), on);
}
function applyBest() {
  const { best } = findBest();
  ui.AR = Math.min(+$('AR').max, Math.max(+$('AR').min, best.AR));
  ui.lam = best.lam;
  render();
}

// ---- rendering ----
const fmt = (v, d = 2) => v.toFixed(d);
let mapView = null;
let lastKey = '', mapData = null, bestInfo = null;
let heavyTimer = null, tableVersion = 0;

function render() {
  const af = airfoil(), p = params();
  syncControls();
  const r = evaluate(af, ui.AR, ui.lam, p);
  renderKpis(r, af, p);
  renderReqs(r, af, p);
  renderCharts(r, af, p);
  if (mapData) mapView.overlay({ AR: ui.AR, lam: ui.lam }, bestInfo);
  clearTimeout(heavyTimer);
  heavyTimer = setTimeout(renderHeavy, 70);
  writeHash();
}

function renderKpis(r, af, p) {
  const items = [
    ['Wing area', fmt(r.S, 4), 'm²'], ['Span', fmt(r.b, 3), 'm'],
    ['Chords root / tip', `${(r.cr * 1e3).toFixed(0)} / ${(r.ct * 1e3).toFixed(0)}`, 'mm'],
    ['Cruise C<sub>L</sub>', fmt(r.CLcr, 3), ''], ['Cruise α', fmt(r.alphaCr, 2), '°'],
    ['Cruise L/D', fmt(r.LD, 1), ''], ['C<sub>D</sub> (C<sub>D0</sub> + C<sub>Di</sub>)', `${fmt(r.CD, 4)}`, `(${fmt(r.CD0, 4)} + ${fmt(r.CDi, 4)})`],
    ['Landing α', fmt(r.alphaLand, 2), '°'], ['Tip deflection', fmt(r.deltaPct, 2), '% of span'],
    ['Spar', describeSpar(r.spar), ''],
  ];
  $('kpis').innerHTML = items.map(([k, v, u]) => `<div class="kpi"><div class="k">${k}</div><div class="v">${v} <span class="u">${u}</span></div></div>`).join('');
}

function reqDetail(k, r, af, p) {
  const s = r.spar, ct = r.ct;
  switch (k) {
    case 'alpha': {
      const margin = Math.min(p.alphaMax - r.alphaCr, r.alphaCr - p.alphaMin);
      return `α = ${fmt(r.alphaCr)}° in a window of ${p.alphaMin}° to ${p.alphaMax}° (margin ${margin >= 0 ? '' : '−'}${fmt(Math.abs(margin))}°)`;
    }
    case 'span': return `b = ${fmt(r.b, 3)} m, limit ${fmt(p.spanMax)} m`;
    case 'land': return `peak c<sub>l</sub> = ${fmt(r.clPeakLand, 3)} at α = ${fmt(r.alphaLand)}°, ${fmt(r.landRatio * 100, 0)}% of c<sub>l,max</sub> (${fmt(af.clmax, 3)})`;
    case 'fit': {
      const dMax = af.tc * ct * 1e3;
      return s.kind === 'rect'
        ? `${describeSpar(s)}: depth ${(s.h * 1e3).toFixed(0)} mm of ${dMax.toFixed(1)} mm allowed, width ${(s.w * 1e3).toFixed(0)} mm of ${(p.widthFrac * ct * 1e3).toFixed(1)} mm allowed`
        : `${describeSpar(s)}: diameter ${(s.d * 1e3).toFixed(0)} mm of ${dMax.toFixed(1)} mm allowed`;
    }
    default: return `σ = ${fmt(s.sigma / 1e6, 1)} MPa, yield ${fmt(p.yieldStress / 1e6, 1)} MPa (spar sized to ${fmt(p.deflFrac * 100, 1)}% tip deflection)`;
  }
}

function renderReqs(r, af, p) {
  $('reqs').innerHTML = CONSTRAINTS.map((k) => {
    const met = r.viol[k] <= 0, enabled = on[k];
    const badge = !enabled ? '<span class="badge off">Not applied</span>'
      : met ? '<span class="badge ok">✓ Met</span>' : '<span class="badge bad">✕ Not met</span>';
    return `<div class="req ${enabled ? '' : 'off'}"><input type="checkbox" id="on-${k}" ${enabled ? 'checked' : ''} aria-label="Apply ${REQ_NAMES[k]}">`
      + `<label class="name" for="on-${k}">${REQ_NAMES[k]}</label>${badge}<div class="detail">${reqDetail(k, r, af, p)}</div></div>`;
  }).join('');
  CONSTRAINTS.forEach((k) => $(`on-${k}`).addEventListener('change', (ev) => { on[k] = ev.target.checked; lastKey = ''; render(); }));
}

function renderCharts(r, af, p) {
  const wing = new Wing(r.S, ui.AR, ui.lam);
  const q = 0.5 * CONST.rho * p.vCruise ** 2;
  const d = wing.distribution(r.CLcr, FULL_GRID);
  const clCruise = d.cl, clLand = d.cl.map((v) => (v * r.CLland) / r.CLcr);
  const yDom = [-wing.b / 2, wing.b / 2];
  const c1 = color('s1'), c2 = color('s2'), ink = color('ink');
  lineChart($('ch-cl'), $('lg-cl'), {
    xLabel: 'Spanwise position, y [m]', yLabel: 'Section lift coefficient, c_l',
    xDomain: yDom, yDomain: [0, Math.max(af.clmax * 1.12, Math.max(...clLand) * 1.1)],
    series: [{ name: `Cruise (α = ${fmt(r.alphaCr)}°)`, x: d.y, y: clCruise, color: c1 },
      { name: `Landing (α = ${fmt(r.alphaLand)}°)`, x: d.y, y: clLand, color: c2 }],
    hlines: [{ y: af.clmax, label: `airfoil c_l,max = ${fmt(af.clmax, 3)}`, color: ink }],
    digits: { x: 3, y: 3 },
  });
  const Lp = d.ccl.map((v) => q * v);
  const ell = d.y.map((y) => ((4 * r.W) / (Math.PI * wing.b)) * Math.sqrt(Math.max(0, 1 - (2 * y / wing.b) ** 2)));
  lineChart($('ch-lp'), $('lg-lp'), {
    xLabel: 'Spanwise position, y [m]', yLabel: "Lift per unit span, L'(y) [N/m]",
    xDomain: yDom, yDomain: [0, Math.max(...Lp, ...ell) * 1.1],
    series: [{ name: `Lifting line (e = ${fmt(r.e, 3)})`, x: d.y, y: Lp, color: c1 },
      { name: 'Elliptical, same total lift', x: d.y, y: ell, color: color('ink2'), dash: '6 4', width: 1.6 }],
    digits: { x: 3, y: 2 },
  });
  const loads = halfWingLoads(wing, r.CLcr, p);
  const defl = deflectionCurve(loads, r.spar.I, p).map((v) => v * 1e3);
  const limit = p.deflFrac * wing.b * 1e3;
  lineChart($('ch-df'), $('lg-df'), {
    xLabel: 'Spanwise position from root, y [m]', yLabel: 'Deflection, δ(y) [mm]',
    xDomain: [0, wing.b / 2], yDomain: [0, Math.max(limit, defl[defl.length - 1]) * 1.15],
    series: [{ name: `${describeSpar(r.spar)}`, x: loads.y, y: defl, color: c2 }],
    hlines: [{ y: limit, label: `limit ${fmt(p.deflFrac * 100, 1)}% of span = ${fmt(limit, 0)} mm`, color: ink }],
    digits: { x: 3, y: 1 },
  });
  lineChart($('ch-bm'), $('lg-bm'), {
    xLabel: 'Spanwise position from root, y [m]', yLabel: `Bending moment at ${fmt(p.loadFactor, 1)} g, M(y) [N m]`,
    xDomain: [0, wing.b / 2], yDomain: [0, loads.moment[0] * 1.1],
    series: [{ name: `Root moment ${fmt(loads.moment[0], 1)} N m`, x: loads.y, y: loads.moment, color: c1 }],
    digits: { x: 3, y: 2 },
  });
}

// ---- heavy: map grid, best design, table ----
function renderHeavy() {
  const af = airfoil(), p = params();
  const key = JSON.stringify([airfoilName, p, on]);
  if (key !== lastKey) {
    lastKey = key;
    const { arMax } = searchGrid(af, p);
    const arHi = Math.max(arMax * 1.25, CONST.arMin + 2);
    const ars = linspace(CONST.arMin, arHi, 60);
    const lams = []; for (let l = CONST.taperMin; l <= CONST.taperMax + 1e-9; l += CONST.taperStep) lams.push(Math.round(l * 1e6) / 1e6);
    const res = scan(af, ars, lams, p);
    const b = findBest(af, p);
    bestInfo = { AR: b.best.AR, lam: b.best.lam, ok: b.ok };
    mapData = { ars, lams, res, on, arMax, current: { AR: ui.AR, lam: ui.lam }, best: bestInfo, bestResult: b.best };
    mapView.draw({ ...mapData, current: { AR: ui.AR, lam: ui.lam } });
    renderBestNote(b.best, b.ok);
    renderLegend();
    tableVersion++;
    const v = tableVersion;
    setTimeout(() => renderTable(v), 0);
  } else if (mapData) {
    mapView.draw({ ...mapData, current: { AR: ui.AR, lam: ui.lam } });
  }
}

function renderBestNote(best, ok) {
  $('best-note').innerHTML = ok
    ? `Best found: AR ${fmt(best.AR)}, λ ${fmt(best.lam)} · L/D ${fmt(best.LD, 1)}`
    : `No design meets every applied requirement. Least-violating: AR ${fmt(best.AR)}, λ ${fmt(best.lam)} · L/D ${fmt(best.LD, 1)}, misses ${violated(best, on).map((k) => REQ_NAMES[k].toLowerCase()).join(', ')}`;
}

function renderLegend() {
  const items = CONSTRAINTS.filter((k) => on[k]).map((k) => {
    const c = color(REQ_STYLE[k].css);
    return `<span><span class="swatch" style="border-color:${c};background-image:repeating-linear-gradient(${REQ_STYLE[k].pattern === 'diag2' ? '135deg' : '45deg'},${c} 0 1px,transparent 1px 6px)"></span>${REQ_STYLE[k].label}</span>`;
  });
  items.push(`<span><span class="swatch" style="border-color:${color('s3')};background:${color('s3')}33"></span>all applied requirements met</span>`);
  items.push('<span>━ ━ span limit · thin lines: cruise L/D · ★ best design · ◇ least-violating design · ◉ current design</span>');
  $('map-legend').innerHTML = items.join('');
}

function renderTable(version) {
  const p = params();
  const names = Object.keys(AIRFOILS);
  const rows = [];
  let i = 0;
  const next = () => {
    if (version !== tableVersion) return;
    if (i < names.length) {
      const af = airfoil(names[i]);
      const b = findBest(af, p);
      rows.push({ name: names[i], r: b.best, ok: b.ok });
      i++;
      setTimeout(next, 0);
    } else {
      const head = '<tr><th>Airfoil</th><th>S [m²]</th><th>AR</th><th>λ</th><th>b [m]</th><th>Cruise α [°]</th><th>C<sub>D</sub></th><th>L/D</th><th>Spar</th><th>Status</th></tr>';
      $('tbl').innerHTML = head + rows.map(({ name, r, ok }) => {
        const bad = violated(r, on).map((k) => REQ_NAMES[k].toLowerCase());
        return `<tr class="row ${name === airfoilName ? 'sel' : ''}" data-name="${name}"><td>${name}</td><td>${fmt(r.S, 4)}</td><td>${fmt(r.AR)}</td><td>${fmt(r.lam)}</td><td>${fmt(r.b, 3)}</td>`
          + `<td>${fmt(r.alphaCr)}</td><td>${fmt(r.CD, 4)}</td><td>${fmt(r.LD, 1)}</td><td>${describeSpar(r.spar)}</td>`
          + `<td>${ok ? '<span class="badge ok">✓ All met</span>' : `<span class="badge bad">✕ ${bad.join(', ')}</span>`}</td></tr>`;
      }).join('');
      $('tbl').querySelectorAll('tr.row').forEach((tr) => tr.addEventListener('click', () => { airfoilName = tr.dataset.name; applyBest(); }));
    }
  };
  next();
}

// ---- map hover text ----
function mapTip(AR, lam) {
  const af = airfoil(), p = params();
  const r = evaluate(af, AR, lam, p);
  const bad = violated(r, on).map((k) => REQ_NAMES[k].toLowerCase());
  return `AR ${fmt(AR)}, λ ${fmt(lam)}<br>L/D ${fmt(r.LD, 1)} · α ${fmt(r.alphaCr)}° · b ${fmt(r.b, 2)} m<br>${describeSpar(r.spar)}<br>${bad.length ? `✕ ${bad.join(', ')}` : '✓ all applied requirements met'}`;
}

// ---- start ----
initControls();
mapView = new FeasibleMap($('map'), $('map-tip'), (AR, lam) => {
  ui.AR = Math.min(+$('AR').max, Math.max(+$('AR').min, AR));
  ui.lam = Math.min(+$('lam').max, Math.max(+$('lam').min, lam));
  render();
}, mapTip);
const hadDesign = readHash();
syncControls();
if (hadDesign) render(); else applyBest();
window.addEventListener('resize', () => { clearTimeout(heavyTimer); lastKey = lastKey + '#'; heavyTimer = setTimeout(renderHeavy, 120); });
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { lastKey = ''; render(); });
window.__explorer = { evaluate, sizing, isFeasible };
