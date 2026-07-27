/**
 * Budowa areny: warstwa powierzchni (LAYER.SURFACE) i warstwa podziemna (LAYER.UNDER).
 * Kamera przelacza widoczne warstwy zaleznie od tego, gdzie jest lokalny gracz —
 * to jest realizacja "Underground View" z GDD (ukrywanie warstw geometrycznych).
 */
import * as THREE from 'three';
import { ARENA, LAYER } from '../core/config.js';
import { grassTexture, soilTexture, undergroundTexture, woodTexture } from './textures.js';

export function setLayerDeep(obj, layer) {
  obj.traverse(o => o.layers.set(layer));
  return obj;
}

const rand = (a, b) => a + Math.random() * (b - a);

/**
 * Maly deterministyczny PRNG (mulberry32). Uklad przeszkod dekoracyjnych (skaly,
 * korzenie, kamienie podziemne) trafia do tablic kolizji — w meczu sieciowym
 * kazdy klient buduje wlasna arene niezaleznie, wiec musi wyjsc BIT W BIT tak
 * samo, inaczej gospodarz i gosc mieliby inne przeszkody blokujace ruch.
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ARENA_SEED = 1337;

/** Zadna przeszkoda nie moze wyladowac na norze ani na punkcie startowym postaci. */
function blockedSpot(world, x, z, pad = 4.5) {
  return world.burrows.some(b => Math.hypot(b.x - x, b.z - z) < pad + 2.5)
    || world.moleSpawns.some(s => Math.hypot(s.x - x, s.z - z) < pad)
    || world.defenderSpawns.some(s => Math.hypot(s.x - x, s.z - z) < pad);
}

export function buildArena(scene) {
  const world = {
    group: new THREE.Group(),
    surface: new THREE.Group(),
    under: new THREE.Group(),
    obstaclesSurface: [],   // { x, z, r } lub { x, z, hw, hd }
    obstaclesUnder: [],
    plots: [],              // { x, z, w, d } — grzadki, tu rosna warzywa
    burrows: [],            // { x, z } — nory ewakuacyjne kretow
    moleSpawns: [],
    defenderSpawns: [],
    bounds: ARENA.half - ARENA.wallInset
  };

  scene.add(world.group);
  world.group.add(world.surface, world.under);

  buildLights(scene, world);
  buildGround(world);
  buildUnderground(world);
  buildFence(world);
  buildPlots(world);
  buildBurrows(world);

  // Od tego miejsca uklad zalezy od losowania — podmieniamy Math.random na
  // deterministyczny seed, zeby host i gosc dostali identyczna geometrie.
  const realRandom = Math.random;
  Math.random = mulberry32(ARENA_SEED);
  try {
    buildProps(world);
    buildRoots(world);
  } finally {
    Math.random = realRandom;
  }

  setLayerDeep(world.surface, LAYER.SURFACE);
  setLayerDeep(world.under, LAYER.UNDER);

  // Cel dla DecalGeometry (slady zapachowe) musi lezec na warstwie powierzchni,
  // ale sam pozostaje niewidoczny.
  world.decalTarget = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA.size, ARENA.size, 14, 14),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  world.decalTarget.rotation.x = -Math.PI / 2;
  world.decalTarget.position.y = 0.1;    // ponad grzadkami, zeby slad byl wszedzie widoczny
  world.decalTarget.visible = false;
  world.decalTarget.updateMatrixWorld();
  scene.add(world.decalTarget);

  return world;
}

function buildLights(scene, world) {
  const hemi = new THREE.HemisphereLight(0xbfe4ff, 0x3a5a24, 1.05);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2d6, 2.1);
  sun.position.set(26, 40, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 120;
  const s = ARENA.half + 6;
  sun.shadow.camera.left = -s;
  sun.shadow.camera.right = s;
  sun.shadow.camera.top = s;
  sun.shadow.camera.bottom = -s;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.035;
  // kamera cieni domyslnie widzi tylko warstwe 0 — powierzchnia jest na warstwie 1
  sun.shadow.camera.layers.enable(LAYER.SURFACE);
  scene.add(sun);
  scene.add(sun.target);

  world.sun = sun;
  world.hemi = hemi;
}

function buildGround(world) {
  const mat = new THREE.MeshStandardMaterial({ map: grassTexture(30), roughness: 0.96, metalness: 0 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(ARENA.size, ARENA.size, 1, 1), mat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  world.surface.add(ground);
  world.ground = ground;

  // trawa poza plotem (kontekst, bez kolizji)
  const outer = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA.size * 3, ARENA.size * 3),
    new THREE.MeshStandardMaterial({ map: grassTexture(80), roughness: 1 })
  );
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.05;
  world.surface.add(outer);
}

