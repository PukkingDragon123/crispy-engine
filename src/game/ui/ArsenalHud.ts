// The arsenal readouts on the HUD (the revolver keeps its rusty cylinder, Hud3D).
// Every piece is a sculpted 3D model below, photographed once (HudSprites) and
// shown as flat pixel art on the HUD grid; motion is 2D (drops, kicks, tumbles):
//  • COACH GUN — two real paper-hulled shotgun shells stand where the cylinder
//    floats (ribbed red hulls, star crimps, high-brass heads). A shot kicks the
//    spent shell out tumbling; a reload drops a fresh one into its place.
//  • THOMPSON — a blued-steel drum magazine (domed faces, rolled rim, rivet ring,
//    hub and winding key) that indexes round per shot and drops out on reload;
//    the "ammo / mag" count is set beside it in Alagard (Hud.ts draws the type).
//  • CARRIED GUNS — a tooled gun-belt strip with each carried gun as a
//    photograph of its own rig over its slot (keys 3/4/5 above, from Hud.ts);
//    the gun in hand is lifted and bigger, the others sit back dimmed.
//  • TREASURE — revealed dig spots, blueprints and maps get a hovering picture
//    of the real prop over the spot; off screen they ride the screen edge beside
//    a weathered wooden sign-arrow pointing the way (photographed in 16 headings).
import * as THREE from 'three';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { buildRigGeo, RigInstance, RigSpec } from '../../engine/voxel/Rig';
import { VF } from '../../engine/voxel/VoxelModel';
import type { WeaponHud } from '../player/Weapons';
import { buildWeaponRig } from '../player/Weapons';
import type { GunId } from '../meta/Blueprints';
import { xMarker, blueprintScroll, mapFragment } from '../models/props/treasure';
import { sculpt, Surf, PixelFx, fbm3, h3, mixc, mulc, clamp01, sstep, len2, len3, sdRoundBox2, TAU, uiSfx, METAL, KNZ } from './HudKit';
import { SpriteBank, Shot, blitC, blitObj, glint, variant, framingBox, wrap } from './HudSprites';

// ------------------------------------------------------------------ shotgun shell (HUD px, 3 vox/px, axis +y)
const SV = 3;
const SHELL_H = 29.5;
function shellModel() {
  const prof = (Y: number) => {
    if (Y < 0.9) return 5.35;
    if (Y < 7.2) return 4.95 - (Y > 3.6 && Y < 3.85 ? 0.2 : 0);
    if (Y < 27) return 4.72;
    const t = (Y - 27) / 2.5;
    return 4.72 * Math.sqrt(Math.max(0, 1 - t * t * 0.9));
  };
  const sd = (x: number, y: number, z: number) => {
    const X = x / SV, Y = y / SV, Z = z / SV;
    if (Y < 0 || Y > SHELL_H) return 1;
    const r = len2(X, Z), a = Math.atan2(Z, X);
    let R = prof(Y);
    if (Y > 7.2 && Y < 27) R += 0.12 * Math.cos(a * 36); // ribbed paper hull
    if (Y >= 27) R *= 1 - 0.16 * Math.pow(Math.abs(Math.cos(a * 3)), 3) * clamp01((Y - 27) / 1.5); // six-fold star crimp
    let d = r - R;
    if (Y > SHELL_H - 0.8 && r < 1.6) d = Math.max(d, SHELL_H - 0.8 - Y + 0.0); // crimp dimple
    return d * SV;
  };
  const paint = (x: number, y: number, z: number, s: Surf): [number, number] => {
    const X = x / SV, Y = y / SV, Z = z / SV;
    const lit = s.nx * -0.5 + s.ny * 0.35 + s.nz * 0.8;
    const n = fbm3(X * 0.6, Y * 0.25, Z * 0.6);
    if (Y < 7.3) {
      let c = lit > 0.75 ? 0xffe9a0 : lit > 0.35 ? 0xd9a640 : lit > -0.1 ? 0xae7f28 : 0x6e4a12;
      if (Math.abs(Y - 3.72) < 0.3 || Y < 0.95) c = mixc(c, 0x5a3a0c, 0.5);
      if (n > 0.35) c = mixc(c, 0x4f8a6e, 0.35); // verdigris
      return [mulc(c, 0.93 + h3(x, y, z, 1) * 0.12), METAL];
    }
    let c = lit > 0.7 ? 0xe0604a : lit > 0.25 ? 0xb83426 : lit > -0.15 ? 0x8a2418 : 0x5a140c;
    const a = Math.atan2(Z, X);
    if (Math.cos(a * 36) < -0.6) c = mulc(c, 0.82); // rib shadows
    if (Y > 15.5 && Y < 19) c = mixc(c, 0x2a1408, 0.22); // a faded printed band
    if (Y > 26.4) c = mixc(c, 0xf09a80, 0.25 * clamp01(s.exp * 2)); // worn crimp folds
    if (n > 0.3) c = mixc(c, 0x6a3a22, (n - 0.3) * 0.8); // grime
    return [mulc(c, 0.93 + h3(x, y, z, 2) * 0.1), VF.SOLID | VF.SOFTAO];
  };
  return sculpt('hud_shell', [-17, 0, -17, 17, Math.ceil(SHELL_H * SV) + 1, 17], sd, paint);
}

