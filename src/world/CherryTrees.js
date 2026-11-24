import { BufferAttribute, BufferGeometry, Color, CylinderGeometry, DoubleSide, Euler, InstancedMesh, Matrix4, MeshDepthMaterial, MeshStandardMaterial, Quaternion, RGBADepthPacking, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PARK } from '../config.js';
import { GLSL_LAMPS, parkUniforms } from '../core/uniforms.js';
import { GLSL_HASH, GLSL_NOISE, GLSL_WIND } from '../shaders/common.js';
import { mulberry32, range } from '../utils/math.js';
import { blossomTexture, disposeBlossomTexture } from './blossomTexture.js';
import { distToLane, distToStations, laneLength, lanePoint, laneSide, STATIONS } from './lane.js';
import { distToStream, STREAM, streamCurve } from './stream.js';
import { terrainHeight } from './terrain.js';

const UP = new Vector3(0, 1, 0);
const _q = new Quaternion();
const _m = new Matrix4();
const CHUNK = 44; // metres: trees are batched per (variant, chunk) so whole chunks frustum-cull
const SHADOW_RANGE = 26; // chunks whose trees are all farther than this from the lane don't cast shadows
const LOD_NEAR = 44; // m from the camera to a chunk's edge before its blossoms switch to the light LOD (far enough that no tree in a shot's background looks thinned)

/** A tapered limb from a → b (open cylinder), with an `aFlex` weight for wind sway. */
function limb(a, b, r0, r1, flex0, flex1, radial = 7) {
  const len = a.distanceTo(b);
  const g = new CylinderGeometry(r1, r0, len, radial, 1, true);
  const flex = new Float32Array(g.attributes.position.count);
  for (let i = 0; i < flex.length; i++) {
    const k = g.attributes.position.getY(i) / len + 0.5;
    flex[i] = flex0 + (flex1 - flex0) * k;
  }
  g.setAttribute('aFlex', new BufferAttribute(flex, 1));
  _q.setFromUnitVectors(UP, b.clone().sub(a).normalize());
  g.applyMatrix4(_m.compose(a.clone().add(b).multiplyScalar(0.5), _q, new Vector3(1, 1, 1)));
  g.deleteAttribute('uv');
  return g;
}

/**
 * One sakura pom-pom: `cards` crossed quads through the cluster centre, each
 * carrying the painted flower-cluster texture (alpha-cut → individual flowers
 * with sky between them). Normals point out from the centre (blended with
 * the card normal) so the pom-pom shades like a soft ball of flowers.
 */
