import { Character, loadManifest } from "./character.js";
import { Api, ApiError } from "./api.js";
import { Voice } from "./voice.js";
import { loadSettings, saveSettings } from "./settings.js";

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let settings = loadSettings();
const api = new Api(() => settings);
const voice = new Voice();
let character;
let speakSession = 0;
let busy = false;
let pendingSuggestion = null;
let idleTimer = null;

const GREETING = "Namaste! Main Rem hoon. Aap mujhse Hindi, English ya Hinglish mein baat kar sakte hain. How can I help you today?";

// ------------------------------------------------------------------ status + UI helpers
function setStatus(state, text) {
  const labels = { idle: "Ready", listening: "Listening…", thinking: "Thinking…", speaking: "Speaking…", error: "Problem" };
  $("status").dataset.state = state;
  $("status-text").textContent = text || labels[state] || "Ready";
  $("btn-mic").setAttribute("aria-pressed", String(state === "listening"));
  $("btn-mic").setAttribute("aria-label", state === "listening" ? "Stop listening" : "Start listening");
}

function setHint(text, ms = 0) {
  $("hint").textContent = text || "";
  if (ms) setTimeout(() => { if ($("hint").textContent === text) $("hint").textContent = ""; }, ms);
}

function toast(text) {
  const el = document.createElement("div");
  el.className = "save-note";
  el.textContent = text;
  el.setAttribute("role", "status");
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

function scrollDown() {
  const m = $("messages");
  m.scrollTop = m.scrollHeight;
}

const SAVE_ICON = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';

function addMsg(role, text, { canSave = false } = {}) {
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  el.textContent = text; // textContent: never interpret model/user text as HTML
  if (role === "user" && canSave) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "save-btn";
    b.title = "Remember this";
    b.setAttribute("aria-label", "Save this message as a memory");
    b.innerHTML = SAVE_ICON;
    b.addEventListener("click", () => saveMemory(text, b));
    el.appendChild(b);
  }
  $("messages").appendChild(el);
  scrollDown();
  return el;
}

function addTyping() {
  const el = document.createElement("div");
  el.className = "msg rem typing";
  el.setAttribute("aria-label", "Rem is thinking");
  el.innerHTML = "<span></span><span></span><span></span>";
  $("messages").appendChild(el);
  scrollDown();
  return el;
}

async function saveMemory(text, btn) {
  try {
    await api.addMemory(text);
    toast("Saved to memory");
    if (btn) btn.remove();
  } catch (e) {
    toast(e.message);
  }
}

// ------------------------------------------------------------------ idle / sleepy
function bumpIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!busy && !voice.listening && !voice.speaking && character.expression === "neutral") character.setExpression("sleepy");
  }, 90000);
}

// ------------------------------------------------------------------ speaking / delivering a reply
function interruptSpeech() {
  speakSession++;
  voice.stopSpeaking();
  character.stopTalking();
}

async function deliver(res) {
  const session = ++speakSession;
  character.setExpression(res.emotion);
  if (res.gesture === "wave") character.gesture("wave");

  const canSpeak = settings.speak && voice.ttsSupported;
  setStatus("speaking");
  if (canSpeak) {
    await voice.speak(res.reply, {
      voiceURI: settings.voiceURI, rate: settings.rate, pitch: settings.pitch,
      onStart: () => session === speakSession && character.startTalking(),
      onWord: () => session === speakSession && character.pulseMouth(),
    });
  } else {
    // No voice available/enabled: still animate the mouth for a time matching the text length.
    character.startTalking();
    await sleep(Math.min(6000, 600 + res.reply.length * 45));
  }
  if (session !== speakSession) return; // interrupted by the user
  character.stopTalking();
  setStatus("idle");
  bumpIdle();
  setTimeout(() => { if (session === speakSession && !busy) character.setExpression("neutral"); }, 2500);

  if (settings.handsFree && voice.sttSupported) startListening(true);
}

