"""Cantilever half-wing spar: shear, moment, deflection, stress and fit (eqs. 21 to 27)."""
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
import config as cfg  # noqa: E402


def _cumtrapz_from_tip(y, f):
    """F(y) = integral from y to the tip (last point) of f, same length as y."""
    seg = 0.5 * (f[1:] + f[:-1]) * np.diff(y)
    out = np.zeros_like(y)
    out[:-1] = np.cumsum(seg[::-1])[::-1]
    return out


def _cumtrapz_from_root(y, f):
    seg = 0.5 * (f[1:] + f[:-1]) * np.diff(y)
    return np.concatenate(([0.0], np.cumsum(seg)))


def half_wing_loads(wing, CL_cruise, V=cfg.V_CRUISE, n_load=cfg.LOAD_FACTOR):
    """Shear V(y) and moment M(y) on the right half-wing for load factor n at speed V.

    w(y) = n * L'_cruise(y) with the cruise lift distribution shape (eq. 21). y runs root -> tip.
    """
    theta = np.linspace(np.pi / 2, np.pi, 801)
    y, cl, c, c_cl = wing.distribution(CL_cruise, theta)
    q = 0.5 * cfg.RHO * V**2
    w = n_load * q * c_cl                         # N/m
    shear = _cumtrapz_from_tip(y, w)              # eq. 22
    moment = _cumtrapz_from_tip(y, shear)
    return dict(y=y, w=w, shear=shear, moment=moment, s=wing.b / 2)


def tip_deflection_integral(loads):
    """Integral of M(y)(s - y) dy; delta_tip = this / (E I)  (eq. 23)."""
    y, M, s = loads["y"], loads["moment"], loads["s"]
    return np.trapezoid(M * (s - y), y)


def I_required(loads, b):
    """Eq. (24): second moment of area that gives tip deflection = DEFLECTION_FRAC * b."""
    return tip_deflection_integral(loads) / (cfg.DEFLECTION_FRAC * b * cfg.WOOD_E)


def deflection_curve(loads, I):
    """Deflection delta(y) [m] of a constant-EI cantilever, delta(0) = delta'(0) = 0."""
    y, M = loads["y"], loads["moment"]
    slope = _cumtrapz_from_root(y, M / (cfg.WOOD_E * I))
    return _cumtrapz_from_root(y, slope)


def _ceil_step(x, step=cfg.STOCK_STEP):
    return np.ceil(x / step - 1e-9) * step


def _floor_step(x, step=cfg.STOCK_STEP):
    return np.floor(x / step + 1e-9) * step


def size_spar(I_req, M_root, c_tip, tc):
    """Lightest solid spar that gives I >= I_req and fits at the tip.

    Fit rules (constant section, tip is the critical station):
      depth h or diameter d <= (t/c) c_tip        (eq. 27)
      rectangle width w <= SPAR_WIDTH_MAX_FRAC * c_tip   [PROPOSED]
    Returns the chosen section dict; `fit_excess` > 0 means nothing fits (best attempt).
    """
    cands = []
    h_max = _floor_step(tc * c_tip)
    if h_max >= cfg.STOCK_STEP:
        w = _ceil_step(12 * I_req / h_max**3)
        w_cap = cfg.SPAR_WIDTH_MAX_FRAC * c_tip
        cands.append(dict(kind="rect", w=w, h=h_max, area=w * h_max,
                          I=w * h_max**3 / 12, c=h_max / 2,
                          fit_excess=max(0.0, w / w_cap - 1)))
    d = _ceil_step((64 * I_req / np.pi) ** 0.25)
    cands.append(dict(kind="round", d=d, area=np.pi * d**2 / 4, I=np.pi * d**4 / 64, c=d / 2,
                      fit_excess=max(0.0, d / (tc * c_tip) - 1)))
    fits = [k for k in cands if k["fit_excess"] <= 0]
    best = min(fits, key=lambda k: k["area"]) if fits else min(cands, key=lambda k: k["fit_excess"])
    best["sigma"] = M_root * best["c"] / best["I"]                  # eq. 26
    best["stress_ok"] = best["sigma"] <= cfg.WOOD_YIELD
    return best


def describe(sec):
    if sec["kind"] == "rect":
        return f"rect {sec['w']*1e3:.0f} x {sec['h']*1e3:.0f} mm"
    return f"round d = {sec['d']*1e3:.0f} mm"
