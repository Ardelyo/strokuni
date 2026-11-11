// Voice first: TTS for every prompt, dictation for notes.
import { Native, isNative } from './native.js';
import { state } from './store.js';

let voice = null;
function pickVoice() {
  if (!('speechSynthesis' in window)) return;
  const voices = speechSynthesis.getVoices();
  voice = voices.find((v) => v.lang === 'id-ID') || voices.find((v) => v.lang?.startsWith('id')) || null;
}
if ('speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

export function hasIndonesianVoice() { return isNative || !!voice; }

export function speak(text, { interrupt = true } = {}) {
  if (!text) return;
  const rate = state.settings.speechRate || 0.9;
  if (isNative && Native.available()) { Native.speak(text, rate); return; }
  if (!('speechSynthesis' in window)) return;
  if (interrupt) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'id-ID';
  if (voice) u.voice = voice;
  u.rate = rate;
  u.pitch = 1;
  speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (isNative) Native.stopSpeaking();
  else if ('speechSynthesis' in window) speechSynthesis.cancel();
}

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = () => (isNative && Native.available()) || !!SR;

/**
 * Listen once. onPartial(text) receives interim results (web only).
 * Resolves with the final text ('' if nothing heard).
 */
export function listen({ onPartial, prompt = 'Silakan bicara' } = {}) {
  if (isNative && Native.available()) {
    return Native.listen(prompt).then((r) => r?.text || '');
  }
  if (!SR) return Promise.reject(new Error('Pengenalan suara tidak tersedia di browser ini'));
  return new Promise((resolve, reject) => {
    const rec = new SR();
    rec.lang = 'id-ID';
    rec.interimResults = true;
    rec.continuous = true;
    let finalText = '';
    let stopTimer;
    const bump = () => { clearTimeout(stopTimer); stopTimer = setTimeout(() => rec.stop(), 4000); };
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript + ' ';
        else interim += r[0].transcript;
      }
      onPartial?.((finalText + interim).trim());
      bump();
    };
    rec.onerror = (e) => { clearTimeout(stopTimer); if (e.error === 'no-speech') resolve(''); else reject(new Error(e.error)); };
    rec.onend = () => { clearTimeout(stopTimer); resolve(finalText.trim()); };
    listen.stop = () => rec.stop();
    rec.start();
    bump();
  });
}
