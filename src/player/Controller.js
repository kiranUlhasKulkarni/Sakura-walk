import { Vector3 } from 'three';
import { CAMERA, CONTROLLER, PARK } from '../config.js';
import { angleDelta, clamp, damp, lerp } from '../utils/math.js';
import { distToLane } from '../world/lane.js';
import { bridgeDeck, distToStream, STREAM } from '../world/stream.js';
import { walkHeight } from '../world/terrain.js';

const _look = new Vector3();
const _cam = new Vector3();
const _d = new Vector3();

/**
 * Third-person controller, ported from infinity-castle/src/player/Controller.js
 * and trimmed for a stroll in the park (no jumping, flat ground + bridge deck).
 *
 *  Input   WASD / arrows (camera-relative), Shift to walk briskly; mouse look
 *          with pointer lock (click), drag-to-look fallback; wheel to zoom.
 *  Motion  inertia: speed builds with `accel`, glides to a halt under
 *          `friction` (frame-rate independent exponential damping); he turns
 *          to face his velocity at `turnRate`.
 *  World   feet follow walkHeight() (terrain, or the arched bridge deck);
 *          circle push-out from the sakura trunks; kept inside the park.
 *  Camera  a smoothed pivot at shoulder height, over-the-shoulder offset,
 *          orbit yaw/pitch, zoom; never dips under the ground.
 *  `state` is plain data the followers read (no imports between them).
 */
export class Controller {
  constructor(camera, dom, actor, trees) {
    this.camera = camera;
    this.dom = dom;
    this.actor = actor;
    this.trunks = trees.placements.map((t) => ({ x: t.x, z: t.z, r: 0.42 * t.scale }));
    this.pos = actor.root.position.clone();
    this.vel = new Vector3();
    this.heading = actor.root.rotation.y;
    this.camYaw = this.heading;
    this.camPitch = CAMERA.pitch;
    this.zoom = CAMERA.distance;
    this.camDist = CAMERA.distance;
    this.pivot = new Vector3();
    this.keys = new Set();
    this.enabled = false; // owns the camera + reads input
    this.autopilot = null; // scripted walk ({ points, i, speed }) — see walkPath()
    this.locked = false; // cinematic: look around, no walking
    this.speed = 0;
    this.fovBase = camera.fov;
    this.state = { position: this.pos, heading: 0, speed: 0 };
    this.bind();
  }

  bind() {
    const dom = this.dom;
    this._down = (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (this.enabled && /^(Arrow|Space)/.test(e.code)) e.preventDefault();
    };
    this._up = (e) => this.keys.delete(e.code);
    this._blur = () => this.keys.clear();
    this._move = (e) => {
      if (!this.enabled) return;
      if (document.pointerLockElement === dom) this.look(e.movementX, e.movementY);
      else if (this.dragging) this.look(e.movementX * 1.4, e.movementY * 1.4);
    };
    this._mdown = (e) => {
      if (!this.enabled) return;
      this.dragging = true;
      if (document.pointerLockElement !== dom && e.button === 0) dom.requestPointerLock?.()?.catch?.(() => {});
    };
    this._mup = () => (this.dragging = false);
    this._wheel = (e) => (this.zoom = clamp(this.zoom + e.deltaY * 0.004, CAMERA.minDistance, CAMERA.maxDistance));
    // touch: one-finger drag looks around
    this._tstart = (e) => (this.lastTouch = e.touches[0] && { x: e.touches[0].clientX, y: e.touches[0].clientY });
    this._tmove = (e) => {
      const t = e.touches[0];
      if (!t || !this.lastTouch) return;
      this.look((t.clientX - this.lastTouch.x) * 2, (t.clientY - this.lastTouch.y) * 2);
      this.lastTouch = { x: t.clientX, y: t.clientY };
    };
    addEventListener('keydown', this._down);
    addEventListener('keyup', this._up);
    addEventListener('blur', this._blur);
    document.addEventListener('mousemove', this._move);
    dom.addEventListener('mousedown', this._mdown);
    addEventListener('mouseup', this._mup);
    dom.addEventListener('wheel', this._wheel, { passive: true });
    dom.addEventListener('touchstart', this._tstart, { passive: true });
    dom.addEventListener('touchmove', this._tmove, { passive: true });
  }

