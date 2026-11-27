import { Vector3 } from 'three';
import { PARK } from '../../config.js';
import { damp } from '../../utils/math.js';
import { laneLength, lanePoint, laneSide, STATIONS, laneU } from '../../world/lane.js';
import { wait } from '../Timeline.js';
import { actCard, letterbox } from '../ui.js';

const v = () => new Vector3();

/** Unit vector to the actor's right. */
const rightOf = (actor, out = v()) => {
  const h = actor.root.rotation.y;
  return out.set(-Math.cos(h), 0, Math.sin(h));
};

/**
 * ACT I — A Stroll Beneath the Blossoms, then a game of catch.
 *
 *  Stroll   He sets off down the lane first; she follows at his shoulder
 *           (the path-following companion from infinity-castle), the cats
 *           trotting along. The camera glides between four framings keyed to
 *           how far they've walked: a front dolly, a side track, a high crane
 *           behind them down the lantern avenue, and a wide from the clearing
 *           as they turn off the lane. Spring Snow plays throughout.
 *  Arrive   He walks to his mark in the clearing and STAYS there (the
 *           waypoint walk ends anchored, never looping back); she walks to
 *           the mark opposite and they turn to face each other; the cats
 *           settle on the far side to watch.
 *  Catch    A glowing ball arcs back and forth: wind-up with the arm raised,
 *           release and follow-through, the catcher's hand reaching up to
 *           meet it in the last half-second. Shots: wide side, over his
 *           shoulder, over hers, then a rising wide to close.
 */
