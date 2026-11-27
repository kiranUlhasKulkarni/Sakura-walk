import { STATIONS } from '../../world/lane.js';
import { prompt } from '../ui.js';

/**
 * INTERACTIVE MODE ("Walk it yourself") — free roam, stage by stage.
 *
 * The player walks him down the lane (WASD / arrows, Shift brisk, mouse look,
 * wheel zoom; touch drag on phones); she and the cats follow. Each stage
 * unlocks the next, and its station offers it with a prompt:
 *   1 catch clearing   E — play catch (30-second catch game: CatchGame)
 *   2 picnic lawn      E — sit down for the picnic (Act II, played: Eat / Feed Her)
 *   3 festival stage   E — sit with her by the dragon (Act III, played: Lean in for the scarf)
 *   4 the plaza        walking in hands over to the film: nightfall, the dance and her
 *                      proposal run on their own (Acts IV–V), only YES / NO is his.
 * The soundtrack is the same as the film's: Spring Snow loops until
 * nightfall, however long each stage takes.
 */
const STAGES = [
  { key: 'catch', act: 'catchgame', label: 'play catch', reach: 4 },
  { key: 'picnic', act: 'act2', label: 'sit down for the picnic', reach: 4.5 },
  { key: 'dragon', station: 'stage', act: 'act3', label: 'sit with her and watch the dragon', reach: 2 },
  { key: 'finale', station: 'plaza', act: 'act4', auto: true, reach: 1 },
];
const NAMES = { catch: 'the catch clearing', picnic: 'the picnic lawn', dragon: 'the dragon stage' };

export const FreeRoam = {
  name: 'free',
  hold: true,

  enter(ctx) {
    const app = ctx.app;
    this.app = app;
    this.spot = null;
    app.progress ??= {};
    app.controller?.takeOver();
    for (const f of app.followers) {
      f.reset();
      f.paused = false;
    }
    const hint = document.getElementById('hint');
    if (hint) {
      hint.classList.remove('hint--fade');
      hint.classList.add('hint--on');
      clearTimeout(this.hintT);
      this.hintT = setTimeout(() => hint.classList.add('hint--fade'), 9000);
    }
    this.onKey = (e) => {
      if (e.code !== 'KeyE' || e.repeat || !this.spot || this.spot.locked) return;
      const act = this.spot.act;
      prompt(null);
      ctx.app.timeline.goto(act);
    };
    addEventListener('keydown', this.onKey);
    // phones: tapping the prompt does the same
    this.onTap = () => this.spot && this.onKey({ code: 'KeyE' });
    document.getElementById('prompt')?.addEventListener('click', this.onTap);
  },

  /** The first stage not yet played. */
  next() {
    const p = this.app.progress ?? {};
    return STAGES.find((s) => !p[s.key]) ?? STAGES[STAGES.length - 1];
  },

  update(dt, t, ctx) {
    const app = ctx.app;
    const him = app.cast?.him;
    if (!him) return;
    const p = him.root.position;
    const next = this.next();
    let found = null;
    for (const s of STAGES) {
      const st = STATIONS[s.station ?? s.key];
      const c = s.key === 'dragon' ? app.stage.benchPos : st.center;
      const r = (s.key === 'dragon' ? 5 : st.radius) + s.reach;
      if (Math.hypot(p.x - c.x, p.z - c.z) < r) found = { ...s, locked: s !== next };
    }
    // the finale: walking into the plaza after the scarf hands over to the film
    if (found && !found.locked && found.auto) {
      prompt(null);
      app.timeline.goto(found.act);
      return;
    }
    const key = found ? `${found.key}:${found.locked}` : null;
    if (key !== this.spotKey) {
      this.spotKey = key;
      this.spot = found;
      if (!found) prompt(null);
      else if (found.locked) prompt(next.key === 'finale' ? 'On to the plaza…' : `Not yet — first, ${NAMES[next.key]}`);
      else prompt(`<b>E</b> ${found.label}`);
    }
  },

  exit(ctx) {
    removeEventListener('keydown', this.onKey);
    document.getElementById('prompt')?.removeEventListener('click', this.onTap);
    clearTimeout(this.hintT);
    document.getElementById('hint')?.classList.add('hint--fade');
    prompt(null);
    this.spotKey = null;
    if (ctx.app.controller) ctx.app.controller.enabled = false;
  },
};
