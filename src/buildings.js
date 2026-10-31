import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { MAT, TEX, addBox, addCyl, mesh, makeGlowSprite, boxGeo, cylGeo, sphereGeo } from './materials.js';
import { TAU, clamp, damp, lerp, makeRng } from './utils.js';

const cropGeoCache = (() => {
  let geo = null;
  return () => {
    if (geo) return geo;
    const geos = [];
    const rng = makeRng(66);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.3;
      const g = new THREE.ConeGeometry(0.028, 0.55, 4).toNonIndexed();
      g.translate(Math.cos(a) * 0.1, 0.28, Math.sin(a) * 0.1);
      g.rotateZ(rng.range(-0.06, 0.06));
      geos.push(g);
      const head = new THREE.IcosahedronGeometry(0.045, 0);
      head.translate(Math.cos(a) * 0.13, 0.54, Math.sin(a) * 0.13);
      geos.push(head);
    }
    geo = BufferGeometryUtils.mergeGeometries(geos, false);
    return geo;
  };
})();

export const BUILDINGS = {
  wall: {
    id: 'wall', name: 'Timber wall', cost: { wood: 4 }, size: [1, 1], solid: true, work: 3.4,
    desc: 'A sturdy plank wall that keeps the wind out.',
    icon: '<path d="M4 20V6l8-3 8 3v14"/><path d="M4 11h16M4 16h16M12 3v17"/>',
  },
  stonewall: {
    id: 'stonewall', name: 'Stone wall', cost: { stone: 6 }, size: [1, 1], solid: true, work: 4.2,
    desc: 'Heavy blocks, laid to last. Fireproof and handsome.',
    icon: '<path d="M3 19V8h18v11"/><path d="M3 12h18M3 15.5h18M9 8v4M15 8v4M6 12v3.5M12 12v3.5M18 12v3.5M9 15.5V19M15 15.5V19"/>',
  },
  door: {
    id: 'door', name: 'Timber door', cost: { wood: 6 }, size: [1, 1], solid: false, walkable: true, work: 2.6,
    desc: 'Opens for settlers. Keeps the weather out.',
    icon: '<path d="M5 21V4h14v17"/><path d="M8 21V7h8v14"/><circle cx="14" cy="14" r=".8"/>',
  },
  floor: {
    id: 'floor', name: 'Plank floor', cost: { wood: 2 }, size: [1, 1], solid: false, walkable: true, work: 1.4,
    desc: 'Clean boards underfoot. A little slice of home.',
    icon: '<path d="M3 17 12 12l9 5-9 5-9-5Z"/><path d="M3 12 12 7l9 5M3 7 12 2l9 5"/>',
  },
  bed: {
    id: 'bed', name: 'Settler bed', cost: { wood: 12 }, size: [1, 2], solid: true, work: 4,
    desc: 'A warm place to sleep. Restores rest quickly.',
    icon: '<path d="M3 19V8h4v5h14v6"/><path d="M3 16h18M7 13V9h6a4 4 0 0 1 4 4v3"/><circle cx="9.5" cy="8.5" r="1.5"/>',
  },
  campfire: {
    id: 'campfire', name: 'Campfire', cost: { wood: 8, stone: 4 }, size: [1, 1], solid: true, work: 3,
    desc: 'Warmth, light, and a place to gather after dark.',
    icon: '<path d="M12 21c4 0 6-2.5 6-6 0-4.5-4-6-4-9 0 0-1 2-2 3 0-2-1-4-2-5-1 3-4 5-4 9 0 5 3 8 6 8Z"/>',
  },
  table: {
    id: 'table', name: 'Table', cost: { wood: 14 }, size: [1, 1], solid: true, work: 4,
    desc: 'Meals taste better sitting down. Lifts the mood.',
    icon: '<path d="M3 9h18M6 9v11M18 9v11"/><path d="M9 9V6h6v3"/>',
  },
  farm: {
    id: 'farm', name: 'Crop plot', cost: { wood: 2 }, size: [3, 3], solid: false, walkable: true, work: 4,
    desc: 'Three by three of tilled soil. Wheat grows in the sun.',
    icon: '<path d="M3 20h18M6 20V9M12 20V7M18 20V9"/><path d="M6 12c-2 0-3-1.5-3-3 2 0 3 1.2 3 3ZM6 12c2 0 3-1.5 3-3-2 0-3 1.2-3 3ZM12 10c-2 0-3-1.5-3-3 2 0 3 1.2 3 3ZM12 10c2 0 3-1.5 3-3-2 0-3 1.2-3 3ZM18 12c-2 0-3-1.5-3-3 2 0 3 1.2 3 3Z"/>',
  },
  storage: {
    id: 'storage', name: 'Stockpile', cost: { wood: 6 }, size: [2, 2], solid: false, walkable: true, work: 3,
    desc: 'Haulers bring wood, stone and food here.',
    icon: '<path d="M3 10 12 4l9 6v10H3V10Z"/><path d="M3 10h18M7 20v-6h10v6M7 14h10"/>',
  },
  torch: {
    id: 'torch', name: 'Torch post', cost: { wood: 3 }, size: [1, 1], solid: true, work: 1.5,
    desc: 'A small flame to hold back the dark.',
    icon: '<path d="M12 21V10"/><path d="M12 10c2.5 0 4-1.7 4-4 0-2.5-2.5-4-4-6-1 2-4 3.5-4 6 0 2.3 1.5 4 4 4Z"/>',
  },
  beacon: {
    id: 'beacon', name: 'Signal beacon', cost: { wood: 40, stone: 30 }, size: [2, 2], solid: true, work: 16,
    desc: 'A tall spire of light. Calls wanderers to your valley.',
    icon: '<path d="M9 21 12 4l3 17"/><path d="M9 21h6M12 4 8 8M12 4l4 4"/><path d="M12 16h.01"/><circle cx="12" cy="10" r="4"/>',
  },
};

