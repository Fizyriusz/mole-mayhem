/**
 * Frakcja A — Kret (Sabotazysta).
 * Stan 1: na powierzchni. Stan 2: pod ziemia (Y = -2, 80% predkosci, kopiec na wejsciu,
 * obloczki kurzu zdradzajace pozycje, slad zapachowy dla psa, winieta w post-processingu).
 */
import * as THREE from 'three';
import { ARENA, LAYER, MOLE } from '../core/config.js';
import { Actor } from './actor.js';
import { buildMole, buildHat } from './models.js';
import { setLayerDeep } from '../world/arena.js';
import { DELIVER_RADIUS } from '../world/burrows.js';

export class Mole extends Actor {
  constructor(game, opts) {
    super(game, { ...opts, team: 'mole', cls: 'mole', model: buildMole(opts.tint), tagHeight: 1.7 });

    this.carrying = null;
    this.dustTimer = Math.random() * MOLE.dustInterval;
    this.scentTimer = 0;
    this.throwCooldown = 3.0;

    if (opts.hat) {
      const hat = buildHat(opts.hat.id, opts.hat.color);
      this.parts.hatAnchor.add(hat);
      setLayerDeep(this.group, LAYER.SURFACE);
    }
  }

  get abilities() {
    return [
      { icon: '⛏️', key: 'SPACJA', cmd: 'dig', label: 'Kop' },
      { icon: '🥕', key: 'E', cmd: 'interact', label: 'Akcja' },
      { icon: '🪨', key: 'Q', cmd: 'ability1', cd: 'throw', label: 'Rzut ziemią' },
      { icon: '💨', key: 'SHIFT', cmd: 'sprint', hold: true, label: 'Sprint' }
    ];
  }

  currentSpeed(sprinting) {
    let s = this.stats.speedSurface;
    if (this.underground) s *= this.stats.speedUnderRatio;
    // z warzywem w lapach nie da sie sprintowac — to okno na kontre obroncy
    if (sprinting && !this.carrying) {
      s *= this.underground ? this.stats.sprintMultiplier : 1.0 + (this.stats.sprintMultiplier - 1) * 0.45;
    }
    if (this.carrying) s *= this.stats.carrySpeedPenalty;
    if (this.slowed) s *= this.slowFactor;
    return s;
  }

  /* ----------------------------------------------------- Stan 1 <-> Stan 2 */

  toggleDig() {
    if (this.busy || this.stunned) return;
    const goingDown = !this.underground;
    if (goingDown) {
      // nie mozna zejsc pod przeszkode podziemna
      const blocked = this.game.world.obstaclesUnder.some(o =>
        Math.hypot(o.x - this.x, o.z - this.z) < (o.r ?? 1) + this.radius);
      if (blocked) {
        if (this.isLocal) this.game.ui.flashHint('Korzenie blokują tunel — odsuń się!');
        return;
      }
    }
    this.startCast('dig', this.stats.digTime, goingDown ? 'Kopanie w dół…' : 'Wynurzanie…', () => {
      this.setUnderground(goingDown);
    });
    this.game.audio.play('dig');
  }

  setUnderground(under, silent = false) {
    this.underground = under;
    this.setLayer(under ? LAYER.UNDER : LAYER.SURFACE);
    this.group.position.y = this.y;

    // GDD: przy zejsciu zostaje kopiec (Object_DirtMound)
    this.game.mounds.spawn(this.x, this.z);
    if (!silent) {
      this.game.particles.digBurst(this.x, this.z, !under);
      this.game.ripples.pulse(this.x, this.z, 3, 0xffa54d);
    }
    if (this.isLocal) {
      this.game.setLocalUnderground(under);
    }
    this.dustTimer = 0.25;
  }

  /** Wyrzucenie na powierzchnie przez waz z woda (GDD 3.B). */
  eject(source) {
    if (!this.underground) {
      this.applyStun(this.stats.stunAfterEject * 0.5);
      return;
    }
    this.setUnderground(false);
    this.applyStun(this.stats.stunAfterEject);
    this.game.particles.digBurst(this.x, this.z, true);
    if (this.isLocal) {
      this.game.postfx.hurtFlash(0.4);
      this.game.ui.flashHint('Wypłukany na powierzchnię!');
    }
    this.game.audio.play('splash');
  }

  /* --------------------------------------------------------- Interakcje */

  interact() {
    if (this.busy || this.stunned) return;

    if (this.carrying) {
      const burrow = this.game.burrows.nearest(this.x, this.z, DELIVER_RADIUS);
      if (burrow) {
        this.startCast('deliver', this.stats.deliverTime, 'Zrzucanie do nory…', () => {
          const veg = this.carrying;
          this.carrying = null;
          this.game.vegetables.deliver(veg);
          this.stats_delivered++;
          this.game.onVegetableDelivered(this, burrow);
        });
        return;
      }
      if (this.isLocal) this.game.ui.flashHint('Zanieś warzywo do świecącej nory!');
      return;
    }

    if (this.underground) {
      if (this.isLocal) this.game.ui.flashHint('Warzywa zbierasz tylko na powierzchni');
      return;
    }

    const veg = this.game.vegetables.inRange(this.x, this.z, 2.1);
    if (!veg) {
      if (this.isLocal) this.game.ui.flashHint('Brak warzywa w zasięgu');
      return;
    }

    this.faceInstantly(veg.mesh.position.x, veg.mesh.position.z);
    this.startCast('pickup', this.stats.pickupTime, 'Wykopywanie warzywa…', () => {
      if (veg.state !== 'plot' && veg.state !== 'dropped') return;
      this.game.vegetables.attachTo(veg, this);
      this.carrying = veg;
      this.game.audio.play('pickup');
      // kradziez jest glosna — obroncy dowiaduja sie, gdzie zniknelo warzywo
      this.game.alertDefenders(this.x, this.z, this);
      if (this.isLocal) this.game.ui.flashHint(`${veg.name} w łapach — do nory!`);
    });
    this.game.audio.play('digSoft');
  }