// ------------------------------------------------------------------ Thompson drum (HUD px, 2 vox/px, face +z)
const DV = 2;
const DRUM_R = 18;
function drumModel() {
  const W = 4.2;
  const rivets: [number, number][] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    rivets.push([Math.cos(a) * (DRUM_R - 2.6), Math.sin(a) * (DRUM_R - 2.6)]);
  }
  const col = (x: number, y: number) => {
    const X = x / DV, Y = y / DV;
    const r = len2(X, Y);
    let rv = 99;
    for (const [rx, ry] of rivets) rv = Math.min(rv, len2(X - rx, Y - ry));
    // the face: domed, with two pressed rings and a raised hub
    let face = W - Math.pow(r / DRUM_R, 4) * 0.9;
    if (Math.abs(r - 11.5) < 0.45 || Math.abs(r - 7.2) < 0.35) face -= 0.35;
    if (r < 4.6) face += 0.9;
    return { r, rv, face };
  };
  const sd = (x: number, y: number, z: number, c: { r: number; rv: number; face: number }) => {
    const X = x / DV, Y = y / DV, Z = z / DV;
    // body + rolled rim band (a fat torus round the edge)
    let d = Math.max(c.r - (DRUM_R - 0.8), Math.abs(Z) - c.face);
    d = Math.min(d, len2(c.r - (DRUM_R - 1.2), Z) - 1.6);
    if (c.rv < 1.2) d = Math.min(d, len2(c.rv, Z - c.face) - 0.85);
    // the winding key over the hub
    if (c.r < 8.5) {
      const key = Math.max(sdRoundBox2(X, Y, 1.0, 6.2, 0.6), Math.abs(Z - (c.face + 0.9)) - 0.7);
      const lobes = Math.min(len3(X, (Y - 6.2) / 1.15, Z - (c.face + 0.9)), len3(X, (Y + 6.2) / 1.15, Z - (c.face + 0.9))) - 1.7;
      d = Math.min(d, key, lobes);
    }
    // the feed lips sticking up at 12 o'clock
    if (Math.abs(X) < 4 && Y > DRUM_R - 3) d = Math.min(d, Math.max(sdRoundBox2(X, Y - DRUM_R - 1.0, 2.6, 2.6, 0.8), Math.abs(Z) - 2.2));
    return d * DV;
  };
  const paint = (x: number, y: number, z: number, s: Surf): [number, number] => {
    const X = x / DV, Y = y / DV;
    const r = len2(X, Y);
    const lit = s.nx * -0.45 + s.ny * 0.6 + s.nz * 0.66;
    let c = lit > 0.85 ? 0x8aa0c8 : lit > 0.5 ? 0x3c4a6a : lit > 0.15 ? 0x283248 : 0x161c2a;
    if (s.exp > 0.5) c = mixc(c, 0xc8ccd4, 0.55); // blueing rubbed to bare steel on the edges
    const n = fbm3(x * 0.06, y * 0.06, z * 0.06);
    if (n > 0.4) c = mixc(c, 0x7a4a2a, (n - 0.4) * 0.8); // a little rust
    if (s.exp < 0.3) c = mixc(c, 0x0c0e14, 0.5);
    if (r < 8.5 && z / DV > 5.3) c = lit > 0.7 ? 0xffe9a0 : lit > 0.3 ? 0xc79236 : 0x7a5414; // the brass winding key
    return [mulc(c, 0.93 + h3(x, y, z, 3) * 0.12), METAL];
  };
  return sculpt('hud_drum', [-40, -40, -14, 40, 46, 14], sd, paint, VF.SOLID, col);
}

