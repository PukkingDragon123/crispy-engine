// Spoken lines as floating 3D text. Anyone who talks (Thoth in his hall, the bookworms,
// Mama Toad and Sundown in the hideout, the trail folk, the bosses, the narration of the
// death cinematic) puts the words in the world: Alagard type (FloatText3D) that types
// itself out beside the speaker's head, follows them as they move, glows softly and
// keeps the same apparent size at any distance. When the speaker is off screen the line
// floats in 3D just inside the screen's edge on their side, so it is never lost.
// Narration lines (no speaker) hang in 3D in front of the camera at a screen position.
//
//   say3D(engine, 'Hot dang! She rolls!', pete.pos, { lift: 1.9, key: 'pete' });
//   say3D(engine, 'THREE DAYS PASSED', null, { screen: [0, 0.35], size: 0.2, key: 'days' });
//   say3D(engine, text, () => head, { scene, camera })   // a scene that is not engine.current
//
// Self-driving (engine.onAfterUpdate). A line belongs to the scene it was said in: it goes
// away when that scene stops being the one on screen.
import * as THREE from 'three';
import type { Engine } from '../../engine/Engine';
import { FloatText3D, FloatTextOpts } from './FloatText3D';
import { Voice, type VoiceId } from '../audio/Voice';

export type SpeechAnchor = THREE.Vector3 | THREE.Object3D | (() => THREE.Vector3 | null) | null;

export interface Say3DOpts extends FloatTextOpts {
  /** a newer line with the same key replaces this one */
  key?: string;
  /** metres above the anchor */
  lift?: number;
  /** metres toward the camera's right of the anchor */
  side?: number;
  /** seconds the line stays once typed (default: by its length) */
  hold?: number;
  /** type at the pace of a spoken line this long (s) */
  voiceDur?: number;
  /** narration: hang in front of the camera at this screen position (NDC, -1..1) */
  screen?: [number, number];
  /** metres in front of the camera for screen lines and off-screen speakers */
  depth?: number;
  /** keep the same apparent size at any distance (default true; this is the size at 5.5 m) */
  fit?: boolean;
  /** where off-screen lines may float (NDC box x0, x1, y0, y1), e.g. clear of a side panel */
  area?: () => [number, number, number, number];
  scene?: THREE.Scene;
  camera?: THREE.Camera;
}

interface Line {
  ft: FloatText3D;
  at: SpeechAnchor;
  o: Say3DOpts;
  scene: THREE.Scene;
  camera: THREE.Camera;
  hold: number;
  gone: boolean;
  away: number;
}

const _v = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _f = new THREE.Vector3();
let engine: Engine | null = null;
const lines: Line[] = [];

function anchorPos(at: SpeechAnchor, out: THREE.Vector3): THREE.Vector3 | null {
  if (!at) return null;
  if (typeof at === 'function') {
    const p = at();
    return p ? out.copy(p) : null;
  }
  if ((at as THREE.Object3D).isObject3D) return (at as THREE.Object3D).getWorldPosition(out);
  return out.copy(at as THREE.Vector3);
}

/** a point `depth` metres in front of the camera at a screen position (NDC) */
function inFront(cam: THREE.Camera, nx: number, ny: number, depth: number, out: THREE.Vector3) {
  const pc = cam as THREE.PerspectiveCamera;
  const fov = THREE.MathUtils.degToRad(pc.fov ?? 50);
  const hh = Math.tan(fov / 2) * depth, hw = hh * (pc.aspect ?? 1);
  cam.getWorldDirection(_f);
  _r.set(1, 0, 0).applyQuaternion(cam.quaternion);
  _u.set(0, 1, 0).applyQuaternion(cam.quaternion);
  return out.copy(cam.position).addScaledVector(_f, depth).addScaledVector(_r, nx * hw).addScaledVector(_u, ny * hh);
}

function place(l: Line) {
  const cam = l.camera, o = l.o;
  const depth = o.depth ?? 2.6;
  if (o.screen) return inFront(cam, o.screen[0], o.screen[1], depth, l.ft.anchor);
  const p = anchorPos(l.at, _v);
  const box = o.area?.() ?? [-0.8, 0.8, -0.62, 0.78];
  if (p) {
    _r.set(1, 0, 0).applyQuaternion(cam.quaternion);
    p.y += o.lift ?? 0.35;
    p.addScaledVector(_r, o.side ?? 0.35);
    const q = p.clone().project(cam);
    const on = q.z < 1 && q.x > box[0] - 0.12 && q.x < box[1] + 0.12 && q.y > box[2] - 0.12 && q.y < box[3] + 0.12;
    if (on) return l.ft.anchor.copy(p);
    // off screen: just inside the edge on the speaker's side, a little way in front of the camera
    let nx = q.x, ny = q.y;
    if (q.z >= 1) {
      nx = -nx;
      ny = -ny;
    }
    const k = Math.max(Math.abs(nx) / Math.max(0.01, box[1]), Math.abs(ny) / Math.max(0.01, box[3]), 1);
    nx = THREE.MathUtils.clamp(nx / k, box[0], box[1]);
    ny = THREE.MathUtils.clamp(ny / k, box[2], box[3]);
    return inFront(cam, nx, ny, depth, l.ft.anchor);
  }
  // no speaker in the world yet: the lower left of the free area
  return inFront(cam, box[0] + 0.25, box[2] + 0.35, depth, l.ft.anchor);
}

