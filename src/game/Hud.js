import { clamp, formatScore, formatTime, loadBest } from './utils.js'

const $ = (id) => document.getElementById(id)

export class Hud {
  constructor(game) {
    this.game = game
    this.el = {
      hud: $('hud'),
      score: $('score'),
      combo: $('combo'),
      comboFill: $('comboFill'),
      timer: $('timer'),
      timerFill: $('timerFill'),
      checkpointText: $('checkpointText'),
      speed: $('speed'),
      speedArc: $('speedArc'),
      gear: $('gear'),
      boostFill: $('boostFill'),
      boostState: $('boostState'),
      driftBadge: $('driftBadge'),
      driftScore: $('driftScore'),
      toastLayer: $('toastLayer'),
      countdown: $('countdown'),
      damageFlash: $('damageFlash'),
      minimap: $('minimap'),
      startScreen: $('startScreen'),
      pauseScreen: $('pauseScreen'),
      overScreen: $('overScreen'),
      loadingScreen: $('loadingScreen'),
      loaderFill: $('loaderFill'),
      bestScore: $('bestScore'),
      pauseScore: $('pauseScore'),
      pauseTime: $('pauseTime'),
      pauseSpeed: $('pauseSpeed'),
      finalScore: $('finalScore'),
      newBest: $('newBest'),
      statDistance: $('statDistance'),
      statTopSpeed: $('statTopSpeed'),
      statDrift: $('statDrift'),
      statCheckpoints: $('statCheckpoints'),
      rotateHint: $('rotateHint'),
      qualityLabel: $('qualityLabel'),
      soundToggle: $('soundToggle'),
      tiltToggle: $('tiltToggle'),
      qualityToggle: $('qualityToggle'),
      howPanel: $('howPanel'),
    }

    this.mapCtx = this.el.minimap.getContext('2d')
    this.mapSize = 220
    this.mapScale = 0.3
    this.mapTimer = 0
    this.toastTimer = null
    this.lastScore = 0
    this.lastSpeed = 0
    this.best = loadBest()
    this.el.bestScore.textContent = formatScore(this.best)
    this.boosting = false

    this.wire()
  }

  wire() {
    const ui = () => this.game.audio.ui()
    $('startBtn').addEventListener('click', () => {
      ui()
      this.game.startRun()
    })
    $('pauseBtn').addEventListener('click', () => {
      ui()
      this.game.pause()
    })
    $('resumeBtn').addEventListener('click', () => {
      ui()
      this.game.resume()
    })
    $('quitBtn').addEventListener('click', () => {
      ui()
      this.game.endRun(true)
    })
    $('retryBtn').addEventListener('click', () => {
      ui()
      this.game.startRun()
    })
    $('menuBtn').addEventListener('click', () => {
      ui()
      this.game.backToMenu()
    })
    this.el.soundToggle.addEventListener('click', () => {
      const muted = this.game.toggleSound()
      this.el.soundToggle.setAttribute('aria-pressed', String(!muted))
      ui()
    })
    this.el.tiltToggle.addEventListener('click', async () => {
      const enabled = await this.game.toggleTilt()
      this.el.tiltToggle.setAttribute('aria-pressed', String(enabled))
      ui()
    })
    this.el.qualityToggle.addEventListener('click', () => {
      this.game.cycleQuality()
      ui()
    })
    $('howBtn').addEventListener('click', () => {
      ui()
      this.el.howPanel.classList.toggle('is-hidden')
    })
    $('howClose').addEventListener('click', () => {
      ui()
      this.el.howPanel.classList.add('is-hidden')
    })
    $('rotateDismiss').addEventListener('click', () => {
      this.el.rotateHint.classList.remove('is-on')
    })
  }

  setQualityLabel(quality) {
    this.el.qualityLabel.textContent = `QUALITY ${quality.toUpperCase()}`
  }

  setSound(enabled) {
    this.el.soundToggle.setAttribute('aria-pressed', String(enabled))
  }

  setTilt(enabled) {
    this.el.tiltToggle.setAttribute('aria-pressed', String(enabled))
  }

  setLoading(progress, text) {
    this.el.loaderFill.style.width = `${Math.round(progress * 100)}%`
    if (text) {
      const label = this.el.loadingScreen.querySelector('.loader-text')
      if (label) label.textContent = text
    }
  }

  hideLoading() {
    this.el.loadingScreen.classList.add('is-hidden')
  }

  showHud() {
    this.el.hud.classList.remove('is-hidden')
    this.el.hud.setAttribute('aria-hidden', 'false')
  }

  hideHud() {
    this.el.hud.classList.add('is-hidden')
    this.el.hud.setAttribute('aria-hidden', 'true')
  }

  showStart() {
    this.el.startScreen.classList.remove('is-hidden')
    this.el.pauseScreen.classList.add('is-hidden')
    this.el.overScreen.classList.add('is-hidden')
    this.el.bestScore.textContent = formatScore(this.best)
  }

