import { AnimationClip, AnimationMixer, Box3, Group, LoopRepeat, Matrix4, Vector3 } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ASSETS } from '../config.js';
import { fitObject } from '../core/AssetLibrary.js';
import { PoseRig } from '../player/PoseRig.js';
import { disposeObject } from '../utils/dispose.js';
import { lanePoint, laneSide, STATIONS } from '../world/lane.js';
import { buildSpread, hanamiCloth } from '../world/PicnicProps.js';
import { fitBandana } from './Bandana.js';
import { OUTFITS, rigDancer } from './DancerRig.js';
import { dressScarf } from './Scarf.js';

/**
 * picnic.glb is a whole diorama fused into one mesh — a square of turf, a
 * hedge row, and a red-check cloth laid with Western tableware (plates, cups,
 * a pizza). The turf and hedge are removed (every triangle whose texture is
 * grass-green), leaving the cloth and its tableware: it becomes a
 * neighbouring family's picnic further along the lawn. (The cloth can't be
 * cut out on its own — it shares triangles with the turf and the plates lie in
 * its plane — so the couple's own hanami cloth and spread are built in code.)
 */
function cleanPicnic(scene) {
  scene.updateMatrixWorld(true);
  scene.traverse((m) => {
    if (!m.isMesh || !m.geometry.index || !m.material.map?.image) return;
    const S = 512;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(m.material.map.image, 0, 0, S, S);
    const data = cx.getImageData(0, 0, S, S).data;
    const flip = m.material.map.flipY;
    const g = m.geometry, idx = g.index, uv = g.attributes.uv;
    const keep = [];
    for (let t = 0; t < idx.count / 3; t++) {
      const vs = [idx.getX(t * 3), idx.getX(t * 3 + 1), idx.getX(t * 3 + 2)];
      const u = (uv.getX(vs[0]) + uv.getX(vs[1]) + uv.getX(vs[2])) / 3, v = (uv.getY(vs[0]) + uv.getY(vs[1]) + uv.getY(vs[2])) / 3;
      const px = Math.min(S - 1, Math.max(0, Math.floor((((u % 1) + 1) % 1) * S)));
      const vv = ((v % 1) + 1) % 1;
      const py = Math.min(S - 1, Math.floor((flip ? 1 - vv : vv) * S));
      const i = (py * S + px) * 4;
      const green = data[i + 1] > data[i] * 1.05 && data[i + 1] >= data[i + 2] * 0.95;
      if (!green) keep.push(...vs);
    }
    g.setIndex(keep);
    m.geometry = g.toNonIndexed(); // compact: bounds / fitting see only what's left
    g.dispose();
  });
}

/**
 * Her dress is skinned mostly to the PELVIS, even over the front of her thighs:
 * when she sits the thighs swing forward and the bare legs push out through a
 * skirt that stays upright. At load, the lower-front dress weight is moved from
 * the pelvis onto the thigh beneath it (more the lower and the more frontal the
 * vertex), so the skirt front rides over her lap. Standing, nothing changes.
 */
