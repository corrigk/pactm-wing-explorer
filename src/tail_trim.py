"""Horizontal-tail sizing, static margin, scissor-plot limits, trim and trimmed drag (HW7, Part 3, Problem 2).

Pure functions. Angles in radians unless a name ends in _deg. x-bar values are fractions of the wing MAC.
r = S_t / S_w.
"""
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
import config as cfg  # noqa: E402


# ------------------------------------------------------------------ geometry and lift slopes
def mac_linear_taper(S, AR, lam):
    """Mean aerodynamic chord of a single linearly tapered wing."""
    b = np.sqrt(AR * S)
    cr = 2 * S / (b * (1 + lam))
    return (2 / 3) * cr * (1 + lam + lam**2) / (1 + lam)


def cl_alpha_empirical(AR, a0=cfg.A0_SECTION):
    """Finite-wing lift slope [1/rad] (lecture slide 9)."""
    return np.pi * AR / (1 + np.sqrt(1 + (np.pi * AR / a0) ** 2))


def downwash_gradient(CLa_w, AR_w, kappa=cfg.KAPPA_DOWNWASH):
    return kappa * CLa_w / (np.pi * AR_w)


def tail_volume(r, lt, cbar):
    return r * lt / cbar


def epsilon0(deps, i_w, alpha0_w):
    return deps * (i_w - alpha0_w)


# ------------------------------------------------------------------ stability and scissor-plot limits
def airplane_derivs(CLa_w, CLa_t, deps, r, lt, cbar, xcg, xac=cfg.X_AC_W, downwash_in_CLalpha=True):
    """C_Lalpha, C_Malpha and static margin. downwash_in_CLalpha=False reproduces HW7 eq. (3) as printed."""
    VH = tail_volume(r, lt, cbar)
    CLa = CLa_w + r * CLa_t * ((1 - deps) if downwash_in_CLalpha else 1.0)
    CMa = (xcg - xac) * CLa - CLa_t * (1 - deps) * VH
    return dict(VH=VH, CLa=CLa, CMa=CMa, SM=-CMa / CLa)


def stability_line(xcg, CLa_w, CLa_t, deps, lt, cbar, SM=cfg.SM_TARGET, xac=cfg.X_AC_W, downwash_in_CLalpha=False):
    """S_t/S_w that gives static margin SM at xcg. Default is HW7 eq. (5) as printed (no downwash factor in
    C_Lalpha); downwash_in_CLalpha=True keeps the (1 - d eps/d alpha) factor as in the lecture."""
    xcg = np.asarray(xcg, dtype=float)
    f = (1 - deps) if downwash_in_CLalpha else 1.0
    num = CLa_w * (xcg - xac + SM)
    den = CLa_t * ((1 - deps) * lt / cbar - f * (xcg - xac + SM))
    return num / den


def required_moment_ratio(xcg, CL_w, CL_t, CMac_w, CM_req, lt, cbar, CMac_t=0.0, ct=0.0, xac=cfg.X_AC_W):
    """HW7 eq. (7): S_t/S_w that delivers C_M,cg = CM_req given the wing and tail lift coefficients."""
    xcg = np.asarray(xcg, dtype=float)
    return (CMac_w + CL_w * (xcg - xac) - CM_req) / (CL_t * (lt / cbar - xcg + xac) - CMac_t * ct / cbar)


def takeoff_line(xcg, CLa_w, i_w, CMac_w, lt, cbar, CL_t=cfg.TAKEOFF_CLT, CM_req=cfg.TAKEOFF_CM_REQ, xac=cfg.X_AC_W):
    """Forward CG limit: the tail must be able to rotate the airplane at takeoff."""
    return required_moment_ratio(xcg, CLa_w * i_w, CL_t, CMac_w, CM_req, lt, cbar, xac=xac)


def stall_recovery_line(xcg, CLmax_w, CLa_t, alpha_stall, CMac_w, lt, cbar, SM=cfg.SM_TARGET, xac=cfg.X_AC_W):
    """Aft CG limit: the tail must be able to pitch the airplane down from wing stall."""
    return required_moment_ratio(xcg, CLmax_w, CLa_t * alpha_stall, CMac_w, -CLmax_w * SM + CMac_w, lt, cbar, xac=xac)


def feasible_cg_range(r, lines, xgrid):
    """Longest contiguous CG interval on xgrid where r >= every limit line. Returns (x_fwd, x_aft) or None."""
    ok = np.ones_like(xgrid, dtype=bool)
    for ln in lines:
        ok &= np.isfinite(ln) & (r >= ln)
    if not ok.any():
        return None
    idx = np.flatnonzero(ok)
    breaks = np.flatnonzero(np.diff(idx) > 1)
    starts = np.r_[idx[0], idx[breaks + 1]]
    ends = np.r_[idx[breaks], idx[-1]]
    k = int(np.argmax(xgrid[ends] - xgrid[starts]))
    return float(xgrid[starts[k]]), float(xgrid[ends[k]])


