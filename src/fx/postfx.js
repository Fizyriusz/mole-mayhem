/**
 * Post-processing (EffectComposer) — realizacja "Widocznosci dla Kretow" z GDD:
 * ciemna winieta wokol ekranu w widoku podziemnym + zabrudzenie obrazu,
 * ktore rosnie, gdy kret jest w zasiegu Pulapki dzwiekowej Ogrodnika.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const UndergroundShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uUnder: { value: 0 },      // 0 = powierzchnia, 1 = pod ziemia
    uDisturb: { value: 0 },    // zaklocenie echolokacji (pulapka dzwiekowa)
    uHurt: { value: 0 },       // blysk po otrzymaniu obrazen
    uStun: { value: 0 },       // ogluszenie po wyrzuceniu woda
    uAspect: { value: 1 }
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uUnder, uDisturb, uHurt, uStun, uAspect;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    void main() {
      vec2 uv = vUv;

      // zaklocenie obrazu: fala + drgania (pulapka dzwiekowa / ogluszenie)
      float shake = uDisturb * 0.9 + uStun * 0.6;
      if (shake > 0.001) {
        uv.x += sin(uv.y * 46.0 + uTime * 11.0) * 0.006 * shake;
        uv.y += cos(uv.x * 38.0 + uTime * 9.0) * 0.004 * shake;
      }

      vec4 color = texture2D(tDiffuse, uv);

      // lekka aberracja chromatyczna przy zakloceniu
      if (shake > 0.05) {
        float o = 0.004 * shake;
        color.r = texture2D(tDiffuse, uv + vec2(o, 0.0)).r;
        color.b = texture2D(tDiffuse, uv - vec2(o, 0.0)).b;
      }

      if (uUnder > 0.001) {
        // ziemisty grading — mniej zieleni, wiecej sepii
        vec3 soil = vec3(
          dot(color.rgb, vec3(0.46, 0.42, 0.18)),
          dot(color.rgb, vec3(0.36, 0.38, 0.16)),
          dot(color.rgb, vec3(0.24, 0.26, 0.22))
        );
        // 0.62 zamiast pelnego przejscia — echolokacja (cyan) i nory (pomaranczowe)
        // musza pozostac rozroznialne w sepii tunelu
        color.rgb = mix(color.rgb, soil * 1.05, uUnder * 0.62);

        // winieta tunelu — ciemnieje dopiero przy krawedziach ekranu
        vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0);
        float r = length(d) * 1.15;
        float vig = smoothstep(1.25, 0.30, r);
        color.rgb *= mix(1.0, 0.25 + vig * 0.85, uUnder);

        // ziarno ziemi
        float g = hash(vUv * 820.0 + fract(uTime) * 91.0);
        color.rgb += (g - 0.5) * 0.04 * uUnder;
      }

      // czerwony blysk obrazen
      color.rgb = mix(color.rgb, vec3(0.75, 0.06, 0.05), clamp(uHurt, 0.0, 1.0) * 0.55);

      gl_FragColor = color;
    }
  `
};

export class PostFX {
  constructor(renderer, scene, camera) {
    const size = renderer.getSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: renderer.capabilities.isWebGL2 ? 4 : 0
    });

    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.pass = new ShaderPass(UndergroundShader);
    this.composer.addPass(this.pass);
    this.composer.addPass(new OutputPass());

    this.u = this.pass.uniforms;
    this.u.uAspect.value = size.x / size.y;
    this.target = { under: 0, disturb: 0 };
    this._hurt = 0;
  }

  hurtFlash(amount = 1) { this._hurt = Math.min(1, this._hurt + amount); }

  setUnderground(on) { this.target.under = on ? 1 : 0; }
  setDisturb(v) { this.target.disturb = v; }
  setStun(v) { this.u.uStun.value = v; }

  update(dt) {
    const u = this.u;
    u.uTime.value += dt;
    u.uUnder.value += (this.target.under - u.uUnder.value) * Math.min(1, dt * 6);
    u.uDisturb.value += (this.target.disturb - u.uDisturb.value) * Math.min(1, dt * 4);
    this._hurt = Math.max(0, this._hurt - dt * 2.2);
    u.uHurt.value = this._hurt;
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    this.u.uAspect.value = w / h;
  }

  render() { this.composer.render(); }
}