// ------------------------------------------------------------------ chat
function showSuggestion(text) {
  pendingSuggestion = text;
  $("suggestion-text").textContent = `Remember: “${text}”?`;
  $("suggestion").hidden = false;
}
function hideSuggestion() {
  pendingSuggestion = null;
  $("suggestion").hidden = true;
}

async function sendMessage(text) {
  text = (text || "").trim();
  if (!text || busy) return;
  busy = true;
  interruptSpeech();
  hideSuggestion();
  addMsg("user", text, { canSave: true });
  character.setState("thinking");
  character.setExpression("thinking");
  setStatus("thinking");
  const typing = addTyping();
  let res;
  try {
    res = await api.chat(text);
  } catch (e) {
    typing.remove();
    const msg = e instanceof ApiError ? e.message : "Something went wrong.";
    addMsg("system", msg);
    character.setState("idle");
    character.setExpression(e.status === 0 ? "sad" : "confused");
    setStatus("error", e.status === 401 ? "Access code needed" : "Problem");
    setTimeout(() => { if (!busy) setStatus("idle"); }, 4000);
    busy = false;
    return;
  }
  typing.remove();
  addMsg("rem", res.reply);
  if (res.memory_suggestion) showSuggestion(res.memory_suggestion);
  character.setState("idle");
  busy = false;
  await deliver(res);
}

// ------------------------------------------------------------------ listening
function startListening(auto = false) {
  if (busy) return;
  interruptSpeech();
  const input = $("input");
  const ok = voice.startListening(settings.sttLang, {
    onInterim: (t) => { input.value = t; input.classList.add("interim"); },
    onFinal: (t) => { input.value = ""; input.classList.remove("interim"); sendMessage(t); },
    onEnd: (gotText) => {
      input.classList.remove("interim");
      if (!gotText && !busy) {
        character.setState("idle");
        setStatus("idle");
      }
    },
    onError: (msg) => {
      character.setState("idle");
      setStatus("idle");
      if (/didn't hear/.test(msg)) setHint(msg, 4000);
      else addMsg("system", msg);
    },
  });
  if (ok) {
    character.setState("listening");
    if (character.expression === "sleepy") character.setExpression("neutral");
    setStatus("listening");
    setHint(auto ? "Listening… (hands-free)" : "Listening… speak now, tap the mic to stop.");
    clearTimeout(idleTimer);
  } else {
    setStatus("idle");
  }
}

$("btn-mic").addEventListener("click", () => {
  if (voice.listening) { voice.stopListening(); setHint(""); return; }
  startListening();
});

$("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  if (voice.listening) voice.abortListening();
  const t = $("input").value;
  $("input").value = "";
  sendMessage(t);
});

$("sug-yes").addEventListener("click", async () => {
  if (pendingSuggestion) await saveMemory(pendingSuggestion);
  hideSuggestion();
});
$("sug-no").addEventListener("click", hideSuggestion);

// ------------------------------------------------------------------ memory sheet
const memSheet = $("sheet-memory");
let memBusy = false;

function memNote(text, kind = "") {
  const n = $("mem-msg");
  n.hidden = !text;
  n.textContent = text || "";
  n.className = "note " + kind;
}

async function renderMemories() {
  const list = $("mem-list");
  list.textContent = "Loading…";
  try {
    const { memories } = await api.memories();
    list.textContent = "";
    if (!memories.length) {
      const p = document.createElement("div");
      p.className = "empty";
      p.textContent = "Nothing saved yet.";
      list.appendChild(p);
    }
    for (const m of memories) list.appendChild(memoryRow(m));
    memNote("");
  } catch (e) {
    list.textContent = "";
    memNote(e.message, "bad");
  }
}