export const BUILD_ORDER = ['wall', 'stonewall', 'door', 'floor', 'bed', 'campfire', 'table', 'farm', 'storage', 'torch', 'beacon'];

export function costString(cost) {
  return Object.entries(cost).map(([k, v]) => `${v} ${k}`).join(' · ') || 'Free';
}

let buildingId = 0;

export class Building {
  constructor(type, tx, tz, world, options = {}) {
    this.id = `b${++buildingId}`;
    this.type = type;
    this.def = BUILDINGS[type];
    this.tx = tx; this.tz = tz;
    this.w = this.def.size[0]; this.h = this.def.size[1];
    this.world = world;
    this.state = options.built ? 'built' : 'blueprint';
    this.progress = options.built ? 1 : 0;
    this.work = this.def.work;
    this.group = new THREE.Group();
    const center = world.worldPos(tx + (this.w - 1) / 2, tz + (this.h - 1) / 2);
    this.center = center;
    this.group.position.set(center.x, center.y, center.z);
    this.group.rotation.y = options.rot || 0;
    this.x = center.x; this.z = center.z; this.y = center.y;
    this.assigned = null;
    this.doorOpen = 0;
    this.growth = options.growth ?? (type === 'farm' ? 0.35 : 0);
    this.anim = 0;
    this.flicker = Math.random() * 10;
    this.smokeT = Math.random() * 1.2;
    this.storage = type === 'storage';
    this.highlight = null;
    this.options = options;
    if (options.built) {
      this.model = buildModel(type, this, world);
      this.group.add(this.model);
      this.anim = 1.4;
    } else {
      this.model = makeBlueprint(this, world);
      this.group.add(this.model);
    }
    world.buildingBlocked[world.idx(tx, tz)] = this.def.walkable ? 0 : 1;
    for (let dz = 0; dz < this.h; dz++) {
      for (let dx = 0; dx < this.w; dx++) {
        const idx = world.idx(tx + dx, tz + dz);
        if (!this.def.walkable) world.buildingBlocked[idx] = 1;
      }
    }
    world.group.add(this.group);
    this.seed = Math.random() * 100;
  }

