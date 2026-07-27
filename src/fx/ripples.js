/**
 * "Echolokacja" kreta — plaskie, pulsujace okregi na poziomie Y=0 generowane
 * przez kroki obroncow chodzacych nad tunelem (GDD 3.A, Widocznosc dla Kretow).
 * Uzywane rowniez jako wizualizacja sferycznego szczekania psa.
 */
import * as THREE from 'three';
import { LAYER } from '../core/config.js';

const RIPPLE_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const RIPPLE_FRAG = /* glsl */`
  uniform float uAge;      // 0..1
  uniform float uRings;
  uniform vec3 uColor;
  uniform float uStrength;
  varying vec2 vUv;

  void main() {
    float d = length(vUv - 0.5) * 2.0;
    if (d > 1.0) discard;

    // rozchodzaca sie fala
    float wave = sin((d - uAge) * uRings * 6.2831);
    float ring = smoothstep(0.35, 1.0, wave);

    // czolo fali biegnie na zewnatrz
    float front = 1.0 - smoothstep(0.0, 0.35, abs(d - uAge));
    float a = (ring * 0.11 + front * 0.26) * (1.0 - uAge) * uStrength;
    a *= smoothstep(1.0, 0.72, d);
    a *= smoothstep(0.0, 0.25, d);   // srodek zostawiamy czysty
    if (a <= 0.001) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

const POOL = 26;

export class RippleSystem {
  constructor(scene) {
    this.items = [];
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < POOL; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uAge: { value: 1 },
          uRings: { value: 2.0 },
          uColor: { value: new THREE.Color(0x9fe8ff) },
          uStrength: { value: 1 }
        },
        vertexShader: RIPPLE_VERT,
        fragmentShader: RIPPLE_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      });
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      m.layers.set(LAYER.UNDER);
      m.renderOrder = 3;
      scene.add(m);
      this.items.push({ mesh: m, mat, age: 0, life: 1, active: false });
    }
    this.cursor = 0;
  }

  _take() {
    for (let i = 0; i < POOL; i++) {
      const it = this.items[(this.cursor + i) % POOL];
      if (!it.active) { this.cursor = (this.cursor + i + 1) % POOL; return it; }
    }
    const it = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % POOL;
    return it;
  }

  /**
   * @param {number} y — wysokosc plaszczyzny (0 dla krokow na powierzchni)
   */
  spawn(x, z, { radius = 5, life = 1.2, color = 0x9fe8ff, rings = 2, strength = 1, y = 0.03 } = {}) {
    const it = this._take();
    it.active = true;
    it.age = 0;
    it.life = life;
    it.mesh.visible = true;
    it.mesh.position.set(x, y, z);
    it.mesh.scale.set(radius * 2, radius * 2, 1);
    it.mat.uniforms.uColor.value.setHex(color);
    it.mat.uniforms.uRings.value = rings;
    it.mat.uniforms.uStrength.value = strength;
    it.mat.uniforms.uAge.value = 0;
    return it;
  }

  /** Krok obroncy nad glowa kreta. */
  footstep(x, z, strength = 1) {
    this.spawn(x, z, { radius: 3.0 + strength * 1.4, life: 1.1, color: 0x4fc9ff, rings: 1.6, strength });
  }

  /** Sferyczne szczekanie psa (widoczne rowniez z podziemia). */
  bark(x, z, radius) {
    this.spawn(x, z, { radius, life: 0.85, color: 0xffd166, rings: 3, strength: 1.4 });
  }

  /** Uderzenie / pulapka. */
  pulse(x, z, radius, color = 0xff7a4d) {
    this.spawn(x, z, { radius, life: 0.7, color, rings: 2.4, strength: 1.2 });
  }

  update(dt) {
    for (const it of this.items) {
      if (!it.active) continue;
      it.age += dt / it.life;
      if (it.age >= 1) {
        it.active = false;
        it.mesh.visible = false;
        continue;
      }
      it.mat.uniforms.uAge.value = it.age;
    }
  }
}
