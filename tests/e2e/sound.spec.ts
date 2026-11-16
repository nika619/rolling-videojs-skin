import { expect, test, type Page } from '@playwright/test';

import { openPlayer, state } from './helpers';

/** What the machine has played, by voice. */
function played(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => ({ ...(document.querySelector('rolling-sound') as HTMLElement & { played: Record<string, number> }).played }));
}

test.describe('the machine sounds', () => {
  test.beforeEach(async ({ page }) => {
    // A fresh choice for each test, kept across the reload a test makes on purpose.
    await page.addInitScript(() => {
      if (sessionStorage.getItem('rolling-test')) return;
      sessionStorage.setItem('rolling-test', '1');
      localStorage.removeItem('rolling-sound');
    });
  });

  /** Playwright's WebKit on Windows has no Web Audio (Safari has): there the machine stays silent, without errors. */
  async function skipWithoutAudio(page: Page): Promise<void> {
    test.skip(!(await page.evaluate(() => 'AudioContext' in window)), 'This browser build has no Web Audio.');
  }

  test('silent until a hand touches the player, silent while muted, then each action has its own voice', async ({ page }) => {
    await openPlayer(page); // the fixture opens muted
    await skipWithoutAudio(page);
    await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).play());
    await expect.poll(async () => (await state(page)).paused).toBe(false);
    expect(await played(page)).toEqual({});

    await page.locator('#rl-play').click(); // a gesture, but the film is muted: still nothing
    expect(await played(page)).toEqual({});

    await page.locator('#rl-mute').click(); // the cork comes out
    await expect.poll(async () => (await state(page)).muted).toBe(false);
    await expect.poll(async () => (await played(page)).pop ?? 0).toBe(1);

    await page.locator('#rl-play').click();
    await expect.poll(async () => (await played(page)).lever ?? 0).toBe(1);
    await page.locator('#rl-rate').click();
    await expect.poll(async () => (await played(page)).ratchet ?? 0).toBe(1);
    expect((await played(page)).die).toBe(1);
  });

  test('the drawer switch silences the machine, and the choice is remembered', async ({ page }) => {
    await openPlayer(page);
    await skipWithoutAudio(page);
    await page.locator('#rl-mute').click();
    await expect.poll(async () => (await played(page)).pop ?? 0).toBe(1);

    await page.locator('#rl-settings').click();
    const item = page.locator('.rl-sound-item');
    await expect(item).toHaveAttribute('aria-checked', 'true');
    await item.click();
    await expect(item).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Escape');

    await page.locator('#rl-rate').click();
    await expect.poll(async () => (await state(page)).playbackRate).not.toBe(1);
    expect((await played(page)).ratchet).toBeUndefined();

    await page.reload();
    await page.locator('#rl-settings').click();
    await expect(page.locator('.rl-sound-item')).toHaveAttribute('aria-checked', 'false');
  });
});
