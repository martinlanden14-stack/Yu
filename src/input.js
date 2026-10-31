import * as THREE from 'three';
import { clamp, damp, angleDamp } from './utils.js';

export class CameraRig {
  constructor(camera, world, dom) {
    this.camera = camera;
    this.world = world;
    this.dom = dom;
    this.target = new THREE.Vector3(0.6, 0.4, 0.8);
    this.desiredTarget = this.target.clone();
    this.yaw = 0.58;
    this.desiredYaw = this.yaw;
    this.pitch = 0.94;
    this.desiredPitch = this.pitch;
    this.distance = 24;
    this.desiredDistance = 24;
    this.minDistance = 9;
    this.maxDistance = 38;
    this.focusPoint = new THREE.Vector3();
    this.portrait = window.innerHeight > window.innerWidth;
    this.baseFov = this.portrait ? 48 : 38;
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const aspect = w / h;
    const portrait = aspect < 0.85;
    const targetFov = portrait ? 50 : 38;
    if (Math.abs(this.camera.fov - targetFov) > 0.1) {
      this.camera.fov = targetFov;
      this.camera.updateProjectionMatrix();
    }
    this.portrait = portrait;
    if (!this._inited) {
      this.desiredDistance = portrait ? 24.5 : 28;
      this.distance = this.desiredDistance;
      this._inited = true;
    }
    this.maxDistance = portrait ? 42 : 40;
  }

  update(dt) {
    this.target.x = damp(this.target.x, this.desiredTarget.x, 8, dt);
    this.target.z = damp(this.target.z, this.desiredTarget.z, 8, dt);
    this.target.y = damp(this.target.y, this.desiredTarget.y, 6, dt);
    this.yaw = angleDamp(this.yaw, this.desiredYaw, 9, dt);
    this.pitch = damp(this.pitch, this.desiredPitch, 8, dt);
    this.distance = damp(this.distance, this.desiredDistance, 7, dt);
    const cp = Math.cos(this.pitch);
    const offset = new THREE.Vector3(
      Math.sin(this.yaw) * cp * this.distance,
      Math.sin(this.pitch) * this.distance,
      Math.cos(this.yaw) * cp * this.distance,
    );
    this.camera.position.copy(this.target).add(offset);
    this.camera.lookAt(this.target);
  }

  pan(dx, dy) {
    const scale = this.distance * 0.00175;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const right = new THREE.Vector3(c, 0, -s);
    const forward = new THREE.Vector3(-s, 0, -c);
    this.desiredTarget.addScaledVector(right, -dx * scale);
    this.desiredTarget.addScaledVector(forward, dy * scale);
    this.clampTarget();
  }

  clampTarget() {
    const lim = this.world.half - 7;
    this.desiredTarget.x = clamp(this.desiredTarget.x, -lim, lim);
    this.desiredTarget.z = clamp(this.desiredTarget.z, -lim, lim);
  }

  zoom(factor) {
    this.desiredDistance = clamp(this.desiredDistance * factor, this.minDistance, this.maxDistance);
  }

  rotate(delta) {
    this.desiredYaw += delta;
  }

  focus(x, z, dist = 13) {
    this.desiredTarget.x = x;
    this.desiredTarget.z = z;
    this.desiredDistance = clamp(dist, this.minDistance, this.maxDistance);
    this.clampTarget();
  }
}

export class InputController {
  constructor({ dom, camera, rig, world, colony, ui, game, buildGhost, audio }) {
    this.dom = dom;
    this.camera = camera;
    this.rig = rig;
    this.world = world;
    this.colony = colony;
    this.ui = ui;
    this.game = game;
    this.ghost = buildGhost;
    this.audio = audio;
    this.raycaster = new THREE.Raycaster();
    this.pointers = new Map();
    this.mode = 'select';
    this.placementType = null;
    this.drag = null;
    this.pinch = null;
    this.lastTap = 0;
    this.keys = new Set();
    this._bind();
  }

