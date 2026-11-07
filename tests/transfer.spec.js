import { readFile } from 'node:fs/promises';
import { test, expect, KEY, openApp, getCode, sketchNames } from './fixtures.js';

const MINE = { a: '// a', b: '// b mine', 'b (imported)': '// b older import' };

async function importFile(page, sketches, choice) {
  await page.locator('#import-file').setInputFiles({ name: 'in.json', mimeType: 'application/json', buffer: Buffer.from(typeof sketches === 'string' ? sketches : JSON.stringify(sketches)) });
  if (!choice) return;
  await expect(page.locator('#import-dialog')).toBeVisible();
  await page.locator(`#import-dialog button[value="${choice}"]`).click();
  await expect(page.locator('#import-dialog')).toBeHidden();
}
const stored = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY.sketches);

test('export downloads every saved sketch, and importing it back changes nothing', async ({ page }) => {
  await openApp(page, { [KEY.sketches]: JSON.stringify(MINE) });
  const download = page.waitForEvent('download');
  await page.click('#export-sketches');
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^hydra-jail-sketches-\d{4}-\d\d-\d\d\.json$/);
  const text = await readFile(await file.path(), 'utf8');
  expect(JSON.parse(text)).toEqual(MINE);
  await importFile(page, text, 'merge');
  expect(await stored(page)).toEqual(MINE);
  await expect(page.locator('#status')).toHaveText(/0 added, 0 renamed .* 3 already here/);
});

test('merge adds new names, keeps clashing ones as "(imported N)", and skips identical copies', async ({ page }) => {
  await openApp(page, { [KEY.sketches]: JSON.stringify(MINE) });
  await importFile(page, { a: '// a', b: '// b theirs', ' c ': '// c', '': '// nameless' }, 'merge');
  expect(await stored(page)).toEqual({ ...MINE, 'b (imported 2)': '// b theirs', c: '// c' });
  await expect(sketchNames(page)).toHaveText(['a', 'b', 'b (imported 2)', 'b (imported)', 'c']); // the explorer's localeCompare order
  await expect(page.locator('#status')).toHaveText(/1 added, 1 renamed .* 1 already here/);
});

test('overwrite replaces everything; the open sketch, if gone, stays in the editor as untitled', async ({ page }) => {
  await openApp(page, { [KEY.sketches]: JSON.stringify(MINE), [KEY.current]: 'a', [KEY.buffer]: '// a' });
  await importFile(page, { z: '// z' }, 'overwrite');
  expect(await stored(page)).toEqual({ z: '// z' });
  await expect(page.locator('#tab')).toHaveText('untitled');
  expect(await getCode(page)).toBe('// a');
});

for (const how of ['Cancel', 'Escape']) {
  test(`${how} changes nothing`, async ({ page }) => {
    await openApp(page, { [KEY.sketches]: JSON.stringify(MINE) });
    await importFile(page, { z: '// z' }, how === 'Cancel' ? 'cancel' : null);
    if (how === 'Escape') {
      await expect(page.locator('#import-dialog')).toBeVisible();
      await page.keyboard.press('Escape');
    }
    await expect(page.locator('#status')).toHaveText('import cancelled');
    expect(await stored(page)).toEqual(MINE);
  });
}
for (const [what, content] of [['not JSON', 'osc().out()'], ['the wrong shape', '["a", "b"]']]) {
  test(`a file that's ${what} is rejected without asking`, async ({ page }) => {
    await openApp(page, { [KEY.sketches]: JSON.stringify(MINE) });
    await importFile(page, content);
    await expect(page.locator('#status')).toHaveText("in.json isn't a sketches file");
    await expect(page.locator('#import-dialog')).toBeHidden();
    expect(await stored(page)).toEqual(MINE);
  });
}
