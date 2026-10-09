// Dependency-free SVG line charts with a hover crosshair and tooltip.

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export const color = (name) => cssVar(`--${name}`);

function niceStep(range, target) {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
}

export function niceTicks(lo, hi, target = 6) {
  const step = niceStep(hi - lo, target);
  const t = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) t.push(Math.abs(v) < 1e-12 ? 0 : v);
  return { ticks: t, step };
}

const fmtTick = (v, step) => {
  const d = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)));
  return v.toFixed(d);
};

/**
 * spec: { xLabel, yLabel, xDomain, yDomain, series: [{name, x, y, color, dash, width}],
 *         hlines: [{y, label, color, dash}], units: {x, y}, digits: {x, y} }
 */
export function lineChart(el, legendEl, spec) {
  const W = Math.max(300, Math.round(el.clientWidth || 600)), H = Math.round(Math.min(330, Math.max(230, W * 0.56))), m = { l: 54, r: 14, t: 14, b: 42 };
  const [x0, x1] = spec.xDomain, [y0, y1] = spec.yDomain;
  const sx = (v) => m.l + ((v - x0) / (x1 - x0)) * (W - m.l - m.r);
  const sy = (v) => H - m.b - ((v - y0) / (y1 - y0)) * (H - m.t - m.b);
  const xt = niceTicks(x0, x1, Math.max(4, Math.min(8, Math.round(W / 85)))), yt = niceTicks(y0, y1, 5);
  const ink = color('ink'), axis = color('axis');
  let g = `<g class="grid">`;
  yt.ticks.forEach((v) => { g += `<line x1="${m.l}" x2="${W - m.r}" y1="${sy(v)}" y2="${sy(v)}"/>`; });
  xt.ticks.forEach((v) => { g += `<line y1="${m.t}" y2="${H - m.b}" x1="${sx(v)}" x2="${sx(v)}"/>`; });
  g += `</g>`;
  let ax = `<line class="axisline" x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/>`
    + `<line class="axisline" x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${H - m.b}"/>`;
  yt.ticks.forEach((v) => { ax += `<text x="${m.l - 7}" y="${sy(v) + 4}" text-anchor="end">${fmtTick(v, yt.step)}</text>`; });
  xt.ticks.forEach((v) => { ax += `<text x="${sx(v)}" y="${H - m.b + 16}" text-anchor="middle">${fmtTick(v, xt.step)}</text>`; });
  ax += `<text class="axis-label" x="${(m.l + W - m.r) / 2}" y="${H - 6}" text-anchor="middle">${spec.xLabel}</text>`;
  ax += `<text class="axis-label" transform="translate(14 ${(m.t + H - m.b) / 2}) rotate(-90)" text-anchor="middle">${spec.yLabel}</text>`;

  let lines = '';
  (spec.hlines || []).forEach((h) => {
    if (h.y < y0 || h.y > y1) return;
    lines += `<line x1="${m.l}" x2="${W - m.r}" y1="${sy(h.y)}" y2="${sy(h.y)}" stroke="${h.color || ink}" stroke-width="1.4" stroke-dasharray="${h.dash || '2 4'}"/>`;
    lines += `<text x="${W - m.r - 4}" y="${sy(h.y) - 6}" text-anchor="end" style="fill:${h.color || ink};font-weight:600">${h.label}</text>`;
  });
  let defs = '';
  spec.series.forEach((s, si) => {
    const pts = s.x.map((xv, i) => `${sx(xv).toFixed(1)},${sy(s.y[i]).toFixed(1)}`).join(' ');
    if (s.fill) {
      const gid = `g${el.id}${si}`;
      defs += `<linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity="0.28"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient>`;
      const base = sy(Math.max(y0, 0)).toFixed(1);
      lines += `<polygon fill="url(#${gid})" stroke="none" points="${sx(s.x[0]).toFixed(1)},${base} ${pts} ${sx(s.x[s.x.length - 1]).toFixed(1)},${base}"/>`;
    }
    lines += `<polyline fill="none" stroke="${s.color}" stroke-width="${s.width || 2.2}" stroke-linejoin="round" stroke-linecap="round" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''} points="${pts}"/>`;
  });

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${spec.aria || spec.yLabel + ' versus ' + spec.xLabel}">`
    + `<defs>${defs}</defs>${g}${ax}${lines}<g class="hover" style="display:none"><line y1="${m.t}" y2="${H - m.b}" stroke="${axis}" stroke-width="1.2"/></g>`
    + `<rect class="hit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"/></svg><div class="tip"></div>`;
  if (legendEl) {
    legendEl.innerHTML = spec.series.map((s) => `<span><i style="border-color:${s.color};${s.dash ? 'border-top-style:dashed' : ''}"></i>${s.name}</span>`).join('');
  }

  const svg = el.querySelector('svg'), hover = el.querySelector('.hover'), tip = el.querySelector('.tip'), hit = el.querySelector('.hit');
  const xs = spec.series[0].x;
  const dx = spec.digits?.x ?? 2, dy = spec.digits?.y ?? 2;
  function move(ev) {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const xv = x0 + ((px - m.l) / (W - m.l - m.r)) * (x1 - x0);
    let lo = 0, hi = xs.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; (xs[mid] > xv ? (hi = mid) : (lo = mid)); }
    const i = Math.abs(xs[lo] - xv) < Math.abs(xs[hi] - xv) ? lo : hi;
    const X = sx(xs[i]);
    hover.style.display = '';
    hover.querySelector('line').setAttribute('x1', X); hover.querySelector('line').setAttribute('x2', X);
    hover.querySelectorAll('circle').forEach((c) => c.remove());
    let html = `<b>${spec.xLabel.split(' [')[0]} = ${xs[i].toFixed(dx)}</b>`;
    spec.series.forEach((s) => {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', X); c.setAttribute('cy', sy(s.y[i])); c.setAttribute('r', 4.5); c.setAttribute('fill', s.color); c.setAttribute('stroke', color('surface')); c.setAttribute('stroke-width', 2);
      hover.appendChild(c);
      html += `<br><span style="color:${s.color}">●</span> ${s.name}: ${s.y[i].toFixed(dy)}`;
    });
    tip.innerHTML = html; tip.style.display = 'block';
    const box = el.getBoundingClientRect();
    const left = (X / W) * r.width;
    tip.style.left = `${left + 12 + tip.offsetWidth > box.width ? left - tip.offsetWidth - 12 : left + 12}px`;
    tip.style.top = '8px';
  }
  const leave = () => { hover.style.display = 'none'; tip.style.display = 'none'; };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerleave', leave);
}
