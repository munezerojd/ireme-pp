// IREME - turns a parsed voice command into app actions.
// main.jsx passes an `api` object (state getters/setters); this file holds all the behaviour so the
// big App component stays small.
import { speak, stopSpeaking, pauseSpeaking, resumeSpeaking, readPage, activePageReader, setRate, getRate, speechSupported } from './speech.js';
import { helpText, nextPage, pageWords } from './commands.js';

const RW_PAGE = { 'Dashboard': 'Ahabanza', 'Farmer data': 'Amakuru y’umuhinzi', 'Statistics': 'Imibare', 'Smart Farm Advisor': 'Umujyanama w’ubuhinzi', 'Forecast': 'Iteganyagihe', 'Crop Scan': 'Gusuzuma igihingwa', 'Ask IREME': 'Baza IREME', 'Admin data': 'Imicungire y’amakuru' };
const pageLabel = (p, lang) => (lang === 'RW' ? RW_PAGE[p] || p : p);
const T = (lang, en, rw) => (lang === 'RW' ? rw : en);

export function createExecutor(api) {
  const state = { askListening: false, lastSpoken: '', history: [], textScale: 1, draft: '', promptedEnter: false, forceRead: false, skipRead: false };

  const say = (text, opts = {}) => { state.lastSpoken = text; speak(text, { lang: api.getLang(), ...opts }); };
  const status = (t) => api.setStatus && api.setStatus(t);

  function startAsking() {
    state.askListening = true;
    status(T(api.getLang(), 'Listening for your question… just speak.', 'Ndategereje ikibazo cyawe… vuga gusa.'));
    api.setAskListening && api.setAskListening(true);
  }
  function stopAsking() {
    state.askListening = false;
    api.setAskListening && api.setAskListening(false);
  }

  async function submitQuestion(text) {
    const lang = api.getLang();
    stopAsking();
    state.draft = ''; state.promptedEnter = false;
    status(T(lang, 'Heard your question: ', 'Numvise ikibazo cyawe: ') + text);
    api.setQuestion(text);
    const answer = await api.ask(text);            // returns the answer text
    if (answer) {
      state.lastSpoken = answer;
      // answer is shown in the page; read it aloud and highlight it (reading mode)
      setTimeout(() => {
        const el = document.querySelector('.asklayout .answer');
        speak(answer + ' ' + T(lang, 'You can ask another question, or say go to dashboard.', 'Ushobora kubaza ikindi kibazo, cyangwa uvuge ahabanza.'), {
          lang, highlight: el, onEnd: () => startAsking(),
        });
      }, 150);
    } else {
      startAsking();
    }
  }

  const SLOW_PAGES = { 'Statistics': 1800, 'Smart Farm Advisor': 1800, 'Forecast': 1900 };
  function onPageEnter(page, readingMode, first = false) {
    const lang = api.getLang();
    stopAsking();
    const force = state.forceRead; const skip = state.skipRead;
    state.forceRead = false; state.skipRead = false;
    if (first) {
      const greet = T(lang, 'Welcome to IREME. Voice mode and reading mode are on. I will read each page for you. Say stop to interrupt, or help to hear all commands.',
        'Murakaza neza kuri IREME. Uburyo bw’ijwi n’ubwo gusoma burakora. Nzajya nsoma buri rupapuro. Vuga hagarara kunsiba, cyangwa ubufasha wumve amabwiriza yose.');
      if (readingMode) { speak(greet, { lang, onEnd: () => { if (api.getPage() === page) readPage({ lang: api.getLang() }); } }); state.lastSpoken = greet; return; }
      say(greet);
      return;
    }
    if (page === 'Ask IREME' && api.isVoiceOn && !api.isVoiceOn()) {
      say(T(lang, 'Ask IREME. Type your question, or press the speak button.', 'Baza IREME. Andika ikibazo cyawe, cyangwa ukande buto yo kuvuga.'));
      return;
    }
    if (page === 'Ask IREME') {
      state.draft = ''; state.promptedEnter = false;
      say(T(lang, 'Ask IREME. Speak your question now. When you finish, say enter.', 'Baza IREME. Vuga ikibazo cyawe ubu. Urangije, vuga ohereza.'), { onEnd: () => { if (api.getPage() === 'Ask IREME') startAsking(); } });
      startAsking();
      return;
    }
    if (skip || !(readingMode || force)) return;
    setTimeout(() => {
      if (api.getPage() !== page) return;
      speak(pageLabel(page, api.getLang()) + '.', { lang: api.getLang(), onEnd: () => {
        if (api.getPage() !== page) return;
        const c = readPage({ lang: api.getLang(), onStatus: (st) => { if (st === 'done') status(T(api.getLang(), 'Finished reading this page.', 'Ndangije gusoma uru rupapuro.')); } });
        if (c) status(T(api.getLang(), 'Reading this page. Say stop, pause or next.', 'Ndimo gusoma uru rupapuro. Vuga hagarara, tegereza cyangwa ikurikira.'));
      } });
    }, SLOW_PAGES[page] || 700);
  }

  // live words while the user is still speaking a question
  function interim(text) {
    if (state.askListening && api.getPage() === 'Ask IREME') api.setQuestion((state.draft + ' ' + text).trim());
  }
  function readNow(page) {
    const lang = api.getLang();
    speak(pageLabel(page, lang) + '.', { lang, onEnd: () => { if (api.getPage() === page) readPage({ lang: api.getLang() }); } });
  }

  function run(cmd, raw) {
    const lang = api.getLang();
    const page = api.getPage();
    status((lang === 'RW' ? 'Numvise: ' : 'Heard: ') + raw);

    // while waiting for a question, anything that is not a command is the question
    if (state.askListening && page === 'Ask IREME') {
      if (cmd.intent === 'unknown' || cmd.intent === 'none') {
        const q = String(raw || '').trim();
        if (q.split(/\s+/).length < 2 && !state.draft) return;
        state.draft = (state.draft + ' ' + q).trim();
        api.setQuestion(state.draft);
        status(T(lang, 'Your question: ', 'Ikibazo cyawe: ') + state.draft + T(lang, '  — say “enter” to get the answer.', '  — vuga “ohereza” ubone igisubizo.'));
        if (!state.promptedEnter) { state.promptedEnter = true; say(T(lang, 'Got it. Say enter to get the answer, or keep speaking.', 'Nabyumvise. Vuga ohereza ubone igisubizo, cyangwa komeza uvuge.')); }
        return;
      }
      if (cmd.intent === 'dictate_submit') { state.draft = (state.draft + ' ' + cmd.text).trim(); api.setQuestion(state.draft); submitQuestion(state.draft); return; }
    }
    if (cmd.intent === 'dictate_submit') { submitQuestion(cmd.text); return; }
    switch (cmd.intent) {
      case 'none': return;
      case 'navigate':
        if (cmd.page === page) { readNow(page); return; }
        state.forceRead = true;
        api.goto(cmd.page);
        status(T(lang, 'Opening ', 'Mfunguye ') + pageLabel(cmd.page, lang));
        return;
      case 'back': state.forceRead = true; api.goBack(); return;
      case 'next_page': state.forceRead = true; api.goto(nextPage(page, 1)); return;
      case 'language': api.setLang(cmd.lang); setTimeout(() => speak(cmd.lang === 'RW' ? 'Ururimi rwahinduwe mu Kinyarwanda.' : 'Language changed to English.', { lang: cmd.lang }), 50); return;
      case 'stop_reading': stopSpeaking(); stopAsking(); status(T(lang, 'Stopped. Say read this page to start again.', 'Mpagaritse. Vuga soma urupapuro kugira ngo ntangire.')); return;
      case 'pause': pauseSpeaking(); status(T(lang, 'Paused. Say resume to continue.', 'Mpagaritse by’agateganyo. Vuga komeza.')); return;
      case 'resume': resumeSpeaking(); return;
      case 'next_block': { const c = activePageReader(); if (c) c.next(); return; }
      case 'prev_block': { const c = activePageReader(); if (c) c.prev(); return; }
      case 'read_page': stopAsking(); readPage({ lang }); return;
      case 'repeat': if (state.lastSpoken) say(state.lastSpoken); else readPage({ lang }); return;
      case 'faster': setRate(getRate() + 0.15); say(T(lang, 'Speaking faster.', 'Ndavuga vuba.')); return;
      case 'slower': setRate(getRate() - 0.15); say(T(lang, 'Speaking slower.', 'Ndavuga buhoro.')); return;
      case 'normal_speed': setRate(1); say(T(lang, 'Normal speed.', 'Umuvuduko usanzwe.')); return;
      case 'reading_mode': api.setReadingMode(cmd.value); say(cmd.value ? T(lang, 'Reading mode is on. I will read each page for you.', 'Uburyo bwo gusoma burakora. Nzajya nsoma buri rupapuro.') : T(lang, 'Reading mode is off.', 'Uburyo bwo gusoma bwarafunzwe.')); return;
      case 'voice_off': say(T(lang, 'Voice assistance stopped.', 'Uburyo bw’ijwi burahagarara.')); api.setVoice(false); return;
      case 'sign': api.setSign(cmd.value); return;
      case 'text_bigger': state.textScale = Math.min(1.5, state.textScale + 0.1); api.setTextScale(state.textScale); say(T(lang, 'Bigger text.', 'Inyandiko nini.')); return;
      case 'text_smaller': state.textScale = Math.max(0.8, state.textScale - 0.1); api.setTextScale(state.textScale); say(T(lang, 'Smaller text.', 'Inyandiko nto.')); return;
      case 'text_reset': state.textScale = 1; api.setTextScale(1); say(T(lang, 'Normal text size.', 'Inyandiko isanzwe.')); return;
      case 'scroll': {
        const el = document.querySelector('.main') || document.scrollingElement;
        const target = document.scrollingElement || document.documentElement;
        const h = window.innerHeight * 0.8;
        if (cmd.dir === 'down') window.scrollBy({ top: h, behavior: 'smooth' });
        else if (cmd.dir === 'up') window.scrollBy({ top: -h, behavior: 'smooth' });
        else if (cmd.dir === 'top') window.scrollTo({ top: 0, behavior: 'smooth' });
        else window.scrollTo({ top: target.scrollHeight, behavior: 'smooth' });
        return void el;
      }
      case 'where': say(T(lang, `You are on ${page}. Say help to hear what you can do here.`, `Uri ku rupapuro rwa ${pageLabel(page, lang)}. Vuga ubufasha wumve ibyo ushobora gukora hano.`)); return;
      case 'help': { const text = helpText(page, lang); api.showHelp(T(lang, 'Voice commands', 'Amabwiriza y’ijwi'), text); say(text); return; }
      case 'theme': api.setTheme(cmd.value); say(cmd.value === 'dark' ? T(lang, 'Dark mode on.', 'Uburyo bw’ijoro burakora.') : T(lang, 'Light mode on.', 'Uburyo bw’amanywa burakora.')); return;
      case 'install_app': api.installApp(); return;
      case 'refresh_weather': api.goto('Forecast'); api.loadWeather(); say(T(lang, 'Refreshing the forecast.', 'Ndimo kuvugurura iteganyagihe.')); return;
      case 'weather_for':
        if (api.hasWeatherDistrict(cmd.district)) { api.setWeatherDistrict(cmd.district); api.goto('Forecast'); status(T(lang, 'Weather for ', 'Iteganyagihe rya ') + cmd.district); }
        else { api.goto('Smart Farm Advisor'); setTimeout(() => window.dispatchEvent(new CustomEvent('ireme:advisor', { detail: { district: cmd.district, read: true } })), 350); }
        return;
      case 'stats_for': api.goto('Statistics'); window.dispatchEvent(new CustomEvent('ireme:stats', { detail: { crop: cmd.crop } })); say(T(lang, `Showing ${cmd.crop} statistics.`, `Mbonetse imibare ya ${cmd.crop}.`)); return;
      case 'map': {
        const delay = page === 'Statistics' ? 150 : 1300;
        if (page !== 'Statistics') { state.skipRead = true; api.goto('Statistics'); }
        setTimeout(() => window.dispatchEvent(new CustomEvent('ireme:map', { detail: { layer: cmd.layer || undefined, crop: cmd.crop || undefined, district: cmd.district || undefined, read: true } })), delay);
        status(T(lang, 'Showing the agriculture map.', 'Mfunguye ikarita y’ubuhinzi.'));
        return;
      }
      case 'advisor': {
        if (page !== 'Smart Farm Advisor') state.skipRead = true;
        api.goto('Smart Farm Advisor');
        setTimeout(() => window.dispatchEvent(new CustomEvent('ireme:advisor', { detail: { crop: cmd.crop, district: cmd.district, season: cmd.season, read: true } })), 350);
        return;
      }
      case 'set_params':
        if (cmd.district) { if (api.hasWeatherDistrict(cmd.district)) api.setWeatherDistrict(cmd.district); window.dispatchEvent(new CustomEvent('ireme:advisor', { detail: { district: cmd.district } })); }
        if (cmd.crop) { window.dispatchEvent(new CustomEvent('ireme:advisor', { detail: { crop: cmd.crop } })); window.dispatchEvent(new CustomEvent('ireme:stats', { detail: { crop: cmd.crop } })); }
        if (cmd.season) { window.dispatchEvent(new CustomEvent('ireme:advisor', { detail: { season: cmd.season } })); }
        say(T(lang, 'Done.', 'Birakozwe.'));
        return;
      case 'practice':
        window.dispatchEvent(new CustomEvent('ireme:advisor', { detail: { practice: cmd.practice, value: cmd.value } }));
        say(T(lang, cmd.value ? 'Noted. I updated the advice.' : 'Removed. I updated the advice.', cmd.value ? 'Byanditswe. Navuguruye inama.' : 'Nakuyeho. Navuguruye inama.'));
        return;
      case 'ask_start': if (page !== 'Ask IREME') api.goto('Ask IREME'); else { say(T(lang, 'I am listening. Ask your question.', 'Ndakumva. Baza ikibazo cyawe.')); startAsking(); } return;
      case 'ask_question': if (page !== 'Ask IREME') api.goto('Ask IREME'); submitQuestion(cmd.text); return;
      case 'read_answer': { const t = api.getAnswer(); if (t) say(t, { highlight: document.querySelector('.asklayout .answer') }); else say(T(lang, 'There is no answer yet. Ask a question first.', 'Nta gisubizo kirabaho. Banza ubaze ikibazo.')); return; }
      case 'clear_question': state.draft = ''; state.promptedEnter = false; api.setQuestion(''); api.setAnswer(''); say(T(lang, 'Ready. Ask your next question.', 'Nditeguye. Baza ikindi kibazo.')); if (page !== 'Ask IREME') api.goto('Ask IREME'); startAsking(); return;
      case 'submit_question': { const q = (state.draft || api.getQuestion() || '').trim(); if (q) submitQuestion(q); else say(T(lang, 'Please speak your question first.', 'Banza uvuge ikibazo cyawe.')); return; }
      case 'unknown':
      default:
        if (String(raw || '').trim().split(/\s+/).length < 2) return;     // ignore single noisy words
        say(T(lang, 'Sorry, I did not understand. Say help to hear the commands.', 'Mbabarira, sinumvise. Vuga ubufasha wumve amabwiriza.'));
    }
  }

  return { run, onPageEnter, interim, startAsking, stopAsking, state, supported: speechSupported, pageWords };
}