function reweightSkirt(model) {
  const SKIRT = /^(Material|Material\.00[23]|cloth1|cloth1b|cloth1c|cloth2|cloth_2|under\.001)$/;
  const inv = new Matrix4(), bm = new Vector3(), vp = new Vector3();
  model.traverse((m) => {
    if (!m.isSkinnedMesh || !SKIRT.test(m.material?.name ?? '')) return;
    const bones = m.skeleton.bones;
    const idx = (re) => bones.findIndex((b) => re.test(b.name));
    const iPel = idx(/^DEF-spine_\d+$/), iL = idx(/^DEF-thighL_/), iR = idx(/^DEF-thighR_/), iToe = idx(/^DEF-toeL_/), iFoot = idx(/^DEF-footL_/), iHead = idx(/^DEF-spine006_/);
    if (iPel < 0 || iL < 0 || iR < 0) return;
    // bone positions in the bind space (the same space as bindMatrix · position)
    const at = (i) => new Vector3().setFromMatrixPosition(inv.copy(m.skeleton.boneInverses[i]).invert());
    const pel = at(iPel), tL = at(iL), tR = at(iR);
    const up = iHead >= 0 ? at(iHead).sub(pel).normalize() : new Vector3(0, 1, 0);
    const fwd = iToe >= 0 && iFoot >= 0 ? at(iToe).sub(at(iFoot)) : new Vector3(0, 0, 1);
    fwd.addScaledVector(up, -fwd.dot(up)).normalize();
    const hipH = tL.clone().lerp(tR, 0.5).sub(pel).dot(up);
    const pos = m.geometry.attributes.position, si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight;
    for (let v = 0; v < pos.count; v++) {
      vp.fromBufferAttribute(pos, v).applyMatrix4(m.bindMatrix).sub(pel);
      const h = vp.dot(up), f = vp.dot(fwd);
      const lower = Math.min(1, Math.max(0, (hipH + 0.02 - h) / 0.14));
      const front = Math.min(1, Math.max(0, (f + 0.01) / 0.07));
      const t = lower * front * 0.9;
      if (t <= 0.01) continue;
      bm.copy(vp).add(pel);
      const thigh = bm.distanceToSquared(tL) < bm.distanceToSquared(tR) ? iL : iR;
      let moved = 0, slotThigh = -1, slotPel = -1;
      for (let q = 0; q < 4; q++) {
        if (si.getComponent(v, q) === iPel) slotPel = q;
        if (si.getComponent(v, q) === thigh) slotThigh = q;
      }
      if (slotPel < 0) continue;
      moved = sw.getComponent(v, slotPel) * t;
      sw.setComponent(v, slotPel, sw.getComponent(v, slotPel) - moved);
      if (slotThigh >= 0) sw.setComponent(v, slotThigh, sw.getComponent(v, slotThigh) + moved);
      else {
        // take over the weakest slot
        let low = slotPel === 0 ? 1 : 0;
        for (let q = 0; q < 4; q++) if (q !== slotPel && sw.getComponent(v, q) < sw.getComponent(v, low)) low = q;
        const lost = sw.getComponent(v, low); // its (small) weight goes back to the pelvis: the sum stays 1
        si.setComponent(v, low, thigh);
        sw.setComponent(v, low, moved);
        sw.setComponent(v, slotPel, sw.getComponent(v, slotPel) + lost);
      }
    }
    si.needsUpdate = sw.needsUpdate = true;
  });
}

/**
 * Her hair, rigid on her skull (the "bald spot" fix, root cause). Her hair
 * meshes were skinned to the head bone plus chains of hair bones (HR, HL,
 * H_back…) — and the lower H_back bones sit far from their bind pose in the
 * exported rest pose, dragging the back hair off the skull and baring her
 * scalp. Every hair vertex is re-skinned 100% (weight 1.0) to the single head
 * bone, and so are the upper-scalp vertices of her head mesh (the rest of the
 * head blends smoothly from the neck), so hair and skull can only ever move as
 * one solid piece. The hair bones then drive nothing at all.
 */
