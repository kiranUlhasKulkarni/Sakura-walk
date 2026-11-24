import { BufferAttribute, BufferGeometry, DoubleSide, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, UniformsLib, UniformsUtils, Vector3 } from 'three';
import { PETALS } from '../config.js';
import { GLSL_LAMPS, parkUniforms } from '../core/uniforms.js';
import { GLSL_HASH } from '../shaders/common.js';
import { mulberry32 } from '../utils/math.js';

/** A single sakura petal: a cupped, gently bent strip; base at v = 0, notched tip at v = 1. */
function petalGeometry() {
  const nx = 2, ny = 4;
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= ny; j++)
    for (let i = 0; i <= nx; i++) {
      const u = i / nx, v = j / ny, x = u - 0.5;
      pos.push(x * 0.72, v, 0.22 * x * x * 4 * 0.25 + 0.14 * v * v); // cupped across, bent along
      uv.push(u, v);
    }
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + nx + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  return g;
}

/**
 * GPU sakura petal storm. One draw call: every petal is an instance whose
 * whole life is evaluated analytically in the vertex shader. Each petal lives
 * PETALS.life seconds, dissolves (dithered fade, no sorting needed) and is
 * re-born at a fresh random spot, so the air stays full but never repeats or
 * clumps; petals also thin out near the lens so close-ups stay clean —
 *   fall (terminal velocity per petal) + wind drift (integrated on the CPU in
 *   Wind.js) + flutter (the side-to-side "falling leaf" rock) + tumble about a
 *   random axis, wrapped in a box that follows the camera's focus so the
 *   storm is endless (the infinite-wrap trick from infinity-castle's embers).
 * Shading: two-sided, translucent when back-lit by the sun/moon, lit by the
 * lantern field, with the real petal silhouette (narrow base, notched tip)
 * cut out by alpha-test (no sorting, MSAA-friendly).
 */
export class Petals {
  constructor(scene, count = PETALS.count) {
    const base = petalGeometry();
    const geo = new InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    geo.instanceCount = count;

    const rnd = mulberry32(4242);
    const seed = new Float32Array(count * 4), axis = new Float32Array(count * 3), misc = new Float32Array(count * 4), life = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      seed.set([rnd(), rnd(), rnd(), rnd()], i * 4);
      const a = new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
      axis.set([a.x, a.y, a.z], i * 3);
      const size = PETALS.size[0] + (PETALS.size[1] - PETALS.size[0]) * rnd();
      const fall = PETALS.fallSpeed[0] + (PETALS.fallSpeed[1] - PETALS.fallSpeed[0]) * rnd();
      const spin = (rnd() < 0.3 ? 4 + rnd() * 6 : 0.6 + rnd() * 1.6) * (rnd() < 0.5 ? -1 : 1); // 30 % tumblers, the rest rock
      misc.set([size, fall, spin, rnd()], i * 4);
      life[i] = PETALS.life[0] + (PETALS.life[1] - PETALS.life[0]) * rnd();
    }
    geo.setAttribute('aSeed', new InstancedBufferAttribute(seed, 4));
    geo.setAttribute('aAxis', new InstancedBufferAttribute(axis, 3));
    geo.setAttribute('aMisc', new InstancedBufferAttribute(misc, 4));
    geo.setAttribute('aLife', new InstancedBufferAttribute(life, 1));
    this.base = base;

    this.uniforms = {
      ...UniformsUtils.clone(UniformsLib.fog),
      uTime: parkUniforms.uTime,
      uGust: parkUniforms.uGust,
      uNight: parkUniforms.uNight,
      uAmbient: parkUniforms.uAmbient,
      uSunDir: parkUniforms.uSunDir,
      uSunCol: parkUniforms.uSunCol,
      uLampPos: parkUniforms.uLampPos,
      uLampCol: parkUniforms.uLampCol,
      uDrift: { value: new Vector3() },
      uFocus: { value: new Vector3() },
      uBox: { value: new Vector3(...PETALS.box) },
      uDensity: { value: 1 }, // 0..1 fraction of petals alive (Act IV can thin / thicken the storm)
      uNearFade: { value: new Vector3(PETALS.nearFade[0], PETALS.nearFade[1], 0) },
    };

