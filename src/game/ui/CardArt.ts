// Typography for the 3D upgrade cards — the only thing drawn in 2D. Alagard
// text on transparent canvases, each sized to one sculpted plaque of the card
// frame (props/tarot.ts skillFrame) and laid onto it in 3D (SkillCards.ts).
import * as THREE from 'three';
import { RARITY, Offer } from '../run/Upgrades';
import { fmtStat, DERIVED_INFO, CORE_INFO, StatId } from '../combat/Stats';
import { SKILL_CARD } from '../models/props/tarot';

/** canvas pixels per card voxel (1 cm) */
export const TEXT_PPV = 10;
const INK = '#2a170c';
const INK_SOFT = '#6a4626';
const GAIN = '#2c6410';

type Rect = { x0: number; y0: number; x1: number; y1: number };

function surface(r: Rect) {
  const cv = document.createElement('canvas');
  cv.width = (r.x1 - r.x0 + 1) * TEXT_PPV;
  cv.height = (r.y1 - r.y0 + 1) * TEXT_PPV;
  const c = cv.getContext('2d')!;
  c.textBaseline = 'alphabetic';
  return { cv, c };
}

const font = (px: number) => `${Math.round(px)}px Alagard`;

/** cap height as a fraction of the font size (Alagard) */
function capOf(c: CanvasRenderingContext2D) {
  c.font = font(100);
  const m = c.measureText('HMX');
  return (m.actualBoundingBoxAscent || 70) / 100;
}

function wrap(c: CanvasRenderingContext2D, text: string, maxW: number) {
  const out: string[] = [];
  let line = '';
  for (const w of text.split(/\s+/)) {
    const t = line ? line + ' ' + w : w;
    if (line && c.measureText(t).width > maxW) {
      out.push(line);
      line = w;
    } else line = t;
  }
  if (line) out.push(line);
  return out;
}

/** engraved ink: a pale lip under the stroke, then the ink */
function engrave(c: CanvasRenderingContext2D, text: string, x: number, y: number, color = INK, lip = 0.5) {
  c.fillStyle = `rgba(255,246,222,${lip})`;
  c.fillText(text, x, y + Math.max(1, TEXT_PPV * 0.12));
  c.fillStyle = color;
  c.fillText(text, x, y);
}

/** one centred line fitted into the canvas (cap height = capFrac of the height) */
function line(cv: HTMLCanvasElement, c: CanvasRenderingContext2D, text: string, capFrac: number, color = INK) {
  const cap = capOf(c);
  let px = (cv.height * capFrac) / cap;
  c.font = font(px);
  const w = c.measureText(text).width;
  if (w > cv.width * 0.94) {
    px *= (cv.width * 0.94) / w;
    c.font = font(px);
  }
  c.textAlign = 'center';
  engrave(c, text, cv.width / 2, cv.height / 2 + (px * cap) / 2, color);
}

const CAT_LABEL: Record<string, string> = { gun: 'IRON', insect: 'BROOD', passive: 'GRIT', gear: 'GEAR', relic: 'RELIC', evolution: 'EVOLUTION' };

export interface FrontText {
  crest: HTMLCanvasElement;
  name: HTMLCanvasElement;
  desc: HTMLCanvasElement;
}

/** front plaques: category · rarity on the crest, the name, the description with its level line */
export function paintCardFront(o: Offer): FrontText {
  const C = SKILL_CARD;
  const rar = RARITY[o.def.rarity];
  const crest = surface(C.crest);
  line(crest.cv, crest.c, `${CAT_LABEL[o.def.cat] ?? ''} · ${rar.name.toUpperCase()}`, 0.5, INK_SOFT);
  const name = surface(C.name);
  line(name.cv, name.c, o.def.name.toUpperCase(), 0.56);
  // description: the largest size whose wrapped lines fit above the footer
  const d = surface(C.desc);
  const c = d.c, W = d.cv.width, H = d.cv.height;
  const cap = capOf(c);
  const foot = o.fromLv === 0 ? (o.def.cat === 'evolution' ? 'EVOLUTION' : 'NEW') : `LV ${o.fromLv} → ${o.toLv}`;
  const gift = o.def.god ? `Gift of ${o.def.god}` : '';
  const footPx = H * 0.13;
  const bodyH = H - footPx * 2.3 - H * 0.08;
  let px = H * 0.2;
  let lines: string[] = [];
  for (; px > 14; px *= 0.94) {
    c.font = font(px);
    lines = wrap(c, o.def.desc(o.toLv), W * 0.9);
    if (lines.length * px * 1.12 <= bodyH) break;
  }
  c.font = font(px);
  c.textAlign = 'center';
  const lh = px * 1.12;
  const y0 = H * 0.06 + (bodyH - lines.length * lh) / 2 + px * cap;
  lines.forEach((l, i) => engrave(c, l, W / 2, y0 + i * lh));
  c.font = font(footPx);
  engrave(c, gift ? `${foot}  ·  ${gift}` : foot, W / 2, H - footPx * 0.7, INK_SOFT, 0.35);
  return { crest: crest.cv, name: name.cv, desc: d.cv };
}

/** back plaques: LEDGER, then the stat rows (before → after), lineage and lore */
export function paintCardBack(o: Offer, rows: { stat: StatId; before: number; after: number }[]) {
  const B = SKILL_CARD.back;
  const plaque = surface(B.plaque);
  line(plaque.cv, plaque.c, 'LEDGER', 0.58);
  const p = surface(B.panel);
  const c = p.c, W = p.cv.width, H = p.cv.height;
  const px = H * 0.052;
  const cap = capOf(c);
  let y = H * 0.07 + px * cap;
  c.font = font(px);
  if (rows.length) {
    for (const r of rows) {
      const nm = (DERIVED_INFO as any)[r.stat]?.name ?? (CORE_INFO as any)[r.stat]?.name ?? r.stat;
      c.textAlign = 'left';
      engrave(c, nm, W * 0.06, y);
      c.textAlign = 'right';
      engrave(c, `${fmtStat(r.stat, r.before)} → ${fmtStat(r.stat, r.after)}`, W * 0.94, y + px * 1.15, GAIN);
      y += px * 2.6;
    }
  } else {
    c.textAlign = 'center';
    engrave(c, 'A special effect —', W / 2, y);
    engrave(c, 'see the front.', W / 2, y + px * 1.2);
    y += px * 2.8;
  }
  if (o.def.evolveFrom) {
    c.textAlign = 'center';
    c.font = font(px * 0.9);
    engrave(c, `Born of: ${o.def.evolveFrom.join(' + ')}`, W / 2, y + px * 0.4, INK_SOFT);
    y += px * 1.8;
  }
  if (o.def.lore) {
    c.font = font(px * 0.9);
    c.textAlign = 'center';
    const ls = wrap(c, `“${o.def.lore}”`, W * 0.86);
    ls.forEach((l, i) => engrave(c, l, W / 2, y + px * 0.8 + i * px * 1.1, INK_SOFT));
  }
  c.font = font(px * 0.8);
  c.textAlign = 'center';
  engrave(c, 'drag to turn · click to claim', W / 2, H - px * 0.9, INK_SOFT, 0.3);
  return { plaque: plaque.cv, panel: p.cv };
}

export function canvasTex(cv: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
