import {
  BoxGeometry,
  CanvasTexture,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mulberry32 } from '../utils/math.js';

/**
 * The hanami picnic spread (Act II), modelled in code at real-world scale
 * (metres): a sushi geta board, an onigiri plate, a two-tier lacquered bento
 * and an opened single bento, hanami dango, a teapot with two cups. Each
 * dish is its own Group so the act can reveal them one by one, and props
 * that get picked up (an onigiri, a dango skewer) are exposed by name.
 */
const mats = {};
function mat(key, color, opts = {}) {
  if (!mats[key]) mats[key] = new MeshStandardMaterial({ color: new Color(color), roughness: 0.6, ...opts });
  return mats[key];
}
const M = {
  rice: () => mat('rice', 0xf4f1ea, { roughness: 0.85 }),
  nori: () => mat('nori', 0x1b2318, { roughness: 0.55 }),
  salmon: () => mat('salmon', 0xf27a4f, { roughness: 0.35 }),
  tuna: () => mat('tuna', 0xb3233a, { roughness: 0.3 }),
  ebi: () => mat('ebi', 0xf0784a, { roughness: 0.4 }),
  tamago: () => mat('tamago', 0xf2c84a, { roughness: 0.6 }),
  cucumber: () => mat('cucumber', 0x6aa84f, { roughness: 0.5 }),
  wasabi: () => mat('wasabi', 0x9cc36b, { roughness: 0.8 }),
  ginger: () => mat('ginger', 0xf4b4b8, { roughness: 0.5 }),
  wood: () => mat('wood', 0xc9a06a, { roughness: 0.75 }),
  woodDark: () => mat('woodDark', 0x7a5432, { roughness: 0.7 }),
  lacquer: () => mat('lacquer', 0x140a0a, { roughness: 0.25 }),
  lacquerRed: () => mat('lacquerRed', 0x8e1420, { roughness: 0.3 }),
  gold: () => mat('gold', 0xd4a64a, { roughness: 0.3, metalness: 0.8 }),
  karaage: () => mat('karaage', 0x9a5a22, { roughness: 0.9 }),
  broccoli: () => mat('broccoli', 0x3f7a2a, { roughness: 0.9 }),
  tomato: () => mat('tomato', 0xd8241c, { roughness: 0.25 }),
  carrot: () => mat('carrot', 0xf07a1e, { roughness: 0.6 }),
  sausage: () => mat('sausage', 0xd2453a, { roughness: 0.45 }),
  ume: () => mat('ume', 0xb01e3a, { roughness: 0.4 }),
  dangoPink: () => mat('dangoPink', 0xf6a9bf, { roughness: 0.7 }),
  dangoWhite: () => mat('dangoWhite', 0xf7f3ea, { roughness: 0.7 }),
  dangoGreen: () => mat('dangoGreen', 0x9cc27a, { roughness: 0.7 }),
  bamboo: () => mat('bamboo', 0xd9c48c, { roughness: 0.7 }),
  plate: () => mat('plate', 0xf3eee6, { roughness: 0.3 }),
  plateBlue: () => mat('plateBlue', 0x2d4a7a, { roughness: 0.3 }),
  clay: () => mat('clay', 0x5a3a2c, { roughness: 0.5 }),
  tea: () => mat('tea', 0x8fa84a, { roughness: 0.1 }),
  leaf: () => mat('leaf', 0x4f7a32, { roughness: 0.6 }),
};

const mesh = (g, m, x = 0, y = 0, z = 0) => {
  const o = new Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
};

/** A slice of fish draped over the rice (a thin, curved box). */
function fishSlice(len, wid, material, stripes = false) {
  const g = new BoxGeometry(len, 0.006, wid, 8, 1, 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / (len / 2);
    p.setY(i, p.getY(i) - x * x * 0.006); // drape over the ends
  }
  g.computeVertexNormals();
  const s = mesh(g, material);
  if (stripes) {
    // the white fat lines of salmon
    for (let k = -2; k <= 2; k++) {
      const line = mesh(new BoxGeometry(0.0025, 0.0065, wid * 0.98), M.rice(), k * len * 0.18, 0.0004, 0);
      line.rotation.y = 0.5;
      s.add(line);
    }
  }
  return s;
}

