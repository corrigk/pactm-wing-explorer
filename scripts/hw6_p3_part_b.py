"""HW6 Problem 3(b): cruise lift distribution, spar and deflection, landing distribution.

Usage: python hw6_p3_part_b.py [airfoil]   (default S7062)
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for p in (ROOT, ROOT / "src"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

import config as cfg  # noqa: E402
import airfoil_data  # noqa: E402
import design_space as ds  # noqa: E402
import spar  # noqa: E402
from lifting_line import Wing  # noqa: E402

BLUE, ORANGE, INK, MUTED = cfg.BLUE, cfg.ORANGE, "#0b0b0b", "#52514e"
TAG = ""


def style(ax, xlabel, ylabel):
    ax.set_xlabel(xlabel)
    ax.set_ylabel(ylabel)
    ax.grid(alpha=0.3)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)


def main(name):
    out = cfg.OUTPUT_DIR
    out.mkdir(exist_ok=True)
    tag = name.replace(" ", "_").replace("(", "").replace(")", "")
    rows = airfoil_data.summarize()
    af = rows[name]
    ARs, lams = ds.grids(af)
    res = ds.scan(af, ARs, lams)
    best, ok = ds.pick_best(res)
    wing = Wing(af["S_req"], best["AR"], best["lam"])
    b, s = wing.b, wing.b / 2
    q = 0.5 * cfg.RHO * cfg.V_CRUISE**2
    sec = best["spar"]

    # (1) cruise lift distribution --------------------------------------------------
    y, cl, c, c_cl = wing.distribution(best["CL_cruise"])
    Lp = q * c_cl                                                    # N/m
    ell = (4 * cfg.W / (np.pi * b)) * np.sqrt(np.clip(1 - (2 * y / b) ** 2, 0, None))
    fig, ax = plt.subplots(1, 2, figsize=(11, 4.2))
    ax[0].plot(y, Lp, color=BLUE, lw=2, label=rf"lifting line, $\alpha$ = {best['alpha_cruise']:.2f}$^\circ$")
    ax[0].plot(y, ell, color=MUTED, lw=1.2, ls="--", label="elliptical, same total lift")
    style(ax[0], "Spanwise position, y [m]", "Lift per unit span, L'(y) [N/m]")
    ax[0].legend(frameon=False)
    ax[1].plot(y, cl, color=ORANGE, lw=2, label=r"$c_l(y)$ at cruise")
    ax[1].axhline(af["clmax"], color=INK, lw=1, ls=":", label=rf"airfoil $c_{{l,max}}$ = {af['clmax']:.3f}")
    style(ax[1], "Spanwise position, y [m]", r"Section lift coefficient, $c_l$")
    ax[1].set_ylim(0, af["clmax"] * 1.1)
    ax[1].legend(frameon=False, loc="lower center")
    fig.tight_layout()
    fig.savefig(out / f"hw6_p3_b1_cruise_{tag}.png", dpi=200)
    plt.close(fig)

    # (2) spar: moment and deflection ------------------------------------------------
    loads = spar.half_wing_loads(wing, best["CL_cruise"])
    defl = spar.deflection_curve(loads, sec["I"])
    limit = cfg.DEFLECTION_FRAC * b
    fig, ax = plt.subplots(1, 2, figsize=(11, 4.2))
    ax[0].plot(loads["y"], loads["moment"], color=BLUE, lw=2)
    style(ax[0], "Spanwise position, y [m]", "Bending moment at 3g, M(y) [N m]")
    ax[1].plot(loads["y"], defl * 1e3, color=ORANGE, lw=2, label=f"spar: {spar.describe(sec)}")
    ax[1].axhline(limit * 1e3, color=INK, lw=1, ls=":", label=rf"limit 3% of b = {limit*1e3:.0f} mm")
    ax[1].plot(s, defl[-1] * 1e3, "o", color=ORANGE, ms=7)
    style(ax[1], "Spanwise position, y [m]", "Deflection, $\\delta$(y) [mm]")
    ax[1].legend(frameon=False, loc="center left")
    fig.tight_layout()
    fig.savefig(out / f"hw6_p3_b2_spar_{tag}.png", dpi=200)
    plt.close(fig)

    # (3) landing ---------------------------------------------------------------------
    yl, cll, _, _ = wing.distribution(best["CL_land"])
    fig, ax = plt.subplots(figsize=(6.5, 4.4))
    ax.plot(yl, cll, color=BLUE, lw=2, label=rf"landing, $\alpha$ = {best['alpha_land']:.2f}$^\circ$")
    ax.plot(y, cl, color=MUTED, lw=1.2, ls="--", label="cruise")
    ax.axhline(af["clmax"], color=INK, lw=1, ls=":", label=rf"airfoil $c_{{l,max}}$ = {af['clmax']:.3f}")
    ax.set_ylim(0, af["clmax"] * 1.1)
    style(ax, "Spanwise position, y [m]", r"Section lift coefficient, $c_l$")
    ax.legend(frameon=False, loc="lower center")
    fig.tight_layout()
    fig.savefig(out / f"hw6_p3_b3_landing_{tag}.png", dpi=200)
    plt.close(fig)

    # large feasible-region plot -------------------------------------------------------
    fig, ax = plt.subplots(figsize=(10, 7.5))
    handles = ds.plot_panel(ax, name, af, ARs, lams, res, best, ok, big=True)
    ax.legend(handles=list(handles.values()), loc="lower left", fontsize=9, frameon=True, framealpha=0.9)
    fig.tight_layout()
    fig.savefig(out / f"hw6_p3_design_space_{tag}.png", dpi=200)
    plt.close(fig)

    # numbers -----------------------------------------------------------------------------
    print(f"{name}: AR {best['AR']:.3f}  lambda {best['lam']:.2f}  b {b:.3f} m  S {wing.S:.4f} m^2  "
          f"c_r {wing.c_r*1e3:.1f} mm  c_t {wing.c_t*1e3:.1f} mm")
    print(f"cruise: C_L {best['CL_cruise']:.4f}  alpha {best['alpha_cruise']:.2f} deg  "
          f"c_l peak {cl.max():.3f} at y = {y[cl.argmax()]:+.3f} m  (c_l,max {af['clmax']:.3f})")
    print(f"landing: C_L {best['CL_land']:.4f}  alpha {best['alpha_land']:.2f} deg  "
          f"c_l peak {cll.max():.3f} at y = {yl[cll.argmax()]:+.3f} m  ratio {cll.max()/af['clmax']:.3f}  "
          f"margin {af['clmax'] - cll.max():.3f}")
    print(f"        alpha_land vs alpha at c_l,max of the polar ({af['a_stall']:.2f} deg): "
          f"{best['alpha_land']:.2f} deg < {af['a_stall']:.2f} deg")
    print(f"spar: {spar.describe(sec)}  I {sec['I']:.4e} m^4 (I_req {best['I_req']:.4e})  "
          f"tip defl {defl[-1]*1e3:.1f} mm = {100*defl[-1]/b:.2f}% of b  (limit {limit*1e3:.0f} mm)")
    print(f"        M_root {loads['moment'][0]:.2f} N m  sigma {sec['sigma']/1e6:.2f} MPa (yield {cfg.WOOD_YIELD/1e6:.1f})  "
          f"tip fit: depth {sec.get('h', sec.get('d'))*1e3:.0f} mm <= {af['tc']*wing.c_t*1e3:.1f} mm")
    print(f"wrote figures to {out}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "S7062")
