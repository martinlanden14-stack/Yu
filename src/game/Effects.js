import * as THREE from 'three'
import { clamp, rand } from './utils.js'
import { makeGlowTexture, makeSmokeTexture } from './textures.js'

const particleVertex = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uScale;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(aSize * uScale / max(0.001, -mv.z), 0.0, 190.0);
    gl_Position = projectionMatrix * mv;
  }
`

const particleFragment = /* glsl */ `
  uniform sampler2D uTexture;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 tex = texture2D(uTexture, gl_PointCoord);
    float a = tex.a * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vColor, a);
  }
`

export class Particles {
  constructor(scene, { max = 400, additive = true, texture = null } = {}) {
    this.max = max
    this.scene = scene
    this.particles = []
    this.cursor = 0
    this.scale = 600

    const geometry = new THREE.BufferGeometry()
    this.positions = new Float32Array(max * 3)
    this.colors = new Float32Array(max * 3)
    this.sizes = new Float32Array(max)
    this.alphas = new Float32Array(max)
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3))
    geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1))
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1))
    geometry.setDrawRange(0, max)

    const map = texture || (additive ? makeGlowTexture(64) : makeSmokeTexture(128))
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTexture: { value: map },
        uScale: { value: this.scale },
      },
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    })

    this.points = new THREE.Points(geometry, material)
    this.points.frustumCulled = false
    this.points.renderOrder = additive ? 4 : 3
    scene.add(this.points)
    this.geometry = geometry
    this.material = material
    this.additive = additive
  }

  spawn(options) {
    const {
      x = 0,
      y = 0,
      z = 0,
      vx = 0,
      vy = 0,
      vz = 0,
      life = 1,
      size0 = 0.4,
      size1 = 1.2,
      color = 0xffffff,
      alpha = 1,
      gravity = 0,
      drag = 0,
      fadeIn = 0.06,
      additive = this.additive,
    } = options
    if (this.particles.length < this.max) {
      const particle = {
        x, y, z, vx, vy, vz,
        life, maxLife: life,
        size0, size1,
        color: new THREE.Color(color),
        alpha, gravity, drag, fadeIn, additive,
      }
      this.particles.push(particle)
      return particle
    }
    // recycle the oldest
    const particle = this.particles[this.cursor]
    this.cursor = (this.cursor + 1) % this.max
    Object.assign(particle, {
      x, y, z, vx, vy, vz,
      life, maxLife: life,
      size0, size1,
      alpha, gravity, drag, fadeIn,
    })
    particle.color.set(color)
    return particle
  }

  burst(position, { count = 12, color = 0x4df3ff, speed = 8, size = 0.5, life = 0.7, gravity = -6, spread = 1 } = {}) {
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(rand(-1, 1))
      const s = speed * rand(0.35, 1)
      this.spawn({
        x: position.x + rand(-0.2, 0.2),
        y: position.y + rand(-0.1, 0.3),
        z: position.z + rand(-0.2, 0.2),
        vx: Math.sin(phi) * Math.cos(theta) * s * spread,
        vy: Math.abs(Math.cos(phi)) * s * 0.7,
        vz: Math.sin(phi) * Math.sin(theta) * s * spread,
        life: life * rand(0.6, 1.2),
        size0: size * rand(0.5, 1.1),
        size1: size * 0.15,
        color,
        alpha: 1,
        gravity,
        drag: 1.6,
      })
    }
  }

  smoke(position, { size = 1.2, life = 1.8, color = 0x8d97ad, alpha = 0.34, vx = 0, vy = 0.4, vz = 0, growth = 2.4 } = {}) {
    this.spawn({
      x: position.x + rand(-0.15, 0.15),
      y: position.y + rand(0, 0.25),
      z: position.z + rand(-0.15, 0.15),
      vx: vx + rand(-0.4, 0.4),
      vy: vy + rand(0.1, 0.5),
      vz: vz + rand(-0.4, 0.4),
      life: life * rand(0.75, 1.25),
      size0: size * rand(0.7, 1.2),
      size1: size * growth,
      color,
      alpha,
      gravity: 0.35,
      drag: 1.4,
      fadeIn: 0.12,
    })
  }

  update(dt, camera) {
    const positions = this.positions
    const colors = this.colors
    const sizes = this.sizes
    const alphas = this.alphas
    let alive = 0

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.life -= dt
      if (p.life <= 0) {
        this.particles.splice(i, 1)
        continue
      }
      const drag = Math.exp(-p.drag * dt)
      p.vx *= drag
      p.vz *= drag
      p.vy = p.vy * drag + p.gravity * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt
      if (p.y < 0.03) {
        p.y = 0.03
        p.vy *= -0.25
      }
      alive++
    }

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i]
      const t = 1 - p.life / p.maxLife
      const fade = Math.min(1, t / Math.max(0.001, p.fadeIn))
      positions[i * 3] = p.x
      positions[i * 3 + 1] = p.y
      positions[i * 3 + 2] = p.z
      colors[i * 3] = p.color.r
      colors[i * 3 + 1] = p.color.g
      colors[i * 3 + 2] = p.color.b
      sizes[i] = p.size0 + (p.size1 - p.size0) * t
      alphas[i] = p.alpha * fade * Math.pow(1 - t, p.additive ? 0.7 : 0.45)
    }

    for (let i = this.particles.length; i < this.max; i++) {
      alphas[i] = 0
    }

    if (camera) {
      const scale =
        (this.scene.userData.viewportHeight || 800) /
        (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))
      this.material.uniforms.uScale.value = scale
    }

    this.geometry.attributes.position.needsUpdate = true
    this.geometry.attributes.aColor.needsUpdate = true
    this.geometry.attributes.aSize.needsUpdate = true
    this.geometry.attributes.aAlpha.needsUpdate = true
    this.alive = alive
  }

  clear() {
    this.particles.length = 0
    this.alphas.fill(0)
    this.geometry.attributes.aAlpha.needsUpdate = true
  }
}

const skidVertex = /* glsl */ `
  attribute float aAlpha;
  attribute float aBirth;
  uniform float uTime;
  varying float vAlpha;
  void main() {
    float age = uTime - aBirth;
    vAlpha = aAlpha * clamp(1.0 - age / 16.0, 0.0, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const skidFragment = /* glsl */ `
  varying float vAlpha;
  uniform vec3 uColor;
  void main() {
    if (vAlpha < 0.003) discard;
    gl_FragColor = vec4(uColor, vAlpha);
  }
`

export class SkidMarks {
  constructor(scene, max = 900) {
    this.max = max
    this.cursor = 0
    this.time = 0
    this.last = new Map()

    const geometry = new THREE.BufferGeometry()
    this.positions = new Float32Array(max * 4 * 3)
    this.alphas = new Float32Array(max * 4)
    this.births = new Float32Array(max * 4)
    const indices = new Uint32Array(max * 6)
    for (let i = 0; i < max; i++) {
      const v = i * 4
      indices[i * 6] = v
      indices[i * 6 + 1] = v + 1
      indices[i * 6 + 2] = v + 2
      indices[i * 6 + 3] = v + 1
      indices[i * 6 + 4] = v + 3
      indices[i * 6 + 5] = v + 2
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1))
    geometry.setAttribute('aBirth', new THREE.BufferAttribute(this.births, 1))
    geometry.setIndex(new THREE.BufferAttribute(indices, 1))

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0x05060a) },
      },
      vertexShader: skidVertex,
      fragmentShader: skidFragment,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })

    this.mesh = new THREE.Mesh(geometry, material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 2
    scene.add(this.mesh)
    this.geometry = geometry
    this.material = material
  }

  reset() {
    this.alphas.fill(0)
    this.births.fill(0)
    this.geometry.attributes.aAlpha.needsUpdate = true
    this.geometry.attributes.aBirth.needsUpdate = true
    this.last.clear()
    this.cursor = 0
  }

  add(key, x, z, headingX, headingZ, width = 0.3, strength = 1) {
    const previous = this.last.get(key)
    if (!previous) {
      this.last.set(key, { x, z })
      return
    }
    const dx = x - previous.x
    const dz = z - previous.z
    const distance = Math.hypot(dx, dz)
    if (distance < 0.18) return
    if (distance > 4) {
      previous.x = x
      previous.z = z
      return
    }

    // perpendicular to direction of travel
    const len = Math.max(0.0001, Math.hypot(dx, dz))
    const px = (-dz / len) * width * 0.5
    const pz = (dx / len) * width * 0.5
    const y = 0.018
    const i = this.cursor
    this.cursor = (this.cursor + 1) % this.max
    const v = i * 4
    const p = this.positions
    p[v * 3] = previous.x + px
    p[v * 3 + 1] = y
    p[v * 3 + 2] = previous.z + pz
    p[v * 3 + 3] = previous.x - px
    p[v * 3 + 4] = y
    p[v * 3 + 5] = previous.z - pz
    p[v * 3 + 6] = x + px
    p[v * 3 + 7] = y
    p[v * 3 + 8] = z + pz
    p[v * 3 + 9] = x - px
    p[v * 3 + 10] = y
    p[v * 3 + 11] = z - pz

    const alpha = clamp(0.5 * strength, 0.06, 0.75)
    for (let k = 0; k < 4; k++) {
      this.alphas[v + k] = alpha
      this.births[v + k] = this.time
    }
    this.geometry.attributes.position.needsUpdate = true
    this.geometry.attributes.aAlpha.needsUpdate = true
    this.geometry.attributes.aBirth.needsUpdate = true
    previous.x = x
    previous.z = z
  }

  update(dt) {
    this.time += dt
    this.material.uniforms.uTime.value = this.time
  }
}

