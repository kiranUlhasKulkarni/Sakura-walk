import { Vector3 } from 'three';
import { damp } from '../../utils/math.js';
import { lanePoint, laneSide, STATIONS } from '../../world/lane.js';
import { walkHeight } from '../../world/terrain.js';
import { wait } from '../Timeline.js';
import { CHEER } from '../DancerRig.js';
import { actCard, letterbox } from '../ui.js';

const v = () => new Vector3();
const UP = new Vector3(0, 1, 0);
const SKY = new Vector3(-0.1, 0, -1).normalize(); // from the plaza toward the open sky over the mountain
const RIGHT = new Vector3(-SKY.z, 0, SKY.x); // the couple's right as they face the sky

/**
 * ACT IV — Hanabi.
 *
 *  Arrive     Through black to the plaza: the couple walk the last stretch of
 *             the lane into the lantern-ringed plaza and stop at its centre,
 *             facing the open sky over the mountain.
 *  Nightfall  The dusk drops to deep night in a breath; the lanterns flare;
 *             "River Flows in You" hands over to "Marry You".
 *  Salvo      The show opens: chrysanthemums, peonies, rings, a heart, a
 *             willow and palm, a white kamuro — colour washing over their faces.
 *  MARRY ME   A hush; then a line of rockets climbs, and each bursts into a
 *             letter that glides into place and hangs in the sky: M A R R Y  M E.
 *             She turns to him.
 *  Dance      A golden curtain falls; the festival dancers (each in her own
 *             colours) rush in and ring the couple; everybody dances under a
 *             sky that keeps on blooming. He twirls her; the cats race circles.
 */
