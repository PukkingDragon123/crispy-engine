// The arsenal readouts in the 3D HUD layer (the revolver keeps its rusty cylinder):
//  • COACH GUN — two real paper-hulled shotgun shells stand where the cylinder
//    floats (ribbed red hulls, star crimps, high-brass heads). A shot kicks the
//    spent shell out tumbling; a reload drops a fresh one into its place.
//  • THOMPSON — a blued-steel drum magazine (domed faces, rolled rim, rivet ring,
//    hub and winding key) that indexes round per shot and drops out on reload;
//    the "ammo / mag" count is set beside it in Alagard (Hud.ts draws the type).
//  • CARRIED GUNS — a tooled gun-belt strip with each carried gun as a lit
//    miniature of its own rig over its slot (keys 3/4/5 above, from Hud.ts);
//    the gun in hand is lifted and lit, the others sit back dimmed.
//  • TREASURE — revealed dig spots, blueprints and maps get a hovering, turning
//    miniature of the real prop over the spot; off screen they ride the screen
//    edge beside a weathered wooden sign-arrow pointing the way.
import * as THREE from 'three';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { makeVoxelMaterial, VoxelMaterial } from '../../engine/render/VoxelMaterial';
import { buildRigGeo, RigInstance, RigSpec } from '../../engine/voxel/Rig';
import { VF } from '../../engine/voxel/VoxelModel';
import type { WeaponHud } from '../player/Weapons';
import { buildWeaponRig } from '../player/Weapons';
import type { GunId } from '../meta/Blueprints';
import { xMarker, blueprintScroll, mapFragment } from '../models/props/treasure';
import { sculpt, JobQueue, Surf, PixelFx, fbm3, h3, mixc, mulc, clamp, clamp01, sstep, len2, len3, sdRoundBox2, TAU, uiSfx, METAL, KNZ } from './HudKit';

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
const SLOT = 28;
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
  mesh: THREE.Object3D;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  w: number;
  life: number;
}

export class ArsenalHud {
  private mat: VoxelMaterial;
  private dimMat: VoxelMaterial;
  private jobs = new JobQueue();
  private built = false;
  // shells
  private shellGeo: THREE.BufferGeometry | null = null;
  private shells: THREE.Mesh[] = [];
  private shellDrop: number[] = [];
  private lastAmmo = -1;
  private lastId = '';
  // drum
  private drumGeo: THREE.BufferGeometry | null = null;
  private drum: THREE.Mesh | null = null;
  private drumRot = 0;
  private drumSpin = 0;
  private drumOut = 0;
  // strip
  private belt: THREE.Mesh | null = null;
  private beltN = 0;
  private guns = new Map<string, RigInstance | null>();
  private gunScale = new Map<string, number>();
  private strip = new THREE.Group();
  // treasure
  private markerGeo = new Map<string, { geo: THREE.BufferGeometry; size: number }>();
  private markers: { root: THREE.Group; model: THREE.Mesh; arrow: THREE.Mesh | null; kind: string }[] = [];
  private arrowGeo: THREE.BufferGeometry | null = null;
  private flyers: Flyer[] = [];
  private fx = new PixelFx(200, false, 8);
  private group = new THREE.Group();
  private t = 0;

  constructor(private scene: THREE.Scene, private revolverSpec: () => RigSpec | null) {
    this.mat = makeVoxelMaterial({ fog: false });
    this.dimMat = makeVoxelMaterial({ fog: false });
    this.dimMat.userData.tint.value.setRGB(0.55, 0.52, 0.5);
    scene.add(this.group, this.strip, this.fx.points);
  }

  private build() {
    this.built = true;
    this.jobs.add(() => (this.shellGeo = buildVoxelGeometry(shellModel(), { voxelSize: 1 / SV, pivot: [0, 0, 0] })));
    this.jobs.add(() => (this.drumGeo = buildVoxelGeometry(drumModel(), { voxelSize: 1 / DV, pivot: [0, 0, 0] })));
    this.jobs.add(() => (this.arrowGeo = buildVoxelGeometry(arrowModel(), { voxelSize: 1 / DV, pivot: [0, 0, 0] })));
  }

  private gun(id: GunId): RigInstance | null {
    if (this.guns.has(id)) return this.guns.get(id)!;
    let r: RigInstance | null = null;
    try {
      const spec = id === 'revolver' ? this.revolverSpec() : buildWeaponRig(id);
      if (spec) {
        r = new RigInstance(buildRigGeo(spec, spec.name + ':hudstrip'), { material: this.mat, castShadow: false });
        const b = new THREE.Box3().setFromObject(r.root);
        const sz = b.getSize(new THREE.Vector3());
        this.gunScale.set(id, 23 / Math.max(1e-3, sz.x, sz.y, sz.z));
        this.strip.add(r.root);
      }
    } catch (e) {
      console.warn('[arsenal hud] gun model failed', id, e);
    }
    this.guns.set(id, r);
    return r;
  }

