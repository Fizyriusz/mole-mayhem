/**
 * System czasteczek (THREE.Points + wlasny shader), pulowany.
 * Obsluguje: obloczki kurzu nad kretem (GDD 3.A), tryskajaca wode z weza,
 * wybuchy ziemi przy kopaniu, iskry trafien i kosmetyczne konfetti z nory.
 */
import * as THREE from 'three';
import { LAYER } from '../core/config.js';
import { softDot } from '../world/textures.js';

const VERT = /* glsl */`
  attribute float aSize;   // rozmiar w jednostkach swiata
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uScale;    // wysokosc bufora / (2 * tan(fov/2))
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(aSize * (uScale / max(0.001, -mv.z)), 1.0, 96.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */`
  uniform sampler2D uMap;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 t = texture2D(uMap, gl_PointCoord);
    if (t.a < 0.02 || vAlpha <= 0.0) discard;
    gl_FragColor = vec4(vColor, t.a * vAlpha);
  }
`;

const _c = new THREE.Color();

class Pool {
  constructor(scene, layer, max, blending) {
    this.max = max;
    this.head = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));

    this.geometry = g;
    this.material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: softDot('#ffffff') }, uScale: { value: 700 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: blending || THREE.NormalBlending
    });

    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.layers.set(layer);
    scene.add(this.points);
  }

  spawn(o) {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    const i3 = i * 3;
    this.pos[i3] = o.x; this.pos[i3 + 1] = o.y; this.pos[i3 + 2] = o.z;
    this.vel[i3] = o.vx; this.vel[i3 + 1] = o.vy; this.vel[i3 + 2] = o.vz;
    _c.setHex(o.color);
    this.col[i3] = _c.r; this.col[i3 + 1] = _c.g; this.col[i3 + 2] = _c.b;
    this.size[i] = o.size;
    this.alpha[i] = 1;
    this.life[i] = o.life;
    this.maxLife[i] = o.life;
    this.grav[i] = o.gravity ?? -6;
    this.drag[i] = o.drag ?? 1.4;
  }

  update(dt) {
    const { pos, vel, life, maxLife, alpha, grav, drag, size } = this;
    let any = false;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) { if (alpha[i] !== 0) { alpha[i] = 0; any = true; } continue; }
      any = true;
      life[i] -= dt;
      const i3 = i * 3;
      const d = Math.max(0, 1 - drag[i] * dt);
      vel[i3] *= d;
      vel[i3 + 2] *= d;
      vel[i3 + 1] = vel[i3 + 1] * d + grav[i] * dt;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;
      const t = Math.max(0, life[i] / maxLife[i]);
      alpha[i] = t * t;
      size[i] *= (1 + dt * 0.35);
      if (life[i] <= 0) alpha[i] = 0;
    }
    if (any) {
      this.geometry.attributes.position.needsUpdate = true;
      this.geometry.attributes.aAlpha.needsUpdate = true;
      this.geometry.attributes.aColor.needsUpdate = true;
      this.geometry.attributes.aSize.needsUpdate = true;
    }
  }
}

const R = (a, b) => a + Math.random() * (b - a);

export class Particles {
  constructor(scene) {
    this.surface = new Pool(scene, LAYER.SURFACE, 600);
    this.under = new Pool(scene, LAYER.UNDER, 400);
    this.both = new Pool(scene, LAYER.DEFAULT, 400, THREE.AdditiveBlending);
    this.pools = [this.surface, this.under, this.both];
  }

  /** Przelicznik rozmiaru punktu — zalezy od wysokosci bufora i FOV kamery. */
  setViewport(heightPx, fovDeg) {
    const scale = heightPx / (2 * Math.tan((fovDeg * Math.PI / 180) / 2));
    for (const p of this.pools) p.material.uniforms.uScale.value = scale;
  }

  update(dt) {
    this.surface.update(dt);
    this.under.update(dt);
    this.both.update(dt);
  }

  /** GDD 3.A: obloczek kurzu zdradzajacy pozycje kreta pod ziemia. */
  dustPuff(x, z) {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = R(0.4, 1.8);
      this.surface.spawn({
        x: x + Math.cos(a) * R(0, .5), y: R(0.05, 0.35), z: z + Math.sin(a) * R(0, .5),
        vx: Math.cos(a) * s, vy: R(1.2, 2.8), vz: Math.sin(a) * s,
        color: [0x8a6b45, 0x6f5636, 0xa08055][(Math.random() * 3) | 0],
        size: R(0.12, 0.3), life: R(0.5, 1.0), gravity: -2.2, drag: 2.2
      });
    }
  }

  /** Wybuch ziemi przy zejsciu / wynurzeniu. */
  digBurst(x, z, up = true) {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = R(1.5, 5);
      const p = {
        x: x + Math.cos(a) * R(0, .6), y: 0.15, z: z + Math.sin(a) * R(0, .6),
        vx: Math.cos(a) * s, vy: up ? R(2.5, 6.5) : R(0.5, 2.5), vz: Math.sin(a) * s,
        color: [0x5a4028, 0x3b2818, 0x6b4c2e][(Math.random() * 3) | 0],
        size: R(0.14, 0.34), life: R(0.6, 1.2), gravity: -13, drag: 0.9
      };
      this.surface.spawn(p);
      this.under.spawn({ ...p, y: -1.6, vy: -p.vy * 0.4 });
    }
  }

  /** GDD 3.B: Particle System tryskajacej wody z weza ogrodnika. */
  waterJet(x, y, z, dirX, dirZ) {
    for (let i = 0; i < 10; i++) {
      const spread = R(-0.4, 0.4);
      const dx = dirX * Math.cos(spread) - dirZ * Math.sin(spread);
      const dz = dirX * Math.sin(spread) + dirZ * Math.cos(spread);
      const s = R(6, 12);
      this.surface.spawn({
        x, y: y + R(-0.1, 0.25), z,
        vx: dx * s, vy: R(1.5, 4.0), vz: dz * s,
        color: [0x8fd8ff, 0x4fb3e8, 0xd9f4ff][(Math.random() * 3) | 0],
        size: R(0.1, 0.24), life: R(0.45, 0.85), gravity: -14, drag: 0.5
      });
    }
  }

  /** Woda wdzierajaca sie do tunelu — widoczna z podziemia. */
  waterFlood(x, z) {
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = R(1, 6);
      this.under.spawn({
        x, y: -0.4, z,
        vx: Math.cos(a) * s, vy: R(-4, -1), vz: Math.sin(a) * s,
        color: [0x8fd8ff, 0x4fb3e8][(Math.random() * 2) | 0],
        size: R(0.16, 0.32), life: R(0.6, 1.1), gravity: -8, drag: 0.8
      });
    }
  }

  hit(x, y, z, color = 0xffd166) {
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = R(2, 6);
      this.both.spawn({
        x, y, z,
        vx: Math.cos(a) * s, vy: R(1, 4), vz: Math.sin(a) * s,
        color, size: R(0.09, 0.2), life: R(0.25, 0.5), gravity: -8, drag: 2
      });
    }
  }

  /** Kosmetyka premium (Zlote Zoledzie): wybuch z nory po dostawie. */
  celebrate(x, z, color = 0xff5fa2) {
    const palette = [color, 0xffffff, 0xffd166, 0x7ce0ff, 0xff8a3d];
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = R(1, 7);
      this.both.spawn({
        x, y: 0.4, z,
        vx: Math.cos(a) * s, vy: R(5, 12), vz: Math.sin(a) * s,
        color: palette[(Math.random() * palette.length) | 0],
        size: R(0.1, 0.26), life: R(0.9, 1.8), gravity: -11, drag: 0.5
      });
    }
  }
}
