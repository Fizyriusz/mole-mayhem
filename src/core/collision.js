/**
 * Lekka kolizja kinematyczna 2D (plaszczyzna XZ) — wystarczajaca dla areny
 * zbudowanej z walcow i prostopadloscianow, bez kosztu pelnego silnika fizyki.
 */

/** Wypycha punkt (x,z) o promieniu r poza pojedyncza przeszkode. Modyfikuje `out`. */
function pushOut(out, r, o) {
  if (o.r !== undefined) {
    const dx = out.x - o.x, dz = out.z - o.z;
    const minD = r + o.r;
    const d2 = dx * dx + dz * dz;
    if (d2 < minD * minD) {
      const d = Math.sqrt(d2) || 0.0001;
      const push = (minD - d) / d;
      out.x += dx * push;
      out.z += dz * push;
      return true;
    }
  } else {
    // AABB rozszerzony o promien postaci
    const hw = o.hw + r, hd = o.hd + r;
    const dx = out.x - o.x, dz = out.z - o.z;
    if (Math.abs(dx) < hw && Math.abs(dz) < hd) {
      const ox = hw - Math.abs(dx);
      const oz = hd - Math.abs(dz);
      if (ox < oz) out.x += Math.sign(dx || 1) * ox;
      else out.z += Math.sign(dz || 1) * oz;
      return true;
    }
  }
  return false;
}

/**
 * @param {{x:number,z:number}} target — pozycja PO ruchu (mutowana w miejscu)
 * @param {number} radius — promien postaci
 * @param {Array} obstacles — lista przeszkod aktywnej warstwy
 * @param {number} bounds — polowa boku dostepnego pola
 */
export function resolve(target, radius, obstacles, bounds) {
  let hit = false;
  // dwa przebiegi — rozwiazuje wciskanie w naroznik dwoch przeszkod
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < obstacles.length; i++) {
      if (pushOut(target, radius, obstacles[i])) hit = true;
    }
  }
  const lim = bounds - radius;
  if (target.x < -lim) { target.x = -lim; hit = true; }
  if (target.x > lim) { target.x = lim; hit = true; }
  if (target.z < -lim) { target.z = -lim; hit = true; }
  if (target.z > lim) { target.z = lim; hit = true; }
  return hit;
}

/** Czy odcinek od->do jest wolny od przeszkod (prosty raycast po probkach). */
export function lineOfSight(ax, az, bx, bz, obstacles, step = 1.0) {
  const dx = bx - ax, dz = bz - az;
  const dist = Math.hypot(dx, dz);
  const n = Math.max(1, Math.ceil(dist / step));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const px = ax + dx * t, pz = az + dz * t;
    for (const o of obstacles) {
      if (o.r !== undefined) {
        if ((px - o.x) ** 2 + (pz - o.z) ** 2 < o.r * o.r) return false;
      } else if (Math.abs(px - o.x) < o.hw && Math.abs(pz - o.z) < o.hd) {
        return false;
      }
    }
  }
  return true;
}

/** Kierunek omijania przeszkody — uzywany przez boty zamiast pelnego pathfindingu. */
export function avoid(x, z, dirX, dirZ, obstacles, lookAhead = 3.2) {
  const px = x + dirX * lookAhead, pz = z + dirZ * lookAhead;
  for (const o of obstacles) {
    const r = o.r !== undefined ? o.r + 1.0 : Math.max(o.hw, o.hd) + 1.0;
    const dx = px - o.x, dz = pz - o.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      const d = Math.sqrt(d2) || 0.001;
      // odbij kierunek stycznie do przeszkody
      const nx = dx / d, nz = dz / d;
      const sx = -nz, sz = nx;
      const side = Math.sign(dirX * sx + dirZ * sz) || 1;
      const mixX = dirX + sx * side * 1.4 + nx * 0.5;
      const mixZ = dirZ + sz * side * 1.4 + nz * 0.5;
      const len = Math.hypot(mixX, mixZ) || 1;
      return { x: mixX / len, z: mixZ / len };
    }
  }
  return { x: dirX, z: dirZ };
}
