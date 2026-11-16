// Footage for the film: the real player on the real GPU, its clock frozen and stepped one 60 fps tick at a time,
// so every frame is sharp at any scale and evenly timed. The film inside the player still runs in real time,
// so shots of the whole player get the film's own frames composited over the picture later (see film.html).
// node submission-film/capture.mjs <shot|all> [more shots...]   (dev server on :5190)   -> docs/renders/film/cap/<shot>/
import { chromium } from '@playwright/test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE ?? 'http://localhost:5190/';
const OUT = new URL('../docs/renders/film/cap/', import.meta.url);

const player = `document.querySelector('video-player')`;
const playing = (t) => [{ eval: `${player}.store.seek(${t}); ${player}.store.play?.()` }, { real: 2600 }, { pause: true }, armed];
const paused = (t) => [{ eval: `${player}.store.seek(${t})` }, { real: 2200 }, { pause: true }, armed];
// Ripples wait for the first key or pointer on the player; Shift does nothing else.
const armed = { eval: `document.querySelector('.media-skin').dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }))` };
const f = (n) => ({ frames: n, every: 2 }); // 30 fps, real time
const click = (s) => ({ click: s });
const key = (sel, k) => ({ eval: `document.querySelector('${sel}').dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', bubbles: true }))` });
const repeat = (n, steps) => Array.from({ length: n }, () => steps).flat();
// The page's own flick: grab the marble, move fast, let go (site/main.ts).
const flick = `(() => { const slider = document.querySelector('media-time-slider'); const s = ${player}.store;
  const r = slider.getBoundingClientRect(); const from = r.left + (s.currentTime / s.duration) * r.width; const y = r.top + r.height / 2;
  const at = (x, type) => slider.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
  at(from, 'pointerdown'); let i = 0; const step = () => { i += 1; at(from + i * r.width * 0.016, 'pointermove'); if (i < 6) requestAnimationFrame(step); else at(from + i * r.width * 0.016, 'pointerup'); }; requestAnimationFrame(step); })()`;
const hover = (p, type = 'pointermove') => ({ eval: `(() => { const sl = document.querySelector('media-time-slider'); const r = sl.getBoundingClientRect();
  sl.dispatchEvent(new PointerEvent('${type}', { bubbles: true, composed: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: r.left + r.width * ${p}, clientY: r.top + r.height / 2 })); })()` });
const progress = `for (const v of [document.querySelector('video'), ...[...document.querySelectorAll('*')].map((e) => e.shadowRoot?.querySelector('video'))].filter(Boolean)) v.dispatchEvent(new Event('progress'))`;

