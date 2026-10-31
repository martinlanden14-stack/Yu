import { clamp, damp } from './utils.js'

/**
 * Unified input: multi-touch pads, keyboard, gamepad and optional tilt.
 */
export class Controls {
  constructor(root, { onPause, onReset } = {}) {
    this.root = root
    this.onPause = onPause
    this.onReset = onReset

    this.keys = new Set()
    this.touch = { left: false, right: false, gas: false, brake: false, drift: false, boost: false }
    this.pointers = new Map()

    this.tiltEnabled = false
    this.tiltAvailable = false
    this.tiltNeutral = null
    this.tiltValue = 0
    this.tiltRaw = 0
    this.orientationHandler = null

    this.steer = 0
    this.steerTarget = 0
    this.boostWasDown = false
    this.gamepadIndex = null

    this.state = {
      steer: 0,
      throttle: 0,
      brake: 0,
      handbrake: false,
      boost: false,
      boostPressed: false,
      tiltActive: false,
    }

    this.bindButtons()
    this.bindKeyboard()
    this.bindGamepad()
    this.bindPointerFallback()
  }

  bindButtons() {
    const buttons = this.root.querySelectorAll('[data-action]')
    buttons.forEach((button) => {
      const action = button.dataset.action
      const down = (event) => {
        event.preventDefault()
        if (event.pointerId !== undefined) {
          this.pointers.set(event.pointerId, { action, button })
          try {
            button.setPointerCapture(event.pointerId)
          } catch {}
        }
        this.setTouch(action, true)
        button.classList.add('is-down')
        if (action === 'boost') this.boostWasDown = true
        if (navigator.vibrate) navigator.vibrate(8)
      }
      const up = (event) => {
        event.preventDefault()
        if (event.pointerId !== undefined) this.pointers.delete(event.pointerId)
        this.setTouch(action, false)
        button.classList.remove('is-down')
      }
      button.addEventListener('pointerdown', down)
      button.addEventListener('pointerup', up)
      button.addEventListener('pointercancel', up)
      button.addEventListener('lostpointercapture', up)
      button.addEventListener('contextmenu', (e) => e.preventDefault())
    })
  }

