/**
 * Frakcja B — Obroncy. Wspolna baza (atak wrecz w stozku + kroki generujace
 * fale slyszalne przez krety pod ziemia) oraz dwie klasy: Ogrodnik i Pies.
 */
import { LAYER, CAMERA_SHAKE } from '../core/config.js';
import { Actor } from './actor.js';
import { buildGardener, buildDog, buildHat } from './models.js';
import { setLayerDeep } from '../world/arena.js';

class Defender extends Actor {
  constructor(game, opts) {
    super(game, { ...opts, team: 'def' });
    this.swinging = 0;
    this.stepTimer = 0;
    this.blindUntil = 0;

    if (opts.hat) {
      const hat = buildHat(opts.hat.id, opts.hat.color);
      this.parts.hatAnchor.add(hat);
      setLayerDeep(this.group, LAYER.SURFACE);
    }
  }

  get attackCfg() { return this.stats.melee || this.stats.bite; }

  /** Atak podstawowy — stozek przed postacia, dziala tylko na krety w Stanie 1. */
  attack(aimX, aimZ) {
    if (this.busy || this.stunned || this.isOnCooldown('attack')) return;
    const cfg = this.attackCfg;
    this.startCooldown('attack', cfg.cooldown);
    if (aimX !== null && aimZ !== null && aimX !== undefined) this.faceInstantly(aimX, aimZ);
    this.swinging = cfg.windup + 0.22;
    this.game.audio.play(this.cls === 'dog' ? 'bite' : 'swing');

    // kierunek zamachu zapamietujemy TERAZ — obrot w trakcie wind-upu nie zmienia trafienia
    const swingDir = this.facing;

    this.schedule(cfg.windup, () => {
      if (!this.alive || !this.game.running) return;
      let hitAny = false;
      for (const a of this.game.actors) {
        if (!a.alive || a.team !== 'mole' || a.underground) continue;
        const dx = a.x - this.x, dz = a.z - this.z;
        const dist = Math.hypot(dx, dz);
        if (dist > cfg.range + a.radius) continue;
        const ang = Math.atan2(dx, dz);
        let diff = ang - swingDir;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        if (Math.abs(diff) > cfg.arc / 2) continue;
        a.takeDamage(cfg.damage, this);
        a.applySlow(0.4, 0.6);
        hitAny = true;
      }
      if (!hitAny) this.game.particles.dustPuff(this.x + Math.sin(swingDir) * cfg.range * 0.6, this.z + Math.cos(swingDir) * cfg.range * 0.6);
      this.game.ripples.pulse(this.x + Math.sin(swingDir) * 1.2, this.z + Math.cos(swingDir) * 1.2, cfg.range, hitAny ? 0xff5252 : 0xffb14d);
      // Wstrzas TYLKO przy trafieniu mlotkiem Ogrodnika (Zadanie 1) — klapniecie
      // Psa uzywa tego samego attack(), ale prompt wymienil je jako osobny,
      // niewstrzasajacy przypadek, wiec celowo tu nie trzesiemy.
      if (hitAny && this.cls === 'gardener') {
        this.game.shakeAt(this.x, this.z, CAMERA_SHAKE.impulses.gardenerHit, CAMERA_SHAKE.falloffDist.gardenerHit);
      }
    });
  }

  /** GDD 4.B: obronca w TriggerZone kopca moze go zniszczyc. Dodatkowo odnosi zgubione warzywa. */
  destroyMound() {
    if (this.busy || this.stunned) return;

    // najpierw ratujemy warzywo upuszczone przez zlapanego kreta
    const veg = this.game.vegetables.list.find(v =>
      v.state === 'dropped' && Math.hypot(v.mesh.position.x - this.x, v.mesh.position.z - this.z) < 2.2);
    if (veg) {
      this.game.vegetables.regrow(veg);
      this.game.particles.hit(veg.home.x, 0.8, veg.home.z, 0x8fd06a);
      this.game.audio.play('place');
      if (this.isLocal) this.game.ui.flashHint('Warzywo wróciło na grządkę');
      return;
    }

    const mound = this.game.mounds.nearest(this.x, this.z, 3.2);
    if (!mound) {
      if (this.isLocal) this.game.ui.flashHint('Brak kopca w zasięgu');
      return;
    }
    this.game.mounds.destroy(mound);
    this.game.particles.dustPuff(mound.x, mound.z);
    this.game.audio.play('stomp');
    this.game.ripples.pulse(mound.x, mound.z, 2.4, 0xffb14d);
    if (this.isLocal) this.game.ui.flashHint('Kopiec zasypany');
  }