function nigiri(topping) {
  const g = new Group();
  const rice = mesh(new RoundedBoxGeometry(0.052, 0.022, 0.026, 3, 0.009), M.rice(), 0, 0.011, 0);
  g.add(rice);
  const fish =
    topping === 'salmon' ? fishSlice(0.062, 0.03, M.salmon(), true) : topping === 'tuna' ? fishSlice(0.062, 0.03, M.tuna()) : topping === 'ebi' ? fishSlice(0.064, 0.026, M.ebi(), true) : mesh(new RoundedBoxGeometry(0.058, 0.014, 0.03, 2, 0.004), M.tamago());
  fish.position.y = topping === 'tamago' ? 0.028 : 0.025;
  g.add(fish);
  if (topping === 'tamago') g.add(mesh(new BoxGeometry(0.012, 0.042, 0.032), M.nori(), 0, 0.02, 0)); // nori belt
  return g;
}

function maki(fill) {
  const g = new Group();
  g.add(mesh(new CylinderGeometry(0.017, 0.017, 0.024, 20, 1, true), M.nori(), 0, 0.012, 0));
  g.add(mesh(new CylinderGeometry(0.0165, 0.0165, 0.023, 20), M.rice(), 0, 0.012, 0));
  g.add(mesh(new CylinderGeometry(0.006, 0.006, 0.0235, 10), fill, 0, 0.012, 0));
  return g;
}

/** A rounded-triangle onigiri with its nori wrap. */
export function onigiri() {
  const s = new Shape();
  const R = 0.034;
  const pts = [0, 1, 2].map((i) => new Vector2(Math.cos(Math.PI / 2 + (i * 2 * Math.PI) / 3) * R, Math.sin(Math.PI / 2 + (i * 2 * Math.PI) / 3) * R));
  // rounded corners
  s.moveTo(pts[0].x * 0.8 + pts[1].x * 0.2, pts[0].y * 0.8 + pts[1].y * 0.2);
  for (let i = 0; i < 3; i++) {
    const a = pts[i], b = pts[(i + 1) % 3], c = pts[(i + 2) % 3];
    s.lineTo(a.x * 0.2 + b.x * 0.8, a.y * 0.2 + b.y * 0.8);
    s.quadraticCurveTo(b.x, b.y, b.x * 0.8 + c.x * 0.2, b.y * 0.8 + c.y * 0.2);
  }
  const g = new Group();
  const body = mesh(new ExtrudeGeometry(s, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 4, curveSegments: 8 }), M.rice());
  body.geometry.translate(0, 0, -0.011);
  g.add(body);
  const nori = mesh(new BoxGeometry(0.034, 0.03, 0.04), M.nori(), 0, -0.022, 0);
  g.add(nori);
  g.rotation.x = -0.25; // leaning back a little, standing on its edge
  const wrap = new Group();
  wrap.add(g);
  g.position.y = 0.036;
  return wrap;
}

/** Hanami dango: pink, white and green rice dumplings on a bamboo skewer. */
export function dango() {
  const g = new Group();
  g.add(mesh(new CylinderGeometry(0.002, 0.002, 0.15, 6), M.bamboo(), 0, 0, 0));
  [M.dangoGreen(), M.dangoWhite(), M.dangoPink()].forEach((m, i) => g.add(mesh(new SphereGeometry(0.0145, 16, 12), m, 0, -0.035 + i * 0.03, 0)));
  return g;
}

function plate(r = 0.09, material = M.plate()) {
  const pts = [new Vector2(0, 0), new Vector2(r * 0.7, 0), new Vector2(r * 0.75, 0.004), new Vector2(r, 0.012), new Vector2(r * 0.98, 0.015), new Vector2(r * 0.72, 0.007), new Vector2(0, 0.007)];
  return mesh(new LatheGeometry(pts, 32), material);
}

/** The sushi geta: a wooden serving board on two feet, nigiri + maki, wasabi and gari. */
function sushiBoard(rnd) {
  const g = new Group();
  g.add(mesh(new BoxGeometry(0.36, 0.018, 0.17), M.wood(), 0, 0.029, 0));
  for (const x of [-0.13, 0.13]) g.add(mesh(new BoxGeometry(0.03, 0.02, 0.16), M.woodDark(), x, 0.01, 0));
  const top = 0.038;
  const kinds = ['salmon', 'tuna', 'ebi', 'tamago', 'salmon', 'tuna'];
  g.userData.nigiri = [];
  kinds.forEach((k, i) => {
    const n = nigiri(k);
    g.userData.nigiri.push(n);
    n.position.set(-0.13 + i * 0.045, top, -0.035);
    n.rotation.y = Math.PI / 2 + (rnd() - 0.5) * 0.1;
    g.add(n);
  });
  [M.cucumber(), M.salmon(), M.tamago(), M.tuna()].forEach((f, i) => {
    const m = maki(f);
    m.position.set(-0.11 + i * 0.038, top, 0.045);
    g.add(m);
  });
  const w = mesh(new SphereGeometry(0.012, 10, 8), M.wasabi(), 0.115, top + 0.004, 0.045);
  w.scale.set(1, 0.6, 1.2);
  g.add(w);
  for (let i = 0; i < 4; i++) {
    const s = mesh(new CylinderGeometry(0.014, 0.014, 0.002, 12), M.ginger(), 0.145, top + 0.003 + i * 0.003, 0.04 + i * 0.004);
    s.rotation.z = 0.3;
    g.add(s);
  }
  return g;
}

