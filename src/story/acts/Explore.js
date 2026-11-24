/**
 * Explore — the user takes the lead: WASD walks him down the lane (Shift for
 * a brisk walk), the mouse looks around, the wheel zooms. She follows at his
 * shoulder, the cats trot along. (The scripted acts will take the camera back
 * at their stations; for now exploration holds.)
 */
export const Explore = {
  name: 'explore',
  hold: true,
  enter(ctx) {
    const app = ctx.app;
    app.controller?.takeOver();
    for (const f of app.followers) {
      f.reset();
      f.paused = false;
    }
    const hint = document.getElementById('hint');
    if (hint) {
      hint.classList.add('hint--on');
      setTimeout(() => hint.classList.add('hint--fade'), 9000);
    }
  },
  exit(ctx) {
    if (ctx.app.controller) ctx.app.controller.enabled = false;
  },
};
