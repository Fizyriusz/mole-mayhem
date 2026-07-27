/**
 * Object_Vegetable — warzywo z kolizja i "HP" (postep wykopywania).
 * Podniesione warzywo jest DOCZEPIANE do kreta w drzewie sceny (kret.add(mesh)),
 * dzieki czemu porusza sie razem z nim bez zadnej logiki w update() — tak jak w GDD.
 */
import * as THREE from 'three';
import { LAYER } from '../core/config.js';
import { setLayerDeep } from './arena.js';

const REGROW_TIME = 18;   // po ilu sekundach warzywo odrasta na swojej grzadce

const KINDS = [
  { id: 'carrot', name: 'Marchewka', build: buildCarrot },
  { id: 'cabbage', name: 'Kapusta', build: buildCabbage },
  { id: 'beet', name: 'Burak', build: buildBeet }
];

function buildCarrot() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.ConeGeometry(0.28, 1.1, 8),
    new THREE.MeshStandardMaterial({ color: 0xff7a24, roughness: 0.7, flatShading: true })
  );
  body.rotation.x = Math.PI;
  body.position.y = 0.55;
  g.add(body);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x4fae37, roughness: 0.9, flatShading: true });
  for (let i = 0; i < 4; i++) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.75, 5), leafMat);
    leaf.position.set(Math.cos(i * 1.57) * 0.14, 1.35, Math.sin(i * 1.57) * 0.14);
    leaf.rotation.set(Math.cos(i * 1.57) * 0.42, 0, -Math.sin(i * 1.57) * 0.42);
    g.add(leaf);
  }
  return g;
}

function buildCabbage() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x8fd06a, roughness: 0.85, flatShading: true });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.46, 0), mat);
  core.position.y = 0.5;
  g.add(core);
  const outer = new THREE.MeshStandardMaterial({ color: 0x5aa73f, roughness: 0.9, flatShading: true });
  for (let i = 0; i < 5; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.3, 5, 4, 0, Math.PI), outer);
    const a = i * 1.256;
    leaf.position.set(Math.cos(a) * 0.36, 0.3, Math.sin(a) * 0.36);
    leaf.rotation.set(-1.1, -a, 0);
    g.add(leaf);
  }
  return g;
}

function buildBeet() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xa32d6b, roughness: 0.65, flatShading: true })
  );
  body.scale.y = 1.15;
  body.position.y = 0.45;
  g.add(body);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f8f34, roughness: 0.9, flatShading: true, side: THREE.DoubleSide });
  for (let i = 0; i < 3; i++) {
    const leaf = new THREE.Mesh(new THREE.CircleGeometry(0.32, 6), leafMat);
    leaf.position.set(Math.cos(i * 2.1) * 0.16, 0.95, Math.sin(i * 2.1) * 0.16);
    leaf.rotation.set(-0.9, i * 2.1, 0);
    g.add(leaf);
  }
  return g;
}

export class VegetableSystem {
  /**
   * @param {Array<{x:number,z:number,kind:string}>|null} fixedSpots — gdy podane
   *   (mecz sieciowy, gosc), pomija losowanie i buduje DOKLADNIE ta liste, ktora
   *   wygenerowal host (serializeSpawn) — inaczej pozycje warzyw rozjechalyby sie
   *   miedzy klientami, bo Math.random() nie jest tu zsynchronizowany.
   */
  constructor(scene, world, count, fixedSpots = null) {
    this.scene = scene;
    this.world = world;
    this.list = [];
    this.time = 0;
    if (fixedSpots) this._spawnFixed(fixedSpots);
    else this._spawn(count);
  }

  _place(index, x, z, kind) {
    const mesh = kind.build();
    mesh.position.set(x, 0.12, z);
    mesh.rotation.y = Math.random() * Math.PI * 2;   // czysto kosmetyczny obrot, wolno mu sie roznic
    mesh.traverse(o => { if (o.isMesh) o.castShadow = true; });
    setLayerDeep(mesh, LAYER.SURFACE);
    this.scene.add(mesh);

    this.list.push({
      id: index,
      kind: kind.id,
      name: kind.name,
      mesh,
      state: 'plot',      // plot | carried | dropped | delivered
      carrier: null,
      hp: 100,            // "HP" warzywa = postep wykopywania
      home: { x, z },
      bobPhase: Math.random() * 6.28
    });
  }

  _spawnFixed(spots) {
    for (let i = 0; i < spots.length; i++) {
      const kind = KINDS.find(k => k.id === spots[i].kind) || KINDS[0];
      this._place(i, spots[i].x, spots[i].z, kind);
    }
  }

