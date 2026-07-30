/**
 * Syntetyczne SFX na WebAudio — zero plikow dzwiekowych.
 * Kazdy efekt to krotka obwiednia na oscylatorze lub szumie.
 */

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 1;     // 0..1 — mnoznik ustawiony przez gracza, patrz src/meta/settings.js
    this.master = null;
    this.noiseBuffer = null;
  }

  /** Kontekst audio wolno stworzyc dopiero po geście uzytkownika. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.35 * this.volume;
    this.master.connect(this.ctx.destination);

    const len = this.ctx.sampleRate * 0.6;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.35 * this.volume;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.35 * this.volume;
  }

  _env(node, gain, attack, decay, when = 0) {
    const t = this.ctx.currentTime + when;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    node.connect(g);
    g.connect(this.master);
    return { g, t, stop: t + attack + decay + 0.02 };
  }

  _tone({ freq = 440, to = null, type = 'sine', gain = 0.3, attack = 0.005, decay = 0.2, when = 0 }) {
    const o = this.ctx.createOscillator();
    o.type = type;
    const t = this.ctx.currentTime + when;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + attack + decay);
    const e = this._env(o, gain, attack, decay, when);
    o.start(e.t);
    o.stop(e.stop);
  }

  _noise({ gain = 0.3, attack = 0.005, decay = 0.25, filter = 900, q = 1, type = 'lowpass', when = 0, sweepTo = null }) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    const t = this.ctx.currentTime + when;
    f.frequency.setValueAtTime(filter, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t + attack + decay);
    f.Q.value = q;
    src.connect(f);
    const e = this._env(f, gain, attack, decay, when);
    src.start(e.t);
    src.stop(e.stop);
  }

  /**
   * @param {string} name  nazwa efektu
   * @param {number} vol   mnoznik glosnosci
   * @param {number} dist  odleglosc od kamery (tlumienie)
   */
  play(name, vol = 1, dist = 0) {
    if (!this.ctx || this.muted) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const att = dist ? Math.max(0, 1 - dist / 42) : 1;
    const g = vol * att;
    if (g <= 0.02) return;

    switch (name) {
      case 'dig':      this._noise({ gain: .45 * g, filter: 700, sweepTo: 180, decay: .35 }); break;
      case 'digSoft':  this._noise({ gain: .25 * g, filter: 500, sweepTo: 200, decay: .2 }); break;
      case 'rustle':   this._noise({ gain: .18 * g, filter: 2400, q: 2, decay: .16, type: 'bandpass' }); break;
      case 'pickup':   this._tone({ freq: 520, to: 880, type: 'triangle', gain: .3 * g, decay: .18 });
                       this._tone({ freq: 780, to: 1180, type: 'sine', gain: .18 * g, decay: .2, when: .07 }); break;
      case 'deliver':  [523, 659, 784, 1046].forEach((f, i) => this._tone({ freq: f, type: 'triangle', gain: .26 * g, decay: .22, when: i * 0.07 })); break;
      case 'swing':    this._noise({ gain: .3 * g, filter: 3200, sweepTo: 700, decay: .14, type: 'bandpass', q: 1.5 }); break;
      case 'hit':      this._tone({ freq: 180, to: 60, type: 'square', gain: .3 * g, decay: .16 });
                       this._noise({ gain: .25 * g, filter: 1600, decay: .1 }); break;
      case 'hurt':     this._tone({ freq: 320, to: 110, type: 'sawtooth', gain: .3 * g, decay: .28 }); break;
      case 'bark':     this._tone({ freq: 420, to: 160, type: 'sawtooth', gain: .38 * g, attack: .008, decay: .16 });
                       this._noise({ gain: .3 * g, filter: 1200, decay: .18, when: .02 }); break;
      case 'bite':     this._noise({ gain: .3 * g, filter: 2600, sweepTo: 500, decay: .1, type: 'bandpass' }); break;
      case 'sniff':    this._noise({ gain: .22 * g, filter: 900, sweepTo: 2400, decay: .3, type: 'bandpass', q: 3 }); break;
      case 'water':    this._noise({ gain: .3 * g, filter: 5200, q: .7, decay: 1.1, type: 'bandpass' }); break;
      case 'splash':   this._noise({ gain: .4 * g, filter: 3800, sweepTo: 600, decay: .5, type: 'bandpass' }); break;
      case 'throw':    this._noise({ gain: .22 * g, filter: 2200, sweepTo: 900, decay: .12, type: 'bandpass' }); break;
      case 'splat':    this._noise({ gain: .35 * g, filter: 800, sweepTo: 200, decay: .2 }); break;
      case 'stomp':    this._tone({ freq: 120, to: 45, type: 'square', gain: .34 * g, decay: .22 }); break;
      case 'place':    this._tone({ freq: 660, to: 440, type: 'square', gain: .22 * g, decay: .12 }); break;
      case 'alarm':    [880, 660].forEach((f, i) => this._tone({ freq: f, type: 'square', gain: .2 * g, decay: .18, when: i * .16 })); break;
      case 'countdown':this._tone({ freq: 660, type: 'triangle', gain: .3 * g, decay: .25 }); break;
      case 'start':    [523, 784, 1046].forEach((f, i) => this._tone({ freq: f, type: 'triangle', gain: .3 * g, decay: .3, when: i * .1 })); break;
      case 'win':      [523, 659, 784, 1046, 1318].forEach((f, i) => this._tone({ freq: f, type: 'triangle', gain: .3 * g, decay: .45, when: i * .12 })); break;
      case 'lose':     [523, 415, 330, 262].forEach((f, i) => this._tone({ freq: f, type: 'sawtooth', gain: .26 * g, decay: .4, when: i * .14 })); break;
      case 'ui':       this._tone({ freq: 720, type: 'square', gain: .12 * g, decay: .07 }); break;
      case 'ping':     this._tone({ freq: 880, to: 1320, type: 'sine', gain: .3 * g, attack: .004, decay: .09 });
                       this._tone({ freq: 1320, type: 'sine', gain: .18 * g, decay: .08, when: .09 }); break;
      default: break;
    }
  }
}
