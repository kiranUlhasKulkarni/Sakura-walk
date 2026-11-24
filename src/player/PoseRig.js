import { Matrix4, Quaternion, Vector3 } from 'three';
import { clamp, damp } from '../utils/math.js';

/**
 * Procedural body layer for the imported humanoids (works on both the
 * Mixamo rig of "him" and the Blender-Rigify rig of "her").
 *
 * Every frame:  restore rest pose → (mixer applies any clip) → this layer:
 *   • relaxed stance: upper arms hang at the sides, a soft bend at the elbow,
 *     wrists eased slightly in — instead of the T / A bind pose or a prop-
 *     holding clip pose. Head and neck are re-levelled to look straight ahead,
 *   • soft hands: each finger curls a little more than the one before it
 *     (index → pinky), thumb tucked toward the palm, a small wrist bend —
 *     the "grip spacing" of a hand at rest,
 *   • a walk cycle when no clip drives the body (her): thigh swing, knee bend
 *     on the passing leg, counter-swinging arms, pelvis bob and sway, a tiny
 *     shoulder counter-twist; plus breathing when standing,
 *   • every rotation is computed in WORLD space and converted to the bone's
 *     local frame, so the same code serves rigs with different bone axes.
 *
 * `bodyWeight` (0..1) fades the stance/walk layer out where a real clip
 * (his Mixamo walk) should own the body; the finger layer always applies.
 */
const _q = new Quaternion();
const _q2 = new Quaternion();
const _pw = new Quaternion();
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _d = new Vector3();
const _n = new Vector3();
const UP = new Vector3(0, 1, 0);

const clean = (n) => n.replace(/^mixamorig:?/i, '').replace(/_\d+$/, '');

/** Bone maps per rig family: logical name → regex on the cleaned bone name. */
const MAPS = {
  mixamo: {
    hips: /^Hips$/, spine: /^Spine$/, chest: /^Spine2$/, neck: /^Neck$/, head: /^Head$/,
    upperArmL: /^LeftArm$/, forearmL: /^LeftForeArm$/, handL: /^LeftHand$/,
    upperArmR: /^RightArm$/, forearmR: /^RightForeArm$/, handR: /^RightHand$/,
    thighL: /^LeftUpLeg$/, shinL: /^LeftLeg$/, footL: /^LeftFoot$/,
    thighR: /^RightUpLeg$/, shinR: /^RightLeg$/, footR: /^RightFoot$/,
    toeL: /^LeftToeBase$/, toeR: /^RightToeBase$/,
    finger: (side, f, j) => new RegExp(`^${side === 'L' ? 'Left' : 'Right'}Hand${{ thumb: 'Thumb', index: 'Index', middle: 'Middle', ring: 'Ring', pinky: 'Pinky' }[f]}${j}$`),
  },
  rigify: {
    hips: /^DEF-spine$/, spine: /^DEF-spine001$/, chest: /^DEF-spine003$/, neck: /^DEF-spine004$/, head: /^DEF-spine006$/,
    upperArmL: /^DEF-upper_armL$/, forearmL: /^DEF-forearmL$/, handL: /^DEF-handL$/,
    upperArmR: /^DEF-upper_armR$/, forearmR: /^DEF-forearmR$/, handR: /^DEF-handR$/,
    thighL: /^DEF-thighL$/, shinL: /^DEF-shinL$/, footL: /^DEF-footL$/,
    thighR: /^DEF-thighR$/, shinR: /^DEF-shinR$/, footR: /^DEF-footR$/,
    toeL: /^DEF-toeL$/, toeR: /^DEF-toeR$/,
    finger: (side, f, j) => (f === 'thumb' ? new RegExp(`^DEF-thumb0${j}${side}$`) : new RegExp(`^DEF-f_${f}0${j}${side}$`)),
  },
};
const FINGERS = ['index', 'middle', 'ring', 'pinky'];

const _m1 = new Matrix4();
const _m2 = new Matrix4();
const _rw = new Quaternion();
const _rw2 = new Quaternion();
const _aimQ = new Quaternion();

