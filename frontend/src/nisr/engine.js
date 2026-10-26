import { agronomyPlan, waterAdvice, dayLabel } from './agronomy.js';
import { CROP_RW, cropName, rwOf, THREAT_RW, THREAT_EN, SOWING_RW, META_NOTE_RW } from './names.js';

// IREME - NISR data engine (pure JavaScript, no React).
// Reads backend/data/nisr_insights.json (built by backend/scripts/build_nisr_insights.py from the
// NISR Agricultural Household Survey 2024 microdata) and turns it into farm advice.
// Everything here is deterministic so the same logic can be tested in Node.

export const DISTRICT_COORDS = {
  Nyarugenge: [-1.95, 30.06], Gasabo: [-1.91, 30.10], Kicukiro: [-1.97, 30.10],
  Kamonyi: [-2.00, 29.90], Gicumbi: [-1.58, 30.07], Bugesera: [-2.15, 30.05],
  Nyanza: [-2.35, 29.75], Gisagara: [-2.60, 29.83], Nyaruguru: [-2.72, 29.57],
  Huye: [-2.60, 29.74], Nyamagabe: [-2.48, 29.56], Ruhango: [-2.22, 29.78],
  Muhanga: [-2.08, 29.75], Ngororero: [-1.87, 29.63], Karongi: [-2.00, 29.35],
  Rutsiro: [-1.95, 29.35], Rusizi: [-2.48, 28.90], Nyamasheke: [-2.35, 29.15],
  Rubavu: [-1.68, 29.26], Nyabihu: [-1.67, 29.50], Rulindo: [-1.75, 30.05],
  Gakenke: [-1.69, 29.78], Musanze: [-1.50, 29.63], Burera: [-1.47, 29.85],
  Rwamagana: [-1.95, 30.43], Kirehe: [-2.25, 30.70], Ngoma: [-2.15, 30.50],
  Kayonza: [-1.88, 30.63], Nyagatare: [-1.30, 30.33], Gatsibo: [-1.60, 30.40],
};
export const ALL_DISTRICTS = Object.keys(DISTRICT_COORDS).sort();

// Words people say or type for each crop in the survey (English + Kinyarwanda).
export const CROP_ALIASES = {
  'Maize': ['maize', 'corn', 'ibigori', 'igigori'],
  'Bush bean': ['bush bean', 'bush beans', 'beans', 'bean', 'ibishyimbo', 'ibishimbo'],
  'Climbing bean': ['climbing bean', 'climbing beans', 'ibishyimbo bizamuka'],
  'Irish potato': ['irish potato', 'irish potatoes', 'potato', 'potatoes', 'ibirayi', 'ikirayi'],
  'Sweet potato': ['sweet potato', 'sweet potatoes', 'ibijumba', 'ikijumba'],
  'Cassava': ['cassava', 'manioc', 'imyumbati', 'umuhogo'],
  'Paddy rice': ['rice', 'paddy rice', 'paddy', 'umuceri'],
  'Sorghum': ['sorghum', 'amasaka', 'isaka'],
  'Soybean': ['soybean', 'soybeans', 'soya', 'soy', 'soya beans'],
  'Groundnut': ['groundnut', 'groundnuts', 'peanut', 'peanuts', 'ubunyobwa'],
  'Pea': ['pea', 'peas', 'amashaza', 'ibishaza'],
  'Taro': ['taro', 'cocoyam', 'amateke', 'itete'],
  'Wheat': ['wheat', 'ingano'],
  'Tomato': ['tomato', 'tomatoes', 'inyanya'],
  'Cabbage': ['cabbage', 'cabbages', 'amashu', 'ishu'],
  'Eggplant': ['eggplant', 'aubergine', 'intoryi'],
  'Sun flower': ['sunflower', 'sun flower', 'ukwatsi'],
  'Onion': ['onion', 'onions', 'igitunguru', 'ibitunguru'],
  'Carrot': ['carrot', 'carrots', 'karoti'],
};
export { CROP_RW, cropName };
export { dayLabel };
export const SEASON_LABEL = {
  EN: { A: 'Season A (Sep–Feb)', B: 'Season B (Mar–Jun)', C: 'Season C (Jul–Aug)' },
  RW: { A: 'Igihembwe A (Nzeri–Gashyantare)', B: 'Igihembwe B (Werurwe–Kamena)', C: 'Igihembwe C (Nyakanga–Kanama)' },
};
export const sowText = (ins, season, key, lang) => (lang === 'RW' ? ((SOWING_RW[season] || {})[key] || '') : (((ins.meta.sowing_text || {})[season] || {})[key] || ''));
export const metaNote = (ins, lang) => (lang === 'RW' ? META_NOTE_RW : `${ins.meta.source}. ${ins.meta.caveat}`);
export const PRACTICE_KEYS = ['improved_seed', 'inorganic', 'organic', 'pesticide', 'irrigation', 'anti_erosion'];
const PRACTICE_NAME = {
  EN: { improved_seed: 'Improved seed', inorganic: 'Inorganic fertilizer', organic: 'Compost / manure', pesticide: 'Crop protection', irrigation: 'Irrigation', anti_erosion: 'Anti-erosion measures', intercrop: 'Intercropping' },
  RW: { improved_seed: 'Imbuto nziza', inorganic: 'Ifumbire mvaruganda', organic: 'Ifumbire y’imborera (compost)', pesticide: 'Kurinda ibihingwa', irrigation: 'Kuhira', anti_erosion: 'Kurwanya isuri', intercrop: 'Guhinga ibihingwa bivanze' },
};
export const practiceName = (k, lang = 'EN') => (PRACTICE_NAME[lang === 'RW' ? 'RW' : 'EN'][k] || k);
const T = (lang, en, rw) => (lang === 'RW' ? rw : en);
const fmt = (n) => (n == null ? '–' : Math.round(n).toLocaleString('en-US'));
const sgn = (n) => (n > 0 ? '+' : '') + Math.round(n);