const dock = { width: 1100, scale: 5, clip: '.rl-dock' };
const SHOTS = {
  lever: { ...dock, steps: [...paused(31.4), f(8), click('#rl-play'), f(50), click('#rl-play'), f(40)] },
  flippers: { ...dock, steps: [...playing(31.4), f(6), click('#rl-fwd'), f(40), click('#rl-back'), f(40)] },
  counter: { ...dock, steps: [...playing(31.4), f(6), click('.rl-counter'), f(40), click('.rl-counter'), f(24)] },
  flick: { ...dock, track: '.rl-ball', steps: [...playing(26), f(6), { eval: flick }, f(96)] },
  cork: { ...dock, steps: [...playing(31.4), f(6), click('#rl-mute'), f(44), click('#rl-mute'), f(40)] },
  shutters: { ...dock, steps: [...playing(31.4), f(4), ...repeat(12, [key('.rl-shutters', 'ArrowDown'), f(2)]), f(12), ...repeat(12, [key('.rl-shutters', 'ArrowUp'), f(2)]), f(16)] },
  die: { ...dock, steps: [...playing(31.4), f(6), click('#rl-rate'), f(36), click('#rl-rate'), f(36), click('#rl-rate'), f(30)] },
  // Captions on first, so the lip has opened and the clip holds it; the next cue (40.5 s) prints during the shot.
  tape: { ...dock, clipLate: true, steps: [{ eval: `${player}.store.seek(38.9); ${player}.store.play?.()` }, click('#rl-cc'), { real: 1300 }, { pause: true }, armed, f(80)] },
  locket: { ...dock, steps: [...playing(31.4), f(6), click('#rl-pip'), { eval: `document.querySelector('#rl-pip').setAttribute('data-pip', '')` }, f(70)] },
  drawer: { ...dock, steps: [...playing(31.4), f(6), click('#rl-settings'), f(60)] },
  // Full screen is stubbed: the tug and the swing are the shot, and a real full screen would move the dock out of the clip.
  cord: { ...dock, stubFullscreen: true, steps: [...playing(31.4), f(6), click('#rl-fs'), f(60)] },
  preview: { ...dock, steps: [...playing(31.4), f(4), hover(0.52, 'pointerenter'), hover(0.52), f(26), hover(0.7), f(26), hover(0.86), f(20)] },
  loading: { ...dock, loading: true, steps: [{ pause: true }, { eval: 'window.__grow = Date.now()' }, { frames: 80, every: 2, each: progress }] },
  cast: { ...dock, steps: [...playing(31.4), { eval: `const c = document.querySelector('#rl-cast'); c.hidden = false; c.removeAttribute('hidden'); c.setAttribute('data-availability', 'available')` }, f(6),
    { eval: `document.querySelector('#rl-cast').setAttribute('data-cast-state', 'connected')` }, f(50)] },
  tray: { width: 1100, scale: 3, clip: '.media-skin', steps: [...playing(31.4), f(4), { eval: `for (const v of [document.querySelector('video'), ...[...document.querySelectorAll('*')].map((e) => e.shadowRoot?.querySelector('video'))].filter(Boolean)) v.src = 'data:video/mp4;base64,AAAA'` }, f(50)] },
  calm: { ...dock, reduced: true, steps: [...playing(31.4), f(6), click('#rl-mute'), f(30), click('#rl-rate'), f(30)] },
  keys: { width: 1100, scale: 3, clip: '.rl-dock', steps: [...paused(31.4), { focusStart: true }, f(4), ...repeat(18, [{ key: 'Tab' }, { snap: true }, f(8)])] },
  flat: { width: 1100, scale: 3, clip: '.media-skin', steps: [...playing(31.4), { meta: true }, f(1), { eval: `document.querySelector('.media-skin').setAttribute('data-machine', 'flat')` }, { tick: 4 }, f(1)] },
  hero: { width: 1100, scale: 2, clip: '.media-skin', steps: [...paused(31.4), { meta: true }, f(8), click('#rl-play'), f(110)] },
  ...Object.fromEntries([1100, 760, 520, 340, 230, 170].map((w) => [`tier${w}`, { width: w, scale: 3, clip: '.media-skin', steps: [...playing(31.4), { meta: true }, f(1)] }])),
};

// Every control a keyboard reaches, as the browser sees it: label, role, size, in clip pixels.
const controls = (clipSel) => {
  const origin = document.querySelector(clipSel).getBoundingClientRect();
  const visible = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  return [...document.querySelector('.media-skin').querySelectorAll('button, [role="slider"], [role="button"], [tabindex="0"], media-time-slider, media-volume-slider')]
    .filter(visible)
    .map((e) => { const r = e.getBoundingClientRect(); return { label: e.getAttribute('aria-label') ?? e.textContent.trim().slice(0, 40), role: e.getAttribute('role') ?? e.localName, x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height }; });
};

