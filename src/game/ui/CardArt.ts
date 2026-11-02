// Canvas painters for physical cards / posters (upgrade cards, wanted posters,
// shop tags). Aged parchment, rarity frames, big pixel icons, western type.
import * as THREE from 'three';
import { atlas } from '../fx/PixelArt';
import { RARITY, Offer } from '../run/Upgrades';
import { fmtStat, DERIVED_INFO, CORE_INFO, StatId } from '../combat/Stats';
import { RNG } from '../../engine/math/rand';

export function parchment(c: CanvasRenderingContext2D, w: number, h: number, seed = 1, base = '#e6cf9f', dark = '#b98f55') {
  const r = new RNG(seed);
  c.fillStyle = base;
  c.fillRect(0, 0, w, h);
  // blotches
  for (let i = 0; i < 90; i++) {
    c.fillStyle = `rgba(150,105,55,${r.range(0.03, 0.09)})`;
    const s = r.range(6, 40);
    c.fillRect(Math.floor(r.range(0, w)), Math.floor(r.range(0, h)), s, s * r.range(0.4, 1));
  }
  // fibers / speckles (pixel)
  for (let i = 0; i < 900; i++) {
    c.fillStyle = r.chance(0.5) ? 'rgba(90,60,30,0.18)' : 'rgba(255,245,215,0.25)';
    c.fillRect(Math.floor(r.range(0, w)), Math.floor(r.range(0, h)), 2, 2);
  }
  // burnt edges
  const g = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, dark + 'cc');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
}

export function drawSprite(c: CanvasRenderingContext2D, name: string, x: number, y: number, scale: number) {
  const f = atlas().get(name);
  const img = atlas().canvas;
  c.imageSmoothingEnabled = false;
  const sx = Math.round(f.u0 * img.width - 0.5), sy = Math.round((1 - f.v1) * img.height - 0.5);
  c.drawImage(img, sx, sy, f.w, f.h, Math.round(x - (f.w * scale) / 2), Math.round(y - (f.h * scale) / 2), f.w * scale, f.h * scale);
}

export function wrapText(c: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number, align: CanvasTextAlign = 'center') {
  const words = text.split(' ');
  let line = '';
  let yy = y;
  c.textAlign = align;
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (c.measureText(test).width > maxW && line) {
      c.fillText(line, x, yy);
      line = w;
      yy += lh;
    } else line = test;
  }
  if (line) c.fillText(line, x, yy);
  return yy + lh;
}

const CAT_LABEL: Record<string, string> = { gun: 'IRON', insect: 'BROOD', passive: 'GRIT', gear: 'GEAR', relic: 'RELIC', evolution: 'EVOLUTION' };

