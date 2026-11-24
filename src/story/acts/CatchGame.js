import { AdditiveBlending, Color, DoubleSide, Mesh, MeshBasicMaterial, RingGeometry, Vector3 } from 'three';
import { angleDelta, damp } from '../../utils/math.js';
import { lanePoint, STATIONS } from '../../world/lane.js';
import { walkHeight } from '../../world/terrain.js';
import { actions, clearActions, flashText, hud, prompt } from '../ui.js';

const v = () => new Vector3();
const UP = new Vector3(0, 1, 0);
const rightOf = (a) => new Vector3().crossVectors(a.root.getWorldDirection(v()).setY(0).normalize(), UP);
const DURATION = 30; // seconds on the clock
const ARENA = 3.0; // how far he can roam from his mark (m)
const SPEED = 2.7; // his running speed while playing (m/s)

/**
 * INTERACTIVE MODE — stage 1: catch at the clearing, against the clock.
 *
 * She throws the glowing ball toward a different spot every time (a soft gold
 * ring on the grass shows where it's coming down); the player runs him there
 * with WASD / the arrow keys and catches it — he snatches it out of the air
 * when he's under it. He tosses it straight back and she lines up the next.
 * A live counter and a 30-second countdown run at the top. When time's up (or
 * whenever the player likes) "Walk on" unlocks the path to the picnic;
 * "Play again" resets the clock.
 */
