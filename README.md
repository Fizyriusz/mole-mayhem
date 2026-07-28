# 🐭 Mole Mayhem 3D

Grywalny prototyp asymetrycznej areny **Krety vs. Obrońcy** z GDD — Three.js + Vite, bez zewnętrznych
assetów (cała geometria, tekstury i dźwięki są generowane proceduralnie w kodzie).

```bash
npm install
npm run dev      # http://localhost:5175
npm run build    # statyczny build do dist/
```

---

## Jak się gra

| Klawisz | Akcja |
|---|---|
| `WASD` | ruch (wektory przeliczane względem obrotu kamery) |
| `LPM` | atak podstawowy; przytrzymany przejmuje obrót postaci na kursor |
| `Spacja` | **Kret:** zejście pod ziemię / wynurzenie (0.5 s) |
| `E` | akcja kontekstowa: zbierz warzywo · oddaj w norze · zadepcz kopiec · odnieś warzywo |
| `Q` | umiejętność 1 (rzut ziemią / wąż z wodą / szczekanie) |
| `F` | umiejętność 2 (pułapka dźwiękowa / węszenie) |
| `Shift` | sprint (zużywa staminę) |
| `Esc` | pauza · `Backspace` w pauzie = wyjście do menu |

**Obrót postaci:** sylwetka patrzy tam, gdzie idzie (stała prędkość kątowa 18 rad/s — pełny zawrot
w 0.18 s). Kursor przejmuje kontrolę nad obrotem dopiero przy przytrzymanym `LPM` i wtedy działa
natychmiastowo, bez wygładzania — dzięki temu da się chodzić w bok, celując w jedno miejsce.

**Dotyk:** lewa połowa ekranu to wirtualny joystick (wychylenie do końca = sprint), prawa połowa
celuje i atakuje, a przyciski umiejętności obsługują *swipe & release* — przeciągasz z przycisku
w wybraną stronę, puszczasz i umiejętność leci w tym kierunku.

Cel kretów: dowieźć wymaganą liczbę warzyw do świecących nor w rogach mapy.
Cel obrońców: zbić kretom HP do zera albo przetrwać do końca czasu.

## Formaty meczu

Obok gotowych `3v1` i `4v2` jest tryb **Własny**, gdzie ustawiasz liczbę kretów (1–8), ogrodników
(0–4), psów (0–4), cel w warzywach (1–40) i długość rundy (60–420 s). Liczby są łączne — Twój slot
też się liczy, więc „gram psem, dwóch ogrodników i 5 kretów" to `Krety 5 · Ogrodnicy 2 · Psy 1`
przy wybranej frakcji Pies.

Resolver ([`resolveMatchSetup()`](src/core/config.js)) pilnuje przypadków brzegowych: przy zerowej
liczbie obrońców dostawia jednego ogrodnika, a jeśli wybrałeś klasę, dla której nie ma slotu,
zamienia jeden slot drugiej klasy. Punktów startowych na mapie jest cztery, więc przy większych
składach kolejne postacie rozstawiają się w pierścieniach wokół nich.

---

## Granie na telefonie (solo)

Gra jest w pełni dotykowa i responsywna. **Najwygodniej w poziomie** — w pionie kamera musi się
mocno odsunąć (patrz `CameraRig.resize()`), więc postacie są małe; w pionie wyświetla się o tym
podpowiedź.

Żeby odpalić na telefonie w tej samej sieci Wi-Fi (bez multiplayera, każdy grający solo):

```bash
npm run dev
```

Vite wypisze dwa adresy — bierzesz ten przy `Network`, np. `http://192.168.18.5:5175`, i wklejasz
go w przeglądarkę telefonu. Warunki: ten sam Wi-Fi (bez izolacji klientów) i przepuszczenie
Node.js przez zaporę Windows dla sieci **prywatnej**.

Wersja zbudowana (szybsza, bez narzutu dev-servera):

```bash
npm run build
npm run preview      # http://<twoje-ip>:4173
```

`base: './'` w konfiguracji sprawia, że `dist/` działa też wrzucone na GitHub Pages, Netlify albo
Vercel — wtedy telefon nie musi być w tej samej sieci. Do **wspólnego** meczu z drugą osobą
(nie każdy osobno z botami) służy zakładka **Wieloosobowa** — patrz sekcja niżej.

