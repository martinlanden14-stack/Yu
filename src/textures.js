import * as THREE from 'three';
import { canvas2d, fbm, makeRng } from './utils.js';

function finish(canvas, repeatX = 1, repeatY = 1) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function noiseOverlay(ctx, w, h, amount = 0.06, seed = 1) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const rng = makeRng(seed);
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng.next() - 0.5) * 255 * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

export function makeGrassTexture() {
  const [c, ctx] = canvas2d(512, 512);
  const rng = makeRng(1337);
  ctx.fillStyle = '#5c7a3e';
  ctx.fillRect(0, 0, 512, 512);
  // broad tonal patches
  for (let i = 0; i < 70; i++) {
    const x = rng.range(0, 512), y = rng.range(0, 512);
    const r = rng.range(20, 90);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const tone = rng.chance(0.5) ? '90,116,60' : '66,92,44';
    g.addColorStop(0, `rgba(${tone},${rng.range(0.03, 0.11).toFixed(3)})`);
    g.addColorStop(1, `rgba(${tone},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // blades
  for (let i = 0; i < 9000; i++) {
    const x = rng.range(0, 512), y = rng.range(0, 512);
    const len = rng.range(1.2, 4.2);
    const shade = rng.range(0, 1);
    ctx.strokeStyle = shade > 0.62
      ? `rgba(${110 + rng.range(0, 30) | 0},${140 + rng.range(0, 28) | 0},${72 + rng.range(0, 22) | 0},.5)`
      : `rgba(${54 + rng.range(0, 28) | 0},${80 + rng.range(0, 28) | 0},${38 + rng.range(0, 20) | 0},.55)`;
    ctx.lineWidth = rng.range(0.5, 1.1);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + rng.range(-1.4, 1.4), y - len);
    ctx.stroke();
  }
  // tiny flowers / clover
  for (let i = 0; i < 90; i++) {
    const x = rng.range(0, 512), y = rng.range(0, 512);
    ctx.fillStyle = rng.chance(0.5) ? 'rgba(208,196,120,.35)' : 'rgba(230,224,190,.24)';
    ctx.beginPath(); ctx.arc(x, y, rng.range(0.6, 1.4), 0, Math.PI * 2); ctx.fill();
  }
  noiseOverlay(ctx, 512, 512, 0.05, 9);
  return finish(c, 1, 1);
}

export function makeDirtTexture() {
  const [c, ctx] = canvas2d(256, 256);
  const rng = makeRng(42);
  ctx.fillStyle = '#806a48';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2400; i++) {
    const x = rng.range(0, 256), y = rng.range(0, 256);
    const s = rng.range(0.5, 2.2);
    const l = rng.range(-30, 26);
    ctx.fillStyle = `rgba(${128 + l},${104 + l},${70 + l},${rng.range(0.2, .7)})`;
    ctx.fillRect(x, y, s, s);
  }
  for (let i = 0; i < 55; i++) {
    const x = rng.range(0, 256), y = rng.range(0, 256);
    ctx.fillStyle = `rgba(${110 + rng.range(0, 40) | 0},${104 + rng.range(0, 30) | 0},${92 + rng.range(0, 20) | 0},.5)`;
    ctx.beginPath(); ctx.ellipse(x, y, rng.range(1, 3.2), rng.range(0.7, 2), rng.range(0, 3), 0, Math.PI * 2); ctx.fill();
  }
  noiseOverlay(ctx, 256, 256, 0.06, 4);
  return finish(c, 1, 1);
}

export function makeSoilTexture() {
  const [c, ctx] = canvas2d(256, 256);
  const rng = makeRng(88);
  ctx.fillStyle = '#58412b';
  ctx.fillRect(0, 0, 256, 256);
  // furrows
  for (let y = 10; y < 256; y += 36) {
    const grad = ctx.createLinearGradient(0, y, 0, y + 22);
    grad.addColorStop(0, 'rgba(38,27,17,.75)');
    grad.addColorStop(0.5, 'rgba(90,65,41,.3)');
    grad.addColorStop(1, 'rgba(120,92,58,.28)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, y, 256, 22);
    ctx.fillStyle = 'rgba(150,118,76,.16)';
    ctx.fillRect(0, y + 22, 256, 2);
  }
  for (let i = 0; i < 1700; i++) {
    const x = rng.range(0, 256), y = rng.range(0, 256);
    ctx.fillStyle = `rgba(${60 + rng.range(0, 60) | 0},${45 + rng.range(0, 40) | 0},${30 + rng.range(0, 30) | 0},${rng.range(.15, .55)})`;
    ctx.fillRect(x, y, rng.range(.5, 2), rng.range(.5, 2));
  }
  noiseOverlay(ctx, 256, 256, 0.055, 12);
  return finish(c, 1, 1);
}

export function makeWoodTexture() {
  const [c, ctx] = canvas2d(256, 256);
  const rng = makeRng(2024);
  ctx.fillStyle = '#8a6138';
  ctx.fillRect(0, 0, 256, 256);
  const plankH = 32;
  for (let p = 0; p < 8; p++) {
    const y = p * plankH;
    const shade = rng.range(-12, 12);
    ctx.fillStyle = `rgb(${138 + shade | 0},${97 + shade | 0},${56 + shade * .7 | 0})`;
    ctx.fillRect(0, y, 256, plankH - 2);
    // grain
    for (let i = 0; i < 46; i++) {
      const gy = y + rng.range(2, plankH - 4);
      ctx.strokeStyle = `rgba(${70 + rng.range(0, 40) | 0},${44 + rng.range(0, 25) | 0},${22 + rng.range(0, 18) | 0},${rng.range(.06, .28)})`;
      ctx.lineWidth = rng.range(.4, 1.3);
      ctx.beginPath();
      ctx.moveTo(0, gy);
      const wob = rng.range(-1.2, 1.2);
      ctx.bezierCurveTo(70, gy + wob, 170, gy - wob, 256, gy + rng.range(-1, 1));
      ctx.stroke();
    }
    // seam
    ctx.fillStyle = 'rgba(45,27,14,.65)';
    ctx.fillRect(0, y + plankH - 2, 256, 2);
    // nail heads
    ctx.fillStyle = 'rgba(50,40,30,.65)';
    ctx.beginPath(); ctx.arc(10, y + plankH / 2, 1.6, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(246, y + plankH / 2, 1.6, 0, 7); ctx.fill();
  }
  noiseOverlay(ctx, 256, 256, 0.045, 7);
  return finish(c, 1, 1);
}

export function makeStoneTexture() {
  const [c, ctx] = canvas2d(256, 256);
  const rng = makeRng(555);
  ctx.fillStyle = '#8b8b80';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 400; i++) {
    const x = rng.range(0, 256), y = rng.range(0, 256);
    const r = rng.range(1, 13);
    const l = rng.range(-34, 30);
    ctx.fillStyle = `rgba(${130 + l},${130 + l},${118 + l},${rng.range(.12, .4)})`;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * rng.range(.5, 1), rng.range(0, 3), 0, 7); ctx.fill();
  }
  for (let i = 0; i < 40; i++) {
    ctx.strokeStyle = `rgba(60,60,52,${rng.range(.06, .2)})`;
    ctx.lineWidth = rng.range(.5, 1.6);
    const x = rng.range(0, 256), y = rng.range(0, 256);
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.lineTo(x + rng.range(-28, 28), y + rng.range(-20, 20));
    ctx.stroke();
  }
  noiseOverlay(ctx, 256, 256, 0.07, 3);
  return finish(c, 1, 1);
}

export function makeSoftCircle(inner = 1, outer = 0, size = 128) {
  const [c, ctx] = canvas2d(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, `rgba(255,255,255,${inner})`);
  g.addColorStop(0.45, `rgba(255,255,255,${inner * 0.55})`);
  g.addColorStop(1, `rgba(255,255,255,${outer})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeSmokeTexture() {
  const [c, ctx] = canvas2d(128, 128);
  const rng = makeRng(77);
  for (let i = 0; i < 26; i++) {
    const x = 64 + rng.range(-24, 24), y = 64 + rng.range(-24, 24);
    const r = rng.range(12, 40);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${rng.range(.08, .2)})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeGlowTexture() {
  const [c, ctx] = canvas2d(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,220,150,1)');
  g.addColorStop(0.2, 'rgba(255,180,80,.6)');
  g.addColorStop(0.55, 'rgba(255,130,40,.16)');
  g.addColorStop(1, 'rgba(255,100,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export function makeCloudTexture() {
  const [c, ctx] = canvas2d(256, 128);
  const rng = makeRng(99);
  for (let i = 0; i < 28; i++) {
    const x = 50 + rng.range(0, 156), y = 60 + rng.range(-16, 28);
    const r = rng.range(18, 48);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${rng.range(.16, .34)})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 128);
  }
  return new THREE.CanvasTexture(c);
}

export function makeRippleTexture() {
  const [c, ctx] = canvas2d(128, 128);
  ctx.strokeStyle = 'rgba(255,255,255,.3)';
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.ellipse(64, 64, 42, 20, 0, 0, 7); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.16)';
  ctx.beginPath(); ctx.ellipse(64, 64, 28, 12, 0, 0, 7); ctx.stroke();
  return new THREE.CanvasTexture(c);
}
