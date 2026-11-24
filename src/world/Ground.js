import { BufferAttribute, BufferGeometry, Color, Mesh, MeshStandardMaterial, PlaneGeometry, Vector3, Vector4 } from 'three';
import { PARK } from '../config.js';
import { parkUniforms } from '../core/uniforms.js';
import { GLSL_HASH, GLSL_NOISE } from '../shaders/common.js';
import { disposeObject } from '../utils/dispose.js';
import { laneCurve, laneLength, STATIONS } from './lane.js';
import { terrainHeight } from './terrain.js';

const STATION_LIST = Object.values(STATIONS);

/**
 * The park floor: a large terrain mesh whose grass is shaded procedurally
 * (fbm patches of lush / dry grass, clover, a carpet of fallen sakura petals
 * that thickens into drifts under the trees, worn pale lawn at every story
 * station) plus the gravel lane ribbon that winds from the gate to the plaza.
 */
export class Ground {
  constructor(scene) {
    this.scene = scene;
    this.curve = laneCurve;
    const size = 600, seg = 240;
    const geo = new PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, 95); // centred on the lane's midpoint
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, terrainHeight(p.getX(i), p.getZ(i)));
    geo.computeVertexNormals();

    const stations = STATION_LIST.map((s) => new Vector4(s.center.x, s.center.z, s.radius, 0));
    const mat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uNight = parkUniforms.uNight;
      sh.uniforms.uStations = { value: stations };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorldP;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           varying vec3 vWorldP;
           uniform float uNight;
           uniform vec4 uStations[${stations.length}];
           ${GLSL_HASH}
           ${GLSL_NOISE}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
           {
             vec2 xz = vWorldP.xz;
             float big = fbm2(xz * 0.035);
             float mid = fbm2(xz * 0.21 + 7.0);
             float fine = vnoise2(xz * 3.1);
             vec3 lush = vec3(0.13, 0.27, 0.07);
             vec3 dry = vec3(0.25, 0.29, 0.11);
             vec3 clover = vec3(0.07, 0.19, 0.06);
             vec3 g = mix(lush, dry, smoothstep(0.38, 0.72, big));
             g = mix(g, clover, smoothstep(0.55, 0.75, mid) * 0.6);
             g *= 0.82 + 0.36 * fine;
             // fallen petals: drifts (low-freq) × little oval petals (high-freq)
             float drift = smoothstep(0.45, 0.8, fbm2(xz * 0.09 + 31.0));
             vec2 cell = floor(xz * 22.0), f = fract(xz * 22.0) - 0.5;
             float ang = hash12(cell + 7.0) * 6.2832;
             f = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * (f - (vec2(hash12(cell + 1.0), hash12(cell + 2.0)) - 0.5) * 0.4);
             float shape = 1.0 - smoothstep(0.85, 1.0, length(f / vec2(0.2, 0.13)));
             float speck = step(0.86 - drift * 0.32, hash12(cell)) * shape;
             float soft = smoothstep(0.45, 0.85, vnoise2(xz * 9.0)) * drift;
             vec3 petal = mix(vec3(0.96, 0.62, 0.72), vec3(1.0, 0.84, 0.9), hash12(cell + 3.0));
             g = mix(g, petal, clamp(speck * (0.35 + drift * 0.5) + soft * 0.18, 0.0, 0.85));
             // story stations: lawn worn a little paler
             float worn = 0.0;
             for (int i = 0; i < ${stations.length}; i++) {
               float d = length(xz - uStations[i].xy);
               worn = max(worn, 1.0 - smoothstep(uStations[i].z * 0.5, uStations[i].z * 1.1, d));
             }
             g = mix(g, g * vec3(1.22, 1.14, 1.0) + vec3(0.025, 0.018, 0.0), worn * 0.45);
             diffuseColor.rgb = g;
           }`,
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = 0.9 + 0.1 * vnoise2(vWorldP.xz * 4.0);');
    };
    this.mesh = new Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);

    this.path = this.buildLane();
    scene.add(this.path);
  }

  /** Gravel ribbon along the lane with feathered, petal-strewn edges; it flares into the plaza. */
  buildLane() {
    const curve = laneCurve;
    const N = Math.ceil(laneLength / 1.2), across = 8;
    const pos = [], uv = [], idx = [];
    const t = new Vector3(), side = new Vector3();
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const c = curve.getPointAt(u);
      curve.getTangentAt(u, t);
      side.set(-t.z, 0, t.x).normalize();
      const w = PARK.laneWidth * (1 + 1.4 * Math.max(0, (u - 0.94) / 0.06) ** 2);
      for (let j = 0; j <= across; j++) {
        const s = (j / across - 0.5) * w;
        const x = c.x + side.x * s, z = c.z + side.z * s;
        pos.push(x, terrainHeight(x, z) + 0.012, z);
        uv.push(j / across, u * laneLength * 0.5);
      }
    }
    for (let i = 0; i < N; i++)
      for (let j = 0; j < across; j++) {
        const a = i * (across + 1) + j, b = a + across + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mat = new MeshStandardMaterial({ color: new Color(0.44, 0.37, 0.31), roughness: 1, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vPathUv;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvPathUv = uv;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec2 vPathUv;\n${GLSL_HASH}\n${GLSL_NOISE}`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
           float edge = abs(vPathUv.x - 0.5) * 2.0;
           float n = vnoise2(vPathUv * vec2(6.0, 3.0));
           float a = 1.0 - smoothstep(0.55 + n * 0.25, 1.0, edge);
           float grit = hash12(floor(vPathUv * vec2(70.0, 120.0)));
           diffuseColor.rgb *= 0.75 + 0.4 * grit;
           // petals blown onto the gravel, thicker toward the edges
           float pet = step(0.95 - edge * 0.08, hash12(floor(vPathUv * vec2(70.0, 120.0)) + 5.0));
           diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.97, 0.7, 0.78), pet * 0.85);
           diffuseColor.a = a;`,
        );
    };
    const mesh = new Mesh(g, mat);
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    return mesh;
  }

  dispose() {
    disposeObject(this.mesh);
    disposeObject(this.path);
  }
}
