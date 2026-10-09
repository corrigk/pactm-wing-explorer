// UI: inputs -> state -> evaluation -> hero, requirements, geometry, charts; heavy grids in a worker.
import { DEFAULTS, CONST, CONSTRAINTS } from './config.js';
import { AIRFOILS } from './airfoilData.js';
import { Wing, FULL_GRID } from './liftingLine.js';
import { halfWingLoads, deflectionCurve, describeSpar } from './spar.js';
import { evaluate, sizing, violated } from './design.js';
import { lineChart, color } from './plot.js';
import { FeasibleMap, REQ_STYLE } from './map.js';
import { drawPlanform, drawSection, drawThumb, colorbarHtml } from './visuals.js';
import { Wing3D } from './wing3d.js';
import { runJob, bestFor } from './jobs.js';

const $ = (id) => document.getElementById(id);
const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');

const REQ_NAMES = {
  alpha: 'Cruise angle of attack', span: 'Span limit', land: 'No stall at landing',
  fit: 'Spar fits at the tip', stress: 'Spar bending stress',
};

// group, key, label, unit, slider min, slider max, step, hard min, hard max, decimals
const CONTROLS = [
  ['airfoil', 'aL0Shift', 'α<sub>L0</sub> adjustment', '°', -3, 3, 0.1, -10, 10, 1],
  ['design', 'AR', 'Aspect ratio, AR', '', 4, 22, 0.01, 1.5, 40, 2],
  ['design', 'lam', 'Taper ratio, λ = c<sub>tip</sub>/c<sub>root</sub>', '', 0.2, 1, 0.01, 0.05, 1.5, 2],
  ['mission', 'mass', 'Mass', 'kg', 1.5, 5, 0.05, 0.1, 50, 2],
  ['mission', 'vCruise', 'Cruise speed', 'm/s', 8, 30, 0.5, 1, 100, 1],
  ['mission', 'vStall', 'Stall speed (sets wing area)', 'm/s', 5, 15, 0.1, 1, 60, 1],
  ['mission', 'landFactor', 'Landing speed ÷ V<sub>stall</sub>', '×', 1, 1.6, 0.01, 1, 3, 2],
  ['mission', 'descentDeg', 'Landing descent angle', '°', 0, 8, 0.5, 0, 30, 1],
  ['mission', 'knockdown', 'Wing C<sub>L</sub><sup>max</sup> ÷ airfoil c<sub>l,max</sub>', '×', 0.6, 1, 0.01, 0.2, 1.5, 2],
  ['structure', 'loadFactor', 'Design load factor', 'g', 1, 6, 0.1, 0.5, 20, 1],
  ['structure', 'deflPct', 'Tip deflection limit', '% b', 1, 8, 0.1, 0.1, 30, 1],
  ['structure', 'Egpa', 'Young’s modulus, E', 'GPa', 3, 14, 0.1, 0.1, 300, 1],
  ['structure', 'yieldMpa', 'Yield strength', 'MPa', 10, 60, 0.5, 0.5, 2000, 1],
  ['structure', 'widthPct', 'Rect. spar width cap', '% c<sub>t</sub>', 10, 60, 1, 1, 100, 0],
  ['limits', 'spanMax', 'Span limit', 'm', 1.2, 3, 0.05, 0.2, 20, 2],
  ['limits', 'alphaMin', 'Cruise α window, lower', '°', -6, 2, 0.5, -20, 20, 1],
  ['limits', 'alphaMax', 'Cruise α window, upper', '°', 0, 8, 0.5, -20, 30, 1],
];
const CTL = Object.fromEntries(CONTROLS.map((c) => [c[1], { group: c[0], key: c[1], label: c[2], unit: c[3], min: c[4], max: c[5], step: c[6], hmin: c[7], hmax: c[8], dec: c[9] }]));

/** HW6 Problem 3 mission requirements and limits. */
const HW6 = {
  aL0Shift: 0, mass: 2.85, vCruise: 15, vStall: 10, landFactor: 1.2, descentDeg: 3, knockdown: 0.9,
  loadFactor: 3, deflPct: 3, Egpa: 7, yieldMpa: 21.6, widthPct: 25, spanMax: 2, alphaMin: -1, alphaMax: 3,
};

let ui = { ...HW6, AR: 12.88, lam: 0.65 };
let airfoilName = 'S7062';
let on = Object.fromEntries(CONSTRAINTS.map((k) => [k, true]));
let pfMode = 'cruise';

