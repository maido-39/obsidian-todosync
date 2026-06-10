// Focused screenshot: the LLM-fallback quick-add preview (AI badge + resolved
// date). Run in the Playwright image: `./dc run --rm shot node scripts/shot-llm.mjs`.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.SHOT_URL ?? 'http://web:5173';
const outDir = '/work/screenshots';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 920, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(500);

const text = '담주 화욜 저녁에 영화 보기';
await page.fill('.quickadd input', text);

// Capture the "해석 중…" busy state first.
await page.click('.quickadd button[type=submit]');
await page.waitForTimeout(150);
await page.screenshot({ path: `${outDir}/llm-1-loading.png`, fullPage: true });
console.log('shot: llm-1-loading.png (해석 중…)');

// Then the resolved preview with the AI badge.
console.log('LLM 해석 대기 (최대 95s)…');
await page.waitForSelector('.pill-ai', { timeout: 95000 });
await page.waitForTimeout(300);
await page.screenshot({ path: `${outDir}/llm-2-preview.png`, fullPage: true });
console.log('shot: llm-2-preview.png (AI 해석 미리보기)');

await browser.close();