    this.material = new ShaderMaterial({
      uniforms: this.uniforms,
      side: DoubleSide,
      fog: true,
      vertexShader: /* glsl */ `
        #include <common>
        #include <fog_pars_vertex>
        uniform float uTime, uGust, uDensity;
        uniform vec3 uDrift, uFocus, uBox;
        attribute vec4 aSeed;
        attribute vec3 aAxis;
        attribute vec4 aMisc; // size, fall speed, spin, tint
        attribute float aLife; // seconds visible per cycle
        uniform vec3 uNearFade;
        varying float vFade;
        varying float vDither;
        varying vec2 vUv;
        varying vec3 vNormalW;
        varying vec3 vWorld;
        varying float vTint;

        mat3 axisAngle(vec3 a, float t) {
          float s = sin(t), c = cos(t), oc = 1.0 - c;
          return mat3(oc * a.x * a.x + c, oc * a.x * a.y + a.z * s, oc * a.z * a.x - a.y * s,
                      oc * a.x * a.y - a.z * s, oc * a.y * a.y + c, oc * a.y * a.z + a.x * s,
                      oc * a.z * a.x + a.y * s, oc * a.y * a.z - a.x * s, oc * a.z * a.z + c);
        }

        void main() {
          vUv = uv;
          vTint = aMisc.w;
          float size = aMisc.x, fall = aMisc.y, spin = aMisc.z;
          float t = uTime + aSeed.w * 100.0;

          // life cycle: each petal lives aLife seconds, dissolves, and is re-born somewhere new
          float age = uTime / aLife + aSeed.w * 7.0;
          float cyc = floor(age), ph = fract(age);
          vec3 rs = fract(aSeed.xyz + cyc * vec3(0.6180339, 0.4142136, 0.7320508));
          // where the petal is in its fall
          float y = uBox.y - mod(rs.y * uBox.y + uTime * fall, uBox.y);
          vec3 c = vec3(rs.x * uBox.x, y, rs.z * uBox.z);
          c.xz += uDrift.xz * (0.75 + aSeed.w * 0.5);                 // carried by the breeze
          float w1 = 0.7 + aSeed.x * 1.3, w2 = 1.1 + aSeed.z * 1.7;
          c.x += sin(t * w1) * 0.55 + sin(t * w2 * 2.3) * 0.12;        // flutter
          c.z += cos(t * w1 * 0.8 + 1.3) * 0.45;
          c.y += sin(t * w1 * 2.0) * 0.08 * (1.0 + uGust);              // little lifts on the swing
          c.xz += vec2(sin(t * 0.37 + aSeed.y * 9.0), cos(t * 0.29 + aSeed.x * 7.0)) * uGust * 1.4; // gust eddies
          // wrap into the box around the focus point (xz only; y is the fall)
          vec2 h = uBox.xz * 0.5;
          c.xz = mod(c.xz - uFocus.xz + h, uBox.xz) - h + uFocus.xz;

          // dissolve in / out over the cycle, settle out on the grass, thin out near the lens
          float life = smoothstep(0.0, 0.5, c.y) * smoothstep(uBox.y, uBox.y - 2.5, c.y);
          float camD = distance(c, cameraPosition);
          vFade = smoothstep(0.0, 0.18, ph) * (1.0 - smoothstep(0.72, 1.0, ph)) * smoothstep(uNearFade.x, uNearFade.y, camD) * life;
          vDither = fract(aSeed.x * 91.7 + aSeed.z * 13.3);
          float alive = step(aSeed.w, uDensity) * step(0.01, vFade);
          float s = size * alive * mix(0.6, 1.0, vFade);

          // orientation: rocking "falling leaf" + tumble
          float rock = sin(t * w1 * 1.6) * 0.9;
          mat3 R = axisAngle(aAxis, t * spin) * axisAngle(vec3(0.0, 0.0, 1.0), rock);
          vec3 p = R * (position - vec3(0.0, 0.5, 0.0)) * s;
          vNormalW = normalize(R * vec3(0.0, 0.0, 1.0));
          vec3 wp = c + p;
          vWorld = wp;
          vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
          // don't let petals smear across the lens
          if (-mvPosition.z < 0.35) mvPosition.xyz = vec3(0.0, 0.0, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <fog_pars_fragment>
        uniform vec3 uAmbient, uSunDir, uSunCol;
        uniform float uNight;
        ${GLSL_LAMPS}
        varying vec2 vUv;
        varying vec3 vNormalW;
        varying vec3 vWorld;
        varying float vTint;
        varying float vFade;
        varying float vDither;
        void main() {
          // organic fade without sorting: dithered opacity (interleaved gradient noise + a per-petal offset)
          float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + vDither);
          if (ign > vFade) discard;
          // silhouette: narrow claw at the base, broad body, V-notch at the tip
          float v = vUv.y, x = abs(vUv.x - 0.5);
          float w = 0.5 * pow(sin(3.14159 * clamp(v * 0.62 + 0.06, 0.0, 1.0)), 0.75);
          w *= 1.0 - smoothstep(0.82, 1.0, v) * 0.35;
          if (x > w) discard;
          if (v > 0.86 + x * 1.15) discard; // notch

          vec3 pinkBody = mix(vec3(1.0, 0.72, 0.8), vec3(1.0, 0.86, 0.9), vTint);
          vec3 col = mix(vec3(1.0, 0.94, 0.9), pinkBody, smoothstep(0.0, 0.35, v));      // pale at the claw
          col = mix(col, vec3(0.98, 0.55, 0.68), smoothstep(0.75, 1.0, v) * 0.45);          // blush toward the tip
          col *= 0.92 + 0.08 * sin(x * 60.0);                                                // faint veins

          vec3 n = normalize(vNormalW);
          vec3 V = normalize(cameraPosition - vWorld);
          if (dot(n, V) < 0.0) n = -n;
          vec3 L = normalize(uSunDir);
          float diff = max(dot(n, L), 0.0);
          float trans = pow(max(dot(-V, L), 0.0), 3.0) * 0.8 + max(dot(-n, L), 0.0) * 0.35;   // light through the petal
          vec3 light = uAmbient * 1.7 + uSunCol * (diff * 0.7 + trans) + lampLight(vWorld, n, 0.6) * 1.4;
          vec3 outCol = col * light;
          gl_FragColor = vec4(outCol, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });

    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  /** `focus`: point the storm is centred on (usually a few metres in front of the camera). */
  update(focus, drift) {
    this.uniforms.uFocus.value.copy(focus);
    this.uniforms.uDrift.value.copy(drift);
  }

  set density(v) {
    this.uniforms.uDensity.value = v;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.base.dispose();
    this.material.dispose();
  }
}
