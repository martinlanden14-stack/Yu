import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { clamp, damp } from './utils.js'
import { makeBlobShadowTexture, makeGlowTexture } from './textures.js'

const MAX_SPEED = 63
const BOOST_SPEED = 79
const WHEEL_RADIUS = 0.34

const _forward = new THREE.Vector2()
const _right = new THREE.Vector2()
const _tmp = new THREE.Vector3()

function makeWheel(materials, side) {
  const group = new THREE.Group()
  const spin = new THREE.Group()
  group.add(spin)

  const tire = new THREE.Mesh(
    new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.27, 30, 1),
    materials.rubber,
  )
  tire.rotation.z = Math.PI / 2
  spin.add(tire)

  // subtle sidewall ring
  const wall = new THREE.Mesh(
    new THREE.TorusGeometry(WHEEL_RADIUS - 0.035, 0.035, 6, 26),
    materials.rubber,
  )
  wall.rotation.y = Math.PI / 2
  wall.position.x = side * 0.135
  spin.add(wall)

  const rimBarrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.225, 0.225, 0.28, 24, 1),
    materials.rimDark,
  )
  rimBarrel.rotation.z = Math.PI / 2
  spin.add(rimBarrel)

  const rimFace = new THREE.Mesh(
    new THREE.CylinderGeometry(0.222, 0.222, 0.035, 24, 1),
    materials.rim,
  )
  rimFace.rotation.z = Math.PI / 2
  rimFace.position.x = side * 0.145
  spin.add(rimFace)

  // five spokes
  for (let i = 0; i < 5; i++) {
    const spoke = new THREE.Mesh(
      new THREE.BoxGeometry(0.045, 0.35, 0.05),
      materials.rim,
    )
    spoke.position.set(side * 0.16, 0.17, 0)
    const holder = new THREE.Group()
    holder.rotation.x = (i / 5) * Math.PI * 2
    holder.add(spoke)
    spin.add(holder)
  }

  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.065, 0.065, 0.34, 12),
    materials.rim,
  )
  hub.rotation.z = Math.PI / 2
  spin.add(hub)

  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.19, 0.19, 0.025, 22),
    materials.disc,
  )
  disc.rotation.z = Math.PI / 2
  disc.position.x = -side * 0.02
  spin.add(disc)

  const caliper = new THREE.Mesh(
    new THREE.BoxGeometry(0.055, 0.12, 0.16),
    materials.caliper,
  )
  caliper.position.set(side * 0.02, 0.13, 0.1)
  group.add(caliper)

  return { group, spin }
}

export class PlayerCar {
  constructor(scene) {
    this.scene = scene
    this.root = new THREE.Group()
    this.bodyPivot = new THREE.Group()
    this.root.add(this.bodyPivot)
    scene.add(this.root)

    this.pos = new THREE.Vector2(0, 0)
    this.vel = new THREE.Vector2(0, 0)
    this.heading = 0
    this.yawRate = 0
    this.slip = 0
    this.driftIntensity = 0
    this.speed = 0
    this.forwardSpeed = 0
    this.steerVisual = 0
    this.wheelSpin = 0
    this.time = 0
    this.shake = 0
    this.impactCooldown = 0
    this.pendingImpact = 0
    this.rumble = 0
    this.offRoad = false
    this.boostFlame = 0
    this.braking = false
    this.boosting = false
    this.lastForwardSpeed = 0
    this.accel = 0
    this.tiltRoll = 0
    this.tiltPitch = 0
    this.rearWheelWorld = [new THREE.Vector3(), new THREE.Vector3()]
    this.frontWheelWorld = [new THREE.Vector3(), new THREE.Vector3()]

    this.buildModel()
    this.reset(0, 0, 0)
  }