  get footTiles() {
    const out = [];
    for (let dz = 0; dz < this.h; dz++) for (let dx = 0; dx < this.w; dx++) out.push({ tx: this.tx + dx, tz: this.tz + dz });
    return out;
  }

  workSpot(world, fromTx, fromTz) {
    // nearest reachable adjacent tile (or inside for walkable buildings)
    let best = null, bestD = Infinity;
    for (let dz = -1; dz <= this.h; dz++) {
      for (let dx = -1; dx <= this.w; dx++) {
        if (dx >= 0 && dx < this.w && dz >= 0 && dz < this.h) {
          if (!this.def.walkable) continue;
        }
        const tx = this.tx + dx, tz = this.tz + dz;
        if (!world.isWalkable(tx, tz)) continue;
        const d = Math.hypot(tx - fromTx, tz - fromTz);
        if (d < bestD) { bestD = d; best = { tx, tz }; }
      }
    }
    return best;
  }

  complete(world, particles) {
    if (this.state === 'built') return;
    this.state = 'built';
    this.progress = 1;
    if (this.model) this.group.remove(this.model);
    this.model = buildModel(this.type, this, world);
    this.group.add(this.model);
    this.anim = 0;
    this.group.scale.setScalar(0.72);
    if (particles) particles.sparkle(this.center.x, this.center.y + 0.2, this.center.z, 16);
  }