function buildUnderground(world) {
  // "podloga" tunelu — to na nia patrzymy w widoku podziemnym
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA.size, ARENA.size, 1, 1),
    new THREE.MeshStandardMaterial({ map: undergroundTexture(14), roughness: 1 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = ARENA.undergroundY - 0.85;
  world.under.add(floor);

  // Swiatla na warstwie UNDER sa zbierane przez renderer tylko wtedy, gdy kamera
  // ma wlaczona te warstwe — czyli nie rozjasniaja widoku z powierzchni.
  const ambient = new THREE.HemisphereLight(0xffcf9a, 0x3a2412, 2.1);
  ambient.layers.set(LAYER.UNDER);
  world.under.add(ambient);

  const glow = new THREE.PointLight(0xffb066, 40, 60, 1.1);
  glow.position.set(0, ARENA.undergroundY + 5, 0);
  glow.layers.set(LAYER.UNDER);
  world.under.add(glow);
  world.undergroundLight = glow;

  // latarka podazajaca za graczem — dodawana do sceny przez Game
  const lamp = new THREE.PointLight(0xffc98a, 26, 26, 1.3);
  lamp.layers.set(LAYER.UNDER);
  lamp.position.set(0, ARENA.undergroundY + 3, 0);
  world.under.add(lamp);
  world.undergroundLamp = lamp;
}

function buildFence(world) {
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture(1), roughness: 0.85 });
  const half = ARENA.half;
  const post = new THREE.BoxGeometry(0.35, 2.0, 0.35);
  const rail = new THREE.BoxGeometry(1, 0.18, 0.16);

  const fence = new THREE.Group();
  const step = 2.4;
  for (let side = 0; side < 4; side++) {
    for (let i = -half; i <= half; i += step) {
      const p = new THREE.Mesh(post, wood);
      const along = i;
      if (side === 0) p.position.set(along, 1, -half);
      if (side === 1) p.position.set(along, 1, half);
      if (side === 2) p.position.set(-half, 1, along);
      if (side === 3) p.position.set(half, 1, along);
      p.rotation.y = side >= 2 ? Math.PI / 2 : 0;
      p.castShadow = true;
      fence.add(p);

      for (const h of [0.75, 1.45]) {
        const r = new THREE.Mesh(rail, wood);
        r.scale.x = step;
        r.position.copy(p.position).setY(h);
        if (side >= 2) { r.rotation.y = Math.PI / 2; r.position.z += step / 2; }
        else r.position.x += step / 2;
        fence.add(r);
      }
    }
  }
  world.surface.add(fence);

  // zywoplot przy plocie — dekoracja + przeszkoda (z dala od nor w naroznikach)
  const hedgeMat = new THREE.MeshStandardMaterial({ color: 0x2c5c22, roughness: 1, flatShading: true });
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const hedge = new THREE.Mesh(new THREE.BoxGeometry(6, 1.6, 1.6), hedgeMat);
    hedge.position.set(sx * 9, 0.8, sz * (half - 4.5));
    hedge.castShadow = hedge.receiveShadow = true;
    world.surface.add(hedge);
    world.obstaclesSurface.push({ x: hedge.position.x, z: hedge.position.z, hw: 3, hd: 0.8 });
  }
}

function buildPlots(world) {
  const soil = new THREE.MeshStandardMaterial({ map: soilTexture(3), roughness: 1 });
  const frameMat = new THREE.MeshStandardMaterial({ map: woodTexture(1), roughness: 0.9 });

  const layout = [
    { x: -14, z: -13, w: 12, d: 8 },
    { x: 15, z: -12, w: 10, d: 9 },
    { x: -15, z: 12, w: 11, d: 8 },
    { x: 14, z: 14, w: 12, d: 7 },
    { x: 0, z: 0, w: 9, d: 9 }
  ];

  for (const p of layout) {
    // grzadka jest plaska — dzieki temu pierscienie postaci i slady zapachowe
    // (decale) leza NAD nia, a nie w srodku bryly
    const bed = new THREE.Mesh(new THREE.BoxGeometry(p.w, 0.08, p.d), soil);
    bed.position.set(p.x, 0.04, p.z);
    bed.receiveShadow = true;
    world.surface.add(bed);

    // niski drewniany obrzeze grzadki
    for (const [dx, dz, sw, sd] of [[0, -p.d / 2, p.w, 0.3], [0, p.d / 2, p.w, 0.3], [-p.w / 2, 0, 0.3, p.d], [p.w / 2, 0, 0.3, p.d]]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(sw, 0.3, sd), frameMat);
      f.position.set(p.x + dx, 0.15, p.z + dz);
      f.castShadow = f.receiveShadow = true;
      world.surface.add(f);
    }
    world.plots.push(p);
  }
}

function buildBurrows(world) {
  const b = ARENA.half - 5;
  const spots = [{ x: -b, z: -b }, { x: b, z: -b }, { x: -b, z: b }, { x: b, z: b }];
  world.burrows = spots;
  world.moleSpawns = spots.map(s => ({ x: s.x * 0.86, z: s.z * 0.86 }));
  world.defenderSpawns = [{ x: 0, z: -6 }, { x: 0, z: 6 }, { x: -6, z: 0 }, { x: 6, z: 0 }];
}