  updateAbilities(dt, cmd) {
    if (cmd.primary) this.attack(cmd.aimX, cmd.aimZ);
    if (cmd.interact) this.destroyMound();

    // kroki -> pulsujace okregi na Y=0 (to wlasnie "slyszy" kret pod ziemia)
    if (this.moveSpeed > 0.6) {
      this.stepTimer -= dt * (this.moveSpeed / (this.stats.speed || 5));
      if (this.stepTimer <= 0) {
        this.stepTimer = 0.42;
        this.game.ripples.footstep(this.x, this.z, Math.min(1.4, 0.6 + this.moveSpeed / 9));
      }
    }

    if (this.swinging > 0) {
      this.swinging -= dt;
      const t = Math.max(0, this.swinging);
      // znaki dobrane pod konwencje "przod modelu = -Z" (patrz faceForward w models.js)
      if (this.parts.arms) this.parts.arms[1].rotation.x = 2.2 - t * 6.5;
      if (this.parts.head && this.cls === 'dog') this.parts.head.rotation.x = 0.35 - t * 1.2;
    } else if (this.parts.head && this.cls === 'dog') {
      this.parts.head.rotation.x *= 0.85;
    }

    if (this.isLocal) {
      this.game.postfx.setDisturb(this.game.time < this.blindUntil ? 1 : 0);
    }
  }
}

/* ------------------------------------------------------------- OGRODNIK */
export class Gardener extends Defender {
  constructor(game, opts) {
    super(game, { ...opts, cls: 'gardener', model: buildGardener(), tagHeight: 2.5 });
    this.hoseTime = 0;
    this.hoseTarget = null;
  }

  get abilities() {
    return [
      { icon: '🔨', key: 'LPM', cmd: 'primary', cd: 'attack', label: 'Młotek' },
      { icon: '🚿', key: 'Q', cmd: 'ability1', cd: 'hose', label: 'Wąż z wodą' },
      { icon: '📢', key: 'F', cmd: 'ability2', cd: 'trap', label: 'Pułapka dźwiękowa' },
      { icon: '💨', key: 'SHIFT', cmd: 'sprint', hold: true, label: 'Sprint' }
    ];
  }

  /** GDD 3.B: woda wlana do kopca wypycha krety z tuneli i ogłusza je. */
  useHose() {
    if (this.busy || this.stunned || this.isOnCooldown('hose')) return;
    const cfg = this.stats.hose;
    const mound = this.game.mounds.nearest(this.x, this.z, cfg.moundRange);
    if (!mound) {
      if (this.isLocal) this.game.ui.flashHint('Podejdź do kopca, żeby wlać wodę');
      return;
    }
    this.startCooldown('hose', cfg.cooldown);
    this.hoseTime = cfg.duration;
    this.hoseTarget = mound;
    mound.wet = cfg.duration + 1.5;
    this.faceInstantly(mound.x, mound.z);
    this.game.audio.play('water');

    // efekt zadziala po zalaniu tunelu
    this.startCast('hose', cfg.duration, 'Zalewanie tunelu…', () => {
      this.game.particles.waterFlood(mound.x, mound.z);
      this.game.ripples.pulse(mound.x, mound.z, cfg.ejectRadius, 0x6fd0ff);
      let caught = 0;
      for (const a of this.game.actors) {
        if (!a.alive || a.team !== 'mole') continue;
        if (Math.hypot(a.x - mound.x, a.z - mound.z) > cfg.ejectRadius) continue;
        if (a.underground) {
          a.eject(this);
          a.takeDamage(cfg.damage, this);
          caught++;
        } else {
          a.applySlow(1.5, 0.6);
        }
      }
      this.game.mounds.destroy(mound);
      if (caught > 0) {
        this.game.shakeAt(mound.x, mound.z, CAMERA_SHAKE.impulses.hoseEject, CAMERA_SHAKE.falloffDist.hoseEject);
      }
      if (this.isLocal) {
        this.game.ui.flashHint(caught ? `Wypłukane krety: ${caught}!` : 'Tunel pusty…');
      }
    });
  }

  /** GDD 3.B: pulapka rzucajaca zaklocenia na echolokacje kretow. */
  placeTrap(aimX, aimZ) {
    if (this.busy || this.stunned || this.isOnCooldown('trap')) return;
    const cfg = this.stats.soundTrap;
    this.startCooldown('trap', cfg.cooldown);
    let x = aimX, z = aimZ;
    if (x === null || x === undefined) {
      x = this.x + Math.sin(this.facing) * 3;
      z = this.z + Math.cos(this.facing) * 3;
    }
    const d = Math.hypot(x - this.x, z - this.z);
    if (d > 9) { x = this.x + (x - this.x) / d * 9; z = this.z + (z - this.z) / d * 9; }
    this.faceInstantly(x, z);
    this.game.traps.place(this, x, z, cfg);
    this.game.audio.play('place');
    if (this.isLocal) this.game.ui.flashHint('Pułapka dźwiękowa postawiona');
  }

