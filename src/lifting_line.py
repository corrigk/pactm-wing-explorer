"""Generalized Prandtl lifting-line solver (symmetric, untwisted wing).

Planform: rectangular centre section of semispan fraction `a` (a = 0 gives a single linear
taper root to tip), then linear taper to c_tip = lam * c_root. Lift slope of the section is 2 pi.
"""
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
import config as cfg  # noqa: E402


def planform(S, AR, lam, a=0.0):
    """b, c_root, c_tip from area, aspect ratio, taper ratio and rectangular fraction a."""
    b = np.sqrt(AR * S)
    c_r = S / (b * (a + 0.5 * (1 + lam) * (1 - a)))
    return b, c_r, lam * c_r


def chord_theta(theta, c_r, lam, a=0.0):
    """Chord at station theta (0 < theta < pi); y = -(b/2) cos(theta)."""
    c = np.abs(np.cos(theta))
    taper = c_r * (1 + (lam - 1) / (1 - a) * (c - a))
    return np.where(c <= a, c_r, taper)


class Wing:
    """Solved lifting-line wing. Coefficients A are per radian of (alpha - alpha_L0)."""

    def __init__(self, S, AR, lam, a=0.0, n_stations=cfg.LL_N_STATIONS):
        self.S, self.AR, self.lam, self.a = S, AR, lam, a
        self.b, self.c_r, self.c_t = planform(S, AR, lam, a)
        N = n_stations
        self.harm = 2 * np.arange(N) + 1                       # 1, 3, ..., 2N-1
        th0 = np.arange(1, N + 1) * np.pi / (2 * N)            # pi/(2N) ... pi/2
        c0 = chord_theta(th0, self.c_r, lam, a)
        n = self.harm[None, :]
        M = (2 * self.b / (np.pi * c0[:, None]) + n / np.sin(th0)[:, None]) * np.sin(n * th0[:, None])
        self.A = np.linalg.solve(M, np.ones(N))                # per rad
        self.a_w = np.pi * AR * self.A[0]                      # 1/rad
        self.a_w_deg = self.a_w * np.pi / 180                  # 1/deg
        self.delta = float(np.sum(self.harm[1:] * (self.A[1:] / self.A[0]) ** 2))
        self.e = 1 / (1 + self.delta)

    def CL(self, alpha_deg, alpha_L0_deg):
        return self.a_w_deg * (alpha_deg - alpha_L0_deg)

    def alpha_for_CL(self, CL, alpha_L0_deg):
        return alpha_L0_deg + CL / self.a_w_deg

    def CDi(self, CL):
        return CL**2 / (np.pi * self.e * self.AR)

    def chord_y(self, y):
        theta = np.arccos(np.clip(-np.asarray(y) / (self.b / 2), -1, 1))
        return chord_theta(theta, self.c_r, self.lam, self.a)

    def distribution(self, CL, theta=None):
        """Spanwise y [m], circulation-normalised c_l(y), and L'(y)/q for a given wing C_L.

        Returns y, c_l(y), c(y), Lprime_over_q  (L' = q * c * c_l, q = dynamic pressure).
        """
        if theta is None:
            theta = np.linspace(1e-4, np.pi - 1e-4, 401)
        y = -(self.b / 2) * np.cos(theta)
        gamma_over_Vb = 2 * (np.sin(np.outer(theta, self.harm)) @ self.A)   # per rad
        scale = CL / self.a_w                                               # rad = alpha - alpha_L0
        c = chord_theta(theta, self.c_r, self.lam, self.a)
        cl = 2 * gamma_over_Vb * scale * self.b / c                         # 2 Gamma/(V c)
        return y, cl, c, c * cl