function rigidHair(model) {
  const inv = new Matrix4(), vp = new Vector3();
  model.traverse((m) => {
    if (!m.isSkinnedMesh) return;
    const name = m.material?.name ?? '';
    const isHair = HER.hair.materials.includes(name);
    const isHead = name === 'face.002';
    if (!isHair && !isHead) return;
    const bones = m.skeleton.bones;
    const iHead = bones.findIndex((b) => /^DEF-spine006/.test(b.name));
    if (iHead < 0) return;
    const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight;
    // the head joint in bind space, and "up" through the skull (neck → head)
    const at = (i) => new Vector3().setFromMatrixPosition(inv.copy(m.skeleton.boneInverses[i]).invert());
    const headP = at(iHead);
    const iNeck = bones.findIndex((b) => /^DEF-spine004/.test(b.name));
    const neckP = iNeck >= 0 ? at(iNeck) : headP.clone().sub(new Vector3(0, 0.1, 0));
    const up = headP.clone().sub(neckP).normalize();
    const L = Math.max(1e-6, headP.distanceTo(neckP)); // the neck's length: the scale of this bind space
    const pos = m.geometry.attributes.position;
    for (let v = 0; v < si.count; v++) {
      let t = 1;
      if (isHead) {
        // the scalp: everything above the head joint is rigid; a short blend below it
        vp.fromBufferAttribute(pos, v).applyMatrix4(m.bindMatrix).sub(headP);
        const h = vp.dot(up) / L; // in neck lengths above the head joint
        t = Math.min(1, Math.max(0, (h + 0.15) / 0.4));
        if (t <= 0) continue;
      }
      if (isHair) {
        si.setXYZW(v, iHead, 0, 0, 0);
        sw.setXYZW(v, 1, 0, 0, 0);
        continue;
      }
      // the head mesh: only its NECK-CHAIN weight (spine003–005) moves onto the head bone; anything
      // driven by the eye / face bones (eyes, lids) is left exactly as it was
      const chain = (q) => /^DEF-spine00[345]_/.test(bones[si.getComponent(v, q)].name);
      // blend: move the fraction t of every other bone's weight onto the head
      let slotHead = -1;
      for (let q = 0; q < 4; q++) if (si.getComponent(v, q) === iHead) slotHead = q;
      if (slotHead < 0) {
        if (![0, 1, 2, 3].some((q) => chain(q) && sw.getComponent(v, q) > 0)) continue; // nothing of the neck to move
        // take over an empty slot, or the weakest neck-chain one (never an eye / face bone's)
        let low = -1;
        for (let q = 0; q < 4; q++) {
          const ok = sw.getComponent(v, q) === 0 || chain(q);
          if (ok && (low < 0 || sw.getComponent(v, q) < sw.getComponent(v, low))) low = q;
        }
        const lost = sw.getComponent(v, low);
        si.setComponent(v, low, iHead);
        sw.setComponent(v, low, 0);
        // give the dropped weight to the strongest remaining slot
        let hi = -1;
        for (let q = 0; q < 4; q++) if (q !== low && chain(q) && (hi < 0 || sw.getComponent(v, q) > sw.getComponent(v, hi))) hi = q;
        if (hi < 0) hi = low; // its weight simply becomes the head's
        sw.setComponent(v, hi, sw.getComponent(v, hi) + lost);
        slotHead = low;
      }
      let moved = 0;
      for (let q = 0; q < 4; q++) {
        if (q === slotHead || !chain(q)) continue;
        const w = sw.getComponent(v, q) * t;
        sw.setComponent(v, q, sw.getComponent(v, q) - w);
        moved += w;
      }
      sw.setComponent(v, slotHead, sw.getComponent(v, slotHead) + moved);
    }
    si.needsUpdate = sw.needsUpdate = true;
  });
}

/** Her customisation (the main girl). Hair: natural dark brown, sheen kept from the painted texture. */
export const HER = {
  hair: { materials: ['Material.001', 'N00_000_00_HairBack_00_HAIR'], dark: 0x3a2416, light: 0x7a5232 },
  // the knife + ring she was exported holding (on her hold bones) — removed,
  // plus the pair of thin rods (crochet needles) she held, one in each hand (Material.006)
  hideMaterials: ['material_23', 'material_24', 'material_25', 'material_26', 'Material.006'],
  // her only clip also held that prop pose: keep just the butterflies that flutter around her
  keepTracks: /^(Bone|wing)/,
  // her pure-white petticoat, skirt layer (cloth_2: the hot spot on her lap at the picnic) and
  // collar ruffles glared into the bloom under the character lights: soft off-whites, no glow
  dimWhites: { 'Material.003': 0.7, cloth_2: 0.6, cloth: 0.82 },
};

/**
 * Wraps one loaded model as a scene actor: a Group (the actor's transform —
 * position / heading) holding the fitted model, an AnimationMixer and its
 * clips by name. Clones use SkeletonUtils so skinned rigs stay independent.
 */
