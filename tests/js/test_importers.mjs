// Check the browser-side importers against the Python results: polar parsing (c_l,max, alpha_L0 and
// the method chosen) for all six study polars, and the inviscid panel-method alpha_L0 from coordinates.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseDat, parsePolar, panelAlphaL0 } from '../../docs/js/importers.js';
import { AIRFOILS } from '../../docs/js/airfoilData.js';

const here = dirname(fileURLToPath(import.meta.url));
const data = (f) => readFileSync(join(here, '..', '..', 'data', 'airfoils', f), 'utf8');
let fails = 0;
const check = (label, ok, extra = '') => { if (!ok) fails++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label} ${extra}`); };

console.log('polar files');
const POLARS = {
  'NACA 2415': 'NACA_2415_Analysis.txt', 'NACA 23015': 'NACA_23015_Analysis.txt', 'NACA 64-212': 'NACA_64212_Analysis.txt',
  S1223: 'S1223_Analysis.txt', S7062: 'S7062_Analysis.txt', 'HW4 (PACTM iter3)': 'PACTM_design_iter3.txt',
};
for (const [name, f] of Object.entries(POLARS)) {
  const p = parsePolar(data(f)), ref = AIRFOILS[name];
  check(`${name} c_l,max`, Math.abs(p.clmax - ref.clmax) < 1e-4, `${p.clmax} vs ${ref.clmax}`);
  check(`${name} alpha at c_l,max`, Math.abs(p.aStall - ref.aStall) < 1e-9);
  check(`${name} alpha_L0 (${p.aL0Method})`, Math.abs(p.aL0 - ref.aL0) < 2e-3 && p.aL0Method === ref.aL0Method, `${p.aL0.toFixed(4)} vs ${ref.aL0}`);
}

console.log('coordinate files and panel method (Python: S7062 -4.408, S1223 -12.956, NACA 64-212 -1.671, HW4 -1.902)');
const PANEL = { 'sd7062.dat': [-4.408, 0.1401], 's1223.dat': [-12.956, 0.1215], 'n64212.dat': [-1.671, 0.1198], 'PACTM_design_iter3.dat': [-1.902, 0.0900] };
for (const [f, [aRef, tcRef]] of Object.entries(PANEL)) {
  const d = parseDat(data(f), f);
  const { aL0 } = panelAlphaL0(d.xy);
  check(`${f} panel alpha_L0`, Math.abs(aL0 - aRef) < 5e-3, `${aL0.toFixed(3)}`);
  check(`${f} t/c`, Math.abs(d.coords.tcGeom - tcRef) < 6e-4, `${d.coords.tcGeom.toFixed(4)}`);
}

console.log('Lednicer format');
const sel = parseDat(data('sd7062.dat'));
let le = 0; sel.xy.forEach((p, i) => { if (p[0] < sel.xy[le][0]) le = i; });
const up = sel.xy.slice(0, le + 1).reverse(), lo = sel.xy.slice(le);
const led = `SD7062 LEDNICER\n${up.length}. ${lo.length}.\n\n${up.map((p) => p.join(' ')).join('\n')}\n\n${lo.map((p) => p.join(' ')).join('\n')}\n`;
const dl = parseDat(led);
check('Lednicer t/c matches Selig', Math.abs(dl.coords.tcGeom - sel.coords.tcGeom) < 1e-6);
check('Lednicer panel alpha_L0 matches Selig', Math.abs(panelAlphaL0(dl.xy).aL0 - panelAlphaL0(sel.xy).aL0) < 1e-6);

console.log(fails ? `\n${fails} check(s) FAILED` : '\nall importer checks pass');
process.exit(fails ? 1 : 0);
