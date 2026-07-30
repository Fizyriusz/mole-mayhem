/**
 * Bazowa encja sterowalna. Zarowno gracz, jak i bot karmia ja tym samym
 * obiektem Command — dzieki temu warstwa sterowania jest wymienna
 * (klawiatura / dotyk / AI / w przyszlosci pakiet sieciowy).
 */
import * as THREE from 'three';
import { ARENA, LAYER, PING } from '../core/config.js';
import { resolve } from '../core/collision.js';
import { setLayerDeep } from '../world/arena.js';
import { disposeObject } from '../core/dispose.js';
import { buildNameTag } from './models.js';

export const EMPTY_COMMAND = {
  mx: 0, mz: 0, sprint: false,
  aimX: null, aimZ: null,
  primary: false, dig: false, interact: false, ability1: false, ability2: false,
  ping: null   // { x, z, kind } — jednoklatkowy impuls, patrz src/core/input.js
};

let nextId = 1;

export class Actor {
  constructor(game, opts) {
    this.game = game;
    this.id = nextId++;
    this.name = opts.name;
    this.team = opts.team;             // 'mole' | 'def'
    this.cls = opts.cls;               // 'mole' | 'gardener' | 'dog'
    this.isLocal = !!opts.isLocal;
    this.isBot = !opts.isLocal;
    this.stats = opts.stats;

    this.maxHp = this.stats.hp;
    this.hp = this.maxHp;
    this.staminaMax = this.stats.staminaMax;
    this.stamina = this.staminaMax;
    this.radius = this.stats.radius;

    this.alive = true;
    this.underground = false;
    this.facing = opts.facing ?? 0;
    this.pos = new THREE.Vector2(opts.spawn.x, opts.spawn.z);
    this.velocity = new THREE.Vector2();
    this.moveSpeed = 0;

    this.cooldowns = {};
    this.pending = [];                 // akcje opoznione — liczone czasem gry, nie setTimeout
    this.cast = null;                  // { key, t, dur, label, onDone }
    this.slowUntil = 0;
    this.slowFactor = 1;
    this.stunUntil = 0;
    this.revealUntil = 0;
    this.lastDamageAt = -99;
    this.staminaBlockUntil = 0;
    this.animPhase = Math.random() * 6.28;
    this.stats_kills = 0;
    this.stats_delivered = 0;

    this.group = new THREE.Group();
    this.group.position.set(this.pos.x, 0, this.pos.y);
    game.scene.add(this.group);

    const built = opts.model;
    this.model = built.root;
    this.parts = built.parts;
    this.group.add(this.model);

    // pierscien pod postacia — kolor druzyny / podswietlenie lokalnego gracza
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(this.radius * 1.15, this.radius * 1.45, 20),
      new THREE.MeshBasicMaterial({
        color: this.isLocal ? 0xffd166 : (this.team === 'mole' ? 0xff8a3d : 0x6fd0ff),
        transparent: true, opacity: this.isLocal ? 0.85 : 0.35, depthWrite: false, side: THREE.DoubleSide
      })
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.12;
    this.group.add(this.ring);

    this.tag = buildNameTag(opts.label ?? this.name, this.isLocal ? '#ffd166' : '#ffffff');
    this.tag.position.y = opts.tagHeight ?? 2.3;
    this.tag.visible = !this.isLocal;
    this.group.add(this.tag);

    this.setLayer(LAYER.SURFACE);
  }

  /* ------------------------------------------------------------- pomocnicze */

  setLayer(layer) {
    this.currentLayer = layer;
    setLayerDeep(this.group, layer);
  }

  get x() { return this.pos.x; }
  get z() { return this.pos.y; }
  get y() { return this.underground ? ARENA.undergroundY : 0; }

  distanceTo(other) { return Math.hypot(other.x - this.x, other.z - this.z); }

  isOnCooldown(key) { return (this.cooldowns[key] || 0) > this.game.time; }
  cooldownLeft(key) { return Math.max(0, (this.cooldowns[key] || 0) - this.game.time); }
  startCooldown(key, seconds) { this.cooldowns[key] = this.game.time + seconds; }