---

## Multiplayer

Prawdziwy wspólny mecz: jeden gracz jest hostem i liczy pełną symulację (dokładnie tak jak w grze
solo — te same klasy `Mole`/`Gardener`/`Dog`, ta sama AI dla wolnych slotów), reszta graczy wysyła
mu swoje komendy ruchu/akcji i dostaje ~20 razy na sekundę skrót stanu meczu (snapshot) do
wyrenderowania. **Serwer sesji (relay) nie zna zasad gry** — tylko przekazuje wiadomości w obrębie
pokoju. To dlatego, że hosting typu Vercel nie utrzyma połączenia WebSocket (funkcje serverless są
zabijane zaraz po odpowiedzi) — front i serwer sesji to zawsze dwa osobne miejsca.

### Architektura

```
Vercel (albo dowolny static hosting)     ← dist/, sama gra
        │  WebSocket
        ▼
Cloudflare Worker — worker/index.js      ← relay pokoi, ~180 linii, bez logiki gry
        (lokalnie na 1999, albo *.workers.dev)
```

- [`worker/index.js`](worker/index.js) — serwer pokoju: roster graczy, przekazuje `claim`
  (wybór frakcji), `start` (host → wszyscy), `cmd` (gość → **tylko host**), `snapshot`/`event`
  (host → wszyscy oprócz hosta). Format wiadomości opisany w nagłówku pliku.
  Jeden **Durable Object** = jeden pokój, adresowany kodem z URL-a.
- [`src/net/client.js`](src/net/client.js) — `NetClient`, cienki klient WebSocket po stronie gry.
- [`src/core/netsync.js`](src/core/netsync.js) — `serializeSnapshot()`/`applySnapshot()`. Filozofia:
  snapshot jest źródłem prawdy dla liczb HUD; FX/dźwięki dla cudzych postaci są **wywnioskowane**
  z różnicy między kolejnymi snapshotami (np. „underground było 0, jest 1” → efekt kopania), więc
  nie trzeba osobnego strumienia zdarzeń.
- [`src/entities/actor.js`](src/entities/actor.js) — `applyNetworkState()` (postać-marionetka:
  gładkie dogonienie pozycji ze snapshotu, zero własnej fizyki) i `reconcileSelf()` (WŁASNA postać
  gracza: hp/ogłuszenie/spowolnienie są zawsze słowem hosta i go nadpisują, ale pozycja zostaje
  lokalna — inaczej sterowanie by się cięło).

Host liczy WSZYSTKO tak jak w solo (włącznie z botami na wolnych slotach); gość dostaje pełną,
lokalną predykcję WYŁĄCZNIE dla własnej postaci (responsywne sterowanie), a wszystkich innych
aktorów renderuje jako marionetki napędzane snapshotem.

### Uruchomienie lokalne

```bash
npm run relay:dev      # serwer sesji lokalnie, port 1999 (wrangler dev)
npm run dev            # sama gra, port 5175
```

albo jednym kliknięciem: `start-servers.cmd` (otwiera oba w osobnych oknach).

W grze, w zakładce **Wieloosobowa**, pole *Adres serwera* wypełnia się samo adresem hosta,
z którego załadowano stronę + `:1999` — więc przy grze przez LAN/Tailscale nie trzeba nic
wpisywać. Host klika **Stwórz sesję** → dostaje 4-znakowy kod → przekazuje go znajomym. Oni
wpisują ten sam adres serwera + kod i klikają **Dołącz**. Frakcję każdy wybiera na zakładce
„Graj” (widać ją od razu w poczekalni); host klika **START MECZU**, gdy skład go satysfakcjonuje.
Wolne sloty (bez podłączonego gracza) zawsze dostają bota — ten sam mechanizm co w grze solo.

Pole adresu serwera jest zapamiętywane w przeglądarce (`localStorage`), więc da się podmienić
relay bez przebudowy frontendu.

### Wdrożenie (Vercel + Cloudflare Workers)

> **Najważniejsze ograniczenie:** strona na Vercelu chodzi po HTTPS, a przeglądarka **blokuje**
> stronie HTTPS otwieranie połączeń `ws://` (mixed content). Po wdrożeniu na Vercel relay na
> localhoście / LAN / Tailscale **przestaje działać** — musi mieć TLS. Gra wykrywa ten przypadek
> i pokazuje konkretny komunikat zamiast generycznego timeoutu.