/** Rotate `bone` by world-space quaternion R (about its own pivot): L' = P⁻¹·R·P·L. */
export function rotateWorld(bone, R, weight = 1) {
  if (weight <= 0) return;
  _rw.copy(R);
  if (weight < 1) {
    _rw2.identity().slerp(_rw, weight);
    _rw.copy(_rw2);
  }
  bone.parent.getWorldQuaternion(_pw);
  _q.copy(_pw).invert().multiply(_rw).multiply(_pw);
  bone.quaternion.premultiply(_q);
  bone.updateMatrixWorld(true);
}

/** Turn `bone` so the direction bone → `child` points along world `dir`. */
function aim(bone, child, dir, weight = 1) {
  bone.getWorldPosition(_a);
  child.getWorldPosition(_b);
  _c.subVectors(_b, _a).normalize();
  _aimQ.setFromUnitVectors(_c, _d.copy(dir).normalize());
  rotateWorld(bone, _aimQ, weight);
}

export class PoseRig {
  /**
   * @param {Object3D} model   the fitted model (bones under it)
   * @param {Object3D} root    the actor's root (gives facing)
   * @param {Object}   opts    { family: 'mixamo' | 'rigify', curl: 1, armOut: 0.14 }
   */
  constructor(model, root, { family, curl = 1, armOut = 0.14, stride = 1.25, armWeight = { L: 1, R: 1 }, headLock = false } = {}) {
    // headLock: turn the head only at the NECK (the head bone stays rigid on it). Her face mesh is
    // weighted across neck / spine005 / head while her hair rides the head bone alone — rotating the
    // head bone by itself shears the scalp out through the hair (the "bald spot" glitch).
    this.headLock = headLock;
    this.model = model;
    this.root = root;
    this.curl = curl;
    this.armOut = armOut;
    this.armWeight = armWeight;
    this.wristAim = true;
    this.foreAim = true; // per-arm strength of the relaxed stance (a rig whose skinning tears can be eased)
    this.stride = stride; // metres per full gait cycle (two steps)
    const bones = {};
    model.traverse((o) => {
      if (o.isBone) bones[clean(o.name)] = o;
    });
    const map = MAPS[family];
    const find = (re) => Object.entries(bones).find(([n]) => re.test(n))?.[1] ?? null;
    this.b = {};
    for (const k of Object.keys(map)) if (k !== 'finger') this.b[k] = find(map[k]);
    this.fingers = { L: {}, R: {} };
    for (const side of ['L', 'R'])
      for (const f of ['thumb', ...FINGERS]) this.fingers[side][f] = [1, 2, 3].map((j) => find(map.finger(side, f, j))).filter(Boolean);
    // rest pose of every bone we touch (restored each frame before the mixer runs)
    this.touched = new Set([...Object.values(this.b).filter(Boolean), ...Object.values(this.fingers.L).flat(), ...Object.values(this.fingers.R).flat()]);
    this.rest = new Map([...this.touched].map((bn) => [bn, bn.quaternion.clone()]));
    this.restModel = model.position.clone();
    this.restModelY = model.position.y;
    this.phase = 0;
    this.speed = 0;
    this.t = Math.random() * 10;
    this.bodyWeight = 1;
    // arm reach (throwing / catching / offering): per side a world target + weight 0..1
    this.reach = { L: { target: new Vector3(), w: 0 }, R: { target: new Vector3(), w: 0 } };
    // sitting on the ground: w 0..1 blends from standing; style 'seiza' (kneeling) | 'agura' (cross-legged)
    this.sit = { w: 0, style: 'seiza' };
    // dancing on the beat (Act IV): w 0..1; the arms are left to reach targets
    this.dance = { w: 0, beat: 0, bpm: 145, sway: 1 };
    this.gazeUp = 0;
    this.lean = 0; // forward bend of the upper body (rad): bending down to her for the kiss
    this.lift = 0; // body raised (m): + up on her toes, − knees softening
    this.sitHands = { L: new Vector3(), R: new Vector3() };
    this.hipH = null; // standing hip height above the feet (measured from the rest pose)
    this.ok = !!(this.b.upperArmL && this.b.forearmL && this.b.upperArmR && this.b.forearmR);
    // Prop / IK helper bones parented to the skeleton ROOT but carrying skin (her "holdL/R":
    // ~60 hand vertices each) would stay frozen at the bind pose while the hands move — the
    // skin tears into a long strip. They're re-attached to the hands with their bind offset.
    model.updateMatrixWorld(true);
    this.attached = [];
    for (const side of ['L', 'R']) {
      const hold = Object.entries(bones).find(([n]) => new RegExp(`^hold${side}$`).test(n))?.[1];
      const hand = this.b[`hand${side}`];
      if (hold && hand) this.attached.push({ bone: hold, to: hand, offset: new Matrix4().copy(hand.matrixWorld).invert().multiply(hold.matrixWorld), restPos: hold.position.clone(), restQuat: hold.quaternion.clone() });
    }
    // Her FACE rig (jaw, temples, brows, cheeks, lips, eyes…) was exported parented to the
    // armature root, not the head: when the head turns or tilts, the skull and hair go with it but
    // the face stays behind — the forehead bares, the features warp. Every such bone is re-attached
    // to ride rigidly on the head bone, at its rest offset.
    const head = this.b.head;
    if (head) {
      const FACE = /^(DEF-(jaw|temple|brow|cheek|lip|nose|eye|lid|forehead|ear|tongue|teeth|tooth|chin|mouth)|eye|ORG-face|MCH-eye)/i;
      model.traverse((o) => {
        if (!o.isBone || o === head || !FACE.test(o.name)) return;
        // only the ones NOT already under the head (a properly parented face needs nothing)
        let p = o.parent, underHead = false;
        while (p) {
          if (p === head) underHead = true;
          if (!p.isBone || FACE.test(p.name)) break;
          p = p.parent;
        }
        if (underHead || (o.parent?.isBone && FACE.test(o.parent.name))) return; // chains follow their face parent
        this.attached.push({ bone: o, to: head, offset: new Matrix4().copy(head.matrixWorld).invert().multiply(o.matrixWorld), restPos: o.position.clone(), restQuat: o.quaternion.clone() });
      });
    }
  }

