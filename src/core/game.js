/**
 * Rdzen gry: scena, petla, warunki zwyciestwa i sklejenie wszystkich systemow.
 * Jedna instancja zyje przez caly czas dzialania aplikacji; `startMatch()` buduje
 * nowy mecz, `endMatch()` sprzata.
 */
import * as THREE from 'three';
import { ARENA, LAYER, MATCH, MOLE, GARDENER, DOG, cloneStats, resolveMatchSetup } from './config.js';
import { CameraRig } from './camera.js';
import { InputSystem } from './input.js';
import { AudioEngine } from './audio.js';
import { buildArena } from '../world/arena.js';
import { VegetableSystem } from '../world/vegetables.js';
import { MoundSystem } from '../world/mounds.js';
import { BurrowSystem } from '../world/burrows.js';
import { Particles } from '../fx/particles.js';
import { RippleSystem } from '../fx/ripples.js';
import { ScentSystem } from '../fx/scent.js';
import { PostFX } from '../fx/postfx.js';
import { Mole, ProjectileSystem } from '../entities/mole.js';
import { Gardener, Dog } from '../entities/defender.js';
import { TrapSystem } from '../entities/traps.js';
import { makeBrain } from '../ai/bots.js';
import { EMPTY_COMMAND } from '../entities/actor.js';
import { disposeObject } from './dispose.js';
import { serializeSnapshot, applySnapshot } from './netsync.js';
import * as Eco from '../meta/economy.js';

const SNAPSHOT_HZ = 20;
const REMOTE_CMD_TTL = 0.5;   // po tylu sekundach cisz od gracza jego postac staje

const MOLE_NAMES = ['Ryjek', 'Bolek', 'Lolek', 'Krecik', 'Sztygar', 'Wąsik'];
const DOG_NAMES = ['Burek', 'Reksio', 'Azor', 'Fafik'];
const GARDENER_NAMES = ['Stefan', 'Zdzisław', 'Halina', 'Mietek'];
const pick = arr => arr[(Math.random() * arr.length) | 0];

const SKY_VERT = /* glsl */`
  varying vec3 vPos;
  void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const SKY_FRAG = /* glsl */`
  uniform vec3 uTop; uniform vec3 uBottom;
  varying vec3 vPos;
  void main() {
    float h = clamp(normalize(vPos).y * 0.5 + 0.5, 0.0, 1.0);
    gl_FragColor = vec4(mix(uBottom, uTop, pow(h, 0.75)), 1.0);
  }
