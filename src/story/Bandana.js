import { BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide, Group, Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry, RepeatWrapping, SphereGeometry, SRGBColorSpace, Vector3 } from 'three';

/**
 * Her bandana: a soft blush-pink cotton headwrap with cream polka dots and a
 * thin maroon edge (the scarf's colour), worn round her crown over the
 * forehead hairline and tied at the back with a knot and two tails.
 *
 * It is FITTED to her actual head: at load, her skinned hair (and scalp)
 * vertices are taken in world space, the slab of them where the band sits
 * (a plane through the hairline, tilted so the band runs low behind) is
 * binned by angle round the head, and the band's outline follows the hair's
 * outer surface bin by bin (smoothed, a few millimetres proud of it) — so it
 * sits snug on her, never floating and never sunk in. The finished wrap is
 * parented to her head bone, so it moves exactly with her skull (the hair is
 * rigidly skinned to that same bone: see Cast.rigidHair).
 */
function fabric() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#ecbcc6';
  g.fillRect(0, 0, 256, 64);
  // a soft weave
  g.globalAlpha = 0.08;
  g.fillStyle = '#ffffff';
  for (let y = 0; y < 64; y += 2) g.fillRect(0, y, 256, 1);
  g.globalAlpha = 1;
  // cream polka dots
  g.fillStyle = '#fff4ea';
  for (let row = 0; row < 3; row++)
    for (let x = 0; x < 256; x += 22) {
      g.beginPath();
      g.arc(x + (row % 2) * 11 + 6, 15 + row * 17, 3.4, 0, Math.PI * 2);
      g.fill();
    }
  // maroon edges, like the scarf she knitted
  g.fillStyle = '#7a1c2e';
  g.fillRect(0, 0, 256, 4);
  g.fillRect(0, 60, 256, 4);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