export const ActIV = {
  name: 'act4',
  next: 'act5', // the question follows the fireworks in both modes

  async enter(ctx) {
    const app = ctx.app;
    const { cast, controller: ctl, movers, fireworks: fw, post } = app;
    this.app = app;
    this.mode = 'arrive';
    this.shot = 'arrive';
    this.reach = new Map();
    this.lastKey = null;
    this.t0 = 0;
    if (!cast?.him || !ctl) return;
    const C = STATIONS.plaza.center.clone().setY(0);
    this.C = C;
    const markHim = C.clone().addScaledVector(RIGHT, -0.45);
    const markHer = C.clone().addScaledVector(RIGHT, 0.45);
    const skyHeading = Math.atan2(SKY.x, SKY.z);

    letterbox(true);
    // ── through black to the plaza ──
    await ctx.clock.tween(1.0, (k) => (post.u.uFade.value = Math.max(post.u.uFade.value, k)));
    fw.clear();
    app.stage.ignite(0); // the festival corner is far behind now
    for (const f of app.followers) f.paused = true;
    const u0 = 0.99;
    const p0 = lanePoint(u0), fwd0 = lanePoint(u0 + 0.004).sub(lanePoint(u0 - 0.004)).setY(0).normalize();
    const side0 = laneSide(u0);
    const place = (a, p, heading) => {
      if (!a) return;
      movers.stop(a);
      a.root.position.set(p.x, walkHeight(p.x, p.z), p.z);
      a.root.rotation.y = heading;
      a.speed = 0;
    };
    const h0 = Math.atan2(fwd0.x, fwd0.z);
    place(cast.him, p0.clone().addScaledVector(side0, -0.5), h0);
    place(cast.her, p0.clone().addScaledVector(side0, 0.5).addScaledVector(fwd0, -0.9), h0);
    place(cast.catHim, p0.clone().addScaledVector(side0, -1.3).addScaledVector(fwd0, -1.2), h0);
    place(cast.catHer, p0.clone().addScaledVector(side0, 1.4).addScaledVector(fwd0, -1.8), h0);
    // the festival dancers wait around the plaza's edge, swaying a little
    this.dancerWait = cast.dancers.map((d, i) => {
      // along both sides of the plaza (clear of the lane's mouth behind the couple and of the sky ahead)
      const a = skyHeading + Math.PI * (i % 2 ? -1 : 1) * (0.34 + Math.floor(i / 2) * 0.085);
      const p = C.clone().add(new Vector3(Math.sin(a), 0, Math.cos(a)).multiplyScalar(7.5 + (i % 2) * 1.2));
      place(d, p, Math.atan2(C.x - p.x, C.z - p.z));
      d.pose.want = 0.15;
      return p;
    });
    ctl.pos.copy(cast.him.root.position);
    ctl.heading = cast.him.root.rotation.y;
    for (const f of app.followers) {
      f.reset();
      f.paused = false;
    }
    this.cutNext = true;
    setTimeout(() => actCard('IV', 'Hanabi', 5.5), 500);
    ctx.clock.tween(1.4, (k) => (post.u.uFade.value = 1 - k));

    // ── the last stretch into the plaza ──
    await ctl.walkPath([lanePoint(0.997), C.clone().addScaledVector(SKY, -1.4), markHim], 1.25);
    for (const f of app.followers) f.paused = true;
    await Promise.all([
      movers.walkTo(cast.him, markHim, { speed: 0.6, face: markHim.clone().addScaledVector(SKY, 5) }),
      cast.her ? movers.walkTo(cast.her, markHer, { speed: 0.9, face: markHer.clone().addScaledVector(SKY, 5) }) : null,
      cast.catHim ? movers.walkTo(cast.catHim, markHim.clone().addScaledVector(RIGHT, -0.7).addScaledVector(SKY, -0.4), { speed: 1, face: C.clone().addScaledVector(SKY, 6) }) : null,
      cast.catHer ? movers.walkTo(cast.catHer, markHer.clone().addScaledVector(RIGHT, 0.75).addScaledVector(SKY, -0.3), { speed: 1, face: C.clone().addScaledVector(SKY, 6) }) : null,
    ]);
    for (const d of cast.dancers) movers.turnTo(d, skyHeading, { rate: 2 });

    // ── nightfall ──
    this.mode = 'show';
    this.shot = 'nightfall';
    ctx.clock.tween(2.5, (k) => {
      for (const a of [cast.him, cast.her]) if (a?.pose) a.pose.gazeUp = 0.42 * k;
    });
    await wait(ctx, 0.8);
    app.nightfall(1.6); // + "Marry You"
    await wait(ctx, 2.4);

    // ── the opening salvo ──
    const S = (along, across, up) => fw.skyPoint(along, across, up);
    fw.salvo([
      { type: 'chrysanthemum', pos: S(110, 0, 55), colorA: 'gold', pistil: 'sakura', scale: 1.3, flight: 2.4 },
      { type: 'peony', pos: S(120, -48, 48), colorA: 'sakura', delay: 1.4 },
      { type: 'ring', pos: S(125, 50, 58), colorA: 'violet', pistil: 'gold', delay: 1.6 },
      { type: 'willow', pos: S(140, 8, 70), scale: 1.2, delay: 2.6 },
      { type: 'heart', pos: S(108, -22, 44), colorA: 'pink', colorB: 'rose', delay: 3.4 },
      { type: 'glitter', pos: S(130, 62, 50), colorA: 'silver', delay: 3.8 },
      { type: 'palm', pos: S(115, -62, 52), colorA: 'sakura', delay: 4.6 },
      { type: 'chrysanthemum', pos: S(135, 35, 62), colorA: 'electric', pistil: 'white', delay: 5.0 },
      { type: 'peony', pos: S(118, -30, 60), colorA: 'magenta', delay: 6.0 },
      { type: 'peony', pos: S(122, 22, 56), colorA: 'sakura', colorB: 'white', delay: 6.3 },
      { type: 'ring', pos: S(128, -5, 66), colorA: 'gold', pistil: 'violet', delay: 6.6 },
      { type: 'kamuro', pos: S(150, 0, 74), colorA: 'white', scale: 1.3, delay: 7.5 },
    ]);
    this.shot = 'sky';
    await wait(ctx, 4.2);
    this.shot = 'faces';
    await wait(ctx, 4.6);
    this.shot = 'wide';
    await wait(ctx, 3.4);

    // ── MARRY ME ──
    this.shot = 'text';
    this.textCenter = S(106, -3, 31);
    const formed = fw.writeText('MARRY ME', { center: this.textCenter, height: 8.5, stagger: 0.2, flight: 2.3, hold: 7.5, colorA: 'gold', colorB: 'sakura' });
    await wait(ctx, formed + 1.4);
    // HER message to him: he turns to her, a hand to his heart; she turns to him, smiling
    this.shot = 'reaction';
    const her = cast.her;
    ctx.clock.tween(1.2, (k) => {
      for (const a of [cast.him, her]) if (a?.pose) a.pose.gazeUp = 0.42 * (1 - k);
    });
    if (her) movers.turnTo(her, cast.him.root.position, { rate: 1.8 });
    movers.turnTo(cast.him, her ? her.root.position : C, { rate: 2.2 });
    if (cast.him.pose) this.setReach(cast.him, 'R', 0.85, () => {
      const chest = cast.him.pose.b.chest?.getWorldPosition(v()) ?? cast.him.root.position.clone().setY(1.3);
      return chest.addScaledVector(cast.him.root.getWorldDirection(v()), 0.16).addScaledVector(new Vector3().crossVectors(cast.him.root.getWorldDirection(v()), UP), -0.06);
    }, 2.5);
    await wait(ctx, 3.2);
    if (cast.him.pose) this.setReach(cast.him, 'R', 0, null, 2);
    this.shot = 'text-wide';
    await wait(ctx, 1.6);
    // a golden curtain to close the first half
    fw.salvo([
      { type: 'kamuro', pos: S(125, -40, 66), colorA: 'gold', scale: 1.2 },
      { type: 'kamuro', pos: S(132, 40, 68), colorA: 'gold', scale: 1.2, delay: 0.25 },
      { type: 'willow', pos: S(118, 0, 62), scale: 1.25, delay: 0.5 },
    ]);
    await wait(ctx, 2.6);

    // ── Part 1: her show — a tightly synchronized cheer routine ──
    // he steps back to watch from the front; she takes the centre; the dancers rush into a V behind her
    this.mode = 'dance';
    this.shot = 'show';
    this.danceT = 0;
    fw.auto(1.0);
    const him = cast.him;
    const centre = C.clone().addScaledVector(SKY, 0.8);
    this.centre = centre;
    const watch = C.clone().addScaledVector(SKY, -4.4);
    this.watch = watch;
    const forward = SKY.clone().negate(); // the formation faces him (and the lane)
    const across = RIGHT.clone();
    const spots = cast.dancers.map((d, i) => {
      if (i === 10) return centre.clone().addScaledVector(forward, -4.3); // the point of the V, at the back
      const pair = Math.floor(i / 2), side = i % 2 ? 1 : -1;
      return centre.clone().addScaledVector(across, side * (1.05 + pair * 0.92)).addScaledVector(forward, -(0.75 + pair * 0.72));
    });
    this.spots = spots;
    if (cast.catHim) movers.walkTo(cast.catHim, watch.clone().addScaledVector(RIGHT, -0.8).addScaledVector(forward, 0.3), { speed: 1.4, face: centre });
    if (cast.catHer) movers.walkTo(cast.catHer, watch.clone().addScaledVector(RIGHT, 0.9).addScaledVector(forward, 0.4), { speed: 1.4, face: centre });
    const arrive = cast.dancers.map((d, i) => movers.walkTo(d, spots[i], { speed: 2.0, face: watch }));
    await Promise.all([
      movers.walkTo(him, watch, { speed: 1.2, face: centre }),
      her ? movers.walkTo(her, centre, { speed: 1.6, face: watch }) : null,
      Promise.race([Promise.all(arrive), wait(ctx, 6)]),
    ]);
    for (const [i, d] of cast.dancers.entries()) {
      movers.stop(d);
      d.root.position.copy(spots[i]);
      d.root.rotation.y = Math.atan2(watch.x - spots[i].x, watch.z - spots[i].z);
    }
    // a breath — then everybody hits the first beat together
    await wait(ctx, 0.6);
    for (const d of cast.dancers) {
      d.pose.sync(0);
      d.pose.want = 1;
      d.pose.energy = 1;
    }
    if (her?.pose) {
      her.pose.dance.beat = 0;
      her.pose.dance.sway = 0.6;
    }
    this.cheerBeat = 0;
    this.cheer = true;
    ctx.clock.tween(0.4, (k) => her?.pose && (her.pose.dance.w = k));
    const beats = (n) => (n * 60) / 145;
    const showShots = ['show', 'show-low', 'show-side', 'show-crane', 'show'];
    for (const sh of showShots) {
      this.shot = sh;
      await wait(ctx, beats(10));
    }
    this.cheer = false;

    // ── Part 2: she brings him into the middle; the crowd freestyles, circling them ──
    this.shot = 'lead';
    cast.dancers.forEach((d, i) => d.pose.freestyleMode(i));
    if (her) {
      ctx.clock.tween(0.6, (k) => her.pose && (her.pose.dance.w = 1 - k));
      await movers.walkTo(her, watch.clone().addScaledVector(forward, -0.55), { speed: 1.5, face: watch });
      // she takes his hand…
      this.setReach(her, 'R', 1, () => him.pose.handPosition('L', v()), 4);
      this.setReach(him, 'L', 1, () => her.pose.handPosition('R', v()), 4);
      await wait(ctx, 0.9);
      // …and leads him to the centre of the circle
      await Promise.all([
        movers.walkTo(her, C.clone().addScaledVector(RIGHT, 0.4), { speed: 1.0 }),
        movers.walkTo(him, C.clone().addScaledVector(RIGHT, -0.4), { speed: 1.0 }),
      ]);
      this.setReach(her, 'R', 0, null, 3);
      this.setReach(him, 'L', 0, null, 3);
    }
    // the crowd opens into a ring and circles the couple
    this.ring = cast.dancers.map((d, i) => ({ a: (i / cast.dancers.length) * Math.PI * 2, r: 3.5 + (i % 2) * 0.6 }));
    await Promise.race([
      Promise.all(cast.dancers.map((d, i) => movers.walkTo(d, C.clone().add(new Vector3(Math.sin(this.ring[i].a), 0, Math.cos(this.ring[i].a)).multiplyScalar(this.ring[i].r)), { speed: 2.2, face: C }))),
      wait(ctx, 3.5),
    ]);
    for (const d of cast.dancers) movers.stop(d);
    this.circling = true;
    this.shot = 'orbit';
    fw.auto(1.15);
    // the couple face each other and dance, hands joined
    await Promise.all([movers.turnTo(him, her ? her.root.position : C), her ? movers.turnTo(her, him.root.position) : null]);
    this.holding = true;
    for (const a of [him, her]) if (a?.pose) {
      a.pose.dance.beat = 0;
      a.pose.dance.sway = 1;
    }
    ctx.clock.tween(1.5, (k) => {
      for (const a of [him, her]) if (a?.pose) a.pose.dance.w = k;
    });
    this.runCats(ctx);
    await wait(ctx, 7);
    // the twirl: his hand high, she spins under it
    this.shot = 'couple';
    this.twirl = true;
    await wait(ctx, 0.9);
    if (her) {
      const h = her.root.rotation.y;
      await ctx.clock.tween(1.7, (k) => (her.root.rotation.y = h + k * Math.PI * 2));
      await ctx.clock.tween(1.7, (k) => (her.root.rotation.y = h + Math.PI * 2 + k * Math.PI * 2));
      her.root.rotation.y = h;
    }
    this.twirl = false;
    await wait(ctx, 1.2);
    this.shot = 'crane';
    fw.salvo([
      { type: 'heart', pos: S(112, 0, 50), colorA: 'pink', colorB: 'white', scale: 1.25 },
      { type: 'chrysanthemum', pos: S(130, -45, 60), colorA: 'violet', pistil: 'gold', delay: 0.3 },
      { type: 'chrysanthemum', pos: S(130, 45, 60), colorA: 'sakura', pistil: 'gold', delay: 0.3 },
    ]);
    await wait(ctx, 7);
    // hands up, everybody
    this.shot = 'dancers';
    this.celebrate = true;
    await wait(ctx, 6);
    this.celebrate = false;
    this.shot = 'orbit';
    await wait(ctx, 5);
    // the song carries on; the show settles to a gentle rhythm and the couple come close
    fw.auto(0.5);
    for (const d of cast.dancers) d.pose.want = 0.55;
    this.holding = false;
    await ctx.clock.tween(2, (k) => {
      for (const a of [him, her]) if (a?.pose) a.pose.dance.w = 1 - k * 0.7;
    });
    this.circling = false;
    this.mode = 'end';
    this.shot = 'couple';
    await wait(ctx, 2.5);
    letterbox(false);
    await wait(ctx, 0.6);
  },

  /** The cats chase each other round the dancing couple. */
  async runCats(ctx) {
    const { cast, movers } = ctx.app;
    const cats = [cast.catHim, cast.catHer].filter(Boolean);
    let a = 0;
    while (this.mode === 'dance') {
      a += 0.9;
      await Promise.all(cats.map((c, i) => {
        const ang = a + i * Math.PI;
        const p = this.C.clone().add(new Vector3(Math.sin(ang), 0, Math.cos(ang)).multiplyScalar(1.9));
        return movers.walkTo(c, p, { speed: 2.4 });
      }));
    }
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
    if (!cast?.him || rig.free || !this.C) return;
    const C = this.C;
    const him = cast.him, her = cast.her;
    // ── arms ──
    if (this.mode === 'dance' && her?.pose && him.pose && !this.cheer && this.shot !== 'lead') {
      this.danceT += dt;
      const hp = him.root.position, sp = her.root.position;
      const mid = hp.clone().lerp(sp, 0.5);
      const across = new Vector3().crossVectors(sp.clone().sub(hp).setY(0).normalize(), UP); // his left → her right side
      const bob = Math.sin(this.danceT * Math.PI * (145 / 60)) * 0.04;
      if (this.twirl) {
        // his right hand high over her head, hers meeting it; his left on his hip-height
        const top = sp.clone().lerp(hp, 0.42).setY(1.86);
        this.setReach(him, 'R', 1, () => top, 6);
        this.setReach(her, 'L', 1, () => top.clone().add(new Vector3(0, -0.03, 0)), 6);
        this.setReach(him, 'L', 0, null, 4);
        this.setReach(her, 'R', 0, null, 4);
      } else if (this.celebrate) {
        for (const [a, s] of [[him, 'L'], [him, 'R'], [her, 'L'], [her, 'R']]) {
          const sgn = s === 'L' ? -1 : 1;
          this.setReach(a, s, 1, () => {
            const fwd = a.root.getWorldDirection(v());
            const right = new Vector3().crossVectors(fwd, UP);
            return a.root.position.clone().addScaledVector(right, sgn * 0.32).addScaledVector(fwd, 0.15).setY(1.95 + Math.max(0, Math.sin(this.danceT * Math.PI * 2.4 + sgn)) * 0.12);
          }, 5);
        }
      } else if (this.holding) {
        // both hands joined between them, swinging gently on the beat
        const lo = mid.clone().setY(1.0 + bob);
        this.setReach(him, 'R', 1, () => lo.clone().addScaledVector(across, 0.2), 4);
        this.setReach(her, 'L', 1, () => lo.clone().addScaledVector(across, 0.19), 4);
        this.setReach(him, 'L', 1, () => lo.clone().addScaledVector(across, -0.2), 4);
        this.setReach(her, 'R', 1, () => lo.clone().addScaledVector(across, -0.19), 4);
      } else {
        for (const [a, s] of [[him, 'L'], [him, 'R'], [her, 'L'], [her, 'R']]) this.setReach(a, s, 0, null, 2.5);
      }
    }
    // her cheer arms, on exactly the dancers' beat and moves (see DancerRig CHEER)
    if (this.cheer && her?.pose) {
      this.cheerBeat += (dt * 145) / 60;
      const b = this.cheerBeat, move = CHEER[Math.floor(b / 8) % CHEER.length];
      const fwdH = her.root.getWorldDirection(v()).setY(0).normalize();
      const rightH = new Vector3().crossVectors(fwdH, UP);
      const chest = her.pose.b.chest?.getWorldPosition(v()) ?? her.root.position.clone().setY(1.2);
      const f = b % 1, hitK = f < 0.2 ? Math.sin((f / 0.2) * Math.PI * 0.5) : 1;
      for (const s of ['L', 'R']) {
        const out = s === 'R' ? 1 : -1;
        let o = 0.25, u = -0.3, fw = 0.12;
        if (move === 'cheerV') {
          const up = Math.floor(b) % 2 === 0 ? hitK : 1 - hitK;
          o = 0.24 + 0.24 * up; u = -0.32 + 0.82 * up; fw = 0.1 - 0.05 * up;
        } else if (move === 'punch') {
          const k = Math.floor(b) % 4, on = (s === 'L' ? k === 0 : k === 1) || k >= 2 ? hitK : 0;
          o = 0.12; u = -0.02 + 0.62 * on; fw = 0.22 - 0.12 * on;
        } else if (move === 'clapHigh') {
          const c = Math.pow(0.5 + 0.5 * Math.cos(Math.PI * 2 * f), 4);
          o = 0.12 - 0.09 * c; u = 0.62; fw = 0.08;
        } else if (move === 'hips') {
          o = 0.22; u = -0.3; fw = -0.02;
        } else if (move === 'kick') {
          o = 0.62; u = 0.12; fw = 0.02;
        } else if (move === 'wave') {
          o = 0.3 + Math.sin(Math.PI * b * 0.5) * 0.12 * out; u = 0.58; fw = 0.05;
        }
        this.setReach(her, s, 1, () => chest.clone().addScaledVector(rightH, out * o).add(new Vector3(0, u, 0)).addScaledVector(fwdH, fw), 14);
      }
    }
    // the crowd circling the couple, dancing as they go
    if (this.circling && this.ring) {
      cast.dancers.forEach((d, i) => {
        const R = this.ring[i];
        R.a += dt * 0.09;
        const p = C.clone().add(new Vector3(Math.sin(R.a), 0, Math.cos(R.a)).multiplyScalar(R.r));
        d.root.position.set(p.x, d.root.position.y, p.z);
        d.root.rotation.y = Math.atan2(C.x - p.x, C.z - p.z) + Math.sin(t * 0.7 + i) * 0.5;
        d.speed = 0.2;
      });
    }
    for (const r of this.reach.values()) {
      r.w += (r.want - r.w) * damp(r.rate, dt);
      const pose = r.actor.pose;
      if (!pose) continue;
      if (r.w > 0.02 || r.want > 0) {
        pose.reach[r.side].w = r.w;
        if (r.target) pose.reach[r.side].target.copy(r.target());
      } else pose.reach[r.side].w = 0;
    }

    // ── camera ──
    const c = cast.coupleCenter(v());
    const want = v(), look = v();
    let rate = 1.2;
    const shot = this.shot;
    if (shot === 'arrive') {
      const fwd = him.root.getWorldDirection(v()).setY(0).normalize();
      const side = new Vector3().crossVectors(fwd, UP);
      want.copy(c).addScaledVector(fwd, -4.6).addScaledVector(side, 1.2).setY(1.55);
      look.copy(c).addScaledVector(fwd, 9).setY(2.0);
      rate = 1.0;
    } else if (shot === 'nightfall') {
      // high behind them: the plaza, its lanterns and the sky falling dark
      want.copy(C).addScaledVector(SKY, -9).addScaledVector(RIGHT, 2.5).setY(2.2);
      look.copy(C).addScaledVector(SKY, 40).setY(7);
    } else if (shot === 'sky' || shot === 'text') {
      // low behind the couple: their heads at the bottom of the frame, the show above
      const back = shot === 'text' ? 6 : 4.4;
      want.copy(C).addScaledVector(SKY, -back).addScaledVector(RIGHT, shot === 'text' ? 0.9 : 1.1).setY(1.15);
      look.copy(this.textCenter ?? app.fireworks.skyPoint(105, 0, 32)).setY(shot === 'text' ? 25 : 27);
      rate = 0.6;
    } else if (shot === 'faces') {
      // in front of them, looking back at their upturned faces washed in colour
      want.copy(C).addScaledVector(SKY, 2.5).addScaledVector(RIGHT, 0.35).setY(1.2);
      look.copy(c).setY(1.5);
      rate = 0.5;
    } else if (shot === 'wide') {
      want.copy(C).addScaledVector(SKY, -11).addScaledVector(RIGHT, -3.5).setY(1.6);
      look.copy(C).addScaledVector(SKY, 60).setY(20);
      rate = 0.4;
    } else if (shot === 'reaction') {
      // over her shoulder onto his face as he takes in her message
      const hp = him.pose?.b.head?.getWorldPosition(v()) ?? c;
      want.copy(C).addScaledVector(RIGHT, 2.2).addScaledVector(SKY, 1.4).setY(1.72);
      look.copy(hp).setY(hp.y - 0.08);
      rate = 0.7;
    } else if (shot === 'text-wide') {
      want.copy(C).addScaledVector(SKY, -12).addScaledVector(RIGHT, 2).setY(2.0);
      look.copy(this.textCenter).setY(20);
      rate = 0.5;
    } else if (shot === 'show' || shot === 'show-low' || shot === 'show-side' || shot === 'show-crane') {
      // her show, framed from his side: the V of dancers behind her
      const ctr = this.centre ?? C, w = this.watch ?? C;
      const fwdS = w.clone().sub(ctr).setY(0).normalize(), sideS = new Vector3().crossVectors(fwdS, UP);
      if (shot === 'show') {
        want.copy(w).addScaledVector(fwdS, 2.6).addScaledVector(sideS, 0.8).setY(2.0);
        look.copy(ctr).addScaledVector(fwdS, -1.6).setY(1.1);
      } else if (shot === 'show-low') {
        want.copy(ctr).addScaledVector(fwdS, 2.4).addScaledVector(sideS, -0.6).setY(0.55);
        look.copy(ctr).addScaledVector(fwdS, -1.5).setY(1.5);
      } else if (shot === 'show-side') {
        want.copy(ctr).addScaledVector(sideS, 7.2).addScaledVector(fwdS, 0.8).setY(1.5);
        look.copy(ctr).addScaledVector(fwdS, -1.6).setY(1.0);
      } else {
        want.copy(w).addScaledVector(fwdS, 3.5).setY(7 + (this.danceT ?? 0) * 0.05);
        look.copy(ctr).addScaledVector(fwdS, -2.2).setY(0.6);
      }
      this.danceT = (this.danceT ?? 0) + dt;
      rate = 1.2;
    } else if (shot === 'lead') {
      const mid2 = him.root.position.clone().lerp(her?.root.position ?? him.root.position, 0.5);
      want.copy(mid2).addScaledVector(RIGHT, 4.2).addScaledVector(SKY, -1).setY(1.6);
      look.copy(mid2).setY(1.2);
      rate = 1.0;
    } else if (shot === 'orbit' || shot === 'dancers') {
      // round the ring of dancers
      // (always outside the ring: the dancers are at 3.4–4.1 m)
      const r = shot === 'dancers' ? 6.2 : 6.8;
      const a = Math.atan2(-SKY.x, -SKY.z) + (shot === 'dancers' ? -0.4 : 0.55) + (this.danceT ?? 0) * 0.16;
      want.copy(C).add(new Vector3(Math.sin(a), 0, Math.cos(a)).multiplyScalar(r)).setY(shot === 'dancers' ? 0.9 : 2.7); // (orbit: high enough to see over the circling crowd)
      look.copy(C).setY(shot === 'dancers' ? 2.4 : 2.3).addScaledVector(SKY, 3);
      rate = 1.5;
    } else if (shot === 'couple') {
      const hp = him.root.position, sp = her?.root.position ?? hp;
      const across = new Vector3().crossVectors(sp.clone().sub(hp).setY(0).normalize(), UP);
      if (across.dot(SKY) > 0) across.negate(); // shoot with the sky behind them
      want.copy(c).addScaledVector(across, 3.3).setY(1.45);
      look.copy(c).setY(1.35);
      rate = 1.4;
    } else if (shot === 'crane') {
      // high over the plaza, looking down on the ring of dancers in the lantern light
      want.copy(C).addScaledVector(SKY, -5.5).addScaledVector(RIGHT, 2.2).setY(7.5 + (this.danceT ?? 0) * 0.03);
      look.copy(C).addScaledVector(SKY, 1.5).setY(0.6);
      rate = 0.6;
    }
    const key = shot;
    if (this.cutNext || (this.lastKey && this.lastKey !== key)) {
      rig.pos.copy(want);
      rig.look.copy(look);
      this.cutNext = false;
    } else {
      rig.pos.lerp(want, damp(rate, dt));
      rig.look.lerp(look, damp(rate * 1.6, dt));
    }
    this.lastKey = key;
  },

  exit(ctx) {
    const { cast, post, fireworks } = ctx.app;
    this.mode = 'done';
    for (const a of [cast?.him, cast?.her]) {
      if (!a?.pose) continue;
      a.pose.reach.L.w = a.pose.reach.R.w = 0;
      a.pose.dance.w = 0;
      a.pose.gazeUp = 0;
    }
    this.reach = new Map();
    this.cheer = this.circling = false;
    post.u.uFade.value = 0;
    if (fireworks.autoRate > 0.5) fireworks.auto(0.5); // the show carries on softly over the park
    letterbox(false);
  },
};