  get stunned() { return this.game.time < this.stunUntil; }
  get slowed() { return this.game.time < this.slowUntil; }
  get busy() { return this.cast !== null; }

  applySlow(duration, factor) {
    this.slowUntil = Math.max(this.slowUntil, this.game.time + duration);
    this.slowFactor = Math.min(this.slowFactor === 1 ? factor : this.slowFactor, factor);
  }

  applyStun(duration) {
    this.stunUntil = Math.max(this.stunUntil, this.game.time + duration);
    this.cancelCast();
  }

  reveal(duration) {
    this.revealUntil = Math.max(this.revealUntil, this.game.time + duration);
  }

  /** Odpalenie funkcji po `delay` sekund czasu gry (zatrzymuje sie razem z pauza). */
  schedule(delay, fn) {
    this.pending.push({ at: this.game.time + delay, fn });
  }

  startCast(key, dur, label, onDone, onCancel) {
    this.cast = { key, t: 0, dur, label, onDone, onCancel };
  }

  cancelCast() {
    if (this.cast && this.cast.onCancel) this.cast.onCancel();
    this.cast = null;
  }

  takeDamage(amount, source) {
    if (!this.alive) return;
    this.hp = Math.max(0, this.hp - amount);
    this.lastDamageAt = this.game.time;
    // trafienie przerywa zbior warzywa (nie przerywa juz rozpoczetego kopania)
    if (this.cast && this.cast.key === 'pickup') this.cancelCast();
    this.game.particles.hit(this.x, this.y + 0.9, this.z, this.team === 'mole' ? 0xff6b6b : 0xffd166);
    if (this.isLocal) {
      this.game.postfx.hurtFlash(0.6);
      this.game.audio.play('hurt');
    } else if (source && source.isLocal) {
      this.game.audio.play('hit');
    }
    if (this.hp <= 0) this.die(source);
  }

  die(source) {
    this.alive = false;
    this.cancelCast();
    this.game.onActorDown(this, source);
  }

  /* ---------------------------------------------------------------- update */

  update(dt, cmd) {
    if (!this.alive) return;

    if (this.slowUntil <= this.game.time) this.slowFactor = 1;

    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (this.game.time >= this.pending[i].at) {
        const fn = this.pending[i].fn;
        this.pending.splice(i, 1);
        fn();
      }
    }

    if (this.cast) {
      this.cast.t += dt;
      if (this.cast.t >= this.cast.dur) {
        const done = this.cast.onDone;
        this.cast = null;
        if (done) done();
      }
    }

    const blocked = this.stunned || (this.cast && this.cast.blocking !== false);
    const wants = !blocked && (cmd.mx !== 0 || cmd.mz !== 0);

    // sprint / stamina
    let sprinting = false;
    if (wants && cmd.sprint && this.stamina > 1 && this.game.time > this.staminaBlockUntil) {
      sprinting = true;
      this.stamina -= this.stats.staminaDrain * dt;
      if (this.stamina <= 0) {
        this.stamina = 0;
        this.staminaBlockUntil = this.game.time + 1.2;
      }
      this.lastSprintAt = this.game.time;
    } else if (this.game.time - (this.lastSprintAt ?? -9) > (this.stats.staminaRegenDelay ?? 0.6)) {
      this.stamina = Math.min(this.staminaMax, this.stamina + this.stats.staminaRegen * dt);
    }

    const speed = this.currentSpeed(sprinting);
    this.moveSpeed = 0;

    if (wants) {
      const len = Math.hypot(cmd.mx, cmd.mz) || 1;
      const dx = (cmd.mx / len) * speed * dt;
      const dz = (cmd.mz / len) * speed * dt;
      const target = { x: this.pos.x + dx, z: this.pos.y + dz };
      resolve(target, this.radius, this.underground ? this.game.world.obstaclesUnder : this.game.world.obstaclesSurface, this.game.world.bounds);
      const movedX = target.x - this.pos.x;
      const movedZ = target.z - this.pos.y;
      this.pos.set(target.x, target.z);
      this.moveSpeed = Math.hypot(movedX, movedZ) / Math.max(dt, 0.0001);
      // Postac patrzy tam, gdzie idzie. Kursor/swipe przejmuje obrot dopiero
      // w momencie akcji (GDD: LPM -> lookAt na punkt trafienia promienia),
      // dzieki czemu sylwetka nie "wlecze sie" za myszka.
      this.faceTowards(this.pos.x + cmd.mx, this.pos.y + cmd.mz, dt);
    }

