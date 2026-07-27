/**
 * Meta-gra poza meczem: portfel, odblokowania, wybrane perki i kosmetyka.
 * Zapis w localStorage (brak backendu w prototypie).
 */
import { ECONOMY, SHOP, PERKS, CUSTOM_LIMITS } from '../core/config.js';

const KEY = 'molemayhem.save.v1';

const DEFAULT_SAVE = {
  silver: 120,
  gold: 3,
  owned: ['cls_gardener'],
  equipped: { hat: null, fx: null },
  perks: ['digger', 'lungs'],
  faction: 'mole',
  format: '3v1',
  custom: { moles: 5, gardeners: 2, dogs: 1, vegetablesToWin: 26, duration: 240 },
  matches: 0,
  wins: 0
};

let save = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SAVE };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SAVE, ...parsed,
      equipped: { ...DEFAULT_SAVE.equipped, ...(parsed.equipped || {}) },
      custom: { ...DEFAULT_SAVE.custom, ...(parsed.custom || {}) }
    };
  } catch {
    return { ...DEFAULT_SAVE };
  }
}

export function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* tryb prywatny — trudno */ }
}

export function getSave() { return save; }

export function owns(id) { return save.owned.includes(id); }

export function isClassUnlocked(cls) {
  if (cls === 'mole' || cls === 'gardener') return true;
  return owns('cls_' + cls);
}

export function buy(itemId) {
  const item = SHOP.find(i => i.id === itemId);
  if (!item || owns(itemId)) return { ok: false, reason: 'owned' };
  const wallet = item.currency === 'gold' ? save.gold : save.silver;
  if (wallet < item.price) return { ok: false, reason: 'funds' };
  if (item.currency === 'gold') save.gold -= item.price; else save.silver -= item.price;
  save.owned.push(itemId);
  if (item.kind === 'cosmetic') save.equipped[item.slot] = itemId;
  persist();
  return { ok: true, item };
}

export function equip(itemId) {
  const item = SHOP.find(i => i.id === itemId);
  if (!item || item.kind !== 'cosmetic' || !owns(itemId)) return false;
  save.equipped[item.slot] = save.equipped[item.slot] === itemId ? null : itemId;
  persist();
  return true;
}

export function togglePerk(perkId) {
  const perk = PERKS.find(p => p.id === perkId);
  if (!perk) return;
  const i = save.perks.indexOf(perkId);
  if (i >= 0) {
    save.perks.splice(i, 1);
  } else {
    // maks. 2 perki na drużynę — wypychamy najstarszy z tej samej frakcji
    const sameTeam = save.perks.filter(id => (PERKS.find(p => p.id === id) || {}).team === perk.team);
    if (sameTeam.length >= 2) save.perks.splice(save.perks.indexOf(sameTeam[0]), 1);
    save.perks.push(perkId);
  }
  persist();
}

export function activePerksFor(team) {
  return save.perks
    .map(id => PERKS.find(p => p.id === id))
    .filter(p => p && p.team === team);
}

export function setFaction(cls) { save.faction = cls; persist(); }
export function setFormat(fmt) { save.format = fmt; persist(); }

/** Zmiana pojedynczego parametru trybu wlasnego, z przycieciem do dozwolonego zakresu. */
export function setCustom(key, value) {
  const lim = CUSTOM_LIMITS[key];
  if (!lim) return;
  save.custom[key] = Math.max(lim.min, Math.min(lim.max, value));
  persist();
}

export function equippedCosmetic(slot) {
  const id = save.equipped[slot];
  return id ? SHOP.find(i => i.id === id) || null : null;
}

/** Nagrody po meczu -> Srebrne Monety + Zlote Zoledzie. */
export function awardMatch({ won, vegetables = 0, catches = 0 }) {
  const silver = Math.round(
    ECONOMY.silverPerMatch +
    (won ? ECONOMY.silverWinBonus : 0) +
    vegetables * ECONOMY.silverPerVegetable +
    catches * ECONOMY.silverPerCatch
  );
  const gold = won ? ECONOMY.goldPerWin : ECONOMY.goldPerMatch;
  save.silver += silver;
  save.gold += gold;
  save.matches += 1;
  if (won) save.wins += 1;
  persist();
  return { silver, gold };
}
