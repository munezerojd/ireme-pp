// IREME - real map of Rwanda for agriculture (Leaflet + OpenStreetMap).
// * Basemap: OpenStreetMap tiles.
// * District outlines: /rwanda_districts.geojson if present (see backend/scripts/fetch_rwanda_boundaries.py),
//   otherwise downloaded from geoBoundaries (open licence). If neither is reachable the map still works with
//   markers at approximate district centres, and says so.
// * Colours come from the NISR AHS 2024 insight file: yield, input use and soil threats per district.
import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { DISTRICT_COORDS, ALL_DISTRICTS, cropName, loadInsights } from '../nisr/engine.js';
import { LAYERS, layerById, layerLabel, layerValues, classify, legendItems, formatValue, featureDistrict, matchedShare, mapSummary, districtSummary, mapCrops, RWANDA_BOUNDS, NO_DATA } from './mapData.js';
import { speak, stopSpeaking } from '../voice/speech.js';

const h = React.createElement;
const T = (lang, en, rw) => (lang === 'RW' ? rw : en);
let boundaryPromise = null;

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url);
  return r.json();
}
export function loadBoundaries() {
  if (!boundaryPromise) {
    boundaryPromise = (async () => {
      // 1. your own bundled file (works offline)
      try {
        const g = await fetchJson('/rwanda_districts.geojson');
        if (g && g.features && matchedShare(g).matched >= 20) return { geojson: g, source: 'local' };
      } catch (_) { /* try the next source */ }
      // 2. geoBoundaries (open data), district level
      try {
        const meta = await fetchJson('https://www.geoboundaries.org/api/current/gbOpen/RWA/ADM2/');
        for (const key of ['simplifiedGeometryGeoJSON', 'gjDownloadURL']) {
          if (!meta[key]) continue;
          try {
            const g = await fetchJson(meta[key]);
            if (g && g.features && matchedShare(g).matched >= 20) return { geojson: g, source: 'geoBoundaries' };
          } catch (_) { /* next key */ }
        }
      } catch (_) { /* fall through */ }
      return { geojson: null, source: 'none' };
    })();
  }
  return boundaryPromise;
}