// Rwanda's seasons (approximate calendar): A Sep-Feb, B Mar-Jun, C Jul-Aug.
export function currentSeason(date = new Date()) {
  const m = date.getMonth() + 1;
  if (m >= 9 || m <= 2) return 'A';
  if (m <= 6) return 'B';
  return 'C';
}

// ------------------------------------------------------------------ loading
let insightsPromise = null;
export function loadInsights(apiBase = '') {
  if (!insightsPromise) {
    insightsPromise = fetch('/nisr_insights.json')
      .then((r) => { if (!r.ok) throw new Error('static'); return r.json(); })
      .catch(() => fetch(`${apiBase}/api/nisr/insights`).then((r) => { if (!r.ok) throw new Error('api'); return r.json(); }))
      .catch((e) => { insightsPromise = null; throw e; });
  }
  return insightsPromise;
}

export const modelledCrops = (ins) => Object.keys(ins.crops).filter((c) => ins.crops[c].model);
export const knownCrops = (ins) => Object.keys(ins.crops);

// ------------------------------------------------------------------ prediction
// Median expected yield (kg/ha) for a farm, from the per-crop regression (evaluated at the crop's typical plot size).
export function predictYield(ins, { crop, district, season = 'A', areaHa = null, practices = {}, window = 'main' }) {
  const node = ins.crops[crop];
  const m = node && node.model;
  if (!m) return null;
  const c = m.coef;
  const s = m.seasons.includes(season) ? season : m.seasons[0];
  let z = c.intercept;
  z += c['d:' + district] != null ? c['d:' + district] : (c['d:Other'] || 0);
  if (c['s:' + s] != null) z += c['s:' + s];
  for (const p of PRACTICE_KEYS) if (practices[p]) z += c['p:' + p] || 0;
  if (practices.intercrop) z += c['p:intercrop'] || 0;
  if (window === 'early') z += c['w:early'] || 0;
  if (window === 'late') z += c['w:late'] || 0;
  // The survey plots are small (often well under 0.1 ha) and yield per hectare falls as plot size grows,
  // so we always evaluate the model at the crop's typical plot size (log_area term = 0) and only
  // multiply by the farmer's area to estimate a harvest total. We never extrapolate the plot-size effect.
  const rq = m.resid_q;
  const r = { median: Math.exp(z), low: Math.exp(z + rq['0.25']), high: Math.exp(z + rq['0.75']), season: s, areaHa: null };
  if (areaHa && areaHa > 0) {
    r.areaHa = areaHa;
    r.total = { median: r.median * areaHa, low: r.low * areaHa, high: r.high * areaHa };
  }
  return r;
}

function confidenceOf(node) {
  const m = node.model;
  if (!m) return { level: 'limited' };
  if (m.n >= 1000 && m.cv_r2 >= 0.15) return { level: 'good' };
  if (m.n >= 300) return { level: 'moderate' };
  return { level: 'limited' };
}
const CONF_TEXT = {
  EN: { good: 'Good: many survey plots support this advice, but individual farms still vary a lot.', moderate: 'Moderate: a fair number of survey plots; treat ranges as a guide.', limited: 'Limited: few survey plots; use only as a rough guide.' },
  RW: { good: 'Ikizere cyiza: imirima myinshi y’ubushakashatsi ishyigikira iyi nama, ariko buri murima uratandukanye.', moderate: 'Ikizere giciriritse: imirima iringaniye; fata imibare nk’icyerekezo.', limited: 'Ikizere gito: imirima mike; fata iyi nama nk’igereranya gusa.' },
};

