// The hideout: a dusty saloon at the edge of town. Everything is a physical
// object you click: the wardrobe (hats, outfits, boards), the gun bench (drag
// parts onto the revolver's slots), Thoth's codex on the table, the rubber duck
// on the bar (it quacks), the gramophone, the dartboard, and the swinging
// doors (ride out). Sundown stands in the middle wearing whatever you pick.
import * as THREE from 'three';
import type { Engine, GameScene } from '../../engine/Engine';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { buildRigGeo, RigInstance, RigSpec } from '../../engine/voxel/Rig';
import { makeVoxelMaterial, sharedVoxelMaterial } from '../../engine/render/VoxelMaterial';
import * as PM from '../models/props';
import * as CH from '../models/characters';
import { modelEntry } from '../models/lookup';
import { Particles } from '../fx/Particles';
import { FaceQuads, RigEyes, emote } from '../fx/FaceFx';
import { ENEMIES } from '../enemies/EnemyDefs';
import { loadSave, writeSave, buy, owns, PRICES, HATS, OUTFITS, BOARDS, GUN_PARTS, GUN_PERKS, GunLoadout } from '../meta/Save';
import { Ease } from '../../engine/Tween';
import { damp, rnd } from '../../engine/math/rand';

interface Clickable {
  id: string;
  obj: THREE.Object3D;
  label: string;
  hover: number;
  base: THREE.Vector3;
}

const UI_CSS = "position:absolute;z-index:8;padding:16px 20px;background:#e8d4a4;border:4px solid #5a3418;box-shadow:0 6px 0 #2a1408;font-family:'Alagard';color:#2a1a10;font-size:17px;pointer-events:auto";
const BTN_CSS = "font-family:'Alagard';font-size:17px;padding:4px 12px;background:#7a4a28;color:#fff3d6;border:3px solid #2a1408;box-shadow:0 3px 0 #2a1408;cursor:pointer";