function pomPom(spec, cards, grow = 1) {
  const { centre, size, flex, tint, rot } = spec;
  const pos = [], nor = [], uv = [], col = [], fl = [], idx = [];
  const s = size * grow * 0.5;
  const q = new Quaternion();
  for (let c = 0; c < cards; c++) {
    // first card faces up-ish, the others stand up crossing it
    q.setFromEuler(new Euler(c === 0 ? -Math.PI / 2 + rot[0] * 0.5 : rot[0] * 0.6, rot[1] + (c * Math.PI) / cards, rot[2] * 0.4));
    const base = pos.length / 3;
    const flip = (c + spec.flip) % 2 ? -1 : 1;
    for (const [x, y, u, v] of [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1]]) {
      const p = new Vector3(x * s * flip, y * s, 0).applyQuaternion(q);
      const n = new Vector3(0, 0, 1).applyQuaternion(q);
      const sph = p.clone().normalize();
      n.lerp(sph.lengthSq() ? sph : n, 0.75).normalize();
      pos.push(p.x + centre.x, p.y + centre.y, p.z + centre.z);
      nor.push(n.x, n.y, n.z);
      uv.push(u, v);
      const under = Math.max(0, -p.y / s);
      col.push(tint.r * (1 - under * 0.06), tint.g * (1 - under * 0.2), tint.b * (1 - under * 0.1));
      fl.push(flex);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setAttribute('aFlex', new BufferAttribute(new Float32Array(fl), 1));
  g.setIndex(idx);
  return g;
}

/**
 * One procedural sakura, Somei-Yoshino habit: a short, massive, leaning trunk
 * that splits low into 4–5 heavy scaffold limbs arcing up-and-OUT, then forks
 * through three more orders of ever-thinner, crooked branches — every limb a
 * real tapered mesh with bark, visible between the flowers. Blossoms are
 * separate pom-pom clusters: small ones dotted along the outer branches,
 * bunches of 4–6 around every twig tip, so the crown is layered and airy
 * (sky shows through) instead of a solid pink mass.
 * Returns merged wood geometry + blossom geometry at two LODs.
 */
function buildTree(seed) {
  const rnd = mulberry32(seed);
  const wood = [];
  const poms = [];
  const tint = new Color();
  const newTint = () => tint.setHSL(range(rnd, 0.955, 0.99), range(rnd, 0.55, 0.8), range(rnd, 0.84, 0.92)).clone();
  const spec = (centre, size, flex, tone) => ({ centre, size, flex, tint: tone, rot: [range(rnd, -0.6, 0.6), rnd() * 6.28, range(rnd, -0.6, 0.6)], flip: rnd() < 0.5 ? 0 : 1, tip: false });
  const MAX = 3;

  function branch(start, dir, length, radius, depth, flex) {
    const segs = depth === 0 ? 4 : 3;
    let p = start.clone();
    const d = dir.clone();
    let r = radius;
    const rEnd = radius * (depth === MAX ? 0.35 : 0.62);
    const tone = newTint();
    for (let s = 0; s < segs; s++) {
      // crooked, zig-zagging sakura limbs: rise, then relax outward and droop under the bloom
      d.y += (depth === 0 ? 0.03 : -0.05 * depth) + range(rnd, -0.12, 0.12);
      d.x += range(rnd, -0.22, 0.22);
      d.z += range(rnd, -0.22, 0.22);
      d.normalize();
      const q = p.clone().addScaledVector(d, length / segs);
      const r2 = r + (rEnd - r) / segs;
      const f0 = flex + (s / segs) * 0.1 * (depth + 1), f1 = flex + ((s + 1) / segs) * 0.1 * (depth + 1);
      wood.push(limb(p, q, r, r2, f0, f1, depth >= 2 ? 5 : depth === 1 ? 7 : 9));
      // overlapping clusters smothering the outer branches (2–3 per segment), and the outer
      // half of the scaffold limbs, so the crown is heavy and overflowing — yet still clumps
      const along = depth >= 2 ? 3 + (rnd() < 0.35 ? 1 : 0) : depth === 1 && s >= 1 ? 1 + (rnd() < 0.8 ? 1 : 0) : 0;
      for (let k = 0; k < along; k++) {
        const at = p.clone().lerp(q, (k + rnd()) / along);
        at.add(new Vector3(range(rnd, -0.35, 0.35), range(rnd, -0.15, 0.3), range(rnd, -0.35, 0.35)));
        poms.push(spec(at, range(rnd, 0.75, 1.15), f1, tone));
      }
      p = q;
      r = r2;
    }
    if (depth >= MAX) {
      // the tip: a heavy bunch of 7–10 overlapping pom-poms, some spilling below the twig
      const n = 10 + Math.floor(rnd() * 4);
      for (let k = 0; k < n; k++) {
        const at = p.clone().add(new Vector3(range(rnd, -0.65, 0.65), range(rnd, -0.7, 0.4), range(rnd, -0.65, 0.65))).addScaledVector(d, range(rnd, -0.3, 0.35));
        const sp = spec(at, range(rnd, 0.85, 1.3), flex + 0.4, tone);
        sp.tip = k < 6;
        poms.push(sp);
      }
      return;
    }
    const kids = depth === 0 ? 4 + Math.floor(rnd() * 2) : 2 + (rnd() < 0.6 ? 1 : 0);
    const yaw0 = rnd() * Math.PI * 2;
    for (let k = 0; k < kids; k++) {
      const yaw = yaw0 + (k / kids) * Math.PI * 2 + range(rnd, -0.5, 0.5);
      const spread = depth === 0 ? range(rnd, 0.6, 0.95) : range(rnd, 0.45, 0.85);
      const out = new Vector3(Math.cos(yaw), 0, Math.sin(yaw));
      const nd = d.clone().multiplyScalar(Math.cos(spread)).addScaledVector(out, Math.sin(spread));
      if (depth === 0) nd.y = Math.max(nd.y, 0.45);
      if (depth === 1) nd.y = Math.max(nd.y, 0.1);
      nd.normalize();
      // forks branch off along the parent, not only at its end
      const from = k === 0 || depth === 0 ? p : start.clone().lerp(p, range(rnd, 0.55, 0.9));
      branch(from, nd, length * range(rnd, 0.62, 0.8), r * (k === 0 ? 0.95 : 0.8), depth + 1, flex + 0.25);
    }
  }

  // trunk: short, stout, leaning, with a flared root collar
  const lean = new Vector3(range(rnd, -0.2, 0.2), 1, range(rnd, -0.2, 0.2)).normalize();
  const trunkH = range(rnd, 1.5, 2.1);
  const base = new Vector3(0, -0.2, 0);
  const mid = base.clone().addScaledVector(lean, 0.6);
  const top = base.clone().addScaledVector(lean, trunkH);
  wood.push(limb(base, mid, 0.66, 0.44, 0, 0, 12));
  wood.push(limb(mid, top, 0.44, 0.36, 0, 0.02, 12));
  branch(top, lean, range(rnd, 3.8, 4.8), 0.32, 0, 0.04);

  const woodGeo = mergeGeometries(wood);
  wood.forEach((g) => g.dispose());
  // LOD0: every pom-pom, 3 crossed cards. LOD1 (distant): tip bunches + two buds in three, 2 cards, a bit larger.
  const hi = poms.map((p) => pomPom(p, 3));
  const lo = poms.filter((p, i) => p.tip || i % 3 !== 2).map((p) => pomPom(p, 2, 1.15));
  const bloomGeo = mergeGeometries(hi);
  const bloomGeoLow = mergeGeometries(lo);
  hi.forEach((g) => g.dispose());
  lo.forEach((g) => g.dispose());
  bloomGeo.computeBoundingBox();
  const bb = bloomGeo.boundingBox;
  const crown = Math.max(-bb.min.x, bb.max.x, -bb.min.z, bb.max.z);
  return { woodGeo, bloomGeo, bloomGeoLow, height: bb.max.y, crown, crownBase: bb.min.y };
}

/** Shared vertex-side wind sway for wood + blossoms (instanced). */
function swayChunk(sh) {
  Object.assign(sh.uniforms, { uTime: parkUniforms.uTime, uWind: parkUniforms.uWind, uGust: parkUniforms.uGust });
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>\nattribute float aFlex;\nvarying vec3 vWorldP;\nvarying vec3 vObjP;\n${GLSL_WIND}`)
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vObjP = position;
       vec3 rootW = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
       vec3 sway = windSway(rootW + position * 0.3, aFlex * aFlex) * 0.2;
       transformed += inverse(mat3(instanceMatrix)) * sway; // world-aligned offset`,
    )
    .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
}