// ------------------------------------------------------------------ gun-belt strip (HUD px, 2 vox/px)
export const SLOT = 32;
function beltModel(n: number) {
  const hw = (n * SLOT) / 2 + 3, hh = 6.5;
  const col = (x: number, y: number) => {
    const X = x / DV, Y = y / DV;
    const d2 = sdRoundBox2(X, Y, hw, hh, 2.2) + 0.25 * KNZ.n2(X * 0.3, Y * 0.3);
    let zt = 1.4 + 0.3 * clamp01(-d2 / 4) - 0.5 * sstep(1, 0, -d2);
    const gd = Math.abs(d2 + 1.8);
    if (gd < 0.35) zt -= 0.4;
    const stitch = gd < 0.45 && ((((X + Y * 0.2) * 0.9) % 1) + 1) % 1 < 0.5;
    // brass rivets between the slots
    let rv = 99;
    for (let i = 0; i <= n; i++) for (const sy of [-1, 1]) rv = Math.min(rv, len2(X - (-hw + 3 + i * SLOT), Y - sy * 3.4));
    return { d2, zt, stitch, rv };
  };
  const sd = (x: number, y: number, z: number, c: { d2: number; zt: number; stitch: boolean; rv: number }) => {
    const Z = z / DV;
    let d = Math.max(c.d2, Z - c.zt, -Z);
    if (c.stitch) d = Math.min(d, Math.max(c.d2, Z - (c.zt + 0.35), -Z));
    if (c.rv < 1.4) d = Math.min(d, len2(c.rv / 1.2, (Z - 1.6) / 0.6) - 1);
    return d * DV;
  };
  const paint = (x: number, y: number, z: number, s: Surf): [number, number] => {
    const lit = s.nx * -0.45 + s.ny * 0.6 + s.nz * 0.66;
    if (z / DV > 1.75 && s.nz > 0.2 && s.exp > 0.35) return [lit > 0.7 ? 0xffe9a0 : 0xc79236, METAL];
    const X = x / DV, Y = y / DV;
    const gd = Math.abs(sdRoundBox2(X, Y, hw, hh, 2.2) + 0.25 * KNZ.n2(X * 0.3, Y * 0.3) + 1.8);
    if (gd < 0.45 && z / DV > 1.15) return [lit > 0.4 ? 0xead6a8 : 0xb8a07a, VF.SOLID]; // saddle stitching
    let c = lit > 0.7 ? 0x9c6238 : lit > 0.3 ? 0x6e3e20 : 0x4a2612;
    const n = fbm3(x * 0.1, y * 0.2, 2);
    c = mixc(c, n > 0 ? 0x9c6238 : 0x3a1c0c, Math.abs(n) * 0.35);
    if (s.exp < 0.3) c = mixc(c, 0x2a1408, 0.4);
    return [mulc(c, 0.92 + h3(x, y, z, 6) * 0.12), VF.SOLID | VF.SOFTAO];
  };
  return sculpt('hud_belt_' + n, [-Math.ceil(hw * DV) - 2, -18, 0, Math.ceil(hw * DV) + 2, 18, 6], sd, paint, VF.SOLID, col);
}

