import * as THREE from 'three';
import { Building, BUILDINGS } from './buildings.js';
import { Colonist, Deer } from './entities.js';
import { MAT, mesh, cylGeo, sphereGeo, boxGeo } from './materials.js';
import { TAU, clamp, makeRng, smoothstep } from './utils.js';

const rng = makeRng(9128);
const DAY_LENGTH = 480; // seconds at 1x

const COLONIST_DEFS = [
  {
    id: 0, name: 'Mara', role: 'Carpenter', skills: { build: 5, chop: 3, mine: 2, farm: 2 },
    skin: 0xe3b38b, hair: 0x7a4b2a, shirt: 0x9c5547, pants: 0x4a533f, accent: 0xd9a353,
    hairStyle: 1, traits: ['Steady hands', 'Early riser'], speed: 1.62,
  },
  {
    id: 1, name: 'Ivo', role: 'Forester', skills: { build: 2, chop: 5, mine: 2, farm: 2 },
    skin: 0xc98d63, hair: 0x3a2a1e, shirt: 0x4d7570, pants: 0x3b4039, accent: 0xc98a3a,
    hairStyle: 0, traits: ['Woodsman', 'Hearty'], speed: 1.55,
  },
  {
    id: 2, name: 'Sena', role: 'Grower', skills: { build: 1, chop: 2, mine: 1, farm: 5 },
    skin: 0xf0c6a1, hair: 0xcfc1a1, shirt: 0xb08a45, pants: 0x4a4038, accent: 0x7a8f5a,
    hairStyle: 2, traits: ['Green thumb', 'Gentle'], speed: 1.5,
  },
  {
    id: 3, name: 'Kai', role: 'Prospector', skills: { build: 2, chop: 2, mine: 5, farm: 1 },
    skin: 0x8f5f42, hair: 0x1f1b18, shirt: 0x46607a, pants: 0x33372f, accent: 0xb85c4a,
    hairStyle: 3, traits: ['Stonewise', 'Wanderer'], speed: 1.58,
  },
];

export class Colony {
  constructor(world, particles, scene) {
    this.world = world;
    this.particles = particles;
    this.scene = scene;
    this.resources = { wood: 92, stone: 54, food: 26, silver: 12 };
    this.colonists = [];
    this.buildings = [];
    this.groundItems = [];
    this.designations = new Set();
    this.animals = [];
    this.selected = null;
    this.selectedBuilding = null;
    this.day = 1;
    this.hour = 7.35;
    this.timeScale = 1;
    this.dayLength = DAY_LENGTH;
    this.time = 0;
    this.weather = { type: 'Clear', wind: 0.12, growth: 1 };
    this.stats = { harvested: 0, meals: 0, built: 0, chopped: 0, mined: 0, days: 1 };
    this.logs = [];
    this.objectives = [];
    this.eventFlags = new Set();
    this.thinkTimer = 0;
    this.toastQueue = [];
    this.floatTexts = [];
    this.ui = null;
    this.windX = 0.12;
    this.newColonistId = 4;
    this.completedObjectives = new Set();
    this.wandererJoined = false;
    this.rain = null;

    this.buildStartingCamp();
    this.spawnColonists();
    this.spawnStartingItems();
    this.spawnDeer();
    this.setupObjectives();
    this.assignBeds();
    this.markStartDesignation();
    this.log('The colony wakes to birdsong in the pines.', 'dawn');
    this.log('Three settlers, a kettle, and a valley full of timber.', 'story');

    // let the settlers get moving right away
    setTimeout(() => {
      for (const c of this.colonists) this.think(c, true);
    }, 350);
  }

