import { expect, type Locator, type Page } from '@playwright/test';

/** What the tests read from the player store. */
export interface PlayerState {
  paused: boolean;
  ended: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  playbackRate: number;
  isFullscreen: boolean;
  subtitlesShowing: boolean;
}

export interface MarbleState {
  x: number;
  v: number;
  turn: number;
  mode: 'follow' | 'drag' | 'glide';
}

export const FILM_SECONDS = 30;

/** The fixture's query: muted, so every engine lets it play, and the flat skin unless the test names a machine. */
export function fixtureUrl(query = ''): string {
  // 3D depends on the GPU of whatever runs the tests; the tests of the machine itself ask for it by name.
  return `/?muted&${/(^|&)machine=/.test(query) ? '' : 'machine=flat&'}${query}`;
}

/** Open the fixture and wait until the film's length is known. */
export async function openPlayer(page: Page, query = ''): Promise<void> {
  await page.goto(fixtureUrl(query));
  await page.waitForFunction(() => {
    const player = document.querySelector('video-player') as (HTMLElement & { store?: { duration: number } }) | null;
    return (player?.store?.duration ?? 0) > 0;
  });
}

export function state(page: Page): Promise<PlayerState> {
  return page.evaluate(() => {
    const { store } = document.querySelector('video-player') as unknown as { store: PlayerState };
    const { paused, ended, currentTime, duration, volume, muted, playbackRate, isFullscreen, subtitlesShowing } = store;
    return { paused, ended, currentTime, duration, volume, muted, playbackRate, isFullscreen, subtitlesShowing };
  });
}

export function marble(page: Page): Promise<MarbleState> {
  return page.evaluate(() => ({ ...(document.querySelector('rolling-rail') as unknown as { marble: MarbleState }).marble }));
}

/** Wait until the film has finished seeking. */
export async function seekSettled(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const { store } = document.querySelector('video-player') as unknown as { store: { seeking: boolean } };
    return !store.seeking;
  });
}

/** Wait for the marble to come to rest on the playhead. */
export async function marbleAtRest(page: Page): Promise<MarbleState> {
  await expect
    .poll(
      async () => {
        const [m, s] = await Promise.all([marble(page), state(page)]);
        return m.mode === 'follow' && Math.abs(m.v) < 0.01 && Math.abs(m.x - s.currentTime / s.duration) < 0.02;
      },
      { timeout: 8000 }
    )
    .toBe(true);
  return marble(page);
}

export const controls = (page: Page) => ({
  player: page.locator('media-container'),
  dock: page.locator('.rl-dock'),
  rail: page.locator('.rl-slider'),
  marble: page.getByRole('slider', { name: 'Seek' }),
  lever: page.locator('#rl-play'),
  back: page.locator('#rl-back'),
  forward: page.locator('#rl-fwd'),
  counter: page.locator('.rl-counter'),
  duration: page.locator('.rl-duration'),
  horn: page.locator('#rl-mute'),
  shutters: page.locator('.rl-shutters'),
  volume: page.locator('.rl-shutters-knob'),
  jack: page.locator('#rl-rate'),
  tapeKey: page.locator('#rl-cc'),
  locket: page.locator('#rl-pip'),
  drawer: page.locator('#rl-settings'),
  menu: page.locator('#rl-menu'),
  cord: page.locator('#rl-fs'),
});

/** The focus ring must be drawn on the control itself or, for the marble, on the ball inside it. */
export async function expectFocusRing(target: Locator): Promise<void> {
  const ring = await target.evaluate((element) => {
    const drawn = element.querySelector('.rl-ball') ?? element;
    const style = getComputedStyle(drawn);
    return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth), shadow: style.boxShadow };
  });

  expect(ring.style, 'focus outline style').not.toBe('none');
  expect(ring.width, 'focus outline width').toBeGreaterThanOrEqual(2);
  // Second tone: a dark ring outside the light one, so it shows on walnut and on maple.
  expect(ring.shadow, 'two-tone ring').not.toBe('none');
}

/** Fail the test on any page error or console error. Call first; check with the returned function. */
export function watchConsole(page: Page): () => void {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  return () => expect(problems, 'console and page errors').toEqual([]);
}
