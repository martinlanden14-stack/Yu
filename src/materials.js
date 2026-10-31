import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  makeGrassTexture, makeDirtTexture, makeSoilTexture, makeWoodTexture,
  makeStoneTexture, makeSoftCircle, makeSmokeTexture, makeGlowTexture,
  makeCloudTexture, makeRippleTexture,
} from './textures.js';

export const TEX = {
  grass: makeGrassTexture(),
  dirt: makeDirtTexture(),
  soil: makeSoilTexture(),
  wood: makeWoodTexture(),
  stone: makeStoneTexture(),
  soft: makeSoftCircle(),
  smoke: makeSmokeTexture(),
  glow: makeGlowTexture(),
  cloud: makeCloudTexture(),
  ripple: makeRippleTexture(),
};

const std = (opts) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...opts });

function texClone(tex, rx, ry) {
  const t = tex.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.needsUpdate = true;
  return t;
}

export const MAT = {
  wood: std({ map: texClone(TEX.wood, 1, 1), color: 0xffffff, roughness: 0.82 }),
  woodDark: std({ map: texClone(TEX.wood, 1, 1), color: 0x9b7c58, roughness: 0.88 }),
  woodLight: std({ map: texClone(TEX.wood, 1, 1), color: 0xe0c399, roughness: 0.78 }),
  log: std({ color: 0x7b5632, roughness: 0.9, flatShading: true }),
  logEnd: std({ color: 0xc79b62, roughness: 0.85 }),
  stone: std({ map: texClone(TEX.stone, 1, 1), color: 0xffffff, roughness: 0.95 }),
  stoneLight: std({ color: 0xb7b4a6, roughness: 0.95, flatShading: true }),
  stoneDark: std({ color: 0x6c6d64, roughness: 0.95, flatShading: true }),
  soil: std({ map: texClone(TEX.soil, 1, 1), roughness: 1 }),
  metal: std({ color: 0x8d938e, roughness: 0.42, metalness: 0.72 }),
  metalDark: std({ color: 0x4e5550, roughness: 0.5, metalness: 0.6 }),
  gold: std({ color: 0xd9a353, roughness: 0.34, metalness: 0.65 }),
  cloth: std({ color: 0x7c8a72, roughness: 1 }),
  clothRed: std({ color: 0x9c5547, roughness: 1 }),
  clothCream: std({ color: 0xd8c9a8, roughness: 1 }),
  dark: std({ color: 0x2b2e28, roughness: 0.9 }),
  black: std({ color: 0x171a16, roughness: 0.8 }),
  leaf: std({ color: 0x4f7c3a, roughness: 0.95, flatShading: true }),
  leafDeep: std({ color: 0x3c6630, roughness: 0.95, flatShading: true }),
  leafLight: std({ color: 0x6d9448, roughness: 0.95, flatShading: true }),
  pine: std({ color: 0x3f6b48, roughness: 0.96, flatShading: true }),
  pineDeep: std({ color: 0x315638, roughness: 0.96, flatShading: true }),
  bark: std({ color: 0x5e432a, roughness: 0.95, flatShading: true }),
  crop: std({ color: 0x7da24f, roughness: 0.95, flatShading: true }),
  cropGold: std({ color: 0xc9aa55, roughness: 0.95, flatShading: true }),
  water: std({ color: 0x3f7f86, roughness: 0.18, metalness: 0.1, transparent: true, opacity: 0.86 }),
  blueprint: new THREE.MeshBasicMaterial({ color: 0x7fd4c8, transparent: true, opacity: 0.34, depthWrite: false }),
  blueprintEdge: new THREE.LineBasicMaterial({ color: 0x9ff0e2, transparent: true, opacity: 0.6 }),
  valid: new THREE.MeshBasicMaterial({ color: 0x8fe08a, transparent: true, opacity: 0.28, depthWrite: false }),
  invalid: new THREE.MeshBasicMaterial({ color: 0xe2856f, transparent: true, opacity: 0.3, depthWrite: false }),
};

export const SKIN_TONES = [0xe3b38b, 0xc98d63, 0x8f5f42, 0xf0c6a1, 0x6f4834, 0xd6a077];
export const HAIR_TONES = [0x3a2a1e, 0x1f1b18, 0x7a4b2a, 0xb07037, 0xcfc1a1, 0x4a3125];
export const CLOTH_TONES = [0x9c5547, 0x4d7570, 0xb08a45, 0x6a7a4d, 0x7d5a7d, 0x46607a];

const geoCache = new Map();
export function boxGeo(w, h, d, radius = 0.04) {
  const key = `r${w},${h},${d},${radius}`;
  if (!geoCache.has(key)) geoCache.set(key, new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 2, h / 2, d / 2)));
  return geoCache.get(key);
}
export function cylGeo(rt, rb, h, seg = 8) {
  const key = `c${rt},${rb},${h},${seg}`;
  if (!geoCache.has(key)) geoCache.set(key, new THREE.CylinderGeometry(rt, rb, h, seg));
  return geoCache.get(key);
}
export function sphereGeo(r, w = 10, h = 8) {
  const key = `s${r},${w},${h}`;
  if (!geoCache.has(key)) geoCache.set(key, new THREE.SphereGeometry(r, w, h));
  return geoCache.get(key);
}

export function mesh(geometry, material, x = 0, y = 0, z = 0, cast = true, receive = true) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

export function addBox(parent, w, h, d, material, x, y, z, radius = 0.04) {
  const m = mesh(boxGeo(w, h, d, radius), material, x, y, z);
  parent.add(m);
  return m;
}

export function addCyl(parent, rt, rb, h, material, x, y, z, seg = 8) {
  const m = mesh(cylGeo(rt, rb, h, seg), material, x, y, z);
  parent.add(m);
  return m;
}

export function makeGlowSprite(color = 0xffb35c, opacity = 0.8, scale = 1) {
  const mat = new THREE.SpriteMaterial({
    map: TEX.glow, color, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const s = new THREE.Sprite(mat);
  s.scale.set(scale, scale, 1);
  return s;
}

export function makeSmokeSprite() {
  const mat = new THREE.SpriteMaterial({
    map: TEX.smoke, color: 0xcfd8d0, transparent: true, opacity: 0.25, depthWrite: false,
  });
  return new THREE.Sprite(mat);
}