const params = () => ({
  ...DEFAULTS, mass: ui.mass, vCruise: ui.vCruise, vStall: ui.vStall, landFactor: ui.landFactor, descentDeg: ui.descentDeg,
  knockdown: ui.knockdown, loadFactor: ui.loadFactor, deflFrac: ui.deflPct / 100, E: ui.Egpa * 1e9,
  yieldStress: ui.yieldMpa * 1e6, widthFrac: ui.widthPct / 100, spanMax: ui.spanMax, alphaMin: ui.alphaMin,
  alphaMax: ui.alphaMax, aL0Shift: ui.aL0Shift,
});
const airfoil = (name = airfoilName) => ({ name, ...AIRFOILS[name] });

// ---------------------------------------------------------------- inputs
function buildControls() {
  for (const c of CONTROLS) {
    const k = c[1], d = CTL[k];
    const box = document.createElement('div');
    box.className = 'ctl'; box.id = `c-${k}`;
    box.innerHTML = `<div class="ctl-top"><label class="ctl-label" for="n-${k}">${d.label}</label>`
      + `<span class="numbox"><input id="n-${k}" type="number" inputmode="decimal" step="${d.step}" aria-describedby="m-${k}"><span class="unit">${d.unit}</span></span></div>`
      + `<div class="range-wrap"><input type="range" id="r-${k}" min="${d.min}" max="${d.max}" step="${d.step}" aria-label="${d.label.replace(/<[^>]+>/g, '')} slider" tabindex="-1"></div>`
      + `<div class="ctl-msg" id="m-${k}" role="alert"></div>`;
    $(`g-${d.group}`).appendChild(box);
    const range = box.querySelector('input[type=range]'), num = box.querySelector('input[type=number]');
    range.addEventListener('input', () => {
      ui[k] = +range.value; box.classList.remove('invalid', 'pinned');
      num.value = (+range.value).toFixed(d.dec);
      setFill(range); onInputChanged(k);
    });
    num.addEventListener('input', () => {
      const v = num.value.trim() === '' ? NaN : +num.value;
      const msg = validate(k, v);
      if (msg) { box.classList.add('invalid'); $(`m-${k}`).textContent = msg; return; }
      box.classList.remove('invalid');
      ui[k] = v; syncRange(k); onInputChanged(k);
    });
    num.addEventListener('change', () => { if (!box.classList.contains('invalid')) num.value = (+ui[k]).toFixed(d.dec); });
    num.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const nv = +(ui[k] + (e.key === 'ArrowUp' ? 1 : -1) * d.step * (e.shiftKey ? 10 : 1)).toFixed(6);
      if (validate(k, nv)) return;
      ui[k] = nv; num.value = nv.toFixed(d.dec); syncRange(k); onInputChanged(k);
    });
  }
}

function validate(k, v) {
  const d = CTL[k];
  if (!Number.isFinite(v)) return 'Enter a number.';
  if (v < d.hmin || v > d.hmax) return `Enter a value between ${d.hmin} and ${d.hmax}${d.unit ? ' ' + d.unit.replace(/<[^>]+>/g, '') : ''}.`;
  if (k === 'alphaMin' && v >= ui.alphaMax) return 'Lower limit must be below the upper limit.';
  if (k === 'alphaMax' && v <= ui.alphaMin) return 'Upper limit must be above the lower limit.';
  if (k === 'vStall' && v >= ui.vCruise * 1.5) return 'Stall speed must be well below cruise speed.';
  return '';
}

function setFill(range) {
  const pct = ((+range.value - +range.min) / (+range.max - +range.min)) * 100;
  range.style.setProperty('--fill', `${Math.max(0, Math.min(100, pct))}%`);
}
function syncRange(k) {
  const d = CTL[k], r = $(`r-${k}`);
  r.value = ui[k]; setFill(r);
  $(`c-${k}`).classList.toggle('pinned', ui[k] < d.min || ui[k] > d.max);
}
function syncInputs() {
  for (const k of Object.keys(CTL)) {
    const n = $(`n-${k}`);
    if (document.activeElement !== n) n.value = (+ui[k]).toFixed(CTL[k].dec);
    $(`c-${k}`).classList.remove('invalid');
    syncRange(k);
  }
  $('airfoil').value = airfoilName;
}

function onInputChanged(k) {
  if (k === 'AR' || k === 'lam') scheduleRender(false);
  else scheduleRender(true);
}