/** One opened bento: black lacquer outside, red inside, four compartments of colourful food. */
function bento(rnd, { tiers = 1, lidSide = 1 } = {}) {
  const g = new Group();
  const W = 0.2, D = 0.14, H = 0.05;
  for (let t = 0; t < tiers; t++) {
    const tier = new Group();
    tier.position.y = t * H;
    const wall = 0.006;
    tier.add(mesh(new BoxGeometry(W, 0.006, D), M.lacquer(), 0, 0.003, 0));
    tier.add(mesh(new BoxGeometry(W, H, wall), M.lacquer(), 0, H / 2, D / 2 - wall / 2));
    tier.add(mesh(new BoxGeometry(W, H, wall), M.lacquer(), 0, H / 2, -D / 2 + wall / 2));
    tier.add(mesh(new BoxGeometry(wall, H, D), M.lacquer(), W / 2 - wall / 2, H / 2, 0));
    tier.add(mesh(new BoxGeometry(wall, H, D), M.lacquer(), -W / 2 + wall / 2, H / 2, 0));
    tier.add(mesh(new BoxGeometry(W - 0.014, 0.002, D - 0.014), M.lacquerRed(), 0, 0.007, 0)); // red inside
    tier.add(mesh(new BoxGeometry(0.003, H * 0.8, D - 0.014), M.lacquerRed(), -0.01, H * 0.42, 0)); // divider
    g.add(tier);
  }
  const base = (tiers - 1) * H;
  if (tiers === 1 || true) {
    const y = base + 0.008;
    // rice with an umeboshi + black sesame
    const rice = mesh(new RoundedBoxGeometry(0.084, 0.03, 0.118, 3, 0.01), M.rice(), -0.053, y + 0.015, 0);
    g.add(rice);
    g.add(mesh(new SphereGeometry(0.011, 12, 10), M.ume(), -0.053, y + 0.033, 0));
    for (let i = 0; i < 14; i++) g.add(mesh(new SphereGeometry(0.0015, 4, 3), M.lacquer(), -0.053 + (rnd() - 0.5) * 0.07, y + 0.031, (rnd() - 0.5) * 0.1));
    // tamagoyaki roll slices
    for (let i = 0; i < 3; i++) {
      const tm = mesh(new RoundedBoxGeometry(0.026, 0.024, 0.014, 2, 0.004), M.tamago(), 0.025, y + 0.012, -0.04 + i * 0.016);
      g.add(tm);
    }
    // karaage
    for (let i = 0; i < 3; i++) {
      const k = mesh(new SphereGeometry(0.014, 8, 6), M.karaage(), 0.065 + (rnd() - 0.5) * 0.01, y + 0.012, -0.035 + i * 0.022);
      k.scale.set(1, 0.8, 1.1);
      g.add(k);
    }
    // broccoli, cherry tomatoes, sakura-cut carrot, octopus sausages
    for (let i = 0; i < 2; i++) {
      const br = new Group();
      br.add(mesh(new CylinderGeometry(0.004, 0.005, 0.016, 6), M.cucumber(), 0, 0.008, 0));
      br.add(mesh(new SphereGeometry(0.011, 8, 6), M.broccoli(), 0, 0.019, 0));
      br.position.set(0.02 + i * 0.022, y, 0.03);
      g.add(br);
    }
    g.add(mesh(new SphereGeometry(0.011, 12, 10), M.tomato(), 0.074, y + 0.011, 0.04));
    g.add(mesh(new SphereGeometry(0.01, 12, 10), M.tomato(), 0.06, y + 0.011, 0.055));
    const flower = new Shape();
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10) * Math.PI * 2, r = i % 2 ? 0.006 : 0.012;
      i ? flower.lineTo(Math.cos(a) * r, Math.sin(a) * r) : flower.moveTo(r, 0);
    }
    const carrot = mesh(new ExtrudeGeometry(flower, { depth: 0.004, bevelEnabled: false }), M.carrot(), 0.0, y + 0.028, 0.045);
    carrot.rotation.x = -Math.PI / 2;
    g.add(carrot);
    for (let i = 0; i < 2; i++) {
      const s = new Group();
      s.add(mesh(new CapsuleGeometry(0.008, 0.012, 4, 8), M.sausage(), 0, 0.016, 0));
      for (let l = 0; l < 6; l++) {
        const leg = mesh(new CylinderGeometry(0.002, 0.003, 0.012, 5), M.sausage(), Math.cos(l) * 0.007, 0.004, Math.sin(l) * 0.007);
        leg.rotation.z = Math.cos(l) * 0.5;
        leg.rotation.x = Math.sin(l) * 0.5;
        s.add(leg);
      }
      s.position.set(0.03 + i * 0.03, y, -0.055);
      g.add(s);
    }
  }
  // the lid, set aside, with a gold sakura mon
  const lid = new Group();
  lid.add(mesh(new BoxGeometry(W, 0.012, D), M.lacquer(), 0, 0.006, 0));
  const mon = new Shape();
  for (let i = 0; i <= 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const x = Math.cos(a) * 0.022, y = Math.sin(a) * 0.022;
    i ? mon.quadraticCurveTo(Math.cos(a - 0.63) * 0.034, Math.sin(a - 0.63) * 0.034, x, y) : mon.moveTo(x, y);
  }
  const m = mesh(new ExtrudeGeometry(mon, { depth: 0.001, bevelEnabled: false }), M.gold(), 0, 0.0125, 0);
  m.rotation.x = -Math.PI / 2;
  lid.add(m);
  lid.position.set(lidSide * (W + 0.03), 0, 0);
  lid.rotation.y = lidSide * 0.2;
  g.add(lid);
  // chopsticks on a rest
  for (const dz of [-0.004, 0.004]) {
    const c = mesh(new CylinderGeometry(0.0015, 0.0028, 0.21, 6), M.lacquerRed(), 0, 0.012, D / 2 + 0.03 + dz);
    c.rotation.z = Math.PI / 2;
    g.add(c);
  }
  g.add(mesh(new BoxGeometry(0.012, 0.008, 0.02), M.plateBlue(), -0.07, 0.004, D / 2 + 0.03));
  return g;
}

