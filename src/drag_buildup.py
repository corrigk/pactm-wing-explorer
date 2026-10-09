"""Subsonic component drag build-up (HW1), parametrized by wing area, span and t/c.

Tail and fuselage geometry stay PACTM's; their contribution scales as 1/S_wing.
"""
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
import config as cfg  # noqa: E402


def reynolds_number(rho, V, l, mu):
    return rho * V * l / mu


def skin_friction_turbulent(Re):
    return 0.455 / np.log10(Re) ** 2.58


def wetted_area_liftingsurface(S_exposed):
    return 2.0 * 1.02 * S_exposed


def wetted_area_fuselage(D_f, l_f):
    lam_f = l_f / D_f
    return np.pi * D_f * l_f * (1 - 2 / lam_f) ** (2 / 3) * (1 + 1 / lam_f**2)


def form_factor_liftingsurface(t_c, M, sweep_deg=0.0):
    s = np.radians(sweep_deg)
    Z = (2 - M**2) * np.cos(s) / np.sqrt(1 - M**2 * np.cos(s) ** 2)
    return 1 + Z * t_c + 100 * t_c**4


def form_factor_fuselage(D_f, l_f):
    lam_f = l_f / D_f
    return 0.9 + 5 / lam_f**1.5 + lam_f / 400


def compute_CD0(V, t_c_wing, S=cfg.S_PACTM, b=cfg.B_PACTM, t_c_tail=cfg.T_C_TAIL,
                rho=cfg.RHO, mu=cfg.MU, misc=0.0, parts=False):
    """C_D0 referenced to the wing area S. Wing Reynolds length is the mean chord S/b."""
    M = V / cfg.A_SOUND

    Cf_w = skin_friction_turbulent(reynolds_number(rho, V, S / b, mu))
    term_w = (form_factor_liftingsurface(t_c_wing, M) * cfg.Q_WING * Cf_w
              * wetted_area_liftingsurface(S) / S)

    Cf_t = skin_friction_turbulent(reynolds_number(rho, V, cfg.C_TAIL, mu))
    term_t = (form_factor_liftingsurface(t_c_tail, M) * cfg.Q_TAIL * Cf_t
              * wetted_area_liftingsurface(cfg.S_HTAIL + cfg.S_VTAIL) / S)

    Cf_f = skin_friction_turbulent(reynolds_number(rho, V, cfg.L_FUSE, mu))
    term_f = (form_factor_fuselage(cfg.D_FUSE, cfg.L_FUSE) * cfg.Q_FUSE * Cf_f
              * wetted_area_fuselage(cfg.D_FUSE, cfg.L_FUSE) / S)

    CD0 = term_w + term_t + term_f + misc
    return (CD0, term_w, term_t, term_f) if parts else CD0
