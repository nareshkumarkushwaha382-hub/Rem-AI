// Character renderer. Animations are kept separate and driven by JavaScript:
//   state      : idle | listening | thinking | speaking      (body/head motion)
//   expression : neutral happy sad surprised thinking confused blushing sleepy winking
//   blink      : independent random timer
//   mouth      : independent talking loop while speaking
//   gesture    : wave (SVG hand, or an image from the manifest)
//
// Built-in art is an original layered SVG. To use your own art, list files in
// assets/character/manifest.json (see README "Using your own character art").
// Only files named in the manifest are ever requested.

export const EXPRESSIONS = ["neutral", "happy", "sad", "surprised", "thinking", "confused", "blushing", "sleepy", "winking"];

const SVG = `
<svg id="rem-svg" viewBox="0 0 400 520" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Rem AI companion">
  <defs>
    <linearGradient id="hairG" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8fcbff"/><stop offset="1" stop-color="#4f95e6"/>
    </linearGradient>
    <linearGradient id="irisG" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2f6fd0"/><stop offset="0.6" stop-color="#58b0ff"/><stop offset="1" stop-color="#a6e0ff"/>
    </linearGradient>
    <linearGradient id="outfitG" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#dcebff"/>
    </linearGradient>
  </defs>

  <g id="body">
    <path d="M40 520 C40 420 100 360 165 342 L235 342 C300 360 360 420 360 520 Z" fill="url(#outfitG)" stroke="#a9c9f5" stroke-width="3"/>
    <path d="M165 342 L200 410 L235 342 C222 352 178 352 165 342 Z" fill="#2f6fd0"/>
    <path d="M150 346 L200 430 L250 346" fill="none" stroke="#2f6fd0" stroke-width="7" stroke-linejoin="round"/>
    <path d="M70 470 C80 430 105 400 140 385" fill="none" stroke="#a9c9f5" stroke-width="3" stroke-linecap="round"/>
    <path d="M330 470 C320 430 295 400 260 385" fill="none" stroke="#a9c9f5" stroke-width="3" stroke-linecap="round"/>
    <g transform="translate(200 424)">
      <path d="M0 0 C-30 -22 -46 -6 -34 12 C-24 22 -8 10 0 0 Z" fill="#4f95e6" stroke="#2f6fd0" stroke-width="3" stroke-linejoin="round"/>
      <path d="M0 0 C30 -22 46 -6 34 12 C24 22 8 10 0 0 Z" fill="#4f95e6" stroke="#2f6fd0" stroke-width="3" stroke-linejoin="round"/>
      <circle r="9" fill="#2f6fd0"/>
    </g>
  </g>

  <g id="wave-arm" class="gesture" style="display:none">
    <path d="M318 470 C336 440 340 390 332 340" fill="none" stroke="#dcebff" stroke-width="44" stroke-linecap="round"/>
    <path d="M318 470 C336 440 340 390 332 340" fill="none" stroke="#a9c9f5" stroke-width="3" stroke-linecap="round" opacity=".0"/>
    <g id="wave-hand" transform="translate(332 328)">
      <ellipse cx="0" cy="-12" rx="22" ry="26" fill="#ffd9c6"/>
      <rect x="-22" y="-52" width="9" height="30" rx="4.5" fill="#ffd9c6"/>
      <rect x="-11" y="-60" width="9" height="34" rx="4.5" fill="#ffd9c6"/>
      <rect x="0" y="-60" width="9" height="34" rx="4.5" fill="#ffd9c6"/>
      <rect x="11" y="-54" width="9" height="30" rx="4.5" fill="#ffd9c6"/>
      <rect x="-34" y="-22" width="9" height="24" rx="4.5" fill="#ffd9c6" transform="rotate(-28 -30 -10)"/>
    </g>
  </g>

  <g id="head">
    <path d="M104 236 C92 120 140 52 200 52 C260 52 308 120 296 236 C300 290 292 322 280 344 C240 326 160 326 120 344 C108 322 100 290 104 236 Z" fill="url(#hairG)" stroke="#3f86d0" stroke-width="3"/>
    <rect x="178" y="270" width="44" height="90" rx="16" fill="#ffd9c6"/>
    <path d="M178 316 Q200 336 222 316 L222 300 L178 300 Z" fill="#f2bfa8" opacity=".75"/>

    <path d="M122 208 C122 142 158 118 200 118 C242 118 278 142 278 208 C278 266 246 304 200 304 C154 304 122 266 122 208 Z" fill="#ffe6d8" stroke="#f2c9b4" stroke-width="2"/>
    <path d="M168 282 Q200 300 232 282" fill="none" stroke="#f2c9b4" stroke-width="2" opacity=".6"/>

    <g id="blush">
      <ellipse cx="150" cy="252" rx="20" ry="10" fill="#ff8fa8" opacity="0"/>
      <ellipse cx="250" cy="252" rx="20" ry="10" fill="#ff8fa8" opacity="0"/>
    </g>

    <g id="face" data-expr="neutral" data-mouth="smile">
      <path class="brow bL" d="M134 190 Q158 176 184 188" fill="none" stroke="#3f86d0" stroke-width="5" stroke-linecap="round"/>
      <path class="brow bR" d="M216 188 Q242 176 266 190" fill="none" stroke="#3f86d0" stroke-width="5" stroke-linecap="round"/>

      ${["L", "R"].map((side) => `
      <g class="eye ${side}" transform="translate(${side === "L" ? 160 : 240} 224)">
        <g class="e-open">
          <ellipse class="sclera" rx="22" ry="27" fill="#fff"/>
          <g class="iris">
            <ellipse rx="16" ry="21" fill="url(#irisG)"/>
            <ellipse class="pupil" rx="7" ry="10" fill="#1c3f7a"/>
            <circle cx="-6" cy="-9" r="5" fill="#fff"/>
            <circle cx="6" cy="8" r="2.4" fill="#fff" opacity=".9"/>
          </g>
          <path d="M-25 -8 Q0 -40 25 -8" fill="none" stroke="#24457f" stroke-width="5.5" stroke-linecap="round"/>
          <path d="M${side === "L" ? "-25 -8 L-30 -14" : "25 -8 L30 -14"}" stroke="#24457f" stroke-width="4" stroke-linecap="round"/>
        </g>
        <path class="e-happy" d="M-21 6 Q0 -24 21 6" fill="none" stroke="#24457f" stroke-width="5.5" stroke-linecap="round"/>
        <path class="lid" d="M-27 -34 H27 V3 Q0 12 -27 3 Z" fill="#ffe6d8"/>
        <path class="lid" d="M-24 3 Q0 13 24 3" fill="none" stroke="#24457f" stroke-width="5" stroke-linecap="round"/>
      </g>`).join("")}

      <path d="M198 246 Q200 249 203 247" fill="none" stroke="#e5a68f" stroke-width="2.5" stroke-linecap="round"/>

      <g class="mouth" transform="translate(200 272)">
        <path class="m m-smile" d="M-13 0 Q0 10 13 0" fill="none" stroke="#b5495a" stroke-width="3.5" stroke-linecap="round"/>
        <path class="m m-tiny" d="M-7 1 Q0 5 7 1" fill="none" stroke="#b5495a" stroke-width="3.5" stroke-linecap="round"/>
        <path class="m m-grin" d="M-17 -3 Q0 22 17 -3 Q0 2 -17 -3 Z" fill="#d9576b" stroke="#b5495a" stroke-width="3" stroke-linejoin="round"/>
        <path class="m m-frown" d="M-11 7 Q0 -3 11 7" fill="none" stroke="#b5495a" stroke-width="3.5" stroke-linecap="round"/>
        <ellipse class="m m-o" rx="7" ry="9" fill="#c9505f" stroke="#b5495a" stroke-width="2.5"/>
        <path class="m m-wavy" d="M-15 3 Q-7.5 -4 0 3 T15 3" fill="none" stroke="#b5495a" stroke-width="3.5" stroke-linecap="round"/>
        <ellipse class="m m-t1" rx="9" ry="4" fill="#c9505f" stroke="#b5495a" stroke-width="2.5"/>
        <ellipse class="m m-t2" rx="10" ry="8" fill="#c9505f" stroke="#b5495a" stroke-width="2.5"/>
        <path class="m m-t3" d="M-15 -3 Q0 -6 15 -3 Q13 18 0 19 Q-13 18 -15 -3 Z" fill="#c9505f" stroke="#b5495a" stroke-width="2.5" stroke-linejoin="round"/>
      </g>
    </g>

    <path d="M118 210 C108 250 110 300 122 346 C138 312 144 258 142 196 Z" fill="url(#hairG)" stroke="#3f86d0" stroke-width="3" stroke-linejoin="round"/>
    <path d="M282 210 C292 250 290 300 278 346 C262 312 256 258 258 196 Z" fill="url(#hairG)" stroke="#3f86d0" stroke-width="3" stroke-linejoin="round"/>
    <path d="M114 212 C100 124 148 70 204 72 C262 74 300 128 286 212 C282 180 268 152 246 142 C240 166 216 178 198 160 C182 180 152 174 144 150 C130 168 126 192 114 212 Z" fill="url(#hairG)" stroke="#3f86d0" stroke-width="3" stroke-linejoin="round"/>
    <path d="M160 100 C176 88 196 86 214 90" fill="none" stroke="#d8efff" stroke-width="5" stroke-linecap="round" opacity=".8"/>
    <path d="M200 74 C196 48 214 36 232 44 C220 46 212 58 214 74" fill="url(#hairG)" stroke="#3f86d0" stroke-width="3" stroke-linejoin="round"/>
    <g transform="translate(256 122) rotate(25)">
      <rect x="-16" y="-5" width="32" height="10" rx="5" fill="#fff" stroke="#2f6fd0" stroke-width="2.5"/>
      <rect x="-5" y="-16" width="10" height="32" rx="5" fill="#fff" stroke="#2f6fd0" stroke-width="2.5"/>
      <circle r="4" fill="#58b0ff"/>
    </g>

    <g class="fx fx-think"><circle cx="318" cy="126" r="6"/><circle cx="338" cy="104" r="9"/><circle cx="364" cy="76" r="13"/></g>
    <g class="fx fx-q"><text x="316" y="120" font-size="54" font-weight="800">?</text></g>
    <g class="fx fx-ex"><text x="316" y="120" font-size="54" font-weight="800">!</text></g>
    <g class="fx fx-z"><text x="310" y="130" font-size="34" font-weight="800">z</text><text x="336" y="100" font-size="26" font-weight="800">z</text><text x="354" y="76" font-size="20" font-weight="800">z</text></g>
    <g class="fx fx-sparkle"><path d="M330 110 l5 12 12 5 -12 5 -5 12 -5 -12 -12 -5 12 -5z"/><path d="M80 130 l4 9 9 4 -9 4 -4 9 -4 -9 -9 -4 9 -4z"/></g>
    <g class="fx fx-sweat"><path d="M290 160 C282 176 280 186 290 190 C300 186 298 176 290 160 Z"/></g>
  </g>
</svg>`;

