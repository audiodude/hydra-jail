import { test as base, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const VENDOR = new URL('vendor/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', VENDOR), 'utf8'));
const APP = 'http://localhost:8642/';
const BLANK = '__blank'; // empty same-origin page, for seeding storage before the app loads
const STUBBED = ['https://fonts.googleapis.com/', 'https://fonts.gstatic.com/'];

// Every request is answered locally: the app from the repo, CDN URLs from tests/vendor/.
// Anything else is aborted and fails the test, so a library bump without `npm run vendor` is caught.
export const test = base.extend({
  context: async ({ context }, use) => {
    const unvendored = [];
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith(APP)) {
        const path = decodeURIComponent(new URL(url).pathname.slice(1)) || 'index.html';
        if (path === BLANK) return route.fulfill({ contentType: 'text/html', body: '' });
        return route.fulfill({ path: new URL(path, ROOT).pathname });
      }
      if (manifest[url]) {
        return route.fulfill({
          path: new URL(manifest[url], VENDOR).pathname,
          headers: { 'access-control-allow-origin': '*' }, // module scripts are fetched with CORS
        });
      }
      if (STUBBED.some((p) => url.startsWith(p))) return route.fulfill({ contentType: 'text/css', body: '' });
      unvendored.push(url);
      return route.abort();
    });
    await use(context);
    expect(unvendored, 'requests with no vendored copy; run `npm run vendor`').toEqual([]);
  },
});
export { expect };

export const KEY = {
  buffer: 'hydra-jail:code',
  sketches: 'hydra-jail:sketches',
  current: 'hydra-jail:current',
  running: 'hydra-jail:running',
};

// Loads the app, optionally seeding localStorage first. Seeds from a blank page, since unloading
// the app itself would autosave its buffer over the seed.
export async function openApp(page, storage = null) {
  if (storage) {
    await page.goto(BLANK);
    await page.evaluate((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, storage);
  }
  await page.goto('/');
  await page.locator('.CodeMirror').waitFor();
}

export const setCode = (page, code) =>
  page.evaluate((c) => document.querySelector('.CodeMirror').CodeMirror.setValue(c), code);
export const getCode = (page) =>
  page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getValue());
export const sketchNames = (page) => page.locator('#sketch-list li .name');

// Answers every confirm() and returns the messages seen.
export function answerDialogs(page, accept = true) {
  const seen = [];
  page.on('dialog', (d) => { seen.push(d.message()); accept ? d.accept() : d.dismiss(); });
  return seen;
}

// Ctrl+S (untitled) or Ctrl+Shift+S, then commit `name` in the inline input.
export async function saveAs(page, name, { shift = false } = {}) {
  await page.keyboard.press(shift ? 'Control+Shift+s' : 'Control+s');
  const input = page.locator('#sketch-list input');
  await input.fill(name);
  await input.press('Enter');
  await expect(input).toHaveCount(0);
}
