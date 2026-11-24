import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  ShaderMaterial,
  SphereGeometry,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { parkUniforms } from '../core/uniforms.js';
import { GLSL_HASH, GLSL_NOISE } from '../shaders/common.js';
import { disposeObject } from '../utils/dispose.js';
import { mulberry32, range } from '../utils/math.js';
import { lanePoint } from './lane.js';
import { crossing, laneDir, STREAM, streamAcross, streamCurve, streamLength } from './stream.js';
import { addWalkSurface, terrainHeight } from './terrain.js';

const UP = new Vector3(0, 1, 0);

/** A box from a → b (centre line), cross-section w × h, its "up" kept near world up. */
function beam(a, b, w, h) {
  const len = a.distanceTo(b);
  const g = new BoxGeometry(w, h, len);
  const dir = b.clone().sub(a).normalize();
  const m = new Matrix4().lookAt(new Vector3(), dir, UP);
  m.setPosition(a.clone().add(b).multiplyScalar(0.5));
  return g.applyMatrix4(m);
}

/**
 * The scene from the reference painting: a dark-lacquered arched bridge
 * (taiko-bashi) carrying the lane over the brook, stone piers beneath it,
 * railings with giboshi finials, a weathered torii just beyond, mossy
 * boulders along the banks, and the water itself — a slow, petal-strewn
 * stream reflecting the pastel sky. The deck is registered as a walk
 * surface, so the couple really climb and descend the arch.
 */
export class BridgeScene {
  constructor(scene) {
    this.group = new Group();
    this.group.name = 'stream-bridge-torii';
    scene.add(this.group);
    this.unregister = addWalkSurface((x, z) => this.deck(x, z));

    const wood = new MeshStandardMaterial({ color: new Color(0.11, 0.065, 0.055), roughness: 0.55, metalness: 0 });
    const woodDark = new MeshStandardMaterial({ color: new Color(0.045, 0.03, 0.028), roughness: 0.45 });
    const stone = new MeshStandardMaterial({ color: new Color(0.2, 0.19, 0.22), roughness: 0.92 });
    const brass = new MeshStandardMaterial({ color: new Color(0.55, 0.42, 0.22), roughness: 0.35, metalness: 0.7 });
    this.materials = [wood, woodDark, stone, brass];

    this.buildBridge(wood, woodDark, stone, brass);
    this.buildTorii(wood, woodDark);
    this.buildRocks(stone);
    this.buildWater();
  }

  deck(x, z) {
    const dx = x - crossing.x, dz = z - crossing.z;
    const a = dx * laneDir.x + dz * laneDir.z, b = dx * streamAcross.x + dz * streamAcross.z;
    const L = STREAM.bridgeLength / 2;
    if (Math.abs(a) > L + 0.2 || Math.abs(b) > STREAM.bridgeWidth / 2 - 0.1) return -Infinity;
    const k = Math.min(1, Math.abs(a) / L);
    return STREAM.bridgeRise * (1 - k * k) + 0.06;
  }

  /** World point at (along, across, up) in bridge space, riding the arch. */
  at(a, b, up = 0, onArch = true) {
    const L = STREAM.bridgeLength / 2;
    const k = Math.min(1, Math.abs(a) / L);
    const y = (onArch ? STREAM.bridgeRise * (1 - k * k) : 0) + up;
    return crossing.clone().addScaledVector(laneDir, a).addScaledVector(streamAcross, b).setY(y);
  }

