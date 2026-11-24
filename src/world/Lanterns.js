import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedMesh,
  LatheGeometry,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LANTERNS, PARK } from '../config.js';
import { parkUniforms } from '../core/uniforms.js';
import { mulberry32, range } from '../utils/math.js';
import { distToLane, laneLength, lanePoint, laneSide, STATIONS } from './lane.js';
import { distToStream, STREAM } from './stream.js';

/** Chōchin body: a ribbed paper ellipsoid, 1 m tall (scaled per instance), pivot at the top. */
function bodyGeometry() {
  const pts = [];
  const N = 18, ribs = 11;
  for (let i = 0; i <= N; i++) {
    const v = i / N; // 0 bottom → 1 top
    const y = v - 1; // hangs below the pivot
    const base = Math.sqrt(Math.max(0, 1 - (2 * v - 1) ** 2)) * 0.5;
    const r = Math.max(0.16, base) * (1 - 0.045 * Math.abs(Math.sin(v * ribs * Math.PI)));
    pts.push(new Vector2(r * 0.82, y));
  }
  return new LatheGeometry(pts, 12);
}

/** Black lacquered rim caps top + bottom and the little hanging hook. */
function capGeometry() {
  const top = new CylinderGeometry(0.15, 0.15, 0.06, 16).translate(0, -0.03, 0);
  const bot = new CylinderGeometry(0.15, 0.15, 0.06, 16).translate(0, -0.97, 0);
  const hook = new CylinderGeometry(0.012, 0.012, 0.18, 6).translate(0, 0.09, 0);
  const g = mergeGeometries([top, bot, hook]);
  [top, bot, hook].forEach((x) => x.dispose());
  return g;
}

/** Catenary sag between two points (n points). */
function catenary(a, b, sag, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = a.clone().lerp(b, t);
    p.y -= sag * 4 * t * (1 - t);
    out.push(p);
  }
  return out;
}

/**
 * Red and gold paper lanterns strung on ropes between the hero trees around
 * the plaza and the catch clearing, zig-zagging down the whole lane, over
 * the picnic lawn and (dim, red) around the festival stage.
 *  • Bodies: one InstancedMesh with an HDR paper shader (ribs, black bands,
 *    a candle-flicker per lantern, hot core) → the bloom pass makes them glow.
 *  • Each lantern swings on its hook with the wind (pivot at the top).
 *  • `anchors`: the centroid of each string. Lighting hops its few real
 *    PointLights to the anchors nearest the couple, so warm pools fall on the
 *    grass and the characters wherever they are on the lane.
 */