export const ActI = {
  name: 'act1',

  async enter(ctx) {
    const app = ctx.app;
    const { cast, controller: ctl, follow, movers, ball, rig } = app;
    this.app = app;
    this.mode = 'stroll';
    this.odo = 0;
    this.reach = new Map();
    this.flight = null;
    this.holder = null;
    if (!cast?.him || !ctl) return;

    letterbox(true);
    setTimeout(() => actCard('I', 'A Stroll Beneath the Blossoms', 6), 1200);

    // ── the stroll: waypoints down the lane, then off it into the catch clearing ──
    const st = STATIONS.catch;
    const T = lanePoint(st.u + 0.004).sub(lanePoint(st.u - 0.004)).setY(0).normalize();
    const P = st.center.clone().sub(lanePoint(st.u)).setY(0).normalize(); // lane → clearing
    this.frame = { T, P, center: st.center.clone() };
    this.markHim = st.center.clone().addScaledVector(T, 2.3);
    this.markHer = st.center.clone().addScaledVector(T, -2.3);
    const pts = [];
    // from wherever he stands (the gate in the film; anywhere before the clearing in interactive mode)
    const u0 = Math.max(0.035, Math.min(st.u - 0.04, laneU(cast.him.root.position.x, cast.him.root.position.z) + 0.006)), u1 = st.u - 0.03;
    for (let u = u0; u <= u1; u += 2 / laneLength) pts.push(lanePoint(u));
    pts.push(lanePoint(st.u - 0.008).addScaledVector(laneSide(st.u), st.side * (PARK.laneWidth / 2 + 1.2)));
    pts.push(this.markHim.clone());
    this.pathLen = pts.reduce((s, p, i) => (i ? s + p.distanceTo(pts[i - 1]) : 0), 0) + cast.him.root.position.distanceTo(pts[0]);
    this.u0 = u0;
    this.u1 = u1;

    for (const f of app.followers) {
      f.reset();
      f.paused = false;
    }
    rig.cut(rig.pos.clone(), rig.look.clone()); // take the camera as the prelude left it; update() glides from here
    const jump = ctx.jump;
    ctx.jump = null;
    if (jump === 'catch') {
      // straight to the catch (the chapter picker): they're already in the clearing
      const put = (a, p, look) => {
        if (!a) return;
        a.root.position.copy(p);
        a.root.rotation.y = Math.atan2(look.x - p.x, look.z - p.z);
      };
      put(cast.him, this.markHim, this.markHer);
      put(cast.her, this.markHer.clone().addScaledVector(P, 0.8), this.markHim);
      put(cast.catHim, this.markHim.clone().addScaledVector(P, 1.6), st.center);
      put(cast.catHer, this.markHer.clone().addScaledVector(P, 1.8), st.center);
      ctl.pos.copy(this.markHim);
      for (const f of app.followers) f.reset();
      this.odo = this.pathLen; // (the stroll's camera framings are skipped)
      rig.cut(st.center.clone().addScaledVector(P, -6.6).setY(1.65), st.center.clone().setY(1.35));
      await wait(ctx, 0.8);
    } else {
      await wait(ctx, 0.6);
      await ctl.walkPath(pts, 1.3);
    }

    // ── arrival: everyone to their marks (and they stay there) ──
    this.mode = 'arrive';
    for (const f of app.followers) f.paused = true;
    const catSpot = (mark, dt) => mark.clone().addScaledVector(P, 1.7).addScaledVector(T, dt);
    await Promise.all([
      cast.her ? movers.walkTo(cast.her, this.markHer, { speed: 1.15, face: this.markHim }) : null,
      movers.turnTo(cast.him, this.markHer),
      cast.catHim ? movers.walkTo(cast.catHim, catSpot(this.markHim, -0.7), { speed: 1.1, face: st.center }) : null,
      cast.catHer ? movers.walkTo(cast.catHer, catSpot(this.markHer, 0.7), { speed: 1.1, face: st.center }) : null,
    ]);
    await movers.turnTo(cast.him, cast.her.root.position);

    // ── catch ──
    this.mode = 'catch';
    this.throws = 0;
    this.holder = cast.him;
    ball.set(true);
    await wait(ctx, 1.2);
    let a = cast.him, b = cast.her;
    for (let i = 0; i < 6; i++) {
      await this.throwBall(ctx, a, b);
      this.throws = i + 1;
      [a, b] = [b, a];
      await wait(ctx, 0.55);
    }
    // close: the ball settles in his hand and fades; a last rising wide
    this.mode = 'outro';
    await wait(ctx, 1.6);
    ball.set(false);
    await wait(ctx, 2.2);
    this.setReach(cast.him, 0, null, 2);
    this.setReach(cast.her, 0, null, 2);
    letterbox(false);
    await wait(ctx, 1.2);
  },

  /** Ease an actor's right arm toward a target (fn → Vector3) with weight w. */
  setReach(actor, w, targetFn, rate = 5) {
    const r = this.reach.get(actor) ?? { w: 0 };
    r.want = w;
    if (targetFn) r.target = targetFn;
    r.rate = rate;
    this.reach.set(actor, r);
  },

  async throwBall(ctx, thrower, catcher) {
    const toward = (from, to) => to.root.position.clone().sub(from.root.position).setY(0).normalize();
    // wind-up: hand raised beside the head, a little back
    this.setReach(thrower, 1, () => thrower.root.position.clone().add(new Vector3(0, 1.72, 0)).addScaledVector(rightOf(thrower), 0.3).addScaledVector(toward(thrower, catcher), -0.12), 6);
    // the catcher gets ready: hand out in front
    this.setReach(catcher, 0.55, () => catcher.root.position.clone().add(new Vector3(0, 1.25, 0)).addScaledVector(toward(catcher, thrower), 0.45).addScaledVector(rightOf(catcher), 0.15), 3);
    await wait(ctx, 0.55);
    // release + follow-through
    const flightT = 1.15;
    this.flight = { from: this.app.ball.pos.clone(), t: 0, T: flightT, catcher, apex: 1.0 };
    this.holder = null;
    this.setReach(thrower, 0.8, () => thrower.root.position.clone().add(new Vector3(0, 1.3, 0)).addScaledVector(toward(thrower, catcher), 0.65), 7);
    await wait(ctx, 0.35);
    this.setReach(thrower, 0, null, 2.2);
    // the catch: in the last half-second the hand tracks the ball
    await wait(ctx, flightT - 0.35 - 0.5);
    this.setReach(catcher, 1, () => this.app.ball.pos.clone(), 9);
    await new Promise((r) => (this.flight.done = r));
    this.flight = null;
    this.holder = catcher;
    this.setReach(catcher, 0.6, () => catcher.root.position.clone().add(new Vector3(0, 1.2, 0)).addScaledVector(toward(catcher, thrower), 0.3), 3);
    await wait(ctx, 0.35);
    this.setReach(catcher, 0, null, 2.2);
  },

  update(dt, t, ctx) {
    const app = ctx.app;
    const { cast, rig, controller: ctl } = app;
    if (!cast?.him || rig.free) return;
    // arm reach weights
    for (const [actor, r] of this.reach) {
      r.w += (r.want - r.w) * damp(r.rate, dt);
      if (!actor.pose) continue;
      actor.pose.reach.R.w = r.w;
      if (r.target) actor.pose.reach.R.target.copy(r.target());
    }
    // ── camera ──
    const c = cast.coupleCenter(v());
    const want = v(), look = v();
    if (this.mode === 'stroll') {
      this.odo += ctl.speed * dt;
      const p = Math.min(1, this.odo / this.pathLen);
      const u = Math.min(this.u1, this.u0 + this.odo / laneLength);
      const fwd = lanePoint(Math.min(1, u + 0.004)).sub(lanePoint(Math.max(0, u - 0.004))).setY(0).normalize();
      const side = laneSide(u);
      if (p < 0.28) {
        want.copy(c).addScaledVector(fwd, 5.2).addScaledVector(side, 1.1).setY(1.55); // front dolly
        look.copy(c).setY(1.2);
      } else if (p < 0.55) {
        want.copy(c).addScaledVector(side, -5.6).addScaledVector(fwd, 0.9).setY(1.75); // side track
        look.copy(c).addScaledVector(fwd, 0.7).setY(1.2);
      } else if (p < 0.8) {
        want.copy(c).addScaledVector(fwd, -6.5).addScaledVector(side, 1.2).setY(2.3); // low behind them, down the avenue (under the canopy)
        look.copy(c).addScaledVector(fwd, 12).setY(1.9);
      } else {
        const F = this.frame;
        want.copy(F.center).addScaledVector(F.P, 5.5).addScaledVector(F.T, -3.5).setY(2.1); // the clearing waits for them
        look.copy(c).setY(1.2);
      }
      rig.pos.lerp(want, damp(0.75, dt));
      rig.look.lerp(look, damp(1.5, dt));
    } else {
      const F = this.frame;
      const mid = F.center.clone().setY(1.35);
      const shot = this.mode === 'arrive' ? 0 : this.mode === 'outro' ? 3 : Math.min(2, Math.floor((this.throws ?? 0) / 2));
      if (shot === 0) {
        want.copy(mid).addScaledVector(F.P, -6.6).setY(1.65); // wide side, from the lane
        look.copy(mid);
      } else if (shot === 1) {
        want.copy(this.markHim).addScaledVector(F.T, 2.4).addScaledVector(F.P, -0.9).setY(1.85); // over his shoulder
        look.copy(this.markHer).setY(1.3);
      } else if (shot === 2) {
        want.copy(this.markHer).addScaledVector(F.T, -2.4).addScaledVector(F.P, -0.9).setY(1.75); // over hers
        look.copy(this.markHim).setY(1.4);
      } else {
        want.copy(mid).addScaledVector(F.P, -7.5).addScaledVector(F.T, 1.5).setY(3.4); // rising wide
        look.copy(mid).setY(1.0);
      }
      if (this.flight) look.lerp(app.ball.pos, 0.25); // the eye follows the ball a little
      rig.pos.lerp(want, damp(shot === 3 ? 0.5 : 1.1, dt));
      rig.look.lerp(look, damp(2, dt));
    }
    // the cats watch the ball
    if (this.mode === 'catch' || this.mode === 'outro') {
      for (const cat of [cast.catHim, cast.catHer]) {
        if (!cat) continue;
        const b = app.ball.pos;
        const h = Math.atan2(b.x - cat.root.position.x, b.z - cat.root.position.z);
        let d = h - cat.root.rotation.y;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        cat.root.rotation.y += d * damp(3, dt);
      }
    }
  },

  /** After posing: the ball rides the holder's hand, or flies its arc to the catcher's. */
  late(dt, t, ctx) {
    const ball = ctx.app.ball;
    if (this.holder?.pose) {
      this.holder.pose.handPosition('R', ball.pos);
      ball.pos.y += 0.03;
    } else if (this.flight) {
      const f = this.flight;
      f.t += dt;
      const k = Math.min(1, f.t / f.T);
      const end = f.catcher.pose ? f.catcher.pose.handPosition('R', v()) : f.catcher.root.position.clone().setY(1.3);
      ball.pos.copy(f.from).lerp(end, k);
      ball.pos.y += f.apex * 4 * k * (1 - k);
      if (k >= 1) f.done?.();
    }
  },

  exit(ctx) {
    ctx.app.ball.set(false);
    letterbox(false);
    for (const a of [ctx.app.cast?.him, ctx.app.cast?.her]) if (a?.pose) a.pose.reach.R.w = 0;
    this.reach = new Map();
    this.flight = null;
    this.holder = null;
  },
};

