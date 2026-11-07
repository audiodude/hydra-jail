import { readFile } from 'node:fs/promises';
import { test, expect, openApp, setCode } from './fixtures.js';

// Counts encoder use and samples the centre pixel of every encoded frame (r+g+b+a).
function instrumentEncoder() {
  window.__configures = 0;
  window.__px = [];
  const canvas = new OffscreenCanvas(8, 8), g = canvas.getContext('2d');
  const { configure, encode } = VideoEncoder.prototype;
  VideoEncoder.prototype.configure = function (...a) { window.__configures++; return configure.apply(this, a); };
  VideoEncoder.prototype.encode = function (frame, ...a) {
    g.clearRect(0, 0, 8, 8);
    g.drawImage(frame, 0, 0, 8, 8);
    const d = g.getImageData(4, 4, 1, 1).data;
    window.__px.push(d[0] + d[1] + d[2] + d[3]);
    return encode.call(this, frame, ...a);
  };
}

async function render(page, secs) {
  await page.fill('#render-secs', String(secs));
  const download = page.waitForEvent('download');
  await page.click('#render');
  return download;
}

// The mp4's colour boxes: `colr` (nclx) for every track, `vpcC` for VP9.
function colourInfo(bytes) {
  const c = bytes.indexOf('colrnclx'), v = bytes.indexOf('vpcC');
  return {
    matrix: bytes.readUInt16BE(c + 12),
    fullRange: bytes[c + 14] >> 7,
    vp9: v < 0 ? null : { profile: bytes[v + 8], bitDepth: bytes[v + 10] >> 4 },
  };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(instrumentEncoder);
  await openApp(page);
});

test('renders an H.264 mp4 with one frame per 1/60 s', async ({ page }) => {
  const download = await render(page, 0.5);
  expect(download.suggestedFilename()).toMatch(/^untitled-[\d-]+\.mp4$/);
  const bytes = await readFile(await download.path());
  expect(bytes.includes('ftyp')).toBe(true);
  expect(bytes.includes('avc1')).toBe(true);
  // Limited range: players that ignore the full-range flag (VLC) would stretch full range, crushing darks.
  expect(colourInfo(bytes)).toEqual({ matrix: 1, fullRange: 0, vp9: null });
  expect(await page.evaluate(() => window.__px.length)).toBe(30);
  await expect(page.locator('#render')).toHaveText('⏵ Render');
  await expect(page.locator('#record')).toBeEnabled();
});

test('10-bit renders VP9 profile 2, and the choice survives a reload', async ({ page }) => {
  await page.selectOption('#render-depth', '10');
  const download = await render(page, 0.5);
  expect(download.suggestedFilename()).toMatch(/\.mp4$/);
  expect(colourInfo(await readFile(await download.path()))).toEqual({ matrix: 1, fullRange: 0, vp9: { profile: 2, bitDepth: 10 } });
  expect(await page.evaluate(() => window.__px.length)).toBe(30);
  await page.reload();
  await expect(page.locator('#render-depth')).toHaveValue('10');
});

test('translucent output renders as it looks live', async ({ page }) => {
  // Hydra leaves (77, 0, 0, 128) in its premultiplied canvas, which the page shows as red 77.
  // Un-premultiplying it would brighten the render to red 154.
  await setCode(page, 'solid(0.3, 0, 0, 0.5).out()');
  await page.click('#run');
  await render(page, 0.1);
  const px = await page.evaluate(() => window.__px[0]); // r+g+b+a of the centre pixel
  expect(px).toBeGreaterThan(77 + 255 - 15);
  expect(px).toBeLessThan(77 + 255 + 15);
});

test('a second click cancels instead of starting another render', async ({ page }) => {
  await page.fill('#render-secs', '1');
  await page.evaluate(() => { const b = document.getElementById('render'); b.click(); b.click(); });
  await expect(page.locator('#status')).toHaveText('render cancelled');
  // The cancelled job may configure its encoder before it checks for cancellation, but encodes nothing.
  expect(await page.evaluate(() => window.__configures)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => window.__px.length)).toBe(0);
  await expect(page.locator('#render')).toHaveText('⏵ Render');
});

for (const [secs, message] of [[301, /capped at 300 s/], [0.001, /at least one frame/], [0, /positive number/]]) {
  test(`rejects a ${secs} s render`, async ({ page }) => {
    await page.fill('#render-secs', String(secs));
    await page.click('#render');
    await expect(page.locator('#status')).toHaveText(message);
    await expect(page.locator('#render')).not.toHaveClass(/on/);
    expect(await page.evaluate(() => window.__configures)).toBe(0);
  });
}

// Brightness follows `time`, so every drawn frame differs from the one before.
for (const [fps, hold] of [[undefined, 1], [30, 2], [20, 3]]) {
  test(`fps = ${fps} renders each drawn frame ${hold}x, from the first frame`, async ({ page }) => {
    await setCode(page, `fps = ${fps}; solid(() => (time * 4) % 1, 0, 0).out()`);
    await page.click('#run');
    await render(page, 0.5);
    const px = await page.evaluate(() => window.__px);
    expect(px).toHaveLength(30);
    for (let i = 0; i < px.length; i++) {
      if (i % hold) expect(px[i], `frame ${i} repeats its group`).toBe(px[i - 1]);
      else if (i) expect(px[i], `frame ${i} is a new draw`).not.toBe(px[i - 1]);
    }
    expect(px[0], 'first frame is drawn, not blank').toBeGreaterThan(255); // alpha alone is 255
  });
}

test('p5 instances replaced mid-render follow the render, not the wall clock', async ({ page }) => {
  await setCode(page, `window.cnt = { a: 0, b: 0, c: 0 };
pa = new p5(s => { s.setup = () => s.createCanvas(10, 10).hide(); s.draw = () => cnt.a++ });
pb = new p5(s => { s.setup = () => { s.createCanvas(10, 10).hide(); s.noLoop() }; s.draw = () => cnt.b++ });
osc().out()`);
  await page.click('#run');
  await expect.poll(() => page.evaluate(() => cnt.a)).toBeGreaterThan(0);
  const download = render(page, 1);
  await expect(page.locator('#render')).toHaveText(/⏹/);
  // The README's re-run pattern, done mid-render.
  await page.evaluate(() => {
    pa.remove();
    window.removedA = pa;
    window.aAtRemove = cnt.a;
    pc = new p5(s => { s.setup = () => s.createCanvas(10, 10).hide(); s.draw = () => cnt.c++ });
  });
  await download;
  const r = await page.evaluate(() => ({
    aAfterRemove: cnt.a - aAtRemove, b: cnt.b, aLooping: removedA.isLooping(), cLooping: pc.isLooping(), c: cnt.c,
  }));
  expect(r.b, 'a sketch stopped with noLoop() stays stopped').toBe(1);
  expect(r.aAfterRemove, 'a removed instance never draws again').toBe(0);
  expect(r.aLooping, 'a removed instance is not restarted').toBe(false);
  expect(r.cLooping, 'a new instance resumes looping after the render').toBe(true);
  expect(r.c, 'the new instance drew during the render').toBeGreaterThan(1);
});