function memoryRow(m) {
  const row = document.createElement("div");
  row.className = "mem-item";
  const txt = document.createElement("div");
  txt.className = "txt";
  txt.textContent = m.content;
  const small = document.createElement("small");
  small.textContent = new Date(m.updated_at).toLocaleDateString();
  txt.appendChild(small);
  const actions = document.createElement("div");
  actions.className = "mem-actions";

  const edit = document.createElement("button");
  edit.className = "btn sm"; edit.type = "button"; edit.textContent = "Edit";
  const del = document.createElement("button");
  del.className = "btn sm danger"; del.type = "button"; del.textContent = "Delete";

  del.addEventListener("click", async () => {
    try { await api.deleteMemory(m.id); row.remove(); if (!$("mem-list").querySelector(".mem-item")) renderMemories(); }
    catch (e) { memNote(e.message, "bad"); }
  });
  edit.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "text"; input.value = m.content; input.maxLength = 500; input.setAttribute("aria-label", "Edit memory");
    row.replaceChild(input, txt);
    edit.textContent = "Save";
    const finish = async () => {
      const v = input.value.trim();
      if (!v) return memNote("A memory can't be empty. Delete it instead.", "bad");
      try { await api.updateMemory(m.id, v); renderMemories(); }
      catch (e) { memNote(e.message, "bad"); }
    };
    edit.onclick = finish;
    input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); finish(); } });
    input.focus();
  }, { once: true });
  actions.append(edit, del);
  row.append(txt, actions);
  return row;
}

$("btn-memory").addEventListener("click", () => { memSheet.showModal(); renderMemories(); });

$("mem-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const v = $("mem-input").value.trim();
  if (!v || memBusy) return;
  memBusy = true;
  try { await api.addMemory(v); $("mem-input").value = ""; await renderMemories(); }
  catch (err) { memNote(err.message, "bad"); }
  memBusy = false;
});

$("mem-export").addEventListener("click", async () => {
  try {
    const { memories } = await api.memories();
    const blob = new Blob([JSON.stringify({ app: "rem-ai", memories: memories.map(({ content, category }) => ({ content, category })) }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "rem-memories.json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    memNote(`Exported ${memories.length} memories.`, "good");
  } catch (e) { memNote(e.message, "bad"); }
});
$("mem-import").addEventListener("click", () => $("mem-file").click());
$("mem-file").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const items = Array.isArray(data) ? data : data.memories;
    if (!Array.isArray(items)) throw new Error("That file doesn't look like a Rem memory export.");
    const r = await api.importMemories(items);
    memNote(`Imported ${r.added}, skipped ${r.skipped} duplicates/empty.`, "good");
    renderMemories();
  } catch (err) { memNote(err.message || "Couldn't read that file.", "bad"); }
});

$("clear-history").addEventListener("click", async () => {
  if (!confirm("Clear the whole conversation history? Saved memories are kept.")) return;
  try {
    await api.clearHistory();
    $("messages").textContent = "";
    addMsg("rem", GREETING);
    memNote("Conversation history cleared. Your saved memories were kept.", "good");
  } catch (e) { memNote(e.message, "bad"); }
});

// ------------------------------------------------------------------ settings sheet
const setSheet = $("sheet-settings");

function fillVoices() {
  const sel = $("set-voice");
  const keep = settings.voiceURI;
  sel.length = 1;
  voice.voices
    .filter((v) => /^(en|hi)/i.test(v.lang))
    .sort((a, b) => a.lang.localeCompare(b.lang))
    .forEach((v) => {
      const o = document.createElement("option");
      o.value = v.voiceURI;
      o.textContent = `${v.name} (${v.lang})`;
      sel.appendChild(o);
    });
  sel.value = keep;
}

function updateSupportNote() {
  const parts = [];
  parts.push(voice.sttSupported ? "Voice input: supported." : "Voice input: NOT supported in this browser (use Chrome on Android). Text chat still works.");
  parts.push(voice.ttsSupported ? "Voice output: supported." : "Voice output: NOT supported. Rem will reply in text.");
  if (!window.isSecureContext) parts.push("The microphone needs a secure (https) page.");
  $("support-note").textContent = parts.join(" ");
}

