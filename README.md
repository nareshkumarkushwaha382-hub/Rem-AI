# Rem AI 💙

A voice-enabled 2D anime-style AI companion that talks in **Hindi, English and Hinglish**, remembers only what *you* approve, and runs in an Android mobile browser.

```
Browser (GitHub Pages, no secrets)  ──►  Python backend (Starlette)  ──►  Google Gemini API
 docs/  HTML+CSS+JS                      backend/  + SQLite memory         (API key lives here only)
 mic → speech-to-text, text-to-speech
```

## What is in this repo
| Path | Purpose |
|---|---|
| `docs/` | The whole frontend (served by GitHub Pages). `index.html`, `css/`, `js/`, `config.js`, `assets/character/` |
| `backend/` | `app.py` API, `gemini.py` Gemini client, `db.py` SQLite, `persona.py` Rem's personality |
| `rem_ai.py` | Terminal chat using the same brain/memory (kept from the original prototype) |
| `rem_persona.py` | Original persona file, now a thin wrapper around `backend/persona.py` |
| `Rem_AI_Development.ipynb` | Original Colab prototype (unchanged, for history) |
| `tests/` | Backend unit/API tests (`pytest`) and a browser end-to-end test (`e2e_browser.js`) |

The original prototype listed `openai` in `requirements.txt` but never used it; it is replaced by what the app really needs.

## 1. Run it locally (5 minutes)
1. Get a free Gemini API key at <https://aistudio.google.com/apikey>. (Account and billing setup must be done by an eligible adult.)
2. ```bash
   python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   cp .env.example .env        # then edit .env and paste your key
   uvicorn backend.app:app --reload
   ```
3. Open <http://localhost:8000>. The backend also serves the frontend locally, so no CORS or URL setup is needed.
4. To try on your phone on the same Wi-Fi: run `uvicorn backend.app:app --host 0.0.0.0` and open `http://<your-PC-IP>:8000`. Text chat works; the **microphone requires https**, so test voice on the deployed version (or `localhost`).

## 2. Deploy the backend
Any host that runs Python or Docker works. The key is set as a **secret environment variable** on the host, never in the repo.

**Render** (included `render.yaml`): New → Blueprint → pick this repo → fill in `GEMINI_API_KEY`, `REM_ACCESS_CODE`, `REM_ALLOWED_ORIGINS=https://YOURNAME.github.io`.
**Fly.io / Railway / any Docker host:** use the `Dockerfile`, mount a volume at `/data`, set the same variables.

⚠️ **SQLite needs a persistent disk.** Free tiers (e.g. Render free) erase the file on restart/redeploy, so memories would vanish. Use a host with a volume, or use *Memories → Export* regularly and *Import* after a reset.
Free tiers may also "sleep"; the first reply can take ~30 s.

Environment variables: see `.env.example`. `REM_ACCESS_CODE` is strongly recommended: without it anyone who finds your backend URL can spend your Gemini quota and read your memories. The backend also rate-limits chat (20/min per IP by default).

## 3. Deploy the frontend on GitHub Pages
1. Push this repo to GitHub.
2. Settings → Pages → *Deploy from a branch* → branch `main`, folder **`/docs`**.
3. Open `https://YOURNAME.github.io/REPO/` on your Android phone (Chrome).
4. Tap the gear → enter your **Backend URL** (and access code) → *Test connection*. (Or set `BACKEND_URL` in `docs/config.js` once; it is public, non-secret.)

## 4. Using it
- **Mic button**: tap, speak, Rem answers aloud. Tap again to stop. Pressing the mic while Rem talks interrupts her.
- **Text box**: always available, also the fallback if mic/voice isn't supported.
- **Settings**: speaking language (Hinglish/Hindi/English), voice, speed, pitch, speak on/off, hands-free mode (listens again after each answer).
- **Memory (bulb icon)**: view, add, edit, delete, export/import. Rem *suggests* things to remember; nothing becomes long-term memory unless you press **Remember** (or the + on one of your messages). "Clear conversation history" keeps memories.
- Voice input and output use the browser's built-in engines (Chrome on Android). For Hindi script use "Hindi" in Settings; Hinglish/English use the en-IN engine.

## Using your own character art
The built-in character is an original drawn SVG (layers: hair, face, blinking eyes, 9 expressions, 9 mouth shapes, wave gesture). To use your own art, put image files in `docs/assets/character/` and list **only files that exist** in `manifest.json`:
```json
{ "base": "rem_base.png", "blink": "rem_eyes_closed.png",
  "expressions": { "happy": "rem_happy.png", "sad": "rem_sad.png" },
  "mouthFrames": ["mouth_a.png", "mouth_b.png", "mouth_c.png"],
  "gestures": { "wave": "rem_wave.png" } }
```
All layers should be the same size as the base so they stack exactly (transparent PNG/WebP). Expressions you don't list simply keep the base image. Layers are switched separately by JavaScript, never merged into one GIF.

## Testing
```bash
pip install pytest
python -m pytest -q                      # backend: database, Gemini client, API, access code, rate limit, CORS
# Browser test on an emulated Android phone (needs Node + playwright):
python tests/fake_gemini_server.py 9100 &
GEMINI_API_KEY=live-test-key GEMINI_API_BASE=http://127.0.0.1:9100/v1beta REM_DB_PATH=/tmp/e2e.db uvicorn backend.app:app --port 8000 &
node tests/e2e_browser.js http://localhost:8000
```
**Manual checklist on a real Android phone** (these cannot be fully automated): mic permission prompt appears; speaking Hindi/Hinglish is transcribed; Rem's voice is audible and the mouth moves with it; hands-free mode; layout in portrait and landscape.
Security check: search your repo and the deployed page source for your key (`AIza…`): there must be no match.

## Troubleshooting
- *"I can't reach my backend"* → Backend URL wrong, backend asleep, or `REM_ALLOWED_ORIGINS` doesn't match your Pages origin exactly (no trailing slash, `https://name.github.io`).
- *"Access code missing or wrong"* → enter `REM_ACCESS_CODE` in Settings.
- *"Gemini rejected the API key" / quota* → check `GEMINI_API_KEY`; free-tier limits apply. Change `GEMINI_MODEL` if Google retires the default model.
- No voice input → needs Chrome on Android and an https page; check site microphone permission.
