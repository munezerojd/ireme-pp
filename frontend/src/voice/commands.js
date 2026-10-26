// IREME - voice command understanding (pure JavaScript, fully testable in Node).
// Turns what the microphone heard into an intent such as {intent:'navigate', page:'Statistics'}.
// Accuracy comes from: normalising speech, fixing common mis-hearings of "IREME", many synonyms in
// English and Kinyarwanda, fuzzy (typo-tolerant) matching, trying every alternative the recogniser
// offers, and an echo filter so IREME does not obey its own voice.
import { findCrop, findDistrict, ALL_DISTRICTS, CROP_ALIASES } from '../nisr/engine.js';

export const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[’'`]/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Speech engines often hear "IREME" as one of these.
const IREME_FIX = /\b(irene|irenee|iremy|irem|iremi|iram|i remy|i rem|i ream|eye ream|airem|aireme|ay rem|a remy|eye remy|ireny|aremy|i reme)\b/g;
const FILLERS = [
  'please', 'kindly', 'can you', 'could you', 'would you', 'will you', 'i want to', 'i would like to', 'i wanna', 'i need to', 'let me',
  'let us', 'lets', 'hey ireme', 'ok ireme', 'okay ireme', 'hello ireme', 'hi ireme', 'ireme please', 'again please', 'ndashaka', 'nyabuneka', 'ndagusaba',
];
export function clean(text) {
  let t = norm(text).replace(IREME_FIX, 'ireme');
  // keep "ask ireme"/"baza ireme" intact; drop other polite filler
  FILLERS.forEach((f) => { t = (' ' + t + ' ').replace(new RegExp(' ' + f + ' ', 'g'), ' '); });
  return t.replace(/\s+/g, ' ').trim();
}

export function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const ratio = (a, b) => 1 - lev(a, b) / Math.max(a.length, b.length, 1);
const words = (t) => (t ? t.split(' ') : []);
const containsPhrase = (t, p) => (' ' + t + ' ').includes(' ' + p + ' ');

// Score how well text matches one phrase (0..1).
export function phraseScore(text, phrase) {
  if (!text || !phrase) return 0;
  if (text === phrase) return 1;
  const tw = words(text).length, pw = words(phrase).length;
  if (containsPhrase(text, phrase)) return Math.max(0.82, 0.96 - 0.03 * (tw - pw));
  if (Math.abs(tw - pw) <= 1) {
    const r = ratio(text, phrase);
    if (r >= 0.8) return r * 0.92;
  }
  // phrase words all present (any order) for longer phrases
  if (pw >= 2) {
    const tws = new Set(words(text));
    if (words(phrase).every((w) => tws.has(w)) && tw <= pw + 2) return 0.8;
  }
  return 0;
}

// ------------------------------------------------------------------ vocabulary
export const PAGES = {
  'Dashboard': { en: ['dashboard', 'home', 'home page', 'main page', 'start page', 'go home', 'main menu', 'overview'], rw: ['ahabanza', 'intangiriro', 'urupapuro rwa mbere'] },
  'Farmer data': { en: ['farmer data', 'my farm data', 'my farm', 'submit data', 'farm data', 'report my harvest', 'farmer form'], rw: ['amakuru y umuhinzi', 'amakuru y umurima', 'tanga amakuru'] },
  'Statistics': { en: ['statistics', 'statistic', 'stats', 'analytics', 'numbers', 'charts', 'data and charts', 'crop statistics', 'yield statistics'], rw: ['imibare', 'ibarurishamibare', 'imibare y ubuhinzi'] },
  'Smart Farm Advisor': { en: ['smart farm advisor', 'farm advisor', 'smart advisor', 'advisor', 'adviser', 'farming advice', 'farm advice', 'give me advice', 'advice', 'agronomy advice'], rw: ['umujyanama w ubuhinzi', 'umujyanama', 'inama z ubuhinzi', 'inama'] },
  'Forecast': { en: ['forecast', 'weather', 'weather forecast', 'rain forecast', 'rain', 'will it rain', 'climate'], rw: ['iteganyagihe', 'ikirere', 'imvura'] },
  'Crop Scan': { en: ['crop scan', 'scan crop', 'scan my plant', 'scan plant', 'scan a plant', 'check my crop', 'plant scan', 'plant disease', 'check plant', 'scan', 'crop skin', 'crop scam', 'disease check', 'leaf check', 'diagnose plant'], rw: ['gusuzuma igihingwa', 'suzuma igihingwa', 'reba indwara', 'gusuzuma'] },
  'Ask IREME': { en: ['ask ireme', 'ask the agronomist', 'ask an agronomist', 'ask a question', 'ask question', 'ask a questions', 'questions', 'chat', 'talk to ireme', 'i have a question', 'help me with a question'], rw: ['baza ireme', 'umujyanama w ubuhinzi ireme', 'mfite ikibazo', 'baza ikibazo'] },
  'Admin data': { en: ['admin data', 'admin', 'manage data', 'data management', 'admin page'], rw: ['imicungire y amakuru', 'umuyobozi'] },
};
const NAV_VERBS = ['go to', 'open', 'show', 'show me', 'take me to', 'navigate to', 'switch to', 'go', 'visit', 'view', 'load', 'fungura', 'jya kuri', 'jya', 'mfungurire', 'ndeka mbone', 'reba', 'berekana'];
const PAGE_ORDER = ['Dashboard', 'Farmer data', 'Statistics', 'Smart Farm Advisor', 'Forecast', 'Crop Scan', 'Ask IREME', 'Admin data'];

const RULES = [
  // reading control (high priority, work while IREME is talking)
  { intent: 'stop_reading', urgent: true, phrases: ['stop', 'stop reading', 'be quiet', 'quiet', 'silence', 'shut up', 'enough', 'cancel', 'stop talking', 'hush', 'hagarara', 'hagarika gusoma', 'hagarika', 'ceceka', 'bihagije'] },
  { intent: 'pause', urgent: true, phrases: ['pause', 'pause reading', 'wait', 'hold on', 'tegereza', 'rekera aho'] },
  { intent: 'resume', phrases: ['resume', 'continue reading', 'carry on', 'keep reading', 'go on', 'komeza gusoma', 'komeza'] },
  { intent: 'next_block', urgent: true, phrases: ['next', 'next section', 'skip', 'skip this', 'next part', 'go next', 'ikurikira', 'simbuka'] },
  { intent: 'prev_block', urgent: true, phrases: ['previous', 'previous section', 'go back a bit', 'last section', 'previous part', 'subira inyuma gato', 'icyabanje'] },
  { intent: 'read_page', phrases: ['read this page', 'read page', 'read the page', 'read it aloud', 'read aloud', 'read to me', 'read it', 'read everything', 'start reading', 'read this', 'soma urupapuro', 'soma iyi page', 'soma iyi paji', 'soma', 'nsomera'] },
  { intent: 'repeat', phrases: ['repeat', 'say again', 'say that again', 'repeat that', 'what did you say', 'once more', 'subiramo', 'ongera uvuge', 'subiza'] },
  { intent: 'faster', phrases: ['read faster', 'speak faster', 'faster', 'speed up', 'talk faster', 'vuga vuba', 'vuba'] },
  { intent: 'slower', phrases: ['read slower', 'speak slower', 'slower', 'slow down', 'talk slower', 'vuga buhoro', 'buhoro'] },
  { intent: 'normal_speed', phrases: ['normal speed', 'normal voice speed', 'reset speed', 'vuga bisanzwe'] },
  // modes
  { intent: 'reading_mode', value: true, phrases: ['reading mode on', 'turn on reading mode', 'start reading mode', 'enable reading mode', 'reading mode', 'auto read on', 'fungura uburyo bwo gusoma', 'fungura gusoma'] },
  { intent: 'reading_mode', value: false, phrases: ['reading mode off', 'turn off reading mode', 'stop reading mode', 'disable reading mode', 'auto read off', 'funga uburyo bwo gusoma', 'funga gusoma'] },
  { intent: 'voice_off', phrases: ['stop listening', 'turn off voice', 'voice off', 'stop voice', 'disable voice', 'mute microphone', 'turn off microphone', 'hagarika ijwi', 'hagarika kumva', 'funga ijwi', 'zimya ijwi'] },
  { intent: 'sign', value: true, phrases: ['sign language on', 'turn on sign language', 'show sign language', 'enable sign language', 'sign language', 'fungura amarenga', 'amarenga'] },
  { intent: 'sign', value: false, phrases: ['sign language off', 'turn off sign language', 'hide sign language', 'disable sign language', 'funga amarenga'] },
  { intent: 'language', lang: 'RW', phrases: ['change language to kinyarwanda', 'switch to kinyarwanda', 'speak kinyarwanda', 'kinyarwanda', 'in kinyarwanda', 'hindura ururimi mu kinyarwanda', 'ikinyarwanda', 'kinyarwanda please', 'vuga ikinyarwanda'] },
  { intent: 'language', lang: 'EN', phrases: ['change language to english', 'switch to english', 'speak english', 'english', 'in english', 'hindura mu cyongereza', 'icyongereza', 'ikinyarwanda ni cyongereza', 'vuga icyongereza'] },
  { intent: 'theme', value: 'dark', phrases: ['dark mode', 'dark mode on', 'turn on dark mode', 'night mode', 'dark theme', 'switch to dark', 'enable dark mode', 'fungura uburyo bw ijoro', 'uburyo bw ijoro', 'umwijima'] },
  { intent: 'theme', value: 'light', phrases: ['light mode', 'light mode on', 'day mode', 'light theme', 'switch to light', 'dark mode off', 'turn off dark mode', 'disable dark mode', 'uburyo bw amanywa', 'umucyo'] },
  { intent: 'install_app', phrases: ['install app', 'install the app', 'install ireme', 'download app', 'download the app', 'add to home screen', 'install application', 'shyiraho porogaramu', 'kuramo porogaramu'] },
  { intent: 'text_bigger', phrases: ['bigger text', 'larger text', 'increase text size', 'make text bigger', 'zoom in', 'bigger', 'text bigger', 'kongera inyandiko', 'inyandiko nini'] },
  { intent: 'text_smaller', phrases: ['smaller text', 'decrease text size', 'make text smaller', 'zoom out', 'smaller', 'text smaller', 'gabanya inyandiko', 'inyandiko nto'] },
  { intent: 'text_reset', phrases: ['normal text', 'reset text', 'reset zoom', 'normal text size', 'inyandiko isanzwe'] },
  { intent: 'scroll', dir: 'down', phrases: ['scroll down', 'page down', 'go down', 'down', 'manuka'] },
  { intent: 'scroll', dir: 'up', phrases: ['scroll up', 'page up', 'go up', 'up', 'zamuka'] },
  { intent: 'scroll', dir: 'top', phrases: ['scroll to top', 'go to top', 'top of page', 'back to top', 'hejuru', 'ku itangiriro'] },
  { intent: 'scroll', dir: 'bottom', phrases: ['scroll to bottom', 'go to bottom', 'bottom of page', 'end of page', 'hasi', 'ku musozo'] },
  { intent: 'back', phrases: ['go back', 'back', 'previous page', 'return', 'subira inyuma', 'subira', 'garuka'] },
  { intent: 'next_page', phrases: ['next page', 'go forward', 'forward', 'urupapuro rukurikira'] },
  { intent: 'where', phrases: ['where am i', 'what page is this', 'which page', 'what is this page', 'current page', 'ndi he', 'iyi ni page ki', 'ni urupapuro rwa'] },
  { intent: 'help', phrases: ['help', 'what can i say', 'voice commands', 'commands', 'list commands', 'how do i use this', 'help me', 'options', 'ubufasha', 'amabwiriza', 'amabwiriza y ijwi', 'nafashwa nte', 'mfasha'] },
  // forecast
  { intent: 'refresh_weather', phrases: ['refresh forecast', 'refresh weather', 'load forecast', 'load weather', 'update forecast', 'update weather', 'get the forecast', 'reba iteganyagihe rishya', 'vugurura iteganyagihe'] },
  // Ask IREME
  { intent: 'ask_start', phrases: ['ask ireme', 'i have a question', 'ask a question', 'start asking', 'let me ask', 'ready to ask', 'mfite ikibazo', 'baza ireme', 'baza ikibazo', 'ndashaka kubaza'] },
  { intent: 'read_answer', phrases: ['read answer', 'read the answer', 'read response', 'read it again', 'read answer again', 'soma igisubizo', 'subiramo igisubizo'] },
  { intent: 'clear_question', phrases: ['clear question', 'new question', 'clear', 'start over', 'delete question', 'another question', 'ask another question', 'ask another', 'kuraho ikibazo', 'ikibazo gishya', 'ikindi kibazo'] },
  { intent: 'submit_question', phrases: ['enter', 'press enter', 'hit enter', 'send', 'submit', 'send question', 'submit question', 'ask now', 'go ahead', 'done', 'i am done', 'finished', 'that is all', 'thats all', 'that is it', 'answer', 'answer me', 'get answer', 'get the answer', 'give me the answer', 'ohereza', 'ohereza ikibazo', 'rangije', 'birangiye', 'mpa igisubizo'] },
];

// English + Kinyarwanda words for the advisor's practices.
const PRACTICE_WORDS = {
  improved_seed: ['improved seed', 'improved seeds', 'good seed', 'good seeds', 'certified seed', 'certified seeds', 'imbuto nziza', 'imbuto zitoranyijwe'],
  inorganic: ['fertilizer', 'fertiliser', 'inorganic fertilizer', 'chemical fertilizer', 'dap', 'urea', 'npk', 'ifumbire mvaruganda', 'ifumbire'],
  organic: ['compost', 'manure', 'organic fertilizer', 'organic', 'ifumbire y imborera', 'imborera'],
  pesticide: ['pesticide', 'pesticides', 'crop protection', 'fungicide', 'spraying', 'umuti', 'imiti'],
  irrigation: ['irrigation', 'irrigate', 'watering', 'kuhira'],
  anti_erosion: ['anti erosion', 'terraces', 'terrace', 'contour', 'mulch', 'mulching', 'erosion control', 'kurwanya isuri', 'amaterasi'],
};
const USE_WORDS = ['i use', 'i am using', 'using', 'i have', 'i apply', 'i do use', 'add', 'tick', 'select', 'with', 'include', 'turn on', 'nkoresha', 'mfite', 'ongeraho'];
const NOT_USE_WORDS = ['i do not use', 'i dont use', 'i don t use', 'not using', 'no', 'without', 'remove', 'untick', 'unselect', 'turn off', 'ntakoresha', 'nta', 'kuraho'];

// ------------------------------------------------------------------ parser
function bestRule(text, minScore = 0.8) {
  let best = null;
  for (const rule of RULES) {
    for (const p of rule.phrases) {
      const sc = phraseScore(text, p);
      if (sc >= minScore && (!best || sc > best.score || (sc === best.score && p.length > best.len))) best = { rule, score: sc, len: p.length };
    }
  }
  return best;
}
function bestPage(text) {
  let best = null;
  for (const [page, v] of Object.entries(PAGES)) {
    for (const p of [...v.en, ...v.rw]) {
      const sc = phraseScore(text, p);
      if (sc >= 0.8 && (!best || sc > best.score || (sc === best.score && p.length > best.len))) best = { page, score: sc, len: p.length };
    }
  }
  return best;
}
function stripNavVerb(text) {
  let t = text;
  let had = false;
  for (const v of [...NAV_VERBS].sort((a, b) => b.length - a.length)) {
    if (t === v) return { text: '', had: true };
    if (t.startsWith(v + ' ')) { t = t.slice(v.length + 1); had = true; break; }
  }
  t = t.replace(/^(the|to|my|a|kuri|ku)\s+/, '').replace(/\s+(page|screen|section|urupapuro)$/, '');
  return { text: t, had };
}

function practiceIn(text) {
  for (const [key, ws] of Object.entries(PRACTICE_WORDS)) {
    for (const w of ws) if (containsPhrase(text, w)) return key;
  }
  return null;
}

// ctx: { page, lang, askListening }
export function parseCommand(rawText, ctx = {}) {
  const t = clean(rawText);
  if (!t) return { intent: 'none', score: 0 };
  const nw = words(t).length;
  const strict = !!ctx.askListening;               // while waiting for a spoken question, avoid hijacking normal sentences

  // 0. while dictating a question, "... enter" at the end of a sentence sends it
  if (strict) {
    const tail = t.match(/^(.{6,}?)\s+(enter|submit|send|ask now|go ahead|that is all|thats all|ohereza|rangije)$/);
    if (tail && words(tail[1]).length >= 2) return { intent: 'dictate_submit', text: tail[1], score: 0.95 };
  }
  // 1. "ask ireme <question>" carries its own question
  const m = t.match(/^(?:ask ireme|baza ireme|ask the agronomist|ask an agronomist)\s+(.{6,})$/);
  if (m) return { intent: 'ask_question', text: m[1], score: 0.97 };
  const m2 = t.match(/^(?:ask|question)\s+(.{8,})$/);
  if (m2 && (ctx.page === 'Ask IREME') && nw >= 4) return { intent: 'ask_question', text: m2[1], score: 0.9 };

  const crop = findCrop(t);
  const district = findDistrict(t);
  const season = (t.match(/\b(?:season|igihembwe)\s+(a|b|c|ay|bee|be|see|ce)\b/) || [])[1];
  const seasonKey = season ? ({ a: 'A', ay: 'A', b: 'B', bee: 'B', be: 'B', c: 'C', see: 'C', ce: 'C' })[season] : null;

  // 1b. map requests: "show fertilizer map", "yield map for maize", "erosion map in Musanze"
  if (!strict && nw <= 10 && /\b(map|maps|ikarita)\b/.test(t)) {
    const LAYER_WORDS = [['anti_erosion', ['anti erosion', 'terrace', 'terraces', 'kurwanya isuri']], ['erosion', ['erosion', 'isuri']], ['fertility_loss', ['fertility', 'uburumbuke']],
      ['waterlogging', ['waterlogging', 'water logging', 'flooding', 'amazi menshi']], ['landslide', ['landslide', 'landslides', 'inkangu']], ['improved_seed', ['improved seed', 'seed', 'seeds', 'imbuto']],
      ['inorganic', ['fertilizer', 'fertiliser', 'ifumbire']], ['organic', ['compost', 'manure', 'imborera']], ['pesticide', ['pesticide', 'crop protection', 'protection']],
      ['irrigation', ['irrigation', 'irrigated', 'kuhira']], ['yield', ['yield', 'harvest', 'production', 'umusaruro']]];
    let layer = null;
    for (const [id, ws] of LAYER_WORDS) { if (ws.some((w) => containsPhrase(t, w))) { layer = id; break; } }
    return { intent: 'map', layer, crop, district, score: 0.93 };
  }
  // 2. weather / advisor / statistics requests that carry a place or crop
  const wantsWeather = /\b(weather|forecast|rain|iteganyagihe|ikirere|imvura)\b/.test(t);
  const wantsAdvice = /\b(advice|advise|adviser|advisor|inama|umujyanama|recommend|recommendation)\b/.test(t);
  const wantsStats = /\b(statistics|stats|yield|imibare|analytics)\b/.test(t);
  if (!strict || nw <= 6) {
    if (wantsAdvice && (crop || district)) return { intent: 'advisor', crop, district, season: seasonKey, read: true, score: 0.93 };
    if (wantsWeather && district && nw <= 8) return { intent: 'weather_for', district, score: 0.93 };
    if (wantsStats && crop && nw <= 8) return { intent: 'stats_for', crop, season: seasonKey, score: 0.92 };
  }

  // 3. set parameters on the page you are on
  const setDistrict = /\b(district|akarere)\b/.test(t) && district;
  const setCrop = /\b(crop|igihingwa)\b/.test(t) && crop;
  if ((setDistrict || setCrop || seasonKey) && nw <= 7 && !strict) {
    return { intent: 'set_params', crop: setCrop ? crop : null, district: setDistrict ? district : null, season: seasonKey, score: 0.9 };
  }
  // 4. toggle practices on the advisor ("I use improved seed", "without fertilizer")
  if (ctx.page === 'Smart Farm Advisor' && nw <= 8) {
    const pk = practiceIn(t);
    if (pk) {
      const off = NOT_USE_WORDS.some((w) => containsPhrase(t, w));
      const on = USE_WORDS.some((w) => containsPhrase(t, w));
      if (off || on) return { intent: 'practice', practice: pk, value: !off, score: 0.9 };
    }
  }

  // 5. control and navigation rules
  const rule = bestRule(t, strict ? 0.88 : 0.8);
  const { text: rest, had: hadVerb } = stripNavVerb(t);
  const pageHit = bestPage(rest || t);
  const pageOk = pageHit && (hadVerb || nw <= 4 || pageHit.score >= 0.95) && !(strict && !hadVerb && nw > 3);

  if (rule && pageOk) {
    // "ask ireme" appears in both lists - prefer ask_start; otherwise higher score wins
    if (rule.rule.intent === 'ask_start' && pageHit.page === 'Ask IREME') return { intent: 'ask_start', score: Math.max(rule.score, pageHit.score) };
    if (pageHit.score > rule.score + 0.04 && hadVerb) return { intent: 'navigate', page: pageHit.page, score: pageHit.score };
  }
  if (rule && !(strict && nw > 4 && rule.score < 0.95)) {
    const r = rule.rule;
    const out = { intent: r.intent, score: rule.score };
    if (r.value !== undefined) out.value = r.value;
    if (r.lang) out.lang = r.lang;
    if (r.dir) out.dir = r.dir;
    return out;
  }
  if (pageOk) return { intent: 'navigate', page: pageHit.page, score: pageHit.score };

  return { intent: 'unknown', score: 0, text: t };
}

// Try every alternative from the recogniser; first confident hit wins, otherwise keep the first alternative.
export function parseAlternatives(alts, ctx = {}) {
  let best = null;
  for (let i = 0; i < alts.length; i++) {
    const r = parseCommand(alts[i], ctx);
    const adj = r.intent === 'unknown' || r.intent === 'none' ? -1 : r.score - i * 0.02;
    if (!best || adj > best.adj) best = { ...r, adj, alt: i };
  }
  return best || { intent: 'none', score: 0 };
}

// Echo filter: true when what we "heard" is mostly what IREME itself is saying.
export function isEcho(heard, spoken) {
  const h = words(norm(heard));
  const s = new Set(words(norm(spoken)));
  if (!h.length || !s.size) return false;
  const overlap = h.filter((w) => s.has(w)).length / h.length;
  return overlap >= 0.6 && h.length >= 3;
}

export const PAGE_LIST = PAGE_ORDER;
export const nextPage = (page, step = 1) => PAGE_ORDER[(PAGE_ORDER.indexOf(page) + step + PAGE_ORDER.length) % PAGE_ORDER.length];
export const pageWords = (page, lang = 'EN') => ((PAGES[page] || {})[lang === 'RW' ? 'rw' : 'en'] || [])[0] || page;

// ------------------------------------------------------------------ help text
const HELP = {
  EN: {
    base: 'You can say: go to dashboard, statistics, advisor, weather, crop scan, or ask IREME. Say read this page to hear the page. Say stop, pause, resume, next, or previous to control reading. Say faster or slower to change speed. Say bigger text or smaller text. Say Kinyarwanda or English to change language. Say where am I to hear the current page. Say stop listening to turn the microphone off.',
    'Ask IREME': 'On Ask IREME, speak your question, for example: how can I increase my maize yield in Musanze. You can speak in several parts. When you finish, say enter, and IREME will answer and read the answer to you. Say clear to start over, read answer to hear it again, new question to ask another, or go to dashboard to leave.',
    'Smart Farm Advisor': 'On the advisor, say: advice for maize in Huye, or set district to Musanze, set crop to beans, season A. Say I use improved seed or I use fertilizer to tell the advisor what you already do. Say read this page to hear the advice.',
    'Forecast': 'On the weather page, say: weather in Musanze, or forecast for Huye. Say refresh forecast to reload. Say read this page to hear the advice.',
    'Statistics': 'On statistics, say: show maize statistics, or season B. For the map, say: show fertilizer map, yield map for maize, or erosion map in Musanze. Say read this page to hear the numbers explained.',
    'Crop Scan': 'On crop scan, use the take photo or upload photo button, then say read this page to hear the result.',
  },
  RW: {
    base: 'Ushobora kuvuga: ahabanza, imibare, umujyanama, iteganyagihe, gusuzuma igihingwa, cyangwa baza IREME. Vuga soma urupapuro kugira ngo wumve urupapuro. Vuga hagarara, tegereza, komeza, ikurikira cyangwa icyabanje kugenzura gusoma. Vuga vuba cyangwa buhoro. Vuga inyandiko nini cyangwa inyandiko nto. Vuga Kinyarwanda cyangwa English guhindura ururimi. Vuga ndi he wumve urupapuro uriho. Vuga hagarika ijwi kugira ngo ufunge mikoro.',
    'Ask IREME': 'Kuri Baza IREME, vuga ikibazo cyawe, urugero: nakongera nte umusaruro w’ibigori muri Musanze. Ushobora kukivuga mu bice. Urangije, vuga ohereza, IREME igusubize kandi igusomere igisubizo. Vuga siba utangire bundi bushya, soma igisubizo wongere wumve, ikibazo gishya kubaza ikindi, cyangwa ahabanza gusohoka.',
    'Smart Farm Advisor': 'Ku mujyanama, vuga: inama ku bigori muri Huye, cyangwa akarere Musanze, igihingwa ibishyimbo, igihembwe A. Vuga nkoresha imbuto nziza cyangwa nkoresha ifumbire kugira ngo umujyanama amenye ibyo usanzwe ukora. Vuga soma urupapuro wumve inama.',
    'Forecast': 'Ku iteganyagihe, vuga: iteganyagihe muri Musanze. Vuga vugurura iteganyagihe. Vuga soma urupapuro wumve inama.',
    'Statistics': 'Ku mibare, vuga: imibare y’ibigori, cyangwa igihembwe B. Ku ikarita, vuga: ikarita y’ifumbire, ikarita y’umusaruro w’ibigori, cyangwa ikarita y’isuri muri Musanze. Vuga soma urupapuro wumve imibare isobanuye.',
    'Crop Scan': 'Ku gusuzuma igihingwa, koresha buto yo gufata cyangwa gushyiraho ifoto, hanyuma uvuge soma urupapuro wumve igisubizo.',
  },
};
export function helpText(page, lang = 'EN') {
  const h = HELP[lang === 'RW' ? 'RW' : 'EN'];
  return (h[page] ? h[page] + ' ' : '') + h.base;
}
export const ALL_DISTRICT_NAMES = ALL_DISTRICTS;
export const CROP_NAMES = Object.keys(CROP_ALIASES);
