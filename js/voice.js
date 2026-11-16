// Voice: speech-to-text (SpeechRecognition) and text-to-speech (speechSynthesis).
// Both are built into Chrome on Android; no extra service or key is needed.
import { STT_LANGS } from "./settings.js";

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const hasDevanagari = (t) => /[ऀ-ॿ]/.test(t);

// Remove things a voice would read badly: markdown marks, emoji, URLs.
export function cleanForSpeech(text) {
  return text
    .replace(/https?:\/\/\S+/g, " link ")
    .replace(/[*_`#>~|]/g, "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Long utterances get cut off on some Android versions, so speak sentence by sentence.
export function splitSentences(text, maxLen = 180) {
  const parts = text.split(/(?<=[.!?।…])\s+/).filter(Boolean);
  const out = [];
  for (let p of parts) {
    while (p.length > maxLen) {
      let cut = p.lastIndexOf(" ", maxLen);
      if (cut < 40) cut = maxLen;
      out.push(p.slice(0, cut).trim());
      p = p.slice(cut).trim();
    }
    if (p) out.push(p);
  }
  return out;
}

export class Voice {
  constructor() {
    this.sttSupported = !!SR;
    this.ttsSupported = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
    this.recog = null;
    this.listening = false;
    this._speakToken = 0;
    this.speaking = false;
    this.voices = [];
    if (this.ttsSupported) {
      const load = () => (this.voices = speechSynthesis.getVoices() || []);
      load();
      speechSynthesis.addEventListener?.("voiceschanged", load);
    }
  }

  // ------------------------------------------------------------ listening
  /**
   * handlers: { onInterim(text), onFinal(text), onEnd(), onError(message) }
   */
  startListening(lang, handlers) {
    if (!this.sttSupported) {
      handlers.onError("Voice input isn't supported in this browser. Please use Chrome on Android, or type instead.");
      return false;
    }
    if (this.listening) return true;
    this.stopSpeaking();
    const r = new SR();
    r.lang = STT_LANGS[lang] || lang || "en-IN";
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    let finalText = "";
    let gotError = false;

    r.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finalText += t;
        else interim += t;
      }
      if (interim) handlers.onInterim(finalText + interim);
    };
    r.onerror = (ev) => {
      gotError = true;
      const map = {
        "not-allowed": "Microphone permission was denied. Allow the microphone for this site in your browser settings, or type instead.",
        "service-not-allowed": "Speech recognition isn't allowed here. Please type instead.",
        "no-speech": "I didn't hear anything. Tap the mic and try again.",
        "audio-capture": "I can't find a microphone on this device.",
        "network": "Speech recognition needs an internet connection.",
        "aborted": "",
      };
      const msg = ev.error in map ? map[ev.error] : `Voice input error: ${ev.error}`;
      if (msg) handlers.onError(msg);
    };
    r.onend = () => {
      this.listening = false;
      this.recog = null;
      const text = finalText.trim();
      if (text) handlers.onFinal(text);
      handlers.onEnd(!!text, gotError);
    };
    try {
      r.start();
      this.recog = r;
      this.listening = true;
      return true;
    } catch (e) {
      handlers.onError("Couldn't start the microphone. Please try again.");
      return false;
    }
  }

  stopListening() {
    if (this.recog) {
      try { this.recog.stop(); } catch { /* already stopped */ }
    }
  }

  abortListening() {
    if (this.recog) {
      try { this.recog.abort(); } catch { /* ignore */ }
    }
  }

  // ------------------------------------------------------------ speaking
  pickVoice(text, voiceURI) {
    const wantHindi = hasDevanagari(text);
    const byLang = (prefix) => this.voices.find((v) => v.lang.replace("_", "-").toLowerCase().startsWith(prefix));
    const chosen = voiceURI && this.voices.find((v) => v.voiceURI === voiceURI);
    if (wantHindi) {
      if (chosen && /^hi/i.test(chosen.lang)) return chosen;
      return byLang("hi") || chosen || null;
    }
    return chosen || byLang("en-in") || byLang("en") || null;
  }

  /**
   * opts: { voiceURI, rate, pitch, onStart(), onWord(), onEnd() }
   * Resolves when finished or cancelled.
   */
  speak(text, opts = {}) {
    const clean = cleanForSpeech(text);
    if (!this.ttsSupported || !clean) return Promise.resolve(false);
    this.stopSpeaking();
    const token = ++this._speakToken;
    const chunks = splitSentences(clean);
    const hindi = hasDevanagari(clean);
    this.speaking = true;

    return new Promise((resolve) => {
      this._cancelPending = () => resolve(false); // lets stopSpeaking() settle this promise
      let idx = 0;
      let started = false;
      const finish = (completed) => {
        if (token !== this._speakToken) return resolve(false);
        this.speaking = false;
        opts.onEnd?.();
        resolve(completed);
      };
      const next = () => {
        if (token !== this._speakToken) return resolve(false);
        if (idx >= chunks.length) return finish(true);
        const u = new SpeechSynthesisUtterance(chunks[idx++]);
        const voice = this.pickVoice(clean, opts.voiceURI);
        if (voice) u.voice = voice;
        u.lang = voice ? voice.lang : hindi ? "hi-IN" : "en-IN";
        u.rate = opts.rate || 1;
        u.pitch = opts.pitch || 1;
        u.onstart = () => {
          if (!started) { started = true; opts.onStart?.(); }
        };
        u.onboundary = () => opts.onWord?.();
        u.onend = next;
        u.onerror = (e) => {
          if (e.error === "canceled" || e.error === "interrupted") return;
          finish(false);
        };
        speechSynthesis.speak(u);
      };
      // Safety net: if the browser never fires onstart (blocked/muted engine), still unblock the UI.
      setTimeout(() => {
        if (token === this._speakToken && !started && this.speaking) {
          started = true;
          opts.onStart?.();
        }
      }, 1500);
      next();
    });
  }

  stopSpeaking() {
    this._speakToken++;
    this.speaking = false;
    const pending = this._cancelPending;
    this._cancelPending = null;
    if (this.ttsSupported) speechSynthesis.cancel();
    if (pending) pending();
  }
}