**Krok 1 — relay na Cloudflare** (musi być pierwszy, bo jego adres jest potrzebny do builda):

```bash
npm run relay:login     # jednorazowo: otwiera przeglądarkę, autoryzacja konta
npm run relay:deploy
```

Wypisze adres w formacie `mole-mayhem-relay.<twój-subdomain>.workers.dev`. Człon
`mole-mayhem-relay` pochodzi z pola `name` w [`wrangler.toml`](wrangler.toml), a
`<twój-subdomain>` to subdomena konta (panel → *Workers & Pages* → *Account Details*).

> Jeśli deploy przerwie z „You need to register a workers.dev subdomain": konto nie ma jeszcze
> subdomeny. Wrangler próbuje o nią zapytać, ale **w trybie nieinteraktywnym sam sobie odpowiada
> „nie"** i przerywa — bez żadnego widocznego pytania. Subdomenę zakłada się raz, w panelu
> Cloudflare; potem deploy przechodzi bez pytań.

**Krok 2 — frontend na Vercel:** *Add New → Project* → import repo z GitHuba. Vercel wykryje Vite
sam, a [`vercel.json`](vercel.json) i tak ustawia to jawnie (`npm run build` → `dist/`). Przed
pierwszym deployem dodaj zmienną środowiskową:

| Klucz | Wartość |
|---|---|
| `VITE_PARTYKIT_HOST` | `mole-mayhem-relay.<twój-subdomain>.workers.dev` |

**Vite podstawia zmienne `VITE_*` w momencie budowania, nie w przeglądarce** — jeśli dodasz ją
po deployu, trzeba zrobić *Redeploy*, żeby zadziałała. Bez niej gra na HTTPS zostawia pole
*Adres serwera* puste i trzeba je wypełnić ręcznie (patrz `defaultHost()` w
[`src/net/client.js`](src/net/client.js)).

Kolejność źródeł adresu: **wpis gracza w polu (localStorage) → `VITE_PARTYKIT_HOST` → auto-wykrycie
z adresu strony**. Ręczny wpis zawsze wygrywa, więc da się podmienić relay bez redeployu.

#### Dlaczego nie PartyKit

Projekt startował na PartyKit i `party/session.js` działał bez zarzutu, ale `partykit deploy`
publikuje na **współdzielonej** domenie `partykit.dev`, która uderzyła w twardy limit Cloudflare
(10 000 custom domains na strefę) — błąd globalny, niezależny od nas i nie do obejścia po stronie
kodu. Ponieważ PartyKit i tak stoi pod spodem na Durable Objects, relay przeniesiono na czystego
Workera na **własnym koncie**: ta sama technologia, własna strefa, limit znika.

Sprawdzana była też droga na skróty — `partykit dev` + tunel (localtunnel). **Nie działa**: darmowy
localtunnel wykłada się na kilku równoległych, trwałych połączeniach WebSocket. Zmierzone —
3 próby po 2 jednoczesne połączenia: w dwóch padły oba, w jednej jedno z dwóch; pojedyncze
połączenie wchodziło dopiero po ~5 s. Dla gry, gdzie każdy gracz trzyma otwarty socket, to
dyskwalifikacja.

**Koszt:** Durable Objects mieszczą się w darmowym planie Workers (100 tys. zapytań/dobę,
13 000 GB-s/dobę). Dlatego w [`wrangler.toml`](wrangler.toml) migracja używa
`new_sqlite_classes`, a nie `new_classes` — darmowy plan udostępnia wyłącznie backend SQLite.

**Alternatywa bez Vercela:** zostaw grę lokalnie (`npm run dev`) i wejdźcie przez Tailscale.
Wtedy wszystko chodzi po HTTP i relay na `localhost:1999` działa bez przeszkód — kosztem tego,
że Twój komputer musi być włączony.

### Znane uproszczenia V1

- **Perki i kosmetyka nie działają w meczu sieciowym** — wymagałoby to synchronizacji wyboru
  KAŻDEGO gracza przed startem; wszystkie postacie (host, goście, boty) dostają bazowe staty.
  Solo nie jest tym dotknięte.