export function fitBandana(actor, { hairMaterials = [], scalpMaterial = 'face.002', width = 0.052, tilt = 0.38 } = {}) {
  const head = actor.pose?.b.head;
  if (!head) return null;
  actor.root.updateMatrixWorld(true);
  // her facing and the eye line give the band's frame
  const fwd = actor.root.getWorldDirection(new Vector3()).setY(0).normalize();
  const up = new Vector3(0, 1, 0);
  const eyes = [];
  actor.model.traverse((o) => o.isBone && /^eye[LR]_/i.test(o.name) && eyes.push(o.getWorldPosition(new Vector3())));
  const headP = head.getWorldPosition(new Vector3());
  let eye = eyes.length === 2 ? eyes[0].clone().lerp(eyes[1], 0.5) : null;
  if (!eye || eye.distanceTo(headP) > 0.3) eye = headP.clone().add(new Vector3(0, 0.09, 0)).addScaledVector(fwd, 0.08); // eye bones not placed: estimate

  // her skinned hair + scalp, in world space
  const pts = [], v = new Vector3();
  actor.model.traverse((m) => {
    if (!m.isSkinnedMesh) return;
    const name = m.material?.name;
    if (!hairMaterials.includes(name) && name !== scalpMaterial) return;
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 2) {
      m.getVertexPosition(i, v);
      pts.push(m.localToWorld(v.clone()));
    }
  });
  if (!pts.length) return null;

  // the band's plane: through the hairline above the brows, tilted to run low round the back
  const n = up.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(fwd, -Math.sin(tilt)).normalize();
  const front = eye.clone().add(new Vector3(0, 0.058, 0));
  // the centre of the head on that plane: the centroid of the hair in the slab
  const slab = (p, c) => Math.abs(p.clone().sub(c).dot(n)) < width * 0.55;
  let C = front.clone().addScaledVector(fwd, -0.085);
  for (let it = 0; it < 3; it++) {
    const inSlab = pts.filter((p) => slab(p, C) && p.distanceTo(C) < 0.16);
    if (inSlab.length < 20) break;
    const d = inSlab.reduce((s, p) => s.add(p), new Vector3()).divideScalar(inSlab.length).sub(C);
    // keep the plane through the hairline: move the centre only within the plane
    d.addScaledVector(n, -d.dot(n));
    C.addScaledVector(d, 0.8);
  }
  const e1 = fwd.clone().addScaledVector(n, -fwd.dot(n)).normalize();
  const e2 = new Vector3().crossVectors(n, e1).normalize();

  // the hair's outline round the head, bin by bin (an upper percentile: the outer surface)
  const N = 56;
  const bins = Array.from({ length: N }, () => []);
  for (const p of pts) {
    const d = p.clone().sub(C);
    if (Math.abs(d.dot(n)) > width * 0.6) continue;
    const x = d.dot(e1), y = d.dot(e2), r = Math.hypot(x, y);
    if (r > 0.17 || r < 0.03) continue; // not the pigtails hanging past, not the inside
    const a = (Math.atan2(y, x) + Math.PI * 2) % (Math.PI * 2);
    bins[Math.floor((a / (Math.PI * 2)) * N) % N].push(r);
  }
  let R = bins.map((b) => (b.length ? b.sort((x, y) => x - y)[Math.floor(b.length * 0.88)] : NaN));
  const known = R.filter((r) => !Number.isNaN(r)).sort((a, b) => a - b);
  const med = known.length ? known[Math.floor(known.length / 2)] : 0.095;
  R = R.map((r) => (Number.isNaN(r) ? med : Math.min(med * 1.14, Math.max(med * 0.88, r))));
  for (let pass = 0; pass < 4; pass++) R = R.map((r, i) => (R[(i + N - 1) % N] + 2 * r + R[(i + 1) % N]) / 4);

  // the band: 4 rows across its width, gently rounded like folded cotton
  const rows = [-0.5, -0.18, 0.18, 0.5];
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const dir = e1.clone().multiplyScalar(Math.cos(a)).addScaledVector(e2, Math.sin(a));
    const r = R[i % N] + 0.005;
    rows.forEach((t, j) => {
      const bulge = (1 - (2 * t) ** 2) * 0.004;
      const p = C.clone().addScaledVector(dir, r + bulge).addScaledVector(n, t * width);
      pos.push(p.x, p.y, p.z);
      uv.push((i / N) * 7, j / (rows.length - 1));
    });
  }
  for (let i = 0; i < N; i++)
    for (let j = 0; j < rows.length - 1; j++) {
      const a = i * rows.length + j, b = a + rows.length;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const tex = fabric();
  // a little of the fabric's own colour as emissive: it stays blush pink in the lilac dusk and at night
  const mat = new MeshStandardMaterial({ map: tex, roughness: 0.88, metalness: 0, side: DoubleSide, color: new Color(1, 1, 1), emissiveMap: tex, emissive: new Color(0.3, 0.26, 0.27) });
  const wrap = new Group();
  wrap.name = 'bandana';
  const band = new Mesh(g, mat);
  wrap.add(band);

  // the knot at the back, and two tails falling from it
  const back = C.clone().addScaledVector(e1, -(R[Math.floor(N / 2)] + 0.012)).addScaledVector(n, -width * 0.1);
  const knot = new Mesh(new SphereGeometry(0.02, 14, 10), mat);
  knot.scale.set(1.3, 0.85, 0.75);
  knot.position.copy(back);
  knot.lookAt(back.clone().addScaledVector(e1, -1));
  wrap.add(knot);
  for (const k of [-1, 1]) {
    const tailGeo = new PlaneGeometry(0.036, 0.12, 1, 4);
    const tp = tailGeo.attributes.position;
    for (let i = 0; i < tp.count; i++) tp.setZ(i, ((tp.getY(i) + 0.06) / 0.12 - 1) ** 2 * -0.025); // a soft curve away from the hair
    tailGeo.computeVertexNormals();
    const tail = new Mesh(tailGeo, mat);
    tail.position.copy(back).add(new Vector3(0, -0.06, 0)).addScaledVector(e2, k * 0.018).addScaledVector(e1, -0.008);
    tail.lookAt(tail.position.clone().addScaledVector(e1, -1));
    tail.rotateZ(k * 0.32);
    wrap.add(tail);
  }
  wrap.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  // parent it to the head bone, keeping exactly where it was fitted
  head.updateMatrixWorld(true);
  const local = new Matrix4().copy(head.matrixWorld).invert();
  wrap.applyMatrix4(local);
  head.add(wrap);
  wrap.userData.dispose = () => {
    g.dispose();
    mat.dispose();
    tex.dispose();
    knot.geometry.dispose();
  };
  return wrap;
}