  look(dx, dy) {
    if (!this.enabled) return;
    this.camYaw -= dx * CAMERA.sensitivity;
    this.camPitch = clamp(this.camPitch + dy * CAMERA.sensitivity, CAMERA.minPitch, CAMERA.maxPitch);
  }

  /**
   * Walk him along `points` (Vector3[]) at `speed`; resolves when he has
   * arrived at the last one — where he then stays put (anchored for the acts
   * that follow) until something else moves him.
   */
  walkPath(points, speed = 1.3) {
    this.pos.copy(this.actor.root.position);
    this.heading = this.actor.root.rotation.y;
    return new Promise((resolve) => {
      this.autopilot = { points, i: 0, speed, reach: 0.9, resolve };
    });
  }

  /** Take over from wherever the cinematic camera is, without a jump. */
  takeOver() {
    this.pos.copy(this.actor.root.position);
    this.heading = this.actor.root.rotation.y;
    const c = this.camera.position;
    this.pivot.set(this.pos.x, this.pos.y + CAMERA.pivotHeight, this.pos.z);
    _d.subVectors(c, this.pivot);
    this.camYaw = Math.atan2(-_d.x, -_d.z);
    this.camPitch = clamp(Math.atan2(_d.y, Math.hypot(_d.x, _d.z)), CAMERA.minPitch, CAMERA.maxPitch);
    this.camDist = this.zoom = clamp(_d.length(), CAMERA.minDistance, CAMERA.maxDistance);
    this.enabled = true;
  }

  update(dt) {
    const k = this.keys;
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const side = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const run = k.has('ShiftLeft') || k.has('ShiftRight');
    const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
    let wx = fx * fwd - fz * side, wz = fz * fwd + fx * side;
    let wl = Math.hypot(wx, wz);
    let active = this.enabled && !this.locked && wl > 0;
    let target = active ? (run ? CONTROLLER.runSpeed : CONTROLLER.walkSpeed) : 0;
    const ap = this.autopilot;
    if (ap) {
      // scripted walk: head for the current waypoint; advance through the queue;
      // at the LAST one ease to a stop and hold there (no wrap-around, no snapping)
      let p = ap.points[ap.i];
      let dx = p.x - this.pos.x, dz = p.z - this.pos.z, d = Math.hypot(dx, dz);
      while (d < ap.reach && ap.i < ap.points.length - 1) {
        ap.i++;
        p = ap.points[ap.i];
        dx = p.x - this.pos.x;
        dz = p.z - this.pos.z;
        d = Math.hypot(dx, dz);
      }
      const last = ap.i === ap.points.length - 1;
      if (last && d < 0.06) {
        this.autopilot = null;
        this.vel.set(0, 0, 0);
        ap.resolve?.();
        active = false;
        target = 0;
        wl = 0;
      } else {
        wx = dx / d;
        wz = dz / d;
        wl = 1;
        active = true;
        target = ap.speed * (last ? Math.min(1, d / 1.4) : 1);
      }
    }
    if (wl > 0 && !ap) {
      wx /= wl;
      wz /= wl;
    }
    const a = damp(active ? CONTROLLER.accel : CONTROLLER.friction, dt);
    this.vel.x += ((active ? wx * target : 0) - this.vel.x) * a;
    this.vel.z += ((active ? wz * target : 0) - this.vel.z) * a;
    if (!active && Math.hypot(this.vel.x, this.vel.z) < 0.04) this.vel.x = this.vel.z = 0;
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    if (this.speed > 0.15) this.heading += angleDelta(this.heading, Math.atan2(this.vel.x, this.vel.z)) * damp(CONTROLLER.turnRate, dt);

    const px = this.pos.x, pz = this.pos.z;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    if (this.inWater(this.pos.x, this.pos.z)) {
      // slide along the bank: keep whichever axis stays dry
      if (!this.inWater(this.pos.x, pz)) this.pos.z = pz;
      else if (!this.inWater(px, this.pos.z)) this.pos.x = px;
      else this.pos.set(px, this.pos.y, pz);
    }
    this.collide();
    this.pos.y = walkHeight(this.pos.x, this.pos.z);

    const r = this.actor.root;
    r.position.copy(this.pos);
    r.rotation.y = this.heading;
    this.actor.speed = this.speed;
    this.state.heading = this.heading;
    this.state.speed = this.speed;
    if (this.enabled) this.updateCamera(dt);
  }