  private markerModel(kind: string) {
    let e = this.markerGeo.get(kind);
    if (!e) {
      const pm = kind === 'x' ? xMarker(2) : kind === 'map' ? mapFragment(3) : blueprintScroll('gun');
      const geo = buildVoxelGeometry(pm.model, { voxelSize: 1, pivot: 'center' });
      geo.computeBoundingBox();
      const s = geo.boundingBox!.getSize(new THREE.Vector3());
      e = { geo, size: Math.max(s.x, s.y, s.z) };
      this.markerGeo.set(kind, e);
    }
    return e;
  }

  update(dt: number, A: ArsenalAnchors | null, visible: boolean, s: number, cylHidden: boolean) {
    dt = Math.min(dt, 0.1);
    this.t += dt;
    this.fx.update(dt, s);
    const show = !!A && visible;
    this.group.visible = this.strip.visible = show;
    for (const m of this.markers) m.root.visible = false;
    if (!A || !show) return;
    if (!this.built) this.build();
    this.jobs.step();
    const k = A.k;
    const w = A.weapon;
    const kind = w?.kind ?? 'cylinder';
    const swap = w?.swap ?? 0;
    const swapDrop = Math.sin(clamp01(swap) * Math.PI) * 46;
    if (w && w.id !== this.lastId) {
      this.lastId = w.id;
      this.lastAmmo = -1;
    }
    // ---------------------------------------------------- shells
    const nShell = kind === 'shells' && w ? Math.min(4, Math.max(1, w.mag)) : 0;
    while (this.shells.length < nShell && this.shellGeo) {
      const m = new THREE.Mesh(this.shellGeo, this.mat);
      this.group.add(m);
      this.shells.push(m);
      this.shellDrop.push(1);
    }
    if (kind === 'shells' && w) {
      if (this.lastAmmo >= 0 && w.ammo < this.lastAmmo) {
        // spent hulls kicked out of the breech
        for (let i = w.ammo; i < this.lastAmmo && i < this.shells.length; i++) this.eject(this.shells[i], A, s);
        uiSfx('shell_casing', 0.4, 0.8);
      }
      if (this.lastAmmo >= 0 && w.ammo > this.lastAmmo) for (let i = this.lastAmmo; i < w.ammo && i < this.shellDrop.length; i++) this.shellDrop[i] = 0;
      this.lastAmmo = w.ammo;
    }
    for (let i = 0; i < this.shells.length; i++) {
      const m = this.shells[i];
      const on = i < nShell && !!w && i < w.ammo;
      m.visible = on;
      if (!on) continue;
      this.shellDrop[i] = Math.min(1, this.shellDrop[i] + dt * 4.5);
      const d = this.shellDrop[i];
      const fall = (1 - d * d) * 40;
      const sp = (i - (nShell - 1) / 2) * 12;
      const bob = Math.sin(this.t * 1.6 + i * 0.9) * 1.2;
      m.position.set((A.x + sp * k) * s, -(A.y + (SHELL_H / 2) * k - fall * k - bob + swapDrop) * s, 30);
      m.scale.setScalar(s * k);
      m.rotation.set(0.28 + Math.sin(this.t * 0.8 + i) * 0.04, 0.5 + this.t * 0.35 + i * 1.3, (i - 0.5) * -0.16 + (1 - d) * 0.6);
    }
    // ---------------------------------------------------- drum
    if (kind === 'drum' && w && this.drumGeo && !this.drum) {
      this.drum = new THREE.Mesh(this.drumGeo, this.mat);
      this.group.add(this.drum);
    }
    if (this.drum) {
      const on = kind === 'drum' && !!w;
      this.drum.visible = on;
      if (on && w) {
        if (this.lastAmmo >= 0 && w.ammo < this.lastAmmo) {
          this.drumRot -= (TAU / Math.max(10, w.mag)) * (this.lastAmmo - w.ammo);
          this.drumSpin = 1;
        }
        this.lastAmmo = w.ammo;
        this.drumSpin = Math.max(0, this.drumSpin - dt * 6);
        this.drumOut += ((w.reloading ? 1 : 0) - this.drumOut) * Math.min(1, dt * 7);
        const out = this.drumOut;
        this.drum.position.set((A.x + out * 10 * k) * s, -(A.y + out * 26 * k + swapDrop + Math.sin(this.t * 1.6) * 1.2) * s, 30);
        this.drum.scale.setScalar(s * k * 0.95);
        this.drum.rotation.set(-0.2 + Math.sin(this.t * 0.9) * 0.04, 0.42 + Math.sin(this.t * 0.7) * 0.06, this.drumRot + out * 2.4 + Math.sin(this.drumSpin * 9) * 0.02);
      }
    }
    // ---------------------------------------------------- carried strip
    const st = A.strip;
    for (const r of this.guns.values()) if (r) r.root.visible = false;
    if (st && st.slots.length > 1) {
      if (this.beltN !== st.slots.length) {
        this.belt?.removeFromParent();
        this.belt?.geometry.dispose();
        this.belt = null;
        const n = st.slots.length;
        this.beltN = n;
        this.jobs.add(() => {
          this.belt = new THREE.Mesh(buildVoxelGeometry(beltModel(n), { voxelSize: 1 / DV, pivot: [0, 0, 0] }), this.mat);
          this.strip.add(this.belt);
        });
      }
      if (this.belt) {
        this.belt.visible = true;
        this.belt.position.set(st.x * s, -st.y * s, 0);
        this.belt.scale.setScalar(s * k);
        this.belt.rotation.set(0.12, -0.08, 0);
      }
      for (const sl of st.slots) {
        const g = this.gun(sl.id);
        if (!g) continue;
        g.root.visible = true;
        const sc = (this.gunScale.get(sl.id) ?? 30) * s * k * (sl.active ? 1.12 : 0.92);
        g.root.scale.setScalar(sc);
        const lift = sl.active ? 3 + Math.sin(this.t * 2.2) * 0.8 : 0;
        g.root.position.set(sl.x * s, -(st.y - lift) * s, 40);
        g.root.rotation.set(0.1 + (sl.active ? Math.sin(this.t * 1.3) * 0.05 : 0), Math.PI / 2 + (sl.active ? Math.sin(this.t * 0.9) * 0.25 : 0.12), sl.active ? 0.08 : -0.05);
        for (const m of Object.values(g.meshes)) (m as THREE.Mesh).material = sl.active ? this.mat : this.dimMat;
      }
    } else if (this.belt) this.belt.visible = false;
    // ---------------------------------------------------- treasure markers
    for (let i = 0; i < A.markers.length; i++) {
      const mk = A.markers[i];
      let o = this.markers[i];
      if (!o || o.kind !== mk.kind) {
        o?.root.removeFromParent();
        const e = this.markerModel(mk.kind);
        const root = new THREE.Group();
        const model = new THREE.Mesh(e.geo, this.mat);
        model.userData.size = e.size;
        root.add(model);
        o = { root, model, arrow: null, kind: mk.kind };
        this.markers[i] = o;
        this.group.add(root);
      }
      if (!o.arrow && this.arrowGeo) {
        o.arrow = new THREE.Mesh(this.arrowGeo, this.mat);
        o.root.add(o.arrow);
      }
      o.root.visible = true;
      o.root.position.set(mk.x * s, -mk.y * s, 20);
      const bob = Math.sin(this.t * 2.4 + i) * 1.5;
      const size = (mk.kind === 'x' ? 18 : 15) * k;
      o.model.scale.setScalar((size * s) / (o.model.userData.size || 1));
      o.model.position.set(0, (bob + (mk.edge ? 0 : 6 * k)) * s, 0);
      o.model.rotation.set(mk.kind === 'x' ? 0.75 : 0.45, this.t * 1.1 + i, mk.kind === 'blueprint' ? 0.4 : 0);
      if (o.arrow) {
        o.arrow.visible = mk.edge;
        if (mk.edge) {
          // the sign rides between the miniature and the edge, pointing the way
          const ax = Math.cos(mk.ang), ay = Math.sin(mk.ang);
          o.arrow.position.set(ax * 15 * k * s, -ay * 15 * k * s, 4);
          o.arrow.scale.setScalar(s * k * (1 + Math.sin(this.t * 6) * 0.05));
          o.arrow.rotation.set(0, 0, -mk.ang);
        }
      }
    }
    for (let i = A.markers.length; i < this.markers.length; i++) this.markers[i].root.visible = false;
    // ---------------------------------------------------- ejected hulls
    for (let i = this.flyers.length - 1; i >= 0; i--) {
      const f = this.flyers[i];
      f.life -= dt;
      f.vy += 900 * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.r += f.w * dt;
      f.mesh.position.set(f.x * s, -f.y * s, 60);
      f.mesh.rotation.set(f.r * 0.7, f.r * 0.3, f.r);
      if (f.life <= 0) {
        f.mesh.removeFromParent();
        this.flyers.splice(i, 1);
      }
    }
  }

