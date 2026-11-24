import './styles.css';
import { App } from './core/App.js';
import { isTouch, Joystick } from './ui/Joystick.js';
import { ActI } from './story/acts/ActI.js';
import { ActII } from './story/acts/ActII.js';
import { ActIII } from './story/acts/ActIII.js';
import { ActIV } from './story/acts/ActIV.js';
import { ActV } from './story/acts/ActV.js';
import { CatchGame } from './story/acts/CatchGame.js';
import { Explore } from './story/acts/Explore.js';
import { FreeRoam } from './story/acts/FreeRoam.js';
import { Prelude } from './story/acts/Prelude.js';
import { laneU, STATIONS } from './world/lane.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');

const app = new App(document.getElementById('app'), { debug: DEBUG });
// the film, in order — plus the interactive mode's free roam and catch game (reached by goto)
app.timeline.add(Prelude).add(ActI).add(ActII).add(ActIII).add(ActIV).add(ActV).add(Explore).add(FreeRoam).add(CatchGame);
// phones / tablets: a thumbstick while the player has control (free roam, the catch game)
const stick = isTouch() ? new Joystick() : null;
app.timeline.onChange = (name) => {
  document.body.dataset.act = name;
  stick?.show(name === 'free' || name === 'catchgame');
};

/* ───────────── gate: loading → click to begin (the click also unlocks audio) ───────────── */
const gate = document.getElementById('gate');
const bar = document.getElementById('gate-bar');
const prompt = document.getElementById('gate-prompt');
let entered = false;

// the gate opens once the models are staged AND the music players are buffered
// (or have given up after a few seconds — the show never waits on YouTube forever)
Promise.all([app.load((p) => (bar.style.transform = `scaleX(${(p * 0.95).toFixed(3)})`)), app.music.ready(9000)])
  .then(() => {
    bar.style.transform = 'scaleX(1)';
    gate.classList.add('gate--ready');
    prompt.textContent = 'Click to begin';
  })
  .catch((err) => {
    console.error('[cherry] load failed', err);
    gate.classList.add('gate--ready');
    prompt.textContent = 'Some models failed to load — click to begin anyway';
  });

/**
 * Two ways in:
 *   cinematic    — the directed film: Prelude → Act I … (hands off)
 *   interactive  — the player walks him (WASD / mouse look), plays catch at the
 *                  clearing and starts each scene at its station (FreeRoam)
 */
const MODE_LABEL = { cinematic: 'Cinematic · take control', interactive: 'Interactive · watch the film' };
const modeBtn = document.getElementById('mode');
function setModeLabel() {
  modeBtn.textContent = MODE_LABEL[app.timeline.ctx.interactive ? 'interactive' : 'cinematic'];
}
function enter(mode = 'cinematic') {
  if (entered || !gate.classList.contains('gate--ready')) return;
  entered = true;
  app.music.startPhase1(); // synchronously inside the gesture (autoplay policy); also primes phase 2
  gate.classList.add('gate--leaving');
  document.body.classList.add('entered');
  setTimeout(() => gate.remove(), 2200);
  app.timeline.ctx.interactive = mode === 'interactive';
  setModeLabel();
  const jump = params.get('act'); // ?act=act1 jumps straight to an act
  if (mode === 'interactive') app.timeline.goto(jump || 'free');
  else app.timeline.start(jump || undefined);
}
for (const b of gate.querySelectorAll('[data-mode]')) b.addEventListener('click', () => enter(b.dataset.mode));
addEventListener('keydown', (e) => {
  if (!entered && (e.code === 'Enter' || e.code === 'Space')) enter('cinematic');
});
// switch at any time: take control now, or hand back to the film from the next scene ahead
modeBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const tl = app.timeline;
  if (!tl.ctx.interactive) {
    tl.ctx.interactive = true;
    tl.goto('free');
  } else {
    tl.ctx.interactive = false;
    if (tl.current?.name === 'free' || tl.current?.name === 'catchgame') {
      const p = app.cast?.him?.root.position;
      const u = p ? laneU(p.x, p.z) : 0;
      tl.goto(u < STATIONS.catch.u - 0.02 ? 'act1' : u < STATIONS.picnic.u - 0.02 ? 'act2' : u < STATIONS.stage.u - 0.02 ? 'act3' : 'act4');
    }
  }
  setModeLabel();
  modeBtn.blur();
});
// any later gesture re-kicks music that a strict browser refused to start
// (touchend / click too: iOS Safari only grants media playback on those, not on pointerdown)
for (const ev of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) addEventListener(ev, () => entered && app.music.nudge(), { passive: true });

