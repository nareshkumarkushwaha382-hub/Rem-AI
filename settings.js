// User settings, stored only in this browser (localStorage). No secrets except the
// optional access code the user chooses to type for their own backend.
const KEY = "rem.settings.v1";

const DEFAULTS = {
  backendUrl: "",
  accessCode: "",
  sttLang: "auto",     // auto | hinglish | hindi | english
  voiceURI: "",        // "" = automatic
  rate: 1,
  pitch: 1.1,
  speak: true,         // speak replies aloud
  handsFree: false,    // listen again automatically after Rem finishes speaking
};

export function loadSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || "{}") || {};
  } catch { /* storage blocked: use defaults */ }
  const cfg = (window.REM_CONFIG && window.REM_CONFIG.BACKEND_URL) || "";
  const s = { ...DEFAULTS, backendUrl: cfg, ...saved };
  if (!saved.backendUrl) s.backendUrl = cfg;
  return s;
}

export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch { /* ignore */ }
}

// SpeechRecognition language codes
export const STT_LANGS = { auto: "en-IN", hinglish: "en-IN", hindi: "hi-IN", english: "en-US" };
