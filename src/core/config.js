/**
 * Centralny plik balansu. Wszystkie liczby, ktore projektant chcialby kręcić,
 * mieszkają tutaj — reszta kodu tylko je czyta.
 */

export const LAYER = {
  DEFAULT: 0,   // widoczne zawsze (obie perspektywy)
  SURFACE: 1,   // widoczne tylko z perspektywy "na powierzchni"
  UNDER: 2      // widoczne tylko z perspektywy "pod ziemią"
};

export const ARENA = {
  size: 62,          // dlugosc boku kwadratowej areny
  half: 31,
  wallInset: 1.2,    // o ile plot zawęża pole gry
  undergroundY: -2.0 // poziom Y kreta pod ziemia (wg GDD)
};

export const MATCH = {
  duration: 210,          // 3:30 (GDD: 3-4 min)
  vegetableCount: 22,     // ile warzyw lezy jednoczesnie na mapie
  countdown: 3            // odliczanie przed startem
  // cel (ile warzyw trzeba dowiezc) zalezy od formatu — patrz FORMATS na dole pliku
};

export const MOLE = {
  hp: 100,
  radius: 0.55,
  speedSurface: 6.0,
  speedUnderRatio: 0.8,   // GDD: 80% predkosci pod ziemia
  sprintMultiplier: 1.75,
  staminaMax: 100,
  staminaDrain: 34,       // na sekunde sprintu
  staminaRegen: 17,
  staminaRegenDelay: 0.6,
  digTime: 0.5,           // GDD: przejscie stan 1 <-> 2
  pickupTime: 1.5,        // GDD: animacja podnoszenia
  deliverTime: 0.6,
  carrySpeedPenalty: 0.78,// z lupem kret jest wolniejszy i nie moze sprintowac
  dustInterval: 1.15,     // co ile sek. obłoczek kurzu na powierzchni
  scentInterval: 0.28,    // co ile sek. odcisk zapachowy (decal)
  scentLifetime: 5.0,     // GDD: slad z ostatnich 5 sekund
  hpRegenUnderground: 4.5,// regeneracja gdy schowany i nietrafiony
  hpRegenDelay: 4.0,
  stunAfterEject: 2.0,    // GDD: wyskok z tunelu -> 2 sek. ogluszenia
  carryDustFactor: 0.5    // z warzywem kret kurzy dwa razy czesciej (szansa dla obroncow)
};

export const GARDENER = {
  hp: 200,
  radius: 0.7,
  speed: 5.0,             // GDD: wolny (kret ma 6.0)
  sprintMultiplier: 1.35,
  staminaMax: 100,
  staminaDrain: 28,
  staminaRegen: 20,
  visionRange: 34,        // GDD: bardzo duzy zasieg widzenia
  melee: {
    damage: 34,           // 3 trafienia = zlapany kret
    range: 3.1,
    arc: Math.PI * 0.55,  // stozek przed postacia
    windup: 0.18,
    cooldown: 0.75
  },
  hose: {                 // Zdolnosc: Waz z woda
    cooldown: 12,
    duration: 1.4,
    moundRange: 5.0,      // jak blisko kopca trzeba stac
    ejectRadius: 6.5,     // GDD: kret blizej niz R od tunelu wylatuje
    damage: 22
  },
  soundTrap: {            // Zdolnosc: Pulapka dzwiekowa
    cooldown: 16,
    lifetime: 22,
    radius: 11,
    maxActive: 2
  }
};

export const DOG = {
  hp: 150,
  radius: 0.6,
  speed: 8.2,             // GDD: bardzo szybki
  sprintMultiplier: 1.3,
  staminaMax: 100,
  staminaDrain: 30,
  staminaRegen: 22,
  visionRange: 24,
  smellRange: 20,         // zasieg czytania sladow zapachowych
  bite: {
    damage: 19,
    range: 2.5,
    arc: Math.PI * 0.5,
    windup: 0.1,
    cooldown: 0.5
  },
  bark: {                 // Zdolnosc: Szczekanie (sfera 3D, dziala tez pod ziemia)
    cooldown: 8,
    radius: 9.5,
    slowDuration: 3.0,    // GDD: Slowed na 3 sekundy
    slowFactor: 0.5,
    revealDuration: 3.0
  }
};

export const AI = {
  wanderRadius: 14,
  moleDangerRadius: 11,   // kiedy kret zaczyna sie chować
  moleFleeHp: 45
};

/**
 * Trzesienie kamery — czysto wizualny efekt (patrz src/fx/camerashake.js).
 * Nigdy nie wplywa na symulacje, wiec bezpiecznie moze sie roznic klatka po
 * klatce miedzy klientami bez zadnych konsekwencji dla stanu meczu.
 */
