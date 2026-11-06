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