// ------------------------------------------------------------------ weather
export function weatherSummary(daily) {
  if (!daily || !daily.precipitation_sum) return null;
  const rain = daily.precipitation_sum.reduce((a, b) => a + (b || 0), 0);
  const wetDays = (daily.precipitation_probability_max || []).filter((x) => x >= 60).length;
  const tmax = daily.temperature_2m_max || [];
  const avgMax = tmax.length ? tmax.reduce((a, b) => a + (b || 0), 0) / tmax.length : null;
  let level = 'mixed';
  if (rain >= 80 || wetDays >= 7) level = 'wet'; else if (rain <= 15 && wetDays <= 2) level = 'dry';
  return { rain, wetDays, avgMax, level, days: daily.time ? daily.time.length : 0 };
}
export function weatherTips(crop, ws, lang = 'EN') {
  if (!ws) return [];
  const wetCrops = ['Bush bean', 'Climbing bean', 'Irish potato', 'Tomato', 'Cabbage', 'Eggplant'];
  const tips = [];
  if (ws.level === 'wet') {
    tips.push(T(lang, `Wet spell ahead (about ${fmt(ws.rain)} mm in ${ws.days} days). Keep drainage channels open and avoid spraying just before rain.`,
      `Hateganyijwe imvura nyinshi (nka mm ${fmt(ws.rain)} mu minsi ${ws.days}). Fungura inzira z’amazi kandi wirinde gutera umuti imvura igiye kugwa.`));
    if (wetCrops.includes(crop)) tips.push(T(lang, `${cropName(crop)} is prone to fungal disease in wet weather. Inspect leaves after rain and remove badly affected plants.`,
      `Igihingwa ${rwOf(crop, 'cy')} cyibasirwa n’indwara z’uduhumyo mu mvura nyinshi. Genzura amababi nyuma y’imvura kandi ukure ibimera byarembye cyane.`));
  } else if (ws.level === 'dry') {
    tips.push(T(lang, 'Dry spell likely. Mulch to keep soil moisture, and do not rely on one forecast to decide planting.',
      'Hateganyijwe izuba ryinshi. Gumisha ubuhehere ukoresheje ibishingwe, kandi ntushingire ku iteganyagihe rimwe mu gutera.'));
    if (crop === 'Maize') tips.push(T(lang, 'After dry spells, check maize whorls for fall armyworm early.', 'Nyuma y’izuba ryinshi, genzura ibigori hakiri kare ko hatariho inyenzi z’ibigori (fall armyworm).'));
  } else {
    tips.push(T(lang, 'Rainfall looks mixed. Check local rain before sowing and keep drainage ready on slopes.',
      'Imvura iteganyijwe iratandukanye. Reba imvura y’aho uri mbere yo gutera kandi utegure inzira z’amazi ku misozi.'));
  }
  return tips;
}

// ------------------------------------------------------------------ advice
const SOIL_ADVICE = {
  erosion: { EN: 'Soil erosion is reported by many farmers here. Plant along contours, add grass strips and mulch.', RW: 'Isuri ivugwa n’abahinzi benshi aha. Tera ukurikije imirongo y’ubutaka, ushyireho ibyatsi bifata ubutaka kandi utwikire ubutaka.' },
  fertility_loss: { EN: 'Falling soil fertility is a common problem here. Add well-decomposed compost or manure and rotate with beans or other legumes.', RW: 'Kugabanuka k’uburumbuke bw’ubutaka ni ikibazo gikunze kuboneka aha. Shyiramo compost cyangwa ifumbire y’imborera yaboze neza kandi uhinduranye n’ibishyimbo.' },
  waterlogging: { EN: 'Waterlogging is a risk in this district. Dig drainage channels and avoid working saturated soil.', RW: 'Amazi menshi mu murima ni ikibazo muri aka karere. Cukura inzira z’amazi kandi wirinde guhinga ubutaka bwuzuye amazi.' },
  landslide: { EN: 'Landslide risk is higher than usual here. Avoid planting on very steep unprotected slopes and follow local authority guidance.', RW: 'Ibyago by’inkangu biri hejuru muri aka karere. Irinde guhinga ahahanamye cyane hadakingiye kandi ukurikize inama z’ubuyobozi.' },
};