  _bind() {
    const el = this.dom;
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointercancel', (e) => this.onUp(e, true));
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.audio) this.audio.unlock();
      this.rig.zoom(e.deltaY > 0 ? 1.08 : 0.925);
    }, { passive: false });
    el.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k === 'escape') {
        if (this.placementType) this.game.cancelPlacement();
        else this.game.setTool('select');
      }
      if (k === 'q') this.rig.rotate(0.14);
      if (k === 'e') this.rig.rotate(-0.14);
      if (k === '1') this.game.setSpeed(1);
      if (k === '2') this.game.setSpeed(2);
      if (k === '3') this.game.setSpeed(4);
      if (k === ' ') { e.preventDefault(); this.game.togglePause(); }
      if (k === 'w' || k === 'a' || k === 's' || k === 'd' || k === 'arrowup' || k === 'arrowdown' || k === 'arrowleft' || k === 'arrowright') {
        e.preventDefault();
      }
      if (this.audio) this.audio.unlock();
    });
    window.addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  update(dt) {
    let dx = 0, dz = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) dz -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) dz += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx += 1;
    if (dx || dz) {
      const scale = this.rig.distance * 0.55 * dt;
      const s = Math.sin(this.rig.yaw), c = Math.cos(this.rig.yaw);
      this.rig.desiredTarget.x += (c * dx - s * dz) * scale;
      this.rig.desiredTarget.z += (-s * dx - c * dz) * scale;
      this.rig.clampTarget();
    }
    if (this.rig) this.rig.update(dt);
  }

  onDown(e) {
    if (this.audio) this.audio.unlock();
    try { this.dom.setPointerCapture?.(e.pointerId); } catch { /* synthetic or already released */ }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, time: performance.now(), type: e.pointerType, button: e.button, moved: false });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        angle: Math.atan2(b.y - a.y, b.x - a.x),
        startDist: this.rig.desiredDistance,
        center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
      this.drag = null;
    } else if (this.pointers.size === 1) {
      this.drag = { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moved: false, button: e.button, type: e.pointerType, time: performance.now(), mode: this.placementType ? 'place' : (e.pointerType === 'mouse' && e.button === 2 ? 'rotate' : 'pan') };
    }
    if (this.placementType) this.updateGhostFromScreen(e.clientX, e.clientY);
  }

  onMove(e) {
    const p = this.pointers.get(e.pointerId);
    if (p) {
      p.moved = p.moved || Math.hypot(e.clientX - p.startX, e.clientY - p.startY) > 7;
      p.x = e.clientX; p.y = e.clientY;
    }
    if (this.pointers.size === 2 && this.pinch) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      if (this.pinch.dist > 0) {
        this.rig.desiredDistance = clamp(this.pinch.startDist * (this.pinch.dist / Math.max(20, dist)), this.rig.minDistance, this.rig.maxDistance);
      }
      // two fingers can also drag the whole map while pinching
      const cx = (a.x + b.x) * 0.5, cy = (a.y + b.y) * 0.5;
      if (this.pinch.center) {
        const dx = cx - this.pinch.center.x, dy = cy - this.pinch.center.y;
        if (Math.hypot(dx, dy) < 70) this.rig.pan(dx, dy);
      }
      this.pinch.center = { x: cx, y: cy };
      let da = angle - this.pinch.angle;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      if (Math.abs(da) > 0.006) {
        this.rig.desiredYaw += da;
        this.pinch.angle = angle;
      }
      return;
    }
    if (this.drag) {
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 0.5) this.drag.moved = true;
      if (this.drag.mode === 'rotate') this.rig.rotate(-dx * 0.007);
      else this.rig.pan(dx, dy);
      this.drag.x = e.clientX; this.drag.y = e.clientY;
    }
    if (this.placementType) this.updateGhostFromScreen(e.clientX, e.clientY);
  }

  onUp(e, cancelled = false) {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size === 0) {
      const d = this.drag;
      this.drag = null;
      if (!d || cancelled) return;
      const moved = d.moved || Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 7;
      const elapsed = performance.now() - d.time;
      if (!moved && elapsed < 500 && d.button !== 2) {
        this.tap(e.clientX, e.clientY);
      }
    } else if (this.pointers.size === 1) {
      const [id, pt] = [...this.pointers.entries()][0];
      this.drag = { x: pt.x, y: pt.y, startX: pt.x, startY: pt.y, moved: true, button: 0, type: pt.type, time: pt.time, mode: 'pan' };
    }
  }

  tap(clientX, clientY) {
    const rect = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    // colonists are picked in screen space to make touch selection forgiving
    let bestC = null, bestD = 40;
    for (const c of this.colony.colonists) {
      const v = new THREE.Vector3(c.x, c.y + 0.9, c.z).project(this.camera);
      if (v.z > 1) continue;
      const sx = (v.x * 0.5 + 0.5) * rect.width;
      const sy = (-v.y * 0.5 + 0.5) * rect.height;
      const d = Math.hypot(sx - (clientX - rect.left), sy - (clientY - rect.top));
      if (d < bestD) { bestD = d; bestC = c; }
    }

    const hit = this.raycastGround(ndc);
    const tile = hit ? this.world.tileAt(hit.point.x, hit.point.z) : null;

    if (this.placementType) {
      if (tile) this.game.tryPlace(tile.tx, tile.tz);
      return;
    }
    if (this.mode === 'chop') {
      if (tile) {
        const tree = this.treeAt(tile.tx, tile.tz);
        if (tree) { this.colony.markDesignation(tree, 'chop'); this.audio?.chop(); this.game.setTool('chop'); return; }
      }
      if (bestC) { this.game.selectColonist(bestC); return; }
      this.ui.toast('Tap a tree to mark it for chopping', 'info');
      return;
    }
    if (this.mode === 'mine') {
      if (tile) {
        const rock = this.rockAt(tile.tx, tile.tz);
        if (rock) { this.colony.markDesignation(rock, 'mine'); this.audio?.mine(); this.game.setTool('mine'); return; }
      }
      if (bestC) { this.game.selectColonist(bestC); return; }
      this.ui.toast('Tap a rock to mark it for mining', 'info');
      return;
    }
    if (this.mode === 'harvest') {
      if (tile) {
        const b = this.colony.getBuildingAt(tile.tx, tile.tz);
        if (b && b.type === 'farm') {
          b.priority = true;
          this.ui.toast(b.growth > 0.9 ? 'Harvest prioritized' : `Crops are ${Math.round(b.growth * 100)}% grown`, 'farm');
          return;
        }
      }
      if (bestC) { this.game.selectColonist(bestC); return; }
      return;
    }

    // select mode
    if (bestC) { this.game.selectColonist(bestC); return; }
    if (tile) {
      const b = this.colony.getBuildingAt(tile.tx, tile.tz);
      if (b) { this.game.selectBuilding(b); return; }
      const tree = this.treeAt(tile.tx, tile.tz);
      if (tree) {
        this.game.selectColonist(null);
        this.ui.toast(`${tree.pine ? 'Pine' : 'Oak'} · ${Math.round(tree.height * 10) / 10}m tall`, 'tree');
        return;
      }
      const rock = this.rockAt(tile.tx, tile.tz);
      if (rock) { this.game.selectColonist(null); this.ui.toast('Granite outcrop · mineable', 'rock'); return; }
    }
    this.game.selectColonist(null);
  }

  raycastGround(ndc) {
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.world.ground, false);
    return hits[0] || null;
  }

  screenToTile(clientX, clientY) {
    const rect = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const hit = this.raycastGround(ndc);
    if (!hit) return null;
    const tile = this.world.tileAt(hit.point.x, hit.point.z);
    return { tx: tile.tx, tz: tile.tz, point: hit.point };
  }

  updateGhostFromScreen(clientX, clientY) {
    if (!this.placementType) return;
    const rect = this.dom.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return;
    const tile = this.screenToTile(clientX, clientY);
    if (!tile) return;
    this.game.setGhostTile(tile.tx, tile.tz);
  }

  treeAt(tx, tz) {
    let best = null;
    for (const t of this.world.trees) {
      if (t.removed) continue;
      if (Math.abs(t.tx - tx) <= 0.6 && Math.abs(t.tz - tz) <= 0.6) return t;
      if (Math.abs(t.tx - tx) <= 1 && Math.abs(t.tz - tz) <= 1) best = t;
    }
    return best;
  }

  rockAt(tx, tz) {
    for (const r of this.world.rocks) {
      if (r.removed) continue;
      if (r.tx === tx && r.tz === tz) return r;
    }
    return null;
  }
}
