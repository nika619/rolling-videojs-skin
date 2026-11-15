import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

import {
  controls,
  expectFocusRing,
  FILM_SECONDS,
  fixtureUrl,
  marble,
  marbleAtRest,
  openPlayer,
  seekSettled,
  state,
  watchConsole,
} from './helpers';

const time = (page: Page) => state(page).then((s) => s.currentTime);

test.describe('minimum requirements', () => {
  test('play and pause with the lever', async ({ page }) => {
    const noErrors = watchConsole(page);
    await openPlayer(page);
    const { lever } = controls(page);

    await expect(lever).toHaveAccessibleName('Play');
    await lever.click();
    await expect.poll(() => state(page).then((s) => s.paused)).toBe(false);
    await expect(lever).toHaveAccessibleName('Pause');
    await expect.poll(() => time(page)).toBeGreaterThan(0.5);

    await lever.click();
    await expect.poll(() => state(page).then((s) => s.paused)).toBe(true);
    await expect(lever).toHaveAccessibleName('Play');
    noErrors();
  });

  test('seek: tap the rail, kick with the flippers, step from the keyboard', async ({ page }) => {
    const noErrors = watchConsole(page);
    await openPlayer(page, 'width=1100');
    const { rail, forward, back, marble: thumb } = controls(page);
    const box = (await rail.boundingBox())!;

    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.6);
    await expect.poll(() => time(page)).toBeGreaterThan(FILM_SECONDS * 0.5 - 1.5);
    expect(await time(page)).toBeLessThan(FILM_SECONDS * 0.5 + 1.5);
    expect((await marbleAtRest(page)).x).toBeCloseTo(0.5, 1);

    const middle = await time(page);
    await forward.click();
    await expect.poll(() => time(page)).toBeCloseTo(middle + 10, 0);
    await back.click();
    await back.click();
    await expect.poll(() => time(page)).toBeCloseTo(middle - 10, 0);

    await thumb.focus();
    // Playwright's WebKit drops a seek asked for while the last one is still landing, and lands a frame late.
    for (const [key, second] of [['Home', 0], ['ArrowRight', 1], ['ArrowRight', 2], ['PageUp', 12], ['ArrowLeft', 11]] as const) {
      await seekSettled(page);
      await page.keyboard.press(key);
      await expect.poll(() => time(page)).toBeCloseTo(second, 0);
    }
    expect((await marbleAtRest(page)).x).toBeCloseTo(11 / FILM_SECONDS, 1);
    noErrors();
  });

  test('time: the counter shows elapsed, then remaining; the duration is on its plate', async ({ page }) => {
    await openPlayer(page);
    const { counter, duration, marble: thumb } = controls(page);

    await expect(duration).toHaveText('0:30');
    await expect(counter).toHaveText(/0:00/);

    await thumb.focus();
    for (let second = 1; second <= 4; second++) {
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => time(page)).toBeCloseTo(second, 1);
      // WebKit drops a step pressed while the last seek is still landing.
      await seekSettled(page);
    }
    await expect(counter).toHaveText(/0:04/);
    await expect(thumb).toHaveAttribute('aria-valuetext', /4 seconds/);

    // WebKit can land a seek a frame late (4.01), and whole seconds are floored: 25 left, not 26.
    const left = Math.floor(FILM_SECONDS - (await time(page)));
    await counter.click();
    await expect(counter).toHaveText(new RegExp(`0:${left}`));
    await expect(counter).toHaveAccessibleName(/remaining/i);
    await counter.click();
    await expect(counter).toHaveText(/0:04/);
  });

  test('volume and mute: the cork and the swell shutters', async ({ page }) => {
    const noErrors = watchConsole(page);
    await openPlayer(page, 'width=1100');
    const { horn, volume, shutters } = controls(page);

    expect((await state(page)).muted).toBe(true);
    await expect(horn).toHaveAccessibleName('Unmute');
    await horn.click();
    await expect.poll(() => state(page).then((s) => s.muted)).toBe(false);
    await expect(horn).toHaveAccessibleName('Mute');

    await expect(shutters).toBeVisible();
    await volume.focus();
    await page.keyboard.press('Home');
    await expect.poll(() => state(page).then((s) => s.volume)).toBe(0);
    await page.keyboard.press('End');
    await expect.poll(() => state(page).then((s) => s.volume)).toBe(1);
    await page.keyboard.press('ArrowLeft');
    const lowered = (await state(page)).volume;
    expect(lowered).toBeLessThan(1);
    expect(lowered).toBeGreaterThan(0.8);

    // Dragging the shutters sets the level too.
    const box = (await shutters.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2);
    await expect.poll(() => state(page).then((s) => s.volume)).toBeCloseTo(0.25, 1);

    await horn.click();
    await expect.poll(() => state(page).then((s) => s.muted)).toBe(true);
    noErrors();
  });

  test('full screen: the pull cord asks for it', async ({ page }) => {
    await page.addInitScript(() => {
      const counter = window as unknown as { fullscreenRequests: number };
      counter.fullscreenRequests = 0;
      for (const name of ['requestFullscreen', 'webkitRequestFullscreen', 'webkitRequestFullScreen']) {
        const proto = Element.prototype as unknown as Record<string, ((...args: unknown[]) => unknown) | undefined>;
        const original = proto[name];
        if (!original) continue;
        proto[name] = function (this: Element, ...args: unknown[]) {
          counter.fullscreenRequests++;
          return original.apply(this, args);
        };
      }
    });
    await openPlayer(page);
    const { cord, player } = controls(page);

    await expect(cord).toHaveAccessibleName('Enter fullscreen');
    await cord.click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { fullscreenRequests: number }).fullscreenRequests))
      .toBeGreaterThan(0);

    // Where the engine grants it headless, the whole player goes full screen and the cord offers the way out.
    const granted = await page
      .waitForFunction(() => !!(document.fullscreenElement ?? (document as any).webkitFullscreenElement), null, {
        timeout: 2500,
      })
      .then(() => true)
      .catch(() => false);

    if (granted) {
      expect(await player.evaluate((el) => (document.fullscreenElement ?? (document as any).webkitFullscreenElement) === el)).toBe(true);
      await expect(cord).toHaveAccessibleName('Exit fullscreen');
      await cord.click();
      await expect.poll(() => state(page).then((s) => s.isFullscreen)).toBe(false);
    }
  });
});

