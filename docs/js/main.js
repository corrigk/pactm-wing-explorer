// UI: inputs -> state -> evaluation -> Design tab, Compare tab, airfoil upload; heavy grids in a worker.
import { DEFAULTS, CONST, CONSTRAINTS } from './config.js';
import { AIRFOILS } from './airfoilData.js';
import { Wing, FULL_GRID } from './liftingLine.js';
import { halfWingLoads, deflectionCurve, describeSpar } from './spar.js';
import { evaluate, sizing, violated } from './design.js';
import { lineChart, color } from './plot.js';
import { FeasibleMap, REQ_STYLE } from './map.js';
import { drawPlanform, drawSection, drawThumb, colorbarHtml, drawPlanformOverlay } from './visuals.js';
import { Wing3D } from './wing3d.js';
import { runJob, bestFor } from './jobs.js';
import { parseDat, parsePolar, panelAlphaL0 } from './importers.js';

const $ = (id) => document.getElementById(id);
const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
let tab = 'design';
let cmp = null;   // { A: {airfoil, AR, lam}, B: {...} }

const params = () => ({
  ...DEFAULTS, mass: ui.mass, vCruise: ui.vCruise, vStall: ui.vStall, landFactor: ui.landFactor, descentDeg: ui.descentDeg,
  knockdown: ui.knockdown, loadFactor: ui.loadFactor, deflFrac: ui.deflPct / 100, E: ui.Egpa * 1e9,
  yieldStress: ui.yieldMpa * 1e6, widthFrac: ui.widthPct / 100, spanMax: ui.spanMax, alphaMin: ui.alphaMin,
  alphaMax: ui.alphaMax, aL0Shift: ui.aL0Shift,
});

// ---------------------------------------------------------------- airfoil registry (built-in + yours)
const AF = { ...AIRFOILS };
const CUSTOM_KEY = 'pactm-custom-airfoils';
function loadCustom() {
  try { (JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]') || []).forEach((a) => { if (a && a.name && a.coords && a.polar) AF[a.name] = a; }); } catch (e) { /* storage unavailable */ }
}
function saveCustom() {
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(Object.entries(AF).filter(([, a]) => a.custom).map(([name, a]) => ({ ...a, name })))); } catch (e) { /* storage unavailable */ }
}
const airfoil = (name = airfoilName) => ({ name, ...AF[name] });
const workerAirfoils = () => Object.fromEntries(Object.entries(AF).map(([n, a]) => [n, { clmax: a.clmax, aL0: a.aL0, tc: a.tc }]));

function airfoilOptions(selected) {
  const builtIn = Object.keys(AF).filter((n) => !AF[n].custom), mine = Object.keys(AF).filter((n) => AF[n].custom);
  const opt = (n) => `<option value="${esc(n)}" ${n === selected ? 'selected' : ''}>${esc(n)}</option>`;
  return builtIn.map(opt).join('') + (mine.length ? `<optgroup label="Your airfoils">${mine.map(opt).join('')}</optgroup>` : '');
}
function refreshAirfoilLists() {
  $('airfoil').innerHTML = airfoilOptions(airfoilName);
  const mine = Object.keys(AF).filter((n) => AF[n].custom);
  $('custom-list').innerHTML = mine.map((n) => `<div class="custom-item"><span>★ ${esc(n)}</span><button type="button" data-rm="${esc(n)}" aria-label="Remove ${esc(n)}" title="Remove">✕</button></div>`).join('');
  $('custom-list').querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
    delete AF[b.dataset.rm];
    saveCustom();
    if (airfoilName === b.dataset.rm) airfoilName = 'S7062';
    if (cmp) ['A', 'B'].forEach((k) => { if (!AF[cmp[k].airfoil]) cmp[k].airfoil = 'S7062'; });
    refreshAirfoilLists(); if (cmp) buildSlots(); lastKey = ''; applyBest();
  }));
}

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
function onInputChanged(k) { scheduleRender(!(k === 'AR' || k === 'lam')); }