function tick(_dt: number, rdt: number) {
  const eng = engine!;
  const showing = (eng.post as any).renderPass?.scene as THREE.Scene | undefined;
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    // the line belongs to its scene: off it goes when that scene leaves the screen
    l.away = showing && showing !== l.scene ? l.away + rdt : 0;
    if (l.away > 0.4) l.gone = true;
    if (!l.gone && l.ft.done) {
      l.hold -= rdt;
      if (l.hold <= 0) l.gone = true;
    }
    if (l.gone) l.ft.show(false);
    place(l);
    l.ft.update(rdt, l.camera);
    if (l.o.fit !== false) {
      const d = l.o.screen ? l.o.depth ?? 2.6 : l.camera.position.distanceTo(l.ft.anchor);
      l.ft.mesh.scale.multiplyScalar(THREE.MathUtils.clamp(d / 5.5, 0.2, 3));
    }
    if (l.gone && l.ft.visibleAmount < 0.02) {
      l.ft.dispose();
      lines.splice(i, 1);
    }
  }
}

export interface SpeechLine {
  /** let it fade now */
  end(): void;
  /** the words are all typed out */
  readonly typed: boolean;
}

/** say a line in the world (see the top of the file). Returns a handle (end it early, check it). */
export function say3D(eng: Engine, text: string, at: SpeechAnchor, o: Say3DOpts = {}): SpeechLine {
  if (engine !== eng) {
    engine = eng;
    eng.onAfterUpdate.push(tick);
  }
  if (o.key) for (const l of lines) if (l.o.key === o.key) l.gone = true;
  const cps = o.cps ?? (o.voiceDur ? Math.min(70, Math.max(10, text.length / Math.max(0.25, o.voiceDur * 0.85))) : 34);
  const ft = new FloatText3D(text, { size: 0.15, px: 56, wrap: 28, color: '#fff3d6', glow: '#ffb070', hdr: 1.3, ...o, cps });
  const scene = o.scene ?? (eng.current?.scene as THREE.Scene);
  const camera = o.camera ?? (eng.current?.camera as THREE.Camera);
  const l: Line = { ft, at, o, scene, camera, hold: o.hold ?? 1.6 + text.length * 0.045, gone: false, away: 0 };
  place(l);
  scene?.add(ft.mesh);
  lines.push(l);
  return {
    end: () => {
      l.gone = true;
    },
    get typed() {
      return ft.done;
    },
  };
}

/** end every line with this key (or every line said in a scene) */
export function hush3D(key?: string, scene?: THREE.Scene) {
  for (const l of lines) if ((!key || l.o.key === key) && (!scene || l.scene === scene)) l.gone = true;
}

/** a voiced line: the speaker says it (Voice) and the words float beside them, typed at the voice's pace */
export function speak3D(eng: Engine, profile: VoiceId, text: string, at: THREE.Vector3 | THREE.Object3D, o: Say3DOpts & { voice?: { follow?: boolean; delay?: number; key?: string; volume?: number; sing?: number[]; duck?: number } } = {}) {
  const pos = (at as THREE.Object3D).isObject3D ? (at as THREE.Object3D).getWorldPosition(new THREE.Vector3()) : (at as THREE.Vector3);
  let sp: { duration: number } | null = null;
  try {
    sp = Voice.say(profile, text, { pos, ...(o.voice ?? {}) } as any);
  } catch {
    /* no voice: the words still float */
  }
  return say3D(eng, text, at, { voiceDur: sp?.duration, ...o });
}

/** a canned mood line (Voice phrases), voiced and floating */
export function chatter3D(eng: Engine, profile: VoiceId, kind: string, at: THREE.Vector3 | THREE.Object3D, o: Parameters<typeof speak3D>[4] = {}) {
  const text = Voice.line(profile, kind);
  return text ? speak3D(eng, profile, text, at, o) : null;
}
