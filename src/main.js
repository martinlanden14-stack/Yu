import * as THREE from 'three';
import './style.css';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { World } from './world.js';
import { Particles } from './particles.js';
import { Colony } from './colony.js';
import { UI } from './ui.js';
import { CameraRig, InputController } from './input.js';
import { AudioEngine } from './audio.js';
import { BUILDINGS } from './buildings.js';
import { clamp } from './utils.js';

class Rain {
  constructor(scene) {
    this.count = 900;
    this.positions = new Float32Array(this.count * 6);
    this.vel = new Float32Array(this.count);
    this.offsets = new Float32Array(this.count * 3);
    for (let i = 0; i < this.count; i++) {
      this.offsets[i * 3] = (Math.random() - 0.5) * 44;
      this.offsets[i * 3 + 1] = Math.random() * 24;
      this.offsets[i * 3 + 2] = (Math.random() - 0.5) * 44;
      this.vel[i] = 18 + Math.random() * 12;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.mat = new THREE.LineBasicMaterial({ color: 0xcfe4e8, transparent: true, opacity: 0, depthWrite: false });
    this.lines = new THREE.LineSegments(geo, this.mat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 5;
    scene.add(this.lines);
    this.active = false;
    this.gain = 0;
    this.center = new THREE.Vector3();
    this.geo = geo;
  }

  update(dt, camera, target, active) {
    this.active = active;
    this.gain += ((active ? 1 : 0) - this.gain) * Math.min(1, dt * 1.4);
    this.mat.opacity = this.gain * 0.32;
    this.lines.visible = this.gain > 0.01;
    if (!this.lines.visible) return;
    this.center.set(target.x, 0, target.z);
    for (let i = 0; i < this.count; i++) {
      this.offsets[i * 3 + 1] -= this.vel[i] * dt;
      if (this.offsets[i * 3 + 1] < 0) {
        this.offsets[i * 3 + 1] = 20 + Math.random() * 8;
        this.offsets[i * 3] = (Math.random() - 0.5) * 44;
        this.offsets[i * 3 + 2] = (Math.random() - 0.5) * 44;
      }
      const x = this.center.x + this.offsets[i * 3];
      const y = this.offsets[i * 3 + 1];
      const z = this.center.z + this.offsets[i * 3 + 2];
      this.positions[i * 6] = x;
      this.positions[i * 6 + 1] = y;
      this.positions[i * 6 + 2] = z;
      this.positions[i * 6 + 3] = x + 0.035;
      this.positions[i * 6 + 4] = y + 0.65;
      this.positions[i * 6 + 5] = z;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}

async function boot() {
  const container = document.getElementById('scene');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  } catch (e) {
    document.getElementById('loading').innerHTML = '<p style="font-family:var(--serif);font-size:20px">This valley needs WebGL</p><span>Try a modern browser with hardware acceleration.</span>';
    return;
  }
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.innerWidth < 760;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.8 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.14;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.5, 420);
  camera.position.set(12, 18, 18);

  const world = new World(renderer, scene);
  const particles = new Particles(scene);
  const colony = new Colony(world, particles, scene);
  const rig = new CameraRig(camera, world, renderer.domElement);

  // postprocessing: gentle bloom keeps firelight and night skies alive
  let composer = null, bloom = null;
  try {
    composer = new EffectComposer(renderer);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(window.innerWidth, window.innerHeight);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), isMobile ? 0.3 : 0.38, 0.6, 0.82);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  } catch {
    composer = null;
  }

  // translucent placement ghost
  const ghost = makeGhost();
  scene.add(ghost.group);
  ghost.group.visible = false;

  const rain = new Rain(scene);

