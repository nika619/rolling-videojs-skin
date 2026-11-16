import { expect, test, type Locator, type Page } from '@playwright/test';

import { openPlayer, state, watchConsole } from './helpers';

/** What the caption tape shows, and the lip it runs in. */
function tape(page: Page) {
  return page.evaluate(() => {
    const element = document.querySelector('rolling-tape') as (HTMLElement & { text: string }) | null;
    const ink = element?.querySelector('.rl-tape-ink');
    return {
      showing: element?.hasAttribute('data-showing') ?? false,
      text: element?.text ?? '',
      ink: ink?.textContent ?? '',
      printing: ink?.getAnimations().length ?? 0,
      lip: (document.querySelector('.rl-lip') as HTMLElement).offsetHeight,
      paperVisible: !!element?.querySelector('.rl-tape-paper')?.checkVisibility(),
    };
  });
}

type Shot = Awaited<ReturnType<Locator['screenshot']>>;

/** The share of pixels that differ clearly between two screenshots of the same size. A cue box changes several percent. */
function changedShare(page: Page, a: Shot, b: Shot): Promise<number> {
  return page.evaluate(async ([a, b]) => {
    const pixels = async (base64: string) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = Object.assign(document.createElement('canvas'), { width: image.width, height: image.height });
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, image.width, image.height).data;
    };
    const [x, y] = await Promise.all([pixels(a), pixels(b)]);
    let changed = 0;
    for (let i = 0; i < x.length; i += 4) {
      if (Math.max(Math.abs(x[i] - y[i]), Math.abs(x[i + 1] - y[i + 1]), Math.abs(x[i + 2] - y[i + 2])) > 24) changed++;
    }
    return changed / (x.length / 4);
  }, [a.toString('base64'), b.toString('base64')]);
}

async function seekTo(page: Page, seconds: number): Promise<void> {
  await page.evaluate((t) => {
    (document.querySelector('video') as HTMLVideoElement).currentTime = t;
  }, seconds);
  await expect.poll(async () => Math.abs((await state(page)).currentTime - seconds)).toBeLessThan(0.3);
}

test.describe('the caption tape', () => {
  test('captions print on the tape under the picture, and the lip closes when they go off', async ({ page }) => {
    const errors = watchConsole(page);
    await openPlayer(page);
    const before = await tape(page);
    expect(before.showing).toBe(false);
    expect(before.paperVisible).toBe(false);

    await page.locator('#rl-cc').click();
    await expect.poll(async () => (await state(page)).subtitlesShowing).toBe(true);
    await seekTo(page, 5);
    await expect.poll(async () => (await tape(page)).text).toBe('The marble is the playhead.');
    const on = await tape(page);
    expect(on.showing).toBe(true);
    expect(on.ink).toBe('The marble is the playhead.');
    expect(on.paperVisible).toBe(true);
    expect(on.lip).toBeGreaterThan(before.lip);

    // A gap between cues leaves the paper blank, not the old words.
    await seekTo(page, 9.5);
    await expect.poll(async () => (await tape(page)).text).toBe('');

    await page.locator('#rl-cc').click();
    await expect.poll(async () => (await tape(page)).showing).toBe(false);
    expect((await tape(page)).lip).toBe(before.lip);
    errors();
  });

  test('the browser draws no cue box of its own over the film', async ({ page }) => {
    await openPlayer(page);
    await seekTo(page, 5);
    const film = page.locator('video');
    const without = await film.screenshot();
    await page.locator('#rl-cc').click();
    await expect.poll(async () => (await tape(page)).text).toBe('The marble is the playhead.');
    // The tape opened the lip, so the film is where it was: the same paused frame, pixel for pixel, with captions on.
    await page.waitForTimeout(300);
    expect(await changedShare(page, without, await film.screenshot())).toBeLessThan(0.002);
  });

  test.describe('with reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('new words appear at once, without the printing sweep', async ({ page }) => {
      await openPlayer(page);
      await page.locator('#rl-cc').click();
      await seekTo(page, 5);
      await expect.poll(async () => (await tape(page)).text).toBe('The marble is the playhead.');
      expect((await tape(page)).printing).toBe(0);
    });
  });
});
