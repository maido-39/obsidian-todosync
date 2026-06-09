// Read-only screenshot of the current dashboard state (no interactions).
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.SHOT_URL ?? 'http://web:5173';
mkdirSync('/work/screenshots', { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 920, height: 1200 } });
await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
await page.screenshot({ path: '/work/screenshots/20-current.png', fullPage: true });
console.log('done');
await browser.close();
