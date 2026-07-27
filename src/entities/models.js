/**
 * Proceduralne modele 3D postaci (low-poly, flat shading) — bez zewnetrznych assetow.
 * Kazdy builder zwraca { root, parts } — `parts` sa animowane proceduralnie w Actor.
 */
import * as THREE from 'three';

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({
  color, roughness: 0.85, metalness: 0, flatShading: true, ...opts
});

/**
 * Modele sa rzezbione "twarza do -Z" (wygodniej sie je czyta przy pisaniu),
 * a Actor ustawia `group.rotation.y = atan2(dx, dz)`, czyli przod postaci to +Z.
 * Ten obrot godzi obie konwencje — bez niego postacie chodza tylem.
 */
function faceForward(root) {
  root.rotation.y = Math.PI;
  return root;
}

function shadowify(root) {
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  return root;
}

/* ------------------------------------------------------------------ KRET */
export function buildMole(tint = 0x4a4038) {
  const root = new THREE.Group();
  const parts = {};

  const fur = mat(tint);
  const belly = mat(0x6d6055);

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.42, 3, 10), fur);
  body.rotation.z = Math.PI / 2;
  body.position.y = 0.5;
  body.scale.set(1, 1.15, 1.05);
  root.add(body);
  parts.body = body;

  const head = new THREE.Group();
  head.position.set(0, 0.56, -0.52);
  root.add(head);
  parts.head = head;

  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.33, 10, 8), fur);
  head.add(skull);

  const snout = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.42, 8), mat(0xf3a3a8));
  snout.rotation.x = -Math.PI / 2;
  snout.position.set(0, -0.04, -0.34);
  head.add(snout);
  parts.snout = snout;

  const eyeGeo = new THREE.SphereGeometry(0.058, 6, 6);
  const eyeMat = mat(0x14100c, { roughness: 0.3 });
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(sx * 0.15, 0.08, -0.24);
    head.add(eye);
  }
  const earGeo = new THREE.SphereGeometry(0.09, 6, 5);
  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(earGeo, mat(0xd98e93));
    ear.scale.set(1, 1, 0.4);
    ear.position.set(sx * 0.26, 0.22, 0.02);
    head.add(ear);
  }

  const bellyM = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), belly);
  bellyM.scale.set(0.9, 0.75, 1.1);
  bellyM.position.set(0, 0.34, -0.05);
  root.add(bellyM);

  // lapy z pazurami — znak rozpoznawczy kreta
  parts.paws = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(sx * 0.42, 0.42, -0.22);
    root.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.17, 7, 6), mat(0x3a322b));
    hand.scale.set(1, 0.8, 1.25);
    arm.add(hand);
    for (let i = 0; i < 3; i++) {
      const claw = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.24, 5), mat(0xe8e2d4, { roughness: 0.5 }));
      claw.position.set((i - 1) * 0.09, -0.02, -0.2);
      claw.rotation.x = -Math.PI / 2.2;
      arm.add(claw);
    }
    parts.paws.push(arm);
  }

  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.5, 6), mat(0xd98e93));
  tail.position.set(0, 0.5, 0.55);
  tail.rotation.x = -Math.PI / 2.6;
  root.add(tail);
  parts.tail = tail;

  parts.hatAnchor = new THREE.Group();
  parts.hatAnchor.position.set(0, 0.3, 0.02);
  head.add(parts.hatAnchor);

  root.scale.setScalar(1.3);   // kret jest maly — podbijamy czytelnosc sylwetki
  return { root: faceForward(shadowify(root)), parts };
}

/* -------------------------------------------------------------- OGRODNIK */
export function buildGardener() {
  const root = new THREE.Group();
  const parts = {};

  const skin = mat(0xe8b48c);
  const shirt = mat(0xc9482f);
  const denim = mat(0x35507a);
  const boot = mat(0x3a2a1c);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 0.5, 3, 10), shirt);
  torso.position.y = 1.25;
  root.add(torso);
  parts.body = torso;

  const dungarees = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.42, 0.62, 10), denim);
  dungarees.position.y = 1.02;
  root.add(dungarees);

  const head = new THREE.Group();
  head.position.y = 1.92;
  root.add(head);
  parts.head = head;

  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 8), skin);
  head.add(skull);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 6), skin);
  nose.rotation.x = -Math.PI / 2;
  nose.position.set(0, -0.02, -0.26);
  head.add(nose);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 6), mat(0x1b1b1b, { roughness: .3 }));
    eye.position.set(sx * 0.11, 0.06, -0.23);
    head.add(eye);
  }
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.05, 14), mat(0xd9b968));
  brim.position.y = 0.22;
  head.add(brim);
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 0.26, 12), mat(0xc9a750));
  crown.position.y = 0.34;
  head.add(crown);

  parts.legs = [];
  for (const sx of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(sx * 0.17, 0.72, 0);
    root.add(leg);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.42, 2, 8), denim);
    thigh.position.y = -0.28;
    leg.add(thigh);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.18, 0.42), boot);
    shoe.position.set(0, -0.6, -0.06);
    leg.add(shoe);
    parts.legs.push(leg);
  }

  parts.arms = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(sx * 0.42, 1.55, 0);
    root.add(arm);
    const limb = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.42, 2, 8), shirt);
    limb.position.y = -0.28;
    arm.add(limb);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.13, 7, 6), skin);
    hand.position.y = -0.56;
    arm.add(hand);
    parts.arms.push(arm);
  }

  // mlotek / lopata w prawej rece
  const tool = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 1.15, 7), mat(0x9a6f3c));
  handle.position.y = -0.3;
  tool.add(handle);
  const headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.26, 0.26), mat(0x8f9498, { metalness: .35, roughness: .55 }));
  headMesh.position.y = -0.88;
  tool.add(headMesh);
  tool.position.set(0, -0.5, -0.08);
  tool.rotation.x = -0.4;      // glowica pochylona w strone twarzy, czyli do przodu
  parts.arms[1].add(tool);
  parts.tool = tool;

  parts.hatAnchor = new THREE.Group();
  parts.hatAnchor.position.y = 0.5;
  head.add(parts.hatAnchor);

  return { root: faceForward(shadowify(root)), parts };
}