  hideStart() {
    this.el.startScreen.classList.add('is-hidden')
  }

  showPause(stats) {
    this.el.pauseScreen.classList.remove('is-hidden')
    this.el.pauseScore.textContent = formatScore(stats.score)
    this.el.pauseTime.textContent = formatTime(stats.time)
    this.el.pauseSpeed.textContent = `${Math.round(stats.speed)}`
  }

  hidePause() {
    this.el.pauseScreen.classList.add('is-hidden')
  }

  showOver(stats) {
    this.el.overScreen.classList.remove('is-hidden')
    this.el.finalScore.textContent = formatScore(stats.score)
    this.el.statDistance.textContent = `${formatScore(stats.distance)} m`
    this.el.statTopSpeed.textContent = `${Math.round(stats.topSpeed)} km/h`
    this.el.statDrift.textContent = formatScore(stats.driftScore)
    this.el.statCheckpoints.textContent = String(stats.checkpoints)
    this.el.newBest.classList.toggle('is-hidden', !stats.newBest)
    if (stats.newBest) {
      this.best = stats.score
      this.el.bestScore.textContent = formatScore(this.best)
    }
    this.hideHud()
  }

  hideOver() {
    this.el.overScreen.classList.add('is-hidden')
  }

  showRotateHint() {
    this.el.rotateHint.classList.add('is-on')
  }

  toast(text, variant = '', duration = 1600) {
    const node = document.createElement('div')
    node.className = `toast ${variant}`.trim()
    node.textContent = text
    this.el.toastLayer.appendChild(node)
    while (this.el.toastLayer.children.length > 3) {
      this.el.toastLayer.firstChild.remove()
    }
    setTimeout(() => node.remove(), duration + 400)
  }

  countdown(text) {
    const node = this.el.countdown
    node.textContent = text
    node.classList.remove('is-on')
    void node.offsetWidth
    node.classList.add('is-on')
  }

  damage(strength) {
    this.el.damageFlash.style.opacity = String(clamp(strength * 0.9, 0, 0.9))
  }

  update(state, dt) {
    const { score, combo, timer, boost, driftScore, checkpointDistance } = state
    this.el.score.textContent = formatScore(score)
    this.el.combo.textContent = `×${combo.toFixed(1)}`
    this.el.combo.classList.toggle('is-hot', combo > 2)
    this.el.comboFill.style.width = `${clamp((combo - 1) / 7, 0, 1) * 100}%`

    this.el.timer.textContent = formatTime(timer)
    this.el.timer.classList.toggle('is-low', timer < 10)
    this.el.timerFill.style.width = `${clamp(timer / 60, 0, 1) * 100}%`
    this.el.timerFill.classList.toggle('is-low', timer < 10)

    if (checkpointDistance != null) {
      this.el.checkpointText.textContent = `CHECKPOINT ${Math.max(0, Math.round(checkpointDistance))}m`
    } else {
      this.el.checkpointText.textContent = 'CHECKPOINT CLEARED'
    }

    const kmh = Math.round(state.speed)
    this.el.speed.textContent = String(kmh)
    const ratio = clamp(kmh / 260, 0, 1)
    this.el.speedArc.style.strokeDasharray = `${ratio * 75} 100`
    this.el.speedArc.style.stroke =
      ratio > 0.82 ? '#ff2fb3' : ratio > 0.6 ? '#8b5cff' : '#4df3ff'
    this.el.gear.textContent = state.gear

    this.el.boostFill.style.width = `${clamp(boost, 0, 100)}%`
    const active = state.boosting
    this.el.boostState.textContent = active ? 'BURN' : boost > 98 ? 'READY' : `${Math.round(boost)}%`
    this.el.boostState.classList.toggle('is-active', active)
    this.el.boostState.classList.toggle('is-ready', !active && boost > 98)
    const boostBtn = document.querySelector('.boost-btn')
    if (boostBtn) boostBtn.classList.toggle('is-armed', boost > 98 && !active)

    this.el.driftBadge.classList.toggle('is-on', driftScore > 0)
    if (driftScore > 0) this.el.driftScore.textContent = formatScore(driftScore)

    this.mapTimer -= dt
    if (this.mapTimer <= 0) {
      this.mapTimer = 0.075
      this.drawMinimap()
    }
  }

  drawMinimap() {
    const ctx = this.mapCtx
    const size = this.mapSize
    const half = size / 2
    const game = this.game
    const player = game.player
    const scale = this.mapScale
    const px = player.pos.x
    const pz = player.pos.y

    ctx.clearRect(0, 0, size, size)
    ctx.save()
    ctx.beginPath()
    ctx.arc(half, half, half - 5, 0, Math.PI * 2)
    ctx.clip()

    const bg = ctx.createRadialGradient(half, half, 10, half, half, half)
    bg.addColorStop(0, 'rgba(10,24,38,0.92)')
    bg.addColorStop(1, 'rgba(3,8,16,0.96)')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, size, size)

