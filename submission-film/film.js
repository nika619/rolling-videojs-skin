// The film as a pure function of time. GSAP owns the type (masked lines, clip reveals); update(t) owns every
// picture: which captured frame shows, where the loupe looks, the wipes and irises. seek(t) awaits every decode.
gsap.registerPlugin(SplitText);
const FPS = 30;
const CAP = '../docs/renders/film/cap/', ASSET = '../docs/renders/film/assets/', SNAKE = '../site/public/img/snake/seq/';
const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
const lerp = (a, b, p) => a + (b - a) * p;
const io = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
const out3 = (p) => 1 - (1 - p) ** 3;
const expo = (p) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p));
const pad = (i, n = 4) => String(i).padStart(n, '0');
const cap = (shot, i) => `${CAP}${shot}/f${pad(i)}.jpg`;
const pending = [];
function show(img, url) {
  if (img.getAttribute('src') === url) return;
  img.setAttribute('src', url);
  pending.push(img.decode().catch(() => {}));
}
const css = (el, o) => Object.assign(el.style, o);

// Scenes, in order, with their lengths in seconds.
const S = {};
let cursor = 0;
for (const [k, d] of [['open', 4.2], ['hero', 4.6], ['tour', 13 * 2.2], ['snake', 3.4], ['rest', 3.2], ['alive', 4.6], ['ctl', 3.4], ['keys', 3.6], ['calm', 2.9], ['tiers', 3.4], ['mux', 3.8], ['end', 4.6]]) {
  S[k] = [cursor, cursor + d];
  cursor += d;
}
const DURATION = cursor;
const PRE = { hero: 0.8, tour: 0.35 }; // scenes that open over the one before

// The tour: each mechanism, where it sits in the 5x dock frames (5500 x 910), and what it means.
const BEAT = 2.2;
const BEATS = [
  { shot: 'lever', at: [253, 728], k: 1, name: 'Lever', means: 'Play and pause', line: 'Drops a brass pin in front of the marble.', el: 'media-play-button', label: 'Play', keys: ['Space', 'K'] },
  { shot: 'flippers', at: [803, 728], k: 0.9, name: 'Pinball flippers', means: 'Skip ten seconds', line: 'They kick the marble back or forward.', el: 'media-seek-button', label: 'Seek forward 10 seconds', keys: ['J', 'L'] },
  { shot: 'counter', at: [1364, 728], k: 1, name: 'Drum counter', means: 'Time', line: 'Press it and the drums show the time left.', el: 'media-time', label: 'Show remaining time', keys: [] },
  { shot: 'flick', track: true, k: 1.1, name: 'Marble on the rail', means: 'Seek, with momentum', line: 'Flick it and it rolls on. Tap the rail and it rolls there.', el: 'media-time-slider', label: 'Seek', keys: ['←', '→'] },
  { shot: 'flick', at: [2590, 375], k: 1.5, name: 'Chime bars', means: 'Chapters', line: 'One tuned bar per chapter; the marble rings it in passing.', el: 'media-time-slider-chapters', label: 'Chapter', keys: [] },
  { shot: 'cork', at: [3080, 728], k: 1, name: 'Cork in the horn', means: 'Mute', line: 'Pull it and the sound comes back with a pop.', el: 'media-mute-button', label: 'Mute', keys: ['M'] },
  { shot: 'shutters', at: [3531, 728], k: 0.95, name: 'Organ swell shutters', means: 'Volume', line: 'The slats open with the volume; the film’s light leaks through.', el: 'media-volume-slider', label: 'Volume', keys: ['↑', '↓'] },
  { shot: 'die', at: [4015, 728], k: 1, name: 'Die on a ratchet jack', means: 'Speed', line: 'Six speeds, six faces. The jack tilts the rail: steeper is faster.', el: 'media-playback-rate-button', label: 'Playback rate', keys: ['<', '>'] },
  { shot: 'tape', at: [3075, 125], k: 0.72, free: true, film: 264, name: 'Paper tape', means: 'Captions', line: 'Printed in the lip under the picture. They never cover the film.', el: 'media-captions-button', label: 'Enable captions', keys: ['C'] },
  { shot: 'locket', at: [4631, 728], k: 1, name: 'Brass locket', means: 'Picture-in-picture', line: 'Its lid opens on the live film before it leaves.', el: 'media-pip-button', label: 'Enter picture-in-picture', keys: ['I'] },
  { shot: 'drawer', at: [4972, 728], k: 0.95, name: 'Felt drawer', means: 'Settings', line: 'It slides down the slope; each setting is a peg in a hole.', el: 'media-menu', label: 'Settings', keys: [] },
  { shot: 'cord', at: [5308, 728], k: 1, name: 'Pull cord', means: 'Full screen', line: 'A wooden bead that swings after the tug.', el: 'media-fullscreen-button', label: 'Enter fullscreen', keys: ['F'] },
  { shot: 'preview', at: [2900, 150], k: 0.75, free: true, film: 78, last: 29, name: 'Loupe', means: 'Preview', line: 'Hover the rail: that moment, its time and its chapter.', el: 'media-time-slider', label: 'Seek', keys: [] },
];
const R = 330; // the loupe's radius on screen
const LOUPE = { x: 1330, y: 395 };
const STRIP = { x: 110, y: 739, w: 1700, h: 282 };

