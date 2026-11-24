import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Mesh, PointLight, Points, ShaderMaterial, SphereGeometry, Vector3 } from 'three';

const TRAIL = 48;

/**
 * The glowing ball the couple play catch with: an HDR pearl (white-hot core,
 * rose-gold rim) that blooms, a soft halo sprite, a fading comet trail of
 * sparkles sampled along its flight, and a small warm point light so it
 * lights their hands and faces as it passes. Created hidden at start-up (so
 * the extra light is compiled into every shader before the show starts).
 */
export class CatchBall {
  constructor(scene) {
    this.pos = new Vector3(0, -50, 0);
    this.visible = false;
    this.glow = 0; // 0..1 fade
    const core = new Mesh(
      new SphereGeometry(0.075, 24, 16),
      new ShaderMaterial({
        uniforms: { uGlow: { value: 0 }, uTime: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec3 vN; varying vec3 vV;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uGlow, uTime;
          varying vec3 vN; varying vec3 vV;
          void main() {
            float f = pow(1.0 - max(dot(vN, vV), 0.0), 2.0);
            vec3 col = mix(vec3(3.2, 3.0, 2.7), vec3(2.6, 1.0, 1.4), f);   // white-hot core → rose-gold rim
            col *= 0.9 + 0.1 * sin(uTime * 9.0);
            gl_FragColor = vec4(col * uGlow, 1.0);
          }`,
      }),
    );
    core.frustumCulled = false;
    this.core = core;

    // halo + trail: one Points cloud (index 0 = halo, rest = trail samples)
    const n = TRAIL + 1;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aAge', new BufferAttribute(new Float32Array(n).fill(1), 1));
    g.setAttribute('aSeed', new BufferAttribute(Float32Array.from({ length: n }, () => Math.random()), 1));
    this.points = new Points(
      g,
      new ShaderMaterial({
        uniforms: { uGlow: { value: 0 }, uPixelRatio: { value: 1 } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        vertexShader: /* glsl */ `
          uniform float uPixelRatio;
          attribute float aAge; attribute float aSeed;
          varying float vA; varying float vHalo;
          void main() {
            vHalo = gl_VertexID == 0 ? 1.0 : 0.0;
            vA = 1.0 - aAge;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            float size = vHalo > 0.5 ? 1.1 : (0.05 + aSeed * 0.07) * vA;
            gl_PointSize = size * 700.0 * uPixelRatio / max(-mv.z, 0.3);
          }`,
        fragmentShader: /* glsl */ `
          uniform float uGlow;
          varying float vA; varying float vHalo;
          void main() {
            float r = length(gl_PointCoord - 0.5) * 2.0;
            if (vHalo > 0.5) {
              float h = exp(-r * r * 5.0) * 0.55 + exp(-r * 18.0) * 0.4;
              gl_FragColor = vec4(vec3(1.0, 0.62, 0.72) * h * uGlow, 1.0);
              return;
            }
            float s = smoothstep(1.0, 0.0, r);
            gl_FragColor = vec4(mix(vec3(1.0, 0.55, 0.7), vec3(1.0, 0.9, 0.7), vA) * s * vA * vA * 1.8 * uGlow, 1.0);
          }`,
      }),
    );
    this.points.frustumCulled = false;
    this.trail = Array.from({ length: TRAIL }, () => ({ p: new Vector3(0, -50, 0), age: 1 }));
    this.trailT = 0;

    this.light = new PointLight(new Color(1.0, 0.7, 0.75), 0, 4.5, 1.6);
    this.light.position.copy(this.pos);
    scene.add(core, this.points, this.light);
    this.set(false);
  }

  set(visible) {
    this.visible = visible;
  }

  update(dt, time, pixelRatio = 1) {
    this.glow += ((this.visible ? 1 : 0) - this.glow) * Math.min(1, dt * 4);
    const on = this.glow > 0.01;
    this.core.visible = this.points.visible = on;
    this.core.position.copy(this.pos);
    this.light.position.copy(this.pos);
    this.light.intensity = 2.4 * this.glow;
    this.core.material.uniforms.uGlow.value = this.glow;
    this.core.material.uniforms.uTime.value = time;
    const pu = this.points.material.uniforms;
    pu.uGlow.value = this.glow;
    pu.uPixelRatio.value = pixelRatio;
    // trail: drop a sparkle every ~1/60 s at the ball, age them out over ~0.6 s
    this.trailT -= dt;
    if (this.trailT <= 0 && on) {
      this.trailT = 1 / 60;
      const t = this.trail.pop();
      t.p.copy(this.pos).add(new Vector3((Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.04));
      t.age = 0;
      this.trail.unshift(t);
    }
    const pos = this.points.geometry.attributes.position, age = this.points.geometry.attributes.aAge;
    pos.setXYZ(0, this.pos.x, this.pos.y, this.pos.z);
    age.setX(0, 0);
    this.trail.forEach((t, i) => {
      t.age = Math.min(1, t.age + dt / 0.6);
      t.p.y -= dt * 0.15 * t.age; // sparkles drift down as they fade
      pos.setXYZ(i + 1, t.p.x, t.p.y, t.p.z);
      age.setX(i + 1, t.age);
    });
    pos.needsUpdate = age.needsUpdate = true;
  }

  dispose() {
    for (const o of [this.core, this.points]) {
      o.removeFromParent();
      o.geometry.dispose();
      o.material.dispose();
    }
    this.light.removeFromParent();
  }
}
