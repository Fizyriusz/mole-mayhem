/**
 * Kamera 3D Top-Down z podazaniem za postacia (GDD 1).
 * Odpowiada tez za przelaczanie widocznych warstw sceny:
 * powierzchnia (LAYER.SURFACE) vs. podziemie (LAYER.UNDER).
 */
import * as THREE from 'three';
import { LAYER } from './config.js';
import { CameraShake } from '../fx/camerashake.js';
import { getSettings } from '../meta/settings.js';

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
    this.shakeFx = new CameraShake();
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

  /**
   * @param {number} amount — 0..1, sila impulsu PRZED zastosowaniem ustawien gracza.
   * Intensywnosc z ustawien mnozy sie tu, na wejsciu — przy wylaczonych wstrzasach
   * trauma w ogole sie nie kumuluje (nie tylko nie jest widoczna), wiec przelaczenie
   * suwaka z powrotem w gore nie odpala "zalegloscia" starego zdarzenia.
   */
  shake(amount) {
    const intensity = getSettings().shakeIntensity;
    if (intensity <= 0) return;
    this.shakeFx.add(amount * intensity);
  }

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

    // `this.position` to "prawdziwa" pozycja logiczna kamery — nastepna klatka
    // lerpuje dalej OD NIEJ, nie od wersji potrzasnietej. Offset trzesienia
    // nakladamy dopiero na `camera.position`, przy skladaniu finalnej
    // transformacji, zeby wstrzas nigdy nie zaburzyl plynnosci sledzenia.
    this.camera.position.copy(this.position);
    const shakeOffset = this.shakeFx.update(dt);
    this.camera.position.add(shakeOffset);
    this.camera.lookAt(this.lookAt);
  }

  /** Ustawienie natychmiastowe (start meczu / respawn kamery). */
  snapTo(target) {
    this.lookAt.set(target.x, target.y, target.z);
    this.position.set(target.x + this.offset.x, target.y + this.offset.y, target.z + this.offset.z);
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.lookAt);
    this.shakeFx.reset();   // nowy mecz nie powinien dziedziczyc trzesienia z poprzedniego
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
