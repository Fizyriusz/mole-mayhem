/**
 * Trzesienie kamery w stylu "trauma" (Squirrel Eiserloh, GDC 2015): impulsy
 * sumuja sie w jedna wartosc 0..1 z gornym ograniczeniem, ktora zanika
 * wykladniczo. Widoczny offset = trauma^2 * maxOffset — male impulsy ledwo
 * drgaja, duze trzesa mocno, bez liniowej "sztywnosci".
 *
 * Kierunek szumu jest WYGLADZANY (lerp miedzy losowymi probkami wygladzony
 * smoothstepem), nie czystym Math.random() co klatke — inaczej przy niskiej
 * amplitudzie wyglada to jak migoczacy szum telewizyjny zamiast drgania kamery.
 *
 * Czysto prezentacyjne: modul nic nie wie o stanie meczu i nigdy nie jest
 * odczytywany przez symulacje — bezpiecznie moze dzialac inaczej na kazdym
 * kliencie bez zadnych konsekwencji dla determinizmu.
 */
import * as THREE from 'three';
import { CAMERA_SHAKE } from '../core/config.js';

export class CameraShake {
  constructor() {
    this.trauma = 0;
    this._from = new THREE.Vector3();
    this._to = new THREE.Vector3();
    this._t = 1;         // >=1 wymusza reroll przy pierwszym update()
    this.offset = new THREE.Vector3();
  }

  /** @param {number} amount — 0..1, ile traumy dodac (juz przemnozone przez intensywnosc) */
  add(amount) {
    if (amount <= 0) return;
    this.trauma = Math.min(CAMERA_SHAKE.maxTrauma, this.trauma + amount);
  }

  reset() {
    this.trauma = 0;
    this.offset.set(0, 0, 0);
  }

  _reroll() {
    this._from.copy(this._to);
    this._to.set(rand11(), rand11() * 0.6, rand11());   // mniej drgania w pionie — mniej mdlosci
    // UWAGA: nie zerowac tu _t. Wolajacy petli `while (_t>=1){reroll();_t-=1;}`
    // sam odejmuje 1, zeby zachowac czesc ulamkowa (plynne przejscie miedzy
    // probkami szumu). Zerowanie w tym miejscu podwajalo odjecie i zjezdzalo
    // _t na wartosci ujemne (np. dokladnie -1 po pierwszym przewinieciu).
  }

  /** @returns {THREE.Vector3} offset do dodania do JUZ policzonej pozycji kamery */
  update(dt) {
    if (this.trauma <= 0.0005) {
      this.offset.set(0, 0, 0);
      return this.offset;
    }
    this.trauma *= Math.pow(0.5, dt / CAMERA_SHAKE.halfLife);

    this._t += dt / CAMERA_SHAKE.noiseInterval;
    while (this._t >= 1) { this._reroll(); this._t -= 1; }
    const s = this._t;
    const smooth = s * s * (3 - 2 * s);   // smoothstep

    const mag = this.trauma * this.trauma * CAMERA_SHAKE.maxOffset;
    this.offset.lerpVectors(this._from, this._to, smooth).multiplyScalar(mag);
    return this.offset;
  }
}

function rand11() { return Math.random() * 2 - 1; }