  setHighlight(on) {
    if (on && !this.highlight) {
      const w = this.w + 0.16, h = this.h + 0.16;
      const g = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: 0xf0c07c, transparent: true, opacity: 0.85, depthWrite: false });
      for (const [x, z, sx, sz] of [[0, -h / 2, w, 0.055], [0, h / 2, w, 0.055], [-w / 2, 0, 0.055, h], [w / 2, 0, 0.055, h]]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.025, sz), mat);
        m.position.set(x, 0.06, z);
        g.add(m);
      }
      g.position.copy(this.group.position);
      this.highlight = g;
      this.world.group.add(g);
    } else if (!on && this.highlight) {
      this.world.group.remove(this.highlight);
      this.highlight.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
      this.highlight = null;
    }
  }

  update(dt, time, colony, particles, dayFactor) {
    // completion pop
    if (this.state === 'built' && this.anim < 1) {
      this.anim = Math.min(1, this.anim + dt * 3);
      const t = this.anim;
      const s = 0.72 + 0.28 * (1 - Math.pow(1 - t, 3)) + Math.sin(t * Math.PI) * 0.045;
      this.group.scale.setScalar(s);
      if (this.anim >= 1) this.group.scale.setScalar(1);
    }

    if (this.type === 'campfire' || this.type === 'torch') {
      this.updateFire(dt, time, colony, particles, dayFactor);
    } else if (this.type === 'beacon') {
      this.updateBeacon(dt, time);
    }

    if (this.type === 'door' && this.doorPivot) {
      let near = false;
      for (const c of colony.colonists) {
        if (Math.hypot(c.x - this.x, c.z - this.z) < 1.5) { near = true; break; }
      }
      this.doorOpen = damp(this.doorOpen, near ? 1 : 0, 8, dt);
      this.doorPivot.rotation.y = -this.doorOpen * 1.42;
    }

    if (this.type === 'farm' && this.farmCrops) {
      this.growth = Math.min(1, this.growth + dt * 0.0034 * (colony.weather?.growth ?? 1));
      const t = this.growth;
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const pos = new THREE.Vector3();
      const scl = new THREE.Vector3();
      const color = new THREE.Color();
      for (let i = 0; i < 9; i++) {
        const row = Math.floor(i / 3), col = i % 3;
        const bx = (col - 1) * 0.82, bz = (row - 1) * 0.82;
        const s = 0.28 + t * 0.86;
        pos.set(bx, 0.035, bz);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (i * 1.7 + this.seed) % TAU);
        scl.set(s, s, s);
        m.compose(pos, q, scl);
        this.farmCrops.setMatrixAt(i, m);
        color.setHSL(0.22 + t * 0.03, 0.42, 0.32 + t * 0.22);
        if (t > 0.94) color.setHSL(0.12, 0.55, 0.55);
        this.farmCrops.setColorAt(i, color);
      }
      this.farmCrops.instanceMatrix.needsUpdate = true;
      if (this.farmCrops.instanceColor) this.farmCrops.instanceColor.needsUpdate = true;
    }
  }

  updateFire(dt, time, colony, particles, dayFactor) {
    if (!this.flames) return;
    this.flicker += dt * 9;
    const flick = 0.86 + Math.sin(time * 11 + this.seed) * 0.09 + Math.sin(time * 23 + this.seed * 2) * 0.05;
    const isTorch = this.type === 'torch';
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i];
      const ph = time * (8 + i * 3) + this.seed + i * 2;
      f.scale.set(
        f.userData.baseX * (0.9 + Math.sin(ph) * 0.12),
        f.userData.baseY * flick * (0.92 + Math.sin(ph * 0.7 + 1) * 0.1),
        f.userData.baseZ * (0.9 + Math.cos(ph * 0.8) * 0.12),
      );
      f.rotation.y += dt * (1.1 + i * 0.4);
      f.position.x = f.userData.ox + Math.sin(ph * 0.6) * 0.025;
      f.position.z = f.userData.oz + Math.cos(ph * 0.5) * 0.025;
    }
    if (this.fireLight) {
      this.fireLight.intensity = (isTorch ? 5 : 12) * (0.72 + 0.28 * (1 - dayFactor)) * flick;
      this.fireLight.position.y = isTorch ? 1.75 : 0.85;
    }
    if (this.glow) this.glow.material.opacity = (isTorch ? 0.45 : 0.62) * flick * (0.55 + 0.45 * (1 - dayFactor));
    this.smokeT -= dt;
    if (this.smokeT <= 0 && particles) {
      this.smokeT = isTorch ? 0.3 : 0.12;
      const originY = this.group.position.y + (isTorch ? 1.85 : 0.5);
      particles.smoke(this.group.position.x, originY, this.group.position.z, 1, isTorch ? 0.4 : 1, colony.windX || 0.08);
      if (!isTorch && Math.random() < 0.75) particles.fireEmbers(this.group.position.x, originY - 0.2, this.group.position.z, 1);
    }
  }

  updateBeacon(dt, time) {
    if (this.crystal) {
      this.crystal.rotation.y += dt * 0.8;
      this.crystal.position.y = this.crystal.userData.baseY + Math.sin(time * 1.4) * 0.06;
      this.crystal.material.emissiveIntensity = 1.2 + Math.sin(time * 2) * 0.35;
    }
    if (this.beam) {
      this.beam.material.opacity = 0.08 + Math.sin(time * 0.8) * 0.025;
    }
    if (this.beaconLight) {
      this.beaconLight.intensity = 4 + Math.sin(time * 2.2) * 1.2;
    }
  }

  destroy() {
    this.world.group.remove(this.group);
    this.setHighlight(false);
    for (const t of this.footTiles) this.world.buildingBlocked[this.world.idx(t.tx, t.tz)] = 0;
    this.group.traverse(o => { o.geometry?.dispose?.(); });
  }
}

function makeBlueprint(building, world) {
  const g = new THREE.Group();
  const w = building.w - 0.08, d = building.h - 0.08;
  const h = building.type === 'wall' || building.type === 'stonewall' ? 1.45 : building.type === 'beacon' ? 3.6 : 0.9;
  const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), MAT.blueprint);
  box.position.y = h / 2;
  g.add(box);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)), MAT.blueprintEdge);
  edges.position.y = h / 2;
  g.add(edges);
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: 0x7fd4c8, transparent: true, opacity: 0.16, depthWrite: false }));
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.04;
  g.add(pad);
  return g;
}

