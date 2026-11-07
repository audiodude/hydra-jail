import { test, expect, openApp } from './fixtures.js';

// Opens the app with the utilities view showing.
async function openUtilities(page) {
  await openApp(page);
  await page.click('#toggle-utilities');
  await expect(page.locator('#utilities')).toBeVisible();
}

test('the activity bar shows one view at a time, and clicking the open one closes the sidebar', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#explorer')).toBeVisible(); // the default
  await page.click('#toggle-utilities');
  await expect(page.locator('#utilities')).toBeVisible();
  await expect(page.locator('#explorer')).toBeHidden();
  await expect(page.locator('#toggle-utilities')).toHaveClass(/on/);
  await expect(page.locator('#toggle-explorer')).not.toHaveClass(/on/);
  await page.click('#toggle-utilities');
  await expect(page.locator('#utilities')).toBeHidden();
  await expect(page.locator('#explorer')).toBeHidden();
  await page.keyboard.press('Control+b');
  await expect(page.locator('#explorer')).toBeVisible();
});

test('the open view is remembered across reloads', async ({ page }) => {
  await openUtilities(page);
  await page.reload();
  await expect(page.locator('#utilities')).toBeVisible();
  await expect(page.locator('#explorer')).toBeHidden();
});

test('saving from the utilities view switches to the explorer to name the sketch', async ({ page }) => {
  await openUtilities(page);
  await page.keyboard.press('Control+s');
  await expect(page.locator('#sketch-list input')).toBeFocused();
  await expect(page.locator('#utilities')).toBeHidden();
});

for (const [input, expected] of [
  ['#ff8000', '1, 0.502, 0, 1'],
  ['#FF800080', '1, 0.502, 0, 0.502'],
  ['#f80', '1, 0.533, 0, 1'],
  ['f808', '1, 0.533, 0, 0.533'],
  [' #00000000 ', '0, 0, 0, 0'],
  ['rgba(207, 108, 38, 0.5)', '0.812, 0.424, 0.149, 0.5'],
  ['rgb(255 0 51 / 25%)', '1, 0, 0.2, 0.25'],
  ['RGB(0,0,0)', '0, 0, 0, 1'],
]) {
  test(`${JSON.stringify(input)} converts to ${expected}`, async ({ page }) => {
    await openUtilities(page);
    await page.fill('#color-hex', input);
    await expect(page.locator('#color-out')).toHaveText(expected);
    await expect(page.locator('#color-hex')).not.toHaveClass(/invalid/);
    await expect(page.locator('#copy-color')).toBeEnabled();
  });
}

for (const input of ['#f', '#ff800', '#gg0000', 'red', 'rgb(256, 0, 0)', 'rgba(0, 0, 0, 2)', 'rgb(1, 2)']) {
  test(`${JSON.stringify(input)} is rejected`, async ({ page }) => {
    await openUtilities(page);
    await page.fill('#color-hex', input);
    await expect(page.locator('#color-out')).toHaveText('');
    await expect(page.locator('#color-hex')).toHaveClass(/invalid/);
    await expect(page.locator('#copy-color')).toBeDisabled();
  });
}

test('copy puts the color() call on the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openUtilities(page);
  await page.fill('#color-hex', '#ff8000');
  await page.click('#copy-color');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('1, 0.502, 0, 1');
});

test('the eyedropper fills in the picked color; dismissing it changes nothing', async ({ page, context }) => {
  // The real picker is a native overlay Playwright can't drive. Chrome's returns rgba(), despite the name.
  await context.addInitScript(() => {
    window.EyeDropper = class { open() { return window.__cancelPick ? Promise.reject(new DOMException('', 'AbortError')) : Promise.resolve({ sRGBHex: 'rgba(51, 102, 153, 1)' }); } };
  });
  await openUtilities(page);
  await page.click('#eyedropper');
  await expect(page.locator('#color-hex')).toHaveValue('rgba(51, 102, 153, 1)');
  await expect(page.locator('#color-out')).toHaveText('0.2, 0.4, 0.6, 1');
  await page.evaluate(() => { window.__cancelPick = true; });
  await page.click('#eyedropper');
  await expect(page.locator('#color-hex')).toHaveValue('rgba(51, 102, 153, 1)');
  await expect(page.locator('#status')).not.toHaveClass(/err/);
});

test('clicking the rainbow picks the color under the pointer', async ({ page }) => {
  await openUtilities(page);
  const box = await page.locator('#rainbow').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + 1); // top row, middle column: pure red
  await expect(page.locator('#color-hex')).toHaveValue(/^rgb\(2[45]\d, [0-9], [0-9]\)$/);
  await page.mouse.click(box.x + 1, box.y + box.height / 2); // left column: near white
  await expect(page.locator('#color-hex')).toHaveValue(/^rgb\(2[45]\d, 2[45]\d, 2[45]\d\)$/);
  await expect(page.locator('#color-out')).toHaveText(/^(1|0\.9\d*), (1|0\.9\d*), (1|0\.9\d*), 1$/);
});

test('without EyeDropper support the button is disabled', async ({ page, context }) => {
  await context.addInitScript(() => { delete window.EyeDropper; });
  await openUtilities(page);
  await expect(page.locator('#eyedropper')).toBeDisabled();
});
