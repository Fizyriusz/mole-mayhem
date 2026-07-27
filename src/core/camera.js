/**
 * Kamera 3D Top-Down z podazaniem za postacia (GDD 1).
 * Odpowiada tez za przelaczanie widocznych warstw sceny:
 * powierzchnia (LAYER.SURFACE) vs. podziemie (LAYER.UNDER).
 */
import * as THREE from 'three';
import { LAYER } from './config.js';

const SURFACE_OFFSET = new THREE.Vector3(0, 13.0, 10.5);
const UNDER_OFFSET = new THREE.Vector3(0, 9.5, 7.6);

export class CameraRig {
  constructor(aspect) {
    this.camera = new THREE.PerspectiveCamera(55, aspect, 0.5, 260);
    this.camera.layers.enable(LAYER.SURFACE);
    this.offset = SURFACE_OFFSET.clone();
    this.targetOffset = SURFACE_OFFSET.clone();
    this.lookAt = new THREE.Vector3();
    this.position = new THREE.Vector3(0, 20, 16);
    this.shakeAmount = 0;
    this.under = false;
    this.zoom = 1;
  }

  setUnderground(under) {
    if (this.under === under) return;
    this.under = under;
    this.targetOffset.copy(under ? UNDER_OFFSET : SURFACE_OFFSET);
    if (under) {
      this.camera.layers.disable(LAYER.SURFACE);
      this.camera.layers.enable(LAYER.UNDER);
    } else {
      this.camera.layers.enable(LAYER.SURFACE);
      this.camera.layers.disable(LAYER.UNDER);
    }
  }

  shake(amount) { this.shakeAmount = Math.min(1.2, this.shakeAmount + amount); }

  /** @param {{x:number,y:number,z:number}} target — pozycja sledzonej postaci */
  follow(target, dt, lead = null) {
    this.offset.lerp(this.targetOffset, Math.min(1, dt * 3));

    const desiredX = target.x + (lead ? lead.x * 1.6 : 0);
    const desiredZ = target.z + (lead ? lead.z * 1.6 : 0);

    this.lookAt.lerp(new THREE.Vector3(desiredX, target.y + 0.8, desiredZ), Math.min(1, dt * 6));
    const want = new THREE.Vector3(
      desiredX + this.offset.x,
      target.y + this.offset.y * this.zoom,
      desiredZ + this.offset.z * this.zoom
    );
    this.position.lerp(want, Math.min(1, dt * 5.5));

    this.camera.position.copy(this.position);
    if (this.shakeAmount > 0.001) {
      this.shakeAmount = Math.max(0, this.shakeAmount - dt * 2.2);
      const s = this.shakeAmount * 0.55;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.position.z += (Math.random() - 0.5) * s;
    }
    this.camera.lookAt(this.lookAt);
  }

  /** Ustawienie natychmiastowe (start meczu / respawn kamery). */
  snapTo(target) {
    this.lookAt.set(target.x, target.y, target.z);
    this.position.set(target.x + this.offset.x, target.y + this.offset.y, target.z + this.offset.z);
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.lookAt);
  }

  resize(w, h) {
    const aspect = w / h;
    this.camera.aspect = aspect;
    // Na wysokim ekranie (telefon w pionie) kadr jest waski w poziomie, wiec
    // odsuwamy kamere proporcjonalnie do proporcji ekranu. Bez tego gracz widzi
    // ~10 jednostek na boki i nie ma szans zareagowac na obronce z flanki.
    this.zoom = aspect >= 1.3 ? 1 : Math.min(2.0, 1.25 / Math.max(aspect, 0.4));
    this.camera.updateProjectionMatrix();
  }
}
