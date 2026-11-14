// The Sphinx's stone: the game's cel / ink voxel shader plus the two things a
// living statue needs.
//  - SEAMS: every voxel flagged EMISSIVE (and not GLOW) is a crack. It stays a
//    dark fissure until it opens: a crack-site material (SX_SITE) reveals its
//    seams outward from the site's centre as `open` grows (the part's pivot is
//    the site centre, so the part-local position is the distance), and `seam`
//    opens every dormant crack on the body at once (the statue breaking up).
//    Open seams burn with a slow pulse of sunlight; `heat` pushes them white.
//  - GLOW voxels (eyes, the gem, the throat, the uraeus' eyes) scale with `glow`,
//    so the statue can sleep with dark eyes and blaze when enraged.
import * as THREE from 'three';
import { makeVoxelMaterial, type VoxelMaterial } from '../../../engine/render/VoxelMaterial';

export interface StoneU {
  seam: { value: number };
  open: { value: number };
  reach: { value: number };
  heat: { value: number };
  glow: { value: number };
}

export function stoneUniforms(o: Partial<Record<keyof StoneU, number>> = {}): StoneU {
  return { seam: { value: o.seam ?? 0 }, open: { value: o.open ?? 0 }, reach: { value: o.reach ?? 2.5 }, heat: { value: o.heat ?? 0 }, glow: { value: o.glow ?? 1 } };
}

export function sphinxStone(kind: 'body' | 'site', fx: { value: THREE.Vector4 }, u: StoneU): VoxelMaterial {
  const m = makeVoxelMaterial({ roughness: 0.95 });
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    base.call(m, sh, r);
    sh.uniforms.uFx = fx;
    sh.uniforms.uSxSeam = u.seam;
    sh.uniforms.uSxOpen = u.open;
    sh.uniforms.uSxReach = u.reach;
    sh.uniforms.uSxHeat = u.heat;
    sh.uniforms.uSxGlow = u.glow;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSxL;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvSxL = position;');
    sh.fragmentShader = (kind === 'site' ? '#define SX_SITE\n' : '') + sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uSxSeam, uSxOpen, uSxReach, uSxHeat, uSxGlow;\nvarying vec3 vSxL;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float sxSeam = 0.0;
        if (vMatx.x > 0.4 && vMatx.x < 1.0) {
          float sxH = vhash(floor(vSxL * 2.5 + 7.0));
          #ifdef SX_SITE
            float sxK = uSxOpen * uSxReach;
            sxSeam = (1.0 - smoothstep(sxK - 0.55, sxK + 0.05, length(vSxL) + sxH * 0.45)) * step(0.001, uSxOpen);
          #endif
          sxSeam = max(sxSeam, step(sxH, uSxSeam * 1.02));
          diffuseColor.rgb = mix(vec3(0.16, 0.112, 0.078), mix(diffuseColor.rgb, vec3(1.0, 0.97, 0.88), uSxHeat * 0.45), sxSeam);
        }`
      )
      .replace(
        'totalEmissiveRadiance += diffuseColor.rgb * (vMatx.x * uEmissiveStrength * (1.0 + vFx.z));',
        `{
          float sxE = vMatx.x > 1.0 ? (1.0 + vFx.z) * uSxGlow : sxSeam * (1.35 + 0.55 * sin(uTime * 2.6 + vWPos.y * 0.8 + vWPos.x * 0.3)) * (1.0 + uSxHeat * 1.6);
          totalEmissiveRadiance += diffuseColor.rgb * (vMatx.x * uEmissiveStrength * sxE);
        }`
      );
  };
  m.customProgramCacheKey = () => 'sphinx-stone-' + kind + '-v1';
  m.userData.fx = fx;
  return m;
}