  /** Call BEFORE the mixer updates. */
  restore() {
    for (const [bn, q] of this.rest) bn.quaternion.copy(q);
    for (const a of this.attached ?? []) {
      a.bone.position.copy(a.restPos);
      a.bone.quaternion.copy(a.restQuat);
    }
    this.model.position.copy(this.restModel);
  }

  /** Call AFTER the mixer. `speed` in m/s drives the gait. */
  apply(dt, speed = 0) {
    if (!this.ok) return;
    this.t += dt;
    this.speed += (speed - this.speed) * damp(8, dt);
    this.root.updateMatrixWorld(true);
    if (this.hipH == null && this.b.thighL) {
      // standing hip height above the root (measured once, in the rest pose)
      this.hipH = this.b.thighL.getWorldPosition(new Vector3()).y - this.root.getWorldPosition(new Vector3()).y;
    }
    const w = this.bodyWeight;
    // character frame
    const fwd = _n.set(0, 0, 1).applyQuaternion(this.root.getWorldQuaternion(new Quaternion())).setY(0).normalize().clone();
    const right = new Vector3().crossVectors(fwd, UP).normalize(); // character's right (fwd × up)
    const walk = clamp(this.speed / 1.3, 0, 1);
    this.phase += (dt * this.speed * Math.PI * 2) / this.stride;
    const ph = this.phase;

    if (w > 0) {
      const b = this.b;
      // ── gait cycle (her; his walk comes from his clip) ──
      // Each leg runs a phase φ ∈ [0,1): heel strike at 0, stance until ~0.6 (toe-off),
      // swing until 1. Joint profiles follow normal human gait:
      //   hip   +21° flexed at heel strike → −13° extended at push-off → flexes through swing
      //   knee  ~15° "loading" flex after heel strike, ~60° flex mid-swing (the foot lifts clear)
      //   ankle plantarflex at push-off (heel rises, toes push), dorsiflex in swing (toes up)
      // Pelvis: dips at double support, rises over the stance leg, shifts its weight onto it,
      // the swing-side hip drops (list) and rotates forward; the chest counter-rotates.
      const amp = walk > 0 ? Math.pow(walk, 0.7) : 0;
      const TAU = Math.PI * 2;
      const bump = (x, c, w) => {
        let d = x - c;
        d -= Math.round(d);
        return Math.exp(-((d / w) ** 2));
      };
      const phase = (ph / TAU) % 1;
      const legPh = { L: phase, R: (phase + 0.5) % 1 };
      const hipAng = (f) => (4 + 17 * Math.cos(TAU * f) + 3 * Math.sin(TAU * f)) * (Math.PI / 180);
      const kneeAng = (f) => (3 + 15 * bump(f, 0.13, 0.09) + 60 * bump(f, 0.73, 0.13)) * (Math.PI / 180);
      const ankleAng = (f) => (6 * bump(f, 0.02, 0.06) - 16 * bump(f, 0.6, 0.07) + 9 * bump(f, 0.82, 0.1)) * (Math.PI / 180);

      // ── arms hang relaxed, swinging against the legs ──
      for (const s of ['L', 'R']) {
        const ua = b[`upperArm${s}`], fa = b[`forearm${s}`], hand = b[`hand${s}`];
        if (!ua || !fa) continue;
        // which way is "out" for this arm (from the body centre to the shoulder)
        b.chest?.getWorldPosition(_a) ?? this.root.getWorldPosition(_a);
        ua.getWorldPosition(_b);
        const out = _b.sub(_a).setY(0).normalize().clone();
        const other = s === 'L' ? 'R' : 'L';
        const swing = walk > 0.01 ? Math.sin(hipAng(legPh[other]) * 1.4) * 0.5 * amp : 0; // with the opposite leg
        const breathe = Math.sin(this.t * 1.4) * 0.012;
        const armDir = new Vector3(0, -1, 0).addScaledVector(out, this.armOut + breathe).addScaledVector(fwd, 0.04 + swing);
        const aw = w * (this.armWeight[s] ?? 1);
        aim(ua, fa, armDir, aw);
        if (hand) {
          const elbow = 0.24 + Math.max(0, swing) * 0.7; // the forearm lifts more on the forward swing
          const foreDir = new Vector3(0, -1, 0).addScaledVector(fwd, Math.sin(elbow) + swing * 0.5).addScaledVector(out, 0.05);
          aim(fa, hand, foreDir, aw);
          // wrist: hands turned in toward the thighs, slightly cupped
          const mid = this.fingers[s].middle[0];
          if (mid) aim(hand, mid, foreDir.clone().addScaledVector(out, -0.22).addScaledVector(fwd, 0.08), aw * 0.8);
        }
      }

      if (amp > 0.01) {
        const stanceL = Math.cos(TAU * phase); // >0 while the left leg carries the weight (around φ 0..0.5)
        // pelvis: transverse rotation (swing hip forward), list (swing side drops), forward lean
        if (b.hips) {
          rotateWorld(b.hips, _q2.setFromAxisAngle(UP, Math.sin(TAU * phase) * 0.09 * amp), w);
          rotateWorld(b.hips, _q2.setFromAxisAngle(fwd, -Math.sin(TAU * phase) * 0.06 * amp), w);
        }
        if (b.spine) rotateWorld(b.spine, _q2.setFromAxisAngle(right, 0.05 * amp), w); // a slight forward lean into the walk
        if (b.chest) {
          rotateWorld(b.chest, _q2.setFromAxisAngle(UP, -Math.sin(TAU * phase) * 0.16 * amp), w); // shoulders counter the hips
          rotateWorld(b.chest, _q2.setFromAxisAngle(fwd, Math.sin(TAU * phase) * 0.05 * amp), w);
        }
        // legs: + about `right` swings a limb forward (right × down = forward)
        for (const s of ['L', 'R']) {
          const th = b[`thigh${s}`], sh = b[`shin${s}`], ft = b[`foot${s}`];
          if (!th || !sh) continue;
          const f = legPh[s];
          rotateWorld(th, _q2.setFromAxisAngle(right, hipAng(f) * amp), w);
          rotateWorld(sh, _q2.setFromAxisAngle(right, -kneeAng(f) * amp), w); // flexion: the shin folds back
          if (ft) rotateWorld(ft, _q2.setFromAxisAngle(right, ankleAng(f) * amp), w);
        }
        // weight transfer: the body rises over the stance leg and dips at double support,
        // and shifts sideways onto whichever foot is planted
        const bob = -Math.cos(2 * TAU * phase) * 0.022 * amp - 0.012 * amp;
        const sway = stanceL * 0.022 * amp; // + = toward her left
        const left = new Vector3().copy(right).negate();
        const local = left.multiplyScalar(sway).add(new Vector3(0, bob, 0));
        // into the root's local frame (the model is the root's child)
        local.applyQuaternion(this.root.getWorldQuaternion(new Quaternion()).invert());
        this.model.position.copy(this.restModel).add(local);
      } else if (b.chest) {
        // breathing
        rotateWorld(b.chest, _q2.setFromAxisAngle(right, Math.sin(this.t * 1.4) * 0.015), w);
      }
      if (this.dance.w > 0.001) this.applyDance(dt, this.dance.w * w * (1 - walk), fwd, right);
      if (this.lean) {
        // (about `right`, a negative angle tips the upper body FORWARD: right × up = −forward)
        if (b.spine) rotateWorld(b.spine, _q2.setFromAxisAngle(right, -this.lean * 0.45));
        if (b.chest) rotateWorld(b.chest, _q2.setFromAxisAngle(right, -this.lean * 0.55));
      }
      if (this.lift) {
        this.model.position.y += this.lift;
        // on tiptoe: heels up (feet pitch down); knees soften when lowering
        for (const s of ['L', 'R']) {
          const ft = b[`foot${s}`];
          if (ft && this.lift > 0) rotateWorld(ft, _q2.setFromAxisAngle(right, Math.min(0.6, this.lift * 7)));
        }
        this.model.updateMatrixWorld(true);
      }
      if (this.sit.w > 0.001) this.applySit(this.sit.w * w, fwd, right);
      // ── head & neck last (after the hips / chest moved them): level, looking straight ahead ──
      if (this.headLock) {
        if (b.neck) this.level(b.neck, fwd, w);
      } else {
        if (b.head && b.neck) this.level(b.neck, fwd, w * 0.6);
        if (b.head) this.level(b.head, fwd, w);
      }
    }
    this.applyReach();
    this.relaxHands();
    this.followAttached();
  }

