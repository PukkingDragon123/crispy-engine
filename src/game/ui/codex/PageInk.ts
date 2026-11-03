// The Codex's ink: every page's typography set in Alagard on a transparent canvas
// (the paper, the plates and the stamps are the page shader). Running heads, plate
// numbers, drop capitals, red rubrics, dot leaders, typed tally marks and folios,
// like a field book filled in by hand over many years.
import { Codex, CodexEntry, CodexSection, F_CLAIM, F_MASTER, F_READ, F_SEEN, MASTER_KILLS } from '../../meta/Codex';
import { TECHNIQUES, isUnlocked } from '../../player/Techniques';
import { INK_W, INK_H } from './PageSheet';

export type PageSpec =
  | { kind: 'frontis' }
  | { kind: 'contents' }
  | { kind: 'title'; s: number }
  | { kind: 'index'; s: number; from: number; to: number }
  | { kind: 'plate'; key: string }
  | { kind: 'entry'; key: string }
  | { kind: 'moves' }
  | { kind: 'cards' }
  | { kind: 'end' };

export interface Link {
  r: [number, number, number, number];
  to: string;
}
export interface Painted {
  canvas: HTMLCanvasElement;
  links: Link[];
  stamp: string | null;
}

/** index rows under a chapter title, and on a full index page */
export const TITLE_ROWS = 13;
export const INDEX_ROWS = 26;
/** where the plate sits on a plate page (canvas uv) */
export const PLATE_RECT: [number, number, number, number] = [0.09, 0.115, 0.91, 0.64];

const INK = '#2a1a10';
const SEPIA = '#5a3a20';
const RED = '#8e2616';
const FADE = 'rgba(42,26,16,0.42)';
const M = 62; // page margin (px)

