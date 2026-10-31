import * as THREE from 'three';
import { MAT, SKIN_TONES, HAIR_TONES, CLOTH_TONES, boxGeo, cylGeo, sphereGeo, mesh, addBox, addCyl } from './materials.js';
import { TAU, clamp, damp, lerp, makeRng, angleDamp, easeInOutSine } from './utils.js';
import { findPath, findNearestWalkable, adjacentTiles } from './pathfinding.js';

const rng = makeRng(4747);

function makeColonistMaterials(def) {
  const skin = new THREE.MeshStandardMaterial({ color: def.skin, roughness: 0.86 });
  const hair = new THREE.MeshStandardMaterial({ color: def.hair, roughness: 0.94, flatShading: true });
  const shirt = new THREE.MeshStandardMaterial({ color: def.shirt, roughness: 0.94 });
  const pants = new THREE.MeshStandardMaterial({ color: def.pants, roughness: 0.95 });
  const accent = new THREE.MeshStandardMaterial({ color: def.accent, roughness: 0.85 });
  const boots = new THREE.MeshStandardMaterial({ color: 0x3a2e23, roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x22251f, roughness: 0.85 });
  return { skin, hair, shirt, pants, accent, boots, dark };
}

export class Colonist {
  constructor(colony, def) {
    this.colony = colony;
    this.world = colony.world;
    this.id = def.id;
    this.name = def.name;
    this.role = def.role;
    this.skills = def.skills;
    this.skin = def.skin;
    this.hair = def.hair;
    this.shirt = def.shirt;
    this.pants = def.pants;
    this.accent = def.accent;
    this.hairStyle = def.hairStyle ?? 0;
    this.traits = def.traits ?? [];
    this.speed = def.speed ?? 1.55;

    this.x = def.x; this.z = def.z;
    const startTile = this.world.tileAt(def.x, def.z);
    this.tx = startTile.tx;
    this.tz = startTile.tz;
    this.y = this.world.groundHeight(this.tx, this.tz);
    this.path = [];
    this.pathIndex = 0;
    this.arrived = true;
    this.moving = false;
    this.facing = rng.range(0, TAU);
    this.targetFacing = this.facing;

    this.hunger = def.hunger ?? rng.range(66, 86);
    this.rest = def.rest ?? rng.range(72, 92);
    this.joy = def.joy ?? rng.range(56, 78);
    this.mood = 70;
    this.moodLabel = 'Content';
    this.hp = 100;

    this.task = null;
    this.activity = 'Settling in';
    this.selected = false;
    this.carrying = null;
    this.tool = null;
    this.walkPhase = rng.range(0, TAU);
    this.idleTime = 0;
    this.blink = rng.range(1, 4);
    this.footstep = 0;
    this.workParticleTimer = 0;
    this.claim = null;
    this.bed = null;
    this.sleepBlend = 0;
    this.baseSpeed = this.speed;
    this.sitting = false;
    this.priority = null;

    this.buildModel();
    this.root.position.set(this.x, this.y, this.z);
    this.root.rotation.y = this.facing;
    this.refreshMood();
  }