const meta = {};
const lavaImg = new Image();
let lctx, mctx, mask, wordW = 0, glyphX = [];
const WORD = 'Rolling', FS = 460;

const tl = gsap.timeline({ paused: true });

/** Masked line reveals for every .split, clip wipes for kickers and chips, in at tIn and out at tOut. */
function type(scope, tIn, tOut) {
  [...scope.querySelectorAll('.kicker, .split, .chip, .code, .facts')].forEach((el, i) => {
    const at = tIn + i * 0.09;
    if (el.classList.contains('split')) {
      const lines = SplitText.create(el, { type: 'lines', mask: 'lines', linesClass: 'ln' }).lines;
      tl.fromTo(lines, { yPercent: 118 }, { yPercent: 0, duration: 0.8, ease: 'expo.out', stagger: 0.07 }, at);
      if (tOut) tl.to(lines, { yPercent: -118, duration: 0.34, ease: 'power3.in', stagger: 0.025 }, tOut);
    } else {
      tl.fromTo(el, { clipPath: 'inset(-20% 100% -20% 0%)' }, { clipPath: 'inset(-20% 0% -20% 0%)', duration: 0.6, ease: 'power3.out' }, at);
      if (tOut) tl.to(el, { clipPath: 'inset(-20% 0% -20% 100%)', duration: 0.3, ease: 'power3.in' }, tOut);
    }
  });
}

function buildTour() {
  const box = $('#tour-text');
  BEATS.forEach((b, i) => {
    const d = document.createElement('div');
    d.className = 'beat';
    const keys = b.keys.map((k) => `<span class="kbd">${k}</span>`).join('');
    d.innerHTML = `<h2 class="name split">${b.name}</h2><p class="means split">${b.means}</p><p class="line split">${b.line}</p>
      <div class="ctl"><span class="code">&lt;${b.el}&gt; <em>“${b.label}”</em>${keys}</span></div>`;
    box.append(d);
    const s = S.tour[0] + i * BEAT;
    type(d, s + 0.1, s + BEAT - 0.36);
  });
  const ticks = $('#ring-ticks');
  for (let a = 0; a < 360; a += 4) {
    const long = a % 40 === 0, r0 = long ? 350 : 352, r1 = long ? 372 : 362, rad = (a * Math.PI) / 180;
    ticks.insertAdjacentHTML('beforeend', `<line x1="${r0 * Math.cos(rad)}" y1="${r0 * Math.sin(rad)}" x2="${r1 * Math.cos(rad)}" y2="${r1 * Math.sin(rad)}" stroke-width="${long ? 3 : 1.4}"/>`);
  }
}

const REST = [
  { shot: 'loading', at: [1500, 330], k: 0.8, name: 'Sleepers', means: 'Loading', f0: 0 },
  { shot: 'cast', at: [4630, 728], k: 1.05, name: 'Catapult', means: 'Cast', f0: 0 },
  { shot: 'tray', at: [1650, 1000], k: 0.55, name: 'Tray', means: 'Error: “Put it back”', f0: 0 },
];
function buildRest() {
  const row = $('#rest-row');
  REST.forEach((r, i) => {
    row.insertAdjacentHTML('beforeend', `<div class="mini" style="left:${400 + i * 560 - 220}px;top:330px"><div class="in"><img alt="" /></div><h3 class="split">${r.name}<span>${r.means}</span></h3></div>`);
  });
}

const ALIVE = [
  { shot: 'lever', from: 2, hit: 8, at: [253, 728], centre: 1745, note: '<b>Play</b>The pin drops, a glint runs down the rods, the sleepers wave, the snake looks up.' },
  { shot: 'cork', from: 42, hit: 50, at: [3080, 640], centre: 3080, note: '<b>Unmute</b>The cork pops and bounces, the horn trembles, the slats flutter.' },
  { shot: 'die', from: 0, hit: 6, at: [4015, 728], centre: 3755, note: '<b>Speed</b>The jack ratchets tooth by tooth, the die bounces, the rail tilts and the marble rocks.' },
];