  updateAbilities(dt, cmd) {
    super.updateAbilities(dt, cmd);
    if (cmd.ability1) this.useHose();
    if (cmd.ability2) this.placeTrap(cmd.aimX, cmd.aimZ);

    if (this.hoseTime > 0 && this.hoseTarget) {
      this.hoseTime -= dt;
      const dx = this.hoseTarget.x - this.x, dz = this.hoseTarget.z - this.z;
      const len = Math.hypot(dx, dz) || 1;
      this.faceTowards(this.hoseTarget.x, this.hoseTarget.z, dt, 6);
      this.game.particles.waterJet(this.x + dx / len * 0.6, 1.3, this.z + dz / len * 0.6, dx / len, dz / len);
      if (this.parts.arms) this.parts.arms[0].rotation.x = 1.5;   // ramie z wezem wyciagniete przed siebie
    }
  }

  contextHint() {
    if (this.cast) return this.cast.label;
    const veg = this.game.vegetables.list.find(v =>
      v.state === 'dropped' && Math.hypot(v.mesh.position.x - this.x, v.mesh.position.z - this.z) < 2.2);
    if (veg) return '[E] Odnieś warzywo na grządkę';
    const mound = this.game.mounds.nearest(this.x, this.z, this.stats.hose.moundRange);
    if (mound && !this.isOnCooldown('hose')) return '[Q] Wlej wodę do kopca';
    if (mound) return '[E] Zadepcz kopiec';
    return '[LPM] Uderz młotkiem · [F] Postaw pułapkę';
  }
}

/* ------------------------------------------------------------------ PIES */
export class Dog extends Defender {
  constructor(game, opts) {
    super(game, { ...opts, cls: 'dog', model: buildDog(opts.coat), tagHeight: 1.9 });
  }

  get abilities() {
    return [
      { icon: '🦷', key: 'LPM', cmd: 'primary', cd: 'attack', label: 'Kłapnięcie' },
      { icon: '🗣️', key: 'Q', cmd: 'ability1', cd: 'bark', label: 'Szczekanie' },
      { icon: '👃', key: 'F', cmd: 'ability2', cd: 'sniff', label: 'Węszenie' },
      { icon: '💨', key: 'SHIFT', cmd: 'sprint', hold: true, label: 'Sprint' }
    ];
  }

  /** GDD 3.B: sferyczny atak dzwiekowy — dziala rowniez na osi Y (pod ziemia). */
  bark() {
    if (this.busy || this.stunned || this.isOnCooldown('bark')) return;
    const cfg = this.stats.bark;
    this.startCooldown('bark', cfg.cooldown);
    this.game.audio.play('bark');
    this.game.ripples.bark(this.x, this.z, cfg.radius);
    this.game.ripples.spawn(this.x, this.z, { radius: cfg.radius, life: 0.9, color: 0xffd166, rings: 3, strength: 1.2, y: -1.97 });
    this.game.shakeAt(this.x, this.z, CAMERA_SHAKE.impulses.dogBark, CAMERA_SHAKE.falloffDist.dogBark);

    let hit = 0;
    for (const a of this.game.actors) {
      if (!a.alive || a.team !== 'mole') continue;
      // pelna odleglosc 3D — kret pod ziemia jest 2 jednostki nizej
      const d = Math.sqrt((a.x - this.x) ** 2 + (a.y - this.y) ** 2 + (a.z - this.z) ** 2);
      if (d > cfg.radius) continue;
      a.applySlow(cfg.slowDuration, cfg.slowFactor);
      a.reveal(cfg.revealDuration);
      hit++;
      if (a.isLocal) {
        this.game.postfx.hurtFlash(0.25);
        this.game.ui.flashHint('Szczekanie! Spowolnienie 3s');
      }
    }
    if (this.isLocal) this.game.ui.flashHint(hit ? `Namierzone krety: ${hit}` : 'Hau! Nikogo w zasięgu');
  }

  /** Rozszerzenie wechu: krotkie "namierzenie" wszystkich kretow w poblizu. */
  sniff() {
    if (this.busy || this.stunned || this.isOnCooldown('sniff')) return;
    this.startCooldown('sniff', 14);
    this.game.audio.play('sniff');
    let n = 0;
    for (const a of this.game.actors) {
      if (!a.alive || a.team !== 'mole') continue;
      if (this.distanceTo(a) > this.stats.smellRange) continue;
      a.reveal(4);
      n++;
    }
    this.game.ripples.spawn(this.x, this.z, { radius: this.stats.smellRange, life: 1.2, color: 0x66e0ff, rings: 1.5, strength: 0.9 });
    if (this.isLocal) this.game.ui.flashHint(n ? `Wywęszone krety: ${n}` : 'Powietrze czyste…');
  }

  updateAbilities(dt, cmd) {
    super.updateAbilities(dt, cmd);
    if (cmd.ability1) this.bark();
    if (cmd.ability2) this.sniff();
  }

  contextHint() {
    return '[LPM] Kłapnij · [Q] Szczekaj · [F] Węsz';
  }
}
