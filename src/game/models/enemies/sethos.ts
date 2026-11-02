// Sethos, Set's champion (STYLE v2 major boss). A Set-animal head (long
// down-curving snout, tall square-topped ears, square sockets under heavy
// brows) on the toon layout.
//  form 1 (1/20): the outlaw god — black hat with the ears poking through,
//    red neckerchief, long-coat shoulders, vest, two revolvers (gun_l/gun_r)
//    and the hero's wanted poster tucked in his belt.
//  form 2 (1/20): the warlord — black fur, gold-and-black armour, spiked
//    pauldrons, gold revolvers.
//  form 3 (1/8): the storm god — crimson fur, gold crown, was-sceptre staff
//    (`weapon`, `scepter_top` socket).
// Capes are engine cloth from `cape_anchor` (meta.cloth.cape).
import type { RigSpec } from '../../../engine/voxel/Rig';
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import { TOON, Ramp } from '../style';
import { toonPelvis, buildHumanoid, defaultExpressions, pantLeg, cowboyBoot, JOINT, mirrorV3 } from '../toon/humanoid';
import type { HumanoidParts } from '../toon/humanoid';
import { roundBox, autoShade, mirrored, hatModel, bandana, gunBelt, revolverDown } from './human';
import { furArms } from './jackal';
import { vest } from './gunslinger';
import { BOSS_EXPR } from './marshal';
import { seg } from './tk';

const SET_EYE: [number, number, number] = [3.5, 47.5, 6];
const SET_BROW: [number, number, number] = [3.5, 49.5, 7.5];

function setHead(F: Ramp, G: Ramp, o: { crown?: boolean } = {}) {
  const head = new VoxelModel('head');
  for (let y = 40; y <= 51; y++) {
    const hx = y >= 51 ? 5 : y >= 49 ? 6 : 7;
    const zb = y >= 50 ? -5 : -6, zf = y >= 50 ? 4 : 6;
    roundBox(head, -hx, y, zb, hx, y, zf, F.base, y >= 49 ? 2 : 1);
  }
  // long snout curving down at the tip
  roundBox(head, -3, 40, 6, 3, 44, 11, F.base, 1);
  roundBox(head, -2, 39, 12, 2, 44, 14, F.base, 1);
  roundBox(head, -2, 37, 15, 2, 41, 16, F.base, 1);
  roundBox(head, -1, 37, 17, 1, 39, 17, TOON.black.base, 0);
  for (let z = 7; z <= 11; z++) head.set(0, 45, z, F.hi);
  head.set(2, 40, 15, TOON.bone.hi).set(-2, 40, 15, TOON.bone.hi); // fangs
  // sockets
  for (const s of [1, -1])
    for (let i = 2; i <= 4; i++)
      for (let y = 46; y <= 48; y++) {
        head.del(s * i, y, 6);
        head.set(s * i, y, 5, TOON.socket.dark);
      }
  // tall ears, flaring into square tops
  for (const s of [1, -1])
    for (let y = 50; y <= 62; y++) {
      const top = y >= 59;
      const x0 = top ? 3 : 4, x1 = top ? 8 : 6;
      for (let x = x0; x <= x1; x++)
        for (let z = -3; z <= -1; z++) head.set(s * x, y, z, z === -1 && !top && x === 5 && y > 51 ? TOON.red.dark : top && y === 62 ? G.base : F.base, top && y === 62 ? VF.METAL : VF.SOLID);
    }
  if (o.crown) {
    for (let x = -7; x <= 7; x++) for (let z = -6; z <= 6; z++) if (head.has(x, 51, z) && (Math.abs(x) >= 5 || Math.abs(z) >= 4)) head.set(x, 51, z, G.base, VF.METAL);
    for (const x of [-4, 0, 4]) roundBox(head, x, 52, -1, x, 54 + (x === 0 ? 2 : 0), 0, G.base, 0, VF.METAL);
    head.set(0, 52, 6, TOON.red.base);
  }
  autoShade(head, [F]);
  const jaw = new VoxelModel('jaw');
  roundBox(jaw, -3, 37, 4, 3, 39, 11, F.shade, 1);
  roundBox(jaw, -2, 36, 12, 2, 37, 14, F.shade, 1);
  jaw.set(2, 38, 13, TOON.bone.base).set(-2, 38, 13, TOON.bone.base);
  const eye_l = new VoxelModel('eye_l');
  for (let i = 2; i <= 4; i++) for (let y = 46; y <= 48; y++) eye_l.set(i, y, 5, TOON.socket.dark);
  const brow_l = new VoxelModel('brow_l');
  for (let i = 1; i <= 5; i++) brow_l.set(i, 49, 7, TOON.black.base).set(i, 50, 7, i >= 2 && i <= 4 ? TOON.black.base : F.base);
  return { head, jaw, eye_l, eye_r: mirrored(eye_l, 'eye_r'), brow_l, brow_r: mirrored(brow_l, 'brow_r') };
}

