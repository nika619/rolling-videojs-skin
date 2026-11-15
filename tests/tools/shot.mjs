// Render a page and save a PNG of one element, for looking at the skin before anyone else does.
// node tests/tools/shot.mjs <url> <out.png> [--engine chromium|firefox|webkit] [--width 1280] [--height 900]
//   [--selector .media-skin] [--scale 2] [--scheme dark|light] [--eval "js to run first"] [--wait 800]
//   [--print "js whose JSON result is printed"] [--gpu 1 (real GPU instead of software WebGL)]
//   [--clip x,y,w,h (a part of the element, in CSS pixels from its corner)]
import { chromium, firefox, webkit } from '@playwright/test';

const [url, out, ...rest] = process.argv.slice(2);
const option = (name, fallback) => {
  const index = rest.indexOf(`--${name}`);
  return index === -1 ? fallback : rest[index + 1];
};

if (!url || !out) {
  console.error('usage: node tests/tools/shot.mjs <url> <out.png> [options]');
  process.exit(1);
}

const engine = { chromium, firefox, webkit }[option('engine', 'chromium')];
// Headless Chromium draws WebGL in software unless told to use the machine's GPU.
const browser = await engine.launch(option('gpu') ? { args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] } : {});
const page = await browser.newPage({
  viewport: { width: Number(option('width', 1280)), height: Number(option('height', 900)) },
  deviceScaleFactor: Number(option('scale', 2)),
  colorScheme: option('scheme', 'dark'),
  reducedMotion: option('motion', 'no-preference'),
});
const problems = [];

page.on('pageerror', (error) => problems.push(String(error)));
page.on('console', (message) => message.type() === 'error' && problems.push(message.text()));

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(Number(option('wait', 800)));
if (option('eval')) await page.evaluate(option('eval'));
if (option('eval')) await page.waitForTimeout(Number(option('settle', 600)));

if (option('print')) console.log(JSON.stringify(await page.evaluate(option('print')), null, 1));
const target = page.locator(option('selector', '.media-skin')).first();
if (option('clip')) {
  const [x, y, width, height] = option('clip').split(',').map(Number);
  const box = await target.boundingBox();
  await page.screenshot({ path: out, clip: { x: box.x + x, y: box.y + y, width, height } });
} else {
  await target.screenshot({ path: out });
}
await browser.close();
console.log(problems.length ? `saved ${out}; errors: ${problems.join(' | ')}` : `saved ${out}`);
