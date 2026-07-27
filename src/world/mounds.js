/**
 * Object_DirtMound — kopiec zostawiany przez kreta przy zejsciu/wynurzeniu.
 * Renderowany przez InstancedMesh (GDD 4.B), bo kopcow potrafi byc kilkadziesiat.
 * Warstwa SURFACE = widoczny dla obroncow; bliznicza instancja na warstwie UNDER
 * pokazuje kretom siec wlasnych szybow.
 */
import * as THREE from 'three';
import { ARENA, LAYER } from '../core/config.js';
import { soilTexture } from './textures.js';

const MAX = 90;
const _m = new THREE.Object3D();

export class MoundSystem {
  constructor(scene) {
    const geo = new THREE.SphereGeometry(0.85, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5);
    geo.scale(1, 0.55, 1);

    this.mesh = new THREE.InstancedMesh(
      geo,
      new THREE.MeshStandardMaterial({ map: soilTexture(1), roughness: 1, flatShading: true }),
      MAX
    );
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.layers.set(LAYER.SURFACE);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    // szyby widziane z podziemia — plaskie, swiecace obreze wejscia do tunelu
    const shaftGeo = new THREE.RingGeometry(0.55, 1.0, 14);
    shaftGeo.rotateX(-Math.PI / 2);
    this.shafts = new THREE.InstancedMesh(
      shaftGeo,
      new THREE.MeshBasicMaterial({
        color: 0xff9a3d, side: THREE.DoubleSide, transparent: true, opacity: 0.45, depthWrite: false
      }),
      MAX
    );
    this.shafts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shafts.layers.set(LAYER.UNDER);
    this.shafts.frustumCulled = false;
    scene.add(this.shafts);

    this.items = [];
    for (let i = 0; i < MAX; i++) {
      this.items.push({ i, alive: false, x: 0, z: 0, scale: 0, target: 0, wet: 0 });
      _m.position.set(0, -999, 0);
      _m.scale.setScalar(0.0001);
      _m.updateMatrix();
      this.mesh.setMatrixAt(i, _m.matrix);
      this.shafts.setMatrixAt(i, _m.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.shafts.instanceMatrix.needsUpdate = true;

    // `.i` (slot InstancedMesh) jest stabilny na cale zycie obiektu — `spawn()`
    // przestawia KOLEJNOSC w `this.items` przy recyklingu, wiec do synchronizacji
    // sieciowej trzeba szukac po `.i`, nie po pozycji w tablicy.
    this.byIndex = new Map(this.items.map(m => [m.i, m]));
  }

  spawn(x, z) {
    // nie duplikuj kopca w tym samym miejscu
    const near = this.nearest(x, z, 1.6);
    if (near) { near.target = 1; return near; }

    let slot = this.items.find(m => !m.alive);
    if (!slot) {
      slot = this.items[0];         // recykling najstarszego
      this.items.push(this.items.shift());
    }
    slot.alive = true;
    slot.x = x; slot.z = z;
    slot.scale = 0.05;
    slot.target = 1;
    slot.wet = 0;
    slot.rot = Math.random() * Math.PI * 2;
    return slot;
  }

  destroy(mound) {
    if (!mound || !mound.alive) return false;
    mound.target = 0;
    return true;
  }

  nearest(x, z, r = 5) {
    let best = null, bestD = r;
    for (const m of this.items) {
      if (!m.alive || m.target === 0) continue;
      const d = Math.hypot(m.x - x, m.z - z);
      if (d < bestD) { bestD = d; best = m; }
    }
    return best;
  }

  activeCount() {
    return this.items.reduce((n, m) => n + (m.alive && m.target > 0 ? 1 : 0), 0);
  }

  /** Do snapshotu hosta — tylko zywe kopce, adresowane stabilnym `.i`. */
  serializeActive() {
    const out = [];
    for (const m of this.items) if (m.alive) out.push({ i: m.i, x: m.x, z: m.z, t: m.target });
    return out;
  }

  /** Korekta stanu goscia: dopisuje/aktualizuje kopce z listy hosta, gasi te, ktorych juz tam nie ma. */
  applyNetworkState(list) {
    const present = new Set();
    for (const e of list) {
      present.add(e.i);
      const m = this.byIndex.get(e.i);
      if (!m) continue;
      if (!m.alive) { m.alive = true; m.scale = 0.05; m.rot = m.rot || Math.random() * Math.PI * 2; }
      m.x = e.x; m.z = e.z; m.target = e.t;
    }
    for (const m of this.items) {
      if (m.alive && !present.has(m.i)) m.target = 0;
    }
  }

  update(dt) {
    let dirty = false;
    for (const m of this.items) {
      if (!m.alive) continue;
      const prev = m.scale;
      m.scale += (m.target - m.scale) * Math.min(1, dt * 8);
      if (m.wet > 0) m.wet = Math.max(0, m.wet - dt);
      if (m.target === 0 && m.scale < 0.02) {
        m.alive = false;
        m.scale = 0;
      }
      if (Math.abs(prev - m.scale) > 0.0005 || m.scale === 0) {
        dirty = true;
        _m.position.set(m.x, 0.02, m.z);
        _m.rotation.set(0, m.rot || 0, 0);
        _m.scale.setScalar(Math.max(0.0001, m.scale));
        _m.updateMatrix();
        this.mesh.setMatrixAt(m.i, _m.matrix);

        _m.position.set(m.x, ARENA.undergroundY + 1.1, m.z);
        _m.rotation.set(0, 0, 0);
        _m.scale.set(Math.max(0.0001, m.scale), Math.max(0.0001, m.scale), Math.max(0.0001, m.scale));
        _m.updateMatrix();
        this.shafts.setMatrixAt(m.i, _m.matrix);
      }
    }
    if (dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.shafts.instanceMatrix.needsUpdate = true;
    }
  }
}