test.describe('keyboard only', () => {
  test('every control is reached in visual order with a visible two-tone ring', async ({ page, browserName }) => {
    await openPlayer(page, 'width=1100');
    const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';

    const expected = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.rl-dock [tabindex="0"], .rl-dock button')]
        .filter((el) => el.checkVisibility() && el.getClientRects().length > 0)
        .map((el) => el.id || el.className.split(' ').find((name: string) => name.startsWith('rl-')) || el.tagName)
    );

    expect(expected.slice(0, 3)).toEqual(['rl-marble', 'rl-play', 'rl-back']);
    expect(expected.slice(-2)).toEqual(['rl-settings', 'rl-fs']);
    // The locket and the catapult are only on the bench where the browser can do what they do.
    expect(expected).toEqual(
      expect.arrayContaining(['rl-fwd', 'rl-counter', 'rl-mute', 'rl-shutters-knob', 'rl-rate', 'rl-cc'])
    );

    await page.locator('media-container').focus();
    const reached: string[] = [];
    const places: { x: number; y: number }[] = [];

    for (let i = 0; i < expected.length; i++) {
      await page.keyboard.press(tab);
      // Firefox makes the <video> itself a tab stop on the way to the dock.
      if (i === 0 && !(await page.evaluate(() => !!document.activeElement?.closest('.rl-dock')))) await page.keyboard.press(tab);
      const focused = page.locator(':focus');
      reached.push(
        await focused.evaluate(
          (el) => el.id || el.className.split(' ').find((name: string) => name.startsWith('rl-')) || el.tagName
        )
      );
      await expectFocusRing(focused);
      places.push(
        await focused.evaluate((el) => {
          const box = el.getBoundingClientRect();
          return { x: box.x + box.width / 2 + scrollX, y: box.y + box.height / 2 + scrollY };
        })
      );
    }

    expect(reached).toEqual(expected);

    // Reading order: the rail first, then the bench from its start to its end.
    for (let i = 2; i < places.length; i++) expect(places[i]!.x).toBeGreaterThan(places[i - 1]!.x);
    expect(places[1]!.y).toBeGreaterThan(places[0]!.y);
  });

  test('controls are operated with Enter and Space, and Escape leaves the settings drawer', async ({ page }) => {
    const noErrors = watchConsole(page);
    await openPlayer(page, 'width=1100');
    const { lever, horn, jack, tapeKey, drawer, menu } = controls(page);

    await lever.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => state(page).then((s) => s.paused)).toBe(false);
    await page.keyboard.press('Space');
    await expect.poll(() => state(page).then((s) => s.paused)).toBe(true);

    await horn.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => state(page).then((s) => s.muted)).toBe(false);

    await jack.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => state(page).then((s) => s.playbackRate)).toBe(1.25);
    await expect(jack).toHaveAccessibleName('Playback rate, 1.25');

    await tapeKey.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => state(page).then((s) => s.subtitlesShowing)).toBe(true);
    await expect(tapeKey).toHaveAccessibleName('Disable captions');

    await drawer.focus();
    await page.keyboard.press('Enter');
    await expect(menu).toHaveAttribute('data-open', '');
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('#rl-menu'))).toBe(true);
    await page.keyboard.press('ArrowDown');
    await expectFocusRing(page.locator(':focus'));

    await page.keyboard.press('Escape');
    await expect(menu).not.toHaveAttribute('data-open', '');
    await expect(drawer).toBeFocused();
    noErrors();
  });

  test('player hotkeys work from anywhere in the player', async ({ page }) => {
    await openPlayer(page);
    await page.locator('media-container').focus();

    await page.keyboard.press('k');
    await expect.poll(() => state(page).then((s) => s.paused)).toBe(false);
    await page.keyboard.press('k');
    await expect.poll(() => state(page).then((s) => s.paused)).toBe(true);
    await page.keyboard.press('m');
    await expect.poll(() => state(page).then((s) => s.muted)).toBe(false);
    await page.keyboard.press('End');
    await expect.poll(() => time(page)).toBeGreaterThan(FILM_SECONDS - 1);
  });
});