// ---------------------------------------------------------------- state <-> URL
function readHash() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (h.has('airfoil') && AIRFOILS[h.get('airfoil')]) airfoilName = h.get('airfoil');
  if (h.has('widthFrac') && !h.has('widthPct')) h.set('widthPct', String(100 * +h.get('widthFrac')));
  for (const k of Object.keys(CTL)) if (h.has(k) && Number.isFinite(+h.get(k)) && !validate(k, +h.get(k))) ui[k] = +h.get(k);
  if (h.has('off')) h.get('off').split(',').forEach((k) => { if (k in on) on[k] = false; });
  return h.has('AR');
}
function hashString() {
  const h = new URLSearchParams();
  h.set('airfoil', airfoilName); h.set('AR', String(+ui.AR.toPrecision(12))); h.set('lam', String(+ui.lam.toPrecision(12)));
  for (const k of Object.keys(HW6)) if (Math.abs(ui[k] - HW6[k]) > 1e-9) h.set(k, String(+ui[k].toFixed(6)));
  const off = CONSTRAINTS.filter((k) => !on[k]);
  if (off.length) h.set('off', off.join(','));
  return `#${h.toString()}`;
}
let hashTimer = null;
const writeHash = (now = false) => {
  clearTimeout(hashTimer);
  const go = () => history.replaceState(null, '', hashString());
  if (now) go(); else hashTimer = setTimeout(go, 250);
};

// ---------------------------------------------------------------- best design
function applyBest() {
  const b = bestFor(airfoil(), params(), on);
  ui.AR = b.AR; ui.lam = b.lam;
  syncInputs();
  scheduleRender(true);
}

// ---------------------------------------------------------------- render scheduling
let rafPending = false, heavyNeeded = false;
function scheduleRender(heavy) {
  heavyNeeded = heavyNeeded || heavy;
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    renderFast();
    requestHeavy(heavyNeeded);
    heavyNeeded = false;
  });
}

function renderFast() {
  const af = airfoil(), p = params();
  const r = evaluate(af, ui.AR, ui.lam, p);
  renderAirfoilCard(af, p);
  renderStatus(r, af);
  renderKpis(r);
  renderReqs(r, af, p);
  const wing = new Wing(r.S, ui.AR, ui.lam);
  const dist = wing.distribution(r.CLcr, FULL_GRID);
  const loads = halfWingLoads(wing, r.CLcr, p);
  const defl = deflectionCurve(loads, r.spar.I, p);
  renderGeometry(r, af, wing, dist, loads, defl, p);
  renderCharts(r, af, p, wing, dist, loads, defl);
  if (mapMsg) mapView.overlay({ AR: ui.AR, lam: ui.lam }, mapMsg.best);
  writeHash();
}

