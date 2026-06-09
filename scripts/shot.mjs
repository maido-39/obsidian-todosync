// Headless screenshot driver for the web dashboard. Runs in the Playwright
// official image (browsers + deps preinstalled). See compose `shot` service.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.SHOT_URL ?? 'http://web:5173';
const outDir = '/work/screenshots';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 920, height: 1100 } });
page.on('console', (m) => console.log('  [page]', m.type(), m.text()));
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

let n = 0;
async function shot(name) {
  n += 1;
  const file = `${outDir}/${String(n).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: file, fullPage: true });
  console.log('shot:', file);
}
async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    console.log(`step "${name}" failed: ${e.message}`);
  }
  await page.waitForTimeout(400);
  await shot(name);
}

console.log('goto', base);
await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(700);
await shot('initial');

await step('quickadd-preview', async () => {
  await page.fill('.quickadd input', '내일 오후 3시 디자인 리뷰 #업무');
  await page.click('.quickadd button[type=submit]');
  await page.waitForSelector('.preview', { timeout: 5000 });
});

await step('after-quickadd', async () => {
  await page.click('.preview-actions button');
  await page.waitForTimeout(700);
});

await step('structured-add', async () => {
  await page.fill('.structured .grow', '장보기');
  await page.fill('.structured input[type=date]', '2026-06-11');
  await page.click('.structured button[type=submit]');
  await page.waitForTimeout(700);
});

await step('toggle-done', async () => {
  await page.locator('.task input[type=checkbox]').first().check({ timeout: 3000 });
  await page.waitForTimeout(500);
});

await step('after-sync', async () => {
  await page.click('.syncbar button');
  await page.waitForTimeout(2500);
});

await browser.close();
console.log('done');