export class Actor {
  constructor(name, gltf, fit, { clone = false } = {}) {
    this.name = name;
    this.root = new Group();
    this.root.name = name;
    const model = clone ? cloneSkinned(gltf.scene) : gltf.scene;
    fitObject(model, fit);
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = !o.isSkinnedMesh; // skinned bounds are bind-pose: don't cull mid-animation
      }
    });
    this.model = model;
    this.root.add(model);
    this.mixer = gltf.animations.length ? new AnimationMixer(model) : null;
    this.clips = Object.fromEntries(gltf.animations.map((c) => [c.name, c]));
    this.action = null;
    this.pose = null; // PoseRig (procedural stance, hands, gait) — set by Cast for the humanoids
    this.speed = 0; // ground speed (m/s), set by whoever moves the actor
    this.walkClip = null;
  }

  play(name, { fade = 0.4, loop = LoopRepeat, timeScale = 1 } = {}) {
    const clip = this.clips[name];
    if (!clip || !this.mixer) return null;
    const next = this.mixer.clipAction(clip);
    next.reset().setLoop(loop, Infinity).setEffectiveTimeScale(timeScale).fadeIn(fade).play();
    if (this.action && this.action !== next) this.action.fadeOut(fade);
    this.action = next;
    return next;
  }

  place(x, z, heading = 0) {
    this.root.position.set(x, 0, z);
    this.root.rotation.y = heading;
    return this;
  }

  faceTo(x, z) {
    this.root.rotation.y = Math.atan2(x - this.root.position.x, z - this.root.position.z);
    return this;
  }

  /**
   * Use a clip for walking (him: Mixamo 'walking'). Mixamo walks carry ROOT
   * MOTION — the hips travel ~1.8 m forward per cycle and jump back to the start
   * at every loop, which fights the controller and snaps the body backwards.
   * The clip is made in-place: each position track loses its net drift
   * (removed linearly over the cycle) but keeps its bob and sway. Its playback
   * rate then follows the real ground speed, measured from that drift.
   */
  setWalkClip(name) {
    const src = this.clips[name];
    if (!src || !this.mixer) return;
    const clip = src.clone();
    let travel = 0;
    for (const t of clip.tracks) {
      if (!t.name.endsWith('.position')) continue;
      const v = t.values, n = t.times.length, T = t.times[n - 1] - t.times[0] || 1;
      const d = [v[(n - 1) * 3] - v[0], v[(n - 1) * 3 + 1] - v[1], v[(n - 1) * 3 + 2] - v[2]];
      const len = Math.hypot(...d);
      if (len < 0.05) continue;
      for (let i = 0; i < n; i++) {
        const k = (t.times[i] - t.times[0]) / T;
        for (let c = 0; c < 3; c++) v[i * 3 + c] -= d[c] * k;
      }
      // metres per second of the original motion (track units × the bone's world scale)
      const bone = this.model.getObjectByName(t.name.slice(0, t.name.lastIndexOf('.')));
      const ws = bone?.parent ? bone.parent.getWorldScale(new Vector3()).x : 1;
      travel = Math.max(travel, (len * ws) / clip.duration);
    }
    this.walkClip = { action: this.mixer.clipAction(clip), naturalSpeed: travel || 1.4, on: false };
    this.walkClip.action.setLoop(LoopRepeat, Infinity);
  }

  update(dt) {
    this.pose?.restore();
    const W = this.walkClip;
    if (W) {
      const moving = this.speed > 0.25;
      if (moving && !W.on) W.action.reset().fadeIn(0.3).play();
      if (!moving && W.on) W.action.fadeOut(0.35);
      W.on = moving;
      W.action.setEffectiveTimeScale(Math.max(0.4, this.speed / W.naturalSpeed));
    }
    this.mixer?.update(dt);
    if (this.pose) {
      // the clip owns the body while it plays; the procedural stance fades in as it fades out
      this.pose.bodyWeight = W ? 1 - (W.action.isRunning() ? W.action.getEffectiveWeight() : 0) : 1;
      this.pose.apply(dt, W ? 0 : this.speed);
    }
  }

  dispose() {
    this.mixer?.stopAllAction();
    disposeObject(this.root);
  }
}

/**
 * Everyone in the park, staged at their opening marks. (Per-act choreography,
 * recolouring and the scarf are layered on by the acts themselves.)
 *   him, her          — the couple at the clearing's centre
 *   catHim, catHer    — their cats, one beside each
 *   dancers[0..4]     — festival visitors around the clearing
 *   dragon            — the street-performance dragon on the dim stage
 *   picnic            — the Act II picnic set under the picnic tree
 *   scarf             — hidden until the Act III scarf moment
 */
