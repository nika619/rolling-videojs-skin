// Render a page and save a PNG of one element, for looking at the skin before anyone else does.
// node tests/tools/shot.mjs <url> <out.png> [--engine chromium|firefox|webkit] [--width 1280] [--height 900]
//   [--selector .media-skin] [--scale 2] [--scheme dark|light] [--eval "js to run first"] [--wait 800]
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
const browser = await engine.launch();
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

await page.locator(option('selector', '.media-skin')).first().screenshot({ path: out });
await browser.close();
console.log(problems.length ? `saved ${out}; errors: ${problems.join(' | ')}` : `saved ${out}`);
