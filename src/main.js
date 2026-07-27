/**
 * Mole Mayhem 3D — punkt wejscia.
 * Spina UI (HTML) z rdzeniem gry (Three.js) i prowadzi petle renderowania.
 */
import { Game } from './core/game.js';
import { UI } from './ui/ui.js';

const canvas = document.getElementById('scene');

const ui = new UI({
  onPlay: () => game.startMatch(),
  onQuitToMenu: () => game.quitToMenu(),
  audio: null
});

const game = new Game(canvas, ui);
ui.audio = game.audio;
ui.game = game;
ui.showMenu();
ui.hideLoading();

// AudioContext wolno uruchomic dopiero po gescie uzytkownika
const unlock = () => {
  game.audio.unlock();
  removeEventListener('pointerdown', unlock);
  removeEventListener('keydown', unlock);
};
addEventListener('pointerdown', unlock);
addEventListener('keydown', unlock);

addEventListener('keydown', e => {
  if (e.code === 'Backspace' && game.paused) {
    e.preventDefault();
    game.backspaceQuit = true;
  }
});

let last = performance.now();
let acc = 0, frames = 0;

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, Math.max(0.0001, (now - last) / 1000));
  last = now;

  // Zabezpieczenie: jesli strona wystartowala w karcie o zerowym rozmiarze
  // (ukryta zakladka / panel), bufor renderera nigdy by sie nie ustawil.
  if (!game.canvas.width || !Number.isFinite(game.camera.aspect)) game.resize();

  if (game.netRole === 'guest') game.updateGuest(dt);
  else game.update(dt);
  game.input.endFrame();
  game.render();

  // adaptacyjna jakosc: gdy klatki spadaja, obniz pixelRatio (glownie mobile).
  // W ukrytej karcie requestAnimationFrame jest dlawiony, wiec pomiar bylby falszywy.
  if (document.hidden) { acc = 0; frames = 0; return; }
  acc += dt; frames++;
  if (acc >= 2) {
    const fps = frames / acc;
    acc = 0; frames = 0;
    const pr = game.renderer.getPixelRatio();
    const max = Math.min(devicePixelRatio || 1, 2);
    let next = pr;
    if (fps < 34 && pr > 0.75) next = Math.max(0.75, pr - 0.25);
    else if (fps > 56 && pr < max) next = Math.min(max, pr + 0.25);
    if (next !== pr) {
      game.renderer.setPixelRatio(next);
      // rozmiar czasteczek zalezy od wysokosci bufora rysowania
      game.particles.setViewport(game.canvas.clientHeight * next, game.camera.fov);
    }
  }
}

requestAnimationFrame(loop);

// pomocne przy debugowaniu w konsoli przegladarki
window.__mm = { game, ui };
