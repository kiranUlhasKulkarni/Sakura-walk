import { Vector3 } from 'three';
import { lanePoint, STATIONS } from '../world/lane.js';
import { walkHeight } from '../world/terrain.js';

/**
 * The chapters the end screen offers ("Pick a chapter"), and how each one's
 * world is prepared when the page loads with ?chapter=<id> — where everyone
 * stands, the time of day, whether he already wears the scarf, which stage of
 * the soundtrack plays. Jumping always goes through a fresh page load, so no
 * state from an earlier chapter can leak into the one you pick; this sets up
 * only what that chapter would have inherited from the ones before it.
 */
export const CHAPTERS = [
  { id: 'stroll', act: 'act1', title: 'A Stroll Beneath the Blossoms', sub: 'the walk & the cats' },
  { id: 'catch', act: 'act1', jump: 'catch', title: 'Catch', sub: 'the glowing ball' },
  { id: 'picnic', act: 'act2', title: 'A Picnic Under the Blossoms', sub: 'sushi & bento' },
  { id: 'dragon', act: 'act3', title: 'Fire and Thread', sub: 'the dragon & the scarf' },
  { id: 'hanabi', act: 'act4', title: 'Hanabi', sub: 'nightfall & the fireworks' },
  { id: 'dance', act: 'act4', jump: 'dance', title: 'The Dance', sub: 'eleven girls & the two of them' },
  { id: 'question', act: 'act5', title: 'The Question', sub: 'will you marry me?' },
];

export const chapterById = (id) => CHAPTERS.find((c) => c.id === id) ?? null;

/** Call inside the start click (the soundtrack stage may need to change). */
export function prepareChapter(app, ch) {
  const { cast, controller: ctl, timeline } = app;
  if (!cast?.him) return;
  const place = (a, p, look) => {
    if (!a) return;
    a.root.position.set(p.x, walkHeight(p.x, p.z), p.z);
    if (look) a.root.rotation.y = Math.atan2(look.x - p.x, look.z - p.z);
  };
  timeline.ctx.jump = ch.jump ?? null;
  timeline.ctx.interactive = false; // chapters replay the film
  const sideways = (u) => {
    const a = lanePoint(u + 0.004), b = lanePoint(u - 0.004);
    return a.sub(b).setY(0).normalize();
  };
  if (ch.act === 'act2') {
    // they finished catch in the clearing
    const st = STATIONS.catch, T = sideways(st.u);
    place(cast.him, st.center.clone().addScaledVector(T, 2.3), st.center);
    place(cast.her, st.center.clone().addScaledVector(T, -2.3), st.center);
    place(cast.catHim, st.center.clone().addScaledVector(T, 1.6).add(new Vector3(0.6, 0, 0.6)), st.center);
    place(cast.catHer, st.center.clone().addScaledVector(T, -1.6).add(new Vector3(-0.6, 0, 0.6)), st.center);
  } else if (ch.act === 'act3') {
    // they've just stood up from the picnic
    const pc = STATIONS.picnic, out = lanePoint(pc.u).sub(pc.center).setY(0).normalize();
    place(cast.him, pc.center.clone().addScaledVector(out, 2.2), lanePoint(pc.u + 0.02));
    place(cast.her, pc.center.clone().addScaledVector(out, 2.0).add(new Vector3(0.7, 0, 0.3)), lanePoint(pc.u + 0.02));
    place(cast.catHim, pc.center.clone().addScaledVector(out, 1.6).add(new Vector3(-0.6, 0, 0)), null);
    place(cast.catHer, pc.center.clone().addScaledVector(out, 1.6).add(new Vector3(1.2, 0, 0)), null);
  } else if (ch.act === 'act4' || ch.act === 'act5') {
    // after the dragon: he wears the scarf she knitted, the evening has fallen
    app.wornScarf = true;
    cast.followScarf();
    app.setNight(ch.act === 'act5' || ch.jump === 'dance' ? 1 : 0.86);
  }
  if (ch.act === 'act5') {
    // the question follows the dance: in the plaza, at night, "Marry You", the show still going
    const C = STATIONS.plaza.center;
    place(cast.him, C.clone().add(new Vector3(-0.45, 0, 0.2)), C.clone().add(new Vector3(0.45, 0, 0.2)));
    place(cast.her, C.clone().add(new Vector3(0.45, 0, 0.2)), C.clone().add(new Vector3(-0.45, 0, 0.2)));
    place(cast.catHim, C.clone().add(new Vector3(-1.4, 0, 1.4)), C);
    place(cast.catHer, C.clone().add(new Vector3(1.4, 0, 1.4)), C);
    cast.dancers.forEach((d, i) => {
      const a = (i / cast.dancers.length) * Math.PI * 2;
      place(d, C.clone().add(new Vector3(Math.sin(a), 0, Math.cos(a)).multiplyScalar(4)), C);
      d.pose.want = 0.5;
    });
    app.music.toPhase2();
    app.fireworks.auto(0.5);
  }
  if (ctl) {
    ctl.pos.copy(cast.him.root.position);
    ctl.heading = cast.him.root.rotation.y;
  }
  for (const f of app.followers) f.reset();
  // the camera starts on them (not back at the park gate's opening shot, gliding through the trees)
  if (ch.act !== 'act1' || ch.jump) {
    const p = cast.him.root.position, fwd = cast.him.root.getWorldDirection(new Vector3()).setY(0).normalize();
    app.rig.cut(p.clone().addScaledVector(fwd, -4.5).add(new Vector3(0.8, 1.9, 0)), p.clone().addScaledVector(fwd, 6).setY(1.4));
  }
}
