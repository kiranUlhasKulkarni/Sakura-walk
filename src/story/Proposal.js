import {
  BoxGeometry, CanvasTexture, Color, CylinderGeometry, DoubleSide, Group, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  OctahedronGeometry, PlaneGeometry, Quaternion, SphereGeometry, SRGBColorSpace, TorusGeometry, Vector3,
} from 'three';

/**
 * Act V's props: the ring box (red velvet, the lid hinged open, a gold band
 * with a sparkling stone) and his INJURIES — every "NO" earns one more, and
 * they all stay on him until she says YES:
 *   1  a black eye          (a soft purple-blue bruise round his left eye)
 *   2  a cheek bruise       (smaller, on his right cheekbone)
 *   3  a sticking plaster   (a crossed skin-tone pair, low on his left cheek)
 *   4+ a scratch            (a thin red line along his jaw, one more per NO)
 * Every one sits on his face below the hairline — never on his hair or crown.
 */
export function ringBox(envMap) {
  const g = new Group();
  g.name = 'ring-box';
  const velvet = new MeshStandardMaterial({ color: new Color(0.42, 0.02, 0.06), roughness: 1, metalness: 0 });
  const satin = new MeshStandardMaterial({ color: new Color(0.95, 0.9, 0.86), roughness: 0.6 });
  const gold = new MeshStandardMaterial({ color: new Color(1.0, 0.76, 0.36), metalness: 1, roughness: 0.22, envMap, envMapIntensity: 1.6 });
  const gem = new MeshStandardMaterial({ color: 0xffffff, emissive: new Color(2.4, 2.6, 3.0), roughness: 0.05, metalness: 0, envMap }); // HDR: it glints in the bloom
  const base = new Mesh(new BoxGeometry(0.07, 0.04, 0.07), velvet);
  base.position.y = 0.02;
  const cushion = new Mesh(new BoxGeometry(0.058, 0.008, 0.058), satin);
  cushion.position.y = 0.041;
  const hinge = new Group();
  hinge.position.set(0, 0.04, -0.035);
  const lid = new Mesh(new BoxGeometry(0.07, 0.022, 0.07), velvet);
  lid.position.set(0, 0.011, 0.035);
  hinge.add(lid);
  hinge.rotation.x = -1.9; // open
  const ring = new Group();
  const band = new Mesh(new TorusGeometry(0.011, 0.0026, 10, 28), gold);
  const stone = new Mesh(new OctahedronGeometry(0.0055), gem);
  stone.position.y = 0.0135;
  ring.add(band, stone);
  ring.position.set(0, 0.055, 0.004);
  g.add(base, cushion, hinge, ring);
  g.traverse((o) => o.isMesh && (o.castShadow = true));
  return { group: g, hinge, ring, materials: [velvet, satin, gold, gem] };
}

function bruiseTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 6, 64, 64, 62);
  grad.addColorStop(0, 'rgba(55,20,70,0.95)');
  grad.addColorStop(0.45, 'rgba(80,35,95,0.75)');
  grad.addColorStop(0.75, 'rgba(110,60,90,0.35)');
  grad.addColorStop(1, 'rgba(120,70,80,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function gauzeTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#f3efe8';
  g.fillRect(0, 0, 128, 32);
  g.strokeStyle = 'rgba(180,170,160,0.5)';
  for (let x = 0; x < 128; x += 4) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 32);
    g.stroke();
  }
  for (let y = 0; y < 32; y += 4) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(128, y);
    g.stroke();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export class Injuries {
  /** `actor`: him (PoseRig with head bone); `top`: the head-top end bone (for the head's up axis). */
  constructor(actor) {
    this.actor = actor;
    this.level = 0;
    this.pieces = [];
    this.materials = [];
    this.textures = [];
    this.opacity = 1;
    let top = null;
    actor.model.traverse((o) => {
      if (!top && o.isBone && /HeadTop/i.test(o.name)) top = o;
    });
    this.top = top;
  }

  /** The head's frame in world space right now: origin at the head bone, up through the crown, forward = his facing. */
  frame() {
    const head = this.actor.pose.b.head;
    const o = head.getWorldPosition(new Vector3());
    const up = this.top ? this.top.getWorldPosition(new Vector3()).sub(o).normalize() : new Vector3(0, 1, 0);
    const fwd = this.actor.root.getWorldDirection(new Vector3());
    fwd.addScaledVector(up, -fwd.dot(up)).normalize();
    const right = new Vector3().crossVectors(fwd, up).normalize(); // his right
    return { head, o, up, fwd, right };
  }

  /** Put `mesh` at head-frame offset (along up, fwd, right) facing `face` (a frame axis), then parent it to the head bone. */
  attach(mesh, { up = 0, fwd = 0, right = 0, face = 'fwd', spin = 0 }) {
    const F = this.frame();
    const pos = F.o.clone().addScaledVector(F.up, up).addScaledVector(F.fwd, fwd).addScaledVector(F.right, right);
    // orientation: the mesh's +Z → `face`, its +Y → head up
    const z = face === 'fwd' ? F.fwd : face === 'right' ? F.right : face === 'left' ? F.right.clone().negate() : F.up;
    const y = face === 'up' ? F.fwd.clone().negate() : F.up;
    const x = new Vector3().crossVectors(y, z).normalize();
    const m = new Matrix4().makeBasis(x, y.clone().normalize(), z.clone().normalize());
    const q = new Quaternion().setFromRotationMatrix(m).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), spin));
    const world = new Matrix4().compose(pos, q, new Vector3(1, 1, 1));
    F.head.updateMatrixWorld(true);
    const local = new Matrix4().copy(F.head.matrixWorld).invert().multiply(world);
    local.decompose(mesh.position, mesh.quaternion, mesh.scale);
    F.head.add(mesh);
    this.pieces.push(mesh);
    for (const mt of [mesh.material].flat()) if (mt && !this.materials.includes(mt)) this.materials.push(mt);
  }

  /** One more injury (returns the new level). */
  add() {
    this.level++;
    const L = this.level;
    if (L === 1) {
      const tex = bruiseTexture();
      this.textures.push(tex);
      const m = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, opacity: 1 });
      const bruise = new Mesh(new PlaneGeometry(0.06, 0.05), m);
      bruise.renderOrder = 3;
      this.attach(bruise, { up: 0.138, fwd: 0.093, right: -0.034, face: 'fwd' });
    } else if (L === 2) {
      // a second, smaller bruise on his right cheekbone (everything stays on his FACE, below the
      // hairline: nothing bright ever sits on his hair or crown)
      const tex = bruiseTexture();
      this.textures.push(tex);
      const m = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, opacity: 1 });
      const bruise = new Mesh(new PlaneGeometry(0.038, 0.03), m);
      bruise.renderOrder = 3;
      this.attach(bruise, { up: 0.095, fwd: 0.09, right: 0.048, face: 'fwd' });
    } else if (L === 3) {
      // a small skin-tone sticking plaster (a crossed pair) low on his left cheek
      const m = new MeshStandardMaterial({ color: new Color(0.72, 0.52, 0.4), roughness: 0.8, transparent: true, opacity: 1 });
      for (const k of [-1, 1]) {
        const strip = new Mesh(new BoxGeometry(0.036, 0.01, 0.002), m);
        this.attach(strip, { up: 0.075, fwd: 0.09, right: -0.045, face: 'fwd', spin: k * 0.6 });
      }
    } else {
      // a little red scratch along his jaw (one more for every further NO)
      const m = new MeshBasicMaterial({ color: new Color(0.55, 0.12, 0.1), transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
      const k = Math.min(3, L - 4);
      const scratch = new Mesh(new PlaneGeometry(0.03, 0.0035), m);
      scratch.renderOrder = 3;
      this.attach(scratch, { up: 0.035 - k * 0.008, fwd: 0.088, right: 0.035 - k * 0.012, face: 'fwd', spin: 0.4 });
    }
    return L;
  }

  /** Fade every injury (YES: she kisses them better). */
  setOpacity(k) {
    this.opacity = k;
    for (const m of this.materials) m.opacity = k;
    for (const p of this.pieces) p.visible = k > 0.01;
  }

  dispose() {
    for (const p of this.pieces) {
      p.removeFromParent();
      p.geometry.dispose();
    }
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
    this.pieces = [];
    this.materials = [];
    this.level = 0;
  }
}
