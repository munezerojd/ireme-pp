// IREME - NISR-trained advisor panel (shown inside the Smart Farm Advisor page).
// Uses the app's existing look: advisor-card / recommendation / advisor-controls / chartcard classes.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { ALL_DISTRICTS, DISTRICT_COORDS, SEASON_LABEL, PRACTICE_KEYS, practiceName, cropName, currentSeason, loadInsights, advise, bestCrops, knownCrops, modelledCrops } from './engine.js';
import { STAGES, STAGE_LABEL, IRRIGATION, IRRIGATION_LABEL, SOILS, SOIL_LABEL, forecastDays, kcFor } from './agronomy.js';
import { dayLabel, metaNote } from './engine.js';
import { speak, stopSpeaking } from '../voice/speech.js';

const h = React.createElement;
const T = (lang, en, rw) => (lang === 'RW' ? rw : en);
const fmt = (n) => (n == null ? '–' : Math.round(n).toLocaleString('en-US'));
const forecastCache = {};

async function fetchForecast(district) {
  if (forecastCache[district]) return forecastCache[district];
  const [lat, lon] = DISTRICT_COORDS[district] || DISTRICT_COORDS.Gasabo;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,et0_fao_evapotranspiration,wind_speed_10m_max&timezone=Africa%2FKigali&forecast_days=16`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('weather');
  const data = await res.json();
  forecastCache[district] = data.daily;
  return data.daily;
}

export default function NisrAdvisor({ lang = 'EN', apiBase = '', initialDistrict = 'Musanze', initialCrop = 'Maize' }) {
  const [ins, setIns] = useState(null);
  const [error, setError] = useState('');
  const [district, setDistrict] = useState(ALL_DISTRICTS.includes(initialDistrict) ? initialDistrict : 'Musanze');
  const [crop, setCrop] = useState(initialCrop);
  const [season, setSeason] = useState(currentSeason());
  const [area, setArea] = useState('');
  const [practices, setPractices] = useState({});
  const [stage, setStage] = useState('growing');
  const [irrigation, setIrrigation] = useState('rainfed');
  const [soil, setSoil] = useState('medium');
  const [daily, setDaily] = useState(null);
  const rootRef = useRef(null);
  const stateRef = useRef({});

  useEffect(() => { loadInsights(apiBase).then(setIns).catch(() => setError('load')); }, [apiBase]);
  useEffect(() => { let on = true; fetchForecast(district).then((d) => on && setDaily(d)).catch(() => on && setDaily(null)); return () => { on = false; }; }, [district]);

  const areaHa = parseFloat(area) > 0 ? parseFloat(area) : null;
  const advice = useMemo(() => (ins ? advise(ins, { crop, district, season, areaHa, practices, weather: daily, lang, stage, irrigation, soil }) : null), [ins, crop, district, season, areaHa, practices, daily, lang, stage, irrigation, soil]);
  stateRef.current = { advice, lang };

  function read() {
    const a = stateRef.current.advice;
    if (!a) return;
    speak(a.speech, { lang: stateRef.current.lang, highlight: rootRef.current });
  }
  // voice control: "advice for maize in Huye", "I use improved seed" ...
  useEffect(() => {
    function onEvt(e) {
      const d = e.detail || {};
      if (d.crop) setCrop(d.crop);
      if (d.district) setDistrict(d.district);
      if (d.season) setSeason(d.season);
      if (d.practice) setPractices((p) => ({ ...p, [d.practice]: !!d.value }));
      if (d.stage) setStage(d.stage);
      if (d.irrigation) setIrrigation(d.irrigation);
      if (d.soil) setSoil(d.soil);
      if (d.read) setTimeout(read, 900);
    }
    window.addEventListener('ireme:advisor', onEvt);
    return () => window.removeEventListener('ireme:advisor', onEvt);
  }, []);

  if (error) return h('div', { className: 'advisor-card nisr-panel' }, h('p', { className: 'warning' }, T(lang, 'NISR insight data could not be loaded. Run backend/scripts/build_nisr_insights.py and copy nisr_insights.json to frontend/public.', 'Amakuru ya NISR ntiyabashije gufungurwa. Koresha backend/scripts/build_nisr_insights.py hanyuma wimure nisr_insights.json muri frontend/public.')));
  if (!ins) return h('div', { className: 'advisor-card nisr-panel' }, h('p', null, T(lang, 'Loading NISR survey insights…', 'Turimo gufungura amakuru ya NISR…')));

  const crops = knownCrops(ins).sort((a, b) => (ins.crops[b].n - ins.crops[a].n));
  const a = advice;
  const ref = a && (a.benchmarks.district || a.benchmarks.national);
  const chartRows = [];
  if (a && a.benchmarks.national) chartRows.push({ name: T(lang, 'National typical', 'Uw’igihugu'), v: a.benchmarks.national.median });
  if (a && a.benchmarks.district) chartRows.push({ name: district, v: a.benchmarks.district.median });
  if (a && a.expected) chartRows.push({ name: T(lang, 'Your practices', 'Ibyo ukora'), v: Math.round(a.expected.median) });
  if (a && a.scenario && a.recommendations.length) chartRows.push({ name: T(lang, 'With advice', 'Ukurikije inama'), v: Math.round(a.scenario.median) });
  const best = bestCrops(ins, district, 5);
  const ag = a && a.ok ? a.agro : null;
  const ALERT_TITLE = { heavy_rain: ['Heavy rain', 'Imvura nyinshi'], disease: ['Disease risk', 'Ibyago by’indwara'], armyworm: ['Armyworm risk', 'Ibyago by’inyenzi'], heat: ['Heat stress', 'Ubushyuhe bukabije'], cold: ['Cold nights', 'Amajoro akonje'], harvest_wet: ['Wet harvest', 'Isarura mu mvura'] };
  const agroBlocks = [];
  if (a && a.ok && !(ag && ag.hasForecast)) agroBlocks.push(h('div', { className: 'recommendation', key: 'nofc', 'data-read-block': true }, h('b', null, T(lang, 'Weather forecast not available', 'Iteganyagihe ntiriboneka')), h('p', null, T(lang, 'Advice below uses survey data and growth-stage tips only. Connect to the internet to add irrigation and weather alerts.', 'Inama zikurikira zishingiye ku makuru y’ubushakashatsi n’ibyiciro by’igihingwa gusa. Fungura interineti kugira ngo wongereho kuhira n’impuruza z’ikirere.'))));
  if (ag && ag.hasForecast) {
    ag.alerts.forEach((x, i) => agroBlocks.push(h('div', { className: 'recommendation nisr-risk', key: 'al' + i, 'data-read-block': true }, h('b', null, (x.level === 'high' ? T(lang, 'Weather alert: ', 'Impuruza y’ikirere: ') : T(lang, 'Watch: ', 'Witondere: ')) + (ALERT_TITLE[x.key] ? ALERT_TITLE[x.key][lang === 'RW' ? 1 : 0] : '')), h('p', null, x.text))));
    if (ag.planting) {
      agroBlocks.push(h('div', { className: 'recommendation' + (ag.planting.level === 'good' ? '' : ' nisr-risk'), key: 'plant', 'data-read-block': true }, h('b', null, T(lang, 'Is it time to plant?', 'Ni igihe cyo gutera?')), h('p', null, ag.planting.text), h('small', null, T(lang, 'Based on the 14-day Open-Meteo forecast; beyond day 7 forecasts are less certain.', 'Bishingiye ku iteganyagihe rya Open-Meteo ry’iminsi 14; nyuma y’umunsi wa 7 ntiryizewe cyane.'))));
    } else if (a.water.length) {
      const rows = forecastDays(daily, 7).map((d) => ({ name: dayLabel(d.date, lang).split(' ').slice(0, lang === 'RW' ? 3 : 2).join(' '), rain: Math.round(d.rain * 10) / 10, need: Math.round((d.et0 != null ? d.et0 : 3.8) * kcFor(crop, stage) * 10) / 10 }));
      agroBlocks.push(h('div', { className: 'recommendation', key: 'water', 'data-read-block': true }, h('b', null, T(lang, `Irrigation and water for ${cropName(crop, lang)}`, `Kuhira n’amazi ku ${cropName(crop, lang)}`)), a.water.map((t, i) => h('p', { key: i }, t)),
        ag.water && ag.water.critical ? h('p', null, h('b', null, T(lang, 'Critical stage: protect water supply now.', 'Igihe cy’ingenzi: rinda amazi ubu.'))) : null,
        h('small', null, T(lang, 'Method: FAO-56 water balance (forecast ET0 × crop factor − useful rain). A planning guide for a typical field, not a sensor reading.', 'Uburyo: FAO-56 (ET0 y’iteganyagihe × ikigereranyo cy’igihingwa − imvura ifasha). Ni inama yo gutegura, si igipimo cy’umurima wawe.'))));
      agroBlocks.push(h('article', { className: 'chartcard', key: 'waterchart' }, h('h3', null, T(lang, 'Rain vs crop water need (mm per day)', 'Imvura n’amazi igihingwa gikeneye (mm ku munsi)')),
        h(ResponsiveContainer, { width: '100%', height: 220 }, h(BarChart, { data: rows }, h(CartesianGrid, { strokeDasharray: '3 3', vertical: false }), h(XAxis, { dataKey: 'name', tick: { fontSize: 11 } }), h(YAxis, null), h(Tooltip, null), h(Legend, null), h(Bar, { dataKey: 'rain', name: T(lang, 'Rain', 'Imvura'), fill: '#258e9b', radius: [4, 4, 0, 0] }), h(Bar, { dataKey: 'need', name: T(lang, 'Crop need', 'Igikenewe'), fill: '#e5a53a', radius: [4, 4, 0, 0] })))));
    }
    if (ag.windows) {
      const fmtDays = (arr) => (arr.length ? arr.slice(0, 5).map((x) => dayLabel(x, lang)).join(', ') : T(lang, 'none this week', 'nta munsi w’iki cyumweru'));
      agroBlocks.push(h('div', { className: 'recommendation', key: 'win', 'data-read-block': true }, h('b', null, T(lang, 'Best days this week', 'Iminsi myiza y’iki cyumweru')),
        h('p', null, T(lang, `Spraying (dry and calm): ${fmtDays(ag.windows.spray)}.`, `Gutera umuti (humutse kandi nta muyaga): ${fmtDays(ag.windows.spray)}.`)),
        h('p', null, T(lang, `Harvest and drying: ${fmtDays(ag.windows.harvest)}.`, `Gusarura no kumisha: ${fmtDays(ag.windows.harvest)}.`)),
        h('p', null, T(lang, `Field work (planting, weeding): ${fmtDays(ag.windows.fieldwork)}.`, `Imirimo yo mu murima (gutera, gukura ibyatsi): ${fmtDays(ag.windows.fieldwork)}.`))));
    }
  }
  if (ag && ag.tips.length) agroBlocks.push(h('div', { className: 'recommendation', key: 'stage', 'data-read-block': true }, h('b', null, T(lang, 'For this growth stage', 'Kuri iki cyiciro cy’igihingwa')), ag.tips.map((t, i) => h('p', { key: i }, t))));
  const shareText = a ? `IREME – ${cropName(crop, lang)}, ${district}\n${a.speech}` : '';

  const select = (label, value, onChange, options) => h('label', { key: label }, label, h('select', { value, onChange: (e) => onChange(e.target.value) }, options));
  const opt = (v, t) => h('option', { key: v, value: v }, t == null ? v : t);

  return h('div', { className: 'advisor-card nisr-panel', ref: rootRef, 'data-nisr-advisor': true },
    h('span', { className: 'tag' }, T(lang, 'NISR DATA ADVISOR • TRAINED ON AHS 2024', 'UMUJYANAMA UKORESHA AMAKURU YA NISR • AHS 2024')),
    h('h3', null, T(lang, 'Advice built from real Rwandan farm records', 'Inama zishingiye ku makuru nyakuri y’abahinzi b’u Rwanda')),
    h('p', null, T(lang, `Trained on ${ins.meta.crop_records_used.toLocaleString('en-US')} crop records from NISR’s Agricultural Household Survey 2024. Tick what you already do, and IREME shows what could raise your harvest.`,
      `Byatojwe ku bihingwa ${ins.meta.crop_records_used.toLocaleString('en-US')} byo mu bushakashatsi bwa NISR (AHS 2024). Hitamo ibyo usanzwe ukora, IREME iguhe icyakongera umusaruro.`)),
    h('div', { className: 'advisor-controls nisr-controls' },
      select(T(lang, 'District', 'Akarere'), district, setDistrict, ALL_DISTRICTS.map((d) => opt(d))),
      select(T(lang, 'Crop', 'Igihingwa'), crop, setCrop, crops.map((c) => opt(c, cropName(c, lang)))),
      select(T(lang, 'Season', 'Igihembwe'), season, setSeason, ['A', 'B', 'C'].map((s) => opt(s, SEASON_LABEL[lang === 'RW' ? 'RW' : 'EN'][s]))),
      select(T(lang, 'Crop stage now', 'Igihe igihingwa kigezemo'), stage, setStage, STAGES.map((x) => opt(x, STAGE_LABEL[lang === 'RW' ? 'RW' : 'EN'][x]))),
      select(T(lang, 'Water', 'Amazi'), irrigation, setIrrigation, IRRIGATION.map((x) => opt(x, IRRIGATION_LABEL[lang === 'RW' ? 'RW' : 'EN'][x]))),
      select(T(lang, 'Soil', 'Ubutaka'), soil, setSoil, SOILS.map((x) => opt(x, SOIL_LABEL[lang === 'RW' ? 'RW' : 'EN'][x]))),
      h('label', null, T(lang, 'Your land (hectares, optional)', 'Ubuso bwawe (hegitari, si ngombwa)'), h('input', { type: 'number', min: '0', step: '0.01', value: area, onChange: (e) => setArea(e.target.value), placeholder: '0.25' }))),
    h('div', { className: 'nisr-practices', role: 'group', 'aria-label': T(lang, 'What you already do', 'Ibyo usanzwe ukora') },
      h('b', null, T(lang, 'What I already do:', 'Ibyo nsanzwe nkora:')),
      PRACTICE_KEYS.map((p) => h('label', { key: p, className: 'nisr-check' }, h('input', { type: 'checkbox', checked: !!practices[p], onChange: (e) => setPractices({ ...practices, [p]: e.target.checked }) }), ' ' + practiceName(p, lang)))),
    !a || !a.ok ? null : h(React.Fragment, null,
      h('section', { className: 'kpis nisr-kpis', 'data-read-block': true },
        h('article', { className: 'kpi' }, h('span', null, T(lang, 'Typical plot yield', 'Umusaruro usanzwe')), h('strong', null, ref ? `${fmt(ref.median)} kg/ha` : '–'), h('small', null, ref ? T(lang, `${a.benchmarks.district ? district : 'Rwanda'} • ${ref.n} survey plots`, `${a.benchmarks.district ? district : 'u Rwanda'} • imirima ${ref.n}`) : '')),
        a.expected ? h('article', { className: 'kpi' }, h('span', null, a.practicesUsed ? T(lang, 'With your practices', 'Ukurikije ibyo ukora') : T(lang, 'Without extra inputs', 'Nta nyongeramusaruro')), h('strong', null, `${fmt(a.expected.low)}–${fmt(a.expected.high)} kg/ha`), h('small', null, T(lang, 'Middle half of similar plots', 'Imirima isa kimwe, igice cyo hagati'))) : null,
        a.scenario && a.recommendations.length ? h('article', { className: 'kpi' }, h('span', null, T(lang, 'Possible with advice', 'Bishoboka ukurikije inama')), h('strong', null, `${fmt(a.scenario.low)}–${fmt(a.scenario.high)} kg/ha`), h('small', null, T(lang, 'Upper estimate; effects overlap', 'Igereranyo cyo hejuru; ibyiciro biruzuzanya'))) : null,
        areaHa && a.expected && a.expected.total ? h('article', { className: 'kpi' }, h('span', null, T(lang, `Harvest from ${areaHa} ha`, `Umusaruro wa hegitari ${areaHa}`)), h('strong', null, `${fmt(a.expected.total.low)}–${fmt(a.expected.total.high)} kg`), h('small', null, T(lang, 'Rough planning range', 'Igereranyo cyo gutegura'))) : null),
      h('div', { className: 'recommendation', 'data-read-block': true },
        h('b', null, T(lang, `What the data says for ${cropName(crop, lang)} in ${district}`, `Icyo amakuru avuga ku ${cropName(crop, lang)} muri ${district}`)),
        h('p', null, a.confidenceText),
        a.trend ? h('p', null, T(lang, `Farmers reported production of this crop went down for ${Math.round(a.trend.down * 100)}% of plots and up for ${Math.round(a.trend.up * 100)}%.`, `Abahinzi bavuze ko umusaruro wagabanutse ku ${Math.round(a.trend.down * 100)}% by’imirima kandi wiyongereye ku ${Math.round(a.trend.up * 100)}%.`)) : null),
      ...agroBlocks,
      a.recommendations.length ? a.recommendations.map((r, i) => h('div', { className: 'recommendation', key: r.key, 'data-read-block': true },
        h('b', null, `${i + 1}. ${r.title}`), h('p', null, r.detail), h('small', null, T(lang, `Evidence: NISR AHS 2024, ${r.evidence.replace('n=', '')} ${cropName(crop, lang)} plots. Association, not guarantee.`, `Ibimenyetso: NISR AHS 2024, imirima ${r.evidence.replace('n=', '')}. Ni ibigaragara, si ingwate.`))))
        : h('div', { className: 'recommendation', 'data-read-block': true }, h('b', null, T(lang, 'No clear extra gain found', 'Nta nyongera igaragara yabonetse')), h('p', null, T(lang, 'For the practices you selected, or for this crop, the survey shows no clearly supported extra gain. Keep scouting weekly and ask your agronomist.', 'Ku byo wahisemo, cyangwa kuri iki gihingwa, ubushakashatsi nta nyongera igaragara bwerekana. Komeza ugenzure umurima buri cyumweru, ubaze umujyanama w’ubuhinzi.'))),
      a.risks.map((r) => h('div', { className: 'recommendation nisr-risk', key: r.key, 'data-read-block': true }, h('b', null, T(lang, `Local risk: ${r.pct}% of plots affected`, `Ibyago byo muri aka karere: ${r.pct}% by’imirima`)), h('p', null, r.detail), h('small', null, T(lang, 'Evidence: NISR AHS 2024 soil-threat reports for this district.', 'Ibimenyetso: raporo za NISR AHS 2024 z’ibibazo by’ubutaka muri aka karere.')))),
      a.notes.concat(a.tips).length ? h('div', { className: 'recommendation', 'data-read-block': true }, h('b', null, T(lang, 'Also consider', 'Tekereza no kuri ibi')), a.notes.concat(a.tips).map((t, i) => h('p', { key: i }, t))) : null,
      h('article', { className: 'chartcard' }, h('h3', null, T(lang, 'Yield comparison (kg per hectare)', 'Igereranya ry’umusaruro (kg kuri hegitari)')),
        h(ResponsiveContainer, { width: '100%', height: 240 }, h(BarChart, { data: chartRows }, h(CartesianGrid, { strokeDasharray: '3 3', vertical: false }), h(XAxis, { dataKey: 'name' }), h(YAxis, null), h(Tooltip, null),
          h(Bar, { dataKey: 'v', name: 'kg/ha', radius: [6, 6, 0, 0] }, chartRows.map((_, i) => h(Cell, { key: i, fill: ['#6b7fa7', '#258e9b', '#176b4d', '#b8d832'][i % 4] }))))),
        h('small', null, T(lang, 'Typical = survey median plot yield. Ranges show the middle half of similar plots, so your own result can be higher or lower.', 'Usanzwe = umusaruro wo hagati w’imirima y’ubushakashatsi. Imibare yerekana igice cyo hagati cy’imirima isa; umusaruro wawe ushobora kuba uri hejuru cyangwa hasi.'))),
      best.length ? h('div', { className: 'recommendation', 'data-read-block': true }, h('b', null, T(lang, `Crops doing well in ${district}`, `Ibihingwa bitanga umusaruro mwiza muri ${district}`)),
        h('div', { className: 'chips' }, best.map((r) => h('button', { key: r.crop, type: 'button', onClick: () => setCrop(r.crop) }, `${cropName(r.crop, lang)} · ${fmt(r.median)} kg/ha`))),
        h('small', null, T(lang, 'Compared with the national typical yield of each crop. Tap one to see advice.', 'Bigereranywa n’umusaruro usanzwe w’igihugu. Kanda kimwe urebe inama.'))) : null,
      h('div', { className: 'nisr-actions' },
        h('button', { type: 'button', className: 'primary', onClick: read }, T(lang, 'Read this advice aloud', 'Soma iyi nama mu ijwi')),
        h('button', { type: 'button', className: 'secondary', onClick: () => stopSpeaking() }, T(lang, 'Stop', 'Hagarika')),
        h('a', { className: 'secondary nisr-share', href: 'https://wa.me/?text=' + encodeURIComponent(shareText), target: '_blank', rel: 'noreferrer' }, T(lang, 'Share on WhatsApp', 'Sangiza kuri WhatsApp'))),
      h('small', { className: 'data-caveat' }, metaNote(ins, lang))));
}