test.describe('the rail', () => {
  test('the marble is the playhead while the film plays', async ({ page }) => {
    await openPlayer(page, 'width=1100');
    await controls(page).lever.click();
    await expect.poll(() => time(page)).toBeGreaterThan(1.2);

    const [m, s] = await Promise.all([marble(page), state(page)]);
    expect(m.mode).toBe('follow');
    expect(Math.abs(m.x - s.currentTime / s.duration)).toBeLessThan(0.02);
    // Rolling without slipping: it has turned as far as it has travelled.
    const geometry = await page.evaluate(() => ({
      length: document.querySelector<HTMLElement>('.rl-slider')!.clientWidth,
      radius: document.querySelector<HTMLElement>('.rl-marble')!.offsetWidth / 2,
    }));
    expect(m.turn).toBeCloseTo((m.x * geometry.length) / geometry.radius, 1);
  });

  test.describe('thrown @timing', () => {
  // Measured: Playwright's WebKit on Windows decodes and paints each seek of a drag in software, about 200 ms at 2x,
  // and stamps pointer events when it gets round to them, so a quick lift reads as a pause. At 1x it keeps up.
  test.use({ deviceScaleFactor: 1 });


  test('a flicked marble rolls on with momentum and the film follows it', async ({ page }) => {
    // The flick is made of real pointer events a few milliseconds apart. A browser starved by its neighbours delivers
    // them late enough to read as a slow drag, so `npm run test:e2e` runs the @timing tests on their own, one at a time.
    const noErrors = watchConsole(page);
    await openPlayer(page, 'width=1100');
    const box = (await controls(page).rail.boundingBox())!;
    const y = box.y + box.height * 0.6;
    const at = (fraction: number) => box.x + box.width * fraction;

    // A flick: the pointer crosses a third of the rail in a moment and lets go while still moving.
    await page.mouse.move(at(0.9), y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      await page.waitForTimeout(8);
      await page.mouse.move(at(0.9 - i * 0.06), y);
    }
    await page.mouse.up();

    const released = 0.9 - 6 * 0.06;
    await expect.poll(() => marble(page).then((m) => m.mode)).toBe('glide');
    const rest = await marbleAtRest(page);
    const s = await state(page);

    expect(rest.x).toBeLessThan(released - 0.05);
    expect(rest.x).toBeGreaterThanOrEqual(0);
    expect(Math.abs(s.currentTime / s.duration - rest.x)).toBeLessThan(0.02);
    noErrors();
  });
  });

  test('the ruler, the chime bars and the preview loupe are drawn', async ({ page }) => {
    await openPlayer(page, 'width=1100');
    const { rail } = controls(page);

    await expect(page.locator('.rl-tick[data-rank="0"]').first()).toHaveText('0:00');
    expect(await page.locator('.rl-tick').count()).toBeGreaterThan(10);
    await expect(page.locator('.rl-chapter')).toHaveCount(4);

    const box = (await rail.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.61, box.y + box.height * 0.6);
    await expect(page.locator('.rl-loupe')).toHaveCSS('opacity', '1');
    await expect(page.locator('.rl-loupe-time')).toHaveText('0:18');
    await expect(page.locator('.rl-loupe-chapter')).toHaveText('The long run');
  });

  test.describe('with reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('the marble is placed, never thrown', async ({ page }) => {
      await openPlayer(page, 'width=1100');
      const box = (await controls(page).rail.boundingBox())!;
      const y = box.y + box.height * 0.6;

      await page.mouse.move(box.x + box.width * 0.7, y);
      await page.mouse.down();
      for (let i = 1; i <= 6; i++) {
        await page.waitForTimeout(10);
        await page.mouse.move(box.x + box.width * (0.7 - i * 0.03), y);
      }
      await page.mouse.up();

      const m = await marble(page);
      expect(m.mode).toBe('follow');
      expect(m.turn).toBe(0);
      await expect.poll(() => time(page)).toBeCloseTo(FILM_SECONDS * 0.52, 0);
      expect((await marbleAtRest(page)).x).toBeCloseTo(0.52, 1);
    });
  });
});

