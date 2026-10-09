"""Polar parsing and per-airfoil summary (c_l,max, alpha_L0, t/c, sizing)."""
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
import config as cfg  # noqa: E402

SEARCH_DIRS = [cfg.AIRFOIL_DIR, Path(__file__).resolve().parent, ROOT]


def find_file(name):
    """Look for a data file in data/airfoils/, next to this script, then the project root."""
    for d in SEARCH_DIRS:
        if (d / name).is_file():
            return d / name
    raise FileNotFoundError(
        f"Could not find '{name}'. Put it in {cfg.AIRFOIL_DIR} "
        f"(searched: {', '.join(str(d) for d in SEARCH_DIRS)}).")


def load_polar(path):
    """alpha [deg], c_l, c_d from an XFLR5 polar export (11 header lines)."""
    a, cl, cd = np.loadtxt(path, skiprows=11, usecols=(0, 1, 2)).T
    return a, cl, cd


def zero_lift_crossing(a, cl):
    """c_l = 0 crossing closest to alpha = 0 between adjacent points <= 0.5 deg apart."""
    best = None
    for k in range(len(a) - 1):
        if cl[k] * cl[k + 1] < 0 and a[k + 1] - a[k] <= 0.5:
            z = a[k] - cl[k] * (a[k + 1] - a[k]) / (cl[k + 1] - cl[k])
            if best is None or abs(z) < abs(best):
                best = z
    return best


def zero_lift_fit(a, cl, window=cfg.FIT_WINDOW):
    m = (a >= window[0]) & (a <= window[1])
    slope, icpt = np.polyfit(a[m], cl[m], 1)
    return -icpt / slope, slope


def thickness_ratio_xy(xy):
    """Max thickness / chord from Selig-ordered coordinates."""
    return thickness_ratio(None, xy)[0]


def thickness_ratio(dat_path, xy=None):
    """Max thickness / chord and its chordwise location from a Selig-format .dat file."""
    if xy is None:
        xy = np.loadtxt(dat_path, skiprows=1)
    le = xy[:, 0].argmin()
    up, lo = xy[: le + 1][::-1], xy[le:]
    x = np.linspace(0, 1, 2001)
    t = np.interp(x, up[:, 0], up[:, 1]) - np.interp(x, lo[:, 0], lo[:, 1])
    return t.max(), x[t.argmax()]


def sizing(clmax_airfoil):
    """Wing C_L^max, S_req and cruise C_L for the stall-speed requirement (eqs. 2, 3, 12)."""
    CLmax = cfg.CLMAX_KNOCKDOWN * clmax_airfoil
    S_req = 2 * cfg.W / (cfg.RHO * cfg.V_STALL**2 * CLmax)
    CL_cruise = 2 * cfg.W / (cfg.RHO * cfg.V_CRUISE**2 * S_req)
    return CLmax, S_req, CL_cruise


def summarize():
    """One dict per airfoil in config.AIRFOILS."""
    rows = {}
    for name, (fname, method, tc_known) in cfg.AIRFOILS.items():
        a, cl, cd = load_polar(find_file(fname))
        i = cl.argmax()
        if method == "cross":
            aL0 = zero_lift_crossing(a, cl)
            slope = zero_lift_fit(a, cl)[1]
        else:
            aL0, slope = zero_lift_fit(a, cl)
        tc = tc_known if tc_known is not None else thickness_ratio(find_file(cfg.HW4_DAT))[0]
        CLmax, S_req, CL_cruise = sizing(cl[i])
        rows[name] = dict(clmax=cl[i], a_stall=a[i], aL0=aL0, slope=slope, tc=tc,
                          CLmax=CLmax, S_req=S_req, CL_cruise=CL_cruise,
                          AR_max=cfg.SPAN_MAX**2 / S_req)
    return rows


if __name__ == "__main__":
    print(f"W = {cfg.W:.3f} N   (m = {cfg.MASS} kg)\n")
    print(f"{'airfoil':<20}{'cl_max':>8}{'a_stall':>9}{'aL0[deg]':>10}{'t/c':>8}"
          f"{'CLmax(.9)':>11}{'S_req[m2]':>11}{'CL_cruise':>11}{'AR_max':>8}")
    for name, r in summarize().items():
        print(f"{name:<20}{r['clmax']:>8.4f}{r['a_stall']:>9.2f}{r['aL0']:>10.3f}{r['tc']:>8.4f}"
              f"{r['CLmax']:>11.4f}{r['S_req']:>11.4f}{r['CL_cruise']:>11.4f}{r['AR_max']:>8.2f}")
