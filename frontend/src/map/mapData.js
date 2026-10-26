// IREME - agriculture map data logic (pure JavaScript, testable in Node).
// Turns the NISR insight file into per-district values, colour classes and readable summaries.
import { ALL_DISTRICTS, cropName, practiceName, knownCrops } from '../nisr/engine.js';

export const RWANDA_BOUNDS = [[-2.90, 28.80], [-1.00, 30.95]];

const SEQ = ['#eef6e8', '#c9e4b4', '#8fc98a', '#4ea36a', '#176b4d'];   // production / adoption (greens)
const RISK = ['#fff4dc', '#fbd48a', '#f2a65a', '#d96c3b', '#a8412a'];  // soil / water risks (oranges)
export const NO_DATA = '#e3e7e1';

export const LAYERS = [
  { id: 'yield', kind: 'crop', unit: 'kg/ha', palette: SEQ, en: 'Typical yield of a crop', rw: 'Umusaruro usanzwe w’igihingwa' },
  { id: 'improved_seed', kind: 'adoption', unit: '%', palette: SEQ, en: 'Plots using improved seed', rw: 'Imirima ikoresha imbuto nziza' },
  { id: 'inorganic', kind: 'adoption', unit: '%', palette: SEQ, en: 'Plots using inorganic fertilizer', rw: 'Imirima ikoresha ifumbire mvaruganda' },
  { id: 'organic', kind: 'adoption', unit: '%', palette: SEQ, en: 'Plots using compost or manure', rw: 'Imirima ikoresha ifumbire y’imborera' },
  { id: 'pesticide', kind: 'adoption', unit: '%', palette: SEQ, en: 'Plots with crop protection', rw: 'Imirima irinzwe udukoko n’indwara' },
  { id: 'irrigation', kind: 'adoption', unit: '%', palette: SEQ, en: 'Irrigated plots', rw: 'Imirima yuhirwa' },
  { id: 'anti_erosion', kind: 'adoption', unit: '%', palette: SEQ, en: 'Plots with anti-erosion measures', rw: 'Imirima ifite uburyo bwo kurwanya isuri' },
  { id: 'erosion', kind: 'threat', unit: '%', palette: RISK, en: 'Soil erosion reported', rw: 'Isuri yatangajwe' },
  { id: 'fertility_loss', kind: 'threat', unit: '%', palette: RISK, en: 'Falling soil fertility reported', rw: 'Kugabanuka k’uburumbuke bw’ubutaka' },
  { id: 'waterlogging', kind: 'threat', unit: '%', palette: RISK, en: 'Waterlogging reported', rw: 'Amazi menshi mu murima' },
  { id: 'landslide', kind: 'threat', unit: '%', palette: RISK, en: 'Landslide risk reported', rw: 'Ibyago by’inkangu' },
];
export const layerById = (id) => LAYERS.find((l) => l.id === id) || LAYERS[0];
export const layerLabel = (l, lang) => (lang === 'RW' ? l.rw : l.en);

export const normName = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\bdistrict\b/g, '').replace(/[^a-z]+/g, '');
const DISTRICT_KEYS = Object.fromEntries(ALL_DISTRICTS.map((d) => [normName(d), d]));

// Name of the district for a boundary feature (geoBoundaries uses shapeName; our own file uses name).
export function featureDistrict(feature) {
  const p = (feature && feature.properties) || {};
  const raw = p.name || p.shapeName || p.NAME_2 || p.district || p.District || p.ADM2_EN || '';
  return DISTRICT_KEYS[normName(raw)] || null;
}
export function matchedShare(geojson) {
  const feats = (geojson && geojson.features) || [];
  const hit = new Set(feats.map(featureDistrict).filter(Boolean));
  return { matched: hit.size, total: ALL_DISTRICTS.length, names: [...hit] };
}

// Value of the chosen layer for every district (null when the survey has too few plots).
export function layerValues(ins, layerId, crop) {
  const l = layerById(layerId);
  const out = {};
  for (const d of ALL_DISTRICTS) {
    let v = null; let n = null;
    if (l.kind === 'crop') {
      const node = ins.crops[crop] && ins.crops[crop].district[d];
      if (node) { v = node.median; n = node.n; }
    } else {
      const dd = ins.districts[d];
      if (dd) {
        const raw = l.kind === 'adoption' ? (dd.adoption || {})[l.id] : (dd.soil_threats || {})[l.id];
        if (raw != null) { v = Math.round(raw * 1000) / 10; n = dd.n_plots; }
      }
    }
    out[d] = { value: v, n };
  }
  return out;
}