  /** Keep root-parented helper bones riding on the hands (see constructor). */
  followAttached() {
    for (const a of this.attached) {
      a.to.updateMatrixWorld(true);
      _m1.copy(a.to.matrixWorld).multiply(a.offset); // desired world matrix
      _m2.copy(a.bone.parent.matrixWorld).invert().multiply(_m1); // → parent-local
      _m2.decompose(a.bone.position, a.bone.quaternion, a.bone.scale);
      a.bone.updateMatrixWorld(true);
    }
  }

  /**
   * Sitting on the picnic cloth. Every limb is AIMED at a world direction in
   * the character's frame, so the same code poses both rigs:
   *   seiza  kneeling — thighs forward and a little down, shins folded straight
   *          back under her, feet pointing back, pelvis resting on her heels
   *   agura  cross-legged — thighs out and forward, shins crossing inward,
   *          pelvis almost on the ground, a relaxed slump
   *   chair  on a bench — thighs level, shins down, feet flat
   * The pelvis is lowered so the knees meet the ground; hands come to rest on
   * the thighs (unless an act is using the arms).
   */
  applySit(sw, fwd, right) {
    const b = this.b;
    if (this.hipH == null) return;
    const agura = this.sit.style === 'agura';
    const chair = this.sit.style === 'chair';
    const kneel = this.sit.style === 'kneel'; // the proposal: down on his left knee, right foot planted
    // pelvis height when seated: cross-legged / kneeling on the ground, or on a bench of height seatY
    const seat = kneel ? this.hipH * 0.55 : chair ? (this.sit.seatY ?? 0.48) + 0.09 : agura ? 0.24 : 0.42;
    const pos = this.model.position;
    pos.y -= (this.hipH - seat) * sw;
    this.model.updateMatrixWorld(true);
    const down = new Vector3(0, -1, 0);
    for (const s of ['L', 'R']) {
      const th = b[`thigh${s}`], sh = b[`shin${s}`], ft = b[`foot${s}`], toe = b[`toe${s}`];
      if (!th || !sh || !ft) continue;
      const out = (s === 'L' ? right.clone().negate() : right.clone());
      if (kneel && s === 'L') {
        // the knee on the grass: thigh straight down, shin along the ground behind, toes tucked
        aim(th, sh, down.clone().addScaledVector(fwd, -0.08).addScaledVector(out, 0.06), sw);
        aim(sh, ft, fwd.clone().multiplyScalar(-0.97).addScaledVector(down, 0.18), sw);
        if (toe) aim(ft, toe, fwd.clone().multiplyScalar(-0.55).addScaledVector(down, 0.85), sw * 0.8);
      } else if (kneel) {
        // the other leg: thigh forward and level, shin straight down, foot flat
        aim(th, sh, fwd.clone().addScaledVector(down, 0.12).addScaledVector(out, 0.12), sw);
        aim(sh, ft, down.clone().addScaledVector(fwd, 0.04), sw);
        if (toe) aim(ft, toe, fwd.clone().addScaledVector(down, 0.35), sw * 0.8);
      } else if (chair) {
        // on a bench: thighs level and a little apart, shins straight down, feet flat
        aim(th, sh, fwd.clone().addScaledVector(down, 0.08).addScaledVector(out, 0.1), sw);
        aim(sh, ft, down.clone().addScaledVector(fwd, 0.12).addScaledVector(out, 0.02), sw);
        if (toe) aim(ft, toe, fwd.clone().addScaledVector(down, 0.25), sw * 0.8);
      } else if (agura) {
        aim(th, sh, fwd.clone().multiplyScalar(0.72).addScaledVector(out, 0.66).addScaledVector(down, 0.2), sw);
        aim(sh, ft, out.clone().multiplyScalar(-0.86).addScaledVector(fwd, 0.36).addScaledVector(down, 0.18), sw);
        if (toe) aim(ft, toe, out.clone().multiplyScalar(-0.5).addScaledVector(fwd, 0.4).addScaledVector(down, 0.3), sw * 0.8);
      } else {
        aim(th, sh, fwd.clone().multiplyScalar(0.92).addScaledVector(down, 0.38).addScaledVector(out, 0.12), sw);
        aim(sh, ft, fwd.clone().multiplyScalar(-0.98).addScaledVector(down, 0.06).addScaledVector(out, 0.04), sw);
        if (toe) aim(ft, toe, fwd.clone().multiplyScalar(-0.85).addScaledVector(down, 0.5), sw * 0.9);
      }
      // where the hand rests: on the thigh, toward the knee
      const hip = th.getWorldPosition(new Vector3()), knee = sh.getWorldPosition(new Vector3());
      this.sitHands[s].copy(hip).lerp(knee, agura ? 0.75 : chair ? 0.65 : 0.6).add(new Vector3(0, 0.07, 0)).addScaledVector(out, agura ? -0.02 : -0.03);
    }
    // posture: kneeling upright, cross-legged a touch slumped
    if (b.spine) rotateWorld(b.spine, _q2.setFromAxisAngle(right, (kneel ? -0.08 : agura ? 0.12 : chair ? 0.06 : 0.04) * sw));
  }

