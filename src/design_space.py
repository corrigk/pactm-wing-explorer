"""Design evaluation, constraint maps over (AR, taper ratio), best-design pick, and plots."""
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
import config as cfg  # noqa: E402
import spar  # noqa: E402
from drag_buildup import compute_CD0  # noqa: E402
from lifting_line import Wing  # noqa: E402

CONSTRAINTS = ["alpha", "span", "land", "fit", "stress"]


def evaluate(af, AR, lam, S=None):
    """All requirements for one design. `af` is a row from airfoil_data.summarize().

    S defaults to S_req (stall-speed sizing); pass a larger S for the stall-speed sensitivity study.
    """
    S = af["S_req"] if S is None else S
    wing = Wing(S, AR, lam)
    b = wing.b
    CL_cr = 2 * cfg.W / (cfg.RHO * cfg.V_CRUISE**2 * S)
    alpha_cr = wing.alpha_for_CL(CL_cr, af["aL0"])

    V_land = cfg.LAND_FACTOR * cfg.V_STALL
    CL_land = 2 * cfg.W * np.cos(np.radians(cfg.DESCENT_DEG)) / (cfg.RHO * V_land**2 * S)
    alpha_land = wing.alpha_for_CL(CL_land, af["aL0"])
    _, cl_land, _, _ = wing.distribution(CL_land)
    land_ratio = cl_land.max() / af["clmax"]                      # eq. 20

    loads = spar.half_wing_loads(wing, CL_cr)
    I_req = spar.I_required(loads, b)
    sec = spar.size_spar(I_req, loads["moment"][0], wing.c_t, af["tc"])
    delta_tip = spar.tip_deflection_integral(loads) / (cfg.WOOD_E * sec["I"])

    CD0 = compute_CD0(cfg.V_CRUISE, af["tc"], S=S, b=b)
    CDi = wing.CDi(CL_cr)
    CD = CD0 + CDi

    viol = dict(
        alpha=max(0.0, alpha_cr - cfg.ALPHA_CRUISE_MAX, cfg.ALPHA_CRUISE_MIN - alpha_cr) / 4.0,
        span=max(0.0, b / cfg.SPAN_MAX - 1),
        land=max(0.0, land_ratio - 1),
        fit=sec["fit_excess"],
        stress=max(0.0, sec["sigma"] / cfg.WOOD_YIELD - 1),
    )
    return dict(AR=AR, lam=lam, S=S, b=b, c_r=wing.c_r, c_t=wing.c_t, a_w=wing.a_w_deg, e=wing.e,
                CL_cruise=CL_cr, alpha_cruise=alpha_cr, CL_land=CL_land, alpha_land=alpha_land,
                land_ratio=land_ratio, I_req=I_req, spar=sec, delta_pct=100 * delta_tip / b,
                M_root=loads["moment"][0], CD0=CD0, CDi=CDi, CD=CD, LD=CL_cr / CD,
                viol=viol, feasible=all(v <= 0 for v in viol.values()),
                total_viol=sum(viol.values()))


def grids(af, n_ar=33, lam_range=cfg.TAPER_RANGE, lam_step=cfg.TAPER_STEP):
    ar_max = cfg.SPAN_MAX**2 / af["S_req"]
    ARs = np.linspace(cfg.AR_MIN, ar_max, n_ar)
    lams = np.arange(lam_range[0], lam_range[1] + 1e-9, lam_step)
    return ARs, lams


def scan(af, ARs, lams, S=None):
    """Evaluate every (lam, AR) node; returns list-of-lists res[i_lam][j_AR]."""
    return [[evaluate(af, AR, lam, S) for AR in ARs] for lam in lams]


def pick_best(res):
    """Highest L/D among fully feasible designs; otherwise least total violation, then L/D."""
    flat = [r for row in res for r in row]
    feas = [r for r in flat if r["feasible"]]
    if feas:
        return max(feas, key=lambda r: r["LD"]), True
    return min(flat, key=lambda r: (round(r["total_viol"], 6), -r["LD"])), False


def violated(r):
    return [k for k, v in r["viol"].items() if v > 0]


