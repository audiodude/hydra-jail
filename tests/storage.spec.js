import { test, expect, KEY, openApp, setCode, getCode, sketchNames, answerDialogs, saveAs } from './fixtures.js';

test('a save without running is what reloads', async ({ page }) => {
  await openApp(page);
  await setCode(page, '// v1');
  await page.click('#run');
  await saveAs(page, 'a');
  await setCode(page, '// v2');
  await page.keyboard.press('Control+s');
  await expect(page.locator('#status')).toHaveText('saved "a"');
  await page.reload();
  await page.locator('.CodeMirror').waitFor();
  expect(await getCode(page)).toBe('// v2');
  await expect(page.locator('#tab')).toHaveText('a');
  await expect(page.locator('#tab')).not.toHaveClass(/dirty/);
});

test('typed edits survive a reload without run or save', async ({ page }) => {
  await openApp(page);
  await setCode(page, '// typed, never run');
  await page.reload(); // immediately, before the autosave debounce
  await page.locator('.CodeMirror').waitFor();
  expect(await getCode(page)).toBe('// typed, never run');
});

test('unreadable sketches are moved aside, not overwritten', async ({ page }) => {
  await openApp(page, { [KEY.sketches]: '{bad json' });
  await expect(page.locator('#status')).toHaveText(/saved sketches were unreadable/);
  await expect(page.locator('#status')).toHaveClass('err');
  const backups = await page.evaluate(() =>
    Object.keys(localStorage).filter((k) => k.startsWith('hydra-jail:sketches:corrupt-')).map((k) => localStorage.getItem(k)));
  expect(backups).toEqual(['{bad json']);
  await saveAs(page, 'fresh');
  await expect(sketchNames(page)).toHaveText(['fresh']);
});

test('a failed write reports the error and changes nothing', async ({ page }) => {
  await openApp(page, { [KEY.sketches]: JSON.stringify({ keep: '// k' }) });
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (this === localStorage) throw new DOMException('quota exceeded', 'QuotaExceededError');
      return setItem.call(this, k, v);
    };
  });
  await saveAs(page, 'q');
  await expect(page.locator('#status')).toHaveText('not saved: quota exceeded');
  await expect(sketchNames(page)).toHaveText(['keep']);
  await expect(page.locator('#tab')).toHaveText('untitled');
});

test('after a run hangs the page, the next load skips the auto-run once', async ({ page }) => {
  await openApp(page, { [KEY.buffer]: 'window.__ran = true; osc().out()' });
  // A hang never reaches pagehide, so the run flag survives into the next load. Simulate that once.
  await page.addInitScript((key) => {
    if (sessionStorage.getItem('test:hung')) return;
    sessionStorage.setItem('test:hung', '1');
    sessionStorage.setItem(key, '1');
  }, KEY.running);
  await page.reload();
  await expect(page.locator('#status')).toHaveText(/auto-run skipped/);
  expect(await page.evaluate(() => window.__ran)).toBeUndefined();
  await page.reload();
  await expect(page.locator('#status')).toHaveText(/^ran at/);
  expect(await page.evaluate(() => window.__ran)).toBe(true);
});

test('a normal reload right after a run still auto-runs', async ({ page }) => {
  await openApp(page);
  await setCode(page, 'window.__ran = true; osc().out()');
  await page.click('#run');
  await page.reload();
  await expect(page.locator('#status')).toHaveText(/^ran at/);
  expect(await page.evaluate(() => window.__ran)).toBe(true);
});

test('tabs share sketches without clobbering each other', async ({ context, page }) => {
  const other = await context.newPage();
  answerDialogs(other);
  await openApp(page);
  await openApp(other);
  await setCode(page, '// from A');
  await saveAs(page, 'a');
  await setCode(other, '// from B');
  await saveAs(other, 'b');
  for (const p of [page, other]) await expect(sketchNames(p)).toHaveText(['a', 'b']);
  expect(JSON.parse(await page.evaluate((k) => localStorage.getItem(k), KEY.sketches)))
    .toEqual({ a: '// from A', b: '// from B' });

  // Deleting A's open sketch from B leaves A's code in place as untitled.
  const row = other.locator('#sketch-list li', { hasText: 'a' });
  await row.hover();
  await row.getByTitle('Delete').click();
  await expect(sketchNames(page)).toHaveText(['b']);
  await expect(page.locator('#tab')).toHaveText('untitled');
  await expect(page.locator('#tab')).toHaveClass(/dirty/);
  expect(await getCode(page)).toBe('// from A');
});