  private eject(src: THREE.Mesh, A: ArsenalAnchors, s: number) {
    const m = new THREE.Mesh(src.geometry, this.dimMat);
    m.scale.copy(src.scale);
    this.group.add(m);
    const x = src.position.x / s, y = -src.position.y / s;
    this.flyers.push({ mesh: m, x, y, vx: 60 + Math.random() * 80, vy: -260 - Math.random() * 120, r: 0, w: 9 + Math.random() * 8, life: 1.3 });
    for (let i = 0; i < 8; i++)
      this.fx.emit({ x, y: y - SHELL_H * A.k * 0.5, vx: (Math.random() - 0.3) * 40, vy: -20 - Math.random() * 30, ay: -10, drag: 1.2, life: 0.5 + Math.random() * 0.5, size: 1, size1: 3, c0: 0xd8d0c0, c1: 0x6a6460, alpha: 0.6 });
  }

  dispose() {
    this.group.removeFromParent();
    this.strip.removeFromParent();
    this.fx.dispose();
    this.shellGeo?.dispose();
    this.drumGeo?.dispose();
    this.arrowGeo?.dispose();
    this.belt?.geometry.dispose();
    for (const e of this.markerGeo.values()) e.geo.dispose();
    void this.scene;
    void clamp;
  }
}
