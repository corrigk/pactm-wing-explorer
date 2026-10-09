"""Inviscid linear-vorticity panel method (Kutta condition) for a Selig-format airfoil.

Used only to get an inviscid zero-lift angle alpha_L0 from coordinates, independent of
the viscous-polar kinks. Panel influence formulas follow Katz & Plotkin, linear vorticity.
"""
import numpy as np


def load_dat(path):
    """Selig .dat (name line, then x y pairs, TE -> upper -> LE -> lower -> TE)."""
    xy = np.loadtxt(path, skiprows=1)
    if np.hypot(*(xy[0] - xy[-1])) > 1e-9:          # blunt TE: close it at the mid-gap point
        te = 0.5 * (xy[0] + xy[-1])
        xy = xy.copy()
        xy[0] = xy[-1] = te
    return xy


def naca4(code, n=100):
    """Coordinates of a NACA 4-digit airfoil (cosine spacing, closed TE), Selig ordering."""
    m, p, t = int(code[0]) / 100, int(code[1]) / 10, int(code[2:]) / 100
    x = 0.5 * (1 - np.cos(np.linspace(0, np.pi, n)))
    yt = 5 * t * (0.2969 * np.sqrt(x) - 0.126 * x - 0.3516 * x**2 + 0.2843 * x**3 - 0.1036 * x**4)
    yc = np.where(x < p, m / p**2 * (2 * p * x - x**2), m / (1 - p) ** 2 * ((1 - 2 * p) + 2 * p * x - x**2))
    dyc = np.where(x < p, 2 * m / p**2 * (p - x), 2 * m / (1 - p) ** 2 * (p - x))
    th = np.arctan(dyc)
    xu, yu = x - yt * np.sin(th), yc + yt * np.cos(th)
    xl, yl = x + yt * np.sin(th), yc - yt * np.cos(th)
    up = np.c_[xu, yu][::-1]
    lo = np.c_[xl, yl][1:]
    xy = np.vstack([up, lo])
    xy[-1] = xy[0]
    return xy


def _influence(P, A, B):
    """(u, w) global velocity at points P from unit-strength linear vorticity on panel A->B.

    Returns (ga, gb): influence of the vorticity at node A and at node B, each shape (len(P), 2).
    """
    d = B - A
    l = np.hypot(*d)
    t = d / l
    n = np.array([-t[1], t[0]])
    rel = P - A
    x, z = rel @ t, rel @ n
    r1 = np.hypot(x, z)
    r2 = np.hypot(x - l, z)
    th1, th2 = np.arctan2(z, x), np.arctan2(z, x - l)
    dth = th2 - th1
    lnr = np.log(np.maximum(r1, 1e-12) / np.maximum(r2, 1e-12))
    u_c = dth / (2 * np.pi)
    w_c = -lnr / (2 * np.pi)
    u_l = (x * dth - z * lnr) / (2 * np.pi * l)
    w_l = -(x * lnr - l + z * dth) / (2 * np.pi * l)
    ga = np.c_[u_c - u_l, w_c - w_l]
    gb = np.c_[u_l, w_l]
    to_global = lambda uw: uw[:, [0]] * t + uw[:, [1]] * n
    return to_global(ga), to_global(gb)


def cl_vs_alpha(xy, alphas_deg):
    """Inviscid c_l at each angle of attack (chord = unit length)."""
    N = len(xy) - 1
    A, B = xy[:-1], xy[1:]
    mid = 0.5 * (A + B)
    d = B - A
    l = np.hypot(d[:, 0], d[:, 1])
    t = d / l[:, None]
    nrm = np.c_[-t[:, 1], t[:, 0]]
    M = np.zeros((N + 1, N + 1))
    for j in range(N):
        ga, gb = _influence(mid, A[j], B[j])
        M[:N, j] += np.einsum("ij,ij->i", ga, nrm)
        M[:N, j + 1] += np.einsum("ij,ij->i", gb, nrm)
    M[N, 0] = M[N, N] = 1.0                                   # Kutta: gamma_1 + gamma_N+1 = 0
    out = []
    for a in np.radians(alphas_deg):
        Vinf = np.array([np.cos(a), np.sin(a)])
        rhs = np.zeros(N + 1)
        rhs[:N] = -(nrm @ Vinf)
        g = np.linalg.solve(M, rhs)
        Gamma = np.sum(0.5 * (g[:-1] + g[1:]) * l)
        out.append(2 * Gamma)
    out = np.array(out)
    return out


def alpha_L0(xy):
    """Inviscid zero-lift angle [deg] and lift slope [1/deg]; sign fixed so the slope is positive."""
    a = np.array([0.0, 4.0])
    cl = cl_vs_alpha(xy, a)
    slope = (cl[1] - cl[0]) / (a[1] - a[0])
    sgn = 1.0 if slope > 0 else -1.0
    cl, slope = sgn * cl, sgn * slope
    return -cl[0] / slope, slope