export class Rain {
  constructor(scene, count = 900) {
    this.count = count
    this.positions = new Float32Array(count * 2 * 3)
    this.drops = []
    this.area = 80
    this.height = 38
    for (let i = 0; i < count; i++) {
      this.drops.push({
        x: rand(-this.area / 2, this.area / 2),
        y: rand(0, this.height),
        z: rand(-this.area / 2, this.area / 2),
        speed: rand(28, 46),
        len: rand(0.5, 1.4),
      })
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    const material = new THREE.LineBasicMaterial({
      color: 0x9fd6ff,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    })
    this.mesh = new THREE.LineSegments(geometry, material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 5
    scene.add(this.mesh)
    this.geometry = geometry
    this.material = material
  }

  setEnabled(enabled) {
    this.mesh.visible = enabled
  }

  update(dt, camera, speed = 0) {
    if (!this.mesh.visible) return
    const center = camera.position
    const half = this.area / 2
    const wind = -2.5
    for (let i = 0; i < this.count; i++) {
      const drop = this.drops[i]
      drop.y -= drop.speed * dt
      drop.x += wind * dt
      if (drop.y < center.y - 6) {
        drop.y += this.height
        drop.x = center.x + rand(-half, half)
        drop.z = center.z + rand(-half, half)
      }
      // wrap horizontally around the camera
      if (drop.x < center.x - half) drop.x += this.area
      if (drop.x > center.x + half) drop.x -= this.area
      if (drop.z < center.z - half) drop.z += this.area
      if (drop.z > center.z + half) drop.z -= this.area

      const p = this.positions
      const v = i * 6
      const len = drop.len * (1 + speed * 0.02)
      p[v] = drop.x
      p[v + 1] = drop.y
      p[v + 2] = drop.z
      p[v + 3] = drop.x - wind * 0.04
      p[v + 4] = drop.y + len
      p[v + 5] = drop.z
    }
    this.geometry.attributes.position.needsUpdate = true
  }
}
