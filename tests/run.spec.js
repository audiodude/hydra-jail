import { test, expect, openApp, setCode } from './fixtures.js';

const status = (page) => page.locator('#status');

test('a syntax error shows in the status bar', async ({ page }) => {
  await openApp(page);
  await setCode(page, 'osc(');
  await page.click('#run');
  await expect(status(page)).toHaveText(/SyntaxError/);
  await expect(status(page)).toHaveClass('err');
});

// Hydra swallows these and only logs them; they surface once a frame is drawn with the new code.
for (const [what, code, message] of [
  ['an arrow-function argument', 'osc(() => nope.x).out()', 'nope is not defined'],
  ['update', 'osc().out(); update = () => { boom() }', 'boom is not defined'],
  ['a p5 draw', `p = new p5(s => { s.setup = () => s.createCanvas(10, 10).hide(); s.draw = () => s.zzz() })`, 's.zzz is not a function'],
]) {
  test(`an error in ${what} shows in the status bar`, async ({ page }) => {
    await openApp(page);
    await setCode(page, code);
    await page.click('#run');
    await expect(status(page)).toHaveText(`runtime error: ${message}`);
    await expect(status(page)).toHaveClass('err');
  });
}

test('audio sketches run silently with the mic off', async ({ page }) => {
  await openApp(page);
  await setCode(page, `a.setBins(8); a.setSmooth(0.8); a.onBeat = () => {};
osc(() => 10 + 20 * a.fft[7]).scale(a0(0.5, 1)).out(); update = () => { window.__fft = a.fft.slice() }`);
  await page.click('#run');
  await expect.poll(() => page.evaluate(() => window.__fft)).toEqual(Array(8).fill(0));
  await expect(status(page)).not.toHaveClass('err');
  await expect(page.locator('#mic')).toHaveText('mic off');
});

test('open in Hydra passes the code in a URL hydra.ojack.xyz decodes back to it', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => { window.open = (url) => { window.__opened = url; }; });
  const code = 'osc(10, 0.1, 1.2).out() // ünïcode ✓ & ?=+/';
  await setCode(page, code);
  await page.click('#open-hydra');
  const url = new URL(await page.evaluate(() => window.__opened));
  expect(url.origin + url.pathname).toBe('https://hydra.ojack.xyz/');
  expect(decodeURIComponent(atob(url.searchParams.get('code')))).toBe(code);
});
