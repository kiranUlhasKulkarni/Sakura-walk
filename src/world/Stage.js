import { BoxGeometry, CanvasTexture, Color, CylinderGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace, TorusGeometry, Vector3 } from 'three';
import { disposeObject } from '../utils/dispose.js';
import { mulberry32 } from '../utils/math.js';
import { lanePoint, STATIONS } from './lane.js';

/** A nobori festival banner's fabric: a bold colour field with a vertical band of brush "characters". */
function bannerTexture(bg, ink, seed) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, 64, 256);
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.fillRect(0, 0, 64, 14);
  const rnd = mulberry32(seed);
  g.strokeStyle = ink;
  g.lineCap = 'round';
  for (let k = 0; k < 4; k++) {
    // a brush glyph: a few confident strokes inside a cell
    const y0 = 30 + k * 52;
    for (let s = 0; s < 4; s++) {
      g.lineWidth = 3 + rnd() * 4;
      g.beginPath();
      const x = 14 + rnd() * 36, y = y0 + rnd() * 34;
      g.moveTo(x, y);
      g.quadraticCurveTo(x + (rnd() - 0.5) * 30, y + (rnd() - 0.5) * 20, x + (rnd() - 0.5) * 26, y + rnd() * 26);
      g.stroke();
    }
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/**
 * The festival corner where the dragon performs (Act III): a low round
 * wooden stage under the beast, four iron braziers burning at its edge
 * (their fire comes from the Fire system), a row of nobori banners, and a
 * wooden bench at the front where the couple sit to watch.
 */
export class Stage {
  constructor(scene, fire) {
    this.group = new Group();
    this.group.name = 'festival-stage';
    scene.add(this.group);
    const st = STATIONS.stage;
    this.center = st.center.clone();
    this.toLane = lanePoint(st.u).sub(st.center).setY(0).normalize(); // stage → lane
    this.side = new Vector3(-this.toLane.z, 0, this.toLane.x);
    const wood = new MeshStandardMaterial({ color: new Color(0.24, 0.14, 0.09), roughness: 0.8 });
    const darkWood = new MeshStandardMaterial({ color: new Color(0.1, 0.06, 0.05), roughness: 0.7 });
    const iron = new MeshStandardMaterial({ color: new Color(0.08, 0.075, 0.08), roughness: 0.55, metalness: 0.7 });
    const ember = new MeshStandardMaterial({ color: 0x220a04, emissive: new Color(1.6, 0.45, 0.1), emissiveIntensity: 1.0, roughness: 1 });
    this.materials = [wood, darkWood, iron, ember];

    // the stage: a low round platform of planks with a lacquered rim
    const R = 4.6;
    const deck = new Mesh(new CylinderGeometry(R, R + 0.15, 0.28, 48), wood);
    deck.position.copy(this.center).setY(0.14);
    const rim = new Mesh(new TorusGeometry(R + 0.06, 0.07, 8, 64), darkWood);
    rim.rotation.x = Math.PI / 2;
    rim.position.copy(this.center).setY(0.28);
    for (const m of [deck, rim]) {
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
    }

    // four braziers around the front half of the stage
    this.braziers = [];
    const angles = [-1.15, -0.4, 0.4, 1.15];
    for (const a of angles) {
      const dir = this.toLane.clone().applyAxisAngle(new Vector3(0, 1, 0), a);
      const p = this.center.clone().addScaledVector(dir, R + 1.2);
      const b = new Group();
      b.position.copy(p).setY(0);
      for (let k = 0; k < 3; k++) {
        const leg = new Mesh(new CylinderGeometry(0.025, 0.03, 1.15, 6), iron);
        const la = (k / 3) * Math.PI * 2;
        leg.position.set(Math.cos(la) * 0.22, 0.55, Math.sin(la) * 0.22);
        leg.rotation.set(Math.sin(la) * 0.22, 0, -Math.cos(la) * 0.22);
        b.add(leg);
      }
      const bowl = new Mesh(new CylinderGeometry(0.36, 0.2, 0.22, 20, 1, true), iron);
      bowl.material.side = DoubleSide;
      bowl.position.y = 1.15;
      b.add(bowl);
      const coals = new Mesh(new CylinderGeometry(0.33, 0.33, 0.04, 20), ember);
      coals.position.y = 1.2;
      b.add(coals);
      b.traverse((o) => o.isMesh && (o.castShadow = true));
      this.group.add(b);
      const flame = fire.add({ pos: p.clone().setY(1.26), rate: 120, speed: 0.85, spread: 0.22, size: 0.24, life: 0.8, smoke: 0.15, light: 0, lightPower: 2.6, on: false });
      this.braziers.push({ group: b, flame, coals });
    }

    // taimatsu torches: tall poles with burning heads ringing the back and sides of the stage,
    // and a pair flanking the bench — the corner is lit by fire against the dark park
    this.torches = [];
    const torchHead = new MeshStandardMaterial({ color: 0x120804, emissive: new Color(1.0, 0.28, 0.04), emissiveIntensity: 0.35, roughness: 1 });
    this.materials.push(torchHead);
    const torchAt = (p, lightIdx) => {
      const t = new Group();
      t.position.copy(p).setY(0);
      const pole = new Mesh(new CylinderGeometry(0.045, 0.06, 2.5, 7), darkWood);
      pole.position.y = 1.25;
      const head = new Mesh(new CylinderGeometry(0.11, 0.07, 0.32, 9), torchHead);
      head.position.y = 2.6;
      const band = new Mesh(new TorusGeometry(0.1, 0.018, 5, 12), iron);
      band.rotation.x = Math.PI / 2;
      band.position.y = 2.48;
      t.add(pole, head, band);
      t.traverse((o) => o.isMesh && (o.castShadow = true));
      this.group.add(t);
      const flame = fire.add({ pos: p.clone().setY(2.78), rate: 60, speed: 0.85, spread: 0.18, size: 0.17, life: 0.6, smoke: 0.2, light: lightIdx, lightPower: 1.6, on: false });
      this.torches.push({ group: t, flame });
    };
    for (let i = 0; i < 9; i++) {
      const a = 1.55 + (i / 8) * (Math.PI * 2 - 3.1); // all round the back, leaving the front open
      const dir = this.toLane.clone().applyAxisAngle(new Vector3(0, 1, 0), a);
      torchAt(this.center.clone().addScaledVector(dir, R + 2.4), i < 5 ? 2 : 3);
    }
    // spark fountains along the stage's front edge (driven by the fireworks engine: see sparks())
    this.fountains = [-0.75, -0.25, 0.25, 0.75].map((a) => {
      const dir = this.toLane.clone().applyAxisAngle(new Vector3(0, 1, 0), a);
      return { pos: this.center.clone().addScaledVector(dir, R - 0.25).setY(0.3), out: dir };
    });

    // nobori banners flanking the stage
    const colors = [['#8e1420', '#f4e7d0'], ['#f4e7d0', '#8e1420'], ['#1f3a6a', '#f4e7d0'], ['#c88a1a', '#2a120c'], ['#8e1420', '#f4e7d0'], ['#f4e7d0', '#1f3a6a']];
    this.banners = [];
    colors.forEach(([bg, ink], i) => {
      const s = i < 3 ? -1 : 1;
      const k = i % 3;
      const p = this.center.clone().addScaledVector(this.side, s * (R + 2.2 + k * 1.3)).addScaledVector(this.toLane, -1.5 + k * 1.6);
      const pole = new Mesh(new CylinderGeometry(0.035, 0.04, 4.2, 6), darkWood);
      pole.position.copy(p).setY(2.1);
      const tex = bannerTexture(bg, ink, i * 17 + 3);
      const flagMat = new MeshStandardMaterial({ map: tex, side: DoubleSide, roughness: 0.85 });
      this.materials.push(flagMat);
      const flag = new Mesh(new PlaneGeometry(0.55, 2.2, 1, 8), flagMat);
      flag.position.copy(p).add(new Vector3(0, 2.75, 0)).addScaledVector(this.toLane.clone().cross(new Vector3(0, 1, 0)), 0);
      flag.lookAt(flag.position.clone().add(this.toLane));
      flag.translateX(0.3);
      const top = new Mesh(new BoxGeometry(0.62, 0.03, 0.03), darkWood);
      top.position.copy(flag.position).add(new Vector3(0, 1.11, 0));
      top.quaternion.copy(flag.quaternion);
      for (const m of [pole, flag, top]) {
        m.castShadow = true;
        this.group.add(m);
      }
      this.banners.push({ flag, base: flag.geometry.attributes.position.array.slice(), phase: i * 1.7 });
    });

    // the bench the couple watch from, between the lane and the stage
    this.benchPos = this.center.clone().addScaledVector(this.toLane, R + 4.2);
    const bench = new Group();
    bench.position.copy(this.benchPos);
    bench.rotation.y = Math.atan2(-this.toLane.x, -this.toLane.z); // facing the stage
    const seat = new Mesh(new BoxGeometry(1.7, 0.07, 0.42), wood);
    seat.position.y = 0.45;
    bench.add(seat);
    for (const x of [-0.7, 0.7]) {
      const leg = new Mesh(new BoxGeometry(0.08, 0.42, 0.36), darkWood);
      leg.position.set(x, 0.21, 0);
      bench.add(leg);
    }
    bench.traverse((o) => o.isMesh && (o.castShadow = o.receiveShadow = true));
    this.bench = bench;
    this.group.add(bench);
    this.benchHeading = bench.rotation.y;
    // seats on the bench (world), him on the left as they face the stage
    const right = new Vector3(Math.cos(bench.rotation.y), 0, -Math.sin(bench.rotation.y));
    this.seats = {
      him: this.benchPos.clone().addScaledVector(right, -0.42).addScaledVector(this.toLane, 0.08),
      her: this.benchPos.clone().addScaledVector(right, 0.42).addScaledVector(this.toLane, 0.08),
    };
    this.seatHeight = 0.485;
    // two more torches either side of the bench
    for (const k of [-1, 1]) torchAt(this.benchPos.clone().addScaledVector(right, k * 2.7).addScaledVector(this.toLane, -0.6), 3);
  }

  /** Light the braziers and torches (k 0..1 ramps them in; 0 puts them out). */
  ignite(k = 1) {
    for (const b of [...this.braziers, ...this.torches]) {
      b.flame.on = k > 0.01;
      b.flame.intensity = k;
    }
  }

  update(time) {
    // banners ripple in the breeze
    for (const b of this.banners) {
      const p = b.flag.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = b.base[i * 3 + 1];
        const x = b.base[i * 3];
        const k = (1.1 - y) / 2.2; // 0 at the top, 1 at the bottom
        p.setZ(i, Math.sin(time * 2.2 + y * 2.0 + b.phase) * 0.08 * (0.3 + k) + (x + 0.27) * 0.08 * Math.sin(time * 3.1 + b.phase));
      }
      p.needsUpdate = true;
    }
  }

  dispose() {
    disposeObject(this.group);
    this.materials.forEach((m) => m.dispose());
  }
}