// ------------------------------------------------------------------ sign-arrow (off-screen treasure pointer), points +x
function arrowModel() {
  const col = (x: number, y: number) => {
    const X = x / DV, Y = y / DV;
    // a plank with a hand-cut point and a splintered tail
    const head = Math.max(Math.abs(Y) - (9.5 - X) * 0.62, X - 9.5, -X + 2);
    const shaft = Math.max(Math.abs(Y) - 2.6, Math.abs(X + 3) - 6.2 - 0.6 * KNZ.n2(Y * 0.8, 3));
    const d2 = Math.min(head, shaft) + 0.15 * KNZ.n2(X * 0.6, Y * 0.6);
    const grain = Math.abs(Math.sin((Y + fbm3(X * 0.08, Y * 0.2, 1) * 2.5) * 2.4));
    return { d2, zt: 1.6 - 0.35 * sstep(0.8, 1, grain) - 0.4 * sstep(1, 0, -d2) };
  };
  const sd = (x: number, y: number, z: number, c: { d2: number; zt: number }) => {
    const X = x / DV, Y = y / DV, Z = z / DV;
    let d = Math.max(c.d2, Z - c.zt, -Z);
    d = Math.min(d, len3((X + 3) / 1.1, Y / 1.1, (Z - 1.7) / 0.6) - 1); // the nail through it
    return d * DV;
  };
  const paint = (x: number, y: number, z: number, s: Surf): [number, number] => {
    const X = x / DV, Y = y / DV, Z = z / DV;
    const lit = s.nx * -0.45 + s.ny * 0.6 + s.nz * 0.66;
    if (len2(X + 3, Y) < 1.2 && Z > 1.4) return [lit > 0.6 ? 0x9a948c : 0x4a4440, METAL];
    let c = lit > 0.7 ? 0xc4a47a : lit > 0.3 ? 0x8c6440 : 0x5a3e24;
    if (X > 2.5 && s.nz > 0.4) c = mixc(c, 0xb02a18, 0.65 * clamp01(0.6 + fbm3(X * 0.3, Y * 0.3, 4))); // red-painted point, flaking
    if (s.exp < 0.3) c = mixc(c, 0x3a2410, 0.5);
    return [mulc(c, 0.9 + h3(x, y, z, 9) * 0.15), VF.SOLID];
  };
  return sculpt('hud_signarrow', [-22, -12, 0, 22, 12, 6], sd, paint, VF.SOLID, col);
}

// ------------------------------------------------------------------ anchors

export interface ArsenalAnchors {
  k: number;
  /** magazine centre (the cylinder's spot), HUD px */
  x: number;
  y: number;
  weapon: WeaponHud | null;
  /** the carried-guns strip: its centre and one slot per gun */
  strip: { x: number; y: number; slots: { x: number; id: GunId; active: boolean }[] } | null;
  /** treasure markers, HUD px; edge = clamped to the screen border, ang = direction to the target */
  markers: { x: number; y: number; kind: 'x' | 'blueprint' | 'map'; edge: boolean; ang: number }[];
}

interface Flyer {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  w: number;
  life: number;
}

// the models, built on first use and only ever photographed
const geos = new Map<string, THREE.BufferGeometry>();
function geo(name: string, make: () => THREE.BufferGeometry) {
  let g = geos.get(name);
  if (!g) geos.set(name, (g = make()));
  return g;
}
const mesh = (g: THREE.BufferGeometry) => new THREE.Mesh(g, SpriteBank.get().material());
const shellGeo = () => geo('shell', () => buildVoxelGeometry(shellModel(), { voxelSize: 1 / SV, pivot: [0, 0, 0] }));
const gunRigs = new Map<string, THREE.Group | null>();

export class ArsenalHud {
  private bank = SpriteBank.get();
  private shellDrop: number[] = [];
  private lastAmmo = -1;
  private lastId = '';
  private drumKick = 0;
  private drumOut = 0;
  private flyers: Flyer[] = [];
  private dust = new PixelFx(200, false, 8);
  private t = 0;

