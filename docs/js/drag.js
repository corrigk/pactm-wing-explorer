// Subsonic component drag build-up (port of src/drag_buildup.py).
import { CONST } from './config.js';

const reynolds = (V, l) => (CONST.rho * V * l) / CONST.mu;
const skinFriction = (Re) => 0.455 / Math.log10(Re) ** 2.58;
const wettedLifting = (S) => 2.0 * 1.02 * S;
const formFactorLifting = (tc, M) => {
  const Z = (2 - M ** 2) / Math.sqrt(1 - M ** 2);   // unswept
  return 1 + Z * tc + 100 * tc ** 4;
};

/** C_D0 referenced to the wing area S. Wing Reynolds length is the mean chord S/b. */
export function computeCD0(V, tcWing, S, b) {
  const M = V / CONST.aSound;
  const wing = (formFactorLifting(tcWing, M) * CONST.qWing * skinFriction(reynolds(V, S / b)) * wettedLifting(S)) / S;
  const tail = (formFactorLifting(CONST.tcTail, M) * CONST.qTail * skinFriction(reynolds(V, CONST.cTail))
    * wettedLifting(CONST.sH + CONST.sV)) / S;
  const lam = CONST.lFuse / CONST.dFuse;
  const ffFuse = 0.9 + 5 / lam ** 1.5 + lam / 400;
  const wetFuse = Math.PI * CONST.dFuse * CONST.lFuse * (1 - 2 / lam) ** (2 / 3) * (1 + 1 / lam ** 2);
  const fuse = (ffFuse * CONST.qFuse * skinFriction(reynolds(V, CONST.lFuse)) * wetFuse) / S;
  return { total: wing + tail + fuse, wing, tail, fuse };
}
