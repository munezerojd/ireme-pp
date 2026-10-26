// IREME - speech output (reading mode). Wraps the browser's speechSynthesis with:
//  * sentence chunking (Chrome cuts off long utterances),
//  * adjustable speed, pause / resume / stop,
//  * guided page reading with highlighting, skip-next / skip-previous,
//  * knowledge of what is being spoken so the microphone can ignore IREME's own voice.

const HIGHLIGHT = 'reading-highlight';

// Kinyarwanda reading aloud and voice recognition are still under development.
// While this is false, any attempt to speak or listen in Kinyarwanda shows the "Iracyari kubakwa / Under development"
// notice instead. Set it to true when a good Kinyarwanda voice and recogniser are available.
export const RW_VOICE_READY = false;
let blockedHandler = null;
export const setSpeechBlockHandler = (fn) => { blockedHandler = fn; };
function rwBlocked(lang) {
  if (lang === 'RW' && !RW_VOICE_READY) { if (blockedHandler) blockedHandler(); return true; }
  return false;
}
let rate = 1;
let session = 0;                 // bumped on every stop so stale callbacks do nothing
let spokenNow = '';              // text currently being spoken (for echo filtering)
let speaking = false;
let pageReader = null;
const listeners = new Set();

const synth = () => (typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null);
export const speechSupported = () => !!synth();
export const isSpeaking = () => speaking;
export const currentSpokenText = () => spokenNow;
export const getRate = () => rate;
export const setRate = (r) => { rate = Math.min(1.6, Math.max(0.6, r)); return rate; };
export const onSpeechState = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
function emit(state) { speaking = state; listeners.forEach((f) => { try { f(state); } catch (_) { /* ignore */ } }); }

export const langTag = (lang) => (lang === 'RW' ? 'rw-RW' : 'en-US');

export function clearHighlights() {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('.' + HIGHLIGHT).forEach((el) => el.classList.remove(HIGHLIGHT));
}

