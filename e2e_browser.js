// Browser end-to-end test on an emulated Android phone.
//   1. start fake Gemini:  python tests/fake_gemini_server.py 9100
//   2. start backend:      GEMINI_API_KEY=live-test-key GEMINI_API_BASE=http://127.0.0.1:9100/v1beta REM_DB_PATH=/tmp/e2e.db uvicorn backend.app:app --port 8000
//   3. node tests/e2e_browser.js http://localhost:8000
// Speech engines are replaced by fakes (headless Chromium has none), so this tests Rem's
// voice *logic*, not the real microphone or voices. Test those on a real phone.
const { chromium, devices } = require('playwright');
const URL = process.argv[2] || 'http://localhost:8000';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

const FAKES = `
window.__spoken = []; window.__mouthSeen = new Set();
window.SpeechSynthesisUtterance = function (t) { this.text = t; };
const synth = { speaking:false, getVoices(){ return [{name:'Fake India',lang:'en-IN',voiceURI:'fake-en'},{name:'Fake Hindi',lang:'hi-IN',voiceURI:'fake-hi'}]; },
  addEventListener(){}, cancel(){ this._u && this._u.onerror && this._u.onerror({error:'canceled'}); this._u=null; },
  speak(u){ this._u=u; window.__spoken.push({text:u.text, lang:u.lang, voice:u.voice && u.voice.voiceURI}); setTimeout(()=>u.onstart&&u.onstart(),20);
    setTimeout(()=>{ u.onboundary&&u.onboundary(); },100); setTimeout(()=>{ if(this._u===u){ this._u=null; u.onend&&u.onend(); } },900); } };
Object.defineProperty(window,'speechSynthesis',{value:synth,configurable:true});
window.__sr = { script: 'mujhe anime pasand hai' };
window.webkitSpeechRecognition = function(){ const r=this; r.start=function(){ window.__sr.started=(window.__sr.started||0)+1; window.__sr.lang=r.lang;
  setTimeout(()=>r.onresult({resultIndex:0,results:[Object.assign([{transcript:window.__sr.script}],{isFinal:false})]}),80);
  setTimeout(()=>{ r.onresult({resultIndex:0,results:[Object.assign([{transcript:window.__sr.script}],{isFinal:true})]}); r.onend(); },400); };
  r.stop=function(){}; r.abort=function(){}; };
window.SpeechRecognition = window.webkitSpeechRecognition;
`;

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['Pixel 7'] });
  await ctx.addInitScript(FAKES);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  const keyReq = []; p.on('request', r => { if (/generativelanguage|goog/.test(r.url())) keyReq.push(r.url()); });
  await p.goto(URL); await p.waitForSelector('#rem-svg');

  // layout / startup
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow at phone width');
  ok(await p.locator('#messages .msg.rem').count() >= 1, 'greeting shown');
  const mic = await p.locator('#btn-mic').boundingBox();
  ok(mic.width >= 44 && mic.height >= 44, 'mic button is touch-sized');

  // idle blink
  const blinked = await p.evaluate(() => new Promise(res => { const e=document.querySelector('.eye'); const mo=new MutationObserver(()=>{ if(e.classList.contains('blink')){mo.disconnect();res(true);} }); mo.observe(e,{attributes:true}); setTimeout(()=>res(false),9000); }));
  ok(blinked, 'idle: eyes blink automatically');

  // text chat + speaking + mouth animation + expressions
  const mouths = new Set();
  await p.exposeFunction('__m', m => mouths.add(m));
  await p.evaluate(() => setInterval(()=>__m(document.getElementById('face').dataset.mouth), 40));
  await p.fill('#input', 'hello rem, I love tea');
  await p.click('#btn-send');
  await p.waitForSelector('#messages .msg.user');
  ok(await p.evaluate(() => document.getElementById('status').dataset.state) === 'thinking', 'status shows Thinking while waiting');
  await p.waitForFunction(() => document.querySelectorAll('#messages .msg.rem:not(.typing)').length >= 2);
  const reply = await p.locator('#messages .msg.rem:not(.typing)').last().innerText();
  ok(/Echo/.test(reply), 'text conversation gets a Gemini-path reply: ' + reply.slice(0, 40));
  await p.waitForTimeout(200);
  ok(await p.evaluate(() => document.getElementById('status').dataset.state) === 'speaking', 'status shows Speaking');
  ok(await p.evaluate(() => document.getElementById('rem-svg').dataset.state) === 'speaking', 'character in speaking state');
  ok(await p.evaluate(() => document.getElementById('rem-svg').dataset.expr) === 'blushing', 'expression switched from AI emotion (blushing)');
  ok(await p.evaluate(() => document.getElementById('rem-svg').dataset.gesture) === 'wave', 'wave gesture triggered');
  await p.waitForTimeout(1200);
  ok([...mouths].filter(m => /^t\d$/.test(m)).length >= 2, 'mouth cycles through open shapes while speaking: ' + [...mouths].join(','));
  ok((await p.evaluate(() => window.__spoken.length)) >= 1, 'text-to-speech called');
  await p.waitForTimeout(500);
  ok(await p.evaluate(() => document.getElementById('status').dataset.state) === 'idle', 'returns to idle after speaking');
  ok(!(await p.evaluate(() => /^t\d$/.test(document.getElementById('face').dataset.mouth))), 'mouth closed after speaking');

  // voice input
  await p.evaluate(() => { window.__sr.script = 'mujhe anime pasand hai'; });
  await p.click('#btn-mic');
  ok(await p.evaluate(() => document.getElementById('status').dataset.state) === 'listening', 'status shows Listening');
  ok(await p.evaluate(() => document.getElementById('rem-svg').dataset.state) === 'listening', 'character listening pose');
  await p.waitForFunction(() => [...document.querySelectorAll('#messages .msg.user')].some(m => /anime/.test(m.textContent)));
  ok(await p.evaluate(() => window.__sr.lang) === 'en-IN', 'speech recognition uses en-IN for Hinglish/auto');
  await p.waitForSelector('#suggestion:not([hidden])');
  ok(/anime/i.test(await p.locator('#suggestion-text').innerText()), 'memory suggestion offered (not auto-saved)');

  // memory: nothing saved until user agrees
  await p.click('#btn-memory'); await p.waitForSelector('#mem-list .empty');
  ok(true, 'memory empty before approval'); await p.click('#sheet-memory [data-close]');
  await p.click('#sug-yes'); await p.waitForTimeout(400);
  await p.click('#btn-memory'); await p.waitForSelector('#mem-list .mem-item');
  ok(/anime/i.test(await p.locator('#mem-list .mem-item .txt').first().innerText()), 'approved memory saved & listed');
  await p.fill('#mem-input', 'Plays chess'); await p.click('#mem-form button');
  await p.waitForFunction(() => document.querySelectorAll('#mem-list .mem-item').length === 2);
  ok(true, 'manual memory added');
  await p.locator('#mem-list .mem-item').nth(1).getByText('Edit').click();
  await p.locator('#mem-list .mem-item input').fill('Plays chess daily');
  await p.locator('#mem-list .mem-item').nth(1).getByText('Save').click();
  await p.waitForFunction(() => /daily/.test(document.querySelector('#mem-list').innerText));
  ok(true, 'memory edited');
  await p.locator('#mem-list .mem-item').nth(0).getByText('Delete').click();
  await p.waitForFunction(() => document.querySelectorAll('#mem-list .mem-item').length === 1);
  ok(true, 'memory deleted');
  // survives reload (persistence in SQLite)
  await p.reload(); await p.waitForSelector('#rem-svg');
  ok(await p.locator('#messages .msg.user').count() >= 2, 'chat history restored after reload');
  await p.click('#btn-memory'); await p.waitForSelector('#mem-list .mem-item');
  ok(/daily/.test(await p.locator('#mem-list').innerText()), 'memory persists after reload');
  p.once('dialog', d => d.accept());
  await p.click('#clear-history'); await p.waitForTimeout(500);
  ok(await p.locator('#messages .msg.user').count() === 0, 'clear history works');
  ok(/daily/.test(await p.locator('#mem-list').innerText()), 'clearing history keeps memories');
  await p.click('#sheet-memory [data-close]');

  // Hindi script picks hindi voice
  await p.evaluate(() => window.__rem.voice.speak('नमस्ते, कैसे हैं आप?', {}));
  await p.waitForTimeout(100);
  ok(await p.evaluate(() => window.__spoken.at(-1).voice) === 'fake-hi', 'Devanagari text uses the Hindi voice');

  // settings + connection test
  await p.click('#btn-settings'); await p.click('#btn-check');
  await p.waitForFunction(() => /Connected/.test(document.getElementById('check-msg').innerText));
  ok(true, 'settings: test connection OK');
  await p.selectOption('#set-lang', 'hindi');
  await p.click('#sheet-settings [data-close]');
  await p.click('#btn-mic'); await p.waitForTimeout(100);
  ok(await p.evaluate(() => window.__sr.lang) === 'hi-IN', 'Hindi setting switches recognition to hi-IN');
  await p.waitForTimeout(900);

  // error path: bad backend URL -> readable error, text input still usable
  await p.evaluate(() => { const s = window.__rem.settings; s.backendUrl = 'http://127.0.0.1:1'; });
  await p.fill('#input', 'hi'); await p.click('#btn-send');
  await p.waitForSelector('#messages .msg.system');
  ok(/can't reach/i.test(await p.locator('#messages .msg.system').last().innerText()), 'unreachable backend shows friendly error');
  ok(await p.evaluate(() => document.getElementById('rem-svg').dataset.expr) === 'sad', 'error -> sad expression');

  // security
  ok(keyReq.length === 0, 'browser never contacted Google directly');
  const html = await p.content();
  ok(!/live-test-key/.test(html), 'API key absent from page HTML');
  for (const f of ['js/app.js','js/api.js','js/voice.js','js/settings.js','js/character.js','config.js']) {
    const t = await (await fetch(URL + '/' + f)).text();
    if (/live-test-key|AIza[0-9A-Za-z_-]{20,}/.test(t)) ok(false, 'key-like string in ' + f);
  }
  ok(true, 'no key-like strings in served JS');
  ok(errs.length === 0, 'no uncaught page errors ' + errs.join('|'));

  // no-voice fallback: text still works when speech APIs missing
  const ctx2 = await b.newContext({ ...devices['Pixel 7'] });
  await ctx2.addInitScript(() => { delete window.webkitSpeechRecognition; delete window.SpeechRecognition; delete window.speechSynthesis; delete window.SpeechSynthesisUtterance; });
  const q = await ctx2.newPage(); const e2 = []; q.on('pageerror', e => e2.push(String(e)));
  await q.goto(URL); await q.waitForSelector('#rem-svg');
  ok(await q.locator('#btn-mic').isDisabled(), 'no STT support: mic disabled with hint');
  await q.fill('#input', 'hello'); await q.click('#btn-send');
  await q.waitForFunction(() => document.querySelectorAll('#messages .msg.rem:not(.typing)').length >= 2);
  ok(e2.length === 0, 'text fallback works without any speech API, no errors ' + e2.join('|'));
  await b.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
