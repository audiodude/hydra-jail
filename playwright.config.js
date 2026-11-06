import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  expect: { timeout: 15_000 }, // headless WebGL can run at a few fps; per-frame effects take a while to show
  use: {
    // Installed Chrome, not Playwright's Chromium: the latter typically can't encode H.264.
    channel: 'chrome',
    // Intercepted by fixtures.js (nothing listens there), so tests never hit the network.
    // localhost, not a made-up host: WebCodecs only exists in secure contexts.
    baseURL: 'http://localhost:8642/',
  },
});
