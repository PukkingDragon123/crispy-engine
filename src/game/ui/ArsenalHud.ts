// The arsenal readouts on the HUD (the revolver keeps its cylinder, Hud3D), drawn as
// stylized pixel art from authored sprites (HudArt.ts); motion is 2D (drops, kicks, tumbles):
//  • COACH GUN — the shells stand where the cylinder floats (red paper hulls, brass
//    heads). A shot kicks the spent shell out tumbling; a reload drops a fresh one in.
//  • THOMPSON — a blued-steel drum (rolled rim, rivet ring, brass winding key) kicked by
//    every round and dropped out on reload; the "ammo / mag" count is Hud.ts's type.
//  • CARRIED GUNS — a tooled gun belt with a slot per gun (keys 3/4/5 above, from
//    Hud.ts); the gun in hand rides up out of its slot, the others sit back dimmed.
//  • TREASURE — revealed dig spots, blueprints and maps get their icon hovering over the
//    spot; off screen they ride the screen edge beside a painted sign-arrow pointing the
//    way (eight headings from two authored signs).
import * as THREE from 'three';
import type { WeaponHud } from '../player/Weapons';
import type { GunId } from '../meta/Blueprints';
import { PixelFx, clamp01, TAU, uiSfx } from './HudKit';
import type { RigSpec } from '../../engine/voxel/Rig';
import { blitC, blitObj, glint, variant } from './HudSprites';
import { sprite, drawSprite, strip3, SWAP_DIM, SWAP_FLASH, type PixelSprite } from './PixelUI';
import { HUD_ART as ART } from './HudArt';

/** one gun-belt slot (HUD px) */
export const SLOT = 32;

const flips = new WeakMap<PixelSprite, PixelSprite>();
/** an authored sprite mirrored left to right (the belt's right end) */
function flipped(def: PixelSprite): PixelSprite {
  let f = flips.get(def);
  if (!f) flips.set(def, (f = { w: def.w, h: def.h, rows: def.rows.map((r) => r.split('').reverse().join('')) }));
  return f;
}

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

export class ArsenalHud {
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
      // a tooled leather belt, a slot per gun; the gun in hand rides up out of its slot
      const small = k < 0.85;
      const belt = strip3(small ? ART.belt_end_s : ART.belt_end, small ? ART.belt_mid_s : ART.belt_mid, flipped(small ? ART.belt_end_s : ART.belt_end), st.slots.length * (small ? 20 : SLOT) + 10, small ? 'belt_s' : 'belt');
      blitObj(c, belt, st.x, st.y, 2);
      for (const sl of st.slots) {
        const def = ART['gun_' + sl.id] ?? ART.gun_revolver;
        const lift = sl.active ? Math.round(3 + Math.sin(this.t * 2.2) * 0.8) : 0;
        const g = sl.active ? sprite(def) : sprite(def, SWAP_DIM, 'dim');
        blitObj(c, g, sl.x, st.y - lift - 2, 1 + lift);
        if (sl.active) glint(g, sl.x, st.y - lift - 2, 0.4, dt);
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
        const sp = sprite(k < 0.85 ? ART.shell_s : ART.shell);
        if (i >= w.ammo) continue;
        this.shellDrop[i] = Math.min(1, this.shellDrop[i] + dt * 4.5);
        const d = this.shellDrop[i];
        const fall = (1 - d * d) * 40;
        const bob = Math.sin(this.t * 1.6 + i * 0.9) * 1.2;
        const x = A.x + (i - (nShell - 1) / 2) * 12 * k;
        const y = A.y - fall * k + bob + swapDrop;
        blitObj(c, sp, x, y, 3 + fall * k * 0.3);
        glint(sp, x, y, 0.25, dt);
        // a fresh shell drops in glinting
        if (d < 0.6) blitC(c, sprite(k < 0.85 ? ART.shell_s : ART.shell, SWAP_FLASH, 'flash'), x, y, (0.6 - d) * 1.2);
      }
    }
    // ---------------------------------------------------- drum
    if (kind === 'drum' && w) {
      // the housing never turns (the rotor inside does): each round kicks it instead
      if (this.lastAmmo >= 0 && w.ammo < this.lastAmmo) this.drumKick = 1;
      this.lastAmmo = w.ammo;
      this.drumKick = Math.max(0, this.drumKick - dt * 6);
      this.drumOut += ((w.reloading ? 1 : 0) - this.drumOut) * Math.min(1, dt * 7);
      const sp = sprite(k < 0.85 ? ART.drum_s : ART.drum);
      {
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
      const sp = sprite(ART['prize_' + mk.kind]);
      const bob = Math.round(Math.sin(this.t * 2.4 + i) * 1.5);
      // a prize hovering over its spot: the shadow stays below while it bobs
      if (sp) blitObj(c, sp, mk.x, mk.y - bob - (mk.edge ? 0 : 12 * k), 5 + bob);
      if (mk.edge) {
        // the sign rides between the picture and the edge, pointing the way
        // eight headings from two authored signs: straight (turned) and diagonal (mirrored)
        const d = ((Math.round((mk.ang / TAU) * 8) % 8) + 8) % 8;
        const diag = d % 2 === 1;
        const ar = sprite(diag ? ART.arrow_d : ART.arrow);
        const pulse = Math.round(Math.sin(this.t * 6) * 1);
        const ax = mk.x + Math.cos(mk.ang) * (22 * k + pulse), ay = mk.y + Math.sin(mk.ang) * (22 * k + pulse);
        const o = diag ? { flipX: d === 3 || d === 5, flipY: d === 1 || d === 3 } : { turns: d / 2 === 2 ? 0 : d / 2, flipX: d === 4 };
        drawSprite(c, variant(ar, 'shadow'), ax + 2, ay + 3, { ...o, alpha: 0.32 });
        drawSprite(c, ar, ax, ay, o);
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
      // a spent hull tumbling: the shell sprite quarter-turned, sunk in shade
      const fr = ((Math.floor((f.r / Math.PI) * 2) % 4) + 4) % 4;
      const sp = sprite(k < 0.85 ? ART.shell_s : ART.shell, SWAP_DIM, 'dim');
      drawSprite(c, variant(sp, 'shadow'), f.x + 4, f.y + 6, { turns: fr, alpha: 0.3 * Math.min(1, f.life * 3) });
      drawSprite(c, sp, f.x, f.y, { turns: fr, alpha: Math.min(1, f.life * 3) });
    }
  }

  private eject(A: ArsenalAnchors, i: number, n: number) {
    const x = A.x + (i - (n - 1) / 2) * 12 * A.k, y = A.y;
    this.flyers.push({ x, y, vx: 60 + Math.random() * 80, vy: -260 - Math.random() * 120, r: 0, w: 9 + Math.random() * 8, life: 1.3 });
    for (let j = 0; j < 8; j++)
      this.dust.emit({ x, y: y - 14 * A.k, vx: (Math.random() - 0.3) * 40, vy: -20 - Math.random() * 30, ay: -10, drag: 1.2, life: 0.5 + Math.random() * 0.5, size: 1, size1: 3, c0: 0xd8d0c0, c1: 0x6a6460, alpha: 0.6 });
  }

  dispose() {
    this.dust.dispose();
    void this.scene;
    void this.revolverSpec;
  }
}
