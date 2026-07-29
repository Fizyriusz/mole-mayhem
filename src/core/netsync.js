/**
 * Serializacja stanu gry (host -> snapshot) i jego odtwarzanie u goscia.
 *
 * Filozofia: snapshot jest ZAWSZE zrodlem prawdy dla liczb HUD i stanu meczu.
 * FX/dzwieki dla INNYCH aktorow sa WYWNIOSKOWANE z roznicy miedzy kolejnymi
 * snapshotami (np. "underground bylo 0, jest 1" -> zagraj kopanie) zamiast
 * osobnego strumienia zdarzen — mniej stanu do trzymania w zgodzie, a WLASNA
 * postac goscia i tak dostaje pelna, natychmiastowa informacje zwrotna z
 * wlasnej (predykcyjnej) symulacji, wiec nie potrzebuje echa z sieci.
 */
import { ARENA, CAMERA_SHAKE } from './config.js';

export function serializeSnapshot(game) {
  const actors = game.actors.map(a => ({
    x: +a.x.toFixed(2), z: +a.z.toFixed(2), f: +a.facing.toFixed(3),
    h: Math.round(a.hp), s: Math.round(a.stamina),
    u: a.underground ? 1 : 0, a: a.alive ? 1 : 0,
    r: game.time < a.revealUntil ? 1 : 0,
    st: a.stunned ? 1 : 0, sl: a.slowed ? 1 : 0,
    bl: game.time < a.blindUntil ? 1 : 0
  }));

  const veg = game.vegetables ? game.vegetables.list.map(v => {
    const s = v.state === 'plot' ? 0 : v.state === 'dropped' ? 1 : v.state === 'carried' ? 2 : 3;
    return {
      s,
      x: s === 1 ? +v.mesh.position.x.toFixed(2) : v.home.x,
      z: s === 1 ? +v.mesh.position.z.toFixed(2) : v.home.z,
      ci: v.carrier ? game.actors.indexOf(v.carrier) : -1
    };
  }) : [];

  return {
    time: game.time, timeLeft: game.timeLeft, countdown: game.countdown, state: game.state,
    delivered: game.delivered, vegetablesToWin: game.vegetablesToWin,
    molesAlive: game.molesAlive, moleCount: game.moleCount,
    winner: game._winner ?? null, reason: game._winReason ?? null,
    actors, veg,
    mounds: game.mounds.serializeActive(),
    traps: game.traps.serializeActive()
  };
}

export function applySnapshot(game, msg) {
  const prevState = game.state;
  const prevCountdown = game.countdown ?? msg.countdown;

  game.delivered = msg.delivered;
  game.vegetablesToWin = msg.vegetablesToWin;
  game.molesAlive = msg.molesAlive;
  game.moleCount = msg.moleCount;
  game.timeLeft = msg.timeLeft;
  game.countdown = msg.countdown;

  // --- przejscia stanu meczu (kolejnosc wazna: 'over' ma pierwszenstwo) ---
  if (prevState === 'countdown') {
    const before = Math.ceil(prevCountdown);
    const after = Math.ceil(msg.countdown);
    if (after !== before && after > 0) { game.ui.banner(String(after), 0.9); game.audio.play('countdown'); }
  }
  if (msg.state === 'over' && prevState !== 'over') {
    game.finish(msg.winner, msg.reason);            // finish() sam ustawia game.state='over'
  } else if (msg.state === 'playing' && prevState === 'countdown') {
    game.state = 'playing';
    game.ui.banner('START!', 1);
    game.audio.play('start');
  } else {
    game.state = msg.state;
  }
  if (game.state === 'playing' && game.timeLeft > 0 && game.timeLeft < 30 && !game._warned30) {
    game._warned30 = true;
    game.ui.banner('OSTATNIE 30 SEKUND', 1.4);
  }

  // --- aktorzy: wlasny = korekta autorytatywnych pol, pozostali = cel lerpa ---
  for (let i = 0; i < msg.actors.length && i < game.actors.length; i++) {
    const a = game.actors[i];
    const entry = msg.actors[i];
    if (a === game.localActor) {
      a.reconcileSelf(entry);
      continue;
    }
    const prev = a._netTarget;
    if (prev) {
      if (!prev.u && entry.u) { game.particles.digBurst(entry.x, entry.z, false); game.audio.play('digSoft'); }
      else if (prev.u && !entry.u) { game.particles.digBurst(entry.x, entry.z, true); game.audio.play('dig'); }
      if (entry.h < prev.h) {
        const y = entry.u ? ARENA.undergroundY : 0;
        game.particles.hit(entry.x, y + 0.9, entry.z, a.team === 'mole' ? 0xff6b6b : 0xffd166);
        // Zadanie 1 (rozszerzenie): wstrzas kamery tez dla OBSERWATOROW, nie tylko
        // sprawcy/ofiary — bez zadnego nowego pola w snapshocie, bo hp/underground
        // juz i tak leca co klatke. Wyplukanie wezem = jednoczesny spadek hp I
        // wynurzenie w tej samej klatce; z boku nie da sie odroznic mlotka od
        // klapniecia Psa, wiec dla nich uzywamy slabszego, ogolnego impulsu.
        const wasEjected = prev.u && !entry.u;
        game.shakeAt(entry.x, entry.z,
          wasEjected ? CAMERA_SHAKE.impulses.hoseEject : CAMERA_SHAKE.impulses.gardenerHit * 0.7,
          wasEjected ? CAMERA_SHAKE.falloffDist.hoseEject : CAMERA_SHAKE.falloffDist.gardenerHit);
      }
      if (prev.a && !entry.a) {
        game.audio.play('alarm');
        game.ui.banner(`${a.name} ${a.team === 'mole' ? 'złapany!' : 'pada!'}`, 1.2);
      }
    }
    a._netTarget = entry;
  }

  // --- dostawa warzywa przez kogos innego niz gosc sam obserwuje ---
  const prevDelivered = game._lastDelivered ?? msg.delivered;
  if (msg.delivered > prevDelivered) {
    game.audio.play('deliver');
    game.ui.banner(`WARZYWO W NORZE  ${msg.delivered}/${msg.vegetablesToWin}`, 1.2);
  }
  game._lastDelivered = msg.delivered;

  game.vegetables?.applyNetworkState(msg.veg, game.actors);
  game.mounds.applyNetworkState(msg.mounds);
  game.traps.applyNetworkState(msg.traps);
}