export class Cast {
  constructor(scene, gltf) {
    this.scene = scene;
    this.actors = [];
    const make = (name, key, fit, opts) => {
      if (!gltf[key]) return null;
      const a = new Actor(name, gltf[key], fit, opts);
      scene.add(a.root);
      this.actors.push(a);
      return a;
    };
    this.him = make('him', 'man', { height: ASSETS.man.height });
    this.her = make('her', 'girl', { height: ASSETS.girl.height });
    this.catHim = make('catHim', 'cat', { height: ASSETS.cat.height }, { clone: true });
    this.catHer = make('catHer', 'cat', { height: ASSETS.cat.height }, { clone: true });
    this.dancers = OUTFITS.map((_, i) => make(`dancer${i}`, 'dancer', { height: ASSETS.dancer.height * (0.97 + ((i * 37) % 7) * 0.01) }, { clone: true })).filter(Boolean);
    // dancer.glb has no skeleton: auto-rig it (once) and dress each dancer in her own colours
    this.dancers.forEach((d, i) => {
      const rig = rigDancer(d, gltf.dancer.scene, OUTFITS[i % OUTFITS.length]);
      rig.offset = i * 1.37; // not in lock-step
      rig.routine = [...rig.routine.slice(i), ...rig.routine.slice(0, i)];
      rig.want = 0.12; // a little sway while waiting
    });
    this.dragon = make('dragon', 'dragon', { length: ASSETS.dragon.length });
    if (gltf.picnic) cleanPicnic(gltf.picnic.scene);
    this.picnic = make('picnic', 'picnic', { width: ASSETS.picnic.width });
    if (this.picnic) this.picnic.model.position.y += 0.01; // lie on the grass, not in it
    this.scarf = make('scarf', 'scarf', { height: 0.28 });
    if (this.scarf) {
      this.scarf.root.visible = false; // until Act III: she wraps it round his neck
      dressScarf(this.scarf); // plain white → maroon coffee-red knit
    }

    // ── opening marks, spread down the lane (each act moves people on from here) ──
    // the couple + cats at the park gate, facing down the lane
    const g0 = lanePoint(0.02), g1 = lanePoint(0.06), side = laneSide(0.02);
    const at = (along, across) => g0.clone().addScaledVector(side, across).add(g1.clone().sub(g0).normalize().multiplyScalar(along));
    const put = (actor, p, look) => actor?.place(p.x, p.z).faceTo(look.x, look.z);
    put(this.him, at(0.6, 0.55), g1);
    put(this.her, at(0, -0.55), g1);
    put(this.catHim, at(0.9, 1.25), g1);
    put(this.catHer, at(0.2, -1.3), g1);
    // festival visitors: two strolling by the picnic lawn, three waiting in the plaza
    const pc = STATIONS.picnic, pz = STATIONS.plaza;
    const visitorSpots = [
      lanePoint(pc.u - 0.035).addScaledVector(laneSide(pc.u - 0.035), -1.0),
      lanePoint(pc.u + 0.04).addScaledVector(laneSide(pc.u + 0.04), 1.1),
      ...[0, 1, 2].map((i) => pz.center.clone().add(new Vector3(Math.cos(i * 2.1 + 0.4) * 6.5, 0, Math.sin(i * 2.1 + 0.4) * 6.5))),
    ];
    // the rest wait around the plaza (Act IV gathers everyone)
    for (let i = visitorSpots.length; i < this.dancers.length; i++) {
      const a = i * 0.93 + 0.4;
      visitorSpots.push(pz.center.clone().add(new Vector3(Math.cos(a) * 9, 0, Math.sin(a) * 9)));
    }
    this.dancers.forEach((d, i) => {
      const p = visitorSpots[i];
      const look = i < 2 ? lanePoint(pc.u) : pz.center;
      d.place(p.x, p.z).faceTo(look.x + 0.01, look.z);
    });
    // the dragon on its dim stage, facing the lane; the picnic set on its lawn
    const st = STATIONS.stage;
    const stLook = lanePoint(st.u);
    this.dragon?.place(st.center.x, st.center.z).faceTo(stLook.x, stLook.z);
    if (this.dragon) this.aimDragon(st.center, stLook);
    // the neighbouring family's picnic (picnic.glb) a few metres along the lawn
    const along = lanePoint(pc.u + 0.004).sub(lanePoint(pc.u - 0.004)).setY(0).normalize();
    const nb = pc.center.clone().addScaledVector(along, 5.2).addScaledVector(pc.center.clone().sub(lanePoint(pc.u)).setY(0).normalize(), 1.2);
    this.picnic?.place(nb.x, nb.z, pc.heading + 0.4);
    this.setupSpread(pc, along);

    this.dragon?.play(Object.keys(this.dragon.clips)[0]);
    this.setupHumans();
  }

