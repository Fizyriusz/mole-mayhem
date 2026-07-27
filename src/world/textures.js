/**
 * Proceduralne tekstury (CanvasTexture) — zero assetów do pobrania,
 * a scena nie wyglada jak plaskie kolory z 1997.
 */
import * as THREE from 'three';

const cache = new Map();

function make(key, size, draw, repeat = 1) {
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 4;
  tex.userData.shared = true;   // wspoldzielona przez wiele materialow — nie zwalniac
  cache.set(key, tex);
  return tex;
}

function noise(ctx, size, count, colors, min, max, alpha = 1) {
  ctx.globalAlpha = alpha;
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[(Math.random() * colors.length) | 0];
    const r = min + Math.random() * (max - min);
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function grassTexture(repeat = 26) {
  return make('grass' + repeat, 256, (ctx, s) => {
    ctx.fillStyle = '#3d7a2e';
    ctx.fillRect(0, 0, s, s);
    noise(ctx, s, 900, ['#478a34', '#356b28', '#54a03d', '#2e5f22'], 1.5, 6);
    // pojedyncze zdzbla
    ctx.lineWidth = 1;
    for (let i = 0; i < 400; i++) {
      ctx.strokeStyle = Math.random() > .5 ? '#5cb043' : '#2c5c20';
      const x = Math.random() * s, y = Math.random() * s;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (Math.random() - .5) * 4, y - 3 - Math.random() * 4);
      ctx.stroke();
    }
  }, repeat);
}

export function soilTexture(repeat = 4) {
  return make('soil' + repeat, 256, (ctx, s) => {
    ctx.fillStyle = '#4a3320';
    ctx.fillRect(0, 0, s, s);
    noise(ctx, s, 700, ['#3b2818', '#5a4028', '#2e1f12', '#6b4c2e'], 2, 9);
    // bruzdy grzadki
    ctx.globalAlpha = .35;
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = '#33220f';
      ctx.fillRect(0, i * (s / 8) + 4, s, 6);
    }
    ctx.globalAlpha = 1;
  }, repeat);
}

export function undergroundTexture(repeat = 10) {
  return make('under' + repeat, 256, (ctx, s) => {
    ctx.fillStyle = '#2a1c10';
    ctx.fillRect(0, 0, s, s);
    noise(ctx, s, 800, ['#1d1309', '#382513', '#120c06', '#45301a'], 2, 12);
    // kamyki
    for (let i = 0; i < 70; i++) {
      ctx.fillStyle = '#54463a';
      ctx.globalAlpha = .5;
      ctx.beginPath();
      ctx.ellipse(Math.random() * s, Math.random() * s, 2 + Math.random() * 3, 1.5 + Math.random() * 2, Math.random() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }, repeat);
}

export function woodTexture(repeat = 2) {
  return make('wood' + repeat, 128, (ctx, s) => {
    ctx.fillStyle = '#8a6136';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 60; i++) {
      ctx.strokeStyle = Math.random() > .5 ? '#6d4b28' : '#a2764a';
      ctx.lineWidth = 1 + Math.random() * 2;
      const y = Math.random() * s;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(s * .3, y + (Math.random() - .5) * 8, s * .6, y + (Math.random() - .5) * 8, s, y);
      ctx.stroke();
    }
  }, repeat);
}

/** Miekka, okragla "plamka" — bazowa mapa dla czasteczek i decali. */
export function softDot(color = '#ffffff') {
  return make('dot' + color, 64, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, color);
    g.addColorStop(0.45, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

/** Odcisk lapy kreta — uzywany przez DecalGeometry (sciezka zapachowa psa). */
export function pawTexture() {
  return make('paw', 64, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(s / 2, s * 0.62, s * 0.2, s * 0.24, 0, 0, Math.PI * 2);
    ctx.fill();
    const toes = [[-0.22, -0.14], [-0.08, -0.26], [0.08, -0.26], [0.22, -0.14]];
    for (const [dx, dy] of toes) {
      ctx.beginPath();
      ctx.ellipse(s / 2 + dx * s, s * 0.55 + dy * s, s * 0.075, s * 0.095, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}
