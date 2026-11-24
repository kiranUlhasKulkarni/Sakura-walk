import { Vector3 } from 'three';
import { WIND } from '../config.js';
import { parkUniforms } from '../core/uniforms.js';
import { mulberry32 } from '../utils/math.js';

/**
 * The park's breeze: a steady drift plus gust swells every ~WIND.gustEvery s.
 * Drives parkUniforms.uGust (tree sway) and integrates `drift` — the total
 * distance the air has carried a petal so far — so a gust speeds petals up
 * smoothly instead of teleporting them (a shader using wind × time would jump
 * whenever the wind changed).
 */
export class Wind {
  constructor() {
    this.rnd = mulberry32(77);
    this.base = new Vector3(...WIND.dir).normalize();
    this.drift = new Vector3();
    this.gust = 0;
    this.gustT = 0; // time since the current gust started
    this.nextGust = 4;
    this.gustLen = 4;
    this.gustPeak = 1;
    this.forced = 0; // extra one-off swell (e.g. a dramatic camera beat)
  }

  /** A one-off strong gust (0..1+), e.g. when the dragon roars. */
  burst(strength = 1) {
    this.forced = Math.max(this.forced, strength);
  }

  update(dt) {
    this.nextGust -= dt;
    if (this.nextGust <= 0) {
      this.gustT = 0;
      this.gustLen = 3 + this.rnd() * 3;
      this.gustPeak = 0.5 + this.rnd() * 0.5;
      this.nextGust = WIND.gustEvery * (0.6 + this.rnd() * 0.8) + this.gustLen;
    }
    this.gustT += dt;
    const k = Math.min(1, this.gustT / this.gustLen);
    const swell = this.gustT < this.gustLen ? Math.sin(Math.PI * k) ** 2 * this.gustPeak : 0;
    this.forced = Math.max(0, this.forced - dt * 0.45);
    this.gust = Math.max(swell, this.forced);
    parkUniforms.uGust.value = this.gust;
    const speed = WIND.speed * (1 + this.gust * WIND.gustStrength);
    parkUniforms.uWind.value.copy(this.base).multiplyScalar(speed);
    this.drift.addScaledVector(this.base, speed * dt);
  }
}