export default function RwandaAgriMap({ lang = 'EN', apiBase = '', selected = null, compact = false, onSelect = null, onAdvice = null, onWeather = null, initialLayer = 'yield', initialCrop = 'Maize' }) {
  const [ins, setIns] = useState(null);
  const [layer, setLayer] = useState(initialLayer);
  const [crop, setCrop] = useState(initialCrop);
  const [picked, setPicked] = useState(selected && ALL_DISTRICTS.includes(selected) ? selected : null);
  const [bounds, setBounds] = useState({ geojson: null, source: 'loading' });
  const divRef = useRef(null);
  const mapRef = useRef(null);
  const groupRef = useRef(null);

  useEffect(() => { loadInsights(apiBase).then(setIns).catch(() => {}); loadBoundaries().then(setBounds); }, [apiBase]);
  useEffect(() => { if (selected && ALL_DISTRICTS.includes(selected)) setPicked(selected); }, [selected]);
  const latest = useRef({});
  useEffect(() => {
    const onEvt = (e) => {
      const d = e.detail || {};
      if (d.layer) setLayer(d.layer); if (d.crop) setCrop(d.crop); if (d.district) setPicked(d.district);
      if (d.read) setTimeout(() => {
        const c = latest.current;
        if (!c.ins) return;
        const lay = d.layer || c.layer; const cr = d.crop || c.crop;
        speak(d.district ? districtSummary(c.ins, d.district, lay, cr, c.lang) : mapSummary(c.ins, lay, cr, c.lang), { lang: c.lang, highlight: divRef.current ? divRef.current.closest('.agri-map-block') : null });
      }, 500);
    };
    window.addEventListener('ireme:map', onEvt);
    return () => window.removeEventListener('ireme:map', onEvt);
  }, []);

  // create the Leaflet map once
  useEffect(() => {
    if (!divRef.current || mapRef.current) return undefined;
    const map = L.map(divRef.current, { scrollWheelZoom: false, minZoom: 7, maxZoom: 13, zoomSnap: 0.25, attributionControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
    L.control.scale({ imperial: false }).addTo(map);
    map.fitBounds(RWANDA_BOUNDS);
    groupRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const t = setTimeout(() => { map.invalidateSize(); map.fitBounds(RWANDA_BOUNDS); }, 250);
    return () => { clearTimeout(t); map.remove(); mapRef.current = null; groupRef.current = null; };
  }, []);

  const l = layerById(layer);
  latest.current = { ins, layer, crop, lang };
  const values = ins ? layerValues(ins, layer, crop) : {};
  const cls = ins ? classify(values, l.palette) : { breaks: [], colors: {}, palette: l.palette };

  // (re)draw districts whenever data, layer, selection or boundaries change
  useEffect(() => {
    const group = groupRef.current;
    const map = mapRef.current;
    if (!group || !map || !ins) return;
    group.clearLayers();
    const tip = (d) => `<b>${d}</b><br>${formatValue(values[d] ? values[d].value : null, l.unit)}`;
    if (bounds.geojson) {
      L.geoJSON(bounds.geojson, {
        style: (f) => { const d = featureDistrict(f); const on = d && d === picked; return { fillColor: (d && cls.colors[d]) || NO_DATA, fillOpacity: 0.78, color: on ? '#124e3b' : '#ffffff', weight: on ? 3 : 1 }; },
        onEachFeature: (f, lyr) => {
          const d = featureDistrict(f);
          if (!d) return;
          lyr.bindTooltip(tip(d), { sticky: true });
          lyr.on('click', () => { setPicked(d); if (onSelect) onSelect(d); });
        },
      }).addTo(group);
    } else if (bounds.source !== 'loading') {
      ALL_DISTRICTS.forEach((d) => {
        const [lat, lon] = DISTRICT_COORDS[d];
        const m = L.circleMarker([lat, lon], { radius: picked === d ? 13 : 10, fillColor: cls.colors[d] || NO_DATA, fillOpacity: 0.9, color: picked === d ? '#124e3b' : '#ffffff', weight: picked === d ? 3 : 2 });
        m.bindTooltip(tip(d), { sticky: true });
        m.on('click', () => { setPicked(d); if (onSelect) onSelect(d); });
        m.addTo(group);
      });
    }
  }, [ins, layer, crop, bounds, picked, lang]);

  const crops = ins ? mapCrops(ins) : [];
  const summary = ins ? mapSummary(ins, layer, crop, lang) : '';
  const detail = ins && picked ? districtSummary(ins, picked, layer, crop, lang) : '';
  const sourceNote = bounds.source === 'loading' ? T(lang, 'Loading district outlines…', 'Turimo gufungura imbibi z’uturere…')
    : bounds.source === 'none' ? T(lang, 'District outlines could not be loaded (offline or blocked). The real map is shown with markers at approximate district centres. To work offline, run backend/scripts/fetch_rwanda_boundaries.py once.', 'Imbibi z’uturere ntizabashije gufungurwa (nta interineti cyangwa byahagaritswe). Ikarita nyayo irerekana ibimenyetso hafi y’ikigo cy’akarere. Kugira ngo ikore nta interineti, koresha backend/scripts/fetch_rwanda_boundaries.py rimwe.')
      : T(lang, `District outlines: ${bounds.source === 'local' ? 'local file' : 'geoBoundaries (open data)'}. Basemap © OpenStreetMap contributors.`, `Imbibi z’uturere: ${bounds.source === 'local' ? 'dosiye yo mu gikoresho' : 'geoBoundaries (amakuru afunguye)'}. Ikarita fatizo © abashyizeho OpenStreetMap.`);

  const select = (label, value, onChange, options) => h('label', null, label, h('select', { value, onChange: (e) => onChange(e.target.value) }, options));

  return h('div', { className: 'agri-map-block' + (compact ? ' compact' : '') },
    h('div', { className: 'advisor-controls nisr-controls' },
      select(T(lang, 'Map shows', 'Ikarita yerekana'), layer, setLayer, LAYERS.map((x) => h('option', { key: x.id, value: x.id }, layerLabel(x, lang)))),
      l.kind === 'crop' ? select(T(lang, 'Crop', 'Igihingwa'), crop, setCrop, crops.map((c) => h('option', { key: c, value: c }, cropName(c, lang)))) : null,
      select(T(lang, 'District', 'Akarere'), picked || '', (v) => { setPicked(v || null); if (v && onSelect) onSelect(v); }, [h('option', { key: '', value: '' }, T(lang, '— choose —', '— hitamo —'))].concat(ALL_DISTRICTS.map((d) => h('option', { key: d, value: d }, d))))),
    h('div', { className: 'agri-map-frame', 'data-noread': true },
      h('div', { className: 'agri-map', ref: divRef, role: 'application', 'aria-label': T(lang, 'Interactive map of Rwanda districts and agriculture', 'Ikarita ikorana y’uturere tw’u Rwanda n’ubuhinzi') })),
    h('div', { className: 'map-legend agri-legend', 'data-noread': true },
      legendItems(cls, l.unit).map((it, i) => h('span', { key: i }, h('i', { style: { background: it.color } }), it.text + (l.unit === '%' ? '%' : ''))),
      h('span', null, h('i', { style: { background: NO_DATA } }), T(lang, 'Not enough survey data', 'Nta makuru ahagije'))),
    h('div', { className: 'recommendation', 'data-read-block': true }, h('b', null, T(lang, 'Map summary', 'Incamake y’ikarita')), h('p', null, summary)),
    picked && ins ? h('div', { className: 'recommendation agri-detail', 'data-read-block': true },
      h('b', null, picked), h('p', null, detail),
      h('div', { className: 'nisr-actions' },
        h('button', { type: 'button', className: 'secondary', onClick: () => speak(detail, { lang }) }, T(lang, 'Read aloud', 'Soma mu ijwi')),
        onAdvice ? h('button', { type: 'button', className: 'primary', onClick: () => onAdvice(picked, l.kind === 'crop' ? crop : undefined) }, T(lang, `Farm advice for ${picked}`, `Inama z’ubuhinzi muri ${picked}`)) : null,
        onWeather ? h('button', { type: 'button', className: 'secondary', onClick: () => onWeather(picked) }, T(lang, 'Weather', 'Iteganyagihe')) : null,
        h('button', { type: 'button', className: 'secondary', onClick: () => { stopSpeaking(); setPicked(null); } }, T(lang, 'Clear', 'Siba')))) : null,
    h('small', { className: 'data-caveat' }, sourceNote + ' ' + T(lang, 'Values: NISR Agricultural Household Survey 2024 (district samples; districts with too few plots are grey). Not an official soil-suitability map.', 'Imibare: NISR Agricultural Household Survey 2024 (ingero z’uturere; uturere dufite imirima mike turi umukara). Si ikarita yemewe y’ubukwiriye bw’ubutaka.')));
}
