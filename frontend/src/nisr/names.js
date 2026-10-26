// IREME - shared Kinyarwanda names and small grammar helpers (no dependencies).
export const CROP_RW = {
  'Maize': 'Ibigori', 'Bush bean': 'Ibishyimbo (bitazamuka)', 'Climbing bean': 'Ibishyimbo bizamuka',
  'Irish potato': 'Ibirayi', 'Sweet potato': 'Ibijumba', 'Cassava': 'Imyumbati', 'Paddy rice': 'Umuceri',
  'Sorghum': 'Amasaka', 'Soybean': 'Soya', 'Groundnut': 'Ubunyobwa', 'Pea': 'Amashaza', 'Taro': 'Amateke',
  'Wheat': 'Ingano', 'Tomato': 'Inyanya', 'Cabbage': 'Amashu', 'Eggplant': 'Intoryi', 'Sun flower': 'Ururabo rw’izuba',
  'Onion': 'Ibitunguru', 'Carrot': 'Karoti', 'Banana': 'Ibitoki', 'Coffee': 'Ikawa', 'Tea': 'Icyayi', 'Vegetables': 'Imboga',
  'Amaranth': 'Dodo', 'Millet': 'Uburo', 'Sweet pepper': 'Puwavuro', 'French beans': 'Ibishyimbo bya Faransa', 'Chia seeds': 'Imbuto za chia',
  'Pumpkin': 'Igihaza', 'Garlic': 'Tungurusumu', 'Cooking banana': 'Ibitoki bitekwa', 'Pepper': 'Urusenda',
};
export const cropName = (c, lang = 'EN') => (lang === 'RW' ? (CROP_RW[c] || c) : c);
const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
// "of <crop>" in Kinyarwanda: rwOf('Maize','y') -> "y’ibigori" (as in imirima y’ibigori); consonant names get "ya soya".
// cls: y (imirima), w (umusaruro), cy (igihingwa), b (abahinzi), by (ibyiciro), bw (ubutaka), z (inyungu), rw
export function rwOf(crop, cls = 'y') {
  const n = lowerFirst(CROP_RW[crop] || crop);
  return /^[aeiouAEIOU]/.test(n) ? `${cls}’${n}` : `${cls}a ${n}`;
}
export const THREAT_RW = { erosion: 'isuri', fertility_loss: 'kugabanuka k’uburumbuke', waterlogging: 'amazi menshi mu murima', landslide: 'inkangu', salinization: 'umunyu mu butaka' };
export const THREAT_EN = { erosion: 'erosion', fertility_loss: 'fertility loss', waterlogging: 'waterlogging', landslide: 'landslide', salinization: 'salinization' };
// Sowing windows (the survey's English texts live in the insight file; these are the Kinyarwanda versions)
export const SOWING_RW = {
  A: { early: 'mbere ya 1 Nzeri', main: 'muri Nzeri', late: 'muri Ukwakira cyangwa nyuma yaho' },
  B: { early: 'muri Mutarama cyangwa mbere yaho', main: 'muri Gashyantare', late: 'muri Werurwe cyangwa nyuma yaho' },
};
export const META_NOTE_RW = 'Isoko: NISR Agricultural Household Survey (AHS) 2024, amakuru y’ibanze y’imirima, inyongeramusaruro n’uburyo bwo guhinga. Ibi ni ibigaragara mu bushakashatsi, si ingwate. Umusaruro ni uwatangajwe n’abahinzi kuri hegitari y’ubuso bw’igihingwa ku mirima yabajijwe, bityo utandukanye n’imibare y’igihugu yemewe ya NISR. Emeza inama na RAB cyangwa umujyanama w’ubuhinzi w’akarere.';
