import { CatmullRomCurve3, Vector3 } from 'three';
import { PARK } from '../config.js';

/**
 * The cherry-blossom lane: one curve every system shares (ground ribbon,
 * tree avenue, lantern strings, terrain flattening, act choreography).
 */
export const laneCurve = new CatmullRomCurve3(PARK.lane.map((p) => new Vector3(...p)), false, 'centripetal');
export const laneLength = laneCurve.getLength();

// dense 2D samples for fast distance queries
const SAMPLES = laneCurve.getSpacedPoints(Math.ceil(laneLength / 1.5));

/** Distance (m, horizontal) from (x, z) to the lane's centre line. */
export function distToLane(x, z) {
  let m = Infinity;
  for (const p of SAMPLES) {
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < m) m = d;
  }
  return Math.sqrt(m);
}

const _t = new Vector3();
/** Unit vector pointing to the RIGHT of the direction of travel at u. */
export function laneSide(u, out = new Vector3()) {
  laneCurve.getTangentAt(Math.min(1, Math.max(0, u)), _t);
  return out.set(-_t.z, 0, _t.x).normalize();
}

/** Point on the lane at fraction u (0 gate → 1 plaza). */
export const lanePoint = (u, out = new Vector3()) => laneCurve.getPointAt(Math.min(1, Math.max(0, u)), out);

/**
 * Resolved stations: { name: { center: Vector3, radius, u, heading } }.
 * `heading` = yaw (rad) facing back toward the lane (handy for staging).
 */
export const STATIONS = Object.fromEntries(
  Object.entries(PARK.stations).map(([name, s]) => {
    if (s.center) return [name, { center: new Vector3(...s.center), radius: s.radius, u: 1, heading: Math.PI }];
    const base = lanePoint(s.u);
    const center = base.clone().addScaledVector(laneSide(s.u), s.side * s.offset);
    const heading = Math.atan2(base.x - center.x, base.z - center.z);
    return [name, { center, radius: s.radius, u: s.u, heading, side: s.side }];
  }),
);

/** Distance from (x, z) to the nearest station's edge (negative = inside). */
export function distToStations(x, z) {
  let m = Infinity;
  for (const s of Object.values(STATIONS)) m = Math.min(m, Math.hypot(x - s.center.x, z - s.center.z) - s.radius);
  return m;
}

/** Fraction u (0..1) of the lane point nearest to (x, z). */
export function laneU(x, z) {
  let m = Infinity, k = 0;
  for (let i = 0; i < SAMPLES.length; i++) {
    const p = SAMPLES[i];
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < m) {
      m = d;
      k = i;
    }
  }
  return k / (SAMPLES.length - 1);
}
