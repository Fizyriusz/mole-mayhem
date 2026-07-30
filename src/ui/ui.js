/**
 * Nakladka UI (HTML/CSS nad canvasem) — menu/lobby, HUD meczu i ekran podsumowania.
 * Nie zna Three.js; dostaje gotowe liczby z warstwy gry.
 */
import { PERKS, SHOP, CUSTOM_LIMITS, resolveMatchSetup, suggestedGoal } from '../core/config.js';
import { NetClient, randomRoomCode, getSavedHost, saveHost, getSavedName, saveName } from '../net/client.js';
import * as Eco from '../meta/economy.js';
import * as Settings from '../meta/settings.js';

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const SETTINGS_STEP = 0.25;   // 5 poziomow: 0/25/50/75/100% — dla glosnosci i wstrzasow kamery

export class UI {
  constructor({ onPlay, onQuitToMenu, audio }) {
    this.onPlay = onPlay;
    this.onQuitToMenu = onQuitToMenu;
    this.audio = audio;
    this.game = null;      // ustawiane z zewnatrz po skonstruowaniu Game (main.js) — patrz uwaga tam

    this.el = {
      menu: $('#menu'), hud: $('#hud'), end: $('#endscreen'), loading: $('#loading'),
      veg: $('#hud-veg'), moles: $('#hud-moles'), timer: $('#hud-timer'), phase: $('#hud-phase'),
      roster: $('#hud-roster'), banner: $('#hud-banner'), cast: $('#hud-cast'),
      castBar: $('#hud-cast .cast-bar i'), castLabel: $('#hud-cast .cast-label'),
      hp: $('#bar-hp'), st: $('#bar-st'), carry: $('#carry'), carryCount: $('#carry-count'),
      abilities: $('#abilities'), hint: $('#hud-hint'), stick: $('#touch-left'),
      pingEdges: $('#ping-edges'), hudMenuBtn: $('#hud-menu-btn'),
      matchMenu: $('#match-menu'), mmTitle: $('#mm-title'), mmLive: $('#mm-live'),
      mmMain: $('#mm-main'), mmResume: $('#mm-resume'), mmRestart: $('#mm-restart'),
      mmSettingsOpen: $('#mm-settings-open'), mmLeave: $('#mm-leave'), mmQuit: $('#mm-quit'),
      mmSettings: $('#mm-settings'), mmSettingsBack: $('#mm-settings-back'),
      mmVolVal: $('#mm-vol-val'), mmVolMinus: $('#mm-vol-minus'), mmVolPlus: $('#mm-vol-plus'),
      mmShakeVal: $('#mm-shake-val'), mmShakeMinus: $('#mm-shake-minus'), mmShakePlus: $('#mm-shake-plus'),
      mmConfirm: $('#mm-confirm'), mmConfirmText: $('#mm-confirm-text'),
      mmConfirmYes: $('#mm-confirm-yes'), mmConfirmNo: $('#mm-confirm-no'),
      silver: $('#w-silver'), gold: $('#w-gold'),
      perkList: $('#perk-list'), shopList: $('#shop-list'), playNote: $('#play-note'),
      customSetup: $('#custom-setup'),
      shakeVal: $('#shake-val'), shakeMinus: $('#shake-minus'), shakePlus: $('#shake-plus'),
      volVal: $('#vol-val'), volMinus: $('#vol-minus'), volPlus: $('#vol-plus'),
      endTitle: $('#end-title'), endSub: $('#end-sub'), endStats: $('#end-stats'),
      endSilver: $('#end-silver'), endGold: $('#end-gold'),
      mpConnect: $('#mp-connect'), mpLobby: $('#mp-lobby'),
      mpHost: $('#mp-host'), mpName: $('#mp-name'), mpCode: $('#mp-code'), mpConnectNote: $('#mp-connect-note'),
      mpRoomCode: $('#mp-room-code'), mpRoster: $('#mp-roster'),
      mpStart: $('#btn-mp-start'), mpWaitNote: $('#mp-wait-note')
    };

    this.net = null;
    this.mpRoster = [];
    this.mpHostId = null;
    this.mpRoom = null;

    this.hintTimer = 0;
    this.bannerTimer = 0;
    this._pingEdgeEls = [];
    this._bindMenu();
    this._bindMultiplayer();
    this._bindMatchMenu();
  }

  /* ------------------------------------------------------------ MENU */