// Five classes by quantile so differences stay visible even when values are close.
export function classify(values, palette) {
  const nums = Object.values(values).map((x) => x.value).filter((v) => v != null).sort((a, b) => a - b);
  if (!nums.length) return { breaks: [], colors: {}, palette };
  const q = (p) => nums[Math.min(nums.length - 1, Math.floor(p * (nums.length - 1) + 0.5))];
  const breaks = [q(0.2), q(0.4), q(0.6), q(0.8)];
  const colors = {};
  for (const [d, x] of Object.entries(values)) {
    if (x.value == null) { colors[d] = NO_DATA; continue; }
    let i = 0;
    while (i < breaks.length && x.value > breaks[i]) i++;
    colors[d] = palette[i];
  }
  return { breaks, colors, palette, min: nums[0], max: nums[nums.length - 1] };
}
export function legendItems(cls, unit) {
  if (!cls.breaks.length) return [];
  const b = cls.breaks; const f = (v) => (unit === '%' ? v.toFixed(v < 10 ? 1 : 0) : Math.round(v).toLocaleString('en-US'));
  return [
    { color: cls.palette[0], text: `≤ ${f(b[0])}` }, { color: cls.palette[1], text: `${f(b[0])}–${f(b[1])}` },
    { color: cls.palette[2], text: `${f(b[1])}–${f(b[2])}` }, { color: cls.palette[3], text: `${f(b[2])}–${f(b[3])}` },
    { color: cls.palette[4], text: `> ${f(b[3])}` },
  ];
}
export const formatValue = (v, unit) => (v == null ? '–' : unit === '%' ? `${v}%` : `${Math.round(v).toLocaleString('en-US')} kg/ha`);

// ------------------------------------------------------------------ text for screen readers and voice
const T = (lang, en, rw) => (lang === 'RW' ? rw : en);
export function mapSummary(ins, layerId, crop, lang = 'EN') {
  const l = layerById(layerId);
  const vals = layerValues(ins, layerId, crop);
  const rows = Object.entries(vals).filter(([, x]) => x.value != null).sort((a, b) => b[1].value - a[1].value);
  const title = l.kind === 'crop' ? `${layerLabel(l, lang)}: ${cropName(crop, lang)}` : layerLabel(l, lang);
  if (rows.length < 4) return T(lang, `${title}. Not enough survey data to rank districts.`, `${title}. Nta makuru ahagije yo gutondeka uturere.`);
  const fmt = (r) => `${r[0]} ${formatValue(r[1].value, l.unit)}`;
  const top = rows.slice(0, 3).map(fmt).join(', ');
  const low = rows.slice(-3).reverse().map(fmt).join(', ');
  const hi = T(lang, l.kind === 'threat' ? 'Most reported' : 'Highest', l.kind === 'threat' ? 'Hibasiwe cyane' : 'Hejuru cyane');
  const lo = T(lang, l.kind === 'threat' ? 'Least reported' : 'Lowest', l.kind === 'threat' ? 'Hibasiwe gake' : 'Hasi cyane');
  return `${title}. ${hi}: ${top}. ${lo}: ${low}. ` + T(lang, `Based on NISR AHS 2024 survey plots in ${rows.length} districts.`, `Bishingiye ku mirima y’ubushakashatsi bwa NISR AHS 2024 mu turere ${rows.length}.`);
}

export function districtSummary(ins, d, layerId, crop, lang = 'EN') {
  const dd = ins.districts[d];
  if (!dd) return T(lang, `${d}: not enough NISR survey data.`, `${d}: nta makuru ahagije ya NISR.`);
  const l = layerById(layerId);
  const parts = [];
  const val = layerValues(ins, layerId, crop)[d];
  parts.push(`${d}. ${layerLabel(l, lang)}${l.kind === 'crop' ? ' (' + cropName(crop, lang) + ')' : ''}: ${val && val.value != null ? formatValue(val.value, l.unit) : T(lang, 'not enough data', 'nta makuru ahagije')}.`);
  const best = (ins.ranking[d] || []).slice(0, 3);
  if (best.length) parts.push(T(lang, `Crops doing well here: ${best.map((r) => cropName(r.crop)).join(', ')}.`, `Ibihingwa bitanga umusaruro mwiza hano: ${best.map((r) => cropName(r.crop, 'RW')).join(', ')}.`));
  const a = dd.adoption || {};
  parts.push(T(lang, `Improved seed on ${Math.round((a.improved_seed || 0) * 100)}% of plots, inorganic fertilizer on ${Math.round((a.inorganic || 0) * 100)}%, compost on ${Math.round((a.organic || 0) * 100)}%.`,
    `Imbuto nziza ku ${Math.round((a.improved_seed || 0) * 100)}% by’imirima, ifumbire mvaruganda ku ${Math.round((a.inorganic || 0) * 100)}%, compost ku ${Math.round((a.organic || 0) * 100)}%.`));
  const th = Object.entries(dd.soil_threats || {}).filter(([k, v]) => k !== 'none' && v >= 0.05).sort((x, y) => y[1] - x[1]).slice(0, 2);
  if (th.length) parts.push(T(lang, `Main soil concerns: ${th.map(([k, v]) => `${k.replace('_', ' ')} ${Math.round(v * 100)}%`).join(', ')}.`, `Ibibazo by’ubutaka: ${th.map(([k, v]) => `${k.replace('_', ' ')} ${Math.round(v * 100)}%`).join(', ')}.`));
  return parts.join(' ');
}
export const mapCrops = (ins) => knownCrops(ins).sort((a, b) => ins.crops[b].n - ins.crops[a].n);
export { practiceName };
