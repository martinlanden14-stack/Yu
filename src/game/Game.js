import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { City } from './City.js'
import { PlayerCar } from './PlayerCar.js'
import { Traffic } from './Traffic.js'
import { Collectibles } from './Collectibles.js'
import { Checkpoints } from './Checkpoints.js'
import { Controls } from './Controls.js'
import { Hud } from './Hud.js'
import { AudioEngine } from './Audio.js'
import { Particles, SkidMarks, Rain } from './Effects.js'
import {
  clamp,
  damp,
  formatScore,
  isTouchDevice,
  loadBest,
  nextFrame,
  saveBest,
} from './utils.js'

const MAX_DPR = {
  high: 2,
  medium: 1.5,
  low: 1,
}

const QUALITY = {
  high: { bloom: true, rain: true, strength: 0.62, radius: 0.46, threshold: 1.02 },
  medium: { bloom: true, rain: true, strength: 0.5, radius: 0.42, threshold: 1.06 },
  low: { bloom: false, rain: false, strength: 0, radius: 0.42, threshold: 1.06 },
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uSpeed: { value: 0 },
    uBoost: { value: 0 },
    uHit: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uSpeed;
    uniform float uBoost;
    uniform float uHit;
    varying vec2 vUv;

    float gradeHash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);

      // gentle lens curve
      vec2 duv = uv + c * r2 * 0.018;

      float ca = (0.0005 + uBoost * 0.0035 + uSpeed * 0.0012) * (0.35 + r2 * 2.2);
      vec3 col;
      col.r = texture2D(tDiffuse, duv + c * ca).r;
      col.g = texture2D(tDiffuse, duv).g;
      col.b = texture2D(tDiffuse, duv - c * ca).b;

      // radial speed streaks while boosting
      float boost = clamp(uBoost, 0.0, 1.0);
      if (boost > 0.01) {
        vec3 streak = vec3(0.0);
        for (int i = 1; i <= 5; i++) {
          float t = float(i) / 5.0;
          vec2 suv = uv - c * t * 0.055 * boost;
          streak += texture2D(tDiffuse, suv).rgb;
        }
        streak /= 5.0;
        col = mix(col, streak, boost * 0.32 * smoothstep(0.02, 0.42, r2));
      }

      // grade: cool shadows, warm highlights
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, col * vec3(0.9, 0.99, 1.1), (1.0 - l) * 0.35);
      col = mix(col, col * vec3(1.05, 0.99, 1.02), l * 0.35);

      // vignette
      col *= 1.0 - smoothstep(0.3, 0.82, r2) * 0.46;

      // film grain
      float g = gradeHash(uv * vec2(1720.0, 980.0) + uTime * 47.0) - 0.5;
      col += g * 0.016;

      // impact pulse
      col = mix(col, col * vec3(1.35, 0.7, 0.8), uHit * 0.55);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
}

export class Game {
  constructor(canvas) {
    this.canvas = canvas
    this.state = 'loading'
    this.time = 0
    this.lastTime = performance.now()
    this.frameDt = 1 / 60
    this.frameAvg = 1 / 60
    this.dprScale = 1
    this.slowTime = 0
    this.fastTime = 0

    this.qualityMode = 'auto'
    this.quality = 'high'
    this.qualitySettings = QUALITY.high

    this.score = 0
    this.best = loadBest()
    this.timer = 90
    this.combo = 1
    this.boost = 35
    this.driftChain = 0
    this.totalDrift = 0
    this.driftIdle = 0
    this.distance = 0
    this.topSpeed = 0
    this.checkpointCount = 0
    this.nextCheckpointTimer = 0
    this.damage = 0
    this.hitFx = 0
    this.boostFx = 0
    this.boosting = false
    this.wasBoosting = false
    this.comboMilestone = 1
    this.menuAngle = 0.8
    this.camPos = new THREE.Vector3(0, 3.2, -8)
    this.camLook = new THREE.Vector3(0, 1.1, 6)
    this.automated = navigator.webdriver === true
    this.idleInput = {
      steer: 0,
      throttle: 0,
      brake: 0,
      handbrake: false,
      boost: false,
      boostPressed: false,
    }
    this.input = { ...this.idleInput }

    this.audio = new AudioEngine()
    this.hud = new Hud(this)
    this.soundOn = true
    this.tiltOn = false
  }

