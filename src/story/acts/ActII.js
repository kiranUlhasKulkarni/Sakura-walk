import { Vector3 } from 'three';
import { PARK } from '../../config.js';
import { damp, easeOutBack } from '../../utils/math.js';
import { laneLength, lanePoint, laneSide, laneU, STATIONS } from '../../world/lane.js';
import { crossing, laneDir, STREAM, streamAcross } from '../../world/stream.js';
import { wait } from '../Timeline.js';
import { actCard, actions, clearActions, flashText, letterbox } from '../ui.js';

const v = () => new Vector3();

/**
 * ACT II — A Picnic Under the Blossoms.
 *
 *  Walk     From the catch clearing back onto the lane, over the arched bridge
 *           and under the torii, to the picnic lawn. He leads, she follows at
 *           his shoulder, the cats trot after them. Camera: a low follow down
 *           the avenue; as they near the brook the painting's view — from the
 *           bank, low over the water, the couple crossing the arch with the
 *           torii beyond; a front dolly after; a wide of the lawn on arrival.
 *  Settle   Each walks to a seat on the long edges of the cloth, they face one
 *           another and sit — she kneels in seiza, he sits cross-legged — and
 *           the cats curl up / sit by the food.
 *  Spread   The dishes appear one by one (a soft spring-in): the sushi geta,
 *           two bento, onigiri, hanami dango, the tea set. An insert glides
 *           low across the food.
 *  Share    She lifts an onigiri and offers it to him (he takes a bite); he
 *           answers with a dango skewer. A gust sends petals over them for a
 *           closing crane, then they get to their feet.
 */