`;

export class Game {
  constructor(canvas, ui) {
    this.canvas = canvas;
    this.ui = ui;
    this.time = 0;
    this.running = false;
    this.paused = false;
    this.state = 'menu';       // menu | countdown | playing | over

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    // updateStyle=false JEST TU ISTOTNE: domyslne `true` wpisuje canvasowi inline
    // `style="width:1280px;height:720px"`, ktory przebija CSS-owe `width:100%`.
    // resize() celowo tez nie rusza stylu (rozmiarem elementu zarzadza CSS), wiec
    // taki inline zostalby na zawsze — na telefonie canvas bylby wiekszy od ekranu
    // i widac by bylo tylko jego wycinek, podczas gdy HUD skalowalby sie poprawnie.
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.skyColor = new THREE.Color(0x8fc6ea);
    this.soilColor = new THREE.Color(0x150e07);
    this.scene.background = this.skyColor.clone();
    this.scene.fog = new THREE.Fog(this.skyColor.clone(), 60, 145);

    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(160, 20, 14),
      new THREE.ShaderMaterial({
        uniforms: { uTop: { value: new THREE.Color(0x2f74b5) }, uBottom: { value: new THREE.Color(0xd8efff) } },
        vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false
      })
    );
    sky.layers.set(LAYER.SURFACE);
    this.scene.add(sky);

    this.rig = new CameraRig(innerWidth / innerHeight);
    this.rig.resize(innerWidth, innerHeight);
    this.camera = this.rig.camera;

    this.audio = new AudioEngine();
    this.input = new InputSystem(canvas);
    this.postfx = new PostFX(this.renderer, this.scene, this.camera);

    // swiat i systemy wspoldzielone miedzy meczami
    this.world = buildArena(this.scene);
    this.particles = new Particles(this.scene);
    this.ripples = new RippleSystem(this.scene);
    this.scent = new ScentSystem(this.scene, this.world);
    this.mounds = new MoundSystem(this.scene);
    this.burrows = new BurrowSystem(this.scene, this.world);
    this.traps = new TrapSystem(this);
    this.projectiles = new ProjectileSystem(this);

    this.actors = [];
    this.brains = new Map();
    this.vegetables = null;
    this.revealMarkers = [];

    // ---- multiplayer (patrz src/net/client.js + src/core/netsync.js) ----
    this.netRole = null;             // null (solo) | 'host' | 'guest'
    this.net = null;                 // NetClient, przypiety przez attachNet()
    this.remoteCommands = new Map(); // host: connId -> ostatni Command od goscia
    this._netAccum = 0;

    // ResizeObserver zamiast samego zdarzenia 'resize' — na mobile (chowajacy sie
    // pasek adresu, obrot ekranu) zdarzenie okna potrafi nie przyjsc albo przyjsc
    // ze starymi wymiarami.
    this._lastSize = { w: 0, h: 0 };
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this.resize()).observe(canvas);
    }
    addEventListener('resize', () => this.resize());
    addEventListener('orientationchange', () => setTimeout(() => this.resize(), 120));
    this.resize();
    this.particles.setViewport(this._lastSize.h * this.renderer.getPixelRatio(), this.camera.fov);
  }

  /** Rozmiar bierzemy z samego canvasu, nie z okna — dziala w kazdym kontenerze. */
  resize() {
    const w = this.canvas.clientWidth || innerWidth;
    const h = this.canvas.clientHeight || innerHeight;
    if (!w || !h || (w === this._lastSize.w && h === this._lastSize.h)) return;
    this._lastSize = { w, h };
    this.renderer.setSize(w, h, false);
    this.rig.resize(w, h);
    this.postfx.setSize(w, h);
    this.particles?.setViewport(h * this.renderer.getPixelRatio(), this.camera.fov);
  }

  distanceToCamera(x, z) {
    return Math.hypot(this.camera.position.x - x, this.camera.position.z - z);
  }

  /* -------------------------------------------------------- MULTIPLAYER */

  /**
   * Podpina klienta sieciowego raz, po udanym polaczeniu z lobby — wiaze
   * zdarzenia PartyKit z metodami Game. Wywolywane przez UI, nie tutaj,
   * bo to UI zna moment polaczenia (patrz src/ui/ui.js).
   */
  attachNet(client) {
    this.net = client;
    client.onCmd(msg => {
      if (this.netRole === 'host') this.remoteCommands.set(msg.from, { cmd: msg.cmd, at: this.time });
    });
    client.onSnapshot(msg => {
      if (this.netRole === 'guest') applySnapshot(this, msg);
    });
    client.onStart(msg => {
      if (!client.isHost) this.startMatchGuest(msg.setup, msg.specs, msg.vegSpots);
    });
    client.onPlayerLeft(msg => {
      // host: gracz odpadl w trakcie meczu — oddajemy jego postac botowi
      if (this.netRole !== 'host') return;
      const a = this.actors.find(x => x.netId === msg.id);
      if (!a) return;
      a.netId = null;
      this.remoteCommands.delete(msg.id);
      if (a.alive && !this.brains.has(a.id)) this.brains.set(a.id, makeBrain(this, a));
      this.ui.flashHint(`${a.name} rozłączony — przejęty przez bota`, 3);
    });
    client.onHostLeft(() => {
      if (this.netRole !== 'guest') return;
      this.ui.banner('Host opuścił grę', 3);
      this.netRole = null;
      this.running = false;
      setTimeout(() => this.quitToMenu(), 1500);
    });
    client.onDisconnected(() => {
      if (this.netRole === null) return;
      this.ui.banner('Utracono połączenie z serwerem', 3);
      this.netRole = null;
      this.running = false;
      setTimeout(() => this.quitToMenu(), 1500);
    });
  }

  /* ------------------------------------------------------------ MECZ */

  startMatch() {
    this.cleanup();
    this.netRole = null;
    const save = Eco.getSave();
    const fmt = resolveMatchSetup(save);
    this.format = fmt;
    this.vegetablesToWin = fmt.vegetablesToWin;
    this.delivered = 0;
    this.catches = 0;
    this.timeLeft = fmt.duration;
    this.countdown = MATCH.countdown;
    this.state = 'countdown';
    this.running = true;
    this.paused = false;
    this.time = 0;
    this._warned30 = false;   // bez tego "OSTATNIE 30 SEKUND" pokazaloby sie tylko raz na cala sesje

    this.vegetables = new VegetableSystem(this.scene, this.world, MATCH.vegetableCount);

    const playerCls = save.faction;
    const playerIsMole = playerCls === 'mole';
    const perksMole = Eco.activePerksFor('mole');
    const perksDef = Eco.activePerksFor('def');
    const hat = Eco.equippedCosmetic('hat');

    // Punktow startowych jest 4, a graczy moze byc wiecej — kolejne "pierscienie"
    // rozsuwaja postacie wokol punktu, zeby nie startowaly jedna w drugiej.
    const spawnAt = (list, i) => {
      const base = list[i % list.length];
      const ring = Math.floor(i / list.length);
      if (ring === 0) return base;
      const ang = i * 2.39996;
      return { x: base.x + Math.cos(ang) * 1.7 * ring, z: base.z + Math.sin(ang) * 1.7 * ring };
    };

    // ---- krety
    const moleSpawns = [...this.world.moleSpawns].sort(() => Math.random() - 0.5);
    for (let i = 0; i < fmt.moles; i++) {
      const isLocal = playerIsMole && i === 0;
      const stats = cloneStats(MOLE);
      if (isLocal) perksMole.forEach(p => p.apply(stats));
      const mole = new Mole(this, {
        name: isLocal ? 'Ty' : pick(MOLE_NAMES) + ' ' + (i + 1),
        isLocal, stats,
        spawn: spawnAt(moleSpawns, i),
        tint: isLocal ? 0x5a4a3c : [0x4a4038, 0x3d3630, 0x554a40][i % 3],
        hat: isLocal && hat ? hat : null
      });
      this.actors.push(mole);
    }

    // ---- obroncy (sklad rozstrzyga resolveMatchSetup: presety i tryb wlasny)
    const defClasses = fmt.defenderClasses;

    for (let i = 0; i < fmt.defenders; i++) {
      const cls = defClasses[i];
      const isLocal = !playerIsMole && i === 0;
      const stats = cloneStats(cls === 'dog' ? DOG : GARDENER);
      if (isLocal) perksDef.forEach(p => p.apply(stats));
      const spawn = spawnAt(this.world.defenderSpawns, i);
      const Ctor = cls === 'dog' ? Dog : Gardener;
      const def = new Ctor(this, {
        name: isLocal ? 'Ty' : (cls === 'dog' ? pick(DOG_NAMES) : pick(GARDENER_NAMES)),
        isLocal, stats, spawn,
        coat: [0xb5763c, 0x6d6156, 0x2f2a26][i % 3],
        hat: isLocal && hat && cls !== 'dog' ? hat : null
      });
      this.actors.push(def);
    }

    for (const a of this.actors) {
      if (a.isBot) this.brains.set(a.id, makeBrain(this, a));
      if (a.isLocal) this.localActor = a;
    }

    this.moleCount = fmt.moles;
    this.molesAlive = fmt.moles;

    // znaczniki ujawnionych kretow (widoczne dla obroncow)
    for (let i = 0; i < fmt.moles; i++) {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.75, 1.05, 20),
        new THREE.MeshBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: .8, depthWrite: false, side: THREE.DoubleSide })
      );
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.15;
      m.visible = false;
      m.layers.set(LAYER.SURFACE);
      this.scene.add(m);
      this.revealMarkers.push(m);
    }

    this.scent.setVisible(this.localActor.cls === 'dog');
    this.setLocalUnderground(false);
    this.rig.snapTo({ x: this.localActor.x, y: 0, z: this.localActor.z });

    this.input.setEnabled(true);
    this.ui.showHud(this.localActor, this.input);
    this.ui.banner('PRZYGOTUJ SIĘ', 1);
    this.audio.unlock();
  }

  /**
   * Host: rozpoczyna mecz sieciowy. `connectedPlayers` to roster BEZ hosta
   * (host dostaje slot swojej frakcji tak samo jak reszta — patrz allPlayers
   * nizej). Sklad (ile kretow/ogrodnikow/psow) decyduje WYLACZNIE host,
   * dokladnie jak w resolveMatchSetup dla gry solo.
   *
   * Uproszczenie V1: perki i kapelusze sa POMIJANE w meczu sieciowym — wymagaloby
   * to synchronizacji wyboru KAZDEGO gracza z lobby, zanim host zbuduje postacie.
   */
  startMatchHost(connectedPlayers, myName) {
    this.cleanup();
    this.netRole = 'host';
    const save = Eco.getSave();
    const setup = resolveMatchSetup(save);

    // UWAGA: nazwa NIE moze byc "Ty" — to widza wszyscy POZOSTALI gracze,
    // ktorym nad glowa hosta wyswietlaloby sie mylace "Ty" zamiast jego imienia
    const allPlayers = [
      { connId: this.net.id, name: myName || 'Host', faction: save.faction },
      ...connectedPlayers.map(p => ({ connId: p.id, name: p.name, faction: p.faction || 'mole' }))
    ];

    const specs = [];
    for (let i = 0; i < setup.moles; i++) specs.push({ team: 'mole', cls: 'mole', connId: null, name: null });
    for (const cls of setup.defenderClasses) specs.push({ team: 'def', cls, connId: null, name: null });

    // 1. przebieg: kazdy gracz probuje trafic w wolny slot swojej DOKLADNEJ klasy
    const unplaced = [];
    for (const p of allPlayers) {
      const slot = specs.find(s => !s.connId && s.cls === p.faction);
      if (slot) { slot.connId = p.connId; slot.name = p.name; }
      else unplaced.push(p);
    }
    // 2. przebieg (rezerwowy): gracz nie zmiescil sie w slocie swojej DOKLADNEJ klasy
    // (np. wybral Psa w formacie 3v1, ktory nie ma ani jednego slotu psa) — dostaje
    // jakikolwiek wolny slot tej samej druzyny, a w ostatecznosci jakikolwiek wolny
    // slot. Bez tego zostalby bez postaci, a _buildFromSpecs wywalaloby sie na
    // localActor===null (patrz test w README) — kazdy podlaczony gracz MUSI dostac aktora.
    for (const p of unplaced) {
      const wantTeam = p.faction === 'mole' ? 'mole' : 'def';
      const slot = specs.find(s => !s.connId && s.team === wantTeam) || specs.find(s => !s.connId);
      if (slot) { slot.connId = p.connId; slot.name = p.name; }
      // nadmiarowi gracze (wiecej ludzi niz slotow w formacie) zostaja bez aktora —
      // patrz zabezpieczenie na koniec _buildFromSpecs
    }

    this._buildFromSpecs(specs, setup, { myConnId: this.net.id, vegSpots: null });

    // teraz, gdy pozycje startowe i losowe imiona botow sa juz ustalone, dopisujemy
    // je do specs i rozsylamy — gosc MUSI dostac te same wartosci: pozycje, bo jego
    // wlasna postac (przewidywana lokalnie, bez korekty z sieci) startowalaby w innym
    // miejscu niz u hosta; imiona botow, bo inaczej kazdy klient wylosowalby inne
    const fullSpecs = specs.map((s, i) => ({
      ...s, name: this.actors[i].name, spawn: { x: this.actors[i].x, z: this.actors[i].z }
    }));
    this.net.sendStart(setup, fullSpecs, this.vegetables.serializeSpawn());
  }

  /** Gosc: buduje DOKLADNIE ten sam mecz, ktory host wlasnie rozeslal. */
  startMatchGuest(setup, specs, vegSpots) {
    this.cleanup();
    this.netRole = 'guest';
    this._buildFromSpecs(specs, setup, { myConnId: this.net.id, vegSpots });
  }

  /**
   * Wspolny budowniczy meczu SIECIOWEGO (host i gosc). Kolejnosc `specs` jest
   * ZAWSZE identyczna u obu stron (host generuje ja raz i rozsyla), wiec kazdy
   * aktor ma ten sam indeks w `this.actors` wszedzie — to na tym opiera sie
   * cala reszta synchronizacji (snapshoty adresuja aktorow po indeksie).
   */
  _buildFromSpecs(specs, setup, { myConnId = null, vegSpots = null } = {}) {
    this.format = setup;
    this.vegetablesToWin = setup.vegetablesToWin;
    this.delivered = 0;
    this.catches = 0;
    this.timeLeft = setup.duration;
    this.countdown = MATCH.countdown;
    this.state = 'countdown';
    this.running = true;
    this.paused = false;
    this.time = 0;
    this._warned30 = false;
    this._lastDelivered = 0;
    this._winner = null;
    this._winReason = null;
    this.remoteCommands.clear();

    this.vegetables = new VegetableSystem(this.scene, this.world, MATCH.vegetableCount, vegSpots);

    const spawnAt = (list, i) => {
      const base = list[i % list.length];
      const ring = Math.floor(i / list.length);
      if (ring === 0) return base;
      const ang = i * 2.39996;
      return { x: base.x + Math.cos(ang) * 1.7 * ring, z: base.z + Math.sin(ang) * 1.7 * ring };
    };

    let moleIdx = 0, defIdx = 0;
    for (const spec of specs) {
      const isMine = !!spec.connId && spec.connId === myConnId;
      if (spec.team === 'mole') {
        const spawn = spec.spawn || spawnAt(this.world.moleSpawns, moleIdx);
        const mole = new Mole(this, {
          name: spec.name || (isMine ? 'Ty' : pick(MOLE_NAMES) + ' ' + (moleIdx + 1)),
          isLocal: isMine, stats: cloneStats(MOLE), spawn,
          tint: isMine ? 0x5a4a3c : [0x4a4038, 0x3d3630, 0x554a40][moleIdx % 3],
          hat: null
        });
        mole.netId = spec.connId || null;
        this.actors.push(mole);
        moleIdx++;
      } else {
        const spawn = spec.spawn || spawnAt(this.world.defenderSpawns, defIdx);
        const Ctor = spec.cls === 'dog' ? Dog : Gardener;
        const def = new Ctor(this, {
          name: spec.name || (isMine ? 'Ty' : (spec.cls === 'dog' ? pick(DOG_NAMES) : pick(GARDENER_NAMES))),
          isLocal: isMine, stats: cloneStats(spec.cls === 'dog' ? DOG : GARDENER), spawn,
          coat: [0xb5763c, 0x6d6156, 0x2f2a26][defIdx % 3],
          hat: null
        });
        def.netId = spec.connId || null;
        this.actors.push(def);
        defIdx++;
      }
      if (isMine) this.localActor = this.actors[this.actors.length - 1];
    }

    // Zabezpieczenie: jesli podlaczonych graczy jest wiecej niz slotow w tym
    // formacie, ten klient moglby nie dostac zadnego aktora — bez tej strazy
    // dalszy kod (np. this.localActor.cls nizej) rzucalby wyjatkiem zamiast
    // pokazac czytelny komunikat. Host dobiera format pod liczbe graczy, wiec
    // to sytuacja brzegowa, nie normalna sciezka.
    if (!this.localActor) {
      this.cleanup();
      this.ui.showMenu();
      this.ui.flashHint('Brak wolnego miejsca w tym formacie meczu — host musi zwiększyć skład.', 4);
      return;
    }

    // sloty bez podlaczonego gracza dostaja bota (dokladnie jak w grze solo)
    for (const a of this.actors) {
      if (!a.netId && !a.isLocal) this.brains.set(a.id, makeBrain(this, a));
    }

    this.moleCount = setup.moles;
    this.molesAlive = setup.moles;

    for (let i = 0; i < setup.moles; i++) {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.75, 1.05, 20),
        new THREE.MeshBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: .8, depthWrite: false, side: THREE.DoubleSide })
      );
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.15;
      m.visible = false;
      m.layers.set(LAYER.SURFACE);
      this.scene.add(m);
      this.revealMarkers.push(m);
    }

    this.scent.setVisible(this.localActor.cls === 'dog');
    this.setLocalUnderground(false);
    this.rig.snapTo({ x: this.localActor.x, y: 0, z: this.localActor.z });

    this.input.setEnabled(true);
    this.ui.showHud(this.localActor, this.input);
    this.ui.banner('PRZYGOTUJ SIĘ', 1);
    this.audio.unlock();
  }

  cleanup() {
    for (const a of this.actors) a.dispose();
    this.actors.length = 0;
    this.brains.clear();
    this.localActor = null;
    for (const m of this.revealMarkers) disposeObject(m);
    this.revealMarkers.length = 0;
    for (const t of [...this.traps.items]) this.traps.remove(t);
    for (let i = this.projectiles.items.length - 1; i >= 0; i--) this.projectiles._remove(i);
    if (this.vegetables) {
      for (const v of this.vegetables.list) disposeObject(v.mesh);
      this.vegetables = null;
    }
    this.mounds.items.forEach(m => { m.alive = false; m.target = 0; m.scale = 0; });
    this.mounds.update(0.016);
  }

  quitToMenu() {
    this.running = false;
    this.state = 'menu';
    this.netRole = null;
    this.net?.disconnect();
    this.input.setEnabled(false);
    this.cleanup();
    this.setLocalUnderground(false);
    this.ui.showMenu();
  }

  /* ------------------------------------------------- zdarzenia rozgrywki */

  setLocalUnderground(under) {
    this.rig.setUnderground(under);
    this.postfx.setUnderground(under);
    const target = under ? this.soilColor : this.skyColor;
    this.scene.background.copy(target);
    this.scene.fog.color.copy(target);
    this.scene.fog.near = under ? 6 : 60;
    this.scene.fog.far = under ? 34 : 145;
  }

  onVegetableDelivered(mole, burrow) {
    this.delivered++;
    this.audio.play('deliver');
    const fx = Eco.equippedCosmetic('fx');
    this.particles.celebrate(burrow.x, burrow.z, fx ? fx.color : 0xff8a3d);
    this.ripples.pulse(burrow.x, burrow.z, 5, 0xffd166);
    this.rig.shake(0.3);
    this.ui.banner(`WARZYWO W NORZE  ${this.delivered}/${this.vegetablesToWin}`, 1.2);
    // gosc NIGDY sam nie rozstrzyga wygranej — dostanie ja snapshotem/polem 'state'
    // od hosta (patrz netsync.applySnapshot); tu policzylby ja tylko podwojnie
    if (this.netRole !== 'guest' && this.delivered >= this.vegetablesToWin) {
      this.finish('mole', 'Krety wyniosły plony!');
    }
  }

  onActorDown(actor, source) {
    actor.group.visible = false;
    if (actor.team === 'mole') {
      this.molesAlive--;
      this.catches += source && source.isLocal ? 1 : 0;
      this.audio.play('alarm');
      this.ui.banner(`${actor.name} złapany!`, 1.2);
      if (actor.isLocal) {
        this.ui.flashHint('Zostałeś złapany — obserwujesz resztę drużyny', 3);
        this.setLocalUnderground(false);
      }
      if (this.netRole !== 'guest' && this.molesAlive <= 0) this.finish('def', 'Wszystkie krety złapane!');
    } else {
      this.ui.banner(`${actor.name} pada!`, 1.2);
    }
  }

  /** Kradziez warzywa zdradza pozycje — wszyscy obroncy dostaja namiar. */
  alertDefenders(x, z, mole) {
    this.ripples.pulse(x, z, 4.5, 0xff6b6b);
    this.audio.play('alarm', 0.4, this.distanceToCamera(x, z));
    for (const a of this.actors) {
      if (a.team !== 'def' || !a.alive) continue;
      const brain = this.brains.get(a.id);
      if (brain) brain.lastKnown = { x, z, at: this.time };
      if (a.isLocal) this.ui.flashHint('Ktoś wyrywa warzywo z grządki!');
    }
    if (mole && mole.isLocal) this.ui.flashHint('Kradzież narobiła hałasu — uciekaj!');
  }

  markReveal(mole) {
    const idx = this.actors.filter(a => a.team === 'mole').indexOf(mole);
    const marker = this.revealMarkers[idx];
    if (!marker) return;
    marker.visible = true;
    marker.position.set(mole.x, 0.15, mole.z);
    marker.scale.setScalar(1 + Math.sin(this.time * 8) * 0.12);
    marker.material.opacity = 0.45 + Math.sin(this.time * 8) * 0.3;
    marker.userData.until = this.time + 0.1;
  }

  finish(winner, reason) {
    if (this.state === 'over') return;
    this.state = 'over';
    this.running = false;
    this.input.setEnabled(false);
    this._winner = winner;
    this._winReason = reason;   // dolaczane do kazdego kolejnego snapshotu, zeby gosc znal tekst konca meczu

    const localTeam = this.localActor ? this.localActor.team : 'mole';
    const won = winner === localTeam;
    this.audio.play(won ? 'win' : 'lose');

    const playedAsMole = this.localActor && this.localActor.team === 'mole';
    const reward = Eco.awardMatch({
      won,
      vegetables: playedAsMole ? this.localActor.stats_delivered : 0,
      catches: playedAsMole ? 0 : this.catches
    });

    const stats = [
      ['Warzywa dowiezione', `${this.delivered} / ${this.vegetablesToWin}`],
      ['Krety w grze', `${this.molesAlive} / ${this.moleCount}`],
      ['Czas do końca', `${Math.max(0, Math.ceil(this.timeLeft))}s`]
    ];
    if (this.localActor) {
      stats.push(this.localActor.team === 'mole'
        ? ['Twoje dostawy', String(this.localActor.stats_delivered)]
        : ['Twoje złapania', String(this.catches)]);
    }

    setTimeout(() => {
      this.ui.showEnd({
        win: won,
        title: winner === 'mole' ? 'KRETY WYGRYWAJĄ' : 'OBROŃCY WYGRYWAJĄ',
        subtitle: reason,
        stats, reward
      });
    }, 900);
  }

  /* ------------------------------------------------------------ PETLA */

  update(dt) {
    this.ui.update(dt);

    if (this.state === 'menu') {
      this.time += dt;
      this.burrows.update(dt);
      this.particles.update(dt);
      this.mounds.update(dt);
      this.menuCamera(dt);
      return;
    }

    // Pauza tylko w grze solo — hosta pauza zatrzymalaby wysylanie snapshotow
    // i zamrozila mecz wszystkim podlaczonym gosciom (gosc i tak nie odpala
    // tej metody, patrz updateGuest()).
    if (this.netRole === null) {
      if (this.input.escapePressed && this.state !== 'over') {
        this.paused = !this.paused;
        this.input.setEnabled(!this.paused);
        if (this.paused) this.ui.banner('PAUZA — ESC wznawia, BACKSPACE = menu', 9999);
        else this.ui.banner('', 0.01);
      }
      if (this.paused) {
        if (this.backspaceQuit) { this.backspaceQuit = false; this.quitToMenu(); }
        return;
      }
    }

    this.time += dt;

    if (this.state === 'countdown') {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const after = Math.ceil(this.countdown);
      if (after !== before && after > 0) {
        this.ui.banner(String(after), 0.9);
        this.audio.play('countdown');
      }
      if (this.countdown <= 0) {
        this.state = 'playing';
        this.ui.banner('START!', 1);
        this.audio.play('start');
      }
    } else if (this.state === 'playing') {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.finish('def', 'Czas minął — grządki obronione!');
      }
      if (this.timeLeft > 0 && this.timeLeft < 30 && !this._warned30) {
        this._warned30 = true;
        this.ui.banner('OSTATNIE 30 SEKUND', 1.4);
      }
    }

    const playing = this.state === 'playing';

    // ---- postacie
    for (const marker of this.revealMarkers) {
      if (marker.visible && (marker.userData.until ?? 0) < this.time) marker.visible = false;
    }

    for (const a of this.actors) {
      if (!a.alive) continue;
      let cmd = EMPTY_COMMAND;
      if (playing) {
        if (a.isLocal) cmd = this.input.buildCommand(this.camera, a);
        else if (a.netId) {
          // Komenda wygasa: bez tego postac gracza, ktoremu zamarzla karta,
          // biegla by w nieskonczonosc ostatnim otrzymanym kierunkiem. Na telefonie
          // to pewniak — przelaczenie aplikacji dlawi requestAnimationFrame,
          // wiec komendy po prostu przestaja przychodzic.
          const rc = this.remoteCommands.get(a.netId);
          cmd = rc && this.time - rc.at < REMOTE_CMD_TTL ? rc.cmd : EMPTY_COMMAND;
        }
        else {
          const brain = this.brains.get(a.id);
          cmd = brain ? brain.think(dt) : EMPTY_COMMAND;
        }
      }
      a.update(dt, cmd);
    }

    // ---- systemy
    this.vegetables?.update(dt);
    this.mounds.update(dt);
    this.burrows.update(dt);
    this.particles.update(dt);
    this.ripples.update(dt);
    this.scent.update(dt);
    this.traps.update(dt);
    this.projectiles.update(dt);

    // ---- lokalny gracz: zaklocenia, kamera, podpowiedzi
    const view = this.viewTarget();
    if (view) {
      this.rig.follow({ x: view.x, y: view.y, z: view.z }, dt);
      // latarnia podziemna trzyma sie obserwowanej postaci
      if (this.world.undergroundLamp) {
        this.world.undergroundLamp.position.set(view.x, ARENA.undergroundY + 3, view.z);
      }
    }

    if (this.localActor && this.localActor.alive) {
      const a = this.localActor;
      if (a.team === 'mole') {
        this.postfx.setDisturb(a.underground ? this.traps.disturbanceAt(a.x, a.z) : 0);
        this.postfx.setStun(a.stunned ? 1 : 0);
      }
      this.ui.setHint(a.contextHint ? a.contextHint() : '');
    }

    this.postfx.update(dt);
    this.ui.updateHud(this);

    // Celowo BEZ dodatkowego warunku na stan meczu: 'menu' juz odcial wczesniejszy
    // return na gorze update(), wiec tutaj stan to zawsze countdown/playing/over.
    // Musimy wysylac tez w 'over' — inaczej klatka, na ktorej finish() przelaczyl
    // stan (w petli aktorow, powyzej), byla by OSTATNIA wyslana, a przejscie do
    // 'over' nigdy by realnie nie dotarlo do goscia (patrz historia buga w README).
    if (this.netRole === 'host') {
      this._netAccum += dt;
      if (this._netAccum >= 1 / SNAPSHOT_HZ) {
        this._netAccum = 0;
        this.net.sendSnapshot(serializeSnapshot(this));
      }
    }
  }

  /**
   * Petla klatki dla goscia — bez botow, bez rozstrzygania wygranej. Wlasna
   * postac dostaje pelna, lokalna symulacje (predykcja, jak w grze solo) i co
   * klatke wysyla swoj Command do hosta; wszyscy pozostali aktorzy to czysty
   * playback snapshotow z applySnapshot() (patrz Actor.applyNetworkState).
   */
  updateGuest(dt) {
    this.ui.update(dt);
    if (this.state === 'menu' || this.paused) return;
    this.time += dt;

    for (const marker of this.revealMarkers) {
      if (marker.visible && (marker.userData.until ?? 0) < this.time) marker.visible = false;
    }

    const playing = this.state === 'playing';
    for (const a of this.actors) {
      if (a === this.localActor) {
        if (!a.alive) continue;
        const cmd = playing ? this.input.buildCommand(this.camera, a) : EMPTY_COMMAND;
        a.update(dt, cmd);
        if (playing) this.net.sendCommand(cmd);
      } else if (a._netTarget) {
        a.applyNetworkState(a._netTarget, dt);
      }
    }

    this.vegetables?.update(dt);
    this.mounds.update(dt);
    this.burrows.update(dt);
    this.particles.update(dt);
    this.ripples.update(dt);
    this.scent.update(dt);
    this.traps.update(dt);
    this.projectiles.update(dt);

    const view = this.viewTarget();
    if (view) {
      this.rig.follow({ x: view.x, y: view.y, z: view.z }, dt);
      if (this.world.undergroundLamp) {
        this.world.undergroundLamp.position.set(view.x, ARENA.undergroundY + 3, view.z);
      }
    }

    if (this.localActor && this.localActor.alive) {
      const a = this.localActor;
      if (a.team === 'mole') {
        this.postfx.setDisturb(a.underground ? this.traps.disturbanceAt(a.x, a.z) : 0);
        this.postfx.setStun(a.stunned ? 1 : 0);
      }
      this.ui.setHint(a.contextHint ? a.contextHint() : '');
    }

    this.postfx.update(dt);
    this.ui.updateHud(this);
  }

  /** Kogo obserwuje kamera (po smierci — kolejnego zywego z druzyny). */
  viewTarget() {
    if (this.localActor && this.localActor.alive) return this.localActor;
    const team = this.localActor ? this.localActor.team : 'mole';
    return this.actors.find(a => a.alive && a.team === team) || this.actors.find(a => a.alive) || null;
  }

  /** Powolny obrot kamery nad arena w menu. */
  menuCamera(dt) {
    const t = this.time * 0.12;
    const r = 34;
    this.camera.position.set(Math.cos(t) * r, 22, Math.sin(t) * r);
    this.camera.lookAt(0, 0, 0);
  }

  render() {
    this.postfx.render();
  }
}
