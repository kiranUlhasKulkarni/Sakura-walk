/** GLSL snippets shared by the custom materials (hashes from both reference projects). */

export const GLSL_HASH = /* glsl */ `
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float hash13(vec3 p3) {
    p3 = fract(p3 * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
  }
`;

export const GLSL_NOISE = /* glsl */ `
  float vnoise2(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
  }
  float vnoise3(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash13(i), n100 = hash13(i + vec3(1, 0, 0));
    float n010 = hash13(i + vec3(0, 1, 0)), n110 = hash13(i + vec3(1, 1, 0));
    float n001 = hash13(i + vec3(0, 0, 1)), n101 = hash13(i + vec3(1, 0, 1));
    float n011 = hash13(i + vec3(0, 1, 1)), n111 = hash13(i + vec3(1, 1, 1));
    return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
  }
  float fbm2(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * vnoise2(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
    return v;
  }
  float fbm3(vec3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * vnoise3(p); p = p * 2.07 + vec3(11.3, 5.1, 7.7); a *= 0.5; }
    return v;
  }
`;

/**
 * Wind field shared by tree sway and petal drift. `uWind.xyz` = direction ×
 * speed, `uGust` 0..1 swell. Returns a displacement for a point at height h.
 */
export const GLSL_WIND = /* glsl */ `
  uniform vec3 uWind;
  uniform float uGust;
  uniform float uTime;
  vec3 windSway(vec3 wp, float flex) {
    float ph = dot(wp.xz, vec2(0.11, 0.07));
    float s = sin(uTime * 1.3 + ph) * 0.6 + sin(uTime * 2.7 + ph * 1.7) * 0.25 + sin(uTime * 5.1 + wp.y) * 0.08;
    vec3 w = normalize(uWind + vec3(1e-4));
    return (w * (0.35 + s) * (0.6 + uGust * 1.6) + vec3(-w.z, 0.0, w.x) * sin(uTime * 1.9 + ph * 2.3) * 0.25) * flex;
  }
`;
