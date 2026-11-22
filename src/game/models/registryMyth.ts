// The roadside legends (run/MythRoad, models/characters/mythFolk.ts): gods, the serpent, the Fool's dog,
// quest tokens and their props. Picked up by models/lookup.ts (registry glob).
import { besRig, taweretRig, hathorRig, khnumRig, isisRig, serpentRig, terrierRig, tokenModel, shadowProp, potterWheel } from './characters/mythFolk';

export const MYTH_MODELS = {
  myth_bes: () => besRig(),
  myth_taweret: () => taweretRig(),
  myth_hathor: () => hathorRig(),
  myth_khnum: () => khnumRig(),
  myth_isis: () => isisRig(),
  myth_serpent: () => serpentRig(),
  myth_terrier: () => terrierRig(),
  myth_wheel: () => potterWheel(),
  myth_beer_jar: () => tokenModel('beer'),
  myth_clay: () => tokenModel('clay'),
  myth_wand: () => tokenModel('wand'),
  myth_osiris: () => tokenModel('osiris'),
  myth_myrrh: () => tokenModel('myrrh'),
  myth_page: () => tokenModel('page'),
  coffee_gum: () => tokenModel('gum'),
  myth_oar: () => shadowProp('oar'),
  myth_bow: () => shadowProp('bow'),
  myth_book: () => shadowProp('book'),
};
