import { BufferAttribute, BufferGeometry, CanvasTexture, CatmullRomCurve3, Color, DoubleSide, Mesh, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace } from 'three';
import { mulberry32 } from '../utils/math.js';

/**
 * The maroon coffee-red scarf (#5C061C → #7A1C2E) with a soft hand-knit
 * look: a stockinette texture painted in code (rows of little V stitches,
 * each a slightly different shade of wool, with fuzzy fibres) used as the
 * colour map, and its luminance as the bump map, so the stitches catch the
 * firelight; the wool stays fully matte.
 */
let knit = null;
function knitTextures() {
  if (knit) return knit;
  const S = 256, cols = 8, rows = 12;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const base = new Color(0x5c061c), hi = new Color(0x7a1c2e);
  g.fillStyle = '#3d0412';
  g.fillRect(0, 0, S, S);
  const rnd = mulberry32(61);
  const cw = S / cols, rh = S / rows;
  for (let r = 0; r < rows; r++)
    for (let k = 0; k < cols; k++) {
      const col = base.clone().lerp(hi, 0.35 + rnd() * 0.6);
      const x = k * cw + cw / 2, y = r * rh;
      // one stitch: two leaning loops forming a V
      for (const s of [-1, 1]) {
        const grad = g.createLinearGradient(x, y, x + s * cw * 0.45, y + rh);
        grad.addColorStop(0, `#${col.clone().multiplyScalar(0.7).getHexString()}`);
        grad.addColorStop(0.5, `#${col.getHexString()}`);
        grad.addColorStop(1, `#${col.clone().multiplyScalar(0.75).getHexString()}`);
        g.fillStyle = grad;
        g.beginPath();
        g.ellipse(x + s * cw * 0.22, y + rh * 0.55, cw * 0.2, rh * 0.62, -s * 0.55, 0, Math.PI * 2);
        g.fill();
      }
    }
  // fuzzy fibres
  for (let i = 0; i < 1400; i++) {
    g.strokeStyle = `rgba(${150 + rnd() * 60},${40 + rnd() * 30},${60 + rnd() * 30},${0.08 + rnd() * 0.12})`;
    g.lineWidth = 0.6;
    const x = rnd() * S, y = rnd() * S;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rnd() - 0.5) * 6, y + (rnd() - 0.5) * 6);
    g.stroke();
  }
  const color = new CanvasTexture(c);
  color.colorSpace = SRGBColorSpace;
  // luminance copy for bump / roughness
  const d = document.createElement('canvas');
  d.width = d.height = S;
  const dg = d.getContext('2d');
  dg.filter = 'grayscale(1) contrast(1.6) brightness(1.4)';
  dg.drawImage(c, 0, 0);
  const lum = new CanvasTexture(d);
  for (const t of [color, lum]) {
    t.wrapS = t.wrapT = RepeatWrapping;
    t.anisotropy = 4;
  }
  knit = { color, lum };
  return knit;
}

export function knitMaterial(repeat = [3, 10]) {
  const { color, lum } = knitTextures();
  const map = color.clone(), bump = lum.clone();
  for (const t of [map, bump]) {
    t.repeat.set(...repeat);
    t.needsUpdate = true;
  }
  // wool is matte everywhere: bump for the stitch relief, no roughness map (dark stitches would turn glossy)
  return new MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 1.0, roughness: 1.0, metalness: 0, side: DoubleSide });
}

/** Re-dresses the plain white scarf model in maroon knit. */
export function dressScarf(scarfActor) {
  const m = knitMaterial([4, 4]);
  scarfActor.model.traverse((o) => {
    if (!o.isMesh) return;
    o.material.dispose?.();
    o.material = m;
    o.castShadow = true;
  });
  return m;
}

/**
 * The scarf she's finishing: a knitted strip that grows from between her
 * needles, falls across her lap and spills over her knees. Rebuilt each
 * frame from three world points (cheap: 2 × 28 vertices).
 */
export class KnitStrip {
  constructor(scene) {
    this.N = 28;
    this.width = 0.17;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.N * 2 * 3), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.N * 2 * 2), 2));
    const idx = [];
    for (let i = 0; i < this.N - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setIndex(idx);
    this.material = knitMaterial([1, 8]);
    this.mesh = new Mesh(g, this.material);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.length = 0.25;
    scene.add(this.mesh);
  }

  /** start: between her hands; lap: on her thighs; knee: past her knees, near the ground; side: her right. */
  update(start, lap, knee, side) {
    const ground = knee.clone();
    ground.y = Math.max(0.03, knee.y - 0.45);
    const curve = new CatmullRomCurve3([start, lap, knee, ground]);
    const total = curve.getLength();
    const L = Math.min(this.length, total);
    const p = this.mesh.geometry.attributes.position, uv = this.mesh.geometry.attributes.uv;
    const half = side.clone().normalize().multiplyScalar(this.width / 2);
    for (let i = 0; i < this.N; i++) {
      const s = (i / (this.N - 1)) * (L / total);
      const c = curve.getPointAt(Math.min(1, s));
      p.setXYZ(i * 2, c.x - half.x, c.y - half.y, c.z - half.z);
      p.setXYZ(i * 2 + 1, c.x + half.x, c.y + half.y, c.z + half.z);
      const v = (s * total) / 0.17;
      uv.setXY(i * 2, 0, v);
      uv.setXY(i * 2 + 1, 1, v);
    }
    p.needsUpdate = uv.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
    this.mesh.geometry.computeBoundingSphere();
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