  bindPointerFallback() {
    window.addEventListener('pointerup', (event) => {
      const entry = this.pointers.get(event.pointerId)
      if (!entry) return
      this.pointers.delete(event.pointerId)
      this.setTouch(entry.action, false)
      entry.button.classList.remove('is-down')
    })
    window.addEventListener('blur', () => this.releaseAll())
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll()
    })
  }

  bindKeyboard() {
    window.addEventListener('keydown', (event) => {
      const code = event.code
      if (
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(code) &&
        !event.target.closest?.('input, textarea')
      ) {
        event.preventDefault()
      }
      if (event.repeat) return
      this.keys.add(code)
      if (code === 'Space') this.boostWasDown = this.boostWasDown || false
      if (code === 'KeyP' || code === 'Escape') this.onPause?.()
      if (code === 'KeyR') this.onReset?.()
      if (code === 'ShiftLeft' || code === 'ShiftRight') this.boostWasDown = true
    })
    window.addEventListener('keyup', (event) => this.keys.delete(event.code))
  }

  bindGamepad() {
    window.addEventListener('gamepadconnected', (event) => {
      this.gamepadIndex = event.gamepad.index
    })
    window.addEventListener('gamepaddisconnected', () => {
      this.gamepadIndex = null
    })
  }

  setTouch(action, value) {
    if (!(action in this.touch)) return
    this.touch[action] = value
    if (action === 'boost' && value) this.boostWasDown = true
  }

  releaseAll() {
    for (const key of Object.keys(this.touch)) this.touch[key] = false
    this.pointers.clear()
    this.keys.clear()
    this.root.querySelectorAll('.ctrl-btn.is-down').forEach((b) => b.classList.remove('is-down'))
  }

  async enableTilt() {
    if (typeof DeviceOrientationEvent === 'undefined') return false
    try {
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        const permission = await DeviceOrientationEvent.requestPermission()
        if (permission !== 'granted') return false
      }
      if (!this.orientationHandler) {
        this.orientationHandler = (event) => this.onOrientation(event)
        window.addEventListener('deviceorientation', this.orientationHandler, true)
      }
      this.tiltEnabled = true
      this.tiltNeutral = null
      this.tiltAvailable = true
      return true
    } catch {
      return false
    }
  }

  disableTilt() {
    this.tiltEnabled = false
    this.tiltValue = 0
    this.tiltRaw = 0
    if (this.orientationHandler) {
      window.removeEventListener('deviceorientation', this.orientationHandler, true)
      this.orientationHandler = null
    }
  }

  onOrientation(event) {
    if (!this.tiltEnabled) return
    const angle =
      (screen.orientation && screen.orientation.angle) ||
      (typeof window.orientation === 'number' ? window.orientation : 0)
    let value
    if (Math.abs(angle) === 90) {
      value = -event.beta * Math.sign(angle)
    } else {
      value = event.gamma
    }
    if (value == null || Number.isNaN(value)) return
    this.tiltRaw = value
    if (this.tiltNeutral === null) this.tiltNeutral = value
    const deadzone = 1.5
    const delta = value - this.tiltNeutral
    const effective = Math.abs(delta) < deadzone ? 0 : delta - Math.sign(delta) * deadzone
    this.tiltValue = clamp(effective / 20, -1, 1)
    // Slowly re-centre so the player can hold a natural angle.
    this.tiltNeutral = damp(this.tiltNeutral, value, 0.12, 1 / 60)
  }

  recalibrateTilt() {
    this.tiltNeutral = this.tiltRaw || null
  }

  pollGamepad() {
    if (this.gamepadIndex === null || !navigator.getGamepads) return null
    const pad = navigator.getGamepads()[this.gamepadIndex]
    if (!pad) return null
    const axis = pad.axes[0] || 0
    const steer = Math.abs(axis) > 0.12 ? axis : 0
    const throttle = pad.buttons[7]?.value || 0
    const brake = pad.buttons[6]?.value || 0
    const drift = pad.buttons[0]?.pressed || false
    const boost = pad.buttons[1]?.pressed || false
    return { steer, throttle, brake, drift, boost }
  }

  update(dt) {
    const pad = this.pollGamepad()

    let target = 0
    if (this.touch.left) target -= 1
    if (this.touch.right) target += 1
    const keyLeft = this.keys.has('ArrowLeft') || this.keys.has('KeyA')
    const keyRight = this.keys.has('ArrowRight') || this.keys.has('KeyD')
    if (keyLeft) target -= 1
    if (keyRight) target += 1

    if (target === 0 && this.tiltEnabled && this.tiltAvailable) {
      target = this.tiltValue
    }
    if (pad && Math.abs(pad.steer) > 0.01) target = pad.steer
    target = clamp(target, -1, 1)

    // Nonlinear steering response near centre for stability.
    const shaped = Math.sign(target) * Math.pow(Math.abs(target), 1.25)
    this.steerTarget = shaped
    const rate = Math.abs(shaped) > 0.02 ? 6.5 : 9
    this.steer = damp(this.steer, shaped, rate, dt)

    const gasKey = this.keys.has('ArrowUp') || this.keys.has('KeyW')
    const brakeKey = this.keys.has('ArrowDown') || this.keys.has('KeyS')
    const driftKey = this.keys.has('Space')
    const boostKey = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')

    const throttle = clamp((this.touch.gas ? 1 : 0) + (pad?.throttle || 0) + (gasKey ? 1 : 0), 0, 1)
    const brake = clamp((this.touch.brake ? 1 : 0) + (pad?.brake || 0) + (brakeKey ? 1 : 0), 0, 1)
    const handbrake = this.touch.drift || driftKey || pad?.drift || false
    const boost = this.touch.boost || boostKey || pad?.boost || false

    this.state.steer = this.steer
    this.state.throttle = throttle
    this.state.brake = brake
    this.state.handbrake = handbrake
    this.state.boost = boost
    this.state.boostPressed = this.boostWasDown
    this.state.tiltActive = this.tiltEnabled && this.tiltAvailable
    this.boostWasDown = false
    return this.state
  }
}