  const game = {
    renderer, scene, camera, world, particles, colony, rig, composer, bloom, ghost, rain,
    ui: null, input: null, audio: null,
    placementType: null, ghostValid: false, ghostTile: null,
    lastSpeed: 1,
    ready: false,

    setTool(tool) {
      if (tool === 'build') { this.ui.openBuildSheet(); return; }
      if (tool !== 'select') this.clearSelection();
      this.cancelPlacement(false);
      this.ui.setTool(tool);
      this.input.mode = tool;
      if (tool === 'chop' || tool === 'mine' || tool === 'harvest') {
        this.ui.tutorial.classList.add('hidden');
        this.audio?.click();
      }
      if (tool === 'select') {
        this.audio?.click();
      }
    },

    beginPlacement(type) {
      const def = BUILDINGS[type];
      if (!def) return;
      this.clearSelection();
      this.placementType = type;
      this.ghostTile = null;
      ghost.configure(def);
      ghost.group.visible = true;
      this.ui.setPlacement(type);
      this.input.mode = 'build';
      this.input.placementType = type;
      // place the ghost under the middle of the view
      const gt = world.tileAt(rig.desiredTarget.x, rig.desiredTarget.z);
      this.setGhostTile(gt.tx, gt.tz);
      this.audio?.place();
    },

    cancelPlacement(showUI = true) {
      if (this.placementType) {
        this.placementType = null;
        ghost.group.visible = false;
        this.ghostTile = null;
        if (this.input) this.input.placementType = null;
      }
      if (showUI && this.ui) this.ui.clearPlacement();
      if (this.input) this.input.mode = this.ui?.tool || 'select';
    },

    setGhostTile(tx, tz) {
      if (!this.placementType) return;
      const def = BUILDINGS[this.placementType];
      tx = clamp(tx, 0, world.size - def.size[0]);
      tz = clamp(tz, 0, world.size - def.size[1]);
      this.ghostTile = { tx, tz };
      const cx = tx + (def.size[0] - 1) / 2;
      const cz = tz + (def.size[1] - 1) / 2;
      const p = world.worldPos(cx, cz);
      ghost.group.position.set(p.x, p.y + 0.01, p.z);
      const result = this.validatePlacement(this.placementType, tx, tz);
      ghost.setValid(result.ok);
      this.ghostValid = result.ok;
      this.ghostReason = result.reason;
    },

    validatePlacement(type, tx, tz) {
      const def = BUILDINGS[type];
      if (!def) return { ok: false, reason: 'Unknown structure' };
      if (!colony.canAfford(def.cost)) return { ok: false, reason: 'Not enough materials' };
      for (let dz = 0; dz < def.size[1]; dz++) {
        for (let dx = 0; dx < def.size[0]; dx++) {
          const x = tx + dx, z = tz + dz;
          if (!world.isBuildable(x, z)) {
            return { ok: false, reason: world.typeAt(x, z) === 3 ? 'Too wet to build there' : 'That ground is not clear' };
          }
          if (colony.groundItems.some(i => !i.removed && Math.abs(i.tx - x) < 0.5 && Math.abs(i.tz - z) < 0.5)) {
            return { ok: false, reason: 'Clear the supplies first' };
          }
        }
      }
      return { ok: true };
    },

    tryPlace(tx, tz) {
      if (!this.placementType) return;
      const result = this.validatePlacement(this.placementType, tx, tz);
      if (!result.ok) {
        this.ui.toast(result.reason, 'danger');
        this.audio?.error();
        return;
      }
      const res = colony.placeBuilding(this.placementType, tx, tz);
      if (!res.ok) {
        this.ui.toast(res.reason, 'danger');
        this.audio?.error();
        return;
      }
      this.audio?.place();
      const p = world.worldPos(tx, tz);
      particles.sparkle(p.x, p.y + 0.4, p.z, 10);
      // remain in placement mode for repeat builds if materials remain
      if (colony.canAfford(BUILDINGS[this.placementType].cost)) {
        this.setGhostTile(tx, tz);
      } else {
        this.cancelPlacement();
        this.ui.toast('Out of materials for more of those', 'danger');
      }
    },

    selectColonist(c) {
      if (this.selectedColonist === c) {
        this.clearSelection();
        return;
      }
      this.clearSelection();
      this.selectedColonist = c;
      if (c) {
        c.select(true);
        this.ui.showColonist(c);
        this.audio?.select();
      } else {
        this.ui.hideSelection();
      }
    },

    clearSelection() {
      if (this.selectedColonist) this.selectedColonist.select(false);
      if (this.selectedBuilding) this.selectedBuilding.setHighlight(false);
      this.selectedColonist = null;
      this.selectedBuilding = null;
      this.ui?.hideSelection();
    },

    selectBuilding(b) {
      if (this.selectedBuilding === b) { this.clearSelection(); return; }
      this.clearSelection();
      this.selectedBuilding = b;
      b.setHighlight(true);
      this.ui.showBuilding(b);
      this.audio?.select();
    },

    focusColonist(c) {
      if (!c) return;
      rig.focus(c.x, c.z, 12.5);
      this.audio?.click();
    },

    focusBuilding(b) {
      if (!b) return;
      rig.focus(b.x, b.z, 13);
      this.audio?.click();
    },

    prioritize(c) {
      if (!c) return;
      if (c.task) {
        this.ui.toast(`${c.name} is already busy`, 'info');
        return;
      }
      colony.think(c, true);
      this.ui.toast(`${c.name} is looking for work`, 'order');
      this.audio?.select();
    },

    demolish(b) {
      if (!b) return;
      const refund = {};
      for (const [k, v] of Object.entries(b.def.cost)) refund[k] = Math.floor(v * (b.state === 'built' ? 0.5 : 1));
      for (const [k, v] of Object.entries(refund)) if (v > 0) colony.addResource(k, v);
      const name = b.def.name;
      colony.removeBuilding(b);
      this.clearSelection();
      this.ui.toast(`${name} ${b.state === 'built' ? 'deconstructed' : 'cancelled'}`, 'build');
      colony.log(`${name} ${b.state === 'built' ? 'taken down' : 'blueprint cleared'}.`, 'build');
      this.audio?.place();
    },

    setSpeed(n) {
      colony.timeScale = n;
      this.ui.setSpeedUI(n);
      this.audio?.click();
    },

    togglePause() {
      if (colony.timeScale > 0) {
        this.lastSpeed = colony.timeScale;
        this.setSpeed(0);
      } else this.setSpeed(this.lastSpeed || 1);
    },

    simulate(seconds) {
      const step = 0.05;
      for (let t = 0; t < seconds; t += step) {
        colony.update(step);
        world.update(step, colony.hour);
      }
    },
  };

