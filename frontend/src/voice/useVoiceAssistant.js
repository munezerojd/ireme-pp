// IREME - always-on voice assistant hook (Web Speech API recognition).
// Robustness: auto-restart with back-off, language fallback (Kinyarwanda -> English if the browser
// has no Kinyarwanda recogniser), up to 5 alternatives per phrase, instant "stop" while IREME is
// talking, and an echo filter so IREME does not obey its own voice.
import { useEffect, useRef, useState } from 'react';
import { parseAlternatives, isEcho } from './commands.js';
import { isSpeaking, currentSpokenText } from './speech.js';

export const recognitionSupported = () => typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

export function useVoiceAssistant({ enabled, lang, getContext, onCommand, onStatus, onInterim }) {
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const latest = useRef({});
  latest.current = { lang, getContext, onCommand, onStatus, onInterim };

  useEffect(() => {
    if (!enabled) { setListening(false); return undefined; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { latest.current.onStatus && latest.current.onStatus('unsupported'); return undefined; }
    let alive = true;
    let rec = null;
    let fallbackLang = null;      // set to 'en-US' if Kinyarwanda recognition is not available
    let failures = 0;
    let restartTimer = null;
    let lastFinal = { text: '', at: 0 };
    let urgentHandledAt = 0;

    const recLang = () => fallbackLang || (latest.current.lang === 'RW' ? 'rw-RW' : 'en-US');

    function handle(alts, isFinal) {
      const ctx = { ...(latest.current.getContext ? latest.current.getContext() : {}), lang: latest.current.lang };
      const spoken = isSpeaking() ? currentSpokenText() : '';
      const first = alts[0] || '';
      if (spoken && isEcho(first, spoken)) return;                       // that was IREME's own voice
      const cmd = parseAlternatives(alts, ctx);
      if (!isFinal) {
        if (!spoken && latest.current.onInterim) latest.current.onInterim(first);
        // only react early to short, urgent controls (stop / pause / next) while IREME is talking
        if (spoken && cmd.score >= 0.9 && ['stop_reading', 'pause', 'next_block', 'prev_block'].includes(cmd.intent) && first.split(' ').length <= 3) {
          urgentHandledAt = Date.now();
          latest.current.onCommand(cmd, first);
        }
        return;
      }
      if (Date.now() - urgentHandledAt < 1500 && ['stop_reading', 'pause', 'next_block', 'prev_block'].includes(cmd.intent)) return;
      const now = Date.now();
      if (first === lastFinal.text && now - lastFinal.at < 1500) return; // duplicate final result
      lastFinal = { text: first, at: now };
      setHeard(first);
      latest.current.onCommand(cmd, first);
    }

    function start() {
      if (!alive) return;
      try {
        rec = new SR();
        rec.lang = recLang();
        rec.continuous = true;
        rec.interimResults = true;
        rec.maxAlternatives = 5;
        rec.onstart = () => { failures = 0; setListening(true); latest.current.onStatus && latest.current.onStatus('listening', rec.lang); };
        rec.onresult = (ev) => {
          for (let i = ev.resultIndex; i < ev.results.length; i++) {
            const res = ev.results[i];
            const alts = [];
            for (let k = 0; k < res.length; k++) alts.push(res[k].transcript);
            if (alts.length) handle(alts, res.isFinal);
          }
        };
        rec.onerror = (ev) => {
          if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') { alive = false; setListening(false); latest.current.onStatus && latest.current.onStatus('denied'); }
          else if (ev.error === 'language-not-supported' && !fallbackLang) { fallbackLang = 'en-US'; latest.current.onStatus && latest.current.onStatus('fallback'); }
          else if (ev.error === 'network') { latest.current.onStatus && latest.current.onStatus('network'); }
          else if (ev.error !== 'no-speech' && ev.error !== 'aborted') { latest.current.onStatus && latest.current.onStatus('problem'); }
        };
        rec.onend = () => {
          setListening(false);
          if (!alive) return;
          failures += 1;
          const delay = Math.min(3000, 250 * failures);
          restartTimer = setTimeout(start, delay);
        };
        rec.start();
      } catch (_) {
        failures += 1;
        restartTimer = setTimeout(start, Math.min(3000, 400 * failures));
      }
    }
    start();

    return () => {
      alive = false;
      clearTimeout(restartTimer);
      if (rec) { rec.onend = null; rec.onresult = null; rec.onerror = null; try { rec.abort(); } catch (_) { /* ignore */ } }
      setListening(false);
    };
  }, [enabled, lang]);

  return { listening, heard, supported: recognitionSupported() };
}