function staticMesh(sm: { model: any; voxelSize: number } | undefined | null, pivot: 'bottom' | 'center' = 'bottom') {
  if (!sm?.model) return null;
  const m = new THREE.Mesh(buildVoxelGeometry(sm.model, { voxelSize: sm.voxelSize, pivot }), sharedVoxelMaterial);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export class HubScene implements GameScene {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(48, 1, 0.05, 120);
  private particles = new Particles();
  private faces = new FaceQuads();
  private clickables: Clickable[] = [];
  private ray = new THREE.Raycaster();
  private hovered: Clickable | null = null;
  private hero: RigInstance | null = null;
  private heroEyes: RigEyes | null = null;
  private heroHolder = new THREE.Group();
  private boardMesh: THREE.Object3D | null = null;
  private gunHolder = new THREE.Group();
  private gun: RigInstance | null = null;
  private panel: HTMLDivElement | null = null;
  private tip: HTMLDivElement;
  private bank: HTMLDivElement;
  private camGoal = { pos: new THREE.Vector3(0, 2.6, 7.2), look: new THREE.Vector3(0, 1.3, 0) };
  private camLook = new THREE.Vector3(0, 1.3, 0);
  private t = 0;
  private duck: THREE.Object3D | null = null;
  private duckSquash = 0;
  private music = true;

  constructor(private engine: Engine, private onRide: () => void, private onMenu: () => void) {
    this.tip = document.createElement('div');
    this.bank = document.createElement('div');
  }

  async enter() {
    const s = this.scene;
    const eng = this.engine;
    const P: any = PM;
    s.background = new THREE.Color(0x1a100a);
    s.fog = new THREE.Fog(0x1a100a, 9, 26);
    s.add(new THREE.HemisphereLight(0xffd8a8, 0x3a2414, 0.75));
    for (const [x, z] of [[-3, -1], [3, -1], [0, 2.5]]) {
      const l = new THREE.PointLight(0xffb060, 18, 9, 1.7);
      l.position.set(x, 3.1, z);
      s.add(l);
      const lan = staticMesh(P.lantern?.(), 'center');
      if (lan) {
        lan.position.set(x, 3.3, z);
        s.add(lan);
      }
    }
    const win = new THREE.DirectionalLight(0xffc890, 1.6);
    win.position.set(-6, 5, 4);
    win.castShadow = true;
    win.shadow.mapSize.set(1024, 1024);
    s.add(win);
    s.add(this.particles.group, this.faces.mesh);
    // room shell
    try {
      const ft = P.floorTile?.(0);
      if (ft) {
        const g = buildVoxelGeometry(ft.model, { voxelSize: ft.voxelSize, pivot: 'bottom' });
        g.computeBoundingBox();
        const b = g.boundingBox!;
        const w = b.max.x - b.min.x, d = b.max.z - b.min.z;
        for (let x = -7; x <= 7; x += w)
          for (let z = -5; z <= 5; z += d) {
            const m = new THREE.Mesh(g, sharedVoxelMaterial);
            m.position.set(x, -(b.max.y - b.min.y), z);
            m.receiveShadow = true;
            s.add(m);
          }
      }
      const ws = P.wallSegment?.(true, 0);
      if (ws) {
        const g = buildVoxelGeometry(ws.model, { voxelSize: ws.voxelSize, pivot: 'bottom' });
        g.computeBoundingBox();
        const w = g.boundingBox!.max.x - g.boundingBox!.min.x;
        for (let x = -7 + w / 2; x < 7.5; x += w) {
          const m = new THREE.Mesh(g, sharedVoxelMaterial);
          m.position.set(x, 0, -5);
          s.add(m);
        }
        for (const side of [-1, 1])
          for (let z = -5 + w / 2; z < 5; z += w) {
            const m = new THREE.Mesh(g, sharedVoxelMaterial);
            m.position.set(side * 7, 0, z);
            m.rotation.y = side * Math.PI / 2;
            s.add(m);
          }
      }
    } catch (e) {
      console.warn('[hub] shell', e);
    }
    if (!P.floorTile) {
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 10), new THREE.MeshStandardMaterial({ color: 0x6a4428 }));
      floor.rotation.x = -Math.PI / 2;
      s.add(floor);
    }
    const place = (id: string, label: string, sm: any, x: number, z: number, ry = 0, y = 0) => {
      const m = staticMesh(sm);
      if (!m) return null;
      const g = new THREE.Group();
      g.add(m);
      g.position.set(x, y, z);
      g.rotation.y = ry;
      s.add(g);
      if (id) this.clickables.push({ id, obj: g, label, hover: 0, base: g.position.clone() });
      return g;
    };
    place('', '', P.barCounter?.(), 0, -3.6);
    place('', '', P.shelf?.(0), -1.6, -4.7);
    place('', '', P.shelf?.(1), 1.6, -4.7);
    for (let i = 0; i < 6; i++) place('', '', P.bottle?.(i), -0.9 + i * 0.4, -3.6, 0, 1.12);
    place('piano', 'Old Piano', P.piano?.(), -5.6, -3.2, Math.PI / 2);
    place('wardrobe', 'Wardrobe — hats, outfits, boards', P.wardrobe?.(), 5.9, -2.2, -Math.PI / 2);
    place('mirror', 'Mirror', P.mirror?.(), 6.7, 0.6, -Math.PI / 2, 0.4);
    place('bench', 'Gun Bench — customize your revolver', P.workbench?.(), -5.4, 1.4, Math.PI / 2);
    place('', '', P.table?.(0), -2.4, 2.3);
    place('book', "Thoth's Codex", P.book?.(), -2.4, 2.3, 0.4, 0.82);
    place('gramophone', 'Gramophone', P.gramophone?.(), 2.6, -3.6, -0.3, 1.12);
    place('dart', 'Dartboard', P.dartboard?.(), 3.8, -4.85, 0, 1.6);
    place('board', 'Notice Board — RIDE OUT', P.noticeBoard?.(0), 6.5, 3.0, -Math.PI / 2);
    // ceiling: plank boards on heavy beams
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(14, 10), new THREE.MeshStandardMaterial({ color: 0x3a2414, roughness: 1 }));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = 4.4;
    s.add(ceil);
    for (const z of [-3.6, 0, 3.6])
      for (const x of [-4.8, 0, 4.8]) {
        const b = staticMesh(P.roofBeam?.(), 'center');
        if (!b) break;
        b.position.set(x, 4.15, z);
        s.add(b);
      }
    for (const [x, z] of [[-0.8, -2.8], [0.6, -2.8], [-2, 1.4], [-2.9, 3.1]]) place('', '', P.stool?.(), x, z);
    // rubber duck on the bar
    const duck = modelEntry('rubber_duck')?.() as any;
    this.duck = place('duck', 'Rubber Duck', duck, 1.3, -3.55, -0.5, 1.12);
    // gun on the bench
    this.gunHolder.position.set(-5.2, 1.08, 1.4);
    s.add(this.gunHolder);
    this.buildGun();
    // Sundown
    this.heroHolder.position.set(0.4, 0, 0.6);
    this.heroHolder.rotation.y = -0.25;
    s.add(this.heroHolder);
    this.buildHero();
    // camera + UI
    this.camera.aspect = eng.width / eng.height;
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(this.camGoal.pos);
    (window as any).__music?.setMood('hub');
    eng.input.setWantLock(false);
    this.tip.style.cssText = "position:absolute;z-index:7;pointer-events:none;display:none;font-family:'Alagard';font-size:17px;color:#fff3d6;text-shadow:0 2px 0 #2a1408,0 0 10px #000";
    this.bank.style.cssText = "position:absolute;left:24px;top:20px;z-index:7;pointer-events:none;font-family:'Alagard';font-size:22px;color:#ffd36b;text-shadow:0 3px 0 #2a1408";
    eng.overlay.append(this.tip, this.bank);
    this.updateBank();
  }

  private updateBank() {
    const d = loadSave();
    this.bank.innerHTML = `BANK: ${d.bank} gold<div style="font-size:15px;color:#fff3d6;opacity:.8">Runs ${d.runs} · Best wave ${d.bestWave} · Outlaws ${d.kills}</div>`;
  }

  private buildHero() {
    const d = loadSave();
    this.hero?.root.removeFromParent();
    this.boardMesh?.removeFromParent();
    let spec: RigSpec | null = null;
    try {
      spec = (CH as any).skeletonCowboyRig?.({ hat: d.look.hat, outfit: d.look.outfit }) ?? null;
    } catch (e) {
      console.warn('[hub] hero', e);
    }
    spec = spec ?? ((modelEntry('cowboy_stetson_duster')?.() as RigSpec) || null);
    if (!spec?.parts) return;
    this.hero = new RigInstance(buildRigGeo(spec, spec.name + ':hub:' + d.look.hat + d.look.outfit), { material: makeVoxelMaterial() });
    this.heroHolder.add(this.hero.root);
    this.heroEyes = new RigEyes(this.hero, 'glow', 0x9dff3a);
    try {
      const b = (CH as any).sandboardModel?.(d.look.board);
      if (b?.model) {
        const bm = staticMesh(b, 'center')!;
        bm.position.set(-0.9, 0.55, -0.35);
        bm.rotation.set(0.2, 0.3, Math.PI / 2 - 0.15);
        this.heroHolder.add(bm);
        this.boardMesh = bm;
      }
    } catch (e) {
      console.warn('[hub] board', e);
    }
  }

  private buildGun() {
    const d = loadSave();
    this.gun?.root.removeFromParent();
    let spec: RigSpec | null = null;
    try {
      spec = (CH as any).revolverRig?.(d.gun) ?? null;
    } catch (e) {
      console.warn('[hub] gun', e);
    }
    if (!spec?.parts) return;
    const key = `gun:${d.gun.barrel}:${d.gun.cylinder}:${d.gun.grip}:${d.gun.sight}`;
    this.gun = new RigInstance(buildRigGeo(spec, key), { material: makeVoxelMaterial() });
    this.gun.root.scale.setScalar(2.2);
    this.gun.root.rotation.set(0, Math.PI / 2, Math.PI / 2);
    this.gunHolder.add(this.gun.root);
  }

  private focus(pos: THREE.Vector3 | null, look?: THREE.Vector3) {
    if (!pos) {
      this.camGoal.pos.set(0, 2.6, 7.2);
      this.camGoal.look.set(0, 1.3, 0);
    } else {
      this.camGoal.pos.copy(pos);
      this.camGoal.look.copy(look!);
    }
  }

  private closePanel() {
    this.panel?.remove();
    this.panel = null;
    this.focus(null);
  }

  private openPanel(html: HTMLElement, side: 'left' | 'right') {
    this.panel?.remove();
    const p = document.createElement('div');
    p.style.cssText = UI_CSS + `;top:50%;transform:translateY(-50%);${side}:5vw;max-width:min(420px,40vw)`;
    const close = document.createElement('button');
    close.textContent = 'DONE';
    close.style.cssText = BTN_CSS + ';display:block;margin:14px auto 0';
    close.onclick = () => this.closePanel();
    p.append(html, close);
    this.engine.overlay.appendChild(p);
    this.panel = p;
  }

  private wardrobe() {
    this.focus(new THREE.Vector3(2.4, 1.9, 3.2), new THREE.Vector3(0.4, 1.2, 0.6));
    const wrap = document.createElement('div');
    const render = () => {
      wrap.innerHTML = '<div style="font-size:26px;color:#8a2a18;text-align:center;margin-bottom:8px">WARDROBE</div>';
      const d = loadSave();
      const row = (kind: 'hat' | 'outfit' | 'board', list: string[], cur: string) => {
        const r = document.createElement('div');
        r.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin:8px 0';
        const i = list.indexOf(cur);
        const prev = document.createElement('button');
        prev.textContent = '◀';
        prev.style.cssText = BTN_CSS;
        const next = document.createElement('button');
        next.textContent = '▶';
        next.style.cssText = BTN_CSS;
        const lab = document.createElement('div');
        lab.style.cssText = 'flex:1;text-align:center';
        const key = `${kind}:${cur}`;
        const own = owns(key);
        lab.innerHTML = `<div style="font-size:13px;opacity:.7">${kind.toUpperCase()}</div>${cur.replace('_', ' ')}${own ? '' : `<div style="color:#a02a1a;font-size:14px">${PRICES[key]} gold</div>`}`;
        const set = (v: string) => {
          (d.look as any)[kind] = v;
          writeSave(d);
          this.buildHero();
          render();
          this.engine.audio.play('paper_flutter', { volume: 0.5 });
        };
        prev.onclick = () => set(list[(i - 1 + list.length) % list.length]);
        next.onclick = () => set(list[(i + 1) % list.length]);
        r.append(prev, lab, next);
        if (!own) {
          const b = document.createElement('button');
          b.textContent = 'BUY';
          b.style.cssText = BTN_CSS;
          b.onclick = () => {
            if (buy(key)) {
              this.engine.audio.play('gold_burst', { volume: 0.8 });
              this.updateBank();
              render();
            } else this.engine.audio.play('ui_error', { volume: 0.8 });
          };
          r.appendChild(b);
        }
        wrap.appendChild(r);
      };
      row('hat', HATS, d.look.hat);
      row('outfit', OUTFITS, d.look.outfit);
      row('board', BOARDS, d.look.board);
      const note = document.createElement('div');
      note.style.cssText = 'font-size:14px;opacity:.75;text-align:center;margin-top:6px';
      note.textContent = 'Locked looks are previewed; buy them to ride out in style.';
      wrap.appendChild(note);
    };
    render();
    this.openPanel(wrap, 'left');
  }

  /** drag a part chip onto its slot (or click it) */
  private gunBench() {
    this.focus(new THREE.Vector3(-3.6, 2.0, 2.6), new THREE.Vector3(-5.2, 1.1, 1.4));
    const wrap = document.createElement('div');
    const render = () => {
      const d = loadSave();
      wrap.innerHTML = '<div style="font-size:26px;color:#8a2a18;text-align:center;margin-bottom:4px">GUN BENCH</div><div style="font-size:14px;text-align:center;opacity:.75;margin-bottom:8px">Drag a part onto its slot</div>';
      for (const slot of Object.keys(GUN_PARTS) as (keyof GunLoadout)[]) {
        const r = document.createElement('div');
        r.style.cssText = 'margin:8px 0';
        const target = document.createElement('div');
        target.style.cssText = 'border:3px dashed #5a3418;padding:6px 10px;margin-bottom:4px;background:#f4e4bc';
        target.innerHTML = `<span style="font-size:13px;opacity:.7">${slot.toUpperCase()}</span> · ${d.gun[slot]}<div style="font-size:13px;color:#5a3a1a">${GUN_PERKS[`${slot}:${d.gun[slot]}`] ?? ''}</div>`;
        target.ondragover = (e) => {
          e.preventDefault();
          target.style.background = '#ffe9a8';
        };
        target.ondragleave = () => (target.style.background = '#f4e4bc');
        target.ondrop = (e) => {
          e.preventDefault();
          const v = e.dataTransfer?.getData('text/plain') ?? '';
          const [sl, part] = v.split(':');
          if (sl === slot) equip(slot, part);
          else target.style.background = '#f4e4bc';
        };
        const chips = document.createElement('div');
        chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';
        for (const part of GUN_PARTS[slot] as string[]) {
          const key = `gun:${slot}:${part}`;
          const own = owns(key);
          const c = document.createElement('div');
          c.draggable = true;
          c.textContent = own ? part : `${part} (${PRICES[key]}g)`;
          c.title = GUN_PERKS[`${slot}:${part}`] ?? '';
          c.style.cssText = `cursor:grab;padding:3px 8px;border:3px solid #2a1408;background:${(d.gun as any)[slot] === part ? '#c9a050' : own ? '#d8b878' : '#b8a888'};font-size:15px`;
          c.ondragstart = (e) => e.dataTransfer?.setData('text/plain', `${slot}:${part}`);
          c.onclick = () => equip(slot, part);
          chips.appendChild(c);
        }
        r.append(target, chips);
        wrap.appendChild(r);
      }
    };
    const equip = (slot: keyof GunLoadout, part: string) => {
      const key = `gun:${slot}:${part}`;
      if (!owns(key) && !buy(key)) {
        this.engine.audio.play('ui_error', { volume: 0.8 });
        return;
      }
      const d = loadSave();
      (d.gun as any)[slot] = part;
      writeSave(d);
      this.engine.audio.play(slot === 'cylinder' ? 'rev_spin' : 'rev_close', { volume: 0.8 });
      this.updateBank();
      this.buildGun();
      render();
    };
    render();
    this.openPanel(wrap, 'right');
  }

  private codex() {
    this.focus(new THREE.Vector3(-1.6, 2.2, 3.6), new THREE.Vector3(-2.4, 0.9, 2.3));
    this.engine.audio.play('book_open', { volume: 0.8 });
    const d = loadSave();
    const wrap = document.createElement('div');
    wrap.style.cssText = 'max-height:56vh;overflow:auto;padding-right:6px';
    wrap.innerHTML = '<div style="font-size:26px;color:#8a2a18;text-align:center">THOTH\'S CODEX</div><div style="font-size:14px;text-align:center;opacity:.75;margin-bottom:8px">Every soul you send ahead is written down.</div>';
    for (const e of Object.values(ENEMIES) as any[]) {
      const n = d.codex[e.id] ?? 0;
      const r = document.createElement('div');
      r.style.cssText = 'border-bottom:2px solid rgba(90,52,24,.35);padding:6px 0';
      r.innerHTML = n > 0 ? `<b style="color:#5a1a10">${e.name}</b> <span style="float:right">${n} slain</span><div style="font-size:14px;opacity:.8">${e.title}</div>` : `<b style="opacity:.5">???</b><div style="font-size:14px;opacity:.5">Not yet encountered.</div>`;
      wrap.appendChild(r);
    }
    this.openPanel(wrap, 'right');
  }

  private click(c: Clickable) {
    const eng = this.engine;
    switch (c.id) {
      case 'wardrobe':
      case 'mirror':
        this.wardrobe();
        break;
      case 'bench':
        this.gunBench();
        break;
      case 'book':
        this.codex();
        break;
      case 'duck': {
        this.duckSquash = 1;
        eng.audio.play('duck_quack', { volume: 1, pitch: 0.9 + rnd.next() * 0.3 });
        const p = c.obj.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.35, 0));
        emote(this.particles, p, rnd.pick(['heart', 'note', 'exclaim']), 0.8);
        break;
      }
      case 'gramophone':
        this.music = !this.music;
        (window as any).__music?.setMood(this.music ? 'hub' : 'off');
        eng.audio.play('ui_click', { volume: 0.7 });
        break;
      case 'piano':
        eng.audio.play('banjo_funny', { volume: 0.8 });
        emote(this.particles, c.obj.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1.6, 0)), 'note');
        break;
      case 'dart': {
        const score = rnd.pick([5, 10, 20, 25, 50, 0]);
        eng.audio.play('kick', { volume: 0.6, pitch: 1.6 });
        this.flashTip(score === 50 ? 'BULLSEYE!' : score === 0 ? 'Missed the board. Embarrassing.' : `${score} points`);
        break;
      }
      case 'board':
        eng.audio.play('door_creak', { volume: 0.8 });
        this.onRide();
        break;
    }
  }

  private flashTip(t: string) {
    this.tip.textContent = t;
    this.tip.style.display = 'block';
    this.tip.style.left = '50%';
    this.tip.style.top = '12vh';
    this.tip.style.transform = 'translateX(-50%)';
    this.tip.style.fontSize = '24px';
    clearTimeout((this.tip as any)._t);
    (this.tip as any)._t = setTimeout(() => {
      this.tip.style.display = 'none';
      this.tip.style.transform = '';
      this.tip.style.fontSize = '17px';
    }, 1600);
  }

  exit() {
    this.panel?.remove();
    this.tip.remove();
    this.bank.remove();
    document.body.style.cursor = 'default';
  }

  update(_dt: number, rdt: number) {
    this.t += rdt;
    const inp = this.engine.input;
    if (inp.wasPressed('Escape')) {
      if (this.panel) this.closePanel();
      else this.onMenu();
    }
    // hover / click
    if (!this.panel) {
      this.ray.setFromCamera(new THREE.Vector2(inp.ndcX, inp.ndcY), this.camera);
      const hits = this.ray.intersectObjects(this.clickables.map((c) => c.obj), true);
      let h: Clickable | null = null;
      if (hits.length) {
        let o: THREE.Object3D | null = hits[0].object;
        while (o && !h) {
          h = this.clickables.find((c) => c.obj === o) ?? null;
          o = o.parent;
        }
      }
      if (h !== this.hovered) {
        if (h) this.engine.audio.play('ui_hover', { volume: 0.4 });
        this.hovered = h;
        document.body.style.cursor = h ? 'pointer' : 'default';
      }
      if (h) {
        this.tip.textContent = h.label;
        this.tip.style.display = 'block';
        this.tip.style.left = `${inp.mouseX + 16}px`;
        this.tip.style.top = `${inp.mouseY + 12}px`;
        if (inp.wasPressed('Mouse0')) this.click(h);
      } else if (!(this.tip as any)._t) this.tip.style.display = 'none';
    }
    for (const c of this.clickables) {
      c.hover = damp(c.hover, c === this.hovered ? 1 : 0, 10, rdt);
      c.obj.position.y = c.base.y + c.hover * 0.04;
    }
    // duck squash
    if (this.duck) {
      this.duckSquash = Math.max(0, this.duckSquash - rdt * 3);
      const k = Math.sin(this.duckSquash * 12) * this.duckSquash;
      this.duck.scale.set(1 + k * 0.25, 1 - k * 0.3, 1 + k * 0.25);
    }
    // gun turntable
    if (this.gun) this.gun.root.rotation.z = Math.PI / 2 + Math.sin(this.t * 0.7) * 0.4;
    if (this.gun?.nodes['cylinder']) this.gun.nodes['cylinder'].rotation.z += rdt * 0.8;
    // hero idle
    if (this.hero) {
      const n = this.hero.nodes;
      if (n['torso']) n['torso'].rotation.set(Math.sin(this.t * 1.5) * 0.02, Math.sin(this.t * 0.4) * 0.08, 0);
      if (n['arm_l']) n['arm_l'].rotation.set(0, 0, 0.25);
      if (n['arm_r']) n['arm_r'].rotation.set(-0.1, 0, -0.35);
      if (n['fore_r']) n['fore_r'].rotation.x = -1.4;
      this.hero.root.updateMatrixWorld(true);
      this.faces.begin();
      this.heroEyes?.lookAt(this.hovered ? this.hovered.obj.getWorldPosition(new THREE.Vector3()) : this.camera.position);
      this.heroEyes?.draw(this.faces, rdt);
      this.faces.end(this.scene.fog as THREE.Fog);
    }
    this.particles.update(rdt, this.scene.fog as THREE.Fog);
    // camera
    const k = Math.min(1, rdt * 3);
    const drift = this.panel ? new THREE.Vector3() : new THREE.Vector3(inp.ndcX * 0.4, inp.ndcY * 0.2, 0);
    this.camera.position.lerp(this.camGoal.pos.clone().add(drift), k);
    this.camLook.lerp(this.camGoal.look, k);
    this.camera.lookAt(this.camLook);
  }
}

export { Ease };
