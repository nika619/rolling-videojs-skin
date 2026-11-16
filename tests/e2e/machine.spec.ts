import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

import { controls, expectFocusRing, openPlayer, state, watchConsole } from './helpers';

/** What the tests read from `<rolling-machine>`. */
interface Stats {
  frames: number;
  fps: number;
  builds: number;
  triangles: number;
  impulses: Record<string, number>;
}

// A fixed quality, so the machine never steps down on a slow software rasteriser in the middle of a test.
const MACHINE = 'machine=standard';

// Headless engines draw WebGL in software: building and drawing the bench takes several times longer than on a GPU.
test.describe.configure({ timeout: 90_000 });

const stats = (page: Page): Promise<Stats | null> =>
  page.evaluate(() => (document.querySelector('rolling-machine') as unknown as { stats: Stats | null }).stats);

const hasWebGL2 = (page: Page): Promise<boolean> => page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));

/** Open the fixture with the 3D machine and wait until its first frame is on the canvas. */
async function open3d(page: Page, query = 'width=1100'): Promise<void> {
  await openPlayer(page, `${MACHINE}&${query}`);
  test.skip(!(await hasWebGL2(page)), 'this engine has no WebGL 2 here: the flat skin is the whole player, as tested elsewhere');
  await expect(controls(page).player).toHaveAttribute('data-machine', '3d', { timeout: 20_000 });
}

/** Every focusable control of the dock that is on show, in source order. */
const stops = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.rl-dock [tabindex="0"], .rl-dock button')]
      .filter((el) => el.checkVisibility() && el.getClientRects().length > 0)
      .map((el) => el.id || el.className.split(' ').find((name: string) => name.startsWith('rl-')) || el.tagName)
  );

