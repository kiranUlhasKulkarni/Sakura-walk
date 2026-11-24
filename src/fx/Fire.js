import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, NormalBlending, PointLight, Points, ShaderMaterial, Vector3 } from 'three';
import { parkUniforms } from '../core/uniforms.js';
import { mulberry32 } from '../utils/math.js';

const FLAMES = 6000;
const SMOKE = 1400;

/**
 * Real-time fire: GPU sprite flames + soft smoke, fed by emitters.
 *
 * Each particle is written once at birth (origin, velocity, birth time,
 * life, size, seed) into a ring buffer; its whole life is evaluated in the
 * vertex shader — buoyant rise, flicker-turbulence, cooling colour ramp
 * (white-hot core → yellow → orange → deep red → gone) — like the
 * fireworks project's ParticlePool. Flames are additive HDR (they bloom);
 * smoke is alpha-blended, grows, drifts with the wind and darkens the glow
 * behind it. A few point lights flicker with each emitter group so the fire
 * really lights its surroundings (created at start-up, so the extra lights
 * are compiled into every shader before the show).
 *
 * Emitters: { pos: Vector3, dir: Vector3, rate, speed, spread, size, life,
 *            smoke (0..1), light (index or -1), on: bool }
 */
export class Fire {
  constructor(scene, { lights = 2 } = {}) {
    this.scene = scene;
    this.emitters = [];
    this.rnd = mulberry32(1234);
    this.flame = this.pool(FLAMES, this.flameMaterial());
    this.smoke = this.pool(SMOKE, this.smokeMaterial());
    this.smoke.points.renderOrder = 4;
    this.flame.points.renderOrder = 5;
    scene.add(this.smoke.points, this.flame.points);
    this.lights = Array.from({ length: lights }, () => {
      const l = new PointLight(new Color(1.0, 0.55, 0.2), 0, 16, 1.6);
      l.position.set(0, -100, 0);
      scene.add(l);
      return { light: l, level: 0, target: 0, pos: new Vector3() };
    });
    this.time = 0;
  }

  pool(n, material) {
    const g = new BufferGeometry();
    const attrs = {
      position: new BufferAttribute(new Float32Array(n * 3), 3), // origin
      aVel: new BufferAttribute(new Float32Array(n * 3), 3),
      aBirth: new BufferAttribute(new Float32Array(n).fill(-1e6), 1),
      aMisc: new BufferAttribute(new Float32Array(n * 4), 4), // life, size, seed, heat
    };
    for (const [k, a] of Object.entries(attrs)) g.setAttribute(k, a);
    g.boundingSphere = null;
    const points = new Points(g, material);
    points.frustumCulled = false;
    return { n, cursor: 0, attrs, points, dirty: false };
  }

  spawn(pool, origin, vel, life, size, heat = 1) {
    const i = pool.cursor;
    pool.cursor = (pool.cursor + 1) % pool.n;
    const a = pool.attrs;
    a.position.setXYZ(i, origin.x, origin.y, origin.z);
    a.aVel.setXYZ(i, vel.x, vel.y, vel.z);
    a.aBirth.setX(i, this.time);
    a.aMisc.setXYZW(i, life, size, this.rnd(), heat);
    pool.dirty = true;
  }

  add(emitter) {
    const e = { rate: 120, speed: 1.2, spread: 0.35, size: 0.35, life: 0.9, smoke: 0.25, light: -1, on: true, acc: 0, intensity: 1, ...emitter };
    e.pos = e.pos.clone();
    e.dir = (e.dir ?? new Vector3(0, 1, 0)).clone().normalize();
    this.emitters.push(e);
    return e;
  }

  remove(e) {
    this.emitters.splice(this.emitters.indexOf(e), 1);
  }

