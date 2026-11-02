// Status effects with stacking rules and cross-status combos.
//  poison  : magic DoT per stack (cap = attacker's poisonStacks), refreshes on apply
//  bleed   : physical DoT per stack, doubled while the target moves
//  burn    : % max HP DoT (reduced on bosses), linen/mummies take double
//  curse   : +3% damage taken per stack; at 15 stacks → DOOM (execute / huge hit)
//  slow    : -40% move/attack speed;  stun: frozen;  armorBreak: -50% armor
// Combos (hidden interactions, logged to the codex when discovered):
//  Toxic Blaze  = burn applied to 10+ poison → venom explosion, consumes burn
//  Plague       = poison + curse on death → spreads both to nearby enemies
//  Shatter      = stun + armorBreak → next hit +100% crit damage and guaranteed crit
//  Hemorrhage   = bleed + curse → bleed ticks can crit
//  Paralysis    = slow + 20 poison → 0.8 s stun (once per 4 s)

export type StatusId = 'poison' | 'bleed' | 'burn' | 'curse' | 'slow' | 'stun' | 'armorBreak' | 'mark';

export const STATUS_INFO: Record<StatusId, { name: string; color: number; css: string; desc: string; icon: string }> = {
  poison: { name: 'Poison', color: 0x9dff3a, css: '#9dff3a', desc: 'Magic damage over time per stack. Stacks refresh on hit.', icon: 'bubble' },
  bleed: { name: 'Bleeding', color: 0xe0402c, css: '#e0402c', desc: 'Physical damage over time, doubled while the target moves.', icon: 'blood0' },
  burn: { name: 'Burning', color: 0xffb233, css: '#ffb233', desc: 'Percent max health damage over time. Linen burns twice as well.', icon: 'flame1' },
  curse: { name: 'Curse', color: 0xb565ff, css: '#b565ff', desc: '+3% damage taken per stack. At 15 stacks: DOOM.', icon: 'skull' },
  slow: { name: 'Slow', color: 0x6fe3cf, css: '#6fe3cf', desc: '-40% movement and attack speed.', icon: 'dot4' },
  stun: { name: 'Stun', color: 0xfff2a0, css: '#fff2a0', desc: 'Cannot act.', icon: 'star4' },
  armorBreak: { name: 'Armor Break', color: 0xd49a24, css: '#d49a24', desc: '-50% armor.', icon: 'shield' },
  mark: { name: 'Bounty Mark', color: 0xffd36b, css: '#ffd36b', desc: 'Marked targets drop double bounty.', icon: 'sheriff' },
};

export const COMBO_INFO = {
  toxicBlaze: { name: 'Toxic Blaze', desc: 'Burning a heavily poisoned target makes it erupt in venom fire.' },
  plague: { name: 'Plague', desc: 'Poisoned + cursed targets spread both on death.' },
  shatter: { name: 'Shatter', desc: 'Stunned + armor-broken targets take a guaranteed super-crit.' },
  hemorrhage: { name: 'Hemorrhage', desc: 'Cursed bleeding can critically strike.' },
  paralysis: { name: 'Paralysis Venom', desc: 'Slowed targets with 20+ poison seize up.' },
} as const;
export type ComboId = keyof typeof COMBO_INFO;

export interface StatusEntry {
  stacks: number;
  time: number;
  dur: number;
  power: number; // dmg per stack per second (already scaled by attacker potency)
}

export interface StatusResist {
  [k: string]: number | undefined; // 0..1 resistance per status id
}

export class StatusSet {
  s = new Map<StatusId, StatusEntry>();
  shatterReady = false;
  paralysisCd = 0;
  private tickAcc = 0;

  has(id: StatusId) {
    const e = this.s.get(id);
    return !!e && e.stacks > 0 && e.time > 0;
  }
  stacks(id: StatusId) {
    const e = this.s.get(id);
    return e && e.time > 0 ? e.stacks : 0;
  }

  /** returns combo triggered (if any) */
  apply(id: StatusId, stacks: number, dur: number, power: number, cap: number, resist: StatusResist): ComboId | null {
    const r = resist[id] ?? 0;
    if (r >= 1) return null;
    const eff = stacks * (1 - r);
    if (eff <= 0) return null;
    let e = this.s.get(id);
    if (!e || e.time <= 0) {
      e = { stacks: 0, time: 0, dur, power };
      this.s.set(id, e);
    }
    e.stacks = Math.min(cap, e.stacks + eff);
    e.time = Math.max(e.time, dur * (1 - r * 0.5));
    e.dur = dur;
    e.power = Math.max(e.power * 0.7, power);
    // combos
    if (id === 'burn' && this.stacks('poison') >= 10) {
      e.time = 0;
      return 'toxicBlaze';
    }
    if ((id === 'stun' && this.has('armorBreak')) || (id === 'armorBreak' && this.has('stun'))) {
      this.shatterReady = true;
      return 'shatter';
    }
    if ((id === 'slow' || id === 'poison') && this.has('slow') && this.stacks('poison') >= 20 && this.paralysisCd <= 0) {
      this.paralysisCd = 4;
      const st = this.s.get('stun') ?? { stacks: 0, time: 0, dur: 0.8, power: 0 };
      st.stacks = 1;
      st.time = 0.8;
      this.s.set('stun', st);
      return 'paralysis';
    }
    return null;
  }

  clear(id?: StatusId) {
    if (id) this.s.delete(id);
    else this.s.clear();
  }

  /**
   * Advance timers. Returns damage to deal this frame per type (ticks at 4 Hz for readable numbers).
   */
  tick(dt: number, maxHp: number, moving: boolean, isBoss: boolean, burnMul = 1) {
    this.paralysisCd -= dt;
    this.tickAcc += dt;
    let out: { poison: number; bleed: number; burn: number; ticked: boolean } | null = null;
    const doTick = this.tickAcc >= 0.25;
    const tdt = this.tickAcc;
    if (doTick) this.tickAcc = 0;
    for (const [id, e] of this.s) {
      if (e.time <= 0) continue;
      e.time -= dt;
      if (e.time <= 0) {
        e.stacks = 0;
        continue;
      }
      if (!doTick) continue;
      if (!out) out = { poison: 0, bleed: 0, burn: 0, ticked: true };
      if (id === 'poison') out.poison += e.stacks * e.power * tdt;
      else if (id === 'bleed') out.bleed += e.stacks * e.power * tdt * (moving ? 2 : 1);
      else if (id === 'burn') out.burn += Math.min(maxHp * 0.03 * (isBoss ? 0.15 : 1), 60 * e.power) * tdt * burnMul + e.power * 2 * tdt;
    }
    return out;
  }

  /** multiplier on damage taken from curse */
  curseMul() {
    return 1 + 0.03 * this.stacks('curse');
  }
  slowMul() {
    return this.has('slow') ? 0.6 : 1;
  }
  stunned() {
    return this.has('stun');
  }
  armorMul() {
    return this.has('armorBreak') ? 0.5 : 1;
  }
}