test.describe('the 3D machine', () => {
  test('the canvas is decorative: hidden from assistive technology, no pointer, nothing to focus', async ({ page }) => {
    const noErrors = watchConsole(page);
    await open3d(page);

    const facts = await page.evaluate(() => {
      const host = document.querySelector('rolling-machine')!;
      const canvas = host.querySelector('canvas')!;
      const dock = document.querySelector<HTMLElement>('.rl-dock')!;
      return {
        hidden: host.getAttribute('aria-hidden'),
        pointer: getComputedStyle(canvas).pointerEvents,
        focusable: host.querySelectorAll('a, button, input, select, textarea, [tabindex]').length,
        tabIndex: canvas.tabIndex,
        canvas: [canvas.clientWidth, canvas.clientHeight],
        dock: [dock.offsetWidth, dock.offsetHeight],
      };
    });

    expect(facts.hidden).toBe('true');
    expect(facts.pointer).toBe('none');
    expect(facts.focusable).toBe(0);
    expect(facts.tabIndex).toBe(-1);
    expect(facts.canvas).toEqual(facts.dock);

    // Whatever the pointer meets over the bench is the control, never the canvas.
    await controls(page).lever.scrollIntoViewIfNeeded();
    const lever = (await controls(page).lever.boundingBox())!;
    const hit = await page.evaluate(
      ([x, y]) => {
        // Out through the icons' shadow roots to the control they belong to.
        let node: Element | null = document.elementFromPoint(x!, y!);
        while (node && node.id !== 'rl-play') node = node.parentElement ?? ((node.getRootNode() as ShadowRoot).host || null);
        return !!node;
      },
      [lever.x + lever.width / 2, lever.y + lever.height / 2]
    );
    expect(hit).toBe(true);
    noErrors();
  });

  test('play, seek, mute, volume, speed, the drawer and full screen all work with 3D on', async ({ page }) => {
    await page.addInitScript(() => {
      const counter = window as unknown as { fullscreenRequests: number };
      counter.fullscreenRequests = 0;
      const original = Element.prototype.requestFullscreen;
      Element.prototype.requestFullscreen = function (this: Element, ...args) {
        counter.fullscreenRequests++;
        return original.apply(this, args);
      };
    });
    const noErrors = watchConsole(page);
    await open3d(page);
    const { lever, rail, horn, volume, jack, drawer, menu, cord, player } = controls(page);

    await lever.click();
    await expect.poll(() => state(page).then((s) => s.paused)).toBe(false);

    const box = (await rail.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.6);
    await expect.poll(() => state(page).then((s) => s.currentTime)).toBeGreaterThan(12);

    await horn.click();
    await expect.poll(() => state(page).then((s) => s.muted)).toBe(false);
    await volume.focus();
    await page.keyboard.press('Home');
    await expect.poll(() => state(page).then((s) => s.volume)).toBe(0);
    await page.keyboard.press('End');
    await expect.poll(() => state(page).then((s) => s.volume)).toBe(1);

    await jack.click();
    await expect.poll(() => state(page).then((s) => s.playbackRate)).toBe(1.25);

    await drawer.click();
    await expect(menu).toHaveAttribute('data-open', '');
    await page.keyboard.press('Escape');
    await expect(menu).not.toHaveAttribute('data-open', '');
    await expect(drawer).toBeFocused();

    await cord.click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { fullscreenRequests: number }).fullscreenRequests))
      .toBeGreaterThan(0);

    await expect(player).toHaveAttribute('data-machine', '3d');
    noErrors();
  });

  test('every tab stop keeps its two-tone ring over the 3D bench', async ({ page, browserName }) => {
    await open3d(page);
    const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
    const expected = await stops(page);

    await page.locator('media-container').focus();
    for (let i = 0; i < expected.length; i++) {
      await page.keyboard.press(tab);
      // Firefox makes the <video> itself a tab stop on the way to the dock.
      if (i === 0 && !(await page.evaluate(() => !!document.activeElement?.closest('.rl-dock')))) await page.keyboard.press(tab);
      await expectFocusRing(page.locator(':focus'));
    }
    await expect(controls(page).player).toHaveAttribute('data-machine', '3d');
  });

  test('the ruler sits on the beam as drawn, and playing never rebuilds the machine', async ({ page }) => {
    await open3d(page, 'width=1100&src=lava');
    const shift = await page.locator('.rl-dock').evaluate((dock) => dock.style.getPropertyValue('--rl-beam-shift'));
    expect(shift).toMatch(/^-?\d+(\.\d+)?px$/);
    expect(await page.locator('.rl-ruler').evaluate((ruler) => getComputedStyle(ruler).translate)).toContain(shift.replace(/\.?0+px$/, ''));

    const before = (await stats(page))!;
    expect(before.triangles).toBeGreaterThan(0);
    await controls(page).lever.click();
    // The film's colours change many times a second; they light the machine and never rebuild it.
    await page.waitForTimeout(2000);
    const after = (await stats(page))!;
    expect(after.frames).toBeGreaterThan(before.frames);
    expect(after.builds).toBe(before.builds);
  });

  test('settled, it draws nothing; playing, at most 30 frames a second; scrolled away, nothing', async ({ page }) => {
    await open3d(page);
    // First it settles: the sleepers drop in while the film loads, the light eases onto the first frame.
    await expect
      .poll(
        async () => {
          const before = (await stats(page))!.frames;
          await page.waitForTimeout(500);
          return (await stats(page))!.frames - before;
        },
        { timeout: 30_000 }
      )
      .toBe(0);
    const settled = (await stats(page))!.frames;
    await page.waitForTimeout(1500);
    expect((await stats(page))!.frames, 'no frames once settled').toBe(settled);

    await controls(page).lever.click();
    // The click itself is interaction, drawn at full rate for a moment; the second after it is plain playback.
    await page.waitForTimeout(2200);
    expect((await stats(page))!.fps, 'plain playback stays at or under 30 frames a second').toBeLessThanOrEqual(31);

    await page.evaluate(() => {
      document.body.style.paddingBlockEnd = '4000px';
      window.scrollTo(0, 3000);
    });
    await page.waitForTimeout(600);
    const away = (await stats(page))!.frames;
    await page.waitForTimeout(1000);
    expect((await stats(page))!.frames, 'no frames while the player is off screen').toBe(away);
    expect((await state(page)).paused, 'the film plays on while the machine rests').toBe(false);
  });
});