// Split into short, natural chunks so long answers are never cut off mid-way.
export function chunkText(text, max = 180) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?…]+[.!?…]*\s*/g) || [clean];
  const out = [];
  let cur = '';
  for (const s of sentences) {
    if ((cur + s).length > max && cur) { out.push(cur.trim()); cur = ''; }
    if (s.length > max) {
      const parts = s.split(/(?<=[,;:])\s+/);
      for (const p of parts) {
        if ((cur + p).length > max && cur) { out.push(cur.trim()); cur = ''; }
        cur += p + ' ';
      }
    } else cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function stopSpeaking() {
  session += 1;
  pageReader = null;
  const s = synth();
  if (s) { try { s.cancel(); } catch (_) { /* ignore */ } }
  spokenNow = '';
  clearHighlights();
  emit(false);
}
export function pauseSpeaking() { const s = synth(); if (s && speaking) s.pause(); }
export function resumeSpeaking() { const s = synth(); if (s) s.resume(); }

// Speak text. Options: lang ('EN'|'RW'), interrupt (default true), onEnd, highlight (element to highlight while speaking).
export function speak(text, { lang = 'EN', interrupt = true, onEnd = null, highlight = null } = {}) {
  if (rwBlocked(lang)) return 0;
  const s = synth();
  const chunks = chunkText(text);
  if (!s || !chunks.length) { if (onEnd) onEnd(); return 0; }
  if (interrupt) { try { s.cancel(); } catch (_) { /* ignore */ } clearHighlights(); }
  const my = ++session;
  spokenNow = chunks.join(' ');
  if (highlight && highlight.classList) { clearHighlights(); highlight.classList.add(HIGHLIGHT); }
  emit(true);
  chunks.forEach((c, i) => {
    const u = new SpeechSynthesisUtterance(c);
    u.lang = langTag(lang);
    u.rate = rate;
    const last = i === chunks.length - 1;
    u.onend = () => {
      if (my !== session) return;
      if (last) {
        spokenNow = ''; emit(false);
        if (highlight && highlight.classList) highlight.classList.remove(HIGHLIGHT);
        if (onEnd) onEnd();
      }
    };
    u.onerror = (e) => {
      if (my !== session) return;
      if (e && (e.error === 'canceled' || e.error === 'interrupted')) return;
      if (last) { spokenNow = ''; emit(false); if (onEnd) onEnd(); }
    };
    s.speak(u);
  });
  return my;
}

// ------------------------------------------------------------------ page reading
const SKIP = 'select, option, svg, script, style, [data-noread], [aria-hidden="true"], input, textarea';
const BLOCK_TAGS = 'h1,h2,h3,h4,p,li,div,article,section,small,label,tr,summary,details';

export function readableText(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll(SKIP).forEach((n) => n.remove());
  clone.querySelectorAll('button').forEach((b) => { if (!b.hasAttribute('data-read')) b.remove(); });
  clone.querySelectorAll(BLOCK_TAGS).forEach((n) => n.append(' . '));
  return (clone.textContent || '').replace(/\s*\.\s*(\.\s*)+/g, '. ').replace(/\s+/g, ' ').trim();
}

export function pageBlocks(root) {
  if (!root) return [];
  const tops = Array.from(root.querySelectorAll(':scope > section')).filter((el) => !el.classList.contains('voice-command-status'));
  const blocks = [];
  tops.forEach((s) => {
    const text = readableText(s);
    if (!text) return;
    if (text.length > 800) {
      const kids = Array.from(s.children).filter((k) => readableText(k));
      if (kids.length > 1) {
        kids.forEach((k) => { if (k.children.length && readableText(k).length > 900) Array.from(k.children).filter((g) => readableText(g)).forEach((g) => blocks.push(g)); else blocks.push(k); });
        return;
      }
    }
    blocks.push(s);
  });
  return blocks;
}

// Guided reading with highlight. Returns a controller {next, prev, stop}.
export function readPage({ lang = 'EN', root = null, onStatus = null, startAt = 0 } = {}) {
  if (rwBlocked(lang)) { if (onStatus) onStatus('blocked'); return null; }
  const s = synth();
  if (!s) { if (onStatus) onStatus('unsupported'); return null; }
  stopSpeaking();
  const main = root || document.querySelector('.main');
  const blocks = pageBlocks(main);
  if (!blocks.length) { if (onStatus) onStatus('empty'); return null; }
  const my = ++session;
  let index = Math.max(0, startAt);
  let token = 0;                       // each block gets its own token so late 'end' events of cancelled blocks are ignored
  const ctrl = {
    blocks,
    get index() { return index; },
    stop() { stopSpeaking(); },
    next() { if (my === session) { s.cancel(); playAt(index + 1); } },
    prev() { if (my === session) { s.cancel(); playAt(Math.max(0, index - 1)); } },
  };
  function playAt(i) {
    if (my !== session) return;
    const tok = ++token;
    clearHighlights();
    if (i >= blocks.length) { spokenNow = ''; emit(false); pageReader = null; if (onStatus) onStatus('done'); return; }
    index = i;
    const el = blocks[i];
    const text = readableText(el);
    if (!text) { playAt(i + 1); return; }
    el.classList.add(HIGHLIGHT);
    try { el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (_) { /* ignore */ }
    const chunks = chunkText(text);
    spokenNow = chunks.join(' ');
    emit(true);
    if (onStatus) onStatus('reading', i, blocks.length);
    chunks.forEach((c, k) => {
      const u = new SpeechSynthesisUtterance(c);
      u.lang = langTag(lang); u.rate = rate;
      const last = k === chunks.length - 1;
      u.onend = () => { if (my === session && tok === token && last) playAt(i + 1); };
      u.onerror = (e) => { if (my === session && tok === token && last && !(e && (e.error === 'canceled' || e.error === 'interrupted'))) playAt(i + 1); };
      s.speak(u);
    });
  }
  pageReader = ctrl;
  playAt(index);
  return ctrl;
}
export const activePageReader = () => pageReader;