  /**
   * The couple's hanami: a gingham cloth (built in code) on the picnic lawn
   * with the Japanese spread on it. The frame's +x runs along the cloth's
   * long side (parallel to the lane), z across it; the dishes start hidden
   * until Act II reveals them; the seats are on the two long edges.
   */
  setupSpread(pc, along) {
    const frame = new Group();
    frame.position.copy(pc.center).setY(0);
    frame.rotation.y = Math.atan2(-along.z, along.x); // its +x runs along the lane
    this.scene.add(frame);
    const length = 2.5, width = 1.75;
    this.clothMesh = hanamiCloth(length, width);
    frame.add(this.clothMesh);
    this.spread = buildSpread(frame, { length, width, clothTop: 0.016 });
    this.spread.frame = frame;
    this.spread.size = { length, width };
    for (const d of this.spread.dishes) d.scale.setScalar(0.0001);
    // they sit side by side round one corner of the cloth, each angled toward the other (~0.6 m
    // apart, legs pointing different ways so they never collide), the sharing plate in front —
    // close enough to feed each other with a softly bent arm, never a lunge
    const edge = width / 2 - 0.15;
    this.spread.seats = { him: new Vector3(0.74, 0, -edge + 0.02), her: new Vector3(length / 2 - 0.18, 0, -0.37) };
    this.spread.faces = { him: new Vector3(0.75, 0, 0.1), her: new Vector3(0.45, 0, -0.55) }; // where each looks (into the corner, toward the other)
  }

  /** A point in the spread's frame → world. */
  spreadToWorld(local, out = new Vector3()) {
    this.spread.frame.updateMatrixWorld(true);
    return out.copy(local).applyMatrix4(this.spread.frame.matrixWorld);
  }

  /** Relaxed hands / stance / gait for the couple; her prop removed and her clip reduced to the butterflies. */
  setupHumans() {
    if (this.him) {
      // a clean, unobscured face: his glasses come off
      this.him.model.traverse((o) => {
        if (o.isMesh && /glasses/i.test(`${o.name} ${o.material?.name}`)) o.visible = false;
      });
      this.him.pose = new PoseRig(this.him.model, this.him.root, { family: 'mixamo', armOut: 0.2, stride: 1.4 });
      this.him.setWalkClip('walking');
    }
    const her = this.her;
    if (her) {
      her.needles = [];
      her.model.traverse((o) => {
        if (!o.isMesh || !HER.hideMaterials.includes(o.material?.name)) return;
        o.visible = false;
        if (o.material.name === 'Material.006') her.needles.push(o); // back out for the knitting in Act III
      });
      her.model.traverse((o) => {
        const k = o.isMesh && HER.dimWhites[o.material?.name];
        if (k && !o.material.userData.dimmed) {
          o.material.color.multiplyScalar(k);
          o.material.emissive?.setRGB(0, 0, 0);
          o.material.userData.noGlow = true; // CharacterLook keeps emissive off for these
          o.material.userData.dimmed = true;
        }
      });
      const clip = Object.values(her.clips)[0];
      if (clip) {
        const butterflies = new AnimationClip('butterflies', clip.duration, clip.tracks.filter((t) => HER.keepTracks.test(t.name)));
        her.clips = { butterflies };
        her.mixer.stopAllAction();
        her.play('butterflies', { fade: 0 });
      }
      her.pose = new PoseRig(her.model, her.root, { family: 'rigify', armOut: 0.42, stride: 1.3, headLock: true });
      reweightSkirt(her.model);
      rigidHair(her.model);
      // a fitted black bandana over her crown and hairline, on her head bone — fitted on her
      // first posed frame (see update): before that her eye bones aren't placed yet
      her.bandana = null; // arms clear of her flared skirt
    }
  }

