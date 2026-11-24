import { Color, DirectionalLight, FogExp2, HemisphereLight, PointLight, Vector3 } from 'three';
import { LANTERNS, RENDER, SKY } from '../config.js';
import { MAX_LAMPS, parkUniforms } from '../core/uniforms.js';
import { lerp, smoothstep } from '../utils/math.js';

/** Key colours at dusk (night = 0) and deep night (night = 1). */
const DUSK = {
  hemiSky: new Color(0xc9a8c8), // soft lilac-rose sky-light (painterly, low-contrast twilight)
  hemiGround: new Color(0x4a3a40),
  hemiIntensity: 2.0,
  key: new Color(1.0, 0.78, 0.74), // the sun's afterglow: pale peach-pink, gentle
  keyIntensity: 0.85,
  fog: new Color(0xb9a2bf), // lavender mist (distant trees fade into it, as in the painting)
  ambient: new Color(0.42, 0.34, 0.48),
  exposure: 1.0,
  fill: new Color(1.0, 0.72, 0.6),
  fillIntensity: 1.5,
  rim: new Color(1.0, 0.62, 0.55), // sunset rim on the characters' silhouettes
  env: 0.55,
};
const NIGHT = {
  hemiSky: new Color(0x2a3868),
  hemiGround: new Color(0x0a080e),
  hemiIntensity: 0.7,
  key: new Color(0.55, 0.66, 1.0), // moonlight
  keyIntensity: 0.6,
  fog: new Color(0x0b0d1c),
  ambient: new Color(0.06, 0.08, 0.16),
  exposure: 1.15,
  fill: new Color(1.0, 0.66, 0.42), // lantern-warm
  fillIntensity: 2.2,
  rim: new Color(0.55, 0.7, 1.0), // moonlit rim
  env: 0.28,
};

/**
 * Scene lighting for the PBR characters + park:
 *  • a hemisphere sky light,
 *  • one shadow-casting key light — the setting sun at dusk, the moon at
 *    night — whose shadow frustum follows the couple down the lane,
 *  • MAX_LAMPS real point lights that hop between lantern strings: the ones
 *    nearest the couple are kept lit, and a light only moves after fading out
 *    (fixed count → no shader recompiles, and no popping),
 *  • a soft "hero fill" that rides beside the camera so faces always read
 *    (the trick infinity-castle uses for Tanjiro),
 *  • exp² fog matched to the horizon colour.
 * `night` (0..1) lerps all of it and mirrors into parkUniforms for the
 * shaders; `characterLook` (rim colour, env intensity) follows along.
 */
export class Lighting {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.hemi = new HemisphereLight(DUSK.hemiSky, DUSK.hemiGround, DUSK.hemiIntensity);
    scene.add(this.hemi);

    const key = new DirectionalLight(DUSK.key, DUSK.keyIntensity);
    key.castShadow = true;
    key.shadow.mapSize.set(RENDER.shadowMapSize, RENDER.shadowMapSize);
    const s = key.shadow.camera;
    s.left = -30; s.right = 30; s.top = 30; s.bottom = -30; s.near = 1; s.far = 160;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.035;
    key.shadow.radius = 5; // soft-edged shadows
    scene.add(key, key.target);
    this.key = key;
    this.focus = new Vector3(); // where the action is (shadow frustum + lantern lights follow it)

    this.slots = Array.from({ length: MAX_LAMPS }, () => {
      const light = new PointLight(0xff8040, 0, LANTERNS.lightRange, 1.7);
      light.position.set(0, -100, 0);
      scene.add(light);
      return { light, anchor: null, fade: 0, color: new Color() };
    });
    this.anchors = [];
    this.pickT = 0;

    this.heroFill = new PointLight(DUSK.fill, DUSK.fillIntensity, 9, 1.4);
    scene.add(this.heroFill);

    // shared with CharacterLook
    this.characterLook = { rim: new Color().copy(DUSK.rim), rimStrength: { value: 0.55 }, env: DUSK.env, flash: new Color(0, 0, 0) };

