// Full mobile controls. Left half: a floating stick that appears under your
// thumb (ride / steer). Right half: drag anywhere to look; the FIRE button can be
// held and dragged at the same time (aim while shooting). Around it: aim, jump,
// push (hold: drift), boost, reload, kick, grapple, the three skills, the ultimate, the two
// consumables, interact and pause. During a QTE a big tap target sends exactly
// the key the QTE wants (balance QTEs get left/right pads).
// Everything is injected into the normal Input as real key codes, so gameplay
// code doesn't know the difference.
import type { Input } from '../../engine/Input';
import type { Qte } from './Qte';

interface Btn {
  el: HTMLDivElement;
  code: string;
  toggle?: boolean;
  on: boolean;
  touch: number | null;
}

export function isTouchDevice() {
  try {
    return new URLSearchParams(location.search).get('touch') === '1' || matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  } catch {
    return false;
  }
}

const CSS = `
.tc-root{position:absolute;inset:0;z-index:6;touch-action:none;user-select:none;-webkit-user-select:none;pointer-events:none}
.tc-zone{position:absolute;top:0;bottom:0;pointer-events:auto;touch-action:none}
.tc-stick{position:absolute;width:132px;height:132px;margin:-66px 0 0 -66px;border-radius:50%;border:3px solid rgba(255,236,200,.55);background:radial-gradient(rgba(40,24,12,.35),rgba(40,24,12,.15));display:none;pointer-events:none}
.tc-knob{position:absolute;left:50%;top:50%;width:58px;height:58px;margin:-29px 0 0 -29px;border-radius:50%;background:rgba(255,236,200,.85);box-shadow:0 3px 0 #3a2210, inset 0 -4px 0 rgba(0,0,0,.25)}
.tc-btn{position:absolute;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Alagard',serif;color:#fff3d6;text-shadow:0 2px 0 #2a1408;pointer-events:auto;touch-action:none;background:rgba(58,34,18,.62);border:3px solid rgba(255,220,160,.55);box-shadow:0 4px 0 rgba(20,10,4,.6);letter-spacing:.5px}
.tc-btn.on{background:rgba(200,120,40,.8);border-color:#ffd36b;transform:translateY(2px);box-shadow:0 2px 0 rgba(20,10,4,.6)}
.tc-qte{position:absolute;left:50%;top:58%;width:170px;height:170px;margin:-85px 0 0 -85px;border-radius:50%;display:none;align-items:center;justify-content:center;font-family:'Alagard',serif;font-size:30px;color:#2a1408;background:rgba(255,211,107,.9);border:5px solid #fff3d6;box-shadow:0 0 0 6px rgba(42,20,8,.6);pointer-events:auto;touch-action:none;z-index:9}
.tc-pad{position:absolute;bottom:18%;width:120px;height:120px;border-radius:24px;display:none;align-items:center;justify-content:center;font-family:'Alagard',serif;font-size:40px;color:#2a1408;background:rgba(255,211,107,.85);border:4px solid #fff3d6;pointer-events:auto;touch-action:none;z-index:9}
`;

export class TouchControls {
  root: HTMLDivElement;
  private stick: HTMLDivElement;
  private knob: HTMLDivElement;
  private stickTouch: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private lookTouch: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private btns: Btn[] = [];
  private held = new Set<string>();
  private qteBtn: HTMLDivElement;
  private padL: HTMLDivElement;
  private padR: HTMLDivElement;
  private qteCode = '';
  visible = true;

