export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
export const lerp = (a, b, t) => a + (b - a) * t
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt))
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a)
export const randInt = (a, b) => Math.floor(rand(a, b + 1))
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hash2(x, y) {
  let h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123
  return h - Math.floor(h)
}

export function shortestAngle(a, b) {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

export const formatScore = (n) => Math.round(n).toLocaleString('en-US')
export const formatTime = (n) => (Math.max(0, n)).toFixed(1)

export function disposeObject(object) {
  object.traverse((child) => {
    if (child.geometry) child.geometry.dispose()
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material]
      for (const material of materials) {
        for (const key of Object.keys(material)) {
          const value = material[key]
          if (value && value.isTexture) value.dispose()
        }
        material.dispose()
      }
    }
  })
}

export const nextFrame = () =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()))

export function saveBest(score) {
  try {
    localStorage.setItem('neondrift.best', String(Math.round(score)))
  } catch {}
}

export function loadBest() {
  try {
    return Number(localStorage.getItem('neondrift.best')) || 0
  } catch {
    return 0
  }
}

export function isTouchDevice() {
  return (
    (typeof window !== 'undefined' && 'ontouchstart' in window) ||
    (navigator.maxTouchPoints || 0) > 0
  )
}
