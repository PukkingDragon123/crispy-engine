// Dev-only model viewer: viewer.html?model=name[,name2...]&yaw=30&pitch=15&zoom=1&pose=run
// Renders voxel rigs/models with the in-game lighting & post stack. Sets window.__ready.
import * as THREE from 'three';
import { CHARACTER_MODELS } from '../game/models/registryCharacters';
import { PROP_MODELS } from '../game/models/registryProps';
import { ENEMY_MODELS } from '../game/models/registryEnemies';
import { VARIANT_MODELS } from '../game/models/registryVariants';
import { buildRigGeo, RigInstance, RigSpec, voxelMesh } from '../engine/voxel/Rig';
import { PostStack } from '../engine/render/Post';
import { globalUniforms } from '../engine/render/VoxelMaterial';

const params = new URLSearchParams(location.search);
const names = (params.get('model') ?? '').split(',').filter(Boolean);
const yaw = (+(params.get('yaw') ?? 35) * Math.PI) / 180;
const pitch = (+(params.get('pitch') ?? 14) * Math.PI) / 180;
const zoom = +(params.get('zoom') ?? 1);
const lbl = document.getElementById('lbl')!;

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fc4e8);
scene.fog = new THREE.Fog(0xe9cfa3, 30, 120);
const cam = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.05, 500);
const hemi = new THREE.HemisphereLight(0xbfd9ff, 0xc9945a, 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d6, 3.2);
sun.position.set(-6, 10, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -8;
sun.shadow.camera.right = 8;
sun.shadow.camera.top = 8;
sun.shadow.camera.bottom = -8;
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
(sun.shadow as any).radius = 3;
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0xe0b373, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// match in-game lighting: desert sky environment for PBR reflections + rim light (material global)
{
  const envScene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 32, 16);
  const col: number[] = [];
  const pos = geo.getAttribute('position');
  const z = new THREE.Color(0x3f86d6), h = new THREE.Color(0xf3d6a4), g = new THREE.Color(0xd9ad74), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 10;
    if (y > 0) c.copy(h).lerp(z, Math.pow(y, 0.6));
    else c.copy(h).lerp(g, Math.min(1, -y * 3));
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  envScene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.6;
  hemi.intensity = 0.8;
}
const post = new PostStack(renderer, scene, cam, innerWidth, innerHeight);
post.setSize(innerWidth, innerHeight, 1);

const root = new THREE.Group();
scene.add(root);
let x = 0;
const box = new THREE.Box3();
const all = { ...CHARACTER_MODELS, ...ENEMY_MODELS, ...VARIANT_MODELS, ...PROP_MODELS };
if (params.get('list')) { lbl.textContent = Object.keys(all).join(' '); }
const labels: string[] = [];
for (const n of names) {
  const entry = all[n];
  if (!entry) {
    labels.push(`?${n}`);
    continue;
  }
  const t0 = performance.now();
  const r = entry();
  let obj: THREE.Object3D;
  let info = '';
  if ((r as RigSpec).parts) {
    const spec = r as RigSpec;
    const rig = new RigInstance(buildRigGeo(spec, spec.name + ':viewer:' + Math.random()));
    obj = rig.root;
    const vox = spec.parts.reduce((a, p) => a + p.model.count, 0);
    const tris = Object.values(rig.meshes).reduce((a, m) => a + (m.geometry.index!.count / 3), 0);
    info = `${spec.parts.length} parts, ${vox} vox, ${tris | 0} tris`;
    (window as any).__rig = rig;
  } else {
    const m = r as { model: any; voxelSize: number };
    const mesh = voxelMesh(m.model, m.voxelSize, 'bottom');
    obj = mesh;
    info = `${m.model.count} vox, ${(mesh.geometry.index!.count / 3) | 0} tris`;
  }
  const b = new THREE.Box3().setFromObject(obj);
  const w = b.max.x - b.min.x;
  obj.position.x = x + w / 2 - (b.max.x + b.min.x) / 2;
  x += w + 0.4;
  root.add(obj);
  labels.push(`${n}: ${info} (${(performance.now() - t0).toFixed(0)}ms)`);
}
root.position.x = -x / 2;
box.setFromObject(root);
const size = box.getSize(new THREE.Vector3());
const center = box.getCenter(new THREE.Vector3());
// optional close-up: fy = focus height (m), fd = camera distance (m)
if (params.get('fy')) center.y = +params.get('fy')!;
if (params.get('fz')) center.z = +params.get('fz')!;
if (params.get('fx')) center.x = +params.get('fx')!;
const dist = params.get('fd') ? +params.get('fd')! : (Math.max(size.x, size.y * 1.4, size.z) * 1.6 + 0.6) / zoom;
cam.position.set(center.x + Math.sin(yaw) * Math.cos(pitch) * dist, center.y + Math.sin(pitch) * dist, center.z + Math.cos(yaw) * Math.cos(pitch) * dist);
cam.lookAt(center);
lbl.textContent = labels.join(' | ');
const ext = Math.max(size.x, size.z, size.y) * 0.8 + 2;
sun.shadow.camera.left = -ext;
sun.shadow.camera.right = ext;
sun.shadow.camera.top = ext;
sun.shadow.camera.bottom = -ext;
sun.shadow.camera.updateProjectionMatrix();
sun.target.position.copy(center);
sun.position.copy(center).add(new THREE.Vector3(-6, 10, 7));
scene.add(sun.target);

let frames = 0;
function tick(t: number) {
  globalUniforms.uTime.value = t / 1000;
  post.u.uTime.value = t / 1000;
  post.render(1 / 60);
  frames++;
  if (frames === 3) (window as any).__ready = true;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