export const CAMERA_SHAKE = {
  maxTrauma: 1,
  halfLife: 0.25,          // po tylu sekundach trauma spada o polowe (wykladniczy zanik)
  // Kamera jest DALEKO od sledzonej postaci (offset ~17 jednostek), wiec zeby
  // przesuniecie pozycji bylo widoczne na ekranie, musi byc wieksze niz przy
  // typowej bliskiej kamerze FPS. maxOffset=1.4 przy trauma=1 daje wyrazne,
  // ale nie chaotyczne drganie — zweryfikowane zrzutami ekranu.
  maxOffset: 1.4,
  noiseInterval: 0.045,     // co ile sekund losujemy nowy kierunek szumu (wygladzany miedzy probkami)
  impulses: {
    dogBark: 0.4,
    gardenerHit: 0.55,
    hoseEject: 0.7
  },
  falloffDist: {
    dogBark: 11,
    gardenerHit: 6,
    hoseEject: 13
  }
};

/**
 * System pingow (Zadanie 3) — komunikacja bez czatu. Pole `ping` jedzie w tym
 * samym obiekcie Command co reszta wejscia (patrz src/entities/actor.js),
 * wiec ten blok trzyma tylko strojenie: jak czesto wolno pingowac i jak dlugo
 * znacznik zyje w swiecie, zanim zniknie.
 */
export const PING = {
  cooldown: 2.2,   // limit czestotliwosci na aktora — inaczej staje sie spamem
  life: 5,         // sekundy, zanim znacznik 3D wygasnie
  edgeMargin: 46   // px od krawedzi ekranu dla wskaznika poza kadrem
};

export const ECONOMY = {
  silverPerMatch: 40,
  silverWinBonus: 55,
  silverPerVegetable: 12,
  silverPerCatch: 18,
  goldPerWin: 2,
  goldPerMatch: 1
};

/** Perki — gracz wybiera 2 przed meczem (GDD: Drzewko Loadoutow). */
export const PERKS = [
  { id: 'digger',   name: 'Kopacz',        team: 'mole', desc: 'Zejście pod ziemię i wynurzenie o 45% szybsze.', apply: s => { s.digTime *= 0.55; } },
  { id: 'silent',   name: 'Cichy Bandyta', team: 'mole', desc: 'Obłoczki kurzu pojawiają się o 60% rzadziej.',     apply: s => { s.dustInterval *= 2.5; } },
  { id: 'lungs',    name: 'Wielkie Płuca', team: 'mole', desc: '+40 staminy i szybszy sprint.',                    apply: s => { s.staminaMax += 40; s.sprintMultiplier += 0.15; } },
  { id: 'thief',    name: 'Zwinne Łapki',  team: 'mole', desc: 'Podnoszenie warzywa trwa 0.9s zamiast 1.5s.',      apply: s => { s.pickupTime = 0.9; } },
  { id: 'tough',    name: 'Twarda Skóra',  team: 'mole', desc: '+45 HP i krótsze ogłuszenie po wodzie.',           apply: s => { s.hp += 45; s.stunAfterEject *= 0.6; } },
  { id: 'ghost',    name: 'Duch Ogrodu',   team: 'mole', desc: 'Ślad zapachowy znika po 2s zamiast po 5s.',        apply: s => { s.scentLifetime = 2.0; } },

  { id: 'strong',   name: 'Siłacz',        team: 'def',  desc: 'Atak podstawowy zadaje +40% obrażeń.',             apply: s => { (s.melee || s.bite).damage *= 1.4; } },
  { id: 'quick',    name: 'Szybkie Ręce',  team: 'def',  desc: 'Wszystkie cooldowny umiejętności -30%.',           apply: s => { if (s.hose) { s.hose.cooldown *= 0.7; s.soundTrap.cooldown *= 0.7; } if (s.bark) s.bark.cooldown *= 0.7; } },
  { id: 'boots',    name: 'Gumowce',       team: 'def',  desc: '+18% prędkości ruchu.',                            apply: s => { s.speed *= 1.18; } },
  { id: 'hunter',   name: 'Tropiciel',     team: 'def',  desc: 'Większy zasięg wody / szczekania.',                apply: s => { if (s.hose) s.hose.ejectRadius *= 1.35; if (s.bark) s.bark.radius *= 1.3; } },
  { id: 'brawler',  name: 'Zamaszysty',    team: 'def',  desc: 'Szerszy i dłuższy zasięg ataku podstawowego.',     apply: s => { const a = s.melee || s.bite; a.range *= 1.35; a.arc *= 1.25; } },
  { id: 'watchdog', name: 'Czujność',      team: 'def',  desc: 'Kopce wykrywasz z dwukrotnie większej odległości.', apply: s => { s.visionRange *= 1.4; } }
];