async function init() {
  await Promise.all([document.fonts.load('500 100px Switzer'), document.fonts.load('400 30px Switzer')]);
  await document.fonts.ready;
  for (const name of ['hero', 'flat', 'keys', 'flick', 'tape', 'tray', 'cast', ...[1100, 760, 520, 340, 230, 170].map((w) => `tier${w}`)]) {
    meta[name] = await fetch(`${CAP}${name}/meta.json`).then((r) => r.json()).catch(() => null);
  }
  // Lava word: letters laid out once, drawn per frame into a mask over the lava.
  const c = $('#lava-canvas');
  lctx = c.getContext('2d');
  mask = document.createElement('canvas');
  mask.width = 1920; mask.height = 1080;
  mctx = mask.getContext('2d');
  for (const x of [lctx, mctx]) { x.font = `500 ${FS}px Switzer`; x.letterSpacing = '-18px'; }
  wordW = mctx.measureText(WORD).width;
  glyphX = [...WORD].map((_, i) => mctx.measureText(WORD.slice(0, i)).width);

  buildTour();
  buildRest();
  $('#alive-notes').innerHTML = ALIVE.map((a) => `<p class="note">${a.note}</p>`).join('');

  // Type for each scene.
  tl.fromTo('#open-kicker', { clipPath: 'inset(-20% 100% -20% 0%)' }, { clipPath: 'inset(-20% 0% -20% 0%)', duration: 0.7, ease: 'power3.out' }, 0.5);
  const openLine = SplitText.create('#open-line', { type: 'lines', mask: 'lines', linesClass: 'ln' }).lines;
  tl.fromTo(openLine, { yPercent: 118 }, { yPercent: 0, duration: 0.9, ease: 'expo.out' }, 1.35);
  tl.to(['#open-kicker', '#open-line'], { opacity: 0, duration: 0.4 }, 3.55);
  type($('#hero-text'), S.hero[0] + 0.35, S.hero[1] - 0.75);
  tl.fromTo('#hero-chip', { clipPath: 'inset(-20% 100% -20% 0%)' }, { clipPath: 'inset(-20% 0% -20% 0%)', duration: 0.6, ease: 'power3.out' }, S.hero[0] + 0.2);
  tl.to('#hero-chip', { opacity: 0, duration: 0.25 }, S.hero[1] - 0.75);
  for (const k of ['snake', 'rest', 'alive', 'ctl', 'keys', 'calm', 'tiers', 'mux']) type($(`#${k}`), S[k][0] + 0.12, S[k][1] - 0.4);
  tl.fromTo('#end-chip', { clipPath: 'inset(-30% 100% -30% 0%)' }, { clipPath: 'inset(-30% 0% -30% 0%)', duration: 0.8, ease: 'power3.out' }, S.end[0] + 1.3);
  const endLine = SplitText.create('#end-line', { type: 'lines', mask: 'lines', linesClass: 'ln' }).lines;
  tl.fromTo(endLine, { yPercent: 118 }, { yPercent: 0, duration: 0.9, ease: 'expo.out' }, S.end[0] + 1.6);
  tl.to({}, { duration: 0.01 }, DURATION); // the timeline runs the film's whole length

  // Tiers: six real captures at one scale, standing on one rule.
  const row = $('#tier-row');
  let x = 110;
  const ws = [1100, 760, 520, 340, 230, 170], names = ['XL', 'L', 'M', 'S', 'XS', 'XXS'], k = 0.5;
  ws.forEach((w, i) => {
    const m = meta[`tier${w}`];
    const h = m ? m.clip.height : w * 0.7;
    row.insertAdjacentHTML('beforeend', `<div class="tier" style="left:${x}px"><div class="shot" style="width:${w * k}px;height:${h * k}px"><img alt="" src="${cap(`tier${w}`, 0)}" style="width:${w * k}px" /></div><p><b>${names[i]}</b> ${w} px</p></div>`);
    x += w * k + 28;
  });
  row.insertAdjacentHTML('beforeend', '<i id="tier-rule"></i>');
  [...row.querySelectorAll('.tier')].forEach((el, i) => {
    tl.fromTo(el.querySelector('.shot'), { clipPath: 'inset(100% 0 0 0 round 12px)' }, { clipPath: 'inset(0% 0 0 0 round 12px)', duration: 0.7, ease: 'expo.out' }, S.tiers[0] + 0.45 + i * 0.1);
    tl.fromTo(el.querySelector('p'), { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 0.5, ease: 'power3.out' }, S.tiers[0] + 0.8 + i * 0.1);
    tl.to(el, { yPercent: -6, opacity: 0, duration: 0.3, ease: 'power2.in' }, S.tiers[1] - 0.38 + i * 0.02);
  });
  tl.fromTo('#tier-rule', { scaleX: 0 }, { scaleX: 1, duration: 1.1, ease: 'expo.out' }, S.tiers[0] + 0.3);
  tl.to('#tier-rule', { scaleX: 0, transformOrigin: '100% 50%', duration: 0.3 }, S.tiers[1] - 0.38);

  // Controls scene boxes, from the real elements' rectangles.
  const fm = meta.flat;
  if (fm) {
    const boxes = $('#ctl-boxes');
    fm.controls.filter((c) => c.y >= fm.dock.y - 2 && c.w * c.h > 400).forEach((c) => {
      boxes.insertAdjacentHTML('beforeend', `<rect data-x="${c.x}" data-y="${c.y - fm.dock.y}" data-w="${c.w}" data-h="${c.h}" rx="8"/>`);
    });
    const n = boxes.children.length;
    $('#ctl-facts').innerHTML = `<span>${n} controls</span> · each one labelled · 44 px touch targets on phones · a two-tone focus ring`;
    tl.fromTo('#ctl-facts', { clipPath: 'inset(-20% 100% -20% 0%)' }, { clipPath: 'inset(-20% 0% -20% 0%)', duration: 0.7, ease: 'power3.out' }, S.ctl[0] + 1.5);
  }
  $('#pid-text').textContent = '';
}