export function paintCardFront(o: Offer, w = 384, h = 576) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d')!;
  const rar = RARITY[o.def.rarity];
  parchment(c, w, h, o.def.id.length * 31 + o.toLv);
  // frame
  c.fillStyle = '#3a2414';
  c.fillRect(0, 0, w, 14);
  c.fillRect(0, h - 14, w, 14);
  c.fillRect(0, 0, 14, h);
  c.fillRect(w - 14, 0, 14, h);
  c.fillStyle = rar.color;
  c.fillRect(6, 6, w - 12, 6);
  c.fillRect(6, h - 12, w - 12, 6);
  c.fillRect(6, 6, 6, h - 12);
  c.fillRect(w - 12, 6, 6, h - 12);
  // corner studs
  for (const [x, y] of [[18, 18], [w - 30, 18], [18, h - 30], [w - 30, h - 30]]) {
    c.fillStyle = '#2a1810';
    c.fillRect(x, y, 12, 12);
    c.fillStyle = rar.color;
    c.fillRect(x + 3, y + 3, 6, 6);
  }
  // header
  c.fillStyle = '#3a2414';
  c.font = "24px 'Alagard'";
  c.textAlign = 'center';
  c.fillText(`${CAT_LABEL[o.def.cat] ?? ''} · ${rar.name.toUpperCase()}`, w / 2, 52);
  // icon plate
  c.fillStyle = 'rgba(58,36,20,0.18)';
  c.fillRect(w / 2 - 96, 70, 192, 172);
  c.strokeStyle = '#3a2414';
  c.lineWidth = 4;
  c.strokeRect(w / 2 - 96, 70, 192, 172);
  const f = atlas().get(o.def.icon);
  const scale = Math.max(4, Math.floor(130 / Math.max(f.w, f.h)));
  drawSprite(c, o.def.icon, w / 2, 156, scale);
  // title
  c.fillStyle = '#2a1810';
  c.font = "32px 'Alagard'";
  wrapText(c, o.def.name.toUpperCase(), w / 2, 292, w - 50, 36);
  // level pips
  const pipW = 22;
  const total = o.def.maxLv;
  const x0 = w / 2 - (total * pipW) / 2;
  for (let i = 0; i < total; i++) {
    const filled = i < o.toLv;
    const isNew = i === o.toLv - 1;
    c.fillStyle = '#2a1810';
    c.fillRect(x0 + i * pipW + 3, 352, 16, 16);
    c.fillStyle = filled ? (isNew ? rar.color : '#8a6a3a') : '#d8c49a';
    c.fillRect(x0 + i * pipW + 6, 355, 10, 10);
  }
  // description
  c.fillStyle = '#3a2414';
  c.font = "24px 'Alagard'";
  wrapText(c, o.def.desc(o.toLv), w / 2, 402, w - 64, 27);
  // footer
  c.font = "20px 'Alagard'";
  c.fillStyle = '#6b4a2c';
  c.fillText(o.fromLv === 0 ? (o.def.cat === 'evolution' ? '✦ EVOLUTION ✦' : 'NEW') : `LV ${o.fromLv} → ${o.toLv}`, w / 2, h - 34);
  if (o.def.god) {
    c.font = "18px 'Alagard'";
    c.fillText(`Gift of ${o.def.god}`, w / 2, h - 58);
  }
  return cv;
}

export function paintCardBack(o: Offer, rows: { stat: StatId; before: number; after: number }[], w = 384, h = 576) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d')!;
  parchment(c, w, h, 99, '#5a3a22', '#1a0f08');
  const rar = RARITY[o.def.rarity];
  c.fillStyle = rar.color;
  c.fillRect(8, 8, w - 16, 5);
  c.fillRect(8, h - 13, w - 16, 5);
  c.fillStyle = '#f1e2c2';
  c.font = "32px 'Alagard'";
  c.textAlign = 'center';
  c.fillText('LEDGER', w / 2, 52);
  drawSprite(c, 'scorp_x2', w / 2, 100, 5);
  c.font = "20px 'Alagard'";
  let y = 160;
  if (rows.length) {
    for (const r of rows) {
      const name = (DERIVED_INFO as any)[r.stat]?.name ?? (CORE_INFO as any)[r.stat]?.name ?? r.stat;
      c.fillStyle = '#e6cf9f';
      c.textAlign = 'left';
      c.fillText(name, 30, y);
      c.textAlign = 'right';
      c.fillStyle = '#c8ff5a';
      c.fillText(`${fmtStat(r.stat, r.before)} → ${fmtStat(r.stat, r.after)}`, w - 30, y);
      y += 30;
    }
  } else {
    c.fillStyle = '#e6cf9f';
    c.fillText('Special effect — see front.', w / 2, y);
    y += 30;
  }
  if (o.def.evolveFrom) {
    c.fillStyle = '#ffd36b';
    c.textAlign = 'center';
    c.fillText(`Born of: ${o.def.evolveFrom.join(' + ')}`, w / 2, y + 10);
    y += 40;
  }
  if (o.def.lore) {
    c.fillStyle = '#c9a97c';
    c.font = "19px 'Alagard'";
    wrapText(c, `“${o.def.lore}”`, w / 2, y + 20, w - 60, 24);
  }
  c.fillStyle = '#8a6a4a';
  c.font = "17px 'Alagard'";
  c.textAlign = 'center';
  c.fillText('drag to turn · click to claim', w / 2, h - 30);
  return cv;
}

export function canvasTex(cv: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
