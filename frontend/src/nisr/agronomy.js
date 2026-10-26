// IREME - agronomy engine (pure JavaScript, testable in Node).
// Turns a weather forecast + crop + growth stage + irrigation access + soil type into practical actions:
// an irrigation schedule from a simple daily soil-water balance, spray / field-work / drying windows,
// disease and heat/cold alerts, planting readiness and stage-specific tips.
// Crop water use follows the FAO-56 idea: crop water need = reference evapotranspiration (ET0) x crop coefficient (Kc).
// Numbers are planning guides, not measurements of one field - the advice always says so.

const T = (lang, en, rw) => (lang === 'RW' ? rw : en);

export const STAGES = ['not_planted', 'just_planted', 'growing', 'flowering', 'near_harvest'];
export const STAGE_LABEL = {
  EN: { not_planted: 'Not planted yet', just_planted: 'Just planted / germinating', growing: 'Growing (leaves and stems)', flowering: 'Flowering / fruit or grain filling', near_harvest: 'Near harvest' },
  RW: { not_planted: 'Sindaterwa', just_planted: 'Maze gutera / biri kumera', growing: 'Biri gukura (amababi n’ibiti)', flowering: 'Biri kuzana indabyo / kwera', near_harvest: 'Hafi gusarura' },
};
export const IRRIGATION = ['rainfed', 'can_irrigate'];
export const IRRIGATION_LABEL = {
  EN: { rainfed: 'Rain only (no irrigation)', can_irrigate: 'I can irrigate (drip, watering can, canal or pump)' },
  RW: { rainfed: 'Imvura gusa (nta kuhira)', can_irrigate: 'Nshobora kuhira (drip, isuka, umuyoboro cyangwa pompe)' },
};
export const SOILS = ['light', 'medium', 'heavy'];
export const SOIL_LABEL = {
  EN: { light: 'Light / sandy (dries fast)', medium: 'Medium / loam', heavy: 'Heavy / clay (holds water)' },
  RW: { light: 'Umusenyi (wuma vuba)', medium: 'Ubutaka busanzwe (loam)', heavy: 'Ibumba (rifata amazi)' },
};
// Readily available soil water in the root zone (mm) and a sensible irrigation amount per event (mm).
const SOIL = { light: { cap: 25, event: 12, gap: 'every 2–3 days', gapRW: 'buri minsi 2–3' }, medium: { cap: 45, event: 22, gap: 'every 4–5 days', gapRW: 'buri minsi 4–5' }, heavy: { cap: 60, event: 30, gap: 'every 6–7 days', gapRW: 'buri minsi 6–7' } };