function buildModel(type, b, world) {
  const g = new THREE.Group();
  switch (type) {
    case 'wall': buildWall(g, false); break;
    case 'stonewall': buildWall(g, true); break;
    case 'door': buildDoor(g, b); break;
    case 'floor': buildFloor(g); break;
    case 'bed': buildBed(g); break;
    case 'campfire': buildCampfire(g, b, world); break;
    case 'table': buildTable(g); break;
    case 'farm': buildFarm(g, b); break;
    case 'storage': buildStorage(g, b); break;
    case 'torch': buildTorch(g, b); break;
    case 'beacon': buildBeacon(g, b); break;
    default: buildWall(g, false);
  }
  g.traverse(o => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
  return g;
}

function buildWall(g, stone) {
  const mat = stone ? MAT.stone : MAT.wood;
  const base = addBox(g, 0.96, 0.24, 0.96, MAT.stoneDark, 0, 0.12, 0, 0.035);
  const body = addBox(g, 0.88, 1.24, 0.88, mat, 0, 0.76, 0, 0.05);
  const top = addBox(g, 1.0, 0.1, 1.0, stone ? MAT.stoneLight : MAT.woodDark, 0, 1.42, 0, 0.03);
  if (!stone) {
    // corner posts give the wall a crafted look
    for (const [x, z] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) {
      addBox(g, 0.1, 1.32, 0.1, MAT.woodDark, x, 0.82, z, 0.025);
    }
  } else {
    for (let i = 0; i < 3; i++) {
      const m = addBox(g, 0.09, 0.03, 0.9, MAT.stoneDark, 0, 0.35 + i * 0.3, 0, 0.01);
      m.material = MAT.stoneDark;
    }
  }
}

function buildDoor(g, b) {
  addBox(g, 0.16, 1.5, 0.9, MAT.woodDark, -0.42, 0.75, 0, 0.03);
  addBox(g, 0.16, 1.5, 0.9, MAT.woodDark, 0.42, 0.75, 0, 0.03);
  addBox(g, 1.0, 0.14, 0.9, MAT.woodDark, 0, 1.46, 0, 0.03);
  const pivot = new THREE.Group();
  pivot.position.set(-0.32, 0, 0);
  const panel = addBox(pivot, 0.62, 1.28, 0.08, MAT.wood, 0.34, 0.68, 0, 0.025);
  const frame = addBox(pivot, 0.72, 0.1, 0.1, MAT.woodDark, 0.34, 1.32, 0, 0.02);
  const brace = addBox(pivot, 0.6, 0.08, 0.1, MAT.woodDark, 0.34, 0.74, 0, 0.02);
  brace.rotation.z = 0.5;
  const handle = addBox(pivot, 0.05, 0.05, 0.12, MAT.gold, 0.58, 0.7, 0.02, 0.02);
  const hingeA = addBox(pivot, 0.05, 0.1, 0.14, MAT.metalDark, 0.02, 1.05, 0, 0.01);
  const hingeB = addBox(pivot, 0.05, 0.1, 0.14, MAT.metalDark, 0.02, 0.35, 0, 0.01);
  g.add(pivot);
  b.doorPivot = pivot;
}

function buildFloor(g) {
  const m = addBox(g, 0.99, 0.07, 0.99, MAT.woodLight, 0, 0.035, 0, 0.012);
  m.material = MAT.wood;
  // subtle seam strips
  for (const x of [-0.22, 0.22]) addBox(g, 0.012, 0.012, 0.96, MAT.woodDark, x, 0.075, 0, 0.004);
}

function buildBed(g) {
  addBox(g, 0.84, 0.16, 1.76, MAT.woodDark, 0, 0.24, 0, 0.03);
  addBox(g, 0.06, 0.54, 1.76, MAT.woodDark, -0.45, 0.52, 0, 0.025);
  addBox(g, 0.06, 0.34, 1.76, MAT.woodDark, 0.45, 0.4, 0, 0.025);
  addBox(g, 0.84, 0.62, 0.07, MAT.woodDark, 0, 0.56, -0.87, 0.03);
  addBox(g, 0.7, 0.14, 1.56, MAT.clothCream, 0, 0.38, 0.03, 0.06);
  addBox(g, 0.68, 0.07, 0.92, MAT.clothRed, 0, 0.47, 0.3, 0.05);
  addBox(g, 0.68, 0.05, 0.12, MAT.clothRed, 0, 0.49, -0.2, 0.02);
  addBox(g, 0.58, 0.1, 0.24, MAT.cloth, 0, 0.5, -0.58, 0.05);
  addBox(g, 0.74, 0.04, 0.06, MAT.woodDark, 0, 0.18, -0.8, 0.01);
  for (const [x, z] of [[-0.34, -0.68], [0.34, -0.68], [-0.34, 0.68], [0.34, 0.68]]) {
    addBox(g, 0.07, 0.18, 0.07, MAT.woodDark, x, 0.09, z, 0.015);
  }
}

function buildCampfire(g, b, world) {
  const stoneMat = MAT.stoneDark;
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU;
    const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.14, 0), stoneMat);
    s.position.set(Math.cos(a) * 0.43, 0.11, Math.sin(a) * 0.43);
    s.rotation.set(Math.random(), Math.random(), Math.random());
    s.scale.set(1, 0.75, 1.1);
    s.castShadow = true; s.receiveShadow = true;
    g.add(s);
  }
  const logGeo = cylGeo(0.075, 0.09, 0.58, 7);
  for (let i = 0; i < 4; i++) {
    const log = mesh(logGeo, MAT.log, Math.cos(i * 1.5) * 0.11, 0.2, Math.sin(i * 1.5) * 0.11);
    log.rotation.set(Math.PI / 2 - 0.22, i * 1.4, 0);
    g.add(log);
  }
  const flameGroup = new THREE.Group();
  flameGroup.position.y = 0.26;
  const colors = [0xff9d3d, 0xffc75e, 0xffe6a8];
  b.flames = [];
  for (let i = 0; i < 4; i++) {
    const h = 0.52 - i * 0.08;
    const mat = new THREE.MeshBasicMaterial({
      color: colors[i % 3], transparent: true, opacity: 0.82,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.17 - i * 0.025, h, 6), mat);
    f.position.set((i - 1.5) * 0.055, h / 2, (i % 2 - 0.5) * 0.04);
    f.userData = { baseX: 1, baseY: 1, baseZ: 1, ox: f.position.x, oz: f.position.z, i };
    f.renderOrder = 4;
    flameGroup.add(f);
    b.flames.push(f);
  }
  g.add(flameGroup);
  const glow = makeGlowSprite(0xffa64a, 0.6, 2.2);
  glow.position.y = 0.45;
  g.add(glow);
  b.glow = glow;
  const light = new THREE.PointLight(0xff9b4a, 11, 12, 1.8);
  light.position.y = 0.9;
  g.add(light);
  b.fireLight = light;
}

