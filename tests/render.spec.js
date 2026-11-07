import { test, expect, openApp, setCode, renderFile } from './fixtures.js';

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

// Width and height from the track's sample entry (avc1/vp09), after `stsd`: ftyp also names avc1 as a brand.
function videoSize(bytes) {
  const e = bytes.indexOf('stsd') + 16; // stsd header (12) + entry size (4) → entry type
  return { codec: bytes.toString('latin1', e, e + 4), width: bytes.readUInt16BE(e + 28), height: bytes.readUInt16BE(e + 30) };
}

test('renders an H.264 mp4 with one frame per 1/60 s, saved to the picked file', async ({ page }) => {
  const file = await renderFile(page, 0.5);
  expect(file.name).toMatch(/^untitled-[\d-]+\.mp4$/);
  await expect(page.locator('#status')).toHaveText(`saved ${file.name}`);
  expect(file.bytes.includes('ftyp')).toBe(true);
  expect(videoSize(file.bytes)).toEqual({ codec: 'avc1', width: 1920, height: 1080 });
  // Limited range: players that ignore the full-range flag (VLC) would stretch full range, crushing darks.
  expect(colourInfo(file.bytes)).toEqual({ matrix: 1, fullRange: 0, vp9: null });
  expect(await page.evaluate(() => window.__px.length)).toBe(30);
});

test('10-bit renders VP9 profile 2, and the choice survives a reload', async ({ page }) => {
  await page.selectOption('#render-depth', '10');
  const file = await renderFile(page, 0.5);
  expect(colourInfo(file.bytes)).toEqual({ matrix: 1, fullRange: 0, vp9: { profile: 2, bitDepth: 10 } });
  expect(await page.evaluate(() => window.__px.length)).toBe(30);
  await page.reload();
  await expect(page.locator('#render-depth')).toHaveValue('10');
});

test('4K renders at 3840×2160, then the live canvas goes back to 1080p', async ({ page }) => {
  await page.selectOption('#render-size', '2160');
  const file = await renderFile(page, 0.1);
  expect(videoSize(file.bytes)).toEqual({ codec: 'avc1', width: 3840, height: 2160 });
  expect(await page.evaluate(() => [document.getElementById('hydra').width, document.getElementById('hydra').height])).toEqual([1920, 1080]);
});

test('4K is greyed out where it can\'t render, and comes back when it can', async ({ page }) => {
  // An encoder with no 10-bit 4K, and a saved 10-bit 4K choice.
  await page.addInitScript(() => {
    const real = VideoEncoder.isConfigSupported.bind(VideoEncoder);
    VideoEncoder.isConfigSupported = (c) => (c.width === 3840 && c.codec.startsWith('vp09.02') ? Promise.resolve({ supported: false }) : real(c));
  });
  await page.evaluate(() => { localStorage.setItem('hydra-jail:render-size', '2160'); localStorage.setItem('hydra-jail:render-depth', '10'); });
  await page.reload();
  const fourK = page.locator('#render-size option[value="2160"]');
  await expect(fourK).toBeDisabled();
  await expect(page.locator('#render-size')).toHaveValue('1080');
  await page.selectOption('#render-depth', '8');
  await expect(fourK).toBeEnabled();
  await expect(page.locator('#render-size'), 'the saved 4K choice returns').toHaveValue('2160');
  await page.selectOption('#render-depth', '10');
  await expect(fourK).toBeDisabled();
  await expect(page.locator('#render-size')).toHaveValue('1080');
});

test('translucent output renders as it looks live', async ({ page }) => {
  // Hydra leaves (77, 0, 0, 128) in its premultiplied canvas, which the page shows as red 77.
  // Un-premultiplying it would brighten the render to red 154.
  await setCode(page, 'solid(0.3, 0, 0, 0.5).out()');
  await page.click('#run');
  await renderFile(page, 0.1);
  const px = await page.evaluate(() => window.__px[0]); // r+g+b+a of the centre pixel
  expect(px).toBeGreaterThan(77 + 255 - 15);
  expect(px).toBeLessThan(77 + 255 + 15);
});

test('a second click cancels, and the partial file is discarded', async ({ page }) => {
  await page.fill('#render-secs', '1');
  await page.evaluate(() => { const b = document.getElementById('render'); b.click(); b.click(); });
  await expect(page.locator('#status')).toHaveText('render cancelled');
  // The cancelled job may configure its encoder before it checks for cancellation, but encodes nothing.
  expect(await page.evaluate(() => window.__configures)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => window.__px.length)).toBe(0);
  // Nothing committed, and the new empty file the picker created is deleted.
  expect(await page.evaluate(() => [window.__saved, window.__aborted, window.__removed])).toEqual([null, 1, 1]);
  await expect(page.locator('#render')).toHaveText('⏵ Render');
});

test('closing the save dialog cancels before anything is encoded', async ({ page }) => {
  await page.evaluate(() => { window.__dismissPicker = true; });
  expect(await renderFile(page, 1)).toBeNull();
  await expect(page.locator('#status')).toHaveText('render cancelled');
  expect(await page.evaluate(() => window.__configures)).toBe(0);
});

for (const [secs, message] of [[0.001, /at least one frame/], [0, /positive number/]]) {
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
    await renderFile(page, 0.5);
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
  const done = renderFile(page, 1);
  await expect(page.locator('#render')).toHaveText(/⏹/);
  // The README's re-run pattern, done mid-render.
  await page.evaluate(() => {
    pa.remove();
    window.removedA = pa;
    window.aAtRemove = cnt.a;
    pc = new p5(s => { s.setup = () => s.createCanvas(10, 10).hide(); s.draw = () => cnt.c++ });
  });
  await done;
  const r = await page.evaluate(() => ({
    aAfterRemove: cnt.a - aAtRemove, b: cnt.b, aLooping: removedA.isLooping(), cLooping: pc.isLooping(), c: cnt.c,
  }));
  expect(r.b, 'a sketch stopped with noLoop() stays stopped').toBe(1);
  expect(r.aAfterRemove, 'a removed instance never draws again').toBe(0);
  expect(r.aLooping, 'a removed instance is not restarted').toBe(false);
  expect(r.cLooping, 'a new instance resumes looping after the render').toBe(true);
  expect(r.c, 'the new instance drew during the render').toBeGreaterThan(1);
});