test.describe('the machine is alive', () => {
  /** Frames drawn over half a second. */
  const drawing = async (page: Page): Promise<number> => {
    const before = (await stats(page))!.frames;
    await page.waitForTimeout(500);
    return (await stats(page))!.frames - before;
  };

  test('nothing ripples on first load: the machine waits for a hand on the player', async ({ page }) => {
    await open3d(page);
    await expect.poll(() => drawing(page), { timeout: 30_000 }).toBe(0);
    expect((await stats(page))!.impulses, 'no impulse before anyone touches the player').toEqual({});
  });

  test('a pause draws its ripple through the machine and then settles back to no frames at all', async ({ page }) => {
    await open3d(page);
    await controls(page).lever.click();
    await expect.poll(async () => (await state(page)).paused).toBe(false);
    await page.waitForTimeout(1000);

    const before = (await stats(page))!.frames;
    await controls(page).lever.click();
    await expect.poll(async () => (await stats(page))!.impulses.pause ?? 0).toBe(1);
    await page.waitForTimeout(300);
    expect((await stats(page))!.frames, 'the pause is drawn').toBeGreaterThan(before);
    // The knock dies away, the nearest chime rings out, and then nothing moves and nothing is drawn.
    await expect.poll(() => drawing(page), { timeout: 30_000 }).toBe(0);
    expect((await state(page)).paused).toBe(true);
  });

  test('every action reaches the machine as its own impulse', async ({ page }) => {
    await open3d(page);
    const count = async (name: string): Promise<number> => (await stats(page))!.impulses[name] ?? 0;
    const actions: [string, () => Promise<void>, string[]][] = [
      ['play', () => controls(page).lever.click(), ['lever', 'play']],
      ['pause', () => controls(page).lever.click(), ['pause']],
      ['skip', () => controls(page).forward.click(), ['fwd', 'seek']],
      // The fixture opens muted, so every engine lets it play: the first pull of the cork brings the sound.
      ['unmute', () => controls(page).horn.click(), ['horn', 'unmute']],
      ['mute', () => controls(page).horn.click(), ['mute']],
      ['speed', () => controls(page).jack.click(), ['jack', 'rate']],
      ['captions', () => controls(page).tapeKey.click(), ['tapekey', 'captions']],
      ['settings', () => controls(page).drawer.click(), ['drawer', 'open']],
    ];
    for (const [action, act, names] of actions) {
      const before = await Promise.all(names.map(count));
      await act();
      for (const [index, name] of names.entries()) {
        await expect.poll(() => count(name), { message: `${action} sends ${name}` }).toBeGreaterThan(before[index]!);
      }
    }
    await page.keyboard.press('Escape');
  });

  test('with reduced motion an action changes state without a ripple, and the machine is still at once', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open3d(page);
    await expect.poll(() => drawing(page), { timeout: 30_000 }).toBe(0);
    await controls(page).horn.click();
    await expect.poll(async () => (await stats(page))!.impulses.unmute ?? 0).toBe(1);
    // No cork leaping and bouncing, no fluttering slats, no flinch: the new state, then nothing.
    await page.waitForTimeout(700);
    expect(await drawing(page)).toBe(0);
  });
});

test.describe('the flat fallback', () => {
  test('without WebGL the player stays flat and works', async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        return /webgl/.test(type) ? null : (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
      };
    });
    const noErrors = watchConsole(page);
    await openPlayer(page, `${MACHINE}&width=1100`);
    const { player, lever, rail } = controls(page);

    await page.waitForTimeout(1500);
    await expect(player).toHaveAttribute('data-machine', 'flat');
    expect(await page.locator('rolling-machine canvas').count()).toBe(0);

    await lever.click();
    await expect.poll(() => state(page).then((s) => s.paused)).toBe(false);
    const box = (await rail.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.6);
    await expect.poll(() => state(page).then((s) => s.currentTime)).toBeGreaterThan(12);
    noErrors();
  });

  test('forced colours keep the flat skin, in system colours, with no canvas', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await openPlayer(page, `${MACHINE}&width=1100`);
    test.skip(!(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)), 'this engine cannot emulate forced colours');

    await page.waitForTimeout(1500);
    await expect(controls(page).player).toHaveAttribute('data-machine', 'flat');
    expect(await page.locator('rolling-machine canvas').count()).toBe(0);

    // Switched on while 3D is up, the machine steps aside at once.
    await page.emulateMedia({ forcedColors: 'none' });
    await expect(controls(page).player).toHaveAttribute('data-machine', '3d', { timeout: 20_000 });
    await page.emulateMedia({ forcedColors: 'active' });
    await expect(controls(page).player).toHaveAttribute('data-machine', 'flat');
  });

  test('a lost context mid-play hands back to the flat skin with the film where it was', async ({ page }) => {
    await open3d(page);
    const { player, lever, rail } = controls(page);

    await lever.click();
    const box = (await rail.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.6);
    await expect.poll(() => state(page).then((s) => s.currentTime)).toBeGreaterThan(12);
    const before = await state(page);

    await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('rolling-machine canvas')!;
      canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context')!.loseContext();
    });

    await expect(player).toHaveAttribute('data-machine', 'flat');
    expect(await page.locator('rolling-machine canvas').count()).toBe(0);
    // The flat artwork is back: the rail's own track shows again.
    await expect(page.locator('.rl-track').first()).toBeVisible();
    const after = await state(page);
    expect(after.paused).toBe(false);
    expect(after.currentTime).toBeGreaterThanOrEqual(before.currentTime - 0.2);
    expect(after.muted).toBe(before.muted);

    await lever.click();
    await expect.poll(() => state(page).then((s) => s.paused)).toBe(true);
  });
});