# ------------------------------------------------------------------ trim
def trim_cruise(CL, xcg, r, lt, cbar, CMac_w, CLa_w, CLa_t, deps, alpha0_w, i_w=None, xac=cfg.X_AC_W):
    """Trim at C_M,cg = 0 for total lift coefficient CL (C_Mac,t = 0).

    With i_w=None the wing set angle is chosen so that the fuselage-reference angle equals cfg.ALPHA_FRL_TRIM.
    """
    VH = tail_volume(r, lt, cbar)
    CL_t = (CMac_w + CL * (xcg - xac)) / VH
    CL_w = CL - r * CL_t
    alpha_w = alpha0_w + CL_w / CLa_w
    if i_w is None:
        i_w = alpha_w - np.radians(cfg.ALPHA_FRL_TRIM)
    alpha_frl = alpha_w - i_w
    eps0 = epsilon0(deps, i_w, alpha0_w)
    i_t = CL_t / CLa_t - alpha_frl * (1 - deps) + eps0
    return dict(CL_t=CL_t, CL_w=CL_w, alpha_w=alpha_w, alpha_frl=alpha_frl, i_w=i_w, i_t=i_t, VH=VH)


def trim_given_incidences(i_w, i_t, xcg, r, lt, cbar, CMac_w, CLa_w, CLa_t, deps, alpha0_w, xac=cfg.X_AC_W):
    """Trimmed (C_M,cg = 0) operating point for fixed incidences: returns C_L,trim and alpha_FRL."""
    eps0 = epsilon0(deps, i_w, alpha0_w)

    def coeffs(alpha):
        CLw = CLa_w * (alpha + i_w - alpha0_w)
        CLt = CLa_t * (alpha * (1 - deps) + i_t - eps0)
        CM = CMac_w + (CLw + r * CLt) * (xcg - xac) - r * CLt * lt / cbar
        return CLw + r * CLt, CM

    (c0, m0), (c1, m1) = coeffs(0.0), coeffs(1.0)
    alpha = -m0 / (m1 - m0)
    return dict(CL=c0 + (c1 - c0) * alpha, alpha_frl=alpha)


def trimmed_drag(CL, CD0, xcg, r, lt, cbar, CMac_w, e_w, AR_w, e_t, AR_t, xac=cfg.X_AC_W):
    """HW7 part (e): C_D = C_D0 + (C_L^w)^2/(pi e_w AR_w) + r (C_L^t)^2/(pi e_t AR_t), trimmed at C_M,cg = 0."""
    CL_t = (CMac_w + CL * (xcg - xac)) / (r * lt / cbar)
    CL_w = CL - r * CL_t
    return CD0 + CL_w**2 / (np.pi * e_w * AR_w) + r * CL_t**2 / (np.pi * e_t * AR_t)


# ------------------------------------------------------------------ airfoil data helpers
def cmac_from_polar(alpha, cm, start, window=8.0):
    """Mean quarter-chord moment coefficient over the attached window [start, start + window] (deg)."""
    m = (alpha >= start) & (alpha <= start + window) & np.isfinite(cm)
    return float(np.mean(cm[m]))


def stall_metrics(alpha, cl, window=4.0):
    """Lift-curve stall character from a polar sorted by alpha.

    loss2 and loss4: fractional c_l loss 2 and 4 deg past the peak (clamped to the end of the data);
    post: degrees of data available after the peak; plateau: width in deg of the region with c_l >= 0.95 c_l,max.
    """
    i = int(np.argmax(cl))
    pk = float(cl[i])
    lo = i
    while lo > 0 and cl[lo - 1] >= 0.95 * pk:
        lo -= 1
    hi = i
    while hi < len(alpha) - 1 and cl[hi + 1] >= 0.95 * pk:
        hi += 1
    loss = lambda d: (pk - float(np.interp(min(alpha[i] + d, alpha[-1]), alpha, cl))) / pk
    return dict(alpha_peak=float(alpha[i]), cl_peak=pk, loss2=loss(2.0), loss4=loss(window),
                post=float(alpha[-1] - alpha[i]), plateau=float(alpha[hi] - alpha[lo]))


def stall_label(m, sharp=0.15, gradual=0.06):
    """'sharp', 'moderate' or 'gradual' from the c_l loss 4 deg past the peak; notes when the data end early."""
    lab = "sharp" if m["loss4"] >= sharp else ("gradual" if m["loss4"] <= gradual else "moderate")
    return lab + (" (sweep ends before stall)" if m["post"] < 2.0 else "")