    scene.fog = new FogExp2(DUSK.fog.clone(), SKY.fogDensity.dusk);
    this.sunDir = new Vector3(...SKY.sunDir).normalize();
    this.moonDir = new Vector3(...SKY.moonDir).normalize();
    this.night = -1;
    this._v = new Vector3();
  }

  /** Every lantern string's light anchor: [{ position: Vector3, color: [r,g,b] }]. */
  setAnchors(anchors) {
    this.anchors = anchors;
    this.pick(true);
  }

  /** Keep the MAX_LAMPS anchors nearest the focus lit; swap others out via fades. */
  pick(immediate = false) {
    const want = this.anchors
      .map((a) => ({ a, d: a.position.distanceToSquared(this.focus) }))
      .sort((x, y) => x.d - y.d)
      .slice(0, this.slots.length)
      .map((x) => x.a);
    const held = new Set(this.slots.map((s) => s.anchor));
    const queue = want.filter((a) => !held.has(a));
    for (const slot of this.slots) {
      if (slot.anchor && want.includes(slot.anchor)) {
        slot.leaving = false;
        continue;
      }
      if (!slot.anchor || immediate || slot.fade <= 0.001) {
        const next = queue.shift();
        if (!next) continue;
        slot.anchor = next;
        slot.leaving = false;
        slot.fade = immediate ? 1 : 0;
        slot.light.position.copy(next.position);
        slot.color.setRGB(...next.color);
      } else slot.leaving = true; // fade out first, re-assign on a later pick
    }
  }

  setNight(k) {
    if (k === this.night) return;
    this.night = k;
    const e = smoothstep(0, 1, k);
    this.hemi.color.lerpColors(DUSK.hemiSky, NIGHT.hemiSky, e);
    this.hemi.groundColor.lerpColors(DUSK.hemiGround, NIGHT.hemiGround, e);
    this.hemi.intensity = lerp(DUSK.hemiIntensity, NIGHT.hemiIntensity, e);
    this.key.color.lerpColors(DUSK.key, NIGHT.key, e);
    this.key.intensity = lerp(DUSK.keyIntensity, NIGHT.keyIntensity, e);
    this.scene.fog.color.lerpColors(DUSK.fog, NIGHT.fog, e);
    this.scene.fog.density = lerp(SKY.fogDensity.dusk, SKY.fogDensity.night, e);
    this.renderer.toneMappingExposure = RENDER.exposure * lerp(DUSK.exposure, NIGHT.exposure, e);
    this.heroFill.color.lerpColors(DUSK.fill, NIGHT.fill, e);
    this.heroFill.intensity = lerp(DUSK.fillIntensity, NIGHT.fillIntensity, e);
    this.characterLook.rim.lerpColors(DUSK.rim, NIGHT.rim, e);
    this.characterLook.env = lerp(DUSK.env, NIGHT.env, e);
    parkUniforms.uNight.value = k;
    parkUniforms.uAmbient.value.lerpColors(DUSK.ambient, NIGHT.ambient, e);
    parkUniforms.uSunDir.value.copy(this.sunDir).lerp(this.moonDir, e).normalize();
    parkUniforms.uSunCol.value.copy(this.key.color).multiplyScalar(this.key.intensity);
  }

  update(dt, time, camera) {
    // key light: far along the sun/moon direction, aimed at the focus;
    // a grazing sun makes endless shadows, so the shadow-caster stays ≥ ~25° up
    const dir = this._v.copy(parkUniforms.uSunDir.value);
    dir.y = Math.max(dir.y, 0.45);
    dir.normalize();
    this.key.position.copy(this.focus).addScaledVector(dir, 70);
    this.key.target.position.copy(this.focus);

    // hero fill: up and to the camera side of the couple
    if (camera) {
      const toCam = this._v.copy(camera.position).sub(this.focus).setY(0).normalize();
      this.heroFill.position.copy(this.focus).addScaledVector(toCam, 3.4).setY(this.focus.y + 3.2);
    }

    // lantern lights: re-pick a few times a second; fade in / out; candle flicker
    this.pickT -= dt;
    if (this.pickT <= 0) {
      this.pickT = 0.35;
      this.pick();
    }
    const glow = lerp(0.35, 1, smoothstep(0, 0.8, this.night));
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      s.fade = Math.min(1, Math.max(0, s.fade + (s.leaving ? -dt * 1.6 : dt * 1.2)));
      const f = 0.86 + 0.08 * Math.sin(time * 7.3 + i * 2.1) + 0.06 * Math.sin(time * 13.1 + i * 5.7);
      const I = s.anchor ? LANTERNS.lightIntensity * glow * f * s.fade : 0;
      s.light.intensity = I;
      s.light.color.copy(s.color);
      parkUniforms.uLampPos.value[i].copy(s.light.position);
      parkUniforms.uLampCol.value[i].set(s.color.r, s.color.g, s.color.b).multiplyScalar(I * 0.32);
    }
  }

  dispose() {
    this.key.shadow.map?.dispose();
    for (const l of [this.hemi, this.key, this.heroFill, ...this.slots.map((s) => s.light)]) l.removeFromParent();
    this.scene.fog = null;
  }
}
