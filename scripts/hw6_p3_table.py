"""HW6 Problem 3(a): design table (one row per airfoil) and feasible-region figures."""
import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for p in (ROOT, ROOT / "src"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

import config as cfg  # noqa: E402
import airfoil_data  # noqa: E402
import design_space as ds  # noqa: E402
import spar  # noqa: E402


def main():
    cfg.OUTPUT_DIR.mkdir(exist_ok=True)
    rows = airfoil_data.summarize()
    scans, bests, table = {}, {}, []
    for name, af in rows.items():
        ARs, lams = ds.grids(af)
        res = ds.scan(af, ARs, lams)
        best, ok = ds.pick_best(res)
        scans[name], bests[name] = (ARs, lams, res), (best, ok)
        sec = best["spar"]
        table.append(dict(
            airfoil=name, CD0=best["CD0"], CLmax=af["CLmax"], S_req=af["S_req"], AR=best["AR"],
            taper=best["lam"], CD=best["CD"], LD=best["LD"], delta_pct=best["delta_pct"],
            b=best["b"], spar=spar.describe(sec), alpha_cruise=best["alpha_cruise"],
            alpha_land=best["alpha_land"], land_ratio=best["land_ratio"],
            sigma_MPa=sec["sigma"] / 1e6, feasible=ok, violated=",".join(ds.violated(best)) or "-"))

    hdr = (f"{'airfoil':<19}{'CD0':>8}{'CLmax':>7}{'S_req':>7}{'AR':>6}{'lam':>5}{'CD':>8}{'L/D':>7}"
           f"{'defl%b':>7}{'b[m]':>6}  {'spar':<20}{'a_cr':>6}{'a_land':>7}{'cl/clmax':>9}{'sig[MPa]':>9}  status")
    print(hdr)
    for t in table:
        print(f"{t['airfoil']:<19}{t['CD0']:>8.5f}{t['CLmax']:>7.3f}{t['S_req']:>7.4f}{t['AR']:>6.2f}"
              f"{t['taper']:>5.2f}{t['CD']:>8.5f}{t['LD']:>7.2f}{t['delta_pct']:>7.2f}{t['b']:>6.3f}  "
              f"{t['spar']:<20}{t['alpha_cruise']:>6.2f}{t['alpha_land']:>7.2f}{t['land_ratio']:>9.3f}"
              f"{t['sigma_MPa']:>9.2f}  {'OK' if t['feasible'] else 'violates: ' + t['violated']}")

    with open(cfg.OUTPUT_DIR / "hw6_p3_table.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(table[0]))
        w.writeheader()
        w.writerows(table)
    ds.make_figure(rows, scans, bests, cfg.OUTPUT_DIR / "hw6_p3_design_space.png")
    print(f"\nwrote {cfg.OUTPUT_DIR / 'hw6_p3_table.csv'} and hw6_p3_design_space.png")


if __name__ == "__main__":
    main()