export const ActII = {
  name: 'act2',

  async enter(ctx) {
    const app = ctx.app;
    const { cast, controller: ctl, movers, rig } = app;
    this.app = app;
    this.mode = 'walk';
    this.reach = new Map();
    this.held = null;
    this.shot = null;
    if (!cast?.him || !ctl || !cast.spread) return;
    const sp = cast.spread;

    const play = !!ctx.interactive; // the player brought him here: he sits down and chooses what to do
    if (!play) {
      letterbox(true);
      setTimeout(() => actCard('II', 'A Picnic Under the Blossoms', 6), 900);
    }

    // ── the walk: back to the lane, over the bridge, to the picnic lawn ──
    const pc = STATIONS.picnic;
    const seatHim = cast.spreadToWorld(sp.seats.him), seatHer = cast.spreadToWorld(sp.seats.her);
    const centre = cast.spreadToWorld(new Vector3(0, 0, 0));
    this.centre = centre;
    this.seatHim = seatHim;
    this.seatHer = seatHer;
    const awayHim = seatHim.clone().sub(centre).setY(0).normalize(); // from the food out past his seat
    const awayHer = seatHer.clone().sub(centre).setY(0).normalize();
    const uStart = laneU(cast.him.root.position.x, cast.him.root.position.z);
    const pts = [];
    const half = PARK.laneWidth / 2;
    const st = STATIONS.catch;
    // back onto the lane from the clearing (only if they are still at / before it: in the
    // interactive mode the player may already be further along)
    if (uStart < st.u + 0.012) pts.push(lanePoint(st.u + 0.01).addScaledVector(laneSide(st.u + 0.01), st.side * (half - 0.4)));
    for (let u = Math.max(uStart, st.u + 0.02); u <= pc.u - 0.025; u += 2 / laneLength) pts.push(lanePoint(u));
    pts.push(lanePoint(pc.u - 0.012).addScaledVector(laneSide(pc.u), pc.side * (half + 1.2)));
    const standHim = seatHim.clone().addScaledVector(awayHim, 0.55);
    pts.push(standHim);
    this.pathLen = pts.reduce((s, p, i) => (i ? s + p.distanceTo(pts[i - 1]) : 0), 0);
    this.odo = 0;

    for (const f of app.followers) {
      f.reset();
      f.paused = false;
    }
    rig.cut(rig.pos.clone(), rig.look.clone());
    if (!play) {
      await wait(ctx, 0.8);
      await ctl.walkPath(pts, 1.3);
    } else {
      this.mode = 'settle';
      await ctl.walkPath([standHim], 1.2); // just round to his side of the cloth
    }

    // ── settle: to the seats, face each other, sit ──
    this.mode = 'settle';
    for (const f of app.followers) f.paused = true;
    const sideDir = seatHer.clone().sub(seatHim).cross(new Vector3(0, 1, 0)).normalize(); // along the cloth
    await Promise.all([
      movers.walkTo(cast.him, seatHim, { speed: 0.8 }),
      cast.her ? movers.walkTo(cast.her, seatHer, { speed: 1.0 }) : null,
      cast.catHer ? movers.walkTo(cast.catHer, centre.clone().addScaledVector(sideDir, -1.25).addScaledVector(awayHer, 0.35), { speed: 0.9, face: centre }) : null,
      cast.catHim ? movers.walkTo(cast.catHim, centre.clone().addScaledVector(sideDir, 0.95).addScaledVector(awayHim, 0.55), { speed: 0.9, face: centre }) : null,
    ]);
    // angled toward each other round the corner, not nose to nose
    const faceHim = sp.faces ? cast.spreadToWorld(sp.faces.him) : seatHer, faceHer = sp.faces ? cast.spreadToWorld(sp.faces.her) : seatHim;
    await Promise.all([movers.turnTo(cast.him, faceHim), cast.her ? movers.turnTo(cast.her, faceHer) : null]);
    if (cast.him.pose) cast.him.pose.sit.style = 'agura';
    if (cast.her?.pose) cast.her.pose.sit.style = 'seiza';
    await ctx.clock.tween(1.8, (k) => {
      if (cast.him.pose) cast.him.pose.sit.w = k;
      if (cast.her?.pose) cast.her.pose.sit.w = k;
    });
    // the cats: hers curls up asleep on the cloth's corner, his sits up by the sushi
    const gHer = app.gaits.find((g) => g.actor === cast.catHer), gHim = app.gaits.find((g) => g.actor === cast.catHim);
    ctx.clock.tween(2.5, (k) => {
      if (gHer) gHer.sleep = k;
      if (gHim) gHim.sleep = k * 0.45;
    });

    // ── the spread appears, dish by dish ──
    this.mode = 'spread';
    for (const d of sp.dishes) {
      ctx.clock.tween(0.7, (k) => d.scale.setScalar(Math.max(0.0001, easeOutBack(k, 1.6))), (t) => t);
      await wait(ctx, 0.45);
    }
    await wait(ctx, 1.0);
    if (play) {
      await this.play(ctx, sp);
      await ctx.clock.tween(1.6, (k) => {
        if (cast.him.pose) cast.him.pose.sit.w = 1 - k;
        if (cast.her?.pose) cast.her.pose.sit.w = 1 - k;
      });
      for (const g of app.gaits) g.sleep = 0;
      app.progress = { ...app.progress, picnic: true };
      return;
    }
    this.mode = 'insert'; // glide low across the food
    await wait(ctx, 5.5);

    // ── she offers him an onigiri ──
    this.mode = 'feed-her';
    await this.feed(ctx, cast.her, cast.him, sp.pick.share[1]); // a piece of tuna nigiri from the sharing plate
    // ── he answers with a piece of sushi ──
    this.mode = 'feed-him';
    await this.feed(ctx, cast.him, cast.her, sp.pick.share[0]); // and salmon for her

    // ── a gust of petals, a closing crane, and they rise ──
    this.mode = 'crane';
    app.wind.burst(1.4);
    await wait(ctx, 5.5);
    await ctx.clock.tween(1.6, (k) => {
      if (cast.him.pose) cast.him.pose.sit.w = 1 - k;
      if (cast.her?.pose) cast.her.pose.sit.w = 1 - k;
    });
    letterbox(false);
    await wait(ctx, 0.8);
  },

  setReach(actor, w, targetFn, rate = 4, side = null) {
    const r = this.reach.get(actor) ?? { w: 0, side: 'R' };
    if (side && side !== r.side) {
      if (actor.pose) actor.pose.reach[r.side].w = 0;
      r.side = side;
      r.w = 0;
    }
    r.want = w;
    if (targetFn) r.target = targetFn;
    r.rate = rate;
    this.reach.set(actor, r);
  },

  /**
   * INTERACTIVE picnic: [ Eat ] — he picks up a piece of sushi (or an onigiri)
   * and eats it; [ Feed Her ] — he holds a piece across to her lips. After the
   * first, [ Stand up · walk on ] leads on to the dragon stage.
   */
  async play(ctx, sp) {
    const { cast } = ctx.app;
    const pieces = [...sp.pick.share, ...sp.pick.sushi, ...sp.pick.onigiris];
    let did = false;
    for (;;) {
      this.mode = 'spread';
      const left = pieces.filter((p) => p.visible);
      const list = [];
      if (left.length) list.push({ id: 'eat', label: 'Eat' }, { id: 'feed', label: 'Feed Her', primary: !did });
      if (did || !left.length) list.push({ id: 'stand', label: 'Stand up · walk on', primary: did });
      const choice = await actions(list);
      if (!choice || choice === 'stand') break;
      // the nearest piece to his side of the board
      const him = cast.him.root.position;
      const item = left.sort((a, b) => a.getWorldPosition(v()).distanceTo(him) - b.getWorldPosition(v()).distanceTo(him))[0];
      this.mode = 'feed-him';
      await this.feed(ctx, cast.him, choice === 'eat' ? cast.him : cast.her, item);
      if (choice === 'feed') flashText('Itadakimasu ♡', 'flash-text--good');
      did = true;
    }
    clearActions();
  },

  /**
   * `giver` picks up `item` (it rides in the hand: see late()), shuffles in and
   * leans across the cloth, and holds it to `taker`'s lips; the taker leans in
   * and takes two bites until it's gone. With taker === giver he eats it himself.
   */
  async feed(ctx, giver, taker, item) {
    if (!giver?.pose || !taker?.pose || !item) return;
    const self = taker === giver;
    // the hand on the receiver's side (for himself: the one nearer the piece)
    const gFwd = giver.root.getWorldDirection(v()).setY(0).normalize();
    const gRight = new Vector3().crossVectors(gFwd, new Vector3(0, 1, 0));
    const toward = (self ? item.getWorldPosition(v()) : taker.root.position.clone()).sub(giver.root.position);
    const side = toward.dot(gRight) >= 0 ? 'R' : 'L';
    // 1 — reach down to the piece on the plate (an easy, bent-arm reach: see PoseRig.applyReach)
    this.setReach(giver, 1, () => item.getWorldPosition(v()).add(new Vector3(0, 0.025, 0)), 3, side);
    await wait(ctx, 1.0);
    this.held = { item, by: giver, side };
    this.app.scene.attach(item);
    const s0 = item.scale.clone();
    // 2 — lift it, unhurried, to a gentle pause just in front of their lips. Both stay seated;
    //     the giver leans only a little toward them, the receiver a touch forward to meet it.
    const leanG = self ? 0.05 : 0.12, leanT = self ? 0 : 0.1;
    this.bite = 0;
    const lips = () => {
      const fwd = taker.root.getWorldDirection(v()).setY(0).normalize();
      // a few cm in front of the mouth, easing closer as they take the bite (never into the face)
      return taker.pose.mouthPosition(v()).addScaledVector(fwd, 0.075 - 0.04 * this.bite).add(new Vector3(0, -0.01, 0));
    };
    // the reach drives the wrist; aim so the PALM (where the piece sits) arrives at the lips
    const palmAt = (want) => {
      const hand = giver.pose.b[`hand${side}`];
      if (!hand) return want;
      return want.sub(giver.pose.handPosition(side, v()).sub(hand.getWorldPosition(v())));
    };
    this.setReach(giver, 1, () => palmAt(lips()), 1.8);
    await ctx.clock.tween(1.5, (k) => {
      giver.pose.lean = leanG * k;
      if (!self) taker.pose.lean = leanT * k;
    });
    await wait(ctx, 0.5); // the little pause, offered
    // 3 — two small bites: the receiver leans in a little, the piece eases closer, and it's gone
    for (const left of [0.6, 0]) {
      this.lean = { actor: taker, w: 0, toward: self ? null : giver };
      await ctx.clock.tween(0.5, (k) => {
        this.bite = Math.sin(k * Math.PI);
        this.lean.w = this.bite * 0.7;
      });
      if (left > 0) item.scale.copy(s0).multiplyScalar(left);
      else item.visible = false;
      await wait(ctx, 0.5);
    }
    this.bite = 0;
    this.held = null;
    this.lean = null;
    // 4 — the hand drifts back to rest, they settle back
    this.setReach(giver, 0, null, 2.0);
    await ctx.clock.tween(1.1, (k) => {
      giver.pose.lean = leanG * (1 - k);
      if (!self) taker.pose.lean = leanT * (1 - k);
    });
    await wait(ctx, 0.4);
  },

  update(dt, t, ctx) {
    const app = ctx.app;
    const { cast, rig, controller: ctl } = app;
    if (!cast?.him || rig.free) return;
    for (const [actor, r] of this.reach) {
      r.w += (r.want - r.w) * damp(r.rate, dt);
      if (!actor.pose) continue;
      if (r.w > 0.02) {
        actor.pose.reach[r.side].w = r.w;
        if (r.target) actor.pose.reach[r.side].target.copy(r.target());
      } else if (r.want === 0) actor.pose.reach[r.side].w = 0; // hand goes back to resting on the thigh
    }
    // camera
    const c = cast.coupleCenter(v());
    const want = v(), look = v();
    let rate = 1.0;
    if (this.mode === 'walk') {
      this.odo += ctl.speed * dt;
      const him = cast.him.root.position;
      const u = laneU(him.x, him.z);
      const fwd = lanePoint(Math.min(1, u + 0.004)).sub(lanePoint(Math.max(0, u - 0.004))).setY(0).normalize();
      const side = laneSide(u);
      const toBridge = him.distanceTo(crossing);
      const along = him.clone().sub(crossing).dot(laneDir); // <0 before the bridge
      const toPicnic = him.distanceTo(this.centre);
      if (toPicnic < 16) {
        // the lawn waits for them
        want.copy(this.centre).addScaledVector(this.seatHer.clone().sub(this.centre).setY(0).normalize(), 4.5).addScaledVector(fwd, 3).setY(1.8);
        look.copy(c).setY(1.1);
        rate = 0.8;
      } else if (toBridge < 15 && along < 9) {
        // the painting: from the bank, low over the water, looking at the arch (torii beyond)
        want.copy(crossing).addScaledVector(streamAcross, -9.5).addScaledVector(laneDir, -2.5).setY(STREAM.water + 1.6);
        look.copy(c).lerp(crossing, 0.4).setY(1.7);
        rate = 1.2;
      } else if (along < 0) {
        want.copy(c).addScaledVector(fwd, -5.5).addScaledVector(side, 1.3).setY(2.0); // following down the avenue
        look.copy(c).addScaledVector(fwd, 8).setY(1.5);
      } else {
        want.copy(c).addScaledVector(fwd, 5).addScaledVector(side, -1.2).setY(1.6); // leading them in
        look.copy(c).setY(1.2);
      }
    } else {
      const ctr = this.centre;
      const across = this.seatHer.clone().sub(this.seatHim).setY(0).normalize();
      const along = across.clone().cross(new Vector3(0, 1, 0)).normalize();
      if (this.mode === 'insert') {
        // low over the food, sliding along the cloth
        this.insertT = (this.insertT ?? 0) + dt;
        const s = Math.min(1, this.insertT / 5.5);
        want.copy(ctr).addScaledVector(along, -0.9 + s * 1.8).addScaledVector(across, -0.35).setY(0.55);
        look.copy(ctr).addScaledVector(along, -0.5 + s * 1.0).addScaledVector(across, 0.15).setY(0.05);
        rate = 2.2;
      } else if (this.mode === 'feed-her' || this.mode === 'feed-him') {
        // side-on two-shot across the food, from the same end of the cloth for both offers (a
        // sideways shift favours the giver; the camera never swings through the couple);
        // pulled back on portrait screens so both stay in frame
        const favour = this.mode === 'feed-her' ? 0.45 : -0.45;
        const back = 2.3 * Math.max(1, 0.85 / app.camera.aspect);
        const mid = this.seatHim.clone().lerp(this.seatHer, 0.5);
        want.copy(mid).addScaledVector(along, back).addScaledVector(across, favour).setY(1.05);
        look.copy(mid).setY(0.72);
        rate = 1.4;
      } else if (this.mode === 'crane') {
        this.craneT = (this.craneT ?? 0) + dt;
        const k = Math.min(1, this.craneT / 5);
        want.copy(ctr).addScaledVector(along, 3.4 + k * 1.5).addScaledVector(across, -1.0).setY(1.2 + k * 3.2);
        look.copy(ctr).setY(0.6 + k * 0.6);
        rate = 1.2;
      } else {
        // settle / spread: the two-shot from the side of the cloth
        want.copy(ctr).addScaledVector(along, 3.2).addScaledVector(across, -0.4).setY(1.2);
        look.copy(ctr).setY(0.65);
      }
    }
    // a hard cut when the beat changes (spread → insert → offers → crane), a glide otherwise
    const glide = new Set(['walk>settle', 'settle>spread', 'feed-her>feed-him']);
    if (this.lastMode && this.lastMode !== this.mode && !glide.has(`${this.lastMode}>${this.mode}`)) {
      rig.pos.copy(want);
      rig.look.copy(look);
    } else {
      rig.pos.lerp(want, damp(rate, dt));
      rig.look.lerp(look, damp(rate * 1.6, dt));
    }
    this.lastMode = this.mode;
  },

  /** After posing: a held item rides in the giver's right hand. */
  late(dt, t, ctx) {
    // the bite: the taker leans in toward the food (after posing, so the rig's reset doesn't undo it)
    if (this.lean?.w > 0) {
      const a = this.lean.actor;
      const by = this.lean.toward ?? this.held?.by;
      if (by && by !== a) {
        const toward = by.root.position.clone().sub(a.root.position).setY(0).normalize();
        a.model.position.addScaledVector(toward, 0.025 * this.lean.w); // a small lean in for the bite
      }
    }
    const h = this.held;
    if (!h?.by.pose) return;
    h.by.pose.handPosition(h.side ?? 'R', h.item.position);
    h.item.position.y -= 0.01;
  },

  exit(ctx) {
    const { cast } = ctx.app;
    for (const a of [cast?.him, cast?.her]) {
      if (!a?.pose) continue;
      a.pose.reach.R.w = 0;
      a.pose.sit.w = 0;
      a.pose.lean = 0;
    }
    for (const g of ctx.app.gaits) g.sleep = 0;
    this.reach = new Map();
    this.held = null;
    this.lean = null;
    clearActions();
    this.insertT = this.craneT = 0;
    this.lastMode = null;
    letterbox(false);
  },
};
