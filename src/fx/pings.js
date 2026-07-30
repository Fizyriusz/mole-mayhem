/**
 * Znaczniki pingow w swiecie 3D (Zadanie 3). Sprite rysowany na CanvasTexture
 * (zero zewnetrznych assetow, ten sam wzorzec co buildNameTag w models.js),
 * z depthTest wylaczonym — widoczny "przez" geometrie, zgodnie ze spec.
 *
 * Czysto prezentacyjne: ktore pingi w ogole trafiaja do spawn() (filtr wlasnej
 * frakcji) rozstrzyga Game.showPing(), nie ten modul.
 */
import * as THREE from 'three';
import { LAYER } from '../core/config.js';

const KIND_STYLE = {
  mark: { color: '#ffcf4d', glyph: '❓' },     // obroncy: podejrzany kopiec/pozycja
  trap: { color: '#ff8a3d', glyph: '💥' },     // krety: pulapka dzwiekowa
  danger: { color: '#ff4d4d', glyph: '❗' }    // krety: uwaga / uciekaj
};

const texCache = new Map();
function getTex(kind) {
  if (texCache.has(kind)) return texCache.get(kind);
  const style = KIND_STYLE[kind] || KIND_STYLE.mark;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.beginPath();
  ctx.arc(64, 60, 50, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(10,10,10,.6)';
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.strokeStyle = style.color;
  ctx.stroke();
  ctx.font = '58px "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(style.glyph, 64, 64);
  // "ogonek" wskazujacy dokladny punkt na ziemi pod znacznikiem
  ctx.beginPath();
  ctx.moveTo(48, 106); ctx.lineTo(80, 106); ctx.lineTo(64, 126);
  ctx.closePath();
  ctx.fillStyle = 'rgba(10,10,10,.6)';
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  texCache.set(kind, tex);
  return tex;
}

const POOL = 10;
const BOB_HEIGHT = 2.5;

export class PingSystem {
  constructor(scene) {
    this.items = [];
    for (let i = 0; i < POOL; i++) {
      const mat = new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(1.7, 1.7, 1);
      sprite.visible = false;
      sprite.renderOrder = 20;
      // Widoczny niezaleznie od tego, czy lokalny gracz jest akurat pod ziemia —
      // filtr "czyj to ping" juz zaszedl wczesniej w Game.showPing().
      sprite.layers.enable(LAYER.SURFACE);
      sprite.layers.enable(LAYER.UNDER);
      scene.add(sprite);
      this.items.push({ mesh: sprite, mat, kind: null, age: 0, life: 1, active: false });
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

  spawn(x, z, kind, life = 5) {
    const it = this._take();
    it.active = true;
    it.age = 0;
    it.life = life;
    it.kind = kind;
    it.mesh.visible = true;
    it.mesh.position.set(x, BOB_HEIGHT, z);
    it.mat.map = getTex(kind);
    it.mat.opacity = 1;
    it.mat.needsUpdate = true;
    return it;
  }

  clear() {
    for (const it of this.items) { it.active = false; it.mesh.visible = false; }
  }

  update(dt) {
    for (const it of this.items) {
      if (!it.active) continue;
      it.age += dt;
      const t = it.age / it.life;
      if (t >= 1) { it.active = false; it.mesh.visible = false; continue; }
      it.mesh.position.y = BOB_HEIGHT + Math.sin(it.age * 3) * 0.08;
      // ostatnia 1/4 zycia — wygaszanie, zeby zniknieccie nie bylo nagle
      it.mat.opacity = t > 0.75 ? Math.max(0, 1 - (t - 0.75) / 0.25) : 1;
    }
  }
}
