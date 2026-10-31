import { BUILDINGS, BUILD_ORDER, costString } from './buildings.js';
import { clamp } from './utils.js';

const ICONS = {
  note: '<path d="M12 3v18M5 8h14M5 16h14"/>',
  build: '<path d="m3 11 9-7 9 7"/><path d="M5 10v10h14V10"/>',
  food: '<path d="M6 3v8a3 3 0 0 0 6 0V3M9 11v10M15 3c2 0 3 2 3 5s-1 5-3 5v8"/>',
  order: '<path d="M5 5h14M5 12h14M5 19h9"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  danger: '<path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5M12 17h.01"/>',
  star: '<path d="m12 3 2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.8L6.6 19.6l1-6L3.3 9.4l6-.9L12 3Z"/>',
  join: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-4 2.7-6.5 6-6.5s6 2.5 6 6.5"/><path d="M17 8h4M19 6v4"/>',
  gift: '<path d="M4 10h16v10H4V10ZM3 6h18v4H3V6Z"/><path d="M12 6v14M12 6c-3 0-5-1-5-3 0-1.5 2-2 3-1 1 .8 2 4 2 4ZM12 6c3 0 5-1 5-3 0-1.5-2-2-3-1-1 .8-2 4-2 4Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  rain: '<path d="M7 15a4 4 0 0 1 .4-8 5.5 5.5 0 0 1 10.4 1.5A3.3 3.3 0 0 1 17 15H7Z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>',
  tree: '<path d="M12 21V9M12 13 7 9M12 11l4-3"/><path d="M7 10a5 5 0 1 1 10 0c0 2-2 4-5 4s-5-2-5-4Z"/>',
  rock: '<path d="m5 18 2-9 7-4 5 5-2 8H5Z"/><path d="m7 9 5 3 7 0M12 12l-1 6"/>',
  farm: '<path d="M3 20h18M6 20V9M12 20V7M18 20V9"/><path d="M6 12C4 12 3 10.5 3 9c2 0 3 1.2 3 3ZM6 12c2 0 3-1.5 3-3-2 0-3 1.2-3 3ZM12 10c-2 0-3-1.5-3-3 2 0 3 1.2 3 3ZM12 10c2 0 3-1.5 3-3-2 0-3 1.2-3 3Z"/>',
  sleep: '<path d="M3 17h18M5 17v-4h5a4 4 0 0 1 4 4"/><path d="M15 5h5l-5 5h5"/>',
  hammer: '<path d="m14 4 6 6-3 3-6-6 3-3ZM10 9 4 15l3 3 6-6"/>',
  chop: '<path d="m14 3 6 3-2 4-6-3Z"/><path d="m12.5 8.5 2 3L7 19l-3-2 8.5-8.5Z"/>',
};

