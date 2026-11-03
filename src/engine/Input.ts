// Keyboard / mouse input with pointer lock, edge detection and rebindable actions.

export type Action =
  | 'forward' | 'back' | 'left' | 'right'
  | 'jump' | 'push' | 'drift' | 'boost' | 'grapple'
  | 'fire' | 'aim' | 'reload' | 'melee' | 'grenade'
  | 'skill1' | 'skill2' | 'ultimate' | 'interact'
  | 'item1' | 'item2' | 'stats' | 'pause' | 'trick';

export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  // SHIFT is the rider's foot: TAP to kick-push (on the beat for a perfect push),
  // HOLD through an A / D carve to drift, hold in the air + WASD to spin / flip
  push: ['ShiftLeft', 'ShiftRight'],
  drift: ['ShiftLeft', 'ShiftRight'],
  boost: ['KeyV'], // not Ctrl: Ctrl+W would close the browser tab
  grapple: ['KeyQ'],
  fire: ['Mouse0'],
  aim: ['Mouse2'],
  reload: ['KeyR'],
  melee: ['KeyF', 'Mouse3'],
  grenade: ['KeyG'],
  skill1: ['KeyE'],
  skill2: ['KeyC'],
  ultimate: ['KeyZ', 'KeyX'],
  interact: ['KeyT', 'Enter'],
  item1: ['Digit1'],
  item2: ['Digit2'],
  stats: ['Tab'],
  pause: ['Escape', 'KeyP'],
  trick: ['Mouse4', 'KeyB'],
};

export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  bindings: Record<Action, string[]> = JSON.parse(JSON.stringify(DEFAULT_BINDINGS));
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  mouseX = 0; // pixels
  mouseY = 0;
  ndcX = 0;
  ndcY = 0;
  locked = false;
  /** pointer lock refused (e.g. sandboxed iframe): mouse movement still steers the camera */
  lockFailed = false;
  get lookActive() {
    return this.locked || (this.lockFailed && this.wantLock);
  }
  sensitivity = 1;
  invertY = false;
  /** when false, all gameplay actions read as idle (cinematics) */
  enabled = true;
  lastClickTime = 0;
  anyKeyPressed = false;
  private wantLock = false;

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      this.anyKeyPressed = true;
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.released.add(e.code);
    });
    window.addEventListener('blur', () => {
      for (const k of this.down) this.released.add(k);
      this.down.clear();
    });
    el.addEventListener('mousedown', (e) => {
      const c = 'Mouse' + e.button;
      if (!this.down.has(c)) this.pressed.add(c);
      this.down.add(c);
      this.anyKeyPressed = true;
      if (this.wantLock && !this.locked) this.requestLock();
    });
    window.addEventListener('mouseup', (e) => {
      const c = 'Mouse' + e.button;
      this.down.delete(c);
      this.released.add(c);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (this.locked || (this.lockFailed && this.wantLock)) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.ndcX = (e.clientX / window.innerWidth) * 2 - 1;
      this.ndcY = -(e.clientY / window.innerHeight) * 2 + 1;
    });
    window.addEventListener(
      'wheel',
      (e) => {
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: true }
    );
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (this.locked) this.lockFailed = false;
    });
    document.addEventListener('pointerlockerror', () => {
      this.lockFailed = true;
      if (this.wantLock) this.locked = true; // pseudo-lock: raw mouse movement steers
    });
  }

  /** gameplay wants pointer lock (re-acquired on click) */
  setWantLock(v: boolean) {
    this.wantLock = v;
    if (this.lockFailed) {
      this.locked = v;
      return;
    }
    if (v) this.requestLock();
    else if (this.locked) document.exitPointerLock();
  }
  requestLock() {
    try {
      const fn = (this.el as any).requestPointerLock;
      if (!fn) {
        this.lockFailed = true;
        if (this.wantLock) this.locked = true;
        return;
      }
      const p = fn.call(this.el, { unadjustedMovement: false });
      if (p && p.catch)
        p.catch(() => {
          this.lockFailed = true;
          if (this.wantLock) this.locked = true;
        });
    } catch {
      /* ignore */
    }
  }

  /** virtual key/button injection (touch controls) */
  press(code: string) {
    if (!this.down.has(code)) this.pressed.add(code);
    this.down.add(code);
    this.anyKeyPressed = true;
  }
  release(code: string) {
    if (!this.down.has(code)) return;
    this.down.delete(code);
    this.released.add(code);
  }
  /** touch devices: no pointer lock, look comes from the touch layer */
  touchMode = false;

  isDown(code: string) {
    return this.down.has(code);
  }
  wasPressed(code: string) {
    return this.pressed.has(code);
  }
  held(a: Action) {
    if (!this.enabled && a !== 'pause') return false;
    return this.bindings[a].some((c) => this.down.has(c));
  }
  hit(a: Action) {
    if (!this.enabled && a !== 'pause') return false;
    return this.bindings[a].some((c) => this.pressed.has(c));
  }
  up(a: Action) {
    return this.bindings[a].some((c) => this.released.has(c));
  }
  /** raw click (for 3D UI) regardless of enabled flag */
  clicked(button = 0) {
    return this.pressed.has('Mouse' + button);
  }
  axis(neg: Action, pos: Action) {
    return (this.held(pos) ? 1 : 0) - (this.held(neg) ? 1 : 0);
  }
  consumeMouse() {
    const dx = this.mouseDX * this.sensitivity;
    const dy = this.mouseDY * this.sensitivity * (this.invertY ? -1 : 1);
    this.mouseDX = 0;
    this.mouseDY = 0;
    return { dx, dy };
  }
  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.wheel = 0;
    this.anyKeyPressed = false;
  }
  keyName(a: Action) {
    const c = this.bindings[a][0] ?? '?';
    return c.replace('Key', '').replace('Digit', '').replace('Mouse0', 'LMB').replace('Mouse2', 'RMB').replace('Mouse3', 'M4').replace('Mouse4', 'M5').replace('ShiftLeft', 'Shift').replace('ControlLeft', 'Ctrl').replace('Space', 'Space').replace('Escape', 'Esc');
  }
}
