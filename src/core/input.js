/**
 * Warstwa wejscia: klawiatura + mysz (Raycaster na plaszczyzne Y = pozycja gracza)
 * oraz dotyk (wirtualny joystick + "swipe & release" na przyciskach umiejetnosci).
 * Wynikiem jest zawsze ten sam obiekt Command, ktory dostaja tez boty.
 */
import * as THREE from 'three';

const KEY_MAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'dig',
  KeyE: 'interact',
  KeyQ: 'ability1',
  KeyF: 'ability2',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  KeyC: 'pingAim',    // ping na cel pod kursorem (kopiec/pulapka)
  KeyX: 'pingSelf'    // szybki ping "tu/uwaga" na wlasnej pozycji, bez celowania
};

export class InputSystem {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.edges = new Set();
    this.enabled = false;

    this.pointer = new THREE.Vector2();
    this.pointerInside = false;
    this.primaryDown = false;
    this.primaryEdge = false;

    this.stick = { id: null, active: false, x: 0, y: 0, baseX: 0, baseY: 0 };
    this.touchAim = null;              // { dx, dy } — wektor naciagniecia na mobile
    this.queuedAbilities = [];         // z przyciskow HUD
    this.queuedPing = null;            // { drag: {dx,dy,len} | null } z przycisku pingu HUD

    this.raycaster = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._hit = new THREE.Vector3();
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