export function advise(ins, { crop, district, season, areaHa = null, practices = {}, weather = null, lang = 'EN', stage = 'growing', irrigation = 'rainfed', soil = 'medium' }) {
  const node = ins.crops[crop];
  if (!node) return { ok: false, reason: 'unknown-crop' };
  const s = season || currentSeason();
  const dist = ins.districts[district] || null;
  const m = node.model || null;
  const out = { ok: true, crop, district, season: s, lang, recommendations: [], risks: [], notes: [], tips: [], practicesUsed: PRACTICE_KEYS.some((k) => practices[k]) };

  // benchmarks (typical plot yield from survey)
  const dNode = node.district[district] || null;
  const sNode = node.season[s] || null;
  out.benchmarks = {
    district: dNode ? { median: dNode.median, p25: dNode.p25, p75: dNode.p75, n: dNode.n } : null,
    national: { median: node.national.median, avg: node.national.avg, n: node.national.n },
    season: sNode ? { median: sNode.median, avg: sNode.avg, n: sNode.n } : null,
  };
  out.confidence = confidenceOf(node);
  out.confidenceText = CONF_TEXT[lang === 'RW' ? 'RW' : 'EN'][out.confidence.level];

  // expected yield for the practices the farmer already uses, and the "with recommended" scenario
  const windows = {};
  if (m) {
    out.expected = predictYield(ins, { crop, district, season: s, areaHa, practices });
  }

  // recommendations: practices not yet used with a clearly positive, well-supported effect
  if (m) {
    const share = (p) => (node.practices[p] ? node.practices[p].share : null);
    const nYes = (p) => (node.practices[p] ? node.practices[p].n_yes : 0);
    const cand = [];
    for (const p of PRACTICE_KEYS) {
      if (practices[p]) continue;
      const e = m.effects['p:' + p];
      if (!e || (e.lo === 0 && e.hi === 0)) continue;
      if (e.pct >= 8 && e.lo > 3 && nYes(p) >= 25) cand.push({ p, e });
    }
    cand.sort((a, b) => b.e.pct - a.e.pct);
    for (const { p, e } of cand.slice(0, 4)) {
      let detail;
      if (p === 'improved_seed') {
        detail = T(lang, `Plots with improved seed had about ${Math.round(e.pct)}% higher yield (likely ${Math.round(e.lo)}% to ${Math.round(e.hi)}%). ${Math.round((share(p) || 0) * 100)}% of ${cropName(crop)} plots in the survey used it. Buy certified seed from approved sellers (RAB / agro-dealers).`,
          `Imirima yakoresheje imbuto nziza yatanze umusaruro uri hejuru ya ${Math.round(e.pct)}% (hagati ya ${Math.round(e.lo)}% na ${Math.round(e.hi)}%). ${Math.round((share(p) || 0) * 100)}% by’imirima ${rwOf(crop, 'y')} mu bushakashatsi yazikoresheje. Gura imbuto zemewe ku bacuruzi bemewe (RAB / agro-dealers).`);
      } else if (p === 'inorganic') {
        const types = node.fertilizer_types ? Object.keys(node.fertilizer_types).join(', ') : '';
        detail = T(lang, `Plots using inorganic fertilizer had about ${Math.round(e.pct)}% higher yield (likely ${Math.round(e.lo)}% to ${Math.round(e.hi)}%).${types ? ` Farmers growing ${cropName(crop)} mostly used: ${types}.` : ''} Get the right type and amount from a soil test or your agronomist; do not guess doses.`,
          `Imirima yakoresheje ifumbire mvaruganda yatanze umusaruro uri hejuru ya ${Math.round(e.pct)}% (hagati ya ${Math.round(e.lo)}% na ${Math.round(e.hi)}%).${types ? ` Abahinzi ${rwOf(crop, 'b')} bakoresheje cyane: ${types}.` : ''} Baza umujyanama w’ubuhinzi ubwoko n’ingano bikwiye; ntukeke ingano.`);
      } else if (p === 'organic') {
        detail = T(lang, `Plots with compost or manure had about ${Math.round(e.pct)}% higher yield (likely ${Math.round(e.lo)}% to ${Math.round(e.hi)}%). Use well-decomposed material; it also protects the soil.`,
          `Imirima yashyizwemo compost cyangwa ifumbire y’imborera yatanze umusaruro uri hejuru ya ${Math.round(e.pct)}% (hagati ya ${Math.round(e.lo)}% na ${Math.round(e.hi)}%). Koresha iyabaye neza; irinda n’ubutaka.`);
      } else if (p === 'pesticide') {
        detail = T(lang, `Plots where the crop was protected against pests and disease had about ${Math.round(e.pct)}% higher yield (likely ${Math.round(e.lo)}% to ${Math.round(e.hi)}%). Scout the field every week; if you see damage, confirm the cause with an agronomist and use only registered products as the label says.`,
          `Imirima yarinzwe udukoko n’indwara yatanze umusaruro uri hejuru ya ${Math.round(e.pct)}% (hagati ya ${Math.round(e.lo)}% na ${Math.round(e.hi)}%). Genzura umurima buri cyumweru; nubona ibyangiritse, emeza ikibazo n’umujyanama w’ubuhinzi, ukoreshe imiti yemewe gusa nk’uko ibivuga.`);
      } else if (p === 'irrigation') {
        detail = T(lang, `Irrigated plots had about ${Math.round(e.pct)}% higher yield (likely ${Math.round(e.lo)}% to ${Math.round(e.hi)}%). Consider it where water is available, especially in dry spells.`,
          `Imirima yuhirwa yatanze umusaruro uri hejuru ya ${Math.round(e.pct)}% (hagati ya ${Math.round(e.lo)}% na ${Math.round(e.hi)}%). Tekereza kuhira aho amazi ahari, cyane mu gihe cy’izuba.`);
      } else {
        detail = T(lang, `Plots with anti-erosion measures had about ${Math.round(e.pct)}% higher yield (likely ${Math.round(e.lo)}% to ${Math.round(e.hi)}%). Use contour ridges, grass strips, mulch or terraces.`,
          `Imirima ifite uburyo bwo kurwanya isuri yatanze umusaruro uri hejuru ya ${Math.round(e.pct)}% (hagati ya ${Math.round(e.lo)}% na ${Math.round(e.hi)}%). Koresha imirongo, ibyatsi bifata ubutaka, ibishingwe cyangwa amaterasi.`);
      }
      out.recommendations.push({ key: p, title: practiceName(p, lang), detail, effectPct: e.pct, lo: e.lo, hi: e.hi, share: share(p), evidence: `n=${m.n}` });
    }

    // planting time
    const lateE = m.effects['w:late'];
    const sTxt = ins.meta.sowing_text && ins.meta.sowing_text[s];
    const planting = node.planting[s];
    if (sTxt && lateE && lateE.hi < -5) {
      const mainShare = planting && planting.main ? Math.round(planting.main.share * 100) : null;
      const lateTxt = sowText(ins, s, 'late', lang);
      const mainTxt = sowText(ins, s, 'main', lang);
      out.planting = { latePct: lateE.pct, window: mainTxt, late: lateTxt };
      out.recommendations.push({
        key: 'timing', title: T(lang, 'Plant on time', 'Tera ku gihe'),
        detail: T(lang, `${cropName(crop)} sown ${lateTxt} yielded about ${Math.abs(lateE.pct)}% less than crops sown on time (likely ${Math.abs(lateE.hi)}% to ${Math.abs(lateE.lo)}% less).${mainShare ? ` Most farmers (${mainShare}%) sowed ${mainTxt}.` : ''} Prepare land and seed early and sow when the rains are reliable.`,
          `Igihingwa ${rwOf(crop, 'cy')} cyateye ${lateTxt} cyatanze umusaruro uri munsi ya ${Math.abs(Math.round(lateE.pct))}% ugereranyije n’icyateye ku gihe (hagati ya ${Math.abs(Math.round(lateE.hi))}% na ${Math.abs(Math.round(lateE.lo))}% munsi).${mainShare ? ` Abahinzi benshi (${mainShare}%) bateye ${mainTxt}.` : ''} Tegura umurima n’imbuto hakiri kare kandi utere imvura imaze kuba nyinshi kandi yizewe.`),
        effectPct: lateE.pct, lo: lateE.lo, hi: lateE.hi, share: null, evidence: `n=${m.n}`,
      });
    }
    // mixed cropping note
    const ic = m.effects['p:intercrop'];
    if (ic && ic.hi < -5) {
      out.notes.push(T(lang, `Mixed planting lowers the yield of ${cropName(crop)} per hectare of its own area (about ${Math.round(ic.pct)}%), but you also harvest the other crop. Compare total harvest and income before deciding.`,
        `Guhinga ibihingwa bivanze bigabanya umusaruro ${rwOf(crop, 'w')} kuri hegitari y’ubuso bwawo (nka ${Math.round(ic.pct)}%), ariko usarura n’ikindi gihingwa. Gereranya umusaruro wose n’amafaranga mbere yo guhitamo.`));
    }

    // scenario with all recommended practices
    const withRec = { ...practices };
    out.recommendations.forEach((r) => { if (PRACTICE_KEYS.includes(r.key)) withRec[r.key] = true; });
    const timing = out.recommendations.some((r) => r.key === 'timing');
    out.scenario = predictYield(ins, { crop, district, season: s, areaHa, practices: withRec, window: 'main' });
    out.scenarioUsesAll = out.recommendations.filter((r) => PRACTICE_KEYS.includes(r.key)).length > 0 || timing;
  }

  // district risks
  if (dist) {
    const th = dist.soil_threats || {};
    const all = Object.values(ins.districts).map((d) => d.soil_threats || {});
    const med = (k) => { const v = all.map((t) => t[k] || 0).sort((a, b) => a - b); return v[Math.floor(v.length / 2)] || 0; };
    for (const k of ['erosion', 'fertility_loss', 'waterlogging', 'landslide']) {
      const v = th[k] || 0;
      if (v >= 0.05 && v >= 1.3 * med(k)) out.risks.push({ key: k, pct: Math.round(v * 100), detail: SOIL_ADVICE[k][lang === 'RW' ? 'RW' : 'EN'] });
    }
    out.risks.sort((a, b) => b.pct - a.pct);
    out.risks = out.risks.slice(0, 2);
    const ib = dist.irrigation_barriers || {};
    if ((ib.no_water || 0) >= 0.15) out.notes.push(T(lang, `${Math.round(ib.no_water * 100)}% of plots in ${district} say no water is available for irrigation. Consider rainwater harvesting and mulching.`, `${Math.round(ib.no_water * 100)}% by’imirima muri ${district} ivuga ko nta mazi yo kuhira ahari. Tekereza kubika amazi y’imvura no gutwikira ubutaka.`));
    if ((ib.cannot_afford || 0) >= 0.1) out.notes.push(T(lang, `${Math.round(ib.cannot_afford * 100)}% of plots in ${district} say irrigation is too costly. Ask your cooperative about shared pumps or low-cost drip kits.`, `${Math.round(ib.cannot_afford * 100)}% by’imirima muri ${district} ivuga ko kuhira bihenze. Baza koperative yawe ku mapombo asangiwe cyangwa uburyo buhendutse bwo kuhira.`));
  }

  // weather
  out.weather = weatherSummary(weather);
  // forecast + crop + growth stage + irrigation access + soil -> irrigation schedule, alerts, windows, stage tips
  out.agro = agronomyPlan(weather, { crop, stage, soil, irrigation }, lang);
  out.water = out.agro.water ? waterAdvice(out.agro.water, lang, crop) : [];
  out.tips = out.agro.hasForecast ? [] : weatherTips(crop, out.weather, lang);

  // farm-support context (cooperatives, farmer groups) for this district
  const hh = ins.households && ins.households.district && ins.households.district[district];
  if (hh && hh.cooperative != null && hh.cooperative < 0.15) out.notes.push(T(lang, `Only ${Math.round(hh.cooperative * 100)}% of surveyed households in ${district} belong to an agricultural cooperative. Cooperatives can help with certified seed, fertilizer, shared irrigation and markets; ask your sector agronomist.`, `${Math.round(hh.cooperative * 100)}% gusa by’ingo zabajijwe muri ${district} ni zo ziri muri koperative z’ubuhinzi. Koperative zishobora gufasha mu mbuto zemewe, ifumbire, kuhira dusangiye n’isoko; baza umujyanama w’ubuhinzi w’umurenge.`));

  // farmer-reported production trend
  if (node.trend) out.trend = node.trend;

  out.speech = speechFor(out, lang);
  return out;
}

