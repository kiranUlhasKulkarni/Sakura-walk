import { Color, HalfFloatType, Vector2, WebGLRenderTarget } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RENDER } from '../config.js';

/**
 * HDR pipeline (recipe shared with infinity-castle/src/fx/Post.js and the
 * fireworks project): half-float MSAA scene target so lanterns and fireworks
 * can be several × brighter than white → UnrealBloom with a high threshold
 * (only the glowing paper / flames / sparks bloom) → ACES (OutputPass) →
 * a final grade: soft dreamy halation, rose-tinted shadows at dusk, cool
 * blue-black shadows at night, vignette, film grain, and a fade-to-black /
 * flash control the story uses for its big beats.
 */
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uNight: { value: 0 },
    uFade: { value: 0 }, // 0 = picture, 1 = black
    uFlash: { value: 0 }, // a flash (fireworks / the "yes")
    uFlashColor: { value: new Color(1.0, 0.92, 0.8) }, // its tint: white-gold, or the YES's gold / pink
    uRes: { value: new Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uNight, uFade, uFlash;
    uniform vec3 uFlashColor;
    uniform vec2 uRes;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r = length(c);
      vec2 off = c * 0.0018 * r * 2.0;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      // split-tone: dusk → rose shadows / peach highlights; night → indigo shadows / warm lantern highlights
      vec3 shDusk = vec3(1.06, 0.94, 1.04), hiDusk = vec3(1.05, 0.98, 0.92);
      vec3 shNight = vec3(0.86, 0.92, 1.12), hiNight = vec3(1.06, 0.97, 0.88);
      vec3 sh = mix(shDusk, shNight, uNight), hi = mix(hiDusk, hiNight, uNight);
      col *= mix(sh, hi, smoothstep(0.08, 0.6, lum));
      col = mix(vec3(lum), col, 1.06); // a touch more saturation
      col *= mix(1.0, smoothstep(0.95, 0.2, r), 0.6); // vignette
      col += uFlashColor * uFlash;
      col += (hash(vUv * uRes + fract(uTime * 7.13) * 100.0) - 0.5) * 0.022; // grain
      col *= 1.0 - uFade;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    const size = renderer.getDrawingBufferSize(new Vector2());
    const target = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    const b = RENDER.bloom;
    this.bloom = new UnrealBloomPass(new Vector2(size.x, size.y), b.strength, b.radius, b.threshold);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);
    this.u = this.final.uniforms;
  }

  setSize(w, h, pr) {
    const samples = pr > 1.3 ? 0 : 4; // MSAA on half-float is expensive; barely visible at high DPR
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (rt.samples !== samples) {
        rt.samples = samples;
        rt.dispose();
      }
    }
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.u.uRes.value.set(w * pr, h * pr);
  }

  render(dt, time, night) {
    this.u.uTime.value = time;
    this.u.uNight.value = night;
    this.composer.render(dt);
  }

  dispose() {
    this.composer.dispose();
    this.bloom.dispose();
  }
}
