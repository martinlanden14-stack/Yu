// A* on the colony tile grid with line-of-sight path smoothing.
class MinHeap {
  constructor() { this.items = []; }
  push(node) {
    const a = this.items;
    a.push(node);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    if (!a.length) return null;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let s = i;
        if (l < a.length && a[l].f < a[s].f) s = l;
        if (r < a.length && a[r].f < a[s].f) s = r;
        if (s === i) break;
        [a[s], a[i]] = [a[i], a[s]];
        i = s;
      }
    }
    return top;
  }
  get size() { return this.items.length; }
}

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414],
];

export function findNearestWalkable(world, tx, tz, maxRadius = 6) {
  if (world.isWalkable(tx, tz)) return { tx, tz };
  for (let r = 1; r <= maxRadius; r++) {
    let best = null, bestD = Infinity;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const nx = tx + dx, nz = tz + dz;
        if (!world.isWalkable(nx, nz)) continue;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = { tx: nx, tz: nz }; }
      }
    }
    if (best) return best;
  }
  return null;
}

export function findPath(world, start, goal, maxNodes = 4200) {
  const s = findNearestWalkable(world, start.tx, start.tz);
  let g = goal;
  if (!world.isWalkable(g.tx, g.tz)) g = findNearestWalkable(world, goal.tx, goal.tz);
  if (!s || !g) return null;
  if (s.tx === g.tx && s.tz === g.tz) return [{ tx: g.tx, tz: g.tz }];

  const SIZE = world.size;
  const N = SIZE * SIZE;
  const gScore = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const startI = s.tz * SIZE + s.tx;
  const goalI = g.tz * SIZE + g.tx;
  const h = (tx, tz) => {
    const dx = Math.abs(tx - g.tx), dz = Math.abs(tz - g.tz);
    return (dx + dz) + (1.414 - 2) * Math.min(dx, dz);
  };
  const open = new MinHeap();
  gScore[startI] = 0;
  open.push({ i: startI, tx: s.tx, tz: s.tz, f: h(s.tx, s.tz) });
  let visited = 0;
  while (open.size) {
    const cur = open.pop();
    if (closed[cur.i]) continue;
    closed[cur.i] = 1;
    if (cur.i === goalI) {
      const path = [];
      let ci = cur.i;
      while (ci !== -1) {
        path.push({ tx: ci % SIZE, tz: (ci / SIZE) | 0 });
        ci = came[ci];
      }
      path.reverse();
      return smoothPath(world, path);
    }
    if (++visited > maxNodes) break;
    for (const [dx, dz, cost] of DIRS) {
      const nx = cur.tx + dx, nz = cur.tz + dz;
      if (!world.isWalkable(nx, nz)) continue;
      if (dx && dz && (!world.isWalkable(cur.tx + dx, cur.tz) || !world.isWalkable(cur.tx, cur.tz + dz))) continue;
      const ni = nz * SIZE + nx;
      if (closed[ni]) continue;
      const ng = gScore[cur.i] + cost;
      if (ng < gScore[ni]) {
        gScore[ni] = ng;
        came[ni] = cur.i;
        open.push({ i: ni, tx: nx, tz: nz, f: ng + h(nx, nz) });
      }
    }
  }
  return null;
}

export function smoothPath(world, path) {
  if (path.length <= 2) return path;
  const out = [path[0]];
  let i = 0;
  while (i < path.length - 1) {
    let j = Math.min(path.length - 1, i + 14);
    while (j > i + 1 && !lineWalkable(world, path[i], path[j])) j--;
    out.push(path[j]);
    i = j;
  }
  return out;
}

export function lineWalkable(world, a, b) {
  const dx = b.tx - a.tx, dz = b.tz - a.tz;
  const dist = Math.hypot(dx, dz);
  const steps = Math.ceil(dist * 3);
  let px = a.tx, pz = a.tz;
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const x = Math.round(a.tx + dx * t);
    const z = Math.round(a.tz + dz * t);
    if (x === px && z === pz) continue;
    if (!world.isWalkable(x, z)) return false;
    if (x !== px && z !== pz) {
      if (!world.isWalkable(px, z) || !world.isWalkable(x, pz)) return false;
    }
    px = x; pz = z;
  }
  return true;
}

export function adjacentTiles(world, tx, tz, radius = 1) {
  const out = [];
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (!radius && !dx && !dz) continue;
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius && radius > 0) continue;
      const nx = tx + dx, nz = tz + dz;
      if (world.isWalkable(nx, nz)) out.push({ tx: nx, tz: nz });
    }
  }
  return out;
}