// ---------------------------------------------------------------- state <-> URL
function readHash() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (h.has('airfoil') && AF[h.get('airfoil')]) airfoilName = h.get('airfoil');
  if (h.has('widthFrac') && !h.has('widthPct')) h.set('widthPct', String(100 * +h.get('widthFrac')));
  for (const k of Object.keys(CTL)) if (h.has(k) && Number.isFinite(+h.get(k)) && !validate(k, +h.get(k))) ui[k] = +h.get(k);
  if (h.has('off')) h.get('off').split(',').forEach((k) => { if (k in on) on[k] = false; });
  const slot = (v) => { const [a, ar, l] = (v || '').split('~'); return AF[a] && +ar > 0 && +l > 0 ? { airfoil: a, AR: +ar, lam: +l } : null; };
  if (h.has('ca') && h.has('cb') && slot(h.get('ca')) && slot(h.get('cb'))) cmp = { A: slot(h.get('ca')), B: slot(h.get('cb')) };
  if (h.get('tab') === 'compare') tab = 'compare';
  return h.has('AR');
}
function hashString() {
  const h = new URLSearchParams();
  h.set('airfoil', airfoilName); h.set('AR', String(+ui.AR.toPrecision(12))); h.set('lam', String(+ui.lam.toPrecision(12)));
  for (const k of Object.keys(HW6)) if (Math.abs(ui[k] - HW6[k]) > 1e-9) h.set(k, String(+ui[k].toFixed(6)));
  const off = CONSTRAINTS.filter((k) => !on[k]);
  if (off.length) h.set('off', off.join(','));
  if (tab === 'compare' && cmp) {
    h.set('tab', 'compare');
    const s = (d) => `${d.airfoil}~${+(+d.AR).toPrecision(12)}~${+(+d.lam).toPrecision(12)}`;
    h.set('ca', s(cmp.A)); h.set('cb', s(cmp.B));
  }
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

function designData(sel, p) {
  const af = airfoil(sel.airfoil);
  const r = evaluate(af, sel.AR, sel.lam, p);
  const wing = new Wing(r.S, sel.AR, sel.lam);
  const dist = wing.distribution(r.CLcr, FULL_GRID);
  const loads = halfWingLoads(wing, r.CLcr, p);
  const defl = deflectionCurve(loads, r.spar.I, p);
  return { af, r, wing, dist, loads, defl };
}

function renderFast() {
  const p = params(), af = airfoil();
  renderAirfoilCard(af, p);
  if (tab === 'design') {
    const D = designData({ airfoil: airfoilName, AR: ui.AR, lam: ui.lam }, p);
    renderStatus(D.r, af);
    renderKpis(D.r);
    renderReqs(D.r, af, p);
    renderGeometry(D, p);
    renderPolar(D, p);
    renderCharts(D, p);
    if (mapMsg) mapView.overlay({ AR: ui.AR, lam: ui.lam }, mapMsg.best);
  } else {
    renderCompare(p);
  }
  writeHash();
}

// ---------------------------------------------------------------- design tab
function renderAirfoilCard(af, p) {
  const { Sreq } = sizing(af, p);
  const tag = af.name + document.documentElement.dataset.theme;
  if (renderAirfoilCard.last !== tag) { drawThumb($('af-thumb'), af.coords); renderAirfoilCard.last = tag; }
  const facts = [
    ['c<sub>l,max</sub>', fmt(af.clmax, 3)], ['α at c<sub>l,max</sub>', `${fmt(af.aStall, 2)}°`], ['t/c', fmt(af.tc, 3)],
    ['α<sub>L0</sub>', `${fmt(af.aL0 + ui.aL0Shift, 2)}°`], ['C<sub>L</sub><sup>max</sup> wing', fmt(ui.knockdown * af.clmax, 3)], ['S from V<sub>stall</sub>', `${fmt(Sreq, 4)} m²`],
  ];
  $('af-facts').innerHTML = facts.map(([k, v]) => `<div class="fact"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  $('af-warn').textContent = af.custom
    ? `${af.note || ''}${af.panelAL0 != null && Number.isFinite(af.panelAL0) ? ` Inviscid α_L0 from the shape: ${fmt(af.panelAL0, 2)}°.` : ''}`.trim()
    : af.aL0Method === 'fit' ? 'This α_L0 comes from a fitted attached branch and is uncertain (≈ −8.8° to −13°). Try the adjustment.' : '';
}

function renderStatus(r, af) {
  const applied = CONSTRAINTS.filter((k) => on[k]);
  const bad = violated(r, on);
  const pill = bad.length
    ? `<span class="pill bad">✕ Misses ${bad.length} of ${applied.length}: ${bad.map((k) => REQ_NAMES[k].toLowerCase()).join(', ')}</span>`
    : `<span class="pill ok">✓ All ${applied.length} applied requirements met</span>`;
  $('status').innerHTML = `<div><div class="hint">Selected airfoil</div><div class="air">${esc(af.name)}</div></div>`
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
  const span = 1.25, w = (Math.min(ratio, span) / span) * 100, limit = (1 / span) * 100;
  return `<div class="gauge"><div class="fill ${ratio > 1 ? 'bad' : ''}" style="width:${Math.max(0, w).toFixed(1)}%"></div><div class="mark" style="left:${limit}%" title="limit"></div></div>`;
}
function gaugeWindow(a, lo, hi) {
  const d0 = Math.min(lo - 2, a - 1), d1 = Math.max(hi + 2, a + 1), pos = (v) => ((v - d0) / (d1 - d0)) * 100;
  return `<div class="gauge"><div class="band" style="left:${pos(lo)}%;width:${pos(hi) - pos(lo)}%"></div><div class="mark" style="left:${pos(a)}%;background:${a < lo || a > hi ? color('bad') : color('ink')}"></div></div>`;
}
const fitRatioOf = (r, af, p) => (r.spar.kind === 'rect'
  ? Math.max(r.spar.h / (af.tc * r.ct), r.spar.w / (p.widthFrac * r.ct)) : r.spar.d / (af.tc * r.ct));

function renderReqs(r, af, p) {
  const s = r.spar, ct = r.ct;
  const rows = {
    alpha: [gaugeWindow(r.alphaCr, p.alphaMin, p.alphaMax), `α = ${fmt(r.alphaCr)}° · window ${p.alphaMin}° to ${p.alphaMax}° · margin ${fmt(Math.min(p.alphaMax - r.alphaCr, r.alphaCr - p.alphaMin))}°`],
    span: [gaugeUtil(r.b / p.spanMax), `b = ${fmt(r.b, 3)} m of ${fmt(p.spanMax)} m (${fmt((100 * r.b) / p.spanMax, 0)}%)`],
    land: [gaugeUtil(r.landRatio), `peak c<sub>l</sub> ${fmt(r.clPeakLand, 3)} at α = ${fmt(r.alphaLand)}° · ${fmt(r.landRatio * 100, 0)}% of c<sub>l,max</sub>`],
    fit: [gaugeUtil(fitRatioOf(r, af, p)), s.kind === 'rect'
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

function renderGeometry({ af, r, wing, dist, loads, defl }, p) {
  const cl = pfMode === 'cruise' ? dist.cl : dist.cl.map((v) => (v * r.CLland) / r.CLcr);
  drawPlanform($('planform'), { b: wing.b, cr: wing.cr, lam: ui.lam, y: dist.y, cl, clmax: af.clmax, xt: af.coords.xt, spar: r.spar });
  $('pf-colorbar').innerHTML = colorbarHtml(`c<sub>l</sub> / c<sub>l,max</sub> at ${pfMode === 'cruise' ? 'cruise' : 'landing'}`);
  drawSection($('section'), { coords: af.coords, cr: wing.cr, ct: wing.ct, tc: af.tc, spar: r.spar, fitOk: r.viol.fit <= 0, widthFrac: p.widthFrac });
  $('sec-hint').textContent = 'Constant-section spar: the tip is the tightest fit';
  const half = dist.y.map((y, i) => [y, dist.cl[i]]).filter(([y]) => y >= 0);
  const sigma = loads.moment.map((m) => (m * r.spar.c) / r.spar.I / p.yieldStress);
  wing3d.set({
    b: wing.b, cr: wing.cr, lam: ui.lam, coords: af.coords, deflY: loads.y, defl, tipDefl: defl[defl.length - 1], loadFactor: p.loadFactor,
    clField: { y: half.map((q) => q[0]), v: half.map((q) => q[1] / af.clmax) },
    stressField: { y: loads.y, v: sigma },
  });
}

/** Section angle on the airfoil's own polar where c_l first reaches `target` (attached branch). */
function polarAlphaFor(af, target) {
  const { alpha, cl } = af.polar;
  for (let i = 0; i < alpha.length - 1; i++) {
    if (alpha[i + 1] < af.aL0 - 1 || alpha[i] > af.aStall) continue;
    if ((cl[i] - target) * (cl[i + 1] - target) <= 0 && cl[i + 1] !== cl[i]) return alpha[i] + ((target - cl[i]) * (alpha[i + 1] - alpha[i])) / (cl[i + 1] - cl[i]);
  }
  return NaN;
}
const interpArr = (xs, ys, x) => {
  for (let i = 0; i < xs.length - 1; i++) if (x >= xs[i] && x <= xs[i + 1]) return ys[i] + ((ys[i + 1] - ys[i]) * (x - xs[i])) / (xs[i + 1] - xs[i]);
  return NaN;
};

function renderPolar({ af, r }, p) {
  const P = af.polar, c1 = color('c1'), c2 = color('c2'), ink = color('ink'), muted = color('muted');
  const aL0 = af.aL0 + p.aL0Shift;
  const xLo = Math.max(P.alpha[0], Math.min(aL0 - 3, -4)), xHi = Math.min(P.alpha[P.alpha.length - 1], af.aStall + 4);
  const inX = P.alpha.map((a, i) => i).filter((i) => P.alpha[i] >= xLo - 0.5 && P.alpha[i] <= xHi + 0.5);
  const ax = inX.map((i) => P.alpha[i]), acl = inX.map((i) => P.cl[i]);
  const lin = [xLo, xHi].map((a) => ((2 * Math.PI * Math.PI) / 180) * (a - aL0));
  const aCr = polarAlphaFor(af, r.clPeakCruise), aLd = polarAlphaFor(af, r.clPeakLand);
  lineChart($('ch-pa'), $('lg-pa'), {
    xLabel: 'Section angle of attack, α [deg]', yLabel: 'Section lift coefficient, c_l',
    xDomain: [xLo, xHi], yDomain: [Math.min(0, ...acl) - 0.1, af.clmax * 1.18],
    series: [{ name: `${af.name} polar`, x: ax, y: acl, color: c1 },
      { name: 'Lifting-line section model (2π)', x: [xLo, xHi], y: lin, color: muted, dash: '6 5', width: 1.5 }],
    hlines: [{ y: af.clmax, label: `c_l,max ${fmt(af.clmax, 3)} at ${fmt(af.aStall, 2)}°`, color: ink }],
    vlines: [{ x: aL0, label: `α_L0 ${fmt(aL0, 2)}°`, color: muted }],
    points: [{ x: aCr, y: r.clPeakCruise, color: c1, label: `cruise ${fmt(r.clPeakCruise, 2)}` },
      { x: aLd, y: r.clPeakLand, color: c2, label: `landing ${fmt(r.clPeakLand, 2)}` }],
    digits: { x: 2, y: 3 },
  });
  const att = P.alpha.map((a, i) => i).filter((i) => P.alpha[i] >= aL0 - 2 && P.alpha[i] <= af.aStall + 1);
  const dcd = att.map((i) => P.cd[i]), dcl = att.map((i) => P.cl[i]), dal = att.map((i) => P.alpha[i]);
  const cdCr = interpArr(P.alpha, P.cd, aCr), cdLd = interpArr(P.alpha, P.cd, aLd);
  lineChart($('ch-pd'), $('lg-pd'), {
    xLabel: 'Section drag coefficient, c_d', yLabel: 'c_l',
    xDomain: [0, Math.max(...dcd) * 1.12], yDomain: [Math.min(0, ...dcl) - 0.1, af.clmax * 1.18],
    series: [{ name: 'Drag polar (attached range)', x: dcd, y: dcl, color: c1, extra: (i) => `α = ${fmt(dal[i], 2)}°` }],
    points: [{ x: cdCr, y: r.clPeakCruise, color: c1, label: `cruise c_d ${fmt(cdCr, 4)}` },
      { x: cdLd, y: r.clPeakLand, color: c2, label: `landing c_d ${fmt(cdLd, 4)}`, dy: 16 }],
    hover: 'nearest', digits: { x: 4, y: 3 },
  });
  $('polar-note').innerHTML = `Peak section c<sub>l</sub>: cruise ${fmt(r.clPeakCruise, 3)} (${fmt((100 * r.clPeakCruise) / af.clmax, 0)}% of c<sub>l,max</sub>), `
    + `landing ${fmt(r.clPeakLand, 3)} (${fmt((100 * r.clPeakLand) / af.clmax, 0)}%). The lifting-line model uses a 2π slope through α<sub>L0</sub>; `
    + 'the dashed line shows how that compares with the real airfoil.';
}

function renderCharts({ af, r, wing, dist, loads, defl }, p) {
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

// ---------------------------------------------------------------- compare tab
function initCompare() {
  if (cmp) return;
  const other = airfoilName === 'S1223' ? 'S7062' : 'S1223';
  const b = bestFor(airfoil(other), params(), on);
  cmp = { A: { airfoil: airfoilName, AR: ui.AR, lam: ui.lam }, B: { airfoil: other, AR: b.AR, lam: b.lam } };
}

function buildSlots() {
  if (!cmp) return;
  $('cmp-slots').innerHTML = ['A', 'B'].map((k) => `
    <div class="slot" style="--slot:var(--c${k === 'A' ? 1 : 2})">
      <div class="slot-head"><span class="slot-name">Design ${k}</span><span class="hint" id="slot-${k}-sum"></span></div>
      <div class="slot-row">
        <label>Airfoil<select id="s-${k}-af">${airfoilOptions(cmp[k].airfoil)}</select></label>
        <label>AR<input type="number" id="s-${k}-AR" step="0.01" min="1.5" max="40"></label>
        <label>λ<input type="number" id="s-${k}-lam" step="0.01" min="0.05" max="1.5"></label>
      </div>
      <div class="slot-actions"><button type="button" data-best="${k}">Best for this airfoil</button><button type="button" data-from="${k}">Copy from Design tab</button></div>
    </div>`).join('');
  ['A', 'B'].forEach((k) => {
    $(`s-${k}-AR`).value = (+cmp[k].AR).toFixed(2); $(`s-${k}-lam`).value = (+cmp[k].lam).toFixed(2);
    $(`s-${k}-af`).addEventListener('change', (e) => {
      cmp[k].airfoil = e.target.value;
      const b = bestFor(airfoil(cmp[k].airfoil), params(), on);
      cmp[k].AR = b.AR; cmp[k].lam = b.lam; syncSlots(); scheduleRender(false);
    });
    for (const f of ['AR', 'lam']) {
      $(`s-${k}-${f}`).addEventListener('input', (e) => {
        const v = +e.target.value, ok = e.target.value !== '' && Number.isFinite(v) && v >= +e.target.min && v <= +e.target.max;
        e.target.style.borderColor = ok ? '' : color('bad');
        if (ok) { cmp[k][f] = v; scheduleRender(false); }
      });
    }
  });
  $('cmp-slots').querySelectorAll('[data-best]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.best, r = bestFor(airfoil(cmp[k].airfoil), params(), on);
    cmp[k].AR = r.AR; cmp[k].lam = r.lam; syncSlots(); scheduleRender(false);
  }));
  $('cmp-slots').querySelectorAll('[data-from]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.from; cmp[k] = { airfoil: airfoilName, AR: ui.AR, lam: ui.lam }; syncSlots(); scheduleRender(false);
  }));
}
function syncSlots() {
  ['A', 'B'].forEach((k) => {
    $(`s-${k}-af`).value = cmp[k].airfoil;
    $(`s-${k}-AR`).value = (+cmp[k].AR).toFixed(2); $(`s-${k}-lam`).value = (+cmp[k].lam).toFixed(2);
  });
}

const subs = (t) => t.replace('C_L', 'C<sub>L</sub>').replace('C_D0', 'C<sub>D0</sub>').replace('C_Di', 'C<sub>Di</sub>').replace('C_D', 'C<sub>D</sub>')
  .replace('c_l,max', 'c<sub>l,max</sub>').replace('c_l', 'c<sub>l</sub>');

function renderCompare(p) {
  initCompare();
  if (!$('s-A-af')) buildSlots();
  const A = designData(cmp.A, p), B = designData(cmp.B, p);
  const c1 = color('c1'), c2 = color('c2');
  ['A', 'B'].forEach((k) => {
    const bad = violated((k === 'A' ? A : B).r, on);
    $(`slot-${k}-sum`).innerHTML = bad.length ? `<span style="color:${color('bad')}">✕ misses ${bad.length}</span>` : `<span style="color:${color('ok')}">✓ all met</span>`;
  });
  const rows = [
    ['Planform'],
    ['Wing area S', (D) => D.r.S, 4, 'm²'], ['Span b', (D) => D.r.b, 3, 'm'], ['Aspect ratio', (D) => D.r.AR, 2, ''],
    ['Taper ratio', (D) => D.r.lam, 2, ''], ['Root chord', (D) => D.r.cr * 1e3, 0, 'mm'], ['Tip chord', (D) => D.r.ct * 1e3, 0, 'mm'],
    ['Cruise'],
    ['C_L', (D) => D.r.CLcr, 3, ''], ['Angle of attack', (D) => D.r.alphaCr, 2, '°'], ['Span efficiency e', (D) => D.r.e, 3, ''],
    ['C_D0', (D) => D.r.CD0, 4, ''], ['C_Di', (D) => D.r.CDi, 4, ''], ['C_D', (D) => D.r.CD, 4, ''], ['L/D', (D) => D.r.LD, 2, ''],
    ['Landing'],
    ['C_L', (D) => D.r.CLland, 3, ''], ['Angle of attack', (D) => D.r.alphaLand, 2, '°'], ['Peak c_l / c_l,max', (D) => D.r.landRatio, 3, ''],
    ['Structure'],
    ['Spar (solid wood)', (D) => (D.r.spar.kind === 'rect' ? `${(D.r.spar.w * 1e3).toFixed(0)} × ${(D.r.spar.h * 1e3).toFixed(0)} mm rect.` : `Ø ${(D.r.spar.d * 1e3).toFixed(0)} mm round`), null, ''],
    ['Spar cross-section', (D) => D.r.spar.area * 1e6, 0, 'mm²'], ['Spar volume, full span', (D) => D.r.spar.area * D.r.b * 1e6, 0, 'cm³'],
    ['Tip deflection', (D) => D.r.deltaPct, 2, '% b'], ['Root moment', (D) => D.r.Mroot, 1, 'N·m'], ['Max stress', (D) => D.r.spar.sigma / 1e6, 1, 'MPa'],
    ['Requirements'],
    ['Status', (D) => { const b = violated(D.r, on); return b.length ? `✕ ${b.map((k) => REQ_NAMES[k].toLowerCase()).join(', ')}` : '✓ all met'; }, null, ''],
  ];
  const head = `<tr><th></th><th class="a">A · ${esc(cmp.A.airfoil)}</th><th class="b">B · ${esc(cmp.B.airfoil)}</th><th>B − A</th></tr>`;
  const rowHtml = (row) => {
    if (row.length === 1) return `<tr class="sec"><td colspan="4">${row[0]}</td></tr>`;
    const [label, f, d, u] = row, a = f(A), b = f(B);
    if (d === null) return `<tr><td class="lbl">${label}</td><td class="a wrap">${a}</td><td class="b wrap">${b}</td><td></td></tr>`;
    const dl = b - a, pct = Math.abs(a) > 1e-12 ? (100 * dl) / Math.abs(a) : NaN;
    const unit = u ? ` <span class="u">${u}</span>` : '';
    return `<tr><td class="lbl">${subs(label)}</td><td class="a">${fmt(a, d)}${unit}</td><td class="b">${fmt(b, d)}${unit}</td>`
      + `<td class="delta">${dl >= 0 ? '+' : '−'}${fmt(Math.abs(dl), d)}${Number.isFinite(pct) ? ` <span class="pct">(${pct >= 0 ? '+' : '−'}${fmt(Math.abs(pct), 1)}%)</span>` : ''}</td></tr>`;
  };
  const split = rows.findIndex((r) => r.length === 1 && r[0] === 'Landing');
  $('cmp-table').innerHTML = head + rows.slice(0, split).map(rowHtml).join('');
  $('cmp-table2').innerHTML = head + rows.slice(split).map(rowHtml).join('');
  drawPlanformOverlay($('cmp-planform'), [
    { b: A.wing.b, cr: A.wing.cr, lam: cmp.A.lam, color: c1, label: `A · ${cmp.A.airfoil}` },
    { b: B.wing.b, cr: B.wing.cr, lam: cmp.B.lam, color: c2, label: `B · ${cmp.B.airfoil}` },
  ]);
  const bMax = Math.max(A.wing.b, B.wing.b);
  const land = (D) => D.dist.cl.map((v) => (v * D.r.CLland) / D.r.CLcr);
  lineChart($('ch-ccl'), $('lg-ccl'), {
    xLabel: 'Spanwise position, y [m]', yLabel: 'c_l', xDomain: [-bMax / 2, bMax / 2],
    yDomain: [0, Math.max(A.af.clmax, B.af.clmax) * 1.12],
    series: [{ name: 'A cruise', x: A.dist.y, y: A.dist.cl, color: c1 }, { name: 'B cruise', x: B.dist.y, y: B.dist.cl, color: c2 },
      { name: 'A landing', x: A.dist.y, y: land(A), color: c1, dash: '6 4', width: 1.8 }, { name: 'B landing', x: B.dist.y, y: land(B), color: c2, dash: '6 4', width: 1.8 }],
    hlines: [{ y: A.af.clmax, label: `A c_l,max ${fmt(A.af.clmax, 2)}`, color: c1 }, ...(cmp.B.airfoil !== cmp.A.airfoil ? [{ y: B.af.clmax, label: `B c_l,max ${fmt(B.af.clmax, 2)}`, color: c2 }] : [])],
    digits: { x: 3, y: 3 },
  });
  const q = 0.5 * CONST.rho * p.vCruise ** 2;
  lineChart($('ch-clp'), $('lg-clp'), {
    xLabel: 'Spanwise position, y [m]', yLabel: "L'(y) [N/m]", xDomain: [-bMax / 2, bMax / 2],
    yDomain: [0, Math.max(...A.dist.ccl, ...B.dist.ccl) * q * 1.12],
    series: [{ name: `A · e ${fmt(A.r.e, 3)}`, x: A.dist.y, y: A.dist.ccl.map((v) => q * v), color: c1, fill: true },
      { name: `B · e ${fmt(B.r.e, 3)}`, x: B.dist.y, y: B.dist.ccl.map((v) => q * v), color: c2, fill: true }],
    digits: { x: 3, y: 2 },
  });
  const lim = (D) => p.deflFrac * D.wing.b * 1e3;
  lineChart($('ch-cdf'), $('lg-cdf'), {
    xLabel: 'Distance from root, y [m]', yLabel: 'δ [mm]', xDomain: [0, bMax / 2],
    yDomain: [0, Math.max(lim(A), lim(B), A.defl[A.defl.length - 1] * 1e3, B.defl[B.defl.length - 1] * 1e3) * 1.18],
    series: [{ name: `A · ${describeSpar(A.r.spar)}`, x: A.loads.y, y: A.defl.map((v) => v * 1e3), color: c1 },
      { name: `B · ${describeSpar(B.r.spar)}`, x: B.loads.y, y: B.defl.map((v) => v * 1e3), color: c2 }],
    hlines: [{ y: lim(A), label: `A limit ${fmt(lim(A), 0)} mm`, color: c1 }, ...(Math.abs(lim(A) - lim(B)) > 0.5 ? [{ y: lim(B), label: `B limit ${fmt(lim(B), 0)} mm`, color: c2 }] : [])],
    digits: { x: 3, y: 1 },
  });
  const pol = (D) => {
    const idx = D.af.polar.alpha.map((a, j) => j).filter((j) => D.af.polar.alpha[j] >= -8 && D.af.polar.alpha[j] <= D.af.aStall + 3);
    return { x: idx.map((j) => D.af.polar.alpha[j]), y: idx.map((j) => D.af.polar.cl[j]) };
  };
  const pa = pol(A), pb = pol(B);
  lineChart($('ch-cpa'), $('lg-cpa'), {
    xLabel: 'Section angle of attack, α [deg]', yLabel: 'c_l', xDomain: [-8, Math.max(A.af.aStall, B.af.aStall) + 3],
    yDomain: [Math.min(0, ...pa.y, ...pb.y) - 0.1, Math.max(A.af.clmax, B.af.clmax) * 1.15],
    series: [{ name: `A · ${cmp.A.airfoil}`, x: pa.x, y: pa.y, color: c1 }, { name: `B · ${cmp.B.airfoil}`, x: pb.x, y: pb.y, color: c2 }],
    points: [{ x: polarAlphaFor(A.af, A.r.clPeakCruise), y: A.r.clPeakCruise, color: c1, label: 'A cruise' },
      { x: polarAlphaFor(B.af, B.r.clPeakCruise), y: B.r.clPeakCruise, color: c2, label: 'B cruise', dy: 16 }],
    digits: { x: 2, y: 3 },
  });
}

function setTab(t) {
  tab = t;
  $('tab-btn-design').setAttribute('aria-selected', String(t === 'design'));
  $('tab-btn-compare').setAttribute('aria-selected', String(t === 'compare'));
  $('tab-design').hidden = t !== 'design';
  $('tab-compare').hidden = t !== 'compare';
  if (t === 'compare') { initCompare(); buildSlots(); }
  renderFast();
  if (t === 'design') { drawMap(); wing3d.request(); }
}

// ---------------------------------------------------------------- heavy work (worker)
let worker = null;
const VERSION = new URL(import.meta.url).search;   // '?v=N' from index.html, passed on to the worker
try { worker = new Worker(new URL(`./worker.js${VERSION}`, import.meta.url), { type: 'module' }); } catch (e) { worker = null; }
let jobId = 0, inFlight = false, pendingJob = null, lastKey = '', mapMsg = null;

function requestHeavy(force) {
  const p = params();
  const key = JSON.stringify([airfoilName, p, on, Object.keys(AF)]);
  if (key === lastKey && (mapMsg || !force)) return;
  lastKey = key;
  const job = { id: ++jobId, airfoil: airfoilName, p, on: { ...on }, table: true, airfoils: workerAirfoils() };
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
  if (!mapMsg || tab !== 'design') return;
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
  items.push('<span><span class="swatch" style="border-color:#cfb991;background:rgba(207,185,145,.3)"></span>all applied requirements met</span>');
  items.push('<span><svg width="16" height="16" viewBox="0 0 20 20"><path d="M10 1l2.6 6.2 6.4.4-5 4.2 1.6 6.5L10 14.8 4.4 18.3 6 11.8 1 7.6l6.4-.4z" fill="#cfb991" stroke="#000"/></svg>best design</span>');
  items.push(`<span><svg width="16" height="16" viewBox="0 0 20 20"><circle cx="10" cy="10" r="6.5" fill="none" stroke="${color('ink')}" stroke-width="2"/><circle cx="10" cy="10" r="2" fill="${color('ink')}"/></svg>current design</span>`);
  items.push('<span>thin lines: cruise L/D</span>');
  $('map-legend').innerHTML = items.join('');
}
function renderTable(rows) {
  const head = '<tr><th>Airfoil</th><th>S [m²]</th><th>AR</th><th>λ</th><th>b [m]</th><th>Cruise α</th><th>C<sub>D</sub></th><th>L/D</th><th>Spar</th><th>Status</th></tr>';
  $('tbl').innerHTML = head + rows.map((r) => {
    const bad = CONSTRAINTS.filter((k) => on[k] && r.viol[k] > 0).map((k) => REQ_NAMES[k].toLowerCase());
    return `<tr class="row ${r.name === airfoilName ? 'sel' : ''}" data-name="${esc(r.name)}" tabindex="0"><td>${AF[r.name]?.custom ? '★ ' : ''}${esc(r.name)}</td><td>${fmt(r.S, 4)}</td><td>${fmt(r.AR)}</td><td>${fmt(r.lam)}</td><td>${fmt(r.b, 3)}</td>`
      + `<td>${fmt(r.alphaCr)}°</td><td>${fmt(r.CD, 4)}</td><td><b>${fmt(r.LD, 1)}</b></td><td>${describeSpar(r.spar)}</td>`
      + `<td>${r.ok ? '<span class="badge ok">✓ All met</span>' : `<span class="badge bad">✕ ${bad.join(', ')}</span>`}</td></tr>`;
  }).join('');
  $('tbl').querySelectorAll('tr.row').forEach((tr) => {
    const go = () => { if (!AF[tr.dataset.name]) return; airfoilName = tr.dataset.name; applyBest(); };
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

// ---------------------------------------------------------------- add-your-own airfoil
const addState = { dat: null, pol: null, panel: null };
function resetAdd() {
  addState.dat = addState.pol = addState.panel = null;
  ['dat', 'pol'].forEach((k) => { $(`drop-${k}`).className = 'drop'; $(`file-${k}`).value = ''; });
  $('dat-status').textContent = 'Drop or choose a .dat file'; $('pol-status').textContent = 'Drop or choose a polar .txt';
  $('add-preview').hidden = true; $('add-err').textContent = ''; $('add-ok').disabled = true;
}
async function readAddFile(kind, file) {
  const drop = $(`drop-${kind}`), st = $(`${kind}-status`);
  try {
    if (file.size > 2e6) throw new Error('File is larger than 2 MB.');
    const text = await file.text();
    if (kind === 'dat') {
      addState.dat = parseDat(text, file.name.replace(/\.[^.]+$/, ''));
      addState.panel = null;
      st.textContent = `${file.name} · ${addState.dat.xy.length} points · t/c ${fmt(addState.dat.coords.tcGeom, 4)}`;
    } else {
      addState.pol = parsePolar(text);
      st.textContent = `${file.name} · ${addState.pol.nRows} rows · c_l,max ${fmt(addState.pol.clmax, 3)}`;
    }
    drop.className = 'drop done';
    $('add-err').textContent = '';
  } catch (e) {
    addState[kind] = null; drop.className = 'drop err'; st.textContent = file.name;
    $('add-err').textContent = e.message;
  }
  updateAddPreview();
}
function uniqueName(n) {
  const base = (n || '').trim() || 'My airfoil';
  let name = base, k = 2;
  while (AF[name]) name = `${base} (${k++})`;
  return name;
}
function updateAddPreview() {
  const { dat, pol } = addState;
  $('add-preview').hidden = !(dat || pol);
  if (dat) drawThumb($('add-thumb'), dat.coords);
  if (dat && !$('add-name').dataset.touched) $('add-name').value = uniqueName(dat.name);
  if (dat) $('add-tc').value = dat.coords.tcGeom.toFixed(4);
  if (pol) { $('add-clmax').value = pol.clmax.toFixed(4); $('add-astall').value = pol.aStall.toFixed(2); $('add-al0').value = pol.aL0.toFixed(3); }
  const notes = [];
  if (pol) notes.push(`α<sub>L0</sub> from the polar by ${pol.aL0Method === 'cross' ? 'the c<sub>l</sub> = 0 crossing' : 'a linear fit of 0°–4°'}.${pol.note ? ' ' + esc(pol.note) : ''}`);
  if (dat && !addState.panel) {
    notes.push('Computing the inviscid α<sub>L0</sub> from the coordinates…');
    setTimeout(() => {
      if (!addState.dat || addState.panel) return;
      try { addState.panel = panelAlphaL0(addState.dat.xy); } catch (e) { addState.panel = { aL0: NaN }; }
      updateAddPreview();
    }, 30);
  } else if (dat && addState.panel) {
    notes.push(`Inviscid (panel-method) α<sub>L0</sub> from the shape: ${fmt(addState.panel.aL0, 2)}°. Viscous values are usually a little less negative; a big gap means the polar or the shape needs a second look.`);
  }
  $('add-notes').innerHTML = notes.join('<br>');
  $('add-ok').disabled = !(dat && pol);
}
function commitAdd() {
  const { dat, pol } = addState;
  const name = uniqueName($('add-name').value || dat.name);
  const num = (id) => +$(id).value;
  const clmax = num('add-clmax'), aStall = num('add-astall'), aL0 = num('add-al0'), tc = num('add-tc');
  if (!(clmax > 0.2 && clmax < 4)) { $('add-err').textContent = 'c_l,max should be between 0.2 and 4.'; return false; }
  if (!(tc > 0.02 && tc < 0.4)) { $('add-err').textContent = 't/c should be between 0.02 and 0.4.'; return false; }
  if (!(aL0 > -20 && aL0 < 10)) { $('add-err').textContent = 'α_L0 should be between −20° and 10°.'; return false; }
  AF[name] = {
    custom: true, clmax, aStall, aL0, tc, aL0Method: pol.aL0Method, note: pol.note || '',
    panelAL0: addState.panel ? addState.panel.aL0 : null,
    coords: dat.coords, polar: { alpha: pol.alpha, cl: pol.cl, cd: pol.cd, cm: pol.cm },
  };
  saveCustom();
  airfoilName = name;
  refreshAirfoilLists(); if (cmp) buildSlots();
  applyBest();
  return true;
}
function initAddDialog() {
  const dlg = $('dlg-add');
  $('btn-add').addEventListener('click', () => { resetAdd(); $('add-name').dataset.touched = ''; $('add-name').value = ''; dlg.showModal(); });
  $('add-name').addEventListener('input', () => { $('add-name').dataset.touched = '1'; });
  for (const kind of ['dat', 'pol']) {
    $(`file-${kind}`).addEventListener('change', (e) => { if (e.target.files[0]) readAddFile(kind, e.target.files[0]); });
    const drop = $(`drop-${kind}`);
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) readAddFile(kind, e.dataTransfer.files[0]); });
  }
  $('add-ok').addEventListener('click', (e) => { e.preventDefault(); if (commitAdd()) dlg.close(); });
}

// ---------------------------------------------------------------- start
loadCustom();
buildControls();
refreshAirfoilLists();
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
  renderFast(); drawMap(); if (mapMsg) renderMapLegend(mapMsg.on);
});
$('tab-btn-design').addEventListener('click', () => setTab('design'));
$('tab-btn-compare').addEventListener('click', () => setTab('compare'));
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
document.querySelectorAll('[data-col]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('[data-col]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  wing3d.setMode(b.dataset.col);
}));
initAddDialog();
let resizeTimer = null;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { renderFast(); drawMap(); wing3d.request(); }, 150); });

const hadDesign = readHash();
syncInputs();
if (tab === 'compare') setTab('compare');
if (hadDesign) scheduleRender(true); else applyBest();