  // ── setup ────────────────────────────────────────────────
  addBuilding(type, tx, tz, opts = {}) {
    for (let dz = 0; dz < BUILDINGS[type].size[1]; dz++) {
      for (let dx = 0; dx < BUILDINGS[type].size[0]; dx++) {
        if (!this.world.isBuildable(tx + dx, tz + dz)) {
          // still allow prebuilt structures on dirt if flat
          if (!this.world.isFlat(tx + dx, tz + dz) || this.world.typeAt(tx + dx, tz + dz) === 3) return null;
          if (this.world.buildingBlocked[this.world.idx(tx + dx, tz + dz)]) return null;
        }
      }
    }
    const b = new Building(type, tx, tz, this.world, opts);
    this.buildings.push(b);
    if (opts.built) this.stats.built++;
    return b;
  }

  buildStartingCamp() {
    // plank floor of the open cabin
    for (let z = 22; z <= 24; z++) {
      for (let x = 21; x <= 24; x++) this.addBuilding('floor', x, z, { built: true });
    }
    // three-sided cabin
    for (let x = 20; x <= 25; x++) this.addBuilding('wall', x, 21, { built: true });
    for (let z = 22; z <= 24; z++) {
      this.addBuilding('wall', 20, z, { built: true });
      this.addBuilding('wall', 25, z, { built: true });
    }
    this.addBuilding('bed', 21, 22, { built: true });
    this.addBuilding('bed', 23, 22, { built: true });
    this.addBuilding('torch', 24, 25, { built: true });
    // camp core
    this.addBuilding('campfire', 27, 27, { built: true });
    this.addBuilding('storage', 29, 24, { built: true });
    this.addBuilding('table', 27, 30, { built: true });
    const farm = this.addBuilding('farm', 22, 29, { built: true, growth: 0.97 });
    this.addBuilding('torch', 30, 29, { built: true });
    this.addBuilding('torch', 24, 26, { built: true });
    this.initialFarm = farm;
  }

  spawnColonists() {
    const spawn = [
      [1.4, 0.4], [-0.5, 1.2], [2.4, 2.4],
    ];
    for (let i = 0; i < 3; i++) {
      const def = COLONIST_DEFS[i];
      const c = new Colonist(this, {
        ...def, x: spawn[i][0], z: spawn[i][1],
        hunger: [72, 58, 84][i], rest: [88, 74, 92][i], joy: [70, 64, 78][i],
      });
      this.colonists.push(c);
    }
  }

  spawnWanderer() {
    if (this.wandererJoined) return;
    this.wandererJoined = true;
    const def = COLONIST_DEFS[3];
    const c = new Colonist(this, {
      ...def, id: this.newColonistId++, x: 5.2, z: 4.2,
      hunger: 46, rest: 62, joy: 58,
    });
    this.colonists.push(c);
    this.assignBeds();
    this.log(`${c.name} the prospector arrives from the high ridge.`, 'join');
    this.toast(`${c.name} joined the colony`, 'join');
    this.particles.sparkle(c.x, c.y + 1, c.z, 24);
    this.think(c, true);
    if (this.ui) this.ui.refreshColonists();
  }

  spawnStartingItems() {
    this.spawnGroundItem('wood', 8, 29, 26, 'logs');
    this.spawnGroundItem('wood', 9, 25, 29, 'logs');
    this.spawnGroundItem('stone', 7, 30, 31, 'stone');
    this.spawnGroundItem('stone', 6, 21, 26, 'stone');
    this.spawnGroundItem('food', 6, 26, 25, 'crops');
  }

