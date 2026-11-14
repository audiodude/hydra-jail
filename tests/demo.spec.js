import { test, expect, openApp, setCode, KEY } from './fixtures.js';

const CODE = 'window.__ran = "ünïcode ✓ & ?=+/"; solid(1, 0, 0).out()';

// Clicks demo with `code` in the editor and returns the URL it opened.
async function demoLink(page, code) {
  await page.evaluate(() => { window.open = (url) => { window.__opened = url; }; });
  await setCode(page, code);
  await page.click('#demo');
  return page.evaluate(() => window.__opened);
}

test('demo opens just the canvas running the code, and leaves storage alone', async ({ page }) => {
  await openApp(page, { [KEY.buffer]: 'osc().out()', [KEY.sketches]: '{"a":"noise().out()"}', [KEY.current]: 'a' });
  const url = await demoLink(page, CODE);
  await page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.setValue('osc().out()')); // back to the stored buffer
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); // flush autosave
  const before = await page.evaluate(() => ({ ...localStorage }));

  await page.goto(url);
  await expect.poll(() => page.evaluate(() => window.__ran)).toBe('ünïcode ✓ & ?=+/');
  await expect(page.locator('.CodeMirror')).toHaveCount(0); // the editor never loads
  await expect(page.locator('#workbench')).toBeHidden();
  await expect(page.locator('#statusbar')).toBeHidden();
  const box = await page.locator('#hydra').boundingBox();
  const vp = page.viewportSize();
  expect(Math.min(vp.width - box.width, vp.height - box.height)).toBeLessThan(1); // fills the window one way
  // The canvas's WebGL buffer is cleared after compositing, so check what's on screen.
  const png = await page.screenshot({ clip: { x: box.x + box.width / 2, y: box.y + box.height / 2, width: 1, height: 1 } });
  const pixel = await page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const g = new OffscreenCanvas(1, 1).getContext('2d');
    g.drawImage(bmp, 0, 0);
    return [...g.getImageData(0, 0, 1, 1).data];
  }, png.toString('base64'));
  expect(pixel).toEqual([255, 0, 0, 255]);

  await page.goto('/'); // unloading the demo
  await page.locator('.CodeMirror').waitFor();
  expect(await page.evaluate(() => ({ ...localStorage }))).toEqual(before);
});

// hydra.ojack.xyz links: base64 '+' left unescaped (read back as a space).
test('a hydra.ojack.xyz ?code= link plays in the demo, unescaped + included', async ({ page }) => {
  const code = 'window.__ran = "abc~~~"; solid(0, 0, 1).out()';
  const b64 = Buffer.from(encodeURIComponent(code)).toString('base64');
  expect(b64).toContain('+');
  await page.goto(`/?code=${b64}`);
  await expect.poll(() => page.evaluate(() => window.__ran)).toBe('abc~~~');
});

test('a bad ?code= or a failing demo shows the error', async ({ page }) => {
  await page.goto('/?code=%%%');
  await expect(page.locator('#status')).toHaveText(/could not decode \?code=/);
  await expect(page.locator('#statusbar')).toBeVisible();

  await openApp(page);
  await page.goto(await demoLink(page, 'osc('));
  await expect(page.locator('#status')).toHaveText(/SyntaxError/);
});
