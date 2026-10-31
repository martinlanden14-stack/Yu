import * as THREE from 'three';
import { MAT, TEX, mesh, sphereGeo, cylGeo } from './materials.js';
import {
  TAU, clamp, damp, fbm, lerp, makeRng, smoothstep, smootherstep,
} from './utils.js';

const SIZE = 52;
const HALF = SIZE / 2;
const CENTER = 25.5;
const POND = { x: 14.5, z: 16, rx: 5.0, rz: 4.2, level: -0.32 };

function makeBarkStrip() {
  return null;
}

export class World {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.size = SIZE;
    this.half = HALF;
    this.seed = 20261031;
    this.rng = makeRng(this.seed);
    this.time = 0;
    this.hour = 7.4;
    this.dayFactor = 1;
    this.group = new THREE.Group();
    this.group.name = 'world';
    scene.add(this.group);

    this.heights = new Float32Array(SIZE * SIZE);
    this.types = new Uint8Array(SIZE * SIZE);
    this.staticBlocked = new Uint8Array(SIZE * SIZE);
    this.buildingBlocked = new Uint8Array(SIZE * SIZE);
    this.trees = [];
    this.rocks = [];
    this.bushes = [];
    this.markers = new THREE.Group();
    this.group.add(this.markers);
    this.markerIcons = {
      chop: makeIconTexture('chop'),
      mine: makeIconTexture('mine'),
      harvest: makeIconTexture('harvest'),
      build: makeIconTexture('build'),
    };
    this.floatingMarkers = [];