function buildTable(g) {
  addBox(g, 0.92, 0.1, 0.7, MAT.woodLight, 0, 0.6, 0, 0.035);
  for (const [x, z] of [[-0.34, -0.24], [0.34, -0.24], [-0.34, 0.24], [0.34, 0.24]]) {
    addBox(g, 0.09, 0.56, 0.09, MAT.woodDark, x, 0.3, z, 0.02);
  }
  addBox(g, 0.76, 0.04, 0.06, MAT.woodDark, 0, 0.4, 0.22, 0.01);
  // two little stools
  for (const z of [-0.62, 0.62]) {
    addCyl(g, 0.19, 0.22, 0.07, MAT.wood, 0, 0.33, z, 8);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU;
      const leg = addBox(g, 0.035, 0.3, 0.035, MAT.woodDark, Math.cos(a) * 0.12, 0.15, z + Math.sin(a) * 0.12, 0.01);
      leg.rotation.z = Math.cos(a) * 0.2;
      leg.rotation.x = Math.sin(a) * 0.2;
    }
  }
  // a bowl and a mug
  addCyl(g, 0.1, 0.07, 0.05, MAT.clothCream, -0.16, 0.68, 0.05, 10);
  addCyl(g, 0.04, 0.045, 0.09, MAT.metalDark, 0.2, 0.7, -0.05, 7);
}