// ---------------------------------------------------------------- cards
function renderAirfoilCard(af, p) {
  const { Sreq } = sizing(af, p);
  if (renderAirfoilCard.last !== af.name) { drawThumb($('af-thumb'), af.coords); renderAirfoilCard.last = af.name; }
  const facts = [
    ['c<sub>l,max</sub>', fmt(af.clmax, 3)], ['α at c<sub>l,max</sub>', `${fmt(af.aStall, 2)}°`], ['t/c', fmt(af.tc, 3)],
    ['α<sub>L0</sub>', `${fmt(af.aL0 + ui.aL0Shift, 2)}°`], ['C<sub>L</sub><sup>max</sup> wing', fmt(ui.knockdown * af.clmax, 3)], ['S from V<sub>stall</sub>', `${fmt(Sreq, 4)} m²`],
  ];
  $('af-facts').innerHTML = facts.map(([k, v]) => `<div class="fact"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  $('af-warn').textContent = af.aL0Method === 'fit'
    ? 'This α_L0 comes from a fitted attached branch and is uncertain (≈ −8.8° to −13°). Try the adjustment.' : '';
}

function renderStatus(r, af) {
  const applied = CONSTRAINTS.filter((k) => on[k]);
  const bad = violated(r, on);
  const pill = bad.length
    ? `<span class="pill bad">✕ Misses ${bad.length} of ${applied.length}: ${bad.map((k) => REQ_NAMES[k].toLowerCase()).join(', ')}</span>`
    : `<span class="pill ok">✓ All ${applied.length} applied requirements met</span>`;
  $('status').innerHTML = `<div><div class="hint">Selected airfoil</div><div class="air">${af.name}</div></div>`
    + `<div class="ld"><span class="v">${fmt(r.LD, 1)}</span><span class="k">cruise L/D</span></div>${pill}`;
}

function renderKpis(r) {
  const items = [
    ['Wing area', fmt(r.S, 4), 'm²', ''], ['Span', fmt(r.b, 3), 'm', ''],
    ['AR · λ', `${fmt(r.AR, 2)} · ${fmt(r.lam, 2)}`, '', ''],
    ['Root / tip chord', `${(r.cr * 1e3).toFixed(0)} / ${(r.ct * 1e3).toFixed(0)}`, 'mm', ''],
    ['Cruise C<sub>L</sub>', fmt(r.CLcr, 3), '', `e = ${fmt(r.e, 3)}`],
    ['Cruise α', fmt(r.alphaCr, 2), '°', ''], ['Landing α', fmt(r.alphaLand, 2), '°', `C<sub>L</sub> ${fmt(r.CLland, 3)}`],
    ['C<sub>D</sub>', fmt(r.CD, 4), '', `${fmt(r.CD0, 4)} + ${fmt(r.CDi, 4)} induced`],
    ['Tip deflection', fmt(r.deltaPct, 2), '% b', `${fmt((r.deltaPct / 100) * r.b * 1e3, 0)} mm`],
    ['Spar', r.spar.kind === 'rect' ? `${(r.spar.w * 1e3).toFixed(0)}×${(r.spar.h * 1e3).toFixed(0)}` : `Ø${(r.spar.d * 1e3).toFixed(0)}`, 'mm', `${r.spar.kind === 'rect' ? 'rectangle' : 'round'} · σ ${fmt(r.spar.sigma / 1e6, 1)} MPa`],
  ];
  $('kpis').innerHTML = items.map(([k, v, u, s]) => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}<span class="u">${u}</span></div>${s ? `<div class="s">${s}</div>` : ''}</div>`).join('');
}

function gaugeUtil(ratio) {
  const span = 1.25, w = Math.min(ratio, span) / span * 100, limit = (1 / span) * 100;
  return `<div class="gauge"><div class="fill ${ratio > 1 ? 'bad' : ''}" style="width:${Math.max(0, w).toFixed(1)}%"></div><div class="mark" style="left:${limit}%" title="limit"></div></div>`;
}
function gaugeWindow(a, lo, hi) {
  const d0 = Math.min(lo - 2, a - 1), d1 = Math.max(hi + 2, a + 1), pos = (v) => ((v - d0) / (d1 - d0)) * 100;
  return `<div class="gauge"><div class="band" style="left:${pos(lo)}%;width:${pos(hi) - pos(lo)}%"></div><div class="mark" style="left:${pos(a)}%;background:${a < lo || a > hi ? color('bad') : color('ink')}"></div></div>`;
}

function renderReqs(r, af, p) {
  const s = r.spar, ct = r.ct;
  const fitRatio = s.kind === 'rect' ? Math.max(s.h / (af.tc * ct), s.w / (p.widthFrac * ct)) : s.d / (af.tc * ct);
  const rows = {
    alpha: [gaugeWindow(r.alphaCr, p.alphaMin, p.alphaMax), `α = ${fmt(r.alphaCr)}° · window ${p.alphaMin}° to ${p.alphaMax}° · margin ${fmt(Math.min(p.alphaMax - r.alphaCr, r.alphaCr - p.alphaMin))}°`],
    span: [gaugeUtil(r.b / p.spanMax), `b = ${fmt(r.b, 3)} m of ${fmt(p.spanMax)} m (${fmt((100 * r.b) / p.spanMax, 0)}%)`],
    land: [gaugeUtil(r.landRatio), `peak c<sub>l</sub> ${fmt(r.clPeakLand, 3)} at α = ${fmt(r.alphaLand)}° · ${fmt(r.landRatio * 100, 0)}% of c<sub>l,max</sub>`],
    fit: [gaugeUtil(fitRatio), s.kind === 'rect'
      ? `depth ${(s.h * 1e3).toFixed(0)} of ${(af.tc * ct * 1e3).toFixed(1)} mm · width ${(s.w * 1e3).toFixed(0)} of ${(p.widthFrac * ct * 1e3).toFixed(1)} mm`
      : `Ø ${(s.d * 1e3).toFixed(0)} of ${(af.tc * ct * 1e3).toFixed(1)} mm`],
    stress: [gaugeUtil(s.sigma / p.yieldStress), `σ = ${fmt(s.sigma / 1e6, 1)} of ${fmt(p.yieldStress / 1e6, 1)} MPa (${fmt((100 * s.sigma) / p.yieldStress, 0)}%)`],
  };
  $('reqs').innerHTML = CONSTRAINTS.map((k) => {
    const met = r.viol[k] <= 0, en = on[k];
    const badge = !en ? '<span class="badge off">Off</span>' : met ? '<span class="badge ok">✓ Met</span>' : '<span class="badge bad">✕ Not met</span>';
    return `<div class="req ${en ? '' : 'off'}"><div class="req-top"><input type="checkbox" id="on-${k}" ${en ? 'checked' : ''}><label for="on-${k}">${REQ_NAMES[k]}</label>${badge}</div>${rows[k][0]}<div class="detail">${rows[k][1]}</div></div>`;
  }).join('');
  CONSTRAINTS.forEach((k) => $(`on-${k}`).addEventListener('change', (e) => { on[k] = e.target.checked; scheduleRender(true); }));
}

