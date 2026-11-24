import { Vector3 } from 'three';
import { angleDelta, clamp, damp, lerp } from '../utils/math.js';
import { walkHeight } from '../world/terrain.js';

const SAMPLE = 0.12; // metres between breadcrumbs
const _a = new Vector3();
const _b = new Vector3();

/** Catmull-Rom on one axis (smoothing of the recorded path). */
function cr(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/**
 * Path-following companion, ported from infinity-castle's CompanionAI (the
 * grounded half): the leader's position is recorded as breadcrumbs every
 * 12 cm; the follower travels along that trail `distance` metres (of path)
 * behind, sampled with Catmull-Rom so corners stay round, at the leader's
 * own speed plus a pull proportional to the gap. Personal space: never
 * closer than `personalSpace` in a straight line. `side` offsets her beside
 * the trail (so she walks at his shoulder rather than in his footsteps).
 * Faces her velocity while moving, his heading when stopped.
 */
export class Follower {
  constructor(actor, leader, { distance = 1.2, personalSpace = 0.7, side = 0, maxSpeed = 6 } = {}) {
    this.actor = actor;
    this.leader = leader; // { position, heading, speed }
    this.D = distance;
    this.personalSpace = personalSpace;
    this.side = side;
    this.maxSpeed = maxSpeed;
    this.pos = actor.root.position.clone();
    this.prev = this.pos.clone();
    this.vel = new Vector3();
    this.sep = new Vector3();
    this.off = new Vector3();
    this.heading = actor.root.rotation.y;
    this.path = [];
    this.s = 0;
    this.v = 0;
    this.paused = false; // an act is moving this actor itself
    this.reset();
  }

  reset() {
    this.pos.copy(this.actor.root.position);
    this.prev.copy(this.pos);
    const L = this.leader.position;
    this.path = [{ p: this.pos.clone(), s: 0 }];
    const d = this.pos.distanceTo(L);
    if (d > 1e-3) this.path.push({ p: L.clone(), s: d });
    this.s = 0;
    this.v = 0;
  }

  segment(s) {
    const P = this.path;
    let i = 0;
    while (i < P.length - 2 && P[i + 1].s < s) i++;
    return i;
  }

  sampleAt(s, out) {
    const P = this.path;
    if (P.length === 1) return out.copy(P[0].p);
    const i = this.segment(s);
    const a = P[i], b = P[i + 1];
    const t = clamp((s - a.s) / Math.max(b.s - a.s, 1e-6), 0, 1);
    const p0 = (P[i - 1] ?? a).p, p1 = a.p, p2 = b.p, p3 = (P[i + 2] ?? b).p;
    return out.set(cr(p0.x, p1.x, p2.x, p3.x, t), 0, cr(p0.z, p1.z, p2.z, p3.z, t));
  }

  update(dt) {
    if (this.paused) return;
    const L = this.leader;
    const lp = L.position;
    // record
    const P = this.path;
    const last = P[P.length - 1];
    const d = last.p.distanceTo(lp);
    if (d > 25) this.reset();
    else if (d >= SAMPLE) P.push({ p: lp.clone(), s: last.s + d });
    const tail = P[P.length - 1];
    const leaderS = tail.s + tail.p.distanceTo(lp);
    const targetS = leaderS - this.D;
    if (targetS - this.s > 30) this.s = targetS - 30;
    const gap = targetS - this.s;
    const want = gap < 0 ? 0 : clamp(L.speed + gap * 2.6, 0, this.maxSpeed);
    this.v = lerp(this.v, want, damp(want > this.v ? 6 : 8, dt));
    this.s = Math.max(this.s, Math.min(this.s + this.v * dt, Math.max(this.s, targetS)));
    this.sampleAt(this.s, _a);
    // walk beside the trail, offset toward her side of his heading
    this.off.lerp(_b.set(Math.cos(L.heading) * -this.side, 0, -Math.sin(L.heading) * -this.side), damp(2, dt));
    _a.add(this.off);
    // personal space
    _b.set(_a.x - lp.x, 0, _a.z - lp.z);
    const dl = _b.length();
    if (dl < this.personalSpace) {
      if (dl < 1e-3) _b.set(-Math.sin(L.heading), 0, -Math.cos(L.heading));
      else _b.divideScalar(dl);
      _b.multiplyScalar(this.personalSpace - dl);
    } else _b.set(0, 0, 0);
    this.sep.lerp(_b, damp(10, dt));
    _a.add(this.sep);
    _a.y = walkHeight(_a.x, _a.z);
    this.pos.copy(_a);
    while (P.length > 3 && P[2].s < this.s - 0.5) P.shift();

    // velocity + facing
    this.vel.subVectors(this.pos, this.prev).divideScalar(Math.max(dt, 1e-4));
    this.prev.copy(this.pos);
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const face = hs > 0.35 ? Math.atan2(this.vel.x, this.vel.z) : L.heading;
    this.heading += angleDelta(this.heading, face) * damp(hs > 0.35 ? 8 : 3, dt);
    const r = this.actor.root;
    r.position.copy(this.pos);
    r.rotation.y = this.heading;
    this.actor.speed = Math.min(hs, this.maxSpeed);
  }
}