// kc = crop coefficient (initial / mid-season / late); heat & cold in °C; critical = most water-sensitive stage.
export const CROP_AGRO = {
  'Maize': { kc: [0.4, 1.2, 0.6], heat: 35, cold: 8, critical: 'flowering', crit: ['Tasseling and silking is the most water-sensitive time for maize.', 'Gutera indabyo n’ubwoya bw’ibigori (silking) ni cyo gihe ibigori bikenera amazi cyane.'], scout: ['fall armyworm in the whorl, maize streak and leaf blight', 'inyenzi z’ibigori (fall armyworm), maize streak n’indwara z’amababi'] },
  'Bush bean': { kc: [0.4, 1.05, 0.35], heat: 32, cold: 8, critical: 'flowering', crit: ['Flowering and pod filling are the most water-sensitive stages for beans.', 'Kuzana indabyo no kwera imiteja ni ibihe ibishyimbo bikenera amazi cyane.'], scout: ['angular leaf spot, rust and anthracnose, bean stem maggot', 'angular leaf spot, rust, anthracnose n’isazi y’ibishyimbo'] },
  'Climbing bean': { kc: [0.4, 1.15, 0.35], heat: 32, cold: 8, critical: 'flowering', crit: ['Flowering and pod filling are the most water-sensitive stages for beans.', 'Kuzana indabyo no kwera imiteja ni ibihe ibishyimbo bikenera amazi cyane.'], scout: ['angular leaf spot, rust and anthracnose; keep stakes firm', 'angular leaf spot, rust, anthracnose; komeza imambo zikomeye'] },
  'Irish potato': { kc: [0.5, 1.15, 0.75], heat: 29, cold: 2, critical: 'flowering', crit: ['Tuber initiation and bulking need steady moisture; avoid both drought and waterlogging.', 'Gutangira no kubyimba kw’ibirayi bikenera ubuhehere buhoraho; irinde izuba ryinshi n’amazi menshi.'], scout: ['late blight (dark spots, white mould under leaves) and bacterial wilt', 'late blight (ibibara by’umukara) na bacterial wilt'] },
  'Sweet potato': { kc: [0.5, 1.15, 0.65], heat: 36, cold: 10, critical: 'growing', crit: ['Root bulking needs moisture; avoid waterlogging that rots roots.', 'Kubyimba kw’ibijumba bikenera ubuhehere; irinde amazi menshi ashyira imizi.'], scout: ['sweet potato weevil and virus; use clean vines', 'inyenzi z’ibijumba n’virusi; koresha imitumba isukuye'] },
  'Cassava': { kc: [0.4, 0.8, 0.5], heat: 38, cold: 12, critical: 'just_planted', crit: ['Cassava tolerates dry spells once established; the first three months need clean weeding and moisture.', 'Imyumbati yihanganira izuba imaze gukura; amezi atatu ya mbere akeneye gukura ibyatsi n’ubuhehere.'], scout: ['cassava mosaic and brown streak: plant clean, disease-free cuttings', 'cassava mosaic na brown streak: tera imitumba isukuye idafite indwara'] },
  'Paddy rice': { kc: [1.05, 1.2, 0.9], heat: 35, cold: 15, critical: 'flowering', crit: ['Flowering and grain filling are critical; keep water managed and avoid cold nights.', 'Kuzana indabyo no kwera ni ibihe by’ingenzi; genzura amazi kandi wirinde ijoro rikonje.'], scout: ['rice blast and sheath blight', 'rice blast na sheath blight'] },
  'Sorghum': { kc: [0.4, 1.0, 0.55], heat: 38, cold: 10, critical: 'flowering', crit: ['Boot to grain filling is the most water-sensitive period.', 'Kuva ku mbuto kugeza kwera ni cyo gihe gikeneye amazi cyane.'], scout: ['birds at grain fill, head smut, stem borer', 'inyoni, head smut n’ibyonnyi by’ibiti'] },
  'Soybean': { kc: [0.4, 1.15, 0.5], heat: 35, cold: 10, critical: 'flowering', crit: ['Flowering and pod filling are the most water-sensitive stages.', 'Kuzana indabyo no kwera ni ibihe bikenera amazi cyane.'], scout: ['soybean rust and leaf diseases', 'soybean rust n’indwara z’amababi'] },
  'Groundnut': { kc: [0.4, 1.05, 0.6], heat: 36, cold: 12, critical: 'flowering', crit: ['Flowering and pod formation (pegging) need moisture; dry the harvest well to avoid aflatoxin.', 'Kuzana indabyo no gukora imbuto bikenera ubuhehere; yumisha umusaruro neza wirinde aflatoxin.'], scout: ['leaf spot and rosette virus', 'leaf spot na rosette virus'] },
  'Tomato': { kc: [0.6, 1.15, 0.8], heat: 32, cold: 10, critical: 'flowering', crit: ['Flowering and fruit set need regular, even watering (uneven watering causes cracking and blossom-end rot).', 'Kuzana indabyo no kwera bikenera kuhira buri gihe kungana; kuhira bidahwitse bitera gucika n’ibibara.'], scout: ['late blight, bacterial wilt and leaf miner', 'late blight, bacterial wilt n’udukoko tw’amababi'] },
  'Cabbage': { kc: [0.7, 1.05, 0.95], heat: 30, cold: 4, critical: 'growing', crit: ['Head formation needs even moisture.', 'Gukora umutwe w’ishu bikenera ubuhehere bungana.'], scout: ['diamondback moth, aphids and black rot', 'diamondback moth, udukoko tw’amababi na black rot'] },
  'Pea': { kc: [0.5, 1.15, 0.3], heat: 30, cold: 2, critical: 'flowering', crit: ['Flowering and pod filling need moisture.', 'Kuzana indabyo no kwera bikenera ubuhehere.'], scout: ['powdery mildew and aphids', 'powdery mildew n’udukoko tw’amababi'] },
  'Wheat': { kc: [0.4, 1.15, 0.4], heat: 32, cold: 2, critical: 'flowering', crit: ['Booting to grain filling is the most water-sensitive period.', 'Kuva ku mbuto kugeza kwera ni cyo gihe gikeneye amazi cyane.'], scout: ['yellow and stem rust', 'yellow rust na stem rust'] },
  'Eggplant': { kc: [0.6, 1.05, 0.9], heat: 34, cold: 12, critical: 'flowering', crit: ['Flowering and fruit set need steady moisture.', 'Kuzana indabyo no kwera bikenera ubuhehere buhoraho.'], scout: ['bacterial wilt and fruit borer', 'bacterial wilt n’udukoko tw’imbuto'] },
  'Taro': { kc: [1.0, 1.15, 1.1], heat: 35, cold: 10, critical: 'growing', crit: ['Taro likes wet soil but not standing water for long.', 'Amateke akunda ubutaka butose ariko atarimo amazi ahagaze igihe kirekire.'], scout: ['taro leaf blight', 'taro leaf blight'] },
};
const DEFAULT_AGRO = { kc: [0.5, 1.05, 0.6], heat: 34, cold: 8, critical: 'flowering', crit: ['Flowering and fruit or grain filling are usually the most water-sensitive stages.', 'Kuzana indabyo no kwera ni ibihe bikenera amazi cyane.'], scout: ['pests and leaf diseases', 'udukoko n’indwara z’amababi'] };
export const agroFor = (crop) => CROP_AGRO[crop] || DEFAULT_AGRO;

