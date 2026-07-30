/**
 * Boty. Kazdy bot produkuje dokladnie taki sam obiekt Command, jaki produkuje
 * warstwa wejscia gracza — logika postaci nie wie, kto nia steruje.
 */
import { AI } from '../core/config.js';
import { avoid } from '../core/collision.js';
import { DELIVER_RADIUS } from '../world/burrows.js';

const cmd = () => ({
  mx: 0, mz: 0, sprint: false, aimX: null, aimZ: null,
  primary: false, dig: false, interact: false, ability1: false, ability2: false
});

class Brain {
  constructor(game, actor) {
    this.game = game;
    this.actor = actor;
    this.target = { x: actor.x, z: actor.z };
    this.repath = 0;
    this.actionLock = 0;
    this.state = 'init';
    this.wanderAngle = Math.random() * 6.28;

    this.lastPos = { x: actor.x, z: actor.z };
    this.lastDesired = { x: 0, z: 1 };
    this.stuckTimer = 0;
    this.unstuckUntil = 0;
    this.unstuckDir = { x: 0, z: 0 };
    this.wantedMove = false;
  }

  /** Bez pathfindingu zdarza sie utknac na przeszkodzie — wykryj i odbij. */
  checkStuck(dt) {
    const a = this.actor;
    const moved = Math.hypot(a.x - this.lastPos.x, a.z - this.lastPos.z);
    this.lastPos.x = a.x; this.lastPos.z = a.z;
    if (this.wantedMove && moved < 0.03 && !a.busy) this.stuckTimer += dt;
    else this.stuckTimer = 0;

    if (this.stuckTimer > 0.4) {
      this.stuckTimer = 0;
      this.unstuckUntil = this.game.time + 0.6 + Math.random() * 0.4;
      const side = Math.random() < 0.5 ? 1 : -1;
      const { x: dx, z: dz } = this.lastDesired;
      const ux = -dz * side - dx * 0.35;
      const uz = dx * side - dz * 0.35;
      const len = Math.hypot(ux, uz) || 1;
      this.unstuckDir = { x: ux / len, z: uz / len };
    }
  }

  moveToward(c, tx, tz, obstacles) {
    const a = this.actor;
    let dx = tx - a.x, dz = tz - a.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.15) { this.wantedMove = false; return 0; }
    dx /= d; dz /= d;
    this.wantedMove = true;
    this.lastDesired.x = dx; this.lastDesired.z = dz;

    if (this.game.time < this.unstuckUntil) {
      c.mx = this.unstuckDir.x;
      c.mz = this.unstuckDir.z;
      return d;
    }
    const dir = avoid(a.x, a.z, dx, dz, obstacles, 3.0);
    c.mx = dir.x;
    c.mz = dir.z;
    return d;
  }

  wander(c, obstacles, center = { x: 0, z: 0 }, radius = AI.wanderRadius) {
    if (this.repath <= 0) {
      this.repath = 2 + Math.random() * 2.5;
      this.wanderAngle += (Math.random() - 0.5) * 2.6;
      this.target = {
        x: Math.max(-28, Math.min(28, center.x + Math.cos(this.wanderAngle) * radius * (0.4 + Math.random() * 0.6))),
        z: Math.max(-28, Math.min(28, center.z + Math.sin(this.wanderAngle) * radius * (0.4 + Math.random() * 0.6)))
      };
    }
    const d = this.moveToward(c, this.target.x, this.target.z, obstacles);
    if (d < 1.2) this.repath = 0;
  }

  nearestEnemy(filterFn) {
    const a = this.actor;
    let best = null, bestD = Infinity;
    for (const o of this.game.actors) {
      if (!o.alive || o.team === a.team) continue;
      if (filterFn && !filterFn(o)) continue;
      const d = a.distanceTo(o);
      if (d < bestD) { bestD = d; best = o; }
    }
    return best ? { actor: best, dist: bestD } : null;
  }
}

/* --------------------------------------------------------------- KRET-BOT */
export class MoleBrain extends Brain {
  constructor(game, actor) {
    super(game, actor);
    this.digLock = 0;
    this.veg = null;
  }