function buildProps(world) {
  const trunkMat = new THREE.MeshStandardMaterial({ map: woodTexture(1), roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f7a2a, roughness: 1, flatShading: true });
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a8a86, roughness: 0.95, flatShading: true });

  const treeSpots = [[-24, 0], [24, 2], [-3, -24], [6, 24], [-17, -7], [16, 7]];
  for (const [x, z] of treeSpots) {
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.62, 3.4, 7), trunkMat);
    trunk.position.y = 1.7;
    trunk.castShadow = true;
    tree.add(trunk);
    for (let i = 0; i < 3; i++) {
      const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(1.7 - i * 0.28, 0), leafMat);
      blob.position.set(rand(-.7, .7), 3.4 + i * 1.05, rand(-.7, .7));
      blob.castShadow = true;
      tree.add(blob);
    }
    tree.position.set(x, 0, z);
    world.surface.add(tree);
    world.obstaclesSurface.push({ x, z, r: 0.9 });
    // korzen pod drzewem blokuje takze tunel
    world.obstaclesUnder.push({ x, z, r: 1.7 });
  }

  for (let i = 0; i < 14; i++) {
    const x = rand(-26, 26), z = rand(-26, 26);
    if (Math.hypot(x, z) < 8 || blockedSpot(world, x, z)) continue;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.5, 1.1), 0), rockMat);
    rock.position.set(x, 0.25, z);
    rock.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
    rock.castShadow = rock.receiveShadow = true;
    world.surface.add(rock);
    world.obstaclesSurface.push({ x, z, r: 0.85 });
  }

  // szopka ogrodnika (spawn obroncow)
  const shed = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ map: woodTexture(2), roughness: 0.9 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 4), wallMat);
  body.position.y = 1.5;
  body.castShadow = body.receiveShadow = true;
  shed.add(body);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(4.2, 1.8, 4), new THREE.MeshStandardMaterial({ color: 0x8a3b2a, roughness: .9, flatShading: true }));
  roof.position.y = 3.9;
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  shed.add(roof);
  shed.position.set(0, 0, -22);
  world.surface.add(shed);
  world.obstaclesSurface.push({ x: 0, z: -22, hw: 2.5, hd: 2 });

  // studnia (dekoracja)
  const well = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.6, 1.2, 12), rockMat);
  ring.position.y = 0.6;
  ring.castShadow = true;
  well.add(ring);
  const water = new THREE.Mesh(new THREE.CircleGeometry(1.3, 16), new THREE.MeshStandardMaterial({ color: 0x2a6ea8, roughness: .2, metalness: .3 }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = 1.05;
  well.add(water);
  well.position.set(20, 0, -22);
  world.surface.add(well);
  world.obstaclesSurface.push({ x: 20, z: -22, r: 1.7 });
  world.wellPosition = new THREE.Vector3(20, 0, -22);
}

function buildRoots(world) {
  // Korzenie: przeszkody widoczne WYLACZNIE w widoku podziemnym (GDD).
  const rootMat = new THREE.MeshStandardMaterial({ color: 0x6b4a26, roughness: 1, flatShading: true });
  const y = ARENA.undergroundY;

  for (let i = 0; i < 26; i++) {
    const x = rand(-27, 27), z = rand(-27, 27);
    if (Math.hypot(x, z) < 6) continue;
    if (blockedSpot(world, x, z, 6)) continue;

    const root = new THREE.Group();
    const seg = 2 + ((Math.random() * 3) | 0);
    let px = 0, pz = 0;
    for (let s = 0; s < seg; s++) {
      const len = rand(1.6, 3.4);
      const th = rand(0.22, 0.5);
      const piece = new THREE.Mesh(new THREE.CylinderGeometry(th * 0.7, th, len, 6), rootMat);
      const ang = rand(0, Math.PI * 2);
      piece.position.set(px, rand(-0.2, 1.4), pz);
      piece.rotation.set(rand(-0.5, 0.5), ang, Math.PI / 2 + rand(-0.4, 0.4));
      root.add(piece);
      px += Math.cos(ang) * len * 0.5;
      pz += Math.sin(ang) * len * 0.5;
    }
    root.position.set(x, y, z);
    world.under.add(root);
    world.obstaclesUnder.push({ x, z, r: 1.25 });
  }

  // kamienie podziemne
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x6d6660, roughness: 1, flatShading: true });
  for (let i = 0; i < 14; i++) {
    const x = rand(-26, 26), z = rand(-26, 26);
    if (Math.hypot(x, z) < 7 || blockedSpot(world, x, z, 6)) continue;
    const st = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.8, 1.5), 0), stoneMat);
    st.position.set(x, y + 0.2, z);
    st.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
    world.under.add(st);
    world.obstaclesUnder.push({ x, z, r: 1.1 });
  }
}