    this.makeHeightfield();
    this.buildGround();
    this.buildDirtPatches();
    this.buildWater();
    this.buildRocks();
    this.buildTrees();
    this.buildFoliage();
    this.buildReeds();
    this.buildSky();
    this.buildLights();
    this.buildBirds();
    this.buildClouds();
    this.buildFireflies();
    this.update(0, 7.4);
  }

  idx(tx, tz) { return tz * SIZE + tx; }

  inBounds(tx, tz) { return tx >= 0 && tz >= 0 && tx < SIZE && tz < SIZE; }

  heightAt(tx, tz) {
    const x = tx - CENTER, z = tz - CENTER;
    const r = Math.hypot(x, z);
    let h = 0;
    const rim = smoothstep(15.5, 25, r);
    h += Math.pow(rim, 1.6) * 5.4;
    h += (fbm((tx + 20) * 0.11, (tz + 20) * 0.11, 3) - 0.5) * 0.42 * smoothstep(14, 19, r);
    h += (fbm(tx * 0.22, tz * 0.22, 2) - 0.5) * 0.075 * smoothstep(8.5, 14, r);
    // pond basin
    const pd = Math.hypot((tx - POND.x) / POND.rx, (tz - POND.z) / POND.rz);
    if (pd < 1.65) h -= smootherstep(1.65, 0.2, pd) * 1.65;
    return h;
  }

  makeHeightfield() {
    for (let tz = 0; tz < SIZE; tz++) {
      for (let tx = 0; tx < SIZE; tx++) {
        const i = this.idx(tx, tz);
        const h = this.heightAt(tx, tz);
        this.heights[i] = h;
        const pd = Math.hypot((tx - POND.x) / POND.rx, (tz - POND.z) / POND.rz);
        const x = tx - CENTER, z = tz - CENTER;
        const r = Math.hypot(x, z);
        let type = 0; // grass
        if (pd < 1.0) type = 3; // water
        else if (pd < 1.28) type = 4; // sand
        else if (r > 21.5 || h > 2.2) type = 2; // rock/rough
        if (type === 3) this.staticBlocked[i] = 1;
        // central dirt suggest a clearing
        if (type === 0 && r < 8.4 && fbm(tx * 0.4, tz * 0.4, 2) > 0.58) type = 1;
        this.types[i] = type;
      }
    }
  }

  typeAt(tx, tz) {
    if (!this.inBounds(tx, tz)) return 5;
    return this.types[this.idx(tx, tz)];
  }

  groundHeight(tx, tz) {
    const x0 = Math.floor(tx), z0 = Math.floor(tz);
    const fx = tx - x0, fz = tz - z0;
    const sx = Math.min(SIZE - 1, Math.max(0, x0));
    const sz = Math.min(SIZE - 1, Math.max(0, z0));
    const sx1 = Math.min(SIZE - 1, sx + 1);
    const sz1 = Math.min(SIZE - 1, sz + 1);
    const h00 = this.heights[this.idx(sx, sz)];
    const h10 = this.heights[this.idx(sx1, sz)];
    const h01 = this.heights[this.idx(sx, sz1)];
    const h11 = this.heights[this.idx(sx1, sz1)];
    return lerp(lerp(h00, h10, fx), lerp(h01, h11, fx), fz);
  }

  worldPos(tx, tz) {
    return new THREE.Vector3(tx - CENTER + 0.5, this.groundHeight(tx, tz), tz - CENTER + 0.5);
  }

  tileAt(x, z) {
    return { tx: Math.floor(x + CENTER), tz: Math.floor(z + CENTER) };
  }

  isBuildable(tx, tz) {
    if (!this.inBounds(tx, tz)) return false;
    const i = this.idx(tx, tz);
    if (this.types[i] === 3) return false;
    if (this.staticBlocked[i] || this.buildingBlocked[i]) return false;
    if (this.heights[i] > 0.32) return false;
    return true;
  }

  isWalkable(tx, tz) {
    if (!this.inBounds(tx, tz)) return false;
    const i = this.idx(tx, tz);
    if (this.types[i] === 3) return false;
    if (this.heights[i] > 1.15) return false;
    return !this.staticBlocked[i] && !this.buildingBlocked[i];
  }

  isFlat(tx, tz) {
    if (!this.inBounds(tx, tz)) return false;
    return this.heights[this.idx(tx, tz)] <= 0.32;
  }

  buildGround() {
    const N = 104;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array((N + 1) * (N + 1) * 3);
    const colors = new Float32Array((N + 1) * (N + 1) * 3);
    const uvs = new Float32Array((N + 1) * (N + 1) * 2);
    const indices = [];
    const col = new THREE.Color();
    const grassA = new THREE.Color(0x94b26b);
    const grassB = new THREE.Color(0x729650);
    const dirtC = new THREE.Color(0xc0a173);
    const sandC = new THREE.Color(0xd8c08e);
    const rockC = new THREE.Color(0x9a998d);
    for (let iz = 0; iz <= N; iz++) {
      for (let ix = 0; ix <= N; ix++) {
        const k = iz * (N + 1) + ix;
        const x = (ix / N) * SIZE - HALF;
        const z = (iz / N) * SIZE - HALF;
        const tx = x + CENTER, tz = z + CENTER;
        const h = this.heightAt(tx, tz);
        positions[k * 3] = x;
        positions[k * 3 + 1] = h;
        positions[k * 3 + 2] = z;
        uvs[k * 2] = ix / N;
        uvs[k * 2 + 1] = iz / N;
        const pd = Math.hypot((tx - POND.x) / POND.rx, (tz - POND.z) / POND.rz);
        const r = Math.hypot(tx - CENTER, tz - CENTER);
        const n = fbm(tx * 0.35, tz * 0.35, 3);
        const n2 = fbm(tx * 0.07 + 10, tz * 0.07 - 7, 2);
        if (pd < 1.3) col.copy(sandC).lerp(dirtC, n * 0.4);
        else if (r > 21.5 || h > 2.2) col.copy(rockC).lerp(grassB, smoothstep(3.5, 1.4, h) * 0.42);
        else if (r < 8.4 && n > 0.55) col.copy(grassB).lerp(dirtC, smoothstep(0.55, 0.8, n) * 0.55);
        else col.copy(grassA).lerp(grassB, n2 * 0.9 + n * 0.1);
        // outer edges darken very slightly
        const edge = smoothstep(18, 25.5, r);
        col.lerp(new THREE.Color(0x60704c), edge * 0.22);
        col.multiplyScalar(0.93 + n * 0.14);
        colors[k * 3] = col.r; colors[k * 3 + 1] = col.g; colors[k * 3 + 2] = col.b;
      }
    }
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const a = iz * (N + 1) + ix;
        const b = a + 1;
        const c = a + (N + 1);
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const map = TEX.grass.clone();
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(26, 26);
    map.needsUpdate = true;
    const mat = new THREE.MeshStandardMaterial({
      map, vertexColors: true, roughness: 0.98, metalness: 0,
    });
    this.ground = mesh(geo, mat, 0, 0, 0, false, true);
    this.ground.name = 'terrain';
    this.group.add(this.ground);
  }

  buildDirtPatches() {
    const [c, ctx] = [document.createElement('canvas'), null];
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const rng = makeRng(17);
    const grad = g.createRadialGradient(128, 128, 18, 128, 128, 122);
    grad.addColorStop(0, 'rgba(132,108,72,.95)');
    grad.addColorStop(0.62, 'rgba(124,100,67,.72)');
    grad.addColorStop(1, 'rgba(120,98,65,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(128, 128, 122, 122, 0, 0, TAU);
    g.fill();
    for (let i = 0; i < 700; i++) {
      const a = rng.range(0, TAU), r = rng.range(0, 112);
      g.fillStyle = `rgba(${100 + rng.range(0, 60) | 0},${78 + rng.range(0, 40) | 0},${50 + rng.range(0, 30) | 0},${rng.range(.1, .5)})`;
      g.fillRect(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, rng.range(1, 3), rng.range(1, 3));
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({
      map: tex, transparent: true, opacity: 0.62, roughness: 1, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1,
    });
    const patches = [
      [0.4, 2.2, 8.8, 6.8], [-2.2, -0.6, 6.2, 5.2], [4.6, 7.4, 5.3, 4.3],
      [-5.8, 4.2, 4.4, 3.8], [7.4, -3.2, 3.8, 3.4], [0.0, 10.6, 3.8, 3.0],
    ];
    for (const [x, z, sx, sz] of patches) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(1, 28), mat);
      m.rotation.x = -Math.PI / 2;
      m.scale.set(sx, sz, 1);
      m.position.set(x, 0.025, z);
      m.receiveShadow = true;
      this.group.add(m);
    }
    // scattered flat stone flags
    const stoneMat = new THREE.MeshStandardMaterial({ map: TEX.stone, roughness: 0.9 });
    for (let i = 0; i < 14; i++) {
      const a = i / 14 * TAU;
      const rad = 2.25;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.4, 0.07, 7), stoneMat);
      m.position.set(Math.cos(a) * rad + 0.4, 0.045, Math.sin(a) * rad + 2.2);
      m.rotation.y = a;
      m.receiveShadow = true;
      m.castShadow = false;
      this.group.add(m);
    }
  }

  buildWater() {
    const geo = new THREE.CircleGeometry(1, 64);
    this.waterMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uSky: { value: new THREE.Color(0xbcd7e4) },
        uDeep: { value: new THREE.Color(0x1d4b52) },
        uShallow: { value: new THREE.Color(0x4b8885) },
        uDay: { value: 1 },
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        varying vec3 vWorld;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */`
        uniform float uTime;
        uniform vec3 uSky, uDeep, uShallow;
        uniform float uDay;
        varying vec2 vUv;
        varying vec3 vWorld;
        void main() {
          float d = length(vUv - 0.5) * 2.0;
          float n = sin((vUv.x*23.0 + uTime*0.6)) * 0.5 + 0.5;
          float n2 = sin((vUv.y*31.0 - uTime*0.45) + n*2.0) * 0.5 + 0.5;
          float ripple = n * n2;
          vec3 col = mix(uDeep, uShallow, smoothstep(0.18, 0.95, d) * 0.6 + ripple * 0.14);
          float fres = pow(1.0 - clamp(d, 0.0, 1.0), 3.0);
          col = mix(col, uSky, 0.16 + fres * 0.16);
          float foam = smoothstep(0.8, 0.99, d) * (0.35 + 0.3 * sin(uTime * 1.1 + vUv.x * 42.0));
          col = mix(col, vec3(0.83, 0.9, 0.84), clamp(foam, 0.0, 0.5));
          float glint = pow(max(0.0, sin(vUv.x*60.0 + uTime*1.4) * sin(vUv.y*48.0 - uTime)), 22.0);
          col += vec3(1.0, 0.92, 0.72) * glint * 0.3;
          col *= mix(0.16, 1.0, uDay);
          gl_FragColor = vec4(col, 0.93);
        }`,
    });
    this.water = new THREE.Mesh(geo, this.waterMat);
    this.water.rotation.x = -Math.PI / 2;
    this.water.scale.set(POND.rx * 1.03, POND.rz * 1.03, 1);
    this.water.position.set(POND.x - CENTER + 0.5, POND.level, POND.z - CENTER + 0.5);
    this.water.renderOrder = 2;
    this.group.add(this.water);

    // lily pads
    const padMat = new THREE.MeshStandardMaterial({ color: 0x4f7d3e, roughness: 0.85, side: THREE.DoubleSide });
    const rng = makeRng(9);
    for (let i = 0; i < 11; i++) {
      const a = rng.range(0, TAU), r = rng.range(0.8, 3.6);
      const x = POND.x - CENTER + 0.5 + Math.cos(a) * r;
      const z = POND.z - CENTER + 0.5 + Math.sin(a) * r * 0.8;
      const pad = new THREE.Mesh(new THREE.CircleGeometry(rng.range(0.12, 0.25), 9), padMat);
      pad.rotation.x = -Math.PI / 2;
      pad.rotation.z = rng.range(0, TAU);
      pad.position.set(x, POND.level + 0.012, z);
      pad.receiveShadow = true;
      this.group.add(pad);
      if (rng.chance(0.3)) {
        const flower = new THREE.Mesh(sphereGeo(0.06, 6, 4), new THREE.MeshStandardMaterial({ color: 0xf3e5cf, roughness: 0.7 }));
        flower.position.set(x + 0.05, POND.level + 0.05, z + 0.03);
        this.group.add(flower);
      }
    }
  }

  buildRocks() {
    const rng = makeRng(313);
    const positions = [];
    // boulders around the rim and a few interior outcrops
    for (let i = 0; i < 92; i++) {
      const a = rng.range(0, TAU);
      const rad = rng.range(19.2, 25.2);
      const tx = Math.round(CENTER + Math.cos(a) * rad);
      const tz = Math.round(CENTER + Math.sin(a) * rad);
      if (!this.inBounds(tx, tz)) continue;
      if (this.types[this.idx(tx, tz)] === 3) continue;
      positions.push({ tx, tz, sx: rng.range(0.6, 1.9), sy: rng.range(0.5, 1.5), sz: rng.range(0.6, 1.9), rot: rng.range(0, TAU), central: false });
    }
    // interior rocks as mineable outcrops
    const spots = [
      [-8.5, 6.2], [7.8, 7.2], [-7.2, -5.8], [8.8, -6.4], [-3.4, 9.8], [5.6, 10.6], [10.5, 2.4],
    ];
    for (const [x, z] of spots) {
      const tx = Math.round(CENTER + x), tz = Math.round(CENTER + z);
      if (!this.inBounds(tx, tz)) continue;
      for (let k = 0; k < 2; k++) {
        const ox = k === 0 ? 0 : (rng.chance(0.5) ? 1 : 0);
        const oz = k === 0 ? 0 : (rng.chance(0.5) ? 1 : -1);
        positions.push({ tx: tx + ox, tz: tz + oz, sx: rng.range(0.75, 1.15), sy: rng.range(0.65, 1.05), sz: rng.range(0.75, 1.15), rot: rng.range(0, TAU), central: true });
      }
    }

    const geo = new THREE.DodecahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x9a9b90, roughness: 0.94, flatShading: true });
    const inst = new THREE.InstancedMesh(geo, mat, positions.length);
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const rng2 = makeRng(707);
    positions.forEach((p, i) => {
      const y = this.groundHeight(p.tx, p.tz);
      dummy.position.set(p.tx - CENTER + 0.5, y + p.sy * 0.42, p.tz - CENTER + 0.5);
      dummy.rotation.set(p.rot * 0.3, p.rot, rng2.range(-0.1, 0.1));
      dummy.scale.set(p.sx, p.sy, p.sz);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
      color.setHSL(0.1, 0.06, rng2.range(0.48, 0.72));
      inst.setColorAt(i, color);
      const rock = {
        id: `rock-${i}`, tx: p.tx, tz: p.tz, mesh: inst, index: i,
        x: p.tx - CENTER + 0.5, z: p.tz - CENTER + 0.5, y, size: p.sx,
        designated: false, removed: false, hp: 3, central: p.central,
        base: dummy.matrix.clone(),
      };
      this.rocks.push(rock);
      if (p.central || p.sy > 0.85) this.staticBlocked[this.idx(p.tx, p.tz)] = 1;
    });
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    this.rockMesh = inst;
    this.group.add(inst);

    // small scattered pebbles (non-blocking)
    const pebGeo = new THREE.DodecahedronGeometry(0.18, 0);
    const pebMat = new THREE.MeshStandardMaterial({ color: 0x8f9086, roughness: 0.95, flatShading: true });
    const pebCount = 90;
    const peb = new THREE.InstancedMesh(pebGeo, pebMat, pebCount);
    peb.castShadow = false; peb.receiveShadow = true;
    for (let i = 0; i < pebCount; i++) {
      let tx = 0, tz = 0, tries = 0;
      do {
        tx = rng.int(3, SIZE - 4); tz = rng.int(3, SIZE - 4); tries++;
      } while (tries < 40 && (this.types[this.idx(tx, tz)] === 3 || Math.hypot(tx - CENTER, tz - CENTER) < 3));
      dummy.position.set(tx - CENTER + 0.5, this.groundHeight(tx, tz) + 0.06, tz - CENTER + 0.5);
      dummy.rotation.set(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3));
      dummy.scale.setScalar(rng.range(0.4, 1.3));
      dummy.updateMatrix();
      peb.setMatrixAt(i, dummy.matrix);
    }
    this.group.add(peb);
  }

  buildTrees() {
    const rng = makeRng(818);
    const spots = [];

    // A handful of close trees frame the clearing and give early chopping work.
    const near = [[34, 24], [33, 33], [18, 30], [19, 22], [29, 16], [35, 30], [15, 33], [30, 36]];
    for (const [tx, tz] of near) {
      if (!this.inBounds(tx, tz)) continue;
      const ni = this.idx(tx, tz);
      if (this.types[ni] === 3 || this.heights[ni] > 0.34) continue;
      const pine = rng.chance(0.68);
      spots.push({
        tx, tz, pine,
        h: pine ? rng.range(2.5, 3.7) : rng.range(2.0, 2.8),
        scale: rng.range(0.95, 1.35),
        rot: rng.range(0, TAU),
        hue: rng.range(-0.05, 0.055),
        lean: rng.range(-0.055, 0.055),
      });
    }

    for (let i = 0; i < 150; i++) {
      const a = rng.range(0, TAU);
      const rad = rng.range(9.7, 24.2);
      const tx = Math.round(CENTER + Math.cos(a) * rad);
      const tz = Math.round(CENTER + Math.sin(a) * rad);
      if (!this.inBounds(tx, tz)) continue;
      const i2 = this.idx(tx, tz);
      if (this.types[i2] === 3 || this.staticBlocked[i2] && !this.rocks.find(r => r.tx === tx && r.tz === tz)) continue;
      const pd = Math.hypot((tx - POND.x) / (POND.rx + 2.2), (tz - POND.z) / (POND.rz + 2.2));
      if (pd < 1) continue;
      if (Math.hypot(tx - CENTER, tz - CENTER) < 9.4) continue;
      // spacing
      if (spots.some(s => Math.hypot(s.tx - tx, s.tz - tz) < 2.1)) continue;
      const pine = rng.chance(0.56);
      spots.push({
        tx, tz, pine,
        h: pine ? rng.range(2.1, 3.5) : rng.range(1.8, 2.7),
        scale: rng.range(0.82, 1.28),
        rot: rng.range(0, TAU),
        hue: rng.range(-0.05, 0.055),
        lean: rng.range(-0.055, 0.055),
      });
    }

    const trunks = new THREE.InstancedMesh(cylGeo(0.08, 0.17, 1, 6), MAT.bark, spots.length);
    trunks.castShadow = true; trunks.receiveShadow = true;
    const pineCount = spots.filter(s => s.pine).length * 3;
    const leafCount = spots.filter(s => !s.pine).length * 4;
    const pines = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 7), MAT.pine, pineCount);
    pines.castShadow = true; pines.receiveShadow = true;
    const leaves = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), MAT.leaf, leafCount);
    leaves.castShadow = true; leaves.receiveShadow = true;

    this.applyWind(pines, 0.055);
    this.applyWind(leaves, 0.07);

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const rng2 = makeRng(919);
    let pi = 0, li = 0;
    spots.forEach((s, i) => {
      const y = this.groundHeight(s.tx, s.tz);
      const x = s.tx - CENTER + 0.5, z = s.tz - CENTER + 0.5;
      dummy.position.set(x, y + s.h * 0.5, z);
      dummy.rotation.set(s.lean, s.rot, s.lean * 0.7);
      dummy.scale.set(s.scale, s.h, s.scale);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
      const tree = {
        id: `tree-${i}`, tx: s.tx, tz: s.tz, x, z, y, height: s.h * s.scale, pine: s.pine,
        scale: s.scale, designated: false, removed: false, hp: 4,
        parts: [{ mesh: trunks, index: i }],
      };
      this.staticBlocked[this.idx(s.tx, s.tz)] = 1;
      if (s.pine) {
        for (let k = 0; k < 3; k++) {
          const t = k / 2;
          const layerY = y + s.h * (0.62 + t * 0.3);
          const rad = s.scale * (1.45 - t * 0.5);
          dummy.position.set(x, layerY, z);
          dummy.rotation.set(0, s.rot + k, 0);
          dummy.scale.set(rad, s.h * 0.46, rad);
          dummy.updateMatrix();
          pines.setMatrixAt(pi, dummy.matrix);
          color.setHSL(0.3 + s.hue, rng2.range(0.28, 0.42), rng2.range(0.21, 0.34));
          pines.setColorAt(pi, color);
          tree.parts.push({ mesh: pines, index: pi });
          pi++;
        }
      } else {
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * TAU + s.rot;
          const rad = k === 0 ? 0 : s.scale * 0.52;
          const layerY = y + s.h * (k === 0 ? 1.02 : 0.84 + (k % 2) * 0.12);
          dummy.position.set(x + Math.cos(a) * rad, layerY, z + Math.sin(a) * rad);
          dummy.rotation.set(rng2.range(0, 1), rng2.range(0, TAU), rng2.range(0, 1));
          const sc = s.scale * (k === 0 ? 1.05 : rng2.range(0.6, 0.82));
          dummy.scale.set(sc, sc * rng2.range(0.85, 1.15), sc);
          dummy.updateMatrix();
          leaves.setMatrixAt(li, dummy.matrix);
          color.setHSL(0.26 + s.hue, rng2.range(0.3, 0.46), rng2.range(0.26, 0.41));
          leaves.setColorAt(li, color);
          tree.parts.push({ mesh: leaves, index: li });
          li++;
        }
      }
      this.trees.push(tree);
    });
    trunks.instanceMatrix.needsUpdate = true;
    pines.instanceMatrix.needsUpdate = true;
    leaves.instanceMatrix.needsUpdate = true;
    if (pines.instanceColor) pines.instanceColor.needsUpdate = true;
    if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
    this.trunkMesh = trunks;
    this.pineMesh = pines;
    this.leafMesh = leaves;
    this.group.add(trunks, pines, leaves);
  }

  buildFoliage() {
    const rng = makeRng(4411);
    // grass tufts
    const bladeGeo = makeGrassBladeGeometry();
    const grassMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 1, side: THREE.DoubleSide, alphaTest: 0.3,
      vertexColors: false,
    });
    this.applyWind(grassMat, 0.12, true);
    const count = 1900;
    const grass = new THREE.InstancedMesh(bladeGeo, grassMat, count);
    grass.receiveShadow = true;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    let placed = 0, tries = 0;
    while (placed < count && tries < count * 8) {
      tries++;
      const tx = rng.range(1, SIZE - 1), tz = rng.range(1, SIZE - 1);
      const i = this.idx(Math.floor(tx), Math.floor(tz));
      if (this.types[i] === 3 || this.types[i] === 2) continue;
      const x = tx - CENTER, z = tz - CENTER;
      if (Math.hypot(x, z) < 1.7) continue;
      const y = this.heightAt(tx, tz);
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, rng.range(0, TAU), 0);
      dummy.scale.setScalar(rng.range(0.65, 1.5));
      dummy.updateMatrix();
      grass.setMatrixAt(placed, dummy.matrix);
      color.setHSL(0.235 + rng.range(-0.02, 0.045), rng.range(0.36, 0.58), rng.range(0.2, 0.34));
      grass.setColorAt(placed, color);
      placed++;
    }
    grass.count = placed;
    grass.instanceMatrix.needsUpdate = true;
    if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
    this.group.add(grass);
    this.grass = grass;

    // flowers
    const flowerGeo = new THREE.IcosahedronGeometry(0.055, 0);
    const flowerMat = new THREE.MeshStandardMaterial({ roughness: 0.65, color: 0xffffff });
    const fcount = 420;
    const flowers = new THREE.InstancedMesh(flowerGeo, flowerMat, fcount);
    let fi = 0;
    while (fi < fcount) {
      const tx = rng.range(1, SIZE - 1), tz = rng.range(1, SIZE - 1);
      const i = this.idx(Math.floor(tx), Math.floor(tz));
      if (this.types[i] !== 0) continue;
      const y = this.heightAt(tx, tz);
      dummy.position.set(tx - CENTER, y + rng.range(0.12, 0.3), tz - CENTER);
      dummy.scale.setScalar(rng.range(0.7, 1.5));
      dummy.rotation.set(0, rng.range(0, TAU), 0);
      dummy.updateMatrix();
      flowers.setMatrixAt(fi, dummy.matrix);
      const pal = [0xf0e6c2, 0xe7c96a, 0xd88b76, 0xc7b4dc, 0xf2f0e4];
      color.set(pal[Math.floor(rng.next() * pal.length)]);
      flowers.setColorAt(fi, color);
      fi++;
    }
    if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
    this.group.add(flowers);

    // bushes
    const bushGeo = new THREE.IcosahedronGeometry(1, 1);
    const bushCount = 46;
    const bush = new THREE.InstancedMesh(bushGeo, MAT.leafDeep, bushCount);
    bush.castShadow = true; bush.receiveShadow = true;
    let bi = 0;
    while (bi < bushCount) {
      const a = rng.range(0, TAU), rad = rng.range(9.8, 23);
      const tx = Math.round(CENTER + Math.cos(a) * rad), tz = Math.round(CENTER + Math.sin(a) * rad);
      if (!this.inBounds(tx, tz) || this.types[this.idx(tx, tz)] === 3) continue;
      const y = this.groundHeight(tx, tz);
      dummy.position.set(tx - CENTER + rng.range(-.3, .3), y + rng.range(0.18, 0.3), tz - CENTER + rng.range(-.3, .3));
      dummy.rotation.set(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3));
      const sc = rng.range(0.35, 0.75);
      dummy.scale.set(sc, sc * rng.range(0.7, 1.1), sc);
      dummy.updateMatrix();
      bush.setMatrixAt(bi, dummy.matrix);
      color.setHSL(0.27 + rng.range(-.04, .04), rng.range(.28, .42), rng.range(.2, .3));
      bush.setColorAt(bi, color);
      bi++;
    }
    if (bush.instanceColor) bush.instanceColor.needsUpdate = true;
    this.group.add(bush);
    this.bushMesh = bush;
    this.applyWind(bush, 0.018);

    // fallen logs / stumps
    const logGeo = cylGeo(0.16, 0.2, 1.4, 7);
    const stumpGeo = cylGeo(0.22, 0.28, 0.4, 7);
    for (let i = 0; i < 12; i++) {
      const a = rng.range(0, TAU), rad = rng.range(9.5, 22);
      const tx = Math.round(CENTER + Math.cos(a) * rad), tz = Math.round(CENTER + Math.sin(a) * rad);
      if (!this.inBounds(tx, tz) || this.types[this.idx(tx, tz)] !== 0) continue;
      const y = this.groundHeight(tx, tz);
      const log = mesh(logGeo, MAT.log, tx - CENTER + 0.5, y + 0.18, tz - CENTER + 0.5);
      log.rotation.set(0, rng.range(0, TAU), Math.PI / 2 + rng.range(-0.08, 0.08));
      this.group.add(log);
      if (rng.chance(0.5)) {
        const stub = mesh(stumpGeo, MAT.bark, log.position.x + rng.range(-.6, .6), y + 0.2, log.position.z + rng.range(-.6, .6));
        this.group.add(stub);
      }
    }
  }

  buildReeds() {
    const rng = makeRng(66);
    const reedGeo = new THREE.ConeGeometry(0.035, 1, 4);
    const mat = new THREE.MeshStandardMaterial({ color: 0x7d9455, roughness: 0.95, side: THREE.DoubleSide });
    const inst = new THREE.InstancedMesh(reedGeo, mat, 70);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 70; i++) {
      const a = rng.range(0, TAU);
      const rr = rng.range(0.92, 1.16);
      const tx = POND.x + Math.cos(a) * POND.rx * rr;
      const tz = POND.z + Math.sin(a) * POND.rz * rr;
      const y = this.heightAt(tx, tz);
      dummy.position.set(tx - CENTER, y + rng.range(0.3, 0.55), tz - CENTER);
      dummy.rotation.set(rng.range(-.12, .12), rng.range(0, TAU), rng.range(-.12, .12));
      const sc = rng.range(0.45, 0.95);
      dummy.scale.set(1, sc, 1);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.castShadow = true;
    this.group.add(inst);
  }

  applyWind(object, strength = 0.05, isMaterial = false) {
    const key = `wind-${strength}`;
    const apply = (mat) => {
      mat.userData.wind = { value: 0 };
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uWindTime = mat.userData.wind;
        shader.uniforms.uWindStrength = { value: strength };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>
            uniform float uWindTime; uniform float uWindStrength;`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            #ifdef USE_INSTANCING
              vec3 iOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
            #else
              vec3 iOrigin = vec3(0.0);
            #endif
            float phase = iOrigin.x * 0.55 + iOrigin.z * 0.41;
            float swayAmt = uWindStrength * smoothstep(0.0, 1.4, position.y);
            transformed.x += sin(uWindTime * 1.35 + phase) * swayAmt;
            transformed.z += cos(uWindTime * 1.07 + phase * 1.3) * swayAmt * 0.65;`);
      };
      mat.needsUpdate = true;
    };
    const mat = isMaterial ? object : object.material;
    if (!mat) return;
    if (!mat.userData.wind) apply(mat);
    if (!isMaterial) mat.userData.windRefs = (mat.userData.windRefs || 0) + 1;
    // store reference for update
    this.windMats = this.windMats || [];
    if (!this.windMats.includes(mat)) this.windMats.push(mat);
  }

  buildSky() {
    const skyGeo = new THREE.SphereGeometry(240, 32, 20);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x5e96c8) },
        uHorizon: { value: new THREE.Color(0xd8e3d2) },
        uSunCol: { value: new THREE.Color(0xffd9a0) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uNight: { value: 0 },
      },
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uTop, uHorizon, uSunCol, uSunDir;
        uniform float uNight;
        varying vec3 vDir;
        void main() {
          float y = clamp(vDir.y, -0.2, 1.0);
          vec3 col = mix(uHorizon, uTop, smoothstep(-0.04, 0.62, y));
          float sunAmt = pow(max(dot(normalize(vDir), normalize(uSunDir)), 0.0), 220.0);
          float glow = pow(max(dot(normalize(vDir), normalize(uSunDir)), 0.0), 6.0);
          col += uSunCol * sunAmt * 1.5 + uSunCol * glow * 0.16 * (1.0 - uNight);
          float below = smoothstep(0.0, -0.16, vDir.y);
          col = mix(col, mix(uHorizon, uTop, 0.3) * 0.7, below);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(skyGeo, this.skyMat);
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);

    // stars
    const starCount = 700;
    const pos = new Float32Array(starCount * 3);
    const phase = new Float32Array(starCount);
    const rng = makeRng(1212);
    for (let i = 0; i < starCount; i++) {
      const a = rng.range(0, TAU), el = rng.range(0.08, 1.35);
      const r = 220;
      pos[i * 3] = Math.cos(a) * Math.cos(el) * r;
      pos[i * 3 + 1] = Math.sin(el) * r;
      pos[i * 3 + 2] = Math.sin(a) * Math.cos(el) * r;
      phase[i] = rng.range(0, TAU);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
    this.starMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uNight: { value: 0 } },
      vertexShader: /* glsl */`
        attribute float phase;
        uniform float uTime, uNight;
        varying float vA;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (1.0 + 1.6 * fract(phase * 3.7)) * (160.0 / -mv.z);
          vA = uNight * (0.5 + 0.5 * sin(uTime * 1.3 + phase)) * (0.5 + 0.5 * fract(phase * 9.1));
        }`,
      fragmentShader: /* glsl */`
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          gl_FragColor = vec4(vec3(0.85, 0.9, 1.0), vA * smoothstep(0.5, 0.0, d));
        }`,
    });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.renderOrder = -9;
    this.scene.add(this.stars);

    // moon
    this.moon = new THREE.Mesh(new THREE.CircleGeometry(4.2, 24), new THREE.MeshBasicMaterial({ color: 0xe8edff, transparent: true, opacity: 0.9, fog: false }));
    this.moon.renderOrder = -8;
    this.scene.add(this.moon);
    const moonGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.soft, color: 0xcfe0ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    moonGlow.scale.set(34, 34, 1);
    this.moonGlow = moonGlow;
    this.moon.add(moonGlow);
  }

  buildLights() {
    this.hemi = new THREE.HemisphereLight(0xbcd6e8, 0x54603e, 0.85);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffe4b5, 2.4);
    this.sun.position.set(18, 30, 12);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 90;
    const s = 27;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 3.5;
    this.sun.target.position.set(0, 0, 0);
    this.scene.add(this.sun, this.sun.target);
    this.sunOffset = new THREE.Vector3(18, 30, 12);

    this.fill = new THREE.DirectionalLight(0x9ec5d8, 0.35);
    this.fill.position.set(-22, 16, -18);
    this.scene.add(this.fill);

    this.scene.fog = new THREE.FogExp2(0xc9d8c5, 0.0085);
    this.scene.background = null;
  }

  buildBirds() {
    this.birds = [];
    const rng = makeRng(1515);
    const mat = new THREE.MeshBasicMaterial({ color: 0x39433c, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
    const wingGeo = new THREE.BufferGeometry();
    wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.62, 0.05, -0.12, 0.5, 0, 0.2], 3));
    wingGeo.computeVertexNormals();
    for (let i = 0; i < 7; i++) {
      const bird = new THREE.Group();
      const l = new THREE.Mesh(wingGeo, mat);
      const r = new THREE.Mesh(wingGeo, mat);
      r.scale.x = -1;
      bird.add(l, r);
      const rad = rng.range(12, 26), y = rng.range(9, 15);
      bird.position.set(Math.cos(rng.range(0, TAU)) * rad, y, Math.sin(rng.range(0, TAU)) * rad);
      const s = rng.range(0.6, 1.2);
      bird.scale.setScalar(s);
      bird.userData = {
        rad, y, speed: rng.range(0.045, 0.09) * (rng.chance(0.7) ? 1 : -1),
        phase: rng.range(0, TAU), wings: [l, r], flapping: rng.range(0, TAU),
        scale: s,
      };
      this.group.add(bird);
      this.birds.push(bird);
    }
  }

  buildClouds() {
    this.clouds = [];
    const rng = makeRng(1717);
    for (let i = 0; i < 9; i++) {
      const mat = new THREE.SpriteMaterial({
        map: TEX.cloud, color: 0xffffff, transparent: true, opacity: rng.range(0.2, 0.42),
        depthWrite: false, fog: false,
      });
      const spr = new THREE.Sprite(mat);
      const a = rng.range(0, TAU), rad = rng.range(70, 150);
      spr.position.set(Math.cos(a) * rad, rng.range(24, 50), Math.sin(a) * rad);
      const w = rng.range(38, 78);
      spr.scale.set(w, w * rng.range(0.35, 0.52), 1);
      spr.userData = { speed: rng.range(0.12, 0.34), a, rad, baseOpacity: mat.opacity };
      this.group.add(spr);
      this.clouds.push(spr);
    }
  }

  buildFireflies() {
    const count = 90;
    const pos = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    const rng = makeRng(2323);
    for (let i = 0; i < count; i++) {
      const a = rng.range(0, TAU), r = rng.range(1.5, 13);
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = rng.range(0.25, 2.2);
      pos[i * 3 + 2] = Math.sin(a) * r;
      phase[i] = rng.range(0, TAU);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
    this.fireflyMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: { value: 0 }, uNight: { value: 0 } },
      vertexShader: /* glsl */`
        attribute float phase; uniform float uTime, uNight; varying float vA;
        void main() {
          vec3 p = position;
          p.x += sin(uTime * 0.4 + phase) * 0.8;
          p.z += cos(uTime * 0.33 + phase * 1.7) * 0.8;
          p.y += sin(uTime * 0.8 + phase * 2.2) * 0.28;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = 90.0 / -mv.z;
          vA = uNight * smoothstep(0.1, 0.85, sin(uTime * 0.9 + phase * 3.0) * 0.5 + 0.5);
        }`,
      fragmentShader: /* glsl */`
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          gl_FragColor = vec4(1.0, 0.86, 0.45, vA * smoothstep(0.5, 0.0, d) * 0.9);
        }`,
    });
    this.fireflies = new THREE.Points(g, this.fireflyMat);
    this.group.add(this.fireflies);
  }

  update(dt, hour) {
    this.time += dt;
    this.hour = hour;
    const t = this.time;
    const sunAngle = ((hour - 6) / 12) * Math.PI;
    const elevation = Math.sin(sunAngle);
    const azimuth = (hour / 24) * TAU - 0.8;
    const sunDir = new THREE.Vector3(
      Math.cos(azimuth) * Math.cos(sunAngle * 0.75),
      elevation,
      Math.sin(azimuth) * Math.cos(sunAngle * 0.75),
    ).normalize();
    if (sunDir.y < 0.05) sunDir.y = Math.min(0.05, sunDir.y);

    const day = smoothstep(-0.04, 0.24, elevation);
    this.dayFactor = day;
    const dawn = 1 - Math.abs(clamp(elevation, 0, 1) - 0.16) * 3;
    const night = 1 - day;

    // sky colors
    const topDay = new THREE.Color(0x4d86bd);
    const topDusk = new THREE.Color(0x6b6a8e);
    const topNight = new THREE.Color(0x101a2d);
    const horDay = new THREE.Color(0xd7e4d5);
    const horDusk = new THREE.Color(0xf0b87e);
    const horNight = new THREE.Color(0x29394a);
    const top = topNight.clone().lerp(topDay, day).lerp(topDusk, Math.max(0, dawn) * 0.55);
    const hor = horNight.clone().lerp(horDay, day).lerp(horDusk, Math.max(0, dawn) * 0.6);
    this.skyMat.uniforms.uTop.value.copy(top);
    this.skyMat.uniforms.uHorizon.value.copy(hor);
    this.skyMat.uniforms.uSunDir.value.copy(sunDir);
    this.skyMat.uniforms.uSunCol.value.set(elevation < 0.3 ? 0xffb370 : 0xffe8bd);
    this.skyMat.uniforms.uNight.value = night;
    this.starMat.uniforms.uNight.value = smoothstep(0.25, 0.85, night);
    this.starMat.uniforms.uTime.value = t;
    this.fireflyMat.uniforms.uNight.value = smoothstep(0.45, 0.95, night);
    this.fireflyMat.uniforms.uTime.value = t;
    this.scene.fog.color.copy(hor).lerp(new THREE.Color(0x8da08a), day * 0.25);
    this.scene.fog.density = lerp(0.0125, 0.0062, day);

    // light
    const sunCol = new THREE.Color(0xffe2b0).lerp(new THREE.Color(0xff9f63), Math.max(0, dawn) * 0.65);
    const moonCol = new THREE.Color(0x9fb6dc);
    this.sun.color.copy(moonCol).lerp(sunCol, day);
    this.sun.intensity = lerp(0.32, 2.55, day);
    this.sun.position.copy(this.sun.target.position).addScaledVector(sunDir, 42);
    this.sun.castShadow = day > 0.15;
    this.hemi.color.copy(moonCol).lerp(new THREE.Color(0xbdd8ea), day);
    this.hemi.groundColor.copy(new THREE.Color(0x333b31)).lerp(new THREE.Color(0x68784c), day);
    this.hemi.intensity = lerp(0.4, 1.04, day);
    this.fill.intensity = lerp(0.12, 0.32, day);
    this.fill.color.copy(moonCol).lerp(new THREE.Color(0x9ec5d8), day);

    // moon & stars placement
    const moonDir = sunDir.clone().multiplyScalar(-1);
    this.moon.position.copy(moonDir).multiplyScalar(210);
    this.moon.lookAt(0, 0, 0);
    this.moon.material.opacity = smoothstep(0.15, 0.75, night) * 0.92;
    this.moonGlow.material.opacity = smoothstep(0.15, 0.75, night) * 0.42;
    this.stars.visible = night > 0.05;

    // wind
    if (this.windMats) for (const m of this.windMats) if (m.userData?.wind) m.userData.wind.value = t;

    // water
    this.waterMat.uniforms.uTime.value = t;
    this.waterMat.uniforms.uSky.value.copy(hor).lerp(top, 0.45);
    this.waterMat.uniforms.uDay.value = day;

    // clouds
    for (const c of this.clouds) {
      c.userData.a += c.userData.speed * dt * 0.012;
      c.position.x = Math.cos(c.userData.a) * c.userData.rad;
      c.position.z = Math.sin(c.userData.a) * c.userData.rad;
      c.material.opacity = c.userData.baseOpacity * lerp(0.18, 1, day);
      c.material.color.copy(new THREE.Color(0x26313a)).lerp(new THREE.Color(0xffffff), day * 0.9 + 0.1);
    }

    // birds
    for (const b of this.birds) {
      const u = b.userData;
      u.phase += u.speed * dt;
      const r = u.rad + Math.sin(t * 0.15 + u.phase) * 1.5;
      b.position.set(Math.cos(u.phase) * r, u.y + Math.sin(t * 0.5 + u.phase * 3) * 0.6, Math.sin(u.phase) * r);
      b.rotation.y = -u.phase + (u.speed > 0 ? 0 : Math.PI);
      const flap = Math.sin(t * 7.5 + u.flapping) * 0.55;
      u.wings[0].rotation.z = flap;
      u.wings[1].rotation.z = -flap;
      b.visible = day > 0.2;
    }

    // markers bob
    for (const m of this.floatingMarkers) {
      if (m.sprite) m.sprite.position.y = m.baseY + Math.sin(t * 2.2 + m.phase) * 0.09;
    }

    this.updateAmbientParticles(dt, night, day);
  }

  updateAmbientParticles(dt, night, day) {
    // floating motes during the day, handled with lightweight sprite points
    if (!this.motes) {
      const count = 46;
      const pos = new Float32Array(count * 3);
      const phase = new Float32Array(count);
      const rng = makeRng(3333);
      for (let i = 0; i < count; i++) {
        const a = rng.range(0, TAU), r = rng.range(1, 14);
        pos[i * 3] = Math.cos(a) * r;
        pos[i * 3 + 1] = rng.range(0.4, 4.5);
        pos[i * 3 + 2] = Math.sin(a) * r;
        phase[i] = rng.range(0, TAU);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
      this.moteMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uDay: { value: 0 } },
        vertexShader: /* glsl */`
          attribute float phase; uniform float uTime, uDay; varying float vA;
          void main() {
            vec3 p = position;
            p.x += sin(uTime * 0.18 + phase) * 1.2;
            p.y += sin(uTime * 0.25 + phase * 1.9) * 0.4;
            p.z += cos(uTime * 0.15 + phase * 1.3) * 1.2;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = (1.5 + fract(phase) * 2.0) * (60.0 / -mv.z);
            vA = uDay * (0.25 + 0.35 * (sin(uTime * 0.7 + phase) * 0.5 + 0.5));
          }`,
        fragmentShader: /* glsl */`
          varying float vA;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            if (d > 0.5) discard;
            gl_FragColor = vec4(1.0, 0.95, 0.8, vA * smoothstep(0.5, 0.0, d));
          }`,
      });
      this.motes = new THREE.Points(g, this.moteMat);
      this.group.add(this.motes);
    }
    this.moteMat.uniforms.uTime.value = this.time;
    this.moteMat.uniforms.uDay.value = day * 0.6;
  }

  setMarker(target, kind) {
    if (!target) return;
    if (target.marker) {
      target.marker.material.map = this.markerIcons[kind] || this.markerIcons.chop;
      target.marker.material.needsUpdate = true;
      return;
    }
    const mat = new THREE.SpriteMaterial({
      map: this.markerIcons[kind] || this.markerIcons.chop,
      transparent: true, depthWrite: false, depthTest: false, sizeAttenuation: true,
    });
    const spr = new THREE.Sprite(mat);
    const top = (target.height || 1.2) + target.y + 0.6;
    spr.position.set(target.x, top, target.z);
    spr.scale.setScalar(0.75);
    spr.renderOrder = 10;
    this.markers.add(spr);
    target.marker = spr;
    this.floatingMarkers.push({ sprite: spr, baseY: top, phase: Math.random() * 6 });
  }

  clearMarker(target) {
    if (!target || !target.marker) return;
    this.markers.remove(target.marker);
    target.marker.material.dispose();
    target.marker = null;
    this.floatingMarkers = this.floatingMarkers.filter(m => m.sprite !== target.marker);
  }

  removeTree(tree) {
    if (tree.removed) return;
    tree.removed = true;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const part of tree.parts) {
      part.mesh.setMatrixAt(part.index, zero);
      part.mesh.instanceMatrix.needsUpdate = true;
    }
    this.staticBlocked[this.idx(tree.tx, tree.tz)] = 0;
    this.clearMarker(tree);
    tree.marker = null;
  }

  removeRock(rock) {
    if (rock.removed) return;
    rock.removed = true;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    rock.mesh.setMatrixAt(rock.index, zero);
    rock.mesh.instanceMatrix.needsUpdate = true;
    this.staticBlocked[this.idx(rock.tx, rock.tz)] = 0;
    this.clearMarker(rock);
    rock.marker = null;
  }
}

