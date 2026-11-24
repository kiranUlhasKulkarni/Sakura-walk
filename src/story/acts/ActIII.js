import { Vector3 } from 'three';
import { PARK } from '../../config.js';
import { damp } from '../../utils/math.js';
import { laneLength, lanePoint, laneSide, laneU, STATIONS } from '../../world/lane.js';
import { KnitStrip } from '../Scarf.js';
import { wait } from '../Timeline.js';
import { actCard, actions, clearActions, letterbox, prompt } from '../ui.js';

const v = () => new Vector3();
const UP = new Vector3(0, 1, 0);

/**
 * ACT III — Fire and Thread.
 *
 *  Walk     From the picnic down the lane toward the dim festival corner, the
 *           dusk deepening as they go. The camera pans to the stage: the
 *           phoenix-dragon hangs over its round wooden stage, ringed by
 *           banners; the braziers flare alight one by one.
 *  Perform  They sit on the bench in front of the stage. The dragon breathes
 *           real fire — a roaring cone of flame and smoke from its jaws that
 *           lights the whole corner orange, shakes the camera and gusts the
 *           petals — again and again between wide shots and a low hero angle.
 *  Knit     She takes out her crochet needles and finishes the scarf: her hands
 *           work in small rhythmic loops while the maroon strip grows across
 *           her lap and over her knees. Inserts on her hands; the two of them
 *           lit by the firelight from the front.
 *  Wrap     They stand. She steps in front of him and, reaching up with both
 *           hands, wraps the finished maroon scarf around his neck — it
 *           settles there and stays for the rest of the night.
 */