function teaSet() {
  const g = new Group();
  // a squat clay teapot (kyusu) with a side handle
  const pot = mesh(new SphereGeometry(0.055, 20, 14), M.clay(), 0, 0.045, 0);
  pot.scale.set(1, 0.8, 1);
  g.add(pot);
  g.add(mesh(new CylinderGeometry(0.03, 0.034, 0.012, 20), M.clay(), 0, 0.09, 0));
  g.add(mesh(new SphereGeometry(0.008, 8, 6), M.clay(), 0, 0.1, 0));
  const spout = mesh(new CylinderGeometry(0.006, 0.011, 0.05, 8), M.clay(), 0.06, 0.06, 0);
  spout.rotation.z = -0.9;
  g.add(spout);
  const handle = mesh(new CylinderGeometry(0.009, 0.009, 0.08, 8), M.clay(), 0, 0.05, -0.085);
  handle.rotation.x = Math.PI / 2;
  g.add(handle);
  // two cups of green tea
  for (const [x, z] of [[0.11, 0.05], [0.12, -0.06]]) {
    const pts = [new Vector2(0, 0), new Vector2(0.026, 0), new Vector2(0.03, 0.045), new Vector2(0.028, 0.046), new Vector2(0.024, 0.004), new Vector2(0, 0.004)];
    g.add(mesh(new LatheGeometry(pts, 24), M.plate(), x, 0, z));
    g.add(mesh(new CylinderGeometry(0.026, 0.026, 0.002, 20), M.tea(), x, 0.036, z));
  }
  return g;
}

/**
 * Builds the spread for a cloth of size (lengthX × widthZ) centred at the
 * origin of `parent` (its top at y = clothTop). Returns { group, dishes[],
 * pick: { onigiri, dango } } — `dishes` are revealed one by one.
 */
