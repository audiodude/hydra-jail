import { test as base, expect } from '@playwright/test';

export const DIST = new URL('../dist/', import.meta.url); // built by `npm test` (vite build) before the run
const APP = 'http://localhost:8642/';
const BLANK = '__blank'; // empty same-origin page, for seeding storage before the app loads

// The built app is served from dist/; it should be fully self-contained, so any other
// request (a CDN, a font) is aborted and fails the test.
// Stands in for the native save dialog, which Playwright can't drive. A render's file is kept in memory:
// window.__saved = { name, bytes } once committed; __aborted / __removed count discarded and deleted files.
// Set window.__dismissPicker to act as if the dialog was closed.
function fakeSavePicker() {
  window.__saved = null;
  window.__aborted = 0;
  window.__removed = 0;
  window.showSaveFilePicker = async ({ suggestedName: name }) => {
    if (window.__dismissPicker) throw new DOMException('dismissed', 'AbortError');
    return {
      name,
      getFile: async () => new Blob([]), // a new, empty file
      remove: async () => { window.__removed++; },
      createWritable: async () => {
        let buf = new Uint8Array(1 << 20), len = 0;
        return {
          async write({ data, position }) {
            const bytes = new Uint8Array(data.buffer ?? data, data.byteOffset ?? 0, data.byteLength);
            if (position + bytes.length > buf.length) {
              const bigger = new Uint8Array(Math.max(buf.length * 2, position + bytes.length));
              bigger.set(buf);
              buf = bigger;
            }
            buf.set(bytes, position);
            len = Math.max(len, position + bytes.length);
          },
          async close() { window.__saved = { name, bytes: buf.slice(0, len) }; },
          async abort() { window.__aborted++; },
        };
      },
    };
  };
}

// The built app is served from dist/; it should be fully self-contained, so any other
// request (a CDN, a font) is aborted and fails the test.
export const test = base.extend({
  context: async ({ context }, use) => {
    await context.addInitScript(fakeSavePicker);
    const external = [];
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith(DIST.href)) return route.continue(); // build.spec.js opening dist/ from file://
      if (!url.startsWith(APP)) {
        external.push(url);
        return route.abort();
      }
      const path = decodeURIComponent(new URL(url).pathname.slice(1)) || 'index.html';
      if (path === BLANK) return route.fulfill({ contentType: 'text/html', body: '' });
      return route.fulfill({ path: new URL(path, DIST).pathname });
    });
    await use(context);
    expect(external, 'the built app made requests outside itself').toEqual([]);
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

// Starts a render of `secs` seconds and waits for it to finish. Returns the saved file, or null if none was.
export async function renderFile(page, secs) {
  await page.fill('#render-secs', String(secs));
  await page.click('#render');
  await expect(page.locator('#render')).not.toHaveClass(/on/, { timeout: 60_000 }); // set until the render ends
  const saved = await page.evaluate(() => window.__saved && { name: __saved.name, bytes: Array.from(__saved.bytes) });
  return saved && { name: saved.name, bytes: Buffer.from(saved.bytes) };
}
