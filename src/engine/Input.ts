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

/** a touch screen (or ?touch=1 to try the touch controls with a mouse) */
export function touchScreen() {
  try {
    return new URLSearchParams(location.search).get('touch') === '1' || matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  } catch {
    return false;
  }
}

/** a finger on the screen outside gameplay (the screen as a mouse) */
interface TouchFinger {
  id: number;
  x0: number;
  y0: number;
  t0: number;
  x: number;
  y: number;
  moved: number;
  /** another finger came down with it: a two-finger tap */
  pair: TouchFinger | null;
  /** held still long enough to be a long press (the right button) */
  long: boolean;
}

/** a finished touch gesture outside gameplay; swipes name the way the finger went */
export type TouchGesture = 'tap' | 'back' | 'swipeLeft' | 'swipeRight' | 'swipeUp' | 'swipeDown';

function readFlag(key: string) {
  try {
    const q = new URLSearchParams(location.search).get('autopush');
    if (q !== null) return q === '1';
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  bindings: Record<Action, string[]> = JSON.parse(JSON.stringify(DEFAULT_BINDINGS));
  mouseDX = 0;
  mouseDY = 0;
  /** last time the mouse actually turned the view (ms); the camera follows the board when it rests */
  mouseMovedAt = 0;
  private edgeAt = 0;
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
      for (const a of this.tHeld) this.tUp.add(a);
      this.tHeld.clear();
      this.stick.active = false;
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
        if (Math.abs(e.movementX) + Math.abs(e.movementY) > 1) this.mouseMovedAt = performance.now();
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
    if (this.touchDevice) {
      const o = { passive: false, capture: true } as AddEventListenerOptions;
      window.addEventListener('touchstart', (e) => this.tStart(e), o);
      window.addEventListener('touchmove', (e) => this.tMove(e), o);
      window.addEventListener('touchend', (e) => this.tEnd(e), o);
      window.addEventListener('touchcancel', (e) => this.tEnd(e, true), o);
      // no browser panning, zooming or long-press menus over the game
      try {
        document.documentElement.style.touchAction = 'none';
        (document.documentElement.style as any).webkitUserSelect = 'none';
        (document.documentElement.style as any).webkitTouchCallout = 'none';
      } catch {
        /* ignore */
      }
    }
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

  // ---------------------------------------------------------------- touch layer
  // The gesture layer (game/ui/TouchControls) drives actions directly instead of
  // faking key codes, so a gesture never fights a real key bound to the same action.
  private tHeld = new Set<Action>();
  private tHit = new Set<Action>();
  private tUp = new Set<Action>();
  /** analog steering from the touch layer (x: carve right +, y: forward + / brake -) */
  stick = { x: 0, y: 0, active: false };
  /** a touch PUSH tap lands this many seconds after the finger went down (the beat is timed from the touch) */
  pushLead = 0;
  /** performance.now() of the last aiming drag on the touch layer (the camera eases behind the board when idle) */
  touchAimAt = 0;
  /** desktop opt-in: the board kick-pushes on its own while you hold a direction (touch always does) */
  autoPushDesktop = readFlag('dustup.autoPush');
  get autoPush() {
    return this.touchMode || this.autoPushDesktop;
  }
  setAutoPushDesktop(v: boolean) {
    this.autoPushDesktop = v;
    try {
      localStorage.setItem('dustup.autoPush', v ? '1' : '0');
    } catch {
      /* storage blocked */
    }
  }
  /** hold / let go of an action from the touch layer */
  touchHold(a: Action, on: boolean) {
    if (on && !this.tHeld.has(a)) {
      this.tHeld.add(a);
      this.tHit.add(a);
      this.anyKeyPressed = true;
    } else if (!on && this.tHeld.has(a)) {
      this.tHeld.delete(a);
      this.tUp.add(a);
    }
  }
  /** a one-frame press and release of an action (a tap) */
  touchTap(a: Action) {
    this.tHit.add(a);
    if (!this.tHeld.has(a)) this.tUp.add(a);
    this.anyKeyPressed = true;
  }
  /** is the touch layer holding this action */
  touchHeld(a: Action) {
    return this.tHeld.has(a);
  }
  /** let go of everything the touch layer holds */
  touchReset() {
    for (const a of this.tHeld) this.tUp.add(a);
    this.tHeld.clear();
    this.stick.active = false;
    this.stick.x = this.stick.y = 0;
  }

  // ---------------------------------------------------------------- touch outside gameplay
  // Everywhere the gameplay gesture layer is not live (menus, the hideout, shops,
  // pickers, cutscenes, pause), a finger on the game canvas works the mouse:
  //   tap = left click where the finger lifted (it hovers while it rests)
  //   press and hold still = right button (turn a card, shoot in the shop), and
  //   `touchHolding` for hold-to-skip; two fingers tapped together = Escape (back,
  //   close, leave, pause); a swipe = the arrow key that moves the view the way the
  //   finger went (finger left = ArrowRight: next page, look right).
  // Touches on DOM controls (buttons, sliders, labels) are left to the browser.
  /** this device has a touch screen (or ?touch=1) */
  readonly touchDevice = touchScreen();
  /** the gameplay gesture layer (ui/TouchControls) owns the screen this frame */
  touchLive = false;
  /** a finger rests on the screen, held still: hold-to-skip and other holds */
  touchHolding = false;
  /** this frame's finished touch gesture (outside gameplay) */
  gesture: TouchGesture | null = null;
  /** a scene with its own pointer drag (the gun rack) took this touch: its swipe is not an arrow key */
  swipeOwned = false;
  private fingers = new Map<number, TouchFinger>();
  /** the game canvas */
  get surface() {
    return this.el;
  }
  private setPointer(x: number, y: number) {
    this.mouseX = x;
    this.mouseY = y;
    this.ndcX = (x / window.innerWidth) * 2 - 1;
    this.ndcY = -(y / window.innerHeight) * 2 + 1;
  }
  private tap(code: string) {
    this.pressed.add(code);
    this.released.add(code);
    this.anyKeyPressed = true;
  }
  private tStart(e: TouchEvent) {
    if (this.touchLive) return;
    let mine = false;
    const now = performance.now();
    for (const t of Array.from(e.changedTouches)) {
      if (t.target !== this.el) continue;
      mine = true;
      const f: TouchFinger = { id: t.identifier, x0: t.clientX, y0: t.clientY, t0: now, x: t.clientX, y: t.clientY, moved: 0, pair: null, long: false };
      for (const o of this.fingers.values()) {
        if (o.pair || now - o.t0 > 220 || o.moved > 18) continue;
        o.pair = f;
        f.pair = o;
        break;
      }
      this.fingers.set(f.id, f);
      if (!f.pair) this.setPointer(f.x, f.y);
      this.anyKeyPressed = true;
    }
    if (mine) e.preventDefault();
  }
  private tMove(e: TouchEvent) {
    if (this.touchLive) return;
    let mine = false;
    for (const t of Array.from(e.changedTouches)) {
      const f = this.fingers.get(t.identifier);
      if (!f) continue;
      mine = true;
      f.x = t.clientX;
      f.y = t.clientY;
      f.moved = Math.max(f.moved, Math.hypot(f.x - f.x0, f.y - f.y0));
      if (!f.pair) this.setPointer(f.x, f.y);
    }
    if (mine) e.preventDefault();
  }
  private tEnd(e: TouchEvent, cancel = false) {
    const now = performance.now();
    let mine = false;
    for (const t of Array.from(e.changedTouches)) {
      const f = this.fingers.get(t.identifier);
      if (!f) continue;
      mine = true;
      this.fingers.delete(f.id);
      if (f.long) this.release('Mouse2');
      if (cancel || this.touchLive) continue;
      f.x = t.clientX;
      f.y = t.clientY;
      const dur = now - f.t0;
      const still = f.moved < 18 && dur < 450;
      if (f.pair) {
        // two fingers: both lift as taps = Escape; the first to lift waits for the other
        const o = f.pair;
        if (this.fingers.has(o.id)) {
          if (!still) o.pair = null;
          continue;
        }
        if (still && o.moved < 18 && !o.long) {
          this.tap('Escape');
          this.gesture = 'back';
        }
        continue;
      }
      if (f.long) continue;
      if (still) {
        this.setPointer(f.x, f.y);
        this.tap('Mouse0');
        this.gesture = 'tap';
        continue;
      }
      const dx = f.x - f.x0, dy = f.y - f.y0;
      const d = Math.hypot(dx, dy);
      if (d > 48 && dur < 600 && d / Math.max(1, dur) > 0.3) {
        const horiz = Math.abs(dx) > Math.abs(dy);
        this.gesture = horiz ? (dx < 0 ? 'swipeLeft' : 'swipeRight') : dy < 0 ? 'swipeUp' : 'swipeDown';
        // the view moves with the finger: a swipe to the left brings in what lies to the right
        if (!this.swipeOwned) this.tap(horiz ? (dx < 0 ? 'ArrowRight' : 'ArrowLeft') : dy < 0 ? 'ArrowDown' : 'ArrowUp');
      }
    }
    if (!this.fingers.size) this.swipeOwned = false;
    if (mine) e.preventDefault();
  }
  /** per frame (from endFrame): long presses, the hold flag, and the gesture layer taking over */
  private touchFrame() {
    if (this.touchLive && this.fingers.size) {
      for (const f of this.fingers.values()) if (f.long) this.release('Mouse2');
      this.fingers.clear();
    }
    const now = performance.now();
    let hold = false;
    for (const f of this.fingers.values()) {
      if (f.pair || f.moved >= 18) continue;
      const age = now - f.t0;
      if (age > 300) hold = true;
      if (age > 480 && !f.long) {
        f.long = true;
        this.press('Mouse2');
      }
    }
    this.touchHolding = hold;
  }

  isDown(code: string) {
    return this.down.has(code);
  }
  wasPressed(code: string) {
    return this.pressed.has(code);
  }
  held(a: Action) {
    if (!this.enabled && a !== 'pause') return false;
    return this.tHeld.has(a) || this.bindings[a].some((c) => this.down.has(c));
  }
  hit(a: Action) {
    if (!this.enabled && a !== 'pause') return false;
    return this.tHit.has(a) || this.bindings[a].some((c) => this.pressed.has(c));
  }
  up(a: Action) {
    return this.tUp.has(a) || this.bindings[a].some((c) => this.released.has(c));
  }
  /** raw click (for 3D UI) regardless of enabled flag */
  clicked(button = 0) {
    return this.pressed.has('Mouse' + button);
  }
  axis(neg: Action, pos: Action) {
    return (this.held(pos) ? 1 : 0) - (this.held(neg) ? 1 : 0);
  }
  consumeMouse() {
    // no real pointer lock (some embeds refuse it): the cursor stops at the window edge, so resting
    // it in an edge band keeps turning the view, faster the deeper it sits
    const now = performance.now();
    const fdt = Math.min(0.1, Math.max(0, (now - (this.edgeAt || now)) / 1000));
    this.edgeAt = now;
    if (this.lockFailed && this.wantLock && !this.touchMode && this.enabled) {
      const ax = Math.abs(this.ndcX);
      if (ax > 0.86 && ax <= 1) {
        this.mouseDX += Math.sign(this.ndcX) * ((ax - 0.86) / 0.14) * 900 * fdt;
        this.mouseMovedAt = now;
      }
    }
    const dx = this.mouseDX * this.sensitivity;
    const dy = this.mouseDY * this.sensitivity * (this.invertY ? -1 : 1);
    this.mouseDX = 0;
    this.mouseDY = 0;
    return { dx, dy };
  }
  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.tHit.clear();
    this.tUp.clear();
    this.pushLead = 0;
    this.wheel = 0;
    this.anyKeyPressed = false;
    this.gesture = null;
    if (this.touchDevice) this.touchFrame();
  }
  keyName(a: Action) {
    const c = this.bindings[a][0] ?? '?';
    return c.replace('Key', '').replace('Digit', '').replace('Mouse0', 'LMB').replace('Mouse2', 'RMB').replace('Mouse3', 'M4').replace('Mouse4', 'M5').replace('ShiftLeft', 'Shift').replace('ControlLeft', 'Ctrl').replace('Space', 'Space').replace('Escape', 'Esc');
  }
}