export function buildSpread(parent, { length = 2.4, width = 1.5, clothTop = 0.01 } = {}) {
  const rnd = mulberry32(77);
  const group = new Group();
  group.position.y = clothTop;
  parent.add(group);
  const dishes = [];
  const place = (obj, x, z, ry = 0) => {
    obj.position.set(x, 0, z);
    obj.rotation.y = ry;
    group.add(obj);
    dishes.push(obj);
    return obj;
  };
  // the long axis runs along x; the couple sit facing each other across z
  const board = place(sushiBoard(rnd), 0, 0, 0);
  place(bento(rnd, { tiers: 2, lidSide: 1 }), -0.42, 0.05, 0.1);
  place(bento(rnd, { tiers: 1, lidSide: -1 }), 0.2, 0.24, -0.12);
  // onigiri on a bamboo-leaf plate (her side)
  const og = new Group();
  const leaf = mesh(new SphereGeometry(0.11, 16, 6, 0, Math.PI * 2, 0, 0.35), M.leaf());
  leaf.scale.set(1, 0.12, 0.55);
  og.add(leaf);
  const onis = [-0.05, 0.0, 0.05].map((x, i) => {
    const o = onigiri();
    o.position.set(x, 0.004, (i - 1) * 0.004);
    o.rotation.y = (i - 1) * 0.25;
    og.add(o);
    return o;
  });
  place(og, -0.12, 0.27, 0.2);
  // dango on a small plate (his side)
  const dg = new Group();
  dg.add(plate(0.075, M.plateBlue()));
  const dangos = [-0.025, 0.0, 0.025].map((z, i) => {
    const d = dango();
    d.rotation.z = Math.PI / 2;
    d.rotation.y = (i - 1) * 0.15;
    d.position.set(0, 0.022, z);
    dg.add(d);
    return d;
  });
  place(dg, 0.12, -0.28, -0.1);
  place(teaSet(), -0.82, 0.24, 0.4);
  // a small sharing plate at the corner where they sit together (Cast.setupSpread): two nigiri and
  // two onigiri within easy reach of both, for feeding each other (and eating)
  const sh = new Group();
  sh.add(plate(0.1, M.plate()));
  const share = [];
  [['salmon', -0.035, -0.03], ['tuna', 0.035, 0.03]].forEach(([k, x, z]) => {
    const n = nigiri(k);
    n.position.set(x, 0.014, z);
    n.rotation.y = 0.6;
    sh.add(n);
    share.push(n);
  });
  [[0.04, -0.035], [-0.04, 0.035]].forEach(([x, z]) => {
    const o = onigiri();
    o.scale.setScalar(0.8);
    o.position.set(x, 0.01, z);
    o.rotation.y = 0.8;
    sh.add(o);
    share.push(o);
  });
  place(sh, 0.66, -0.26, 0.3);
  // pieces that can be picked up and eaten (Act II, and the interactive picnic's Eat / Feed Her)
  return { group, dishes, pick: { onigiri: onis[1], dango: dangos[1], onigiriPlate: og, dangoPlate: dg, sushi: board.userData.nigiri, onigiris: onis, share } };
}

export function disposeSpread(spread) {
  spread?.group.traverse((o) => o.geometry?.dispose());
  spread?.group.removeFromParent();
}

/**
 * The couple's picnic cloth: red-and-white gingham (woven look: the
 * overlapping stripes are deeper), softly rumpled, with a narrow hem.
 */
export function hanamiCloth(length = 2.5, width = 1.75) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#e9dfda'; // a warm off-white: the gingham's light squares never glare in the sun
  g.fillRect(0, 0, S, S);
  const n = 8, w = S / n;
  for (let i = 0; i < n; i += 2) {
    g.fillStyle = 'rgba(196, 30, 52, 0.55)';
    g.fillRect(i * w, 0, w, S);
    g.fillRect(0, i * w, S, w);
  }
  for (let i = 0; i < n; i += 2) for (let j = 0; j < n; j += 2) {
    g.fillStyle = 'rgba(150, 12, 32, 0.55)';
    g.fillRect(i * w, j * w, w, w);
  }
  // a little weave noise
  for (let k = 0; k < 4000; k++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`;
    g.fillRect(Math.random() * S, Math.random() * S, 1, 2);
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(length / 0.32, width / 0.32);
  tex.anisotropy = 4;
  const geo = new PlaneGeometry(length, width, 40, 28).rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  const rnd = mulberry32(5);
  const ph = [rnd() * 6, rnd() * 6, rnd() * 6];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const edge = Math.min(length / 2 - Math.abs(x), width / 2 - Math.abs(z));
    // gentle rumples, a little lift where the cloth folds at the edges
    const y = 0.012 + 0.006 * Math.sin(x * 5.3 + ph[0]) * Math.sin(z * 4.1 + ph[1]) + 0.004 * Math.sin((x + z) * 11 + ph[2]) + (edge < 0.05 ? (0.05 - edge) * 0.12 : 0);
    p.setY(i, y);
  }
  geo.computeVertexNormals();
  const cloth = new Mesh(geo, new MeshStandardMaterial({ map: tex, roughness: 0.92 }));
  cloth.receiveShadow = true;
  return cloth;
}
