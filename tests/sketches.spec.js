import { test, expect, KEY, openApp, setCode, getCode, sketchNames, answerDialogs, saveAs } from './fixtures.js';

test('switching away from modified untitled code asks first', async ({ page }) => {
  const dialogs = answerDialogs(page, false);
  await openApp(page, { [KEY.sketches]: JSON.stringify({ b: 'osc(5).out()' }), [KEY.buffer]: '// scratch' });
  await expect(page.locator('#tab')).toHaveClass(/dirty/);
  await sketchNames(page).first().click();
  expect(dialogs).toEqual(['Discard unsaved changes to "untitled"?']);
  expect(await getCode(page)).toBe('// scratch');
});

test('untouched starter code switches without asking', async ({ page }) => {
  const dialogs = answerDialogs(page, false);
  await openApp(page, { [KEY.sketches]: JSON.stringify({ b: 'osc(5).out()' }) });
  await sketchNames(page).first().click();
  expect(dialogs).toEqual([]);
  expect(await getCode(page)).toBe('osc(5).out()');
  await expect(page.locator('#tab')).toHaveText('b');
});

test('Ctrl+S in the name input commits it', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press('Control+s');
  const input = page.locator('#sketch-list input');
  await input.fill('x');
  await input.press('Control+s');
  await expect(input).toHaveCount(0);
  await expect(sketchNames(page)).toHaveText(['x']);
  await expect(page.locator('#tab')).toHaveText('x');
});

test('a duplicate name keeps the input open', async ({ page }) => {
  await openApp(page);
  await saveAs(page, 'x');
  await page.keyboard.press('Control+Shift+s');
  const input = page.locator('#sketch-list input');
  await input.fill('x');
  await input.press('Enter');
  await expect(input).toHaveAttribute('title', '"x" already exists');
  await input.press('Escape');
  await expect(sketchNames(page)).toHaveText(['x']);
});

test('new, rename, open and delete', async ({ page }) => {
  const dialogs = answerDialogs(page);
  await openApp(page);
  await setCode(page, '// a');
  await saveAs(page, 'a');

  await page.click('#new-sketch');
  await page.locator('#sketch-list input').fill('n');
  await page.locator('#sketch-list input').press('Enter');
  await expect(page.locator('#tab')).toHaveText('n');
  await expect(sketchNames(page)).toHaveText(['a', 'n']);

  await page.locator('#sketch-list li.active').dblclick();
  await page.locator('#sketch-list input').fill('m');
  await page.locator('#sketch-list input').press('Enter');
  await expect(sketchNames(page)).toHaveText(['a', 'm']);
  await expect(page.locator('#tab')).toHaveText('m');

  await sketchNames(page).filter({ hasText: 'a' }).click();
  expect(await getCode(page)).toBe('// a');

  const row = page.locator('#sketch-list li.active');
  await row.hover();
  await row.getByTitle('Delete').click();
  expect(dialogs).toEqual(['Delete "a"?']);
  await expect(sketchNames(page)).toHaveText(['m']);
  await expect(page.locator('#tab')).toHaveText('untitled'); // the code stays, now untitled
  expect(await getCode(page)).toBe('// a');

  await page.reload();
  await page.locator('.CodeMirror').waitFor();
  await expect(sketchNames(page)).toHaveText(['m']);
  expect(await getCode(page)).toBe('// a');
});