test.describe('the machine at each size', () => {
  for (const [width, tier] of [[1100, 'xl'], [800, 'l'], [520, 'm'], [360, 's']] as const) {
    test(`${tier} at ${width}px mounts the machine under its dock, and nothing leaves the dock`, async ({ page }) => {
      const noErrors = watchConsole(page);
      await open3d(page, `width=${width}`);
      const { player, dock } = controls(page);
      await expect(player).toHaveAttribute('data-tier', tier);

      const area = (await dock.boundingBox())!;
      const canvas = (await page.locator('rolling-machine canvas').boundingBox())!;
      expect(Math.abs(canvas.x - area.x) + Math.abs(canvas.width - area.width) + Math.abs(canvas.height - area.height)).toBeLessThan(1.5);

      const boxes = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.rl-dock [tabindex="0"], .rl-dock button')]
          .filter((el) => el.checkVisibility() && el.getClientRects().length > 0)
          .map((el) => {
            const box = el.getBoundingClientRect();
            return { name: el.id || el.className, left: box.left, right: box.right, bottom: box.bottom };
          })
      );
      for (const box of boxes) {
        expect(box.left, `${box.name} starts inside the dock`).toBeGreaterThanOrEqual(area.x - 0.5);
        expect(box.right, `${box.name} ends inside the dock`).toBeLessThanOrEqual(area.x + area.width + 0.5);
        expect(box.bottom, `${box.name} is not cut off below`).toBeLessThanOrEqual(area.y + area.height + 0.5);
      }
      noErrors();
    });
  }

  for (const [width, tier] of [[240, 'xs'], [180, 'xxs']] as const) {
    test(`${tier} at ${width}px stays flat and never fetches the machine`, async ({ page }) => {
      const fetched: string[] = [];
      page.on('request', (request) => {
        if (/machine\/(scene|parts|materials|post)/.test(request.url())) fetched.push(request.url());
      });
      await openPlayer(page, `${MACHINE}&width=${width}`);
      await page.waitForTimeout(1500);
      await expect(controls(page).player).toHaveAttribute('data-tier', tier);
      await expect(controls(page).player).toHaveAttribute('data-machine', 'flat');
      expect(fetched).toEqual([]);
    });
  }

  test('the machine follows the player down to the flat sizes and back', async ({ page }) => {
    await open3d(page);
    const { player } = controls(page);

    await page.evaluate(() => (document.getElementById('root')!.style.inlineSize = '240px'));
    await expect(player).toHaveAttribute('data-machine', 'flat');
    expect(await page.locator('rolling-machine canvas').count()).toBe(0);

    await page.evaluate(() => (document.getElementById('root')!.style.inlineSize = '800px'));
    await expect(player).toHaveAttribute('data-machine', '3d', { timeout: 20_000 });
    await expect(player).toHaveAttribute('data-tier', 'l');
  });
});

test.describe('accessibility scan with 3D on', () => {
  for (const width of [1100, 520]) {
    test(`axe finds nothing at ${width}px: at rest, playing, drawer open`, async ({ page }) => {
      await open3d(page, `width=${width}`);
      const scan = async (label: string) => {
        const results = await new AxeBuilder({ page }).include('media-container').analyze();
        const found = results.violations.flatMap((violation) =>
          violation.nodes.map((node) => `${label}: ${violation.id} (${node.target.join(' ')})`)
        );
        // The same inherited exception as the flat scan: Video.js names its time toggle with the remaining time.
        expect(found.filter((entry) => !entry.includes('label-content-name-mismatch (.rl-counter)'))).toEqual([]);
      };

      await scan('at rest');
      await controls(page).lever.click();
      await expect.poll(() => state(page).then((s) => s.paused)).toBe(false);
      await scan('playing');
      await controls(page).drawer.click();
      await expect(controls(page).menu).toHaveAttribute('data-open', '');
      await scan('drawer open');
    });
  }
});

