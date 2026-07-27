/**
 * Cienki klient WebSocket do party/session.js. Nie zna zasad gry — tylko
 * laczy sie z pokojem i podaje warstwie gry (Game) gotowe wiadomosci.
 * Protokol opisany w naglowku party/session.js.
 */

const HOST_KEY = 'molemayhem.relayHost';
const NAME_KEY = 'molemayhem.playerName';
const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // bez 0/O/1/I/L — latwiej podyktowac

export function randomRoomCode(len = 4) {
  let s = '';
  for (let i = 0; i < len; i++) s += ROOM_ALPHABET[(Math.random() * ROOM_ALPHABET.length) | 0];
  return s;
}

const DEFAULT_RELAY_PORT = 1999;   // domyslny port `partykit dev`

/**
 * Domyslny adres relaya. Kluczowe jest ostatnie ogniwo: relay prawie zawsze stoi
 * na TYM SAMYM hoscie, z ktorego serwowana jest gra, wiec bierzemy `location.hostname`.
 * Bez tego telefon otwierajacy grę po Tailscale/LAN dostawalby w polu "localhost:1999",
 * czyli probowalby sie polaczyc z SAMYM SOBA i dostawal mylacy blad polaczenia.
 */
export function defaultHost() {
  const h = location.hostname;
  if (!h || h === 'localhost' || h === '127.0.0.1') return `localhost:${DEFAULT_RELAY_PORT}`;
  return `${h}:${DEFAULT_RELAY_PORT}`;
}

export function getSavedHost() {
  return localStorage.getItem(HOST_KEY) || import.meta.env.VITE_PARTYKIT_HOST || defaultHost();
}
export function saveHost(host) { localStorage.setItem(HOST_KEY, host.trim()); }

export function getSavedName() { return localStorage.getItem(NAME_KEY) || ''; }
export function saveName(name) { localStorage.setItem(NAME_KEY, name.trim().slice(0, 20)); }

/**
 * Uzytkownik moze wkleic gola nazwe hosta ("192.168.18.5:1999", "moj-tunel.loca.lt")
 * albo pelny adres ("ws://...", "wss://...") — jawny schemat zawsze wygrywa.
 *
 * Bez schematu zgadujemy: adresy w sieci prywatnej (LAN, Tailscale — zarowno IP
 * 100.64.0.0/10, jak i nazwy MagicDNS *.ts.net) obsluguje `partykit dev`, ktory
 * NIE ma TLS-a, wiec musi byc ws://. Wszystko inne (tunel loca.lt, *.partykit.dev,
 * wlasna domena) chodzi po HTTPS, wiec wss://.
 */
export function normalizeHost(input) {
  const h = input.trim().replace(/\/+$/, '');
  if (/^wss?:\/\//i.test(h)) return h;

  const hostOnly = h.replace(/:\d+$/, '');
  const isPlainLocal =
    /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(hostOnly) ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(hostOnly) ||          // dowolne gole IP (LAN, Tailscale 100.x)
    /(^|\.)ts\.net$/i.test(hostOnly) ||                   // Tailscale MagicDNS
    /(^|\.)local$/i.test(hostOnly);                       // mDNS / Bonjour

  return (isPlainLocal ? 'ws://' : 'wss://') + h;
}

export class NetClient {
  constructor() {
    this.ws = null;
    this.id = null;
    this.isHost = false;
    this.connected = false;
    this.room = null;
    this._handlers = new Map();
    this._cmdSeq = 0;
  }

  on(type, cb) {
    if (!this._handlers.has(type)) this._handlers.set(type, new Set());
    this._handlers.get(type).add(cb);
    return () => this._handlers.get(type)?.delete(cb);
  }

  _emit(type, payload) {
    for (const cb of this._handlers.get(type) || []) cb(payload);
  }

  /** @returns {Promise<{id:string, isHost:boolean, matchRunning:boolean}>} */
  connect(hostInput, room, name) {
    this.disconnect();
    this.room = room;
    const url = `${normalizeHost(hostInput)}/parties/main/${room}`;

    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) { settled = true; this.disconnect(); reject(new Error('Przekroczono czas połączenia (adres serwera nieprawidłowy albo offline).')); }
      }, 8000);

      let ws;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        clearTimeout(timeout);
        reject(new Error('Nieprawidłowy adres serwera.'));
        return;
      }
      this.ws = ws;

      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({ type: 'hello', name }));
      });

      ws.addEventListener('message', ev => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }

        if (msg.type === 'welcome' && !settled) {
          settled = true;
          clearTimeout(timeout);
          this.id = msg.id;
          this.isHost = msg.isHost;
          this.connected = true;
          resolve(msg);
          return;
        }
        this._emit(msg.type, msg);
      });

      ws.addEventListener('error', () => {
        if (!settled) { settled = true; clearTimeout(timeout); reject(new Error('Nie udało się połączyć z serwerem.')); }
      });

      ws.addEventListener('close', () => {
        const wasConnected = this.connected;
        this.connected = false;
        if (wasConnected) this._emit('disconnected', {});
      });
    });
  }

  disconnect() {
    if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null; }
    this.connected = false;
    this.id = null;
    this.isHost = false;
  }

  _send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  claim(faction) { this._send({ type: 'claim', faction }); }
  sendStart(setup, specs, vegSpots) { this._send({ type: 'start', setup, specs, vegSpots }); }
  sendCommand(cmd) { this._send({ type: 'cmd', cmd, seq: this._cmdSeq++ }); }
  sendSnapshot(data) { this._send({ type: 'snapshot', ...data }); }
  sendEvent(name, data) { this._send({ type: 'event', name, ...data }); }
  sendReset() { this._send({ type: 'reset' }); }

  onRoster(cb) { return this.on('roster', cb); }
  onStart(cb) { return this.on('start', cb); }
  onSnapshot(cb) { return this.on('snapshot', cb); }
  onEvent(cb) { return this.on('event', cb); }
  onCmd(cb) { return this.on('cmd', cb); }
  onReset(cb) { return this.on('reset', cb); }
  onHostLeft(cb) { return this.on('host_left', cb); }
  onPlayerLeft(cb) { return this.on('player_left', cb); }
  onDisconnected(cb) { return this.on('disconnected', cb); }
}