  buildBridge(wood, woodDark, stone, brass) {
    const L = STREAM.bridgeLength / 2, W = STREAM.bridgeWidth / 2;
    const deck = [], rails = [], dark = [], stones = [], caps = [];
    // planks laid across the arch
    const N = 26;
    for (let i = 0; i < N; i++) {
      const a0 = -L + (i / N) * 2 * L, a1 = -L + ((i + 0.92) / N) * 2 * L;
      const p0 = this.at(a0, 0, -0.04), p1 = this.at(a1, 0, -0.04);
      const g = beam(p0, p1, W * 2, 0.08);
      deck.push(g);
    }
    // the two arched side girders + the underside
    for (const side of [-1, 1]) {
      for (let i = 0; i < N; i++) {
        const a0 = -L - 0.2 + (i / N) * (2 * L + 0.4), a1 = -L - 0.2 + ((i + 1) / N) * (2 * L + 0.4);
        dark.push(beam(this.at(a0, side * (W + 0.05), -0.2), this.at(a1, side * (W + 0.05), -0.2), 0.16, 0.34));
        // rails: top + mid, riding 0.95 m / 0.5 m above the deck
        rails.push(beam(this.at(a0, side * W, 0.95), this.at(a1, side * W, 0.95), 0.1, 0.09));
        rails.push(beam(this.at(a0, side * W, 0.5), this.at(a1, side * W, 0.5), 0.06, 0.06));
      }
      // posts every ~1.1 m with giboshi (onion-dome) finials on the end posts
      const P = 11;
      for (let i = 0; i <= P; i++) {
        const a = -L + (i / P) * 2 * L;
        const base = this.at(a, side * W, -0.05);
        const end = i === 0 || i === P;
        const h = end ? 1.25 : 1.02;
        const post = new BoxGeometry(end ? 0.18 : 0.11, h, end ? 0.18 : 0.11).translate(base.x, base.y + h / 2, base.z);
        rails.push(post);
        if (end) {
          caps.push(new SphereGeometry(0.11, 12, 8).scale(1, 1.15, 1).translate(base.x, base.y + h + 0.08, base.z));
          caps.push(new CylinderGeometry(0, 0.05, 0.14, 8).translate(base.x, base.y + h + 0.26, base.z));
        }
      }
    }
    // stone piers rising from the bed, and abutments at both banks
    for (const a of [-L * 0.45, L * 0.45]) {
      const top = this.at(a, 0, -0.3);
      const bed = -STREAM.depth - 0.2;
      const h = top.y - bed;
      stones.push(new BoxGeometry(W * 1.6, h, 0.9).applyMatrix4(new Matrix4().makeRotationY(Math.atan2(laneDir.x, laneDir.z))).translate(top.x, bed + h / 2, top.z));
    }
    for (const a of [-L - 0.4, L + 0.4]) {
      const p = this.at(a, 0, 0, false);
      stones.push(new BoxGeometry(W * 2.2, 1.6, 1.2).applyMatrix4(new Matrix4().makeRotationY(Math.atan2(laneDir.x, laneDir.z))).translate(p.x, -0.86, p.z));
    }
    const add = (geos, mat, shadow = true) => {
      const m = new Mesh(mergeGeometries(geos.map((g) => g.toNonIndexed())), mat);
      geos.forEach((g) => g.dispose());
      m.castShadow = shadow;
      m.receiveShadow = true;
      this.group.add(m);
      return m;
    };
    add(deck, wood);
    add(rails, wood);
    add(dark, woodDark);
    add(stones, stone);
    add(caps, brass);
  }