function icon(kind) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[kind] || ICONS.note}</svg>`;
}

function hex(n) { return '#' + n.toString(16).padStart(6, '0'); }
function shade(hexColor, amt) {
  const c = new THREE.Color(hexColor);
  c.offsetHSL(0, 0, amt);
  return '#' + c.getHexString();
}
import * as THREE from 'three';

export class UI {
  constructor(game, colony) {
    this.game = game;
    this.colony = colony;
    this.selected = null;
    this.selectedBuilding = null;
    this.tool = 'select';
    this.placement = null;
    this.labelMap = new Map();
    this.alertKey = '';
    this.alertTimer = 0;
    this.lastNeeds = 0;
    this.tutorialStep = 0;
    this.toastCount = 0;
    this.buildOpen = false;

    this.$ = (s) => document.querySelector(s);
    this.clock = this.$('#clock');
    this.day = this.$('#day');
    this.weather = this.$('#weather');
    this.resVals = {};
    for (const el of document.querySelectorAll('.res')) this.resVals[el.dataset.res] = el.querySelector('.res-val');
    this.strip = this.$('#colonist-strip');
    this.portraitCanvas = this.$('#sel-portrait canvas');
    this.panel = this.$('#selection-panel');
    this.dock = this.$('#colonist-dock');
    this.labels = this.$('#labels');
    this.buildSheet = this.$('#build-sheet');
    this.buildGrid = this.$('#build-grid');
    this.placementTip = this.$('#placement-tip');
    this.logPanel = this.$('#log-panel');
    this.menuPanel = this.$('#menu-panel');
    this.helpOverlay = this.$('#help-overlay');
    this.tutorial = this.$('#tutorial');
    this.alerts = this.$('#alerts');
    this.toasts = this.$('#toasts');
    this.toolButtons = [...document.querySelectorAll('#tool-row .tool')];
    this.speedButtons = [...document.querySelectorAll('.spd')];

    this.buildBuildGrid();
    this.bind();
    this.refreshColonists();
    this.updateResources(this.colony.resources);
    this.renderObjectives();
    this.updateSpeedButtons();
    this.showTutorialStep(0);
  }

  bind() {
    for (const btn of this.toolButtons) {
      btn.addEventListener('click', () => {
        const tool = btn.dataset.tool;
        this.game.audio?.click();
        if (tool === 'build') this.openBuildSheet();
        else this.game.setTool(tool);
      });
    }
    for (const btn of this.speedButtons) {
      btn.addEventListener('click', () => { this.game.audio?.click(); this.game.setSpeed(Number(btn.dataset.speed)); });
    }
    this.$('#sel-close').addEventListener('click', () => this.game.selectColonist(null));
    document.querySelectorAll('#selection-panel [data-action="focus"]').forEach(b => b.addEventListener('click', () => this.focusSelected()));
    document.querySelectorAll('#selection-panel [data-action="prioritize"]').forEach(b => b.addEventListener('click', () => {
      if (this.selected) this.game.prioritize(this.selected);
    }));
    this.$('#sheet-close').addEventListener('click', () => this.closeBuildSheet());
    this.buildSheet.querySelector('.sheet-backdrop').addEventListener('click', () => this.closeBuildSheet());
    this.$('#placement-cancel').addEventListener('click', () => this.game.cancelPlacement());
    this.$('#btn-objectives').addEventListener('click', () => { this.game.audio?.click(); this.openLog(); });
    this.$('#log-close').addEventListener('click', () => this.closeLog());
    this.logPanel.querySelector('.sheet-backdrop').addEventListener('click', () => this.closeLog());
    this.$('#btn-menu').addEventListener('click', () => { this.game.audio?.click(); this.openMenu(); });
    this.$('#menu-close').addEventListener('click', () => this.closeMenu());
    this.menuPanel.querySelector('.sheet-backdrop').addEventListener('click', () => this.closeMenu());
    this.$('#btn-help').addEventListener('click', () => { this.helpOverlay.classList.add('open'); });
    this.$('#help-close').addEventListener('click', () => { this.helpOverlay.classList.remove('open'); });
    this.$('#btn-reset').addEventListener('click', () => window.location.reload());
    this.$('#btn-sound').addEventListener('click', () => {
      const audio = this.game.audio;
      if (audio && !audio.ctx) audio.unlock();
      const muted = audio?.toggleMute();
      this.$('#btn-sound').classList.toggle('muted', muted);
    });
    this.$('#tut-next').addEventListener('click', () => {
      this.game.audio?.click();
      if (this.tutorialStep < 2) this.showTutorialStep(this.tutorialStep + 1);
      else this.tutorial.classList.add('hidden');
    });
  }

  // ── build menu ───────────────────────────────────────────
  buildBuildGrid() {
    this.buildGrid.innerHTML = '';
    for (const id of BUILD_ORDER) {
      const def = BUILDINGS[id];
      const card = document.createElement('button');
      card.className = 'build-card';
      card.dataset.building = id;
      card.innerHTML = `
        <span class="bc-icon"><svg viewBox="0 0 24 24">${def.icon}</svg></span>
        <span class="bc-name">${def.name}</span>
        <span class="bc-cost">${costString(def.cost)}</span>`;
      card.addEventListener('click', () => {
        this.game.audio?.click();
        this.chooseBuilding(id, def);
      });
      card.addEventListener('mouseenter', () => {
        this.$('#cost-preview').textContent = `${def.name} — ${def.desc}`;
      });
      this.buildGrid.appendChild(card);
    }
  }

  refreshBuildGrid() {
    for (const card of this.buildGrid.children) {
      const id = card.dataset.building;
      const def = BUILDINGS[id];
      const afford = this.colony.canAfford(def.cost);
      card.classList.toggle('poor', !afford);
      const costEl = card.querySelector('.bc-cost');
      costEl.innerHTML = Object.entries(def.cost).map(([k, v]) => `<span class="${this.colony.resources[k] < v ? 'miss' : ''}">${v} ${k}</span>`).join(' · ') || 'Free';
    }
  }

  openBuildSheet() {
    this.buildOpen = true;
    this.buildSheet.classList.add('open');
    this.refreshBuildGrid();
    this.$('#cost-preview').textContent = 'Select a structure';
    this.game.audio?.click();
  }

  closeBuildSheet() {
    this.buildOpen = false;
    this.buildSheet.classList.remove('open');
  }

  chooseBuilding(id, def) {
    if (!this.colony.canAfford(def.cost)) {
      this.toast(`Not enough materials for ${def.name.toLowerCase()}`, 'danger');
      this.game.audio?.error();
      return;
    }
    this.closeBuildSheet();
    this.game.beginPlacement(id);
  }

  // ── tools & placement ────────────────────────────────────
  setTool(tool) {
    this.tool = tool;
    this.placement = null;
    for (const btn of this.toolButtons) {
      btn.classList.toggle('active', btn.dataset.tool === tool);
      if (btn.dataset.tool === 'cancel') btn.hidden = tool === 'select';
    }
    this.placementTip.classList.remove('show');
    if (tool === 'select') this.closeBuildSheet();
  }

  setPlacement(type) {
    this.placement = type;
    this.tool = 'build';
    for (const btn of this.toolButtons) {
      btn.classList.toggle('active', btn.dataset.tool === 'build');
      if (btn.dataset.tool === 'cancel') btn.hidden = false;
    }
    const def = BUILDINGS[type];
    this.$('#placement-name').textContent = def.name;
    this.$('#placement-cost').textContent = costString(def.cost);
    this.placementTip.classList.add('show');
    this.tutorial.classList.add('hidden');
  }

  clearPlacement() {
    this.placement = null;
    this.tool = 'select';
    for (const btn of this.toolButtons) {
      btn.classList.toggle('active', btn.dataset.tool === 'select');
      if (btn.dataset.tool === 'cancel') btn.hidden = true;
    }
    this.placementTip.classList.remove('show');
  }

  // ── selection ────────────────────────────────────────────
  showColonist(c) {
    this.selected = c;
    this.selectedBuilding = null;
    this.panel.classList.remove('hidden');
    this.panel.querySelector('.needs').style.display = '';
    this.panel.querySelector('.skills').style.display = '';
    this.panel.querySelector('.sel-actions').innerHTML = `
      <button class="pill-btn" data-action="focus">Center</button>
      <button class="pill-btn" data-action="prioritize">Prioritize</button>`;
    this.panel.querySelector('[data-action="focus"]').addEventListener('click', () => this.focusSelected());
    this.panel.querySelector('[data-action="prioritize"]').addEventListener('click', () => this.game.prioritize(this.selected));
    this.panel.querySelector('.sel-title p').textContent = `${c.role} · ${c.traits?.[0] || 'Settler'}`;
    this.drawPortrait(c);
    this.setNeeds(c);
    this.updateSelection();
    this.refreshColonists();
  }

  showBuilding(b) {
    this.selected = null;
    this.selectedBuilding = b;
    this.panel.classList.remove('hidden');
    this.panel.querySelector('.needs').style.display = 'none';
    this.panel.querySelector('.skills').style.display = 'none';
    this.panel.querySelector('.sel-title p').textContent = b.state === 'built' ? 'Structure · built' : 'Structure · blueprint';
    this.panel.querySelector('.sel-actions').innerHTML = `
      <button class="pill-btn" data-action="focus">Center</button>
      <button class="pill-btn" data-action="demolish">${b.state === 'built' ? 'Deconstruct' : 'Cancel'}</button>`;
    this.panel.querySelector('[data-action="focus"]').addEventListener('click', () => this.game.focusBuilding(b));
    this.panel.querySelector('[data-action="demolish"]').addEventListener('click', () => this.game.demolish(b));
    this.drawBuildingPortrait(b);
    this.updateSelection();
    this.refreshColonists();
    this.game.audio?.click();
  }

  hideSelection() {
    this.selected = null;
    this.selectedBuilding = null;
    this.panel.classList.add('hidden');
    this.refreshColonists();
  }

  drawPortrait(c) {
    const cv = this.portraitCanvas;
    const ctx = cv.getContext('2d');
    drawColonistPortrait(ctx, cv.width, cv.height, c);
  }

  drawBuildingPortrait(b) {
    const cv = this.portraitCanvas;
    const ctx = cv.getContext('2d');
    const w = cv.width, h = cv.height;
    ctx.clearRect(0, 0, w, h);
    const g = ctx.createRadialGradient(w * 0.5, h * 0.3, 10, w * 0.5, h * 0.55, w * 0.7);
    g.addColorStop(0, '#41503f');
    g.addColorStop(1, '#1d271f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2 + 4);
    ctx.strokeStyle = '#e7c084';
    ctx.fillStyle = 'rgba(231,192,132,.12)';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const path = new Path2D();
    const def = b.def;
    if (def.id === 'farm') {
      ctx.beginPath(); ctx.moveTo(-34, 26); ctx.lineTo(34, 26);
      for (const x of [-22, 0, 22]) { ctx.moveTo(x, 26); ctx.lineTo(x, -8); }
      for (const x of [-22, 0, 22]) {
        ctx.moveTo(x, 8); ctx.quadraticCurveTo(x - 13, 8, x - 13, -6); ctx.quadraticCurveTo(x, -6, x, 8);
        ctx.moveTo(x, 4); ctx.quadraticCurveTo(x + 13, 4, x + 13, -10); ctx.quadraticCurveTo(x, -10, x, 4);
      }
      ctx.stroke();
    } else if (def.id === 'campfire') {
      ctx.beginPath(); ctx.ellipse(0, 22, 30, 9, 0, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, 6); ctx.bezierCurveTo(16, 0, 17, -16, 0, -30); ctx.bezierCurveTo(-4, -18, -16, -10, -16, 0); ctx.bezierCurveTo(-16, 10, -8, 16, 0, 16); ctx.stroke();
    } else if (def.id === 'beacon') {
      ctx.beginPath(); ctx.moveTo(-26, 30); ctx.lineTo(-6, -22); ctx.lineTo(6, -22); ctx.lineTo(26, 30); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -22); ctx.lineTo(0, -40); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, -26, 5, 0, 7); ctx.fillStyle = '#e7c084'; ctx.fill();
    } else {
      ctx.beginPath(); ctx.moveTo(-32, 24); ctx.lineTo(-32, -6); ctx.lineTo(0, -28); ctx.lineTo(32, -6); ctx.lineTo(32, 24); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-12, 24); ctx.lineTo(-12, 4); ctx.lineTo(12, 4); ctx.lineTo(12, 24); ctx.stroke();
    }
    ctx.restore();
  }

  setNeeds(c) {
    const needs = this.panel.querySelector('#sel-needs');
    needs.innerHTML = c.needsList.map(n => `
      <div class="need" data-need="${n.id}">
        <div class="need-top"><span>${n.label}</span><b>${Math.round(n.value)}</b></div>
        <div class="need-bar"><i style="width:${n.value}%;background:${this.needColor(n.value)}"></i></div>
      </div>`).join('');
    const skills = this.panel.querySelector('#sel-skills');
    const labels = { build: 'Build', chop: 'Wood', mine: 'Mine', farm: 'Farm' };
    skills.innerHTML = Object.entries(c.skills).map(([k, v]) => `<span class="skill-chip">${labels[k] || k} <b>${'●'.repeat(Math.min(5, v))}</b></span>`).join('');
  }

  needColor(v) {
    if (v >= 60) return 'linear-gradient(90deg,#7fae62,#a9c77e)';
    if (v >= 30) return 'linear-gradient(90deg,#ceac5f,#ecc97c)';
    return 'linear-gradient(90deg,#c46954,#e2856f)';
  }

  updateSelection() {
    const c = this.selected;
    const b = this.selectedBuilding;
    if (c) {
      const name = this.panel.querySelector('#sel-name');
      name.textContent = c.name;
      this.panel.querySelector('.sel-title p').textContent = `${c.role} · ${c.traits?.[0] || 'Settler'}`;
      const moodRow = this.panel.querySelector('.mood-row');
      moodRow.querySelector('span:last-child').textContent = c.moodLabel;
      moodRow.querySelector('.mood-dot').style.background = c.moodColor;
      moodRow.querySelector('.mood-dot').style.boxShadow = `0 0 8px ${c.moodColor}aa`;
      const needs = this.panel.querySelector('#sel-needs');
      for (const n of c.needsList) {
        const el = needs.querySelector(`[data-need="${n.id}"]`);
        if (!el) continue;
        el.querySelector('b').textContent = Math.round(n.value);
        const bar = el.querySelector('i');
        bar.style.width = `${n.value}%`;
        bar.style.background = this.needColor(n.value);
      }
      const act = this.panel.querySelector('#sel-activity');
      act.textContent = c.activity;
      this.panel.querySelector('.act-icon').classList.toggle('idle', !c.task || c.activity === 'Wandering');
      this.panel.querySelector('.portrait').style.display = '';
    } else if (b) {
      const name = this.panel.querySelector('#sel-name');
      name.textContent = b.def.name;
      const needs = this.panel.querySelector('.needs');
      needs.style.display = 'block';
      needs.innerHTML = `
        <div class="sel-desc">${b.def.desc}</div>
        ${b.state === 'built' ? '' : `<div class="sel-progress">Construction <div class="need-bar"><i style="width:${Math.round(b.progress * 100)}%"></i></div></div>`}
        ${b.type === 'farm' ? `<div class="sel-progress">Crop growth <div class="need-bar"><i style="width:${Math.round(b.growth * 100)}%"></i></div></div>` : ''}`;
      this.panel.querySelector('#sel-activity').textContent = b.state === 'built' ? 'Standing proud' : 'Waiting for a builder';
      this.panel.querySelector('.act-icon').classList.toggle('idle', b.state !== 'built');
    }
  }

  focusSelected() {
    if (this.selected) this.game.focusColonist(this.selected);
    else if (this.selectedBuilding) this.game.focusBuilding(this.selectedBuilding);
  }

  // ── colonists dock ───────────────────────────────────────
  refreshColonists() {
    const ids = this.colony.colonists.map(c => c.id).join(',');
    if (this._stripIds !== ids) {
      this._stripIds = ids;
      this.strip.innerHTML = '';
      for (const c of this.colony.colonists) {
        const el = document.createElement('button');
        el.className = 'col-portrait';
        el.dataset.id = c.id;
        el.setAttribute('aria-label', c.name);
        const cv = document.createElement('canvas');
        cv.width = 64; cv.height = 64;
        drawColonistPortrait(cv.getContext('2d'), 64, 64, c, true);
        const mood = document.createElement('span');
        mood.className = 'cp-mood';
        mood.innerHTML = '<i></i>';
        const dot = document.createElement('span');
        dot.className = 'cp-activity';
        const zzz = document.createElement('span');
        zzz.className = 'cp-sleep';
        zzz.textContent = 'z';
        el.append(cv, mood, dot, zzz);
        el.addEventListener('click', () => { this.game.audio?.select(); this.game.selectColonist(c); });
        this.strip.appendChild(el);
      }
    }
    for (const c of this.colony.colonists) {
      const el = this.strip.querySelector(`[data-id="${c.id}"]`);
      if (!el) continue;
      el.classList.toggle('selected', this.selected === c);
      el.classList.toggle('working', !!c.task && c.task.phase === 'work');
      el.classList.toggle('sleeping', c.task?.type === 'sleep');
      const bar = el.querySelector('.cp-mood i');
      bar.style.width = `${Math.round(c.mood)}%`;
      bar.style.background = c.moodColor;
    }
  }

  // ── per-frame UI ─────────────────────────────────────────
  update(dt, camera) {
    this.clock.textContent = this.colony.timeString;
    this.day.textContent = `Day ${this.colony.day}`;
    this.weather.textContent = this.colony.weather.type;
    this.weather.style.color = this.colony.weather.type === 'Rain' ? '#9fc1cf' : '';
    if (this.selected) {
      this.updateSelection();
      this.updateNeedsLive();
    } else if (this.selectedBuilding) {
      this.updateSelection();
    }
    this.updateLabels(camera);
    this.alertTimer -= dt;
    if (this.alertTimer <= 0) {
      this.alertTimer = 0.5;
      this.refreshAlerts();
    }
  }

  updateNeedsLive() {
    const c = this.selected;
    if (!c) return;
    const needs = this.panel.querySelector('#sel-needs');
    for (const n of c.needsList) {
      const el = needs.querySelector(`[data-need="${n.id}"]`);
      if (!el) continue;
      el.querySelector('b').textContent = Math.round(n.value);
      const bar = el.querySelector('i');
      bar.style.width = `${n.value}%`;
      bar.style.background = this.needColor(n.value);
    }
    const act = this.panel.querySelector('#sel-activity');
    if (act.textContent !== c.activity) act.textContent = c.activity;
    this.panel.querySelector('.act-icon').classList.toggle('idle', !c.task || c.activity === 'Wandering');
    this.panel.querySelector('.sel-title p').textContent = `${c.role} · ${c.traits?.[0] || 'Settler'}`;
    const moodRow = this.panel.querySelector('.mood-row');
    moodRow.querySelector('span:last-child').textContent = c.moodLabel;
    moodRow.querySelector('.mood-dot').style.background = c.moodColor;
  }

  updateLabels(camera) {
    const placed = [];
    for (const c of this.colony.colonists) {
      let el = this.labelMap.get(c.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'world-label';
        el.innerHTML = `<span class="wl-name"></span><span class="wl-activity"></span>`;
        this.labels.appendChild(el);
        this.labelMap.set(c.id, el);
      }
      const v = new THREE.Vector3(c.x, c.y + 2.05, c.z).project(camera);
      const onScreen = v.z < 1 && v.x > -1.08 && v.x < 1.08 && v.y > -1.08 && v.y < 1.08;
      const dist = camera.position.distanceTo(new THREE.Vector3(c.x, c.y, c.z));
      el.style.opacity = onScreen && dist < 34 ? '1' : '0';
      if (!onScreen) continue;
      let sx = (v.x * 0.5 + 0.5) * window.innerWidth;
      let sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
      for (const q of placed) {
        if (Math.abs(sx - q.x) < 74 && Math.abs(sy - q.y) < 26) sy = Math.min(sy, q.y - 26);
      }
      sy = Math.max(78, sy);
      placed.push({ x: sx, y: sy });
      el.style.left = `${sx}px`;
      el.style.top = `${sy}px`;
      el.classList.toggle('selected', this.selected === c);
      const nameEl = el.firstChild;
      if (nameEl.textContent !== c.name) nameEl.textContent = c.name;
      const activity = c.task?.type === 'sleep' ? 'Sleeping' : (c.activity || 'Idle');
      const actEl = el.lastChild;
      if (actEl.textContent !== activity) actEl.textContent = activity;
      el.style.opacity = onScreen && dist < (this.selected === c ? 50 : 30) ? '1' : onScreen ? '0.7' : '0';
    }
  }

  // ── resources ────────────────────────────────────────────
  updateResources(res, bumpType) {
    for (const [k, v] of Object.entries(res)) {
      const el = this.resVals[k];
      if (!el) continue;
      const next = Math.round(v);
      if (el.textContent !== String(next)) el.textContent = next;
      if (k === bumpType) {
        const parent = el.closest('.res');
        parent.classList.remove('bump');
        void parent.offsetWidth;
        parent.classList.add('bump');
        clearTimeout(parent._bumpT);
        parent._bumpT = setTimeout(() => parent.classList.remove('bump'), 500);
      }
    }
    if (this.buildOpen) this.refreshBuildGrid();
  }

  floatResource(x, y, z, type, amount) {
    const v = new THREE.Vector3(x, y, z).project(this.game.camera);
    if (v.z > 1) return;
    const el = document.createElement('div');
    el.className = 'float-text';
    el.textContent = `${amount > 0 ? '+' : ''}${amount} ${type}`;
    el.style.left = `${(v.x * 0.5 + 0.5) * window.innerWidth}px`;
    el.style.top = `${(-v.y * 0.5 + 0.5) * window.innerHeight}px`;
    this.labels.appendChild(el);
    setTimeout(() => el.remove(), 1400);
  }

  // ── toasts, alerts, logs ─────────────────────────────────
  toast(text, kind = 'note') {
    if (this.toastCount > 2) {
      const first = this.toasts.firstElementChild;
      if (first) first.remove();
    }
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<span class="t-ic">${icon(kind)}</span><span>${text}</span>`;
    this.toasts.appendChild(t);
    this.toastCount++;
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => { t.remove(); this.toastCount = Math.max(0, this.toastCount - 1); }, 360);
    }, 3800);
  }

  refreshAlerts() {
    const list = [];
    for (const c of this.colony.colonists) {
      if (c.hunger < 28) list.push({ key: `hungry${c.id}`, text: `${c.name} is hungry`, kind: 'danger' });
      else if (c.task?.type === 'sleep' && !c.task.bed) list.push({ key: `rough${c.id}`, text: `${c.name} is sleeping rough`, kind: 'warn' });
    }
    if (this.colony.resources.food < 6) list.push({ key: 'foodlow', text: 'Food stores are running low', kind: 'danger' });
    if (this.colony.hour >= 21 || this.colony.hour < 5) {
      if (this.colony.buildings.some(b => b.state === 'blueprint')) list.push({ key: 'bpn', text: 'Builders are heading to bed', kind: 'info' });
    }
    const key = list.map(a => a.key).join(',');
    if (key === this.alertKey) return;
    this.alertKey = key;
    this.alerts.innerHTML = '';
    for (const a of list.slice(0, 2)) {
      const el = document.createElement('div');
      el.className = `alert ${a.kind === 'danger' ? 'danger' : ''}`;
      el.innerHTML = `<span class="a-ic">${icon(a.kind === 'danger' ? 'danger' : 'info')}</span><span>${a.text}</span>`;
      this.alerts.appendChild(el);
    }
  }

  addLog(entry) {
    if (!this.logPanel.classList.contains('open')) return;
    const el = this.logEntryEl(entry);
    this.$('#log-list').prepend(el);
  }

  logEntryEl(entry) {
    const el = document.createElement('div');
    el.className = 'log-entry';
    const h = Math.floor(entry.hour) % 24;
    el.innerHTML = `<span class="le-day">Day ${entry.day}<br>${String(h).padStart(2, '0')}:00</span><span class="le-text">${entry.text}</span>`;
    return el;
  }

  openLog() {
    this.closeBuildSheet();
    this.logPanel.classList.add('open');
    this.$('#log-list').innerHTML = '';
    for (const entry of this.colony.logs) this.$('#log-list').appendChild(this.logEntryEl(entry));
    this.renderObjectives();
  }

  closeLog() { this.logPanel.classList.remove('open'); }

  renderObjectives() {
    const el = this.$('#objective-list');
    if (!el) return;
    el.innerHTML = this.colony.objectives.map(o => {
      const cur = Math.min(o.target, o.get());
      return `<div class="obj ${o.done ? 'done' : ''}"><span class="obj-check"></span><span>${o.label}</span><span class="obj-prog">${o.done ? '' : `${Math.round(cur)}/${o.target}`}</span></div>`;
    }).join('');
    const badge = this.$('#build-badge');
    if (badge) {
      const pending = this.colony.buildings.filter(b => b.state === 'blueprint').length;
      badge.textContent = pending ? String(pending) : '+';
      badge.style.display = pending ? 'grid' : 'none';
    }
  }

  refreshObjectives() { this.renderObjectives(); }

  // ── menu & speed ─────────────────────────────────────────
  openMenu() {
    this.menuPanel.classList.add('open');
    const avgMood = Math.round(this.colony.colonists.reduce((s, c) => s + c.mood, 0) / Math.max(1, this.colony.colonists.length));
    this.$('#menu-stats').innerHTML = `
      <div class="menu-stat"><span>Day</span><b>${this.colony.day}</b></div>
      <div class="menu-stat"><span>Settlers</span><b>${this.colony.colonists.length}</b></div>
      <div class="menu-stat"><span>Structures</span><b>${this.colony.buildings.filter(b => b.state === 'built').length}</b></div>
      <div class="menu-stat"><span>Colony mood</span><b>${avgMood}</b></div>`;
  }

  closeMenu() { this.menuPanel.classList.remove('open'); }

  updateSpeedButtons() {
    for (const btn of this.speedButtons) btn.classList.toggle('active', Number(btn.dataset.speed) === this.colony.timeScale);
  }

  setSpeedUI(n) {
    this.updateSpeedButtons();
  }

  showTutorialStep(i) {
    this.tutorialStep = i;
    const titles = ['Welcome to Ridgewood', 'Build a place to belong', 'Shape the valley'];
    const texts = [
      'Drag to pan · pinch to zoom · tap a settler to meet them.',
      'Open Build to raise beds, walls, a campfire, or a crop plot.',
      'Chop and Mine mark resources. Your settlers handle the rest.',
    ];
    this.$('#tut-title').textContent = titles[i];
    this.$('#tut-text').textContent = texts[i];
    this.$('#tut-next').textContent = i < 2 ? 'Next' : 'Got it';
    this.tutorial.classList.remove('hidden');
  }
}