const TIERS = [
  { width: 1100, tier: 'xl', shown: ['rail', 'lever', 'back', 'forward', 'counter', 'horn', 'shutters', 'jack', 'tapeKey', 'locket', 'drawer', 'cord'] },
  { width: 800, tier: 'l', shown: ['rail', 'lever', 'back', 'forward', 'counter', 'horn', 'shutters', 'jack', 'tapeKey', 'locket', 'drawer', 'cord'] },
  { width: 640, tier: 'l', shown: ['rail', 'lever', 'back', 'forward', 'counter', 'horn', 'shutters', 'jack', 'tapeKey', 'locket', 'drawer', 'cord'] },
  { width: 520, tier: 'm', shown: ['rail', 'lever', 'counter', 'horn', 'tapeKey', 'drawer', 'cord'] },
  { width: 360, tier: 's', shown: ['rail', 'lever', 'counter', 'horn', 'cord'] },
  { width: 240, tier: 'xs', shown: ['rail', 'lever', 'horn', 'cord'] },
  { width: 180, tier: 'xxs', shown: ['lever', 'horn'] },
] as const;

const TIERED = ['rail', 'lever', 'back', 'forward', 'counter', 'horn', 'shutters', 'jack', 'tapeKey', 'locket', 'drawer', 'cord'] as const;

test.describe('size tiers', () => {
  for (const { width, tier, shown } of TIERS) {
    test(`${tier} at ${width}px keeps its controls, inside the dock, and they work`, async ({ page }) => {
      const noErrors = watchConsole(page);
      await openPlayer(page, `width=${width}`);
      const parts = controls(page);

      await expect(parts.player).toHaveAttribute('data-tier', tier);
      expect(Math.round((await parts.player.boundingBox())!.width)).toBe(width);

      const dock = (await parts.dock.boundingBox())!;
      const boxes: { name: string; x: number; y: number; width: number; height: number }[] = [];
      // Unsupported features are absent, not broken: no locket where the browser has no picture-in-picture.
      const canPip = await page.evaluate(() => document.pictureInPictureEnabled === true);

      for (const name of TIERED) {
        if (!(shown as readonly string[]).includes(name) || (name === 'locket' && !canPip)) {
          await expect(parts[name], `${name} is not part of tier ${tier}`).toBeHidden();
          continue;
        }
        await expect(parts[name], `${name} belongs to tier ${tier}`).toBeVisible();
        const box = (await parts[name].boundingBox())!;
        expect(box.x, `${name} starts inside the dock`).toBeGreaterThanOrEqual(dock.x - 0.5);
        expect(box.x + box.width, `${name} ends inside the dock`).toBeLessThanOrEqual(dock.x + dock.width + 0.5);
        expect(box.y + box.height, `${name} is not cut off below`).toBeLessThanOrEqual(dock.y + dock.height + 0.5);
        if (name !== 'rail') boxes.push({ name, ...box });
      }

      // No two bench controls share space.
      for (let i = 1; i < boxes.length; i++) {
        const before = boxes[i - 1]!;
        expect(boxes[i]!.x, `${boxes[i]!.name} clears ${before.name}`).toBeGreaterThanOrEqual(before.x + before.width - 0.5);
      }

      await parts.lever.click();
      await expect.poll(() => state(page).then((s) => s.paused)).toBe(false);
      await parts.horn.click();
      await expect.poll(() => state(page).then((s) => s.muted)).toBe(false);
      noErrors();
    });
  }

  for (const width of [1100, 960, 800, 760, 720]) {
    test(`the bench still fits at ${width}px when a cast device puts the catapult on it`, async ({ page }) => {
      await openPlayer(page, `width=${width}`);
      const dock = (await controls(page).dock.boundingBox())!;
      const boxes = await page.evaluate(() => {
        const cast = document.querySelector<HTMLElement>('#rl-cast')!;
        cast.hidden = false;
        cast.removeAttribute('data-hidden');
        return [...document.querySelectorAll<HTMLElement>('.rl-bench .rl-key, .rl-counter, .rl-shutters')]
          .filter((el) => el.checkVisibility())
          .map((el) => ({ name: el.id || el.className, left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right }));
      });

      expect(boxes.map((box) => box.name)).toContain('rl-cast');
      expect(boxes[boxes.length - 1]!.right).toBeLessThanOrEqual(dock.x + dock.width + 0.5);
      for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.left, boxes[i]!.name).toBeGreaterThanOrEqual(boxes[i - 1]!.right - 0.5);
    });
  }

  test('where the shutters do not fit, the horn opens a shutter box', async ({ page }) => {
    await openPlayer(page, 'width=520');
    const { horn } = controls(page);
    const box = page.locator('#rl-volpop');

    await expect(box).toBeHidden();
    await horn.hover();
    await expect(box).toBeVisible();
    await box.getByRole('slider', { name: 'Volume' }).focus();
    await page.keyboard.press('Home');
    await expect.poll(() => state(page).then((s) => s.volume)).toBe(0);
    await page.keyboard.press('End');
    await expect.poll(() => state(page).then((s) => s.volume)).toBe(1);
  });
});