  /**
   * Dancing: a bounce on every beat (both knees bend — hips forward, shins
   * back, ankles flex — so the feet stay planted and the pelvis drops), the
   * hips sway side to side over two beats, the shoulders groove against them.
   */
  applyDance(dt, dw, fwd, right) {
    const b = this.b, D = this.dance;
    D.beat += (dt * D.bpm) / 60;
    const TAU = Math.PI * 2;
    const down = Math.pow(0.5 + 0.5 * Math.cos(TAU * (D.beat % 1)), 2);
    const sway = Math.sin((TAU * D.beat) / 2) * D.sway;
    const k = down * 0.2 * dw;
    for (const s of ['L', 'R']) {
      const th = b[`thigh${s}`], sh = b[`shin${s}`], ft = b[`foot${s}`];
      if (!th || !sh) continue;
      rotateWorld(th, _q2.setFromAxisAngle(right, k));
      rotateWorld(sh, _q2.setFromAxisAngle(right, -2 * k));
      if (ft) rotateWorld(ft, _q2.setFromAxisAngle(right, k));
    }
    if (b.hips) rotateWorld(b.hips, _q2.setFromAxisAngle(fwd, sway * 0.06 * dw));
    if (b.chest) {
      rotateWorld(b.chest, _q2.setFromAxisAngle(UP, sway * 0.12 * dw));
      rotateWorld(b.chest, _q2.setFromAxisAngle(fwd, -sway * 0.05 * dw));
    }
    const off = right.clone().multiplyScalar(-sway * 0.03 * dw).add(new Vector3(0, -down * 0.035 * dw, 0));
    off.applyQuaternion(this.root.getWorldQuaternion(new Quaternion()).invert());
    this.model.position.add(off);
    this.model.updateMatrixWorld(true);
  }

