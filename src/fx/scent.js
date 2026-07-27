/**
 * Zdolnosc pasywna psa (Wech) — slady zapachowe kretow rzutowane na teren
 * przy uzyciu DecalGeometry (GDD 3.B). Slad zyje 5 sekund i powoli gasnie.
 */
import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { LAYER, MOLE } from '../core/config.js';
import { pawTexture } from '../world/textures.js';

const POOL = 70;
const _pos = new THREE.Vector3();
const _euler = new THREE.Euler();
const _size = new THREE.Vector3(1.1, 1.1, 3);

export class ScentSystem {
  constructor(scene, world) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.layers.set(LAYER.SURFACE);
    scene.add(this.group);

    this.material = new THREE.MeshBasicMaterial({
      map: pawTexture(),
      transparent: true,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -8,
      blending: THREE.AdditiveBlending,
      color: 0x66e0ff
    });

    this.items = [];
    for (let i = 0; i < POOL; i++) {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material.clone());
      mesh.visible = false;
      mesh.layers.set(LAYER.SURFACE);
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.items.push({ mesh, age: 0, life: MOLE.scentLifetime, active: false });
    }
    this.cursor = 0;
    this.visibleForLocal = false;
  }

  /** Widoczne tylko dla klas z wechem (pies). */
  setVisible(v) {
    this.visibleForLocal = v;
    this.group.visible = v;
  }

  stamp(x, z, angle, life = MOLE.scentLifetime, color = 0x66e0ff) {
    const it = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % POOL;

    _pos.set(x, 0.1, z);
    _euler.set(-Math.PI / 2, 0, -angle);
    const geo = new DecalGeometry(this.world.decalTarget, _pos, _euler, _size);
    it.mesh.geometry.dispose();
    it.mesh.geometry = geo;
    it.mesh.material.color.setHex(color);
    it.mesh.visible = true;
    it.active = true;
    it.age = 0;
    it.life = life;
  }

  update(dt) {
    if (!this.visibleForLocal) {
      // slady i tak sie starzeja — po przelaczeniu widoku nie moga "wrocic"
      for (const it of this.items) {
        if (it.active) { it.age += dt; if (it.age >= it.life) { it.active = false; it.mesh.visible = false; } }
      }
      return;
    }
    for (const it of this.items) {
      if (!it.active) continue;
      it.age += dt;
      const t = 1 - it.age / it.life;
      if (t <= 0) {
        it.active = false;
        it.mesh.visible = false;
        continue;
      }
      it.mesh.material.opacity = Math.min(1, t * 1.4) * 0.85;
    }
  }

  /** Dla AI psa: najswiezszy slad w zasiegu wechu. */
  freshestNear(x, z, radius) {
    let best = null, bestAge = Infinity;
    for (const it of this.items) {
      if (!it.active) continue;
      const p = it.mesh.geometry.boundingSphere;
      if (!p) it.mesh.geometry.computeBoundingSphere();
      const c = it.mesh.geometry.boundingSphere.center;
      if (Math.hypot(c.x - x, c.z - z) > radius) continue;
      if (it.age < bestAge) { bestAge = it.age; best = c; }
    }
    return best;
  }
}
