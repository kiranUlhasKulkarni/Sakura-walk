import { CanvasTexture, SRGBColorSpace } from 'three';
import { mulberry32 } from '../utils/math.js';

/**
 * A procedurally painted sakura cluster (512²): dozens of individual
 * five-petal Somei-Yoshino flowers — notched petals, white-to-blush gradient,
 * a deep-pink eye with stamens — plus a few unopened buds and tiny twigs,
 * piled densest at the centre and thinning at the edges, on transparent.
 * Used on crossed alpha-cut cards so each pom-pom reads as real flowers
 * with gaps of sky between them, not a solid blob.
 */
let cached = null;
export function blossomTexture() {
  if (cached) return cached;
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const rnd = mulberry32(31);

  const petal = (len, wid) => {
    // one notched petal pointing up from the origin
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(wid * 0.9, -len * 0.25, wid * 1.05, -len * 0.85, wid * 0.32, -len);
    g.lineTo(0, -len * 0.86); // the notch
    g.lineTo(-wid * 0.32, -len);
    g.bezierCurveTo(-wid * 1.05, -len * 0.85, -wid * 0.9, -len * 0.25, 0, 0);
    g.closePath();
  };
  const flower = (x, y, r, rot, shade) => {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    for (let i = 0; i < 5; i++) {
      g.save();
      g.rotate((i / 5) * Math.PI * 2 + (rnd() - 0.5) * 0.25);
      const grad = g.createLinearGradient(0, 0, 0, -r);
      grad.addColorStop(0, `rgb(${236 * shade | 0},${150 * shade | 0},${172 * shade | 0})`);
      grad.addColorStop(0.35, `rgb(${255 * shade | 0},${222 * shade | 0},${230 * shade | 0})`);
      grad.addColorStop(1, `rgb(${255 * shade | 0},${206 * shade | 0},${220 * shade | 0})`);
      g.fillStyle = grad;
      petal(r, r * 0.42);
      g.fill();
      g.strokeStyle = `rgba(${200 * shade | 0},${120 * shade | 0},${145 * shade | 0},0.35)`;
      g.lineWidth = 0.8;
      g.stroke();
      g.restore();
    }
    // eye + stamens
    g.fillStyle = `rgb(${190 * shade | 0},${60 * shade | 0},${95 * shade | 0})`;
    g.beginPath();
    g.arc(0, 0, r * 0.18, 0, Math.PI * 2);
    g.fill();
    for (let i = 0; i < 9; i++) {
      const a = rnd() * Math.PI * 2, d = r * (0.18 + rnd() * 0.22);
      g.strokeStyle = 'rgba(250,235,240,0.8)';
      g.lineWidth = 0.7;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(Math.cos(a) * d, Math.sin(a) * d);
      g.stroke();
      g.fillStyle = '#f2d36b';
      g.beginPath();
      g.arc(Math.cos(a) * d, Math.sin(a) * d, 1.1, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  };

  // a few dark twigs radiating from the cluster's heart (they peek between flowers)
  g.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const a = rnd() * Math.PI * 2;
    g.strokeStyle = 'rgba(52,32,30,0.95)';
    g.lineWidth = 3 + rnd() * 2;
    g.beginPath();
    g.moveTo(S / 2, S / 2);
    g.quadraticCurveTo(S / 2 + Math.cos(a + 0.3) * 80, S / 2 + Math.sin(a + 0.3) * 80, S / 2 + Math.cos(a) * 170, S / 2 + Math.sin(a) * 170);
    g.stroke();
  }
  // flowers: back (shaded) layer first, front (bright) layer last
  const N = 95;
  for (let i = 0; i < N; i++) {
    const k = i / N;
    const a = rnd() * Math.PI * 2;
    const d = Math.pow(rnd(), 0.7) * S * 0.4;
    const r = 26 + rnd() * 16;
    flower(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d * 0.92, r, rnd() * 6.28, 0.72 + 0.28 * k);
  }
  // buds
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2, d = S * (0.3 + rnd() * 0.15);
    g.fillStyle = '#d24a78';
    g.beginPath();
    g.ellipse(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, 5, 8, a, 0, Math.PI * 2);
    g.fill();
  }

  cached = new CanvasTexture(c);
  cached.colorSpace = SRGBColorSpace;
  cached.anisotropy = 4;
  return cached;
}

export function disposeBlossomTexture() {
  cached?.dispose();
  cached = null;
}