    const worldToMap = (wx, wz) => [half + (wx - px) * scale, half - (wz - pz) * scale]

    // roads
    const range = 34
    const baseX = Math.floor(px / 80) * 80
    const baseZ = Math.floor(pz / 80) * 80
    ctx.strokeStyle = 'rgba(120, 220, 255, 0.16)'
    ctx.lineWidth = 5
    ctx.beginPath()
    for (let i = -3; i <= 3; i++) {
      const x = baseX + i * 80
      const [mx] = worldToMap(x, 0)
      ctx.moveTo(mx, 0)
      ctx.lineTo(mx, size)
      const z = baseZ + i * 80
      const [, my] = worldToMap(0, z)
      ctx.moveTo(0, my)
      ctx.lineTo(size, my)
    }
    ctx.stroke()

    // buildings from nearby chunks
    ctx.fillStyle = 'rgba(60, 92, 120, 0.34)'
    const ci = Math.floor(px / 80)
    const cj = Math.floor(pz / 80)
    for (let di = -2; di <= 2; di++) {
      for (let dj = -2; dj <= 2; dj++) {
        const chunk = game.city.chunks.get(`${ci + di},${cj + dj}`)
        if (!chunk) continue
        for (const b of chunk.colliders) {
          const [x1, y1] = worldToMap(b.minX, b.maxZ)
          const [x2, y2] = worldToMap(b.maxX, b.minZ)
          if (x2 < -20 || x1 > size + 20 || y2 < -20 || y1 > size + 20) continue
          ctx.fillRect(x1, y1, x2 - x1, y2 - y1)
        }
      }
    }

    // traffic
    if (game.traffic) {
      ctx.fillStyle = 'rgba(255, 90, 110, 0.9)'
      for (const car of game.traffic.cars) {
        const [mx, my] = worldToMap(car.x, car.z)
        if (mx < -10 || mx > size + 10 || my < -10 || my > size + 10) continue
        ctx.beginPath()
        ctx.arc(mx, my, 2, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // orbs
    if (game.collectibles) {
      ctx.fillStyle = 'rgba(77, 243, 255, 0.8)'
      for (const orb of game.collectibles.orbs) {
        const [mx, my] = worldToMap(orb.x, orb.z)
        if (mx < -10 || mx > size + 10 || my < -10 || my > size + 10) continue
        ctx.fillRect(mx - 1.4, my - 1.4, 2.8, 2.8)
      }
    }

    // checkpoint
    if (game.checkpoints?.target) {
      const cp = game.checkpoints.target
      let [mx, my] = worldToMap(cp.x, cp.z)
      const dx = mx - half
      const dy = my - half
      const dist = Math.hypot(dx, dy)
      const maxR = half - 14
      let edge = false
      if (dist > maxR) {
        mx = half + (dx / dist) * maxR
        my = half + (dy / dist) * maxR
        edge = true
      }
      const pulse = 1 + Math.sin(performance.now() * 0.006) * 0.2
      ctx.save()
      ctx.translate(mx, my)
      ctx.rotate(Math.PI / 4)
      ctx.strokeStyle = '#4df3ff'
      ctx.fillStyle = 'rgba(77,243,255,0.35)'
      ctx.lineWidth = 2
      const s = (edge ? 4 : 5) * pulse
      ctx.fillRect(-s, -s, s * 2, s * 2)
      ctx.strokeRect(-s, -s, s * 2, s * 2)
      ctx.restore()
    }

    // player arrow
    ctx.save()
    ctx.translate(half, half)
    ctx.rotate(player.heading)
    ctx.beginPath()
    ctx.moveTo(0, -8)
    ctx.lineTo(5.5, 6)
    ctx.lineTo(0, 3)
    ctx.lineTo(-5.5, 6)
    ctx.closePath()
    ctx.fillStyle = '#eafcff'
    ctx.shadowColor = '#4df3ff'
    ctx.shadowBlur = 10
    ctx.fill()
    ctx.restore()

    // sweep
    const sweep = ctx.createLinearGradient(0, 0, 0, size)
    sweep.addColorStop(0, 'rgba(77,243,255,0.0)')
    sweep.addColorStop(1, 'rgba(77,243,255,0.05)')
    ctx.fillStyle = sweep
    ctx.fillRect(0, 0, size, size)

    ctx.restore()

    // crosshair ticks
    ctx.strokeStyle = 'rgba(77, 243, 255, 0.28)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2
      const x1 = half + Math.cos(a) * (half - 4)
      const y1 = half + Math.sin(a) * (half - 4)
      const x2 = half + Math.cos(a) * (half - 12)
      const y2 = half + Math.sin(a) * (half - 12)
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
    }
    ctx.stroke()
  }
}