/** Draw the lava word: letters rise through a band mask, the lava runs inside them, a brass rail draws under. */
function drawLava(t, o) {
  lctx.clearRect(0, 0, 1920, 1080);
  if (o.alpha <= 0) return;
  const idx = Math.floor(t * FPS) % 190;
  show(lavaImg, `${ASSET}lava/f${pad((idx < 96 ? idx : 190 - idx) + 1)}.jpg`);
  mctx.clearRect(0, 0, 1920, 1080);
  mctx.save();
  mctx.translate(960, o.y);
  mctx.scale(o.s, o.s);
  mctx.beginPath();
  mctx.rect(-1100, -FS * 1.1, 2200, FS * 1.36);
  mctx.clip();
  mctx.fillStyle = '#000';
  [...WORD].forEach((ch, i) => mctx.fillText(ch, -wordW / 2 + glyphX[i], (1 - o.rise(i)) * FS * 1.4));
  mctx.restore();
  lctx.save();
  lctx.globalAlpha = o.alpha;
  if (lavaImg.complete && lavaImg.naturalWidth) lctx.drawImage(lavaImg, 0, 0, 1920, 1080);
  const g = lctx.createLinearGradient(0, o.y - FS * 0.75 * o.s, 0, o.y + FS * 0.2 * o.s);
  g.addColorStop(0, 'rgba(255,190,120,0.30)');
  g.addColorStop(1, 'rgba(255,90,30,0.10)');
  lctx.globalCompositeOperation = 'screen';
  lctx.fillStyle = g;
  lctx.fillRect(0, 0, 1920, 1080);
  lctx.globalCompositeOperation = 'destination-in';
  lctx.drawImage(mask, 0, 0);
  lctx.globalCompositeOperation = 'source-over';
  // The rail the marble rolls on, drawn in from the left.
  const y = o.y + FS * 0.36 * o.s, x0 = 960 - (wordW / 2) * o.s, x1 = 960 + (wordW / 2) * o.s;
  if (o.rail > 0) {
    lctx.strokeStyle = '#e2b45a';
    lctx.lineWidth = 3;
    lctx.lineCap = 'round';
    lctx.shadowColor = 'rgba(255,190,110,0.6)';
    lctx.shadowBlur = 12;
    lctx.beginPath();
    lctx.moveTo(x0, y);
    lctx.lineTo(lerp(x0, x1, o.rail), y);
    lctx.stroke();
  }
  lctx.restore();
  return { x0, x1, y };
}

function marble(x, y, alpha) {
  const m = $('#marble');
  css(m, { transform: `translate(${x}px, ${y}px)`, opacity: alpha });
  css(m.firstElementChild, { transform: `rotate(${(x / 27) * 57.3}deg)` });
}

/** A clip wipe with a brass edge: p in 0..1 reveals left to right, q in 0..1 hides left to right. */
function wipe(el, p, q, round = 22) {
  css(el, { clipPath: `inset(0 ${(1 - p) * 100}% 0 ${q * 100}% round ${round}px)` });
}

function loupeView(img, b, k, frameW, frameH, r) {
  const cx = clamp(b[0], r / k, frameW - r / k);
  const cy = frameH * k < 2 * r ? frameH / 2 : clamp(b[1], r / k, frameH - r / k);
  css(img, { transform: `translate(${r - cx * k}px, ${r - cy * k}px) scale(${k})` });
  return [cx, cy];
}

function beatState(i, t) {
  const b = BEATS[i];
  const s = S.tour[0] + i * BEAT;
  const m = b.shot === 'tape' ? meta.tape : b.shot === 'flick' ? meta.flick : null;
  const frames = m?.frames ?? 120;
  const last = b.last ?? frames - 1;
  const f = clamp(Math.floor((t - s - 0.25) * FPS), 0, last);
  const W = (m?.clip.width ?? 1100) * 5, H = (m?.clip.height ?? 182) * 5;
  let at = b.at;
  if (b.track && m?.track.length) {
    // The loupe follows the marble, eased over a few frames so the camera never jerks.
    let x = 0, y = 0, n = 0;
    for (let j = Math.max(0, f - 4); j <= Math.min(m.track.length - 1, f + 4); j++, n++) { x += m.track[j][0]; y += m.track[j][1]; }
    at = [(x / n) * 5, (y / n) * 5 + 40];
  }
  const k = b.k * (1 + 0.05 * seg(t, s, s + BEAT));
  const ks = Math.min(STRIP.w / W, STRIP.h / H);
  const cx = clamp(at[0], R / k, W - R / k), cy = b.free ? at[1] : H * k < 2 * R ? H / 2 : clamp(at[1], R / k, H - R / k);
  const ox = STRIP.x + (STRIP.w - W * ks) / 2;
  return { b, s, f, W, H, k, ks, ox, cx, cy, foot: [ox + cx * ks, STRIP.y + cy * ks, (R / k) * ks] };
}