  think(dt) {
    const c = cmd();
    const a = this.actor;
    if (!a.alive) return c;

    this.repath -= dt;
    this.actionLock -= dt;
    this.digLock -= dt;
    this.checkStuck(dt);

    const obstacles = a.underground ? this.game.world.obstaclesUnder : this.game.world.obstaclesSurface;
    const threat = this.nearestEnemy();
    const danger = threat && threat.dist < AI.moleDangerRadius;
    const veryClose = threat && threat.dist < 5.5;

    if (a.busy) {
      // w trakcie kopania / zbierania — stoimy
      return c;
    }

    // 1) Nosimy warzywo -> do najblizszej nory, najchetniej tunelem
    if (a.carrying) {
      this.state = 'return';
      const b = this.game.burrows.nearestAny(a.x, a.z);
      const d = this.moveToward(c, b.x, b.z, obstacles);
      c.sprint = a.underground && a.stamina > 30 && (danger || d > 10);

      if (d < DELIVER_RADIUS - 0.5 && this.actionLock <= 0) {
        c.interact = true;
        this.actionLock = 1.0;
        return c;
      }
      // z lupem wracamy pod ziemia — na powierzchni jestesmy latwym celem
      if (!a.underground && d > 3 && this.digLock <= 0) {
        c.dig = true;
        this.digLock = 2.2;
      }
      return c;
    }

    // 2) Uciekaj, gdy malo HP
    if (a.hp < AI.moleFleeHp && danger) {
      this.state = 'flee';
      const dx = a.x - threat.actor.x, dz = a.z - threat.actor.z;
      const len = Math.hypot(dx, dz) || 1;
      this.moveToward(c, a.x + dx / len * 12, a.z + dz / len * 12, obstacles);
      c.sprint = a.stamina > 15;
      if (!a.underground && this.digLock <= 0) { c.dig = true; this.digLock = 2.5; }
      return c;
    }

    // 3) Szukamy warzywa
    if (!this.veg || (this.veg.state !== 'plot' && this.veg.state !== 'dropped')) {
      this.veg = this.game.vegetables.nearestAvailable(a.x, a.z);
    }
    if (!this.veg) {
      this.state = 'idle';
      this.wander(c, obstacles);
      return c;
    }

    this.state = 'seek';
    const vx = this.veg.mesh.position.x, vz = this.veg.mesh.position.z;
    const d = this.moveToward(c, vx, vz, obstacles);
    c.sprint = a.underground && a.stamina > 45 && d > 8;

    if (a.underground) {
      // wynurzamy sie tuz przy warzywie, jesli nikogo nie ma w poblizu
      if (d < 2.4 && !veryClose && this.digLock <= 0) {
        c.dig = true;
        this.digLock = 2.0;
      }
    } else {
      // domyslny sposob podrozowania kreta to tunel — powierzchnia tylko na zbior
      if ((d > 5.5 || danger) && this.digLock <= 0) {
        c.dig = true;
        this.digLock = 2.4;
      } else if (d < 1.5 && this.actionLock <= 0) {
        c.interact = true;
        this.actionLock = this.actor.stats.pickupTime + 0.4;
      } else if (threat && threat.dist < 9 && !a.isOnCooldown('throw') && Math.random() < 0.02) {
        c.ability1 = true;
        c.aimX = threat.actor.x;
        c.aimZ = threat.actor.z;
      }
    }
    return c;
  }
}

/* ------------------------------------------------------------ OBRONCA-BOT */
export class DefenderBrain extends Brain {
  constructor(game, actor) {
    super(game, actor);
    this.lastKnown = null;      // { x, z, at } — odpowiednik "widzianego kurzu"
    this.abilityLock = 0;
    this.trapTimer = 6;
  }

  /** Percepcja: krety na powierzchni widzimy wprost, pod ziemia — po kurzu i kopcach. */
  perceive() {
    const a = this.actor;
    let visible = null, vd = Infinity;
    let sensed = null, sd = Infinity;

    for (const m of this.game.actors) {
      if (!m.alive || m.team !== 'mole') continue;
      const d = a.distanceTo(m);
      if (!m.underground && d < a.stats.visionRange) {
        if (d < vd) { vd = d; visible = m; }
      } else if (m.underground) {
        // slad kurzu / wechu — im blizej, tym pewniej
        const senseR = a.cls === 'dog' ? a.stats.smellRange : 15;
        const noticeable = m.moveSpeed > 0.5 || this.game.time < m.revealUntil;
        if (d < senseR && noticeable && d < sd) { sd = d; sensed = m; }
      }
      if (this.game.time < m.revealUntil && d < vd) { vd = d; visible = m; }
    }
    return { visible, vd, sensed, sd };
  }