function openSettings() {
  $("set-backend").value = settings.backendUrl;
  $("set-code").value = settings.accessCode;
  $("set-lang").value = settings.sttLang;
  $("set-rate").value = settings.rate;
  $("set-pitch").value = settings.pitch;
  $("set-speak").checked = settings.speak;
  $("set-hands").checked = settings.handsFree;
  fillVoices();
  updateSupportNote();
  $("check-msg").hidden = true;
  setSheet.showModal();
}
$("btn-settings").addEventListener("click", openSettings);

const bind = (id, key, get) => $(id).addEventListener("change", () => { settings[key] = get($(id)); saveSettings(settings); });
bind("set-backend", "backendUrl", (e) => e.value.trim().replace(/\/+$/, ""));
bind("set-code", "accessCode", (e) => e.value.trim());
bind("set-lang", "sttLang", (e) => e.value);
bind("set-voice", "voiceURI", (e) => e.value);
bind("set-rate", "rate", (e) => parseFloat(e.value));
bind("set-pitch", "pitch", (e) => parseFloat(e.value));
bind("set-speak", "speak", (e) => e.checked);
bind("set-hands", "handsFree", (e) => e.checked);

$("btn-test-voice").addEventListener("click", () => {
  if (!voice.ttsSupported) return;
  voice.speak("Namaste! Main Rem hoon. Can you hear me clearly?", { voiceURI: settings.voiceURI, rate: settings.rate, pitch: settings.pitch });
});

$("btn-check").addEventListener("click", async () => {
  // make sure the latest field values are used even if 'change' hasn't fired yet
  settings.backendUrl = $("set-backend").value.trim().replace(/\/+$/, "");
  settings.accessCode = $("set-code").value.trim();
  saveSettings(settings);
  const n = $("check-msg");
  n.hidden = false; n.className = "note"; n.textContent = "Checking…";
  try {
    const h = await api.health();
    if (!h.gemini_configured) { n.className = "note bad"; n.textContent = "Connected, but the server has no GEMINI_API_KEY set."; return; }
    // health is public, so also verify the access code with a protected call
    await api.memories();
    n.className = "note good";
    n.textContent = `Connected. Model: ${h.model}.`;
    loadHistory();
  } catch (e) {
    n.className = "note bad"; n.textContent = e.message;
  }
});

for (const d of document.querySelectorAll("dialog.sheet")) {
  d.querySelector("[data-close]").addEventListener("click", () => d.close());
  d.addEventListener("click", (e) => { if (e.target === d) d.close(); }); // tap outside
}
if (voice.ttsSupported) speechSynthesis.addEventListener?.("voiceschanged", () => { if (setSheet.open) fillVoices(); });

// ------------------------------------------------------------------ startup
async function loadHistory() {
  $("messages").textContent = "";
  try {
    const { messages } = await api.history();
    if (!messages.length) addMsg("rem", GREETING);
    for (const m of messages) addMsg(m.role === "user" ? "user" : "rem", m.content);
  } catch (e) {
    addMsg("rem", GREETING);
    const onPages = /github\.io$/.test(location.hostname);
    if (e.status === 401) addMsg("system", "This backend needs an access code. Open Settings and enter it.");
    else if (onPages && !settings.backendUrl) addMsg("system", "Set your Backend URL in Settings (gear icon) so I can think.");
    else addMsg("system", e.message);
  }
}

async function init() {
  const manifest = await loadManifest();
  character = new Character($("character"), manifest);
  window.__rem = { character, voice, api, get settings() { return settings; } }; // handy for debugging in the console

  if (!voice.sttSupported) {
    $("btn-mic").disabled = true;
    $("btn-mic").title = "Voice input isn't supported in this browser";
    setHint("Voice input isn't available in this browser, so please type. (Chrome on Android supports it.)");
  } else {
    setHint("Tap the mic to talk, or type below.");
  }
  setStatus("idle");
  bumpIdle();
  await loadHistory();
  character.gesture("wave", 2000);
}

init();
