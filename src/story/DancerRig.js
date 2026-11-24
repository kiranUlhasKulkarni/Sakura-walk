import { Bone, BufferAttribute, BufferGeometry, Color, DoubleSide, Euler, Matrix3, Matrix4, MeshStandardMaterial, Quaternion, Skeleton, SkinnedMesh, Vector3 } from 'three';
import { damp } from '../utils/math.js';

/**
 * dancer.glb is a static, vertex-coloured figure (no skeleton) split into six
 * interleaved fragments. To make her dance it is AUTO-RIGGED at load:
 *
 *  1. The fragments are merged into one mesh in the model's space and welded
 *     by position, giving one connected surface (a graph of edges).
 *  2. Joints are found from the body itself: the legs by tracking two
 *     clusters down horizontal slices below the crotch; the arms by GEODESIC
 *     distance (Dijkstra over the surface) from each hand — a hand resting
 *     against the hip is centimetres away in space but a whole arm + torso
 *     away along the skin, so hand and hip never get mixed up.
 *  3. Skin weights: arms by geodesic distance along the arm, legs and torso
 *     by height along their chain, all softly blended at the joints.
 *  4. Each vertex is labelled skin / hair / top / trousers / shoes from its
 *     colour and height, so every dancer can wear her own colours (each gets
 *     its own colour attribute; positions, skinning and indices are shared).
 *
 * The template is built once and shared by every dancer; each dancer gets its
 * own bones and a DanceRig (procedural choreography on the beat).
 */

const CHAIN = {
  hips: null, spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  shoulderL: 'chest', upperArmL: 'shoulderL', forearmL: 'upperArmL', handL: 'forearmL',
  shoulderR: 'chest', upperArmR: 'shoulderR', forearmR: 'upperArmR', handR: 'forearmR',
  thighL: 'hips', shinL: 'thighL', footL: 'shinL',
  thighR: 'hips', shinR: 'thighR', footR: 'shinR',
};
const NAMES = Object.keys(CHAIN);
const IDX = Object.fromEntries(NAMES.map((n, i) => [n, i]));
const REGION = { skin: 0, hair: 1, top: 2, pants: 3, shoes: 4, keep: 5 };

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Min-heap Dijkstra over the welded surface graph (CSR adjacency). */
function geodesic(n, blocked, adj, off, len, seeds) {
  const dist = new Float32Array(n).fill(Infinity);
  const heap = [];
  const push = (d, i) => {
    heap.push([d, i]);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p][0] <= heap[k][0]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  for (const s of seeds) {
    dist[s] = 0;
    push(0, s);
  }
  while (heap.length) {
    const [d, i] = pop();
    if (d > dist[i]) continue;
    for (let e = off[i]; e < off[i + 1]; e++) {
      const j = adj[e], nd = d + len[e];
      if (blocked[j]) continue;
      if (nd < dist[j]) {
        dist[j] = nd;
        push(nd, j);
      }
    }
  }
  return dist;
}

/** sRGB-ish hue / saturation / value of a linear colour (for classifying). */
function hsv(r, g, b) {
  const f = (c) => Math.pow(Math.max(0, c), 1 / 2.2);
  r = f(r);
  g = f(g);
  b = f(b);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-5) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, mx ? d / mx : 0, mx];
}

const templates = new WeakMap();