const MOUTH_BY_EXPR = {
  neutral: "smile", happy: "grin", sad: "frown", surprised: "o", thinking: "tiny",
  confused: "wavy", blushing: "tiny", sleepy: "tiny", winking: "grin",
};

export class Character {
  constructor(container, manifest = null) {
    this.container = container;
    this.manifest = manifest;
    this.expression = "neutral";
    this.state = "idle";
    this.talking = false;
    this._talkTimer = null;
    this._blinkTimer = null;
    this._gestureTimer = null;
    this.imageMode = !!(manifest && manifest.base);
    this.imageMode ? this._buildImages() : this._buildSvg();
    this.setState("idle");
    this.setExpression("neutral");
    this._scheduleBlink();
  }

  // ---------------------------------------------------------------- build
  _buildSvg() {
    this.container.innerHTML = SVG;
    this.root = this.container.querySelector("#rem-svg");
    this.face = this.container.querySelector("#face");
    this.eyes = this.container.querySelectorAll(".eye");
    this.blushEls = this.container.querySelectorAll("#blush ellipse");
    this.waveArm = this.container.querySelector("#wave-arm");
  }

  _buildImages() {
    const m = this.manifest;
    const base = m.dir + m.base;
    this.container.innerHTML = `
      <div id="rem-img" class="img-stack">
        <img class="layer base" alt="Rem AI companion" src="${base}">
        <img class="layer expr" alt="" hidden>
        <img class="layer blinkimg" alt="" hidden>
        <img class="layer mouthimg" alt="" hidden>
        <img class="layer gestimg" alt="" hidden>
      </div>`;
    this.root = this.container.querySelector("#rem-img");
    this.imgs = {
      expr: this.root.querySelector(".expr"), blink: this.root.querySelector(".blinkimg"),
      mouth: this.root.querySelector(".mouthimg"), gest: this.root.querySelector(".gestimg"),
    };
    if (m.blink) this.imgs.blink.src = m.dir + m.blink;
  }