  /** `camera` + `heightPx` (drawing-buffer height) give sprites their true world size. */
  update(dt, camera = null, heightPx = 1000) {
    this.time += dt;
    const r = this.rnd, v = new Vector3(), o = new Vector3(), side = new Vector3();
    for (const L of this.lights) L.target = 0;
    const lightAcc = this.lights.map(() => ({ sum: new Vector3(), n: 0, power: 0 }));
    for (const e of this.emitters) {
      if (!e.on) continue;
      e.acc += e.rate * dt * e.intensity;
      while (e.acc >= 1) {
        e.acc -= 1;
        // a random direction inside the emitter's cone
        side.set(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(2 * e.spread);
        v.copy(e.dir).add(side).normalize().multiplyScalar(e.speed * (0.65 + r() * 0.7));
        o.copy(e.pos).add(new Vector3((r() - 0.5) * e.size * 0.6, (r() - 0.5) * e.size * 0.2, (r() - 0.5) * e.size * 0.6));
        this.spawn(this.flame, o, v, e.life * (0.7 + r() * 0.6), e.size * (0.6 + r() * 0.8), e.heat ?? 1);
        if (r() < e.smoke) {
          v.multiplyScalar(0.35).add(new Vector3(0, 0.6, 0));
          this.spawn(this.smoke, o.addScaledVector(e.dir, e.speed * e.life * 0.6), v, 2.6 + r() * 1.8, e.size * (1.4 + r()));
        }
      }
      if (e.light >= 0 && lightAcc[e.light]) {
        const L = lightAcc[e.light];
        L.sum.add(e.pos);
        L.n++;
        L.power += (e.lightPower ?? 6) * e.intensity;
      }
    }
    this.lights.forEach((L, i) => {
      const acc = lightAcc[i];
      if (acc.n) L.pos.copy(acc.sum).divideScalar(acc.n).add(new Vector3(0, 0.6, 0));
      L.target = acc.power;
      L.level += (L.target - L.level) * Math.min(1, dt * 10);
      const t = this.time * 13 + i * 7;
      const flicker = 0.78 + 0.14 * Math.sin(t) + 0.08 * Math.sin(t * 2.7 + 1.1) + 0.06 * (r() - 0.5);
      L.light.position.copy(L.pos);
      L.light.intensity = L.level * flicker;
    });
    for (const p of [this.flame, this.smoke]) {
      if (!p.dirty) continue;
      for (const a of Object.values(p.attrs)) a.needsUpdate = true;
      p.dirty = false;
    }
    this.flame.points.material.uniforms.uTime.value = this.time;
    this.smoke.points.material.uniforms.uTime.value = this.time;
    // pixels per metre at 1 m distance: H / (2·tan(fov/2))
    const scale = camera ? heightPx / (2 * Math.tan((camera.fov * Math.PI) / 360)) : 1000;
    this.flame.points.material.uniforms.uScale.value = scale;
    this.smoke.points.material.uniforms.uScale.value = scale;
  }

  flameMaterial() {
    return new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 1000 }, uWind: parkUniforms.uWind },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uTime, uScale;
        uniform vec3 uWind;
        attribute vec3 aVel;
        attribute float aBirth;
        attribute vec4 aMisc; // life, size (world diameter, m), seed, heat
        varying float vK;
        varying float vSeed;
        varying float vNear;
        varying float vHeat;
        void main() {
          float age = uTime - aBirth;
          float k = age / aMisc.x;
          vK = k;
          vSeed = aMisc.z;
          if (k < 0.0 || k > 1.0) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); gl_PointSize = 0.0; return; }
          // the jet slows as it mixes with air; hot gas rises; a curl of turbulence
          vec3 p = position + aVel * (1.0 - exp(-age * 2.2)) / 2.2;
          p.y += 1.1 * age * age;
          float s = aMisc.z * 40.0;
          p += vec3(sin(age * 9.0 + s), 0.0, cos(age * 7.0 + s * 1.3)) * 0.08 * k;
          p += uWind * age * 0.25;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          // grows as it billows, then collapses as it burns out
          float size = aMisc.y * (0.6 + 1.0 * k) * (1.0 - smoothstep(0.75, 1.0, k));
          gl_PointSize = min(size * uScale / max(-mv.z, 0.2), 256.0);
          vNear = smoothstep(1.2, 3.5, -mv.z); // sprites right at the lens fade out instead of whiting out the frame
          vHeat = aMisc.w;
        }`,
      fragmentShader: /* glsl */ `
        varying float vK;
        varying float vSeed;
        varying float vNear;
        varying float vHeat;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float r = length(c) * 2.0;
          // ragged, flickering edge
          float a = smoothstep(1.0, 0.15, r + 0.15 * sin(atan(c.y, c.x) * 5.0 + vSeed * 30.0) * vK);
          // cooling ramp: white-hot → yellow → orange → deep red
          vec3 col = mix(vec3(4.0, 3.4, 2.4), vec3(3.0, 1.6, 0.35), smoothstep(0.0, 0.25, vK));
          col = mix(col, vec3(1.8, 0.55, 0.12), smoothstep(0.25, 0.55, vK));
          col = mix(col, vec3(0.5, 0.08, 0.03), smoothstep(0.55, 0.95, vK));
          float fade = (1.0 - smoothstep(0.6, 1.0, vK)) * smoothstep(0.0, 0.05, vK);
          gl_FragColor = vec4(col * a * fade * 0.28 * vNear * vHeat, 1.0);
        }`,
    });
  }

  smokeMaterial() {
    return new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 1000 }, uWind: parkUniforms.uWind, uNight: parkUniforms.uNight },
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      vertexShader: /* glsl */ `
        uniform float uTime, uScale;
        uniform vec3 uWind;
        attribute vec3 aVel;
        attribute float aBirth;
        attribute vec4 aMisc;
        varying float vK;
        varying float vSeed;
        void main() {
          float age = uTime - aBirth;
          float k = age / aMisc.x;
          vK = k;
          vSeed = aMisc.z;
          if (k < 0.0 || k > 1.0) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); gl_PointSize = 0.0; return; }
          vec3 p = position + aVel * age + uWind * age * 0.7;
          p += vec3(sin(age * 1.3 + aMisc.z * 20.0), 0.0, cos(age * 1.1 + aMisc.z * 13.0)) * 0.25 * k;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = min(aMisc.y * (0.6 + 1.8 * k) * uScale / max(-mv.z, 0.2), 320.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uNight;
        varying float vK;
        varying float vSeed;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float r = length(c) * 2.0;
          float puff = smoothstep(1.0, 0.0, r) * (0.75 + 0.25 * sin(atan(c.y, c.x) * 3.0 + vSeed * 20.0));
          float a = puff * smoothstep(0.0, 0.15, vK) * (1.0 - smoothstep(0.4, 1.0, vK)) * 0.16;
          vec3 col = mix(vec3(0.16, 0.13, 0.15), vec3(0.05, 0.045, 0.06), uNight);
          gl_FragColor = vec4(col, a);
        }`,
    });
  }

  dispose() {
    for (const p of [this.flame, this.smoke]) {
      p.points.removeFromParent();
      p.points.geometry.dispose();
      p.points.material.dispose();
    }
    for (const L of this.lights) L.light.removeFromParent();
  }
}