  constructor(private scene: THREE.Scene, private revolverSpec: () => RigSpec | null) {
    scene.add(this.dust.points);
  }

  fx(dt: number, s: number, visible: boolean) {
    this.dust.points.visible = visible;
    this.dust.update(dt, s);
  }

  // ---------------------------------------------------- photographs
  private shell(i: number, k: number) {
    const w = Math.round(14 * k) + 2, h = Math.round(32 * k) + 2;
    return this.bank.get('ars:shell' + i, w, 52, (): Shot => {
      const m = mesh(shellGeo());
      m.position.y = -SHELL_H / 2;
      const inner = new THREE.Group();
      inner.add(m, framingBox([-6, -SHELL_H / 2 - 0.6, -6], [6, SHELL_H / 2 + 0.6, 6]));
      inner.rotation.z = (i - 0.5) * -0.16;
      return { obj: wrap(inner), w, h, yaw: 0.5 + i * 1.3, pitch: 0.28, fit: true };
    });
  }
  private hull(f: number, k: number) {
    const S = Math.round(34 * k) + 2;
    return this.bank.get('ars:hull' + f, S, 30, (): Shot => {
      const m = mesh(shellGeo());
      m.position.y = -SHELL_H / 2;
      const inner = new THREE.Group();
      inner.add(m, framingBox([-17, -17, -17], [17, 17, 17]));
      inner.rotation.z = (f * Math.PI) / 4;
      return { obj: wrap(inner), w: S, h: S, yaw: 0.6, pitch: 0.2, fit: true };
    });
  }
  private drum(k: number) {
    const S = Math.round(44 * k) + 2;
    return this.bank.get('ars:drum', S, 52, (): Shot => {
      const inner = new THREE.Group();
      inner.add(mesh(geo('drum', () => buildVoxelGeometry(drumModel(), { voxelSize: 1 / DV, pivot: [0, 0, 0] }))), framingBox([-23, -23, -8], [23, 23, 8]));
      inner.rotation.x = -0.2;
      return { obj: wrap(inner), w: S, h: S, yaw: 0.42, pitch: 0.1, fit: true };
    });
  }
  private belt(n: number, k: number) {
    const hw = (n * SLOT) / 2 + 4;
    const w = Math.round(hw * 2 * k) + 2, h = Math.round(18 * k) + 2;
    return this.bank.get('ars:belt' + n, w, 50, (): Shot => {
      const inner = new THREE.Group();
      inner.add(mesh(geo('belt' + n, () => buildVoxelGeometry(beltModel(n), { voxelSize: 1 / DV, pivot: [0, 0, 0] }))), framingBox([-hw, -9, -1], [hw, 9, 4]));
      return { obj: wrap(inner), w, h, yaw: -0.08, pitch: 0.12, fit: true };
    });
  }
  private gun(id: GunId, on: boolean, k: number) {
    const S = Math.round((on ? 36 : 30) * k) + 2;
    if (id === 'revolver' && !this.revolverSpec()) return null;
    return this.bank.get(`ars:gun:${id}:${on ? 1 : 0}`, S, on ? 51 : 49, (): Shot | null => {
      let root = gunRigs.get(id);
      if (root === undefined) {
        root = null;
        const spec = id === 'revolver' ? this.revolverSpec() : buildWeaponRig(id);
        if (spec) {
          const r = new RigInstance(buildRigGeo(spec, spec.name + ':hudsprite'), { material: SpriteBank.get().material(), castShadow: false });
          r.root.rotation.set(0, 0, on ? 0.08 : -0.05);
          root = wrap(r.root);
        }
        gunRigs.set(id, root);
      }
      if (!root) return null;
      return { obj: root, w: S, h: S, yaw: Math.PI / 2 + (on ? 0.22 : 0.12), pitch: 0.12, fit: true };
    });
  }
  private prize(kind: 'x' | 'blueprint' | 'map', k: number) {
    const S = Math.round((kind === 'x' ? 34 : 29) * k) + 2;
    return this.bank.get('ars:prize:' + kind, S, 44, (): Shot => {
      const pm = kind === 'x' ? xMarker(2) : kind === 'map' ? mapFragment(3) : blueprintScroll('gun');
      const m = mesh(geo('prize' + kind, () => buildVoxelGeometry(pm.model, { voxelSize: pm.voxelSize ?? 0.05, pivot: 'center' })));
      m.rotation.set(kind === 'x' ? 0.8 : 0.55, 0, kind === 'blueprint' ? 0.35 : 0);
      return { obj: wrap(m), w: S, h: S, yaw: kind === 'blueprint' ? 0.15 : 0.4, pitch: 0.2, fit: true };
    });
  }
  private arrow(d: number, k: number) {
    const S = Math.round(30 * k) + 2;
    return this.bank.get('ars:arrow' + d, S, 40, (): Shot => {
      const inner = new THREE.Group();
      inner.add(mesh(geo('arrow', () => buildVoxelGeometry(arrowModel(), { voxelSize: 1 / DV, pivot: [0, 0, 0] }))), framingBox([-12, -12, -1], [12, 12, 4]));
      inner.rotation.z = -(d / 16) * TAU;
      return { obj: wrap(inner), w: S, h: S, yaw: 0, pitch: 0.06, fit: true };
    });
  }