function renderGeometry(r, af, wing, dist, loads, defl, p) {
  const cl = pfMode === 'cruise' ? dist.cl : dist.cl.map((v) => (v * r.CLland) / r.CLcr);
  drawPlanform($('planform'), { b: wing.b, cr: wing.cr, lam: ui.lam, y: dist.y, cl, clmax: af.clmax, xt: af.coords.xt, spar: r.spar });
  $('pf-colorbar').innerHTML = colorbarHtml(`c<sub>l</sub> / c<sub>l,max</sub> at ${pfMode === 'cruise' ? 'cruise' : 'landing'}`);
  drawSection($('section'), { coords: af.coords, cr: wing.cr, ct: wing.ct, tc: af.tc, spar: r.spar, fitOk: r.viol.fit <= 0, widthFrac: p.widthFrac });
  $('sec-hint').textContent = 'Constant-section spar: the tip is the tightest fit';
  wing3d.set({ b: wing.b, cr: wing.cr, lam: ui.lam, coords: af.coords, deflY: loads.y, defl, tipDefl: defl[defl.length - 1], loadFactor: p.loadFactor });
}

function renderCharts(r, af, p, wing, dist, loads, defl) {
  const q = 0.5 * CONST.rho * p.vCruise ** 2;
  const clLand = dist.cl.map((v) => (v * r.CLland) / r.CLcr);
  const yDom = [-wing.b / 2, wing.b / 2];
  const c1 = color('c1'), c2 = color('c2'), ink = color('ink');
  lineChart($('ch-cl'), $('lg-cl'), {
    xLabel: 'Spanwise position, y [m]', yLabel: 'Section lift coefficient, c_l',
    xDomain: yDom, yDomain: [0, Math.max(af.clmax * 1.12, Math.max(...clLand) * 1.1)],
    series: [{ name: `Cruise · α ${fmt(r.alphaCr)}°`, x: dist.y, y: dist.cl, color: c1, fill: true },
      { name: `Landing · α ${fmt(r.alphaLand)}°`, x: dist.y, y: clLand, color: c2 }],
    hlines: [{ y: af.clmax, label: `airfoil c_l,max ${fmt(af.clmax, 3)}`, color: ink }], digits: { x: 3, y: 3 },
  });
  const Lp = dist.ccl.map((v) => q * v);
  const ell = dist.y.map((y) => ((4 * r.W) / (Math.PI * wing.b)) * Math.sqrt(Math.max(0, 1 - ((2 * y) / wing.b) ** 2)));
  lineChart($('ch-lp'), $('lg-lp'), {
    xLabel: 'Spanwise position, y [m]', yLabel: "L'(y) [N/m]",
    xDomain: yDom, yDomain: [0, Math.max(...Lp, ...ell) * 1.12],
    series: [{ name: `Lifting line · e = ${fmt(r.e, 3)}`, x: dist.y, y: Lp, color: c1, fill: true },
      { name: 'Elliptical, same lift', x: dist.y, y: ell, color: color('muted'), dash: '6 5', width: 1.6 }],
    digits: { x: 3, y: 2 },
  });
  const dmm = defl.map((v) => v * 1e3), limit = p.deflFrac * wing.b * 1e3;
  lineChart($('ch-df'), $('lg-df'), {
    xLabel: 'Distance from root, y [m]', yLabel: 'Deflection, δ [mm]',
    xDomain: [0, wing.b / 2], yDomain: [0, Math.max(limit, dmm[dmm.length - 1]) * 1.18],
    series: [{ name: describeSpar(r.spar), x: loads.y, y: dmm, color: c1, fill: true }],
    hlines: [{ y: limit, label: `limit ${fmt(p.deflFrac * 100, 1)}% b = ${fmt(limit, 0)} mm`, color: ink }], digits: { x: 3, y: 1 },
  });
  lineChart($('ch-bm'), $('lg-bm'), {
    xLabel: 'Distance from root, y [m]', yLabel: `M at ${fmt(p.loadFactor, 1)} g [N·m]`,
    xDomain: [0, wing.b / 2], yDomain: [0, loads.moment[0] * 1.12],
    series: [{ name: `Root moment ${fmt(loads.moment[0], 1)} N·m`, x: loads.y, y: loads.moment, color: c2, fill: true }],
    digits: { x: 3, y: 2 },
  });
}