/** Sklep — odblokowania (srebro) i kosmetyka (zlote zoledzie). */
export const SHOP = [
  { id: 'cls_gardener', kind: 'class',  name: 'Ogrodnik',           desc: 'Klasa obrońcy: młotek + wąż z wodą.', currency: 'silver', price: 0 },
  { id: 'cls_dog',      kind: 'class',  name: 'Pies (Owczarek)',    desc: 'Klasa obrońcy: węch + szczekanie.',   currency: 'silver', price: 250 },
  { id: 'hat_straw',    kind: 'cosmetic', slot: 'hat', name: 'Słomkowy kapelusz', desc: 'Nakrycie głowy dla kreta.', currency: 'gold', price: 4, color: 0xe8c766 },
  { id: 'hat_cone',     kind: 'cosmetic', slot: 'hat', name: 'Czapka górnika',    desc: 'Świeci w tunelach.',        currency: 'gold', price: 7, color: 0xffd76a },
  { id: 'hat_crown',    kind: 'cosmetic', slot: 'hat', name: 'Korona Kreta',      desc: 'Dla prawdziwych królów grządek.', currency: 'gold', price: 14, color: 0xffcf4d },
  { id: 'fx_confetti',  kind: 'cosmetic', slot: 'fx', name: 'Konfetti z nory',   desc: 'Wybuch konfetti przy dostawie.', currency: 'gold', price: 6, color: 0xff5fa2 },
  { id: 'fx_gold',      kind: 'cosmetic', slot: 'fx', name: 'Złoty pył',         desc: 'Złoty wybuch przy dostawie.',    currency: 'gold', price: 11, color: 0xffcf4d }
];

/**
 * Gotowe formaty. Liczby klas obroncow sa podane wprost, zeby ten sam resolver
 * obsluzyl presety i ustawienia wlasne. Wszystkie liczby to STANY LACZNE —
 * gracz zajmuje jeden ze slotow swojej klasy.
 */
export const FORMATS = {
  '3v1': { moles: 3, gardeners: 1, dogs: 0, vegetablesToWin: 16, duration: 210 },
  '4v2': { moles: 4, gardeners: 1, dogs: 1, vegetablesToWin: 22, duration: 210 }
};

/** Zakresy suwakow w trybie wlasnym. */
export const CUSTOM_LIMITS = {
  moles: { min: 1, max: 8, step: 1, label: 'Krety' },
  gardeners: { min: 0, max: 4, step: 1, label: 'Ogrodnicy' },
  dogs: { min: 0, max: 4, step: 1, label: 'Psy' },
  vegetablesToWin: { min: 1, max: 40, step: 1, label: 'Cel (warzywa)' },
  duration: { min: 60, max: 420, step: 30, label: 'Czas rundy (s)' }
};

/** Sugerowany cel przy danej liczbie kretow — tyle mniej wiecej daje mecz na 2-3 min. */
export function suggestedGoal(moles) {
  return Math.max(3, Math.round(moles * 5.3));
}

/**
 * Zamienia zapis gracza na konkretny sklad meczu.
 * @returns {{moles:number, defenderClasses:string[], defenders:number,
 *            vegetablesToWin:number, duration:number}}
 */
export function resolveMatchSetup(save) {
  const src = save.format === 'custom'
    ? { ...save.custom }
    : { ...(FORMATS[save.format] || FORMATS['3v1']) };

  const clamp = (v, lim) => Math.max(lim.min, Math.min(lim.max, Math.round(v)));
  const moles = clamp(src.moles ?? 3, CUSTOM_LIMITS.moles);
  let gardeners = clamp(src.gardeners ?? 1, CUSTOM_LIMITS.gardeners);
  let dogs = clamp(src.dogs ?? 0, CUSTOM_LIMITS.dogs);

  const playerCls = save.faction;
  if (playerCls !== 'mole') {
    // gracz musi miec slot swojej klasy — jesli go nie ma, zabieramy jeden drugiej
    if (playerCls === 'dog' && dogs === 0) { dogs = 1; if (gardeners > 0) gardeners--; }
    if (playerCls === 'gardener' && gardeners === 0) { gardeners = 1; if (dogs > 0) dogs--; }
  }

  let classes = [...Array(gardeners).fill('gardener'), ...Array(dogs).fill('dog')];
  if (classes.length === 0) classes = ['gardener'];         // zawsze co najmniej jeden obronca

  if (playerCls !== 'mole') {
    // slot gracza na pierwszym miejscu (Game bierze index 0 jako lokalnego)
    const i = classes.indexOf(playerCls);
    if (i > 0) classes.splice(i, 1), classes.unshift(playerCls);
  }

  return {
    moles,
    defenderClasses: classes,
    defenders: classes.length,
    vegetablesToWin: clamp(src.vegetablesToWin ?? suggestedGoal(moles), CUSTOM_LIMITS.vegetablesToWin),
    duration: clamp(src.duration ?? MATCH.duration, CUSTOM_LIMITS.duration)
  };
}

/** Glęboka kopia obiektu balansu — perki modyfikuja instancje, nie globalny config. */
export function cloneStats(src) {
  return JSON.parse(JSON.stringify(src));
}
