/**
 * Fully procedural audio: engine, tyres, wind, impacts, pickups and a
 * generated synthwave loop. No audio files, so it works offline.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null
    this.ready = false
    this.muted = false
    this.musicPlaying = false
    this.step = 0
    this.nextNoteTime = 0
    this.timer = null
    this.driftAmount = 0
    this.speedNorm = 0
  }

  async init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {})
      return
    }
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    try {
      const ctx = new AC()
      this.ctx = ctx
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {})

      this.master = ctx.createGain()
      this.master.gain.value = this.muted ? 0 : 0.75
      const compressor = ctx.createDynamicsCompressor()
      compressor.threshold.value = -16
      compressor.knee.value = 22
      compressor.ratio.value = 4
      compressor.attack.value = 0.005
      compressor.release.value = 0.25
      this.master.connect(compressor)
      compressor.connect(ctx.destination)

      this.sfxBus = ctx.createGain()
      this.sfxBus.gain.value = 0.9
      this.sfxBus.connect(this.master)

      this.musicBus = ctx.createGain()
      this.musicBus.gain.value = 0
      this.musicBus.connect(this.master)

      // Shared noise buffer
      const length = ctx.sampleRate * 2
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
      this.noiseBuffer = buffer

      this.buildEngine()
      this.buildTyre()
      this.buildWind()
      this.ready = true
    } catch (error) {
      console.warn('Audio unavailable', error)
    }
  }

  noiseSource(loop = true) {
    const src = this.ctx.createBufferSource()
    src.buffer = this.noiseBuffer
    src.loop = loop
    return src
  }

  buildEngine() {
    const ctx = this.ctx
    this.engineGain = ctx.createGain()
    this.engineGain.gain.value = 0
    this.engineFilter = ctx.createBiquadFilter()
    this.engineFilter.type = 'lowpass'
    this.engineFilter.frequency.value = 420
    this.engineFilter.Q.value = 5.5
    this.engineFilter.connect(this.engineGain)
    this.engineGain.connect(this.sfxBus)

    this.engineOsc = []
    const specs = [
      { type: 'sawtooth', ratio: 1, gain: 0.5 },
      { type: 'sawtooth', ratio: 1.005, gain: 0.36 },
      { type: 'square', ratio: 0.5, gain: 0.34 },
      { type: 'sawtooth', ratio: 2.01, gain: 0.14 },
    ]
    for (const spec of specs) {
      const osc = ctx.createOscillator()
      osc.type = spec.type
      osc.frequency.value = 55
      const gain = ctx.createGain()
      gain.gain.value = spec.gain
      osc.connect(gain)
      gain.connect(this.engineFilter)
      osc.start()
      this.engineOsc.push({ osc, ratio: spec.ratio })
    }

    // A second, brighter layer that opens up under load.
    this.engineWhineGain = ctx.createGain()
    this.engineWhineGain.gain.value = 0
    this.engineWhineFilter = ctx.createBiquadFilter()
    this.engineWhineFilter.type = 'bandpass'
    this.engineWhineFilter.frequency.value = 1200
    this.engineWhineFilter.Q.value = 2
    const whine = ctx.createOscillator()
    whine.type = 'triangle'
    whine.frequency.value = 220
    whine.connect(this.engineWhineFilter)
    this.engineWhineFilter.connect(this.engineWhineGain)
    this.engineWhineGain.connect(this.sfxBus)
    whine.start()
    this.engineWhine = whine
  }

  buildTyre() {
    const ctx = this.ctx
    this.tyreGain = ctx.createGain()
    this.tyreGain.gain.value = 0
    this.tyreFilter = ctx.createBiquadFilter()
    this.tyreFilter.type = 'bandpass'
    this.tyreFilter.frequency.value = 1650
    this.tyreFilter.Q.value = 2.4
    const src = this.noiseSource()
    src.connect(this.tyreFilter)
    this.tyreFilter.connect(this.tyreGain)
    this.tyreGain.connect(this.sfxBus)
    src.start()
    this.tyreSrc = src
  }

  buildWind() {
    const ctx = this.ctx
    this.windGain = ctx.createGain()
    this.windGain.gain.value = 0
    this.windFilter = ctx.createBiquadFilter()
    this.windFilter.type = 'highpass'
    this.windFilter.frequency.value = 600
    const src = this.noiseSource()
    src.connect(this.windFilter)
    this.windFilter.connect(this.windGain)
    this.windGain.connect(this.sfxBus)
    src.start()
    this.windSrc = src
  }

  setMuted(muted) {
    this.muted = muted
    if (!this.ctx) return
    this.master.gain.setTargetAtTime(muted ? 0 : 0.75, this.ctx.currentTime, 0.05)
  }

  setEngine(speedNorm, throttle, boosting, drifting) {
    if (!this.ready) return
    const ctx = this.ctx
    const now = ctx.currentTime
    this.speedNorm = speedNorm
    const rpm = 0.12 + speedNorm * 0.88 + throttle * 0.1
    const base = 44 + rpm * 118
    for (const { osc, ratio } of this.engineOsc) {
      osc.frequency.setTargetAtTime(base * ratio, now, 0.055)
    }
    this.engineWhine.frequency.setTargetAtTime(base * 3.1, now, 0.06)
    this.engineFilter.frequency.setTargetAtTime(
      320 + rpm * 1500 + (boosting ? 900 : 0),
      now,
      0.08,
    )
    this.engineGain.gain.setTargetAtTime(
      0.05 + throttle * 0.07 + speedNorm * 0.05 + (boosting ? 0.035 : 0),
      now,
      0.08,
    )
    this.engineWhineGain.gain.setTargetAtTime(
      0.006 + throttle * 0.012 + (boosting ? 0.02 : 0),
      now,
      0.1,
    )
    this.windGain.gain.setTargetAtTime(speedNorm * speedNorm * 0.11, now, 0.15)
    this.setDrift(drifting)
  }

  setDrift(amount) {
    if (!this.ready) return
    this.driftAmount = amount
    const now = this.ctx.currentTime
    this.tyreGain.gain.setTargetAtTime(amount * 0.13, now, 0.06)
    this.tyreFilter.frequency.setTargetAtTime(1300 + amount * 900, now, 0.08)
  }

  // ---------- one-shots ----------

  blip(freq, duration, type = 'sine', gain = 0.12, slide = 0) {
    if (!this.ready) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t)
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + duration)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration)
    osc.connect(g)
    g.connect(this.sfxBus)
    osc.start(t)
    osc.stop(t + duration + 0.02)
  }

  ui() {
    this.blip(880, 0.07, 'triangle', 0.06, 220)
  }

  pickup(step = 0) {
    const base = 660 * Math.pow(1.122, Math.min(step, 8))
    this.blip(base, 0.12, 'sine', 0.1, 260)
    setTimeout(() => this.blip(base * 1.5, 0.14, 'triangle', 0.07, 180), 55)
  }

  checkpoint() {
    if (!this.ready) return
    const notes = [523.25, 659.25, 783.99, 1046.5]
    notes.forEach((freq, i) => {
      setTimeout(() => this.blip(freq, 0.28, 'triangle', 0.1, 60), i * 70)
    })
  }

  nearMiss() {
    if (!this.ready) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const src = this.noiseSource(false)
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(400, t)
    filter.frequency.exponentialRampToValueAtTime(3200, t + 0.28)
    filter.Q.value = 2.2
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.04)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34)
    src.connect(filter)
    filter.connect(g)
    g.connect(this.sfxBus)
    src.start(t)
    src.stop(t + 0.4)
  }

  impact(strength = 0.5) {
    if (!this.ready) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const src = this.noiseSource(false)
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(1800, t)
    filter.frequency.exponentialRampToValueAtTime(180, t + 0.3)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.28 * strength + 0.05, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42)
    src.connect(filter)
    filter.connect(g)
    g.connect(this.sfxBus)
    src.start(t)
    src.stop(t + 0.45)

    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(120, t)
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.22)
    const og = ctx.createGain()
    og.gain.setValueAtTime(0.0001, t)
    og.gain.exponentialRampToValueAtTime(0.24 * strength + 0.04, t + 0.01)
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
    osc.connect(og)
    og.connect(this.sfxBus)
    osc.start(t)
    osc.stop(t + 0.32)
  }

  boost() {
    if (!this.ready) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(110, t)
    osc.frequency.exponentialRampToValueAtTime(520, t + 0.55)
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(500, t)
    filter.frequency.exponentialRampToValueAtTime(4200, t + 0.5)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.06)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7)
    osc.connect(filter)
    filter.connect(g)
    g.connect(this.sfxBus)
    osc.start(t)
    osc.stop(t + 0.75)
  }

  countdown(go = false) {
    this.blip(go ? 880 : 440, go ? 0.5 : 0.12, 'square', go ? 0.1 : 0.05)
  }

  // ---------- music ----------

  note(freq, time, duration, type, gain, filterFreq, detune = 0) {
    const ctx = this.ctx
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.value = freq
    osc.detune.value = detune
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(filterFreq, time)
    filter.frequency.exponentialRampToValueAtTime(Math.max(120, filterFreq * 0.4), time + duration)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, time)
    g.gain.exponentialRampToValueAtTime(gain, time + Math.min(0.08, duration * 0.3))
    g.gain.exponentialRampToValueAtTime(0.0001, time + duration)
    osc.connect(filter)
    filter.connect(g)
    g.connect(this.musicBus)
    osc.start(time)
    osc.stop(time + duration + 0.03)
  }

  kick(time) {
    const ctx = this.ctx
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(140, time)
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.16)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, time)
    g.gain.exponentialRampToValueAtTime(0.5, time + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.24)
    osc.connect(g)
    g.connect(this.musicBus)
    osc.start(time)
    osc.stop(time + 0.26)
  }

  snare(time) {
    const ctx = this.ctx
    const src = this.noiseSource(false)
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = 2100
    filter.Q.value = 1.2
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, time)
    g.gain.exponentialRampToValueAtTime(0.22, time + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.18)
    src.connect(filter)
    filter.connect(g)
    g.connect(this.musicBus)
    src.start(time)
    src.stop(time + 0.2)
  }

  hat(time, open = false) {
    const ctx = this.ctx
    const src = this.noiseSource(false)
    const filter = ctx.createBiquadFilter()
    filter.type = 'highpass'
    filter.frequency.value = 7200
    const g = ctx.createGain()
    const dur = open ? 0.12 : 0.04
    g.gain.setValueAtTime(0.0001, time)
    g.gain.exponentialRampToValueAtTime(0.09, time + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur)
    src.connect(filter)
    filter.connect(g)
    g.connect(this.musicBus)
    src.start(time)
    src.stop(time + dur + 0.02)
  }

  scheduleBar(bar, time) {
    const stepDur = 0.125
    const chords = [
      { root: 110.0, notes: [220.0, 261.63, 329.63] }, // Am
      { root: 87.31, notes: [174.61, 220.0, 261.63] }, // F
      { root: 130.81, notes: [261.63, 329.63, 392.0] }, // C
      { root: 98.0, notes: [196.0, 246.94, 293.66] }, // G
    ]
    const chord = chords[bar % 4]
    const barStart = time

    // pad
    for (const noteFreq of chord.notes) {
      this.note(noteFreq, barStart, 1.9, 'sawtooth', 0.022, 900, -7)
      this.note(noteFreq * 1.004, barStart, 1.9, 'triangle', 0.018, 1200, 6)
    }

    // bass
    const bassSteps = [0, 3, 6, 8, 11, 14]
    for (const s of bassSteps) {
      const accent = s === 0 || s === 8 ? 1 : 0.65
      this.note(chord.root, barStart + s * stepDur, 0.19, 'sawtooth', 0.11 * accent, 520)
      this.note(chord.root / 2, barStart + s * stepDur, 0.2, 'sine', 0.12 * accent, 300)
    }

    // arpeggio
    const arp = [0, 1, 2, 1, 2, 0, 1, 2]
    for (let s = 0; s < 16; s += 2) {
      const noteFreq = chord.notes[arp[(s / 2) % arp.length]] * 2
      if ((s + bar) % 4 === 0) continue
      this.note(noteFreq, barStart + s * stepDur, 0.14, 'square', 0.022, 2400)
    }

    // drums
    for (let s = 0; s < 16; s++) {
      const t = barStart + s * stepDur
      if (s % 4 === 0) this.kick(t)
      if (s === 4 || s === 12) this.snare(t)
      if (s % 2 === 1) this.hat(t, s === 14)
    }
  }

  startMusic() {
    if (!this.ready || this.musicPlaying) return
    this.musicPlaying = true
    this.step = 0
    const ctx = this.ctx
    this.nextNoteTime = ctx.currentTime + 0.12
    this.musicBus.gain.setTargetAtTime(0.55, ctx.currentTime, 0.6)
    this.timer = setInterval(() => {
      if (!this.musicPlaying) return
      const ahead = ctx.currentTime + 0.3
      while (this.nextNoteTime < ahead) {
        this.scheduleBar(this.step, this.nextNoteTime)
        this.nextNoteTime += 2.0
        this.step++
      }
    }, 120)
  }

  stopMusic(fade = true) {
    this.musicPlaying = false
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (this.ctx) {
      this.musicBus.gain.setTargetAtTime(0, this.ctx.currentTime, fade ? 0.4 : 0.01)
    }
  }

  suspend() {
    this.ctx?.suspend?.().catch(() => {})
  }

  resume() {
    this.ctx?.resume?.().catch(() => {})
  }
}
