// Defaults mirror config.py. Every value the sliders can change lives in DEFAULTS.
export const DEFAULTS = {
  mass: 2.85,          // kg
  vCruise: 15,         // m/s
  vStall: 10,          // m/s
  landFactor: 1.2,     // V_land = landFactor * V_stall
  descentDeg: 3,       // deg
  loadFactor: 3,
  knockdown: 0.9,      // wing C_L^max = knockdown * c_l,max
  deflFrac: 0.03,      // tip deflection / full span
  E: 7.0e9,            // Pa
  yieldStress: 21.6e6, // Pa
  spanMax: 2.0,        // m
  alphaMin: -1,        // deg
  alphaMax: 3,         // deg
  widthFrac: 0.25,     // rectangular spar width <= widthFrac * tip chord
  step: 0.001,         // m, spar stock rounding
  aL0Shift: 0,         // deg, added to the airfoil's alpha_L0
};

export const CONST = {
  g: 9.81, rho: 1.225, mu: 1.789e-5, aSound: 340.3,
  nStations: 40,
  arMin: 4, taperMin: 0.3, taperMax: 1.0, taperStep: 0.05, nAR: 33,
  // PACTM tail and fuselage geometry (config.py)
  sH: 0.029777, sV: 0.039038, cTail: 0.140933, dFuse: 0.108205, lFuse: 0.970270,
  qWing: 1.0, qTail: 1.04, qFuse: 1.0, tcTail: 0.12,
};

export const CONSTRAINTS = ['alpha', 'span', 'land', 'fit', 'stress'];