  _bindMenu() {
    $$('.tab').forEach(tab => tab.addEventListener('click', () => {
      $$('.tab').forEach(t => t.classList.remove('active'));
      $$('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      $(`.panel[data-panel="${tab.dataset.tab}"]`).classList.add('active');
      this.audio?.play('ui');
    }));

    $$('.faction').forEach(btn => btn.addEventListener('click', () => {
      const cls = btn.dataset.class;
      if (!Eco.isClassUnlocked(cls)) {
        this.el.playNote.textContent = 'Ta klasa jest zablokowana — odblokuj ją w sklepie.';
        this.audio?.play('hurt');
        return;
      }
      Eco.setFaction(cls);
      this.net?.claim(cls);   // w lobby wieloosobowej wybor frakcji od razu widac u innych
      this.refreshMenu();
      this.audio?.play('ui');
    }));

    $$('.fmt').forEach(btn => btn.addEventListener('click', () => {
      Eco.setFormat(btn.dataset.format);
      this.refreshMenu();
      this.audio?.play('ui');
    }));

    $('#btn-play').addEventListener('click', () => this._startOrRematch());
    $('#btn-again').addEventListener('click', () => this._startOrRematch());
    $('#btn-menu').addEventListener('click', () => this.onQuitToMenu());

    this.el.shakeMinus.addEventListener('click', () => this._adjustShake(-SETTINGS_STEP));
    this.el.shakePlus.addEventListener('click', () => this._adjustShake(SETTINGS_STEP));
    this.el.volMinus.addEventListener('click', () => this._adjustVolume(-SETTINGS_STEP));
    this.el.volPlus.addEventListener('click', () => this._adjustVolume(SETTINGS_STEP));
  }

  _adjustShake(delta) {
    Settings.setShakeIntensity(Settings.getSettings().shakeIntensity + delta);
    this._renderSettings();
    this.audio?.play('ui');
  }

  _adjustVolume(delta) {
    const v = Math.max(0, Math.min(1, Settings.getSettings().volume + delta));
    Settings.setVolume(v);
    this.audio?.setVolume(v);
    this._renderSettings();
    this.audio?.play('ui');
  }

  /**
   * Wspolna logika "zacznij mecz" dla przyciskow ROZPOCZNIJ MECZ / JESZCZE RAZ.
   * Jesli jestesmy w zywej sesji sieciowej, idzie PRZEZ NIA zamiast cicho spasc
   * do gry solo — bez tego host klikajac "Jeszcze raz" po meczu siecowym
   * odlaczal by (semantycznie) goscia, ktory zamarzalby na ekranie koncowym,
   * bo host przestalby wysylac snapshoty (netRole wrocilby do null).
   */
  _startOrRematch() {
    if (this.net?.connected) {
      if (this.net.isHost) {
        const guests = this.mpRoster.filter(p => p.id !== this.net.id);
        this.game.startMatchHost(guests, this.el.mpName.value.trim() || 'Host');
      } else {
        this._showMpTab();
        this.el.mpWaitNote.textContent = 'Czekaj, aż host rozpocznie kolejny mecz…';
      }
      return;
    }
    this.onPlay();
  }

  _showMpTab() {
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'mp'));
    $$('.panel').forEach(p => p.classList.toggle('active', p.dataset.panel === 'mp'));
    this.el.menu.classList.remove('hidden');
    this.el.hud.classList.add('hidden');
    this.el.end.classList.add('hidden');
  }

  /* ------------------------------------------------------ WIELOOSOBOWA */

  _bindMultiplayer() {
    this.el.mpHost.value = getSavedHost();
    this.el.mpName.value = getSavedName();

    $('#btn-mp-create').addEventListener('click', () => this._mpConnect(randomRoomCode()));
    $('#btn-mp-join').addEventListener('click', () => {
      const code = this.el.mpCode.value.trim().toUpperCase();
      if (!code) { this.el.mpConnectNote.textContent = 'Podaj kod pokoju od hosta.'; return; }
      this._mpConnect(code);
    });
    $('#btn-mp-copy').addEventListener('click', () => {
      navigator.clipboard?.writeText(this.mpRoom || '').catch(() => {});
      this.flashHint('Kod skopiowany');
    });
    $('#btn-mp-leave').addEventListener('click', () => {
      this.net?.disconnect();
      this._mpShowConnectForm('');
    });
    $('#btn-mp-start').addEventListener('click', () => this._startOrRematch());
  }

  async _mpConnect(room) {
    const host = this.el.mpHost.value.trim();
    const name = this.el.mpName.value.trim() || 'Gracz';
    if (!host) { this.el.mpConnectNote.textContent = 'Podaj adres serwera (np. localhost:1999).'; return; }
    saveHost(host);
    saveName(name);
    this.audio?.unlock();     // to gest uzytkownika — dobry moment na odblokowanie WebAudio
    this.el.mpConnectNote.textContent = 'Łączenie…';

    const client = new NetClient();
    try {
      await client.connect(host, room, name);
    } catch (e) {
      this.el.mpConnectNote.textContent = e.message || 'Nie udało się połączyć.';
      return;
    }

    this.net = client;
    this.mpRoom = room;
    this.game.attachNet(client);
    client.claim(Eco.getSave().faction);

    client.onRoster(msg => { this.mpRoster = msg.players; this.mpHostId = msg.hostId; this._renderMpRoster(); });
    client.onHostLeft(() => this._mpShowConnectForm('Host opuścił lobby.'));
    client.onDisconnected(() => this._mpShowConnectForm('Rozłączono z serwerem.'));

    this.el.mpConnect.classList.add('hidden');
    this.el.mpLobby.classList.remove('hidden');
    this.el.mpRoomCode.textContent = room;
    this.el.mpStart.classList.toggle('hidden', !client.isHost);
    this.el.mpWaitNote.textContent = client.isHost ? '' : 'Czekaj, aż host rozpocznie mecz…';
  }

  _renderMpRoster() {
    this.el.mpRoster.innerHTML = '';
    const icons = { mole: '🐭', gardener: '🧑‍🌾', dog: '🐕' };
    for (const p of this.mpRoster) {
      const row = document.createElement('div');
      row.className = 'mp-row ' + (p.faction === 'mole' ? 'role-mole' : p.faction ? 'role-def' : '');
      row.innerHTML = `<span>${icons[p.faction] || '❔'}</span>
        <span class="mp-name">${p.name}${p.id === this.net.id ? ' (Ty)' : ''}</span>
        ${p.id === this.mpHostId ? '<span class="mp-badge">HOST</span>' : ''}`;
      this.el.mpRoster.appendChild(row);
    }
    if (this.net?.isHost) {
      const min = 2; // gospodarz + co najmniej jeden gosc nie jest wymagany, ale sensowny dolny prog UX
      this.el.mpWaitNote.textContent = this.mpRoster.length < 1
        ? ''
        : `${this.mpRoster.length} ${this.mpRoster.length === 1 ? 'osoba' : 'osób'} w lobby.`;
    }
  }

  _mpShowConnectForm(note) {
    this.net = null;
    this.mpRoster = [];
    this.mpHostId = null;
    this.el.mpLobby.classList.add('hidden');
    this.el.mpConnect.classList.remove('hidden');
    this.el.mpConnectNote.textContent = note || '';
  }

  refreshMenu() {
    const save = Eco.getSave();
    this.el.silver.textContent = save.silver;
    this.el.gold.textContent = save.gold;

    $$('.faction').forEach(b => {
      const unlocked = Eco.isClassUnlocked(b.dataset.class);
      b.classList.toggle('sel', save.faction === b.dataset.class);
      b.classList.toggle('locked', !unlocked);
    });
    $$('.fmt').forEach(b => b.classList.toggle('sel', save.format === b.dataset.format));

    const setup = resolveMatchSetup(save);
    const asMole = save.faction === 'mole';
    const mins = `${Math.floor(setup.duration / 60)}:${String(setup.duration % 60).padStart(2, '0')}`;
    this.el.playNote.textContent = asMole
      ? `Grasz jako kret. Cel: dowieź ${setup.vegetablesToWin} warzyw do nory w ${mins}.`
      : `Grasz jako obrońca. Cel: złap wszystkie krety albo nie pozwól im ukraść ${setup.vegetablesToWin} warzyw w ${mins}.`;

    this.el.customSetup.classList.toggle('hidden', save.format !== 'custom');
    if (save.format === 'custom') this._renderCustom();
    this._renderSettings();
    this._renderPerks();
    this._renderShop();
  }

  /** Liczniki skladu meczu — widoczne tylko w trybie "Własny". */
  _renderCustom() {
    const save = Eco.getSave();
    const setup = resolveMatchSetup(save);
    this.el.customSetup.innerHTML = '';

    const hints = {
      moles: 'łącznie, razem z Tobą jeśli grasz kretem',
      gardeners: 'wolni, ale mają wąż z wodą i pułapki',
      dogs: 'szybkie, widzą ślady zapachowe',
      vegetablesToWin: `sugerowane dla ${setup.moles} kretów: ${suggestedGoal(setup.moles)}`,
      duration: 'GDD zakłada 3–4 minuty'
    };

    for (const [key, lim] of Object.entries(CUSTOM_LIMITS)) {
      const value = save.custom[key];
      const row = document.createElement('div');
      row.className = 'cs-row';
      row.innerHTML = `<span class="cs-label">${lim.label}<i>${hints[key]}</i></span>
        <button class="cs-btn" data-d="-1" ${value <= lim.min ? 'disabled' : ''}>−</button>
        <b class="cs-val">${value}</b>
        <button class="cs-btn" data-d="1" ${value >= lim.max ? 'disabled' : ''}>+</button>`;
      row.querySelectorAll('.cs-btn').forEach(btn => btn.addEventListener('click', () => {
        Eco.setCustom(key, value + Number(btn.dataset.d) * lim.step);
        this.audio?.play('ui');
        this.refreshMenu();
      }));
      this.el.customSetup.appendChild(row);
    }

    const sum = document.createElement('div');
    sum.className = 'cs-summary';
    const you = save.faction === 'mole' ? 'kretem' : (save.faction === 'dog' ? 'psem' : 'ogrodnikiem');
    const g = setup.defenderClasses.filter(c => c === 'gardener').length;
    const d = setup.defenderClasses.filter(c => c === 'dog').length;
    const parts = [`<b>${setup.moles}</b> kretów`, `<b>${g}</b> ogrodników`, `<b>${d}</b> psów`];
    let warn = '';
    if (save.custom.gardeners + save.custom.dogs === 0) {
      warn = '<br><span class="cs-warn">Bez obrońców nie ma meczu — dodaję jednego ogrodnika.</span>';
    } else if (save.faction !== 'mole' && setup.defenderClasses[0] !== save.faction) {
      warn = '<br><span class="cs-warn">Zamieniam jeden slot na Twoją klasę.</span>';
    }
    const ratio = setup.moles / Math.max(1, setup.defenders);
    if (ratio >= 4) warn += '<br><span class="cs-warn">Przewaga kretów jest miażdżąca — obrońcy raczej nie zdążą.</span>';
    sum.innerHTML = `Na arenie: ${parts.join(' · ')}. Ty grasz <b>${you}</b>, resztę prowadzą boty.${warn}`;
    this.el.customSetup.appendChild(sum);
  }

  /** Suwak intensywnosci wstrzasow kamery — 0% jest jednoczesnie pelnym wylaczeniem. */
  /** Wolane z main-menu I z panelu ustawien w menu-w-trakcie-meczu — trzyma oba w zgodzie. */
  _renderSettings() {
    const s = Settings.getSettings();
    const pct = v => Math.round(v * 100) + '%';

    this.el.shakeVal.textContent = pct(s.shakeIntensity);
    this.el.shakeMinus.disabled = s.shakeIntensity <= 0;
    this.el.shakePlus.disabled = s.shakeIntensity >= 1;

    this.el.volVal.textContent = pct(s.volume);
    this.el.volMinus.disabled = s.volume <= 0;
    this.el.volPlus.disabled = s.volume >= 1;

    if (this.el.mmShakeVal) {
      this.el.mmShakeVal.textContent = pct(s.shakeIntensity);
      this.el.mmShakeMinus.disabled = s.shakeIntensity <= 0;
      this.el.mmShakePlus.disabled = s.shakeIntensity >= 1;
      this.el.mmVolVal.textContent = pct(s.volume);
      this.el.mmVolMinus.disabled = s.volume <= 0;
      this.el.mmVolPlus.disabled = s.volume >= 1;
    }
  }

  _renderPerks() {
    const save = Eco.getSave();
    const team = save.faction === 'mole' ? 'mole' : 'def';
    this.el.perkList.innerHTML = '';
    for (const p of PERKS) {
      const btn = document.createElement('button');
      btn.className = 'perk' + (save.perks.includes(p.id) ? ' sel' : '');
      btn.style.opacity = p.team === team ? 1 : 0.42;
      btn.innerHTML = `<span class="tagline">${p.team === 'mole' ? 'KRET' : 'OBROŃCA'}</span>
        <b>${p.name}</b><small>${p.desc}</small>`;
      btn.addEventListener('click', () => {
        Eco.togglePerk(p.id);
        this._renderPerks();
        this.audio?.play('ui');
      });
      this.el.perkList.appendChild(btn);
    }
  }

  _renderShop() {
    const save = Eco.getSave();
    this.el.shopList.innerHTML = '';
    for (const item of SHOP) {
      const owned = Eco.owns(item.id);
      const equipped = item.kind === 'cosmetic' && save.equipped[item.slot] === item.id;
      const btn = document.createElement('button');
      btn.className = 'shop-item' + (owned ? ' owned' : '') + (equipped ? ' equipped' : '');
      const priceTxt = owned
        ? (item.kind === 'cosmetic' ? (equipped ? 'ZAŁOŻONE' : 'ZDEJMIJ/ZAŁÓŻ') : 'ODBLOKOWANE')
        : `${item.currency === 'gold' ? '🌰' : '🪙'} ${item.price}`;
      btn.innerHTML = `<span class="price">${priceTxt}</span><b>${item.name}</b><small>${item.desc}</small>`;
      btn.addEventListener('click', () => {
        if (owned) {
          if (item.kind === 'cosmetic') Eco.equip(item.id);
        } else {
          const res = Eco.buy(item.id);
          if (!res.ok) {
            this.el.playNote.textContent = res.reason === 'funds' ? 'Za mało środków!' : '';
            this.audio?.play('hurt');
          } else {
            this.audio?.play('deliver');
          }
        }
        this.refreshMenu();
      });
      this.el.shopList.appendChild(btn);
    }
  }

  showMenu() {
    this.refreshMenu();
    this.el.menu.classList.remove('hidden');
    this.el.hud.classList.add('hidden');
    this.el.end.classList.add('hidden');
    // po zakonczonym meczu sieciowym quitToMenu() juz rozlaczyl klienta —
    // wracamy do formularza polaczenia zamiast pokazywac martwe lobby
    if (this.net && !this.net.connected) this._mpShowConnectForm('');
  }

  hideLoading() { this.el.loading.classList.add('hidden'); }

  /* ------------------------------------------------------------- HUD */

  showHud(localActor, input) {
    this.el.menu.classList.add('hidden');
    this.el.end.classList.add('hidden');
    this.el.hud.classList.remove('hidden');
    this._buildAbilities(localActor, input);
  }

  _buildAbilities(actor, input) {
    this.el.abilities.innerHTML = '';
    this.abilityEls = [];
    for (const ab of actor.abilities) {
      const btn = document.createElement('button');
      btn.className = 'ab ready';
      btn.innerHTML = `<span class="ab-icon">${ab.icon}</span><span class="ab-key">${ab.key}</span><span class="ab-cd"></span>`;
      btn.title = ab.label;
      this.el.abilities.appendChild(btn);
      input.bindAbilityButton(btn, ab.cmd, !!ab.hold);
      this.abilityEls.push({ el: btn, cd: ab.cd, cdEl: btn.querySelector('.ab-cd') });
    }

    // Ping — osobny przycisk, bo nie jest to zwykla flaga cmd (niesie x/z/kind).
    // Stuk = "tu/uwaga", przeciagniecie = ping na cel pod palcem (patrz InputSystem.bindPingButton).
    const pingBtn = document.createElement('button');
    pingBtn.className = 'ab ping ready';
    pingBtn.innerHTML = `<span class="ab-icon">📍</span><span class="ab-key">C/X</span><span class="ab-cd"></span>`;
    pingBtn.title = 'Ping — stuk: tu/uwaga, przeciągnij: wskaż cel';
    this.el.abilities.appendChild(pingBtn);
    input.bindPingButton(pingBtn);
    this.abilityEls.push({ el: pingBtn, cd: 'ping', cdEl: pingBtn.querySelector('.ab-cd') });

    this._pingEdgeEls = [];
    if (this.el.pingEdges) this.el.pingEdges.innerHTML = '';

    input.setStickElement(this.el.stick);
  }

  updateHud(g) {
    const a = g.localActor;
    this.el.veg.textContent = `${g.delivered}/${g.vegetablesToWin}`;
    this.el.moles.textContent = `${g.molesAlive}/${g.moleCount}`;

    const t = Math.max(0, Math.ceil(g.timeLeft));
    this.el.timer.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    this.el.timer.classList.toggle('urgent', t <= 30);

    if (a) {
      this.el.hp.style.width = `${(a.hp / a.maxHp) * 100}%`;
      this.el.st.style.width = `${(a.stamina / a.staminaMax) * 100}%`;
      const carrying = a.carrying ? 1 : 0;
      this.el.carry.classList.toggle('hidden', !carrying);
      this.el.carryCount.textContent = a.carrying ? a.carrying.name : '';
      this.el.phase.textContent = a.underground ? 'Pod ziemią' : (a.team === 'mole' ? 'Na powierzchni' : 'Patrol');

      if (a.cast) {
        this.el.cast.classList.remove('hidden');
        this.el.castBar.style.width = `${(a.cast.t / a.cast.dur) * 100}%`;
        this.el.castLabel.textContent = a.cast.label;
      } else {
        this.el.cast.classList.add('hidden');
      }

      for (const ab of this.abilityEls) {
        if (!ab.cd) continue;
        const left = a.cooldownLeft(ab.cd);
        ab.el.classList.toggle('cooling', left > 0.05);
        ab.el.classList.toggle('ready', left <= 0.05);
        ab.cdEl.textContent = left > 0.05 ? Math.ceil(left) : '';
      }
    }

    this._renderRoster(g);
    this._updatePingEdges(g);
  }

  /**
   * Wskazniki pingow poza kadrem. `g.pingScreens` to juz gotowe px/kat —
   * ui.js celowo nie liczy tu geometrii 3D (patrz Game._updatePingScreens).
   */
  _updatePingEdges(g) {
    if (!this.el.pingEdges) return;
    const offscreen = g.pingScreens.filter(p => !p.onscreen);
    while (this._pingEdgeEls.length < offscreen.length) {
      const d = document.createElement('div');
      d.className = 'ping-edge';
      d.innerHTML = '<i class="pe-arrow"></i>';
      this.el.pingEdges.appendChild(d);
      this._pingEdgeEls.push(d);
    }
    this._pingEdgeEls.forEach((el, i) => {
      const p = offscreen[i];
      if (!p) { el.classList.add('hidden'); return; }
      el.classList.remove('hidden');
      el.classList.remove('kind-mark', 'kind-trap', 'kind-danger');
      el.classList.add(`kind-${p.kind}`);
      el.style.left = `${p.left}px`;
      el.style.top = `${p.top}px`;
      el.querySelector('.pe-arrow').style.transform = `rotate(${p.angle}deg)`;
    });
  }

  /* ------------------------------------------------------- MENU W TRAKCIE MECZU */

  _bindMatchMenu() {
    this.el.hudMenuBtn.addEventListener('click', () => this.game?.openMatchMenu());
    this.el.mmResume.addEventListener('click', () => this.game?.resumeMatch());
    this.el.mmRestart.addEventListener('click', () => this.game?.restartMatch());
    this.el.mmSettingsOpen.addEventListener('click', () => this._showMatchSettings());
    this.el.mmSettingsBack.addEventListener('click', () => this._hideMatchSettings());

    this.el.mmVolMinus.addEventListener('click', () => this._adjustVolume(-SETTINGS_STEP));
    this.el.mmVolPlus.addEventListener('click', () => this._adjustVolume(SETTINGS_STEP));
    this.el.mmShakeMinus.addEventListener('click', () => this._adjustShake(-SETTINGS_STEP));
    this.el.mmShakePlus.addEventListener('click', () => this._adjustShake(SETTINGS_STEP));

    // Solo "wyjscie do menu" nie potrzebuje potwierdzenia (nikt inny nie ucierpi).
    // MP "opusc mecz" zawsze pyta — hosta ostrzegamy wprost, ze konczy mecz wszystkim.
    this.el.mmQuit.addEventListener('click', () => this.game?.quitToMenu());
    this.el.mmLeave.addEventListener('click', () => {
      const isHost = this.game?.netRole === 'host';
      this._confirmMatchAction(
        isHost
          ? 'Jesteś hostem — Twoje wyjście od razu KOŃCZY mecz wszystkim graczom. Kontynuować?'
          : 'Opuścisz mecz — Twoją postać przejmie bot. Kontynuować?',
        'Opuść mecz',
        () => this.game?.quitToMenu()
      );
    });

    this.el.mmConfirmNo.addEventListener('click', () => this._hideConfirm());
  }

  /** Wolane z Game.openMatchMenu() — zawartosc zalezy od trybu (solo/gosc/host). */
  showMatchMenu(game) {
    const isSolo = game.netRole === null;

    this.el.mmTitle.textContent = isSolo ? 'Pauza' : 'Menu';
    this.el.mmLive.classList.toggle('hidden', isSolo);
    this.el.mmRestart.classList.toggle('hidden', !isSolo);
    this.el.mmQuit.classList.toggle('hidden', !isSolo);
    this.el.mmLeave.classList.toggle('hidden', isSolo);

    this._hideMatchSettings();
    this._hideConfirm();
    this._renderSettings();
    this.el.matchMenu.classList.remove('hidden');
  }

  hideMatchMenu() {
    this.el.matchMenu.classList.add('hidden');
  }

  _showMatchSettings() {
    this.el.mmMain.classList.add('hidden');
    this.el.mmConfirm.classList.add('hidden');
    this.el.mmSettings.classList.remove('hidden');
    this._renderSettings();
  }

  _hideMatchSettings() {
    this.el.mmSettings.classList.add('hidden');
    this.el.mmMain.classList.remove('hidden');
  }

  _confirmMatchAction(text, actionLabel, onConfirm) {
    this.el.mmMain.classList.add('hidden');
    this.el.mmSettings.classList.add('hidden');
    this.el.mmConfirm.classList.remove('hidden');
    this.el.mmConfirmText.textContent = text;
    this.el.mmConfirmYes.textContent = actionLabel;
    this.el.mmConfirmYes.onclick = () => { this._hideConfirm(); onConfirm(); };
  }

  _hideConfirm() {
    this.el.mmConfirm.classList.add('hidden');
    this.el.mmMain.classList.remove('hidden');
  }

  _renderRoster(g) {
    const key = g.actors.map(a => `${a.id}:${a.alive ? 1 : 0}:${Math.round(a.hp)}`).join('|');
    if (key === this._rosterKey) return;
    this._rosterKey = key;
    this.el.roster.innerHTML = '';
    for (const a of g.actors) {
      const row = document.createElement('div');
      row.className = 'ros' + (a.team === 'def' ? ' def' : '') + (a.isLocal ? ' me' : '') + (a.alive ? '' : ' dead');
      const icon = a.cls === 'mole' ? '🐭' : a.cls === 'dog' ? '🐕' : '🧑‍🌾';
      row.innerHTML = `<span>${icon}</span><span>${a.name}</span>
        <span class="rhp"><i style="width:${(a.hp / a.maxHp) * 100}%"></i></span>`;
      this.el.roster.appendChild(row);
    }
  }

  setHint(text) {
    if (this.hintTimer > 0) return;
    this.el.hint.textContent = text || '';
    this.el.hint.classList.toggle('on', !!text);
  }

  flashHint(text, seconds = 1.8) {
    this.el.hint.textContent = text;
    this.el.hint.classList.add('on');
    this.hintTimer = seconds;
  }

  banner(text, seconds = 1.4) {
    this.el.banner.textContent = text;
    this.el.banner.classList.remove('hidden');
    // restart animacji
    this.el.banner.style.animation = 'none';
    void this.el.banner.offsetWidth;
    this.el.banner.style.animation = '';
    this.bannerTimer = seconds;
  }

  update(dt) {
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.el.hint.classList.remove('on');
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.el.banner.classList.add('hidden');
    }
  }

  /* ------------------------------------------------------ EKRAN KONCA */

  showEnd({ win, title, subtitle, stats, reward }) {
    this.el.hud.classList.add('hidden');
    this.el.end.classList.remove('hidden');
    this.el.endTitle.textContent = title;
    this.el.endTitle.className = win ? 'win' : 'lose';
    this.el.endSub.textContent = subtitle;
    this.el.endStats.innerHTML = stats
      .map(s => `<div><span>${s[0]}</span><span>${s[1]}</span></div>`)
      .join('');
    this.el.endSilver.textContent = reward.silver;
    this.el.endGold.textContent = reward.gold;
    this.refreshMenu();
  }
}