  inWater(x, z) {
    return distToStream(x, z) < STREAM.halfWidth + 0.5 && bridgeDeck(x, z) === -Infinity;
  }

  collide() {
    const R = CONTROLLER.radius;
    for (const t of this.trunks) {
      const dx = this.pos.x - t.x, dz = this.pos.z - t.z;
      const min = R + t.r;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-8) {
        const d = Math.sqrt(d2);
        this.pos.x = t.x + (dx / d) * min;
        this.pos.z = t.z + (dz / d) * min;
      }
    }
    // stay in the park: a soft wall a little beyond the forest edge
    const lim = PARK.forestWidth + 6;
    const dl = distToLane(this.pos.x, this.pos.z);
    if (dl > lim) {
      this.pos.x -= this.vel.x * 0.02 * (dl - lim);
      this.pos.z -= this.vel.z * 0.02 * (dl - lim);
      this.vel.multiplyScalar(0.5);
    }
  }

  updateCamera(dt) {
    _look.set(this.pos.x, this.pos.y + CAMERA.pivotHeight, this.pos.z);
    this.pivot.lerp(_look, damp(CAMERA.follow, dt));
    const pitch = this.camPitch, yaw = this.camYaw;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const f = { x: Math.sin(yaw), z: Math.cos(yaw) };
    const right = { x: -f.z, z: f.x };
    _d.set(-f.x * cp, sp, -f.z * cp); // pivot → camera
    this.camDist += (this.zoom - this.camDist) * damp(4, dt);
    _cam.copy(this.pivot).addScaledVector(_d, this.camDist);
    _cam.x += right.x * CAMERA.shoulder;
    _cam.z += right.z * CAMERA.shoulder;
    _cam.y = Math.max(_cam.y, walkHeight(_cam.x, _cam.z) + 0.35);
    this.camera.position.copy(_cam);
    _look.copy(this.pivot);
    _look.x += right.x * CAMERA.shoulder + f.x * 1.2;
    _look.z += right.z * CAMERA.shoulder + f.z * 1.2;
    _look.y -= 0.15;
    this.camera.lookAt(_look);
    const brisk = clamp((this.speed - CONTROLLER.walkSpeed) / (CONTROLLER.runSpeed - CONTROLLER.walkSpeed), 0, 1);
    const fov = this.fovBase + brisk * 4;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = lerp(this.camera.fov, fov, damp(5, dt));
      this.camera.updateProjectionMatrix();
    }
  }

  dispose() {
    removeEventListener('keydown', this._down);
    removeEventListener('keyup', this._up);
    removeEventListener('blur', this._blur);
    document.removeEventListener('mousemove', this._move);
    this.dom.removeEventListener('mousedown', this._mdown);
    removeEventListener('mouseup', this._mup);
    this.dom.removeEventListener('wheel', this._wheel);
    this.dom.removeEventListener('touchstart', this._tstart);
    this.dom.removeEventListener('touchmove', this._tmove);
  }
}
