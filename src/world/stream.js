import { CatmullRomCurve3 } from 'three';
import { lanePoint, laneSide } from './lane.js';

/**
 * The stream: a gentle, meandering brook that crosses the lane between the
 * catch clearing and the picnic lawn. Pure geometry here (no three.js scene
 * objects) so terrain, trees, the controller and the bridge can all query it.
 */
export const STREAM = {
  u: 0.385, // where it crosses the lane
  halfWidth: 3.0, // water half-width (m)
  depth: 1.9, // bed below the lawn
  water: -0.85, // water surface height (banks show above it)
  bridgeLength: 11, // deck span along the lane
  bridgeWidth: 2.7,
  bridgeRise: 1.5, // arch height at mid-span
  toriiU: 0.425, // the torii stands on the lane just past the bridge
};

export const crossing = lanePoint(STREAM.u);
export const laneDir = lanePoint(STREAM.u + 0.004).sub(lanePoint(STREAM.u - 0.004)).setY(0).normalize();
const across = laneSide(STREAM.u);

const pts = [];
for (let t = -170; t <= 170; t += 17) {
  const meander = Math.sin(t * 0.032) * 9 + Math.sin(t * 0.081 + 1.2) * 3;
  const w = Math.min(1, Math.abs(t) / 18); // straight where the bridge spans it
  pts.push(crossing.clone().addScaledVector(across, t).addScaledVector(laneDir, meander * w - Math.sin(1.2) * 3 * w));
}
export const streamCurve = new CatmullRomCurve3(pts, false, 'centripetal');
export const streamLength = streamCurve.getLength();
const SAMPLES = streamCurve.getSpacedPoints(Math.ceil(streamLength / 1.2));

/** Horizontal distance from (x, z) to the stream's centre line. */
export function distToStream(x, z) {
  let m = Infinity;
  for (const p of SAMPLES) {
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < m) m = d;
  }
  return Math.sqrt(m);
}

/** Bridge-local coords of (x, z): `a` along the lane from the crossing, `b` across. */
export function bridgeLocal(x, z) {
  const dx = x - crossing.x, dz = z - crossing.z;
  return { a: dx * laneDir.x + dz * laneDir.z, b: dx * across.x + dz * across.z };
}

/** Deck height of the arched bridge at (x, z), or -Infinity off the deck. */
export function bridgeDeck(x, z) {
  const { a, b } = bridgeLocal(x, z);
  const L = STREAM.bridgeLength / 2;
  if (Math.abs(a) > L + 0.2 || Math.abs(b) > STREAM.bridgeWidth / 2) return -Infinity;
  const k = Math.min(1, Math.abs(a) / L);
  return STREAM.bridgeRise * (1 - k * k) + 0.05;
}

export const streamAcross = across;