function buildFarm(g, b) {
  const soil = new THREE.Mesh(new THREE.BoxGeometry(2.96, 0.08, 2.96), MAT.soil);
  soil.position.y = 0.03;
  soil.receiveShadow = true;
  g.add(soil);
  const railMat = MAT.woodDark;
  for (const [x, z, w, d] of [[0, -1.48, 3.0, 0.08], [0, 1.48, 3.0, 0.08], [-1.48, 0, 0.08, 3.0], [1.48, 0, 0.08, 3.0]]) {
    addBox(g, w, 0.12, d, railMat, x, 0.16, z, 0.02);
  }
  for (const [x, z] of [[-1.42, -1.42], [1.42, -1.42], [-1.42, 1.42], [1.42, 1.42]]) {
    addBox(g, 0.12, 0.36, 0.12, MAT.woodDark, x, 0.18, z, 0.025);
  }
  const cropMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
  const inst = new THREE.InstancedMesh(cropGeoCache(), cropMat, 9);
  inst.castShadow = true;
  inst.receiveShadow = true;
  const wPos = worldPosOfBuilding(b);
  inst.position.set(0, 0.03, 0);
  inst.userData.wind = true;
  b.farmCrops = inst;
  g.add(inst);
}

function buildStorage(g, b) {
  // pallet
  addBox(g, 1.86, 0.07, 1.86, MAT.woodDark, 0, 0.035, 0, 0.01);
  for (let i = 0; i < 6; i++) addBox(g, 1.86, 0.035, 0.1, MAT.wood, 0, 0.08, -0.8 + i * 0.32, 0.008);
  // crates
  const crateMat = MAT.wood;
  const makeCrate = (x, z, s, ry) => {
    const c = new THREE.Group();
    addBox(c, s, s, s, crateMat, 0, s / 2 + 0.06, 0, 0.02);
    addBox(c, s * 1.02, 0.07, s * 1.02, MAT.woodDark, 0, s * 0.55, 0, 0.01);
    addBox(c, 0.03, s * 0.9, s * 1.01, MAT.woodDark, 0, s / 2 + 0.06, 0, 0.005);
    c.position.set(x, 0, z);
    c.rotation.y = ry;
    g.add(c);
  };
  makeCrate(-0.48, -0.4, 0.5, 0.2);
  makeCrate(0.36, -0.5, 0.42, -0.3);
  makeCrate(-0.36, 0.42, 0.44, 0.5);
  // log pile
  const logGeo = cylGeo(0.1, 0.12, 0.8, 7);
  const logMat = MAT.log;
  for (let i = 0; i < 4; i++) {
    const l = mesh(logGeo, logMat, 0.48, 0.16 + (i > 1 ? 0.16 : 0), 0.32 + (i % 2) * 0.2);
    l.rotation.z = Math.PI / 2;
    l.rotation.y = 0.15;
    g.add(l);
  }
  // stone heap
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.13, 0), MAT.stone);
    s.position.set(0.55 + (i % 2) * 0.2, 0.12, -0.12 + Math.floor(i / 2) * 0.2);
    s.rotation.set(i, i * 2, i);
    s.scale.set(1, 0.8, 1);
    s.castShadow = true;
    g.add(s);
  }
  // little lantern
  addBox(g, 0.07, 0.28, 0.07, MAT.metalDark, -0.84, 0.2, -0.84, 0.01);
  const lamp = addBox(g, 0.12, 0.14, 0.12, new THREE.MeshStandardMaterial({ color: 0xffd08a, emissive: 0xff9d3d, emissiveIntensity: 1.4 }), -0.84, 0.37, -0.84, 0.03);
  b.lantern = lamp;
}