    this._bind();
  }

  _bind() {
    addEventListener('keydown', e => {
      if (e.repeat) return;
      const k = KEY_MAP[e.code];
      if (k) {
        if (e.code === 'Space') e.preventDefault();
        this.keys.add(k);
        this.edges.add(k);
      }
      if (e.code === 'Escape') this.escapePressed = true;
    });
    addEventListener('keyup', e => {
      const k = KEY_MAP[e.code];
      if (k) this.keys.delete(k);
    });
    addEventListener('blur', () => { this.keys.clear(); this.primaryDown = false; });

    this.canvas.addEventListener('contextmenu', e => e.preventDefault());

    this.canvas.addEventListener('pointerdown', e => {
      if (!this.enabled) return;
      try { this.canvas.setPointerCapture?.(e.pointerId); } catch { /* pointer moze byc juz zwolniony */ }
      if (e.pointerType === 'touch') {
        this._touchStart(e);
      } else if (e.button === 0) {
        this.primaryDown = true;
        this.primaryEdge = true;
        this._updatePointer(e);
      }
    });

    this.canvas.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') this._touchMove(e);
      else this._updatePointer(e);
    });

    const end = e => {
      if (e.pointerType === 'touch') this._touchEnd(e);
      else if (e.button === 0) this.primaryDown = false;
    };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
    this.canvas.addEventListener('pointerleave', e => { if (e.pointerType !== 'touch') this.pointerInside = false; });
  }

  _updatePointer(e) {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    this.pointerInside = true;
  }

  /* ------------------------------------------------------------- dotyk */

  _touchStart(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    if (this.stick.id === null && x < r.width * 0.55) {
      this.stick.id = e.pointerId;
      this.stick.active = true;
      this.stick.baseX = e.clientX;
      this.stick.baseY = e.clientY;
      this.stick.x = this.stick.y = 0;
      if (this.stickEl) {
        this.stickEl.classList.remove('hidden');
        this.stickEl.style.left = `${e.clientX - r.left - 59}px`;
        this.stickEl.style.top = `${e.clientY - r.top - 59}px`;
        this.stickEl.style.bottom = 'auto';
      }
    } else {
      // prawa polowa ekranu = atak podstawowy + celowanie
      this.primaryDown = true;
      this.primaryEdge = true;
      this.aimTouchId = e.pointerId;
      this._updatePointer(e);
    }
  }

  _touchMove(e) {
    if (e.pointerId === this.stick.id) {
      const dx = e.clientX - this.stick.baseX;
      const dy = e.clientY - this.stick.baseY;
      const max = 58;
      const len = Math.hypot(dx, dy) || 1;
      const clamped = Math.min(len, max);
      this.stick.x = (dx / len) * (clamped / max);
      this.stick.y = (dy / len) * (clamped / max);
      if (this.stickEl) {
        const knob = this.stickEl.firstElementChild;
        knob.style.transform = `translate(${(dx / len) * clamped}px, ${(dy / len) * clamped}px)`;
      }
    } else if (e.pointerId === this.aimTouchId) {
      this._updatePointer(e);
    }
  }

  _touchEnd(e) {
    if (e.pointerId === this.stick.id) {
      this.stick.id = null;
      this.stick.active = false;
      this.stick.x = this.stick.y = 0;
      if (this.stickEl) {
        this.stickEl.classList.add('hidden');
        this.stickEl.firstElementChild.style.transform = '';
      }
    } else if (e.pointerId === this.aimTouchId) {
      this.aimTouchId = null;
      this.primaryDown = false;
    }
  }

  /** Rejestracja przyciskow HUD (dotyk) — obsluguje "swipe & release" do celowania. */
  bindAbilityButton(el, cmdName, hold = false) {
    let dragging = null;
    const start = e => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      dragging = { id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2, dx: 0, dy: 0 };
      try { el.setPointerCapture?.(e.pointerId); } catch { /* jw. */ }
      el.classList.add('aiming');
      if (hold) this.holdSprint = true;
    };
    const move = e => {
      if (!dragging || e.pointerId !== dragging.id) return;
      dragging.dx = e.clientX - dragging.cx;
      dragging.dy = e.clientY - dragging.cy;
    };
    const end = e => {
      if (!dragging || e.pointerId !== dragging.id) return;
      el.classList.remove('aiming');
      if (hold) {
        this.holdSprint = false;
      } else {
        const len = Math.hypot(dragging.dx, dragging.dy);
        this.queuedAbilities.push({
          cmd: cmdName,
          drag: len > 24 ? { dx: dragging.dx / len, dy: dragging.dy / len, len } : null
        });
      }
      dragging = null;
    };
    el.addEventListener('pointerdown', start);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  /**
   * Przycisk pingu na HUD — stuk = ping "tu/uwaga" na wlasnej pozycji,
   * przeciagniecie i puszczenie (jak przy umiejetnosciach) = ping na cel
   * pod palcem. Ten sam gest swipe-and-release co bindAbilityButton,
   * zeby dotyk byl spojny z reszta przyciskow.
   */
  bindPingButton(el) {
    let dragging = null;
    const start = e => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      dragging = { id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2, dx: 0, dy: 0 };
      try { el.setPointerCapture?.(e.pointerId); } catch { /* jw. */ }
      el.classList.add('aiming');
    };
    const move = e => {
      if (!dragging || e.pointerId !== dragging.id) return;
      dragging.dx = e.clientX - dragging.cx;
      dragging.dy = e.clientY - dragging.cy;
    };
    const end = e => {
      if (!dragging || e.pointerId !== dragging.id) return;
      el.classList.remove('aiming');
      const len = Math.hypot(dragging.dx, dragging.dy);
      this.queuedPing = { drag: len > 24 ? { dx: dragging.dx / len, dy: dragging.dy / len, len } : null };
      dragging = null;
    };
    el.addEventListener('pointerdown', start);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  setStickElement(el) { this.stickEl = el; }
  setEnabled(v) {
    this.enabled = v;
    if (!v) { this.keys.clear(); this.edges.clear(); this.primaryDown = false; this.queuedAbilities.length = 0; }
  }

  /** Punkt na plaszczyznie gry, w ktory celuje kursor. */
  aimPoint(camera, planeY) {
    if (!this.pointerInside) return null;
    this.plane.constant = -planeY;
    this.raycaster.setFromCamera(this.pointer, camera);
    const hit = this.raycaster.ray.intersectPlane(this.plane, this._hit);
    return hit ? { x: hit.x, z: hit.z } : null;
  }

  /**
   * Zlozenie komendy dla lokalnej postaci.
   * Ruch WASD/joystick jest przeliczany na wektory X/Z wzgledem obrotu kamery.
   */
  buildCommand(camera, actor) {
    const c = {
      mx: 0, mz: 0, sprint: false, aimX: null, aimZ: null,
      primary: false, dig: false, interact: false, ability1: false, ability2: false,
      ping: null
    };
    if (!this.enabled || !actor) return c;

    // baza kamery rzutowana na plaszczyzne XZ
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);

    let ix = 0, iz = 0;
    if (this.keys.has('up')) iz += 1;
    if (this.keys.has('down')) iz -= 1;
    if (this.keys.has('right')) ix += 1;
    if (this.keys.has('left')) ix -= 1;

    if (this.stick.active) {
      ix += this.stick.x;
      iz += -this.stick.y;
      if (Math.hypot(this.stick.x, this.stick.y) > 0.92) c.sprint = true;
    }

    if (ix !== 0 || iz !== 0) {
      const mx = right.x * ix + fwd.x * iz;
      const mz = right.z * ix + fwd.z * iz;
      const len = Math.hypot(mx, mz) || 1;
      c.mx = mx / len;
      c.mz = mz / len;
    }

    c.sprint = c.sprint || this.keys.has('sprint') || !!this.holdSprint;

    // Celowanie: na desktopie zawsze kursor, na dotyku tylko gdy palec trzyma
    // prawa polowe ekranu. Sam obrot postaci idzie za ruchem — punkt celowania
    // jest uzywany dopiero w momencie ataku/umiejetnosci.
    const aim = this.aimPoint(camera, actor.y);
    if (aim && (!this.isTouch || this.aimTouchId != null)) { c.aimX = aim.x; c.aimZ = aim.z; }

    c.primary = this.primaryDown;
    c.dig = this.edges.has('dig');
    c.interact = this.edges.has('interact');
    c.ability1 = this.edges.has('ability1');
    c.ability2 = this.edges.has('ability2');

    // przyciski dotykowe (z opcjonalnym celowaniem przez przeciagniecie)
    for (const q of this.queuedAbilities) {
      c[q.cmd] = true;
      if (q.drag) {
        const wx = right.x * q.drag.dx + fwd.x * -q.drag.dy;
        const wz = right.z * q.drag.dx + fwd.z * -q.drag.dy;
        const len = Math.hypot(wx, wz) || 1;
        const reach = 3 + Math.min(1, q.drag.len / 90) * 9;
        c.aimX = actor.x + (wx / len) * reach;
        c.aimZ = actor.z + (wz / len) * reach;
      }
    }
    if (this.primaryEdge && aim) { c.aimX = aim.x; c.aimZ = aim.z; }

    // Ping: krety maja dwa rodzaje ("pulapka" na cel / "uwaga-uciekaj" na sobie),
    // obroncy tylko jeden ("podejrzana pozycja/kopiec") — oba klawisze dzialaja
    // wiec identycznie dla nich. Klawiatura ma pierwszenstwo nad dotykiem tylko
    // w tym sensie, ze oba moga ustawic c.ping w tej samej klatce — ostatni wygrywa,
    // co w praniu nigdy sie nie zdarza (gracz uzywa albo jednego, albo drugiego wejscia).
    if (this.edges.has('pingAim') && aim) {
      c.ping = { x: aim.x, z: aim.z, kind: actor.team === 'mole' ? 'trap' : 'mark' };
    }
    if (this.edges.has('pingSelf')) {
      c.ping = { x: actor.x, z: actor.z, kind: actor.team === 'mole' ? 'danger' : 'mark' };
    }
    if (this.queuedPing) {
      const q = this.queuedPing;
      if (q.drag) {
        const wx = right.x * q.drag.dx + fwd.x * -q.drag.dy;
        const wz = right.z * q.drag.dx + fwd.z * -q.drag.dy;
        const len = Math.hypot(wx, wz) || 1;
        const reach = 3 + Math.min(1, q.drag.len / 90) * 9;
        c.ping = { x: actor.x + (wx / len) * reach, z: actor.z + (wz / len) * reach, kind: actor.team === 'mole' ? 'trap' : 'mark' };
      } else {
        c.ping = { x: actor.x, z: actor.z, kind: actor.team === 'mole' ? 'danger' : 'mark' };
      }
    }

    return c;
  }

  /** Czysci zdarzenia jednoklatkowe — wolane na koncu kazdej klatki. */
  endFrame() {
    this.edges.clear();
    this.queuedAbilities.length = 0;
    this.queuedPing = null;
    this.primaryEdge = false;
    this.escapePressed = false;
  }
}