  /** A weathered wooden torii on the lane just past the bridge. */
  buildTorii(wood, woodDark) {
    const c = lanePoint(STREAM.toriiU);
    const yaw = Math.atan2(laneDir.x, laneDir.z) + Math.PI / 2; // beams run across the lane
    const g = new Group();
    g.position.copy(c);
    g.rotation.y = yaw;
    const span = 5.0, H = 5.4;
    const parts = [
      [new CylinderGeometry(0.24, 0.29, H, 16).translate(-span / 2, H / 2, 0), wood],
      [new CylinderGeometry(0.24, 0.29, H, 16).translate(span / 2, H / 2, 0), wood],
      // black lacquered footings
      [new CylinderGeometry(0.34, 0.36, 0.45, 16).translate(-span / 2, 0.22, 0), woodDark],
      [new CylinderGeometry(0.34, 0.36, 0.45, 16).translate(span / 2, 0.22, 0), woodDark],
      // nuki (tie beam) and the gakuzuka strut
      [new BoxGeometry(span + 1.3, 0.3, 0.26).translate(0, H - 1.25, 0), wood],
      [new BoxGeometry(0.3, 0.75, 0.24).translate(0, H - 0.72, 0), wood],
      // shimaki + kasagi (the top lintels), the kasagi sweeping up at its ends
      [new BoxGeometry(span + 2.0, 0.28, 0.44).translate(0, H - 0.2, 0), wood],
    ];
    const kasagi = [];
    const segs = 12, Lk = span + 3.0;
    for (let i = 0; i < segs; i++) {
      const x0 = -Lk / 2 + (i / segs) * Lk, x1 = -Lk / 2 + ((i + 1) / segs) * Lk;
      const lift = (x) => 0.3 * Math.pow(Math.abs(x) / (Lk / 2), 2.4);
      kasagi.push(beam(new Vector3(x0, H + 0.18 + lift(x0), 0), new Vector3(x1, H + 0.18 + lift(x1), 0), 0.62, 0.3));
    }
    parts.push([mergeGeometries(kasagi.map((k) => k.toNonIndexed())), woodDark]);
    for (const [geo, mat] of parts) {
      const m = new Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    this.torii = g;
    this.group.add(g);
    this.toriiPosts = [-span / 2, span / 2].map((x) => new Vector3(x, 0, 0).applyAxisAngle(UP, yaw).add(c));
  }

  /** Dark, mossy boulders along both banks (heavier near the bridge, as in the painting). */
  buildRocks(stone) {
    const rnd = mulberry32(808);
    const geos = [];
    for (let i = 0; i < 46; i++) {
      const t = Math.min(1, Math.max(0, 0.5 + (rnd() - 0.5) * (i < 18 ? 0.18 : 0.9)));
      const p = streamCurve.getPointAt(t);
      const tan = streamCurve.getTangentAt(t);
      const side = new Vector3(-tan.z, 0, tan.x).multiplyScalar((rnd() < 0.5 ? -1 : 1) * (STREAM.halfWidth + range(rnd, -0.6, 1.6)));
      p.add(side);
      // keep the bridge's footprint clear
      const dx = p.x - crossing.x, dz = p.z - crossing.z;
      if (Math.abs(dx * laneDir.x + dz * laneDir.z) < STREAM.bridgeLength / 2 + 0.5 && Math.abs(dx * streamAcross.x + dz * streamAcross.z) < STREAM.bridgeWidth) continue;
      const r = range(rnd, 0.35, i < 18 ? 1.3 : 0.9);
      const ico = new IcosahedronGeometry(1, 2);
      ico.deleteAttribute('uv');
      ico.deleteAttribute('normal');
      const g = mergeVertices(ico);
      ico.dispose();
      const pos = g.attributes.position;
      const ph = rnd() * 50;
      for (let k = 0; k < pos.count; k++) {
        const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
        const n = 1 + 0.22 * Math.sin(x * 3.1 + ph) * Math.sin(y * 2.7 + ph) + 0.12 * Math.sin(z * 5.3 + ph * 2);
        pos.setXYZ(k, x * r * 1.3 * n, Math.max(y, -0.3) * r * 0.75 * n, z * r * n);
      }
      g.computeVertexNormals();
      g.applyMatrix4(new Matrix4().makeRotationY(rnd() * 6.28));
      g.translate(p.x, terrainHeight(p.x, p.z) - r * 0.15, p.z);
      geos.push(g);
    }
    const mat = stone.clone();
    mat.color.setRGB(0.2, 0.19, 0.22);
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWN = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;\n${GLSL_HASH}\n${GLSL_NOISE}`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
           float n = fbm3(vWP * 1.7);
           diffuseColor.rgb *= 0.7 + 0.6 * n;
           // moss on the tops, a few fallen petals resting there too
           float top = smoothstep(0.35, 0.85, vWN.y) * smoothstep(0.4, 0.7, fbm3(vWP * 3.0 + 7.0));
           diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.12, 0.17, 0.08), top * 0.8);
           diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.68, 0.76), step(0.93, hash13(floor(vWP * 14.0))) * smoothstep(0.5, 0.9, vWN.y));`,
        );
    };
    this.materials.push(mat);
    const m = new Mesh(mergeGeometries(geos), mat);
    geos.forEach((g) => g.dispose());
    m.castShadow = true;
    m.receiveShadow = true;
    this.group.add(m);
  }

  /** The brook: slow, rippled, reflecting the pastel sky, carrying drifting petals. */
  buildWater() {
    const N = Math.ceil(streamLength / 1.5), across = 6;
    const pos = [], uv = [], idx = [];
    const w = STREAM.halfWidth + 1.4;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const c = streamCurve.getPointAt(t);
      const tan = streamCurve.getTangentAt(t);
      const side = new Vector3(-tan.z, 0, tan.x);
      for (let j = 0; j <= across; j++) {
        const s = (j / across - 0.5) * 2 * w;
        pos.push(c.x + side.x * s, STREAM.water, c.z + side.z * s);
        uv.push(j / across, t * streamLength);
      }
    }
    for (let i = 0; i < N; i++)
      for (let j = 0; j < across; j++) {
        const a = i * (across + 1) + j, b = a + across + 1;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
    g.setIndex(idx);
    this.waterUniforms = {
      ...UniformsUtils.clone(UniformsLib.fog),
      uTime: parkUniforms.uTime,
      uNight: parkUniforms.uNight,
      uSunDir: parkUniforms.uSunDir,
      uSunCol: parkUniforms.uSunCol,
      uLampPos: parkUniforms.uLampPos,
      uLampCol: parkUniforms.uLampCol,
    };
    const mat = new ShaderMaterial({
      uniforms: this.waterUniforms,
      transparent: true,
      depthWrite: false,
      fog: true,
      vertexShader: /* glsl */ `
        #include <common>
        #include <fog_pars_vertex>
        varying vec2 vUv;
        varying vec3 vWP;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWP = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <fog_pars_fragment>
        uniform float uTime, uNight;
        uniform vec3 uSunDir, uSunCol;
        uniform vec3 uLampPos[8];
        uniform vec3 uLampCol[8];
        varying vec2 vUv;
        varying vec3 vWP;
        ${GLSL_HASH}
        ${GLSL_NOISE}
        void main() {
          vec2 flow = vec2(vUv.x * 7.0, vUv.y * 0.6 - uTime * 0.25);
          // ripple normal from two scrolling noise layers
          float h1 = fbm2(flow * 1.3), h2 = fbm2(flow * 2.7 + vec2(3.1, -uTime * 0.2));
          vec3 n = normalize(vec3((h1 - 0.5) * 0.35 + (h2 - 0.5) * 0.2, 1.0, (h2 - 0.5) * 0.3));
          vec3 V = normalize(cameraPosition - vWP);
          float fres = 0.05 + 0.62 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
          // the reflected sky: pastel pink and lavender at dusk, indigo with a moon glint at night
          vec3 R = reflect(-V, n);
          vec3 skyDusk = mix(vec3(0.95, 0.72, 0.82), vec3(0.62, 0.6, 0.86), smoothstep(0.0, 0.6, R.y));
          vec3 skyNight = mix(vec3(0.08, 0.09, 0.2), vec3(0.02, 0.03, 0.08), smoothstep(0.0, 0.6, R.y));
          vec3 sky = mix(skyDusk, skyNight, uNight);
          vec3 deep = mix(vec3(0.1, 0.1, 0.16), vec3(0.015, 0.02, 0.05), uNight); // deep lavender-slate water
          vec3 col = mix(deep, sky, fres);
          col += uSunCol * pow(max(dot(R, normalize(uSunDir)), 0.0), 160.0) * 1.5;
          // lantern reflections shimmering on the surface
          for (int i = 0; i < 8; i++) {
            vec3 L = uLampPos[i] - vWP;
            float d2 = dot(L, L);
            col += uLampCol[i] * pow(max(dot(R, normalize(L)), 0.0), 60.0) * 6.0 / (1.0 + d2 * 0.05);
          }
          // petals drifting downstream
          vec2 pc = vec2(vUv.x * 18.0, vUv.y * 2.2 - uTime * 0.35);
          vec2 cell = floor(pc), f = fract(pc) - 0.5;
          float petal = step(0.86, hash12(cell)) * (1.0 - smoothstep(0.12, 0.2, length(f * vec2(1.0, 1.6))));
          col = mix(col, vec3(0.98, 0.74, 0.82) * mix(1.0, 0.25, uNight), petal);
          // soft banks
          float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
          gl_FragColor = vec4(col, mix(0.0, 0.92, edge) + petal * 0.08);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    this.water = new Mesh(g, mat);
    this.water.renderOrder = 3;
    this.materials.push(mat);
    this.group.add(this.water);
  }

  dispose() {
    this.unregister?.();
    disposeObject(this.group);
    this.materials.forEach((m) => m.dispose());
  }
}

