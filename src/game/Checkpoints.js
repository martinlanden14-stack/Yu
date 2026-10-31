import * as THREE from 'three'
import { makeBeamTexture, makeChevronTexture, makeGlowTexture } from './textures.js'

const CELL = 80

export class Checkpoints {
  constructor(scene, city) {
    this.scene = scene
    this.city = city
    this.time = 0
    this.target = null
    this.collected = false

    this.group = new THREE.Group()
    this.scene.add(this.group)

    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x4df3ff,
      toneMapped: false,
    })
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(7, 0.3, 12, 72), ringMat)
    this.group.add(this.ring)

    const innerMat = new THREE.MeshBasicMaterial({
      color: 0xff2fb3,
      toneMapped: false,
    })
    this.innerRing = new THREE.Mesh(new THREE.TorusGeometry(5.7, 0.09, 8, 64), innerMat)
    this.group.add(this.innerRing)

    const discMat = new THREE.MeshBasicMaterial({
      color: 0x2fe6ff,
      transparent: true,
      opacity: 0.055,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(6.7, 48), discMat)
    this.group.add(this.disc)

    const beamMat = new THREE.MeshBasicMaterial({
      map: makeBeamTexture(),
      color: 0x3fe6ff,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 90, 12, 1, true), beamMat)
    this.beam.position.y = 45
    this.group.add(this.beam)

    const chevron = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeChevronTexture(),
        color: 0xb8fbff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    )
    chevron.scale.set(6.5, 6.5, 1)
    chevron.position.y = 17
    this.chevron = chevron
    this.group.add(chevron)

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeGlowTexture(128),
        color: 0x2fe6ff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    )
    glow.scale.set(26, 26, 1)
    this.glowSprite = glow
    this.group.add(glow)

    this.group.visible = false
  }

  spawn(playerPos, playerHeading) {
    const forwardX = Math.sin(playerHeading)
    const forwardZ = Math.cos(playerHeading)
    const startZ = playerPos.y
    let best = null

    for (let attempt = 0; attempt < 24; attempt++) {
      const angle = playerHeading + (Math.random() - 0.5) * 2.0
      const distance = 240 + Math.random() * 190
      const px = playerPos.x + Math.sin(angle) * distance
      const pz = startZ + Math.cos(angle) * distance
      const ix = Math.round(px / CELL) * CELL
      const iz = Math.round(pz / CELL) * CELL
      const dx = ix - playerPos.x
      const dz = iz - startZ
      const dist = Math.hypot(dx, dz)
      const dot = (dx * forwardX + dz * forwardZ) / (dist || 1)
      if (dist < 190 || dist > 470) continue
      if (dot < 0.15) continue
      best = { x: ix, z: iz, dx, dz }
      break
    }

    if (!best) {
      const angle = playerHeading + (Math.random() - 0.5) * 1.2
      const distance = 300
      best = {
        x: Math.round((playerPos.x + Math.sin(angle) * distance) / CELL) * CELL,
        z: Math.round((startZ + Math.cos(angle) * distance) / CELL) * CELL,
        dx: Math.sin(angle),
        dz: Math.cos(angle),
      }
    }

    this.target = { x: best.x, z: best.z }
    this.group.position.set(best.x, 7.2, best.z)
    this.group.rotation.set(0, Math.abs(best.dx) > Math.abs(best.dz) ? Math.PI / 2 : 0, 0)
    this.group.visible = true
    this.collected = false
    this.spawnTime = this.time
    this.pulse = 0
  }

  reset(playerPos, playerHeading) {
    this.spawn(playerPos, playerHeading)
  }

  update(dt, player) {
    this.time += dt
    this.collected = false
    if (!this.target) return

    const dx = player.pos.x - this.target.x
    const dz = player.pos.y - this.target.z
    const distance = Math.hypot(dx, dz)
    this.distance = distance

    // gentle float + pulse
    this.group.position.y = 7.2 + Math.sin(this.time * 1.6) * 0.25
    const pulse = 1 + Math.sin(this.time * 2.6) * 0.025 + this.pulse * 0.2
    this.ring.scale.setScalar(pulse)
    this.innerRing.rotation.z = this.time * 0.5
    this.chevron.position.y = 17 + Math.sin(this.time * 2.2) * 0.7
    this.disc.material.opacity = 0.045 + Math.sin(this.time * 2.2) * 0.018
    this.glowSprite.scale.setScalar(25 + Math.sin(this.time * 2.4) * 2.5)
    this.pulse = Math.max(0, this.pulse - dt * 2)

    if (distance < 9.5) {
      this.collected = true
      this.target = null
      this.group.visible = false
    }
  }
}