  /** Arms reaching toward world targets (on top of whatever the body is doing). */
  applyReach() {
    const b = this.b;
    for (const s of ['L', 'R']) {
      const R = this.reach[s];
      // seated and the act isn't using this arm: rest the hand on the thigh
      if (R.w < 0.05 && this.sit.w > 0.01 && this.sit.style !== 'kneel') {
        R.target.copy(this.sitHands[s]);
        R.w = Math.max(R.w, this.sit.w * 0.85);
        R._auto = true;
      } else if (R._auto && this.sit.w <= 0.01) {
        R.w = 0;
        R._auto = false;
      }
      if (R.w <= 0.001) continue;
      const ua = this.b[`upperArm${s}`], fa = this.b[`forearm${s}`], hand = this.b[`hand${s}`];
      if (!ua || !fa || !hand) continue;
      // two-bone IK with safe limits: the reach is clamped so the arm is never locked straight
      // (no punching, no hyper-extension) nor folded through itself, and the elbow bends down
      // and out to the side, the way a relaxed arm does
      const S = ua.getWorldPosition(new Vector3()), El = fa.getWorldPosition(new Vector3()), H = hand.getWorldPosition(new Vector3());
      const l1 = S.distanceTo(El), l2 = El.distanceTo(H), L = l1 + l2;
      const toT = R.target.clone().sub(S);
      const dc = Math.min(Math.max(toT.length(), 0.35 * L), 0.9 * L); // ≤ 90 %: a soft elbow, always
      const dir = toT.lengthSq() > 1e-8 ? toT.normalize() : new Vector3(0, -1, 0);
      const Tc = S.clone().addScaledVector(dir, dc);
      const along = (l1 * l1 - l2 * l2 + dc * dc) / (2 * dc);
      const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
      const chestP = (b.chest ?? b.spine ?? this.root).getWorldPosition(new Vector3());
      const out = S.clone().sub(chestP).setY(0);
      if (out.lengthSq() < 1e-8) out.set(s === 'L' ? 1 : -1, 0, 0);
      out.normalize();
      const pole = new Vector3(0, -1, 0).addScaledVector(out, 0.65);
      pole.addScaledVector(dir, -pole.dot(dir));
      if (pole.lengthSq() < 1e-6) pole.copy(out).addScaledVector(dir, -out.dot(dir));
      pole.normalize();
      const E = S.clone().addScaledVector(dir, along).addScaledVector(pole, h);
      aim(ua, fa, E.sub(S).normalize(), R.w);
      const El2 = fa.getWorldPosition(new Vector3());
      aim(fa, hand, Tc.sub(El2).normalize(), R.w);
      const mid = this.fingers[s].middle[0];
      if (mid) {
        // the hand: along an act's chosen direction (folded arms: lying along the other forearm),
        // else continuing the reach, a little lifted
        const hd = R.handDirFn?.();
        if (hd) aim(hand, mid, hd, R.w * 0.85);
        else {
          hand.getWorldPosition(_a);
          aim(hand, mid, R.target.clone().sub(_a).normalize().add(new Vector3(0, 0.25, 0)).normalize(), R.w * 0.7);
        }
      }
    }
  }