// ---------------------------------------------------------------- heavy work (worker)
let worker = null;
try { worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }); } catch (e) { worker = null; }
let jobId = 0, inFlight = false, pendingJob = null, lastKey = '', mapMsg = null;

function requestHeavy(force) {
  const p = params();
  const key = JSON.stringify([airfoilName, p, on]);
  if (!force && key === lastKey) return;
  if (key === lastKey && mapMsg) return;
  lastKey = key;
  const job = { id: ++jobId, airfoil: airfoilName, p, on: { ...on }, table: true };
  if (inFlight) { pendingJob = job; return; }
  send(job);
}
function send(job) {
  inFlight = true;
  if (worker) worker.postMessage(job);
  else setTimeout(() => runJob(job, (msg) => handle(msg)), 0);
}
function handle(msg) {
  if (msg.type === 'map') {
    if (msg.id === jobId || !mapMsg) { mapMsg = msg; drawMap(); renderBestNote(msg.best); renderMapLegend(msg.on); }
  } else if (msg.type === 'table') {
    if (msg.id === jobId) renderTable(msg.rows);
    inFlight = false;
    if (pendingJob) { const j = pendingJob; pendingJob = null; send(j); }
  }
}
if (worker) {
  worker.onmessage = (e) => handle(e.data);
  worker.onerror = () => { worker = null; inFlight = false; lastKey = ''; requestHeavy(true); };
}

