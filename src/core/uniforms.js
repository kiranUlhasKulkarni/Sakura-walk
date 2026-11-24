import { Color, Vector3 } from 'three';
import { LANTERNS, WIND } from '../config.js';

export const MAX_LAMPS = LANTERNS.maxLights;

/**
 * Uniforms shared by every custom shader in the park (sky, petals, lanterns,
 * blossoms), so one update per frame drives time, wind, the dusk → night
 * transition and the lantern light field — same pattern as infinity-castle's
 * castleUniforms.
 */
export const parkUniforms = {
  uTime: { value: 0 },
  uNight: { value: 0 }, // 0 dusk → 1 night
  uWind: { value: new Vector3(...WIND.dir).normalize().multiplyScalar(WIND.speed) },
  uGust: { value: 0 },
  uPixelRatio: { value: 1 },
  uAmbient: { value: new Color() }, // sky-light colour at the current time of day
  uSunDir: { value: new Vector3() }, // dusk sun / night moon direction
  uSunCol: { value: new Color() },
  uLampPos: { value: Array.from({ length: MAX_LAMPS }, () => new Vector3(0, -1e5, 0)) },
  uLampCol: { value: Array.from({ length: MAX_LAMPS }, () => new Vector3()) },
};

/** Lantern lighting for custom shaders (the 8 lantern clusters as soft point lights). */
export const GLSL_LAMPS = /* glsl */ `
  uniform vec3 uLampPos[${MAX_LAMPS}];
  uniform vec3 uLampCol[${MAX_LAMPS}];
  vec3 lampLight(vec3 p, vec3 n, float wrap) {
    vec3 sum = vec3(0.0);
    for (int i = 0; i < ${MAX_LAMPS}; i++) {
      vec3 L = uLampPos[i] - p;
      float d2 = dot(L, L);
      L *= inversesqrt(max(d2, 1e-4));
      float att = 1.0 / (1.0 + d2 * 0.09);
      att *= att;
      sum += uLampCol[i] * att * (wrap + (1.0 - wrap) * max(dot(n, L), 0.0));
    }
    return sum;
  }
`;