function buildTorch(g, b) {
  addBox(g, 0.16, 0.2, 0.16, MAT.stoneDark, 0, 0.1, 0, 0.03);
  addCyl(g, 0.045, 0.06, 1.45, MAT.woodDark, 0, 0.82, 0, 7);
  addBox(g, 0.24, 0.06, 0.24, MAT.metalDark, 0, 1.5, 0, 0.02);
  const basket = addCyl(g, 0.13, 0.08, 0.16, MAT.metalDark, 0, 1.6, 0, 7);
  const flameGroup = new THREE.Group();
  flameGroup.position.y = 1.66;
  b.flames = [];
  const colors = [0xff9d3d, 0xffcf70, 0xffeeb8];
  for (let i = 0; i < 3; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: colors[i], transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.075 - i * 0.012, 0.3 - i * 0.03, 5), mat);
    f.position.set((i - 1) * 0.025, 0.15, (i % 2) * 0.02);
    f.userData = { baseX: 1, baseY: 1, baseZ: 1, ox: f.position.x, oz: f.position.z, i };
    flameGroup.add(f);
    b.flames.push(f);
  }
  g.add(flameGroup);
  const glow = makeGlowSprite(0xffad5a, 0.5, 1.1);
  glow.position.y = 1.8;
  g.add(glow);
  b.glow = glow;
  const light = new THREE.PointLight(0xffa858, 4, 8, 1.9);
  light.position.y = 1.85;
  g.add(light);
  b.fireLight = light;
}

function buildBeacon(g, b) {
  // stone plinth
  addCyl(g, 0.74, 0.9, 0.28, MAT.stone, 0, 0.14, 0, 8);
  addCyl(g, 0.5, 0.64, 0.24, MAT.stoneDark, 0, 0.36, 0, 8);
  // four legs
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    const leg = addBox(g, 0.1, 1.7, 0.1, MAT.woodDark, Math.cos(a) * 0.42, 1.3, Math.sin(a) * 0.42, 0.02);
    leg.rotation.z = Math.cos(a) * -0.05;
    leg.rotation.x = Math.sin(a) * 0.05;
  }
  // platform
  addBox(g, 1.2, 0.12, 1.2, MAT.wood, 0, 2.2, 0, 0.03);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    addBox(g, 0.05, 0.5, 0.05, MAT.metalDark, Math.cos(a) * 0.44, 2.5, Math.sin(a) * 0.44, 0.01);
  }
  // crystal
  const crystalMat = new THREE.MeshStandardMaterial({
    color: 0xa8f2dd, emissive: 0x35c9a8, emissiveIntensity: 1.4, roughness: 0.2, metalness: 0.2,
    transparent: true, opacity: 0.94,
  });
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), crystalMat);
  crystal.position.y = 2.72;
  crystal.userData.baseY = 2.72;
  crystal.castShadow = false;
  g.add(crystal);
  b.crystal = crystal;
  const halo = makeGlowSprite(0x6ff0cf, 0.7, 1.6);
  halo.position.y = 2.72;
  g.add(halo);
  const light = new THREE.PointLight(0x58e6c4, 4, 14, 1.6);
  light.position.y = 2.8;
  g.add(light);
  b.beaconLight = light;
  // vertical beam
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.42, 13, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x6ff0cf, transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  beam.position.y = 9.2;
  g.add(beam);
  b.beam = beam;
}

function worldPosOfBuilding(b) {
  return b.world.worldPos(b.tx + (b.w - 1) / 2, b.tz + (b.h - 1) / 2);
}
