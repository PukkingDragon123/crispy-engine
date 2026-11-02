// Opening cinematic (first ride out): dawn over Serket's Reach, the sand
// spirals up into the goddess Serket, who speaks; Sundown claws his way out of
// the dunes, Pinch scrambles onto his shoulder; title cut-in; ride.
// SPACE / ESC skips.
import * as THREE from 'three';
import type { Engine } from '../../engine/Engine';
import type { CameraRig } from '../player/CameraRig';
import type { Player } from '../player/Player';
import type { Fx } from '../fx/Fx';
import type { Particles } from '../fx/Particles';
import type { World } from '../world/World';
import { buildRigGeo, RigInstance, RigSpec } from '../../engine/voxel/Rig';
import { modelEntry } from '../models/lookup';
import { Ease } from '../../engine/Tween';

export interface IntroDeps {
  engine: Engine;
  cam: CameraRig;
  player: Player;
  fx: Fx;
  particles: Particles;
  world: World;
  scene: THREE.Scene;
  cutIn(title: string, color: string, expr: string): void;
}

export async function playIntro(d: IntroDeps) {
  const { engine: eng, cam, player, world } = d;
  let skipped = false;
  const cap = document.createElement('div');
  cap.style.cssText = "position:absolute;left:50%;bottom:14vh;transform:translateX(-50%);width:min(82vw,920px);text-align:center;font-family:'Alagard';font-size:28px;color:#f0ffe0;text-shadow:0 3px 0 #10200a,0 0 16px #000;z-index:6;pointer-events:none;opacity:0;transition:opacity .35s";
  const skip = document.createElement('div');
  skip.style.cssText = "position:absolute;right:3vw;bottom:4vh;font-family:'Alagard';font-size:16px;color:#fff3d6;opacity:.7;z-index:6;pointer-events:none";
  skip.textContent = 'SPACE to skip';
  eng.overlay.append(cap, skip);
  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'Space' || e.code === 'Escape') skipped = true;
  };
  window.addEventListener('keydown', onKey);
  const wait = async (s: number) => {
    const t0 = performance.now();
    while (!skipped && performance.now() - t0 < s * 1000) await eng.tweens.wait(0.05, true);
  };
  const say = async (text: string, hold: number, color = '#f0ffe0') => {
    if (skipped) return;
    cap.style.color = color;
    cap.textContent = text;
    cap.style.opacity = '1';
    eng.audio.play('divine_whisper', { volume: 0.5 });
    await wait(hold);
    cap.style.opacity = '0';
    await wait(0.3);
  };

  const p = player.pos.clone();
  const fwd = new THREE.Vector3(Math.sin(cam.yaw), 0, Math.cos(cam.yaw));
  const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
  const serketAt = p.clone().addScaledVector(fwd, 16);
  serketAt.y = world.groundAt(serketAt.x, serketAt.z);
  // Serket
  let serket: RigInstance | null = null;
  const spec = modelEntry('serket_avatar')?.() as RigSpec | undefined;
  if (spec?.parts) {
    serket = new RigInstance(buildRigGeo(spec, 'serket:ult'), { ownMaterial: true });
    serket.root.position.copy(serketAt).add(new THREE.Vector3(0, -10, 0));
    serket.root.lookAt(p.x, serketAt.y - 10, p.z);
    serket.material.userData.tint.value.setRGB(0.85, 1.05, 0.9);
    d.scene.add(serket.root);
  }
  player.rig.root.visible = false;
  eng.input.enabled = false;
  eng.letterbox(true, 0.01);
  (window as any).__music?.setMood('intro');
  try {
    // 1. dawn vista
    cam.setCine({ pos: p.clone().addScaledVector(fwd, -14).add(new THREE.Vector3(0, 9, 0)), look: serketAt.clone().add(new THREE.Vector3(0, 4, 0)), fov: 50 });
    await eng.fadeIn(1.2);
    await say("Serket's Reach. Where the sand remembers every bone.", 2.6);
    // 2. the sand spirals into the goddess
    eng.audio.play('quake_rumble', { volume: 0.8 });
    eng.audio.play('sand_rise', { volume: 1 });
    for (let i = 0; i < 16 && !skipped; i++) {
      const a = (i / 16) * Math.PI * 4;
      d.fx.sandBurst({ x: serketAt.x + Math.cos(a) * (4 - i * 0.2), y: serketAt.y, z: serketAt.z + Math.sin(a) * (4 - i * 0.2) }, 1.4);
      await wait(0.06);
    }
    cam.setCine({ pos: serketAt.clone().addScaledVector(fwd, -12).addScaledVector(side, 5).add(new THREE.Vector3(0, 3, 0)), look: serketAt.clone().add(new THREE.Vector3(0, 6, 0)), fov: 55 }, true);
    if (serket) {
      const r = serket;
      await eng.tweens.tween(skipped ? 0.01 : 1.6, (k) => (r.root.position.y = serketAt.y - 10 * (1 - k)), Ease.outBack, true);
    }
    eng.audio.play('spectral_scorpion', { volume: 0.9 });
    await say('SERKET: "Rise, bone-rider. Set\'s storm is eating my desert."', 3, '#c8ff5a');
    await say('"Hunt his outlaws. Take their bounties. Bring me the Hand of Set."', 3, '#c8ff5a');
    // 3. Sundown claws out of the dune
    cam.setCine({ pos: p.clone().addScaledVector(fwd, 4).addScaledVector(side, -2).add(new THREE.Vector3(0, 1.4, 0)), look: p.clone().add(new THREE.Vector3(0, 1.1, 0)), fov: 46 }, true);
    player.rig.root.visible = true;
    const r0 = player.rig.root.position.y;
    eng.audio.play('sand_burst', { volume: 1 });
    d.fx.sandBurst({ x: p.x, y: p.y, z: p.z }, 2);
    await eng.tweens.tween(skipped ? 0.01 : 1.2, (k) => (player.rig.root.position.y = r0 - 1.8 * (1 - k)), Ease.outBack, true);
    player.express('determined', 2);
    await say('SUNDOWN: "…Five more minutes, ma\'am."', 2.2, '#fff3d6');
    eng.audio.play('scorpion_chitter', { volume: 0.8 });
    await say('Pinch: *click click*', 1.4, '#9dff3a');
    // 4. title
    if (serket) {
      const r = serket;
      void eng.tweens.tween(1.2, (k) => (r.root.position.y = serketAt.y - 12 * k), Ease.inQuad, true);
    }
    d.cutIn("SERKET'S REACH", '#c8ff5a', 'smug');
    await wait(1.6);
  } finally {
    window.removeEventListener('keydown', onKey);
    cap.remove();
    skip.remove();
    serket?.root.removeFromParent();
    player.rig.root.visible = true;
    cam.setCine(null);
    eng.letterbox(false, 0.5);
    eng.input.enabled = true;
    if (skipped) eng.fadeIn(0.3);
    (window as any).__music?.setMood('explore');
  }
}