function makeGrassBladeGeometry() {
  const positions = [];
  const uvs = [];
  const indices = [];
  const blades = 3;
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI;
    const dx = Math.cos(a) * 0.075, dz = Math.sin(a) * 0.075;
    const base = positions.length / 3;
    positions.push(-dx, 0, -dz, dx, 0, dz, dx * 0.4, 0.34 + (i % 2) * 0.08, dz * 0.4);
    uvs.push(0, 0, 1, 0, 0.5, 1);
    indices.push(base, base + 1, base + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

function makeIconTexture(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  g.beginPath();
  g.arc(64, 58, 40, 0, TAU);
  g.fillStyle = 'rgba(16,24,19,.82)';
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(245,225,180,.9)';
  g.stroke();
  g.strokeStyle = '#f2d9a6';
  g.fillStyle = '#f2d9a6';
  g.lineWidth = 5;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  if (kind === 'chop') {
    g.moveTo(44, 82); g.lineTo(80, 40);
    g.moveTo(72, 38); g.quadraticCurveTo(88, 38, 90, 54);
    g.quadraticCurveTo(82, 48, 74, 50); g.closePath(); g.stroke();
  } else if (kind === 'mine') {
    g.moveTo(42, 84); g.lineTo(76, 52);
    g.moveTo(58, 36); g.quadraticCurveTo(82, 34, 92, 56);
    g.moveTo(68, 44); g.lineTo(88, 50);
    g.stroke();
  } else if (kind === 'harvest') {
    g.moveTo(64, 86); g.lineTo(64, 48);
    g.moveTo(64, 64); g.quadraticCurveTo(44, 64, 42, 44);
    g.quadraticCurveTo(60, 44, 64, 60);
    g.moveTo(64, 56); g.quadraticCurveTo(82, 54, 86, 38);
    g.quadraticCurveTo(68, 38, 64, 52);
    g.stroke();
  } else {
    g.moveTo(42, 86); g.lineTo(42, 50); g.lineTo(64, 36); g.lineTo(86, 50); g.lineTo(86, 86);
    g.moveTo(56, 86); g.lineTo(56, 68); g.lineTo(72, 68); g.lineTo(72, 86);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