/** Build (once per source scene) the merged, auto-skinned dancer template. */
export function dancerTemplate(sourceScene) {
  if (templates.has(sourceScene)) return templates.get(sourceScene);
  sourceScene.updateMatrixWorld(true);
  const inv = new Matrix4().copy(sourceScene.matrixWorld).invert();
  const P = [], N = [], C = [], T = [];
  const v = new Vector3(), nm = new Matrix3(), m = new Matrix4();
  sourceScene.traverse((o) => {
    if (!o.isMesh) return;
    m.multiplyMatrices(inv, o.matrixWorld);
    nm.getNormalMatrix(m);
    const g = o.geometry, pa = g.attributes.position, na = g.attributes.normal, ca = g.attributes.color;
    const base = P.length / 3;
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i).applyMatrix4(m);
      P.push(v.x, v.y, v.z);
      if (na) {
        v.fromBufferAttribute(na, i).applyMatrix3(nm).normalize();
        N.push(v.x, v.y, v.z);
      } else N.push(0, 1, 0);
      if (ca) C.push(ca.getX(i), ca.getY(i), ca.getZ(i));
      else C.push(0.8, 0.8, 0.8);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) T.push(g.index.getX(i) + base);
    else for (let i = 0; i < pa.count; i++) T.push(i + base);
  });
  const n = P.length / 3;
  const X = (i) => P[i * 3], Y = (i) => P[i * 3 + 1], Z = (i) => P[i * 3 + 2];

  // ── weld by position → one connected surface ──
  const tol = 1e-5, map = new Map(), wid = new Int32Array(n);
  let W = 0;
  const rep = [];
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(X(i) / tol)},${Math.round(Y(i) / tol)},${Math.round(Z(i) / tol)}`;
    let k = map.get(key);
    if (k === undefined) {
      k = W++;
      map.set(key, k);
      rep.push(i);
    }
    wid[i] = k;
  }
  const edges = new Map();
  const addE = (a, b) => {
    if (a === b) return;
    const key = a < b ? a * W + b : b * W + a;
    if (!edges.has(key)) edges.set(key, [a, b]);
  };
  for (let t = 0; t < T.length; t += 3) {
    const a = wid[T[t]], b = wid[T[t + 1]], c = wid[T[t + 2]];
    addE(a, b);
    addE(b, c);
    addE(c, a);
  }
  const deg = new Int32Array(W + 1);
  for (const [a, b] of edges.values()) {
    deg[a + 1]++;
    deg[b + 1]++;
  }
  for (let i = 0; i < W; i++) deg[i + 1] += deg[i];
  const off = deg.slice(), fill = deg.slice(0, W), adj = new Int32Array(off[W]), len = new Float32Array(off[W]);
  for (const [a, b] of edges.values()) {
    const ra = rep[a], rb = rep[b];
    const d = Math.hypot(X(ra) - X(rb), Y(ra) - Y(rb), Z(ra) - Z(rb));
    adj[fill[a]] = b;
    len[fill[a]++] = d;
    adj[fill[b]] = a;
    len[fill[b]++] = d;
  }

  // ── proportions ──
  let minY = Infinity, maxY = -Infinity, cx = 0, cz = 0;
  for (let i = 0; i < n; i++) {
    minY = Math.min(minY, Y(i));
    maxY = Math.max(maxY, Y(i));
    cx += X(i);
    cz += Z(i);
  }
  cx /= n;
  cz /= n;
  const H = maxY - minY;
  const yAt = (f) => minY + f * H;
  const fOf = (y) => (y - minY) / H;
  // the model faces +Z, so her LEFT is +X (fwd × up = right = −X)

  // ── legs: two clusters tracked down horizontal slices (below the hands' reach) ──
  const fCrotch = 0.465, fLegTop = 0.4;
  const legTrack = []; // per slice: { f, L: [x, z], R: [x, z] }
  let cL = [cx + 0.075, cz], cR = [cx - 0.075, cz];
  for (let f = fLegTop; f > 0.0; f -= 0.02) {
    const pts = [];
    for (let k = 0; k < W; k++) {
      const i = rep[k], ff = fOf(Y(i));
      if (ff <= f && ff > f - 0.02) pts.push([X(i), Z(i)]);
    }
    if (pts.length < 6) continue;
    for (let it = 0; it < 6; it++) {
      const sL = [0, 0, 0], sR = [0, 0, 0];
      for (const [x, z] of pts) {
        const dL = (x - cL[0]) ** 2 + (z - cL[1]) ** 2, dR = (x - cR[0]) ** 2 + (z - cR[1]) ** 2;
        const q = dL < dR ? sL : sR;
        q[0] += x;
        q[1] += z;
        q[2]++;
      }
      if (sL[2]) cL = [sL[0] / sL[2], sL[1] / sL[2]];
      if (sR[2]) cR = [sR[0] / sR[2], sR[1] / sR[2]];
    }
    // near the feet the two legs may cross: keep them from swapping / merging
    if (Math.abs(cL[0] - cR[0]) < 0.03 && Math.abs(cL[1] - cR[1]) < 0.03) cL[0] += 0.02;
    legTrack.push({ f: f - 0.01, L: cL.slice(), R: cR.slice() });
  }
  const legAt = (s, f) => {
    let best = legTrack[0];
    for (const t of legTrack) if (Math.abs(t.f - f) < Math.abs(best.f - f)) best = t;
    return best[s];
  };
  // the cores of the thighs and the waist: the arms' geodesic search may not cross them
  // (a hand resting on the hip is fused to it in the scan — without this the "arm" spills down the leg)
  const blocked = new Uint8Array(W);
  for (let k = 0; k < W; k++) {
    const i = rep[k], f = fOf(Y(i));
    if (f < 0.53) {
      const ff = Math.min(f, fLegTop);
      for (const s of ['L', 'R']) {
        const c = legAt(s, ff);
        if (Math.hypot(X(i) - c[0], (Z(i) - c[1]) * 0.8) < 0.064) blocked[k] = 1;
      }
    }
    if (f > 0.5 && f < 0.775 && Math.abs(X(i) - cx) < 0.088) blocked[k] = 1;
  }

  // ── arms: geodesic distance from each hand ──
  const handSeed = (sign) => {
    let best = -1, bx = -Infinity;
    for (let k = 0; k < W; k++) {
      const i = rep[k], f = fOf(Y(i));
      if (f < 0.38 || f > 0.54 || blocked[k]) continue;
      const s = (X(i) - cx) * sign;
      if (s > bx) {
        bx = s;
        best = k;
      }
    }
    const p = rep[best], seeds = [];
    for (let k = 0; k < W; k++) {
      const i = rep[k];
      if (!blocked[k] && Math.hypot(X(i) - X(p), Y(i) - Y(p), Z(i) - Z(p)) < 0.03) seeds.push(k);
    }
    return seeds;
  };
  const geo = { L: geodesic(W, blocked, adj, off, len, handSeed(1)), R: geodesic(W, blocked, adj, off, len, handSeed(-1)) };
  const fShoulder = 0.795, fWrist = 0.505, fElbow = 0.625, fArmTop = 0.775;
  // the arm's geodesic length: from the hand to the shoulder's height on the outside of the arm
  const armLen = {};
  for (const s of ['L', 'R']) {
    const sign = s === 'L' ? 1 : -1;
    let best = Infinity;
    for (let k = 0; k < W; k++) {
      const i = rep[k];
      if (Math.abs(fOf(Y(i)) - fShoulder) < 0.012 && (X(i) - cx) * sign > 0.06) best = Math.min(best, geo[s][k]);
    }
    armLen[s] = Number.isFinite(best) ? best : 0.62;
  }
  // arm membership per welded vertex (1 on the arm, fading out over the shoulder); vertices the
  // search was barred from (the hand's inner face pressed to the hip) take their neighbours' value
  const arm = {};
  for (const s of ['L', 'R']) {
    const A = armLen[s], g = geo[s], m = new Float32Array(W);
    for (let k = 0; k < W; k++) {
      const i = rep[k], f = fOf(Y(i));
      // never below the fingertips, never across the body's midline (stray bits of fused geometry)
      const plausible = f > 0.37 && (X(i) - cx) * (s === 'L' ? 1 : -1) > 0.05;
      m[k] = blocked[k] || !plausible ? 0 : 1 - smooth(A * 0.9, A * 1.06, g[k]);
    }
    // fill only small holes INSIDE the arm (a barred vertex mostly surrounded by arm): a few
    // majority passes — never a diffusion, which would bleed the arm into the thigh it touches
    for (let it = 0; it < 3; it++)
      for (let k = 0; k < W; k++) {
        if (!blocked[k] || m[k] > 0.5) continue;
        let on = 0, c = 0;
        for (let e = off[k]; e < off[k + 1]; e++) {
          if (m[adj[e]] > 0.9) on++;
          c++;
        }
        if (c && on / c > 0.6) m[k] = 1;
      }
    arm[s] = m;
  }
  // the arms hang nearly straight down: joints sit at fixed body heights, on the arm's axis
  const armPoint = (s, f0, f1) => {
    const acc = new Vector3();
    let c = 0;
    for (let k = 0; k < W; k++) {
      const i = rep[k], f = fOf(Y(i));
      if (arm[s][k] > 0.9 && f >= f0 && f < f1) {
        acc.x += X(i);
        acc.y += Y(i);
        acc.z += Z(i);
        c++;
      }
    }
    return c ? acc.divideScalar(c) : null;
  };

  // ── joints (model space) ──
  const J = {};
  const legJ = (s, f) => {
    const [x, z] = legAt(s, f);
    return new Vector3(x, yAt(f), z);
  };
  const fKnee = 0.285, fAnkle = 0.06, fHip = 0.505;
  J.hips = new Vector3(cx, yAt(0.53), cz);
  J.spine = new Vector3(cx, yAt(0.6), cz);
  J.chest = new Vector3(cx, yAt(0.7), cz);
  J.neck = new Vector3(cx, yAt(0.815), cz - 0.01);
  J.head = new Vector3(cx, yAt(0.855), cz);
  for (const s of ['L', 'R']) {
    const sign = s === 'L' ? 1 : -1;
    const top = legJ(s, 0.44);
    J[`thigh${s}`] = new Vector3(top.x, yAt(fHip), top.z);
    J[`shin${s}`] = legJ(s, fKnee);
    J[`foot${s}`] = legJ(s, fAnkle);
    const wrist = armPoint(s, fWrist - 0.01, fWrist + 0.01) ?? new Vector3(cx + sign * 0.18, yAt(fWrist), cz);
    const elbow = armPoint(s, fElbow - 0.01, fElbow + 0.01) ?? new Vector3(cx + sign * 0.16, yAt(fElbow), cz);
    const shoulder = armPoint(s, fArmTop - 0.02, fArmTop) ?? new Vector3(cx + sign * 0.13, yAt(fArmTop), cz);
    shoulder.y = yAt(fArmTop + 0.01);
    J[`shoulder${s}`] = new Vector3(cx + sign * 0.04, yAt(0.785), cz);
    J[`upperArm${s}`] = shoulder;
    J[`forearm${s}`] = elbow;
    J[`hand${s}`] = wrist;
  }

  // ── skin weights ──
  const skinIndex = new Uint16Array(n * 4), skinWeight = new Float32Array(n * 4);
  const region = new Uint8Array(n);
  const armW = new Float32Array(n);
  const wv = new Float32Array(NAMES.length);
  const add = (name, w) => (wv[IDX[name]] += w);
  // piecewise blend along a chain of [boneName, startF] (heights ascending)
  const chain = (f, list, w) => {
    for (let j = 0; j < list.length; j++) {
      const [name, f0] = list[j];
      const f1 = j + 1 < list.length ? list[j + 1][1] : Infinity;
      const blendIn = j === 0 ? 1 : smooth(f0 - 0.02, f0 + 0.02, f);
      const blendOut = Number.isFinite(f1) ? 1 - smooth(f1 - 0.02, f1 + 0.02, f) : 1;
      const k = blendIn * blendOut;
      if (k > 0) add(name, k * w);
    }
  };
  const torso = [['hips', 0], ['spine', 0.575], ['chest', 0.665], ['neck', 0.8], ['head', 0.845]];
  for (let i = 0; i < n; i++) {
    wv.fill(0);
    const k = wid[i], f = fOf(Y(i));
    let rest = 1;
    for (const s of ['L', 'R']) {
      const a = arm[s][k]; // the arm, fading into the shoulder
      if (a <= 0.001) continue;
      const hand = 1 - smooth(fWrist - 0.02, fWrist + 0.02, f);
      const fore = smooth(fWrist - 0.02, fWrist + 0.02, f) * (1 - smooth(fElbow - 0.025, fElbow + 0.025, f));
      const upper = smooth(fElbow - 0.025, fElbow + 0.025, f) * (1 - smooth(fArmTop - 0.01, fArmTop + 0.04, f));
      const sh = smooth(fArmTop - 0.01, fArmTop + 0.04, f);
      add(`hand${s}`, a * hand);
      add(`forearm${s}`, a * fore);
      add(`upperArm${s}`, a * upper);
      add(`shoulder${s}`, a * sh);
      rest -= a;
    }
    rest = Math.max(0, rest);
    armW[i] = 1 - rest;
    if (rest > 0) {
      // legs below the crotch, blending into the hips above it
      const leg = 1 - smooth(fCrotch - 0.02, fCrotch + 0.05, f);
      if (leg > 0) {
        const ff = Math.min(f, fLegTop);
        const pL = legAt('L', ff), pR = legAt('R', ff);
        const dL = (X(i) - pL[0]) ** 2 + (Z(i) - pL[1]) ** 2, dR = (X(i) - pR[0]) ** 2 + (Z(i) - pR[1]) ** 2;
        const s = f > fCrotch ? (X(i) > cx ? 'L' : 'R') : dL < dR ? 'L' : 'R';
        chain(f, [[`foot${s}`, 0], [`shin${s}`, fAnkle + 0.02], [`thigh${s}`, fKnee]], rest * leg);
      }
      if (leg < 1) chain(f, torso, rest * (1 - leg));
    }
    // top four
    const order = [...wv.keys()].sort((a, b) => wv[b] - wv[a]).slice(0, 4);
    let sum = 0;
    for (const j of order) sum += wv[j];
    order.forEach((j, q) => {
      skinIndex[i * 4 + q] = j;
      skinWeight[i * 4 + q] = sum > 0 ? wv[j] / sum : q === 0 ? 1 : 0;
    });
    if (sum <= 0) skinIndex[i * 4] = IDX.hips;

    // ── wardrobe region ──
    const [h, sat, val] = hsv(C[i * 3], C[i * 3 + 1], C[i * 3 + 2]);
    const skinLike = h > 8 && h < 48 && sat > 0.1 && sat < 0.62 && val > 0.42;
    const onArm = arm.L[k] > 0.6 || arm.R[k] > 0.6;
    let r = REGION.keep;
    if (val < 0.18) r = REGION.keep; // choker, bracelets, laces: dark trims stay
    else if (f > 0.83) r = skinLike && f < 0.95 ? REGION.skin : REGION.hair;
    else if (onArm) r = skinLike || f > 0.45 ? REGION.skin : REGION.keep;
    else if (f > 0.665) r = skinLike ? REGION.skin : REGION.top;
    else if (f > 0.605) r = skinLike ? REGION.skin : REGION.pants;
    else if (f > 0.085) r = REGION.pants;
    else r = REGION.shoes;
    region[i] = r;
  }

  // per-region mean luminance (so recolouring keeps the painted shading)
  const lum = (i) => 0.2126 * C[i * 3] + 0.7152 * C[i * 3 + 1] + 0.0722 * C[i * 3 + 2];
  const mean = new Float32Array(6), cnt = new Float32Array(6);
  for (let i = 0; i < n; i++) {
    mean[region[i]] += lum(i);
    cnt[region[i]]++;
  }
  for (let r = 0; r < 6; r++) mean[r] = cnt[r] ? mean[r] / cnt[r] : 1;

  // triangles bridging an arm and the body (where a hand was fused to the hip) would stretch
  // into a sheet as soon as the arm moves: drop them (hidden contact faces in the rest pose)
  const T2 = [];
  for (let t = 0; t < T.length; t += 3) {
    const a = armW[T[t]], b = armW[T[t + 1]], c = armW[T[t + 2]];
    if (Math.max(a, b, c) - Math.min(a, b, c) < 0.4) T2.push(T[t], T[t + 1], T[t + 2]);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(P), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(N), 3));
  geometry.setAttribute('skinIndex', new BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new BufferAttribute(skinWeight, 4));
  geometry.setIndex(T2);
  geometry.computeBoundingSphere();
  const tpl = { geometry, joints: J, colors: new Float32Array(C), region, mean, lum, minY, H };
  templates.set(sourceScene, tpl);
  return tpl;
}

/** Eleven outfits, every one unique: hair, top, trousers, shoes, skin tone (× the scan's own). */
export const OUTFITS = [
  { hair: 0x1b1515, top: 0xc8102e, pants: 0x1d1d26, shoes: 0xf2f2f2, skin: 1.0 }, // crimson & black
  { hair: 0xe2bf6a, top: 0x1f8a5b, pants: 0xf1e6cf, shoes: 0xc9a36a, skin: 0.94 }, // emerald & cream, blonde
  { hair: 0x6e2a16, top: 0x8f74e0, pants: 0x1f2f5c, shoes: 0xffffff, skin: 1.03 }, // lavender & navy, auburn
  { hair: 0x3b2516, top: 0xf2b632, pants: 0x137070, shoes: 0x2b2b2b, skin: 0.8 }, // marigold & teal
  { hair: 0xcfcfe0, top: 0xff6f61, pants: 0x3a2a6e, shoes: 0xf5c6da, skin: 0.97 }, // coral & indigo, silver hair
  { hair: 0xe88fb0, top: 0x7ec8f0, pants: 0xf7f7f2, shoes: 0x7ec8f0, skin: 0.9 }, // sky blue & white, pink hair
  { hair: 0xf2e4b8, top: 0xff2d8a, pants: 0x4a4a55, shoes: 0x111111, skin: 1.06 }, // hot pink & slate, platinum
  { hair: 0x151c33, top: 0xfafafa, pants: 0xa3122a, shoes: 0xa3122a, skin: 0.68 }, // white & ruby, blue-black hair
  { hair: 0xc4571d, top: 0x9acd32, pants: 0x5b2a86, shoes: 0xe6e6e6, skin: 0.98 }, // lime & plum, ginger
  { hair: 0x7b3f1d, top: 0x1b2a6b, pants: 0xc9a227, shoes: 0x1b2a6b, skin: 0.86 }, // navy & mustard, chestnut
  { hair: 0x2b1b12, top: 0x1ab3a6, pants: 0xe37fa6, shoes: 0xffffff, skin: 0.62 }, // turquoise & rose
];

/**
 * The synchronized cheer routine (Act IV, part 1): every dancer — and the main
 * girl, through her arm targets (see cheerArms) — hits the same pose on the
 * same beat. One move per two bars (8 beats).
 */
export const CHEER = ['pomSwing', 'highVStep', 'ripple', 'clapKnee', 'diagSweep', 'finale'];
/** The six steps' names, as the routine announces them. */
export const CHEER_STEPS = {
  pomSwing: 'Pom swing',
  highVStep: 'High V & step-touch',
  ripple: 'Ripple turn',
  clapKnee: 'Clap & knee pop',
  diagSweep: 'Diagonal sweep',
  finale: 'Finale cheer',
};

/** Snappy beat hits: the limb snaps into the pose in the first fifth of a beat and holds it. */
const hit = (b) => {
  const f = b % 1;
  return f < 0.2 ? Math.sin((f / 0.2) * Math.PI * 0.5) : 1;
};

let sharedMaterial = null;

/**
 * Replace a dancer actor's static fragments with one skinned mesh in her own
 * outfit; attach a DanceRig as the actor's pose (Actor.update drives it).
 */
export function rigDancer(actor, sourceScene, outfit) {
  const tpl = dancerTemplate(sourceScene);
  const model = actor.model;
  // drop the static fragments (their geometry belongs to the shared glTF source)
  const olds = [];
  model.traverse((o) => o.isMesh && olds.push(o));
  for (const o of olds) o.removeFromParent();
  // bones at the template's joints (identity rest rotations: local axes = model axes)
  const bones = {};
  for (const name of NAMES) {
    const b = new Bone();
    b.name = `dancer_${name}`;
    bones[name] = b;
  }
  for (const name of NAMES) {
    const parent = CHAIN[name];
    const b = bones[name];
    const p = tpl.joints[name];
    if (parent) {
      b.position.copy(p).sub(tpl.joints[parent]);
      bones[parent].add(b);
    } else {
      b.position.copy(p);
    }
  }
  // her colours
  const pal = [null, new Color(outfit.hair), new Color(outfit.top), new Color(outfit.pants), new Color(outfit.shoes)];
  const src = tpl.colors, n = src.length / 3, col = new Float32Array(src.length);
  for (let i = 0; i < n; i++) {
    const r = tpl.region[i];
    if (r === REGION.skin) {
      for (let c = 0; c < 3; c++) col[i * 3 + c] = src[i * 3 + c] * outfit.skin;
    } else if (r === REGION.keep) {
      for (let c = 0; c < 3; c++) col[i * 3 + c] = src[i * 3 + c];
    } else {
      const shade = Math.min(1.6, Math.max(0.35, tpl.lum(i) / tpl.mean[r]));
      col[i * 3] = pal[r].r * shade;
      col[i * 3 + 1] = pal[r].g * shade;
      col[i * 3 + 2] = pal[r].b * shade;
    }
  }
  const g = new BufferGeometry();
  for (const k of ['position', 'normal', 'skinIndex', 'skinWeight']) g.setAttribute(k, tpl.geometry.attributes[k]);
  g.setIndex(tpl.geometry.index);
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.boundingSphere = tpl.geometry.boundingSphere;
  sharedMaterial ??= new MeshStandardMaterial({ name: 'dancer-cloth', vertexColors: true, roughness: 0.72, metalness: 0, side: DoubleSide });
  const mesh = new SkinnedMesh(g, sharedMaterial);
  mesh.name = 'dancer';
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  model.add(bones.hips);
  model.add(mesh);
  model.updateMatrixWorld(true);
  mesh.bind(new Skeleton(NAMES.map((nm) => bones[nm])), mesh.matrixWorld);
  actor.pose = new DanceRig(actor, bones, tpl);
  return actor.pose;
}

const _e = new Euler(), _q = new Quaternion();

/**
 * Procedural choreography for one auto-rigged dancer, on the beat.
 * Moves (each a pose as a function of the beat): groove (bounce + hip sway),
 * pump (fists punching up), wave (both hands high, swaying), clap,
 * step-touch, spin, and a walk for getting to her spot. Successive moves are
 * cross-faded over a beat. Signs in the model frame (+X her left, +Z front):
 * arm out = ±Z rotation, arm/thigh forward = −X, elbow bend = −X, knee bend = +X.
 */
export class DanceRig {
  constructor(actor, bones, tpl) {
    this.actor = actor;
    this.bones = bones;
    this.restPos = new Map(Object.values(bones).map((b) => [b, b.position.clone()]));
    this.hipsRest = bones.hips.position.clone();
    this.scale = tpl.H; // model units per body height
    this.bpm = 145;
    this.beat = Math.random() * 4;
    this.energy = 0; // 0 = standing still … 1 = full out
    this.want = 0;
    this.routine = ['groove', 'pump', 'groove', 'clap', 'step', 'wave', 'spin', 'pump'];
    this.offset = 0;
    this.bodyWeight = 1;
    this.spin = 0;
    this.walkPh = 0;
  }

  /** Join the synchronized routine: same beat, same moves as everybody else. */
  sync(beat = 0, routine = CHEER) {
    this.beat = beat;
    this.offset = 0;
    this.routine = routine;
    this.freestyle = false;
  }

  /** Free dancing: her own order of moves, out of step with the others. */
  freestyleMode(seed = 0) {
    const pool = ['groove', 'pump', 'wave', 'clap', 'step', 'spin', 'punch', 'hips', 'groove', 'wave'];
    this.routine = pool.map((m, i) => pool[(i * 7 + seed * 3) % pool.length]);
    this.offset = seed * 1.37;
    this.freestyle = true;
  }

  restore() {
    for (const [b, p] of this.restPos) {
      b.quaternion.identity();
      b.position.copy(p);
    }
  }

  /** Joint angles of move `name` at beat position `b` (writes into `o`). */
  move(name, b, o) {
    const TAU = Math.PI * 2;
    const ph = b % 1;
    const down = Math.pow(0.5 + 0.5 * Math.cos(TAU * ph), 2); // 1 on the beat
    const sway = Math.sin((TAU * b) / 2); // two beats per side
    // groove underneath everything
    o.bounce = down * 0.035;
    o.hipsZ = sway * 0.09;
    o.hipsX = sway * 0.025; // side shift (in body heights, applied along X)
    o.chestZ = -sway * 0.06;
    o.chestY = sway * 0.1;
    o.headX = down * 0.08;
    o.knee = down * 0.32;
    o.upperL = [0, 0, 0.18 + 0.05 * down];
    o.upperR = [0, 0, -0.18 - 0.05 * down];
    o.foreL = [-0.35 - 0.25 * Math.max(0, sway), 0, 0];
    o.foreR = [-0.35 - 0.25 * Math.max(0, -sway), 0, 0];
    o.legL = 0;
    o.legR = 0;
    o.stepX = 0;
    o.kneeStraight = 0; // 1: legs kick out straight
    o.pivot = 0; // hips turn (rad) for pivoting footwork
    if (name === 'pump') {
      // fists punch up on alternate beats
      const pL = Math.max(0, Math.sin(TAU * b * 0.5)), pR = Math.max(0, -Math.sin(TAU * b * 0.5));
      o.upperL = [-0.4 - 1.9 * pL, 0, 0.35];
      o.upperR = [-0.4 - 1.9 * pR, 0, -0.35];
      o.foreL = [-1.3 + 1.0 * pL, 0, 0];
      o.foreR = [-1.3 + 1.0 * pR, 0, 0];
      o.chestY *= 0.5;
    } else if (name === 'wave') {
      // both hands high, swaying with the body
      o.upperL = [-0.2, 0, 2.55 + sway * 0.25];
      o.upperR = [-0.2, 0, -2.55 + sway * 0.25];
      o.foreL = [-0.25, 0, 0];
      o.foreR = [-0.25, 0, 0];
      o.chestZ = sway * 0.12;
      o.hipsZ = -sway * 0.08;
    } else if (name === 'clap') {
      // hands meet in front of the chest on every other beat
      const c = Math.pow(0.5 + 0.5 * Math.cos(TAU * ph), 6) * (Math.floor(b) % 2 ? 1 : 0.4);
      o.upperL = [-0.95, 0, 0.1 - 0.35 * c];
      o.upperR = [-0.95, 0, -0.1 + 0.35 * c];
      o.foreL = [-0.85, -0.5 * c, 0];
      o.foreR = [-0.85, 0.5 * c, 0];
    } else if (name === 'step') {
      // step-touch side to side, the touching leg lifting, arms swinging across
      const s = Math.sin((TAU * b) / 2);
      o.stepX = s * 0.09;
      o.legL = Math.max(0, -Math.cos(TAU * b * 0.5)) * 0.55 * (s > 0 ? 0 : 1);
      o.legR = Math.max(0, Math.cos(TAU * b * 0.5)) * 0.55 * (s > 0 ? 1 : 0);
      o.upperL = [-0.6 * s, 0, 0.25];
      o.upperR = [0.6 * s, 0, -0.25];
      o.foreL = [-1.0, 0, 0];
      o.foreR = [-1.0, 0, 0];
    } else if (name === 'pomSwing') {
      // 1 — opening pom swing: both arms swung together to one side, then the other, on the beat,
      // a crisp bounce under it
      const side = Math.floor(b) % 2 ? 1 : -1, h = hit(b);
      const sw = side * (0.25 + 0.95 * h); // + = toward her left
      o.upperL = [-0.55, 0, 0.3 + Math.max(0, sw)];
      o.upperR = [-0.55, 0, -0.3 + Math.min(0, sw)];
      o.foreL = [-0.35, 0, 0];
      o.foreR = [-0.35, 0, 0];
      o.chestY = sw * 0.12;
      o.chestZ = -sw * 0.05;
      o.knee *= 1.25;
    } else if (name === 'highVStep') {
      // 2 — high V on beats 1 & 3, hands clasped overhead on 2 & 4, with a step-touch to the side
      const k = Math.floor(b) % 4, h = hit(b);
      const clasp = k % 2 ? h : 0, vee = k % 2 ? 0 : h;
      o.upperL = [-0.2, 0, 0.4 + 2.0 * vee + 2.45 * clasp];
      o.upperR = [-0.2, 0, -0.4 - 2.0 * vee - 2.45 * clasp];
      o.foreL = [-0.15 - 0.1 * clasp, 0, 0.35 * clasp];
      o.foreR = [-0.15 - 0.1 * clasp, 0, -0.35 * clasp];
      const s2 = Math.sin((Math.PI * b) / 2);
      o.stepX = s2 * 0.08;
      o.legL = Math.max(0, -Math.cos(Math.PI * b * 0.5)) * 0.4 * (s2 > 0 ? 0 : 1);
      o.legR = Math.max(0, Math.cos(Math.PI * b * 0.5)) * 0.4 * (s2 > 0 ? 1 : 0);
    } else if (name === 'ripple') {
      // 3 — the ripple: arms rise in a wave as the quarter turn passes through her (DanceRig.apply
      // turns her, delayed by her place in the formation)
      const r = this.rippleK ?? 0;
      o.upperL = [-0.3, 0, 0.35 + 2.1 * r];
      o.upperR = [-0.3, 0, -0.35 - 2.1 * r];
      o.foreL = [-0.4 * (1 - r), 0, 0];
      o.foreR = [-0.4 * (1 - r), 0, 0];
      o.chestZ = 0;
    } else if (name === 'clapKnee') {
      // 4 — claps in front of the chest on every beat, a knee popping in on the off-beat,
      // shoulders bouncing
      const c = Math.pow(0.5 + 0.5 * Math.cos(Math.PI * 2 * (b % 1)), 5);
      o.upperL = [-0.9, 0, 0.08 - 0.3 * c];
      o.upperR = [-0.9, 0, -0.08 + 0.3 * c];
      o.foreL = [-1.0, -0.45 * c, 0];
      o.foreR = [-1.0, 0.45 * c, 0];
      const pop = Math.pow(Math.max(0, Math.sin(Math.PI * 2 * (b % 1) + Math.PI)), 2);
      if (Math.floor(b) % 2) o.legL = pop * 0.25;
      else o.legR = pop * 0.25;
      o.chestZ = (Math.floor(b) % 2 ? 1 : -1) * 0.05 * pop;
    } else if (name === 'diagSweep') {
      // 5 — a diagonal sweep: both arms from low on one side up to high on the other over two
      // beats, the hips pivoting with it (footwork that opens the formation)
      const ph = (b % 4) / 4, up = Math.sin(Math.PI * Math.min(1, ph * 2));
      const side = ph < 0.5 ? 1 : -1;
      const z = side * (-0.6 + 2.2 * up);
      o.upperL = [-0.35, 0, Math.max(0.25, z)];
      o.upperR = [-0.35, 0, Math.min(-0.25, z)];
      o.foreL = [-0.2, 0, 0];
      o.foreR = [-0.2, 0, 0];
      o.pivot = side * 0.45 * up;
    } else if (name === 'finale') {
      // 6 — the finale cheer: a sharp high V hit on the first beat and HELD, one foot pointed out
      const h = hit(Math.min(b % 8, 0.99));
      o.upperL = [-0.1, 0, 0.35 + 2.2 * h];
      o.upperR = [-0.1, 0, -0.35 - 2.2 * h];
      o.foreL = [-0.05, 0, 0];
      o.foreR = [-0.05, 0, 0];
      o.legR = 0.18 * h;
      o.kneeStraight = 1;
      o.knee *= 0.3;
      o.hipsZ = 0;
      o.chestY = 0;
    } else if (name === 'cheerV') {
      // a sharp high V: both arms flung up and out on every other beat, punched down to the hips between
      const up = Math.floor(b) % 2 === 0 ? hit(b) : 1 - hit(b);
      o.upperL = [-0.15, 0, 0.35 + 2.15 * up];
      o.upperR = [-0.15, 0, -0.35 - 2.15 * up];
      o.foreL = [-0.1 - 0.9 * (1 - up), 0, 0];
      o.foreR = [-0.1 - 0.9 * (1 - up), 0, 0];
      o.chestZ = 0;
      o.hipsZ *= 0.4;
    } else if (name === 'punch') {
      // fists punched straight up, left – right – both – both
      const k = Math.floor(b) % 4, h = hit(b);
      const L = k === 0 || k >= 2 ? h : 0.1, R = k === 1 || k >= 2 ? h : 0.1;
      o.upperL = [-0.25 - 2.6 * L, 0, 0.25];
      o.upperR = [-0.25 - 2.6 * R, 0, -0.25];
      o.foreL = [-1.4 + 1.3 * L, 0, 0];
      o.foreR = [-1.4 + 1.3 * R, 0, 0];
      o.knee *= 1.3;
    } else if (name === 'clapHigh') {
      // claps over the head on every beat
      const c = Math.pow(0.5 + 0.5 * Math.cos(Math.PI * 2 * (b % 1)), 4);
      o.upperL = [-0.3, 0, 2.7 - 0.25 * c];
      o.upperR = [-0.3, 0, -2.7 + 0.25 * c];
      o.foreL = [-0.35, 0, 0.45 * c];
      o.foreR = [-0.35, 0, -0.45 * c];
    } else if (name === 'hips') {
      // hands on hips, a hip pop to each side on the beat, the head snapping with it
      const side = Math.floor(b) % 2 ? 1 : -1, h = hit(b);
      o.upperL = [0.1, 0, 0.75];
      o.upperR = [0.1, 0, -0.75];
      o.foreL = [-1.9, 0.9, 0];
      o.foreR = [-1.9, -0.9, 0];
      o.hipsX = side * 0.05 * h;
      o.hipsZ = side * 0.16 * h;
      o.chestZ = -side * 0.08 * h;
    } else if (name === 'kick') {
      // high kicks, alternate legs, arms in a T
      const k = Math.floor(b) % 2, h = Math.sin(Math.PI * Math.min(1, (b % 1) / 0.6));
      o.legL = k === 0 ? h * 1.25 : 0;
      o.legR = k === 1 ? h * 1.25 : 0;
      o.kneeStraight = 1;
      o.upperL = [0, 0, 1.55];
      o.upperR = [0, 0, -1.55];
      o.foreL = [0, 0, 0];
      o.foreR = [0, 0, 0];
      o.knee *= 0.4;
    } else if (name === 'spin') {
      // arms open as she turns
      o.upperL = [-0.3, 0, 1.25];
      o.upperR = [-0.3, 0, -1.25];
      o.foreL = [-0.3, 0, 0];
      o.foreR = [-0.3, 0, 0];
    }
    return o;
  }

  apply(dt, speed = 0) {
    const bn = this.bones;
    this.beat += (dt * this.bpm) / 60;
    this.energy += (this.want - this.energy) * damp(2.5, dt);
    const b = this.beat + this.offset;
    const bar = Math.floor(b / 8);
    const cur = this.routine[bar % this.routine.length], next = this.routine[(bar + 1) % this.routine.length];
    const A = this.move(cur, b, {}), B = this.move(next, b, {});
    const x = smooth(7, 8, b % 8); // cross-fade over the bar's last beat
    const mix = (a, c) => (Array.isArray(a) ? a.map((v, i) => v + (c[i] - v) * x) : a + (c - a) * x);
    const o = {};
    for (const k of Object.keys(A)) o[k] = mix(A[k], B[k]);
    const e = this.energy;
    // spin: one full turn over the spin bar's middle four beats
    const inBar = b % 8;
    // the ripple: a quarter turn and back, passing through the formation (each dancer's delay)
    if (cur === 'ripple') {
      const lb = inBar - (this.ripple ?? 0);
      this.rippleK = Math.max(0, Math.sin(Math.PI * Math.min(1, Math.max(0, lb / 4))));
    } else this.rippleK = 0;
    const spin = cur === 'spin' ? smooth(2, 6, inBar) * Math.PI * 2 : cur === 'ripple' ? this.rippleK * Math.PI * 0.5 : 0;

    // walking to her spot (a simple gait), dancing fades out while she walks
    const walk = Math.min(1, speed / 1.1);
    this.walkPh += dt * speed * 3.4;
    const wl = Math.sin(this.walkPh), wr = -wl;
    const d = e * (1 - walk);

    const H = this.scale;
    const hp = bn.hips.position.copy(this.hipsRest);
    hp.y -= (o.bounce * d + Math.abs(Math.cos(this.walkPh)) * 0.012 * walk) * H;
    hp.x += (o.hipsX + o.stepX) * d * H;
    const rot = (bone, x, y, z) => {
      _e.set(x, y, z, 'XYZ');
      bone.quaternion.multiply(_q.setFromEuler(_e));
    };
    rot(bn.hips, 0, (spin + (o.pivot ?? 0)) * d, o.hipsZ * d);
    rot(bn.spine, 0.04 * walk, o.chestY * d * 0.5, -o.hipsZ * d * 0.5);
    rot(bn.chest, 0, o.chestY * d * 0.5 - wl * 0.08 * walk, o.chestZ * d);
    rot(bn.head, o.headX * d, 0, -o.chestZ * d * 0.5);
    for (const s of ['L', 'R']) {
      const up = s === 'L' ? o.upperL : o.upperR, fo = s === 'L' ? o.foreL : o.foreR;
      const swing = (s === 'L' ? wr : wl) * 0.35 * walk; // arms swing against the legs
      const side = s === 'L' ? 1 : -1;
      rot(bn[`upperArm${s}`], up[0] * d - swing, up[1] * d, up[2] * d + side * 0.12 * walk);
      rot(bn[`forearm${s}`], fo[0] * d - 0.25 * walk, fo[1] * d, fo[2] * d);
      // legs: the bounce bends both knees (hips forward, shins back) so the feet stay planted
      const lift = s === 'L' ? o.legL : o.legR;
      const stride = (s === 'L' ? wl : wr) * 0.42 * walk;
      const kneeW = Math.max(0, -Math.cos(this.walkPh + (s === 'L' ? 0 : Math.PI))) * 0.6 * walk;
      rot(bn[`thigh${s}`], -(o.knee * 0.5 + lift * 0.9) * d - stride, 0, -o.hipsZ * d);
      rot(bn[`shin${s}`], (o.knee + lift * (1.5 - 1.35 * o.kneeStraight)) * d + kneeW, 0, 0);
      rot(bn[`foot${s}`], -(o.knee * 0.5 + lift * 0.4) * d, 0, 0);
    }
  }
}
