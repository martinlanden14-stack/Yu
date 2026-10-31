import './style.css'
import { Game } from './game/Game.js'

function showFatal(message) {
  const screen = document.getElementById('loadingScreen')
  const label = screen?.querySelector('.loader-text')
  if (label) {
    label.textContent = message
    label.style.color = '#ff6b86'
  }
  const bar = screen?.querySelector('.loader-bar')
  if (bar) bar.style.display = 'none'
  const ring = screen?.querySelector('.loader-ring')
  if (ring) ring.style.animation = 'none'
  console.error('[NEON DRIFT]', message)
}

async function boot() {
  const canvas = document.getElementById('game')
  if (!canvas) {
    showFatal('RENDERER UNAVAILABLE')
    return
  }

  try {
    // Canvas textures use Orbitron for the neon signs, so wait for the fonts.
    if (document.fonts?.ready) {
      await Promise.race([
        document.fonts.ready,
        new Promise((resolve) => setTimeout(resolve, 2500)),
      ])
    }

    const game = new Game(canvas)
    await game.init()
  } catch (error) {
    console.error(error)
    showFatal(
      /webgl/i.test(String(error?.message))
        ? 'WEBGL UNAVAILABLE ON THIS DEVICE'
        : 'THE CITY FAILED TO LOAD — RELOAD TO RETRY',
    )
  }
}

boot()