export function speechFor(a, lang = 'EN') {
  if (!a.ok) return T(lang, 'I could not find that crop in the survey data.', 'Sinabonye icyo gihingwa mu makuru y’ubushakashatsi.');
  const parts = [];
  const place = a.district ? ` ${T(lang, 'in', 'muri')} ${a.district}` : '';
  // 1. urgent weather alerts and the irrigation / planting decision
  const ag = a.agro;
  if (ag && ag.hasForecast) {
    ag.alerts.filter((x) => x.level === 'high').slice(0, 2).forEach((x) => parts.push(x.text));
    if (ag.planting) parts.push(ag.planting.text);
    else if (a.water && a.water.length > 1) parts.push(a.water[1]);
  }
  // 2. what the survey says
  const ref = (a.benchmarks.district || a.benchmarks.national);
  if (ref) {
    parts.push(T(lang, `For ${cropName(a.crop)}${place}, a typical plot produced about ${fmt(ref.median)} kilograms per hectare in the NISR 2024 survey.`,
      `Ku gihingwa ${rwOf(a.crop, 'cy')}${place}, umurima usanzwe watanze nka kilogarama ${fmt(ref.median)} kuri hegitari mu bushakashatsi bwa NISR 2024.`));
  }
  if (a.expected) {
    const using = a.practicesUsed;
    parts.push(using
      ? T(lang, `With the practices you use, expect roughly ${fmt(a.expected.low)} to ${fmt(a.expected.high)} kilograms per hectare.`,
        `Ukoresheje uburyo usanzwe ukoresha, tegereza nka kilogarama ${fmt(a.expected.low)} kugeza ${fmt(a.expected.high)} kuri hegitari.`)
      : T(lang, `Without improved seed, fertilizer or crop protection, expect roughly ${fmt(a.expected.low)} to ${fmt(a.expected.high)} kilograms per hectare.`,
        `Nta mbuto nziza, ifumbire cyangwa kurinda igihingwa, tegereza nka kilogarama ${fmt(a.expected.low)} kugeza ${fmt(a.expected.high)} kuri hegitari.`));
  }
  a.recommendations.slice(0, 3).forEach((r, i) => parts.push(`${i + 1}. ${r.title}. ${r.detail}`));
  if (ag && ag.hasForecast) ag.alerts.filter((x) => x.level !== 'high').slice(0, 1).forEach((x) => parts.push(x.text));
  if (ag && ag.tips[0]) parts.push(ag.tips[0]);
  a.risks.slice(0, 1).forEach((r) => parts.push(r.detail));
  a.tips.slice(0, 1).forEach((t) => parts.push(t));
  parts.push(T(lang, 'These are survey patterns and forecast-based planning guides, not guarantees. Please confirm with your agronomist.', 'Ibi ni ibigaragara mu bushakashatsi n’inama zishingiye ku iteganyagihe, si ingwate. Nyamuneka emeza n’umujyanama w’ubuhinzi.'));
  return parts.join(' ');
}