  /** World position of the mouth (feeding / kissing targets): from the eye bones if the rig has them, else the head. */
  mouthPosition(out = new Vector3()) {
    if (!this.eyes) {
      this.eyes = [];
      this.model.traverse((o) => {
        if (o.isBone && /^eye[LR]_/i.test(o.name)) this.eyes.push(o);
      });
    }
    const fwd = new Vector3(0, 0, 1).applyQuaternion(this.root.getWorldQuaternion(new Quaternion())).setY(0).normalize();
    if (this.eyes.length === 2) {
      this.eyes[0].getWorldPosition(out).lerp(this.eyes[1].getWorldPosition(new Vector3()), 0.5);
      out.y -= this.mouthDrop ?? 0.06;
      return out.addScaledVector(fwd, this.mouthFwd ?? 0.035);
    }
    if (!this.b.head) return this.root.getWorldPosition(out).setY(1.5);
    return this.b.head.getWorldPosition(out).add(new Vector3(0, this.mouthDrop ?? 0.045, 0)).addScaledVector(fwd, this.mouthFwd ?? 0.095);
  }

  /** World position of a hand (palm centre-ish), for props held in it. */
  handPosition(side = 'R', out = new Vector3()) {
    const hand = this.b[`hand${side}`], mid = this.fingers[side].middle[0];
    if (!hand) return this.root.getWorldPosition(out).setY(1);
    hand.getWorldPosition(out);
    if (mid) out.lerp(mid.getWorldPosition(_c), 0.6);
    return out;
  }