  paint(c: CanvasRenderingContext2D, dt: number, A: ArsenalAnchors | null, s: number) {
    dt = Math.min(dt, 0.1);
    this.t += dt;
    this.paintFlyers(c, dt, A?.k ?? 1);
    if (!A) return;
    const k = A.k;
    const w = A.weapon;
    const kind = w?.kind ?? 'cylinder';
    const swap = w?.swap ?? 0;
    const swapDrop = Math.sin(clamp01(swap) * Math.PI) * 46;
    if (w && w.id !== this.lastId) {
      this.lastId = w.id;
      this.lastAmmo = -1;
    }
    // ---------------------------------------------------- carried strip (behind the magazine)
    const st = A.strip;
    if (st && st.slots.length > 1) {
      const belt = this.belt(st.slots.length, k);
      if (belt) blitObj(c, belt, st.x, st.y, 2);
      for (const sl of st.slots) {
        const g = this.gun(sl.id, sl.active, k);
        this.gun(sl.id, !sl.active, k);
        if (!g) continue;
        const lift = sl.active ? Math.round(3 + Math.sin(this.t * 2.2) * 0.8) : 0;
        blitObj(c, sl.active ? g : variant(g, 'dim'), sl.x, st.y - lift, 1 + lift);
        if (sl.active) glint(g, sl.x, st.y - lift, 0.4, dt);
      }
    }
    // ---------------------------------------------------- shells
    const nShell = kind === 'shells' && w ? Math.min(4, Math.max(1, w.mag)) : 0;
    while (this.shellDrop.length < nShell) this.shellDrop.push(1);
    if (kind === 'shells' && w) {
      if (this.lastAmmo >= 0 && w.ammo < this.lastAmmo) {
        // spent hulls kicked out of the breech
        for (let i = w.ammo; i < this.lastAmmo && i < nShell; i++) this.eject(A, i, nShell);
        uiSfx('shell_casing', 0.4, 0.8);
      }
      if (this.lastAmmo >= 0 && w.ammo > this.lastAmmo) for (let i = this.lastAmmo; i < w.ammo && i < this.shellDrop.length; i++) this.shellDrop[i] = 0;
      this.lastAmmo = w.ammo;
      for (let i = 0; i < nShell; i++) {
        const sp = this.shell(i, k);
        if (!sp || i >= w.ammo) continue;
        this.shellDrop[i] = Math.min(1, this.shellDrop[i] + dt * 4.5);
        const d = this.shellDrop[i];
        const fall = (1 - d * d) * 40;
        const bob = Math.sin(this.t * 1.6 + i * 0.9) * 1.2;
        const x = A.x + (i - (nShell - 1) / 2) * 12 * k;
        const y = A.y - fall * k + bob + swapDrop;
        blitObj(c, sp, x, y, 3 + fall * k * 0.3);
        glint(sp, x, y, 0.25, dt);
        // a fresh shell drops in glinting
        if (d < 0.6) blitC(c, variant(sp, 'flash'), x, y, (0.6 - d) * 1.2);
      }
    }
    // ---------------------------------------------------- drum
    if (kind === 'drum' && w) {
      // the housing never turns (the rotor inside does): each round kicks it instead
      if (this.lastAmmo >= 0 && w.ammo < this.lastAmmo) this.drumKick = 1;
      this.lastAmmo = w.ammo;
      this.drumKick = Math.max(0, this.drumKick - dt * 6);
      this.drumOut += ((w.reloading ? 1 : 0) - this.drumOut) * Math.min(1, dt * 7);
      const sp = this.drum(k);
      if (sp) {
        const out = this.drumOut;
        const kick = Math.round(Math.sin(this.drumKick * 14) * this.drumKick * 1.5);
        const x = A.x + out * 10 * k + kick, y = A.y + out * 26 * k + swapDrop + Math.sin(this.t * 1.6) * 1.2 + Math.abs(kick);
        blitObj(c, sp, x, y, 3 + out * 6, 1 - out * 0.55);
        glint(sp, x, y, 0.4, dt);
      }
    }
    // ---------------------------------------------------- treasure markers
    for (let i = 0; i < A.markers.length; i++) {
      const mk = A.markers[i];
      const sp = this.prize(mk.kind, k);
      const bob = Math.round(Math.sin(this.t * 2.4 + i) * 1.5);
      // a prize hovering over its spot: the shadow stays below while it bobs
      if (sp) blitObj(c, sp, mk.x, mk.y - bob - (mk.edge ? 0 : 12 * k), 5 + bob);
      if (mk.edge) {
        // the sign rides between the picture and the edge, pointing the way
        const d = ((Math.round((mk.ang / TAU) * 16) % 16) + 16) % 16;
        const ar = this.arrow(d, k);
        const pulse = Math.round(Math.sin(this.t * 6) * 1);
        if (ar) blitObj(c, ar, mk.x + Math.cos(mk.ang) * (22 * k + pulse), mk.y + Math.sin(mk.ang) * (22 * k + pulse), 3);
      }
    }
    void s;
  }