// best crops for a district (relative to national medians of the same crop)
export function bestCrops(ins, district, limit = 5) {
  return (ins.ranking[district] || []).slice(0, limit);
}

// ------------------------------------------------------------------ statistics helpers
export function yieldByCrop(ins, season = 'all', limit = 12) {
  const rows = Object.entries(ins.crops).map(([crop, n]) => {
    const node = season === 'all' ? n.national : n.season[season];
    return node ? { crop, median: node.median, avg: node.avg, n: node.n } : null;
  }).filter(Boolean);
  rows.sort((a, b) => b.n - a.n);
  return rows.slice(0, limit);
}
export function yieldByDistrict(ins, crop) {
  const n = ins.crops[crop];
  if (!n) return [];
  return Object.entries(n.district).map(([district, v]) => ({ district, median: v.median, n: v.n })).sort((a, b) => b.median - a.median);
}
export function practiceEffects(ins, crop, lang = 'EN') {
  const n = ins.crops[crop];
  if (!n || !n.model) return [];
  return PRACTICE_KEYS.map((p) => {
    const e = n.model.effects['p:' + p];
    const pr = n.practices[p] || {};
    if (!e || (e.lo === 0 && e.hi === 0)) return null;
    return { key: p, label: practiceName(p, lang), pct: e.pct, lo: e.lo, hi: e.hi, share: Math.round((pr.share || 0) * 100), clear: e.lo > 0 || e.hi < 0 };
  }).filter(Boolean).sort((a, b) => b.pct - a.pct);
}
export function adoptionByCrop(ins, crops, lang = 'EN') {
  return crops.filter((c) => ins.crops[c]).map((c) => {
    const row = { crop: cropName(c, lang) };
    for (const p of PRACTICE_KEYS) row[p] = Math.round((((ins.crops[c].practices[p] || {}).share) || 0) * 100);
    return row;
  });
}
export function plantingFor(ins, crop, season, lang = 'EN') {
  const n = ins.crops[crop];
  const w = n && n.planting[season];
  if (!w) return [];
  return ['early', 'main', 'late'].filter((k) => w[k]).map((k) => ({ window: k, label: sowText(ins, season, k, lang) || k, median: w[k].median, share: Math.round(w[k].share * 100), n: w[k].n }));
}

