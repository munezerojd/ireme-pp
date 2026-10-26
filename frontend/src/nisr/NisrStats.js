// IREME - NISR microdata statistics panel (shown on the Statistics page, below the existing charts' filters).
import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { loadInsights, yieldByCrop, yieldByDistrict, practiceEffects, adoptionByCrop, plantingFor, cropName, practiceName, currentSeason, SEASON_LABEL, knownCrops, modelledCrops, statsDigest, districtTable, householdSupport, lowestSupport, trendByCrop, spreadByCrop } from './engine.js';
import { speak } from '../voice/speech.js';

const h = React.createElement;
const T = (lang, en, rw) => (lang === 'RW' ? rw : en);
const fmt = (n) => (n == null ? '–' : Math.round(n).toLocaleString('en-US'));

export default function NisrStats({ lang = 'EN', apiBase = '', initialCrop = 'Maize' }) {
  const [ins, setIns] = useState(null);
  const [error, setError] = useState(false);
  const [crop, setCrop] = useState(initialCrop);
  const [season, setSeason] = useState('all');

  useEffect(() => { loadInsights(apiBase).then(setIns).catch(() => setError(true)); }, [apiBase]);
  useEffect(() => {
    const onEvt = (e) => { const d = e.detail || {}; if (d.crop) setCrop(d.crop); };
    window.addEventListener('ireme:stats', onEvt);
    return () => window.removeEventListener('ireme:stats', onEvt);
  }, []);

  if (error) return h('section', { className: 'advisor-card nisr-panel' }, h('p', { className: 'warning' }, T(lang, 'NISR insight data could not be loaded.', 'Amakuru ya NISR ntabashije gufungurwa.')));
  if (!ins) return h('section', { className: 'advisor-card nisr-panel' }, h('p', null, T(lang, 'Loading NISR survey statistics…', 'Turimo gufungura imibare ya NISR…')));

  const node = ins.crops[crop] || ins.crops.Maize;
  const crops = knownCrops(ins).sort((a, b) => ins.crops[b].n - ins.crops[a].n);
  const byCrop = yieldByCrop(ins, season, 12).map((r) => ({ name: cropName(r.crop, lang), median: r.median, avg: r.avg }));
  const byDist = yieldByDistrict(ins, crop).slice(0, 15).map((r) => ({ name: r.district, median: r.median }));
  const effects = practiceEffects(ins, crop, lang).map((e) => ({ name: e.label, pct: e.pct, clear: e.clear }));
  const adoption = adoptionByCrop(ins, modelledCrops(ins).slice(0, 8), lang).map((r) => ({ name: r.crop, improved: r.improved_seed, fertilizer: r.inorganic, compost: r.organic }));
  const seasonKey = season === 'all' ? currentSeason() : season;
  const planting = plantingFor(ins, crop, seasonKey === 'C' ? 'A' : seasonKey).map((p) => ({ name: p.label, median: p.median }));
  const sL = SEASON_LABEL[lang === 'RW' ? 'RW' : 'EN'];
  const summary = T(lang,
    `${cropName(crop)} in the NISR 2024 household survey: typical plot yield ${fmt(node.national.median)} kilograms per hectare, average ${fmt(node.national.avg)}, from ${node.national.n} plots.`,
    `${cropName(crop, 'RW')} mu bushakashatsi bwa NISR 2024: umusaruro usanzwe kg ${fmt(node.national.median)} kuri hegitari, impuzandengo ${fmt(node.national.avg)}, ku mirima ${node.national.n}.`);
  const digest = statsDigest(ins, crop, lang);
  const table = districtTable(ins, crop);
  const seasonRows = ['A', 'B', 'C'].filter((k) => node.season[k]).map((k) => ({ name: sL[k], median: node.season[k].median, avg: node.season[k].avg }));
  const fertRows = node.fertilizer_types ? Object.entries(node.fertilizer_types).map(([k, v]) => ({ name: k, pct: Math.round(v * 100) })) : [];
  const support = householdSupport(ins, lang).map((r) => ({ name: r.label, pct: r.pct }));
  const lowCoop = lowestSupport(ins, 'cooperative', 5);
  const trendRows = trendByCrop(ins, 10).map((r) => ({ name: cropName(r.crop, lang), down: r.down, same: r.same, up: r.up }));
  const spreadRows = spreadByCrop(ins, 8).map((r) => ({ name: cropName(r.crop, lang), p25: r.p25, median: r.median, p75: r.p75 }));
  function downloadCsv() {
    const head = ['district', 'typical_yield_kg_ha', 'p25', 'p75', 'plots', 'vs_national_pct', 'improved_seed_pct', 'inorganic_fertilizer_pct'];
    const lines = [head.join(',')].concat(table.map((r) => [r.district, r.median, r.p25, r.p75, r.n, r.vsNational, r.improved_seed, r.inorganic].join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `ireme_${crop.replace(/\s+/g, '_').toLowerCase()}_district_yields.csv`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const col = '#176b4d';
  const chart = (title, data, key, fill, note, extra) => h('article', { className: 'chartcard', key: title }, h('h3', null, title),
    data.length ? h(ResponsiveContainer, { width: '100%', height: 250 }, h(BarChart, { data }, h(CartesianGrid, { strokeDasharray: '3 3', vertical: false }), h(XAxis, { dataKey: 'name', interval: 0, tick: { fontSize: 10 }, angle: -25, textAnchor: 'end', height: 56 }), h(YAxis, null), h(Tooltip, null), extra || h(Bar, { dataKey: key, fill, radius: [6, 6, 0, 0] })))
      : h('p', null, T(lang, 'Not enough survey plots for this chart.', 'Nta mirima ihagije kuri iki gishushanyo.')),
    h('small', null, note));

  return h('section', { className: 'advisor-card nisr-panel nisr-stats', 'data-nisr-stats': true },
    h('span', { className: 'tag' }, T(lang, 'NISR MICRODATA • AHS 2024', 'AMAKURU Y’IBANZE YA NISR • AHS 2024')),
    h('h3', null, T(lang, 'What the household survey shows', 'Icyo ubushakashatsi ku ngo bwerekana')),
    h('p', null, T(lang, `Computed from ${ins.meta.crop_records_used.toLocaleString('en-US')} crop records across ${ins.meta.districts.length} districts. Typical = median plot yield; average = total harvest divided by total area.`,
      `Byabazwe mu bihingwa ${ins.meta.crop_records_used.toLocaleString('en-US')} mu turere ${ins.meta.districts.length}. Usanzwe = umusaruro wo hagati; impuzandengo = umusaruro wose ugabanyijwe n’ubuso bwose.`)),
    h('div', { className: 'advisor-controls nisr-controls' },
      h('label', null, T(lang, 'Crop', 'Igihingwa'), h('select', { value: crop, onChange: (e) => setCrop(e.target.value) }, crops.map((c) => h('option', { key: c, value: c }, cropName(c, lang))))),
      h('label', null, T(lang, 'Season', 'Igihembwe'), h('select', { value: season, onChange: (e) => setSeason(e.target.value) }, [['all', T(lang, 'All seasons', 'Ibihembwe byose')], ['A', sL.A], ['B', sL.B], ['C', sL.C]].map(([v, t]) => h('option', { key: v, value: v }, t)))),
      h('button', { type: 'button', className: 'secondary', onClick: () => speak(summary, { lang }) }, T(lang, 'Read summary', 'Soma incamake'))),
    h('section', { className: 'kpis nisr-kpis', 'data-read-block': true },
      h('article', { className: 'kpi' }, h('span', null, T(lang, 'Typical yield', 'Umusaruro usanzwe')), h('strong', null, `${fmt(node.national.median)} kg/ha`), h('small', null, cropName(crop, lang))),
      h('article', { className: 'kpi' }, h('span', null, T(lang, 'Average yield', 'Impuzandengo')), h('strong', null, `${fmt(node.national.avg)} kg/ha`), h('small', null, T(lang, 'Total harvest ÷ total area', 'Umusaruro wose ÷ ubuso bwose'))),
      h('article', { className: 'kpi' }, h('span', null, T(lang, 'Survey plots', 'Imirima y’ubushakashatsi')), h('strong', null, fmt(node.national.n)), h('small', null, T(lang, 'Used for this crop', 'Yakoreshejwe kuri iki gihingwa'))),
      h('article', { className: 'kpi' }, h('span', null, T(lang, 'Advisor model', 'Icyitegererezo cy’umujyanama')), h('strong', null, node.model ? `R² ${node.model.cv_r2}` : T(lang, 'None', 'Nta')), h('small', null, node.model ? T(lang, 'Cross-validated fit; farms vary a lot', 'Ubwizerwe bwapimwe; imirima iratandukanye cyane') : T(lang, 'Too few plots to train', 'Imirima mike ku kwitoza')))),
    h('div', { className: 'recommendation', 'data-read-block': true }, h('b', null, T(lang, `Key findings: ${cropName(crop, lang)}`, `Ibyingenzi: ${cropName(crop, lang)}`)), digest.map((t, i) => h('p', { key: i }, t)),
      h('button', { type: 'button', className: 'secondary', onClick: () => speak(digest.join(' '), { lang }) }, T(lang, 'Read findings aloud', 'Soma ibyingenzi mu ijwi'))),
    h('section', { className: 'chartgrid' },
      chart(T(lang, 'Typical yield by crop (kg/ha)', 'Umusaruro usanzwe ku gihingwa (kg/ha)'), byCrop, 'median', col, T(lang, 'Median survey plot yield for the most surveyed crops.', 'Umusaruro wo hagati w’ibihingwa byabajijwe cyane.')),
      chart(T(lang, `${cropName(crop, lang)} yield by district (kg/ha)`, `Umusaruro w’${cropName(crop, lang)} ku karere (kg/ha)`), byDist, 'median', '#258e9b', T(lang, 'Top districts with at least 20 plots.', 'Uturere dufite imirima nibura 20.')),
      chart(T(lang, `What lifts ${cropName(crop, lang)} yield (% change)`, `Icyongera umusaruro w’${cropName(crop, lang)} (% )`), effects, 'pct', '#b8d832', T(lang, 'Model estimate after adjusting for district, season and plot size. Association, not proof. Negative bars can reflect poorer plots that use a practice.', 'Igereranyo cy’icyitegererezo nyuma yo kugenzura akarere, igihembwe n’ubunini. Si gihamya. Imibare mibi ishobora kugaragaza imirima mibi ikoresha ubwo buryo.'),
        h(Bar, { dataKey: 'pct', name: '%', radius: [6, 6, 0, 0] }, effects.map((e, i) => h(Cell, { key: i, fill: e.pct >= 0 ? (e.clear ? '#176b4d' : '#b8d832') : '#c77955' })))),
      chart(T(lang, 'How many plots use improved inputs (%)', 'Imirima ikoresha inyongeramusaruro (%)'), adoption, 'improved', col, T(lang, 'Share of survey plots per crop.', 'Ijanisha ry’imirima ku gihingwa.'),
        [h(Legend, { key: 'l' }), h(Bar, { key: 'a', dataKey: 'improved', name: practiceName('improved_seed', lang), fill: '#176b4d' }), h(Bar, { key: 'b', dataKey: 'fertilizer', name: practiceName('inorganic', lang), fill: '#e5a53a' }), h(Bar, { key: 'c', dataKey: 'compost', name: practiceName('organic', lang), fill: '#b8d832' })]),
      chart(T(lang, `${cropName(crop, lang)} yield by planting time (kg/ha)`, `Umusaruro w’${cropName(crop, lang)} ukurikije igihe cyo gutera (kg/ha)`), planting, 'median', '#6b7fa7', T(lang, `Shown for ${sL[seasonKey === 'C' ? 'A' : seasonKey]}.`, `Biri ku ${sL[seasonKey === 'C' ? 'A' : seasonKey]}.`))),
    h('section', { className: 'chartgrid' },
      chart(T(lang, `${cropName(crop, lang)}: yield by season (kg/ha)`, `${cropName(crop, lang)}: umusaruro ku gihembwe (kg/ha)`), seasonRows, 'median', '#258e9b', T(lang, 'Median plot yield and (in the tooltip) average yield.', 'Umusaruro wo hagati w’imirima.'),
        [h(Legend, { key: 'l' }), h(Bar, { key: 'a', dataKey: 'median', name: T(lang, 'Typical', 'Usanzwe'), fill: '#258e9b', radius: [6, 6, 0, 0] }), h(Bar, { key: 'b', dataKey: 'avg', name: T(lang, 'Average', 'Impuzandengo'), fill: '#b8d832', radius: [6, 6, 0, 0] })]),
      chart(T(lang, 'How much plot yields vary (kg/ha)', 'Uko umusaruro w’imirima utandukana (kg/ha)'), spreadRows, 'median', col, T(lang, 'Lower quarter, median and upper quarter of plots: the wider the gap, the more results differ between farms.', 'Igice cyo hasi, hagati n’icyo hejuru cy’imirima: uko itandukaniro rirenga, ni ko imirima itandukana.'),
        [h(Legend, { key: 'l' }), h(Bar, { key: 'a', dataKey: 'p25', name: T(lang, 'Lower quarter', 'Hasi'), fill: '#c9e4b4' }), h(Bar, { key: 'b', dataKey: 'median', name: T(lang, 'Median', 'Hagati'), fill: '#4ea36a' }), h(Bar, { key: 'c', dataKey: 'p75', name: T(lang, 'Upper quarter', 'Hejuru'), fill: '#176b4d' })]),
      chart(T(lang, 'Farmers reporting production change (% of plots)', 'Abahinzi bavuga impinduka y’umusaruro (% by’imirima)'), trendRows, 'down', '#c77955', T(lang, 'Farmer-reported change in each crop’s production compared with before.', 'Impinduka z’umusaruro zivuzwe n’abahinzi.'),
        [h(Legend, { key: 'l' }), h(Bar, { key: 'a', dataKey: 'down', name: T(lang, 'Down', 'Wagabanutse'), fill: '#c77955' }), h(Bar, { key: 'b', dataKey: 'same', name: T(lang, 'Same', 'Nta mpinduka'), fill: '#c9e4b4' }), h(Bar, { key: 'c', dataKey: 'up', name: T(lang, 'Up', 'Wiyongereye'), fill: '#176b4d' })]),
      fertRows.length ? chart(T(lang, `Fertilizers used on ${cropName(crop, lang)} (% of fertilised plots)`, `Ifumbire ikoreshwa ku ${cropName(crop, lang)} (% )`), fertRows, 'pct', '#e5a53a', T(lang, 'Share of plots using inorganic fertilizer, by type.', 'Ijanisha ry’imirima ikoresha ifumbire mvaruganda, ukurikije ubwoko.')) : null,
      support.length ? chart(T(lang, 'Farm support and services (% of households)', 'Inkunga na serivisi (% by’ingo)'), support, 'pct', '#6b7fa7', T(lang, `NISR AHS 2024 households (${ins.meta.households_surveyed ? ins.meta.households_surveyed.toLocaleString('en-US') : ''} surveyed).`, 'Ingo z’ubushakashatsi bwa NISR AHS 2024.')) : null),
    lowCoop.length ? h('div', { className: 'recommendation', 'data-read-block': true }, h('b', null, T(lang, 'Districts with the fewest households in cooperatives', 'Uturere dufite ingo nke muri koperative')), h('p', null, lowCoop.map((r) => `${r.district} ${r.pct}%`).join(', ') + '.'), h('small', null, T(lang, 'National average: ' + ((ins.households.national.cooperative || 0) * 100).toFixed(1) + '%. Cooperatives can help farmers buy inputs and sell together.', 'Impuzandengo y’igihugu: ' + ((ins.households.national.cooperative || 0) * 100).toFixed(1) + '%. Koperative zishobora gufasha abahinzi kugura inyongeramusaruro no kugurisha hamwe.'))) : null,
    h('div', { className: 'chartcard nisr-table-card', key: 'table' }, h('h3', null, T(lang, `${cropName(crop, lang)} by district`, `${cropName(crop, lang)} ku karere`)),
      h('div', { className: 'nisr-table-wrap', 'data-noread': true }, h('table', { className: 'nisr-table' }, h('thead', null, h('tr', null, ['District', 'Typical kg/ha', 'Middle half', 'Plots', 'vs Rwanda', 'Improved seed', 'Fertilizer'].map((x, i) => h('th', { key: i }, lang === 'RW' ? ['Akarere', 'Usanzwe kg/ha', 'Igice cyo hagati', 'Imirima', 'Ugereranyije n’u Rwanda', 'Imbuto nziza', 'Ifumbire'][i] : x)))),
        h('tbody', null, table.map((r) => h('tr', { key: r.district }, h('td', null, r.district), h('td', null, fmt(r.median)), h('td', null, `${fmt(r.p25)}–${fmt(r.p75)}`), h('td', null, r.n), h('td', { className: r.vsNational >= 0 ? 'up' : 'down' }, (r.vsNational > 0 ? '+' : '') + r.vsNational + '%'), h('td', null, r.improved_seed + '%'), h('td', null, r.inorganic + '%')))))),
      h('button', { type: 'button', className: 'secondary', onClick: downloadCsv }, T(lang, 'Download table (CSV)', 'Kuramo imbonerahamwe (CSV)'))),
    h('small', { className: 'data-caveat' }, ins.meta.source + '. ' + ins.meta.caveat));
}
