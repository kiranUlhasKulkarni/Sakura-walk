import { Quaternion, Vector3 } from 'three';
import { clamp, damp } from '../utils/math.js';
import { rotateWorld } from './PoseRig.js';

const UP = new Vector3(0, 1, 0);
const _q = new Quaternion();

/**
 * Procedural trot for the cat rig (no clips ship with it): diagonal leg pairs
 * swing together (FL+BR, FR+BL), knees fold on the forward swing, the body
 * bobs twice per stride, the tail sways and lifts, the head stays level.
 * Restores the rest pose each frame first, like PoseRig.
 */
export class CatGait {
  constructor(actor) {
    this.actor = actor;
    const bones = {};
    actor.model.traverse((o) => o.isBone && (bones[o.name.replace(/_\d+$/, '')] = o));
    const pick = (n) => bones[n] ?? null;
    this.legs = [
      { thigh: pick('Thigh_FL'), knee: pick('Knee_FL'), off: 0 },
      { thigh: pick('Thigh_BR'), knee: pick('Knee_BR'), off: 0 },
      { thigh: pick('Thigh_FR'), knee: pick('Knee_FR'), off: Math.PI },
      { thigh: pick('Thigh_BL'), knee: pick('Knee_BL'), off: Math.PI },
    ].filter((l) => l.thigh);
    this.tail = [pick('Tail_1'), pick('Tail_2'), pick('Tail_3')].filter(Boolean);
    this.head = pick('Head');
    this.all = [...this.legs.flatMap((l) => [l.thigh, l.knee]), ...this.tail, this.head].filter(Boolean);
    this.rest = new Map(this.all.map((b) => [b, b.quaternion.clone()]));
    this.restY = actor.model.position.y;
    this.phase = Math.random() * 6;
    this.speed = 0;
    this.t = Math.random() * 10;
    this.sleep = 0; // 0 standing … 1 curled up asleep (a loaf: legs tucked, head down, tail wrapped)
  }

  update(dt) {
    const a = this.actor;
    for (const [b, q] of this.rest) b.quaternion.copy(q);
    a.model.position.y = this.restY;
    this.t += dt;
    this.speed += (a.speed - this.speed) * damp(8, dt);
    const trot = clamp(this.speed / 1.2, 0, 1);
    this.phase += (dt * this.speed * Math.PI * 2) / 0.55; // ~55 cm per stride
    a.root.updateMatrixWorld(true);
    const fwd = new Vector3(0, 0, 1).applyQuaternion(a.root.quaternion);
    const right = new Vector3().crossVectors(fwd, UP).normalize();
    for (const l of this.legs) {
      const p = this.phase + l.off;
      rotateWorld(l.thigh, _q.setFromAxisAngle(right, -Math.sin(p) * 0.55 * trot));
      if (l.knee) rotateWorld(l.knee, _q.setFromAxisAngle(right, Math.max(0, Math.cos(p)) * 0.7 * trot));
    }
    a.model.position.y = this.restY + Math.abs(Math.sin(this.phase)) * 0.012 * trot;
    const r = this.sleep;
    if (r > 0.001) {
      // legs folded under the body, body down on the cloth, chin lowered, tail wrapped round
      this.legs.forEach((l, i) => {
        const front = i === 0 || i === 2;
        rotateWorld(l.thigh, _q.setFromAxisAngle(right, (front ? -1.2 : 1.1) * r));
        if (l.knee) rotateWorld(l.knee, _q.setFromAxisAngle(right, (front ? 1.6 : -1.5) * r));
      });
      a.model.position.y -= 0.085 * r;
      if (this.head) rotateWorld(this.head, _q.setFromAxisAngle(right, -0.45 * r + Math.sin(this.t * 0.8) * 0.02 * r));
    }
    const sway = Math.sin(this.t * (1.2 + trot * 3)) * (0.18 + trot * 0.15) * (1 - r * 0.8);
    this.tail.forEach((b, i) => rotateWorld(b, _q.setFromAxisAngle(UP, sway * (0.5 + i * 0.3) + r * 0.7)));
  }
}
