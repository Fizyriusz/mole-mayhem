/**
 * Pulapka dzwiekowa Ogrodnika (GDD 3.B) — obiekt 3D, ktory zakloca echolokacje
 * kretow. W praktyce steruje uniformem `uDisturb` w shaderze widzenia podziemnego.
 */
import * as THREE from 'three';
import { LAYER } from '../core/config.js';

export class TrapSystem {
  constructor(game) {
    this.game = game;
    this.items = [];
    this.nextId = 1;
  }

  _buildVisual(x, z, radius) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const stake = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 1.1, 6),
      new THREE.MeshStandardMaterial({ color: 0x7a5a34, roughness: 1, flatShading: true })
    );
    stake.position.y = 0.55;
    stake.castShadow = true;
    group.add(stake);

    const horn = new THREE.Mesh(
      new THREE.ConeGeometry(0.42, 0.7, 10, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xd9d4c6, roughness: .6, metalness: .3, side: THREE.DoubleSide, flatShading: true })
    );
    horn.position.y = 1.25;
    horn.rotation.x = Math.PI;
    horn.castShadow = true;
    group.add(horn);

    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xff5252, emissive: 0xff2222, emissiveIntensity: 2 })
    );
    bulb.position.y = 1.55;
    group.add(bulb);

    // zasieg dzialania — czytelny dla obu stron
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius - 0.25, radius, 40),
      new THREE.MeshBasicMaterial({ color: 0xff6b6b, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.14;
    group.add(ring);

    group.traverse(o => o.layers.set(LAYER.DEFAULT));
    this.game.scene.add(group);
    return { group, bulb, ring };
  }

  place(owner, x, z, cfg) {
    const mine = this.items.filter(t => t.owner === owner);
    if (mine.length >= cfg.maxActive) this.remove(mine[0]);

    const { group, bulb, ring } = this._buildVisual(x, z, cfg.radius);
    const trap = {
      id: this.nextId++, owner, x, z, group, bulb, ring,
      radius: cfg.radius, until: this.game.time + cfg.lifetime
    };
    this.items.push(trap);
    return trap;
  }

  remove(trap) {
    const i = this.items.indexOf(trap);
    if (i >= 0) {
      this.game.scene.remove(trap.group);
      this.items.splice(i, 1);
    }
  }

  /** Sila zaklocenia w danym punkcie (0..1) — uzywana przez post-processing i AI. */
  disturbanceAt(x, z) {
    let max = 0;
    for (const t of this.items) {
      const d = Math.hypot(t.x - x, t.z - z);
      if (d < t.radius) max = Math.max(max, 1 - d / t.radius);
    }
    return max;
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const t = this.items[i];
      // pulapki-marionetki (goscia) nie maja `until` — znikaja tylko wtedy,
      // gdy host przestanie je uwzgledniac w snapshocie (patrz applyNetworkState)
      if (t.until !== undefined && this.game.time > t.until) { this.remove(t); continue; }
      const pulse = 0.5 + Math.sin(this.game.time * 8) * 0.5;
      t.bulb.material.emissiveIntensity = 0.6 + pulse * 2.4;
      t.ring.material.opacity = 0.14 + pulse * 0.14;
      t.ring.scale.setScalar(1 + pulse * 0.02);
      if (t.until !== undefined && this.game.time > t.until - 3) t.group.visible = Math.sin(this.game.time * 18) > -0.3;
    }
  }

  /** Do snapshotu hosta. */
  serializeActive() {
    return this.items.map(t => ({ id: t.id, x: t.x, z: t.z, r: t.radius }));
  }

  /** Korekta stanu goscia: tworzy/usuwa wizualizacje pulapek wg listy hosta. */
  applyNetworkState(list) {
    const seen = new Set();
    for (const e of list) {
      seen.add(e.id);
      if (this.items.some(t => t.id === e.id)) continue;
      const { group, bulb, ring } = this._buildVisual(e.x, e.z, e.r);
      this.items.push({ id: e.id, owner: null, x: e.x, z: e.z, group, bulb, ring, radius: e.r, until: undefined });
    }
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (!seen.has(this.items[i].id)) this.remove(this.items[i]);
    }
  }
}