export const ActIII = {
  name: 'act3',

  async enter(ctx) {
    const app = ctx.app;
    const { cast, controller: ctl, movers, rig, stage, fire } = app;
    this.app = app;
    this.mode = 'walk';
    this.reach = new Map();
    this.shake = 0;
    this.strip = null;
    this.lastMode = null;
    if (!cast?.him || !ctl || !stage) return;

    const play = !!ctx.interactive; // the player walked him here: sit with her, look around, lean in
    this.play = play;
    if (!play) {
      letterbox(true);
      setTimeout(() => actCard('III', 'Fire and Thread', 6), 900);
    }
    // the evening falls almost to night on the way: the festival corner is dim and dark, lit by
    // its fires and lanterns (Act IV then drops straight to full night)
    const n0 = app.night;
    ctx.clock.tween(16, (k) => app.setNight(n0 + (0.86 - n0) * k));

    // ── walk to the stage ──
    const st = STATIONS.stage;
    const half = PARK.laneWidth / 2;
    const him = cast.him.root.position;
    const uStart = laneU(him.x, him.z);
    const pts = [lanePoint(Math.min(uStart + 0.008, st.u)).addScaledVector(laneSide(uStart), 0)];
    for (let u = uStart + 0.015; u <= st.u - 0.01; u += 2 / laneLength) pts.push(lanePoint(u));
    pts.push(lanePoint(st.u).addScaledVector(laneSide(st.u), st.side * (half + 1.0)));
    const standHim = stage.seats.him.clone().addScaledVector(stage.toLane, 0.6);
    pts.push(standHim);
    for (const f of app.followers) {
      f.reset();
      f.paused = false;
    }
    rig.cut(rig.pos.clone(), rig.look.clone());
    // the braziers catch as they approach
    this.lit = false;
    if (!play) {
      await wait(ctx, 0.6);
      await ctl.walkPath(pts, 1.3);
    } else await ctl.walkPath([standHim], 1.2);

    // ── sit on the bench ──
    this.mode = 'perform';
    for (const f of app.followers) f.paused = true;
    const faceStage = stage.center;
    await Promise.all([
      movers.walkTo(cast.him, stage.seats.him, { speed: 0.8 }),
      cast.her ? movers.walkTo(cast.her, stage.seats.her, { speed: 0.9 }) : null,
      cast.catHim ? movers.walkTo(cast.catHim, stage.seats.him.clone().addScaledVector(stage.toLane, -0.75).addScaledVector(stage.side, 0.5), { speed: 0.9, face: faceStage }) : null,
      cast.catHer ? movers.walkTo(cast.catHer, stage.seats.her.clone().addScaledVector(stage.toLane, -0.7).addScaledVector(stage.side, -0.4), { speed: 0.9, face: faceStage }) : null,
    ]);
    await Promise.all([movers.turnTo(cast.him, stage.benchHeading), cast.her ? movers.turnTo(cast.her, stage.benchHeading) : null]);
    for (const a of [cast.him, cast.her]) {
      if (!a?.pose) continue;
      a.pose.sit.style = 'chair';
      a.pose.sit.seatY = stage.seatHeight;
    }
    await ctx.clock.tween(1.4, (k) => {
      for (const a of [cast.him, cast.her]) if (a?.pose) a.pose.sit.w = k;
    });

    // ── the dragon breathes fire ──
    this.breath = fire.add({ pos: v(), dir: v(), rate: 0, speed: 9, spread: 0.09, size: 0.34, life: 0.75, smoke: 0.25, heat: 0.3, light: 1, lightPower: 9, on: false });
    const her = cast.her;
    if (play) await this.playKnit(ctx);
    else for (let i = 0; i < 3; i++) {
      this.shot = ['wide', 'hero', 'couple'][i];
      await wait(ctx, 1.6);
      await this.roar(ctx, 2.4);
      await wait(ctx, 1.4);
    }

    // ── she finishes the scarf ──
    if (!play && her) {
      this.mode = 'knit';
      this.shot = 'knit-insert';
      for (const n of her.needles ?? []) n.visible = true;
      this.strip = new KnitStrip(app.scene);
      this.strip.mesh.visible = true;
      this.strip.length = 0.35;
      this.knitting = true;
      await ctx.clock.tween(6, (k) => (this.strip.length = 0.35 + k * 0.75));
      this.shot = 'knit-front';
      this.roarLater = setTimeout(() => this.roar(ctx, 1.8), 1500); // the dragon keeps performing behind them
      await ctx.clock.tween(5, (k) => (this.strip.length = 1.1 + k * 0.4));
      this.knitting = false;
      for (const n of her.needles ?? []) n.visible = false;
      await wait(ctx, 0.8);
    }

    // ── the wrap ──
    this.mode = 'wrap';
    this.shot = 'wrap';
    await ctx.clock.tween(1.4, (k) => {
      for (const a of [cast.him, cast.her]) if (a?.pose) a.pose.sit.w = 1 - k;
    });
    // she steps round to stand facing him
    const front = cast.him.root.position.clone().addScaledVector(stage.toLane, -0.62);
    if (her) {
      this.strip.mesh.visible = false; // gathered up in her hands
      await movers.walkTo(her, front, { speed: 0.7, face: cast.him.root.position });
    }
    await movers.turnTo(cast.him, her ? her.root.position : stage.center);
    // both hands up to his neck
    const neck = () => cast.him.pose?.b.neck?.getWorldPosition(v()) ?? cast.him.root.position.clone().setY(1.5);
    const sideOf = () => new Vector3().crossVectors(cast.him.root.position.clone().sub(her.root.position).setY(0).normalize(), UP).normalize();
    if (her?.pose) {
      this.setReach(her, 'L', 1, () => neck().addScaledVector(sideOf(), 0.13).add(new Vector3(0, -0.04, 0)), 3);
      this.setReach(her, 'R', 1, () => neck().addScaledVector(sideOf(), -0.13).add(new Vector3(0, -0.04, 0)), 3);
    }
    await wait(ctx, 1.3);
    // the scarf settles round his neck
    this.wearing = true;
    const sc = cast.scarf;
    if (sc) {
      sc.root.visible = true;
      await ctx.clock.tween(1.2, (k) => (this.scarfGrow = 0.75 + 0.25 * k));
    }
    await wait(ctx, 0.6);
    if (her?.pose) {
      this.setReach(her, 'L', 0, null, 2);
      this.setReach(her, 'R', 0, null, 2);
    }
    // he touches the scarf, a moment between them
    if (cast.him.pose) this.setReach(cast.him, 'R', 0.8, () => neck().add(new Vector3(0, -0.12, 0)).addScaledVector(cast.him.root.getWorldDirection(v()), 0.12), 2.5);
    await wait(ctx, 2.2);
    if (cast.him.pose) this.setReach(cast.him, 'R', 0, null, 2);
    await wait(ctx, 2.0);
    letterbox(false);
    if (play) ctx.app.progress = { ...ctx.app.progress, dragon: true };
    await wait(ctx, 0.8);
  },

  /**
   * INTERACTIVE: sat beside her on the bench. She knits the scarf at chest
   * height while the dragon performs (a roar every few seconds); the player
   * looks around freely (drag the mouse / a finger). When the scarf is long
   * enough, [ Lean in · receive the scarf ] → she wraps it round his neck.
   */
  async playKnit(ctx) {
    const app = ctx.app;
    const her = app.cast.her;
    this.mode = 'knit';
    this.shot = 'look';
    this.lookYaw = 0;
    this.lookPitch = 0.12;
    const el = app.renderer.domElement;
    this.onDrag = (e) => {
      if (!(e.buttons & 1) && e.pointerType !== 'touch' && document.pointerLockElement !== el) return; // drag, a finger, or the free-roam pointer lock
      this.lookYaw -= e.movementX * 0.004;
      this.lookPitch = Math.max(-0.5, Math.min(0.75, this.lookPitch + e.movementY * 0.003));
    };
    el.addEventListener('pointermove', this.onDrag);
    prompt('<b>Drag</b> to look around');
    setTimeout(() => prompt(null), 4000);
    if (her) {
      for (const n of her.needles ?? []) n.visible = true;
      this.strip = new KnitStrip(app.scene);
      this.strip.mesh.visible = true;
      this.strip.length = 0.35;
      this.knitting = true;
    }
    let roaring = true;
    (async () => {
      await wait(ctx, 2.5);
      while (roaring) {
        await this.roar(ctx, 2.0);
        await wait(ctx, 4.5);
      }
    })();
    // the scarf grows as they watch
    const grow = ctx.clock.tween(14, (k) => this.strip && (this.strip.length = 0.35 + k * 1.15));
    await wait(ctx, 5);
    await actions([{ id: 'lean', label: 'Lean in · receive the scarf', primary: true }]);
    roaring = false;
    if (this.strip) this.strip.length = Math.max(this.strip.length, 1.2);
    void grow;
    el.removeEventListener('pointermove', this.onDrag);
    this.knitting = false;
    for (const n of her?.needles ?? []) n.visible = false;
    this.mode = 'perform';
    this.shot = 'couple';
    await wait(ctx, 0.6);
  },

  /** One fire-breath: a ramp up, a sustained roar, a fade — with shake and a gust. */
  async roar(ctx, seconds) {
    const b = this.breath;
    if (!b) return;
    b.on = true;
    b.rate = 420;
    this.app.wind.burst(1.0);
    this.app.fireworks.fountains(this.app.stage.fountains, 150); // the fountains roar with it
    await ctx.clock.tween(0.3, (k) => (b.intensity = k));
    this.shake = 1;
    await wait(ctx, seconds);
    await ctx.clock.tween(0.5, (k) => (b.intensity = 1 - k));
    b.on = false;
    if (this.mode !== 'done') this.app.fireworks.fountains(this.app.stage.fountains, 26);
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
    const { cast, rig, controller: ctl, stage } = app;
    if (!cast?.him || rig.free) return;
    // the braziers flare up as the couple come near
    if (!this.lit && cast.him.root.position.distanceTo(stage.center) < 26) {
      this.lit = true;
      ctx.clock.tween(2.5, (k) => stage.ignite(k));
      app.fireworks.fountains(stage.fountains, 26); // gold spark fountains along the stage's edge
    }
    // arms
    for (const r of this.reach.values()) {
      r.w += (r.want - r.w) * damp(r.rate, dt);
      const pose = r.actor.pose;
      if (!pose) continue;
      if (r.w > 0.02 || r.want > 0) {
        pose.reach[r.side].w = r.w;
        if (r.target) pose.reach[r.side].target.copy(r.target());
      } else pose.reach[r.side].w = 0;
    }
    // knitting hands: two small loops in front of her lap, out of phase
    const her = cast.her;
    if (this.knitting && her?.pose) {
      const p = her.pose;
      const fwd = her.root.getWorldDirection(v());
      const right = new Vector3().crossVectors(fwd, UP).normalize();
      const chest = p.b.chest?.getWorldPosition(v()) ?? her.root.position.clone().setY(0.9);
      // at chest height, just below her shoulders, held out in front of her (well clear of the dress)
      const base = chest.clone().add(new Vector3(0, 0.02, 0)).addScaledVector(fwd, 0.3);
      const tt = t * 5.2;
      p.reach.L.w = p.reach.R.w = 1;
      p.reach.L.target.copy(base).addScaledVector(right, -0.075).add(new Vector3(Math.sin(tt) * 0.012, Math.cos(tt) * 0.018, 0));
      p.reach.R.target.copy(base).addScaledVector(right, 0.075).add(new Vector3(0, Math.sin(tt + 1.6) * 0.02, Math.cos(tt + 1.6) * 0.015));
    }

    // ── camera ──
    const c = cast.coupleCenter(v());
    const want = v(), look = v();
    let rate = 1.1;
    const dragonHead = this.dragonHead ?? stage.center.clone().setY(4.5);
    if (this.mode === 'walk') {
      const u = laneU(cast.him.root.position.x, cast.him.root.position.z);
      const fwd = lanePoint(Math.min(1, u + 0.004)).sub(lanePoint(Math.max(0, u - 0.004))).setY(0).normalize();
      const side = laneSide(u);
      const toStage = cast.him.root.position.distanceTo(stage.center);
      if (toStage < 28) {
        // the pan to the stage: from behind them, the festival corner opening up ahead
        want.copy(c).addScaledVector(stage.toLane, 6.5).addScaledVector(stage.side, 2.2).setY(2.2);
        look.copy(stage.center).setY(3.0);
        rate = 0.9;
      } else {
        want.copy(c).addScaledVector(fwd, -5.5).addScaledVector(side, 1.4).setY(2.0);
        look.copy(c).addScaledVector(fwd, 8).setY(1.5);
      }
    } else {
      const bench = stage.benchPos;
      const shot = this.shot ?? 'wide';
      if (shot === 'wide') {
        // behind the bench: the couple silhouetted against the stage and its fire
        want.copy(bench).addScaledVector(stage.toLane, 2.4).addScaledVector(stage.side, -1.1).setY(1.9);
        look.copy(stage.center).setY(2.8);
      } else if (shot === 'hero') {
        // low by the stage edge, looking up at the dragon as it breathes
        want.copy(stage.center).addScaledVector(stage.toLane, 6.4).addScaledVector(stage.side, -0.4).setY(0.7); // between the two front braziers
        look.copy(dragonHead).lerp(stage.center.clone().setY(2), 0.3);
      } else if (shot === 'couple' || shot === 'knit-front' || shot === 'wrap') {
        // from in front of the bench, the firelight on their faces
        const back = shot === 'wrap' ? 2.6 : 3.0;
        want.copy(bench).addScaledVector(stage.toLane, -back).addScaledVector(stage.side, shot === 'wrap' ? 1.4 : 0.6).setY(shot === 'wrap' ? 1.6 : 1.25);
        look.copy(c).setY(shot === 'wrap' ? 1.45 : 0.95);
        rate = 1.3;
      } else if (shot === 'look') {
        // from his seat, just behind his head: wherever the player drags
        const head = cast.him.pose?.b.head?.getWorldPosition(v()) ?? cast.him.root.position.clone().setY(1.2);
        const base = Math.atan2(-stage.toLane.x, -stage.toLane.z) + (this.lookYaw ?? 0);
        const dir = new Vector3(Math.sin(base) * Math.cos(this.lookPitch), Math.sin(this.lookPitch), Math.cos(base) * Math.cos(this.lookPitch));
        want.copy(head).addScaledVector(dir, -0.75).add(new Vector3(0, 0.18, 0)).addScaledVector(stage.side, -0.25);
        look.copy(want).addScaledVector(dir, 6);
        rate = 6;
      } else if (shot === 'knit-insert') {
        // close on her hands and the growing scarf
        const hp = her?.pose ? her.pose.handPosition('R', v()) : c;
        const hf = her ? her.root.getWorldDirection(v()) : stage.toLane;
        want.copy(hp).addScaledVector(hf, 0.75).addScaledVector(stage.side, 0.35).add(new Vector3(0, 0.25, 0));
        look.copy(hp).add(new Vector3(0, -0.1, 0));
        rate = 2.0;
      }
    }
    const glide = new Set(['walk>perform']);
    const key = `${this.mode}:${this.shot}`;
    if (this.lastKey && this.lastKey !== key && !glide.has(`${this.lastKey.split(':')[0]}>${this.mode}`)) {
      rig.pos.copy(want);
      rig.look.copy(look);
    } else {
      rig.pos.lerp(want, damp(rate, dt));
      rig.look.lerp(look, damp(rate * 1.6, dt));
    }
    this.lastKey = key;
    // roar shake
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 0.7);
      const s = this.shake * 0.05;
      rig.pos.x += (Math.random() - 0.5) * s;
      rig.pos.y += (Math.random() - 0.5) * s;
    }
  },

  /** After posing: the fire follows the dragon's jaws; the strip and the worn scarf follow the bodies. */
  late(dt, t, ctx) {
    const app = ctx.app;
    const { cast, stage } = app;
    const d = cast?.dragon;
    if (d && this.breath) {
      const jaw = findBone(d, 'B_Jaw');
      const head = findBone(d, 'b_Head'), neck = findBone(d, 'b_Neck_0');
      if (jaw && head && neck) {
        const j = jaw.getWorldPosition(v());
        const dir = j.clone().sub(neck.getWorldPosition(v())).normalize();
        dir.y -= 1.1; // a jet down onto the front of the stage, where it spreads across the boards
        this.breath.pos.copy(j);
        this.breath.dir.copy(dir.normalize());
        this.dragonHead = head.getWorldPosition(v());
      }
    }
    // the knitted strip: from her hands, over her lap and knees
    const her = cast?.her;
    if (this.strip?.mesh.visible && her?.pose) {
      const p = her.pose;
      const start = p.handPosition('L', v()).lerp(p.handPosition('R', v()), 0.5).add(new Vector3(0, -0.03, 0));
      const fwd = her.root.getWorldDirection(v());
      // the finished part falls from her hands down over the TOP of her skirt (lap) and her knees
      const lap = p.sitHands.L.clone().lerp(p.sitHands.R, 0.5).add(new Vector3(0, 0.07, 0)).addScaledVector(fwd, 0.05);
      const knee = (p.b.shinL?.getWorldPosition(v()) ?? lap).lerp(p.b.shinR?.getWorldPosition(v()) ?? lap, 0.5).addScaledVector(fwd, 0.13).add(new Vector3(0, 0.08, 0));
      this.strip.update(start, lap, knee, new Vector3().crossVectors(fwd, UP));
    }
    // the finished scarf rides on his neck
    if (this.wearing) cast.followScarf(this.scarfGrow ?? 1);
  },

  exit(ctx) {
    const { cast } = ctx.app;
    this.mode = 'done';
    if (this.onDrag) ctx.app.renderer.domElement.removeEventListener('pointermove', this.onDrag);
    clearActions();
    ctx.app.fireworks.fountains(ctx.app.stage.fountains, 8); // embers of the show as they leave
    clearTimeout(this.roarLater);
    for (const a of [cast?.him, cast?.her]) {
      if (!a?.pose) continue;
      a.pose.reach.L.w = a.pose.reach.R.w = 0;
      a.pose.sit.w = 0;
    }
    for (const n of cast?.her?.needles ?? []) n.visible = false;
    this.strip?.dispose();
    this.strip = null;
    this.knitting = false;
    if (this.breath) {
      ctx.app.fire.remove(this.breath);
      this.breath = null;
    }
    this.reach = new Map();
    letterbox(false);
    // the scarf stays on him from here on: keep following his neck
    if (this.wearing && cast?.scarf) ctx.app.wornScarf = true;
  },
};

const boneCache = new WeakMap();
function findBone(actor, prefix) {
  let m = boneCache.get(actor);
  if (!m) boneCache.set(actor, (m = new Map()));
  if (!m.has(prefix)) {
    let found = null;
    actor.model.traverse((o) => {
      if (!found && o.isBone && o.name.startsWith(prefix)) found = o;
    });
    m.set(prefix, found);
  }
  return m.get(prefix);
}