  buildModel() {
    const M = makeColonistMaterials(this);
    this.M = M;
    this.root = new THREE.Group();
    this.root.name = `colonist-${this.name}`;
    this.body = new THREE.Group();
    this.root.add(this.body);

    // legs
    this.legL = new THREE.Group();
    this.legR = new THREE.Group();
    this.legL.position.set(-0.115, 0.64, 0);
    this.legR.position.set(0.115, 0.64, 0);
    for (const [leg, side] of [[this.legL, -1], [this.legR, 1]]) {
      const thigh = mesh(boxGeo(0.15, 0.56, 0.18, 0.045), M.pants, 0, -0.28, 0);
      leg.add(thigh);
      const boot = mesh(boxGeo(0.17, 0.15, 0.25, 0.04), M.boots, 0, -0.55, 0.035);
      leg.add(boot);
      const cuff = mesh(boxGeo(0.16, 0.08, 0.19, 0.02), M.accent, 0, -0.46, 0);
      leg.add(cuff);
      this.body.add(leg);
    }

    // torso
    this.torso = new THREE.Group();
    this.torso.position.y = 0.94;
    this.body.add(this.torso);
    const chest = mesh(boxGeo(0.42, 0.56, 0.27, 0.09), M.shirt, 0, 0, 0);
    this.torso.add(chest);
    // belt
    const belt = mesh(boxGeo(0.43, 0.08, 0.29, 0.03), M.dark, 0, -0.28, 0);
    this.torso.add(belt);
    const buckle = mesh(boxGeo(0.07, 0.06, 0.03, 0.01), M.accent, 0, -0.28, 0.15);
    this.torso.add(buckle);
    // collar
    const collar = mesh(boxGeo(0.3, 0.07, 0.22, 0.03), M.accent, 0, 0.27, 0.01);
    this.torso.add(collar);
    // backpack
    const pack = mesh(boxGeo(0.3, 0.36, 0.16, 0.045), M.accent, 0, 0.02, -0.2);
    this.torso.add(pack);
    for (const x of [-0.15, 0.15]) {
      const strap = mesh(boxGeo(0.045, 0.3, 0.03, 0.01), M.boots, x, 0.08, 0.15);
      strap.rotation.z = x > 0 ? -0.15 : 0.15;
      this.torso.add(strap);
    }
    // satchel
    const satchel = mesh(boxGeo(0.16, 0.19, 0.1, 0.035), M.boots, 0.26, -0.12, -0.02);
    this.torso.add(satchel);

    // head
    this.head = new THREE.Group();
    this.head.position.y = 1.43;
    this.body.add(this.head);
    const skull = mesh(sphereGeo(0.175, 14, 12), M.skin, 0, 0, 0);
    skull.scale.set(1, 1.04, 0.96);
    this.head.add(skull);
    // nose
    const nose = mesh(sphereGeo(0.035, 6, 5), M.skin, 0, -0.02, 0.17);
    this.head.add(nose);
    // eyes
    this.eyes = [];
    for (const x of [-0.06, 0.06]) {
      const eye = mesh(sphereGeo(0.021, 6, 5), M.dark, x, 0.015, 0.155);
      eye.castShadow = false;
      this.head.add(eye);
      this.eyes.push(eye);
    }
    // brows
    for (const x of [-0.062, 0.062]) {
      const brow = mesh(boxGeo(0.065, 0.014, 0.02, 0.005), M.hair, x, 0.06, 0.158);
      brow.rotation.z = x < 0 ? 0.1 : -0.1;
      this.head.add(brow);
    }
    // mouth
    const mouth = mesh(boxGeo(0.05, 0.012, 0.012, 0.004), M.dark, 0, -0.075, 0.163);
    mouth.castShadow = false;
    this.head.add(mouth);
    // hair
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.185, 12, 9, 0, TAU, 0, Math.PI * 0.62), M.hair);
    hairCap.position.y = 0.025;
    hairCap.scale.set(1.02, 1.06, 1.02);
    this.head.add(hairCap);
    if (this.hairStyle === 0) {
      const tuft = mesh(sphereGeo(0.07, 7, 6), M.hair, 0, 0.17, -0.02);
      tuft.scale.set(1.2, 0.7, 1.1);
      this.head.add(tuft);
    } else if (this.hairStyle === 1) {
      const bun = mesh(sphereGeo(0.09, 8, 7), M.hair, 0, 0.13, -0.16);
      this.head.add(bun);
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.015, 5, 12), M.accent);
      band.rotation.x = Math.PI / 2;
      band.position.set(0, 0.13, -0.11);
      this.head.add(band);
    } else if (this.hairStyle === 2) {
      const tail = mesh(cylGeo(0.045, 0.02, 0.34, 6), M.hair, 0, 0.02, -0.19);
      tail.rotation.x = 0.35;
      this.head.add(tail);
    } else {
      const hat = mesh(cylGeo(0.23, 0.22, 0.06, 12), M.accent, 0, 0.16, 0);
      const crown = mesh(cylGeo(0.15, 0.16, 0.12, 12), M.accent, 0, 0.23, 0);
      this.head.add(hat, crown);
    }
    // ear
    for (const x of [-0.172, 0.172]) {
      const ear = mesh(sphereGeo(0.045, 6, 5), M.skin, x, -0.005, 0);
      ear.scale.set(0.6, 1, 0.8);
      this.head.add(ear);
    }

    // arms
    this.armL = new THREE.Group();
    this.armR = new THREE.Group();
    this.armL.position.set(-0.255, 1.11, 0);
    this.armR.position.set(0.255, 1.11, 0);
    for (const [arm, side] of [[this.armL, -1], [this.armR, 1]]) {
      const sleeve = mesh(boxGeo(0.13, 0.28, 0.15, 0.045), M.shirt, 0, -0.13, 0);
      arm.add(sleeve);
      const forearm = mesh(cylGeo(0.052, 0.058, 0.24, 7), M.skin, 0, -0.37, 0);
      arm.add(forearm);
      const hand = mesh(sphereGeo(0.065, 7, 6), M.skin, 0, -0.5, 0.015);
      hand.scale.set(0.9, 1.05, 0.9);
      arm.add(hand);
      const cuff = mesh(boxGeo(0.135, 0.05, 0.155, 0.02), M.accent, 0, -0.26, 0);
      arm.add(cuff);
      this.body.add(arm);
    }
    // hand anchor for tools
    this.handR = new THREE.Group();
    this.handR.position.set(0, -0.52, 0.02);
    this.armR.add(this.handR);
    this.handL = new THREE.Group();
    this.handL.position.set(0, -0.52, 0.02);
    this.armL.add(this.handL);

    this.buildTools();
    this.buildCarry();

    // selection ring
    const ringGeo = new THREE.RingGeometry(0.36, 0.46, 36);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xf3c27c, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    this.ring = new THREE.Mesh(ringGeo, this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.035;
    this.ring.visible = false;
    this.root.add(this.ring);

    this.root.traverse(o => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    // eyes/mouth small, no shadow
    this.eyes.forEach(e => e.castShadow = false);

    this.world.group.add(this.root);
  }

  buildTools() {
    this.tools = {};
    const mkAxe = () => {
      const g = new THREE.Group();
      const handle = mesh(cylGeo(0.022, 0.028, 0.62, 6), MAT.woodDark, 0, -0.16, 0);
      handle.rotation.x = Math.PI / 2;
      const blade = mesh(new THREE.CylinderGeometry(0.0, 0.12, 0.2, 4), new THREE.MeshStandardMaterial({ color: 0x9a9f9a, metalness: 0.65, roughness: 0.4 }), 0, 0.14, 0.17);
      blade.rotation.set(0, 0, Math.PI / 2);
      blade.scale.set(1, 1.2, 0.18);
      g.add(handle, blade);
      g.rotation.x = -0.3;
      return g;
    };
    this.tools.axe = mkAxe();
    this.tools.pick = (() => {
      const g = new THREE.Group();
      const handle = mesh(cylGeo(0.022, 0.028, 0.66, 6), MAT.woodDark, 0, -0.2, 0);
      handle.rotation.x = Math.PI / 2;
      const headBar = mesh(boxGeo(0.5, 0.05, 0.06, 0.02), new THREE.MeshStandardMaterial({ color: 0x9a9f9a, metalness: 0.65, roughness: 0.4 }), 0, 0.13, 0);
      headBar.rotation.z = 0.12;
      const tipA = mesh(new THREE.ConeGeometry(0.045, 0.2, 4), MAT.metal, -0.27, 0.14, 0);
      tipA.rotation.z = Math.PI / 2;
      const tipB = tipA.clone();
      tipB.position.x = 0.27;
      tipB.rotation.z = -Math.PI / 2;
      g.add(handle, headBar, tipA, tipB);
      g.rotation.x = -0.3;
      return g;
    })();
    this.tools.hoe = (() => {
      const g = new THREE.Group();
      const handle = mesh(cylGeo(0.022, 0.028, 0.7, 6), MAT.woodDark, 0, -0.2, 0);
      handle.rotation.x = Math.PI / 2;
      const blade = mesh(boxGeo(0.2, 0.03, 0.14, 0.01), MAT.metal, 0, 0.16, 0.06);
      g.add(handle, blade);
      return g;
    })();
    this.tools.hammer = (() => {
      const g = new THREE.Group();
      const handle = mesh(cylGeo(0.02, 0.024, 0.44, 6), MAT.woodDark, 0, -0.1, 0);
      handle.rotation.x = Math.PI / 2;
      const head = mesh(boxGeo(0.28, 0.1, 0.11, 0.02), MAT.metalDark, 0, 0.14, 0);
      g.add(handle, head);
      return g;
    })();
    this.tools.basket = (() => {
      const g = new THREE.Group();
      const basket = mesh(cylGeo(0.16, 0.12, 0.18, 9), MAT.woodLight, 0, -0.08, 0);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.018, 5, 12), MAT.woodDark);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.01;
      g.add(basket, rim);
      return g;
    })();
    for (const k in this.tools) {
      this.tools[k].visible = false;
      this.handR.add(this.tools[k]);
    }
  }

  buildCarry() {
    this.carryGroup = new THREE.Group();
    this.carryGroup.position.set(0, 0.95, 0.26);
    this.body.add(this.carryGroup);
    // logs
    const logs = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const l = mesh(cylGeo(0.055, 0.065, 0.7, 6), MAT.log, (i - 1) * 0.12, (i % 2) * 0.08, 0);
      l.rotation.z = Math.PI / 2;
      logs.add(l);
    }
    // stone
    const stone = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.11, 0), MAT.stone);
      s.position.set((i - 1) * 0.12, (i % 2) * 0.1, 0);
      s.scale.set(1, 0.8, 1);
      s.castShadow = true;
      stone.add(s);
    }
    // crops
    const crops = new THREE.Group();
    for (let i = 0; i < 7; i++) {
      const c = mesh(new THREE.ConeGeometry(0.03, 0.38, 4), i % 2 ? MAT.cropGold : MAT.crop, (i - 3) * 0.035, 0.1, (i % 2) * 0.04);
      c.rotation.z = (i - 3) * 0.08;
      crops.add(c);
    }
    const cloth = mesh(boxGeo(0.3, 0.16, 0.2, 0.05), MAT.clothCream, 0, -0.04, 0);
    crops.add(cloth);
    this.carryModels = { logs, stone, crops };
    for (const k in this.carryModels) { this.carryModels[k].visible = false; this.carryGroup.add(this.carryModels[k]); }
    this.carryGroup.visible = false;
  }

  setCarry(type) {
    this.carrying = type;
    this.carryGroup.visible = !!type;
    for (const k in this.carryModels) this.carryModels[k].visible = k === type;
  }

  setTool(name) {
    this.tool = name;
    for (const k in this.tools) this.tools[k].visible = k === name;
  }

  select(on) {
    this.selected = on;
    this.ring.visible = on;
  }

  setPriority(kind) {
    this.priority = kind;
    this.colony.toast(`${this.name} will prioritize ${kind} work`, 'order');
  }

  refreshMood() {
    const bedBonus = this.bed ? 8 : -6;
    const campBonus = this.colony.nearFire(this) ? 4 : 0;
    this.mood = clamp((this.hunger * 0.34 + this.rest * 0.3 + this.joy * 0.36) + bedBonus + campBonus, 0, 100);
    if (this.mood >= 82) this.moodLabel = 'Inspired';
    else if (this.mood >= 65) this.moodLabel = 'Content';
    else if (this.mood >= 45) this.moodLabel = 'Uneasy';
    else if (this.mood >= 25) this.moodLabel = 'Strained';
    else this.moodLabel = 'Miserable';
  }

  get moodColor() {
    if (this.mood >= 65) return '#9fc178';
    if (this.mood >= 45) return '#e9c06d';
    return '#e2856f';
  }

  setActivity(text) {
    this.activity = text;
  }

  // ── movement ─────────────────────────────────────────────
  moveTo(tx, tz, speed = this.baseSpeed) {
    const start = { tx: this.tx, tz: this.tz };
    const path = findPath(this.world, start, { tx, tz });
    if (!path) return false;
    this.path = path;
    this.pathIndex = 0;
    this.arrived = false;
    this.moveSpeed = speed;
    return true;
  }

  moveToSpot(spot, speed = this.baseSpeed) {
    if (!spot) return false;
    return this.moveTo(spot.tx, spot.tz, speed);
  }

  stopMoving() {
    this.path = [];
    this.pathIndex = 0;
    this.arrived = true;
    this.moving = false;
    this.targetFacing = this.facing;
  }

  tile() {
    const t = this.world.tileAt(this.x, this.z);
    this.tx = t.tx;
    this.tz = t.tz;
    return t;
  }

  stepMovement(dt) {
    if (this.path.length === 0) { this.moving = false; return; }
    const target = this.path[this.pathIndex];
    if (!target) { this.path = []; this.moving = false; this.arrived = true; return; }
    const p = this.world.worldPos(target.tx, target.tz);
    const dx = p.x - this.x, dz = p.z - this.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.07) {
      this.pathIndex++;
      if (this.pathIndex >= this.path.length) {
        this.path = [];
        this.moving = false;
        this.arrived = true;
      }
      return;
    }
    const speed = this.moveSpeed || this.baseSpeed;
    const step = Math.min(dist, speed * dt);
    this.x += (dx / dist) * step;
    this.z += (dz / dist) * step;
    this.moving = step > 0.0002;
    this.walkPhase += step * 7.4;
    this.targetFacing = Math.atan2(dx, dz);
    this.footstep -= step;
    if (this.footstep <= 0) {
      this.footstep = 0.85;
      if (this.colony.particles && !this.carrying) {
        this.colony.particles.dust(this.x, this.y + 0.04, this.z, 1, 0.55);
      }
    }
    this.y = damp(this.y, this.world.groundHeight(target.tx, target.tz), 12, dt);
  }

  // ── update ───────────────────────────────────────────────
  update(dt, time) {
    // needs
    const sleeping = this.task?.type === 'sleep' && this.task.phase === 'sleep';
    const decayScale = this.colony.timeScale > 0 ? 1 : 0;
    if (decayScale && !sleeping) {
      this.hunger = Math.max(0, this.hunger - dt * 0.062);
      this.rest = Math.max(0, this.rest - dt * 0.12);
      this.joy = Math.max(0, this.joy - dt * 0.045);
    }
    if (this.hunger < 8) this.hp = Math.max(0, this.hp - dt * 0.3);
    else if (this.hp < 100) this.hp = Math.min(100, this.hp + dt * 0.1);

    // task machine
    if (this.task) this.updateTask(dt, time);
    else if (this.arrived && this.moving === false) {
      // think handled by colony
    }

    this.stepMovement(dt);
    this.tile();
    if (this.task?.type === 'sleep') this.updateSleepPosition(dt);
    this.root.position.set(this.x, this.sleepBlend > 0.02 ? this.y + 0.55 * this.sleepBlend : this.y, this.z);
    this.root.rotation.y = angleDamp(this.root.rotation.y, this.targetFacing, 10, dt);
    this.animate(dt, time);

    // selection ring pulse
    if (this.selected) {
      const s = 1 + Math.sin(time * 4) * 0.06;
      this.ring.scale.setScalar(s);
      this.ringMat.opacity = 0.55 + Math.sin(time * 4) * 0.2;
    }

    // idle blink
    this.blink -= dt;
    if (this.blink < 0) {
      this.blink = rng.range(2.5, 7);
      this._blinkT = 0.13;
    }
    if (this._blinkT > 0) {
      this._blinkT -= dt;
      const sy = clamp(this._blinkT / 0.13, 0, 1);
      for (const e of this.eyes) e.scale.y = 0.25 + sy * 0.75;
    } else for (const e of this.eyes) e.scale.y = 1;

    this.refreshMood();
  }

  updateSleepPosition(dt) {
    const t = this.task;
    const targetBlend = t.phase === 'sleep' ? 1 : 0;
    this.sleepBlend = damp(this.sleepBlend, targetBlend, 5, dt);
    if (t.phase === 'sleep' && t.bed) {
      const bed = t.bed;
      this.x = damp(this.x, bed.x, 10, dt);
      this.z = damp(this.z, bed.z + 0.8, 10, dt);
      this.targetFacing = bed.group.rotation.y;
      this.y = bed.y;
    } else if (t.phase === 'sleep' && this.sleepGround) {
      this.x = damp(this.x, this.sleepGround.x, 8, dt);
      this.z = damp(this.z, this.sleepGround.z, 8, dt);
      const t = this.world.tileAt(this.x, this.z);
      this.y = this.world.groundHeight(t.tx, t.tz);
    }
  }

  animate(dt, time) {
    const walking = this.moving;
    const speedBlend = walking ? 1 : 0;
    this._walkBlend = damp(this._walkBlend ?? 0, speedBlend, 10, dt);
    const wb = this._walkBlend;
    const ph = this.walkPhase;
    const swing = Math.sin(ph);

    // reset pose targets
    let legL = swing * 0.72 * wb;
    let legR = -swing * 0.72 * wb;
    let armLx = -swing * 0.62 * wb;
    let armRx = swing * 0.62 * wb;
    let armLz = 0.08 + Math.sin(time * 1.2) * 0.02;
    let armRz = -0.08 - Math.sin(time * 1.2) * 0.02;
    let bodyY = Math.abs(Math.sin(ph)) * 0.035 * wb;
    let bodyX = 0;
    let bodyZ = 0;
    let headYaw = Math.sin(time * 0.5 + this.id) * 0.08;
    let headPitch = 0;

    const t = this.task;
    if (t?.type === 'work' || (t && (t.type === 'chop' || t.type === 'mine' || t.type === 'harvest' || t.type === 'build') && t.phase === 'work')) {
      const tool = t.type === 'chop' ? 'axe' : t.type === 'mine' ? 'pick' : t.type === 'harvest' ? 'hoe' : 'hammer';
      armRx = -1.55 + Math.sin(time * 8.5) * 0.7;
      armRz = -0.18;
      armLx = -0.45 + Math.sin(time * 8.5 + 1.6) * 0.16;
      legL = -0.12; legR = 0.12;
      bodyX = -0.07 + Math.sin(time * 8.5) * 0.03;
      headPitch = 0.22;
      if (this.tool !== tool) this.setTool(tool);
    } else if (this.carrying) {
      armLx = -1.28 + Math.sin(ph) * 0.06 * wb;
      armRx = -1.28 - Math.sin(ph) * 0.06 * wb;
      armLz = 0.12; armRz = -0.12;
      bodyX = 0.04;
      if (this.tool) this.setTool(null);
    } else if (t?.type === 'eat' && t.phase === 'eat') {
      armRx = -1.35 - Math.abs(Math.sin(time * 4.5)) * 0.35;
      armRz = -0.25;
      armLx = -0.25;
      headPitch = 0.15;
      legL = 0.06; legR = -0.06;
      if (this.tool) this.setTool(null);
    } else if (t?.type === 'relax') {
      armLx = 0.18; armRx = 0.18;
      legL = -0.18; legR = 0.18;
      bodyY = -0.08 + Math.sin(time * 1.3) * 0.012;
      bodyX = 0.02;
      headYaw = Math.sin(time * 0.3) * 0.2;
      if (this.tool) this.setTool(null);
    } else if (t?.type === 'sleep' && this.sleepBlend > 0.1) {
      armLx = 0.12; armRx = 0.12; armLz = 0.2; armRz = -0.2;
      legL = 0.03; legR = -0.03;
      bodyY = 0.02 + Math.sin(time * 1.1) * 0.012;
      if (this.tool) this.setTool(null);
    } else {
      // idle breathing and looking around
      bodyY = Math.sin(time * 1.4 + this.id) * 0.012;
      armLz = 0.09 + Math.sin(time * 1.1 + this.id) * 0.025;
      armRz = -0.09 - Math.sin(time * 1.1 + this.id) * 0.025;
      if (this.tool) this.setTool(null);
    }

    if (t?.type !== 'work' && !(t && ['chop', 'mine', 'harvest', 'build'].includes(t.type) && t.phase === 'work')) {
      if (this.tool) this.setTool(null);
    }

    const k = 12;
    this.legL.rotation.x = damp(this.legL.rotation.x, legL, k, dt);
    this.legR.rotation.x = damp(this.legR.rotation.x, legR, k, dt);
    this.armL.rotation.x = damp(this.armL.rotation.x, armLx, k, dt);
    this.armR.rotation.x = damp(this.armR.rotation.x, armRx, k, dt);
    this.armL.rotation.z = damp(this.armL.rotation.z, armLz, k, dt);
    this.armR.rotation.z = damp(this.armR.rotation.z, armRz, k, dt);
    this.body.position.y = damp(this.body.position.y, bodyY, k, dt);
    this.body.rotation.x = damp(this.body.rotation.x, bodyX - (this.sleepBlend * Math.PI / 2), 7, dt);
    this.body.rotation.z = damp(this.body.rotation.z, bodyZ, k, dt);
    this.head.rotation.y = damp(this.head.rotation.y, headYaw, 4, dt);
    this.head.rotation.x = damp(this.head.rotation.x, headPitch, 6, dt);
    // torso breathing
    const br = 1 + Math.sin(time * 1.6 + this.id) * 0.012;
    this.torso.scale.set(1, br, 1);
    // carry group follows slight bob
    this.carryGroup.rotation.x = Math.sin(ph) * 0.03 * wb;
  }

  // ── tasks ────────────────────────────────────────────────
  updateTask(dt, time) {
    const t = this.task;
    if (!t) return;
    if (t.phase === 'approach') {
      if (this.arrived) {
        if (!t.spotTiles || this.atSpot(t)) this.onReachTask();
      }
      return;
    }
    if (t.phase === 'work') {
      t.elapsed += dt;
      this.targetFacing = Math.atan2(t.faceX - this.x, t.faceZ - this.z);
      this.setActivity(t.activity || 'Working');
      const rate = t.rate || 1;
      t.progress = Math.min(1, (t.elapsed / t.duration));
      if (t.building) {
        t.building.progress = Math.max(t.building.progress, t.progress);
      }
      this.workParticleTimer -= dt;
      if (this.workParticleTimer <= 0) {
        this.workParticleTimer = 0.22;
        const p = this.colony.particles;
        if (p) {
          if (t.type === 'chop') p.chips(t.faceX, this.world.groundHeight(t.target.tx, t.target.tz) + 0.8, t.faceZ, 3, false);
          else if (t.type === 'mine') p.chips(t.faceX, this.world.groundHeight(t.target.tx, t.target.tz) + 0.5, t.faceZ, 3, true);
          else if (t.type === 'build') p.sparks(t.faceX, this.world.groundHeight(t.target.tx, t.target.tz) + 0.35, t.faceZ, 3);
          else if (t.type === 'harvest') p.leaves(t.faceX, this.world.groundHeight(t.target.tx, t.target.tz) + 0.25, t.faceZ, 1);
        }
      }
      if (t.elapsed >= t.duration) this.onWorkComplete();
      return;
    }
    if (t.phase === 'carry') {
      if (this.arrived) this.onCarryArrive();
      return;
    }
    if (t.phase === 'eat') {
      t.elapsed += dt;
      if (t.elapsed >= t.duration) this.finishEating();
      return;
    }
    if (t.phase === 'sleep') {
      t.elapsed += dt;
      this.rest = Math.min(100, this.rest + dt * 0.36);
      const hour = this.colony.hour;
      const morning = hour >= 6.2 && hour < 9;
      if ((morning && this.rest > 58 && this.hunger > 24) || this.rest >= 99.4 || this.hunger < 14) {
        this.wakeUp();
      }
      return;
    }
    if (t.phase === 'relax') {
      t.elapsed += dt;
      this.joy = Math.min(100, this.joy + dt * 0.09);
      if (t.elapsed >= t.duration) {
        this.finishTask();
        this.colony.think(this, true);
      }
      return;
    }
    if (t.phase === 'wander') {
      if (this.arrived) t.elapsed += dt;
      if (this.arrived && t.elapsed >= t.duration) {
        this.finishTask();
        this.colony.think(this, true);
      }
      return;
    }
  }

  atSpot(t) {
    const s = t.spotTiles;
    if (!s) return true;
    return Math.abs(this.tx - s.tx) <= 1 && Math.abs(this.tz - s.tz) <= 1;
  }

  onReachTask() {
    const t = this.task;
    if (t.type === 'chop' || t.type === 'mine' || t.type === 'harvest' || t.type === 'build' || t.type === 'haul') {
      t.phase = 'work';
      t.elapsed = 0;
      t.faceX = t.target.x ?? t.target.center?.x ?? this.x;
      t.faceZ = t.target.z ?? t.target.center?.z ?? this.z;
      if (t.type === 'build') {
        t.faceX = t.target.x; t.faceZ = t.target.z;
        t.duration = Math.max(1.4, t.target.work * (1 - t.target.progress) * (0.9 / (0.7 + (this.skills.build || 1) * 0.1)));
        t.building = t.target;
      } else if (t.type === 'chop') {
        t.duration = 4.2 / (0.7 + (this.skills.chop || 1) * 0.1);
      } else if (t.type === 'mine') {
        t.duration = 5.2 / (0.7 + (this.skills.mine || 1) * 0.1);
      } else if (t.type === 'harvest') {
        t.duration = 2.6 / (0.7 + (this.skills.farm || 1) * 0.1);
      } else if (t.type === 'haul') {
        t.duration = 0.9;
      }
      this.setActivity(t.activity || 'Working');
    }
  }

  onWorkComplete() {
    const t = this.task;
    const col = this.colony;
    if (t.type === 'chop') {
      const tree = t.target;
      col.particles?.leaves(tree.x, tree.y + 1.4, tree.z, 10);
      col.particles?.chips(tree.x, tree.y + 0.4, tree.z, 12, false);
      col.world.removeTree(tree);
      tree.claimedBy = null;
      tree.designated = false;
      col.designations.delete(tree);
      this.setCarry('logs');
      this.startCarry('wood', 7 + Math.floor(rng.next() * 6), 'logs', 'Hauling timber');
    } else if (t.type === 'mine') {
      const rock = t.target;
      col.particles?.chips(rock.x, rock.y + 0.4, rock.z, 12, true);
      col.world.removeRock(rock);
      rock.claimedBy = null;
      rock.designated = false;
      col.designations.delete(rock);
      this.setCarry('stone');
      this.startCarry('stone', 6 + Math.floor(rng.next() * 5), 'stone', 'Hauling stone');
    } else if (t.type === 'harvest') {
      const farm = t.target;
      t.target.growth = 0.06;
      farm.claimedBy = null;
      col.particles?.leaves(farm.x, farm.y + 0.4, farm.z, 10);
      this.setCarry('crops');
      this.startCarry('food', 8 + Math.floor(rng.next() * 7), 'crops', 'Hauling crops');
    } else if (t.type === 'haul') {
      const item = t.target;
      if (item && !item.removed) {
        col.pickUpItem(item);
        this.setCarry(item.visual || 'logs');
        this.startCarry(item.resource, item.amount, item.visual || 'logs', `Hauling ${item.resource}`);
      } else {
        this.finishTask();
        col.think(this, true);
      }
    } else if (t.type === 'build') {
      const b = t.target;
      b.progress = 1;
      b.complete(col.world, col.particles);
      b.claimedBy = null;
      col.particles?.sparkle(b.x, b.y + 0.4, b.z, 18);
      col.onBuildingComplete(b);
      this.finishTask();
      col.think(this, true);
    }
  }

  startCarry(resource, amount, model, activity) {
    const t = this.task;
    t.phase = 'carry';
    t.carry = { resource, amount };
    t.activity = activity;
    this.setActivity(activity);
    const spot = this.colony.getDepositSpot(this);
    if (!spot) { this.depositCarry(); return; }
    if (!this.moveToSpot(spot, this.baseSpeed * 0.92)) { this.depositCarry(); return; }
  }

  onCarryArrive() {
    this.depositCarry();
  }

  depositCarry() {
    const t = this.task;
    if (t?.carry) {
      this.colony.addResource(t.carry.resource, t.carry.amount);
      const c = t.carry;
      this.colony.floatResource(this.x, this.y + 1.3, this.z, c.resource, c.amount);
    }
    this.setCarry(null);
    this.finishTask();
    this.colony.think(this, true);
  }

  finishTask() {
    if (this.task?.target && this.task.target.claimedBy === this) this.task.target.claimedBy = null;
    if (this.task?.building) this.task.building = null;
    this.task = null;
    this.setTool(null);
    this.setCarry(null);
    this.sleepBlend = 0;
    this.sitting = false;
    this.stopMoving();
  }

  beginChop(tree) {
    if (!tree || tree.removed) return false;
    const spot = this.pickSpotForTarget(tree);
    if (!spot) return false;
    tree.claimedBy = this;
    this.task = {
      type: 'chop', target: tree, phase: 'approach', spotTiles: spot,
      activity: `Chopping ${tree.pine ? 'pine' : 'oak'}`, faceX: tree.x, faceZ: tree.z,
    };
    if (!this.moveToSpot(spot)) { tree.claimedBy = null; this.task = null; return false; }
    this.setActivity(this.task.activity);
    return true;
  }

  beginMine(rock) {
    if (!rock || rock.removed) return false;
    const spot = this.pickSpotForTarget(rock);
    if (!spot) return false;
    rock.claimedBy = this;
    this.task = { type: 'mine', target: rock, phase: 'approach', spotTiles: spot, activity: 'Mining stone', faceX: rock.x, faceZ: rock.z };
    if (!this.moveToSpot(spot)) { rock.claimedBy = null; this.task = null; return false; }
    this.setActivity('Mining stone');
    return true;
  }

  beginHarvest(farm) {
    if (!farm || farm.type !== 'farm') return false;
    const spot = farm.workSpot(this.world, this.tx, this.tz);
    if (!spot) return false;
    farm.claimedBy = this;
    this.task = { type: 'harvest', target: farm, phase: 'approach', spotTiles: spot, activity: 'Harvesting wheat', faceX: farm.x, faceZ: farm.z };
    if (!this.moveToSpot(spot)) { farm.claimedBy = null; this.task = null; return false; }
    this.setActivity('Harvesting wheat');
    return true;
  }

  beginBuild(b) {
    if (!b || b.state === 'built') return false;
    const spot = b.workSpot(this.world, this.tx, this.tz);
    if (!spot) return false;
    b.claimedBy = this;
    this.task = { type: 'build', target: b, phase: 'approach', spotTiles: spot, activity: `Building ${b.def.name.toLowerCase()}`, faceX: b.x, faceZ: b.z };
    if (!this.moveToSpot(spot)) { b.claimedBy = null; this.task = null; return false; }
    this.setActivity(this.task.activity);
    return true;
  }

  beginEat() {
    if (this.colony.resources.food <= 0) return false;
    const table = this.colony.nearestTable(this);
    const spot = table ? table.workSpot(this.world, this.tx, this.tz) : this.colony.nearestCampfireSpot(this);
    if (!spot) return false;
    this.task = {
      type: 'eat', phase: 'approach', spotTiles: spot,
      activity: table ? 'Eating a meal' : 'Eating by the fire', table,
    };
    if (!this.moveToSpot(spot, this.baseSpeed * 1.05)) { this.task = null; return false; }
    this.setActivity(this.task.activity);
    return true;
  }

  beginSleep(bed = null) {
    let spot;
    if (bed) {
      // walk to a free floor tile beside the bed, then lie down on it
      spot = this.bedApproachSpot(bed);
      this.task = { type: 'sleep', phase: 'approach', bed, spotTiles: spot, activity: bed ? 'Going to bed' : 'Going to sleep', elapsed: 0 };
    } else {
      const s = findNearestWalkable(this.world, this.tx, this.tz, 3) || { tx: this.tx, tz: this.tz };
      spot = s;
      this.task = { type: 'sleep', phase: 'approach', bed: null, spotTiles: spot, activity: 'Sleeping rough', elapsed: 0 };
    }
    if (!spot || !this.moveToSpot(spot, this.baseSpeed * 0.9)) { this.task = null; return false; }
    this.setActivity(this.task.activity);
    return true;
  }

  bedApproachSpot(bed) {
    const seen = new Set();
    const candidates = [];
    const feet = bed.footTiles && bed.footTiles.length
      ? bed.footTiles
      : [{ tx: bed.tx, tz: bed.tz }];
    for (const f of feet) {
      for (const t of adjacentTiles(this.world, f.tx, f.tz, 1)) {
        const key = `${t.tx},${t.tz}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (feet.some(o => o.tx === t.tx && o.tz === t.tz)) continue;
        candidates.push(t);
      }
    }
    if (!candidates.length) return findNearestWalkable(this.world, bed.tx, bed.tz, 3);
    candidates.sort((a, b) => Math.hypot(a.tx - this.tx, a.tz - this.tz) - Math.hypot(b.tx - this.tx, b.tz - this.tz));
    return candidates[0];
  }

  fallAsleep() {
    const t = this.task;
    if (!t) return;
    t.phase = 'sleep';
    t.elapsed = 0;
    t.bed = t.bed || null;
    this.stopMoving();
    this.setActivity(t.bed ? `Sleeping in bed` : 'Sleeping on the ground');
    if (!t.bed) {
      // lie on the grass
      this.sleepGround = { x: this.x, z: this.z + 0.55 };
    }
  }

  wakeUp() {
    const t = this.task;
    if (!t) return;
    this.sleepBlend = 0;
    this.finishTask();
    this.setActivity('Rested');
    this.joy = Math.min(100, this.joy + 2);
    this.colony.think(this, true);
  }

  beginRelax(spot) {
    const s = spot || this.colony.nearestCampfireSpot(this);
    if (!s) return false;
    this.task = { type: 'relax', phase: 'approach', spotTiles: s, duration: rng.range(9, 20), elapsed: 0, activity: 'Warming by the fire' };
    if (!this.moveToSpot(s, this.baseSpeed * 0.8)) { this.task = null; return false; }
    this.setActivity('Warming by the fire');
    return true;
  }

  beginWander(spot, duration = rng.range(2.5, 5)) {
    const s = spot || this.colony.randomIdleSpot(this);
    if (!s) return false;
    this.task = { type: 'wander', phase: 'wander', spotTiles: s, duration, elapsed: 0, activity: 'Wandering' };
    if (!this.moveToSpot(s, this.baseSpeed * 0.65)) { this.task = null; return false; }
    this.setActivity('Wandering');
    return true;
  }

  beginHaul(item) {
    if (!item || item.removed) return false;
    item.claimedBy = this;
    const spot = this.pickSpotForTarget(item);
    if (!spot) { item.claimedBy = null; return false; }
    this.task = {
      type: 'haul', target: item, phase: 'approach', spotTiles: spot,
      activity: `Hauling ${item.resource}`, faceX: item.x, faceZ: item.z,
    };
    if (!this.moveToSpot(spot, this.baseSpeed)) { item.claimedBy = null; this.task = null; return false; }
    this.setActivity(this.task.activity);
    return true;
  }

  pickSpotForTarget(target) {
    let best = null, bestD = Infinity;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const tx = target.tx + dx, tz = target.tz + dz;
        if (!this.world.isWalkable(tx, tz)) continue;
        const d = Math.hypot(tx - this.tx, tz - this.tz);
        if (d < bestD) { bestD = d; best = { tx, tz }; }
      }
    }
    return best;
  }

  // called by task machine when reaching sleep spot
  onReachSleep() {
    this.fallAsleep();
  }

  get needsList() {
    return [
      { id: 'food', label: 'Food', value: this.hunger, icon: 'food' },
      { id: 'rest', label: 'Rest', value: this.rest, icon: 'rest' },
      { id: 'joy', label: 'Spirit', value: this.joy, icon: 'joy' },
    ];
  }
}

// patch task reach dispatcher for sleep/eat/relax
const origOnReach = Colonist.prototype.onReachTask;
Colonist.prototype.onReachTask = function () {
  const t = this.task;
  if (!t) return;
  if (t.type === 'sleep') return this.fallAsleep();
  if (t.type === 'eat') {
    t.phase = 'eat'; t.elapsed = 0; t.duration = 5.5;
    this.stopMoving();
    this.targetFacing = Math.atan2((t.table?.x ?? this.x + 1) - this.x, (t.table?.z ?? this.z + 1) - this.z);
    this.setActivity(t.activity);
    return;
  }
  if (t.type === 'relax' || t.type === 'wander') {
    t.phase = t.type;
    t.elapsed = 0;
    this.stopMoving();
    this.setActivity(t.type === 'relax' ? 'Warming by the fire' : 'Taking a breath');
    if (t.type === 'relax') this.colony.giveJoy(this, 1);
    return;
  }
  return origOnReach.call(this);
};

Colonist.prototype.finishEating = function () {
  if (this.colony.resources.food > 0) {
    this.colony.addResource('food', -1);
    this.hunger = Math.min(100, this.hunger + 64);
    this.joy = Math.min(100, this.joy + 2.5);
    this.colony.log(`${this.name} finished a meal.`, 'meal');
    this.colony.toast(`${this.name} had a good meal`, 'food');
  } else {
    this.colony.toast(`${this.name} found the larder empty`, 'danger');
  }
  this.finishTask();
  this.colony.think(this, true);
};

// ── wildlife ────────────────────────────────────────────────
export class Deer {
  constructor(world, x, z) {
    this.world = world;
    this.x = x; this.z = z;
    const start = world.tileAt(x, z);
    this.y = world.groundHeight(start.tx, start.tz);
    this.angle = rng.range(0, TAU);
    this.target = null;
    this.timer = rng.range(1, 5);
    this.phase = rng.range(0, TAU);
    this.speed = rng.range(0.5, 0.8);
    this.flee = 0;
    this.group = new THREE.Group();
    const fur = new THREE.MeshStandardMaterial({ color: 0x9c7448, roughness: 0.95 });
    const furDark = new THREE.MeshStandardMaterial({ color: 0x7b5734, roughness: 0.95 });
    const cream = new THREE.MeshStandardMaterial({ color: 0xd8c3a2, roughness: 0.95 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b251e, roughness: 0.8 });
    const body = mesh(new THREE.CapsuleGeometry(0.2, 0.55, 4, 8), fur, 0, 0.72, 0);
    body.rotation.x = Math.PI / 2;
    this.group.add(body);
    const chest = mesh(sphereGeo(0.23, 8, 6), fur, 0, 0.75, 0.3);
    chest.scale.set(0.95, 1.1, 0.9);
    this.group.add(chest);
    this.neck = new THREE.Group();
    this.neck.position.set(0, 0.9, 0.35);
    this.group.add(this.neck);
    const neck = mesh(cylGeo(0.07, 0.1, 0.38, 6), fur, 0, 0.16, 0.05);
    neck.rotation.x = -0.35;
    this.neck.add(neck);
    const head = mesh(sphereGeo(0.12, 8, 6), fur, 0, 0.35, 0.12);
    head.scale.set(0.85, 1, 1.25);
    this.neck.add(head);
    const snout = mesh(sphereGeo(0.065, 6, 5), cream, 0, 0.31, 0.25);
    snout.scale.set(0.8, 0.7, 1.1);
    this.neck.add(snout);
    const nose = mesh(sphereGeo(0.025, 5, 4), dark, 0, 0.3, 0.31);
    this.neck.add(nose);
    for (const x of [-0.07, 0.07]) {
      const ear = mesh(new THREE.ConeGeometry(0.045, 0.14, 4), furDark, x, 0.43, 0.03);
      ear.rotation.z = x > 0 ? -0.4 : 0.4;
      ear.rotation.x = -0.2;
      this.neck.add(ear);
    }
    // antlers
    for (const side of [-1, 1]) {
      const a1 = mesh(cylGeo(0.014, 0.02, 0.3, 4), cream, side * 0.07, 0.55, 0.05);
      a1.rotation.z = side * -0.55;
      a1.rotation.x = -0.15;
      this.neck.add(a1);
      const a2 = mesh(cylGeo(0.01, 0.014, 0.18, 4), cream, side * 0.16, 0.66, 0.03);
      a2.rotation.z = side * -0.95;
      this.neck.add(a2);
    }
    this.legs = [];
    for (const [x, z] of [[-0.13, 0.26], [0.13, 0.26], [-0.13, -0.26], [0.13, -0.26]]) {
      const leg = new THREE.Group();
      leg.position.set(x, 0.58, z);
      const l = mesh(cylGeo(0.035, 0.045, 0.5, 5), furDark, 0, -0.25, 0);
      leg.add(l);
      const hoof = mesh(boxGeo(0.07, 0.07, 0.1, 0.015), dark, 0, -0.5, 0.02);
      leg.add(hoof);
      this.group.add(leg);
      this.legs.push(leg);
    }
    const tail = mesh(sphereGeo(0.07, 5, 4), cream, 0, 0.82, -0.36);
    this.group.add(tail);
    this.group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.group.position.set(x, this.y, z);
    world.group.add(this.group);
  }

  update(dt, colonists) {
    this.timer -= dt;
    this.flee = Math.max(0, this.flee - dt);
    let nearest = 999;
    for (const c of colonists) {
      const d = Math.hypot(c.x - this.x, c.z - this.z);
      if (d < nearest) nearest = d;
    }
    if (nearest < 2.2) this.flee = 1.2;
    if (this.timer <= 0) {
      this.timer = rng.range(2, 7);
      for (let tries = 0; tries < 12; tries++) {
        const a = rng.range(0, TAU), r = rng.range(3, 9);
        const nx = this.x + Math.cos(a) * r, nz = this.z + Math.sin(a) * r;
        const t = this.world.tileAt(nx, nz);
        if (this.world.isWalkable(t.tx, t.tz) && Math.hypot(nx, nz) > 8) { this.target = { x: nx, z: nz }; break; }
      }
    }
    let speed = this.speed * 0.5;
    if (this.flee > 0) speed = 2.4;
    if (this.target) {
      const dx = this.target.x - this.x, dz = this.target.z - this.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.3 || this.flee > 0 && d < 1) {
        if (this.flee <= 0) this.target = null;
      } else {
        const nx = this.x + (dx / d) * speed * dt;
        const nz = this.z + (dz / d) * speed * dt;
        const t = this.world.tileAt(nx, nz);
        if (this.world.isWalkable(t.tx, t.tz)) {
          this.x = nx; this.z = nz;
          this.angle = Math.atan2(dx, dz);
          this.y = damp(this.y, this.world.groundHeight(t.tx, t.tz), 10, dt);
          this.phase += speed * dt * 4;
          this.group.position.set(this.x, this.y, this.z);
        } else {
          this.target = null;
        }
      }
    }
    if (this.flee > 0) {
      // run away from nearest colonist
      let closest = null, cd = 999;
      for (const c of colonists) {
        const d = Math.hypot(c.x - this.x, c.z - this.z);
        if (d < cd) { cd = d; closest = c; }
      }
      if (closest) {
        const dx = this.x - closest.x, dz = this.z - closest.z, d = Math.hypot(dx, dz) || 1;
        const nx = this.x + (dx / d) * 2.4 * dt, nz = this.z + (dz / d) * 2.4 * dt;
        const t = this.world.tileAt(nx, nz);
        if (this.world.isWalkable(t.tx, t.tz)) {
          this.x = nx; this.z = nz;
          this.angle = Math.atan2(dx, dz);
          this.y = this.world.groundHeight(t.tx, t.tz);
          this.phase += 5 * dt;
          this.group.position.set(this.x, this.y, this.z);
        }
      }
    }
    this.group.rotation.y = angleDamp(this.group.rotation.y, this.angle, 6, dt);
    const walk = this.target ? 1 : 0.12;
    for (let i = 0; i < 4; i++) {
      this.legs[i].rotation.x = Math.sin(this.phase + i * Math.PI / 2) * 0.5 * walk;
    }
    this.neck.rotation.x = -0.05 + Math.sin(this.phase * 0.5) * 0.04 + (this.flee > 0 ? -0.1 : 0);
    // idle grazing
    if (!this.target && this.flee <= 0) this.neck.rotation.x = 0.35 + Math.sin(this.phase * 0.3) * 0.05;
  }
}

export { makeColonistMaterials };
