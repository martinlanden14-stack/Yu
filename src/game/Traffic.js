import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { clamp, rand } from './utils.js'
import { makeBlobShadowTexture, makeGlowTexture } from './textures.js'

const MAX_CARS = 18

function colorize(geometry, color) {
  // RoundedBoxGeometry is non-indexed while CylinderGeometry is indexed;
  // normalise before mergeGeometries() so every part has the same layout.
  const geo = geometry.index ? geometry.toNonIndexed() : geometry
  const count = geo.attributes.position.count
  const array = new Float32Array(count * 3)
  const c = new THREE.Color(color)
  for (let i = 0; i < count; i++) {
    array[i * 3] = c.r
    array[i * 3 + 1] = c.g
    array[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(array, 3))
  return geo
}

function buildCarGeometry() {
  const parts = []
  const tub = new RoundedBoxGeometry(1.78, 0.5, 4.0, 3, 0.12)
  tub.translate(0, 0.6, 0)
  parts.push(colorize(tub, 0xffffff))

  const cabin = new RoundedBoxGeometry(1.5, 0.5, 2.0, 3, 0.12)
  cabin.translate(0, 1.02, 0.12)
  parts.push(colorize(cabin, 0x0a1218))

  const hood = new RoundedBoxGeometry(1.66, 0.14, 1.1, 2, 0.06)
  hood.translate(0, 0.82, 1.42)
  parts.push(colorize(hood, 0xf2f2f2))

  for (const x of [-0.82, 0.82]) {
    for (const z of [-1.32, 1.32]) {
      const wheel = new THREE.CylinderGeometry(0.31, 0.31, 0.22, 14, 1)
      wheel.rotateZ(Math.PI / 2)
      wheel.translate(x, 0.32, z)
      parts.push(colorize(wheel, 0x050506))
    }
  }
  return mergeGeometries(parts)
}

function buildLightGeometry() {
  const parts = []
  for (const x of [-0.55, 0.55]) {
    const head = new THREE.BoxGeometry(0.4, 0.1, 0.06)
    head.translate(x, 0.68, 2.02)
    parts.push(colorize(head, new THREE.Color(3.2, 3.2, 3.0)))

    const tail = new THREE.BoxGeometry(0.36, 0.09, 0.06)
    tail.translate(x, 0.7, -2.02)
    parts.push(colorize(tail, new THREE.Color(3.0, 0.08, 0.16)))
  }
  return mergeGeometries(parts)
}

export class Traffic {
  constructor(scene) {
    this.scene = scene
    this.cars = []
    this.time = 0
    this.nearMissEvent = null
    this.hitEvent = null

    const geometry = buildCarGeometry()
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      metalness: 0.72,
      roughness: 0.34,
      envMapIntensity: 1.5,
    })
    this.mesh = new THREE.InstancedMesh(geometry, material, MAX_CARS)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.frustumCulled = false
    this.mesh.count = 0
    this.scene.add(this.mesh)

    const lightGeo = buildLightGeometry()
    const lightMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      toneMapped: false,
      fog: true,
    })
    this.lightMesh = new THREE.InstancedMesh(lightGeo, lightMat, MAX_CARS)
    this.lightMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.lightMesh.frustumCulled = false
    this.lightMesh.count = 0
    this.scene.add(this.lightMesh)

    // contact shadows
    const shadowGeo = new THREE.PlaneGeometry(2.4, 4.8)
    shadowGeo.rotateX(-Math.PI / 2)
    const shadowMat = new THREE.MeshBasicMaterial({
      map: makeBlobShadowTexture(64),
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      toneMapped: false,
    })
    this.shadowMesh = new THREE.InstancedMesh(shadowGeo, shadowMat, MAX_CARS)
    this.shadowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.shadowMesh.frustumCulled = false
    this.shadowMesh.count = 0
    this.shadowMesh.renderOrder = 1
    this.scene.add(this.shadowMesh)

    // dynamic headlight glows
    const glowGeo = new THREE.BufferGeometry()
    this.glowPositions = new Float32Array(MAX_CARS * 2 * 3)
    this.glowColors = new Float32Array(MAX_CARS * 2 * 3)
    glowGeo.setAttribute('position', new THREE.BufferAttribute(this.glowPositions, 3))
    glowGeo.setAttribute('color', new THREE.BufferAttribute(this.glowColors, 3))
    const glowMat = new THREE.PointsMaterial({
      size: 1.5,
      map: makeGlowTexture(64),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      sizeAttenuation: true,
      toneMapped: false,
      fog: false,
    })
    this.glowPoints = new THREE.Points(glowGeo, glowMat)
    this.glowPoints.frustumCulled = false
    this.glowPoints.renderOrder = 4
    this.scene.add(this.glowPoints)
    this.glowGeometry = glowGeo

    const palette = [
      0xb31f2e, 0x8d939c, 0x1c3f6e, 0x121216, 0xd9a516, 0xe8e8e8, 0x2b5f4a, 0x5a2b6e,
    ]
    this.palette = palette.map((c) => new THREE.Color(c))

    this.dummy = new THREE.Object3D()
    this.dummy.rotation.order = 'YXZ'
  }

  reset(playerPos) {
    this.cars.length = 0
    this.mesh.count = 0
    this.lightMesh.count = 0
    this.shadowMesh.count = 0
    for (let i = 0; i < MAX_CARS; i++) {
      this.spawnCar(playerPos, i)
    }
    this.updateMatrices()
  }

  spawnCar(playerPos, forceIndex = null) {
    const axis = Math.random() > 0.5 ? 'z' : 'x'
    const dir = Math.random() > 0.5 ? 1 : -1
    let x
    let z
    let heading
    // player.pos is a Vector2 where y stores the world Z coordinate.
    const pz = playerPos.y
    if (axis === 'z') {
      const base = Math.round((playerPos.x + rand(-90, 90)) / 80) * 80
      x = base + dir * 4.6
      z = pz + rand(-260, 300)
      if (Math.abs(z - pz) < 55) z = pz + 70 + Math.random() * 120
      heading = dir > 0 ? 0 : Math.PI
    } else {
      const base = Math.round((pz + rand(-90, 90)) / 80) * 80
      z = base + dir * 4.6
      x = playerPos.x + rand(-260, 300)
      if (Math.abs(x - playerPos.x) < 55) x = playerPos.x + 70 + Math.random() * 120
      heading = dir > 0 ? Math.PI / 2 : -Math.PI / 2
    }

    // avoid stacking cars
    for (let attempt = 0; attempt < 6; attempt++) {
      const tooClose = this.cars.some((c) => Math.hypot(c.x - x, c.z - z) < 14)
      if (!tooClose) break
      if (axis === 'z') z += 22 * dir
      else x += 22 * dir
    }

    const car = {
      x,
      z,
      heading,
      speed: rand(8, 17),
      color: this.palette[Math.floor(Math.random() * this.palette.length)],
      nearMissCooldown: 0,
      hitCooldown: 0,
      wobble: Math.random() * Math.PI * 2,
    }
    if (forceIndex !== null && forceIndex < this.cars.length) this.cars[forceIndex] = car
    else this.cars.push(car)
    return car
  }

  update(dt, player, playerSpeed, playerHeading, interact = true) {
    this.time += dt
    this.nearMissEvent = null
    this.hitEvent = null

    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i]
      car.nearMissCooldown = Math.max(0, car.nearMissCooldown - dt)
      car.hitCooldown = Math.max(0, car.hitCooldown - dt)
      car.x += Math.sin(car.heading) * car.speed * dt
      car.z += Math.cos(car.heading) * car.speed * dt

      const dx = car.x - player.pos.x
      const dz = car.z - player.pos.y
      const distance = Math.hypot(dx, dz)

      if (distance > 330) {
        this.spawnCar(player.pos, i)
        continue
      }

      // Menu / countdown / game-over: traffic keeps moving but never touches the car.
      if (!interact) continue

      // player collision
      if (distance < 2.9 && car.hitCooldown <= 0) {
        const nx = dx / (distance || 1)
        const nz = dz / (distance || 1)
        player.pos.x -= nx * (2.9 - distance) * 0.6
        player.pos.y -= nz * (2.9 - distance) * 0.6
        const rel = Math.abs(playerSpeed)
        const strength = clamp(rel / 40, 0.25, 1)
        player.applyTrafficHit(strength, -nx, -nz)
        car.hitCooldown = 1.2
        this.hitEvent = { strength, x: car.x, z: car.z }
      }

      // near miss
      if (
        distance > 2.9 &&
        distance < 7.2 &&
        Math.abs(playerSpeed) > 13 &&
        car.nearMissCooldown <= 0
      ) {
        car.nearMissCooldown = 2.5
        this.nearMissEvent = { x: car.x, z: car.z }
      }
    }

    this.updateMatrices()
  }

  updateMatrices() {
    const dummy = this.dummy
    const count = this.cars.length
    for (let i = 0; i < count; i++) {
      const car = this.cars[i]
      dummy.position.set(car.x, 0, car.z)
      dummy.rotation.set(0, car.heading, 0)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      this.mesh.setMatrixAt(i, dummy.matrix)
      this.lightMesh.setMatrixAt(i, dummy.matrix)
      this.shadowMesh.setMatrixAt(i, dummy.matrix)
      this.mesh.setColorAt(i, car.color)

      const sin = Math.sin(car.heading)
      const cos = Math.cos(car.heading)
      const headX = car.x + sin * 2.05
      const headZ = car.z + cos * 2.05
      const tailX = car.x - sin * 2.05
      const tailZ = car.z - cos * 2.05
      const p = this.glowPositions
      p[i * 6] = headX
      p[i * 6 + 1] = 0.7
      p[i * 6 + 2] = headZ
      p[i * 6 + 3] = tailX
      p[i * 6 + 4] = 0.72
      p[i * 6 + 5] = tailZ
      const c = this.glowColors
      c[i * 6] = 1.6
      c[i * 6 + 1] = 1.8
      c[i * 6 + 2] = 2.0
      c[i * 6 + 3] = 1.8
      c[i * 6 + 4] = 0.05
      c[i * 6 + 5] = 0.12
    }

    this.mesh.count = count
    this.lightMesh.count = count
    this.shadowMesh.count = count
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
    this.lightMesh.instanceMatrix.needsUpdate = true
    this.shadowMesh.instanceMatrix.needsUpdate = true
    this.glowGeometry.setDrawRange(0, count * 2)
    this.glowGeometry.attributes.position.needsUpdate = true
    this.glowGeometry.attributes.color.needsUpdate = true
  }
}
