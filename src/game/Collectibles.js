import * as THREE from 'three'
import { makeGlowTexture } from './textures.js'

const COUNT = 16

export class Collectibles {
  constructor(scene, city) {
    this.scene = scene
    this.city = city
    this.time = 0
    this.orbs = []
    this.collected = null

    const coreGeo = new THREE.IcosahedronGeometry(0.5, 0)
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xa8fdff,
      toneMapped: false,
      transparent: true,
      opacity: 0.95,
    })
    this.coreMesh = new THREE.InstancedMesh(coreGeo, coreMat, COUNT)
    this.coreMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.coreMesh.frustumCulled = false
    this.coreMesh.count = COUNT
    this.scene.add(this.coreMesh)

    const shellGeo = new THREE.IcosahedronGeometry(0.86, 0)
    const shellMat = new THREE.MeshBasicMaterial({
      color: 0xff4fc8,
      wireframe: true,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
    this.shellMesh = new THREE.InstancedMesh(shellGeo, shellMat, COUNT)
    this.shellMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.shellMesh.frustumCulled = false
    this.shellMesh.count = COUNT
    this.scene.add(this.shellMesh)

    const glowGeo = new THREE.BufferGeometry()
    this.glowPositions = new Float32Array(COUNT * 3)
    this.glowColors = new Float32Array(COUNT * 3)
    glowGeo.setAttribute('position', new THREE.BufferAttribute(this.glowPositions, 3))
    glowGeo.setAttribute('color', new THREE.BufferAttribute(this.glowColors, 3))
    const glowMat = new THREE.PointsMaterial({
      size: 3.4,
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

    this.dummy = new THREE.Object3D()
  }

  reset(playerPos) {
    this.orbs.length = 0
    this.collected = null
    for (let i = 0; i < COUNT; i++) {
      this.orbs.push(this.makeOrb(playerPos, i))
    }
    this.updateMatrices()
  }

  makeOrb(playerPos, index = 0) {
    const angle = Math.random() * Math.PI * 2
    const distance = 55 + Math.random() * 230
    const x = playerPos.x + Math.cos(angle) * distance
    const z = playerPos.y + Math.sin(angle) * distance
    const road = this.city.nearestRoad(x, z)
    return {
      x: road.x,
      z: road.z,
      phase: Math.random() * Math.PI * 2,
      index,
      active: true,
    }
  }

  updateMatrices() {
    const dummy = this.dummy

    for (let i = 0; i < this.orbs.length; i++) {
      const orb = this.orbs[i]
      const bob = 1.15 + Math.sin(this.time * 2.2 + orb.phase) * 0.28
      const spin = this.time * 1.6 + orb.phase
      dummy.position.set(orb.x, bob, orb.z)
      dummy.rotation.set(spin * 0.7, spin, spin * 0.4)
      dummy.scale.setScalar(1)
      dummy.updateMatrix()
      this.coreMesh.setMatrixAt(i, dummy.matrix)

      dummy.rotation.set(-spin * 0.4, -spin * 0.8, spin * 0.2)
      dummy.scale.setScalar(1 + Math.sin(this.time * 3 + orb.phase) * 0.08)
      dummy.updateMatrix()
      this.shellMesh.setMatrixAt(i, dummy.matrix)

      this.glowPositions[i * 3] = orb.x
      this.glowPositions[i * 3 + 1] = bob
      this.glowPositions[i * 3 + 2] = orb.z
      this.glowColors[i * 3] = 0.55
      this.glowColors[i * 3 + 1] = 2.0
      this.glowColors[i * 3 + 2] = 2.2
    }

    this.coreMesh.count = this.orbs.length
    this.shellMesh.count = this.orbs.length
    this.coreMesh.instanceMatrix.needsUpdate = true
    this.shellMesh.instanceMatrix.needsUpdate = true
    this.glowGeometry.setDrawRange(0, this.orbs.length)
    this.glowGeometry.attributes.position.needsUpdate = true
    this.glowGeometry.attributes.color.needsUpdate = true
  }

  update(dt, player) {
    this.time += dt
    this.collected = null

    for (let i = 0; i < this.orbs.length; i++) {
      const orb = this.orbs[i]
      const dx = player.pos.x - orb.x
      const dz = player.pos.y - orb.z
      if (dx * dx + dz * dz < 4.6 * 4.6) {
        this.collected = { x: orb.x, z: orb.z }
        this.orbs[i] = this.makeOrb(player.pos, i)
      }
    }

    this.updateMatrices()
  }
}
