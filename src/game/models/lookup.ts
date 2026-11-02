// Runtime model lookup across every registry (characters, enemies, variants, props).
// Uses Vite's glob import so registries that don't exist yet simply aren't included.
import type { ModelEntry } from './registryCharacters';

const regs = import.meta.glob('./registry*.ts', { eager: true }) as Record<string, Record<string, unknown>>;
export const ALL_MODELS: Record<string, ModelEntry> = {};
for (const mod of Object.values(regs))
  for (const v of Object.values(mod)) if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(ALL_MODELS, v as Record<string, ModelEntry>);

export function hasModel(key: string) {
  return key in ALL_MODELS;
}
export function modelEntry(key: string): ModelEntry | undefined {
  return ALL_MODELS[key];
}
/** first existing key from a preference list */
export function firstModel(...keys: string[]) {
  for (const k of keys) if (k in ALL_MODELS) return k;
  return null;
}
