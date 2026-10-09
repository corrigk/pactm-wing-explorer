"""Intermediate numbers for one table row (default S7062). Usage: python hw6_p3_worked_row.py [airfoil]"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for p in (ROOT, ROOT / "src"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

import numpy as np  # noqa: E402

import config as cfg  # noqa: E402
import airfoil_data  # noqa: E402
import design_space as ds  # noqa: E402
import spar  # noqa: E402


def main(name):
    af = airfoil_data.summarize()[name]
    ARs, lams = ds.grids(af)
    best, ok = ds.pick_best(ds.scan(af, ARs, lams))
    r, sec = best, best["spar"]
    q = 0.5 * cfg.RHO * cfg.V_CRUISE**2
    lines = [
        ("airfoil", name, ""),
        ("W", cfg.W, "N"), ("c_l,max", af["clmax"], ""), ("alpha_L0", af["aL0"], "deg"), ("t/c", af["tc"], ""),
        ("C_L^max (0.9 c_l,max)", af["CLmax"], ""), ("S_req", af["S_req"], "m^2"),
        ("AR", r["AR"], ""), ("taper lambda", r["lam"], ""), ("b", r["b"], "m"),
        ("c_root", r["c_r"], "m"), ("c_tip", r["c_t"], "m"),
        ("a_w (lifting line)", r["a_w"], "1/deg"), ("e", r["e"], ""),
        ("C_L,cruise", r["CL_cruise"], ""), ("alpha_cruise", r["alpha_cruise"], "deg"),
        ("C_D0 (HW1 build-up)", r["CD0"], ""), ("C_Di", r["CDi"], ""), ("C_D", r["CD"], ""),
        ("(L/D)_cruise", r["LD"], ""),
        ("V_land", cfg.LAND_FACTOR * cfg.V_STALL, "m/s"), ("C_L,land", r["CL_land"], ""),
        ("alpha_land", r["alpha_land"], "deg"), ("peak c_l / c_l,max at landing", r["land_ratio"], ""),
        ("dynamic pressure q (cruise)", q, "Pa"), ("root bending moment M(0), 3g", r["M_root"], "N m"),
        ("I_req", r["I_req"], "m^4"), ("spar", spar.describe(sec), ""), ("I (rounded spar)", sec["I"], "m^4"),
        ("tip deflection / b", r["delta_pct"], "%"), ("sigma_max", sec["sigma"] / 1e6, "MPa"),
        ("h or d allowed (t/c) c_tip", af["tc"] * r["c_t"] * 1e3, "mm"),
        ("w allowed (0.25 c_tip)", cfg.SPAR_WIDTH_MAX_FRAC * r["c_t"] * 1e3, "mm"),
        ("all requirements met", ok, ""),
    ]
    for label, val, unit in lines:
        txt = f"{val:.5g}" if isinstance(val, (float, np.floating)) else str(val)
        print(f"{label:<34}{txt:>16} {unit}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "S7062")
