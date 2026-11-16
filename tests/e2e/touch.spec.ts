import { expect, test } from '@playwright/test';

import { controls, FILM_SECONDS, openPlayer, state, watchConsole } from './helpers';

test('before the film starts, a tap on the picture is the lever', async ({ page }) => {
  const noErrors = watchConsole(page);
  await openPlayer(page);
  const { player, lever } = controls(page);

  await expect(player).toHaveAttribute('data-tier', 's');
  await player.tap({ position: { x: 120, y: 70 } });
  await expect.poll(() => state(page).then((s) => s.paused)).toBe(false);

  await lever.tap();
  await expect.poll(() => state(page).then((s) => s.paused)).toBe(true);
  noErrors();
});

test('a tap on the rail rolls the marble there, and the horn takes a tap', async ({ page }) => {
  await openPlayer(page);
  const { rail, horn } = controls(page);
  const box = (await rail.boundingBox())!;

  await rail.tap({ position: { x: box.width * 0.5, y: box.height * 0.6 } });
  await expect.poll(() => state(page).then((s) => s.currentTime)).toBeGreaterThan(FILM_SECONDS * 0.5 - 2);
  expect((await state(page)).currentTime).toBeLessThan(FILM_SECONDS * 0.5 + 2);

  await horn.tap();
  await expect.poll(() => state(page).then((s) => s.muted)).toBe(false);
});

test('every control on the dock is big enough for a thumb', async ({ page }) => {
  await openPlayer(page);
  const sizes = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.rl-slider, .rl-bench .rl-key, .rl-counter')]
      .filter((el) => el.checkVisibility())
      .map((el) => {
        const box = el.getBoundingClientRect();
        return { name: el.id || el.className.split(' ')[0]!, width: box.width, height: box.height };
      })
  );

  expect(sizes.map((size) => size.name)).toEqual(['rl-slider', 'rl-play', 'rl-counter', 'rl-mute', 'rl-cc', 'rl-fs']);
  for (const size of sizes) {
    expect(size.width, `${size.name} width`).toBeGreaterThanOrEqual(44);
    expect(size.height, `${size.name} height`).toBeGreaterThanOrEqual(44);
  }
});
