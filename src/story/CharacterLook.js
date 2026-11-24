import { CanvasTexture, Color, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from 'three';

/**
 * Makes the imported characters sit IN the scene's light instead of on top
 * of it, and pop when they're lit.
 *
 * Several of the models were exported "toon-unlit": every texture is also
 * plugged in as a full-strength emissive map, so they glow evenly whatever
 * the light. Here each character material is calibrated:
 *   • baked emissive is cut to a whisper (eyes / mouth keep a little sparkle),
 *   • fabric flagged metallic / mirror-smooth in the export is made dielectric and rough,
 *   • a studio environment map gives skin and cloth soft PBR ambient + sheen
 *     (intensity follows the time of day),
 *   • a fresnel rim light — rose-gold at dusk, moonlit blue at night, and
 *     flashed by fireworks via `look.flash` — separates them from the
 *     background; `actor.highlight` (0..1+) pushes it for a spotlight beat,
 *   • a soft contact shadow under each actor grounds them (cheap AO).
 * Hair recolours (e.g. her dark-brown hair) are applied per material.
 */
const KEEP_GLOW = /eye|mouth|iris|pupil/i;

let blobTex = null;
function contactTexture() {
  if (blobTex) return blobTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grd.addColorStop(0, 'rgba(0,0,0,0.62)');
  grd.addColorStop(0.45, 'rgba(0,0,0,0.32)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  blobTex = new CanvasTexture(c);
  blobTex.colorSpace = SRGBColorSpace;
  return blobTex;
}

export class CharacterLook {
  constructor(lighting, envMap) {
    this.look = lighting.characterLook;
    this.envMap = envMap;
    this.materials = new Set();
    this.shared = {
      uRimColor: { value: new Color() },
      uFlash: { value: new Color(0, 0, 0) },
    };
    this.blobs = [];
  }

  /** Calibrates every material on an actor (materials shared between clones are done once). */
  apply(actor, { footprint = 0.9, hair = null } = {}) {
    actor.highlightU = actor.highlightU || { value: 0 };
    actor.model.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => this.calibrate(m, actor, hair));
    });
    Object.defineProperty(actor, 'highlight', {
      get: () => actor.highlightU.value,
      set: (v) => (actor.highlightU.value = v),
      configurable: true,
    });
    // contact shadow
    const blob = new Mesh(
      new PlaneGeometry(footprint * 2, footprint * 2).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ map: contactTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }),
    );
    blob.position.y = 0.015;
    blob.renderOrder = 2;
    actor.root.add(blob);
    this.blobs.push(blob);
  }

  calibrate(m, actor, hair) {
    if (!m.isMeshStandardMaterial || this.materials.has(m)) return;
    this.materials.add(m);
    const glow = KEEP_GLOW.test(m.name);
    m.emissiveIntensity = m.userData.noGlow ? 0 : glow ? 0.25 : 0.06;
    // exports often mark fabric fully metallic / mirror-smooth: with an env map that turns
    // white cloth into a glowing mirror. Cloth, skin and hair are dielectric and fairly rough.
    if (!m.metalnessMap) m.metalness = Math.min(m.metalness, 0.05);
    if (!m.roughnessMap) m.roughness = Math.max(m.roughness, 0.45);
    m.envMap = this.envMap;
    m.userData.envScale = /skin|face|body/i.test(m.name) ? 0.45 : 1; // skin: soft sheen only (no hot spots on pale hands)
    m.envMapIntensity = this.look.env * m.userData.envScale;
    if (!m.map && m.color.getHex() === 0x000000) m.color.setRGB(0.02, 0.018, 0.018); // pure-black cloth reads as a hole; give it a tiny albedo
    const isHair = hair && hair.materials.includes(m.name);
    if (isHair) {
      m.emissiveIntensity = 0;
      m.roughness = 0.5;
    }
    const shared = this.shared;
    const hi = actor.highlightU;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uRimColor = shared.uRimColor;
      sh.uniforms.uFlash = shared.uFlash;
      sh.uniforms.uHighlight = hi;
      let frag = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uRimColor;\nuniform vec3 uFlash;\nuniform float uHighlight;');
      if (isHair) {
        sh.uniforms.uHairDark = { value: new Color(hair.dark) };
        sh.uniforms.uHairLight = { value: new Color(hair.light) };
        frag = frag
          .replace('#include <common>', '#include <common>\nuniform vec3 uHairDark;\nuniform vec3 uHairLight;')
          .replace(
            '#include <map_fragment>',
            `#include <map_fragment>
             {
               // recolour the dyed texture to natural dark brown, keeping its painted shading + sheen
               vec3 c = diffuseColor.rgb;
               float v = max(c.r, max(c.g, c.b));
               float sat = (v - min(c.r, min(c.g, c.b))) / max(v, 1e-4);
               float shade = pow(clamp(v, 0.0, 1.0), 0.9);
               vec3 brown = uHairDark * shade * 1.15;
               brown = mix(brown, uHairLight, smoothstep(0.5, 0.05, sat) * smoothstep(0.35, 0.9, v) * 0.85); // highlights
               diffuseColor.rgb = brown;
             }`,
          );
      }
      sh.fragmentShader = frag.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         {
           float fres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
           // rim tinted by the surface's own colour, capped so white lace / skin doesn't bloom out
           vec3 alb = min(diffuseColor.rgb, vec3(0.45));
           totalEmissiveRadiance += (uRimColor * (1.0 + uHighlight * 2.0) + uFlash) * fres * alb * 1.2
                                  + uRimColor * fres * 0.03 * (1.0 + uHighlight);
           totalEmissiveRadiance += diffuseColor.rgb * uHighlight * 0.08;
         }`,
      );
    };
    m.customProgramCacheKey = () => (isHair ? 'cherry-char-hair' : 'cherry-char');
    m.needsUpdate = true;
  }

  update() {
    const L = this.look;
    this.shared.uRimColor.value.copy(L.rim).multiplyScalar(L.rimStrength.value);
    this.shared.uFlash.value.copy(L.flash);
    for (const m of this.materials) m.envMapIntensity = L.env * (m.userData.envScale ?? 1);
  }

  dispose() {
    for (const b of this.blobs) {
      b.removeFromParent();
      b.geometry.dispose();
      b.material.dispose();
    }
    blobTex?.dispose();
    blobTex = null;
  }
}