async function shoot(name) {
  const shot = SHOTS[name];
  const out = new URL(`${name}/`, OUT);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: Math.max(shot.width + 80, 400), height: 1100 }, deviceScaleFactor: shot.scale, colorScheme: 'dark', reducedMotion: shot.reduced ? 'reduce' : 'no-preference' });
  // Lift the 3D pixel-ratio cap for the capture only, so the machine renders at the capture's density.
  await page.route('**/src/machine/gate.ts*', async (route) => {
    const res = await route.fetch();
    const body = (await res.text()).replace(/high:\s*2/, `high: ${shot.scale}`).replace(/standard:\s*1\.25/, `standard: ${shot.scale}`);
    await route.fulfill({ response: res, body });
  });
  // The local file instead of Mux, fully buffered so every sleeper shows (or growing, for the loading shot).
  await page.addInitScript((loading) => {
    window.MediaSource.isTypeSupported = () => false;
    Object.defineProperty(HTMLMediaElement.prototype, 'buffered', {
      get() {
        const d = this.duration || 0;
        const end = loading ? d * Math.min(1, Math.max(0, (Date.now() - (window.__grow ?? Infinity)) / 2400)) : d;
        return { length: end > 0 ? 1 : 0, start: () => 0, end: () => end };
      },
    });
  }, !!shot.loading);
  if (shot.stubFullscreen) await page.addInitScript(() => { Element.prototype.requestFullscreen = function () { return Promise.resolve(); }; });
  await page.clock.install();
  await page.goto(BASE, { waitUntil: 'load' });
  await page.addStyleTag({ content: `body>*:not(header.hero){display:none!important}
    .hero{display:block!important;padding:40px!important;margin:0!important}.hero>*:not(.hero-player){display:none!important}
    .hero-player{inline-size:${shot.width}px!important;margin:0!important}.glow{display:none!important}
    #rl-cast{display:inline-grid!important;visibility:visible!important}` });
  await page.waitForFunction(() => document.querySelector('.media-skin')?.hasAttribute('data-machine'), null, { timeout: 40000 });
  if (shot.width >= 280) await page.waitForFunction(() => document.querySelector('.media-skin').getAttribute('data-machine') === '3d', null, { timeout: 40000 }).catch(() => console.warn(name, 'stayed flat'));
  const measure = async () => { const b = await page.locator(shot.clip).boundingBox(); return { x: Math.floor(b.x), y: Math.floor(b.y), width: Math.ceil(b.width), height: Math.ceil(b.height) }; };
  let clip = await measure();
  const meta = { name, scale: shot.scale, width: shot.width, clip, focus: [], track: [] };
  let n = 0;
  for (const step of shot.steps) {
    if (step.real) { await page.clock.resume(); await page.waitForTimeout(step.real); }
    if (step.pause) await page.clock.pauseAt(await page.evaluate(() => Date.now() + 120));
    if (step.eval) await page.evaluate(step.eval);
    if (step.click) await page.evaluate((s) => document.querySelector(s).click(), step.click);
    if (step.focusStart) await page.evaluate(() => { document.activeElement?.blur(); });
    if (step.key) await page.keyboard.press(step.key);
    if (step.tick) await page.clock.runFor((step.tick * 1000) / 60);
    if (step.meta) {
      Object.assign(meta, await page.evaluate((sel) => {
        const o = document.querySelector(sel).getBoundingClientRect();
        const v = document.querySelector('.media-skin mux-video, .media-skin video')?.getBoundingClientRect();
        const d = document.querySelector('.rl-dock')?.getBoundingClientRect();
        const rel = (r) => r && { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height };
        return { picture: rel(v), dock: rel(d), machine: document.querySelector('.media-skin').getAttribute('data-machine'), time: document.querySelector('video-player').store.currentTime };
      }, shot.clip));
      meta.controls = await page.evaluate(controls, shot.clip);
    }
    if (step.snap) {
      meta.focus.push(await page.evaluate(([sel, frame]) => {
        const e = document.activeElement; const o = document.querySelector(sel).getBoundingClientRect(); const r = e.getBoundingClientRect();
        return { frame, label: e.getAttribute('aria-label') ?? e.textContent.trim().slice(0, 40), role: e.getAttribute('role') ?? e.localName, x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height };
      }, [shot.clip, n]));
    }
    if (shot.clipLate && step.frames && !n) meta.clip = clip = await measure();
    for (let i = 0; i < (step.frames ?? 0); i++) {
      if (step.each) await page.evaluate(step.each);
      await page.clock.runFor(((step.every ?? 1) * 1000) / 60);
      if (shot.track) meta.track.push(await page.evaluate(([s, o]) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left + r.width / 2 - o.x, r.top + r.height / 2 - o.y]; }, [shot.track, clip]));
      await page.screenshot({ path: fileURLToPath(new URL(`f${String(n++).padStart(4, '0')}.jpg`, out)), clip, type: 'jpeg', quality: 92 });
    }
  }
  meta.frames = n;
  writeFileSync(new URL('meta.json', out), JSON.stringify(meta, null, 1));
  console.log(name, n, 'frames', JSON.stringify(clip));
  await browser.close();
}

const want = process.argv.slice(2);
for (const name of want.includes('all') ? Object.keys(SHOTS) : want) {
  const t0 = Date.now();
  await shoot(name).catch((e) => console.error(name, 'FAILED', e.message.split('\n')[0]));
  console.log(name, `${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