  think(dt) {
    const c = cmd();
    const a = this.actor;
    if (!a.alive) return c;

    this.repath -= dt;
    this.actionLock -= dt;
    this.abilityLock -= dt;
    this.trapTimer -= dt;
    this.checkStuck(dt);

    const obstacles = this.game.world.obstaclesSurface;
    const { visible, vd, sensed, sd } = this.perceive();

    // Pies: kopiec wyczuty weszem, ktorego i tak nie zdazy sprawdzic, bo jest
    // zajety kretem (widocznym lub tropionym) — ostrzega druzyne pingiem
    // zamiast go po prostu mijac. Sam ping nie przerywa poscigu (ustawiany
    // obok, branze nizej i tak zwroca c z ruchem/atakiem).
    if (a.cls === 'dog' && !a.isOnCooldown('ping') && (visible || sensed)) {
      const mound = this.game.mounds.nearest(a.x, a.z, a.stats.smellRange);
      if (mound) c.ping = { x: mound.x, z: mound.z, kind: 'mark' };
    }

    // 1) Kret na powierzchni — bezposredni poscig
    if (visible) {
      this.state = 'chase';
      this.lastKnown = { x: visible.x, z: visible.z, at: this.game.time };
      const cfg = a.attackCfg;
      const d = this.moveToward(c, visible.x, visible.z, obstacles);
      c.sprint = d > 4 && a.stamina > 20;
      c.aimX = visible.x; c.aimZ = visible.z;

      if (d < cfg.range * 0.85) {
        c.mx = c.mz = 0;
        if (this.actionLock <= 0) {
          c.primary = true;
          this.actionLock = cfg.cooldown * 0.9;
        }
      }
      // pies szczeka, gdy kret probuje uciec
      if (a.cls === 'dog' && this.abilityLock <= 0 && !a.isOnCooldown('bark') && d < a.stats.bark.radius * 0.8) {
        c.ability1 = true;
        this.abilityLock = 1.2;
      }
      return c;
    }

    // 2) Kret wyczuty pod ziemia — idziemy po tropie kurzu
    if (sensed) {
      this.state = 'hunt';
      this.lastKnown = { x: sensed.x, z: sensed.z, at: this.game.time };
      const d = this.moveToward(c, sensed.x, sensed.z, obstacles);
      c.sprint = d > 4 && a.stamina > 25;

      if (a.cls === 'dog') {
        if (this.abilityLock <= 0 && !a.isOnCooldown('bark') && d < a.stats.bark.radius * 0.75) {
          c.ability1 = true;
          this.abilityLock = 1.5;
        } else if (this.abilityLock <= 0 && !a.isOnCooldown('sniff') && d < a.stats.smellRange * 0.8) {
          c.ability2 = true;
          this.abilityLock = 2;
        }
      } else if (!a.isOnCooldown('hose') && this.abilityLock <= 0) {
        // ogrodnik leje wode, gdy kopiec jest w zasiegu weza I kret w zasiegu zalania
        const cfg = a.stats.hose;
        const mound = this.game.mounds.nearest(a.x, a.z, cfg.moundRange * 0.9);
        if (mound && Math.hypot(mound.x - sensed.x, mound.z - sensed.z) < cfg.ejectRadius * 0.8) {
          c.mx = c.mz = 0;
          c.ability1 = true;
          this.abilityLock = cfg.duration + 1;
        }
      }
      return c;
    }

    // 3) Sprawdz ostatnia znana pozycje / kopce
    if (this.lastKnown && this.game.time - this.lastKnown.at < 6) {
      this.state = 'investigate';
      const d = this.moveToward(c, this.lastKnown.x, this.lastKnown.z, obstacles);
      if (d < 2) this.lastKnown = null;
      return c;
    }

    // 4) Zadeptywanie swiezego kopca w poblizu (odbiera kretom wejscia i cel dla weza)
    const mound = this.game.mounds.nearest(a.x, a.z, 12);
    if (mound) {
      this.state = 'patrolMound';
      const d = this.moveToward(c, mound.x, mound.z, obstacles);
      if (d < 2.4 && this.actionLock <= 0) {
        c.mx = c.mz = 0;
        c.interact = true;         // zadeptanie kopca
        this.actionLock = 1.0;
      }
      return c;
    }

    // 5) Straz przy najbogatszej grzadce — tam krety musza sie wynurzyc
    this.state = 'guard';
    if (a.cls === 'gardener' && this.trapTimer <= 0 && !a.isOnCooldown('trap')) {
      this.trapTimer = 16 + Math.random() * 8;
      const hot = this.richestPlot();
      c.ability2 = true;
      c.aimX = hot.x; c.aimZ = hot.z;
      return c;
    }

    if (this.repath <= 0) {
      const plot = this.richestPlot();
      const ang = Math.random() * Math.PI * 2;
      const r = 2 + Math.random() * 4;
      this.target = { x: plot.x + Math.cos(ang) * r, z: plot.z + Math.sin(ang) * r };
      this.repath = 2.5 + Math.random() * 2;
    }
    const d = this.moveToward(c, this.target.x, this.target.z, obstacles);
    if (d < 1.5) this.repath = 0;
    c.sprint = a.stamina > 55 && d > 8;
    return c;
  }

  /** Grzadka z najwieksza liczba warzyw — najbardziej prawdopodobny cel kretow. */
  richestPlot() {
    const plots = this.game.world.plots;
    let best = plots[0], bestScore = -1;
    for (const p of plots) {
      let n = 0;
      for (const v of this.game.vegetables.list) {
        if (v.state !== 'plot') continue;
        if (Math.abs(v.mesh.position.x - p.x) < p.w / 2 + 1 && Math.abs(v.mesh.position.z - p.z) < p.d / 2 + 1) n++;
      }
      // premiujemy grzadki blisko obroncy, zeby nie biegal w kolko przez cala mape
      const score = n - Math.hypot(p.x - this.actor.x, p.z - this.actor.z) * 0.12;
      if (score > bestScore) { bestScore = score; best = p; }
    }
    return best;
  }
}

export function makeBrain(game, actor) {
  return actor.team === 'mole' ? new MoleBrain(game, actor) : new DefenderBrain(game, actor);
}