  constructor(parent: HTMLElement, private input: Input, private qte: Qte) {
    input.touchMode = true;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.className = 'tc-root';
    parent.appendChild(this.root);
    // zones
    const left = document.createElement('div');
    left.className = 'tc-zone';
    left.style.cssText = 'left:0;width:42%';
    const right = document.createElement('div');
    right.className = 'tc-zone';
    right.style.cssText = 'right:0;width:58%';
    this.root.append(left, right);
    this.stick = document.createElement('div');
    this.stick.className = 'tc-stick';
    this.knob = document.createElement('div');
    this.knob.className = 'tc-knob';
    this.stick.appendChild(this.knob);
    this.root.appendChild(this.stick);
    left.addEventListener('touchstart', (e) => this.stickStart(e), { passive: false });
    right.addEventListener('touchstart', (e) => this.lookStart(e), { passive: false });
    window.addEventListener('touchmove', (e) => this.move(e), { passive: false });
    window.addEventListener('touchend', (e) => this.end(e), { passive: false });
    window.addEventListener('touchcancel', (e) => this.end(e), { passive: false });
    // buttons: [label, code, right%, bottom%, size, toggle]
    // [label, code, right %, bottom %, size px, toggle] — an arc around FIRE, clear of the HUD's bottom row
    const B: [string, string, number, number, number, boolean?][] = [
      ['FIRE', 'Mouse0', 5, 24, 100],
      ['AIM', 'Mouse2', 18, 19, 62, true],
      ['JUMP', 'Space', 4, 45, 66],
      ['PUSH', 'ShiftLeft', 16, 37, 58], // tap = kick-push, hold through a carve = drift
      ['BOOST', 'KeyV', 28, 22, 54],
      ['R', 'KeyR', 28, 37, 50],
      ['KICK', 'KeyF', 15, 54, 54],
      ['HOOK', 'KeyQ', 26, 52, 52],
      ['ULT', 'KeyZ', 4, 65, 62],
      ['E', 'KeyE', 39, 22, 50],
      ['C', 'KeyC', 39, 35, 50],
      ['G', 'KeyG', 39, 48, 50],
      ['T', 'KeyT', 38, 62, 50],
    ];
    for (const [label, code, r, b, size, toggle] of B) this.addBtn(label, code, `right:${r}%;bottom:${b}%`, size, toggle);
    this.addBtn('II', 'Escape', 'right:3%;top:4%', 44);
    this.addBtn('TAB', 'Tab', 'right:12%;top:4%', 44);
    // consumables sit just above the HUD's item slots
    this.addBtn('1', 'Digit1', 'left:4%;bottom:27%', 46);
    this.addBtn('2', 'Digit2', 'left:11%;bottom:27%', 46);
    // QTE helpers
    this.qteBtn = document.createElement('div');
    this.qteBtn.className = 'tc-qte';
    this.qteBtn.textContent = 'TAP!';
    this.qteBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this.qteCode) this.input.press(this.qteCode);
    }, { passive: false });
    this.qteBtn.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (this.qteCode) this.input.release(this.qteCode);
    }, { passive: false });
    this.padL = this.pad('<', 'KeyA', 'left:8%');
    this.padR = this.pad('>', 'KeyD', 'right:8%');
    this.root.append(this.qteBtn, this.padL, this.padR);
  }

  private pad(label: string, code: string, pos: string) {
    const p = document.createElement('div');
    p.className = 'tc-pad';
    p.style.cssText = pos;
    p.textContent = label;
    p.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.input.press(code);
    }, { passive: false });
    p.addEventListener('touchend', (e) => {
      e.preventDefault();
      this.input.release(code);
    }, { passive: false });
    return p;
  }

  private addBtn(label: string, code: string, pos: string, size: number, toggle = false) {
    const el = document.createElement('div');
    el.className = 'tc-btn';
    el.style.cssText = `${pos};width:${size}px;height:${size}px;font-size:${Math.max(13, size * 0.24)}px`;
    el.textContent = label;
    const b: Btn = { el, code, toggle, on: false, touch: null };
    el.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const t = e.changedTouches[0];
      if (b.toggle) {
        b.on = !b.on;
        if (b.on) this.input.press(code);
        else this.input.release(code);
      } else {
        b.on = true;
        b.touch = t.identifier;
        this.input.press(code);
        // FIRE doubles as a look pad while held
        if (code === 'Mouse0' && this.lookTouch === null) {
          this.lookTouch = t.identifier;
          this.lookLast = { x: t.clientX, y: t.clientY };
        }
      }
      el.classList.toggle('on', b.on);
    }, { passive: false });
    this.root.appendChild(el);
    this.btns.push(b);
  }

  private stickStart(e: TouchEvent) {
    e.preventDefault();
    if (this.stickTouch !== null) return;
    const t = e.changedTouches[0];
    this.stickTouch = t.identifier;
    this.stickOrigin = { x: t.clientX, y: t.clientY };
    this.stick.style.display = 'block';
    this.stick.style.left = t.clientX + 'px';
    this.stick.style.top = t.clientY + 'px';
    this.knob.style.transform = 'translate(0px,0px)';
  }

  private lookStart(e: TouchEvent) {
    e.preventDefault();
    if (this.lookTouch !== null) return;
    const t = e.changedTouches[0];
    this.lookTouch = t.identifier;
    this.lookLast = { x: t.clientX, y: t.clientY };
  }

  private setKey(code: string, on: boolean) {
    if (on && !this.held.has(code)) {
      this.held.add(code);
      this.input.press(code);
    } else if (!on && this.held.has(code)) {
      this.held.delete(code);
      this.input.release(code);
    }
  }

  private move(e: TouchEvent) {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickTouch) {
        e.preventDefault();
        let dx = t.clientX - this.stickOrigin.x, dy = t.clientY - this.stickOrigin.y;
        const d = Math.hypot(dx, dy), R = 56;
        if (d > R) {
          dx = (dx / d) * R;
          dy = (dy / d) * R;
        }
        this.knob.style.transform = `translate(${dx}px,${dy}px)`;
        const nx = dx / R, ny = dy / R;
        this.setKey('KeyW', ny < -0.28);
        this.setKey('KeyS', ny > 0.45);
        this.setKey('KeyA', nx < -0.3);
        this.setKey('KeyD', nx > 0.3);
      } else if (t.identifier === this.lookTouch) {
        e.preventDefault();
        const k = 2.2 * this.input.sensitivity;
        this.input.mouseDX += (t.clientX - this.lookLast.x) * k;
        this.input.mouseDY += (t.clientY - this.lookLast.y) * k;
        this.lookLast = { x: t.clientX, y: t.clientY };
      }
    }
  }

  private end(e: TouchEvent) {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickTouch) {
        this.stickTouch = null;
        this.stick.style.display = 'none';
        for (const k of ['KeyW', 'KeyS', 'KeyA', 'KeyD']) this.setKey(k, false);
      }
      if (t.identifier === this.lookTouch) this.lookTouch = null;
      for (const b of this.btns) {
        if (b.toggle || b.touch !== t.identifier) continue;
        b.on = false;
        b.touch = null;
        b.el.classList.remove('on');
        this.input.release(b.code);
      }
    }
  }

  /** call every frame: hides the pad during menus/cards (taps reach the 3D UI), drives QTE helpers */
  update(modal: boolean) {
    const show = this.visible && !modal;
    this.root.style.display = show || this.qte.active ? 'block' : 'none';
    for (const b of this.btns) b.el.style.display = show ? 'flex' : 'none';
    const a = this.qte.active as any;
    let code = '';
    let balance = false;
    if (a) {
      const s = a.spec;
      if (s.kind === 'ring') code = s.key ?? 'KeyZ';
      else if (s.kind === 'mash') code = s.key ?? 'Space';
      else if (s.kind === 'bar') code = s.key ?? 'Mouse0';
      else if (s.kind === 'sequence') code = s.keys[a.state.i] ?? '';
      else if (s.kind === 'balance') balance = true;
    }
    this.qteCode = code;
    this.qteBtn.style.display = code ? 'flex' : 'none';
    if (code) this.qteBtn.textContent = a.spec.kind === 'mash' ? 'MASH!' : a.spec.kind === 'sequence' ? code.replace('Key', '') : 'TAP!';
    this.padL.style.display = balance ? 'flex' : 'none';
    this.padR.style.display = balance ? 'flex' : 'none';
  }

  dispose() {
    this.root.remove();
    this.input.touchMode = false;
  }
}