  /** Rotate a head/neck bone so its facing is level and points along `fwd` (keeps any nod small). */
  level(bone, fwd, weight) {
    // the bone's "look" axis: whichever local axis is closest to the character's forward at rest
    bone.getWorldQuaternion(_q);
    if (!this.lookAxis) this.lookAxis = new Map();
    let ax = this.lookAxis.get(bone);
    if (!ax) {
      const inv = _q.clone().invert();
      const local = fwd.clone().applyQuaternion(inv);
      // snap to the dominant local axis
      const m = Math.max(Math.abs(local.x), Math.abs(local.y), Math.abs(local.z));
      ax = new Vector3(Math.abs(local.x) === m ? Math.sign(local.x) : 0, Math.abs(local.y) === m ? Math.sign(local.y) : 0, Math.abs(local.z) === m ? Math.sign(local.z) : 0);
      this.lookAxis.set(bone, ax);
    }
    const cur = ax.clone().applyQuaternion(_q);
    const want = fwd.clone().setY(-0.04 + this.gazeUp).normalize(); // gazeUp > 0: looking up at the sky
    rotateWorld(bone, _aimQ.setFromUnitVectors(cur.normalize(), want), weight);
  }

  /** Soft resting hands: graded finger curl toward the palm, thumb tucked. */
  relaxHands() {
    for (const side of ['L', 'R']) {
      const F = this.fingers[side];
      const hand = this.b[`hand${side}`];
      const idx = F.index[0], pky = F.pinky[0], th = F.thumb[0], mid = F.middle[0];
      if (!hand || !idx || !pky || !mid) continue;
      // palm frame from the knuckles: across (pinky → index), along (wrist → middle), palm normal
      hand.getWorldPosition(_a);
      mid.getWorldPosition(_b);
      const along = _b.clone().sub(_a).normalize();
      idx.getWorldPosition(_c);
      pky.getWorldPosition(_d);
      const across = _c.clone().sub(_d).normalize();
      let palm = new Vector3().crossVectors(along, across).normalize();
      // the thumb sits on the palm side: use it to pick the sign
      if (th) {
        th.getWorldPosition(_c);
        const toThumb = _c.sub(_a);
        if (toThumb.dot(palm) < 0) palm.negate();
      }
      FINGERS.forEach((f, fi) => {
        const chain = F[f];
        const base = (0.2 + fi * 0.07) * this.curl; // index 11° … pinky 23° at the knuckle
        const amt = [base, base * 1.5, base * 1.05];
        chain.forEach((bn, j) => {
          const next = chain[j + 1];
          bn.getWorldPosition(_a);
          if (next) next.getWorldPosition(_b);
          else _b.copy(_a).add(along);
          const dir = _b.sub(_a).normalize();
          const axis = new Vector3().crossVectors(dir, palm).normalize();
          if (axis.lengthSq() < 1e-6) return;
          rotateWorld(bn, _q2.setFromAxisAngle(axis, amt[j]));
        });
      });
      // thumb: drawn in toward the index knuckle, joints softly bent
      F.thumb.forEach((bn, j) => {
        const next = F.thumb[j + 1];
        bn.getWorldPosition(_a);
        if (next) next.getWorldPosition(_b);
        else _b.copy(_a).add(along);
        const dir = _b.sub(_a).normalize();
        const axis = new Vector3().crossVectors(dir, palm).normalize();
        if (axis.lengthSq() > 1e-6) rotateWorld(bn, _q2.setFromAxisAngle(axis, (j === 0 ? 0.12 : 0.22) * this.curl));
      });
    }
  }
}