- **Brak pauzy w meczu sieciowym** — hostowa pauza zatrzymałaby wysyłanie snapshotów i zamroziła
  grę wszystkim; `Esc` jest wtedy no-opem.
- **Host jest pojedynczym punktem awarii.** Jego wyjście kończy mecz dla wszystkich (bez migracji
  hosta) — gość dostaje czytelny komunikat i wraca do menu.
- **Reconnect nie wraca do tego samego slotu.** Rozłączony gracz zostaje zastąpiony botem
  (natychmiast, patrz `attachNet()` w [`src/core/game.js`](src/core/game.js)); ponowne dołączenie
  to nowe połączenie, nowy slot.
- **Prosty lerp zamiast pełnego bufora interpolacji.** Dla sieci lokalnej/tunelu (niskie opóźnienia)
  wygląda płynnie; przy wysokim, zmiennym pingu (gra przez daleki internet) osoby-marionetki
  mogłyby delikatnie „doganiać” pozycję zamiast płynnie się przesuwać.
- **Rzucanie ziemią przez inne postacie nie jest widoczne u gościa** — sam efekt (spowolnienie,
  zaburzenie ekranu) synchronizuje się poprawnie przez `reconcileSelf()`, ale lot grudki ziemi
  rzuconej przez kogoś innego nie jest renderowany. Świadomy skrót: zsynchronizowanie samego lotu
  pocisku groziło podwójnym liczeniem trafień (rzucający symuluje go lokalnie u siebie, a
  broadcast od hosta dubasowałby to samo u niego drugi raz) i wymagałoby dodatkowego znacznika
  „czyj to pocisk” w evencie — nieproporcjonalny koszt do efektu bocznej umiejętności.
- Deterministyczna geometria areny: przeszkody dekoracyjne (skały, korzenie) używają seedowanego
  PRNG (`mulberry32`, stały seed w [`src/world/arena.js`](src/world/arena.js)) zamiast
  `Math.random()`, żeby host i gość mieli identyczną geometrię kolizji — bez tego rozjeżdżałyby się
  przeszkody między klientami.

## Mapa GDD → kod

| Punkt GDD | Realizacja |
|---|---|
| 3D Top-Down z śledzeniem obiektu | [`src/core/camera.js`](src/core/camera.js) — `CameraRig`, dwa zestawy offsetów (powierzchnia / tunel) |
| Stan 1 ↔ Stan 2 kreta (Y = −2, 0.5 s przejścia, 80 % prędkości) | [`src/entities/mole.js`](src/entities/mole.js) — `toggleDig()`, `setUnderground()` |
| Kopiec `DirtMound` na `InstancedMesh` | [`src/world/mounds.js`](src/world/mounds.js) |
| Widok podziemny (ukrywanie warstw geometrycznych) | warstwy `LAYER.SURFACE` / `LAYER.UNDER` w [`src/core/config.js`](src/core/config.js), przełączane przez `camera.layers` |
| Winieta + zaburzenie obrazu (EffectComposer) | [`src/fx/postfx.js`](src/fx/postfx.js) — `RenderPass → ShaderPass → OutputPass` |
| Pulsujące okręgi na Y = 0 od kroków obrońców | [`src/fx/ripples.js`](src/fx/ripples.js) — pula meshy z falującym shaderem |
| Obłoczki kurzu zdradzające kreta pod ziemią | [`src/fx/particles.js`](src/fx/particles.js) — `dustPuff()`, pule `THREE.Points` |
| Warzywo doczepiane do kreta w drzewie sceny | [`src/world/vegetables.js`](src/world/vegetables.js) — `attachTo()` używa `actor.group.add(mesh)` |
| Ogrodnik: młotek (stożek trafienia) | [`src/entities/defender.js`](src/entities/defender.js) — `attack()` |
| Ogrodnik: wąż z wodą (wypłukuje kreta z tunelu + stun 2 s) | `Gardener.useHose()` |
| Ogrodnik: pułapka dźwiękowa zakłócająca echolokację | [`src/entities/traps.js`](src/entities/traps.js) → uniform `uDisturb` w shaderze |
| Pies: węch = ślady zapachowe na `DecalGeometry` | [`src/fx/scent.js`](src/fx/scent.js) |
| Pies: szczekanie jako sfera 3D (działa też pod ziemią) | `Dog.bark()` — dystans liczony w 3D, więc łapie kreta na Y = −2 |
| Raycaster ekran → świat, `lookAt` na Y = 0 | [`src/core/input.js`](src/core/input.js) — `aimPoint()` |
| Ekonomia, perki, kosmetyka, ekran podsumowania | [`src/meta/economy.js`](src/meta/economy.js) + [`src/ui/ui.js`](src/ui/ui.js) (nakładka HTML/CSS nad canvasem) |