export function sethosRig(form: 1 | 2 | 3 = 1): RigSpec {
  const F = form === 1 ? TOON.setRed : form === 2 ? TOON.black : { base: 0x9a1e1a, shade: 0x741612, hi: 0xc0342a, dark: 0x420a08 };
  const G = TOON.gold;
  const giant = form === 3;
  const hd = setHead(F, G, { crown: giant });
  const { arm, fore } = furArms(F, G);
  // ---------------------------------------------------------------- torso
  const T = new VoxelModel('torso');
  roundBox(T, -6, 24, -4, 6, 34, 4, F.base, 2);
  roundBox(T, -2, 35, -3, 2, 38, 1, F.shade, 1);
  if (form === 1) {
    bandana(T, TOON.red);
    vest(T, TOON.black, G);
    roundBox(T, -7, 26, -6, 7, 35, -6, TOON.black.base, 1);
    for (const s of [1, -1]) roundBox(T, s > 0 ? 6 : -9, 31, -5, s > 0 ? 9 : -6, 35, 2, TOON.black.base, 2);
  } else if (form === 2) {
    roundBox(T, -6, 25, 5, 6, 33, 5, G.base, 1, VF.METAL); // chest plate
    for (let y = 26; y <= 32; y += 2) for (let x = -5; x <= 5; x++) T.set(x, y, 6, TOON.black.shade);
    T.set(0, 29, 6, TOON.red.base);
    for (const s of [1, -1]) {
      roundBox(arm, s > 0 ? 6 : -10, 31, -3, s > 0 ? 10 : -6, 35, 3, TOON.black.base, 2);
      for (const z of [-2, 0, 2]) seg(arm, [s * 8, 35, z], [s * 10, 39, z - 1], 0.9, G.base, VF.METAL, 0.4);
    }
  } else {
    for (let y = 29; y <= 35; y++)
      for (let x = -9; x <= 9; x++) {
        const r = 35 - y;
        if (Math.abs(x) > 3 + r * 1.2) continue;
        T.set(x, y, 5, r % 2 ? TOON.lapis.base : G.base, r % 2 ? VF.SOLID : VF.METAL);
      }
  }
  autoShade(T, [F, TOON.black]);
  // ---------------------------------------------------------------- pelvis
  const PV = toonPelvis({ ramp: F });
  if (giant) {
    roundBox(PV, -7, 12, -5, 7, 23, 4, TOON.black.base, 2); // storm robe skirt
    for (let x = -7; x <= 7; x++) for (let z = -5; z <= 4; z++) if (PV.has(x, 23, z)) PV.set(x, 23, z, G.base, VF.METAL);
    for (let y = 12; y <= 22; y++) for (let x = -2; x <= 2; x++) PV.set(x, y, 5, (y >> 1) % 2 ? TOON.setRed.base : G.base);
  } else {
    roundBox(PV, -6, 17, -4, 6, 23, 3, TOON.black.base, 1); // trousers top
    gunBelt(PV, TOON.leather, G, { loops: true, holster: true });
    // wanted poster of the hero tucked in the belt (with a tiny skull + hat doodle)
    roundBox(PV, 3, 17, 4, 6, 21, 4, TOON.linen.base, 0);
    PV.set(4, 19, 5, TOON.black.base).set(5, 19, 5, TOON.black.base).set(4, 20, 5, TOON.hat.base).set(5, 20, 5, TOON.hat.base).set(4, 18, 5, TOON.red.base);
    // skull charms
    for (const x of [-5, -3]) PV.set(x, 20, 5, TOON.bone.base);
  }
  autoShade(PV, [TOON.black]);
  // ---------------------------------------------------------------- legs
  const thigh = pantLeg('thigh', giant ? F : TOON.black);
  const shin = pantLeg('shin', giant ? F : TOON.black);
  if (giant) {
    roundBox(shin, 2, 0, -2, 5, 2, 4, F.shade, 1);
    for (let x = 2; x <= 5; x++) for (let z = -2; z <= 1; z++) if (shin.has(x, 6, z)) shin.set(x, 6, z, G.base, VF.METAL);
  } else cowboyBoot(shin, { ramp: TOON.black, spur: TOON.gold });
  const P: HumanoidParts = {
    pelvis: PV,
    torso: T,
    head: hd.head,
    jaw: hd.jaw,
    eye_l: hd.eye_l,
    eye_r: hd.eye_r,
    brow_l: hd.brow_l,
    brow_r: hd.brow_r,
    arm_l: arm,
    fore_l: fore,
    arm_r: mirrored(arm, 'arm_r'),
    fore_r: mirrored(fore, 'fore_r'),
    thigh_l: thigh,
    shin_l: shin,
    thigh_r: mirrored(thigh, 'thigh_r'),
    shin_r: mirrored(shin, 'shin_r'),
  };
  if (form === 1) {
    const hat = hatModel('wide', TOON.black, TOON.setRed, { y0: 51 });
    // the ears poke through the hat
    for (const s of [1, -1]) for (let y = 51; y <= 58; y++) for (let x = 3; x <= 8; x++) for (let z = -3; z <= -1; z++) hat.del(s * x, y, z);
    P.hat = hat;
  }
  const extra: { name: string; model: VoxelModel; parent: string; joint: [number, number, number] }[] = [];
  const sockets: Record<string, { part: string; at: [number, number, number] }> = {
    cape_anchor: { part: 'torso', at: [0.5, 34, -6] },
    head_top: { part: 'head', at: [0.5, 63, -2] },
  };
  const hr = mirrorV3(JOINT.hand);
  if (giant) {
    // was-sceptre: tall staff, Set-animal head on top, forked foot
    const hx = Math.round(hr[0] - 0.5), hz = Math.round(hr[2] - 0.5);
    const st = new VoxelModel('weapon');
    for (let y = -14; y <= 40; y++) for (let x = hx - 1; x <= hx; x++) st.set(x, y, hz, G.base, VF.METAL);
    roundBox(st, hx - 1, 40, hz - 1, hx, 43, hz + 3, G.base, 0, VF.METAL); // head of the sceptre
    st.set(hx - 1, 44, hz - 1, G.hi, VF.METAL).set(hx, 44, hz - 1, G.hi, VF.METAL);
    for (const dz of [-1, 1]) for (let y = -17; y <= -14; y++) st.set(hx - 1, y, hz + dz, G.shade, VF.METAL);
    extra.push({ name: 'weapon', model: st, parent: 'fore_r', joint: hr });
    sockets.scepter_top = { part: 'weapon', at: [hx + 0.5, 44.5, hz + 1.5] };
  } else {
    const gunR = new VoxelModel('gun_r');
    revolverDown(gunR, form === 2 ? G : TOON.iron, TOON.bone, { long: true });
    extra.push({ name: 'gun_r', model: gunR, parent: 'fore_r', joint: hr }, { name: 'gun_l', model: mirrored(gunR, 'gun_l'), parent: 'fore_l', joint: JOINT.hand });
  }
  const capeCols = form === 1 ? [0xa8261a, 0x5a0e0a, 0x2a2e3a] : form === 2 ? [0x3a3e48, 0x1a1c22, 0xa8261a] : [0x5a0e0a, 0x1a0606, G.base];
  const VS = giant ? 1 / 8 : 1 / 20;
  return buildHumanoid({
    name: `sethos_${form}`,
    parts: P,
    voxelSize: VS,
    joints: { eye: SET_EYE, brow: SET_BROW },
    extra,
    sockets,
    topY: 63,
    radius: 0.34 * (giant ? 3.75 : 1.5),
    expressions: defaultExpressions(BOSS_EXPR),
    meta: { kind: 'sethos', form, boss: true, headY: 46 * VS, defaultExpression: 'smug', cloth: { cape: capeCols } },
  });
}
