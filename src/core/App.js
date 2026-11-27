import { ACESFilmicToneMapping, PCFSoftShadowMap, PerspectiveCamera, PMREMGenerator, Scene, SRGBColorSpace, Timer, Vector3, WebGLRenderer } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CAMERA, FOLLOW, RENDER, SKY } from '../config.js';
import { MusicDirector } from '../audio/MusicDirector.js';
import { Petals } from '../fx/Petals.js';
import { PetalVortex } from '../fx/PetalVortex.js';
import { Post } from '../fx/Post.js';
import { Wind } from '../fx/Wind.js';
import { Cast } from '../story/Cast.js';
import { CharacterLook } from '../story/CharacterLook.js';
import { CatGait } from '../player/CatGait.js';
import { Controller } from '../player/Controller.js';
import { Follower } from '../player/Follower.js';
import { CatchBall } from '../fx/CatchBall.js';
import { Fire } from '../fx/Fire.js';
import { Fireworks } from '../fx/fireworks/Fireworks.js';
import { Stage } from '../world/Stage.js';
import { Movers } from '../story/Mover.js';
import { Timeline } from '../story/Timeline.js';
import { easeInOutSine } from '../utils/math.js';
import { CherryTrees } from '../world/CherryTrees.js';
import { BridgeScene } from '../world/Bridge.js';
import { Ground } from '../world/Ground.js';
import { Lanterns } from '../world/Lanterns.js';
import { Lighting } from '../world/Lighting.js';
import { Sky } from '../world/Sky.js';
import { lanePoint } from '../world/lane.js';
import { AssetLibrary } from './AssetLibrary.js';
import { CameraRig } from './CameraRig.js';
import { parkUniforms } from './uniforms.js';

/** Tiny scheduler on the render clock: `after(seconds, fn)`, `tween(seconds, fn(k))`. */
class StoryClock {
  constructor() {
    this.jobs = [];
  }
  after(s, fn) {
    this.jobs.push({ left: s, fn });
  }
  tween(s, fn, ease = easeInOutSine) {
    return new Promise((resolve) => this.jobs.push({ t: 0, s, fn, ease, resolve }));
  }
  update(dt) {
    for (let i = this.jobs.length - 1; i >= 0; i--) {
      const j = this.jobs[i];
      if (j.s !== undefined) {
        j.t += dt;
        const k = Math.min(1, j.t / j.s);
        j.fn(j.ease(k));
        if (k >= 1) {
          this.jobs.splice(i, 1);
          j.resolve();
        }
      } else if ((j.left -= dt) <= 0) {
        this.jobs.splice(i, 1);
        j.fn();
      }
    }
  }
  clear() {
    this.jobs.length = 0;
  }
}

/**
 * Owns the renderer, the park, the cast, music and the story timeline, and
 * runs the frame loop (with adaptive resolution like infinity-castle). Every
 * subsystem exposes dispose(); App.dispose() tears the whole thing down.
 */
