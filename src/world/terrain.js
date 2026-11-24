import { PARK } from '../config.js';
import { smoothstep } from '../utils/math.js';
import { distToLane, distToStations } from './lane.js';
import { distToStream, STREAM } from './stream.js';

/**
 * Ground height (m). Flat within PARK.flatWidth of the lane and every
 * station (so choreography never needs terrain following), except where the
 * stream cuts its channel; beyond that the ground rises in layers — knolls,
 * then soft irregular hills that enclose the park.
 */
export function terrainHeight(x, z) {
  // the stream's channel: soft grassy banks down to a pebbled bed
  const ds = distToStream(x, z);
  const hw = STREAM.halfWidth;
  const carve = ds < hw + 2.6 ? -STREAM.depth * (1 - smoothstep(hw - 0.8, hw + 2.6, ds)) : 0;
  const d = Math.min(distToLane(x, z), distToStations(x, z) + 4);
  const k = smoothstep(PARK.flatWidth, PARK.flatWidth + 60, d);
  if (k <= 0) return carve;
  // layered elevation: low knolls first, then the rising hills that enclose the park
  const n =
    Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.038 - 0.7) * 0.5 +
    Math.sin(x * 0.11 - z * 0.09 + 2.1) * 0.25 +
    Math.sin((x + z) * 0.021) * 0.25 +
    0.5;
  return carve * (1 - k) + k * k * (3 + n * 12) + k * 2.2 * Math.max(0, Math.sin(x * 0.07 + z * 0.05));
}

/**
 * Walkable surfaces raised above the terrain (the arched bridge deck) register
 * here: fn(x, z) → deck height or -Infinity when (x, z) isn't on it.
 */
const decks = [];
export function addWalkSurface(fn) {
  decks.push(fn);
  return () => decks.splice(decks.indexOf(fn), 1);
}

/** Height the characters stand at: the terrain, or a deck above it. */
export function walkHeight(x, z) {
  let h = terrainHeight(x, z);
  for (const f of decks) h = Math.max(h, f(x, z));
  return h;
}
