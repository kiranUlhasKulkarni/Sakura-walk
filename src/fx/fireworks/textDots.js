/**
 * Dots for writing words in the sky: each letter is drawn on a canvas, and
 * its filled pixels are sampled on a jittered grid. Returns, per letter, its
 * dots in "cap-height units" (cap height = 1, y up) around the word's centre,
 * plus the letter's own centre (where its shell bursts).
 */
export function textDots(text, { font = '800 220px "Avenir Next", "Trebuchet MS", "Helvetica Neue", Arial, sans-serif', step = 11, tracking = 0.18 } = {}) {
  const px = 220;
  const cv = document.createElement('canvas');
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.font = font;
  const cap = px * 0.72; // approximate cap height of a bold sans
  const widths = [...text].map((ch) => g.measureText(ch).width);
  const gap = px * tracking;
  const total = widths.reduce((s, w) => s + w, 0) + gap * (text.length - 1);
  cv.width = Math.ceil(total + 40);
  cv.height = Math.ceil(px * 1.2);
  const base = cv.height * 0.85;
  let x = 20;
  const letters = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], w = widths[i];
    if (ch.trim()) {
      g.clearRect(0, 0, cv.width, cv.height);
      g.font = font;
      g.fillStyle = '#fff';
      g.fillText(ch, x, base);
      const x0 = Math.floor(x - 4), x1 = Math.ceil(x + w + 4);
      const data = g.getImageData(x0, 0, x1 - x0, cv.height).data, W = x1 - x0;
      const pts = [];
      for (let yy = 0; yy < cv.height; yy += step)
        for (let xx = 0; xx < W; xx += step) {
          const sx = Math.min(W - 1, Math.round(xx + (rnd() - 0.5) * step * 0.6));
          const sy = Math.min(cv.height - 1, Math.round(yy + (rnd() - 0.5) * step * 0.6));
          if (data[(sy * W + sx) * 4 + 3] > 140) pts.push([(x0 + sx - (total / 2 + 20)) / cap, (base - sy) / cap - 0.5]);
        }
      letters.push({ char: ch, points: pts, center: [(x + w / 2 - (total / 2 + 20)) / cap, 0] });
    }
    x += w + gap;
  }
  return { letters, width: total / cap };
}
