import { defineConfig, devices } from '@playwright/test';

const PORT = 5180;

// The skin is tested in the three engines against tests/fixture (local media, no network).
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // The flick tests time real pointer events; too many browsers at once stretches the gaps between them.
  workers: 4,
  reporter: [['list']],
  timeout: 30_000,
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  webServer: {
    command: `npx vite --config tests/fixture/vite.config.ts --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /touch\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
      },
    },
    {
      name: 'firefox',
      testIgnore: /touch\.spec\.ts/,
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: { firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0 } },
      },
    },
    { name: 'webkit', testIgnore: /touch\.spec\.ts/, use: { ...devices['Desktop Safari'] } },
    // A phone: coarse pointer, touch input, a player 380px wide.
    { name: 'touch', testMatch: /touch\.spec\.ts/, use: { ...devices['Pixel 7'] } },
  ],
});
