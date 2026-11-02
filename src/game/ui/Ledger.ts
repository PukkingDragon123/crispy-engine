// TAB: the bounty hunter's ledger. Core stats with bars, every derived stat,
// and — on hover — the exact math: base formula, flat adds, % adds,
// multipliers, cap, total, each line tagged with its source.
import type { StatSheet, StatId, CoreStat } from '../combat/Stats';
import { CORE_INFO, DERIVED_INFO, fmtStat } from '../combat/Stats';

const SHOW: StatId[] = ['maxHp', 'regen', 'armor', 'physRes', 'magicRes', 'gunDmg', 'meleeDmg', 'magicDmg', 'critChance', 'critDmg', 'fireRate', 'reloadSpeed', 'ammo', 'statusPower', 'statusChance', 'moveSpeed', 'accel', 'jump', 'dodge', 'cdr', 'lifesteal', 'pickupRange', 'bountyGain', 'goldGain', 'ultCharge', 'scorpions', 'pierce'];

const pretty = (src: string) => src.replace(/^up:/, '').replace(/^item:/, '').replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim();

export class Ledger {
  open = false;
  private el: HTMLDivElement;
  private detail: HTMLDivElement;
  constructor(parent: HTMLElement, private stats: StatSheet) {
    this.el = document.createElement('div');
    this.el.style.cssText = "position:absolute;left:4vw;top:50%;transform:translateY(-50%);z-index:8;display:none;width:min(560px,44vw);max-height:84vh;overflow:auto;padding:16px 20px;background:#e8d4a4;border:4px solid #5a3418;box-shadow:0 6px 0 #2a1408,0 0 0 4px #2a1408 inset;font-family:'Alagard';color:#2a1a10;font-size:16px;pointer-events:auto;image-rendering:pixelated";
    this.detail = document.createElement('div');
    this.detail.style.cssText = "position:absolute;z-index:9;display:none;min-width:260px;max-width:360px;padding:10px 14px;background:#f4e4bc;border:3px solid #5a3418;box-shadow:0 4px 0 #2a1408;font-family:'Alagard';color:#2a1a10;font-size:15px;line-height:1.3;pointer-events:none";
    parent.append(this.el, this.detail);
  }

  toggle(v = !this.open) {
    this.open = v;
    this.el.style.display = v ? 'block' : 'none';
    this.detail.style.display = 'none';
    if (v) this.render();
  }

  private render() {
    const s = this.stats;
    let html = `<div style="font-size:30px;color:#8a2a18;text-align:center">LEDGER</div><div style="text-align:center;font-size:14px;opacity:.75;margin-bottom:10px">value = (base + flat) × (1 + Σ%) × Π mult · hover a line for its math</div>`;
    html += '<div style="display:grid;grid-template-columns:auto 1fr auto;gap:4px 10px;align-items:center;margin-bottom:12px">';
    for (const k of Object.keys(CORE_INFO) as CoreStat[]) {
      const v = s.get(k);
      const info = CORE_INFO[k];
      html += `<div data-stat="${k}" style="color:${info.color};text-shadow:0 1px 0 #2a1408">${info.short}</div><div style="height:10px;background:#c9b082;border:2px solid #5a3418"><div style="height:100%;width:${Math.min(100, v * 4)}%;background:${info.color}"></div></div><div data-stat="${k}">${Math.round(v * 10) / 10}</div>`;
    }
    html += '</div><div style="columns:2;column-gap:18px">';
    for (const st of SHOW) {
      const info = DERIVED_INFO[st as keyof typeof DERIVED_INFO];
      if (!info) continue;
      const v = s.get(st);
      const b = s.breakdown(st);
      const modded = b.flats.length + b.pcts.length + b.mults.length > 0;
      html += `<div data-stat="${st}" style="display:flex;justify-content:space-between;gap:8px;padding:2px 4px;cursor:help;break-inside:avoid;border-bottom:1px solid rgba(90,52,24,.25)"><span>${info.name}</span><b style="color:${modded ? '#2a6a10' : '#2a1a10'}">${fmtStat(st, v)}</b></div>`;
    }
    html += '</div><div style="text-align:center;font-size:13px;opacity:.7;margin-top:10px">TAB to close</div>';
    this.el.innerHTML = html;
    this.el.querySelectorAll<HTMLElement>('[data-stat]').forEach((row) => {
      row.onmouseenter = (e) => this.showDetail(row.dataset.stat as StatId, e as MouseEvent);
      row.onmousemove = (e) => this.place(e as MouseEvent);
      row.onmouseleave = () => (this.detail.style.display = 'none');
    });
  }

  private place(e: MouseEvent) {
    this.detail.style.left = `${e.clientX + 18}px`;
    this.detail.style.top = `${Math.min(window.innerHeight - 220, e.clientY - 10)}px`;
  }

  private showDetail(st: StatId, e: MouseEvent) {
    const b = this.stats.breakdown(st);
    const core = st in CORE_INFO;
    const name = core ? CORE_INFO[st as CoreStat].name : DERIVED_INFO[st as keyof typeof DERIVED_INFO]?.name ?? st;
    const desc = core ? CORE_INFO[st as CoreStat].desc : '';
    const f = (v: number) => (Math.abs(v) < 10 ? (Math.round(v * 1000) / 1000).toString() : Math.round(v).toString());
    let h = `<div style="font-size:19px;color:#8a2a18">${name}</div>`;
    if (desc) h += `<div style="opacity:.8;margin-bottom:4px">${desc}</div>`;
    h += `<div>Base: <b>${f(b.base)}</b>${b.formula && b.formula !== 'base' ? ` <span style="opacity:.7">(${b.formula})</span>` : ''}</div>`;
    for (const r of b.flats) h += `<div style="color:#2a6a10">${r.value >= 0 ? '+' : ''}${f(r.value)} · ${pretty(r.source)}</div>`;
    for (const r of b.pcts) h += `<div style="color:#1a5a7a">${r.value >= 0 ? '+' : ''}${Math.round(r.value * 100)}% · ${pretty(r.source)}</div>`;
    for (const r of b.mults) h += `<div style="color:#7a2a6a">×${f(r.value)} · ${pretty(r.source)}</div>`;
    if (b.cap) h += `<div style="opacity:.7">Cap: ${f(b.cap[0])} – ${f(b.cap[1])}</div>`;
    h += `<div style="margin-top:4px;border-top:2px solid #5a3418;padding-top:3px">Total: <b>${core ? f(b.total) : fmtStat(st, b.total)}</b></div>`;
    this.detail.innerHTML = h;
    this.detail.style.display = 'block';
    this.place(e);
  }

  dispose() {
    this.el.remove();
    this.detail.remove();
  }
}
