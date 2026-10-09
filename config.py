"""Single source of parameters for the PACTM project. Every script imports from here."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
AIRFOIL_DIR = DATA_DIR / "airfoils"
HW6_P2_DIR = DATA_DIR / "hw6_p2"
OUTPUT_DIR = ROOT / "outputs"

# ---- aircraft and atmosphere (sea-level standard) ----
MASS = 2.85              # kg
G = 9.81                 # m/s^2
W = MASS * G             # N
RHO = 1.225              # kg/m^3
MU = 1.789e-5            # kg/(m s)
A_SOUND = 340.3          # m/s

# ---- HW6 Problem 3 requirements ----
V_CRUISE = 15.0          # m/s
V_STALL = 10.0           # m/s
LAND_FACTOR = 1.2        # V_land = 1.2 V_stall
DESCENT_DEG = 3.0        # deg, landing flight-path angle
LOAD_FACTOR = 3.0        # structural design load
CLMAX_KNOCKDOWN = 0.9    # wing C_L^max = 0.9 c_l,max
DEFLECTION_FRAC = 0.03   # tip deflection / full span b
WOOD_E = 7.0e9           # Pa
WOOD_YIELD = 21.6e6      # Pa
SPAN_MAX = 2.0           # m
ALPHA_CRUISE_MIN = -1.0  # deg
ALPHA_CRUISE_MAX = 3.0   # deg

# ---- design search ranges ----
TAPER_RANGE = (0.3, 1.0)     # lambda = c_tip / c_root
TAPER_STEP = 0.05
AR_MIN = 4.0
STOCK_STEP = 0.001           # m, round spar dimensions up to whole mm [PROPOSED]
SPAR_WIDTH_MAX_FRAC = 0.25   # rectangular spar width <= this * tip chord [PROPOSED]

# ---- lifting-line solver ----
LL_N_STATIONS = 40           # control points; odd harmonics 1, 3, ..., 2N-1

# ---- PACTM baseline geometry (3DEXPERIENCE model) ----
S_PACTM = 0.370962
B_PACTM = 1.490527
S_HTAIL = 0.029777
S_VTAIL = 0.039038
C_TAIL = 0.140933
D_FUSE = 0.108205
L_FUSE = 0.970270
Q_WING, Q_TAIL, Q_FUSE = 1.0, 1.04, 1.0
T_C_TAIL = 0.12

# ---- airfoil name -> (polar file, alpha_L0 method, known t/c or None) ----
FIT_WINDOW = (0.0, 4.0)      # deg, attached-branch window for the "fit" method
AIRFOILS = {
    "NACA 2415":         ("NACA_2415_Analysis.txt",   "cross", 0.15),
    "NACA 23015":        ("NACA_23015_Analysis.txt",  "cross", 0.15),
    "NACA 64-212":       ("NACA_64212_Analysis.txt",  "cross", 0.12),
    "S1223":             ("S1223_Analysis.txt",       "fit",   0.1213),
    "S7062":             ("S7062_Analysis.txt",       "cross", 0.14),
    "HW4 (PACTM iter3)": ("PACTM_design_iter3.txt",   "cross", None),
}
HW4_DAT = "PACTM_design_iter3.dat"

# ---- colours ----
BLUE, ORANGE = "#2a78d6", "#eb6834"
