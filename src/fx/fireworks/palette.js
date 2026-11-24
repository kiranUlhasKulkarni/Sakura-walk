/** Linear-space firework star colours (intensity is applied separately). From the fireworks project, plus sakura tones. */
export const COLORS = {
  red: [1.0, 0.13, 0.07],
  orange: [1.0, 0.42, 0.1],
  gold: [1.0, 0.62, 0.24],
  yellow: [1.0, 0.86, 0.38],
  green: [0.25, 1.0, 0.38],
  teal: [0.15, 0.95, 0.8],
  blue: [0.25, 0.38, 1.0],
  violet: [0.55, 0.15, 1.0],
  magenta: [1.0, 0.1, 0.78],
  electric: [0.25, 0.7, 1.0],
  deepblue: [0.1, 0.18, 1.0],
  pink: [1.0, 0.24, 0.62],
  rose: [1.0, 0.45, 0.55],
  sakura: [1.0, 0.55, 0.72],
  silver: [0.82, 0.88, 1.0],
  white: [1.0, 0.96, 0.9],
};

/** The park's show: sakura pinks, golds, violets and silver, a little teal and blue. */
export const SHOW = ['sakura', 'gold', 'violet', 'pink', 'silver', 'magenta', 'gold', 'electric', 'rose', 'white', 'teal', 'sakura', 'red', 'blue'];
export const EMBER_GOLD = [1.0, 0.55, 0.2];
export const STROBE_WHITE = [1.0, 0.95, 0.85];

/** Warm residue colour: what a star leaves behind as it burns. */
export function warmOf(c) {
  return [0.55 * c[0] + 0.45 * EMBER_GOLD[0], 0.55 * c[1] + 0.45 * EMBER_GOLD[1], 0.55 * c[2] + 0.45 * EMBER_GOLD[2]];
}