  /** "Rzucanie przedmiotami" (GDD 3.A) — grudka ziemi oślepiajaca obronce. */
  throwDirt(aimX, aimZ) {
    if (this.underground || this.busy || this.stunned) return;
    if (this.isOnCooldown('throw')) return;
    this.startCooldown('throw', this.throwCooldown);
    const dx = (aimX ?? this.x + Math.sin(this.facing)) - this.x;
    const dz = (aimZ ?? this.z + Math.cos(this.facing)) - this.z;
    const len = Math.hypot(dx, dz) || 1;
    this.faceInstantly(aimX ?? this.x + dx, aimZ ?? this.z + dz);
    this.game.projectiles.spawn(this, this.x, 1.0, this.z, dx / len, dz / len, Math.min(len, 16));
    this.game.audio.play('throw');
  }

  dropCarried() {
    if (!this.carrying) return;
    this.game.vegetables.drop(this.carrying, this.x, this.z);
    this.carrying = null;
  }

  /* ------------------------------------------------------------- Update */

  updateAbilities(dt, cmd) {
    if (cmd.dig) this.toggleDig();
    if (cmd.interact) this.interact();
    if (cmd.ability1) this.throwDirt(cmd.aimX, cmd.aimZ);

    if (this.underground) {
      // GDD: co X sekund obloczek kurzu na powierzchni nad kretem
      this.dustTimer -= dt;
      if (this.dustTimer <= 0) {
        this.dustTimer = this.stats.dustInterval
          * (this.moveSpeed > 0.5 ? 1 : 2.2)
          * (this.carrying ? this.stats.carryDustFactor : 1);
        this.game.particles.dustPuff(this.x, this.z);
        this.game.audio.play('rustle', 0.25, this.game.distanceToCamera(this.x, this.z));
      }

      // slad zapachowy dla psa (DecalGeometry)
      if (this.moveSpeed > 0.5) {
        this.scentTimer -= dt;
        if (this.scentTimer <= 0) {
          this.scentTimer = this.stats.scentInterval;
          this.game.scent.stamp(this.x, this.z, this.facing, this.stats.scentLifetime);
        }
      }

      // regeneracja w ukryciu
      if (this.game.time - this.lastDamageAt > this.stats.hpRegenDelay) {
        this.hp = Math.min(this.maxHp, this.hp + this.stats.hpRegenUnderground * dt);
      }
    }

    // ujawniony kret jest widoczny dla obroncow rowniez pod ziemia
    if (this.underground && this.game.time < this.revealUntil) {
      this.game.markReveal(this);
    }
  }

  contextHint() {
    if (this.stunned) return 'Ogłuszony!';
    if (this.cast) return this.cast.label;
    if (this.carrying) {
      const b = this.game.burrows.nearest(this.x, this.z, DELIVER_RADIUS);
      return b ? '[E] Zrzuć warzywo do nory' : 'Nieś warzywo do świecącej nory';
    }
    if (!this.underground) {
      const v = this.game.vegetables.inRange(this.x, this.z, 2.1);
      if (v) return `[E] Wykop: ${v.name}`;
    }
    return this.underground ? '[SPACJA] Wynurz się' : '[SPACJA] Zakop się';
  }

  die(source) {
    this.dropCarried();
    this.game.particles.digBurst(this.x, this.z, true);
    super.die(source);
  }
}

/** Pociski (grudki ziemi) — wspoldzielone przez wszystkie krety. */
export class ProjectileSystem {
  constructor(game) {
    this.game = game;
    this.items = [];
    this.geo = new THREE.IcosahedronGeometry(0.22, 0);
    this.mat = new THREE.MeshStandardMaterial({ color: 0x5a4028, roughness: 1, flatShading: true });
  }

  spawn(owner, x, y, z, dx, dz, dist) {
    const mesh = new THREE.Mesh(this.geo, this.mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.layers.set(LAYER.SURFACE);
    this.game.scene.add(mesh);
    const speed = 17;
    this.items.push({
      mesh, owner,
      vx: dx * speed, vy: 3.4 + Math.min(dist, 14) * 0.15, vz: dz * speed,
      life: 2.2
    });
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.life -= dt;
      p.vy -= 17 * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.mesh.rotation.x += dt * 9;
      p.mesh.rotation.z += dt * 7;

      let hitActor = null;
      for (const a of this.game.actors) {
        if (!a.alive || a.team === 'mole' || a.underground) continue;
        const d = Math.hypot(a.x - p.mesh.position.x, a.z - p.mesh.position.z);
        if (d < a.radius + 0.6 && p.mesh.position.y < 2.2) { hitActor = a; break; }
      }

      if (hitActor) {
        hitActor.applySlow(1.8, 0.55);
        hitActor.blindUntil = this.game.time + 1.6;
        this.game.particles.hit(p.mesh.position.x, p.mesh.position.y, p.mesh.position.z, 0x6b4c2e);
        if (hitActor.isLocal) {
          this.game.postfx.setDisturb(1);
          this.game.ui.flashHint('Ziemia w oczach!');
        }
        this.game.audio.play('splat');
        this._remove(i);
        continue;
      }

      if (p.mesh.position.y <= 0.2 || p.life <= 0) {
        this.game.particles.dustPuff(p.mesh.position.x, p.mesh.position.z);
        this._remove(i);
      }
    }
  }

  _remove(i) {
    this.game.scene.remove(this.items[i].mesh);
    this.items.splice(i, 1);
  }
}