export class Lanterns {
  constructor(scene, trees) {
    this.scene = scene;
    const rnd = mulberry32(PARK.seed + 9);
    const items = []; // { p: Vector3 (hook), scale, color }
    const ropes = [];
    this.anchors = [];
    this.posts = [];
    const red = new Color(...LANTERNS.red), gold = new Color(...LANTERNS.gold);

    const string = (a, b, { sag = 0.7, spacing = 1.25, pattern = 'alt', anchor = true } = {}) => {
      const len = a.distanceTo(b);
      const curve = catenary(a, b, sag, 24);
      for (let i = 0; i < curve.length - 1; i++) ropes.push(curve[i], curve[i + 1]);
      const n = Math.max(1, Math.floor(len / spacing) - 1);
      const sum = new Vector3();
      const rgb = new Color();
      for (let i = 1; i <= n; i++) {
        const t = i / (n + 1);
        const p = a.clone().lerp(b, t);
        p.y -= sag * 4 * t * (1 - t) + 0.05;
        const isRed = pattern === 'red' ? true : pattern === 'gold' ? false : i % 2 === 1;
        const c = isRed ? red : gold;
        const s = isRed ? range(rnd, 0.42, 0.5) : range(rnd, 0.32, 0.38);
        items.push({ p, s, color: c, round: !isRed });
        sum.add(p);
        rgb.add(c);
      }
      if (anchor) {
        const centroid = sum.multiplyScalar(1 / n);
        centroid.y -= 0.45;
        rgb.multiplyScalar(1 / n);
        this.anchors.push({ position: centroid, color: [rgb.r, rgb.g, rgb.b] });
      }
    };

    // 1) rings of strings between the hero trees around the plaza and the catch clearing
    const hookH = (h) => h.y + 3.3 * h.scale;
    for (const [tag, st] of [['plaza', STATIONS.plaza], ['catch', STATIONS.catch]]) {
      const c = st.center;
      const heroes = trees.heroes(tag).sort((a, b) => Math.atan2(a.z - c.z, a.x - c.x) - Math.atan2(b.z - c.z, b.x - c.x));
      // hook a little inside each crown, toward the centre
      const pull = (h) => new Vector3(c.x + (h.x - c.x) * 0.86, hookH(h), c.z + (h.z - c.z) * 0.86);
      for (let i = 0; i < heroes.length; i++) {
        const h0 = heroes[i], h1 = heroes[(i + 1) % heroes.length];
        if (heroes.length < 2 || Math.hypot(h0.x - h1.x, h0.z - h1.z) > 15) continue; // the gap where the lane enters
        string(pull(h0), pull(h1), { sag: 0.9 });
      }
    }
    // 2) down the whole lane: posts on alternating sides, strings zig-zagging across it
    const L = laneLength;
    const side = new Vector3();
    for (let d = 12, k = 0; d < L - 6; d += 10, k++) { // first string just past the couple's start mark
      const u = d / L, u2 = Math.min(1, (d + 8) / L);
      const p0 = lanePoint(u), p1 = lanePoint(u2);
      laneSide(u, side).multiplyScalar(PARK.laneWidth / 2 + 0.8);
      const s = k % 2 ? 1 : -1;
      const a = p0.clone().addScaledVector(side, s).setY(3.0);
      const b = p1.clone().addScaledVector(side, -s).setY(3.0);
      if (Math.min(distToStream(a.x, a.z), distToStream(b.x, b.z)) < STREAM.halfWidth + 2.5) continue; // the bridge carries no posts
      string(a, b, { sag: 0.38, spacing: 1.4 });
      this.posts.push(a.clone(), b.clone());
    }
    // 3) over the picnic lawn: between its two sakura
    const pt = trees.heroes('picnic');
    if (pt.length === 2) {
      const pc = STATIONS.picnic.center;
      const hook = (h) => new Vector3(pc.x + (h.x - pc.x) * 0.7, hookH(h) - 0.2, pc.z + (h.z - pc.z) * 0.7);
      string(hook(pt[0]), hook(pt[1]), { sag: 0.7, spacing: 1.05 });
    }
    // 4) the festival stage: a dim ring of red lanterns on posts (the dragon's flames light the rest)
    const stg = STATIONS.stage;
    const stagePosts = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const p = stg.center.clone().add(new Vector3(Math.cos(a) * (stg.radius + 1.5), 3.2, Math.sin(a) * (stg.radius + 1.5)));
      if (distToLane(p.x, p.z) < PARK.laneWidth / 2 + 1.5) continue;
      stagePosts.push(p);
    }
    for (let i = 0; i < stagePosts.length; i++) {
      const a = stagePosts[i], b = stagePosts[(i + 1) % stagePosts.length];
      if (a.distanceTo(b) < 14) string(a, b, { sag: 0.8, spacing: 1.6, pattern: 'red' });
      this.posts.push(a.clone());
    }
    // 4b) the festival's canopy: an outer ring of posts round the stage, its strings alternating
    //     red and gold, and spokes of gold lanterns running in to the inner ring (warm light
    //     everywhere around the dark corner)
    const outer = [];
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2 + 0.12;
      const p = stg.center.clone().add(new Vector3(Math.cos(a) * (stg.radius + 6.5), 3.5, Math.sin(a) * (stg.radius + 6.5)));
      if (distToLane(p.x, p.z) < PARK.laneWidth / 2 + 1.2 || distToStream(p.x, p.z) < STREAM.halfWidth + 2) continue;
      outer.push(p);
    }
    for (let i = 0; i < outer.length; i++) {
      const a = outer[i], b = outer[(i + 1) % outer.length];
      if (a.distanceTo(b) < 12.5) string(a, b, { sag: 0.7, spacing: 1.2 });
      this.posts.push(a.clone());
      let near = null;
      for (const q of stagePosts) if (!near || q.distanceTo(a) < near.distanceTo(a)) near = q;
      if (near && near.distanceTo(a) < 9) string(near.clone().setY(3.1), a.clone().setY(3.4), { sag: 0.45, spacing: 1.1, pattern: 'gold' });
    }
    this.items = items;

    // ── ropes ──
    const ropeGeo = new BufferGeometry().setFromPoints(ropes);
    this.ropes = new LineSegments(ropeGeo, new LineBasicMaterial({ color: 0x1a1210 }));
    scene.add(this.ropes);

    // ── wooden posts for the path / picnic strings ──
    const postGeo = new CylinderGeometry(0.06, 0.075, 3.1, 7).translate(0, 1.55, 0);
    this.postMesh = new InstancedMesh(postGeo, new MeshStandardMaterial({ color: 0x2a1c14, roughness: 0.9 }), this.posts.length);
    const m = new Matrix4();
    this.posts.forEach((p, i) => this.postMesh.setMatrixAt(i, m.makeTranslation(p.x, 0, p.z)));
    this.postMesh.castShadow = true;
    scene.add(this.postMesh);

    // ── lantern bodies (HDR paper) + caps ──
    const n = items.length;
    const body = bodyGeometry();
    const phase = new Float32Array(n);
    const colors = new Float32Array(n * 3);
    const q = new Quaternion(), sc = new Vector3();
    this.bodies = new InstancedMesh(body, this.paperMaterial(), n);
    this.caps = new InstancedMesh(capGeometry(), new MeshStandardMaterial({ color: 0x0c0806, roughness: 0.45, metalness: 0.2 }), n);
    items.forEach((it, i) => {
      // gold lanterns are rounder (squashed)
      sc.set(it.s, it.round ? it.s * 0.78 : it.s * 1.05, it.s);
      m.compose(it.p, q, sc);
      this.bodies.setMatrixAt(i, m);
      this.caps.setMatrixAt(i, m);
      colors.set([it.color.r, it.color.g, it.color.b], i * 3);
      phase[i] = rnd() * 100;
    });
    body.setAttribute('aPhase', new InstancedBufferAttribute(phase, 1));
    body.setAttribute('aPaper', new InstancedBufferAttribute(colors, 3));
    this.caps.material.onBeforeCompile = (sh) => this.swing(sh, false);
    this.caps.geometry.setAttribute('aPhase', new InstancedBufferAttribute(phase, 1));
    this.caps.castShadow = false;
    this.bodies.computeBoundingSphere();
    this.caps.computeBoundingSphere();
    scene.add(this.bodies, this.caps);
  }

  /** Vertex chunk: swing about the hook (local origin) driven by wind + gusts. */
  swing(sh, isShader) {
    if (sh) Object.assign(sh.uniforms, { uTime: parkUniforms.uTime, uGust: parkUniforms.uGust });
    const decl = `
      uniform float uTime;
      uniform float uGust;
      attribute float aPhase;
      vec3 swingLocal(vec3 p) {
        float a = sin(uTime * 1.6 + aPhase) * (0.05 + uGust * 0.1) + sin(uTime * 2.9 + aPhase * 1.7) * 0.02;
        float b = cos(uTime * 1.3 + aPhase * 0.6) * (0.04 + uGust * 0.06);
        float ca = cos(a), sa = sin(a), cb = cos(b), sb = sin(b);
        p = vec3(p.x, p.y * ca - p.z * sa, p.y * sa + p.z * ca);
        p = vec3(p.x * cb - p.y * sb, p.x * sb + p.y * cb, p.z);
        return p;
      }`;
    if (isShader) return decl;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${decl}`).replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = swingLocal(transformed);');
  }

  paperMaterial() {
    this.uniforms = {
      ...UniformsUtils.clone(UniformsLib.fog),
      uTime: parkUniforms.uTime,
      uGust: parkUniforms.uGust,
      uNight: parkUniforms.uNight,
      uGlow: { value: LANTERNS.glow },
      uOn: { value: 1 },
    };
    return new ShaderMaterial({
      uniforms: this.uniforms,
      fog: true,
      vertexShader: /* glsl */ `
        #include <common>
        #include <fog_pars_vertex>
        ${this.swing(null, true)}
        attribute vec3 aPaper;
        varying vec3 vPaper;
        varying float vV;
        varying float vPh;
        varying vec3 vN;
        varying vec3 vView;
        void main() {
          vPaper = aPaper;
          vV = position.y + 1.0;
          vPh = aPhase;
          vec3 p = swingLocal(position);
          vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
          vN = normalize(mat3(modelMatrix * instanceMatrix) * swingLocal(normal));
          vView = normalize(cameraPosition - wp.xyz);
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <fog_pars_fragment>
        uniform float uTime, uNight, uGlow, uOn;
        varying vec3 vPaper;
        varying float vV;
        varying float vPh;
        varying vec3 vN;
        varying vec3 vView;
        void main() {
          float flick = 0.86 + 0.09 * sin(uTime * 8.3 + vPh) + 0.05 * sin(uTime * 17.0 + vPh * 3.1);
          // the candle shows through thinnest where the paper faces us (hot core), dimmer at the rim
          float facing = abs(dot(normalize(vN), normalize(vView)));
          float core = mix(0.45, 1.25, pow(facing, 1.5)) * (0.75 + 0.5 * smoothstep(0.0, 0.5, vV) * smoothstep(1.0, 0.45, vV));
          float ribs = 0.86 + 0.14 * abs(sin(vV * 11.0 * 3.14159));
          // classic black bands near top and bottom
          float band = 1.0 - 0.9 * (smoothstep(0.1, 0.12, vV) - smoothstep(0.17, 0.19, vV) + smoothstep(0.81, 0.83, vV) - smoothstep(0.88, 0.9, vV));
          vec3 lit = vPaper * uGlow * mix(0.35, 1.0, smoothstep(0.0, 0.7, uNight)) * flick * core * ribs * band * uOn;
          vec3 unlit = vPaper * 0.12 * band;
          vec3 col = lit + unlit + vec3(1.0, 0.85, 0.6) * pow(facing, 8.0) * 0.6 * uOn * flick; // white-hot centre
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
  }

  dispose() {
    for (const o of [this.ropes, this.postMesh, this.bodies, this.caps]) {
      o.removeFromParent();
      o.geometry.dispose();
      o.material.dispose();
      o.dispose?.();
    }
  }
}
