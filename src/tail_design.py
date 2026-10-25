"""HW7 design cycle: wing (from HW6) + tail + wing set angle, for one airfoil. Pure functions, no I/O."""
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
import config as cfg  # noqa: E402
import airfoil_data  # noqa: E402
import design_space as ds  # noqa: E402
import tail_trim as tt  # noqa: E402
from drag_buildup import compute_CD0  # noqa: E402
from lifting_line import Wing  # noqa: E402

XGRID = np.linspace(0.0, 0.6, 1201)
R_GRID = np.arange(0.01, 0.80, 0.0005)


def wing_inputs(name, af, hw6=None):
    """Wing quantities carried forward from HW6 plus the pitching-moment coefficient from the polar."""
    if hw6 is None:
        ARs, lams = ds.grids(af)
        hw6, _ = ds.pick_best(ds.scan(af, ARs, lams))
    S, AR, lam = hw6["S"], hw6["AR"], hw6["lam"]
    wing = Wing(S, AR, lam)
    a, cl, cd = airfoil_data.load_polar(airfoil_data.find_file(cfg.AIRFOILS[name][0]))
    cm = np.loadtxt(airfoil_data.find_file(cfg.AIRFOILS[name][0]), skiprows=11, usecols=(4,))
    order = np.argsort(a)
    a, cm = a[order], cm[order]
    start = 0.0 if cfg.AIRFOILS[name][1] == "fit" else af["aL0"]        # fitted-branch airfoils: attached window from 0 deg
    return dict(name=name, S=S, AR=AR, lam=lam, b=wing.b, cbar=tt.mac_linear_taper(S, AR, lam),
                CLa=wing.a_w, e=wing.e, alpha0=np.radians(af["aL0"]), CLmax=cfg.CLMAX_KNOCKDOWN * af["clmax"],
                CMac=tt.cmac_from_polar(a, cm, start), cm_window=(start, start + 8.0),
                CLcr=2 * cfg.W / (cfg.RHO * cfg.V_CRUISE**2 * S), tc=af["tc"], hw6=hw6)


def design(wi, AR_t=cfg.TAIL_AR, lam_t=cfg.TAIL_TAPER, lt=cfg.TAIL_ARM, SM=cfg.SM_TARGET, downwash_in_CLalpha=False,
           range_min=cfg.CG_RANGE_MIN, cg_frac=cfg.CG_FRACTION, alpha_stall=None):
    """Fixed-point design cycle on the wing set angle i_w. Returns the full design dictionary."""
    CLa_t = tt.cl_alpha_empirical(AR_t)
    deps = tt.downwash_gradient(wi["CLa"], wi["AR"])
    e_t = Wing(1.0, AR_t, lam_t).e
    alpha_w_max = wi["alpha0"] + wi["CLmax"] / wi["CLa"]            # wing angle at C_L^max
    i_w = np.radians(3.0)
    for _ in range(60):
        a_stall = alpha_w_max - i_w if alpha_stall is None else alpha_stall
        stab = tt.stability_line(XGRID, wi["CLa"], CLa_t, deps, lt, wi["cbar"], SM, downwash_in_CLalpha=downwash_in_CLalpha)
        to = tt.takeoff_line(XGRID, wi["CLa"], i_w, wi["CMac"], lt, wi["cbar"])
        st = tt.stall_recovery_line(XGRID, wi["CLmax"], CLa_t, a_stall, wi["CMac"], lt, wi["cbar"], SM)
        sel = None
        for r in R_GRID:                                           # smallest tail with a wide enough CG range
            rng = tt.feasible_cg_range(r, [stab, to, st], XGRID)
            if rng and rng[1] - rng[0] >= range_min - 1e-9:
                sel = (r, rng)
                break
        if sel is None:
            return dict(feasible=False, wi=wi, lines=(stab, to, st), i_w=i_w)
        r, (x0, x1) = sel
        xcg = x0 + cg_frac * (x1 - x0)
        trim = tt.trim_cruise(wi["CLcr"], xcg, r, lt, wi["cbar"], wi["CMac"], wi["CLa"], CLa_t, deps, wi["alpha0"])
        if abs(trim["i_w"] - i_w) < 1e-7:
            i_w = trim["i_w"]
            break
        i_w = 0.5 * i_w + 0.5 * trim["i_w"]
    St = r * wi["S"]
    bt = np.sqrt(AR_t * St)
    ct = St / bt if lam_t == 1.0 else 2 * St / (bt * (1 + lam_t))
    CD0 = compute_CD0(cfg.V_CRUISE, wi["tc"], S=wi["S"], b=wi["b"], S_ht=St, c_ht=ct)
    CD = tt.trimmed_drag(wi["CLcr"], CD0, xcg, r, lt, wi["cbar"], wi["CMac"], wi["e"], wi["AR"], e_t, AR_t)
    d_lec = tt.airplane_derivs(wi["CLa"], CLa_t, deps, r, lt, wi["cbar"], xcg, downwash_in_CLalpha=True)
    d_hw7 = tt.airplane_derivs(wi["CLa"], CLa_t, deps, r, lt, wi["cbar"], xcg, downwash_in_CLalpha=False)
    return dict(feasible=True, wi=wi, r=r, St=St, AR_t=AR_t, lam_t=lam_t, bt=bt, ct=ct, lt=lt, xcg=xcg, cg_range=(x0, x1),
                SM_lecture=d_lec["SM"], SM_hw7=d_hw7["SM"], VH=d_lec["VH"], deps=deps, CLa_t=CLa_t, e_t=e_t, CD0=CD0, CD=CD,
                LD=wi["CLcr"] / CD, i_w=trim["i_w"], i_t=trim["i_t"], CL_t=trim["CL_t"], CL_w=trim["CL_w"], alpha_stall=a_stall,
                lines=(stab, to, st), SM_target=SM)


def trimmed_polar(d, n=60):
    """Trimmed C_L-C_D polar from near 0 to the wing's C_L^max at the chosen CG."""
    wi = d["wi"]
    CL = np.linspace(0.02, wi["CLmax"], n)
    CD0 = d["CD0"]
    CD = np.array([tt.trimmed_drag(c, CD0, d["xcg"], d["r"], d["lt"], wi["cbar"], wi["CMac"], wi["e"], wi["AR"], d["e_t"], d["AR_t"]) for c in CL])
    return CL, CD