  const audio = new AudioEngine();
  game.audio = audio;

  const ui = new UI(game, colony);
  game.ui = ui;
  colony.ui = ui;
  const input = new InputController({ dom: renderer.domElement, camera, rig, world, colony, ui, game, buildGhost: ghost, audio });
  game.input = input;

  // resize
  const onResize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    if (composer) {
      composer.setSize(w, h);
      bloom?.setSize(w, h);
    }
    rig.resize();
    updateParticleScale();
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 120));

  function updateParticleScale() {
    const h = renderer.domElement.height;
    const scale = h / (2 * Math.tan((camera.fov * Math.PI) / 360));
    particles.setScale(scale);
  }
  updateParticleScale();

  // clock and render loop
  const clock = new THREE.Clock();
  let elapsed = 0;
  let frames = 0;
  let fpsTime = 0;
  let adjusted = false;
  let readyFrames = 0;

  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt;
    frames++;
    fpsTime += dt;

    colony.update(dt);
    world.update(dt, colony.hour);
    input.update(dt);
    particles.update(dt);
    rain.update(dt, camera, rig.target, colony.weather.type === 'Rain');
    if (colony.weather.type === 'Rain') {
      world.sun.intensity *= 0.55;
      world.hemi.intensity *= 0.82;
      world.scene.fog.density *= 1.25;
      if (Math.random() < dt * 10) {
        particles.splash(rig.target.x + (Math.random() - 0.5) * 18, 0.1, rig.target.z + (Math.random() - 0.5) * 18, 1);
      }
    }
    ui.update(dt, camera);
    audio.setEnvironment(colony.hour, colony.weather.type);
    audio.update(dt);

    // animate ghost softly
    if (ghost.group.visible) {
      ghost.pulse(elapsed);
    }

    if (composer) composer.render();
    else renderer.render(scene, camera);

    if (!game.ready) {
      readyFrames++;
      if (readyFrames > 1) {
        game.ready = true;
        document.body.dataset.ready = 'true';
        const loading = document.getElementById('loading');
        loading.classList.add('done');
        setTimeout(() => loading.remove(), 900);
      }
    }

    // gentle adaptive quality: if the device is struggling, drop DPR once
    if (!adjusted && elapsed > 5 && frames / fpsTime < 32) {
      adjusted = true;
      renderer.setPixelRatio(Math.min(1, window.devicePixelRatio || 1));
      if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(window.innerWidth, window.innerHeight); }
      if (bloom) bloom.enabled = false;
      updateParticleScale();
    }
    if (fpsTime > 1) { fpsTime = 0; frames = 0; }
  }

  window.__game = game;
  window.__ridgewood = game;
  frame();
}

function makeGhost() {
  const group = new THREE.Group();
  const fillMat = new THREE.MeshBasicMaterial({ color: 0x8de0a1, transparent: true, opacity: 0.22, depthWrite: false });
  const edgeMat = new THREE.LineBasicMaterial({ color: 0xb8ffcf, transparent: true, opacity: 0.85 });
  const padMat = new THREE.MeshBasicMaterial({ color: 0x8de0a1, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
  const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), fillMat);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), edgeMat);
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), padMat);
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.025;
  group.add(box, edges, pad);
  return {
    group, box, edges, pad, fillMat, edgeMat, padMat,
    configure(def) {
      const [w, h] = def.size;
      const height = def.id === 'wall' || def.id === 'stonewall' ? 1.45
        : def.id === 'beacon' ? 2.9
        : def.id === 'farm' ? 0.35
        : def.id === 'floor' ? 0.12
        : def.id === 'bed' ? 0.6
        : def.id === 'door' ? 1.5 : 1.2;
      box.scale.set(w - 0.06, height, h - 0.06);
      box.position.y = height / 2;
      edges.scale.copy(box.scale);
      edges.position.copy(box.position);
      pad.scale.set(w - 0.02, h - 0.02, 1);
    },
    setValid(ok) {
      const c = ok ? 0x8de0a1 : 0xe2856f;
      fillMat.color.setHex(c);
      edgeMat.color.setHex(ok ? 0xb8ffcf : 0xffb3a3);
      padMat.color.setHex(c);
      fillMat.opacity = ok ? 0.2 : 0.24;
    },
    pulse(t) {
      fillMat.opacity = (0.16 + Math.sin(t * 3) * 0.05) * (this.fillMat.color.getHex() === 0x8de0a1 ? 1 : 1.2);
      edges.material.opacity = 0.65 + Math.sin(t * 3) * 0.18;
    },
  };
}

boot().catch((error) => {
  console.error(error);
  const loading = document.getElementById('loading');
  if (loading) {
    loading.innerHTML = `<p style="font-family:var(--serif);font-size:20px">A tree fell on the renderer</p><span>${String(error.message || error).slice(0, 120)}</span>`;
  }
});
