// Static 2.5D colliders (circles + oriented boxes with vertical extent) in a
// spatial hash. Used by board physics, enemy steering and bullet raycasts.

export interface Collider {
  id: number;
  kind: 'circle' | 'box';
  x: number;
  z: number;
  r: number; // circle radius / box bounding radius
  hx: number;
  hz: number;
  rot: number;
  y0: number;
  y1: number;
  /** blocks bullets */
  bullets: boolean;
  /** blocks movement */
  solid: boolean;
  tag?: string;
  data?: any;
  enabled: boolean;
}

const CELL = 8;

export class Colliders {
  private grid = new Map<number, Collider[]>();
  all: Collider[] = [];
  private nextId = 1;
  private stamp = 0;
  private seen = new Map<number, number>();

  private key(i: number, j: number) {
    return (i + 4096) * 8192 + (j + 4096);
  }

  add(c: Omit<Collider, 'id' | 'enabled' | 'r'> & { r?: number; enabled?: boolean }): Collider {
    const col: Collider = { ...c, id: this.nextId++, enabled: c.enabled ?? true, r: c.kind === 'circle' ? c.r ?? 1 : Math.hypot(c.hx, c.hz) } as Collider;
    this.all.push(col);
    this.insert(col);
    return col;
  }
  circle(x: number, z: number, r: number, y0: number, y1: number, opts: Partial<Collider> = {}) {
    return this.add({ kind: 'circle', x, z, r, hx: r, hz: r, rot: 0, y0, y1, bullets: true, solid: true, ...opts });
  }
  box(x: number, z: number, hx: number, hz: number, rot: number, y0: number, y1: number, opts: Partial<Collider> = {}) {
    return this.add({ kind: 'box', x, z, hx, hz, rot, y0, y1, bullets: true, solid: true, ...opts });
  }
  private insert(c: Collider) {
    const r = c.r;
    const i0 = Math.floor((c.x - r) / CELL), i1 = Math.floor((c.x + r) / CELL);
    const j0 = Math.floor((c.z - r) / CELL), j1 = Math.floor((c.z + r) / CELL);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const k = this.key(i, j);
        let l = this.grid.get(k);
        if (!l) this.grid.set(k, (l = []));
        l.push(c);
      }
  }
  remove(c: Collider) {
    c.enabled = false;
    const r = c.r;
    const i0 = Math.floor((c.x - r) / CELL), i1 = Math.floor((c.x + r) / CELL);
    const j0 = Math.floor((c.z - r) / CELL), j1 = Math.floor((c.z + r) / CELL);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const l = this.grid.get(this.key(i, j));
        if (l) {
          const idx = l.indexOf(c);
          if (idx >= 0) l.splice(idx, 1);
        }
      }
    const ai = this.all.indexOf(c);
    if (ai >= 0) this.all.splice(ai, 1);
  }
  /** move a collider (e.g. rising temple column) */
  setY(c: Collider, y0: number, y1: number) {
    c.y0 = y0;
    c.y1 = y1;
  }

  query(x: number, z: number, r: number, fn: (c: Collider) => void) {
    this.stamp++;
    const i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL);
    const j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const l = this.grid.get(this.key(i, j));
        if (!l) continue;
        for (const c of l) {
          if (!c.enabled || this.seen.get(c.id) === this.stamp) continue;
          this.seen.set(c.id, this.stamp);
          fn(c);
        }
      }
  }

  /**
   * Resolve a moving circle (x,z,radius) at height y..y+h against solid colliders.
   * Returns push-out vector and the collider normal of deepest contact.
   */
  resolve(x: number, z: number, y: number, h: number, radius: number, out: { x: number; z: number; nx: number; nz: number; hit: Collider | null }) {
    out.x = 0;
    out.z = 0;
    out.nx = 0;
    out.nz = 0;
    out.hit = null;
    let best = 0;
    this.query(x, z, radius + 2, (c) => {
      if (!c.solid || y > c.y1 || y + h < c.y0) return;
      let px = 0, pz = 0, pen = 0;
      if (c.kind === 'circle') {
        const dx = x - c.x, dz = z - c.z;
        const d = Math.hypot(dx, dz);
        pen = c.r + radius - d;
        if (pen <= 0) return;
        const inv = d > 1e-5 ? 1 / d : 0;
        px = dx * inv || 1;
        pz = dz * inv;
      } else {
        const cs = Math.cos(c.rot), sn = Math.sin(c.rot);
        const dx = x - c.x, dz = z - c.z;
        const lx = dx * cs + dz * sn, lz = -dx * sn + dz * cs;
        const qx = Math.max(-c.hx, Math.min(c.hx, lx)), qz = Math.max(-c.hz, Math.min(c.hz, lz));
        let ex = lx - qx, ez = lz - qz;
        let d = Math.hypot(ex, ez);
        if (d > 1e-5) {
          pen = radius - d;
          if (pen <= 0) return;
          ex /= d;
          ez /= d;
        } else {
          // inside box: push along smallest axis
          const ox = c.hx - Math.abs(lx), oz = c.hz - Math.abs(lz);
          if (ox < oz) {
            ex = Math.sign(lx) || 1;
            ez = 0;
            pen = ox + radius;
          } else {
            ex = 0;
            ez = Math.sign(lz) || 1;
            pen = oz + radius;
          }
        }
        px = ex * cs - ez * sn;
        pz = ex * sn + ez * cs;
      }
      out.x += px * pen;
      out.z += pz * pen;
      if (pen > best) {
        best = pen;
        out.nx = px;
        out.nz = pz;
        out.hit = c;
      }
    });
    return out;
  }

  /** ray vs colliders (bullets). Returns nearest t or -1 */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, out: { t: number; c: Collider | null; nx: number; nz: number }, filter?: (c: Collider) => boolean) {
    out.t = -1;
    out.c = null;
    const L = Math.hypot(dx, dz);
    if (L < 1e-6) return out;
    // march cells along ray in XZ
    const steps = Math.ceil((maxT * L) / (CELL * 0.5)) + 1;
    const seenIds = new Set<number>();
    let best = maxT;
    for (let s = 0; s <= steps; s++) {
      const t = (s / steps) * maxT;
      const x = ox + dx * t, z = oz + dz * t;
      const i = Math.floor(x / CELL), j = Math.floor(z / CELL);
      const l = this.grid.get(this.key(i, j));
      if (!l) continue;
      for (const c of l) {
        if (!c.enabled || !c.bullets || seenIds.has(c.id)) continue;
        if (filter && !filter(c)) continue;
        seenIds.add(c.id);
        let th = -1, nx = 0, nz = 0;
        if (c.kind === 'circle') {
          const fx = ox - c.x, fz = oz - c.z;
          const a = dx * dx + dz * dz, b = 2 * (fx * dx + fz * dz), cc = fx * fx + fz * fz - c.r * c.r;
          const disc = b * b - 4 * a * cc;
          if (disc < 0) continue;
          const sq = Math.sqrt(disc);
          th = (-b - sq) / (2 * a);
          if (th < 0) th = (-b + sq) / (2 * a) > 0 && cc < 0 ? 0 : -1;
          if (th >= 0) {
            const hx = ox + dx * th - c.x, hz = oz + dz * th - c.z;
            const hl = Math.hypot(hx, hz) || 1;
            nx = hx / hl;
            nz = hz / hl;
          }
        } else {
          const cs = Math.cos(c.rot), sn = Math.sin(c.rot);
          const lx = (ox - c.x) * cs + (oz - c.z) * sn, lz = -(ox - c.x) * sn + (oz - c.z) * cs;
          const ldx = dx * cs + dz * sn, ldz = -dx * sn + dz * cs;
          let tmin = -Infinity, tmax = Infinity, axis = 0;
          for (const [o, d, h, ax] of [[lx, ldx, c.hx, 0], [lz, ldz, c.hz, 1]] as [number, number, number, number][]) {
            if (Math.abs(d) < 1e-9) {
              if (o < -h || o > h) { tmin = Infinity; break; }
            } else {
              let t1 = (-h - o) / d, t2 = (h - o) / d;
              if (t1 > t2) [t1, t2] = [t2, t1];
              if (t1 > tmin) { tmin = t1; axis = ax; }
              tmax = Math.min(tmax, t2);
            }
          }
          if (tmin <= tmax && tmax >= 0) {
            th = Math.max(0, tmin);
            const sgn = axis === 0 ? -Math.sign(ldx) : -Math.sign(ldz);
            const lnx = axis === 0 ? sgn : 0, lnz = axis === 1 ? sgn : 0;
            nx = lnx * cs - lnz * sn;
            nz = lnx * sn + lnz * cs;
          }
        }
        if (th < 0 || th > best) continue;
        const y = oy + dy * th;
        if (y < c.y0 || y > c.y1) continue;
        best = th;
        out.t = th;
        out.c = c;
        out.nx = nx;
        out.nz = nz;
      }
      if (out.t >= 0 && out.t < t) break;
    }
    return out;
  }

  clear() {
    this.grid.clear();
    this.all.length = 0;
  }
}
