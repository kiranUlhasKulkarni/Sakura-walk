import { Color, DirectionalLight, Vector3 } from 'three';
import { mulberry32 } from '../../utils/math.js';
import { Flashes } from './flash.js';
import { SHOW } from './palette.js';
import { ParticlePool } from './ParticlePool.js';
import { evalTrajectory, solveLaunchVelocity } from './physics.js';
import { createSmokeMaterial, createSparkMaterial, fireworkUniforms, KIND } from './shaders.js';
import { burstShell, emitFlash, emitStar, letterBurst, spawnPuff } from './shells.js';
import { textDots } from './textDots.js';
import { makePuffTexture } from './textures.js';

const ROCKET_GOLD = [1.0, 0.68, 0.32];
const TRAIL_GOLD = [1.0, 0.58, 0.24];
const SKY_DIR = new Vector3(-0.1, 0, -1).normalize(); // from the plaza toward the mountain: the open sky
const TYPES = [
  ['peony', 3], ['chrysanthemum', 3], ['willow', 1.5], ['ring', 1.2], ['heart', 1], ['palm', 1], ['glitter', 1.5], ['kamuro', 0.6],
];

/**
 * The night's fireworks — the fireworks project's engine, re-scaled for the
 * park: GPU ring-buffer particles (written once at birth, evaluated in the
 * shader), real shells with rockets, trails, embers, crackle and lit smoke,
 * and two park additions:
 *   • writeText()  rockets that burst into LETTERS which glide into place and
 *                  hang in the sky ("MARRY ME"),
 *   • auto(rate)   a continuous show over the open sky behind the plaza.
 * Bursts light the park: the strongest flash drives a coloured sky light (the
 * light exists from start-up, so no shader recompiles mid-show) and is
 * returned so the characters' rim and the grade can pick it up.
 */
export class Fireworks {
  constructor(scene, { sparks = 260_000, smoke = 16_000, origin = new Vector3() } = {}) {
    this.flashes = new Flashes();
    this.uniforms = fireworkUniforms(this.flashes.uniforms);
    this.puff = makePuffTexture();
    this.sparkMat = createSparkMaterial(this.uniforms);
    this.smokeMat = createSmokeMaterial(this.uniforms, this.puff);
    this.sparks = new ParticlePool(sparks, this.sparkMat);
    this.smoke = new ParticlePool(smoke, this.smokeMat);
    this.smoke.points.renderOrder = 10;
    this.sparks.points.renderOrder = 11;
    scene.add(this.smoke.points, this.sparks.points);
    this.rng = mulberry32(2026);
    this.ctx = { sparks: this.sparks, smoke: this.smoke, rng: this.rng, viewer: [0, 1.6, 0], flashes: this.flashes };
    this.origin = origin.clone(); // the audience (plaza centre)
    this.queue = []; // launches waiting: { at, shell }
    this.pending = []; // bursts waiting: { time, ... }
    this.time = 0;
    this.autoRate = 0;
    this.autoAcc = 0;
    this.v0 = [0, 0, 0];
    this.tmp = [0, 0, 0];
    // the sky lights up with every burst
    this.light = new DirectionalLight(new Color(1, 1, 1), 0);
    this.light.position.set(0, 60, -100);
    this.light.target.position.copy(this.origin);
    scene.add(this.light, this.light.target);
    this.level = 0;
    this.flashColor = new Color();
  }

  /** A point in the show's sky: `along` metres out toward the open sky, `across` to the side, `up` high. */
  skyPoint(along, across, up) {
    const side = new Vector3(-SKY_DIR.z, 0, SKY_DIR.x);
    return this.origin.clone().addScaledVector(SKY_DIR, along).addScaledVector(side, across).setY(up);
  }

  /**
   * Fire one shell: { type, pos: Vector3 (burst point), delay = 0, flight = 2.2,
   * scale = 1, colorA, colorB, pistil }.
   */
  fire(shell) {
    this.queue.push({ at: this.time + (shell.delay ?? 0), shell });
  }

  /** Several shells in one go, e.g. a salvo across the sky. */
  salvo(shells) {
    for (const s of shells) this.fire(s);
  }