  private paintFlyers(c: CanvasRenderingContext2D, dt: number, k: number) {
    for (let i = this.flyers.length - 1; i >= 0; i--) {
      const f = this.flyers[i];
      f.life -= dt;
      f.vy += 900 * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.r += f.w * dt;
      if (f.life <= 0) {
        this.flyers.splice(i, 1);
        continue;
      }
      const fr = ((Math.floor((f.r / Math.PI) * 4) % 4) + 4) % 4;
      const sp = this.hull(fr, k);
      if (sp) blitObj(c, variant(sp, 'dim'), f.x, f.y, 8, Math.min(1, f.life * 3));
    }
  }

  private eject(A: ArsenalAnchors, i: number, n: number) {
    const x = A.x + (i - (n - 1) / 2) * 12 * A.k, y = A.y;
    this.flyers.push({ x, y, vx: 60 + Math.random() * 80, vy: -260 - Math.random() * 120, r: 0, w: 9 + Math.random() * 8, life: 1.3 });
    for (let j = 0; j < 8; j++)
      this.dust.emit({ x, y: y - SHELL_H * A.k * 0.5, vx: (Math.random() - 0.3) * 40, vy: -20 - Math.random() * 30, ay: -10, drag: 1.2, life: 0.5 + Math.random() * 0.5, size: 1, size1: 3, c0: 0xd8d0c0, c1: 0x6a6460, alpha: 0.6 });
  }

  dispose() {
    this.dust.dispose();
    void this.scene;
  }
}