export class App {
  constructor(container, { debug = false } = {}) {
    this.debug = debug;
    const renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = RENDER.exposure;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    this.pixelRatio = Math.min(RENDER.maxPixelRatio, devicePixelRatio || 1);
    renderer.setPixelRatio(this.pixelRatio);
    renderer.setSize(innerWidth, innerHeight);
    renderer.domElement.className = 'scene';
    container.appendChild(renderer.domElement);
    this.renderer = renderer;
    // a lost WebGL context (Safari / mobile GPUs under memory pressure, a backgrounded tab):
    // stop drawing, say so, and reload once the browser hands the context back (or on a tap)
    renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      cancelAnimationFrame(this.raf);
      this.contextLost = true;
      const note = document.createElement('button');
      note.className = 'context-lost';
      note.type = 'button';
      note.textContent = 'The scene paused — tap to resume';
      note.addEventListener('click', () => location.reload());
      document.body.appendChild(note);
    });
    renderer.domElement.addEventListener('webglcontextrestored', () => location.reload());

    this.scene = new Scene();
    this.camera = new PerspectiveCamera(CAMERA.fov, innerWidth / innerHeight, CAMERA.near, CAMERA.far);
    this.rig = new CameraRig(this.camera, renderer.domElement, { debug });

    // ── the park (procedural; ready before the models finish downloading) ──
    this.lighting = new Lighting(this.scene, renderer);
    this.sky = new Sky(this.scene);
    this.ground = new Ground(this.scene);
    this.bridge = new BridgeScene(this.scene);
    this.trees = new CherryTrees(this.scene);
    this.lanterns = new Lanterns(this.scene, this.trees);
    this.lighting.focus.copy(lanePoint(0));
    this.lighting.setAnchors(this.lanterns.anchors);
    // a soft studio environment for the characters' PBR ambient / sheen (not the park: it has its own light)
    const pmrem = new PMREMGenerator(renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.wind = new Wind();
    this.petals = new Petals(this.scene);
    this.ball = new CatchBall(this.scene); // Act I's glowing ball (hidden; its light compiles with everything else)
    this.fire = new Fire(this.scene, { lights: 4 }); // braziers, dragon breath, torches ×2 (lights pre-compiled, dark until lit)
    this.stage = new Stage(this.scene, this.fire);
    this.fireworks = new Fireworks(this.scene);
    this.vortex = new PetalVortex(this.scene); // the YES climax (amount 0 until then; compiled with everything) // Act IV's show (its sky light exists from the start: no recompiles)
    this.movers = new Movers();
    this.post = new Post(renderer, this.scene, this.camera);
    this.music = new MusicDirector();
    this.assets = new AssetLibrary();
    this.cast = null;
    this.controller = null;
    this.followers = [];
    this.gaits = [];

    this.night = SKY.startNight;
    this.lighting.setNight(this.night);
    this.clock = new StoryClock();
    this.timeline = new Timeline({ app: this, clock: this.clock, bag: [] });

    this.time = 0;
    this.focus = new Vector3();
    this._clock = new Timer();
    this._clock.connect?.(document);
    this.perf = { t: 0, frames: 0, good: 0 };
    this.onResize = () => this.resize();
    addEventListener('resize', this.onResize);
    this.resize();

    // opening frame behind the gate: high over the park gate, looking down the lane
    const g = lanePoint(0), g2 = lanePoint(0.08);
    this.rig.cut(g.clone().add(new Vector3(10, 10, 14)), g2.clone().setY(2));
    this.frame = this.frame.bind(this);
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Download + stage the cast, then pre-compile every shader behind the gate. */
  async load(onProgress) {
    const gltf = await this.assets.loadAll(onProgress);
    this.cast = new Cast(this.scene, gltf);
    this.look = new CharacterLook(this.lighting, this.envMap);
    this.cast.calibrate(this.look);
    // third-person exploration: he leads, she and the cats follow (enabled by the Explore act)
    const c = this.cast;
    if (c.him) {
      this.controller = new Controller(this.camera, this.renderer.domElement, c.him, this.trees);
      const L = this.controller.state;
      this.follow = {};
      if (c.her) this.followers.push((this.follow.her = new Follower(c.her, L, FOLLOW.her)));
      if (c.catHim) this.followers.push((this.follow.catHim = new Follower(c.catHim, L, { ...FOLLOW.catHim, maxSpeed: 5 })));
      // her cat follows her
      const herLead = { position: c.her?.root.position, get heading() { return c.her.root.rotation.y; }, get speed() { return c.her.speed; } };
      if (c.catHer && c.her) this.followers.push((this.follow.catHer = new Follower(c.catHer, herLead, { ...FOLLOW.catHer, distance: 1.1, maxSpeed: 5 })));
      for (const f of this.followers) f.paused = true; // until a stroll begins (Act I / Explore)
    }
    for (const cat of [c.catHim, c.catHer]) if (cat) this.gaits.push(new CatGait(cat));
    this.music.init(); // create the (silent) players early so they buffer
    await this.renderer.compileAsync(this.scene, this.camera);
    return this.cast;
  }

  setNight(k) {
    this.night = k;
    this.lighting.setNight(k);
  }

  /**
   * Act IV hook: the sky falls to deep night "instantly" (a fast eased sweep)
   * and, at that same moment, Spring Snow hands over to Bruno Mars.
   */
  nightfall(seconds = 1.6) {
    this.music.toPhase2();
    const from = this.night;
    return this.clock.tween(seconds, (k) => this.setNight(from + (1 - from) * k));
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    // portrait: widen the vertical FOV so the couple still fits side by side
    const minH = (58 * Math.PI) / 180;
    const vForH = (2 * Math.atan(Math.tan(minH / 2) / this.camera.aspect) * 180) / Math.PI;
    this.camera.fov = Math.min(80, Math.max(CAMERA.fov, vForH));
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h);
    this.post.setSize(w, h, this.pixelRatio);
    parkUniforms.uPixelRatio.value = this.pixelRatio;
  }

  adapt(dt, rawDt) {
    const p = this.perf;
    if (document.hidden || rawDt > 0.2) {
      p.t = p.frames = 0;
      return;
    }
    p.t += dt;
    p.frames++;
    if (p.t < 1.5) return;
    const fps = p.frames / p.t;
    p.t = p.frames = 0;
    if (fps < 50 && this.pixelRatio > RENDER.minPixelRatio) {
      this.pixelRatio = Math.max(RENDER.minPixelRatio, this.pixelRatio - 0.25);
      p.good = 0;
      this.resize();
    } else if (fps > 58 && ++p.good > 4 && this.pixelRatio < Math.min(RENDER.maxPixelRatio, devicePixelRatio || 1)) {
      this.pixelRatio = Math.min(RENDER.maxPixelRatio, this.pixelRatio + 0.25);
      p.good = 0;
      this.resize();
    }
  }

  frame() {
    if (this.contextLost) return;
    this.raf = requestAnimationFrame(this.frame);
    this._clock.update();
    const rawDt = this._clock.getDelta();
    this.step(Math.min(rawDt, 1 / 20), rawDt);
  }

  step(dt, rawDt = dt) {
    this.time += dt;
    parkUniforms.uTime.value = this.time;
    this.clock.update(dt);
    this.timeline.update(dt);
    this.wind.update(dt);
    // he moves under the user's control (explore) or a script's (autopilot); she and the cats follow
    const ctl = this.controller;
    if (ctl && (ctl.enabled || ctl.autopilot)) ctl.update(dt);
    if (ctl) for (const f of this.followers) f.update(dt);
    this.movers.update(dt);
    if (!ctl?.enabled) this.rig.update(dt);
    this.cast?.update(dt);
    for (const g of this.gaits) g.update(dt);
    this.timeline.lateUpdate(dt);
    if (this.wornScarf && this.timeline.current?.name !== 'act3') this.cast?.followScarf();
    this.ball.update(dt, this.time, this.pixelRatio);
    this.fire.update(dt, this.camera, this.renderer.domElement.height);
    this.stage.update(this.time);
    const fl = this.fireworks.update(dt, this.time, this.camera, this.renderer.domElement.width, this.renderer.domElement.height, this.scene.fog?.density);
    // the bursts colour the characters' rims and lift the whole frame a touch
    this.lighting.characterLook.flash.copy(fl.color).multiplyScalar(fl.level * 0.5);
    this.post.u.uFlash.value = Math.max(this.flashHold ?? 0, fl.level * 0.018);
    if (this.vortex.uniforms.uAmount.value > 0) this.vortex.uniforms.uFlash.value.set(fl.color.r, fl.color.g, fl.color.b).multiplyScalar(fl.level * 0.6);
    if (this.cast) this.lighting.focus.copy(this.cast.coupleCenter(this.focus).setY(0));
    this.lighting.update(dt, this.time, this.camera);
    this.look?.update();
    this.sky.update(this.camera);
    this.trees.update(this.camera);
    this.petals.update(this.rig.focus(this.focus, 14), this.wind.drift);
    this.post.render(dt, this.time, this.night);
    this.adapt(dt, rawDt);
    this.stats?.update();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    removeEventListener('resize', this.onResize);
    this.timeline.exitCurrent();
    this.clock.clear();
    for (const s of [this.controller, this.cast, this.look, this.ball, this.fire, this.fireworks, this.vortex, this.stage, this.petals, this.lanterns, this.trees, this.bridge, this.ground, this.sky, this.lighting, this.post, this.music, this.rig]) s?.dispose();
    this.envMap.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

