// Tiny procedural soundscape — no audio files, all synthesized on demand.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.enabled = false;
    this.lastBird = 0;
    this.lastCricket = 0;
    this.hour = 8;
    this.weather = 'Clear';
    this.chordTimer = 0;
    this.chordIndex = 0;
    this.notes = [
      [146.83, 220.0, 293.66, 369.99],
      [130.81, 196.0, 261.63, 329.63],
      [110.0, 164.81, 220.0, 293.66],
      [123.47, 185.0, 246.94, 311.13],
    ];
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.75;
      this.master.connect(this.ctx.destination);
      this.buildAmbient();
      this.enabled = true;
      this.chordTimer = 0;
    } catch { /* audio is optional */ }
  }

  buildAmbient() {
    const ctx = this.ctx;
    // wind: filtered looped noise
    const len = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + white * 0.035) * 0.985;
      data[i] = last * 2.2;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 480;
    filter.Q.value = 0.4;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.1;
    src.connect(filter).connect(this.windGain).connect(this.master);
    src.start();

    // low pad
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0.0;
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 620;
    this.padGain.connect(padFilter).connect(this.master);
    this.padOscs = [];
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator();
      o.type = i === 2 ? 'sine' : 'triangle';
      o.frequency.value = [146.83, 220, 293.66][i] * 0.5;
      o.detune.value = (Math.random() - 0.5) * 8;
      const g = ctx.createGain();
      g.gain.value = 0.11 / (i + 1);
      o.connect(g).connect(this.padGain);
      o.start();
      this.padOscs.push(o);
    }
    this.padGain.gain.setTargetAtTime(0.13, ctx.currentTime, 3);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.75, this.ctx.currentTime, 0.08);
    return this.muted;
  }

  setEnvironment(hour, weather) {
    this.hour = hour;
    this.weather = weather;
    if (!this.ctx) return;
    const night = hour >= 21 || hour < 5.5;
    const target = weather === 'Rain' ? 0.19 : night ? 0.075 : 0.1;
    this.windGain.gain.setTargetAtTime(target, this.ctx.currentTime, 1.5);
    const padTarget = night ? 0.14 : 0.08;
    this.padGain.gain.setTargetAtTime(padTarget, this.ctx.currentTime, 4);
  }

  update(dt) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    this.chordTimer += dt;
    if (this.chordTimer > 22) {
      this.chordTimer = 0;
      this.chordIndex = (this.chordIndex + 1) % this.notes.length;
      const chord = this.notes[this.chordIndex];
      for (let i = 0; i < 3; i++) this.padOscs[i].frequency.setTargetAtTime(chord[i] * 0.5, now, 3);
    }
    const night = this.hour >= 21 || this.hour < 5.5;
    if (!night && this.weather !== 'Rain' && now - this.lastBird > 7 + Math.random() * 12) {
      this.lastBird = now;
      this.bird();
    }
    if (night && now - this.lastCricket > 1.4) {
      this.lastCricket = now;
      this.cricket();
    }
  }

  // ── one-shot helpers ─────────────────────────────────────
  env(gainNode, t0, a, peak, d) {
    gainNode.gain.setValueAtTime(0.0001, t0);
    gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }

  tone(freq, type, peak = 0.1, dur = 0.2, delay = 0, slide = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    this.env(g, t, 0.008, peak, dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  noiseBurst(dur = 0.1, peak = 0.12, freq = 1200, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = 0.9;
    const g = this.ctx.createGain();
    this.env(g, t, 0.004, peak, dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
  }

  click() { this.tone(640, 'sine', 0.045, 0.05); }
  select() { this.tone(520, 'sine', 0.045, 0.09); this.tone(780, 'sine', 0.03, 0.12, 0.03); }
  error() { this.tone(180, 'triangle', 0.06, 0.15, 0, -40); }
  chop() { this.noiseBurst(0.08, 0.09, 750); this.tone(130, 'triangle', 0.05, 0.12); }
  mine() { this.noiseBurst(0.06, 0.07, 2400); this.tone(900, 'triangle', 0.025, 0.2); }
  place() { this.noiseBurst(0.14, 0.1, 400); this.tone(220, 'triangle', 0.07, 0.15); }
  complete() { [523.25, 659.25, 783.99].forEach((f, i) => this.tone(f, 'sine', 0.055, 0.5, i * 0.085)); }
  join() { [392, 493.88, 587.33, 783.99].forEach((f, i) => this.tone(f, 'triangle', 0.05, 0.55, i * 0.1)); }
  bird() {
    const base = 1900 + Math.random() * 1200;
    for (let i = 0; i < 3; i++) {
      this.tone(base + Math.random() * 300, 'sine', 0.018, 0.08, i * 0.12, -380);
    }
  }
  cricket() {
    for (let i = 0; i < 2; i++) this.tone(4200 + Math.random() * 300, 'sine', 0.006, 0.035, i * 0.06);
  }
}
