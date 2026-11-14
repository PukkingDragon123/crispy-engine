// Stages and heroes. The desert is the first stage; beating Khonsu of the Sands
// opens the Nile (river surfing, Cleopatra's animal army, the Sphinx at 50,
// Cleopatra at 75, Ra at 100; after Cleopatra falls Ra burns the river into lava).
// Sundown is the first hero; beating Khonsu also frees Mark, the moon-mummy cat.

export type StageId = 'desert' | 'nile';
export type HeroId = 'sundown' | 'mark';

export interface StageInfo {
  id: StageId;
  name: string;
  /** what the menu / bounty board says while it is still sealed */
  sealed: string;
}

export const STAGES: Record<StageId, StageInfo> = {
  desert: { id: 'desert', name: 'The Dunes', sealed: '' },
  nile: { id: 'nile', name: 'The Nile', sealed: 'Beat Khonsu of the Sands to open the river.' },
};