test.describe('editions and states', () => {
  for (const edition of ['walnut', 'maple'] as const) {
    test(`${edition} keeps its wood whatever the page's colour scheme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: edition === 'walnut' ? 'light' : 'dark' });
      await openPlayer(page, `edition=${edition}`);
      const wood = await page
        .locator('.rl-bench')
        .evaluate((el) => getComputedStyle(el).getPropertyValue('--rl-wood').trim());

      // Resolved through light-dark(): walnut is the dark value, maple the light one.
      const lightness = await page.evaluate((value) => {
        const probe = document.createElement('i');
        probe.style.color = value;
        document.querySelector('.rl-bench')!.append(probe);
        const [r, g, b] = getComputedStyle(probe).color.match(/[\d.]+/g)!.map(Number);
        probe.remove();
        return (r! + g! + b!) / 3;
      }, wood);

      if (edition === 'walnut') expect(lightness).toBeLessThan(90);
      else expect(lightness).toBeGreaterThan(130);
    });
  }

  test('at the end the play control offers a replay and the marble runs back', async ({ page }) => {
    await openPlayer(page);
    const { lever, marble: thumb } = controls(page);

    await thumb.focus();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft');
    await lever.click();
    await expect.poll(() => state(page).then((s) => s.ended), { timeout: 10_000 }).toBe(true);
    await expect(page.locator('rolling-rail')).toHaveAttribute('data-ended', '');
    await expect(lever).toHaveAccessibleName(/replay/i);

    await lever.click();
    await expect.poll(() => state(page).then((s) => s.ended)).toBe(false);
    await expect.poll(() => marble(page).then((m) => m.x)).toBeLessThan(0.2);
  });

  test('a film that cannot load shows the tray, and it can be dismissed from the keyboard', async ({ page }) => {
    await page.goto(fixtureUrl('src=broken'));
    const tray = page.getByRole('alertdialog');

    await expect(tray).toBeVisible({ timeout: 15_000 });
    await expect(tray).toContainText(/\S/);
    // Focus is taken to the tray, so the keyboard can put the marble back at once.
    await expect(tray.getByRole('button')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(tray).toBeHidden();
  });
});

test.describe('accessibility scan', () => {
  for (const width of [1100, 520, 240]) {
    test(`axe finds nothing at ${width}px: at rest, playing, drawer open`, async ({ page }) => {
      await openPlayer(page, `width=${width}`);
      const scan = async (label: string) => {
        const results = await new AxeBuilder({ page }).include('media-container').analyze();
        const found = results.violations.flatMap((violation) =>
          violation.nodes.map((node) => `${label}: ${violation.id} (${node.target.join(' ')})`)
        );

        // Known and inherited: Video.js names its time toggle "Show remaining time, 4 seconds elapsed." while the
        // counter shows 0:04, which axe reads as a label that leaves out its visible text. Everything else must be clean.
        expect(found.filter((entry) => !entry.includes('label-content-name-mismatch (.rl-counter)'))).toEqual([]);
      };

      await scan('at rest');
      await controls(page).lever.click();
      await expect.poll(() => state(page).then((s) => s.paused)).toBe(false);
      await scan('playing');

      if (width >= 420) {
        await controls(page).drawer.click();
        await expect(controls(page).menu).toHaveAttribute('data-open', '');
        await scan('drawer open');
      }
    });
  }
});