const ROMAN = (n: number) => {
  const t: [number, string][] = [[50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let s = '';
  for (const [v, r] of t) while (n >= v) (s += r), (n -= v);
  return s;
};

/** the tarot bar's abilities (kept from the old Book of Skills panel) */
const CARDS: [string, string, string][] = [
  ['E', 'I · The Magician', "Scorpion toss: Serket's brood rides your bullets in."],
  ['C', 'XVI · The Tower', 'Scarab swarm: they eat what you whistle at.'],
  ['G', 'XIX · The Sun', "Dung bomb: Khepri's gift, bouncing and rank."],
  ['Z', 'XIII · Death', 'The pale ride: when the deck runs out, so do they.'],
];

function wrap(c: CanvasRenderingContext2D, text: string, maxW: number, firstIndent = 0) {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    let lim = maxW - (out.length === 0 ? firstIndent : 0);
    for (const w of para.split(' ')) {
      const t = line ? line + ' ' + w : w;
      if (c.measureText(t).width > lim && line) {
        out.push(line);
        line = w;
        lim = maxW - (out.length < 2 ? firstIndent : 0);
      } else line = t;
    }
    out.push(line);
  }
  return out;
}

class Pen {
  c: CanvasRenderingContext2D;
  y = M;
  links: Link[] = [];
  constructor(public cv: HTMLCanvasElement) {
    cv.width = INK_W;
    cv.height = INK_H;
    this.c = cv.getContext('2d')!;
    this.c.clearRect(0, 0, INK_W, INK_H);
    this.c.imageSmoothingEnabled = false;
    this.c.textBaseline = 'top';
  }
  font(px: number) {
    this.c.font = `${px}px Alagard`;
  }
  text(s: string, px: number, color = INK, align: CanvasTextAlign = 'center', x?: number, adv = 1.28) {
    const c = this.c;
    this.font(px);
    c.fillStyle = color;
    c.textAlign = align;
    c.fillText(s, x ?? (align === 'center' ? INK_W / 2 : align === 'left' ? M : INK_W - M), this.y);
    this.y += Math.round(px * adv);
  }
  /** the biggest size (≤ px) that fits the line */
  fit(s: string, px: number, maxW = INK_W - M * 2) {
    this.font(px);
    while (px > 14 && this.c.measureText(s).width > maxW) this.font(--px);
    return px;
  }
  para(s: string, px: number, color = INK, dropCap = false) {
    const c = this.c;
    this.font(px);
    const lh = Math.round(px * 1.3);
    let indent = 0;
    if (dropCap && s.length > 1) {
      const cap = s[0];
      c.font = `${px * 2.6}px Alagard`;
      c.fillStyle = RED;
      c.textAlign = 'left';
      c.fillText(cap, M, this.y - 2);
      indent = c.measureText(cap).width + 8;
      s = s.slice(1);
      this.font(px);
    }
    const lines = wrap(c, s, INK_W - M * 2, indent);
    c.fillStyle = color;
    c.textAlign = 'left';
    lines.forEach((l, i) => c.fillText(l, M + (i < 2 ? indent : 0), this.y + i * lh));
    this.y += lines.length * lh + Math.round(px * 0.4);
  }
  /** a typed rule */
  rule(s = '~  *  ~', color = SEPIA, px = 20) {
    this.y += 4;
    this.text(s, px, color);
    this.y += 4;
  }
  /** label ......... value */
  leader(k: string, v: string, px = 22, faded = false) {
    const c = this.c;
    this.font(px);
    const x0 = M, x1 = INK_W - M;
    c.textAlign = 'left';
    c.fillStyle = faded ? FADE : SEPIA;
    c.fillText(k, x0, this.y);
    const kw = c.measureText(k).width;
    c.textAlign = 'right';
    c.fillStyle = faded ? FADE : INK;
    c.fillText(v, x1, this.y);
    const vw = c.measureText(v).width;
    c.textAlign = 'left';
    c.fillStyle = 'rgba(42,26,16,0.4)';
    const dot = c.measureText('. ').width;
    const n = Math.floor((x1 - vw - 12 - (x0 + kw + 12)) / dot);
    if (n > 0) c.fillText('. '.repeat(n), x0 + kw + 12, this.y);
    this.y += Math.round(px * 1.32);
  }
  link(y0: number, y1: number, to: string) {
    this.links.push({ r: [M / INK_W, y0 / INK_H, 1 - M / INK_W, y1 / INK_H], to });
  }
  folio(n: number, left: boolean) {
    const c = this.c;
    this.font(20);
    c.fillStyle = SEPIA;
    c.textAlign = left ? 'left' : 'right';
    c.fillText(`- ${n} -`, left ? M : INK_W - M, INK_H - M + 6);
  }
  head(s: string, left: boolean) {
    const c = this.c;
    this.font(18);
    c.fillStyle = FADE;
    c.textAlign = left ? 'left' : 'right';
    c.fillText(s.toUpperCase(), left ? M : INK_W - M, M - 30);
  }
}

function tally(n: number) {
  if (n <= 0) return '';
  const groups = Math.floor(Math.min(n, 60) / 5), rest = Math.min(n, 60) % 5;
  return ('||||/ '.repeat(groups) + '|'.repeat(rest)).trim() + (n > 60 ? ' ...' : '');
}

export function paintPage(spec: PageSpec, folio: number, left: boolean, cv = document.createElement('canvas')): Painted {
  const p = new Pen(cv);
  const secs = Codex.sections();
  let stamp: string | null = null;
  switch (spec.kind) {
    case 'frontis': {
      const pts = Codex.points(), rk = Codex.rank(pts);
      p.y = 92;
      p.text('THE', 30, SEPIA);
      p.text('CODEX', 96, INK, 'center', undefined, 1.05);
      p.text("of Serket's Reach", 30, SEPIA);
      p.y += 10;
      p.para('Being a true account of the beasts and bandits, the treasures and the haunts of the Reach, set down by the hand of Sundown, who keeps coming back.', 22, SEPIA);
      p.rule();
      p.y += 16;
      p.text('DISCOVERY POINTS', 22, SEPIA);
      p.text(String(pts), 82, INK, 'center', undefined, 1.1);
      p.y += 10;
      p.text('RANK', 20, SEPIA);
      p.text(rk.title.toUpperCase(), p.fit(rk.title.toUpperCase(), 52), RED, 'center', undefined, 1.25);
      if (rk.next) {
        const prev = Math.round(Codex.maxPoints() * [0, 0.03, 0.08, 0.15, 0.24, 0.35, 0.48, 0.62, 0.77, 0.9][rk.index]);
        const f = Math.max(0, Math.min(1, (pts - prev) / Math.max(1, rk.next.at - prev)));
        const N = 30, on = Math.round(f * N);
        p.y += 6;
        p.font(26);
        const c = p.c;
        const bar = '|'.repeat(on), off = '|'.repeat(N - on);
        const w = c.measureText('|'.repeat(N)).width;
        c.textAlign = 'left';
        c.fillStyle = INK;
        c.fillText(bar, INK_W / 2 - w / 2, p.y);
        c.fillStyle = 'rgba(42,26,16,0.22)';
        c.fillText(off, INK_W / 2 - w / 2 + c.measureText(bar).width, p.y);
        p.y += 40;
        p.text(`${rk.next.at - pts} more to ${rk.next.title}`, 22, SEPIA);
      } else p.text('There is no higher title.', 22, SEPIA);
      p.y = INK_H - 210;
      p.rule('-  *  -');
      p.para('Points come from first sightings and first kills, from loot found and plans owned, from every place ridden and every legend met.', 20, SEPIA);
      break;
    }
    case 'contents': {
      p.y = 80;
      p.text('CONTENTS', 46, INK);
      p.rule();
      p.y += 8;
      secs.forEach((s, i) => {
        const st = Codex.sectionStats(s);
        const y0 = p.y - 6;
        p.leader(`${ROMAN(i + 1)}.  ${s.name}`, `${st.found} / ${st.total}`, 26);
        p.c.font = '18px Alagard';
        p.c.textAlign = 'left';
        p.c.fillStyle = st.fresh ? RED : FADE;
        p.c.fillText(st.fresh ? `${st.fresh} new  ·  ${st.pts} of ${st.max} pts` : `${st.pts} of ${st.max} pts`, M + 46, p.y - 6);
        p.y += 26;
        p.link(y0, p.y - 4, 'section:' + i);
      });
      const y0 = p.y - 6;
      p.leader(`${ROMAN(secs.length + 1)}.  Moves & Cards`, `${TECHNIQUES.filter((t) => isUnlocked(t.id)).length} / ${TECHNIQUES.length}`, 26);
      p.y += 26;
      p.link(y0, p.y - 4, 'section:' + secs.length);
      p.y = INK_H - 170;
      p.para('Click a chapter, a tab or a page corner. A and D turn the pages; Esc shuts the book.', 19, FADE);
      break;
    }
    case 'title':
    case 'index': {
      const s = secs[spec.s];
      const st = Codex.sectionStats(s);
      const rowsLeft = Math.min(TITLE_ROWS, s.entries.length);
      let rows: CodexEntry[];
      if (spec.kind === 'title') {
        p.head(`Chapter ${ROMAN(spec.s + 1)}`, true);
        p.y = 70;
        p.text(`CHAPTER ${ROMAN(spec.s + 1)}`, 22, SEPIA);
        p.text(s.name.toUpperCase(), p.fit(s.name.toUpperCase(), 64), INK, 'center', undefined, 1.15);
        p.para(s.blurb, 22, SEPIA);
        p.text(s.epigraph, 20, RED);
        p.y += 6;
        p.text(`${st.found} of ${st.total} recorded  ·  ${st.pts} of ${st.max} points`, 20, SEPIA);
        p.rule();
        rows = s.entries.slice(0, rowsLeft);
      } else {
        p.head(s.name, left);
        p.y = 66;
        rows = s.entries.slice(spec.from, spec.to);
        if (!rows.length) {
          p.y = INK_H * 0.42;
          p.text('~ end of the index ~', 22, FADE);
        }
      }
      const avail = INK_H - M - 30 - p.y;
      const lh = Math.max(26, Math.min(40, Math.floor(avail / Math.max(1, rows.length))));
      const px = Math.min(25, Math.round(lh * 0.66));
      for (const e of rows) {
        const f = Codex.flags(e.key);
        const known = (f & (F_SEEN | F_CLAIM)) !== 0;
        const y0 = p.y - 4;
        const name = known ? e.name : '? ? ?';
        const right = known ? `${Codex.entryPoints(e)} / ${Codex.entryMax(e)}` : `- / ${Codex.entryMax(e)}`;
        p.leader(`${String(e.n).padStart(2, ' ')}.  ${name}`, right, px, !known);
        if (f && !(f & F_READ)) {
          p.c.font = `${Math.round(px * 0.72)}px Alagard`;
          p.c.textAlign = 'left';
          p.c.fillStyle = RED;
          p.c.fillText('NEW', 14, y0 + 6);
        }
        p.y += lh - Math.round(px * 1.32);
        p.link(y0, p.y - 2, 'entry:' + e.key);
      }
      break;
    }
    case 'plate': {
      const e = Codex.entry(spec.key)!;
      const sec = secs.find((s) => s.cat === e.cat)!;
      const known = Codex.known(e.key);
      p.head(sec.name, true);
      p.y = Math.round(INK_H * 0.04);
      p.text(`PLATE ${ROMAN(e.n)}.`, 20, SEPIA);
      p.y = Math.round(INK_H * PLATE_RECT[3]) + 18;
      const nm = known ? e.name : 'Unknown';
      p.text(nm, p.fit(nm, 34), INK);
      p.text(known ? (e.cat === 'blueprint' ? '- drawn to scale -' : e.cat === 'place' ? '- as it stands -' : '- as drawn from life -') : '- glimpsed in the dark -', 19, SEPIA);
      p.y += 10;
      if (known && e.cat === 'bounty') {
        const k = Codex.kills(e.id);
        p.text(k > 0 ? `Laid low: ${k}` : 'Not yet laid low', 22, k > 0 ? INK : FADE);
        if (k > 0) p.text(tally(k), 22, RED);
      } else if (known && e.cat === 'boss') p.text(Codex.flags(e.key) & F_CLAIM ? 'Defeated.' : 'Met, but not beaten.', 22, Codex.flags(e.key) & F_CLAIM ? INK : RED);
      if (known && (e.enemy || (e.model && e.cat !== 'place'))) {
        p.y = INK_H - M - 44;
        p.text(e.enemy || e.cat === 'boss' || e.cat === 'wildlife' || e.cat === 'legend' ? 'hold the cursor on the plate to provoke it' : 'hold the cursor on the plate to turn it', 17, FADE);
      }
      p.folio(folio, true);
      break;
    }
    case 'entry': {
      const e = Codex.entry(spec.key)!;
      const sec = secs.find((s) => s.cat === e.cat)!;
      const f = Codex.flags(e.key);
      const known = (f & (F_SEEN | F_CLAIM)) !== 0;
      p.head(`${sec.name}  ·  No. ${e.n}`, false);
      p.y = 60;
      if (!known) {
        p.y = 120;
        p.text('? ? ?', 70, INK);
        p.text('Not yet recorded.', 24, SEPIA);
        p.rule();
        p.y += 20;
        p.text('RUMOUR HAS IT', 20, RED);
        p.para(e.hint, 24, SEPIA);
        p.y += 30;
        p.text('WORTH', 20, SEPIA);
        if (e.pts.sight) p.leader('First sighting', `+${e.pts.sight}`, 22, true);
        if (e.pts.kill) p.leader(e.cat === 'boss' ? 'Defeated' : e.cat === 'bounty' ? 'First kill' : e.cat === 'blueprint' ? 'Owned' : 'Found', `+${e.pts.kill}`, 22, true);
        if (e.pts.master) p.leader(`Mastered (${MASTER_KILLS} kills)`, `+${e.pts.master}`, 22, true);
        p.folio(folio, false);
        break;
      }
      p.text(e.name.toUpperCase(), p.fit(e.name.toUpperCase(), 48), INK, 'center', undefined, 1.12);
      p.text(`"${e.title}"`, p.fit(`"${e.title}"`, 23), SEPIA);
      p.rule();
      p.para(e.lore, 22, INK, true);
      if (e.stats?.length) {
        p.y += 4;
        for (const [k, v] of e.stats) p.leader(k, v, 21);
      }
      if (e.moves?.length) {
        p.y += 6;
        p.text('KNOWN MOVES', 18, SEPIA);
        p.para(e.moves.map((m) => `"${m}"`).join('   '), 21, RED);
      }
      if (e.weak) {
        p.text('WEAKNESS', 18, SEPIA);
        p.para(e.weak, 21, INK);
      }
      // the points it was worth, achieved in ink, the rest in pencil
      p.y = Math.max(p.y + 4, INK_H - M - 120);
      const parts: [string, number | undefined, boolean][] = [
        ['Seen', e.pts.sight, !!(f & F_SEEN)],
        [e.cat === 'boss' ? 'Beaten' : e.cat === 'bounty' ? 'Slain' : e.cat === 'blueprint' ? 'Owned' : 'Found', e.pts.kill, !!(f & F_CLAIM)],
        ['Mastered', e.pts.master, !!(f & F_MASTER)],
      ];
      const c = p.c;
      p.font(20);
      let x = M;
      c.textAlign = 'left';
      for (const [lab, v, on] of parts) {
        if (!v) continue;
        const s = `${lab} +${v}`;
        c.fillStyle = on ? INK : 'rgba(42,26,16,0.3)';
        c.fillText(s, x, p.y);
        x += c.measureText(s).width + 26;
      }
      if (f & F_MASTER) stamp = 'MASTERED';
      else if (f & F_CLAIM) stamp = e.claimWord ?? 'RECORDED';
      p.folio(folio, false);
      break;
    }
    case 'moves': {
      p.head('Moves & Cards', true);
      p.y = 70;
      p.text('MOVES', 46, INK);
      p.text('performed with the board, the gun and good timing', 18, SEPIA);
      p.rule();
      for (const tq of TECHNIQUES) {
        const open = isUnlocked(tq.id);
        p.text(tq.name.toUpperCase(), 24, open ? RED : FADE, 'left');
        p.para(open ? tq.how : `Locked. ${tq.unlockHint}`, 17, open ? INK : FADE);
        if (p.y > INK_H - M - 40) break;
      }
      p.folio(folio, true);
      break;
    }
    case 'cards': {
      p.head('Moves & Cards', false);
      p.y = 70;
      p.text('THE CARDS', 46, INK);
      p.text('the tarot deck at your hip', 18, SEPIA);
      p.rule();
      for (const [k, card, text] of CARDS) {
        p.text(`[${k}]  ${card}`, 25, RED, 'left');
        p.para(text, 21, INK);
        p.y += 6;
      }
      p.y = INK_H - 190;
      p.rule('-  *  -');
      p.para('More cards are won on the trail: every rank-up deals you a choice.', 19, SEPIA);
      p.folio(folio, false);
      break;
    }
    case 'end': {
      p.y = INK_H * 0.4;
      p.text('~ the rest of the pages are blank ~', 22, FADE);
      p.text('ride out and fill them', 20, FADE);
      break;
    }
  }
  return { canvas: cv, links: p.links, stamp };
}
