"""Golden values from the hand calculations (HW7 Parts 1 and 2). Run: python tests/test_tail_trim.py"""
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
for p in (ROOT, ROOT / "src"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

import tail_trim as tt  # noqa: E402

D = np.radians
# PACTM (HW7 Part 2)
Sw, ARw, cbar = 0.370318, 5.974591, 0.258448
St, ARt, lt, a0w, CMac = 0.059583, 2.996993, 0.569272, D(-2.216), -0.055
r = St / Sw


def pactm():
    CLa_w, CLa_t = tt.cl_alpha_empirical(ARw), tt.cl_alpha_empirical(ARt)
    return CLa_w, CLa_t, tt.downwash_gradient(CLa_w, ARw)


def test_pactm_slopes_and_downwash():
    CLa_w, CLa_t, deps = pactm()
    assert abs(CLa_w - 4.522579) < 2e-5 and abs(CLa_t - 3.360788) < 2e-5
    assert abs(deps - 0.481901) < 2e-5
    assert abs(tt.epsilon0(deps, 0.0, a0w) - 0.018638) < 2e-6
    assert abs(r - 0.160897) < 2e-6 and abs(tt.tail_volume(r, lt, cbar) - 0.354401) < 2e-6


def test_pactm_static_margin():
    CLa_w, CLa_t, deps = pactm()
    d = tt.airplane_derivs(CLa_w, CLa_t, deps, r, lt, cbar, 0.17)
    assert abs(d["CLa"] - 4.802736) < 2e-5 and abs(d["CMa"] + 1.001309) < 2e-5 and abs(d["SM"] - 0.208487) < 2e-6


def test_stability_line_both_conventions():
    CLa_w, CLa_t, deps = pactm()
    SM = 0.208487
    lec = tt.stability_line(0.17, CLa_w, CLa_t, deps, lt, cbar, SM, downwash_in_CLalpha=True)
    hw7 = tt.stability_line(0.17, CLa_w, CLa_t, deps, lt, cbar, SM, downwash_in_CLalpha=False)
    assert abs(lec - 0.160897) < 2e-6 and abs(hw7 - 0.170735) < 2e-6


def test_pactm_trim_cruise():
    CLa_w, CLa_t, deps = pactm()
    t = tt.trim_cruise(0.547836, 0.17, r, lt, cbar, CMac, CLa_w, CLa_t, deps, a0w, i_w=0.0)
    assert abs(np.degrees(t["alpha_frl"]) - 5.292854) < 2e-4
    assert abs(np.degrees(t["i_t"]) + 6.428350) < 2e-4


def test_part1_small_uav():
    CLa_w, CLa_t = tt.cl_alpha_empirical(6.0), tt.cl_alpha_empirical(4.0)
    deps = tt.downwash_gradient(CLa_w, 6.0)
    rr = 0.08 / 0.7
    d = tt.airplane_derivs(CLa_w, CLa_t, deps, rr, 1.1, 0.3, 0.28)
    assert abs(d["VH"] - 0.419048) < 2e-6 and abs(d["CLa"] - 4.759213) < 2e-5
    assert abs(d["SM"] - 0.147624) < 2e-6 and abs(d["CMa"] + 0.702573) < 2e-5
    for i_t, CLt, aF in [(0.0, 0.851241, 4.354150), (-3.0, 1.400445, 11.245713)]:
        s = tt.trim_given_incidences(D(3), D(i_t), 0.28, rr, 1.1, 0.3, -0.05, CLa_w, CLa_t, deps, D(-3.5))
        assert abs(s["CL"] - CLt) < 2e-5, (i_t, s["CL"])
        assert abs(np.degrees(s["alpha_frl"]) - aF) < 2e-4, (i_t, np.degrees(s["alpha_frl"]))


def test_trim_roundtrip_and_drag():
    CLa_w, CLa_t, deps = pactm()
    t = tt.trim_cruise(0.55, 0.20, r, lt, cbar, CMac, CLa_w, CLa_t, deps, a0w)
    assert abs(t["alpha_frl"]) < 1e-12
    s = tt.trim_given_incidences(t["i_w"], t["i_t"], 0.20, r, lt, cbar, CMac, CLa_w, CLa_t, deps, a0w)
    assert abs(s["CL"] - 0.55) < 1e-9 and abs(s["alpha_frl"]) < 1e-9
    assert tt.trimmed_drag(0.55, 0.02, 0.20, r, lt, cbar, CMac, 0.95, ARw, 0.9, ARt) > 0.02


def test_scissor_limit_directions():
    CLa_w, CLa_t, deps = pactm()
    x = np.linspace(0.05, 0.5, 200)
    stab = tt.stability_line(x, CLa_w, CLa_t, deps, lt, cbar)
    to = tt.takeoff_line(x, CLa_w, D(3), CMac, lt, cbar)
    assert np.all(np.diff(stab) > 0)          # more tail needed as CG moves aft
    assert np.all(np.diff(to) < 0)            # less tail needed for rotation as CG moves aft
    rng = tt.feasible_cg_range(0.2, [stab, to], x)
    assert rng is not None and rng[0] < rng[1]


def test_stall_metrics():
    a = np.arange(0.0, 20.01, 0.25)
    sharp = np.where(a < 10, 0.1 * a, 1.0 - 0.15 * (a - 10))
    soft = np.where(a < 10, 0.1 * a, 1.0 - 0.01 * (a - 10))
    ms, mg = tt.stall_metrics(a, sharp), tt.stall_metrics(a, soft)
    assert tt.stall_label(ms) == "sharp" and tt.stall_label(mg) == "gradual"
    assert abs(ms["loss4"] - 0.6) < 1e-9 and abs(mg["loss2"] - 0.02) < 1e-9


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"PASS  {name}")
