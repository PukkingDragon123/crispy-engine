// Hand-authored pixel-art product icons for Ozymandias's wares (16 x 16, the HUD palette: PixelUI's
// HUD_PAL letters, '.' clear). The shop's ware card and the one-by-one reveal show them (ShopUI).
import type { PixelSprite } from './PixelUI';

const S = (rows: string[]): PixelSprite => ({ w: rows[0].length, h: rows.length, rows });

const BANDAGE = S([
  '................',
  '....kkkkkkk.....',
  '..kkOOOOOOOkk...',
  '.kOONNNNNNNOOk..',
  '.kONNkkkkkNNOk..',
  'kONNkMMLMMkNNOk.',
  'kONkMLKKKLMkNOk.',
  'kONkMLKkKLMkNOk.',
  'kONkMLKKKLMkNOk.',
  'kONNkMMLMMkNNOk.',
  '.kONNkkkkkNNOkk.',
  '.kOONNNNNNNOOkOk',
  '..kkOOOOOOOkkONk',
  '....kkkkkkk.kOOk',
  '............kCDk',
  '.............kk.',
]);
const DAGGER = S([
  '..............kk',
  '.............kSk',
  '............kSRk',
  '...........kSRk.',
  '..........kSRk..',
  '.........kSRk...',
  '........kSRk....',
  '.......kSRk.....',
  '..kk..kSRk......',
  '..kikkSRk.......',
  '...kihkk........',
  '....khDk........',
  '...kkkhik.......',
  '..kmnk.kik......',
  '.kmnk...kk......',
  '.kkk............',
]);
const SMOKE = S([
  '..........kk....',
  '.........kRRk...',
  '........kRSSRk..',
  '.....k..kRRRk...',
  '....kjk..kkk....',
  '.....kZk........',
  '......kXk.......',
  '.....kkkkk......',
  '...kkbbbbbkk....',
  '..kbcdcbbbabk...',
  '.kbcdeccbbbaak..',
  '.kbcdcbbbbaaak..',
  '.kbbcbbbbaaaak..',
  '..kbbbbbaaaak...',
  '...kkaaaaakk....',
  '.....kkkkk......',
]);
const SHIELD = S([
  '....kkkkkkkk....',
  '..kkcddddddckk..',
  '.kcdooppppoodck.',
  '.kdoppppppppodk.',
  'kcoppnpkkpnppock',
  'kdopnpkeekpnpodk',
  'kdopnkedcbknpodk',
  'kdopnkdcbakmpodk',
  'kdopnkcbaakmpodk',
  'kdopnpkbakpnmodk',
  'kcopnnpkkpnnmock',
  '.kdonnnnnnnmodk.',
  '.kcdommmmmmodck.',
  '..kkcddddddckk..',
  '....kkkkkkkk....',
  '................',
]);
const CHARM = S([
  '....kk....kk....',
  '...k..k..k..k...',
  '..k....kk....k..',
  '......kkkk......',
  '.....kijjik.....',
  '....kih..hik....',
  '....kih..hik....',
  '.....kihhik.....',
  '..kkkkiiiikkkk..',
  '..kjjiiiiiihhk..',
  '..kkkkhiihkkkk..',
  '......khhk......',
  '......khgk......',
  '......khgk......',
  '......kggk......',
  '.......kk.......',
]);
const DYNAMITE = S([
  '............j...',
  '..........kjEj..',
  '...........kZ...',
  '..........kX....',
  '.........kX.....',
  '...kkkkkkXkk....',
  '..kDDDkDDDkDk...',
  '..kCDCkCDCkCk...',
  '..kxyxkxyxkxk...',
  '..kCCCkCCCkCk...',
  '..kBCBkBCBkBk...',
  '..kBCBkBCBkBk...',
  '..kxyxkxyxkxk...',
  '..kBBBkBBBkBk...',
  '..kABAkABAkAk...',
  '...kkkkkkkkk....',
]);
const SNAKEOIL = S([
  '......kkkk......',
  '......kmnk......',
  '......kkkk......',
  '.......kGk......',
  '.......kGk......',
  '......kGHGk.....',
  '.....kGHIHGk....',
  '....kGHtttHGk...',
  '....kGtBDBtGk...',
  '....kGtDBDtGk...',
  '....kGttttHGk...',
  '....kGHHHHHGk...',
  '....kFGGGGGFk...',
  '....kFFFFFFFk...',
  '.....kkkkkkk....',
  '................',
]);
const WHISKEY = S([
  '.......kk.......',
  '......kmnk......',
  '......kkkk......',
  '.......kZk......',
  '.......kZk......',
  '......kZhZk.....',
  '.....kZhihZk....',
  '....kYZhiiZYk...',
  '....kYttttZYk...',
  '....kYtkktZYk...',
  '....kYttttZYk...',
  '....kYZZZZZYk...',
  '....kXYYYYYXk...',
  '....kXXXXXXXk...',
  '.....kkkkkkk....',
  '................',
]);
const TONIC = S([
  '......kkkk......',
  '......kxyk......',
  '......kkkk......',
  '......kOOk......',
  '.....kOSSOk.....',
  '....kOSSSSOk....',
  '...kOSS##SSOk...',
  '...kOSSSSSSOk...',
  '...kOVVVVVVOk...',
  '...kOVWWWWVOk...',
  '...kOVVVVVVOk...',
  '...kONSSSSNOk...',
  '...kNNNNNNNNk...',
  '....kkkkkkkk....',
  '................',
  '................',
]);
const CARD = S([
  '...kkkkkkkkkk...',
  '...kttttttttk...',
  '...ktBBBBBBtk...',
  '...ktBhiihBtk...',
  '...ktBijjiBtk...',
  '...ktBhiihBtk...',
  '...ktBBhhBBtk...',
  '...ktBhBBhBtk...',
  '...ktBBhhBBtk...',
  '...ktBhiihBtk...',
  '...ktBijjiBtk...',
  '...ktBhiihBtk...',
  '...ktBBBBBBtk...',
  '...kttttttttk...',
  '...kkkkkkkkkk...',
  '................',
]);
/** the purse's gold coin (9 x 9) */
export const COIN_ICON = S(['..kkkkk..', '.kiiiiik.', 'kijjiihgk', 'kijhhhhgk', 'kiihjhhgk', 'kiihhhhgk', 'khhhhhggk', '.kgggggk.', '..kkkkk..']);

/** embalmer's linen: the bandage roll in gilded linen */
export const LINEN_SWAP: Record<string, string> = { O: '#fff0a6', N: '#e2b24a', M: '#b88426', L: '#7c5214' };

const ICONS: Record<string, PixelSprite> = {
  bandage: BANDAGE, goldBandage: BANDAGE, dagger: DAGGER, smoke: SMOKE, shield: SHIELD, charm: CHARM, dynamite: DYNAMITE,
  snakeoil: SNAKEOIL, whiskey: WHISKEY, heal: TONIC, card: CARD,
};

/** the icon for a ware id (null: none authored); `swap` is the palette swap it wants, if any */
export function wareIcon(id: string): { def: PixelSprite; swap?: Record<string, string>; key?: string } | null {
  const def = ICONS[id];
  if (!def) return null;
  return id === 'goldBandage' ? { def, swap: LINEN_SWAP, key: 'linen' } : { def };
}