  // ---------------------------------------------------------------- state
  setState(state) {
    this.state = state;
    this.root.dataset.state = state;
  }

  setExpression(name) {
    if (!EXPRESSIONS.includes(name)) name = "neutral";
    this.expression = name;
    this.root.dataset.expr = name;
    if (this.imageMode) {
      const file = this.manifest.expressions && this.manifest.expressions[name];
      this.imgs.expr.hidden = !file;
      if (file) this.imgs.expr.src = this.manifest.dir + file;
    } else {
      this.face.dataset.expr = name;
      this.blushEls.forEach((e) => (e.style.opacity = name === "blushing" ? "0.75" : "0"));
      if (!this.talking) this._setMouth(MOUTH_BY_EXPR[name]);
    }
  }

  _setMouth(name) {
    if (!this.imageMode) this.face.dataset.mouth = name;
  }

  // ---------------------------------------------------------------- talking
  startTalking() {
    if (this.talking) return;
    this.talking = true;
    this.setState("speaking");
    const frames = this.imageMode ? (this.manifest.mouthFrames || []) : ["t1", "t2", "t3", "t2", "tiny", "t3", "t1"];
    let i = 0;
    const tick = () => {
      if (!this.talking) return;
      // random-ish rhythm so it looks like speech, not a metronome
      i = Math.random() < 0.25 ? Math.floor(Math.random() * frames.length) : (i + 1) % frames.length;
      if (this.imageMode) {
        const f = frames[i];
        this.imgs.mouth.hidden = !f;
        if (f) this.imgs.mouth.src = this.manifest.dir + f;
      } else {
        this._setMouth(frames[i]);
      }
      this._talkTimer = setTimeout(tick, 90 + Math.random() * 90);
    };
    tick();
  }

