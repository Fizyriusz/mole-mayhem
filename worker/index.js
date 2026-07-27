/**
 * Serwer sesji Mole Mayhem — Cloudflare Worker + Durable Object.
 *
 * Dlaczego nie PartyKit: `partykit deploy` publikuje na WSPOLDZIELONEJ domenie
 * partykit.dev, a ta uderzyla w twardy limit Cloudflare (10 000 custom domains
 * na strefe). Ten sam mechanizm (Durable Objects) uruchomiony na WLASNYM koncie
 * omija problem calkowicie, bo `*.workers.dev` to juz Twoja strefa.
 *
 * Protokol JSON jest IDENTYCZNY jak poprzednio — src/net/client.js nie wymagal
 * ani jednej zmiany. Serwer nadal nie zna zasad gry, jest czystym relayem:
 *
 *   - pierwszy klient w pokoju (albo pierwszy po odejsciu hosta) zostaje hostem
 *   - "cmd" (komenda goscia)         -> WYLACZNIE do hosta
 *   - "snapshot"/"event" (od hosta)  -> do wszystkich OPROCZ hosta
 *   - "claim"/"start"/roster         -> koordynacja lobby
 *
 * Jeden Durable Object = jeden pokoj. Adresowany kodem z URL-a, wiec ci sami
 * gracze z tym samym kodem zawsze trafiaja do tej samej instancji.
 */

const MAX_NAME = 20;

export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    /** @type {Map<string, {id:string, name:string, faction:string|null}>} */
    this.players = new Map();
    /** @type {Map<string, WebSocket>} */
    this.sockets = new Map();
    this.hostId = null;
    this.matchRunning = false;
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Ten adres obsluguje wylacznie WebSocket.', { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const id = crypto.randomUUID();

    // Klasyczne (niehibernowane) WebSockety: obiekt zyje dopoki trwaja polaczenia,
    // wiec stan pokoju moze siedziec w polach instancji. Hibernacja nic by tu nie
    // dala — mecz generuje ~20 snapshotow na sekunde, wiec obiekt i tak nie zasnie.
    server.accept();
    this.sockets.set(id, server);

    server.addEventListener('message', ev => {
      try { this.onMessage(id, ev.data); } catch { /* pojedyncza zla wiadomosc nie moze ubic pokoju */ }
    });
    const bye = () => this.onClose(id);
    server.addEventListener('close', bye);
    server.addEventListener('error', bye);

    return new Response(null, { status: 101, webSocket: client });
  }

  /* --------------------------------------------------------- wysylanie */

  send(id, obj) {
    const ws = this.sockets.get(id);
    if (!ws) return;
    try { ws.send(JSON.stringify(obj)); } catch { this.dropSocket(id); }
  }

  /** @param {string|null} exceptId — pomijany odbiorca (zwykle nadawca) */
  broadcast(payload, exceptId = null) {
    const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
    for (const [id, ws] of this.sockets) {
      if (id === exceptId) continue;
      try { ws.send(raw); } catch { this.dropSocket(id); }
    }
  }

  broadcastRoster() {
    this.broadcast({
      type: 'roster',
      hostId: this.hostId,
      players: [...this.players.values()]
    });
  }

  dropSocket(id) {
    this.sockets.delete(id);
    this.players.delete(id);
  }

  /* --------------------------------------------------------- protokol */

  onMessage(senderId, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'hello': {
        const becomesHost = this.hostId === null;
        this.players.set(senderId, {
          id: senderId,
          name: String(msg.name || 'Gracz').slice(0, MAX_NAME),
          faction: null
        });
        if (becomesHost) this.hostId = senderId;
        this.send(senderId, {
          type: 'welcome',
          id: senderId,
          isHost: becomesHost,
          matchRunning: this.matchRunning
        });
        this.broadcastRoster();
        break;
      }

      case 'claim': {
        const p = this.players.get(senderId);
        if (!p) return;
        p.faction = msg.faction ?? null;
        this.broadcastRoster();
        break;
      }

      case 'start': {
        if (senderId !== this.hostId) return;      // mecz rozpoczyna tylko host
        this.matchRunning = true;
        this.broadcast(raw, senderId);
        break;
      }

      case 'cmd': {
        if (!this.hostId) return;
        this.send(this.hostId, { type: 'cmd', from: senderId, cmd: msg.cmd, seq: msg.seq });
        break;
      }

      case 'snapshot':
      case 'event': {
        if (senderId !== this.hostId) return;      // host jest jedynym zrodlem prawdy
        this.broadcast(raw, senderId);
        break;
      }

      case 'reset': {
        if (senderId !== this.hostId) return;
        this.matchRunning = false;
        this.broadcast(raw, senderId);
        break;
      }

      default:
        break;
    }
  }

  onClose(id) {
    if (!this.sockets.has(id) && !this.players.has(id)) return;   // zdarzenia close i error moga przyjsc oba
    const wasHost = id === this.hostId;
    this.sockets.delete(id);
    this.players.delete(id);

    if (wasHost) {
      this.hostId = null;
      this.matchRunning = false;
      this.broadcast({ type: 'host_left' });
    } else {
      this.broadcast({ type: 'player_left', id });
    }
    this.broadcastRoster();
  }
}

/* ------------------------------------------------------------- ROUTER */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Sciezka zgodna z PartyKit, zeby klient gry nie wymagal zmian.
    const match = url.pathname.match(/^\/parties\/main\/([^/]+)\/?$/);
    if (!match) {
      return new Response(
        'Mole Mayhem — serwer sesji dziala.\nPokoje: /parties/main/<KOD>',
        { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } }
      );
    }

    // Kod pokoju normalizujemy, zeby "abc" i "ABC" trafialy do tego samego obiektu.
    const room = match[1].toUpperCase().slice(0, 32);
    const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(room));
    return stub.fetch(request);
  }
};
