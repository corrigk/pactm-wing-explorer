"""Inviscid (panel-method) alpha_L0 from airfoil coordinates vs the viscous-polar values."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for p in (ROOT, ROOT / "src"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

import config as cfg  # noqa: E402
import airfoil_data  # noqa: E402
import panel  # noqa: E402

DAT = {  # polar-table name -> coordinate file in data/airfoils (None = generated NACA 2415)
    "NACA 2415": None,
    "NACA 64-212": "n64212.dat",
    "S1223": "s1223.dat",
    "S7062": "sd7062.dat",
    "HW4 (PACTM iter3)": cfg.HW4_DAT,
}


def main():
    rows = airfoil_data.summarize()
    print(f"{'airfoil':<19}{'polar aL0':>10}{'panel aL0':>10}{'diff':>7}{'panel slope/deg':>17}{'t/c dat':>9}")
    for name, f in DAT.items():
        xy = panel.naca4("2415") if f is None else panel.load_dat(airfoil_data.find_file(f))
        aL0, slope = panel.alpha_L0(xy)
        tc = airfoil_data.thickness_ratio_xy(xy)
        print(f"{name:<19}{rows[name]['aL0']:>10.3f}{aL0:>10.3f}{aL0 - rows[name]['aL0']:>7.2f}"
              f"{slope:>17.4f}{tc:>9.4f}")


if __name__ == "__main__":
    main()