## Architektura

```
worker/index.js       serwer sesji (Cloudflare Worker + Durable Object) — relay, bez logiki gry
wrangler.toml         konfiguracja relaya (port 1999 lokalnie, deploy na workers.dev)
src/
  main.js              pętla renderowania + adaptacyjny pixelRatio
  core/                config (balans), game (rdzeń + netRole host/guest), netsync (snapshoty),
                       camera, input, collision, audio, dispose
  net/                 client.js — NetClient (WebSocket do worker/index.js)
  world/               arena, vegetables, mounds, burrows, textures (proceduralne CanvasTexture)
  entities/            actor (baza + tryb sieciowy), mole, defender (Gardener + Dog), traps, models
  fx/                  postfx, particles, ripples, scent
  ai/                  bots — FSM kretów i obrońców (TYLKO host je uruchamia)
  meta/                economy (localStorage)
  ui/                  ui.js + style.css (nakładka HTML nad canvasem, w tym lobby wieloosobowa)
```

Kluczowa decyzja projektowa: **gracz i bot produkują dokładnie ten sam obiekt `Command`**
(`{ mx, mz, sprint, aimX, aimZ, primary, dig, interact, ability1, ability2 }`). Logika postaci nie
wie, kto nią steruje — dlatego podmiana sterowania na pakiety sieciowe jest zmianą w jednym miejscu
(`Game.update()`), a nie przepisaniem encji.

Kolizje: własny, lekki solver kinematyczny 2D (koła + AABB na płaszczyźnie XZ) zamiast pełnego
silnika fizyki — arena jest zbudowana z walców i prostopadłościanów, a to oszczędza ~1 MB WASM-a
i klatki na mobile. Osobne zestawy przeszkód dla powierzchni i dla tuneli (korzenie blokują kreta,
ale nie ogrodnika).

## Balans (bot vs. bot, mierzone w symulacji)

| Format | Czas meczu | Wynik |
|---|---|---|
| 3v1 (16 warzyw) | 85–213 s | 2 : 2 na cztery mecze |
| 4v2 (22 warzywa) | 115–213 s | 1 : 2 na trzy mecze |

Wszystkie liczby siedzą w [`src/core/config.js`](src/core/config.js) — to jedyny plik, który trzeba
ruszać przy strojeniu rozgrywki. Tryb Własny pozwala rozjechać ten balans świadomie: przy stosunku
4 kretów na obrońcę UI ostrzega, że obrońcy nie zdążą.

## Czego tu nie ma

* **Serwera meta-gry.** Portfel, odblokowania i perki żyją w `localStorage` — każdy gracz ma
  własny, niezależny postęp; multiplayer synchronizuje tylko sam mecz, nie ekonomię.
* **Migracji hosta ani reconnectu do tego samego slotu** — patrz „Znane uproszczenia V1” wyżej.
* Modele są proceduralne (low-poly, flat shading) — docelowo do podmiany na siatki z DCC.

## Dodane ponad GDD (i dlaczego)

* **Rzut ziemią u kreta** (`Q`) — GDD wspomina „rzucanie przedmiotami", ale bez konkretu; grudka
  ziemi spowalnia i oślepia obrońcę, żeby kret miał czym się bronić na powierzchni.
* **Kłapnięcie psa** — GDD daje psu tylko węch i szczekanie, więc sam nie mógłby nikogo złapać.
* **Węszenie** (`F` u psa) — aktywna wersja pasywnego węchu, wyrównuje liczbę przycisków między klasami.
* **Odrastanie warzyw** (18 s) i **alarm przy kradzieży** — bez nich mapa się wyczerpywała, a obrońca
  nie miał żadnej informacji, gdzie się dzieje kradzież.
