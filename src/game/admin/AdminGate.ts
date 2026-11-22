// Turning the admin testing mode on. This little gate lives in the main chunk; the mode itself
// (game/admin/AdminMode) is its own chunk, fetched only once one of these says yes:
//  - a VITE_ADMIN=1 build (npm run build:admin, the desktop admin build)
//  - ?admin=1 or #admin in the address (the desktop app's --admin flag opens the page with ?admin=1)
//  - typing A D M I N anywhere (a claude.ai artifact or an embed has no address bar to add ?admin=1
//    to); it is remembered on this device until the panel's SAVE tab turns it off
// Once it is on, F1, ` (backquote), F10 or Ctrl+Shift+A open the panel (laptops without F-keys and
// keyboards without a backquote key included).
import type { Engine } from '../../engine/Engine';

const KEY = 'dustup-admin';
const CODE = ['KeyA', 'KeyD', 'KeyM', 'KeyI', 'KeyN'];

let loading: Promise<unknown> | null = null;

function remembered() {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
/** forget the typed code on this device */
export function forgetAdmin() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage blocked */
  }
}

export function loadAdmin(engine: Engine, openNow = false) {
  loading ??= import('./AdminMode')
    .then((m) => m.installAdmin(engine))
    .catch((e) => {
      loading = null;
      console.warn('[admin] failed to load', e);
    });
  if (openNow) void loading.then((a) => (a as { show?: () => void } | undefined)?.show?.());
  return loading;
}

export function gateAdmin(engine: Engine, params: URLSearchParams) {
  const on = import.meta.env.VITE_ADMIN === '1' || params.get('admin') === '1' || /(^|[#&])admin\b/.test(location.hash.slice(1)) || remembered();
  if (on) {
    void loadAdmin(engine);
    return;
  }
  // the typed code: five keys within a few seconds, in order
  let at = 0, t0 = 0;
  const onKey = (e: KeyboardEvent) => {
    const now = performance.now();
    if (now - t0 > 3000) at = 0;
    if (e.code === CODE[at]) {
      if (at === 0) t0 = now;
      at++;
      if (at === CODE.length) {
        window.removeEventListener('keydown', onKey, true);
        try {
          localStorage.setItem(KEY, '1');
        } catch {
          /* storage blocked: on for this session only */
        }
        void loadAdmin(engine, true);
      }
    } else at = e.code === CODE[0] ? ((t0 = now), 1) : 0;
  };
  window.addEventListener('keydown', onKey, true);
}
