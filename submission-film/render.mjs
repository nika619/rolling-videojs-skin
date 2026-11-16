// Paints film.html frame by frame: Playwright calls window.seek(t) and screenshots, ffmpeg makes the H.264.
// node submission-film/render.mjs --at 1,5.5,9 [--out dir]        stills for contact sheets (JPEG, t-<s>.jpg)
// node submission-film/render.mjs [--workers 3] [--from 0 --to 69] all frames as PNG (global numbering), then the MP4
// node submission-film/render.mjs --encode                         only the MP4 from frames already painted
import { chromium } from '@playwright/test';
import { mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const flag = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const FPS = 30;
const OUT = flag('out', fileURLToPath(new URL('../docs/renders/film/', import.meta.url)));
const FRAMES = `${OUT}/frames`;
const scene = new URL('film.html', import.meta.url).href;

async function open(browser) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(`${scene}?render=1`, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.ready);
  return page;
}
const paint = (page, t) => page.evaluate(async (t) => {
  await window.seek(t);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}, t);

const browser = await chromium.launch({ args: ['--allow-file-access-from-files', '--disable-web-security'] });
const at = flag('at');
if (at) {
  mkdirSync(OUT, { recursive: true });
  const page = await open(browser);
  for (const t of at.split(',').map(Number)) {
    await paint(page, t);
    await page.screenshot({ path: `${OUT}/t-${t.toFixed(2)}.jpg`, type: 'jpeg', quality: 90 });
  }
  console.log('stills', at);
} else if (!argv.includes('--encode')) {
  mkdirSync(FRAMES, { recursive: true });
  const page0 = await open(browser);
  const duration = await page0.evaluate(() => window.duration);
  const first = Math.round(Number(flag('from', 0)) * FPS), last = Math.round(Number(flag('to', duration)) * FPS);
  const workers = Number(flag('workers', 3));
  const pages = [page0, ...(await Promise.all(Array.from({ length: workers - 1 }, () => open(browser))))];
  let next = first, done = 0;
  const t0 = Date.now();
  await Promise.all(pages.map(async (page) => {
    while (next < last) {
      const i = next++;
      await paint(page, i / FPS);
      await page.screenshot({ path: `${FRAMES}/${String(i).padStart(5, '0')}.png` });
      if (++done % 150 === 0) console.log(done, 'frames', `${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
  }));
  console.log('painted', first, 'to', last - 1);
}
await browser.close();

if (!at && (argv.includes('--encode') || !argv.includes('--from'))) {
  if (!existsSync(`${FRAMES}/00000.png`)) throw new Error('no frames');
  const mp4 = `${OUT}/rolling-film.mp4`;
  // High profile, every second a keyframe, faststart, so Contra's player starts and scrubs quickly.
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-framerate', String(FPS), '-i', `${FRAMES}/%05d.png`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '17',
    '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-g', String(FPS), '-movflags', '+faststart', '-tag:v', 'avc1', mp4], { stdio: 'inherit' });
  console.log('->', mp4);
}
