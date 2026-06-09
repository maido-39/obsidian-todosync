// Screenshot the inline-edit and delete interactions.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.SHOT_URL ?? 'http://web:5173';
const outDir = '/work/screenshots';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 920, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

let n = 10;
async function shot(name) {
  n += 1;
  await page.screenshot({ path: `${outDir}/${n}-${name}.png`, fullPage: true });
  console.log('shot:', name);
}

await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await shot('crud-initial');

// Inline-edit the first task's title.
try {
  await page.locator('.task .title').first().click();
  const edit = page.locator('.task .title-edit').first();
  await edit.fill('디자인 리뷰 (수정됨)');
  await shot('crud-editing');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  await shot('crud-edited');
} catch (e) {
  console.log('edit failed:', e.message);
}

// Delete the last task via its ✕ button.
try {
  await page.locator('.task .del').last().click();
  await page.waitForTimeout(800);
  await shot('crud-deleted');
} catch (e) {
  console.log('delete failed:', e.message);
}

await browser.close();
console.log('done');
