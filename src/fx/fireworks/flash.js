import { Color, Vector3 } from 'three';

/**
 * Every burst registers a short-lived "flash" (from the fireworks project).
 * The strongest one each frame lights the park: a coloured directional light
 * from the sky, the characters' rim (CharacterLook flash) and the smoke.
 */
export const MAX_FLASHES = 4;
const DECAY = 3.2;

export class Flashes {
  constructor() {
    this.slots = Array.from({ length: MAX_FLASHES }, () => ({ pos: new Vector3(), color: new Color(), t0: -1e9, power: 0 }));
    this.uniforms = {
      uFlashPos: { value: Array.from({ length: MAX_FLASHES }, () => new Vector3(0, -1e4, 0)) },
      uFlashColor: { value: Array.from({ length: MAX_FLASHES }, () => new Vector3()) },
      uFlashRadius: { value: 90 },
    };
    this.strongest = { pos: new Vector3(), color: new Color(), level: 0 };
    this.sum = new Color();
  }

  level(s, time) {
    const age = time - s.t0;
    if (age < 0) return 0;
    return s.power * Math.min(1, age / 0.05) * Math.exp(-age * DECAY);
  }

  add(pos, rgb, power, time) {
    let best = this.slots[0], low = Infinity;
    for (const s of this.slots) {
      const l = this.level(s, time);
      if (l < low) {
        low = l;
        best = s;
      }
    }
    best.pos.set(pos[0], pos[1], pos[2]);
    best.color.setRGB(rgb[0], rgb[1], rgb[2]);
    best.t0 = time;
    best.power = power;
  }

  update(time) {
    const st = this.strongest;
    st.level = 0;
    this.sum.setRGB(0, 0, 0);
    this.slots.forEach((s, i) => {
      const l = this.level(s, time);
      this.uniforms.uFlashPos.value[i].copy(s.pos);
      this.uniforms.uFlashColor.value[i].set(s.color.r, s.color.g, s.color.b).multiplyScalar(l * 2.6);
      this.sum.r += s.color.r * l;
      this.sum.g += s.color.g * l;
      this.sum.b += s.color.b * l;
      if (l > st.level) {
        st.level = l;
        st.pos.copy(s.pos);
        st.color.copy(s.color);
      }
    });
    return st;
  }
}