// ── portraits ────────────────────────────────────────────────
export function drawColonistPortrait(ctx, w, h, c, small = false) {
  ctx.clearRect(0, 0, w, h);
  const s = w / 120;
  const skin = hex(c.skin);
  const hair = hex(c.hair);
  const shirt = hex(c.shirt);
  const accent = hex(c.accent);
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, shade(accent, -0.26));
  bg.addColorStop(0.65, '#26332a');
  bg.addColorStop(1, '#1a231d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  // soft glow
  const glow = ctx.createRadialGradient(w * 0.5, h * 0.42, 2, w * 0.5, h * 0.42, w * 0.55);
  glow.addColorStop(0, 'rgba(255,231,185,.15)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.scale(s, s);
  // shoulders
  ctx.fillStyle = shirt;
  ctx.beginPath();
  ctx.moveTo(10, 122);
  ctx.quadraticCurveTo(14, 89, 43, 82);
  ctx.lineTo(77, 82);
  ctx.quadraticCurveTo(106, 89, 110, 122);
  ctx.closePath();
  ctx.fill();
  // collar
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(46, 83); ctx.lineTo(60, 94); ctx.lineTo(74, 83); ctx.lineTo(70, 79); ctx.lineTo(50, 79); ctx.closePath();
  ctx.fill();
  // neck
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.roundRect?.(52, 67, 16, 20, 6);
  if (!ctx.roundRect) ctx.fillRect(52, 67, 16, 20);
  ctx.fill();
  // head
  const skinGrad = ctx.createRadialGradient(50, 42, 3, 60, 54, 34);
  skinGrad.addColorStop(0, shade(skin, 0.08));
  skinGrad.addColorStop(1, shade(skin, -0.08));
  ctx.fillStyle = skinGrad;
  ctx.beginPath();
  ctx.ellipse(60, 48, 27, 30, 0, 0, Math.PI * 2);
  ctx.fill();
  // ears
  ctx.fillStyle = skin;
  for (const x of [33, 87]) {
    ctx.beginPath(); ctx.ellipse(x, 52, 4.2, 7, 0, 0, Math.PI * 2); ctx.fill();
  }
  // hair
  ctx.fillStyle = hair;
  ctx.beginPath();
  if (c.hairStyle === 3) {
    ctx.ellipse(60, 25, 30, 13, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(33, 24, 54, 8);
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.ellipse(60, 20, 31, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(32, 20, 56, 5);
  } else {
    ctx.ellipse(60, 34, 29, 22, 0, Math.PI, Math.PI * 2);
    ctx.lineTo(89, 48); ctx.quadraticCurveTo(84, 37, 76, 36);
    ctx.quadraticCurveTo(60, 30, 44, 36); ctx.quadraticCurveTo(36, 38, 31, 48);
    ctx.closePath(); ctx.fill();
    if (c.hairStyle === 1) {
      ctx.beginPath(); ctx.arc(80, 24, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(78, 25, 5.5, 0, Math.PI * 2); ctx.fill();
    } else if (c.hairStyle === 2) {
      ctx.beginPath(); ctx.ellipse(30, 48, 7, 16, 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(90, 48, 7, 16, -0.3, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.beginPath(); ctx.ellipse(60, 25, 12, 7, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  // brows
  ctx.strokeStyle = shade(hair, -0.05);
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(45, 45); ctx.quadraticCurveTo(50, 42, 55, 45);
  ctx.moveTo(65, 45); ctx.quadraticCurveTo(70, 42, 75, 45);
  ctx.stroke();
  // eyes
  ctx.fillStyle = '#241f19';
  for (const x of [50, 70]) {
    ctx.beginPath(); ctx.ellipse(x, 53, 3.1, 3.6, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  for (const x of [51.1, 71.1]) { ctx.beginPath(); ctx.arc(x, 51.6, 0.9, 0, Math.PI * 2); ctx.fill(); }
  // nose
  ctx.strokeStyle = shade(skin, -0.14);
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(60, 55); ctx.quadraticCurveTo(58, 61, 61, 62); ctx.stroke();
  // mouth
  ctx.strokeStyle = shade(skin, -0.3);
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(54, 69); ctx.quadraticCurveTo(60, 73, 66, 69); ctx.stroke();
  // cheeks
  ctx.fillStyle = 'rgba(190,94,70,.12)';
  for (const x of [45, 75]) { ctx.beginPath(); ctx.ellipse(x, 63, 6, 4, 0, 0, Math.PI * 2); ctx.fill(); }
  // rim light
  ctx.strokeStyle = 'rgba(255,226,176,.28)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(60, 48, 27, 30, 0, Math.PI * 0.95, Math.PI * 1.5); ctx.stroke();
  // tool / backpack detail
  ctx.fillStyle = shade(shirt, -0.2);
  ctx.beginPath(); ctx.roundRect?.(8, 96, 12, 26, 5);
  if (!ctx.roundRect) ctx.fillRect(8, 96, 12, 26);
  ctx.fill();
  ctx.restore();
  if (small) {
    ctx.strokeStyle = 'rgba(255,255,255,.1)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  }
}