  async init() {
    const params = new URLSearchParams(location.search)
    const qualityParam = params.get('quality')
    if (qualityParam && QUALITY[qualityParam]) this.qualityMode = qualityParam
    else {
      const saved = localStorage.getItem('neondrift.quality')
      if (saved && (saved === 'auto' || QUALITY[saved])) this.qualityMode = saved
    }
    if (localStorage.getItem('neondrift.muted') === '1') this.soundOn = false
    this.hud.setSound(this.soundOn)
    this.hud.setQualityLabel(this.qualityMode)

    this.hud.setLoading(0.06, 'IGNITING THE CITY')
    await nextFrame()

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
    })
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.08
    this.renderer.setClearColor(0x05070f, 1)
    this.renderer.info.autoReset = false

    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.FogExp2(0x070b16, 0.0052)

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.2, 1600)
    this.camera.position.set(0, 3.2, -8)

    this.setupPost()
    this.applyQuality()
    this.resize()
    this.hud.setLoading(0.18, 'PAVING THE STREETS')
    await nextFrame()

    this.city = new City(this.scene, this.renderer)
    this.hud.setLoading(0.42, 'RAISING THE SKYLINE')
    await nextFrame()

    this.sparks = new Particles(this.scene, { max: 380, additive: true })
    this.smoke = new Particles(this.scene, { max: 240, additive: false })
    this.skids = new SkidMarks(this.scene)
    this.rain = new Rain(this.scene, 850)
    this.effects = { sparks: this.sparks, smoke: this.smoke, skids: this.skids, rain: this.rain }

    this.hud.setLoading(0.58, 'TUNING THE MACHINE')
    await nextFrame()

    this.player = new PlayerCar(this.scene)
    this.traffic = new Traffic(this.scene)
    this.collectibles = new Collectibles(this.scene, this.city)
    this.checkpoints = new Checkpoints(this.scene, this.city)

    this.hud.setLoading(0.78, 'CALIBRATING CONTROLS')
    await nextFrame()

    this.controls = new Controls(this.hud.el.hud, {
      onPause: () => this.pause(),
      onReset: () => this.recoverCar(),
    })

    this.city.ensureChunks(0, 0)
    this.traffic.reset(this.player.pos)
    this.collectibles.reset(this.player.pos)
    this.player.reset(0, 0, 0)
    this.menuSetup()

    this.hud.setLoading(0.94, 'READY')
    await nextFrame()

    window.addEventListener('resize', () => this.resize())
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250))
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && (this.state === 'playing' || this.state === 'countdown')) {
        this.pause()
      }
    })
    this.canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault()
      this.pause()
      this.hud.toast('RENDERER LOST — RELOAD TO CONTINUE', 'orange', 6000)
    })

    this.hud.setLoading(1, 'READY')
    this.hud.hideLoading()
    this.hud.showStart()
    this.hud.setQualityLabel(this.qualityMode)
    this.state = 'menu'

    if (params.get('play') === '1') {
      this.hud.hideStart()
      this.startRun(true)
    }

    this.lastTime = performance.now()
    this.tick = this.tick.bind(this)
    requestAnimationFrame(this.tick)

    window.__neonDrift = this
  }

  setupPost() {
    this.renderTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
    })
    this.composer = new EffectComposer(this.renderer, this.renderTarget)
    this.renderPass = new RenderPass(this.scene, this.camera)
    this.composer.addPass(this.renderPass)

    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      QUALITY.high.strength,
      QUALITY.high.radius,
      QUALITY.high.threshold,
    )
    this.composer.addPass(this.bloom)

    this.grade = new ShaderPass(GradeShader)
    this.composer.addPass(this.grade)

    this.outputPass = new OutputPass()
    this.composer.addPass(this.outputPass)
  }

  resolveQuality() {
    if (this.qualityMode !== 'auto') return this.qualityMode
    if (this.automated) return 'medium'
    return isTouchDevice() ? 'medium' : 'high'
  }

  applyQuality() {
    this.quality = this.resolveQuality()
    const settings = QUALITY[this.quality]
    this.qualitySettings = settings
    let dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR[this.quality])
    if (this.automated) dpr = Math.min(dpr, 1)
    dpr *= this.dprScale
    this.renderer.setPixelRatio(dpr)
    this.composer.setPixelRatio(dpr)
    this.bloom.enabled = settings.bloom
    this.bloom.strength = settings.strength
    this.bloom.radius = settings.radius
    this.bloom.threshold = settings.threshold
    this.rain?.setEnabled(settings.rain)
    this.hud.setQualityLabel(this.qualityMode)
    this.resize()
  }

  cycleQuality() {
    const order = ['auto', 'high', 'medium', 'low']
    const index = order.indexOf(this.qualityMode)
    this.qualityMode = order[(index + 1) % order.length]
    try {
      localStorage.setItem('neondrift.quality', this.qualityMode)
    } catch {}
    this.dprScale = 1
    this.applyQuality()
    this.hud.toast(`QUALITY ${this.qualityMode.toUpperCase()}`, '', 1200)
  }

  resize() {
    if (!this.renderer) return
    const width = window.innerWidth
    const height = window.innerHeight
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
    this.composer.setSize(width, height)
    this.scene.userData.viewportHeight = height * this.renderer.getPixelRatio()
    this.isPortrait = height > width
  }

  menuSetup() {
    this.player.reset(0, 0, 0)
    this.menuAngle = 0.8
    const side = this.isPortrait ? 5.2 : 6.8
    const back = this.isPortrait ? -8.2 : -9.2
    this.camPos.set(side, this.isPortrait ? 3.4 : 3.3, back)
    this.camLook.set(0.8, this.isPortrait ? 1.4 : 0.95, 9)
    this.camera.position.copy(this.camPos)
    this.camera.lookAt(this.camLook)
  }

  async ensureAudio() {
    await this.audio.init()
    this.audio.setMuted(!this.soundOn)
    if (this.soundOn && (this.state === 'playing' || this.state === 'countdown')) {
      this.audio.startMusic()
    }
  }

  startRun(fromParam = false) {
    const params = new URLSearchParams(location.search)
    const skipIntro = this.automated || params.get('nointro') === '1'
    this.state = skipIntro ? 'playing' : 'countdown'
    this.score = 0
    this.timer = 90
    this.combo = 1
    this.boost = 35
    this.driftChain = 0
    this.totalDrift = 0
    this.driftIdle = 0
    this.distance = 0
    this.topSpeed = 0
    this.checkpointCount = 0
    this.damage = 0
    this.hitFx = 0
    this.boostFx = 0
    this.comboMilestone = 1
    this.countdown = 3.0
    this.lastCount = 3
    this.nextCheckpointTimer = 0
    this.newBest = false

    this.hud.hideStart()
    this.hud.hideOver()
    this.hud.hidePause()
    this.hud.showHud()

    this.player.reset(0, 0, 0)
    this.city.ensureChunks(0, 0)
    this.traffic.reset(this.player.pos)
    this.collectibles.reset(this.player.pos)
    this.checkpoints.reset(this.player.pos, 0)
    this.sparks.clear()
    this.smoke.clear()
    this.skids.reset()
    this.rain.setEnabled(this.qualitySettings.rain)
    this.snapCamera()
    this.ensureAudio()

    if (this.state === 'countdown') {
      this.hud.countdown('3')
      this.audio.countdown(false)
      setTimeout(() => this.audio.countdown(false), 1000)
      setTimeout(() => this.audio.countdown(false), 2000)
      setTimeout(() => this.audio.countdown(true), 3000)
    } else {
      this.hud.toast('DRIFT TO CHARGE N2O', 'magenta', 2200)
      this.hud.countdown('GO')
    }

    if (isTouchDevice() && this.isPortrait && !sessionStorage.getItem('neondrift.rotate')) {
      sessionStorage.setItem('neondrift.rotate', '1')
      setTimeout(() => this.hud.showRotateHint(), 900)
    }
  }

  snapCamera() {
    const player = this.player
    const back = 7.6
    this.camPos.set(
      player.pos.x - Math.sin(player.heading) * back,
      3.15,
      player.pos.y - Math.cos(player.heading) * back,
    )
    this.camLook.set(
      player.pos.x + Math.sin(player.heading) * 7,
      1.1,
      player.pos.y + Math.cos(player.heading) * 7,
    )
    this.camera.position.copy(this.camPos)
    this.camera.lookAt(this.camLook)
    this.camera.fov = 62
    this.camera.updateProjectionMatrix()
  }

  pause() {
    if (this.state !== 'playing' && this.state !== 'countdown') return
    this.prevState = this.state
    this.state = 'paused'
    this.audio.suspend()
    this.hud.showPause({
      score: this.score,
      time: this.timer,
      speed: this.player.speedKmh,
    })
  }

  resume() {
    if (this.state !== 'paused') return
    this.state = this.prevState || 'playing'
    this.hud.hidePause()
    this.audio.resume()
    this.lastTime = performance.now()
  }

  endRun(quit = false) {
    if (this.state === 'over' || this.state === 'menu' || this.state === 'loading') return
    this.state = 'over'
    this.hud.hidePause()
    const best = Math.max(this.best || 0, Math.round(this.score))
    this.newBest = Math.round(this.score) > (this.best || 0)
    this.best = best
    saveBest(best)
    this.hud.showOver({
      score: Math.round(this.score),
      distance: Math.round(this.distance),
      topSpeed: this.topSpeed,
      driftScore: Math.round(this.totalDrift || 0),
      checkpoints: this.checkpointCount,
      newBest: this.newBest,
    })
    this.audio.stopMusic()
    this.audio.setEngine(0, 0, false, 0)
    this.audio.setDrift(0)
    this.overTime = 0
  }

  backToMenu() {
    this.state = 'menu'
    this.audio.stopMusic()
    this.audio.setEngine(0, 0, false, 0)
    this.audio.setDrift(0)
    this.hud.hideOver()
    this.hud.hidePause()
    this.hud.hideHud()
    this.hud.showStart()
    this.player.reset(0, 0, 0)
    this.city.ensureChunks(0, 0)
    this.traffic.reset(this.player.pos)
    this.collectibles.reset(this.player.pos)
    this.checkpoints.target = null
    this.checkpoints.group.visible = false
    this.skids.reset()
    this.sparks.clear()
    this.smoke.clear()
    this.menuAngle = 0.8
  }

  recoverCar() {
    if (this.state !== 'playing') return
    const road = this.city.nearestRoad(this.player.pos.x, this.player.pos.y, 0)
    this.player.reset(road.x, road.z, this.player.heading)
    this.hud.toast('VEHICLE RESET', '', 1200)
  }

  async toggleTilt() {
    if (this.tiltOn) {
      this.controls.disableTilt()
      this.tiltOn = false
      this.hud.setTilt(false)
      return false
    }
    const ok = await this.controls.enableTilt()
    this.tiltOn = ok
    this.hud.setTilt(ok)
    if (!ok) this.hud.toast('TILT STEERING UNAVAILABLE', 'orange', 2200)
    return ok
  }

  toggleSound() {
    this.soundOn = !this.soundOn
    this.audio.setMuted(!this.soundOn)
    try {
      localStorage.setItem('neondrift.muted', this.soundOn ? '0' : '1')
    } catch {}
    if (this.soundOn) this.ensureAudio()
    return !this.soundOn
  }

  // ------------------------------------------------------------------ loop

  tick() {
    requestAnimationFrame(this.tick)
    const now = performance.now()
    let dt = (now - this.lastTime) / 1000
    this.lastTime = now
    if (!Number.isFinite(dt)) dt = 1 / 60
    dt = Math.min(dt, 0.05)
    this.frameDt = dt
    this.frameAvg = this.frameAvg * 0.94 + dt * 0.06
    this.time += dt
    this.update(dt)
    this.render(dt)
    this.adaptResolution(dt)
  }

  adaptResolution() {
    if (this.qualityMode !== 'auto' || this.state === 'paused') return
    if (this.frameAvg > 1 / 34) {
      this.slowTime += this.frameDt
      this.fastTime = 0
      if (this.slowTime > 2.2 && this.dprScale > 0.62) {
        this.dprScale = Math.max(0.6, this.dprScale - 0.1)
        this.slowTime = 0
        this.applyQuality()
      }
    } else if (this.frameAvg < 1 / 57) {
      this.fastTime += this.frameDt
      this.slowTime = 0
      if (this.fastTime > 5 && this.dprScale < 1) {
        this.dprScale = Math.min(1, this.dprScale + 0.05)
        this.fastTime = 0
        this.applyQuality()
      }
    }
  }

  update(dt) {
    const state = this.state
    if (state === 'loading' || state === 'paused') {
      this.updatePost(dt)
      return
    }

    const liveControls = this.controls?.update(dt) || this.idleInput

    if (state === 'menu') {
      this.player.update(dt, this.idleInput, this.city, this.effects)
      this.traffic.update(dt, this.player, 0, this.player.heading, false)
      this.collectibles.update(dt, this.player)
      this.city.update(dt, this.camera, this.player.pos)
      this.effects.sparks.update(dt, this.camera)
      this.effects.smoke.update(dt, this.camera)
      this.effects.skids.update(dt)
      this.effects.rain.update(dt, this.camera, 0)
      this.updateMenuCamera(dt)
      this.audio.setEngine(0.02, 0, false, 0)
      this.updatePost(dt)
      return
    }

    if (state === 'over') {
      this.overTime += dt
      this.player.update(dt, this.idleInput, this.city, this.effects)
      this.traffic.update(dt, this.player, this.player.speed, this.player.heading, false)
      this.collectibles.update(dt, this.player)
      this.city.update(dt, this.camera, this.player.pos)
      this.effects.sparks.update(dt, this.camera)
      this.effects.smoke.update(dt, this.camera)
      this.effects.skids.update(dt)
      this.effects.rain.update(dt, this.camera, this.player.speed)
      this.updateChaseCamera(dt)
      this.audio.setEngine(0, 0, false, 0)
      this.updatePost(dt)
      return
    }

    if (state === 'countdown') {
      this.countdown -= dt
      const ceil = Math.ceil(this.countdown)
      if (ceil !== this.lastCount && ceil > 0) {
        this.lastCount = ceil
        this.hud.countdown(String(ceil))
      }
      if (this.countdown <= 0) {
        this.state = 'playing'
        this.hud.countdown('GO')
        this.hud.toast('DRIFT TO CHARGE N2O', 'magenta', 2200)
      }
    }

    // ---- playing ----
    // The car stays parked and inputs are ignored during the countdown.
    const playing = this.state === 'playing'
    const controls = playing ? liveControls : this.idleInput
    const wantBoost = playing && controls.boost && this.boost > 0.5
    this.boosting = wantBoost
    if (wantBoost) {
      this.boost = Math.max(0, this.boost - 26 * dt)
      if (!this.wasBoosting) this.audio.boost()
    }
    this.wasBoosting = wantBoost
    this.boost = clamp(this.boost + this.player.driftIntensity * 15 * dt, 0, 100)
    this.input.steer = controls.steer
    this.input.throttle = controls.throttle
    this.input.brake = controls.brake
    this.input.handbrake = controls.handbrake
    this.input.boost = wantBoost
    this.input.boostPressed = controls.boostPressed

    this.player.update(dt, this.input, this.city, this.effects)
    this.traffic.update(dt, this.player, this.player.speed, this.player.heading, playing)
    this.collectibles.update(dt, this.player)
    this.checkpoints.update(dt, this.player)
    this.city.update(dt, this.camera, this.player.pos)
    this.effects.sparks.update(dt, this.camera)
    this.effects.smoke.update(dt, this.camera)
    this.effects.skids.update(dt)
    this.effects.rain.update(dt, this.camera, this.player.speed)

    if (playing) {
      this.updateGameplay(dt, controls)
    }

    this.updateChaseCamera(dt)
    this.audio.setEngine(
      clamp(this.player.speed / 63, 0, 1.2),
      controls.throttle,
      wantBoost,
      this.player.driftIntensity,
    )
    this.updatePost(dt)
    this.updateHud(dt)
  }

  updateGameplay(dt, controls) {
    const player = this.player
    this.timer -= dt
    if (this.timer <= 0) {
      this.timer = 0
      this.endRun(false)
      return
    }

    this.distance += player.speed * dt
    this.topSpeed = Math.max(this.topSpeed, player.speedKmh)

    // combo from drifting
    if (player.driftIntensity > 0.1 && player.speed > 7) {
      const gain = player.driftIntensity * player.speed * dt * 8.5
      const points = gain * this.combo
      this.score += points
      this.driftChain += points
      this.totalDrift = (this.totalDrift || 0) + points
      this.driftIdle = 0
      this.combo = Math.min(8, this.combo + player.driftIntensity * dt * 0.95)
    } else {
      this.driftIdle += dt
      if (this.driftIdle > 0.7) this.driftChain = 0
      this.combo = Math.max(1, this.combo - dt * 0.32)
    }

    // distance score
    this.score += player.speed * dt * 1.15 * this.combo

    // combo milestone toast
    const milestone = Math.floor(this.combo)
    if (milestone > this.comboMilestone && milestone >= 2) {
      this.comboMilestone = milestone
      this.hud.toast(`×${milestone} COMBO`, 'magenta', 1200)
    }
    if (this.combo < 1.5) this.comboMilestone = 1

    // checkpoint
    if (this.checkpoints.collected) {
      this.checkpointCount++
      this.timer = Math.min(130, this.timer + 22)
      this.score += 750 * this.combo
      this.combo = Math.min(8, this.combo + 0.5)
      this.boost = clamp(this.boost + 25, 0, 100)
      this.checkpoints.pulse = 1
      this.sparks.burst(
        new THREE.Vector3(
          this.checkpoints.group.position.x,
          5,
          this.checkpoints.group.position.z,
        ),
        { count: 46, color: 0x4df3ff, speed: 16, size: 1.1, life: 1.1, gravity: -4 },
      )
      this.audio.checkpoint()
      this.hud.toast('CHECKPOINT  +22s', 'big', 1800)
      this.nextCheckpointTimer = 1.4
    }
    if (this.nextCheckpointTimer > 0) {
      this.nextCheckpointTimer -= dt
      if (this.nextCheckpointTimer <= 0 && !this.checkpoints.target) {
        this.checkpoints.spawn(player.pos, player.heading)
      }
    }

    // orbs
    if (this.collectibles.collected) {
      const orb = this.collectibles.collected
      this.score += 100 * this.combo
      this.boost = clamp(this.boost + 10, 0, 100)
      this.combo = Math.min(8, this.combo + 0.08)
      this.sparks.burst(new THREE.Vector3(orb.x, 1.2, orb.z), {
        count: 18,
        color: 0x6ff7ff,
        speed: 9,
        size: 0.6,
        life: 0.7,
      })
      this.audio.pickup(Math.floor(Math.random() * 4))
    }

    // traffic events
    if (this.traffic.nearMissEvent) {
      const event = this.traffic.nearMissEvent
      this.score += 60 * this.combo
      this.boost = clamp(this.boost + 12, 0, 100)
      this.combo = Math.min(8, this.combo + 0.2)
      this.audio.nearMiss()
      this.hud.toast('NEAR MISS  +60', 'orange', 900)
      this.sparks.burst(new THREE.Vector3(event.x, 0.8, event.z), {
        count: 10,
        color: 0xff8a2b,
        speed: 6,
        size: 0.5,
        life: 0.5,
      })
    }
    if (this.traffic.hitEvent) {
      this.onImpact(this.traffic.hitEvent.strength, this.traffic.hitEvent.x, this.traffic.hitEvent.z)
    }

    // building impact
    if (player.pendingImpact > 0) {
      const strength = player.pendingImpact
      player.pendingImpact = 0
      this.onImpact(strength, player.pos.x, player.pos.y)
    }

    // continuous light damage from clipping buildings
    if (player.impactFlash) {
      this.hitFx = Math.max(this.hitFx, player.impactFlash)
      player.impactFlash = 0
    }

    this.boostFx = damp(this.boostFx, this.boosting ? 1 : 0, 5, dt)
    this.hitFx = damp(this.hitFx, 0, 4, dt)
    this.damage = Math.max(0, this.damage - dt * 2.2)
    this.hud.damage(this.damage)
  }

  onImpact(strength, x, z) {
    this.combo = 1
    this.comboMilestone = 1
    this.driftChain = 0
    this.damage = Math.max(this.damage, strength)
    this.hitFx = Math.max(this.hitFx, strength)
    this.audio.impact(strength)
    this.hud.damage(strength)
    this.sparks.burst(new THREE.Vector3(x, 0.8, z), {
      count: 16 + Math.round(strength * 20),
      color: Math.random() > 0.5 ? 0xffb26b : 0xffe6a8,
      speed: 8 + strength * 10,
      size: 0.55,
      life: 0.55,
      gravity: -12,
    })
    if (navigator.vibrate) navigator.vibrate(Math.round(20 + strength * 50))
    if (strength > 0.6) this.hud.toast('IMPACT', 'orange', 800)
  }

  updateHud(dt) {
    this.hud.update(
      {
        score: this.score,
        combo: this.combo,
        timer: this.timer,
        boost: this.boost,
        driftScore: this.driftChain,
        checkpointDistance: this.checkpoints.target
          ? this.checkpoints.distance ?? null
          : null,
        speed: this.player.speedKmh,
        gear: this.player.gear,
        boosting: this.boosting,
      },
      dt,
    )
  }

  updatePost(dt) {
    this.grade.uniforms.uTime.value = this.time
    this.grade.uniforms.uSpeed.value = clamp((this.player?.speed || 0) / 63, 0, 1)
    this.grade.uniforms.uBoost.value = this.boostFx || 0
    this.grade.uniforms.uHit.value = this.hitFx || 0
  }

  updateMenuCamera(dt) {
    // Slow, cinematic drift behind the parked car, looking down the avenue.
    this.menuAngle += dt * 0.16
    const portrait = this.isPortrait
    const sway = Math.sin(this.menuAngle) * (portrait ? 0.35 : 0.6)
    const side = (portrait ? 5.2 : 6.8) + sway
    const back = (portrait ? -8.2 : -9.2) + Math.cos(this.menuAngle) * 0.45
    const targetX = this.player.pos.x
    const targetZ = this.player.pos.y
    const desired = new THREE.Vector3(
      targetX + side,
      (portrait ? 3.4 : 3.3) + Math.sin(this.menuAngle * 1.7) * 0.12,
      targetZ + back,
    )
    this.camPos.lerp(desired, 1 - Math.exp(-dt * 2.2))
    const look = new THREE.Vector3(
      targetX + 0.8,
      portrait ? 1.4 : 0.95,
      targetZ + 9,
    )
    this.camLook.lerp(look, 1 - Math.exp(-dt * 2.4))
    this.camera.position.copy(this.camPos)
    this.camera.lookAt(this.camLook)
    this.camera.fov = damp(this.camera.fov, 55, 2, dt)
    this.camera.updateProjectionMatrix()
  }

  updateChaseCamera(dt) {
    const player = this.player
    const speedNorm = clamp(player.speed / 63, 0, 1)
    const camYaw = player.heading + clamp(player.slip, -1, 1) * 0.55
    const back = 7.6 + speedNorm * 1.8
    const height = 3.05 + speedNorm * 0.3
    const lateral = -clamp(player.slip * 2.4, -2.2, 2.2)
    const desired = new THREE.Vector3(
      player.pos.x - Math.sin(camYaw) * back + Math.cos(camYaw) * lateral,
      height,
      player.pos.y - Math.cos(camYaw) * back - Math.sin(camYaw) * lateral,
    )
    const lookAhead = 8 + speedNorm * 5
    const look = new THREE.Vector3(
      player.pos.x + Math.sin(player.heading) * lookAhead + Math.cos(player.heading) * player.slip * 5,
      1.15,
      player.pos.y + Math.cos(player.heading) * lookAhead - Math.sin(player.heading) * player.slip * 5,
    )

    const posRate = 1 - Math.exp(-dt * 6.5)
    const lookRate = 1 - Math.exp(-dt * 10)
    this.camPos.lerp(desired, posRate)
    this.camLook.lerp(look, lookRate)
    this.camera.position.copy(this.camPos)

    const shake =
      player.shake * 0.7 +
      (player.offRoad ? 0.055 : 0) * clamp(player.speed / 30, 0, 1) +
      Math.pow(speedNorm, 3) * 0.02
    if (shake > 0.0001) {
      this.camera.position.x += (Math.random() - 0.5) * shake
      this.camera.position.y += (Math.random() - 0.5) * shake * 0.8
      this.camera.position.z += (Math.random() - 0.5) * shake
    }
    this.camera.lookAt(this.camLook)
    const roll = -clamp(player.slip * 0.075, -0.06, 0.06)
    this.camera.rotateZ(roll)

    const targetFov = 62 + speedNorm * 13 + (this.boosting ? 5 : 0)
    this.camera.fov = damp(this.camera.fov, targetFov, 3.5, dt)
    this.camera.updateProjectionMatrix()
  }

  render() {
    if (!this.composer) return
    this.renderer.info.reset()
    this.composer.render(this.frameDt)
  }
}
