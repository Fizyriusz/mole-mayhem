/**
 * Nory ewakuacyjne — cel kretow. Widoczne w obu perspektywach:
 * na powierzchni jako dziura z pierscieniem, pod ziemia jako swiecacy slup swiatla.
 */
import * as THREE from 'three';
import { ARENA, LAYER } from '../core/config.js';
import { softDot } from './textures.js';

export const DELIVER_RADIUS = 2.6;

export class BurrowSystem {
  constructor(scene, world) {
    this.list = [];
    this.time = 0;

    const holeMat = new THREE.MeshStandardMaterial({ color: 0x140d06, roughness: 1 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x4a3320, roughness: 1, flatShading: true });
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffc978, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false
    });
    const glowMat = new THREE.SpriteMaterial({
      map: softDot('#ffd08a'), color: 0xffb04d, transparent: true, opacity: 0.35,
      depthWrite: false, blending: THREE.AdditiveBlending
    });

    for (const spot of world.burrows) {
      const group = new THREE.Group();
      group.position.set(spot.x, 0, spot.z);
      scene.add(group);

      const rim = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.42, 6, 14), rimMat);
      rim.rotation.x = -Math.PI / 2;
      rim.position.y = 0.16;
      rim.castShadow = rim.receiveShadow = true;
      rim.layers.set(LAYER.SURFACE);
      group.add(rim);

      const hole = new THREE.Mesh(new THREE.CircleGeometry(1.45, 18), holeMat);
      hole.rotation.x = -Math.PI / 2;
      hole.position.y = 0.05;
      hole.layers.set(LAYER.SURFACE);
      group.add(hole);

      // pierscien-znacznik widoczny zawsze (warstwa 0)
      const marker = new THREE.Mesh(
        new THREE.RingGeometry(DELIVER_RADIUS - 0.16, DELIVER_RADIUS, 28),
        new THREE.MeshBasicMaterial({ color: 0xffb14d, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false })
      );
      marker.rotation.x = -Math.PI / 2;
      marker.position.y = 0.13;
      marker.layers.set(LAYER.DEFAULT);
      group.add(marker);

      // slup swiatla dla widoku podziemnego
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.6, 3.2, 12, 1, true), beamMat);
      beam.position.y = ARENA.undergroundY + 0.9;
      beam.layers.set(LAYER.UNDER);
      group.add(beam);

      const sprite = new THREE.Sprite(glowMat.clone());
      sprite.scale.setScalar(2.2);
      sprite.position.y = ARENA.undergroundY + 1.2;
      sprite.layers.set(LAYER.UNDER);
      group.add(sprite);

      this.list.push({ x: spot.x, z: spot.z, group, marker, beam, sprite });
    }
  }

  update(dt) {
    this.time += dt;
    const p = 0.35 + Math.sin(this.time * 2.4) * 0.16;
    for (const b of this.list) {
      b.marker.material.opacity = p;
      b.sprite.material.opacity = 0.3 + Math.sin(this.time * 3 + b.x) * 0.12;
      b.marker.scale.setScalar(1 + Math.sin(this.time * 2.4) * 0.03);
    }
  }

  nearest(x, z, r = DELIVER_RADIUS) {
    let best = null, bestD = r;
    for (const b of this.list) {
      const d = Math.hypot(b.x - x, b.z - z);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }

  nearestAny(x, z) {
    let best = this.list[0], bestD = Infinity;
    for (const b of this.list) {
      const d = Math.hypot(b.x - x, b.z - z);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }
}
