import { readFile } from 'node:fs/promises';
import { test, expect, DIST, openApp, setCode, renderFile } from './fixtures.js';

test('the build is one self-contained file', async () => {
  const html = await readFile(new URL('index.html', DIST), 'utf8');
  expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=/); // everything inlined
});

test('Ubuntu Mono is bundled and used by the editor', async ({ page }) => {
  await openApp(page);
  const font = await page.evaluate(() => getComputedStyle(document.querySelector('.CodeMirror')).fontFamily);
  expect(font).toMatch(/^"Ubuntu Mono"/);
  // All three bundled faces load (CodeMirror's CSS uses bold and italic for some tokens).
  const loaded = await page.evaluate(async () => {
    await Promise.all(['400 17px', 'bold 17px', 'italic 17px'].map((f) => document.fonts.load(`${f} "Ubuntu Mono"`)));
    return [...document.fonts].filter((f) => f.family.includes('Ubuntu Mono') && f.status === 'loaded').length;
  });
  expect(loaded).toBe(3);
});

// The point of the single file: download it and open it, no server.
test('works opened from file://', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(new URL('index.html', DIST).href);
  await page.locator('.CodeMirror').waitFor();
  await setCode(page, 'solid(1, 0, 0).out()');
  await page.click('#run');
  await expect(page.locator('#status')).toHaveText(/^ran at/);
  const file = await renderFile(page, 0.2);
  expect(file.name).toMatch(/\.mp4$/);
  expect(file.bytes.length).toBeGreaterThan(1000);
  expect(errors).toEqual([]);
});