  _spawn(count) {
    const spots = [];
    for (const plot of this.world.plots) {
      const cols = Math.max(2, Math.floor(plot.w / 2.6));
      const rows = Math.max(2, Math.floor(plot.d / 2.6));
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          spots.push({
            x: plot.x - plot.w / 2 + 1.3 + c * (plot.w - 2.6) / Math.max(1, cols - 1),
            z: plot.z - plot.d / 2 + 1.3 + r * (plot.d - 2.6) / Math.max(1, rows - 1)
          });
        }
      }
    }
    // losowa selekcja pozycji
    for (let i = spots.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [spots[i], spots[j]] = [spots[j], spots[i]];
    }

    for (let i = 0; i < Math.min(count, spots.length); i++) {
      const kind = KINDS[(Math.random() * KINDS.length) | 0];
      this._place(i, spots[i].x, spots[i].z, kind);
    }
  }

  /** Lista pozycji/gatunkow do rozeslania gosciom (zeby zbudowali identyczna grzadke). */
  serializeSpawn() {
    return this.list.map(v => ({ x: v.home.x, z: v.home.z, kind: v.kind }));
  }

  update(dt) {
    this.time += dt;
    for (const v of this.list) {
      if (v.state === 'plot' || v.state === 'dropped') {
        v.mesh.rotation.y += dt * 0.35;
        v.mesh.position.y = (v.state === 'plot' ? 0.12 : 0.22) + Math.sin(this.time * 2 + v.bobPhase) * 0.06;
      } else if (v.state === 'delivered' && this.time >= v.regrowAt) {
        this.regrow(v);
      }
    }
  }

  /** Ogród nie jest studnią bez dna, ale też się nie wyczerpuje — warzywa odrastają. */
  regrow(v) {
    v.state = 'plot';
    v.hp = 100;
    v.mesh.scale.setScalar(1);
    v.mesh.position.set(v.home.x, 0.12, v.home.z);
    setLayerDeep(v.mesh, LAYER.SURFACE);
    this.scene.add(v.mesh);
  }

  /** Doczepienie do kreta w hierarchii sceny (GDD 4.B). */
  attachTo(v, actor) {
    v.state = 'carried';
    v.carrier = actor;
    actor.group.add(v.mesh);
    // +Z to przod postaci — warzywo ma byc w lapach, nie za plecami
    v.mesh.position.set(0, 1.05, 0.4);
    v.mesh.rotation.set(-0.35, 0, 0);
    v.mesh.scale.setScalar(0.8);
    // warzywo dziedziczy warstwe nosiciela (zeby zniknelo razem z nim pod ziemia)
    setLayerDeep(v.mesh, actor.underground ? LAYER.UNDER : LAYER.SURFACE);
  }

  drop(v, x, z) {
    if (v.mesh.parent) v.mesh.parent.remove(v.mesh);
    this.scene.add(v.mesh);
    v.mesh.position.set(x, 0.22, z);
    v.mesh.scale.setScalar(0.85);
    v.mesh.rotation.set(0, Math.random() * 6.28, 0);
    setLayerDeep(v.mesh, LAYER.SURFACE);
    v.state = 'dropped';
    v.carrier = null;
    v.hp = 100;
  }

  deliver(v) {
    if (v.mesh.parent) v.mesh.parent.remove(v.mesh);
    v.state = 'delivered';
    v.carrier = null;
    v.regrowAt = this.time + REGROW_TIME;
  }

  /** Najblizsze dostepne warzywo (dla AI kretow). */
  nearestAvailable(x, z, maxDist = Infinity) {
    let best = null, bestD = maxDist;
    for (const v of this.list) {
      if (v.state !== 'plot' && v.state !== 'dropped') continue;
      const d = Math.hypot(v.mesh.position.x - x, v.mesh.position.z - z);
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }

  /** Warzywo w zasiegu podniesienia. */
  inRange(x, z, r = 1.9) {
    let best = null, bestD = r;
    for (const v of this.list) {
      if (v.state !== 'plot' && v.state !== 'dropped') continue;
      const d = Math.hypot(v.mesh.position.x - x, v.mesh.position.z - z);
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }

  remaining() {
    return this.list.filter(v => v.state === 'plot' || v.state === 'dropped').length;
  }

  /**
   * Korekta stanu goscia wg snapshotu z hosta. Wywolywana raz na snapshot (nie co
   * klatke) — sprawdza kazde warzywo i tylko tam, gdzie stan lokalny nie zgadza
   * sie z hostem, odpala ten sam efekt co normalnie (attachTo/drop/regrow/deliver),
   * wiec gosc nie potrzebuje osobnej logiki wizualnej.
   */
  applyNetworkState(list, actors) {
    for (let i = 0; i < list.length && i < this.list.length; i++) {
      const v = this.list[i];
      const t = list[i];
      if (t.s === 2) {
        const carrier = actors[t.ci];
        if (carrier && (v.state !== 'carried' || v.carrier !== carrier)) this.attachTo(v, carrier);
      } else if (t.s === 1 && v.state !== 'dropped') {
        this.drop(v, t.x, t.z);
      } else if (t.s === 0 && v.state !== 'plot') {
        this.regrow(v);
      } else if (t.s === 3 && v.state !== 'delivered') {
        this.deliver(v);
      }
    }
  }
}