/* ------------------------------------------------------------------- PIES */
export function buildDog(coat = 0xb5763c) {
  const root = new THREE.Group();
  const parts = {};
  const fur = mat(coat);
  const dark = mat(0x6d4520);

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.72, 3, 10), fur);
  body.rotation.x = Math.PI / 2;
  body.position.y = 0.72;
  root.add(body);
  parts.body = body;

  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 7), mat(0xe8d7bd));
  chest.scale.set(0.85, 0.8, 1);
  chest.position.set(0, 0.62, -0.36);
  root.add(chest);

  const head = new THREE.Group();
  head.position.set(0, 1.0, -0.72);
  root.add(head);
  parts.head = head;

  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.27, 9, 8), fur);
  skull.scale.set(1, 0.95, 1.05);
  head.add(skull);
  const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.19, 0.34), mat(0xe8d7bd));
  muzzle.position.set(0, -0.08, -0.3);
  head.add(muzzle);
  parts.snout = muzzle;
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.075, 7, 6), mat(0x1c1512));
  nose.position.set(0, -0.04, -0.47);
  head.add(nose);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), mat(0x1b1b1b, { roughness: .3 }));
    eye.position.set(sx * 0.12, 0.07, -0.21);
    head.add(eye);
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 5), dark);
    ear.position.set(sx * 0.19, 0.26, 0.02);
    ear.rotation.z = sx * 0.3;
    head.add(ear);
  }

  parts.legs = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const leg = new THREE.Group();
    leg.position.set(sx * 0.24, 0.5, sz * 0.36);
    root.add(leg);
    const limb = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.36, 2, 7), fur);
    limb.position.y = -0.22;
    leg.add(limb);
    const paw = new THREE.Mesh(new THREE.SphereGeometry(0.11, 6, 5), dark);
    paw.scale.set(1, .7, 1.2);
    paw.position.y = -0.45;
    leg.add(paw);
    parts.legs.push(leg);
  }

  const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.4, 2, 6), fur);
  tail.position.set(0, 0.95, 0.6);
  tail.rotation.x = -0.9;
  root.add(tail);
  parts.tail = tail;

  parts.hatAnchor = new THREE.Group();
  parts.hatAnchor.position.y = 0.28;
  head.add(parts.hatAnchor);

  return { root: faceForward(shadowify(root)), parts };
}

/* -------------------------------------------------------------- KOSMETYKA */
export function buildHat(id, color = 0xffcf4d) {
  const g = new THREE.Group();
  if (id === 'hat_straw') {
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.04, 12), mat(color));
    g.add(brim);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.2, 10), mat(color));
    top.position.y = 0.12;
    g.add(top);
  } else if (id === 'hat_cone') {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.34, 8), mat(0xffd76a, { emissive: 0x996600, emissiveIntensity: .5 }));
    cone.position.y = 0.14;
    g.add(cone);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), mat(0xfff2b0, { emissive: 0xffcc55, emissiveIntensity: 2 }));
    lamp.position.set(0, 0.12, -0.24);
    g.add(lamp);
    const light = new THREE.PointLight(0xffc978, 6, 9, 2);
    light.position.set(0, 0.2, -0.4);
    light.layers.enableAll();
    g.add(light);
  } else if (id === 'hat_crown') {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.16, 10, 1, true), mat(color, { metalness: .8, roughness: .25, side: THREE.DoubleSide }));
    band.position.y = 0.1;
    g.add(band);
    for (let i = 0; i < 6; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 5), mat(color, { metalness: .8, roughness: .25 }));
      spike.position.set(Math.cos(i * 1.05) * 0.25, 0.24, Math.sin(i * 1.05) * 0.25);
      g.add(spike);
    }
  }
  shadowify(g);
  return g;
}

/** Etykieta nad glowa (nick + strzalka lokalnego gracza) rysowana na canvasie. */
export function buildNameTag(text, color = '#ffffff') {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 34px Trebuchet MS, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 7;
  ctx.strokeStyle = 'rgba(0,0,0,.75)';
  ctx.strokeText(text, 128, 34);
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 34);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false
  }));
  sprite.scale.set(2.0, 0.5, 1);
  sprite.renderOrder = 10;
  return sprite;
}