  buildModel() {
    const paint = new THREE.MeshPhysicalMaterial({
      color: 0xe4f2f6,
      metalness: 0.55,
      roughness: 0.2,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      envMapIntensity: 1.8,
    })
    const stripe = new THREE.MeshPhysicalMaterial({
      color: 0x0a2b36,
      metalness: 0.7,
      roughness: 0.24,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      envMapIntensity: 1.5,
    })
    const carbon = new THREE.MeshStandardMaterial({
      color: 0x0a0c12,
      metalness: 0.62,
      roughness: 0.38,
      envMapIntensity: 1.2,
    })
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0x07161f,
      metalness: 0.92,
      roughness: 0.04,
      transparent: true,
      opacity: 0.9,
      envMapIntensity: 2.2,
    })
    const rubber = new THREE.MeshStandardMaterial({
      color: 0x090a0c,
      metalness: 0.05,
      roughness: 0.95,
    })
    const rim = new THREE.MeshStandardMaterial({
      color: 0x9fb2c4,
      metalness: 1,
      roughness: 0.22,
      envMapIntensity: 1.6,
    })
    const rimDark = new THREE.MeshStandardMaterial({
      color: 0x14181f,
      metalness: 0.85,
      roughness: 0.35,
    })
    const disc = new THREE.MeshStandardMaterial({
      color: 0x3a3f48,
      metalness: 0.9,
      roughness: 0.4,
    })
    const caliper = new THREE.MeshStandardMaterial({
      color: 0xff6a1a,
      metalness: 0.6,
      roughness: 0.35,
      emissive: 0x2a0a00,
    })
    const headlight = new THREE.MeshBasicMaterial({
      color: 0xe6fbff,
      toneMapped: false,
    })
    const accent = new THREE.MeshBasicMaterial({
      color: 0x3ff0ff,
      toneMapped: false,
    })
    const tail = new THREE.MeshStandardMaterial({
      color: 0x2a0208,
      emissive: 0xff1338,
      emissiveIntensity: 2.2,
      roughness: 0.35,
      metalness: 0.2,
      toneMapped: false,
    })
    this.tailMaterial = tail
    this.materials = { paint, stripe, carbon, glass, rubber, rim, rimDark, disc, caliper, headlight, accent, tail }

    const body = this.bodyPivot

    // main tub
    const tub = new THREE.Mesh(new RoundedBoxGeometry(1.9, 0.5, 4.3, 5, 0.18), paint)
    tub.position.set(0, 0.58, 0)
    body.add(tub)

    // lower carbon skirt
    const skirt = new THREE.Mesh(new RoundedBoxGeometry(1.82, 0.26, 4.1, 3, 0.1), carbon)
    skirt.position.set(0, 0.36, 0)
    body.add(skirt)

    // long hood
    const hood = new THREE.Mesh(new RoundedBoxGeometry(1.72, 0.18, 1.35, 4, 0.09), paint)
    hood.position.set(0, 0.78, 1.42)
    hood.rotation.x = -0.055
    body.add(hood)

    // nose wedge
    const nose = new THREE.Mesh(new RoundedBoxGeometry(1.66, 0.2, 0.72, 4, 0.09), paint)
    nose.position.set(0, 0.62, 1.95)
    nose.rotation.x = -0.16
    body.add(nose)

    // cabin / greenhouse (extruded side profile)
    const shape = new THREE.Shape()
    shape.moveTo(-1.18, 0)
    shape.lineTo(-1.04, 0.4)
    shape.quadraticCurveTo(-0.94, 0.52, -0.6, 0.54)
    shape.lineTo(0.28, 0.52)
    shape.quadraticCurveTo(0.7, 0.44, 1.0, 0)
    shape.lineTo(-1.18, 0)
    const cabinGeo = new THREE.ExtrudeGeometry(shape, {
      depth: 1.36,
      bevelEnabled: true,
      bevelSegments: 3,
      bevelSize: 0.12,
      bevelThickness: 0.12,
      curveSegments: 8,
    })
    cabinGeo.rotateY(-Math.PI / 2)
    cabinGeo.translate(0.68, 0, 0)
    const cabin = new THREE.Mesh(cabinGeo, glass)
    cabin.position.set(0, 0.8, 0.1)
    body.add(cabin)

    // roof panel
    const roof = new THREE.Mesh(new RoundedBoxGeometry(1.15, 0.06, 1.28, 3, 0.04), paint)
    roof.position.set(0, 1.335, 0.05)
    body.add(roof)

    // racing stripe over roof and hood
    const roofStripe = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.02, 1.2), stripe)
    roofStripe.position.set(0, 1.372, 0.05)
    body.add(roofStripe)
    const hoodStripe = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.02, 1.25), stripe)
    hoodStripe.position.set(0, 0.885, 1.42)
    hoodStripe.rotation.x = -0.055
    body.add(hoodStripe)

    // rear deck
    const deck = new THREE.Mesh(new RoundedBoxGeometry(1.8, 0.16, 1.0, 4, 0.08), paint)
    deck.position.set(0, 0.8, -1.68)
    body.add(deck)

    // side skirts
    for (const side of [-1, 1]) {
      const sideSkirt = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.16, 2.9, 3, 0.04), carbon)
      sideSkirt.position.set(side * 0.94, 0.34, 0)
      body.add(sideSkirt)

      // neon side accent
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.035, 2.6), accent)
      line.position.set(side * 0.955, 0.44, -0.05)
      body.add(line)

      // mirrors
      const mirrorStalk = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.035, 0.06), carbon)
      mirrorStalk.position.set(side * 1.01, 1.02, 0.62)
      body.add(mirrorStalk)
      const mirror = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.09, 0.14, 3, 0.03), paint)
      mirror.position.set(side * 1.12, 1.05, 0.64)
      body.add(mirror)
    }

    // front splitter + canards
    const splitter = new THREE.Mesh(new RoundedBoxGeometry(1.98, 0.07, 0.62, 3, 0.03), carbon)
    splitter.position.set(0, 0.26, 2.05)
    body.add(splitter)
    for (const side of [-1, 1]) {
      const canard = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.28), carbon)
      canard.position.set(side * 0.86, 0.4, 2.0)
      canard.rotation.z = side * -0.18
      body.add(canard)
    }

    // rear diffuser
    const diffuser = new THREE.Mesh(new RoundedBoxGeometry(1.82, 0.18, 0.5, 3, 0.04), carbon)
    diffuser.position.set(0, 0.32, -2.08)
    body.add(diffuser)

    // rear wing
    for (const side of [-1, 1]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.34, 0.12), carbon)
      strut.position.set(side * 0.58, 0.98, -1.88)
      strut.rotation.x = 0.15
      body.add(strut)
    }
    const wing = new THREE.Mesh(new RoundedBoxGeometry(1.92, 0.055, 0.46, 3, 0.025), carbon)
    wing.position.set(0, 1.16, -1.92)
    wing.rotation.x = 0.14
    body.add(wing)
    for (const side of [-1, 1]) {
      const endplate = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.22, 0.46), carbon)
      endplate.position.set(side * 0.95, 1.1, -1.92)
      body.add(endplate)
    }

    // headlights
    for (const side of [-1, 1]) {
      const housing = new THREE.Mesh(new RoundedBoxGeometry(0.56, 0.12, 0.12, 3, 0.04), carbon)
      housing.position.set(side * 0.55, 0.72, 2.04)
      housing.rotation.y = side * -0.16
      body.add(housing)
      const lens = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.055, 0.06), headlight)
      lens.position.set(side * 0.55, 0.725, 2.105)
      lens.rotation.y = side * -0.16
      body.add(lens)
    }

    // full-width tail bar
    const tailBar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.075, 0.05), tail)
    tailBar.position.set(0, 0.79, -2.165)
    body.add(tailBar)
    for (const side of [-1, 1]) {
      const tailFin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.04), tail)
      tailFin.position.set(side * 0.72, 0.75, -2.16)
      body.add(tailFin)
    }

    // exhausts
    for (const side of [-1, 1]) {
      const pipe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.075, 0.085, 0.18, 12, 1, true),
        new THREE.MeshStandardMaterial({
          color: 0x4a4f58,
          metalness: 1,
          roughness: 0.25,
          side: THREE.DoubleSide,
        }),
      )
      pipe.rotation.x = Math.PI / 2
      pipe.position.set(side * 0.42, 0.42, -2.16)
      body.add(pipe)
    }

    // boost flames
    this.flames = []
    for (const side of [-1, 1]) {
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.09, 0.55, 10, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0x65d9ff,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      )
      flame.rotation.x = -Math.PI / 2
      flame.position.set(side * 0.42, 0.42, -2.42)
      body.add(flame)
      this.flames.push(flame)
    }

    // underglow
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 5.8),
      new THREE.MeshBasicMaterial({
        map: makeGlowTexture(128),
        color: 0x25d9ff,
        transparent: true,
        opacity: 0.28,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    )
    glow.rotation.x = -Math.PI / 2
    glow.position.y = 0.04
    glow.renderOrder = 3
    this.root.add(glow)
    this.underglow = glow

    // contact shadow
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(4.6, 6.1),
      new THREE.MeshBasicMaterial({
        map: makeBlobShadowTexture(128),
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        toneMapped: false,
      }),
    )
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = 0.032
    shadow.renderOrder = 1
    this.root.add(shadow)
    this.shadow = shadow

    // headlight beam
    this.headlight = new THREE.SpotLight(0xd6f4ff, 180, 78, 0.62, 0.85, 1.6)
    this.headlight.position.set(0, 0.78, 1.9)
    this.headlightTarget = new THREE.Object3D()
    this.headlightTarget.position.set(0, 0.05, 34)
    body.add(this.headlight)
    body.add(this.headlightTarget)
    this.headlight.target = this.headlightTarget

    // neon underlight
    this.underLight = new THREE.PointLight(0x22d8ff, 10, 8, 2)
    this.underLight.position.set(0, 0.2, 0)
    this.root.add(this.underLight)

    // wheels
    const wheelMaterials = { rubber, rim, rimDark, disc, caliper }
    this.wheels = []
    const positions = [
      { x: 0.9, z: 1.42, front: true },
      { x: -0.9, z: 1.42, front: true },
      { x: 0.9, z: -1.42, front: false },
      { x: -0.9, z: -1.42, front: false },
    ]
    for (const spec of positions) {
      const side = Math.sign(spec.x)
      const { group, spin } = makeWheel(wheelMaterials, side)
      const steerPivot = new THREE.Group()
      steerPivot.position.set(spec.x, WHEEL_RADIUS, spec.z)
      steerPivot.add(group)
      this.root.add(steerPivot)
      this.wheels.push({ steerPivot, spin, front: spec.front, side })
    }

    // small glow sprites at the headlights (visible from the front)
    for (const side of [-1, 1]) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: makeGlowTexture(64),
          color: 0xdff8ff,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      )
      sprite.scale.set(1.4, 1.4, 1)
      sprite.position.set(side * 0.55, 0.73, 2.18)
      body.add(sprite)
    }
  }

  reset(x, z, heading = 0) {
    this.pos.set(x, z)
    this.vel.set(0, 0)
    this.heading = heading
    this.yawRate = 0
    this.slip = 0
    this.driftIntensity = 0
    this.speed = 0
    this.forwardSpeed = 0
    this.steerVisual = 0
    this.wheelSpin = 0
    this.shake = 0
    this.pendingImpact = 0
    this.impactCooldown = 0
    this.boosting = false
    this.boostFlame = 0
    this.tiltRoll = 0
    this.tiltPitch = 0
    this.root.position.set(x, 0, z)
    this.root.rotation.set(0, heading, 0)
    this.bodyPivot.rotation.set(0, 0, 0)
    this.bodyPivot.position.set(0, 0, 0)
    this.tailMaterial.emissiveIntensity = 2.2
    this.underglow.material.opacity = 0.28
    this.headlight.intensity = 180
    this.flames.forEach((flame) => (flame.material.opacity = 0))
    this.updateWheelWorld()
  }

  step(h, input, city) {
    const forward = _forward.set(Math.sin(this.heading), Math.cos(this.heading))
    const right = _right.set(Math.cos(this.heading), -Math.sin(this.heading))

    let vf = this.vel.dot(forward)
    let vl = this.vel.dot(right)

    const boost = input.boost
    const maxSpeed = boost ? BOOST_SPEED : MAX_SPEED
    const throttle = input.throttle
    const brake = input.brake

    if (throttle > 0) {
      const rate = boost ? 1.35 : 0.66
      vf += (maxSpeed - vf) * rate * throttle * h
    }
    if (brake > 0) {
      if (vf > 0.4) {
        vf = Math.max(0, vf - 36 * brake * h)
      } else {
        vf = Math.max(-11, vf - 13 * brake * h)
      }
    }
    if (throttle <= 0 && brake <= 0) {
      vf *= Math.exp(-0.42 * h)
    }

    // steering authority falls away at very high speed
    const absVf = Math.abs(vf)
    const authority =
      clamp(absVf / 4.5, 0, 1) * (1 - 0.48 * clamp(absVf / 82, 0, 1))
    const driftMul = input.handbrake ? 1.42 : 1
    const yawRate = input.steer * 2.2 * authority * driftMul
    this.yawRate = yawRate

    // Lateral grip: handbrake lets the rear step out.
    let grip = input.handbrake ? 1.35 : 9.4
    grip += clamp(1 - absVf / 6, 0, 1) * 6
    const vlNew = vl * Math.exp(-grip * h)
    const removed = vl - vlNew
    vf += Math.abs(removed) * 0.12
    vl = vlNew

    if (input.handbrake) vf *= Math.exp(-0.42 * h)
    vf = clamp(vf, -12, maxSpeed + 2)

    // off-road penalty
    const onRoad = city.isOnRoad(this.pos.x, this.pos.y)
    this.offRoad = !onRoad && Math.abs(vf) > 2
    if (!onRoad) vf *= Math.exp(-0.85 * h)

    // recompose velocity in the current heading frame, then rotate the car
    this.vel.set(forward.x * vf + right.x * vl, forward.y * vf + right.y * vl)
    this.heading += yawRate * h

    this.pos.x += this.vel.x * h
    this.pos.y += this.vel.y * h

    // building collision
    const hit = city.collide(this.pos.x, this.pos.y, 1.02)
    if (hit) {
      this.pos.x += hit.nx * (hit.depth + 0.03)
      this.pos.y += hit.nz * (hit.depth + 0.03)
      const vn = this.vel.x * hit.nx + this.vel.y * hit.nz
      if (vn < 0) {
        this.vel.x -= hit.nx * vn * 1.25
        this.vel.y -= hit.nz * vn * 1.25
      }
      const strength = clamp(-vn / 24, 0.2, 1)
      this.vel.multiplyScalar(0.55)
      if (this.impactCooldown <= 0) {
        this.impactCooldown = 0.4
        this.pendingImpact = strength
        this.shake = Math.max(this.shake, strength)
        this.impactFlash = strength
      }
    }

    this.speed = this.vel.length()
    this.forwardSpeed = vf
    this.slip = Math.atan2(vl, Math.max(1.2, Math.abs(vf)))
    const drift =
      this.speed > 7
        ? clamp((Math.abs(this.slip) - 0.1) / 0.55, 0, 1) *
          clamp(this.speed / 18, 0, 1)
        : 0
    this.driftIntensity = drift
    this.boosting = boost && this.speed > 1
  }

  update(dt, input, city, effects) {
    this.time += dt
    const steps = Math.min(5, Math.max(1, Math.ceil(dt / 0.016)))
    const h = dt / steps
    for (let i = 0; i < steps; i++) this.step(h, input, city)
    this.impactCooldown = Math.max(0, this.impactCooldown - dt)
    this.shake = damp(this.shake, 0, 5, dt)
    this.rumble = this.offRoad ? 1 : 0

    // ----- visual transform -----
    this.root.position.set(this.pos.x, 0, this.pos.y)
    this.root.rotation.y = this.heading

    this.accel = damp(this.accel, (this.forwardSpeed - this.lastForwardSpeed) / Math.max(0.001, dt), 8, dt)
    this.lastForwardSpeed = this.forwardSpeed

    const speedNorm = clamp(this.speed / MAX_SPEED, 0, 1.3)
    const targetRoll = clamp(this.yawRate * this.speed * 0.0017, -0.085, 0.085)
    const targetPitch = clamp(-this.accel * 0.0022, -0.045, 0.06)
    this.tiltRoll = damp(this.tiltRoll, targetRoll, 6, dt)
    this.tiltPitch = damp(this.tiltPitch, targetPitch, 7, dt)
    this.bodyPivot.rotation.z = this.tiltRoll
    this.bodyPivot.rotation.x = this.tiltPitch
    this.bodyPivot.position.y =
      0.012 * Math.sin(this.time * 11 + this.speed * 0.18) * speedNorm +
      0.006 * Math.sin(this.time * 31) * speedNorm

    // wheels
    this.wheelSpin += (this.forwardSpeed / WHEEL_RADIUS) * dt
    const steerTarget = input.steer * 0.52
    this.steerVisual = damp(this.steerVisual, steerTarget, 10, dt)
    for (const wheel of this.wheels) {
      wheel.spin.rotation.x = this.wheelSpin
      if (wheel.front) wheel.steerPivot.rotation.y = this.steerVisual
    }

    // lights
    this.braking = input.brake > 0.1 || input.handbrake
    this.tailMaterial.emissiveIntensity = damp(
      this.tailMaterial.emissiveIntensity,
      this.braking ? 7 : 2.2,
      14,
      dt,
    )
    this.underglow.material.opacity = 0.24 + (this.boosting ? 0.2 : 0) + this.driftIntensity * 0.1
    this.headlight.intensity = 180 + (this.boosting ? 40 : 0)
    this.underLight.intensity = 10 + this.driftIntensity * 8

    this.boostFlame = damp(this.boostFlame, this.boosting ? 1 : 0, 12, dt)
    for (const flame of this.flames) {
      flame.material.opacity = this.boostFlame * (0.65 + Math.random() * 0.3)
      const s = 0.75 + this.boostFlame * (0.4 + Math.random() * 0.35)
      flame.scale.set(s, s, 0.6 + this.boostFlame * 0.9)
    }

    this.updateWheelWorld()

    // effects
    if (effects) {
      if (this.driftIntensity > 0.12) {
        const count = Math.random() < this.driftIntensity ? 2 : 1
        for (let i = 0; i < count; i++) {
          const wheel = this.rearWheelWorld[i % 2]
          effects.smoke.spawn({
            x: wheel.x,
            y: 0.16,
            z: wheel.z,
            vx: -this.vel.x * 0.12 + (Math.random() - 0.5) * 1.4,
            vy: 0.4 + Math.random() * 0.5,
            vz: -this.vel.y * 0.12 + (Math.random() - 0.5) * 1.4,
            life: 1.2 + Math.random() * 0.9,
            size0: 0.5 + this.driftIntensity * 0.4,
            size1: 2.4 + this.driftIntensity * 1.6,
            color: 0xa8b4c8,
            alpha: 0.16 + this.driftIntensity * 0.18,
            gravity: 0.2,
            drag: 1.1,
            fadeIn: 0.12,
          })
        }
        effects.skids.add(
          'rl',
          this.rearWheelWorld[0].x,
          this.rearWheelWorld[0].z,
          0,
          0,
          0.34,
          this.driftIntensity,
        )
        effects.skids.add(
          'rr',
          this.rearWheelWorld[1].x,
          this.rearWheelWorld[1].z,
          0,
          0,
          0.34,
          this.driftIntensity,
        )
      } else {
        effects.skids.last.delete('rl')
        effects.skids.last.delete('rr')
      }

      if (this.boosting) {
        const back = _tmp.set(
          -Math.sin(this.heading) * 2.6,
          0.45,
          -Math.cos(this.heading) * 2.6,
        )
        effects.sparks.spawn({
          x: this.pos.x + back.x + (Math.random() - 0.5) * 0.5,
          y: back.y,
          z: this.pos.y + back.z + (Math.random() - 0.5) * 0.5,
          vx: -this.vel.x * 0.25 + (Math.random() - 0.5) * 1.5,
          vy: 0.2,
          vz: -this.vel.y * 0.25 + (Math.random() - 0.5) * 1.5,
          life: 0.35,
          size0: 0.7,
          size1: 0.1,
          color: Math.random() > 0.4 ? 0x6fe6ff : 0xff8a2b,
          alpha: 1,
          gravity: 0,
          drag: 3,
        })
      }
    }
  }

  updateWheelWorld() {
    const sin = Math.sin(this.heading)
    const cos = Math.cos(this.heading)
    const rear = [
      [-0.9, -1.42],
      [0.9, -1.42],
    ]
    const front = [
      [-0.9, 1.42],
      [0.9, 1.42],
    ]
    for (let i = 0; i < 2; i++) {
      const [lx, lz] = rear[i]
      this.rearWheelWorld[i].set(
        this.pos.x + lx * cos + lz * sin,
        0.02,
        this.pos.y - lx * sin + lz * cos,
      )
      const [fx, fz] = front[i]
      this.frontWheelWorld[i].set(
        this.pos.x + fx * cos + fz * sin,
        0.02,
        this.pos.y - fx * sin + fz * cos,
      )
    }
  }

  applyTrafficHit(strength, nx, nz) {
    this.vel.x += nx * strength * 6
    this.vel.y += nz * strength * 6
    this.vel.multiplyScalar(0.72)
    this.pendingImpact = Math.max(this.pendingImpact, strength)
    this.shake = Math.max(this.shake, strength * 1.1)
    this.impactFlash = Math.max(this.impactFlash || 0, strength)
  }

  get speedKmh() {
    return Math.abs(this.forwardSpeed) * 3.6
  }

  get gear() {
    if (this.forwardSpeed < -0.5) return 'R'
    if (this.speed < 0.6) return 'N'
    const kmh = this.speedKmh
    if (kmh < 28) return '1'
    if (kmh < 58) return '2'
    if (kmh < 92) return '3'
    if (kmh < 128) return '4'
    if (kmh < 170) return '5'
    return '6'
  }
}
