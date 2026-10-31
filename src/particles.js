import * as THREE from 'three';
import { TEX } from './materials.js';
import { makeRng } from './utils.js';

const rng = makeRng(8181);

class Pool {
  constructor(scene, capacity, additive) {
    this.capacity = capacity;
    this.parts = [];
    const pos = new Float32Array(capacity * 3);
    const col = new Float32Array(capacity * 3);
    const size = new Float32Array(capacity);
    const alpha = new Float32Array(capacity);
    this.pos = pos; this.col = col; this.size = size; this.alpha = alpha;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(size, 1));
    g.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uMap: { value: TEX.soft }, uScale: { value: 600 } },
      vertexShader: /* glsl */`
        attribute float size; attribute float alpha; attribute vec3 color;
        uniform float uScale;
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vColor = color; vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(size * uScale / max(0.1, -mv.z), 1.0, 220.0);
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uMap; varying vec3 vColor; varying float vAlpha;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          gl_FragColor = vec4(vColor, t.a * vAlpha);
          if (gl_FragColor.a < 0.01) discard;
        }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    scene.add(this.points);
    this.cursor = 0;
    for (let i = 0; i < capacity; i++) {
      this.parts.push({ live: false, age: 0, life: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, g: 0, drag: 0.98, size0: 0.1, size1: 0.1, r: 1, g2: 1, b: 1, a0: 1, a1: 0, spin: 0 });
    }
  }

  spawn(opts) {
    const p = this.parts[this.cursor];
    this.cursor = (this.cursor + 1) % this.capacity;
    p.live = true;
    p.age = 0;
    p.life = opts.life ?? 1;
    p.x = opts.x; p.y = opts.y; p.z = opts.z;
    p.vx = opts.vx ?? 0; p.vy = opts.vy ?? 0; p.vz = opts.vz ?? 0;
    p.g = opts.g ?? 0;
    p.drag = opts.drag ?? 0.98;
    p.size0 = opts.size0 ?? 0.1;
    p.size1 = opts.size1 ?? 0.1;
    p.r = opts.r ?? 1; p.g2 = opts.g ?? 1; p.b = opts.b ?? 1;
    if (opts.color) { p.r = opts.color.r; p.g2 = opts.color.g; p.b = opts.color.b; }
    p.a0 = opts.a0 ?? 1; p.a1 = opts.a1 ?? 0;
    p.wobble = opts.wobble ?? 0;
    p.phase = rng.range(0, 6.28);
    return p;
  }

  update(dt) {
    const { pos, col, size, alpha, parts } = this;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const i3 = i * 3;
      if (!p.live) { size[i] = 0; alpha[i] = 0; continue; }
      p.age += dt;
      if (p.age >= p.life) {
        p.live = false;
        size[i] = 0; alpha[i] = 0;
        continue;
      }
      const t = p.age / p.life;
      p.vy += p.g * dt;
      const drag = Math.pow(p.drag, dt * 60);
      p.vx *= drag; p.vy *= drag; p.vz *= drag;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.wobble) {
        p.x += Math.sin(p.age * 3 + p.phase) * p.wobble * dt;
        p.z += Math.cos(p.age * 2.6 + p.phase) * p.wobble * dt;
      }
      pos[i3] = p.x; pos[i3 + 1] = p.y; pos[i3 + 2] = p.z;
      col[i3] = p.r; col[i3 + 1] = p.g2; col[i3 + 2] = p.b;
      size[i] = p.size0 + (p.size1 - p.size0) * t;
      alpha[i] = p.a0 + (p.a1 - p.a0) * t;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
  }

  setScale(s) { this.mat.uniforms.uScale.value = s; }
}

export class Particles {
  constructor(scene) {
    this.scene = scene;
    this.normal = new Pool(scene, 420, false);
    this.additive = new Pool(scene, 260, true);
    this.chipColors = [new THREE.Color(0xb78a55), new THREE.Color(0x8a6138), new THREE.Color(0xd9b37b)];
    this.stoneColors = [new THREE.Color(0xb9b6a8), new THREE.Color(0x8f8f84), new THREE.Color(0xd8d3c0)];
    this.leafColors = [new THREE.Color(0x6d9448), new THREE.Color(0x4f7c3a), new THREE.Color(0x8aa85d)];
  }

  setScale(s) { this.normal.setScale(s); this.additive.setScale(s); }

  update(dt) {
    this.normal.update(dt);
    this.additive.update(dt);
  }

  chips(x, y, z, count = 7, stone = false) {
    const palette = stone ? this.stoneColors : this.chipColors;
    for (let i = 0; i < count; i++) {
      this.normal.spawn({
        x: x + rng.range(-0.16, 0.16), y: y + rng.range(0.1, 0.5), z: z + rng.range(-0.16, 0.16),
        vx: rng.range(-1.5, 1.5), vy: rng.range(1.0, 3.2), vz: rng.range(-1.5, 1.5),
        g: -9, drag: 0.985, life: rng.range(0.45, 0.9),
        size0: rng.range(0.035, 0.07), size1: rng.range(0.02, 0.04),
        color: palette[Math.floor(rng.next() * palette.length)], a0: 0.95, a1: 0.2,
      });
    }
  }

  sparks(x, y, z, count = 6) {
    for (let i = 0; i < count; i++) {
      this.additive.spawn({
        x: x + rng.range(-0.1, 0.1), y: y + rng.range(0.2, 0.6), z: z + rng.range(-0.1, 0.1),
        vx: rng.range(-1.1, 1.1), vy: rng.range(0.8, 2.6), vz: rng.range(-1.1, 1.1),
        g: -6, drag: 0.97, life: rng.range(0.25, 0.6),
        size0: rng.range(0.03, 0.06), size1: 0.01,
        color: new THREE.Color(0xffc971), a0: 1, a1: 0,
      });
    }
  }

  dust(x, y, z, count = 3, scale = 1) {
    for (let i = 0; i < count; i++) {
      this.normal.spawn({
        x: x + rng.range(-0.2, 0.2), y: y + rng.range(0.02, 0.14), z: z + rng.range(-0.2, 0.2),
        vx: rng.range(-0.35, 0.35), vy: rng.range(0.15, 0.55), vz: rng.range(-0.35, 0.35),
        g: 0.1, drag: 0.94, life: rng.range(1.0, 1.9),
        size0: rng.range(0.14, 0.26) * scale, size1: rng.range(0.5, 0.85) * scale,
        color: new THREE.Color(0xd8c9a7), a0: 0.22 * scale, a1: 0,
      });
    }
  }

  smoke(x, y, z, count = 1, size = 1, windX = 0.1) {
    for (let i = 0; i < count; i++) {
      this.normal.spawn({
        x: x + rng.range(-0.12, 0.12), y: y + rng.range(0, 0.2), z: z + rng.range(-0.12, 0.12),
        vx: rng.range(-0.08, 0.08) + windX, vy: rng.range(0.35, 0.65), vz: rng.range(-0.08, 0.08),
        g: 0.05, drag: 0.985, life: rng.range(2.4, 4.2),
        size0: 0.16 * size, size1: rng.range(0.9, 1.5) * size,
        color: new THREE.Color(0x9aa39b), a0: 0.42, a1: 0,
        wobble: 0.12,
      });
    }
  }

  fireEmbers(x, y, z, count = 1) {
    for (let i = 0; i < count; i++) {
      this.additive.spawn({
        x: x + rng.range(-0.14, 0.14), y: y + rng.range(0, 0.25), z: z + rng.range(-0.14, 0.14),
        vx: rng.range(-0.2, 0.2), vy: rng.range(0.6, 1.4), vz: rng.range(-0.2, 0.2),
        g: 0.25, drag: 0.985, life: rng.range(0.9, 1.8),
        size0: rng.range(0.018, 0.04), size1: 0.008,
        color: new THREE.Color(0xffb055), a0: 1, a1: 0, wobble: 0.12,
      });
    }
  }

  leaves(x, y, z, count = 2) {
    for (let i = 0; i < count; i++) {
      this.normal.spawn({
        x: x + rng.range(-0.5, 0.5), y: y + rng.range(0.5, 2.2), z: z + rng.range(-0.5, 0.5),
        vx: rng.range(-0.5, 0.5), vy: rng.range(-0.4, -0.05), vz: rng.range(-0.5, 0.5),
        g: -0.25, drag: 0.97, life: rng.range(2.2, 4),
        size0: rng.range(0.05, 0.09), size1: 0.04,
        color: this.leafColors[Math.floor(rng.next() * this.leafColors.length)], a0: 0.9, a1: 0,
        wobble: 0.7,
      });
    }
  }

  sparkle(x, y, z, count = 12) {
    for (let i = 0; i < count; i++) {
      this.additive.spawn({
        x: x + rng.range(-0.4, 0.4), y: y + rng.range(0, 0.8), z: z + rng.range(-0.4, 0.4),
        vx: rng.range(-0.5, 0.5), vy: rng.range(0.4, 1.4), vz: rng.range(-0.5, 0.5),
        g: 0.2, drag: 0.96, life: rng.range(0.7, 1.5),
        size0: rng.range(0.03, 0.06), size1: 0.01,
        color: new THREE.Color(0xffd98a), a0: 1, a1: 0, wobble: 0.3,
      });
    }
  }

  splash(x, y, z, count = 4) {
    for (let i = 0; i < count; i++) {
      this.additive.spawn({
        x, y, z,
        vx: rng.range(-0.3, 0.3), vy: rng.range(0.3, 0.8), vz: rng.range(-0.3, 0.3),
        g: -4, drag: 0.97, life: rng.range(0.3, 0.6),
        size0: 0.04, size1: 0.01,
        color: new THREE.Color(0xcfe8e2), a0: 0.8, a1: 0,
      });
    }
  }
}
