/**
 * Ustawienia urzadzenia (dostepnosc, wolumen, czulosc) — CELOWO oddzielone od
 * economy.js. Te dwa magazyny maja inny cykl zycia: ustawienia sa per-urzadzenie
 * (przegladarka), progresja gracza (waluty, odblokowania) jest per-konto.
 * Rozdzielenie unika mieszania "kim jestem" z "jak wygodnie mi sie gra".
 */

const KEY = 'molemayhem.settings.v1';

const DEFAULT_SETTINGS = {
  shakeIntensity: 1,   // 0..1 — 0 = calkowicie wylaczone trzesienie kamery (dostepnosc)
  volume: 1            // 0..1 — mnoznik glosnosci calej gry (patrz AudioEngine.setVolume)
};

let settings = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* tryb prywatny — trudno */ }
}

export function getSettings() { return settings; }

export function setShakeIntensity(v) {
  settings.shakeIntensity = Math.max(0, Math.min(1, v));
  persist();
}

export function setVolume(v) {
  settings.volume = Math.max(0, Math.min(1, v));
  persist();
}
