import { BackSide, BufferAttribute, BufferGeometry, CylinderGeometry, DoubleSide, Mesh, ShaderMaterial, SphereGeometry } from 'three';
import { parkUniforms } from '../core/uniforms.js';
import { GLSL_HASH, GLSL_NOISE } from '../shaders/common.js';
import { disposeObject } from '../utils/dispose.js';

/**
 * Sky dome + the distant tree-line.
 *  • Dusk (uNight 0): indigo zenith → magenta → a hot peach glow on the western
 *    horizon where the sun has just set, thin lit cloud streaks, first stars.
 *  • Night (uNight 1): blue-black, a full moon with halo, dense twinkling stars
 *    (star field technique from infinity-castle's Atmosphere.js night sky).
 *  • A far ring of layered forest silhouettes (alpha-cut noise ridge) so the
 *    park reads as enclosed, fogged into the horizon colour.
 */
export class Sky {
  constructor(scene) {
    this.uniforms = parkUniforms;
    const sky = new Mesh(
      new SphereGeometry(800, 48, 24),
      new ShaderMaterial({
        uniforms: parkUniforms,
        side: BackSide,
        depthWrite: false,
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
            gl_Position.z = gl_Position.w;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uTime, uNight;
          uniform vec3 uSunDir;
          varying vec3 vDir;
          ${GLSL_HASH}
          ${GLSL_NOISE}
          const vec3 SUN = normalize(vec3(-0.82, 0.07, -0.56));
          const vec3 MOON = normalize(vec3(0.45, 0.52, -0.72));
          vec3 duskSky(vec3 d) {
            // painterly pastel twilight: pale rose at the horizon, lilac above, a soft
            // milky glow where the sun has gone, cotton clouds blushing pink
            float h = d.y;
            float toSun = max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(SUN.x, 0.0, SUN.z))), 0.0);
            vec3 zenith = vec3(0.34, 0.33, 0.58);
            vec3 mid = vec3(0.78, 0.62, 0.82);
            vec3 low = mix(vec3(0.98, 0.8, 0.86), vec3(1.15, 0.9, 0.86), pow(toSun, 3.0));
            vec3 col = mix(low, mid, smoothstep(0.0, 0.22, h));
            col = mix(col, zenith, smoothstep(0.2, 0.85, h));
            col += vec3(1.0, 0.86, 0.8) * pow(toSun, 8.0) * exp(-max(h, 0.0) * 9.0) * 0.45; // afterglow
            vec2 p = d.xz / (h + 0.25);
            float c = smoothstep(0.5, 0.82, fbm2(p * vec2(1.1, 2.6) + vec2(uTime * 0.004, 0.0)));
            c *= smoothstep(0.03, 0.14, h) * (1.0 - smoothstep(0.35, 0.7, h));
            col = mix(col, mix(vec3(0.96, 0.78, 0.86), vec3(1.1, 0.88, 0.9), pow(toSun, 2.0)), c * 0.7);
            return col;
          }
          vec3 nightSky(vec3 d) {
            float h = d.y;
            vec3 col = mix(vec3(0.03, 0.04, 0.1), vec3(0.006, 0.008, 0.028), smoothstep(0.0, 0.6, h));
            float m = dot(d, MOON);
            col += vec3(1.0, 0.96, 0.88) * smoothstep(0.99935, 0.9996, m) * 3.0;
            col += vec3(0.45, 0.52, 0.85) * pow(max(m, 0.0), 260.0) * 0.7 + vec3(0.12, 0.15, 0.3) * pow(max(m, 0.0), 10.0) * 0.3;
            vec2 p = d.xz / (h + 0.25);
            float c = smoothstep(0.6, 0.9, fbm2(p * vec2(1.2, 3.6) + vec2(uTime * 0.003, 4.0))) * smoothstep(0.04, 0.2, h);
            col = mix(col, vec3(0.06, 0.07, 0.12) + vec3(0.25, 0.28, 0.4) * pow(max(m, 0.0), 6.0), c * 0.6);
            return col;
          }
          float stars(vec3 d, float density) {
            vec3 g = d * 360.0;
            float h = hash13(floor(g));
            if (h > density || d.y < 0.03) return 0.0;
            float s = smoothstep(0.42, 0.0, length(fract(g) - 0.5));
            return s * (0.45 + 0.55 * sin(uTime * (1.0 + h * 40.0) + h * 300.0));
          }
          void main() {
            vec3 d = normalize(vDir);
            float n = smoothstep(0.0, 1.0, uNight);
            vec3 col = mix(duskSky(d), nightSky(d), n);
            col += vec3(0.8, 0.85, 1.0) * stars(d, mix(0.003, 0.014, n)) * mix(0.35, 0.9, n) * smoothstep(0.15, 0.6, d.y + n * 0.5);
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    );
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    this.sky = sky;
    scene.add(sky);

    // ── distant forest ring ──
    const ring = new Mesh(
      new CylinderGeometry(330, 330, 70, 160, 1, true),
      new ShaderMaterial({
        uniforms: parkUniforms,
        side: DoubleSide,
        transparent: true,
        depthWrite: false,
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          varying vec3 vDir;
          void main() {
            vUv = uv;
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vDir = normalize(wp.xyz - cameraPosition);
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uNight;
          varying vec2 vUv;
          varying vec3 vDir;
          ${GLSL_HASH}
          ${GLSL_NOISE}
          void main() {
            float x = vUv.x * 160.0;
            // three ridges, nearest darkest; rounded crowns like sakura / pine canopies
            float far = 0.38 + 0.18 * fbm2(vec2(x * 0.08, 1.0)) + 0.05 * vnoise2(vec2(x * 1.3, 2.0));
            float near = 0.26 + 0.2 * fbm2(vec2(x * 0.13, 7.0)) + 0.06 * vnoise2(vec2(x * 2.1, 5.0));
            float y = vUv.y;
            float aFar = 1.0 - smoothstep(far - 0.006, far, y);
            float aNear = 1.0 - smoothstep(near - 0.006, near, y);
            vec3 cFar = mix(vec3(0.62, 0.58, 0.76), vec3(0.04, 0.05, 0.1), uNight);   // misty, nearly sky-coloured
            vec3 cNear = mix(vec3(0.36, 0.32, 0.5), vec3(0.02, 0.025, 0.05), uNight);   // forested, deeper
            // mist pooling at the foot of each ridge
            cNear = mix(cNear, cFar, (1.0 - smoothstep(0.0, near * 0.6, y)) * 0.55);
            vec3 col = mix(cFar, cNear, aNear);
            float a = max(aFar, aNear);
            // a few warm lantern specks in the far woods
            float sp = step(0.9965, hash12(floor(vec2(x * 4.0, y * 120.0)))) * aNear * step(y, near - 0.03);
            col += vec3(1.0, 0.45, 0.18) * sp * (0.5 + uNight * 1.5);
            gl_FragColor = vec4(col, a);
          }`,
      }),
    );
    ring.position.y = 6;
    ring.renderOrder = -9;
    ring.frustumCulled = false;
    this.ring = ring;
    scene.add(ring);
    this.buildMountain(scene);
  }

  /**
   * The great snow-capped peak of the reference painting, far down the lane
   * beyond the plaza: a concave volcanic cone with ridged flanks, a jagged snow
   * line, the west face catching the last light and the east in lavender shade,
   * dissolving into mist at its foot. Unfogged (it carries its own aerial
   * perspective), drawn just in front of the sky.
   */
  buildMountain(scene) {
    const R = 430, H = 250, rings = 48, segs = 128;
    const pos = [], idx = [];
    const ridge = (a) => Math.sin(a * 9.0) * 0.5 + Math.sin(a * 23.0 + 1.3) * 0.3 + Math.sin(a * 41.0 + 0.4) * 0.2;
    for (let i = 0; i <= rings; i++) {
      const r = (i / rings) * R;
      for (let j = 0; j <= segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        const k = r / R;
        // concave profile (Fuji-like) with a truncated crater top; ridges deepen down the flanks
        let h = H * Math.pow(1 - k, 1.9) * (k < 0.04 ? 0.97 + k : 1);
        h += ridge(a + k * 0.6) * 9 * Math.sin(Math.PI * Math.min(1, k * 1.6)) * (0.4 + k);
        pos.push(Math.cos(a) * r * (1 + 0.05 * Math.sin(a * 3)), h, Math.sin(a) * r);
      }
    }
    for (let i = 0; i < rings; i++)
      for (let j = 0; j < segs; j++) {
        const a = i * (segs + 1) + j, b = a + segs + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mat = new ShaderMaterial({
      uniforms: { ...parkUniforms, uPeak: { value: H } },
      vertexShader: /* glsl */ `
        varying vec3 vP;
        varying vec3 vN;
        varying vec3 vW;
        void main() {
          vP = position;
          vN = normalize(mat3(modelMatrix) * normal);
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uNight, uPeak, uTime;
        uniform vec3 uSunDir;
        varying vec3 vP;
        varying vec3 vN;
        varying vec3 vW;
        ${GLSL_HASH}
        ${GLSL_NOISE}
        void main() {
          float k = vP.y / uPeak;
          vec3 n = normalize(vN);
          vec3 L = normalize(vec3(-0.8, 0.45, -0.4)); // the west face takes the afterglow
          float lit = clamp(dot(n, L) * 0.6 + 0.5, 0.0, 1.0);
          // jagged snow line, snow streaming down the gullies
          float streaks = fbm2(vec2(atan(vP.z, vP.x) * 14.0, k * 6.0));
          float snow = smoothstep(0.42, 0.5, k + (streaks - 0.5) * 0.28);
          vec3 rock = mix(vec3(0.24, 0.27, 0.46), vec3(0.42, 0.42, 0.64), lit);       // lavender-blue flanks
          vec3 snowC = mix(vec3(0.66, 0.7, 0.9), vec3(1.15, 1.08, 1.1), lit);      // pink-white snow, shaded lilac
          vec3 dusk = mix(rock, snowC, snow);
          vec3 night = mix(vec3(0.03, 0.04, 0.08), vec3(0.22, 0.25, 0.36), snow) * (0.6 + 0.4 * lit);
          vec3 col = mix(dusk, night, uNight);
          // aerial perspective + mist pooling around its foot
          vec3 mistDusk = vec3(0.86, 0.78, 0.9), mistNight = vec3(0.05, 0.06, 0.12);
          vec3 mist = mix(mistDusk, mistNight, uNight);
          float drift = fbm2(vec2(vW.x * 0.006 + uTime * 0.003, vW.y * 0.02));
          float m = (1.0 - smoothstep(0.0, 0.3 + drift * 0.12, k)) * 0.95;
          col = mix(col, mist, max(m, 0.12));
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const m = new Mesh(g, mat);
    m.position.set(-70, -6, -660);
    m.renderOrder = -8;
    m.frustumCulled = false;
    this.mountain = m;
    scene.add(m);
  }

  update(camera) {
    this.sky.position.copy(camera.position);
    this.ring.position.x = camera.position.x;
    this.ring.position.z = camera.position.z;
  }

  dispose() {
    disposeObject(this.sky);
    disposeObject(this.ring);
    disposeObject(this.mountain);
  }
}
