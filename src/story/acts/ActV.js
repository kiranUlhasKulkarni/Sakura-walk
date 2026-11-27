import { Vector3 } from 'three';
import { RENDER } from '../../config.js';
import { damp } from '../../utils/math.js';
import { STATIONS } from '../../world/lane.js';
import { walkHeight } from '../../world/terrain.js';
import { Injuries, ringBox } from '../Proposal.js';
import { CHAPTERS } from '../chapters.js';
import { wait } from '../Timeline.js';
import { actCard, ask, flashText, letterbox, theEnd } from '../ui.js';

const v = () => new Vector3();
const UP = new Vector3(0, 1, 0);
const SKY = new Vector3(-0.1, 0, -1).normalize();
const RIGHT = new Vector3(-SKY.z, 0, SKY.x);
const HITS = ['Pow!', 'Bonk!', 'Whack!', 'Biff!', 'Thwack!'];

/**
 * ACT V — The Question.
 *
 *  The music dips; the show overhead quietens; the dancers fall back into a
 *  hushed ring. SHE steps up to him, standing tall, and opens a small red ring box.
 *  WILL YOU MARRY ME?   YES / NO
 *
 *  NO   She playfully beats him up — a flurry of punches (Pow! Bonk!) — and he
 *       lands on his backside, seeing stars. He picks himself up with a fresh
 *       injury (a black eye, then a head bandage, then a plaster, then a bump…
 *       they all STAY), and kneels to ask again. The NO button gets smaller.
 *  YES  He slips the ring on her finger, she throws her arms round his neck and
 *       they kiss (and the bruises are kissed better); the music swells, the
 *       sky fills with hearts, the dancers cheer — fade to black. THE END.
 */