    // GDD 4.C: przytrzymany LPM obraca postac w punkt trafienia promienia
    // w plaszczyzne gry — natychmiast, bez wygladzania (zero "wleczenia" za myszka).
    if (cmd.primary && !blocked && cmd.aimX !== null && cmd.aimZ !== null) {
      this.faceInstantly(cmd.aimX, cmd.aimZ);
    }

    this.group.position.set(this.pos.x, this.y, this.pos.y);
    this.group.rotation.y = this.facing;

    this.animate(dt);
    this.updateAbilities(dt, cmd, blocked);

    // Ping: dziala niezaleznie od `blocked` (ogluszenie nie powinno wylaczac
    // komunikacji z druzyna) — jedyny gate to wlasny cooldown aktora.
    if (cmd.ping && !this.isOnCooldown('ping')) {
      this.startCooldown('ping', PING.cooldown);
      this.game.addPing(cmd.ping.x, cmd.ping.z, cmd.ping.kind, this.team, this);
    }
  }

  currentSpeed(sprinting) {
    let s = this.stats.speed ?? this.stats.speedSurface;
    if (sprinting) s *= this.stats.sprintMultiplier;
    if (this.slowed) s *= this.slowFactor;
    return s;
  }

  /**
   * Obrot ze stala predkoscia katowa (rad/s) zamiast wygladzania wykladniczego —
   * dzieki temu skret jest przewidywalny i nie zalezy od liczby klatek.
   * 18 rad/s = pelny obrot o 180 stopni w ~0.17 s.
   */
  faceTowards(tx, tz, dt = 1, turnSpeed = 18) {
    const want = Math.atan2(tx - this.pos.x, tz - this.pos.y);
    let diff = want - this.facing;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const step = turnSpeed * dt;
    this.facing += Math.abs(diff) <= step ? diff : Math.sign(diff) * step;
  }

  faceInstantly(tx, tz) {
    this.facing = Math.atan2(tx - this.pos.x, tz - this.pos.y);
  }

  /** Prosta animacja proceduralna — bez rigów i klipów. */
  animate(dt) {
    const p = this.parts;
    const moving = this.moveSpeed > 0.4;
    this.animPhase += dt * (moving ? 4 + this.moveSpeed * 1.1 : 2.2);
    const s = Math.sin(this.animPhase);

    if (p.legs) {
      for (let i = 0; i < p.legs.length; i++) {
        const phase = this.animPhase + (i % 2 === 0 ? 0 : Math.PI) + (i > 1 ? 0.6 : 0);
        p.legs[i].rotation.x = moving ? Math.sin(phase) * 0.62 : Math.sin(this.animPhase * 0.4) * 0.05;
      }
    }
    if (p.arms) {
      p.arms[0].rotation.x = moving ? Math.sin(this.animPhase + Math.PI) * 0.5 : 0;
      if (!this.swinging) p.arms[1].rotation.x = moving ? Math.sin(this.animPhase) * 0.35 : 0;
    }
    if (p.paws) {
      for (let i = 0; i < p.paws.length; i++) {
        p.paws[i].rotation.x = moving ? Math.sin(this.animPhase + i * Math.PI) * 0.85 : Math.sin(this.animPhase * 0.5 + i) * 0.15;
      }
    }
    if (p.body) p.body.position.y = (p.body.userData.baseY ??= p.body.position.y) + (moving ? Math.abs(s) * 0.06 : Math.sin(this.animPhase * 0.5) * 0.02);
    if (p.tail) p.tail.rotation.z = Math.sin(this.animPhase * 0.9) * (moving ? 0.4 : 0.15);
    if (p.head) p.head.rotation.z = Math.sin(this.animPhase * 0.5) * 0.05;

    // pulsujacy pierscien, gdy postac jest ujawniona
    if (this.game.time < this.revealUntil) {
      this.ring.material.opacity = 0.5 + Math.sin(this.game.time * 9) * 0.35;
    } else if (!this.isLocal) {
      this.ring.material.opacity = 0.35;
    }
  }

  /** Nadpisywane przez klasy pochodne. */
  updateAbilities() {}

  /* -------------------------------------------------------- tryb sieciowy */

  /**
   * Sciezka aktualizacji dla postaci NIE kontrolowanej lokalnie w meczu sieciowym
   * (zdalny gracz albo bot na hoscie, widziany przez goscia). Zero wlasnej
   * fizyki/kolizji/cooldownow — tylko plynne dogonienie stanu ze snapshotu
   * i animacja wizualna, zeby chod/walka nie migaly miedzy klatkami sieci.
   */
  applyNetworkState(state, dt) {
    const rate = Math.min(1, dt * 14);
    const prevX = this.pos.x, prevZ = this.pos.y;
    this.pos.x += (state.x - this.pos.x) * rate;
    this.pos.y += (state.z - this.pos.y) * rate;
    this.moveSpeed = Math.hypot(this.pos.x - prevX, this.pos.y - prevZ) / Math.max(dt, 0.0001);

    let diff = state.f - this.facing;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.facing += diff * rate;

    const vitalRate = Math.min(1, dt * 10);
    this.hp += (state.h - this.hp) * vitalRate;
    this.stamina += (state.s - this.stamina) * vitalRate;

    if (state.r) this.revealUntil = this.game.time + 0.5;   // odswiezane co snapshot, dopoki host mowi "ujawniony"

    const goingUnder = !!state.u;
    if (this.underground !== goingUnder) {
      this.underground = goingUnder;
      this.setLayer(goingUnder ? LAYER.UNDER : LAYER.SURFACE);
    }

    if (this.alive && !state.a) { this.alive = false; this.group.visible = false; }
    else if (!this.alive && state.a) { this.alive = true; this.group.visible = true; this.hp = state.h; }

    this.group.position.set(this.pos.x, this.y, this.pos.y);
    this.group.rotation.y = this.facing;
    this.animate(dt);
  }

  /**
   * Korekta WLASNEGO aktora goscia po snapshocie z hosta. Pozycja/obrot zostaja
   * lokalne (predykcja z wlasnego update()), bo tylko host wie, kto kogo trafil —
   * hp/ogluszenie/spowolnienie/polozenie-pod-ziemia sa wiec zawsze jego slowem
   * ostatecznym i nadpisuja lokalny stan bezposrednio.
   *
   * Uwaga: NIE wolawmy tu die()/onActorDown() — to policzylo by molesAlive-- i
   * sprawdzilo warunek zwyciestwa DRUGI RAZ (host juz to zrobil i przysle wynik
   * snapshotem/eventem 'finish'). Gosc nigdy sam nie decyduje, ze mecz sie skonczyl.
   */
  reconcileSelf(state) {
    this.hp = state.h;
    if (state.st) this.stunUntil = this.game.time + 0.5;
    if (state.sl) this.slowUntil = this.game.time + 0.5;
    if (state.bl) this.blindUntil = this.game.time + 0.5;
    if (this.underground !== !!state.u) {
      this.underground = !!state.u;
      this.setLayer(this.underground ? LAYER.UNDER : LAYER.SURFACE);
    }
    if (this.alive && !state.a) {
      this.alive = false;
      this.cancelCast();
      this.group.visible = false;
      if (this.team === 'mole') {
        this.game.ui.flashHint('Zostałeś złapany — obserwujesz resztę drużyny', 3);
        this.game.setLocalUnderground(false);
      }
    }
  }

  dispose() {
    // warzywo niesione przez kreta nalezy do systemu warzyw — nie kasujemy go razem z postacia
    if (this.carrying && this.carrying.mesh.parent === this.group) {
      this.group.remove(this.carrying.mesh);
    }
    this.game.scene.remove(this.group);
    disposeObject(this.group);
  }
}