/* ───────────── minimal music indicator (click = mute), hidden while idle ───────────── */
const mute = document.getElementById('mute');
mute.addEventListener('click', (e) => {
  e.stopPropagation();
  const m = !app.music.muted;
  app.music.setMuted(m);
  mute.setAttribute('aria-pressed', String(m));
  mute.classList.toggle('mute--off', m);
});
let idleT = 0;
const wake = () => {
  document.body.classList.remove('idle');
  clearTimeout(idleT);
  idleT = setTimeout(() => document.body.classList.add('idle'), 2500);
};
addEventListener('mousemove', wake, { passive: true });
addEventListener('touchstart', wake, { passive: true });
wake();

/* ───────────── debug: ?debug (console handle, O free camera, N nightfall), ?gui panel, ?stats ───────────── */
if (params.has('stats')) {
  import('three/examples/jsm/libs/stats.module.js').then(({ default: Stats }) => {
    app.stats = new Stats();
    document.body.appendChild(app.stats.dom);
  });
}
if (DEBUG) {
  window.__cherry = app;
  // test harness (?debug): drive the frame loop by hand — the Browser pane is often a hidden,
  // rAF-throttled page. __boot(mode) passes the gate and stubs the loop; run(s) steps s seconds
  // (yielding between frames so the acts' awaits resume); until(shot) runs until an act's shot.
  window.__boot = async (mode = 'cinematic') => {
    await new Promise((r) => {
      const t = setInterval(() => gate.classList.contains('gate--ready') && (clearInterval(t), r()), 100);
    });
    app._step = app.step.bind(app);
    app.step = () => {};
    enter(mode);
    document.getElementById('gate')?.remove();
    const V = app.camera.position.constructor;
    window.run = async (s) => {
      for (let i = 0, n = Math.round(s * 30); i < n; i++) {
        app._step(1 / 30);
        await new Promise((r) => setTimeout(r, 0));
      }
      return `${app.timeline.current?.name} ${app.timeline.current?.shot ?? app.timeline.current?.mode ?? ''} t=${app.timeline.t.toFixed(1)}`;
    };
    window.until = async (shot, max = 90) => {
      let o;
      for (let i = 0; i < max * 2 && (app.timeline.current?.shot ?? app.timeline.current?.mode) !== shot; i++) o = await run(0.5);
      return o;
    };
    window.view = async (p, l) => {
      app.rig.cut(new V(...p), new V(...l));
      app._step(1 / 30);
      app._step(1 / 30);
      await new Promise((r) => setTimeout(r, 250));
    };
    return 'booted';
  };
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyN') app.nightfall();
  });
}
if (params.has('gui')) {
  import('three/examples/jsm/libs/lil-gui.module.min.js').then(({ GUI }) => {
    const gui = new GUI({ title: 'Cherry · debug' });
    const s = { night: app.night, petals: 1, gust: () => app.wind.burst(1.2), nightfall: () => app.nightfall() };
    gui.add(s, 'night', 0, 1, 0.01).onChange((v) => app.setNight(v)).listen();
    gui.add(s, 'petals', 0, 1, 0.01).onChange((v) => (app.petals.density = v));
    gui.add(s, 'gust').name('gust of wind');
    gui.add(s, 'nightfall').name('nightfall → Bruno Mars');
    setInterval(() => (s.night = app.night), 250);
  });
}