// ------------------------------------------------------------------ Ask IREME helpers
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
export function findCrop(text, ins) {
  const t = ' ' + norm(text) + ' ';
  let best = null;
  for (const [crop, aliases] of Object.entries(CROP_ALIASES)) {
    if (ins && !ins.crops[crop]) continue;
    for (const a of aliases) {
      if (t.includes(' ' + norm(a) + ' ') && (!best || a.length > best.len)) best = { crop, len: a.length };
    }
  }
  return best ? best.crop : null;
}
export function findDistrict(text) {
  const t = ' ' + norm(text) + ' ';
  return ALL_DISTRICTS.find((d) => t.includes(' ' + norm(d) + ' ')) || null;
}
const INTENT_WORDS = {
  yield: ['yield', 'per hectare', 'how much can', 'how much will', 'expect', 'umusaruro kuri hegitari', 'kuri hegitari', 'ushobora kubona'],
  advice: ['advice', 'advise', 'improve', 'increase', 'boost', 'raise', 'better harvest', 'more harvest', 'grow better', 'how to grow', 'how can i grow', 'how do i grow', 'how should i grow', 'help me grow', 'kongera', 'inama', 'kunoza', 'guhinga neza', 'nahinga nte'],
  fertilizer: ['fertilizer', 'fertiliser', 'manure', 'compost', 'ifumbire'],
  seed: ['improved seed', 'seed', 'imbuto'],
  planting: ['when to plant', 'when should i plant', 'planting time', 'when to sow', 'plant on time', 'gutera ryari', 'igihe cyo gutera', 'nateramo ryari'],
  best: ['best crop', 'which crop', 'what crop', 'what should i plant', 'what should i grow', 'what to grow', 'what to plant', 'igihingwa cyiza', 'nahinga iki', 'ni iki nahinga'],
};
function has(t, key) { return INTENT_WORDS[key].some((w) => t.includes(norm(w))); }

// Returns { answer, topic, crop, district } or null so the caller can fall back to the general knowledge base.
export function answerQuestion(ins, question, { lang = 'EN', season = currentSeason(), weather = null, practices = {} } = {}) {
  if (!ins) return null;
  const t = norm(question);
  const crop = findCrop(question, ins);
  const district = findDistrict(question);
  const wantsBest = has(t, 'best');
  const wantsPlanting = has(t, 'planting');
  const wantsAny = has(t, 'yield') || has(t, 'advice') || has(t, 'fertilizer') || has(t, 'seed') || wantsPlanting;
  if (wantsBest && district) {
    const rows = bestCrops(ins, district, 4);
    if (!rows.length) return null;
    const list = rows.map((r) => `${cropName(r.crop, lang)} (${fmt(r.median)} kg/ha)`).join(', ');
    return { topic: 'best-crops', crop: null, district, answer: T(lang,
      `In ${district}, the crops with the best yields compared with the national typical yield (NISR 2024 survey) are: ${list}. Choose according to your soil, market and season, and confirm with your agronomist.`,
      `Muri ${district}, ibihingwa byatanze umusaruro mwiza ugereranyije n’uw’igihugu (ubushakashatsi bwa NISR 2024) ni: ${list}. Hitamo ukurikije ubutaka, isoko n’igihembwe, kandi wemeze n’umujyanama w’ubuhinzi.`) };
  }
  if (!crop || !wantsAny) return null;
  const d = district || null;
  const a = advise(ins, { crop, district: d, season, practices, weather, lang });
  if (!a.ok) return null;
  if (wantsPlanting) {
    const late = a.planting;
    const mainW = sowText(ins, season, 'main', lang);
    const base = T(lang, `For ${cropName(crop)} in ${SEASON_LABEL.EN[season]}, most farmers sowed ${mainW || 'in the main window'}.`,
      `Ku gihingwa ${rwOf(crop, 'cy')} mu ${SEASON_LABEL.RW[season].replace(/^I/, 'i')}, abahinzi benshi batera ${mainW || 'mu gihe nyamukuru'}.`);
    const extra = late ? T(lang, ` Sowing ${late.late} gave about ${Math.abs(Math.round(late.latePct))}% lower yield in the survey, so prepare early and sow when rains are reliable.`,
      ` Gutera nyuma (${late.late}) byatanze umusaruro uri munsi ya ${Math.abs(Math.round(late.latePct))}% mu bushakashatsi, bityo tegura hakiri kare kandi utere imvura yizewe.`) : '';
    return { topic: 'planting-time', crop, district: d, answer: base + extra };
  }
  const intro = a.speech;
  return { topic: 'nisr-advice', crop, district: d, answer: intro };
}

