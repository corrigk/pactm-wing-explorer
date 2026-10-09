# PACTM Wing Explorer

An interactive conceptual-design tool for the wing and main spar of a small RC airplane (the "PACTM"). Pick an airfoil, change the aspect ratio, taper, stall speed, mass and structural limits, and watch the lift distributions, spar deflection, requirement checks and feasible region update live.

**Live site:** https://corrigk.github.io/pactm-wing-explorer/ (served from the `docs/` folder by GitHub Pages).

## What it models

- Untwisted wing with one airfoil and a single linear taper; Prandtl lifting line (40 stations, section lift slope 2π).
- Wing area set by the stall speed: S = 2W / (ρ V_stall² · 0.9 c_l,max), airfoil data at Re = 300,000 (XFLR5 polars).
- Cruise, landing (1.2 V_stall on a 3° path, L = W cos γ) and a 3 g structural load case.
- Parasite drag from a component build-up (wing, tail, fuselage) plus lifting-line induced drag.
- Solid-wood cantilever spar sized to a tip-deflection limit, rounded up to whole mm, with depth/width/diameter fit limits at the tip and a bending-stress check.
- A feasible-region map over aspect ratio and taper ratio, with each requirement switchable on or off.

It is a conceptual-design aid with simple models (no stall-onset modelling, wing weight ignored), not a certified analysis.

## Repository layout

```
docs/            the website (static HTML, CSS and JavaScript; no build step)
src/             Python reference implementation (lifting line, drag, spar, panel method, design search)
scripts/         scripts that print tables / make figures, and export_web_data.py
tests/           Python and JavaScript checks (the JavaScript is verified against the Python)
data/airfoils/   Re = 300,000 polar exports and airfoil coordinates
config.py        parameters for the Python code
```

The Python code is the reference. The website is a JavaScript port of the same equations, and `tests/js/test_js_matches_python.mjs` checks that both produce the same designs and numbers.

## Run locally

```bash
python -m http.server 8000 --directory docs
```

then open http://localhost:8000. (Opening `index.html` directly from disk does not work because browsers block ES modules on `file://`.)

## Tests

```bash
python tests/test_reproduce.py       # Python checks (needs numpy)
node tests/js/test_js_matches_python.mjs   # JavaScript vs Python (needs Node 18+)
```

If you change the Python model or the airfoil data, regenerate the web data and the reference values first:

```bash
python scripts/export_web_data.py
```

## Publishing on GitHub Pages

1. Push this repository to GitHub (it is a public repository).
2. In the repository: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, choose branch `main` and folder `/docs`, then Save.
3. After a minute the site is live at https://corrigk.github.io/pactm-wing-explorer/.

## Sources and notes

- Lifting-line and thin-airfoil theory: standard textbook treatments (Anderson, *Fundamentals of Aerodynamics*).
- Panel method: linear-vorticity formulation after Katz and Plotkin, *Low-Speed Aerodynamics*.
- Airfoil polars: XFLR5 v6.62 exports at Re = 300,000, N_crit = 9. Airfoil coordinates for S1223, S7062 and NACA 64-212 are from the UIUC Airfoil Coordinates Database.
- The S1223 zero-lift angle is uncertain (about −8.8° to −13° depending on the method); the website has an α_L0 adjustment slider for exactly this reason.