// ------------------------------------------------------------------ forecast helpers
export function forecastDays(daily, n = 7) {
  if (!daily || !daily.time) return [];
  const out = [];
  for (let i = 0; i < Math.min(n, daily.time.length); i++) {
    out.push({
      date: daily.time[i], rain: (daily.precipitation_sum || [])[i] || 0, prob: (daily.precipitation_probability_max || [])[i] ?? null,
      tmax: (daily.temperature_2m_max || [])[i], tmin: (daily.temperature_2m_min || [])[i],
      et0: (daily.et0_fao_evapotranspiration || [])[i], wind: (daily.wind_speed_10m_max || [])[i],
    });
  }
  return out;
}
export function dayLabel(iso, lang = 'EN') {
  const d = new Date(iso + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(lang === 'RW' ? 'en-GB' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
const DEFAULT_ET0 = 3.8;      // mm/day, typical Rwandan highland value when the forecast gives none
export const effectiveRain = (r) => (r < 1 ? 0 : Math.min(r, 25) * 0.8 + Math.max(0, r - 25) * 0.2);
export function kcFor(crop, stage) {
  const [ini, mid, end] = agroFor(crop).kc;
  return ({ not_planted: 0, just_planted: ini, growing: (ini + mid) / 2, flowering: mid, near_harvest: end })[stage] ?? mid;
}

// ------------------------------------------------------------------ water balance and irrigation schedule
export function waterPlan(daily, { crop, stage = 'growing', soil = 'medium', irrigation = 'rainfed' }) {
  const days = forecastDays(daily, 7);
  if (!days.length || stage === 'not_planted') return null;
  const kc = kcFor(crop, stage);
  const s = SOIL[soil] || SOIL.medium;
  let store = 0.6 * s.cap;
  const schedule = [];
  let stressDays = 0; let firstStress = null; let demand = 0; let eff = 0; let applied = 0;
  const usedEt0 = days.some((d) => d.et0 != null);
  days.forEach((d) => {
    const need = (d.et0 != null ? d.et0 : DEFAULT_ET0) * kc;
    const er = effectiveRain(d.rain);
    demand += need; eff += er;
    store = Math.min(s.cap, Math.max(0, store + er - need));          // surplus drains away
    if (irrigation === 'can_irrigate' && store < 0.3 * s.cap) {
      const bigRainSoon = d.rain >= 8 && (d.prob == null || d.prob >= 60);
      if (!bigRainSoon) {
        const add = Math.min(s.event, s.cap - store);
        store += add; applied += add; schedule.push({ date: d.date, mm: Math.round(add) });
        return;
      }
    }
    if (store < 0.2 * s.cap) { stressDays += 1; if (!firstStress) firstStress = d.date; }
  });
  const deficit = Math.max(0, demand - eff - s.cap * 0.4);
  let status = 'balanced';
  if (eff > demand * 1.6 && days.reduce((a, d) => a + d.rain, 0) >= 60) status = 'surplus';
  else if (stressDays >= 3 || deficit > 25) status = 'severe';
  else if (stressDays >= 1 || deficit > 8) status = 'deficit';
  return {
    kc: Math.round(kc * 100) / 100, demand: Math.round(demand), effectiveRain: Math.round(eff), rain: Math.round(days.reduce((a, d) => a + d.rain, 0)),
    status, stressDays, firstStress, schedule, applied: Math.round(applied), perEvent: s.event, gap: s.gap, gapRW: s.gapRW,
    et0Source: usedEt0 ? 'forecast' : 'typical', irrigation, soil, critical: agroFor(crop).critical === stage,
  };
}

// ------------------------------------------------------------------ field windows (best days)
export function fieldWindows(daily) {
  const days = forecastDays(daily, 7);
  const dry = (d) => d.rain < 1 && (d.prob == null || d.prob <= 30);
  return {
    spray: days.filter((d) => dry(d) && (d.wind == null || d.wind <= 25)).map((d) => d.date),
    harvest: days.filter(dry).map((d) => d.date),
    fieldwork: days.filter((d) => d.rain <= 5 && (d.prob == null || d.prob <= 60)).map((d) => d.date),
  };
}

// ------------------------------------------------------------------ alerts
export function weatherAlerts(daily, { crop, stage = 'growing' }, lang = 'EN') {
  const days = forecastDays(daily, 7);
  if (!days.length) return [];
  const a = agroFor(crop);
  const alerts = [];
  const rainyDays = days.filter((d) => d.rain >= 1).length;
  const heavy = days.filter((d) => d.rain >= 30);
  const rain7 = days.reduce((x, d) => x + d.rain, 0);
  const tmean = days.reduce((x, d) => x + ((d.tmax ?? 22) + (d.tmin ?? 12)) / 2, 0) / days.length;
  const dryRun = (() => { let best = 0; let cur = 0; days.forEach((d) => { if (d.rain < 1) { cur += 1; best = Math.max(best, cur); } else cur = 0; }); return best; })();

  if (heavy.length) alerts.push({ key: 'heavy_rain', level: 'high', text: T(lang, `Heavy rain (30 mm or more) is forecast on ${heavy.map((d) => dayLabel(d.date)).join(', ')}. Clear drains, protect bare slopes, and delay spraying, fertilizer application and harvest of mature crops if you can.`, `Hateganyijwe imvura nyinshi (mm 30 cyangwa zirenga) ku ${heavy.map((d) => dayLabel(d.date)).join(', ')}. Fungura inzira z’amazi, urinde imisozi idatwikiriye, kandi ugerageze gutinza gutera umuti, ifumbire no gusarura ibihingwa bihishije.`) });
  const late = ['Irish potato', 'Tomato'].includes(crop);
  const foliar = ['Bush bean', 'Climbing bean', 'Soybean', 'Groundnut', 'Pea', 'Wheat', 'Cabbage', 'Eggplant', 'Maize', 'Paddy rice'].includes(crop);
  if (rainyDays >= 4 && tmean < 24 && (late || foliar)) {
    const lvl = rainyDays >= 5 ? 'high' : 'medium';
    alerts.push({ key: 'disease', level: lvl, text: T(lang, `Wet and mild weather (${rainyDays} rainy days in the next 7) favours fungal diseases of ${crop}. Scout every 2–3 days for ${a.scout[0]}, remove badly infected plants, and avoid working in wet fields.`, `Ikirere gitose kandi gishyushye bike (iminsi ${rainyDays} y’imvura mu 7 iri imbere) gikundira indwara z’uduhumyo ku ${crop}. Genzura buri minsi 2–3: ${a.scout[1]}, ukure ibimera byarembye cyane, wirinde gukorera mu murima utose.`) });
  } else if (rainyDays >= 3 && late) {
    alerts.push({ key: 'disease', level: 'medium', text: T(lang, `Some wet days ahead: check ${crop} leaves for ${a.scout[0]} after each rain.`, `Hari iminsi y’imvura: genzura amababi ya ${crop} nyuma ya buri mvura (${a.scout[1]}).`) });
  }
  if (dryRun >= 5 && days.some((d) => (d.tmax ?? 0) >= 26) && ['Maize', 'Sorghum'].includes(crop)) alerts.push({ key: 'armyworm', level: 'medium', text: T(lang, `A dry, warm spell (${dryRun} dry days) favours fall armyworm. Check the whorls and leaves early in the morning and ask your extension officer about control if you find larvae.`, `Izuba ryinshi n’ubushyuhe (iminsi ${dryRun} nta mvura) bikundira inyenzi z’ibigori. Genzura imitwe n’amababi mu gitondo, ubaze umujyanama w’ubuhinzi uko zirwanywa nubona izo nyenzi.`) });
  const hot = days.filter((d) => d.tmax != null && d.tmax >= a.heat);
  if (hot.length && stage !== 'not_planted') alerts.push({ key: 'heat', level: stage === 'flowering' ? 'high' : 'medium', text: T(lang, `Very hot days (${Math.round(Math.max(...hot.map((d) => d.tmax)))}°C) are forecast. Heat can cause flower drop and poor ${crop} yields${stage === 'flowering' ? ' at flowering' : ''}; keep soil moist and mulched.`, `Hateganyijwe iminsi ishyushye cyane (${Math.round(Math.max(...hot.map((d) => d.tmax)))}°C). Ubushyuhe bushobora gutuma indabyo zigwa n’umusaruro wa ${crop} ukagabanuka; gumisha ubutaka butose kandi ubutwikire.`) });
  const cold = days.filter((d) => d.tmin != null && d.tmin <= a.cold);
  if (cold.length && stage !== 'not_planted') alerts.push({ key: 'cold', level: 'medium', text: T(lang, `Cold nights (${Math.round(Math.min(...cold.map((d) => d.tmin)))}°C) are forecast. ${crop} can be damaged by cold; cover young plants if possible.`, `Hateganyijwe amajoro akonje (${Math.round(Math.min(...cold.map((d) => d.tmin)))}°C). ${crop} gishobora kwangizwa n’imbeho; utwikire ibimera bito niba bishoboka.`) });
  if (stage === 'near_harvest' && rain7 >= 25) alerts.push({ key: 'harvest_wet', level: 'high', text: T(lang, 'Rain is forecast near harvest. Harvest on the driest days, dry the crop on tarpaulins or raised racks, and store only well-dried produce (about 13–14% moisture for grain) in clean, dry bags to avoid mould and aflatoxin.', 'Hateganyijwe imvura hafi y’isarura. Sarura ku minsi yumutse cyane, wumishe umusaruro ku mpuzankano cyangwa ku bishyigikiye, kandi ubike gusa umusaruro wumye neza (nka 13–14% by’ubuhehere ku mbuto) mu mifuka isukuye kandi yumutse wirinde ibumba na aflatoxin.') });
  return alerts;
}

// ------------------------------------------------------------------ planting readiness
export function plantingReadiness(daily, lang = 'EN') {
  const days = forecastDays(daily, 14);
  if (days.length < 7) return null;
  const r7 = days.slice(0, 7).reduce((a, d) => a + d.rain, 0);
  const r14 = days.reduce((a, d) => a + d.rain, 0);
  const wet7 = days.slice(0, 7).filter((d) => d.rain >= 1).length;
  const bigDays = days.slice(0, 7).filter((d) => d.rain >= 25).length;
  let level; let text;
  if (r7 > 140 || bigDays >= 3) { level = 'too_wet'; text = T(lang, `Very wet week ahead (${Math.round(r7)} mm). Wait for the heaviest rain to pass before sowing; prepare drainage and contour lines to stop soil being washed away.`, `Icyumweru gitose cyane (mm ${Math.round(r7)}). Tegereza imvura nyinshi ishire mbere yo gutera; tegura inzira z’amazi n’imirongo irinda isuri.`); }
  else if (r7 >= 25 && wet7 >= 3 && r14 >= 50) { level = 'good'; text = T(lang, `Rain looks regular (${Math.round(r7)} mm in 7 days, ${wet7} rainy days). Good conditions to sow once the soil is moist 10–15 cm down; use certified seed and sow on time.`, `Imvura isa nk’ihoraho (mm ${Math.round(r7)} mu minsi 7, iminsi ${wet7} y’imvura). Ni igihe cyiza cyo gutera ubutaka bumaze gutoha cm 10–15; koresha imbuto zemewe kandi utere ku gihe.`); }
  else if (r7 < 10) { level = 'wait'; text = T(lang, `Little rain is forecast (${Math.round(r7)} mm in 7 days). Prepare the land, but wait for reliable rain before sowing, or sowing may fail.`, `Imvura nke iteganyijwe (mm ${Math.round(r7)} mu minsi 7). Tegura umurima, utegereze imvura yizewe mbere yo gutera, bitabaye ibyo imbuto zishobora kudashibuka.`); }
  else { level = 'partial'; text = T(lang, `Rain is patchy (${Math.round(r7)} mm in 7 days). Prepare now and sow after 2–3 good rainy days in a row.`, `Imvura ntihoraho (mm ${Math.round(r7)} mu minsi 7). Tegura none, utere nyuma y’iminsi 2–3 y’imvura ikurikirana.`); }
  return { level, text, rain7: Math.round(r7), rain14: Math.round(r14), wetDays: wet7 };
}

// ------------------------------------------------------------------ growth-stage tips
export function stageTips(crop, stage, lang = 'EN') {
  const a = agroFor(crop);
  const tips = [];
  if (stage === 'not_planted') tips.push(T(lang, 'Before sowing: test or inspect the soil, plan drainage and erosion control, and prepare certified seed and compost.', 'Mbere yo gutera: suzuma ubutaka, utegure inzira z’amazi no kurwanya isuri, kandi utegure imbuto zemewe na compost.'));
  if (stage === 'just_planted') tips.push(T(lang, 'Keep the seedbed moist but not waterlogged. Re-sow gaps within 1–2 weeks and keep the field free of weeds.', 'Gumisha ubutaka butose ariko butarimo amazi menshi. Ongera utere ahatameze mu byumweru 1–2 kandi ukure ibyatsi.'));
  if (stage === 'growing') tips.push(T(lang, `Weed early and keep the crop evenly fed. Scout every week for ${a.scout[0]}.`, `Kura ibyatsi hakiri kare kandi ugaburire igihingwa kungana. Genzura buri cyumweru: ${a.scout[1]}.`));
  if (stage === 'flowering') tips.push(T(lang, `${a.crit[0]} Avoid stress now: keep soil moist and do not disturb the roots.`, `${a.crit[1]} Irinde ibibazo ubu: gumisha ubutaka butose kandi ntukore ku mizi.`));
  if (stage === 'near_harvest') tips.push(T(lang, 'Stop irrigation as the crop matures, harvest at the right maturity on a dry day, and dry and sort before storage or sale.', 'Hagarika kuhira igihingwa gihishije, usarure igihe gikwiye ku munsi wumutse, kandi wumishe kandi utoranye mbere yo kubika cyangwa kugurisha.'));
  if (stage !== 'flowering' && stage !== 'near_harvest' && stage !== 'not_planted') tips.push(T(lang, a.crit[0], a.crit[1]));
  return tips;
}

// ------------------------------------------------------------------ one call used by the advisor
export function agronomyPlan(daily, opts, lang = 'EN') {
  const { crop, stage = 'growing', soil = 'medium', irrigation = 'rainfed' } = opts;
  const plan = { stage, soil, irrigation, alerts: [], tips: stageTips(crop, stage, lang), water: null, windows: null, planting: null, hasForecast: !!(daily && daily.time) };
  if (!plan.hasForecast) return plan;
  plan.alerts = weatherAlerts(daily, { crop, stage }, lang);
  plan.windows = fieldWindows(daily);
  if (stage === 'not_planted') plan.planting = plantingReadiness(daily, lang);
  else plan.water = waterPlan(daily, { crop, stage, soil, irrigation });
  return plan;
}

// Plain-language irrigation advice from a water plan.
export function waterAdvice(w, lang = 'EN', crop = '') {
  if (!w) return [];
  const out = [];
  const s = SOIL[w.soil] || SOIL.medium;
  const intro = T(lang, `Next 7 days: crop water need about ${w.demand} mm (ET0 ${w.et0Source === 'forecast' ? 'from the forecast' : 'typical value'} × crop factor ${w.kc}) against about ${w.effectiveRain} mm of useful rain (${w.rain} mm forecast).`,
    `Iminsi 7 iri imbere: igihingwa gikeneye nka mm ${w.demand} (ET0 ${w.et0Source === 'forecast' ? 'ivuye mu iteganyagihe' : 'isanzwe'} × ikigereranyo ${w.kc}) naho imvura ifasha ni nka mm ${w.effectiveRain} (mm ${w.rain} ziteganyijwe).`);
  out.push(intro);
  if (w.status === 'surplus') out.push(T(lang, 'Rain will exceed crop needs. Do not irrigate; keep drains open to avoid waterlogging and root disease.', 'Imvura izarenga ibyo igihingwa gikeneye. Ntukuhire; fungura inzira z’amazi wirinde amazi menshi n’indwara z’imizi.'));
  else if (w.irrigation === 'can_irrigate') {
    if (w.schedule.length) {
      const list = w.schedule.map((e) => `${dayLabel(e.date)} (${e.mm} mm)`).join(', ');
      out.push(T(lang, `Suggested irrigation: ${list}. 1 mm is 1 litre per square metre, so ${w.schedule[0].mm} mm is about ${w.schedule[0].mm * 100} litres on a 10 m × 10 m bed. Water early morning or late evening, soaking the root zone rather than the leaves.`,
        `Kuhira bisabwa: ${list}. mm 1 ni litiro 1 kuri metero kare, bityo mm ${w.schedule[0].mm} ni nka litiro ${w.schedule[0].mm * 100} ku murima wa m 10 × m 10. Hira mu gitondo cya kare cyangwa nimugoroba, ushyire amazi ku mizi aho kuyashyira ku mababi.`));
    } else out.push(T(lang, 'Soil moisture should stay adequate this week; no irrigation is needed unless the weather changes.', 'Ubuhehere bw’ubutaka buzaba buhagije muri iki cyumweru; nta kuhira gukenewe keretse ikirere gihindutse.'));
  } else if (w.status === 'deficit' || w.status === 'severe') {
    out.push(T(lang, `Rain alone may not meet crop needs${w.firstStress ? ` (stress possible from ${dayLabel(w.firstStress)})` : ''}. Mulch the soil, weed carefully so weeds do not steal water, and avoid fertilizer until rain returns.${w.critical ? ' This is a critical stage, so protect moisture now.' : ''}`,
      `Imvura yonyine ishobora kudahaza ibyo igihingwa gikeneye${w.firstStress ? ` (guhangayika bishobora gutangira ${dayLabel(w.firstStress)})` : ''}. Twikira ubutaka n’ibishingwe, ukure ibyatsi kugira ngo bitwara amazi, kandi wirinde ifumbire imvura itaragaruka.${w.critical ? ' Iki ni igihe cy’ingenzi, urinde ubuhehere ubu.' : ''}`));
  } else out.push(T(lang, 'Rain should be enough for the crop this week. Keep the soil covered to hold moisture.', 'Imvura ikwiye kuba ihagije igihingwa muri iki cyumweru. Komeza utwikire ubutaka kugira ngo bufate ubuhehere.'));
  if (w.irrigation === 'can_irrigate') out.push(T(lang, `On ${w.soil === 'light' ? 'light' : w.soil === 'heavy' ? 'heavy' : 'medium'} soil, irrigate about ${s.event} mm ${s.gap} instead of a little every day.`, `Ku butaka ${w.soil === 'light' ? 'bw’umusenyi' : w.soil === 'heavy' ? 'bw’ibumba' : 'busanzwe'}, hira nka mm ${s.event} ${s.gapRW} aho guhira gake buri munsi.`));
  return out;
}