// ------------------------------------------------------------------ extra statistics helpers
// Plain-language findings for one crop, generated from the survey tables (used by the Statistics page and read aloud).
export function statsDigest(ins, crop, lang = 'EN') {
  const n = ins.crops[crop];
  if (!n) return [];
  const out = [];
  const nat = n.national;
  out.push(T(lang, `${cropName(crop)}: typical plot yield ${fmt(nat.median)} kg/ha (middle half of plots ${fmt(nat.p25)}–${fmt(nat.p75)}); average ${fmt(nat.avg)} kg/ha over ${nat.n.toLocaleString('en-US')} plots.`,
    `${cropName(crop, 'RW')}: umusaruro usanzwe kg ${fmt(nat.median)}/ha (igice cyo hagati ${fmt(nat.p25)}–${fmt(nat.p75)}); impuzandengo ${fmt(nat.avg)} kg/ha ku mirima ${nat.n.toLocaleString('en-US')}.`));
  const dd = yieldByDistrict(ins, crop);
  if (dd.length >= 4) {
    const top = dd[0]; const low = dd[dd.length - 1];
    out.push(T(lang, `Best district: ${top.district} (${fmt(top.median)} kg/ha). Lowest: ${low.district} (${fmt(low.median)} kg/ha), a gap of ${Math.round((top.median / low.median - 1) * 100)}%.`,
      `Akarere keza cyane: ${top.district} (${fmt(top.median)} kg/ha). Gafite make: ${low.district} (${fmt(low.median)} kg/ha), itandukaniro rya ${Math.round((top.median / low.median - 1) * 100)}%.`));
  }
  const sA = n.season.A; const sB = n.season.B;
  if (sA && sB) out.push(T(lang, `Season A median ${fmt(sA.median)} kg/ha versus Season B ${fmt(sB.median)} kg/ha (${sA.median >= sB.median ? 'A is higher' : 'B is higher'}).`, `Igihembwe A: ${fmt(sA.median)} kg/ha, igihembwe B: ${fmt(sB.median)} kg/ha (${sA.median >= sB.median ? 'A kiri hejuru' : 'B kiri hejuru'}).`));
  const eff = practiceEffects(ins, crop, lang).filter((e) => e.clear && e.pct > 0).slice(0, 2);
  eff.forEach((e) => out.push(T(lang, `${e.label}: plots using it had about ${Math.round(e.pct)}% higher yield (likely ${Math.round(e.lo)}% to ${Math.round(e.hi)}%); ${e.share}% of ${cropName(crop)} plots use it.`,
    `${e.label}: imirima iyikoresha yatanze umusaruro uri hejuru ya ${Math.round(e.pct)}% (hagati ya ${Math.round(e.lo)}% na ${Math.round(e.hi)}%); ${e.share}% by’imirima ${rwOf(crop, 'y')} iyikoresha.`)));
  if (n.trend) out.push(T(lang, `Farmers reported ${cropName(crop)} production went down on ${Math.round(n.trend.down * 100)}% of plots, stayed the same on ${Math.round(n.trend.same * 100)}% and went up on ${Math.round(n.trend.up * 100)}%.`,
    `Abahinzi bavuze ko umusaruro ${rwOf(crop, 'w')} wagabanutse ku ${Math.round(n.trend.down * 100)}% by’imirima, utahindutse ku ${Math.round(n.trend.same * 100)}% kandi wiyongereye ku ${Math.round(n.trend.up * 100)}%.`));
  if (n.fertilizer_types) out.push(T(lang, `Most used fertilizers on ${cropName(crop)}: ${Object.entries(n.fertilizer_types).map(([k, v]) => `${k} (${Math.round(v * 100)}%)`).join(', ')}.`, `Ifumbire ikoreshwa cyane ku gihingwa ${rwOf(crop, 'cy')}: ${Object.entries(n.fertilizer_types).map(([k, v]) => `${k} (${Math.round(v * 100)}%)`).join(', ')}.`));
  return out;
}
export function districtTable(ins, crop) {
  const n = ins.crops[crop];
  if (!n) return [];
  return Object.entries(n.district).map(([district, v]) => {
    const dd = ins.districts[district] || { adoption: {} };
    return { district, median: v.median, p25: v.p25, p75: v.p75, n: v.n, vsNational: Math.round((v.median / n.national.median - 1) * 100),
      improved_seed: Math.round(((dd.adoption || {}).improved_seed || 0) * 100), inorganic: Math.round(((dd.adoption || {}).inorganic || 0) * 100) };
  }).sort((a, b) => b.median - a.median);
}
export function householdSupport(ins, lang = 'EN') {
  const h = ins.households && ins.households.national;
  if (!h) return [];
  const L = { cooperative: ['In an agricultural cooperative', 'Muri koperative y’ubuhinzi'], twigire: ['Twigire Muhinzi group', 'Itsinda rya Twigire Muhinzi'], field_school: ['Farmer field school', 'Ishuri ry’abahinzi (FFS)'], contract_farming: ['Contract farming', 'Ubuhinzi bushingiye ku masezerano'], crop_insurance: ['Crop insurance', 'Ubwishingizi bw’ibihingwa'], kitchen_garden: ['Kitchen garden', 'Akarima k’igikoni'], support_received: ['Received farm support or grant', 'Yabonye inkunga y’ubuhinzi'], loan_tried: ['Tried to get a loan', 'Yagerageje gusaba inguzanyo'] };
  return Object.keys(L).filter((k) => h[k] != null).map((k) => ({ key: k, label: L[k][lang === 'RW' ? 1 : 0], pct: Math.round(h[k] * 1000) / 10 }));
}
export function lowestSupport(ins, key = 'cooperative', limit = 5) {
  const d = (ins.households && ins.households.district) || {};
  return Object.entries(d).filter(([, v]) => v[key] != null).map(([name, v]) => ({ district: name, pct: Math.round(v[key] * 1000) / 10 })).sort((a, b) => a.pct - b.pct).slice(0, limit);
}
export function trendByCrop(ins, limit = 12) {
  return Object.entries(ins.crops).filter(([, n]) => n.trend).sort((a, b) => b[1].n - a[1].n).slice(0, limit).map(([crop, n]) => ({ crop, down: Math.round(n.trend.down * 100), same: Math.round(n.trend.same * 100), up: Math.round(n.trend.up * 100) }));
}
export function spreadByCrop(ins, limit = 8) {
  return Object.entries(ins.crops).sort((a, b) => b[1].n - a[1].n).slice(0, limit).map(([crop, n]) => ({ crop, p25: n.national.p25, median: n.national.median, p75: n.national.p75 }));
}
