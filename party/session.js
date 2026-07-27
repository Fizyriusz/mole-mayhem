/**
 * Serwer sesji (PartyKit). Jeden "room" = jeden lobby/mecz, adresowany kodem
 * w URL: /parties/main/<KOD>. Serwer NIE zna zasad gry — jest czystym relayem:
 *
 *   - pierwszy klient w pokoju (albo pierwszy po odejsciu hosta) zostaje hostem
 *   - host liczy pelna symulacje (Game w trybie 'host'), tak jak dotychczasowy
 *     tryb lokalny, tylko ze zdalne sloty dostaja komendy z sieci zamiast botow
 *   - "cmd" (komenda ruchu/akcji goscia) leci WYLACZNIE do hosta
 *   - "snapshot"/"event" (stan/zdarzenia od hosta) leca do wszystkich OPROCZ hosta
 *   - "claim"/"start"/roster to koordynacja lobby, widoczna dla wszystkich
 *
 * Wire format (JSON, jeden typ na wiadomosc):
 *   hello    {type,name}                    klient -> serwer, przy dolaczeniu
 *   welcome  {type,id,isHost,matchRunning}   serwer -> nadawca, odpowiedz na hello
 *   roster   {type,hostId,players[]}         serwer -> wszyscy, po kazdej zmianie
 *   claim    {type,faction}                  klient -> serwer -> roster
 *   start    {type,setup,assignments}        host -> serwer -> wszyscy oprocz hosta
 *   cmd      {type,cmd,seq}                  gosc -> serwer -> tylko host (dopisuje from)
 *   snapshot {type,...}                      host -> serwer -> wszyscy oprocz hosta
 *   event    {type,name,...}                 host -> serwer -> wszyscy oprocz hosta
 *   reset    {type}                          host -> serwer -> wszyscy oprocz hosta (koniec meczu, powrot do lobby)
 *   host_left / player_left                  serwer -> wszyscy, przy rozlaczeniu
 */
export default class SessionServer {
  constructor(room) {
    this.room = room;
    /** @type {Map<string, {id:string, name:string, faction:string|null}>} */
    this.players = new Map();
    this.hostId = null;
    this.matchRunning = false;
  }

  onConnect(conn) {
    // Czekamy na "hello" zanim cokolwiek wyslemy — dopiero wtedy znamy imie gracza.
  }

  onMessage(raw, sender) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'hello': {
        const becomesHost = this.hostId === null;
        this.players.set(sender.id, {
          id: sender.id,
          name: String(msg.name || 'Gracz').slice(0, 20),
          faction: null
        });
        if (becomesHost) this.hostId = sender.id;
        sender.send(JSON.stringify({
          type: 'welcome',
          id: sender.id,
          isHost: becomesHost,
          matchRunning: this.matchRunning
        }));
        this.broadcastRoster();
        break;
      }

      case 'claim': {
        const p = this.players.get(sender.id);
        if (!p) return;
        p.faction = msg.faction ?? null;
        this.broadcastRoster();
        break;
      }

      case 'start': {
        if (sender.id !== this.hostId) return;   // tylko host rozpoczyna mecz
        this.matchRunning = true;
        this.room.broadcast(raw, [sender.id]);
        break;
      }

      case 'cmd': {
        if (!this.hostId) return;
        const host = this.room.getConnection(this.hostId);
        if (!host) return;
        host.send(JSON.stringify({ type: 'cmd', from: sender.id, cmd: msg.cmd, seq: msg.seq }));
        break;
      }

      case 'snapshot':
      case 'event': {
        if (sender.id !== this.hostId) return;    // tylko host jest zrodlem prawdy
        this.room.broadcast(raw, [sender.id]);
        break;
      }

      case 'reset': {
        if (sender.id !== this.hostId) return;
        this.matchRunning = false;
        this.room.broadcast(raw, [sender.id]);
        break;
      }

      default:
        break;
    }
  }

  onClose(conn) {
    const wasHost = conn.id === this.hostId;
    this.players.delete(conn.id);

    if (wasHost) {
      this.hostId = null;
      this.matchRunning = false;
      this.room.broadcast(JSON.stringify({ type: 'host_left' }));
    } else {
      this.room.broadcast(JSON.stringify({ type: 'player_left', id: conn.id }));
    }
    this.broadcastRoster();
  }

  broadcastRoster() {
    this.room.broadcast(JSON.stringify({
      type: 'roster',
      hostId: this.hostId,
      players: [...this.players.values()]
    }));
  }
}