  /**
   * Character lighting calibration (see CharacterLook) + her dark-brown hair.
   * Called once the look system exists.
   */
  calibrate(look) {
    for (const a of [this.him, this.catHim, this.catHer, ...this.dancers]) a && look.apply(a, { footprint: a.name.startsWith('cat') ? 0.4 : 0.85 });
    if (this.her) look.apply(this.her, { footprint: 0.8, hair: HER.hair });
  }

  /**
   * The phoenix model doesn't face its own +Z: turn it so its HEAD points at
   * the audience (the lane) and slide it back so the head hangs over the
   * front of the stage, where its fire will be seen.
   */
  aimDragon(center, audience) {
    const d = this.dragon;
    let head = null;
    d.model.traverse((o) => {
      if (!head && o.isBone && o.name.startsWith('b_Head')) head = o;
    });
    if (!head) return;
    d.root.updateMatrixWorld(true);
    const off = head.getWorldPosition(new Vector3()).sub(d.root.position).setY(0);
    const want = audience.clone().sub(center).setY(0).normalize();
    const turn = Math.atan2(want.x, want.z) - Math.atan2(off.x, off.z);
    d.root.rotation.y += turn;
    d.root.updateMatrixWorld(true);
    const off2 = head.getWorldPosition(new Vector3()).sub(d.root.position).setY(0);
    // head ~2.5 m in from the stage's front edge
    d.root.position.copy(center).addScaledVector(want, 2.0).sub(off2);
  }

  /**
   * Keep the worn scarf on his neck (from Act III on). `grow` < 1 while it's
   * being put on. The model is a draped wrap (a loop) with fringed tails; the
   * loop's centre is measured once from the mesh (its top third) and placed
   * right on his neck bone, sized to sit snug round the coat collar and hood.
   */
  followScarf(grow = 1) {
    const sc = this.scarf, neck = this.him?.pose?.b.neck;
    if (!sc || !neck) return;
    if (!this.scarfLoop) {
      // the loop centre in the scarf's own (unit-scale) space
      sc.root.position.set(0, 0, 0);
      sc.root.rotation.set(0, 0, 0);
      sc.root.scale.setScalar(1);
      sc.root.updateMatrixWorld(true);
      const pts = [], p = new Vector3();
      sc.model.traverse((o) => {
        if (!o.isMesh) return;
        const a = o.geometry.attributes.position;
        for (let i = 0; i < a.count; i += 2) pts.push(p.fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld).clone());
      });
      const box = new Box3().setFromPoints(pts);
      const top = pts.filter((q) => q.y > box.max.y - (box.max.y - box.min.y) * 0.3);
      this.scarfLoop = top.reduce((s, q) => s.add(q), new Vector3()).divideScalar(Math.max(1, top.length));
    }
    const S = 1.5 * grow;
    sc.root.visible = true;
    sc.root.rotation.y = this.him.root.rotation.y;
    sc.root.scale.setScalar(S);
    const off = this.scarfLoop.clone().multiplyScalar(S).applyAxisAngle(new Vector3(0, 1, 0), sc.root.rotation.y);
    neck.getWorldPosition(sc.root.position).sub(off);
    sc.root.position.y -= 0.035; // the loop's middle just below the neck bone, on the collar
    sc.root.position.addScaledVector(this.him.root.getWorldDirection(new Vector3()), 0.025);
  }

  /**
   * Her butterflies (they flutter round her): sent away for the close moments — at the proposal
   * and the kiss one would otherwise flutter right through his hair (the "white patch on his head").
   */
  butterflies(on) {
    this.her?.model.traverse((o) => {
      if (o.isSkinnedMesh && /^(Material\.00[789]|material)$/.test(o.material?.name ?? '')) o.visible = on;
    });
  }

  /** Centre between the couple at chest height (camera framing helper). */
  coupleCenter(out = new Vector3()) {
    if (!this.him || !this.her) return out.set(0, 1.3, 0);
    return out.copy(this.him.root.position).add(this.her.root.position).multiplyScalar(0.5).setY(1.3);
  }

  update(dt) {
    for (const a of this.actors) a.update(dt);
    const her = this.her;
    if (her && her.bandana === null && her.pose) her.bandana = fitBandana(her, { hairMaterials: HER.hair.materials }) ?? false;
  }

  dispose() {
    for (const a of this.actors) a.dispose();
    this.actors = [];
  }
}
