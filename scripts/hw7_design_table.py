"""HW7 Part 3, Problem 2: six-airfoil tail and trim design table, scissor plots, trimmed polars, stall curves."""
import csv
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
import tail_design as td  # noqa: E402
import tail_trim as tt  # noqa: E402

PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#4a3aa7"]


def polar(name):
    a, cl, cd = airfoil_data.load_polar(airfoil_data.find_file(cfg.AIRFOILS[name][0]))
    o = np.argsort(a)
    return a[o], cl[o]


def main():
    cfg.OUTPUT_DIR.mkdir(exist_ok=True)
    rows = airfoil_data.summarize()
    out, designs = [], {}
    for name, af in rows.items():
        wi = td.wing_inputs(name, af)
        d = td.design(wi)
        designs[name] = d
        a, cl = polar(name)
        sm = tt.stall_metrics(a, cl)
        row = dict(airfoil=name, CD0=d.get("CD0"), S_w=wi["S"], AR_w=wi["AR"], S_t=d.get("St"), AR_t=d.get("AR_t"),
                   xcg=d.get("xcg"), SM=d.get("SM_lecture"), SM_hw7=d.get("SM_hw7"), CD=d.get("CD"), LD=d.get("LD"),
                   stall=tt.stall_label(sm), stall_loss2=sm["loss2"], stall_loss4=sm["loss4"], stall_plateau=sm["plateau"], i_w_deg=np.degrees(d["i_w"]) if d["feasible"] else None,
                   i_t_deg=np.degrees(d["i_t"]) if d["feasible"] else None, CMac=wi["CMac"], feasible=d["feasible"])
        out.append(row)

    hdr = (f"{'airfoil':<19}{'C_D0':>8}{'S_w':>8}{'AR_w':>7}{'S_t':>8}{'AR_t':>6}{'x_cg':>7}{'SM':>7}{'C_D':>8}{'L/D':>7}"
           f"{'i_w':>7}{'i_t':>7}{'CMac':>8}  stall behaviour")
    print(hdr)
    for r in out:
        if not r["feasible"]:
            print(f"{r['airfoil']:<19}no feasible tail size up to S_t/S_w = 0.8")
            continue
        print(f"{r['airfoil']:<19}{r['CD0']:>8.5f}{r['S_w']:>8.4f}{r['AR_w']:>7.2f}{r['S_t']:>8.4f}{r['AR_t']:>6.2f}{r['xcg']:>7.3f}"
              f"{r['SM']:>7.3f}{r['CD']:>8.5f}{r['LD']:>7.2f}{r['i_w_deg']:>7.2f}{r['i_t_deg']:>7.2f}{r['CMac']:>8.4f}  "
              f"{r['stall']}: c_l loss {100 * r['stall_loss2']:.1f}% at +2 deg, {100 * r['stall_loss4']:.1f}% at +4 deg, 95% plateau {r['stall_plateau']:.1f} deg")
    with open(cfg.OUTPUT_DIR / "hw7_design_table.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(out[0]))
        w.writeheader()
        w.writerows(out)

    # ---- scissor plot (NACA 2415 and the selected airfoil) ----
    best = max((r for r in out if r["feasible"]), key=lambda r: r["LD"])["airfoil"]
    for name in dict.fromkeys(["NACA 2415", best]):
        d = designs[name]
        if not d["feasible"]:
            continue
        stab, to, st = d["lines"]
        x = td.XGRID
        fig, ax = plt.subplots(figsize=(7.5, 5.2))
        ceil = 0.5
        ax.plot(x, stab, color=cfg.BLUE, lw=2, label=f"stability, SM = {d['SM_target']:.2f}")
        ax.plot(x, to, color=cfg.ORANGE, lw=2, label="takeoff rotation")
        ax.plot(x, st, color="#1baf7a", lw=2, label="stall recovery")
        lo = np.maximum.reduce([np.where(np.isfinite(l), l, -1) for l in d["lines"]])
        ax.fill_between(x, lo, ceil, where=(lo <= ceil), color="#cfb991", alpha=0.25, label="feasible region")
        ax.plot([d["cg_range"][0], d["cg_range"][1]], [d["r"], d["r"]], color="k", lw=2.5, label="chosen S_t/S_w, CG range")
        ax.plot(d["xcg"], d["r"], "k*", ms=14, label=f"design: x_cg = {d['xcg']:.3f}, S_t/S_w = {d['r']:.3f}")
        ax.set_xlim(0, 0.6); ax.set_ylim(0, ceil)
        ax.set_xlabel(r"CG position, $\bar{x}_{cg}$ [fraction of wing MAC]"); ax.set_ylabel(r"Tail-to-wing area ratio, $S_t/S_w$")
        ax.set_title(f"Scissor plot, {name}"); ax.grid(alpha=0.3); ax.legend(loc="upper left", fontsize=8)
        fig.tight_layout(); fig.savefig(cfg.OUTPUT_DIR / f"hw7_scissor_{name.replace(' ', '_')}.png", dpi=200); plt.close(fig)

    # ---- trimmed polars ----
    fig, ax = plt.subplots(figsize=(7.5, 5.2))
    for k, (name, d) in enumerate(designs.items()):
        if not d["feasible"]:
            continue
        CL, CD = td.trimmed_polar(d)
        ax.plot(CD, CL, color=PALETTE[k], lw=2, label=f"{name} (L/D {d['LD']:.1f})")
        ax.plot(d["CD"], d["wi"]["CLcr"], "o", color=PALETTE[k], ms=6)
    ax.set_xlabel(r"Trimmed drag coefficient, $C_D$"); ax.set_ylabel(r"Lift coefficient, $C_L$ (dots: cruise)")
    ax.set_title("Trimmed drag polars"); ax.grid(alpha=0.3); ax.legend(fontsize=8)
    fig.tight_layout(); fig.savefig(cfg.OUTPUT_DIR / "hw7_trimmed_polars.png", dpi=200); plt.close(fig)

    fig, ax = plt.subplots(figsize=(7.5, 5.2))
    d = designs["NACA 2415"]
    if d["feasible"]:
        CL, CD = td.trimmed_polar(d)
        ax.plot(CD, CL, color=cfg.BLUE, lw=2.2)
        ax.plot(d["CD"], d["wi"]["CLcr"], "o", color=cfg.ORANGE, ms=8, label=f"cruise: $C_L$ = {d['wi']['CLcr']:.3f}, $C_D$ = {d['CD']:.4f}")
    ax.set_xlabel(r"Trimmed drag coefficient, $C_D$"); ax.set_ylabel(r"Lift coefficient, $C_L$")
    ax.set_title("Trimmed drag polar, NACA 2415"); ax.grid(alpha=0.3); ax.legend()
    fig.tight_layout(); fig.savefig(cfg.OUTPUT_DIR / "hw7_trimmed_polar_NACA_2415.png", dpi=200); plt.close(fig)

    # ---- normalised stall curves ----
    fig, ax = plt.subplots(figsize=(7.5, 5.2))
    for k, name in enumerate(rows):
        a, cl = polar(name)
        i = int(np.argmax(cl))
        m = (a - a[i] >= -8) & (a - a[i] <= 6)
        ax.plot(a[m] - a[i], cl[m] / cl[i], color=PALETTE[k], lw=2, label=f"{name} ({tt.stall_label(tt.stall_metrics(a, cl)).split(' (')[0]})")
    ax.axvline(0, color="grey", lw=0.8); ax.axvline(2, color="grey", lw=0.8, ls=":")
    ax.set_xlabel(r"$\alpha - \alpha(c_{l,max})$ [deg]"); ax.set_ylabel(r"$c_l / c_{l,max}$")
    ax.set_title("Stall behaviour, Re = 300,000"); ax.grid(alpha=0.3); ax.legend(fontsize=8, loc="lower left")
    fig.tight_layout(); fig.savefig(cfg.OUTPUT_DIR / "hw7_stall_curves.png", dpi=200); plt.close(fig)
    print(f"\nwrote {cfg.OUTPUT_DIR / 'hw7_design_table.csv'} and 5 figures; best L/D: {best}")


if __name__ == "__main__":
    main()
