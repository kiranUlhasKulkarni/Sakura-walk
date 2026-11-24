
import { angleDelta, damp } from '../utils/math.js';
import { walkHeight } from '../world/terrain.js';

/**
 * Small scripted locomotion for anyone the controller doesn't drive (her, the
 * cats): walk to a point with ease-in/out, turn to face something. Each call
 * returns a promise; an actor has at most one move at a time (a new one
 * replaces the old). When a move ends the actor simply stays where it is.
 */
export class Movers {
  constructor() {
    this.moves = new Map(); // actor → state
  }

  walkTo(actor, target, { speed = 1.2, face = null } = {}) {
    this.moves.get(actor)?.resolve();
    return new Promise((resolve) => {
      this.moves.set(actor, { kind: 'walk', target: target.clone(), speed, v: actor.speed || 0, face, resolve });
    });
  }

  /** Turn in place to face a point (or a heading in radians). */
  turnTo(actor, at, { rate = 4 } = {}) {
    this.moves.get(actor)?.resolve();
    return new Promise((resolve) => {
      this.moves.set(actor, { kind: 'turn', at, rate, resolve });
    });
  }

  stop(actor) {
    const m = this.moves.get(actor);
    if (!m) return;
    this.moves.delete(actor);
    actor.speed = 0;
    m.resolve();
  }

  update(dt) {
    for (const [actor, m] of this.moves) {
      const r = actor.root;
      if (m.kind === 'walk') {
        const dx = m.target.x - r.position.x, dz = m.target.z - r.position.z;
        const d = Math.hypot(dx, dz);
        const want = Math.min(m.speed, d * 1.1);
        m.v += (want - m.v) * damp(4, dt);
        if (d < 0.04) {
          actor.speed = 0;
          this.moves.delete(actor);
          if (m.face) this.moves.set(actor, { kind: 'turn', at: m.face, rate: 4, resolve: m.resolve });
          else m.resolve();
          continue;
        }
        const step = Math.min(d, m.v * dt);
        r.position.x += (dx / d) * step;
        r.position.z += (dz / d) * step;
        r.position.y = walkHeight(r.position.x, r.position.z);
        r.rotation.y += angleDelta(r.rotation.y, Math.atan2(dx, dz)) * damp(7, dt);
        actor.speed = m.v;
      } else {
        const h = typeof m.at === 'number' ? m.at : Math.atan2(m.at.x - r.position.x, m.at.z - r.position.z);
        const dh = angleDelta(r.rotation.y, h);
        r.rotation.y += dh * damp(m.rate, dt);
        actor.speed = Math.min(0.5, Math.abs(dh) * 0.6); // a few shuffling steps while turning
        if (Math.abs(dh) < 0.02) {
          actor.speed = 0;
          this.moves.delete(actor);
          m.resolve();
        }
      }
    }
  }
}