# ------------------------------------------------------------------ plotting
STYLE = {  # constraint -> (label, colour, hatch); first slots of the reference categorical palette
    "alpha":  (r"cruise $\alpha$ outside $-1^\circ$ to $3^\circ$", "#2a78d6", "//"),
    "span":   (r"$b = 2$ m limit (AR search stops here)", "#eb6834", "\\\\"),
    "land":   (r"landing stall ($c_l \geq c_{l,max}$)", "#1baf7a", ".."),
    "fit":    ("spar does not fit at tip", "#eda100", "xx"),
    "stress": (r"spar stress $> 21.6$ MPa", "#e87ba4", "++"),
}


def _mask(res, key):
    return np.array([[r["viol"][key] > 0 for r in row] for row in res])


def plot_panel(ax, name, af, ARs, lams, res, best, best_ok, big=False):
    import matplotlib.patches as mpatches
    from matplotlib.lines import Line2D
    AR_g, lam_g = np.meshgrid(ARs, lams)
    handles = {}
    for key in CONSTRAINTS:
        label, colour, hatch = STYLE[key]
        m = _mask(res, key).astype(float)
        if m.any():
            cs = ax.contourf(AR_g, lam_g, m, levels=[0.5, 1.5], colors="none", hatches=[hatch])
            cs.set_edgecolor(colour)
            cs.set_linewidth(0)
            if not m.all():
                ax.contour(AR_g, lam_g, m, levels=[0.5], colors=[colour], linewidths=1.6)
            handles[key] = mpatches.Patch(facecolor="none", edgecolor=colour, hatch=hatch, label=label)
    ax.axvline(ARs[-1], color=STYLE["span"][1], lw=2.2, ls="--", clip_on=False)
    handles["span"] = Line2D([], [], color=STYLE["span"][1], lw=2.2, ls="--", label=STYLE["span"][0])
    feas = np.array([[r["feasible"] for r in row] for row in res]).astype(float)
    if feas.any():
        ax.contourf(AR_g, lam_g, feas, levels=[0.5, 1.5], colors=["#1baf7a"], alpha=0.15)
    LD = np.array([[r["LD"] for r in row] for row in res])
    cs = ax.contour(AR_g, lam_g, LD, levels=8, colors="#52514e", linewidths=0.8)
    ax.clabel(cs, fmt="%.1f", fontsize=9 if big else 7)
    ax.plot(best["AR"], best["lam"], marker="*" if best_ok else "D", markersize=16 if big else 12,
            markerfacecolor="#0b0b0b" if best_ok else "white", markeredgecolor="#0b0b0b", zorder=5, clip_on=False)
    ax.set_xlim(ARs[0], ARs[-1])
    ax.set_ylim(lams[0], lams[-1])
    ax.set_title(f"{name}  ($S_{{req}}$ = {af['S_req']:.3f} m$^2$)", fontsize=12 if big else 10)
    ax.set_xlabel("Aspect ratio, AR")
    ax.set_ylabel(r"Taper ratio, $\lambda = c_{tip}/c_{root}$")
    ax.grid(alpha=0.25)
    return handles


def make_figure(rows, scans, bests, path, suptitle=None):
    import matplotlib.pyplot as plt
    from matplotlib.lines import Line2D
    names = list(rows)
    fig, axes = plt.subplots(2, 3, figsize=(16, 9.5))
    active = {}
    for ax, name in zip(axes.ravel(), names):
        ARs, lams, res = scans[name]
        best, ok = bests[name]
        active.update(plot_panel(ax, name, rows[name], ARs, lams, res, best, ok))
    handles = [active[k] for k in CONSTRAINTS if k in active]
    handles += [Line2D([], [], color="#52514e", lw=0.8, label="cruise L/D contours"),
                Line2D([], [], marker="*", color="none", markerfacecolor="#0b0b0b",
                       markeredgecolor="#0b0b0b", markersize=12, label="best feasible design"),
                Line2D([], [], marker="D", color="none", markerfacecolor="white",
                       markeredgecolor="#0b0b0b", markersize=9, label="best attempt (none feasible)")]
    fig.legend(handles=handles, loc="lower center", ncol=4, fontsize=10, frameon=False)
    if suptitle:
        fig.suptitle(suptitle)
    fig.tight_layout(rect=(0, 0.08, 1, 1))
    fig.savefig(path, dpi=200)
    plt.close(fig)