  spawnGroundItem(resource, amount, tx, tz, visual) {
    const group = new THREE.Group();
    if (visual === 'logs') {
      for (let i = 0; i < 3; i++) {
        const l = mesh(cylGeo(0.075, 0.09, 0.62, 7), MAT.log, (i % 2) * 0.12, 0.09 + Math.floor(i / 2) * 0.14, (i - 1) * 0.1);
        l.rotation.z = Math.PI / 2;
        l.rotation.y = rng.range(-0.2, 0.2);
        group.add(l);
      }
    } else if (visual === 'stone') {
      for (let i = 0; i < 5; i++) {
        const s = new THREE.Mesh(new THREE.DodecahedronGeometry(rng.range(0.1, 0.17), 0), MAT.stone);
        s.position.set(rng.range(-0.18, 0.18), rng.range(0.07, 0.15), rng.range(-0.18, 0.18));
        s.rotation.set(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3));
        s.castShadow = true;
        group.add(s);
      }
    } else {
      const basket = mesh(cylGeo(0.17, 0.13, 0.18, 9), MAT.woodLight, 0, 0.09, 0);
      group.add(basket);
      for (let i = 0; i < 7; i++) {
        const c = mesh(new THREE.ConeGeometry(0.035, 0.34, 4), i % 2 ? MAT.cropGold : MAT.crop, rng.range(-0.1, 0.1), 0.3, rng.range(-0.1, 0.1));
        c.rotation.z = rng.range(-0.3, 0.3);
        group.add(c);
      }
    }
    const y = this.world.groundHeight(tx, tz);
    group.position.set(tx - this.world.half + 0.5, y + 0.04, tz - this.world.half + 0.5);
    group.rotation.y = rng.range(0, TAU);
    group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.world.group.add(group);
    const item = {
      id: `item-${tx}-${tz}-${this.groundItems.length}`, resource, amount, visual,
      tx, tz, x: group.position.x, z: group.position.z, y,
      group, removed: false, claimedBy: null, phase: rng.range(0, TAU),
    };
    this.groundItems.push(item);
    return item;
  }

  pickUpItem(item) {
    if (!item || item.removed) return;
    item.removed = true;
    item.claimedBy = null;
    this.world.group.remove(item.group);
    this.groundItems = this.groundItems.filter(i => i !== item);
  }

  spawnDeer() {
    const spots = [[-10, 12], [12, -9], [-13, -12]];
    for (const [x, z] of spots) {
      const d = new Deer(this.world, x, z);
      this.animals.push(d);
    }
  }

  markStartDesignation() {
    const camp = this.world.worldPos(27, 27);
    let best = null, bd = 999;
    for (const t of this.world.trees) {
      if (t.removed) continue;
      const d = Math.hypot(t.x - camp.x, t.z - camp.z);
      if (d < bd) { bd = d; best = t; }
    }
    if (best) this.markDesignation(best, 'chop', false);
  }

  setupObjectives() {
    this.objectives = [
      { id: 'bed', label: 'Craft a third settler bed', target: 1, get: () => Math.max(0, this.buildings.filter(b => b.type === 'bed' && b.state === 'built').length - 2) },
      { id: 'farm', label: 'Plant a second crop plot', target: 1, get: () => Math.max(0, this.buildings.filter(b => b.type === 'farm' && b.state === 'built').length - 1) },
      { id: 'food', label: `Harvest ${20} food`, target: 20, get: () => this.stats.harvested },
      { id: 'beacon', label: 'Raise the signal beacon', target: 1, get: () => this.buildings.filter(b => b.type === 'beacon' && b.state === 'built').length },
    ];
    this.objectives.forEach(o => o.done = false);
  }

  checkObjectives() {
    for (const o of this.objectives) {
      if (!o.done && o.get() >= o.target) {
        o.done = true;
        this.completedObjectives.add(o.id);
        this.log(`Objective complete — ${o.label}.`, 'objective');
        this.toast(`Objective complete: ${o.label}`, 'star');
        this.particles.sparkle(this.world.worldPos(27, 27).x, 2, this.world.worldPos(27, 27).z, 20);
      }
    }
    if (this.objectives.every(o => o.done) && !this.completedObjectives.has('all')) {
      this.completedObjectives.add('all');
      this.log('Ridgewood is no longer a camp. It is a home.', 'story');
      this.toast('Ridgewood has become a home', 'star');
    }
  }

  assignBeds() {
    const beds = this.buildings.filter(b => b.type === 'bed' && b.state === 'built');
    beds.forEach(b => { b.occupant = null; });
    for (const c of this.colonists) c.bed = null;
    for (const bed of beds) {
      let best = null, bd = Infinity;
      for (const c of this.colonists) {
        if (c.bed) continue;
        const d = Math.hypot(c.x - bed.x, c.z - bed.z);
        if (d < bd) { bd = d; best = c; }
      }
      if (best) { best.bed = bed; bed.occupant = best; }
    }
  }

  onBuildingComplete(b) {
    this.stats.built++;
    if (b.type === 'bed') {
      this.assignBeds();
      this.log(`${b.def.name} finished. A warm place to sleep.`, 'build');
      this.toast('Bed complete — a settler has a proper pillow', 'build');
    } else if (b.type === 'beacon') {
      this.log('The signal beacon hums to life. Its light climbs into the clouds.', 'story');
      this.toast('Signal beacon online — wanderers will see it', 'star');
      this.particles.sparkle(b.x, b.y + 2.6, b.z, 30);
      setTimeout(() => this.spawnWanderer(), 9000);
    } else if (b.type === 'farm') {
      b.growth = 0.06;
      this.log('A new crop plot is tilled and seeded.', 'build');
    } else if (b.type === 'campfire') {
      this.log('A new fire crackles to life.', 'build');
    }
    if (this.ui) this.ui.refreshObjectives();
    this.checkObjectives();
  }

  // ── time & update ───────────────────────────────────────
  update(realDt) {
    this.time += realDt;
    const dt = realDt * this.timeScale;
    this.hour += (dt * 24) / this.dayLength;
    while (this.hour >= 24) {
      this.hour -= 24;
      this.day++;
      this.stats.days = this.day;
      this.log(`Day ${this.day} dawns over the valley.`, 'dawn');
      this.toast(`Day ${this.day}`, 'sun');
      this.refreshWeather();
    }

    if (dt > 0) {
      this.thinkTimer -= dt;
      for (const c of this.colonists) c.update(dt, this.time);
      if (this.thinkTimer <= 0) {
        this.thinkTimer = 0.65;
        for (const c of this.colonists) if (!c.task) this.think(c);
      }
      this.updateEvents();
    } else {
      // pause: ambient character idling still breathes
      for (const c of this.colonists) c.animate(realDt, this.time);
    }
    for (const b of this.buildings) b.update(realDt, this.time, this, this.particles, this.world.dayFactor);
    for (const d of this.animals) d.update(realDt, this.colonists);
    this.updateGroundItems(realDt);
    this.checkObjectives();
    this.refreshAlerts();
  }

  updateGroundItems(dt) {
    for (const item of this.groundItems) {
      if (!item.group) continue;
      item.group.position.y = item.y + 0.04 + Math.sin(this.time * 1.2 + item.phase) * 0.006;
    }
  }

  refreshWeather() {
    const r = rng.next();
    if (r < 0.22) this.weather = { type: 'Rain', wind: 0.35, growth: 1.35 };
    else if (r < 0.6) this.weather = { type: 'Clear', wind: 0.12, growth: 1 };
    else this.weather = { type: 'Breezy', wind: 0.26, growth: 1.1 };
    this.windX = this.weather.wind;
    if (this.weather.type === 'Rain') {
      this.log('Rain sweeps the valley. The crops drink deep.', 'weather');
      this.toast('Rain — crops grow faster today', 'rain');
    }
  }

  updateEvents() {
    const flag = (k) => {
      if (this.eventFlags.has(k)) return false;
      this.eventFlags.add(k);
      return true;
    };
    if (this.day === 1 && this.hour >= 11.3 && flag('trader')) {
      this.addResource('wood', 12);
      this.addResource('food', 5);
      this.log('A trader stops at the treeline and trades stories for a meal.', 'event');
      this.toast('A trader left 12 timber and 5 food', 'gift');
    }
    if (this.day === 2 && this.hour >= 8.3 && flag('kai')) {
      this.spawnWanderer();
    }
    if (this.day === 2 && this.hour >= 14.5 && flag('pod')) {
      this.addResource('stone', 24);
      this.addResource('silver', 8);
      const p = this.world.worldPos(31, 20);
      this.particles.smoke(p.x, p.y + 0.4, p.z, 8, 1.4, 0.1);
      this.toast('A supply pod tumbled out of the sky — 24 stone, 8 silver', 'gift');
      this.log('A supply pod cracked open near the northern ridge.', 'event');
    }
    if (this.day === 3 && this.hour >= 9 && flag('rainy')) {
      this.weather = { type: 'Rain', wind: 0.34, growth: 1.35 };
      this.log('Soft rain settles over Ridgewood.', 'weather');
    }
  }

  // ── intelligent work choice ─────────────────────────────
  think(c, force = false) {
    if (!c || c.task) return;
    const hour = this.hour;

    // survival first
    if (c.hunger < 34 && this.resources.food > 0) {
      if (c.beginEat()) { this.toastOnce(`${c.name} is hungry`, `hungry-${c.id}`, 'food'); return; }
    }
    if ((c.rest < 22 || (hour >= 21.4 || hour < 5.8) && c.rest < 94)) {
      if (this.startSleepFor(c)) return;
    }

    const work = this.chooseWork(c);
    if (work) {
      const ok = work.type === 'farm' ? c.beginHarvest(work.target)
        : work.type === 'chop' ? c.beginChop(work.target)
        : work.type === 'mine' ? c.beginMine(work.target)
        : work.type === 'build' ? c.beginBuild(work.target)
        : work.type === 'haul' ? c.beginHaul(work.target)
        : false;
      if (ok) return;
    }

    if (c.hunger < 52 && this.resources.food > 0) {
      if (c.beginEat()) return;
    }
    if (c.rest < 45) {
      if (this.startSleepFor(c)) return;
    }
    if (hour >= 18 && hour < 22.5 && c.joy < 86 && (hour >= 19.5 || force)) {
      if (c.beginRelax()) return;
    }
    if (hour >= 22.4 || hour < 5.8) {
      if (this.startSleepFor(c)) return;
    }
    if (c.joy < 35 && this.nearFire(c)) {
      c.joy = Math.min(100, c.joy + 6);
    }
    // idle: stay near the fire, or wander a little
    if (rng.chance(0.6)) c.beginRelax(this.nearestCampfireSpot(c));
    else c.beginWander(this.randomIdleSpot(c), rng.range(3, 6));
  }

  chooseWork(c) {
    let best = null, bestScore = Infinity;
    const center = this.world.worldPos(27, 27);
    const dist = (x, z) => Math.hypot(x - c.x, z - c.z);

    // construction gets first look
    for (const b of this.buildings) {
      if (b.state !== 'blueprint' || b.claimedBy) continue;
      const d = dist(b.x, b.z) - (c.skills.build || 1) * 0.55 - 7;
      if (d < bestScore) { bestScore = d; best = { type: 'build', target: b, score: d }; }
    }

    for (const b of this.buildings) {
      if (b.type !== 'farm' || b.growth < 0.94 || b.claimedBy || b.state !== 'built') continue;
      const d = dist(b.x, b.z) - (c.skills.farm || 1) * 0.7 - 3;
      if (d < bestScore) { bestScore = d; best = { type: 'farm', target: b, score: d }; }
    }

    for (const item of this.groundItems) {
      if (item.removed || item.claimedBy) continue;
      let d = dist(item.x, item.z);
      if (d > 22) continue;
      d -= 1.5;
      if (d < bestScore) { bestScore = d; best = { type: 'haul', target: item, score: d }; }
    }

    for (const t of this.world.trees) {
      if (t.removed || t.claimedBy || !this.designations.has(t)) continue;
      const d = dist(t.x, t.z) - (c.skills.chop || 1) * 0.55 - 2;
      if (d < bestScore) { bestScore = d; best = { type: 'chop', target: t, score: d }; }
    }
    for (const r of this.world.rocks) {
      if (r.removed || r.claimedBy || !this.designations.has(r)) continue;
      const d = dist(r.x, r.z) - (c.skills.mine || 1) * 0.55 - 2;
      if (d < bestScore) { bestScore = d; best = { type: 'mine', target: r, score: d }; }
    }
    // nobody should walk across the valley for a log while a campfire is waiting
    if (best && bestScore > 18) return null;
    return best;
  }

  giveJoy(c, amount = 1) {
    if (!c) return;
    c.joy = Math.min(100, c.joy + amount);
  }

  startSleepFor(c) {
    let bed = c.bed;
    if (bed) {
      const others = this.colonists.filter(o => o !== c && o.task?.type === 'sleep' && o.task.bed === bed);
      if (others.length) bed = null;
    }
    return c.beginSleep(bed);
  }

  // ── queries ─────────────────────────────────────────────
  nearFire(c) {
    for (const b of this.buildings) {
      if ((b.type === 'campfire' || b.type === 'torch') && Math.hypot(c.x - b.x, c.z - b.z) < 3.6) return true;
    }
    return false;
  }

  nearestTable(c) {
    let best = null, bd = Infinity;
    for (const b of this.buildings) {
      if (b.type !== 'table' || b.state !== 'built') continue;
      const d = Math.hypot(c.x - b.x, c.z - b.z);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  nearestCampfire(c) {
    let best = null, bd = Infinity;
    for (const b of this.buildings) {
      if (b.type !== 'campfire' || b.state !== 'built') continue;
      const d = Math.hypot(c.x - b.x, c.z - b.z);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  nearestCampfireSpot(c) {
    const fire = this.nearestCampfire(c);
    if (!fire) return this.randomIdleSpot(c);
    const spots = [];
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const tx = fire.tx + dx, tz = fire.tz + dz;
        if (!this.world.isWalkable(tx, tz)) continue;
        const d = Math.hypot(tx - fire.tx, tz - fire.tz);
        if (d < 1.2 || d > 2.5) continue;
        spots.push({ tx, tz });
      }
    }
    if (!spots.length) return this.randomIdleSpot(c);
    spots.sort((a, b) => Math.hypot(a.tx - c.tx, a.tz - c.tz) - Math.hypot(b.tx - c.tx, b.tz - c.tz));
    return spots[Math.floor(rng.next() * Math.min(3, spots.length))];
  }

  randomIdleSpot(c) {
    const fire = this.nearestCampfire(c);
    const cx = fire ? fire.tx : c.tx, cz = fire ? fire.tz : c.tz;
    for (let i = 0; i < 30; i++) {
      const tx = cx + Math.floor(rng.range(-4.5, 4.5));
      const tz = cz + Math.floor(rng.range(-4.5, 4.5));
      if (!this.world.isWalkable(tx, tz)) continue;
      if (Math.hypot(tx - cx, tz - cz) < 1.5) continue;
      return { tx, tz };
    }
    return this.nearestCampfireSpot(c);
  }

  getDepositSpot(c) {
    let best = null, bd = Infinity;
    for (const b of this.buildings) {
      if (!b.storage || b.state !== 'built') continue;
      for (let dz = 0; dz < b.h; dz++) {
        for (let dx = 0; dx < b.w; dx++) {
          const tx = b.tx + dx, tz = b.tz + dz;
          if (!this.world.isWalkable(tx, tz)) continue;
          const d = Math.hypot(tx - c.tx, tz - c.tz);
          if (d < bd) { bd = d; best = { tx, tz }; }
        }
      }
    }
    if (best) return best;
    return this.nearestCampfireSpot(c);
  }

  // ── resources & feedback ────────────────────────────────
  addResource(type, amount) {
    if (!(type in this.resources)) return;
    this.resources[type] = Math.max(0, Math.round((this.resources[type] + amount) * 10) / 10);
    if (type === 'food' && amount > 0) this.stats.harvested += amount;
    if (type === 'food' && amount < 0) this.stats.meals++;
    if (this.ui) this.ui.updateResources(this.resources, type);
  }

  canAfford(cost) {
    return Object.entries(cost).every(([k, v]) => this.resources[k] >= v);
  }

  spend(cost) {
    for (const [k, v] of Object.entries(cost)) this.resources[k] = Math.max(0, this.resources[k] - v);
    if (this.ui) this.ui.updateResources(this.resources);
  }

  markDesignation(target, kind, showToast = true) {
    if (!target || target.removed) return;
    if (this.designations.has(target)) {
      this.designations.delete(target);
      this.world.clearMarker(target);
      target.designated = false;
      return;
    }
    this.designations.add(target);
    target.designated = true;
    this.world.setMarker(target, kind);
    if (showToast) this.toast(kind === 'chop' ? 'Tree marked for chopping' : 'Rock marked for mining', 'order');
  }

  clearDesignation(target) {
    this.designations.delete(target);
    target.designated = false;
    this.world.clearMarker(target);
  }

  placeBuilding(type, tx, tz) {
    const def = BUILDINGS[type];
    if (!def) return { ok: false, reason: 'Unknown structure' };
    if (!this.canAfford(def.cost)) return { ok: false, reason: 'Not enough materials' };
    // validity
    for (let dz = 0; dz < def.size[1]; dz++) {
      for (let dx = 0; dx < def.size[0]; dx++) {
        if (!this.world.isBuildable(tx + dx, tz + dz)) {
          return { ok: false, reason: this.world.typeAt(tx + dx, tz + dz) === 3 ? 'Too wet to build there' : 'That ground is not clear' };
        }
        if (this.groundItems.some(i => !i.removed && Math.hypot(i.tx - (tx + dx), i.tz - (tz + dz)) < 0.2)) {
          return { ok: false, reason: 'Clear the supplies first' };
        }
      }
    }
    this.spend(def.cost);
    const b = new Building(type, tx, tz, this.world, { built: false });
    this.buildings.push(b);
    this.stats.built++;
    this.log(`${def.name} blueprint laid out.`, 'build');
    this.toast(`${def.name} blueprint placed`, 'build');
    for (const c of this.colonists) if (!c.task) this.think(c, true);
    if (this.ui) this.ui.refreshObjectives();
    return { ok: true, building: b };
  }

  removeBuilding(b) {
    b.destroy();
    this.buildings = this.buildings.filter(o => o !== b);
    for (const c of this.colonists) {
      if (c.bed === b) c.bed = null;
      if (c.task?.target === b) c.finishTask();
    }
    this.assignBeds();
  }

  getNearestTree(c, maxDist = 40) {
    let best = null, bd = maxDist;
    for (const t of this.world.trees) {
      if (t.removed) continue;
      const d = Math.hypot(t.x - c.x, t.z - c.z);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  getVisibleColonistAt(x, z, radius = 0.6) {
    let best = null, bd = radius;
    for (const c of this.colonists) {
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  getBuildingAt(tx, tz) {
    for (const b of this.buildings) {
      if (tx >= b.tx && tx < b.tx + b.w && tz >= b.tz && tz < b.tz + b.h) return b;
    }
    return null;
  }

  // ── notifications ───────────────────────────────────────
  log(text, kind = 'note') {
    this.logs.unshift({ text, kind, day: this.day, hour: this.hour });
    if (this.logs.length > 60) this.logs.length = 60;
    if (this.ui) this.ui.addLog(this.logs[0]);
  }

  toast(text, kind = 'note') {
    if (this.ui) this.ui.toast(text, kind);
    else this.toastQueue.push({ text, kind });
  }

  toastOnce(text, key, kind) {
    if (this.eventFlags.has(`toast-${key}`)) return;
    this.eventFlags.add(`toast-${key}`);
    this.toast(text, kind);
  }

  floatResource(x, y, z, type, amount) {
    if (this.ui) this.ui.floatResource(x, y, z, type, amount);
  }

  refreshAlerts() {
    if (this.ui) this.ui.refreshAlerts();
  }

  get timeString() {
    const h = Math.floor(this.hour) % 24;
    const m = Math.floor((this.hour % 1) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