export const CatchGame = {
  name: 'catchgame',

  async enter(ctx) {
    const app = ctx.app;
    const { cast, movers, ball } = app;
    this.app = app;
    this.reach = new Map();
    this.flight = null;
    this.drop = null;
    this.holder = null;
    this.score = 0;
    this.best ??= 0;
    this.quit = false;
    this.keys = new Set();
    this.vel = new Vector3();
    if (!cast?.him || !cast.her) return;
    const st = STATIONS.catch;
    const T = lanePoint(st.u + 0.004).sub(lanePoint(st.u - 0.004)).setY(0).normalize();
    const P = st.center.clone().sub(lanePoint(st.u)).setY(0).normalize();
    this.frame = { T, P, center: st.center.clone() };
    this.markHim = st.center.clone().addScaledVector(T, 2.6);
    this.markHer = st.center.clone().addScaledVector(T, -2.6);
    for (const f of app.followers) f.paused = true;
    const catSpot = (mark, dt) => mark.clone().addScaledVector(P, 3.4).addScaledVector(T, dt);
    if (cast.catHim) movers.walkTo(cast.catHim, catSpot(this.markHim, -0.4), { speed: 1.6, face: st.center });
    if (cast.catHer) movers.walkTo(cast.catHer, catSpot(this.markHer, 0.4), { speed: 1.6, face: st.center });
    this.mode = 'setup';
    await Promise.all([
      movers.walkTo(cast.him, this.markHim, { speed: 1.4, face: this.markHer }),
      movers.walkTo(cast.her, this.markHer, { speed: 1.5, face: this.markHim }),
    ]);
    await movers.turnTo(cast.her, cast.him.root.position);

    // the landing marker
    this.marker = new Mesh(
      new RingGeometry(0.42, 0.55, 40).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ color: new Color(2.2, 1.6, 0.7), transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }),
    );
    this.marker.renderOrder = 3;
    app.scene.add(this.marker);
    // input: WASD / arrows move him; Esc / E = walk on
    this.onDown = (e) => {
      if (/^(Arrow|Key[WASD])/.test(e.code)) {
        this.keys.add(e.code);
        e.preventDefault();
      }
      if (e.code === 'KeyE' || e.code === 'Escape') this.quit = true;
    };
    this.onUp = (e) => this.keys.delete(e.code);
    addEventListener('keydown', this.onDown);
    addEventListener('keyup', this.onUp);
    ball.set(true);

    // rounds until the player walks on
    for (;;) {
      await this.round(ctx);
      if (this.quit) break;
      this.best = Math.max(this.best, this.score);
      hud(`<span>Time!</span><span>Catches<b>${this.score}</b></span><span>Best<b>${this.best}</b></span>`);
      const pick = await actions([
        { id: 'walk', label: 'Walk on to the picnic', primary: true },
        { id: 'again', label: 'Play again' },
      ]);
      if (pick !== 'again') break;
    }
    app.progress = { ...app.progress, catch: true };
    hud(null);
    clearActions();
    prompt(null);
  },

  /** One 30-second round. */
  async round(ctx) {
    const { cast } = ctx.app;
    this.score = 0;
    this.timeLeft = DURATION;
    this.mode = 'play';
    this.holder = cast.her;
    prompt('<b>WASD</b> run to where the ring glows · catch the ball · <b>E</b> walk on');
    setTimeout(() => prompt(null), 4500);
    this.walkOn = actions([{ id: 'walk', label: 'Walk on' }]).then((id) => id === 'walk' && (this.quit = true));
    while (this.timeLeft > 0 && !this.quit) {
      await this.sleep(ctx, 0.35);
      if (this.quit) break;
      // she throws to a new spot around him
      const caught = await this.herThrow(ctx);
      if (this.quit) break;
      if (caught) {
        this.score++;
        flashText(this.score > 1 ? `Caught! ×${this.score}` : 'Caught!', 'flash-text--good');
        await this.sleep(ctx, 0.35);
        await this.throwTo(ctx, cast.him, cast.her, 1.0, 0.9);
      } else {
        flashText('Missed!', 'flash-text--miss');
        await this.sleep(ctx, 1.1); // it bounces away and rolls; she has another
        this.drop = null;
        this.holder = cast.her;
      }
    }
    this.mode = 'over';
    clearActions();
    this.marker.material.opacity = 0;
  },

  sleep(ctx, s) {
    return new Promise((r) => ctx.clock.after(s, r));
  },

  /** Her throw toward a fresh spot; resolves true if he catches it. */
  async herThrow(ctx) {
    const { cast } = ctx.app;
    const him = cast.him, her = cast.her;
    const F = this.frame;
    // a landing spot inside the arena, at least ~1 m from where he stands now
    let target;
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.6 + Math.random() * (ARENA - 0.7);
      target = this.markHim.clone().addScaledVector(F.T, Math.cos(a) * r * 0.7).addScaledVector(F.P, Math.sin(a) * r);
      if (target.distanceTo(him.root.position) > 1.1) break;
    }
    target.y = walkHeight(target.x, target.z) + 1.25;
    this.target = target;
    this.marker.position.set(target.x, walkHeight(target.x, target.z) + 0.03, target.z);
    const T = 1.25 + Math.random() * 0.45;
    return this.throwTo(ctx, her, him, T, 0.9 + Math.random() * 1.0, target);
  },

  /** A throw: wind-up, arc to `to` (a fixed spot) or to the catcher's hand. */
  async throwTo(ctx, thrower, catcher, T, apex, to = null) {
    const toward = (a, b) => b.root.position.clone().sub(a.root.position).setY(0).normalize();
    this.setReach(thrower, 1, () => thrower.root.position.clone().add(new Vector3(0, 1.72, 0)).addScaledVector(rightOf(thrower), 0.3).addScaledVector(toward(thrower, catcher), -0.12), 6);
    await this.sleep(ctx, 0.45);
    const flight = { from: this.app.ball.pos.clone(), t: 0, T, apex, catcher, to, result: to ? null : true };
    this.flight = flight;
    this.holder = null;
    this.setReach(thrower, 0.8, () => thrower.root.position.clone().add(new Vector3(0, 1.3, 0)).addScaledVector(toward(thrower, catcher), 0.65), 7);
    ctx.clock.after(0.35, () => this.setReach(thrower, 0, null, 2.2));
    if (!to) ctx.clock.after(Math.max(0, T - 0.5), () => this.setReach(catcher, 1, () => this.app.ball.pos.clone(), 9));
    await new Promise((r) => (flight.done = r));
    this.flight = null;
    if (flight.result) {
      this.holder = catcher;
      this.setReach(catcher, 0.55, () => catcher.root.position.clone().add(new Vector3(0, 1.2, 0)).addScaledVector(catcher.root.getWorldDirection(v()), 0.3), 3);
      ctx.clock.after(0.35, () => this.setReach(catcher, 0, null, 2.2));
    }
    return flight.result;
  },

  setReach(actor, w, targetFn, rate = 5) {
    const r = this.reach.get(actor) ?? { w: 0 };
    r.want = w;
    if (targetFn) r.target = targetFn;
    r.rate = rate;
    this.reach.set(actor, r);
  },

  update(dt, t, ctx) {
    const app = ctx.app;
    const { cast, rig } = app;
    if (!cast?.him || rig.free || !this.frame) return;
    const him = cast.him, her = cast.her;
    const F = this.frame;
    // the clock
    if (this.mode === 'play') {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      const s = Math.ceil(this.timeLeft);
      hud(`<span>Catches<b>${this.score}</b></span><span class="${s <= 5 ? 'hud__low' : ''}">Time<b>0:${String(s).padStart(2, '0')}</b></span>`);
    }
    // camera: wide, behind and above him, looking across to her
    const want = this.markHim.clone().addScaledVector(F.T, 4.6).addScaledVector(F.P, -2.6).setY(3.2);
    const look = this.markHim.clone().lerp(this.markHer, 0.42).setY(1.0);
    rig.pos.lerp(want, damp(1.5, dt));
    rig.look.lerp(look, damp(2, dt));
    // WASD: camera-relative running inside the arena
    if (this.mode === 'play' || this.mode === 'over') {
      const k = this.keys;
      const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      const sd = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      const camF = look.clone().sub(want).setY(0).normalize();
      const camR = new Vector3().crossVectors(camF, UP);
      const wish = camF.multiplyScalar(f).addScaledVector(camR, sd);
      if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(SPEED);
      this.vel.lerp(wish, damp(wish.lengthSq() ? 9 : 7, dt));
      const p = him.root.position;
      p.addScaledVector(this.vel, dt);
      const off = p.clone().sub(this.markHim).setY(0);
      if (off.length() > ARENA) p.copy(this.markHim).addScaledVector(off.normalize(), ARENA);
      p.y = walkHeight(p.x, p.z);
      const sp = this.vel.length();
      him.speed = sp;
      // face where he runs; otherwise toward the ball (or her)
      const faceTo = sp > 0.3 ? p.clone().add(this.vel) : this.flight ? app.ball.pos : her.root.position;
      him.root.rotation.y += angleDelta(him.root.rotation.y, Math.atan2(faceTo.x - p.x, faceTo.z - p.z)) * damp(sp > 0.3 ? 12 : 6, dt);
      // she keeps facing him
      her.root.rotation.y += angleDelta(her.root.rotation.y, Math.atan2(p.x - her.root.position.x, p.z - her.root.position.z)) * damp(4, dt);
    }
    // his hand goes up for a ball he's close to
    const f = this.flight;
    if (f?.to && f.result == null) {
      const close = app.ball.pos.clone().setY(0).distanceTo(him.root.position.clone().setY(0));
      if (close < 1.6 && f.t > f.T * 0.55) this.setReach(him, 1, () => app.ball.pos.clone(), 10);
      this.marker.material.opacity = 0.55 + 0.35 * Math.sin(t * 9);
    } else if (this.marker) this.marker.material.opacity *= 1 - Math.min(1, dt * 6);
    for (const [actor, r] of this.reach) {
      r.w += (r.want - r.w) * damp(r.rate, dt);
      if (!actor.pose) continue;
      actor.pose.reach.R.w = r.w;
      if (r.target) actor.pose.reach.R.target.copy(r.target());
    }
    // the cats watch the ball
    for (const cat of [cast.catHim, cast.catHer]) {
      if (!cat) continue;
      const b = app.ball.pos;
      cat.root.rotation.y += angleDelta(cat.root.rotation.y, Math.atan2(b.x - cat.root.position.x, b.z - cat.root.position.z)) * damp(3, dt);
    }
  },

  /** The ball rides a hand, flies its arc (caught if he's under it), or bounces away. */
  late(dt, t, ctx) {
    const { cast, ball } = ctx.app;
    const him = cast?.him;
    if (this.holder?.pose) {
      this.holder.pose.handPosition('R', ball.pos);
      ball.pos.y += 0.03;
    } else if (this.flight) {
      const f = this.flight;
      f.t += dt;
      const k = Math.min(1, f.t / f.T);
      const end = f.to ?? (f.catcher.pose ? f.catcher.pose.handPosition('R', v()) : f.catcher.root.position.clone().setY(1.3));
      ball.pos.copy(f.from).lerp(end, k);
      ball.pos.y += f.apex * 4 * k * (1 - k);
      if (f.to) {
        // caught: he's under it as it comes down
        const reachPt = him.root.position.clone().addScaledVector(him.root.getWorldDirection(v()), 0.2).setY(ball.pos.y);
        if (k > 0.7 && ball.pos.y < 2.1 && ball.pos.y > 0.55 && reachPt.distanceTo(ball.pos) < 0.78) {
          f.result = true;
          f.done?.();
          f.done = null;
          return;
        }
        if (k >= 1) {
          // missed: it carries on down past him and bounces away
          const vel = end.clone().sub(f.from).divideScalar(f.T).add(new Vector3(0, -f.apex * 4 / f.T, 0));
          this.drop = { vel, pos: ball.pos.clone() };
          f.result = false;
          f.done?.();
          f.done = null;
        }
      } else if (k >= 1) {
        f.done?.();
        f.done = null;
      }
    } else if (this.drop) {
      const d = this.drop;
      d.vel.y -= 9.8 * dt;
      d.pos.addScaledVector(d.vel, dt);
      const g = walkHeight(d.pos.x, d.pos.z) + 0.09;
      if (d.pos.y < g) {
        d.pos.y = g;
        d.vel.y = Math.abs(d.vel.y) * 0.45;
        d.vel.x *= 0.7;
        d.vel.z *= 0.7;
      }
      ball.pos.copy(d.pos);
    }
  },

  exit(ctx) {
    this.quit = true;
    removeEventListener('keydown', this.onDown);
    removeEventListener('keyup', this.onUp);
    ctx.app.ball.set(false);
    prompt(null);
    hud(null);
    clearActions();
    if (this.marker) {
      this.marker.removeFromParent();
      this.marker.geometry.dispose();
      this.marker.material.dispose();
      this.marker = null;
    }
    const him = ctx.app.cast?.him;
    if (him) him.speed = 0;
    for (const a of [him, ctx.app.cast?.her]) if (a?.pose) a.pose.reach.R.w = 0;
    this.reach = new Map();
    this.flight = null;
    this.drop = null;
    this.holder = null;
  },
};