function drawMap() {
  if (!mapMsg) return;
  mapView.draw({ ...mapMsg, current: { AR: ui.AR, lam: ui.lam } });
}
function renderBestNote(b) {
  const bad = CONSTRAINTS.filter((k) => on[k] && b.viol[k] > 0).map((k) => REQ_NAMES[k].toLowerCase());
  $('best-note').innerHTML = b.ok
    ? `Best: AR ${fmt(b.AR)}, λ ${fmt(b.lam)} → L/D ${fmt(b.LD, 1)}`
    : `No design meets every applied requirement. Least-violating: AR ${fmt(b.AR)}, λ ${fmt(b.lam)} (misses ${bad.join(', ')})`;
}
function renderMapLegend(onMap) {
  const items = CONSTRAINTS.filter((k) => onMap[k]).map((k) => {
    const c = color(REQ_STYLE[k].css);
    const ang = REQ_STYLE[k].pattern === 'diag2' ? '135deg' : '45deg';
    return `<span><span class="swatch" style="border-color:${c};background:repeating-linear-gradient(${ang},${c} 0 1.5px,transparent 1.5px 6px)"></span>${REQ_STYLE[k].label}</span>`;
  });
  items.push('<span><span class="swatch" style="border-color:#cfb991;background:rgba(207,185,145,.25)"></span>all applied requirements met</span>');
  items.push(`<span><svg width="16" height="16" viewBox="0 0 20 20"><path d="M10 1l2.6 6.2 6.4.4-5 4.2 1.6 6.5L10 14.8 4.4 18.3 6 11.8 1 7.6l6.4-.4z" fill="#cfb991" stroke="#000"/></svg>best design</span>`);
  items.push(`<span><svg width="16" height="16" viewBox="0 0 20 20"><circle cx="10" cy="10" r="6.5" fill="none" stroke="${color('ink')}" stroke-width="2"/><circle cx="10" cy="10" r="2" fill="${color('ink')}"/></svg>current design</span>`);
  items.push('<span>thin lines: cruise L/D</span>');
  $('map-legend').innerHTML = items.join('');
}
function renderTable(rows) {
  const head = '<tr><th>Airfoil</th><th>S [m²]</th><th>AR</th><th>λ</th><th>b [m]</th><th>Cruise α</th><th>C<sub>D</sub></th><th>L/D</th><th>Spar</th><th>Status</th></tr>';
  $('tbl').innerHTML = head + rows.map((r) => {
    const bad = CONSTRAINTS.filter((k) => on[k] && r.viol[k] > 0).map((k) => REQ_NAMES[k].toLowerCase());
    return `<tr class="row ${r.name === airfoilName ? 'sel' : ''}" data-name="${r.name}" tabindex="0"><td>${r.name}</td><td>${fmt(r.S, 4)}</td><td>${fmt(r.AR)}</td><td>${fmt(r.lam)}</td><td>${fmt(r.b, 3)}</td>`
      + `<td>${fmt(r.alphaCr)}°</td><td>${fmt(r.CD, 4)}</td><td><b>${fmt(r.LD, 1)}</b></td><td>${describeSpar(r.spar)}</td>`
      + `<td>${r.ok ? '<span class="badge ok">✓ All met</span>' : `<span class="badge bad">✕ ${bad.join(', ')}</span>`}</td></tr>`;
  }).join('');
  $('tbl').querySelectorAll('tr.row').forEach((tr) => {
    const go = () => { airfoilName = tr.dataset.name; applyBest(); };
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  });
}
function mapTip(AR, lam) {
  const r = evaluate(airfoil(), AR, lam, params());
  const bad = violated(r, on).map((k) => REQ_NAMES[k].toLowerCase());
  return `<b>AR ${fmt(AR)} · λ ${fmt(lam)}</b><br>L/D ${fmt(r.LD, 1)} · α ${fmt(r.alphaCr)}° · b ${fmt(r.b, 2)} m<br>${describeSpar(r.spar)}<br>`
    + (bad.length ? `<span style="color:${color('bad')}">✕ ${bad.join(', ')}</span>` : `<span style="color:${color('ok')}">✓ all applied requirements met</span>`);
}

// ---------------------------------------------------------------- start
buildControls();
$('airfoil').innerHTML = Object.keys(AIRFOILS).map((n) => `<option>${n}</option>`).join('');
$('airfoil').addEventListener('change', (e) => { airfoilName = e.target.value; applyBest(); });
$('btn-best').addEventListener('click', applyBest);
$('btn-hw6').addEventListener('click', () => {
  ui = { ...ui, ...HW6 };
  on = Object.fromEntries(CONSTRAINTS.map((k) => [k, true]));
  applyBest();
});
$('btn-copy').addEventListener('click', async () => {
  writeHash(true);
  try { await navigator.clipboard.writeText(location.href); $('copy-lbl').textContent = 'Copied!'; } catch { $('copy-lbl').textContent = 'Copy from address bar'; }
  setTimeout(() => { $('copy-lbl').textContent = 'Copy link'; }, 1800);
});
$('btn-theme').addEventListener('click', () => {
  const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('pactm-theme', t); } catch (e) { /* storage unavailable */ }
  renderFast(); drawMap(); if (mapMsg) renderMapLegend(mapMsg.on); renderAirfoilCard.last = '';
  renderAirfoilCard(airfoil(), params());
});
document.querySelectorAll('[data-pf]').forEach((b) => b.addEventListener('click', () => {
  pfMode = b.dataset.pf;
  document.querySelectorAll('[data-pf]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  scheduleRender(false);
}));
const mapView = new FeasibleMap($('map'), $('map-tip'), (AR, lam) => {
  ui.AR = Math.max(CTL.AR.hmin, Math.min(CTL.AR.hmax, +AR.toFixed(3)));
  ui.lam = Math.max(CTL.lam.hmin, Math.min(CTL.lam.hmax, +lam.toFixed(3)));
  syncInputs(); scheduleRender(false);
}, mapTip);
const wing3d = new Wing3D($('wing3d'), $('w3d-note'));
document.querySelectorAll('[data-ex]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('[data-ex]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  wing3d.setExag(+b.dataset.ex);
}));
let resizeTimer = null;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { renderFast(); drawMap(); wing3d.request(); }, 150); });

const hadDesign = readHash();
syncInputs();
if (hadDesign) scheduleRender(true); else applyBest();