function update(t) {
  const frame = Math.round(t * FPS);
  $('#turb').setAttribute('seed', String(frame % 97));
  for (const el of document.querySelectorAll('.scene')) {
    const w = S[el.id];
    el.style.visibility = w && t >= w[0] - (PRE[el.id] ?? 0) && t < w[1] ? 'visible' : 'hidden';
  }

  // Opening and end card: the lava word.
  const [o0, o1] = S.open, [e0] = S.end;
  if (t < o1 + 0.3) {
    const fade = 1 - seg(t, 3.75, 4.35);
    const r = drawLava(t, { s: 1 + 0.05 * seg(t, 3.4, 4.4), y: 620, alpha: fade, rail: out3(seg(t, 0.15, 1.1)), rise: (i) => expo(seg(t, 0.12 + i * 0.075, 1.15 + i * 0.075)) });
    const p = out3(seg(t, 0.35, 2.5));
    marble(lerp(-80, r.x1 - 30, p), r.y - 29, 1 - seg(t, 4.0, 4.35));
  } else if (t >= e0) {
    const r = drawLava(t, { s: 0.6, y: 560, alpha: 1, rail: out3(seg(t, e0 + 0.1, e0 + 1)), rise: (i) => expo(seg(t, e0 + 0.15 + i * 0.07, e0 + 1.1 + i * 0.07)) });
    marble(lerp(-80, r.x1 - 30, out3(seg(t, e0 + 0.3, e0 + 2.3))), r.y - 29, 1);
  } else {
    lctx.clearRect(0, 0, 1920, 1080);
    marble(-200, -200, 0);
  }
  css($('#end-chip'), { top: '700px', visibility: t >= e0 ? 'visible' : 'hidden' });
  css($('#end-line'), { top: '800px', visibility: t >= e0 ? 'visible' : 'hidden' });

  // Hero: an iris opens out of the resting marble onto the whole player.
  const hm = meta.hero;
  if (hm && t >= S.hero[0] - 0.8 && t < S.tour[0] + 0.3) {
    const kd = 1140 / hm.clip.width, hx = 670, hy = (1080 - hm.clip.height * kd) / 2;
    const hf = clamp(Math.floor((t - 5.0) * FPS), 0, hm.frames - 1);
    const fr = $('#hero-frame'), img = $('#hero-img'), pic = $('#hero-pic');
    show(img, cap('hero', hf));
    show(pic, `${ASSET}film/f${pad(Math.max(0, hf - 8) + 1)}.jpg`);
    css(img, { width: `${hm.clip.width * kd}px` });
    const pr = hm.picture;
    css(pic, { left: `${pr.x * kd}px`, top: `${pr.y * kd}px`, width: `${pr.w * kd}px`, height: `${pr.h * kd}px`, objectFit: 'cover' });
    // The match cut: the picture folds up, the dock flies down to become the tour's strip.
    const dockY = hm.dock.y * kd, s = STRIP.w / (hm.dock.w * kd);
    const pa = io(seg(t, S.tour[0] - 0.55, S.tour[0] - 0.15)), pb = io(seg(t, S.tour[0] - 0.35, S.tour[0] + 0.15));
    css(fr, { left: '0px', top: '0px', width: `${hm.clip.width * kd}px`, height: `${hm.clip.height * kd}px`,
      transform: `translate(${lerp(hx, STRIP.x, pb)}px, ${lerp(hy, STRIP.y - dockY * s, pb)}px) scale(${lerp(1 + 0.025 * seg(t, 3.5, S.tour[0] - 0.4), s, pb)})`,
      clipPath: `inset(${dockY * pa}px 0 0 0 round ${lerp(20, 14 / s, pb)}px)` });
    const marbleX = 960 + wordW / 2 - 30, marbleY = 620 + FS * 0.36 - 29;
    const ir = io(seg(t, 3.45, 4.5)) * 2300;
    css($('#hero'), { clipPath: t < 4.5 ? `circle(${ir}px at ${marbleX}px ${marbleY}px)` : 'none' });
    css($('#hero-chip'), { left: `${hx}px`, top: `${hy - 72}px` });
  }

  // Tour.
  if (t >= S.tour[0] - 0.35 && t < S.tour[1]) {
    const i = clamp(Math.floor((t - S.tour[0]) / BEAT), 0, BEATS.length - 1);
    const st = beatState(i, t);
    const prev = i > 0 ? beatState(i - 1, t) : st;
    const blend = i > 0 ? io(seg(t, st.s - 0.25, st.s + 0.2)) : 1;
    const strip = $('#strip'), li = $('#loupe-img');
    const url = cap(st.b.shot, st.f);
    show(strip, url);
    show(li, url);
    css(strip, { transform: `translate(${st.ox - STRIP.x}px, 0px) scale(${st.ks})`, opacity: String(seg(t, S.tour[0] - 0.12, S.tour[0] + 0.05)) });
    css(li, { transform: `translate(${R - st.cx * st.k}px, ${R - st.cy * st.k}px) scale(${st.k})` });
    // Above the dock is the picture: where the loupe looks past the lip, it sees the film at that moment.
    const lp = $('#loupe-pic');
    lp.style.visibility = st.b.free ? 'inherit' : 'hidden';
    if (st.b.free) {
      show(lp, `${ASSET}film/f${pad(st.b.film + st.f)}.jpg`);
      css(lp, { transform: `translate(${R - st.cx * st.k}px, ${R - (st.cy + 3094) * st.k}px) scale(${(st.k * 5500) / 1920})` });
    }
    const rin = out3(seg(t, st.s + (i ? 0 : 0.15), st.s + 0.4)), rout = 1 - io(seg(t, st.s + BEAT - 0.28, st.s + BEAT));
    const r = R * Math.min(rin, i === BEATS.length - 1 ? 1 : rout);
    css($('#loupe-in'), { clipPath: `circle(${r}px at ${R}px ${R}px)` });
    const ringIn = out3(seg(t, S.tour[0] - 0.1, S.tour[0] + 0.45)), ringOut = 1 - io(seg(t, S.tour[1] - 0.4, S.tour[1]));
    const turn = 9 * t + 50 * (i + io(seg(t, st.s - 0.15, st.s + 0.45)));
    css($('#ring'), { transform: `rotate(${turn}deg) scale(${ringIn * ringOut})` });
    css($('#loupe'), { transform: `scale(${ringIn * ringOut})` });
    // The footprint on the strip, the dim around it, and the cone up to the loupe.
    const fx = lerp(prev.foot[0], st.foot[0], blend), fy = lerp(prev.foot[1], st.foot[1], blend), fr = lerp(prev.foot[2], st.foot[2], blend);
    const dim = 0.32;
    css($('#strip-wrap'), { maskImage: `radial-gradient(circle ${fr + 18}px at ${fx - STRIP.x}px ${fy - STRIP.y}px, #000 ${fr}px, rgb(0 0 0 / ${dim}) ${fr + 18}px)` });
    const foot = $('#foot');
    foot.setAttribute('cx', fx); foot.setAttribute('cy', fy); foot.setAttribute('r', fr);
    const c2 = [LOUPE.x, LOUPE.y], R2 = 343 * ringIn * ringOut;
    const dx = c2[0] - fx, dy = c2[1] - fy, len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len;
    const a1 = [fx + nx * fr, fy + ny * fr], a2 = [c2[0] + nx * R2, c2[1] + ny * R2], b1 = [fx - nx * fr, fy - ny * fr], b2 = [c2[0] - nx * R2, c2[1] - ny * R2];
    $('#cone-fill').setAttribute('points', [a1, a2, b2, b1].map((p) => p.join(',')).join(' '));
    for (const [id, p, q] of [['#cone-a', a1, a2], ['#cone-b', b1, b2]]) {
      const l = $(id);
      l.setAttribute('x1', p[0]); l.setAttribute('y1', p[1]); l.setAttribute('x2', q[0]); l.setAttribute('y2', q[1]);
    }
    css($('#cone'), { opacity: String(ringIn * ringOut * seg(t, S.tour[0] + 0.1, S.tour[0] + 0.4)) });
    $('#tour-count').textContent = `Mechanism ${pad(i + 1, 2)} / ${BEATS.length}`;
    css($('#tour-count'), { opacity: String(ringIn * ringOut) });
  }

  // Snakes and ladders: the real replay, one 60 fps tick per frame, so it plays at half speed.
  const [n0, n1] = S.snake;
  if (t >= n0 && t < n1) {
    const band = $('#snake-band'), img = $('#snake-img');
    css(band, { left: '110px', top: '420px', width: '1700px', height: '567px' });
    show(img, `${SNAKE}${pad(clamp(Math.floor((t - n0 - 0.5) * FPS), 0, 61), 2)}.webp`);
    const p = expo(seg(t, n0 + 0.05, n0 + 0.75)), q = io(seg(t, n1 - 0.35, n1));
    wipe(band, p, q);
    css(img, { width: '1700px', transform: `scale(${1 + 0.06 * (1 - p)})` });
  }

  // The rest of the machine: three small loupes.
  const [r0, r1] = S.rest;
  if (t >= r0 && t < r1) {
    [...document.querySelectorAll('.mini')].forEach((el, i) => {
      const r = REST[i], m = meta[r.shot];
      const W = (m?.clip.width ?? 1100) * (m?.scale ?? 5), H = (m?.clip.height ?? 182) * (m?.scale ?? 5);
      const img = el.querySelector('img');
      show(img, cap(r.shot, clamp(r.f0 + Math.floor((t - r0 - 0.3) * FPS), 0, (m?.frames ?? 50) - 1)));
      loupeView(img, r.at, r.k, W, H, 220);
      const p = out3(seg(t, r0 + 0.2 + i * 0.14, r0 + 0.7 + i * 0.14)), q = io(seg(t, r1 - 0.38, r1 - 0.05));
      css(el.querySelector('.in'), { transform: `scale(${p * (1 - q)})` });
    });
  }

  // Alive: three actions, each wiping in over the last; rings spread from where the action is.
  const [a0, a1] = S.alive;
  if (t >= a0 && t < a1) {
    const k = 0.55, win = 1920 / k, part = (a1 - a0 - 0.5) / 3;
    const j = clamp(Math.floor((t - a0 - 0.3) / part), 0, 2);
    const lay = (img, idx) => {
      const a = ALIVE[idx], s = a0 + 0.3 + idx * part;
      show(img, cap(a.shot, clamp(a.from + Math.floor((t - s) * FPS), a.from, 200)));
      const left = clamp(a.centre - win / 2, 0, 5500 - win);
      css(img, { transform: `translate(${-left * k}px, ${-((910 * k - 500) / 2)}px) scale(${k})` });
      return { s, left, a };
    };
    const top = $('#alive-img2'), bottom = $('#alive-img');
    const cur = lay(top, j);
    const pin = j ? io(seg(t, cur.s, cur.s + 0.35)) : expo(seg(t, a0 + 0.05, a0 + 0.7));
    if (j && pin < 1) { lay(bottom, j - 1); bottom.style.visibility = 'inherit'; } else bottom.style.visibility = 'hidden';
    css(top, { clipPath: `inset(0 ${(1 - pin) * 100}% 0 0)` });
    css($('#alive-edge'), { left: `${pin * 1920}px`, opacity: pin > 0 && pin < 1 ? '1' : '0' });
    css($('#alive-band'), { clipPath: `inset(${(1 - expo(seg(t, a0, a0 + 0.6))) * 50}% 0 ${(1 - expo(seg(t, a0, a0 + 0.6))) * 50}% 0)`, opacity: String(1 - seg(t, a1 - 0.35, a1)) });
    // Ripples: three rings from the action point, starting on the frame the action lands.
    const hitT = cur.s + (cur.a.hit - cur.a.from) / FPS;
    const px = (cur.a.at[0] - cur.left) * k, py = cur.a.at[1] * k - (910 * k - 500) / 2;
    $('#ripples').innerHTML = [0, 0.12, 0.24].map((d) => {
      const p = seg(t, hitT + d, hitT + d + 1.0);
      return p > 0 && p < 1 ? `<circle cx="${px}" cy="${py}" r="${20 + 520 * out3(p)}" stroke-width="${4 * (1 - p) + 0.5}" stroke-opacity="${0.85 * (1 - p)}"/>` : '';
    }).join('');
    [...document.querySelectorAll('#alive-notes .note')].forEach((el, i) => {
      const s = a0 + 0.3 + i * part;
      const vin = seg(t, s + 0.15, s + 0.55), vout = i < 2 ? seg(t, s + part - 0.05, s + part + 0.2) : seg(t, a1 - 0.4, a1 - 0.1);
      css(el, { clipPath: `inset(-20% ${(1 - out3(vin)) * 100}% -20% ${io(vout) * 100}%)` });
    });
  }

  // Controls: the 3D machine slides off and the real controls underneath are boxed.
  const [c0, c1] = S.ctl, fm = meta.flat;
  if (fm && t >= c0 && t < c1) {
    const kc = 420 / (fm.dock.h * 3), band = $('#ctl-band');
    const span = fm.dock.w * 3 * kc - 1700, pan = -span * io(seg(t, c0 + 0.3, c1 - 0.3));
    css(band, { height: '420px', clipPath: `inset(0 ${(1 - expo(seg(t, c0 + 0.05, c0 + 0.7))) * 100}% 0 0 round 16px)`, opacity: String(1 - seg(t, c1 - 0.3, c1)) });
    for (const [id, f] of [['#ctl-3d', 0], ['#ctl-flat', 1]]) {
      const img = $(id);
      show(img, cap('flat', f));
      css(img, { transform: `translate(${pan}px, ${-fm.dock.y * 3 * kc}px) scale(${kc})` });
    }
    const curtain = io(seg(t, c0 + 0.7, c0 + 1.6));
    css($('#ctl-top'), { clipPath: `inset(0 ${curtain * 100}% 0 0)` });
    css($('#ctl-edge'), { left: `${(1 - curtain) * 1700}px`, opacity: curtain > 0 && curtain < 1 ? '1' : '0' });
    [...document.querySelectorAll('#ctl-boxes rect')].forEach((r, i) => {
      const s = 3 * kc, p = expo(seg(t, c0 + 1.2 + i * 0.05, c0 + 1.6 + i * 0.05)), g = 8 * (1 - p);
      r.setAttribute('x', Number(r.dataset.x) * s + pan - g);
      r.setAttribute('y', Number(r.dataset.y) * s - g);
      r.setAttribute('width', Number(r.dataset.w) * s + 2 * g);
      r.setAttribute('height', Number(r.dataset.h) * s + 2 * g);
      r.style.opacity = String(p);
    });
  }

  // Keyboard: the camera follows the focus ring stop to stop; the Tab key dips on each hop.
  const [k0, k1] = S.keys, km = meta.keys;
  if (km && t >= k0 && t < k1) {
    const d = Math.floor((t - k0 - 0.45) * FPS), f = clamp(4 + 2 * d, 0, km.frames - 1);
    show($('#keys-img'), cap('keys', f));
    const stops = km.focus.filter((s) => s.frame <= f);
    const cur = stops[stops.length - 1], before = stops[stops.length - 2] ?? cur;
    const hopT = cur ? k0 + 0.45 + (cur.frame - 4) / 2 / FPS : k0;
    const centre = (s) => (s ? (s.x + s.w / 2) * 3 : 400);
    const cx = lerp(centre(before), centre(cur), io(seg(t, hopT, hopT + 0.22)));
    const left = clamp(cx - 960, 0, 3300 - 1920);
    css($('#keys-img'), { transform: `translate(${-left}px, 0px)` });
    const p = expo(seg(t, k0 + 0.1, k0 + 0.7)), q = io(seg(t, k1 - 0.35, k1));
    wipe($('#keys-band'), p, q, 0);
    const press = cur ? 1 - seg(t, hopT, hopT + 0.16) : 1;
    $('#keycap').style.setProperty('--d', `${4 + 10 * (1 - (1 - press) * (t >= hopT ? 1 : 0))}px`);
    css($('#keycap'), { transform: `translateY(${10 * (1 - press) * (t >= hopT ? 1 : 0)}px)`, opacity: String(seg(t, k0 + 0.2, k0 + 0.5) * (1 - seg(t, k1 - 0.35, k1))) });
    $('#focus-label').textContent = cur ? cur.label.replace(/,.*$/, '') : '—';
    css($('#focus-read'), { opacity: String(seg(t, k0 + 0.3, k0 + 0.6) * (1 - seg(t, k1 - 0.35, k1))) });
  }

  // Calm: the same cork, with and without motion.
  const [m0, m1] = S.calm;
  if (t >= m0 && t < m1) {
    const f = clamp(Math.floor((t - m0 - 0.35) * FPS), 0, 60);
    for (const [id, shot, i] of [['#calm-a', 'cork', 0], ['#calm-b', 'calm', 1]]) {
      const pane = $(id), img = pane.querySelector('img');
      show(img, cap(shot, f));
      css(img, { transform: `translate(${415 - 3080}px, ${-440}px)` });
      wipe(pane, expo(seg(t, m0 + 0.15 + i * 0.12, m0 + 0.8 + i * 0.12)), io(seg(t, m1 - 0.35, m1)), 20);
    }
  }

  // Mux: the film itself, through an iris, and the playback ID typed out.
  const [x0, x1] = S.mux;
  if (t >= x0 && t < x1) {
    show($('#mux-img'), `${ASSET}film/f${pad(150 + Math.floor((t - x0) * FPS))}.jpg`);
    css($('#mux-img'), { width: '860px', transform: `scale(${1.08 - 0.08 * out3(seg(t, x0, x1))})`, transformOrigin: '50% 50%' });
    const ir = expo(seg(t, x0 + 0.2, x0 + 1.1)) * 560 * (1 - io(seg(t, x1 - 0.4, x1)));
    css($('#mux-frame'), { clipPath: `circle(${ir}px at 50% 50%)` });
    const id = 'TS9zV00Yta00GC9UjUdQBdqIS3W00OOnVIrza3pY9uICPc';
    $('#pid-text').textContent = id.slice(0, Math.round(id.length * seg(t, x0 + 0.7, x0 + 1.9)));
  }
}

window.ready = init();
window.duration = DURATION;
window.seek = async (t) => {
  await window.ready;
  pending.length = 0;
  tl.time(t, false);
  update(t);
  await Promise.all(pending);
  if (pending.length) { const more = pending.splice(0); update(t); await Promise.all(more); } // the lava mask needs its frame decoded
  update(t);
};
