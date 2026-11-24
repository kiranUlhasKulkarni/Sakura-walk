import { Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { easeInOutCubic } from '../utils/math.js';

/**
 * Cinematic camera. A shot is a move of (position, look-at target) from where
 * the camera is now to a destination over `duration` with an easing, optionally
 * along a curved path (`via`: a mid control point → quadratic Bézier). On top
 * of every shot rides a subtle handheld "breathing" so nothing is ever dead
 * still. ?debug adds free OrbitControls (press O to toggle).
 *
 *   rig.cut(pos, look)                       instant
 *   await rig.move({ to, look, duration, via, ease, fov })
 *   rig.follow(() => target, offset)          track a moving subject
 */
export class CameraRig {
  constructor(camera, dom, { debug = false } = {}) {
    this.camera = camera;
    this.pos = camera.position.clone();
    this.look = new Vector3();
    this.shot = null;
    this.followFn = null;
    this.followOffset = new Vector3();
    this.breath = 1;
    this.t = 0;
    this.baseFov = camera.fov;
    this._p = new Vector3();
    this._l = new Vector3();
    this.free = false;
    if (debug) {
      this.controls = new OrbitControls(camera, dom);
      this.controls.enabled = false;
      this.controls.enableDamping = true;
      addEventListener('keydown', (e) => {
        if (e.code !== 'KeyO') return;
        this.free = !this.free;
        this.controls.enabled = this.free;
        if (this.free) this.controls.target.copy(this.look);
      });
    }
  }

  cut(pos, look) {
    this.shot = null;
    this.pos.copy(pos);
    this.look.copy(look);
  }

  move({ to, look, duration = 4, via = null, lookVia = null, ease = easeInOutCubic, fov = null }) {
    return new Promise((resolve) => {
      this.followFn = null;
      this.shot = {
        p0: this.pos.clone(), p1: to.clone(), pv: via?.clone() ?? null,
        l0: this.look.clone(), l1: look.clone(), lv: lookVia?.clone() ?? null,
        f0: this.camera.fov, f1: fov ?? this.camera.fov,
        t: 0, duration, ease, resolve,
      };
    });
  }

  follow(fn, offset) {
    this.shot = null;
    this.followFn = fn;
    this.followOffset.copy(offset);
  }

  static bez(a, v, b, t, out) {
    if (!v) return out.copy(a).lerp(b, t);
    const u = 1 - t;
    return out.set(0, 0, 0).addScaledVector(a, u * u).addScaledVector(v, 2 * u * t).addScaledVector(b, t * t);
  }

  update(dt) {
    this.t += dt;
    if (this.free) {
      this.controls.update();
      return;
    }
    const s = this.shot;
    if (s) {
      s.t += dt;
      const k = s.ease(Math.min(1, s.t / s.duration));
      CameraRig.bez(s.p0, s.pv, s.p1, k, this.pos);
      CameraRig.bez(s.l0, s.lv, s.l1, k, this.look);
      this.camera.fov = s.f0 + (s.f1 - s.f0) * k;
      this.camera.updateProjectionMatrix();
      if (s.t >= s.duration) {
        this.shot = null;
        s.resolve();
      }
    } else if (this.followFn) {
      const target = this.followFn();
      const k = 1 - Math.exp(-dt * 2.5);
      this._p.copy(target).add(this.followOffset);
      this.pos.lerp(this._p, k);
      this.look.lerp(target, k * 1.4);
    }
    // handheld breathing
    const b = this.breath * 0.035;
    this._p.set(Math.sin(this.t * 0.53) * b, Math.sin(this.t * 0.71 + 1.3) * b * 0.7, Math.sin(this.t * 0.37 + 2.1) * b);
    this.camera.position.copy(this.pos).add(this._p);
    this._l.copy(this.look).addScaledVector(this._p, 0.4);
    this.camera.lookAt(this._l);
  }

  /** A point on the ground a few metres ahead of the lens (the petal storm centres here). */
  focus(out, ahead = 12) {
    this.camera.getWorldDirection(out);
    out.y = 0;
    out.normalize().multiplyScalar(ahead).add(this.camera.position);
    out.y = 0;
    return out;
  }

  dispose() {
    this.controls?.dispose();
  }
}
