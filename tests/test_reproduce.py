"""Reproduce known results. Run: python tests/test_reproduce.py  (also pytest-compatible)."""
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
for p in (ROOT, ROOT / "src"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

import importlib.util  # noqa: E402

import config as cfg  # noqa: E402
import airfoil_data  # noqa: E402
import drag_buildup as new_drag  # noqa: E402
from lifting_line import Wing  # noqa: E402
import spar  # noqa: E402

_LEGACY = ROOT / "legacy_code" / "drag_buildup.py"     # not part of the public repo; the comparison is skipped without it
legacy_drag = None
if _LEGACY.is_file():
    _spec = importlib.util.spec_from_file_location("legacy_drag", _LEGACY)
    legacy_drag = importlib.util.module_from_spec(_spec)
    _spec.loader.exec_module(legacy_drag)

# CLAUDE.md section 4: c_l,max, alpha_L0, t/c, S_req
TABLE4 = {
    "NACA 2415":         (1.3482, -2.216, 0.1500, 0.3762),
    "NACA 23015":        (1.4765, -1.104, 0.1500, 0.3435),
    "NACA 64-212":       (0.9742, -1.490, 0.1200, 0.5206),
    "S1223":             (2.2211, -10.321, 0.1213, 0.2283),
    "S7062":             (1.6332, -4.330, 0.1400, 0.3105),
    "HW4 (PACTM iter3)": (1.6293, -2.733, 0.0900, 0.3113),
}

# Problem 1 (legacy_code/lifting_line_part_b.py): c_r and rectangular fraction fixed
C_R = 0.293
A_FRAC = (0.7437235 - 0.447126) / 0.7437235
ALPHA_ZL = -2.0772
S_PACT_P1 = 2 * (C_R * (0.7437235 - 0.447126) + 0.5 * (C_R + 0.1465) * 0.447126)
AR_PACTM = (2 * 0.7437235) ** 2 / S_PACT_P1
P1_CASES = {  # AR, sigma, CL(4 deg), CDi(4 deg), e, slope per deg
    1: (AR_PACTM, 0.5, 0.49747, 0.013262, 0.99419, 0.0819),
    2: (AR_PACTM, 1.0, 0.47968, 0.012824, 0.95590, 0.0789),
    3: (2 * AR_PACTM, 0.5, 0.56920, 0.008740, 0.98752, 0.0937),
    4: (2 * AR_PACTM, 1.0, 0.55037, 0.008839, 0.91292, 0.0906),
}


def test_airfoil_table():
    rows = airfoil_data.summarize()
    for name, (clmax, aL0, tc, S_req) in TABLE4.items():
        r = rows[name]
        assert abs(r["clmax"] - clmax) < 5e-4, name
        assert abs(r["aL0"] - aL0) < 5e-3, name
        assert abs(r["tc"] - tc) < 5e-4, name
        assert abs(r["S_req"] - S_req) < 5e-4, name


def test_cd0_matches_legacy():
    if legacy_drag is None:
        return
    for tc in (0.0887, 0.15, 0.09):
        assert abs(new_drag.compute_CD0(15.0, tc) - legacy_drag.compute_CD0(15.0, tc)) < 1e-12


def test_cd0_vs_hw1_target():
    cd0 = new_drag.compute_CD0(15.0, 0.0887)
    assert abs(cd0 - 0.0214) / 0.0214 < 0.015, cd0  # HW1 target 0.0214 (computed 0.02116)


def test_cd0_scales_with_area():
    c1, w1, t1, f1 = new_drag.compute_CD0(15.0, 0.15, parts=True)
    c2, w2, t2, f2 = new_drag.compute_CD0(15.0, 0.15, S=2 * cfg.S_PACTM, b=cfg.B_PACTM, parts=True)
    assert abs(t2 - t1 / 2) < 1e-12 and abs(f2 - f1 / 2) < 1e-12


def test_problem1_lifting_line():
    for k, (AR, sig, CL4, CDi4, e, slope) in P1_CASES.items():
        b = AR * C_R * (A_FRAC + 0.5 * (1 + sig) * (1 - A_FRAC))
        S = b**2 / AR
        w = Wing(S, AR, sig, a=A_FRAC, n_stations=4)
        CL = w.CL(4.0, ALPHA_ZL)
        assert abs(CL - CL4) < 5e-5, (k, CL)
        assert abs(w.CDi(CL) - CDi4) < 5e-7, (k, w.CDi(CL))
        assert abs(w.e - e) < 5e-5, (k, w.e)
        assert abs(w.a_w_deg - slope) < 5e-5, (k, w.a_w_deg)


def test_lifting_line_converged_and_consistent():
    w = Wing(0.3762, 8.0, 0.5, a=0.0)          # many stations
    w4 = Wing(0.3762, 8.0, 0.5, a=0.0, n_stations=4)
    assert abs(w.a_w_deg - w4.a_w_deg) / w.a_w_deg < 0.02
    # integral of c*c_l over the span returns C_L*S
    CL = 0.6
    y, cl, c, c_cl = w.distribution(CL)
    assert abs(np.trapezoid(c_cl, y) / w.S - CL) < 2e-3
    # elliptical limit: rectangular high-AR wing slope approaches 2 pi AR/(AR+2) per rad
    wr = Wing(1.0, 20.0, 1.0, a=0.0)
    ell = 2 * np.pi * 20 / (20 + 2) * np.pi / 180
    assert abs(wr.a_w_deg - ell) / ell < 0.03


def test_spar_loads_and_deflection():
    w = Wing(0.3762, 8.0, 0.5)
    CL = 0.54
    ld = spar.half_wing_loads(w, CL)
    # root shear on the half-wing is 3 W / 2 when the cruise lift supports W (CL from W)
    CL_w = 2 * cfg.W / (cfg.RHO * cfg.V_CRUISE**2 * w.S)
    ld = spar.half_wing_loads(w, CL_w)
    assert abs(ld["shear"][0] - 1.5 * cfg.W) / (1.5 * cfg.W) < 2e-3
    # deflection curve ends at the closed-form tip integral
    I = 3e-8
    d = spar.deflection_curve(ld, I)
    assert abs(d[-1] - spar.tip_deflection_integral(ld) / (cfg.WOOD_E * I)) / d[-1] < 2e-3
    # sizing to I_req gives tip deflection <= 3 % of span
    b = w.b
    sec = spar.size_spar(spar.I_required(ld, b), ld["moment"][0], w.c_t, 0.15)
    assert spar.tip_deflection_integral(ld) / (cfg.WOOD_E * sec["I"]) <= 0.03 * b + 1e-12


def test_spar_cantilever_point_load():
    # uniform load check of the integrators: w = const -> M(0) = w s^2 / 2, tip defl = w s^4 / (8 EI)
    s_, wl, I = 1.0, 10.0, 1e-8
    y = np.linspace(0, s_, 2001)
    shear = wl * (s_ - y)
    M = wl * (s_ - y) ** 2 / 2
    ld = dict(y=y, moment=M, s=s_)
    assert abs(spar.tip_deflection_integral(ld) / (cfg.WOOD_E * I) - wl * s_**4 / (8 * cfg.WOOD_E * I)) < 1e-6
    assert abs(spar.deflection_curve(ld, I)[-1] - wl * s_**4 / (8 * cfg.WOOD_E * I)) < 1e-6


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"PASS  {name}")