/** Screen-space bump from a procedural height (Mikkelsen's surface-gradient method). */
const GLSL_BUMP = /* glsl */ `
  vec3 bumpNormal(vec3 surfPos, vec3 n, float h, float scale) {
    vec3 sx = dFdx(surfPos), sy = dFdy(surfPos);
    vec3 r1 = cross(sy, n), r2 = cross(n, sx);
    float det = dot(sx, r1);
    vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
    return normalize(abs(det) * n - grad * scale);
  }
`;

/**
 * The park's sakura. PARK.treeVariants procedurally grown trees, drawn with
 * InstancedMeshes batched per (variant, 44 m chunk) so the camera and the
 * shadow camera cull whole chunks along the long lane; distant chunks swap
 * to a lighter blossom LOD. Placement:
 *   • an avenue lining both sides of the lane,
 *   • framing rings around the plaza and the catch clearing (the lantern
 *     strings hang between these "hero" trees),
 *   • two trees shading the picnic lawn, a grove around the gate,
 *   • a deep backdrop forest out to PARK.forestWidth.
 */
export class CherryTrees {
  constructor(scene) {
    this.scene = scene;
    this.meshes = [];
    const rnd = mulberry32(PARK.seed);
    this.variants = Array.from({ length: PARK.treeVariants }, (_, i) => buildTree(PARK.seed * 7 + i * 131));
    this.placements = this.place(rnd);

    // ── materials ──
    const wood = new MeshStandardMaterial({ color: new Color(0.2, 0.13, 0.12), roughness: 0.82 });
    wood.onBeforeCompile = (sh) => {
      swayChunk(sh);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vWorldP;\nvarying vec3 vObjP;\n${GLSL_HASH}\n${GLSL_NOISE}\n${GLSL_BUMP}`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
           // Somei-Yoshino bark: glossy plum-grey, ringed with horizontal lenticel bands,
           // rough fissured patches low on the trunk, grey-green lichen
           float lent = smoothstep(0.6, 0.85, vnoise3(vObjP * vec3(7.0, 70.0, 7.0)));
           float rough = fbm3(vObjP * vec3(5.0, 2.0, 5.0));
           float lichen = smoothstep(0.6, 0.8, fbm3(vObjP * 2.2 + 4.0)) * smoothstep(3.0, 0.5, vObjP.y);
           diffuseColor.rgb *= 0.78 + 0.4 * rough - lent * 0.3;
           diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.33, 0.3, 0.3), smoothstep(0.55, 0.75, rough) * 0.35);
           diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.26, 0.29, 0.22), lichen * 0.55);
           float barkH = rough * 0.6 + lent * 0.5 + vnoise3(vObjP * vec3(18.0, 6.0, 18.0)) * 0.35;`,
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.55, 0.95, rough) + lent * 0.1;')
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = bumpNormal(-vViewPosition, normal, barkH, 0.9);');
    };
    const tex = blossomTexture();
    const bloom = new MeshStandardMaterial({ map: tex, vertexColors: true, alphaTest: 0.42, side: DoubleSide, roughness: 0.75, metalness: 0 });
    bloom.onBeforeCompile = (sh) => {
      swayChunk(sh);
      Object.assign(sh.uniforms, { uLampPos: parkUniforms.uLampPos, uLampCol: parkUniforms.uLampCol, uNight: parkUniforms.uNight, uSunDir: parkUniforms.uSunDir, uSunCol: parkUniforms.uSunCol });
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vWorldP;\nvarying vec3 vObjP;\nuniform float uNight;\nuniform vec3 uSunDir, uSunCol;\n${GLSL_LAMPS}`)
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
           // petals are thin: light shines THROUGH them — lanterns below, the low sun / moon behind —
           // plus a faint self-glow so the canopy stays luminous as the sky darkens
           vec3 nW = inverseTransformDirection(normal, viewMatrix);
           vec3 V = normalize(cameraPosition - vWorldP);
           float back = pow(max(dot(-V, normalize(uSunDir)), 0.0), 4.0);
           totalEmissiveRadiance += diffuseColor.rgb * (lampLight(vWorldP, -nW, 0.75) * 0.22 + uSunCol * back * 0.35
                                    + vec3(0.06, 0.03, 0.04) * uNight + vec3(0.1, 0.05, 0.06) * (1.0 - uNight));`,
        );
    };
    // cut-out shadows: the depth pass honours the flower alpha (sway isn't replicated there: subtle)
    const bloomDepth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking, map: tex, alphaTest: 0.42, side: DoubleSide });
    this.materials = [wood, bloom, bloomDepth];

    // ── batch into (variant, chunk) instanced meshes ──
    const groups = new Map();
    for (const p of this.placements) {
      const key = `${p.variant}:${Math.floor(p.x / CHUNK)}:${Math.floor(p.z / CHUNK)}`;
      if (!groups.has(key)) groups.set(key, { variant: p.variant, list: [] });
      groups.get(key).list.push(p);
    }
    const m = new Matrix4(), q = new Quaternion(), s = new Vector3(), e = new Euler();
    this.chunks = [];
    for (const { variant, list } of groups.values()) {
      const v = this.variants[variant];
      const w = new InstancedMesh(v.woodGeo, wood, list.length);
      const hi = new InstancedMesh(v.bloomGeo, bloom, list.length);
      const lo = new InstancedMesh(v.bloomGeoLow, bloom, list.length);
      hi.customDepthMaterial = lo.customDepthMaterial = bloomDepth;
      const casts = list.some((p) => p.laneD < SHADOW_RANGE);
      list.forEach((p, i) => {
        q.setFromEuler(e.set(0, p.rot, 0));
        s.setScalar(p.scale);
        m.compose(new Vector3(p.x, p.y, p.z), q, s);
        for (const mesh of [w, hi, lo]) mesh.setMatrixAt(i, m);
      });
      for (const mesh of [w, hi, lo]) {
        mesh.castShadow = casts;
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        scene.add(mesh);
        this.meshes.push(mesh);
      }
      lo.visible = false;
      this.chunks.push({ hi, lo, sphere: hi.boundingSphere });
    }
  }

  place(rnd) {
    const out = [];
    const halfLane = PARK.laneWidth / 2;
    const free = (x, z, minD, { lane = halfLane + 3.4, station = 2.5 } = {}) =>
      distToLane(x, z) > lane && distToStations(x, z) > station && distToStream(x, z) > STREAM.halfWidth + 2.4 && out.every((t) => Math.hypot(t.x - x, t.z - z) > minD);
    const add = (x, z, { hero = null, scale = null } = {}) => {
      const variant = Math.floor(rnd() * this.variants.length);
      out.push({
        x, y: terrainHeight(x, z), z,
        rot: rnd() * Math.PI * 2,
        scale: scale ?? range(rnd, 0.92, 1.22),
        variant, hero,
        crown: this.variants[variant].crown,
        laneD: Math.min(distToLane(x, z), distToStations(x, z) + 6),
      });
    };

    // 1) framing rings (hero trees carry lantern strings)
    const ring = (st, n, pad, tag, phase) => {
      for (let i = 0; i < n; i++) {
        const a = phase + (i / n) * Math.PI * 2 + range(rnd, -0.1, 0.1);
        const r = st.radius + pad + range(rnd, -0.4, 0.6);
        const x = st.center.x + Math.cos(a) * r, z = st.center.z + Math.sin(a) * r;
        if (distToLane(x, z) < halfLane + 2.6) continue; // keep the lane's mouth open
        if (out.some((t) => Math.hypot(t.x - x, t.z - z) < 6)) continue;
        add(x, z, { hero: tag, scale: range(rnd, 1.12, 1.3) });
      }
    };
    ring(STATIONS.plaza, 8, 5.5, 'plaza', 0.25);
    ring(STATIONS.catch, 6, 4.8, 'catch', 0.6);
    // 2) the picnic trees: blanket in their shade, away from the lane
    const pc = STATIONS.picnic;
    const away = laneSide(pc.u).multiplyScalar(pc.side);
    const perp = new Vector3(-away.z, 0, away.x);
    for (const k of [-1, 1]) {
      const p = pc.center.clone().addScaledVector(away, 3.2).addScaledVector(perp, k * 4.6);
      add(p.x, p.z, { hero: 'picnic', scale: range(rnd, 1.1, 1.25) });
    }
    // 2b) sakura leaning over the brook on both banks, framing the bridge (the painting's view)
    for (let i = 0; i < 16; i++) {
      const t = 0.5 + (i < 8 ? -1 : 1) * (0.03 + (i % 8) * 0.035) + range(rnd, -0.01, 0.01);
      const c = streamCurve.getPointAt(Math.min(1, Math.max(0, t)));
      const tan = streamCurve.getTangentAt(Math.min(1, Math.max(0, t)));
      const off = (i % 2 ? 1 : -1) * (STREAM.halfWidth + range(rnd, 2.6, 4.2));
      const x = c.x - tan.z * off, z = c.z + tan.x * off;
      if (free(x, z, 6.0, { lane: halfLane + 3.6, station: 3 })) add(x, z, { scale: range(rnd, 1.1, 1.3) });
    }
    // 3) the avenue: both sides of the lane, a tree every ~avenueSpacing m
    for (const side of [-1, 1]) {
      for (let d = 2 + (side > 0 ? PARK.avenueSpacing / 2 : 0); d < laneLength - 10; d += PARK.avenueSpacing * range(rnd, 0.85, 1.15)) {
        const u = d / laneLength;
        const off = halfLane + range(rnd, 4.4, 6.4);
        const p = lanePoint(u).addScaledVector(laneSide(u), side * off);
        if (free(p.x, p.z, 6.2, { lane: halfLane + 3.4, station: 3 })) add(p.x, p.z, { scale: range(rnd, 1.05, 1.25) });
      }
    }
    // 4) the gate grove: the park doesn't just stop behind the gate
    const gate = lanePoint(0);
    const back = lanePoint(0).sub(lanePoint(0.03)).normalize();
    for (let i = 0, t = 0; i < 18 && t < 600; t++) {
      // leave a clear corridor straight behind the gate (the prelude's crane comes down through it)
      const off = range(rnd, 0.75, 1.9) * (rnd() < 0.5 ? -1 : 1);
      const a = Math.atan2(back.z, back.x) + off;
      const r = range(rnd, 7, 34);
      const x = gate.x + Math.cos(a) * r, z = gate.z + Math.sin(a) * r;
      if (free(x, z, 6.8, { lane: halfLane + 4, station: 3 })) {
        add(x, z, { scale: range(rnd, 1.0, 1.25) });
        i++;
      }
    }
    // 5) backdrop forest
    let tries = 0, n = 0;
    while (n < PARK.backdropTrees && tries++ < 9000) {
      const u = rnd();
      const off = (rnd() < 0.5 ? -1 : 1) * range(rnd, halfLane + 9, PARK.forestWidth);
      const p = lanePoint(u).addScaledVector(laneSide(u), off);
      p.x += range(rnd, -6, 6);
      p.z += range(rnd, -6, 6);
      if (free(p.x, p.z, 8.5, { lane: halfLane + 8, station: 4 })) {
        add(p.x, p.z);
        n++;
      }
    }
    // a window in the plaza's ring toward the mountain: the open sky where Act IV's fireworks
    // bloom (removed after placement so every other tree stays exactly where it was)
    const pz = STATIONS.plaza.center;
    return out.filter((t) => {
      if (t.hero !== 'plaza') return true;
      const a = Math.atan2(t.x - pz.x, t.z - pz.z) - Math.atan2(-0.1, -1);
      return Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) > 0.42;
    });
  }

  /** Per-frame LOD: full-detail blossoms for chunks within LOD_NEAR of the camera, the light set beyond. */
  update(camera) {
    const c = camera.position;
    for (const ch of this.chunks) {
      const near = c.distanceTo(ch.sphere.center) - ch.sphere.radius < LOD_NEAR;
      ch.hi.visible = near;
      ch.lo.visible = !near;
    }
  }

  /** Hero trees of one station ('plaza' | 'catch' | 'picnic'). */
  heroes(tag) {
    return this.placements.filter((p) => p.hero === tag);
  }

  dispose() {
    for (const m of this.meshes) {
      m.removeFromParent();
      m.dispose();
    }
    for (const v of this.variants) {
      v.woodGeo.dispose();
      v.bloomGeo.dispose();
      v.bloomGeoLow.dispose();
    }
    this.materials.forEach((m) => m.dispose());
    disposeBlossomTexture();
  }
}