  // Called on word boundaries when the browser reports them: open the mouth wide.
  pulseMouth() {
    if (this.talking && !this.imageMode) this._setMouth("t3");
  }

  stopTalking() {
    this.talking = false;
    clearTimeout(this._talkTimer);
    if (this.imageMode) this.imgs.mouth.hidden = true;
    else this._setMouth(MOUTH_BY_EXPR[this.expression]);
    if (this.state === "speaking") this.setState("idle");
  }

  // ---------------------------------------------------------------- blinking
  _scheduleBlink() {
    clearTimeout(this._blinkTimer);
    this._blinkTimer = setTimeout(() => {
      this.blink();
      if (Math.random() < 0.2) setTimeout(() => this.blink(), 260); // occasional double blink
      this._scheduleBlink();
    }, 2200 + Math.random() * 3800);
  }

  blink() {
    if (this.imageMode) {
      if (!this.manifest.blink) return;
      this.imgs.blink.hidden = false;
      setTimeout(() => (this.imgs.blink.hidden = true), 130);
      return;
    }
    this.eyes.forEach((e) => e.classList.add("blink"));
    setTimeout(() => this.eyes.forEach((e) => e.classList.remove("blink")), 130);
  }

  // ---------------------------------------------------------------- gestures
  gesture(name, ms = 2200) {
    clearTimeout(this._gestureTimer);
    if (name !== "wave") return;
    if (this.imageMode) {
      const file = this.manifest.gestures && this.manifest.gestures.wave;
      if (!file) return;
      this.imgs.gest.src = this.manifest.dir + file;
      this.imgs.gest.hidden = false;
      this._gestureTimer = setTimeout(() => (this.imgs.gest.hidden = true), ms);
      return;
    }
    this.root.dataset.gesture = "wave";
    this.waveArm.style.display = "";
    this._gestureTimer = setTimeout(() => {
      this.root.dataset.gesture = "";
      this.waveArm.style.display = "none";
    }, ms);
  }

  destroy() {
    clearTimeout(this._blinkTimer);
    clearTimeout(this._talkTimer);
    clearTimeout(this._gestureTimer);
  }
}

// Loads assets/character/manifest.json if present; returns null when not using custom art.
export async function loadManifest(dir = "assets/character/") {
  try {
    const res = await fetch(dir + "manifest.json", { cache: "no-cache" });
    if (!res.ok) return null;
    const m = await res.json();
    if (!m || !m.base) return null;
    return { ...m, dir };
  } catch {
    return null;
  }
}