  /**
   * Write a word in fire: one rocket per letter (left → right, `stagger` s
   * apart) bursting into the letter's dots on a plane facing the audience.
   * Returns the time (s) until the last letter has formed.
   */
  writeText(text, { center, height = 12, delay = 0, stagger = 0.22, flight = 2.4, hold = 6.5, colorA = 'gold', colorB = 'sakura' }) {
    const { letters } = textDots(text);
    const toView = this.origin.clone().sub(center).setY(0).normalize();
    const right = new Vector3(toView.z, 0, -toView.x); // the audience's right (they look along −toView)
    const world = ([x, y], out = new Vector3()) => out.copy(center).addScaledVector(right, x * height).add(new Vector3(0, y * height, 0));
    letters.forEach((L, i) => {
      const pos = world(L.center);
      // the stars sit a touch in front of the burst point, so the word reads flat-on
      const points = L.points.map((p) => world(p).addScaledVector(toView, 0.5).toArray());
      this.fire({ type: 'letter', pos, points, hold, colorA, colorB, flight, delay: delay + i * stagger, rocket: 1.25 });
    });
    return delay + (letters.length - 1) * stagger + flight + 1.2;
  }

  /**
   * Spark fountains (the festival stage's gerbs): `list` of { pos, out } spraying
   * gold sparks up and a little outward at `rate` sparks / s each (0 = off).
   */
  fountains(list, rate) {
    this.fountainList = list;
    this.fountainRate = rate;
    this.fountainAcc ??= 0;
  }

  sprayFountains(dt, time) {
    const list = this.fountainList, r = this.rng;
    if (!list?.length || !(this.fountainRate > 0)) return;
    this.fountainAcc += dt * this.fountainRate * list.length;
    const n = Math.floor(this.fountainAcc);
    this.fountainAcc -= n;
    const gold = [1.0, 0.62, 0.24], hot = [1.0, 0.85, 0.55];
    for (let i = 0; i < n; i++) {
      const f = list[Math.floor(r() * list.length)];
      const sp = 5.5 + r() * 3.5;
      emitStar(this.ctx, {
        p: f.pos.toArray(),
        v: [f.out.x * 1.3 + (r() - 0.5) * 1.6, sp, f.out.z * 1.3 + (r() - 0.5) * 1.6],
        birth: time - r() * dt,
        life: 0.9 + r() * 0.8,
        drag: 1.25,
        grav: 0.55,
        color: r() < 0.3 ? hot : gold,
        color2: [1.0, 0.35, 0.08],
        changeAt: 0.6,
        intensity: 3.2,
        size: 0.085 + r() * 0.05,
        freq: 12 + r() * 10,
        kind: r() < 0.18 ? KIND.STROBE : KIND.STAR,
      });
    }
  }

  /** A comic burst of glitter (a punch landing, stars round a dizzy head). */
  pop(pos, { color = [1.0, 0.86, 0.5], n = 26, speed = 2.6, size = 0.05 } = {}) {
    const r = this.rng;
    for (let i = 0; i < n; i++) {
      const u = r() * 2 - 1, a = r() * Math.PI * 2, q = Math.sqrt(1 - u * u), s = speed * (0.5 + r() * 0.7);
      emitStar(this.ctx, {
        p: pos.toArray(),
        v: [Math.cos(a) * q * s, u * s + 0.6, Math.sin(a) * q * s],
        birth: this.time,
        life: 0.35 + r() * 0.4,
        drag: 3.2,
        grav: 0.25,
        color: r() < 0.4 ? [1, 1, 1] : color,
        intensity: 4,
        size: size * (0.7 + r() * 0.6),
        freq: 14 + r() * 10,
        kind: r() < 0.35 ? KIND.STROBE : KIND.STAR,
      });
    }
  }

  /** Continuous show: `rate` shells per second over the open sky (0 = stop launching). */
  auto(rate) {
    this.autoRate = rate;
  }

  randomShell(delay = 0) {
    const r = this.rng;
    let sum = 0;
    for (const [, w] of TYPES) sum += w;
    let pick = r() * sum, type = 'peony';
    for (const [t, w] of TYPES) if ((pick -= w) <= 0) {
      type = t;
      break;
    }
    const colorA = SHOW[Math.floor(r() * SHOW.length)];
    const colorB = r() < 0.4 ? SHOW[Math.floor(r() * SHOW.length)] : null;
    this.fire({
      type,
      pos: this.skyPoint(95 + r() * 70, (r() - 0.5) * 150, 38 + r() * 40),
      flight: 1.8 + r() * 0.9,
      scale: 0.8 + r() * 0.45,
      colorA,
      colorB,
      pistil: SHOW[Math.floor(r() * SHOW.length)],
      delay,
    });
  }

