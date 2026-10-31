import * as THREE from 'three'

function canvas2d(width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  return { canvas, ctx }
}

function finish(canvas, { srgb = true } = {}) {
  const texture = new THREE.CanvasTexture(canvas)
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  texture.needsUpdate = true
  return texture
}

/** Soft radial glow, white on transparent. */
export function makeGlowTexture(size = 128) {
  const { canvas, ctx } = canvas2d(size, size)
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.16, 'rgba(255,255,255,0.9)')
  g.addColorStop(0.38, 'rgba(255,255,255,0.32)')
  g.addColorStop(0.7, 'rgba(255,255,255,0.06)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  return finish(canvas)
}

/** Soft cloud for tyre smoke, white on transparent. */
export function makeSmokeTexture(size = 128) {
  const { canvas, ctx } = canvas2d(size, size)
  ctx.clearRect(0, 0, size, size)
  const blobs = [
    [0.5, 0.5, 0.42, 0.55],
    [0.34, 0.44, 0.26, 0.4],
    [0.66, 0.4, 0.28, 0.38],
    [0.48, 0.68, 0.3, 0.32],
    [0.68, 0.66, 0.2, 0.26],
  ]
  for (const [x, y, r, a] of blobs) {
    const g = ctx.createRadialGradient(x * size, y * size, 0, x * size, y * size, r * size)
    g.addColorStop(0, `rgba(255,255,255,${a})`)
    g.addColorStop(0.55, `rgba(255,255,255,${a * 0.45})`)
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
  }
  return finish(canvas)
}

/** Radial light pool laid flat on the asphalt. */
export function makeLightPoolTexture(size = 128) {
  const { canvas, ctx } = canvas2d(size, size)
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,0.7)')
  g.addColorStop(0.28, 'rgba(255,255,255,0.34)')
  g.addColorStop(0.62, 'rgba(255,255,255,0.08)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  return finish(canvas)
}

/** Soft black oval used as a contact shadow. */
export function makeBlobShadowTexture(size = 128) {
  const { canvas, ctx } = canvas2d(size, size)
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(0,0,0,0.82)')
  g.addColorStop(0.45, 'rgba(0,0,0,0.55)')
  g.addColorStop(0.78, 'rgba(0,0,0,0.16)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  return finish(canvas)
}

const SIGN_WORDS = [
  { text: 'NEON', color: '#4df3ff', sub: 'NIGHT CLUB' },
  { text: 'RAMEN', color: '#ff8a2b', sub: 'OPEN 24H' },
  { text: 'HOTEL', color: '#ff2fb3', sub: 'VACANCY' },
  { text: 'DRIVE', color: '#8b5cff', sub: 'ARCADE' },
  { text: 'SUSHI', color: '#45ffb0', sub: 'BAR · GRILL' },
  { text: '24H', color: '#ffd34d', sub: 'CONVENIENCE' },
  { text: 'CLUB', color: '#ff3b5c', sub: 'AFTER DARK' },
  { text: 'VOLT', color: '#7df8ff', sub: 'CYBER CAFE' },
]

/** Glowing neon sign plates used on building facades. */
export function makeSignTextures() {
  return SIGN_WORDS.map(({ text, color, sub }, index) => {
    const { canvas, ctx } = canvas2d(512, 256)
    ctx.clearRect(0, 0, 512, 256)

    const grd = ctx.createLinearGradient(0, 0, 512, 256)
    grd.addColorStop(0, color)
    grd.addColorStop(1, '#ffffff')

    // frame
    ctx.save()
    ctx.strokeStyle = color
    ctx.globalAlpha = 0.85
    ctx.lineWidth = 5
    ctx.shadowColor = color
    ctx.shadowBlur = 26
    ctx.strokeRect(18, 18, 476, 220)
    ctx.globalAlpha = 0.28
    ctx.lineWidth = 1.5
    ctx.strokeRect(34, 34, 444, 188)
    ctx.restore()

    // corner ticks
    ctx.save()
    ctx.strokeStyle = color
    ctx.lineWidth = 6
    ctx.shadowColor = color
    ctx.shadowBlur = 18
    const tick = 26
    for (const [x, y, dx, dy] of [
      [18, 18, 1, 1],
      [494, 18, -1, 1],
      [18, 238, 1, -1],
      [494, 238, -1, -1],
    ]) {
      ctx.beginPath()
      ctx.moveTo(x + dx * tick, y)
      ctx.lineTo(x, y)
      ctx.lineTo(x, y + dy * tick)
      ctx.stroke()
    }
    ctx.restore()

    // main word
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `900 ${text.length > 4 ? 88 : 108}px Orbitron, "Arial Black", sans-serif`
    ctx.shadowColor = color
    ctx.shadowBlur = 34
    ctx.fillStyle = grd
    ctx.fillText(text, 256, 118)
    ctx.shadowBlur = 12
    ctx.lineWidth = 2
    ctx.strokeStyle = '#ffffff'
    ctx.globalAlpha = 0.55
    ctx.strokeText(text, 256, 118)
    ctx.restore()

    // subtitle
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = '600 25px Rajdhani, "Trebuchet MS", sans-serif'
    ctx.letterSpacing = '8px'
    ctx.fillStyle = color
    ctx.globalAlpha = 0.85
    ctx.shadowColor = color
    ctx.shadowBlur = 14
    ctx.fillText(sub, 256, 196)
    ctx.restore()

    const texture = finish(canvas)
    texture.userData = { color, index }
    return texture
  })
}

/** Vertical gradient for the checkpoint light pillar. */
export function makeBeamTexture() {
  const { canvas, ctx } = canvas2d(8, 256)
  const g = ctx.createLinearGradient(0, 256, 0, 0)
  g.addColorStop(0, 'rgba(255,255,255,0.9)')
  g.addColorStop(0.15, 'rgba(255,255,255,0.5)')
  g.addColorStop(0.55, 'rgba(255,255,255,0.14)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 8, 256)
  return finish(canvas)
}

/** Small arrow chevron sprite for checkpoints / pickups. */
export function makeChevronTexture() {
  const { canvas, ctx } = canvas2d(128, 128)
  ctx.clearRect(0, 0, 128, 128)
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 12
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.shadowColor = '#ffffff'
  ctx.shadowBlur = 18
  for (let i = 0; i < 2; i++) {
    const y = 30 + i * 34
    ctx.beginPath()
    ctx.moveTo(34, y)
    ctx.lineTo(64, y + 26)
    ctx.lineTo(94, y)
    ctx.stroke()
  }
  return finish(canvas)
}

export function makeRainTexture() {
  const { canvas, ctx } = canvas2d(16, 64)
  const g = ctx.createLinearGradient(0, 0, 0, 64)
  g.addColorStop(0, 'rgba(255,255,255,0)')
  g.addColorStop(0.5, 'rgba(255,255,255,0.65)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(6, 0, 4, 64)
  return finish(canvas)
}

export const NEON_COLORS = [
  new THREE.Color('#4df3ff'),
  new THREE.Color('#ff2fb3'),
  new THREE.Color('#8b5cff'),
  new THREE.Color('#ff8a2b'),
  new THREE.Color('#45ffb0'),
  new THREE.Color('#ffd34d'),
]
