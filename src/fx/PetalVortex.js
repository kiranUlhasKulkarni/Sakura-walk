import { DoubleSide, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, NormalBlending, PlaneGeometry, ShaderMaterial, Vector3 } from 'three';
import { parkUniforms } from '../core/uniforms.js';
import { mulberry32 } from '../utils/math.js';

const COUNT = 7000; // instanced quads (one draw call): cheap even at this count

/**
 * The YES climax: a swirling vortex of cherry blossom petals rising around the
 * couple. Every petal's whole motion is analytic in the vertex shader — it
 * orbits the centre (faster near the middle), spirals upward, swells out as it
 * climbs, tumbles and flutters, and wraps from the top back to the bottom — so
 * the CPU only sets `amount` (0 = none … 1 = full storm) and the centre.
 * Petals are softly self-lit pinks pushed into HDR, so the bloom pass turns the
 * storm into a glowing pink-gold haze. Built (invisible, amount 0) at start-up
 * so its shader is compiled with everything else.
 */
export class PetalVortex {
  constructor(scene) {
    const base = new PlaneGeometry(1, 1);
    const g = new InstancedBufferGeometry();
    g.index = base.index;
    g.attributes.position = base.attributes.position;
    g.attributes.uv = base.attributes.uv;
    const rnd = mulberry32(509);
    // three depth layers, so the whole air fills: near (round the couple), mid (the plaza and the
    // dancers), far (the trees and the sky). Each petal: its orbit radius, its own ceiling, its size.
    const a = new Float32Array(COUNT * 4), b = new Float32Array(COUNT * 4), c = new Float32Array(COUNT * 2);
    for (let i = 0; i < COUNT; i++) {
      const L = rnd();
      const layer = L < 0.38 ? 0 : L < 0.74 ? 1 : 2;
      const r = layer === 0 ? 0.6 + Math.pow(rnd(), 0.7) * 4.5 : layer === 1 ? 5 + rnd() * 11 : 16 + rnd() * 24;
      const top = layer === 0 ? 7.5 : layer === 1 ? 15 : 28;
      const size = layer === 0 ? 0.022 + rnd() * 0.022 : layer === 1 ? 0.03 + rnd() * 0.03 : 0.05 + rnd() * 0.05;
      a.set([rnd() * Math.PI * 2, r, rnd(), 0.5 + rnd()], i * 4); // angle, radius, height phase, speed
      b.set([rnd() * 100, rnd(), size, rnd()], i * 4); // seed, tint, size, threshold (shows once amount passes it)
      c.set([top * (0.6 + 0.4 * rnd()), layer / 2], i * 2); // its ceiling (m), depth layer 0 / 0.5 / 1
    }
    g.setAttribute('aA', new InstancedBufferAttribute(a, 4));
    g.setAttribute('aB', new InstancedBufferAttribute(b, 4));
    g.setAttribute('aC', new InstancedBufferAttribute(c, 2));
    g.instanceCount = COUNT;
    this.uniforms = {
      uTime: parkUniforms.uTime,
      uCentre: { value: new Vector3() },
      uAmount: { value: 0 },
      uHeight: { value: 7.5 },
      uSpin: { value: 1 },
      uFlash: { value: new Vector3() }, // the fireworks' light, caught by the petals
    };
    this.material = new ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: NormalBlending,
      vertexShader: /* glsl */ `
        uniform float uTime, uAmount, uHeight, uSpin;
        uniform vec3 uCentre;
        attribute vec4 aA, aB;
        attribute vec2 aC;
        varying vec2 vUv;
        varying float vTint, vAlpha, vLayer;
        mat3 rot(vec3 ax, float a) {
          float s = sin(a), c = cos(a), o = 1.0 - c;
          return mat3(o*ax.x*ax.x + c, o*ax.x*ax.y + ax.z*s, o*ax.z*ax.x - ax.y*s,
                      o*ax.x*ax.y - ax.z*s, o*ax.y*ax.y + c, o*ax.y*ax.z + ax.x*s,
                      o*ax.z*ax.x + ax.y*s, o*ax.y*ax.z - ax.x*s, o*ax.z*ax.z + c);
        }
        void main() {
          vUv = uv;
          vTint = aB.y;
          vLayer = aC.y;
          float t = uTime;
          // climb: wraps from the ground to this petal's own ceiling (higher for the far layers)
          float h = fract(aA.z + t * (0.07 - 0.035 * aC.y) * aA.w);
          float y = h * aC.x * (uHeight / 7.5);
          // radius swells as it climbs, breathing a little
          float r = aA.y * (0.7 + 0.5 * h) * (1.0 + 0.1 * sin(t * 0.9 + aB.x));
          // orbit: faster near the centre (a real vortex)
          float ang = aA.x + t * uSpin * (1.6 / (0.5 + r)) * aA.w;
          vec3 p = uCentre + vec3(cos(ang) * r, y + 0.1, sin(ang) * r);
          p += vec3(sin(t * 2.1 + aB.x), sin(t * 1.7 + aB.x * 1.3) * 0.5, cos(t * 1.9 + aB.x)) * (0.18 + 0.6 * aC.y); // flutter (wider drift far out)
          // a tumbling petal-shaped card
          vec3 ax = normalize(vec3(sin(aB.x), 0.6, cos(aB.x * 1.7)));
          vec3 local = rot(ax, t * (2.0 + aA.w * 3.0) + aB.x) * vec3(position.x * 1.0, position.y * 0.62, 0.0) * aB.z * 2.0;
          // only part of the storm shows below full strength; fade at the bottom and the top
          vAlpha = step(aB.w, uAmount) * smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(0.82, 1.0, h));
          gl_Position = projectionMatrix * viewMatrix * vec4(p + local, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uFlash;
        varying vec2 vUv;
        varying float vTint, vAlpha, vLayer;
        void main() {
          // a sakura petal: a rounded teardrop with the little notch at its tip
          vec2 q = vUv - 0.5;
          q.y += 0.08;
          float d = length(q * vec2(1.25, 0.95));
          float notch = smoothstep(0.06, 0.0, abs(q.x)) * smoothstep(0.28, 0.42, q.y);
          float a = smoothstep(0.42, 0.36, d) * (1.0 - notch) * vAlpha;
          if (a < 0.02) discard;
          vec3 pink = mix(vec3(1.0, 0.36, 0.6), vec3(1.0, 0.62, 0.76), vTint);
          vec3 col = pink * (0.85 + 0.45 * smoothstep(0.3, 0.0, d)); // softly self-lit: a pink glow, not a white-out
          col *= mix(1.0, 0.72, vLayer);                              // the far ones a little dimmer, in the night air
          col += vec3(0.08, 0.1, 0.18) * vLayer;                      // …with a touch of moonlight
          col += uFlash * (0.25 + 0.35 * vLayer);                     // and the colour of each firework burst
          gl_FragColor = vec4(col, a * 0.92);
        }`,
    });
    this.mesh = new Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    scene.add(this.mesh);
  }

  set(centre, amount) {
    if (centre) this.uniforms.uCentre.value.copy(centre);
    this.uniforms.uAmount.value = amount;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