  launch(shell, birth) {
    const { rng, ctx, tmp } = this;
    const target = shell.pos.toArray();
    const L = [target[0] + (rng() - 0.5) * 8, 0.5, target[2] + (rng() - 0.5) * 8];
    const k = 0.45, g = 1.0, T = shell.flight ?? 2.2;
    const v0 = solveLaunchVelocity(this.v0, L, target, k, g, T);
    const rs = shell.rocket ?? 1;
    // rocket head + streak
    emitStar(ctx, { p: L, v: v0, birth, life: T, drag: k, grav: g, color: ROCKET_GOLD, intensity: 5 * rs, size: 0.9 * rs, tails: 5, tailGap: 0.022, kind: KIND.ROCKET });
    // sparkling trail + a thin smoke column
    for (let t = 0.02; t < T; t += 0.03) {
      evalTrajectory(tmp, L, v0, k, g, t);
      tmp[0] += (rng() - 0.5) * 0.2;
      tmp[2] += (rng() - 0.5) * 0.2;
      emitStar(ctx, {
        p: tmp, v: [(rng() - 0.5) * 2.4, (rng() - 0.5) * 2.4 - 1, (rng() - 0.5) * 2.4],
        birth: birth + t, life: 0.35 + rng() * 0.6, drag: 2.0, grav: 0.4,
        color: TRAIL_GOLD, intensity: 2.2, size: 0.32 * rs, freq: 25, kind: KIND.EMBER,
      });
    }
    for (let t = 0.05; t < T; t += 0.18) {
      evalTrajectory(tmp, L, v0, k, g, t);
      spawnPuff(ctx, tmp, birth + t, { size: 1.6, growth: 0.6, life: 3 + rng() * 1.5, tint: TRAIL_GOLD, glow: 0.25, alpha: 0.1, spread: 0.5 });
    }
    emitFlash(ctx, L, birth, ROCKET_GOLD, 3, 1.5, 0.15);
    this.pending.push({ ...shell, time: birth + T, pos: evalTrajectory([0, 0, 0], L, v0, k, g, T), scale: shell.scale ?? 1 });
  }

  /**
   * @returns the strongest flash this frame { color, level, pos } — the app
   * feeds it to the characters' rim light and the grade.
   */
  update(dt, time, camera, widthPx, heightPx, fogDensity = 0.012) {
    this.time = time;
    this.ctx.viewer[0] = camera.position.x;
    this.ctx.viewer[1] = camera.position.y;
    this.ctx.viewer[2] = camera.position.z;
    if (this.autoRate > 0) {
      this.autoAcc += dt * this.autoRate;
      while (this.autoAcc >= 1) {
        this.autoAcc -= 1 + (this.rng() - 0.5) * 0.6; // irregular, like a real show
        this.randomShell(this.rng() * 0.3);
        if (this.rng() < 0.15) this.randomShell(0.15 + this.rng() * 0.3); // a doubled shot now and then
      }
    }
    this.sprayFountains(dt, time);
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const q = this.queue[i];
      if (q.at <= time) {
        this.queue.splice(i, 1);
        this.launch(q.shell, q.at);
      }
    }
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const b = this.pending[i];
      if (b.time <= time) {
        this.pending.splice(i, 1);
        if (b.type === 'letter') letterBurst(this.ctx, b);
        else burstShell(this.ctx, b);
      }
    }
    const u = this.uniforms;
    u.uScale.value = heightPx / (2 * Math.tan((camera.fov * Math.PI) / 360));
    u.uResolution.value.set(widthPx, heightPx);
    u.uFogDensity.value = fogDensity * 0.45; // the show is far away; the park's fog would swallow it
    const st = this.flashes.update(time);
    this.level += (st.level - this.level) * Math.min(1, dt * 20);
    this.flashColor.copy(st.color);
    this.light.color.copy(st.color).lerp(new Color(1, 1, 1), 0.25);
    this.light.intensity = this.level * 1.6;
    this.light.position.copy(st.pos);
    this.sparks.flush();
    this.smoke.flush();
    return { color: this.flashColor, level: this.level, pos: st.pos };
  }

  /** Stop everything (scheduled and airborne): used when the story jumps. */
  clear() {
    this.queue.length = 0;
    this.pending.length = 0;
    this.autoRate = 0;
    this.fountainRate = 0;
  }

  dispose() {
    for (const p of [this.sparks, this.smoke]) {
      p.points.removeFromParent();
      p.dispose();
    }
    this.sparkMat.dispose();
    this.smokeMat.dispose();
    this.puff.dispose();
    this.light.removeFromParent();
    this.light.target.removeFromParent();
  }
}