export const ActV = {
  name: 'act5',
  hold: true,

  async enter(ctx) {
    const app = ctx.app;
    const { cast, movers, fireworks: fw, music } = app;
    this.app = app;
    this.reach = new Map();
    this.shot = 'ask';
    this.lastKey = null;
    this.shake = 0;
    this.ringAt = 'box';
    this.nos ??= 0;
    if (!cast?.him || !cast.her) return;
    const him = cast.him, her = cast.her;
    const C = STATIONS.plaza.center.clone().setY(0);
    this.C = C;
    // a clean head when the proposal begins: any injuries left from an earlier run are cleared
    // (new ones still come with each NO, and stay until YES)
    app.injuries?.dispose();
    app.injuries = new Injuries(him);
    this.nos = 0;
    this.inj = app.injuries;
    // the ring box (in the scene, carried in his hands)
    this.box = ringBox(app.envMap);
    this.box.group.visible = false;
    app.scene.add(this.box.group);
    ctx.bag.push(() => {
      this.box.group.removeFromParent();
      this.box.group.traverse((o) => o.isMesh && o.geometry.dispose());
      this.box.materials.forEach((m) => m.dispose());
    });

    letterbox(true);
    cast.butterflies(false); // nothing fluttering round his head in the close moments
    setTimeout(() => actCard('V', 'The Question', 5), 600);
    // the music dips, the sky quietens
    music.duckTo(0.55); // "Marry You" dips as she steps up to him
    fw.auto(0.16);
    // the dancers fall back into a hushed ring to watch
    cast.dancers.forEach((d, i) => {
      const a = Math.atan2(-SKY.x, -SKY.z) + (i - (cast.dancers.length - 1) / 2) * 0.55;
      const p = C.clone().add(new Vector3(Math.sin(a), 0, Math.cos(a)).multiplyScalar(5.8 + (i % 2) * 0.6));
      d.pose.want = 0.08;
      movers.walkTo(d, p, { speed: 1.1, face: C });
    });
    for (const a of [him, her]) {
      if (!a.pose) continue;
      a.pose.dance.w = 0;
      a.pose.reach.L.w = a.pose.reach.R.w = 0;
    }
    // their marks: facing each other in the middle of the plaza, the open sky behind them
    this.markHer = C.clone().addScaledVector(RIGHT, 0.5);
    this.markHim = C.clone().addScaledVector(RIGHT, -0.42);
    const catSpot = (k) => C.clone().addScaledVector(SKY, -1.3).addScaledVector(RIGHT, k);
    if (cast.catHim) movers.walkTo(cast.catHim, catSpot(-1.2), { speed: 1.2, face: this.markHim });
    if (cast.catHer) movers.walkTo(cast.catHer, catSpot(1.3), { speed: 1.2, face: this.markHer });
    await Promise.all([
      movers.walkTo(him, this.markHim, { speed: 0.8, face: this.markHer }),
      movers.walkTo(her, this.markHer, { speed: 0.8, face: this.markHim }),
    ]);
    await wait(ctx, 0.8);

    // ── she asks, until he says yes ──
    for (;;) {
      await this.propose(ctx);
      this.shot = 'question';
      ctx.app.music.toPhase3(); // the question: Nezuko's Theme (it stays through any NO)
      // he answers (the player): YES starts Tanjiro's Theme at 2:21 inside the click itself
      const answer = await ask('Will you marry me?', { noScale: Math.max(0.42, 1 - this.nos * 0.16), onAnswer: (x) => x === 'yes' && ctx.app.music.toPhase4() });
      if (answer === 'yes') break;
      this.nos++;
      await this.beatUp(ctx);
    }
    await this.yes(ctx);
  },

  /**
   * SHE proposes: she steps up to him, standing tall, and opens the ring box
   * toward him in both hands; he, caught off guard, a hand to his chest.
   */
  async propose(ctx) {
    const { cast, movers } = ctx.app;
    const him = cast.him, her = cast.her;
    this.shot = 'ask';
    await Promise.all([movers.turnTo(him, her.root.position), movers.turnTo(her, him.root.position)]);
    // one confident step forward
    const toHim = him.root.position.clone().sub(her.root.position).setY(0).normalize();
    await movers.walkTo(her, him.root.position.clone().addScaledVector(toHim, -0.68), { speed: 0.9, face: him.root.position });
    const box = this.box;
    box.hinge.rotation.x = 0;
    box.ring.visible = true;
    box.group.visible = true;
    this.ringAt = 'box';
    this.boxBy = her;
    // the box held out in both hands at her chest, toward his face
    const boxPos = () => her.root.position.clone().addScaledVector(her.root.getWorldDirection(v()), 0.34).setY(walkHeight(her.root.position.x, her.root.position.z) + 1.12);
    const side = () => new Vector3().crossVectors(her.root.getWorldDirection(v()), UP);
    this.setReach(her, 'L', 1, () => boxPos().addScaledVector(side(), -0.05).add(new Vector3(0, -0.02, 0)), 3);
    this.setReach(her, 'R', 1, () => boxPos().addScaledVector(side(), 0.05).add(new Vector3(0, -0.02, 0)), 3);
    ctx.clock.tween(1.2, (k) => {
      her.pose.gazeUp = 0.16 * k; // chin up, looking him in the eye
      him.pose.gazeUp = -0.18 * k;
    });
    await wait(ctx, 1.1);
    await ctx.clock.tween(0.9, (k) => (box.hinge.rotation.x = -1.9 * k)); // the lid opens
    // he's moved: standing easy, one hand opening gently toward her (palm up, a soft elbow),
    // the other relaxed at his side, looking at her
    this.setReach(him, 'R', 0.7, () => {
      const f = him.root.getWorldDirection(v()).setY(0).normalize();
      return him.root.position.clone().addScaledVector(f, 0.34).addScaledVector(new Vector3().crossVectors(f, UP), 0.14).setY(him.root.position.y + 0.98);
    }, 1.6);
    await wait(ctx, 1.4);
  },

  /** NO: a playful flurry of punches; he ends up on the grass with a new injury, then gets back up. */
  async beatUp(ctx) {
    const app = ctx.app;
    const { cast, movers, fireworks: fw } = app;
    const him = cast.him, her = cast.her;
    this.shot = 'fight';
    // the box snaps shut and goes in her pocket
    await ctx.clock.tween(0.3, (k) => (this.box.hinge.rotation.x = -1.9 * (1 - k)));
    this.box.group.visible = false;
    for (const s of ['L', 'R']) this.setReach(him, s, 0, null, 6);
    this.setReach(her, 'L', 0, null, 6);
    this.setReach(her, 'R', 0, null, 6);
    await ctx.clock.tween(0.55, (k) => {
      him.pose.sit.w = 1 - k;
      him.pose.gazeUp = 0.35 * (1 - k);
      her.pose.gazeUp = -0.32 * (1 - k);
    });
    // she storms in
    const toHim = () => him.root.position.clone().sub(her.root.position).setY(0).normalize();
    await movers.walkTo(her, him.root.position.clone().addScaledVector(toHim(), -0.52), { speed: 2.2, face: him.root.position });
    // the flurry
    const n = 7 + Math.min(4, this.nos);
    for (let i = 0; i < n; i++) {
      const s = i % 2 ? 'L' : 'R';
      const head = him.pose.b.head?.getWorldPosition(v()) ?? him.root.position.clone().setY(1.6);
      const target = (i % 3 === 2 ? him.root.position.clone().setY(1.25) : head.add(new Vector3(0, 0.04, 0))).add(new Vector3((Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.1));
      this.setReach(her, s, 1, () => target, 22);
      await wait(ctx, 0.12);
      fw.pop(target, { n: 18 });
      this.shake = 0.7;
      if (i % 2 === 0) flashText(HITS[Math.floor(Math.random() * HITS.length)]);
      // the blow rocks him back a little
      const back = toHim();
      him.root.position.addScaledVector(back, 0.045);
      him.root.rotation.y += (Math.random() - 0.5) * 0.25;
      this.setReach(her, s, 0.55, () => her.root.position.clone().setY(1.2).addScaledVector(toHim(), 0.3).addScaledVector(new Vector3().crossVectors(toHim(), UP), s === 'L' ? -0.12 : 0.12), 12);
      await wait(ctx, 0.08);
    }
    // the last one sends him down onto the grass, seeing stars
    flashText('K.O.!', 'flash-text--good');
    this.setReach(her, 'L', 0, null, 4);
    this.setReach(her, 'R', 0, null, 4);
    him.pose.sit.style = 'agura';
    const from = him.root.position.clone(), back = toHim();
    this.shot = 'down';
    await ctx.clock.tween(0.45, (k) => {
      him.root.position.copy(from).addScaledVector(back, 0.45 * k);
      him.pose.sit.w = k;
    });
    this.shake = 1;
    const lvl = this.inj.add();
    this.dizzy = true;
    // she huffs, arms folded, turning half away
    // she huffs, arms folded, turning half away: forearms crossed one over the other in front of her
    // ribs, elbows forward and clear of her body (each hand rests by the other arm's elbow), shoulders
    // level, chin up — a clean pout, no clipping
    const hs = () => new Vector3().crossVectors(her.root.getWorldDirection(v()), UP); // her right
    const ribs = () => {
      const f = her.root.getWorldDirection(v()).setY(0).normalize();
      return (her.pose.b.chest?.getWorldPosition(v()) ?? her.root.position.clone().setY(1.2)).addScaledVector(f, 0.2).add(new Vector3(0, -0.1, 0));
    };
    this.setReach(her, 'L', 1, () => ribs().addScaledVector(hs(), 0.12), 4); // left hand under the right elbow
    this.setReach(her, 'R', 1, () => ribs().addScaledVector(hs(), -0.12).addScaledVector(her.root.getWorldDirection(v()), 0.035).add(new Vector3(0, 0.035, 0)), 4); // right forearm over it
    // relaxed hands lying along the other forearm, toward the outside (not fists pointing up)
    her.pose.reach.L.handDirFn = () => hs().add(new Vector3(0, -0.1, 0)).normalize();
    her.pose.reach.R.handDirFn = () => hs().negate().add(new Vector3(0, -0.1, 0)).normalize();
    ctx.clock.tween(0.6, (k) => (her.pose.gazeUp = 0.1 * k)); // chin up
    movers.turnTo(her, her.root.rotation.y + 1.1, { rate: 3 });
    await wait(ctx, 1.8);
    this.dizzy = false;
    // he gets back up, rubbing his head — the injury stays
    this.shot = 'ask';
    ctx.clock.tween(0.6, (k) => (her.pose.gazeUp = 0.1 * (1 - k)));
    her.pose.reach.L.handDirFn = her.pose.reach.R.handDirFn = null;
    await ctx.clock.tween(1.0, (k) => (him.pose.sit.w = 1 - k));
    this.setReach(him, 'R', 0.9, () => (him.pose.b.head?.getWorldPosition(v()) ?? him.root.position.clone().setY(1.6)).add(new Vector3(0, 0.16, 0)).addScaledVector(him.root.getWorldDirection(v()), 0.02), 4);
    flashText(['Ow…', 'Ouch…', 'Okay… one more try?', 'Still worth it.'][Math.min(3, lvl - 1)], 'flash-text--miss');
    await wait(ctx, 1.2);
    this.setReach(him, 'R', 0, null, 3);
    this.setReach(her, 'L', 0, null, 3);
    this.setReach(her, 'R', 0, null, 3);
    await Promise.all([movers.turnTo(her, him.root.position, { rate: 3 }), movers.walkTo(him, this.markHim, { speed: 0.7, face: her.root.position })]);
    // she takes her mark again, softening
    await movers.walkTo(her, this.markHer, { speed: 0.7, face: this.markHim });
    await wait(ctx, 0.5);
  },

  /**
   * YES: (Tanjiro's Theme is already rising from 2:21) a pink-gold bloom surge,
   * the sky erupting, a vortex of petals swirling up round them, the camera
   * sweeping — she slips the ring onto HIS finger, they kiss in the eye of the
   * storm (and the bruises are kissed better) — the end.
   */
  async yes(ctx) {
    const app = ctx.app;
    const { cast, movers, fireworks: fw, post } = app;
    const him = cast.him, her = cast.her;
    const S = (a, b, c) => fw.skyPoint(a, b, c);
    const mid0 = him.root.position.clone().lerp(her.root.position, 0.5).setY(0);
    this.shot = 'yes-sweep';
    this.sweepT = 0;
    // the surge: a pink flash, the bloom swelling, petals lifting into a vortex
    const bloom = post.bloom, b0 = bloom.strength;
    post.u.uFlashColor.value.setRGB(1.0, 0.7, 0.82);
    ctx.clock.tween(0.2, (k) => (app.flashHold = 0.4 * k)).then(() => ctx.clock.tween(1.8, (k) => (app.flashHold = 0.4 * (1 - k))));
    ctx.clock.tween(2.2, (k) => (bloom.strength = b0 + 0.8 * k));
    app.vortex.uniforms.uSpin.value = 1.4;
    ctx.clock.tween(3.5, (k) => app.vortex.set(mid0, 0.25 + 0.75 * k));
    fw.salvo([
      { type: 'heart', pos: S(100, 0, 44), colorA: 'pink', colorB: 'white', scale: 1.45, flight: 1.6 },
      { type: 'chrysanthemum', pos: S(125, -55, 60), colorA: 'gold', pistil: 'sakura', scale: 1.35, flight: 1.7, delay: 0.15 },
      { type: 'chrysanthemum', pos: S(125, 55, 60), colorA: 'gold', pistil: 'sakura', scale: 1.35, flight: 1.7, delay: 0.15 },
      { type: 'heart', pos: S(118, -30, 52), colorA: 'sakura', scale: 1.15, delay: 0.5 },
      { type: 'heart', pos: S(118, 30, 52), colorA: 'rose', scale: 1.15, delay: 0.6 },
      { type: 'ring', pos: S(135, 0, 70), colorA: 'gold', pistil: 'pink', scale: 1.3, delay: 0.9 },
    ]);
    fw.auto(2.2);
    for (const dn of cast.dancers) {
      dn.pose.routine = ['wave', 'cheerV', 'wave', 'clapHigh', 'spin', 'punch'];
      dn.pose.want = 1;
    }
    // the ring: he holds out his left hand; she takes the ring from the box and slips it on his finger
    this.setReach(him, 'R', 0, null, 3);
    this.setReach(her, 'L', 0, null, 3);
    const between = () => him.root.position.clone().lerp(her.root.position, 0.4).setY(1.02);
    this.setReach(him, 'L', 1, () => between(), 3);
    await wait(ctx, 0.9);
    this.ringAt = 'herHand';
    this.setReach(her, 'R', 1, () => him.pose.handPosition('L', v()).add(new Vector3(0, 0.03, 0)), 4);
    await wait(ctx, 1.3);
    this.ringAt = 'hisFinger';
    await ctx.clock.tween(0.3, (k) => (this.box.hinge.rotation.x = -1.9 * (1 - k)));
    this.box.group.visible = false;
    fw.pop(him.pose.handPosition('L', v()), { color: [1, 0.9, 0.95], n: 36, speed: 1.3, size: 0.03 });
    post.u.uFlashColor.value.setRGB(1.0, 0.86, 0.55); // gold
    ctx.clock.tween(0.15, (k) => (app.flashHold = 0.3 * k)).then(() => ctx.clock.tween(1.2, (k) => (app.flashHold = 0.3 * (1 - k))));
    // they step together
    this.setReach(him, 'L', 0, null, 3);
    this.setReach(her, 'R', 0, null, 3);
    ctx.clock.tween(1.0, (k) => {
      him.pose.gazeUp = -0.18 * (1 - k);
      her.pose.gazeUp = 0.16 * (1 - k);
    });
    const mid = him.root.position.clone().lerp(her.root.position, 0.5);
    const d = her.root.position.clone().sub(him.root.position).setY(0).normalize();
    await Promise.all([
      movers.walkTo(him, mid.clone().addScaledVector(d, -0.1), { speed: 0.6, face: her.root.position }),
      movers.walkTo(her, mid.clone().addScaledVector(d, 0.1), { speed: 0.7, face: him.root.position }),
    ]);
    this.shot = 'kiss-sweep';
    this.sweepT = 0;
    // her arms round his neck, his hands at her waist
    const neck = () => him.pose.b.neck?.getWorldPosition(v()) ?? him.root.position.clone().setY(1.55);
    const hisSide = () => new Vector3().crossVectors(him.root.getWorldDirection(v()), UP);
    const herSide = () => new Vector3().crossVectors(her.root.getWorldDirection(v()), UP);
    this.setReach(her, 'L', 1, () => neck().addScaledVector(hisSide(), 0.13), 2.5);
    this.setReach(her, 'R', 1, () => neck().addScaledVector(hisSide(), -0.13), 2.5);
    const waist = () => her.root.position.clone().setY(0.98);
    this.setReach(him, 'L', 1, () => waist().addScaledVector(herSide(), 0.15), 2.5);
    this.setReach(him, 'R', 1, () => waist().addScaledVector(herSide(), -0.15), 2.5);
    // the kiss: he bends his head down to her, she rises onto her toes, face lifted
    await ctx.clock.tween(1.6, (k) => {
      him.pose.gazeUp = -0.42 * k;
      him.pose.lean = 0.34 * k;
      him.pose.lift = -0.05 * k;
      her.pose.gazeUp = 0.46 * k;
      her.pose.lift = 0.08 * k;
      her.pose.lean = 0.14 * k;
    });
    // THE moment: a golden-pink flare, the vortex at full storm, the sky at its fullest
    post.u.uFlashColor.value.setRGB(1.0, 0.8, 0.72);
    ctx.clock.tween(0.25, (k) => (app.flashHold = 0.55 * k)).then(() => ctx.clock.tween(2.6, (k) => (app.flashHold = 0.55 * (1 - k))));
    app.vortex.uniforms.uSpin.value = 2.0;
    ctx.clock.tween(1.5, (k) => (bloom.strength = b0 + 0.8 + 0.5 * k));
    fw.salvo([
      { type: 'kamuro', pos: S(128, -50, 66), colorA: 'gold', scale: 1.35, flight: 1.6 },
      { type: 'kamuro', pos: S(132, 50, 68), colorA: 'gold', scale: 1.35, flight: 1.6, delay: 0.2 },
      { type: 'heart', pos: S(105, 0, 48), colorA: 'pink', colorB: 'white', scale: 1.5, delay: 0.5 },
      { type: 'chrysanthemum', pos: S(120, -25, 62), colorA: 'sakura', pistil: 'gold', scale: 1.4, delay: 1.0 },
      { type: 'chrysanthemum', pos: S(120, 25, 62), colorA: 'violet', pistil: 'gold', scale: 1.4, delay: 1.1 },
      { type: 'heart', pos: S(112, -45, 44), colorA: 'rose', scale: 1.15, delay: 1.8 },
      { type: 'heart', pos: S(112, 45, 44), colorA: 'pink', scale: 1.15, delay: 2.0 },
      { type: 'palm', pos: S(140, -10, 72), colorA: 'gold', scale: 1.3, delay: 2.8 },
      { type: 'willow', pos: S(145, 10, 76), scale: 1.5, delay: 3.6 },
      { type: 'kamuro', pos: S(150, 0, 80), colorA: 'white', scale: 1.5, delay: 4.6 },
    ]);
    // …and every bruise is kissed better
    ctx.clock.tween(2.2, (k) => this.inj.setOpacity(1 - k)).then(() => {
      this.inj.dispose();
      app.injuries = null;
      this.nos = 0;
    });
    await wait(ctx, 4.5);
    this.shot = 'kiss';
    await wait(ctx, 3.5);
    // the camera spirals up and away out of the storm, the sky ablaze
    this.shot = 'spiral';
    this.sweepT = 0;
    await wait(ctx, 6.5);
    // fade to black
    ctx.clock.tween(3, (k) => {
      app.vortex.set(null, 1 - k);
      bloom.strength = b0 + 1.3 * (1 - k);
    });
    await ctx.clock.tween(3, (k) => (post.u.uFade.value = k));
    post.u.uFlashColor.value.setRGB(1.0, 0.92, 0.8);
    letterbox(false);
    ctx.app.music.duckTo(0.55);
    theEnd({
      // a fresh page load, so every chapter starts from a clean world (see story/chapters.js)
      onReplay: () => (location.href = location.pathname),
      chapters: CHAPTERS,
      onChapter: (id) => (location.href = `${location.pathname}?chapter=${id}`),
      onWander: () => {
        // back into the night park: the show carries on softly, the couple wander together
        ctx.clock.tween(2, (k) => (post.u.uFade.value = 1 - k));
        fw.auto(0.5);
        for (const dn of cast.dancers) dn.pose.want = 0.5;
        app.timeline.ctx.interactive = true;
        app.timeline.goto('free');
      },
    });
  },

  setReach(actor, side, w, targetFn, rate = 4) {
    const key = `${actor.name}:${side}`;
    const r = this.reach.get(key) ?? { w: 0, actor, side };
    r.want = w;
    if (targetFn) r.target = targetFn;
    r.rate = rate;
    this.reach.set(key, r);
  },

  update(dt, t, ctx) {
    const app = ctx.app;
    const { cast, rig } = app;
    if (!cast?.him || !cast.her || rig.free || !this.C) return;
    const him = cast.him, her = cast.her;
    for (const r of this.reach.values()) {
      r.w += (r.want - r.w) * damp(r.rate, dt);
      const pose = r.actor.pose;
      if (!pose) continue;
      if (r.w > 0.02 || r.want > 0) {
        pose.reach[r.side].w = r.w;
        if (r.target) pose.reach[r.side].target.copy(r.target());
      } else pose.reach[r.side].w = 0;
    }
    // stars circling his dizzy head
    if (this.dizzy && Math.random() < dt * 14) {
      const h = him.pose.b.head?.getWorldPosition(v()) ?? him.root.position.clone().setY(1.0);
      const a = t * 7;
      app.fireworks.pop(h.add(new Vector3(Math.cos(a) * 0.2, 0.22, Math.sin(a) * 0.2)), { color: [1, 0.95, 0.4], n: 4, speed: 0.4, size: 0.035 });
    }

    // ── camera ──
    const hp = him.root.position, sp = her.root.position;
    const mid = hp.clone().lerp(sp, 0.5);
    let across = new Vector3().crossVectors(sp.clone().sub(hp).setY(0).normalize(), UP);
    if (across.dot(SKY) > 0) across.negate(); // shoot from the lane side: the open sky behind them
    const want = v(), look = v();
    let rate = 1.2;
    const shot = this.shot;
    if (shot === 'ask' || shot === 'question') {
      // a low two-shot from the side: him on his knee, her above him, the sky behind
      const back = shot === 'question' ? 3.1 : 2.6;
      want.copy(mid).addScaledVector(across, back).addScaledVector(sp.clone().sub(hp).setY(0).normalize(), shot === 'question' ? 0.15 : -0.2).setY(shot === 'question' ? 0.95 : 1.05);
      look.copy(mid).setY(shot === 'question' ? 0.78 : 1.15); // (the question sits low in the frame: lift the couple above it)
      rate = 0.8;
    } else if (shot === 'fight' || shot === 'down') {
      want.copy(mid).addScaledVector(across, 3.6).setY(1.4);
      look.copy(mid).setY(shot === 'down' ? 0.8 : 1.25);
      rate = 1.6;
    } else if (shot === 'yes') {
      want.copy(mid).addScaledVector(across, 2.2).setY(1.25);
      look.copy(mid).setY(1.15);
    } else if (shot === 'yes-sweep' || shot === 'kiss-sweep') {
      // dramatic sweeps round them, dipping and rising, the storm of petals between
      this.sweepT = (this.sweepT ?? 0) + dt;
      const st = this.sweepT;
      const a = st * (shot === 'yes-sweep' ? 0.9 : 0.7);
      const dir = across.clone().applyAxisAngle(UP, a);
      const r = shot === 'yes-sweep' ? 3.0 + Math.sin(st * 0.8) * 0.9 : 1.9 + Math.sin(st * 0.6) * 0.4;
      want.copy(mid).addScaledVector(dir, r).setY((shot === 'yes-sweep' ? 1.3 : 1.45) + Math.sin(st * 0.9) * 0.45);
      look.copy(mid).setY(shot === 'yes-sweep' ? 1.25 : 1.6);
      rate = 3.0;
    } else if (shot === 'spiral') {
      this.sweepT = (this.sweepT ?? 0) + dt;
      const st = this.sweepT;
      const dir = across.clone().applyAxisAngle(UP, st * 0.32);
      want.copy(mid).addScaledVector(dir, 3 + st * 1.1).setY(1.6 + st * 0.95);
      look.copy(mid).setY(1.4 + st * 0.2);
      rate = 2.0;
    } else if (shot === 'kiss') {
      // a slow orbit round the kiss in profile, the hearts going up behind them
      this.orbit = (this.orbit ?? 0) + dt * 0.06;
      const dir = across.clone().applyAxisAngle(UP, Math.sin(this.orbit * 2) * 0.35);
      want.copy(mid).addScaledVector(dir, 1.75).setY(1.58);
      look.copy(mid).setY(1.6);
      rate = 0.9;
    } else if (shot === 'finale') {
      // rising and pulling away: the two of them small in the ring of dancers, the sky ablaze
      want.copy(this.C).addScaledVector(SKY, -11).addScaledVector(RIGHT, 2).setY(4.2);
      look.copy(this.C).addScaledVector(SKY, 30).setY(10);
      rate = 0.35;
    }
    const key = shot === 'question' ? 'ask' : shot;
    if (this.lastKey && this.lastKey !== key && !(this.lastKey === 'kiss' && key === 'finale') && !(this.lastKey === 'fight' && key === 'down') && !(this.lastKey === 'kiss-sweep' && key === 'kiss') && !(this.lastKey === 'kiss' && key === 'spiral')) {
      rig.pos.copy(want);
      rig.look.copy(look);
    } else {
      rig.pos.lerp(want, damp(rate, dt));
      rig.look.lerp(look, damp(rate * 1.6, dt));
    }
    this.lastKey = key;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.5);
      const s = this.shake * 0.03;
      rig.pos.x += (Math.random() - 0.5) * s;
      rig.pos.y += (Math.random() - 0.5) * s;
    }
  },

  /** The box rides his hands; the ring rides the box, then his fingers, then her finger. */
  late(dt, t, ctx) {
    const { cast } = ctx.app;
    const him = cast?.him, her = cast?.her;
    if (!this.box || !him?.pose || !her?.pose) return;
    const g = this.box.group;
    const by = this.boxBy ?? her;
    if (g.visible && by?.pose && this.ringAt !== 'hisFinger') {
      // the box rides in her two hands
      const p = by.pose.handPosition('L', v()).lerp(by.pose.handPosition('R', v()), 0.5);
      g.position.copy(p).add(new Vector3(0, 0.025, 0));
      g.rotation.set(0, by.root.rotation.y, 0);
    }
    const ring = this.box.ring;
    if (this.ringAt === 'herHand' || this.ringAt === 'hisFinger') {
      // carried in world space: re-parent once to the scene
      if (ring.parent !== ctx.app.scene) {
        ctx.app.scene.add(ring);
        ring.scale.setScalar(1);
      }
      const p = this.ringAt === 'herHand' ? her.pose.handPosition('R', v()).add(new Vector3(0, 0.02, 0)) : him.pose.handPosition('L', v());
      ring.position.copy(p);
      ring.rotation.set(Math.PI / 2, (this.ringAt === 'herHand' ? her : him).root.rotation.y, 0);
    }
  },

  exit(ctx) {
    const { cast } = ctx.app;
    for (const a of [cast?.him, cast?.her]) {
      if (!a?.pose) continue;
      a.pose.reach.L.w = a.pose.reach.R.w = 0;
      a.pose.sit.w = 0;
      a.pose.gazeUp = 0;
      a.pose.lean = 0;
      a.pose.lift = 0;
    }
    this.box?.ring.removeFromParent();
    cast?.butterflies(true);
    // the climax's surge settles back
    ctx.app.flashHold = 0;
    ctx.app.vortex?.set(null, 0);
    ctx.app.post.bloom.strength = RENDER.bloom.strength;
    ctx.app.post.u.uFlashColor.value.setRGB(1.0, 0.92, 0.8);
    this.reach = new Map();
    this.dizzy = false;
    letterbox(false);
  },
};
